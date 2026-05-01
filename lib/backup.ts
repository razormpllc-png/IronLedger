// Backup / restore — schema-versioned JSON dump of every row in every
// Iron Ledger table, plus inlined base64 copies of any images referenced
// by image_uri columns. Used for:
//
//   • Manual backups before the user tries something risky.
//   • Migration to a new device (AirDrop the file, import on the new phone).
//   • Data ownership — the user owns their records, not us.
//
// Design notes
// ------------
// • Schema is introspected via PRAGMA table_info so adding a column to a
//   table doesn't require updating this file. Whatever columns SQLite
//   reports get dumped.
// • Photos referenced by image_uri (firearms, firearm_photos, accessories)
//   are read as base64 and stored in a side-channel `photos` map keyed by
//   the original stored path. On restore we write each blob to a fresh
//   file under documentDirectory and rewrite the column to the new
//   relative path.
// • Import is destructive: we wipe every table before re-inserting. A
//   partial/merge mode would mean resolving ID conflicts and is out of
//   scope for v1. Callers MUST confirm with the user first.

import * as FileSystem from 'expo-file-system/legacy';
import { Paths } from 'expo-file-system';
import { db, resolveImageUri, toRelativeImagePath } from './database';

/** Bump whenever the dump format changes. Importers reject newer versions. */
export const BACKUP_VERSION = 1;

/**
 * Every table we back up, in dependency order (parents before children).
 * Restore walks this list top-down when inserting so foreign keys resolve.
 * Wipe walks it bottom-up so children clear before parents.
 */
const TABLES = [
  'firearms',
  'suppressors',
  'nfa_trusts',
  'ammo',
  'accessories',
  'maintenance_logs',
  'expenses',
  'firearm_photos',
  'battery_logs',
  'form4_checkins',
  'range_sessions',
  'range_session_firearms',
  'dispositions',
  'dope_cards',
  'dope_entries',
] as const;

/** Columns across the schema that hold an image path. */
const IMAGE_COLUMNS: Record<string, string[]> = {
  firearms: ['image_uri', 'tax_stamp_image', 'atf_form_front_uri', 'atf_form_back_uri'],
  suppressors: ['image_uri', 'tax_stamp_image', 'atf_form_front_uri', 'atf_form_back_uri'],
  firearm_photos: ['image_uri'],
  accessories: ['image_uri'],
};

type Row = Record<string, any>;

export interface BackupFile {
  app: 'ironledger';
  version: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
  /** Map of stored image_uri → { base64, mime } for photo restoration. */
  photos: Record<string, { base64: string; mime: string }>;
}

// ---------------------------------------------------------------------------
// Column introspection — PRAGMA table_info returns name/cid/type/etc per col.
// ---------------------------------------------------------------------------

function columnsFor(table: string): string[] {
  const rows = db.getAllSync(`PRAGMA table_info(${table})`) as any[];
  return rows.map(r => r.name as string);
}

// ---------------------------------------------------------------------------
// Photo helpers
// ---------------------------------------------------------------------------

function mimeForUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function extForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  return 'jpg';
}

async function readAsBase64(stored: string): Promise<{ base64: string; mime: string } | null> {
  const abs = resolveImageUri(stored);
  if (!abs) return null;
  try {
    const info = await FileSystem.getInfoAsync(abs);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(abs, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64, mime: mimeForUri(stored) };
  } catch (e) {
    console.warn('[backup] skipping unreadable photo', stored, e);
    return null;
  }
}

/**
 * Collect every image path referenced by the dump, read each once, and
 * return a dedup'd `stored path → blob` map.
 */
async function collectPhotos(tables: Record<string, Row[]>): Promise<BackupFile['photos']> {
  const seen = new Set<string>();
  for (const [table, cols] of Object.entries(IMAGE_COLUMNS)) {
    const rows = tables[table] ?? [];
    for (const row of rows) {
      for (const col of cols) {
        const v = row[col];
        if (typeof v === 'string' && v.length) seen.add(v);
      }
    }
  }
  const out: BackupFile['photos'] = {};
  for (const stored of seen) {
    const blob = await readAsBase64(stored);
    if (blob) out[stored] = blob;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Omit to dump everything. Pass a subset for partial exports. */
  tables?: readonly string[];
  /** Skip the base64 photo payload (smaller file, images won't restore). */
  includePhotos?: boolean;
}

export async function exportToJson(opts: ExportOptions = {}): Promise<BackupFile> {
  const list = opts.tables ?? TABLES;
  const includePhotos = opts.includePhotos ?? true;

  const tables: Record<string, Row[]> = {};
  for (const table of list) {
    const rows = db.getAllSync(`SELECT * FROM ${table}`) as Row[];
    tables[table] = rows;
  }

  const photos = includePhotos ? await collectPhotos(tables) : {};

  return {
    app: 'ironledger',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    photos,
  };
}

/**
 * Serialize a backup + write it to the cache with a date-stamped filename
 * so it's ready to hand to a share sheet.
 */
export async function writeBackupToCache(backup: BackupFile): Promise<string> {
  const stamp = backup.exportedAt.slice(0, 10); // YYYY-MM-DD
  const path = `${Paths.cache.uri}ironledger-backup-${stamp}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(backup), {
    encoding: 'utf8',
  });
  return path;
}

// ---------------------------------------------------------------------------
// Import / restore
// ---------------------------------------------------------------------------

export interface RestoreResult {
  tables: Record<string, number>; // rows inserted per table
  photosWritten: number;
  photosSkipped: number;
}

function assertBackup(obj: any): asserts obj is BackupFile {
  if (!obj || obj.app !== 'ironledger') {
    throw new Error('Not an Iron Ledger backup file.');
  }
  if (typeof obj.version !== 'number') {
    throw new Error('Backup missing version.');
  }
  if (obj.version > BACKUP_VERSION) {
    throw new Error(
      `Backup was created by a newer version of Iron Ledger (v${obj.version}). ` +
      `Update the app before restoring.`,
    );
  }
  if (!obj.tables || typeof obj.tables !== 'object') {
    throw new Error('Backup is missing table data.');
  }
}

/**
 * Write every photo blob to documentDirectory with a fresh filename and
 * return a `oldPath → newRelativePath` map so we can rewrite image_uri
 * columns before inserting rows.
 */
async function restorePhotos(
  photos: BackupFile['photos'] | undefined,
): Promise<{ map: Record<string, string>; written: number; skipped: number }> {
  const map: Record<string, string> = {};
  let written = 0;
  let skipped = 0;
  if (!photos) return { map, written, skipped };

  const docDir = Paths.document.uri.endsWith('/') ? Paths.document.uri : Paths.document.uri + '/';

  let counter = Date.now();
  for (const [oldPath, blob] of Object.entries(photos)) {
    const name = `restore-${counter++}.${extForMime(blob.mime)}`;
    const absolute = docDir + name;
    try {
      await FileSystem.writeAsStringAsync(absolute, blob.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Store as relative path so resolveImageUri() handles it everywhere.
      map[oldPath] = toRelativeImagePath(absolute);
      written++;
    } catch (e) {
      console.warn('[backup] failed to restore photo', oldPath, e);
      skipped++;
    }
  }
  return { map, written, skipped };
}

function rewriteImagePaths(table: string, rows: Row[], map: Record<string, string>): Row[] {
  const cols = IMAGE_COLUMNS[table];
  if (!cols || cols.length === 0) return rows;
  return rows.map(row => {
    const copy = { ...row };
    for (const col of cols) {
      const v = copy[col];
      if (typeof v === 'string' && map[v]) {
        copy[col] = map[v];
      }
    }
    return copy;
  });
}

/**
 * Wipe every row from every known table. Runs bottom-up so child tables
 * clear before their parents (in case foreign keys are enforced).
 */
function wipeAll() {
  db.execSync('BEGIN');
  try {
    for (let i = TABLES.length - 1; i >= 0; i--) {
      db.runSync(`DELETE FROM ${TABLES[i]}`);
    }
    // Reset AUTOINCREMENT counters so restored IDs start clean.
    try {
      db.runSync(`DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map(() => '?').join(',')})`, TABLES as any);
    } catch {
      // sqlite_sequence may not exist if no AUTOINCREMENT tables have been used.
    }
    db.execSync('COMMIT');
  } catch (e) {
    db.execSync('ROLLBACK');
    throw e;
  }
}

function insertRows(table: string, rows: Row[]): number {
  if (!rows || rows.length === 0) return 0;
  const schemaCols = new Set(columnsFor(table));
  let count = 0;
  for (const row of rows) {
    // Only include columns that still exist in the live schema. This makes
    // importing backups from an older schema (missing columns) a no-op on
    // those columns rather than a hard failure.
    const keep = Object.keys(row).filter(k => schemaCols.has(k));
    if (keep.length === 0) continue;
    const placeholders = keep.map(() => '?').join(',');
    const values = keep.map(k => {
      const v = row[k];
      // SQLite accepts null/number/string/boolean but expo-sqlite is picky
      // about plain objects — flatten anything unexpected to a string.
      if (v === null || v === undefined) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    db.runSync(
      `INSERT INTO ${table} (${keep.join(',')}) VALUES (${placeholders})`,
      values as any,
    );
    count++;
  }
  return count;
}

export async function importFromJson(raw: string | BackupFile): Promise<RestoreResult> {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  assertBackup(parsed);

  const photoResult = await restorePhotos(parsed.photos);

  const inserted: Record<string, number> = {};
  wipeAll();

  db.execSync('BEGIN');
  try {
    for (const table of TABLES) {
      const rows = parsed.tables[table] ?? [];
      const rewritten = rewriteImagePaths(table, rows, photoResult.map);
      inserted[table] = insertRows(table, rewritten);
    }
    db.execSync('COMMIT');
  } catch (e) {
    db.execSync('ROLLBACK');
    throw e;
  }

  return {
    tables: inserted,
    photosWritten: photoResult.written,
    photosSkipped: photoResult.skipped,
  };
}

/** Read a file URI and hand it to importFromJson. Convenience wrapper. */
export async function importFromFile(uri: string): Promise<RestoreResult> {
  const raw = await FileSystem.readAsStringAsync(uri, {
    encoding: 'utf8',
  });
  return importFromJson(raw);
}
