import * as SQLite from 'expo-sqlite';
import { Paths, File } from 'expo-file-system';

const db = SQLite.openDatabaseSync('ironledger.db');

// Exported so backup/restore (lib/backup.ts) can run raw SELECT/INSERT against
// every table without having to thread a handle through each helper.
export { db };

/**
 * Format a stored date string into a readable display format.
 * Handles: 'YYYY-MM-DD', 'MMDDYYYY', 'MM-DD-YYYY', 'MM/DD/YYYY', etc.
 * Returns 'Month DD, YYYY' (e.g. 'April 8, 2026').
 */
export function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\/\-\.]/g, '');
  let y: number, m: number, d: number;
  if (cleaned.length === 8) {
    // Could be YYYYMMDD or MMDDYYYY
    const firstFour = parseInt(cleaned.slice(0, 4));
    if (firstFour > 1900 && firstFour < 2100) {
      // YYYYMMDD
      y = firstFour;
      m = parseInt(cleaned.slice(4, 6));
      d = parseInt(cleaned.slice(6, 8));
    } else {
      // MMDDYYYY
      m = parseInt(cleaned.slice(0, 2));
      d = parseInt(cleaned.slice(2, 4));
      y = parseInt(cleaned.slice(4, 8));
    }
  } else {
    // Try native parse as fallback
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return raw;
    y = parsed.getFullYear();
    m = parsed.getMonth() + 1;
    d = parsed.getDate();
  }

  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return raw;

  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** Shorter date string (e.g. "Apr 22, 2026") — fits tighter UI cells. */
export function formatDateShort(raw: string | null): string | null {
  if (!raw) return null;
  const full = formatDate(raw);
  if (!full || full === raw) return full;
  const shorts = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  for (let i = 0; i < months.length; i++) {
    if (full.startsWith(months[i])) return full.replace(months[i], shorts[i]);
  }
  return full;
}

/** Get the document directory URI with trailing slash. */
function getDocDirUri(): string {
  const uri = Paths.document.uri;
  return uri.endsWith('/') ? uri : uri + '/';
}

/** Convert an absolute image URI to a relative filename for storage. */
export function toRelativeImagePath(absoluteUri: string): string {
  const docUri = getDocDirUri();
  if (absoluteUri.startsWith(docUri)) {
    return absoluteUri.slice(docUri.length);
  }
  return absoluteUri;
}

/** Resolve a stored (possibly relative) image path to a full URI. */
export function resolveImageUri(stored: string | null): string | null {
  if (!stored) return null;
  // Already absolute
  if (stored.startsWith('file://') || stored.startsWith('http')) return stored;
  // Relative — resolve against documentDirectory
  return getDocDirUri() + stored;
}

export function initDB() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS firearms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      make TEXT NOT NULL, model TEXT NOT NULL,
      caliber TEXT, serial_number TEXT, type TEXT,
      purchase_date TEXT, purchase_price REAL, current_value REAL,
      condition_rating TEXT, notes TEXT, image_uri TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      date TEXT,
      type TEXT,
      rounds_fired INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS ammo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caliber TEXT NOT NULL,
      brand TEXT,
      grain INTEGER,
      type TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      cost_per_box REAL,
      rounds_per_box INTEGER DEFAULT 50,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      firearm_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add details column if missing (migration)
  try {
    db.runSync('ALTER TABLE maintenance_logs ADD COLUMN details TEXT');
  } catch (_) { /* column already exists */ }

  // Add low_stock_threshold column if missing
  try {
    db.runSync('ALTER TABLE ammo ADD COLUMN low_stock_threshold INTEGER DEFAULT 100');
  } catch (_) { /* column already exists */ }

  // Add paired_firearm_ids column if missing. Stores a JSON array of firearm
  // IDs this ammo row is explicitly paired with — lets the user tag a lot of
  // match-grade 9mm to a specific SIG instead of every 9mm host, for cases
  // where caliber-matching alone is too broad.
  try {
    db.runSync('ALTER TABLE ammo ADD COLUMN paired_firearm_ids TEXT');
  } catch (_) { /* column already exists */ }

  // Reloading / handload fields
  const reloadCols: Array<[string, string]> = [
    ['is_handload', 'INTEGER DEFAULT 0'],
    ['powder_brand', 'TEXT'],
    ['powder_type', 'TEXT'],
    ['charge_weight', 'REAL'],
    ['bullet_brand', 'TEXT'],
    ['bullet_weight', 'REAL'],
    ['bullet_type', 'TEXT'],
    ['brass_brand', 'TEXT'],
    ['brass_times_fired', 'INTEGER'],
    ['primer_brand', 'TEXT'],
    ['primer_type', 'TEXT'],
    ['coal', 'REAL'],
    ['cbto', 'REAL'],
    ['velocity_fps', 'REAL'],
    ['velocity_sd', 'REAL'],
    ['velocity_es', 'REAL'],
    ['group_size', 'TEXT'],
    ['load_notes', 'TEXT'],
  ];
  for (const [col, colType] of reloadCols) {
    try { db.runSync(`ALTER TABLE ammo ADD COLUMN ${col} ${colType}`); } catch (_) {}
  }

  // Add new firearm fields (migrations)
  const newFirearmCols = [
    ['nickname', 'TEXT'],
    ['action_type', 'TEXT'],
    ['trigger_type', 'TEXT'],
    ['acquisition_method', 'TEXT'],
    ['purchased_from', 'TEXT'],
    ['dealer_city_state', 'TEXT'],
    ['storage_location', 'TEXT'],
    ['round_count', 'INTEGER DEFAULT 0'],
    ['value_last_updated', 'TEXT'],
    ['is_nfa', 'INTEGER DEFAULT 0'],
    ['nfa_form_type', 'TEXT'],
    ['nfa_item_category', 'TEXT'],
    ['atf_form_status', 'TEXT'],
    ['atf_control_number', 'TEXT'],
    ['date_filed', 'TEXT'],
    ['date_approved', 'TEXT'],
    ['tax_paid_amount', 'REAL'],
    ['trust_type', 'TEXT'],
    ['trust_name', 'TEXT'],
    ['responsible_persons', 'TEXT'],
    ['trust_id', 'INTEGER'],
    // Relative image path for the approved tax stamp. Populated when the
    // user marks a Form 4 as Approved and uploads the stamp photo.
    ['tax_stamp_image', 'TEXT'],
    // Scanned ATF form images (Pro: document_storage). Front = the filed
    // form, back = the approved back-page/stamp. Relative paths.
    ['atf_form_front_uri', 'TEXT'],
    ['atf_form_back_uri', 'TEXT'],
    ['atf_form_scanned_at', 'TEXT'],
    // Maintenance reminder config (Pro: maintenance_reminders). Either/both
    // can be set. Round-count thresholds are evaluated on log open;
    // month-based intervals drive scheduled push notifications via
    // lib/maintenanceNotifications.ts. The notification id is stored so we
    // can cancel it when the user logs new maintenance or changes the interval.
    ['maintenance_interval_months', 'INTEGER'],
    ['maintenance_interval_rounds', 'INTEGER'],
    ['maintenance_notification_id', 'TEXT'],
    ['ownership_type', "TEXT DEFAULT 'personal'"],
  ];
  for (const [col, colType] of newFirearmCols) {
    try { db.runSync(`ALTER TABLE firearms ADD COLUMN ${col} ${colType}`); } catch (_) {}
  }

  // Add new range_sessions fields (migrations)
  const newRangeSessionCols = [
    ['session_type', "TEXT DEFAULT 'outdoor'"],
    ['temperature', 'TEXT'],
    ['humidity', 'TEXT'],
    ['wind', 'TEXT'],
    ['conditions', 'TEXT'],
    ['match_name', 'TEXT'],
    ['match_url', 'TEXT'],
    ['division', 'TEXT'],
    ['classification', 'TEXT'],
    ['placement', 'TEXT'],
    ['match_score', 'TEXT'],
  ];
  for (const [col, colType] of newRangeSessionCols) {
    try { db.runSync(`ALTER TABLE range_sessions ADD COLUMN ${col} ${colType}`); } catch (_) {}
  }

  // Create accessories table
  db.execSync(`
    CREATE TABLE IF NOT EXISTS accessories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      accessory_type TEXT NOT NULL,
      make TEXT,
      model TEXT,
      serial_number TEXT,
      notes TEXT,
      image_uri TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE
    );
  `);

  // Suppressors. Top-level items (like firearms) rather than accessories —
  // suppressors legitimately move between host platforms, so tying them to a
  // single firearm via firearm_id (the old accessory model) was the wrong
  // shape. Columns mirror the firearm NFA fields for code reuse + backup
  // stability. `host_notes` is the free-text "currently mounted on my Rattler /
  // used with 22 host / etc." field.
  db.execSync(`
    CREATE TABLE IF NOT EXISTS suppressors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      serial_number TEXT,
      caliber TEXT,
      purchase_date TEXT,
      purchase_price REAL,
      current_value REAL,
      condition_rating TEXT,
      notes TEXT,
      image_uri TEXT,
      purchased_from TEXT,
      dealer_city_state TEXT,
      storage_location TEXT,
      round_count INTEGER DEFAULT 0,
      value_last_updated TEXT,
      nfa_form_type TEXT,
      atf_form_status TEXT,
      atf_control_number TEXT,
      date_filed TEXT,
      date_approved TEXT,
      tax_paid_amount REAL,
      tax_stamp_image TEXT,
      trust_type TEXT,
      trust_name TEXT,
      responsible_persons TEXT,
      trust_id INTEGER,
      length_inches TEXT,
      weight_oz TEXT,
      thread_pitch TEXT,
      mount_type TEXT,
      full_auto_rated INTEGER DEFAULT 0,
      host_notes TEXT,
      atf_form_front_uri TEXT,
      atf_form_back_uri TEXT,
      atf_form_scanned_at TEXT,
      end_cap_type TEXT,
      end_cap_notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Idempotent column adds for existing suppressors installs.
  const newSuppressorCols: Array<[string, string]> = [
    ['atf_form_front_uri', 'TEXT'],
    ['atf_form_back_uri', 'TEXT'],
    ['atf_form_scanned_at', 'TEXT'],
    ['end_cap_type', 'TEXT'],
    ['end_cap_notes', 'TEXT'],
  ];
  for (const [col, colType] of newSuppressorCols) {
    try { db.runSync(`ALTER TABLE suppressors ADD COLUMN ${col} ${colType}`); } catch (_) {}
  }

  // One-time migration: promote any Suppressor-type accessory rows into the
  // new suppressors table, preserving the SuppressorDetails JSON fields as
  // real columns. Idempotent — the DELETE at the end removes migrated rows
  // so a second run is a no-op.
  try {
    const legacySuppressors = db.getAllSync(
      `SELECT a.*, f.make as host_make, f.model as host_model, f.nickname as host_nickname
         FROM accessories a
         LEFT JOIN firearms f ON f.id = a.firearm_id
        WHERE a.accessory_type = 'Suppressor'`
    ) as Array<any>;
    for (const row of legacySuppressors) {
      let d: any = {};
      if (row.details) { try { d = JSON.parse(row.details) ?? {}; } catch { d = {}; } }
      const hostName = [row.host_nickname, row.host_make, row.host_model]
        .filter(Boolean).join(' ').trim();
      const hostNotes = hostName ? `Previously linked to: ${hostName}` : null;
      db.runSync(
        `INSERT INTO suppressors (
           make, model, serial_number, caliber, notes, image_uri,
           nfa_form_type, atf_form_status, atf_control_number, date_filed, date_approved,
           tax_paid_amount, length_inches, weight_oz, thread_pitch, mount_type,
           full_auto_rated, host_notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.make ?? 'Unknown',
          row.model ?? 'Suppressor',
          row.serial_number ?? null,
          d.caliber ?? null,
          row.notes ?? null,
          row.image_uri ?? null,
          d.nfa_form_type ?? null,
          d.atf_status ?? null,
          d.atf_control_number ?? null,
          d.date_filed ?? null,
          d.date_approved ?? null,
          typeof d.tax_paid === 'number' ? d.tax_paid : null,
          d.length_inches ?? null,
          d.weight_oz ?? null,
          d.thread_pitch ?? null,
          d.mount_type ?? null,
          d.full_auto_rated ? 1 : 0,
          hostNotes,
          row.created_at ?? null,
        ]
      );
    }
    if (legacySuppressors.length > 0) {
      db.runSync(`DELETE FROM accessories WHERE accessory_type = 'Suppressor'`);
    }
  } catch (e) {
    console.warn('[db] Suppressor migration failed; leaving legacy rows in place', e);
  }

  // NFA trusts / responsible persons registry. Lets the user define trusts
  // and corporations once and reuse them across NFA items instead of
  // retyping the trust name and RPs for each firearm.
  db.execSync(`
    CREATE TABLE IF NOT EXISTS nfa_trusts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trust_type TEXT NOT NULL,
      responsible_persons TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Firearm photo gallery (photos beyond the primary image_uri). Lite is
  // limited to just the primary image; Pro can store up to 20 per firearm
  // (cap enforced at the UI layer). Deleting a firearm cascades.
  db.execSync(`
    CREATE TABLE IF NOT EXISTS firearm_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      image_uri TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE
    );
  `);

  // Battery log — tracks battery installations for optics, lights, lasers,
  // and other battery-powered accessories. A log stays "active" until
  // replacement_date is set, at which point it becomes history and a new
  // log is created for the next install. `device_label` is free-text so the
  // user can name their RDS, WML, etc. `expected_life_months` seeds the due
  // date shown in the hub and notification scheduling.
  db.execSync(`
    CREATE TABLE IF NOT EXISTS battery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER,
      accessory_id INTEGER,
      device_label TEXT NOT NULL,
      battery_type TEXT NOT NULL,
      install_date TEXT NOT NULL,
      expected_life_months INTEGER DEFAULT 12,
      replacement_date TEXT,
      notification_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE SET NULL,
      FOREIGN KEY (accessory_id) REFERENCES accessories(id) ON DELETE SET NULL
    );
  `);

  // Form 4 check-in log — lets the user record each time they check ATF
  // status for a pending NFA item (phone call, eForms status page, etc.).
  db.execSync(`
    CREATE TABLE IF NOT EXISTS form4_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      checkin_date TEXT NOT NULL,
      method TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS range_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT NOT NULL,
      location TEXT,
      weather TEXT,
      notes TEXT,
      session_type TEXT DEFAULT 'outdoor',
      temperature TEXT,
      humidity TEXT,
      wind TEXT,
      conditions TEXT,
      match_name TEXT,
      match_url TEXT,
      division TEXT,
      classification TEXT,
      placement TEXT,
      match_score TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS range_session_firearms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      firearm_id INTEGER NOT NULL,
      ammo_id INTEGER,
      rounds_fired INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (session_id) REFERENCES range_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE,
      FOREIGN KEY (ammo_id) REFERENCES ammo(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS range_session_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      image_uri TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES range_sessions(id) ON DELETE CASCADE
    );

    -- Competition matches — full match tracking for USPSA, IDPA, Steel
    -- Challenge, and outlaw matches. Separate from range_sessions so a
    -- match can exist independently or link to a session.
    CREATE TABLE IF NOT EXISTS competition_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_date TEXT NOT NULL,
      match_name TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'USPSA',  -- USPSA, IDPA, Steel Challenge, Outlaw
      practiscore_url TEXT,
      location TEXT,
      firearm_id INTEGER,
      ammo_id INTEGER,
      division TEXT,
      classification TEXT,
      overall_placement INTEGER,
      division_placement INTEGER,
      total_stages INTEGER,
      overall_score REAL,
      overall_hit_factor REAL,
      squad_notes TEXT,
      notes TEXT,
      session_id INTEGER,   -- optional link to a range_session
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE SET NULL,
      FOREIGN KEY (ammo_id) REFERENCES ammo(id) ON DELETE SET NULL,
      FOREIGN KEY (session_id) REFERENCES range_sessions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comp_matches_date ON competition_matches(match_date);

    -- Per-stage breakdown for competition matches
    CREATE TABLE IF NOT EXISTS competition_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      stage_number INTEGER NOT NULL,
      stage_name TEXT,
      -- Scoring (USPSA-style)
      points REAL,
      time REAL,
      hit_factor REAL,
      penalties INTEGER DEFAULT 0,
      -- USPSA hit counts
      a_hits INTEGER,
      c_hits INTEGER,
      d_hits INTEGER,
      m_hits INTEGER,       -- misses
      ns_hits INTEGER,      -- no-shoots
      procedural INTEGER DEFAULT 0,
      -- IDPA scoring
      points_down REAL,
      stage_score REAL,
      -- Steel Challenge
      best_time REAL,
      strings_json TEXT,   -- JSON array of individual string times
      -- General
      stage_placement INTEGER,
      notes TEXT,
      FOREIGN KEY (match_id) REFERENCES competition_matches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comp_stages_match ON competition_stages(match_id);

    -- Dispositions: the "exit" side of the FFL bound book. Polymorphic over
    -- firearms and suppressors via (item_kind, item_id) because the two
    -- tables share almost nothing structurally and a single union table
    -- keeps the A&D export + on-device queries simple. Only ONE active
    -- disposition per item for now — the UI enforces this, not the DB,
    -- since we may eventually want to track multi-step transfers.
    CREATE TABLE IF NOT EXISTS dispositions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_kind TEXT NOT NULL,              -- 'firearm' | 'suppressor'
      item_id INTEGER NOT NULL,
      disposition_date TEXT NOT NULL,
      disposition_type TEXT NOT NULL,       -- Sold / Transferred / Gifted / Traded / Stolen / Lost / Destroyed / Returned
      to_name TEXT,
      to_address TEXT,
      to_ffl_number TEXT,
      form_4473_serial TEXT,
      sale_price REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dispositions_item
      ON dispositions(item_kind, item_id);

    -- DOPE cards — per-firearm (optionally per-ammo) shooting data. A card
    -- is the header (zero, units, scope, conditions). The actual distance
    -- rows live in dope_entries, one row per distance. Cascading delete so
    -- scrubbing a firearm (or the card itself) takes the child rows too.
    CREATE TABLE IF NOT EXISTS dope_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      ammo_description TEXT,
      zero_distance_yards REAL,
      units TEXT NOT NULL DEFAULT 'MOA',   -- 'MOA' or 'MIL'
      scope_notes TEXT,
      conditions_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dope_cards_firearm ON dope_cards(firearm_id);

    CREATE TABLE IF NOT EXISTS dope_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dope_card_id INTEGER NOT NULL,
      distance_yards REAL NOT NULL,
      elevation REAL,         -- ELEVATION USED (card units, MOA or MIL)
      windage REAL,           -- WINDAGE USED (card units)
      drop_inches REAL,
      notes TEXT,             -- Remarks column on the paper card
      range_name TEXT,
      light TEXT,
      mirage TEXT,
      temperature TEXT,
      hour_time TEXT,
      hold TEXT,
      elevation_correct REAL, -- ELEVATION CORRECT (observed)
      windage_correct REAL,   -- WINDAGE CORRECT (observed)
      wind_velocity TEXT,
      wind_clock INTEGER,     -- 1-12 clock position (wind from)
      light_clock INTEGER,    -- 1-12 clock position (sun from)
      shots_json TEXT,        -- JSON array of up to 10 {elev, wind, called}
      FOREIGN KEY (dope_card_id) REFERENCES dope_cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dope_entries_card ON dope_entries(dope_card_id);
  `);

  // Additive migrations for dope_entries — pre-existing installs won't have
  // the expanded USMC-style columns. ALTER TABLE ADD COLUMN is idempotent
  // via try/catch because SQLite has no "IF NOT EXISTS" for columns.
  const dopeEntryAdds = [
    "ALTER TABLE dope_entries ADD COLUMN range_name TEXT",
    "ALTER TABLE dope_entries ADD COLUMN light TEXT",
    "ALTER TABLE dope_entries ADD COLUMN mirage TEXT",
    "ALTER TABLE dope_entries ADD COLUMN temperature TEXT",
    "ALTER TABLE dope_entries ADD COLUMN hour_time TEXT",
    "ALTER TABLE dope_entries ADD COLUMN hold TEXT",
    "ALTER TABLE dope_entries ADD COLUMN elevation_correct REAL",
    "ALTER TABLE dope_entries ADD COLUMN windage_correct REAL",
    "ALTER TABLE dope_entries ADD COLUMN wind_velocity TEXT",
    "ALTER TABLE dope_entries ADD COLUMN wind_clock INTEGER",
    "ALTER TABLE dope_entries ADD COLUMN light_clock INTEGER",
    "ALTER TABLE dope_entries ADD COLUMN shots_json TEXT",
  ];
  for (const sql of dopeEntryAdds) {
    try { db.execSync(sql); } catch { /* column already exists */ }
  }

  // Migrate any existing absolute image paths to relative
  const rows = db.getAllSync(
    `SELECT id, image_uri FROM firearms WHERE image_uri IS NOT NULL AND image_uri LIKE 'file://%'`
  ) as { id: number; image_uri: string }[];
  for (const row of rows) {
    const relative = toRelativeImagePath(row.image_uri);
    if (relative !== row.image_uri) {
      db.runSync('UPDATE firearms SET image_uri = ? WHERE id = ?', [relative, row.id]);
    }
  }
}

export interface Firearm {
  id: number; make: string; model: string;
  caliber: string | null; serial_number: string | null; type: string | null;
  purchase_date: string | null; purchase_price: number | null; current_value: number | null;
  condition_rating: string | null; notes: string | null; image_uri: string | null;
  created_at: string;
  // New fields
  nickname: string | null;
  action_type: string | null;
  trigger_type: string | null;
  acquisition_method: string | null;
  purchased_from: string | null;
  dealer_city_state: string | null;
  storage_location: string | null;
  round_count: number;
  value_last_updated: string | null;
  // NFA fields
  is_nfa: number;
  nfa_form_type: string | null;
  nfa_item_category: string | null;
  atf_form_status: string | null;
  atf_control_number: string | null;
  date_filed: string | null;
  date_approved: string | null;
  tax_paid_amount: number | null;
  trust_type: string | null;
  trust_name: string | null;
  responsible_persons: string | null;
  trust_id: number | null;
  tax_stamp_image: string | null;
  // Scanned copies of the filed ATF form. Pro (document_storage).
  atf_form_front_uri: string | null;
  atf_form_back_uri: string | null;
  atf_form_scanned_at: string | null;
  // Maintenance reminder config (Pro: maintenance_reminders).
  maintenance_interval_months: number | null;
  maintenance_interval_rounds: number | null;
  maintenance_notification_id: string | null;
  ownership_type: string | null;  // 'personal' | 'business'
}

export interface MaintenanceLog {
  id: number; firearm_id: number; date: string | null;
  type: string | null; rounds_fired: number | null; notes: string | null;
  details: string | null; created_at: string;
}

/** Type-specific detail interfaces */
export interface CleaningDetails {
  cleaning_type: 'Wipe Down' | 'Field Strip' | 'Deep Clean';
  solvents: string;
  parts_replaced: string;
}

export interface InspectionDetails {
  reason: 'Pre' | 'Post' | 'Periodic' | 'Detailed' | 'Safety';
}

export interface RepairDetails {
  repairs_made: string;
  components: string;
}

export interface UpgradeDetails {
  description: string;
}

export interface RangeSessionDetails {
  duration: string;
  conditions: string;
}

export function parseDetails<T>(log: MaintenanceLog): T | null {
  if (!log.details) return null;
  try { return JSON.parse(log.details) as T; } catch { return null; }
}

export function addFirearm(data: {
  make: string; model: string; caliber?: string | null; serial_number?: string | null;
  type?: string | null; purchase_date?: string | null; purchase_price?: number | null;
  current_value?: number | null; condition_rating?: string | null; notes?: string | null; image_uri?: string | null;
  nickname?: string | null; action_type?: string | null; trigger_type?: string | null;
  acquisition_method?: string | null;
  purchased_from?: string | null; dealer_city_state?: string | null; storage_location?: string | null;
  round_count?: number; value_last_updated?: string | null;
  is_nfa?: number; nfa_form_type?: string | null; nfa_item_category?: string | null;
  atf_form_status?: string | null; atf_control_number?: string | null; date_filed?: string | null;
  date_approved?: string | null; tax_paid_amount?: number | null; trust_type?: string | null;
  trust_name?: string | null; responsible_persons?: string | null; trust_id?: number | null;
  ownership_type?: string | null;
}): number {
  const result = db.runSync(
    `INSERT INTO firearms (make, model, caliber, serial_number, type, purchase_date, purchase_price,
     current_value, condition_rating, notes, image_uri, nickname, action_type, trigger_type,
     acquisition_method, purchased_from, dealer_city_state, storage_location, round_count,
     value_last_updated, is_nfa, nfa_form_type, nfa_item_category, atf_form_status,
     atf_control_number, date_filed, date_approved, tax_paid_amount, trust_type, trust_name,
     responsible_persons, trust_id, ownership_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.make, data.model, data.caliber ?? null, data.serial_number ?? null, data.type ?? null,
     data.purchase_date ?? null, data.purchase_price ?? null, data.current_value ?? null,
     data.condition_rating ?? null, data.notes ?? null, data.image_uri ?? null,
     data.nickname ?? null, data.action_type ?? null, data.trigger_type ?? null,
     data.acquisition_method ?? null,
     data.purchased_from ?? null, data.dealer_city_state ?? null, data.storage_location ?? null,
     data.round_count ?? 0, data.value_last_updated ?? null,
     data.is_nfa ?? 0, data.nfa_form_type ?? null, data.nfa_item_category ?? null,
     data.atf_form_status ?? null, data.atf_control_number ?? null, data.date_filed ?? null,
     data.date_approved ?? null, data.tax_paid_amount ?? null, data.trust_type ?? null,
     data.trust_name ?? null, data.responsible_persons ?? null, data.trust_id ?? null,
     data.ownership_type ?? 'personal']
  );
  return result.lastInsertRowId as number;
}

export function getAllFirearms(): Firearm[] {
  return db.getAllSync('SELECT * FROM firearms ORDER BY created_at DESC') as Firearm[];
}

export function getFirearmById(id: number): Firearm | null {
  return db.getFirstSync('SELECT * FROM firearms WHERE id = ?', [id]) as Firearm | null;
}

export function updateFirearm(id: number, data: {
  make: string; model: string; caliber?: string | null; serial_number?: string | null;
  type?: string | null; purchase_date?: string | null; purchase_price?: number | null;
  current_value?: number | null; condition_rating?: string | null; notes?: string | null; image_uri?: string | null;
  nickname?: string | null; action_type?: string | null; trigger_type?: string | null;
  acquisition_method?: string | null;
  purchased_from?: string | null; dealer_city_state?: string | null; storage_location?: string | null;
  round_count?: number; value_last_updated?: string | null;
  is_nfa?: number; nfa_form_type?: string | null; nfa_item_category?: string | null;
  atf_form_status?: string | null; atf_control_number?: string | null; date_filed?: string | null;
  date_approved?: string | null; tax_paid_amount?: number | null; trust_type?: string | null;
  trust_name?: string | null; responsible_persons?: string | null; trust_id?: number | null;
  ownership_type?: string | null;
}) {
  db.runSync(
    `UPDATE firearms SET make=?, model=?, caliber=?, serial_number=?, type=?, purchase_date=?,
     purchase_price=?, current_value=?, condition_rating=?, notes=?, image_uri=?,
     nickname=?, action_type=?, trigger_type=?, acquisition_method=?, purchased_from=?,
     dealer_city_state=?, storage_location=?, round_count=?, value_last_updated=?,
     is_nfa=?, nfa_form_type=?, nfa_item_category=?, atf_form_status=?, atf_control_number=?,
     date_filed=?, date_approved=?, tax_paid_amount=?, trust_type=?, trust_name=?,
     responsible_persons=?, trust_id=?, ownership_type=?
     WHERE id=?`,
    [data.make, data.model, data.caliber ?? null, data.serial_number ?? null, data.type ?? null,
     data.purchase_date ?? null, data.purchase_price ?? null, data.current_value ?? null,
     data.condition_rating ?? null, data.notes ?? null, data.image_uri ?? null,
     data.nickname ?? null, data.action_type ?? null, data.trigger_type ?? null,
     data.acquisition_method ?? null,
     data.purchased_from ?? null, data.dealer_city_state ?? null, data.storage_location ?? null,
     data.round_count ?? 0, data.value_last_updated ?? null,
     data.is_nfa ?? 0, data.nfa_form_type ?? null, data.nfa_item_category ?? null,
     data.atf_form_status ?? null, data.atf_control_number ?? null, data.date_filed ?? null,
     data.date_approved ?? null, data.tax_paid_amount ?? null, data.trust_type ?? null,
     data.trust_name ?? null, data.responsible_persons ?? null, data.trust_id ?? null,
     data.ownership_type ?? 'personal', id]
  );
}

export function deleteFirearm(id: number) {
  db.runSync('DELETE FROM firearms WHERE id = ?', [id]);
  db.runSync('DELETE FROM maintenance_logs WHERE firearm_id = ?', [id]);
  db.runSync('DELETE FROM accessories WHERE firearm_id = ?', [id]);
  db.runSync('DELETE FROM firearm_photos WHERE firearm_id = ?', [id]);
}

export function addMaintenanceLog(data: {
  firearm_id: number; date: string; type: string; rounds_fired?: number | null; notes?: string | null; details?: object | null;
}): number {
  const res = db.runSync(
    `INSERT INTO maintenance_logs (firearm_id, date, type, rounds_fired, notes, details) VALUES (?, ?, ?, ?, ?, ?)`,
    [data.firearm_id, data.date, data.type, data.rounds_fired ?? null, data.notes ?? null,
     data.details ? JSON.stringify(data.details) : null]
  );
  return res.lastInsertRowId as number;
}

/** Sum of rounds_fired across maintenance_logs for this firearm that were
 *  logged AFTER the most recent "Cleaning" entry. If the firearm has no
 *  cleaning logs at all, returns the firearm's total round_count (since
 *  every round fired is still "since last cleaning"). Used by the
 *  round-count maintenance-threshold check — we treat Cleaning as the
 *  reset event, Repair/Upgrade/Inspection don't zero the counter. */
export function getRoundsSinceLastCleaning(firearm_id: number): number {
  const lastClean = db.getFirstSync(
    `SELECT created_at FROM maintenance_logs
     WHERE firearm_id = ? AND type = 'Cleaning'
     ORDER BY created_at DESC LIMIT 1`,
    [firearm_id],
  ) as { created_at: string } | null;

  if (!lastClean) {
    // No cleaning ever logged — the firearm's full round count is since
    // "birth" which effectively equals "since last cleaning" (there wasn't
    // one). Fall back to the top-level round_count.
    const f = db.getFirstSync(
      'SELECT round_count FROM firearms WHERE id = ?',
      [firearm_id],
    ) as { round_count: number } | null;
    return f?.round_count ?? 0;
  }

  const row = db.getFirstSync(
    `SELECT COALESCE(SUM(rounds_fired), 0) AS total
     FROM maintenance_logs
     WHERE firearm_id = ? AND created_at > ?
       AND rounds_fired IS NOT NULL`,
    [firearm_id, lastClean.created_at],
  ) as { total: number } | null;
  return row?.total ?? 0;
}

/** Most recent maintenance log date for a firearm (raw MM/DD/YYYY string
 *  exactly as the user entered it), or null if no logs exist. Used by the
 *  maintenance reminder scheduler to anchor the next-due calculation. */
export function getLatestMaintenanceDate(firearm_id: number): string | null {
  const row = db.getFirstSync(
    `SELECT date FROM maintenance_logs
     WHERE firearm_id = ? AND date IS NOT NULL AND date != ''
     ORDER BY date DESC, created_at DESC
     LIMIT 1`,
    [firearm_id],
  ) as { date: string } | null;
  return row?.date ?? null;
}

export function getMaintenanceLogs(firearm_id: number): MaintenanceLog[] {
  return db.getAllSync(
    'SELECT * FROM maintenance_logs WHERE firearm_id = ? ORDER BY date DESC, created_at DESC', [firearm_id]
  ) as MaintenanceLog[];
}

export function getMaintenanceLogById(id: number): MaintenanceLog | null {
  return db.getFirstSync('SELECT * FROM maintenance_logs WHERE id = ?', [id]) as MaintenanceLog | null;
}

export function updateMaintenanceLog(id: number, data: {
  date: string; type: string; rounds_fired?: number | null; notes?: string | null; details?: object | null;
}) {
  db.runSync(
    'UPDATE maintenance_logs SET date=?, type=?, rounds_fired=?, notes=?, details=? WHERE id=?',
    [data.date, data.type, data.rounds_fired ?? null, data.notes ?? null,
     data.details ? JSON.stringify(data.details) : null, id]
  );
}

export function deleteMaintenanceLog(id: number) {
  db.runSync('DELETE FROM maintenance_logs WHERE id = ?', [id]);
}/** Optional inclusive date range for rounds-fired aggregations. Both bounds
 *  are YYYY-MM-DD ISO strings. Omit either bound for an open-ended range. */
export interface RoundsDateRange {
  startIso?: string | null;
  endIso?: string | null;
}

/**
 * Build the date-bounds SQL fragment used by both rounds helpers. Two storage
 * formats coexist: maintenance_logs.date is MM/DD/YYYY (legacy user string),
 * range_sessions.session_date is YYYY-MM-DD (native ISO). We normalize the
 * maintenance side with substr() so the comparison is apples-to-apples.
 */
function roundsRangeClause(
  range: RoundsDateRange | undefined,
  dateExpr: { maintenance: string; range: string },
): { maintenance: string; range: string; params: (string | number)[] } {
  if (!range || (!range.startIso && !range.endIso)) {
    return { maintenance: '', range: '', params: [] };
  }
  const parts = (expr: string) => {
    const conds: string[] = [];
    if (range.startIso) conds.push(`${expr} >= ?`);
    if (range.endIso) conds.push(`${expr} <= ?`);
    return conds.length ? ' AND ' + conds.join(' AND ') : '';
  };
  const params: (string | number)[] = [];
  if (range.startIso) params.push(range.startIso);
  if (range.endIso) params.push(range.endIso);
  return {
    maintenance: parts(dateExpr.maintenance),
    range: parts(dateExpr.range),
    params,
  };
}

/** Aggregate rounds from BOTH sources the user can log into:
 *   - legacy rounds_fired typed on maintenance logs (pre-range-log history)
 *   - rounds_fired on range session lines (new range-log path)
 *  Accepts an optional inclusive date range so the dashboard can scope to a
 *  user-chosen window. */
export function getTotalRoundsFired(range?: RoundsDateRange): number {
  const maintenanceDate = `substr(date, 7, 4) || '-' || substr(date, 1, 2) || '-' || substr(date, 4, 2)`;
  const clauses = roundsRangeClause(range, {
    maintenance: maintenanceDate,
    range: 'session_date',
  });
  const sql = `
    SELECT
      (SELECT COALESCE(SUM(rounds_fired), 0) FROM maintenance_logs
        WHERE 1=1${clauses.maintenance}) +
      (SELECT COALESCE(SUM(rsf.rounds_fired), 0)
        FROM range_session_firearms rsf
        JOIN range_sessions rs ON rs.id = rsf.session_id
        WHERE 1=1${clauses.range.replace(/session_date/g, 'rs.session_date')})
      AS total
  `;
  // SQLite binds params left-to-right, and we appended start then end once per
  // clause — so for each subquery we need its own pair. Duplicate the params
  // array to match the two positional slots in the composed SQL.
  const params = [...clauses.params, ...clauses.params];
  const r = db.getFirstSync(sql, params) as { total: number | null };
  return r?.total || 0;
}

/** Per-firearm roll-up combining maintenance + range rounds for each firearm,
 *  optionally bounded by a date range. Firearms with zero rounds in the
 *  window still appear so the dashboard can render a comprehensive breakdown
 *  (the UI filters zero-total rows itself if desired). */
export function getRoundsPerFirearm(
  range?: RoundsDateRange,
): { firearm_id: number; make: string; model: string; total: number }[] {
  const maintenanceDate = `substr(date, 7, 4) || '-' || substr(date, 1, 2) || '-' || substr(date, 4, 2)`;
  const clauses = roundsRangeClause(range, {
    maintenance: maintenanceDate,
    range: 'rs.session_date',
  });
  const sql = `
    SELECT
      f.id AS firearm_id,
      f.make, f.model,
      (
        (SELECT COALESCE(SUM(rounds_fired), 0) FROM maintenance_logs
          WHERE firearm_id = f.id${clauses.maintenance}) +
        (SELECT COALESCE(SUM(rsf.rounds_fired), 0)
          FROM range_session_firearms rsf
          JOIN range_sessions rs ON rs.id = rsf.session_id
          WHERE rsf.firearm_id = f.id${clauses.range})
      ) AS total
    FROM firearms f
    ORDER BY total DESC
  `;
  const params = [...clauses.params, ...clauses.params];
  return db.getAllSync(sql, params) as { firearm_id: number; make: string; model: string; total: number }[];
}

// ─── AMMO ────────────────────────────────────────────────

export interface Ammo {
  id: number; caliber: string; brand: string | null; grain: number | null;
  type: string | null; quantity: number; cost_per_box: number | null;
  rounds_per_box: number | null; low_stock_threshold: number | null;
  paired_firearm_ids: string | null;
  notes: string | null; created_at: string;
  // Reloading / handload fields
  is_handload: number;
  powder_brand: string | null; powder_type: string | null; charge_weight: number | null;
  bullet_brand: string | null; bullet_weight: number | null; bullet_type: string | null;
  brass_brand: string | null; brass_times_fired: number | null;
  primer_brand: string | null; primer_type: string | null;
  coal: number | null; cbto: number | null;
  velocity_fps: number | null; velocity_sd: number | null; velocity_es: number | null;
  group_size: string | null; load_notes: string | null;
}

/** Parse the JSON-encoded paired_firearm_ids column into a number[]. Returns
 *  [] for null, empty string, or invalid JSON so callers never have to
 *  defensively guard. */
export function parsePairedFirearmIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => typeof n === 'number');
  } catch { return []; }
}

/** Serialize a number[] for storage. Stores null when the array is empty so
 *  the column stays cleanly sparse. */
export function serializePairedFirearmIds(ids: number[] | null | undefined): string | null {
  if (!ids || ids.length === 0) return null;
  return JSON.stringify(ids);
}

export interface AmmoInput {
  caliber: string; brand?: string | null; grain?: number | null; type?: string | null;
  quantity: number; cost_per_box?: number | null; rounds_per_box?: number | null;
  low_stock_threshold?: number | null; paired_firearm_ids?: number[] | null;
  notes?: string | null;
  // Reloading fields
  is_handload?: number;
  powder_brand?: string | null; powder_type?: string | null; charge_weight?: number | null;
  bullet_brand?: string | null; bullet_weight?: number | null; bullet_type?: string | null;
  brass_brand?: string | null; brass_times_fired?: number | null;
  primer_brand?: string | null; primer_type?: string | null;
  coal?: number | null; cbto?: number | null;
  velocity_fps?: number | null; velocity_sd?: number | null; velocity_es?: number | null;
  group_size?: string | null; load_notes?: string | null;
}

export function addAmmo(data: AmmoInput) {
  db.runSync(
    `INSERT INTO ammo (caliber, brand, grain, type, quantity, cost_per_box, rounds_per_box,
     low_stock_threshold, paired_firearm_ids, notes, is_handload, powder_brand, powder_type,
     charge_weight, bullet_brand, bullet_weight, bullet_type, brass_brand, brass_times_fired,
     primer_brand, primer_type, coal, cbto, velocity_fps, velocity_sd, velocity_es,
     group_size, load_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.caliber, data.brand ?? null, data.grain ?? null, data.type ?? null,
     data.quantity, data.cost_per_box ?? null, data.rounds_per_box ?? null,
     data.low_stock_threshold ?? 100,
     serializePairedFirearmIds(data.paired_firearm_ids),
     data.notes ?? null, data.is_handload ?? 0,
     data.powder_brand ?? null, data.powder_type ?? null, data.charge_weight ?? null,
     data.bullet_brand ?? null, data.bullet_weight ?? null, data.bullet_type ?? null,
     data.brass_brand ?? null, data.brass_times_fired ?? null,
     data.primer_brand ?? null, data.primer_type ?? null,
     data.coal ?? null, data.cbto ?? null,
     data.velocity_fps ?? null, data.velocity_sd ?? null, data.velocity_es ?? null,
     data.group_size ?? null, data.load_notes ?? null]
  );
}

export function getAllAmmo(): Ammo[] {
  return db.getAllSync('SELECT * FROM ammo ORDER BY caliber, brand') as Ammo[];
}

export function getAmmoById(id: number): Ammo | null {
  return db.getFirstSync('SELECT * FROM ammo WHERE id = ?', [id]) as Ammo | null;
}

export function updateAmmo(id: number, data: AmmoInput) {
  db.runSync(
    `UPDATE ammo SET caliber=?, brand=?, grain=?, type=?, quantity=?, cost_per_box=?,
     rounds_per_box=?, low_stock_threshold=?, paired_firearm_ids=?, notes=?,
     is_handload=?, powder_brand=?, powder_type=?, charge_weight=?,
     bullet_brand=?, bullet_weight=?, bullet_type=?,
     brass_brand=?, brass_times_fired=?, primer_brand=?, primer_type=?,
     coal=?, cbto=?, velocity_fps=?, velocity_sd=?, velocity_es=?,
     group_size=?, load_notes=? WHERE id=?`,
    [data.caliber, data.brand ?? null, data.grain ?? null, data.type ?? null,
     data.quantity, data.cost_per_box ?? null, data.rounds_per_box ?? null,
     data.low_stock_threshold ?? 100,
     serializePairedFirearmIds(data.paired_firearm_ids),
     data.notes ?? null, data.is_handload ?? 0,
     data.powder_brand ?? null, data.powder_type ?? null, data.charge_weight ?? null,
     data.bullet_brand ?? null, data.bullet_weight ?? null, data.bullet_type ?? null,
     data.brass_brand ?? null, data.brass_times_fired ?? null,
     data.primer_brand ?? null, data.primer_type ?? null,
     data.coal ?? null, data.cbto ?? null,
     data.velocity_fps ?? null, data.velocity_sd ?? null, data.velocity_es ?? null,
     data.group_size ?? null, data.load_notes ?? null, id]
  );
}

export function deleteAmmo(id: number) {
  db.runSync('DELETE FROM ammo WHERE id = ?', [id]);
}

export function getAmmoByCaliber(caliber: string): Ammo[] {
  return db.getAllSync('SELECT * FROM ammo WHERE caliber = ? ORDER BY brand', [caliber]) as Ammo[];
}

export function deductAmmo(id: number, rounds: number): { newQty: number; isLow: boolean; threshold: number } {
  const ammo = getAmmoById(id);
  if (!ammo) return { newQty: 0, isLow: false, threshold: 100 };
  const newQty = Math.max(0, ammo.quantity - rounds);
  db.runSync('UPDATE ammo SET quantity = ? WHERE id = ?', [newQty, id]);
  const threshold = ammo.low_stock_threshold ?? 100;
  return { newQty, isLow: newQty <= threshold, threshold };
}

export function getLowStockAmmo(): Ammo[] {
  return db.getAllSync(
    'SELECT * FROM ammo WHERE quantity <= COALESCE(low_stock_threshold, 100) AND quantity > 0 ORDER BY quantity ASC'
  ) as Ammo[];
}

export function getDistinctCalibers(): string[] {
  const rows = db.getAllSync('SELECT DISTINCT caliber FROM ammo ORDER BY caliber') as { caliber: string }[];
  return rows.map(r => r.caliber);
}

/**
 * Return every ammo row available to a specific firearm. An ammo row is
 * available if either (a) it's explicitly paired with the firearm's id, or
 * (b) its paired list is empty AND its caliber matches the firearm's caliber
 * (case-insensitive, trimmed). Returns rows sorted by quantity descending so
 * the highest-stocked lot shows first.
 */
export function getAmmoForFirearm(firearmId: number): Ammo[] {
  const firearm = getFirearmById(firearmId);
  if (!firearm) return [];
  const caliber = (firearm.caliber || '').trim().toLowerCase();
  const all = db.getAllSync('SELECT * FROM ammo ORDER BY quantity DESC') as Ammo[];
  return all.filter((a) => {
    const paired = parsePairedFirearmIds(a.paired_firearm_ids);
    if (paired.length > 0) return paired.includes(firearmId);
    // No explicit pairing — fall back to caliber match.
    if (!caliber) return false;
    return (a.caliber || '').trim().toLowerCase() === caliber;
  });
}

/** Sum of quantity across every ammo row available to a firearm. */
export function getRoundsAvailableForFirearm(firearmId: number): number {
  return getAmmoForFirearm(firearmId).reduce((sum, a) => sum + (a.quantity || 0), 0);
}

/** Roll up ammo totals by caliber — used for caliber-level summaries on the
 *  supply screen and the dashboard low-stock widget. `lots` is the number of
 *  distinct ammo rows for that caliber. */
export interface CaliberRollup {
  caliber: string;
  rounds: number;
  lots: number;
  value: number;
  anyLow: boolean;
  anyEmpty: boolean;
}

export function getAmmoRollupsByCaliber(): CaliberRollup[] {
  const all = getAllAmmo();
  const map: Record<string, CaliberRollup> = {};
  for (const a of all) {
    const key = a.caliber;
    if (!map[key]) {
      map[key] = { caliber: key, rounds: 0, lots: 0, value: 0, anyLow: false, anyEmpty: false };
    }
    const threshold = a.low_stock_threshold ?? 100;
    map[key].rounds += a.quantity || 0;
    map[key].lots += 1;
    if (a.cost_per_box && a.rounds_per_box) {
      map[key].value += (a.quantity / a.rounds_per_box) * a.cost_per_box;
    }
    if (a.quantity === 0) map[key].anyEmpty = true;
    else if (a.quantity <= threshold) map[key].anyLow = true;
  }
  return Object.values(map).sort((a, b) => b.rounds - a.rounds);
}

/**
 * Returns a caliber rollup that includes EVERY caliber you own a firearm for,
 * even if no ammo has been recorded for it. Calibers with no ammo appear with
 * rounds=0 and anyEmpty=true so the Supply screen can flag them as "need to buy."
 * Ammo lots for calibers you don't own a firearm for are still included.
 */
export function getAmmoRollupsWithFirearmCalibers(): CaliberRollup[] {
  const rollups = getAmmoRollupsByCaliber();
  const byKey: Record<string, CaliberRollup> = {};
  for (const r of rollups) {
    byKey[(r.caliber || '').trim().toLowerCase()] = r;
  }

  // Collect unique firearm calibers (preserving original casing for display).
  const firearms = getAllFirearms();
  const firearmCalibers: Record<string, string> = {};
  for (const f of firearms) {
    const raw = (f.caliber || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!firearmCalibers[key]) firearmCalibers[key] = raw;
  }

  // Add zero-entries for firearm calibers without ammo.
  for (const key of Object.keys(firearmCalibers)) {
    if (!byKey[key]) {
      byKey[key] = {
        caliber: firearmCalibers[key],
        rounds: 0,
        lots: 0,
        value: 0,
        anyLow: false,
        anyEmpty: true,
      };
    }
  }

  // Sort: empty calibers first (need to buy), then low-stock, then by rounds desc.
  return Object.values(byKey).sort((a, b) => {
    const aEmpty = a.rounds === 0 ? 0 : 1;
    const bEmpty = b.rounds === 0 ? 0 : 1;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    const aLow = a.anyLow ? 0 : 1;
    const bLow = b.anyLow ? 0 : 1;
    if (aLow !== bLow) return aLow - bLow;
    return b.rounds - a.rounds;
  });
}

export function getTotalAmmoRounds(): number {
  const r = db.getFirstSync('SELECT SUM(quantity) as total FROM ammo') as { total: number | null };
  return r?.total || 0;
}

export function getTotalAmmoValue(): number {
  const r = db.getFirstSync(
    'SELECT SUM(CAST(quantity AS REAL) / COALESCE(rounds_per_box, 50) * COALESCE(cost_per_box, 0)) as total FROM ammo'
  ) as { total: number | null };
  return r?.total || 0;
}

// ─── EXPENSES ────────────────────────────────────────────

export interface Expense {
  id: number; date: string; category: string; amount: number;
  description: string | null; firearm_id: number | null;
  notes: string | null; created_at: string;
}

export const EXPENSE_CATEGORIES = [
  'Ammunition', 'Accessories', 'Range Fees', 'Gunsmithing',
  'Cleaning Supplies', 'Training', 'Storage', 'Insurance', 'Other',
];

export function addExpense(data: {
  date: string; category: string; amount: number; description?: string | null;
  firearm_id?: number | null; notes?: string | null;
}) {
  db.runSync(
    `INSERT INTO expenses (date, category, amount, description, firearm_id, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [data.date, data.category, data.amount, data.description ?? null,
     data.firearm_id ?? null, data.notes ?? null]
  );
}

export function getAllExpenses(): Expense[] {
  return db.getAllSync('SELECT * FROM expenses ORDER BY date DESC, created_at DESC') as Expense[];
}

export function getExpenseById(id: number): Expense | null {
  return db.getFirstSync('SELECT * FROM expenses WHERE id = ?', [id]) as Expense | null;
}

export function updateExpense(id: number, data: {
  date: string; category: string; amount: number; description?: string | null;
  firearm_id?: number | null; notes?: string | null;
}) {
  db.runSync(
    'UPDATE expenses SET date=?, category=?, amount=?, description=?, firearm_id=?, notes=? WHERE id=?',
    [data.date, data.category, data.amount, data.description ?? null,
     data.firearm_id ?? null, data.notes ?? null, id]
  );
}

export function deleteExpense(id: number) {
  db.runSync('DELETE FROM expenses WHERE id = ?', [id]);
}

export function getTotalExpenses(): number {
  const r = db.getFirstSync('SELECT SUM(amount) as total FROM expenses') as { total: number | null };
  return r?.total || 0;
}

export function getExpensesByCategory(): { category: string; total: number }[] {
  return db.getAllSync(
    'SELECT category, SUM(amount) as total FROM expenses GROUP BY category ORDER BY total DESC'
  ) as { category: string; total: number }[];
}

// ─── Accessories ───────────────────────────────────────────

// Note: 'Suppressor' used to live here. Suppressors are now a top-level
// entity with their own table (see addSuppressor et al). Any legacy
// Suppressor-typed accessory rows are migrated on initDB.
export const ACCESSORY_TYPES = [
  'Red Dot / Optic', 'Weapon Light', 'Laser Sight', 'IR Device',
  'Stock / Brace', 'Grip / Grip Module', 'Trigger',
  'Magazine', 'Sling', 'Other',
] as const;

export type AccessoryType = typeof ACCESSORY_TYPES[number];

export interface Accessory {
  id: number;
  firearm_id: number;
  accessory_type: string;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  notes: string | null;
  image_uri: string | null;
  details: string | null;
  created_at: string;
}

// Type-specific detail shapes stored as JSON in `details`
export interface OpticDetails {
  mount?: string;
  brightness_settings?: string;
  zero_distance?: string;
  battery_type?: string;
  battery_qty?: number;
  date_battery_replaced?: string;
  replacement_interval_days?: number;
  power_type?: 'disposable' | 'rechargeable_internal' | 'rechargeable_swappable' | 'dual_solar';
  charge_connector?: string;
  date_last_charged?: string;
  cell_type?: string;
}

export interface WeaponLightDetails {
  lumens?: string;
  mount_position?: string;
  battery_type?: string;
  battery_qty?: number;
  date_battery_replaced?: string;
  replacement_interval_days?: number;
  power_type?: 'disposable' | 'rechargeable_internal' | 'rechargeable_swappable' | 'dual_solar';
  charge_connector?: string;
  date_last_charged?: string;
  cell_type?: string;
}

export interface LaserDetails {
  color?: string;
  mount?: string;
  battery_type?: string;
  battery_qty?: number;
  date_battery_replaced?: string;
  replacement_interval_days?: number;
  power_type?: 'disposable' | 'rechargeable_internal' | 'rechargeable_swappable' | 'dual_solar';
  charge_connector?: string;
  date_last_charged?: string;
  cell_type?: string;
}

export interface IRDeviceDetails {
  ir_type?: string;
  battery_type?: string;
  battery_qty?: number;
  date_battery_replaced?: string;
  replacement_interval_days?: number;
  power_type?: 'disposable' | 'rechargeable_internal' | 'rechargeable_swappable' | 'dual_solar';
  charge_connector?: string;
  date_last_charged?: string;
  cell_type?: string;
}

export interface SuppressorDetails {
  caliber?: string;
  nfa_form_type?: string;
  atf_status?: string;
  atf_control_number?: string;
  date_filed?: string;
  date_approved?: string;
  tax_paid?: number;
  // Physical specs
  length_inches?: string;
  weight_oz?: string;
  thread_pitch?: string;
  mount_type?: 'direct_thread' | 'qd' | 'hybrid';
  full_auto_rated?: boolean;
}

export interface StockBraceDetails {
  adjustable?: boolean;
  length_of_pull?: string;
  // Expanded
  subtype?: 'fixed' | 'folding' | 'collapsible' | 'adjustable';
  buffer_tube_type?: string;
  material?: string;
}

export interface GripDetails {
  texture?: string;
  color?: string;
  // Expanded
  angle_deg?: string;
  has_beavertail?: boolean;
  finger_grooves?: boolean;
}

export interface TriggerDetails {
  pull_weight?: string;
  shoe_material?: string;
  trigger_type?: string;
  // Expanded
  shape?: 'flat' | 'curved';
  stages?: 'single' | 'two_stage';
  reset_length?: string;
}

export interface MagazineDetails {
  capacity?: number;
  material?: string;
  count_owned?: number;
  // Expanded
  manufacturer_variant?: string;
  anti_tilt_follower?: boolean;
  fits_models?: string;
}

export interface SlingDetails {
  attachment_type?: string;
  // Expanded
  points?: '1_point' | '2_point' | '3_point' | 'convertible';
  material?: string;
  qd_hardware?: boolean;
}

export function addAccessory(data: {
  firearm_id: number;
  accessory_type: string;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  notes?: string | null;
  image_uri?: string | null;
  details?: string | null;
}): number {
  const r = db.runSync(
    `INSERT INTO accessories (firearm_id, accessory_type, make, model, serial_number, notes, image_uri, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.firearm_id, data.accessory_type, data.make ?? null, data.model ?? null,
     data.serial_number ?? null, data.notes ?? null, data.image_uri ?? null, data.details ?? null]
  );
  return r.lastInsertRowId as number;
}

export function getAccessoriesByFirearm(firearm_id: number): Accessory[] {
  return db.getAllSync(
    'SELECT * FROM accessories WHERE firearm_id = ? ORDER BY created_at DESC', [firearm_id]
  ) as Accessory[];
}

export function getAccessoryById(id: number): Accessory | null {
  return db.getFirstSync('SELECT * FROM accessories WHERE id = ?', [id]) as Accessory | null;
}

export function updateAccessory(id: number, data: {
  accessory_type: string;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  notes?: string | null;
  image_uri?: string | null;
  details?: string | null;
}) {
  db.runSync(
    `UPDATE accessories SET accessory_type=?, make=?, model=?, serial_number=?, notes=?, image_uri=?, details=?
     WHERE id=?`,
    [data.accessory_type, data.make ?? null, data.model ?? null, data.serial_number ?? null,
     data.notes ?? null, data.image_uri ?? null, data.details ?? null, id]
  );
}

export function deleteAccessory(id: number) {
  db.runSync('DELETE FROM accessories WHERE id = ?', [id]);
}

export function getAccessoryCount(firearm_id: number): number {
  const r = db.getFirstSync(
    'SELECT COUNT(*) as count FROM accessories WHERE firearm_id = ?', [firearm_id]
  ) as { count: number };
  return r?.count || 0;
}

export function parseAccessoryDetails<T>(accessory: Accessory): T | null {
  if (!accessory.details) return null;
  try { return JSON.parse(accessory.details) as T; } catch { return null; }
}

/**
 * Accessory joined with host-firearm summary fields. Used to surface "Mounted
 * on: {firearm}" rows on the NFA entry screen without firing a per-row query.
 * host_firearm_id can be null if the accessory is orphaned for some reason.
 */
export interface AccessoryWithHost extends Accessory {
  host_firearm_id: number | null;
  host_make: string | null;
  host_model: string | null;
  host_nickname: string | null;
}

// ─── Suppressors (top-level NFA items, separate from firearms) ──────────
//
// Suppressors used to be stored as accessories tied to a single firearm, but
// they move between hosts so they get their own table with a free-text
// `host_notes` field. Columns mirror the NFA-related firearm columns where
// possible so any code that works against a Firearm can also work against a
// Suppressor with minimal branching (esp. the NFA + Form 4 tracker screens).

export interface Suppressor {
  id: number;
  make: string;
  model: string;
  serial_number: string | null;
  caliber: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  current_value: number | null;
  condition_rating: string | null;
  notes: string | null;
  image_uri: string | null;
  purchased_from: string | null;
  dealer_city_state: string | null;
  storage_location: string | null;
  round_count: number;
  value_last_updated: string | null;
  // NFA fields
  nfa_form_type: string | null;
  atf_form_status: string | null;
  atf_control_number: string | null;
  date_filed: string | null;
  date_approved: string | null;
  tax_paid_amount: number | null;
  tax_stamp_image: string | null;
  trust_type: string | null;
  trust_name: string | null;
  responsible_persons: string | null;
  trust_id: number | null;
  // Physical / usage
  length_inches: string | null;
  weight_oz: string | null;
  thread_pitch: string | null;
  mount_type: string | null;
  full_auto_rated: number;
  host_notes: string | null;
  // Scanned copies of the filed ATF form. Pro (document_storage).
  atf_form_front_uri: string | null;
  atf_form_back_uri: string | null;
  atf_form_scanned_at: string | null;
  // End cap configuration
  end_cap_type: string | null;
  end_cap_notes: string | null;
  created_at: string;
}

// Columns that `addSuppressor` / `updateSuppressor` accept. Kept as a named
// type so the screens can build a typed data object without repeating the
// ~35-column shape at every call site.
export interface SuppressorInput {
  make: string;
  model: string;
  serial_number?: string | null;
  caliber?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  current_value?: number | null;
  condition_rating?: string | null;
  notes?: string | null;
  image_uri?: string | null;
  purchased_from?: string | null;
  dealer_city_state?: string | null;
  storage_location?: string | null;
  round_count?: number;
  value_last_updated?: string | null;
  nfa_form_type?: string | null;
  atf_form_status?: string | null;
  atf_control_number?: string | null;
  date_filed?: string | null;
  date_approved?: string | null;
  tax_paid_amount?: number | null;
  tax_stamp_image?: string | null;
  trust_type?: string | null;
  trust_name?: string | null;
  responsible_persons?: string | null;
  trust_id?: number | null;
  length_inches?: string | null;
  weight_oz?: string | null;
  thread_pitch?: string | null;
  mount_type?: string | null;
  full_auto_rated?: number;
  host_notes?: string | null;
  end_cap_type?: string | null;
  end_cap_notes?: string | null;
}

const SUPPRESSOR_COLUMNS = [
  'make', 'model', 'serial_number', 'caliber', 'purchase_date', 'purchase_price',
  'current_value', 'condition_rating', 'notes', 'image_uri', 'purchased_from',
  'dealer_city_state', 'storage_location', 'round_count', 'value_last_updated',
  'nfa_form_type', 'atf_form_status', 'atf_control_number', 'date_filed',
  'date_approved', 'tax_paid_amount', 'tax_stamp_image', 'trust_type',
  'trust_name', 'responsible_persons', 'trust_id', 'length_inches', 'weight_oz',
  'thread_pitch', 'mount_type', 'full_auto_rated', 'host_notes',
  'end_cap_type', 'end_cap_notes',
] as const;

function suppressorInputToValues(data: SuppressorInput): unknown[] {
  return [
    data.make, data.model, data.serial_number ?? null, data.caliber ?? null,
    data.purchase_date ?? null, data.purchase_price ?? null, data.current_value ?? null,
    data.condition_rating ?? null, data.notes ?? null, data.image_uri ?? null,
    data.purchased_from ?? null, data.dealer_city_state ?? null, data.storage_location ?? null,
    data.round_count ?? 0, data.value_last_updated ?? null,
    data.nfa_form_type ?? null, data.atf_form_status ?? null, data.atf_control_number ?? null,
    data.date_filed ?? null, data.date_approved ?? null, data.tax_paid_amount ?? null,
    data.tax_stamp_image ?? null, data.trust_type ?? null, data.trust_name ?? null,
    data.responsible_persons ?? null, data.trust_id ?? null, data.length_inches ?? null,
    data.weight_oz ?? null, data.thread_pitch ?? null, data.mount_type ?? null,
    data.full_auto_rated ?? 0, data.host_notes ?? null,
    data.end_cap_type ?? null, data.end_cap_notes ?? null,
  ];
}

export function addSuppressor(data: SuppressorInput): number {
  const placeholders = SUPPRESSOR_COLUMNS.map(() => '?').join(', ');
  const result = db.runSync(
    `INSERT INTO suppressors (${SUPPRESSOR_COLUMNS.join(', ')}) VALUES (${placeholders})`,
    suppressorInputToValues(data) as any
  );
  return result.lastInsertRowId as number;
}

export function getAllSuppressors(): Suppressor[] {
  return db.getAllSync('SELECT * FROM suppressors ORDER BY created_at DESC') as Suppressor[];
}

export function getSuppressorById(id: number): Suppressor | null {
  return db.getFirstSync('SELECT * FROM suppressors WHERE id = ?', [id]) as Suppressor | null;
}

export function updateSuppressor(id: number, data: SuppressorInput) {
  const setClause = SUPPRESSOR_COLUMNS.map(c => `${c}=?`).join(', ');
  db.runSync(
    `UPDATE suppressors SET ${setClause} WHERE id = ?`,
    [...suppressorInputToValues(data), id] as any
  );
}

export function deleteSuppressor(id: number) {
  db.runSync('DELETE FROM suppressors WHERE id = ?', [id]);
}

/**
 * Fuzzy reverse-lookup: find suppressors whose free-text `host_notes` appears
 * to mention this firearm (by serial #, nickname, or make+model). Used by
 * the firearm detail screen to surface "Suppressors used with this firearm"
 * without a structured FK relationship. Matches are case-insensitive and
 * require the host_notes text to contain the matching token as a substring.
 * Returns an empty array if none of the firearm's identifiers are set.
 */
export function findSuppressorsLinkedToFirearm(f: {
  serial_number: string | null;
  nickname?: string | null;
  make?: string | null;
  model?: string | null;
}): Suppressor[] {
  const needles: string[] = [];
  if (f.serial_number) needles.push(f.serial_number.trim().toLowerCase());
  if (f.nickname) needles.push(f.nickname.trim().toLowerCase());
  if (f.make && f.model) needles.push(`${f.make} ${f.model}`.trim().toLowerCase());
  const filtered = needles.filter(n => n.length >= 3);
  if (filtered.length === 0) return [];
  const rows = db.getAllSync('SELECT * FROM suppressors') as Suppressor[];
  return rows.filter((row) => {
    const hay = (row.host_notes ?? '').toLowerCase();
    if (!hay) return false;
    return filtered.some(n => hay.includes(n));
  });
}

// ─── Firearm Photo Gallery ───────────────────────────────
//
// Each firearm has one "primary" image on the firearms.image_uri column
// (shown as the hero) plus zero or more gallery photos in firearm_photos.
// The total count for paywall purposes is (primary ? 1 : 0) + gallery.length.
// Lite caps the total at 1 (i.e. gallery must be empty); Pro caps at 20.

export interface FirearmPhoto {
  id: number;
  firearm_id: number;
  image_uri: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export function addFirearmPhoto(data: {
  firearm_id: number;
  image_uri: string;
  caption?: string | null;
  sort_order?: number | null;
}): number {
  const result = db.runSync(
    `INSERT INTO firearm_photos (firearm_id, image_uri, caption, sort_order)
     VALUES (?, ?, ?, ?)`,
    [data.firearm_id, data.image_uri, data.caption ?? null, data.sort_order ?? 0]
  );
  return result.lastInsertRowId as number;
}

export function getFirearmPhotos(firearm_id: number): FirearmPhoto[] {
  return db.getAllSync(
    'SELECT * FROM firearm_photos WHERE firearm_id = ? ORDER BY sort_order ASC, created_at ASC',
    [firearm_id]
  ) as FirearmPhoto[];
}

export function countFirearmPhotos(firearm_id: number): number {
  const r = db.getFirstSync(
    'SELECT COUNT(*) as count FROM firearm_photos WHERE firearm_id = ?', [firearm_id]
  ) as { count: number };
  return r?.count || 0;
}

export function deleteFirearmPhoto(id: number) {
  db.runSync('DELETE FROM firearm_photos WHERE id = ?', [id]);
}

export function updateFirearmPhotoCaption(id: number, caption: string | null) {
  db.runSync('UPDATE firearm_photos SET caption = ? WHERE id = ?', [caption, id]);
}

// ─── NFA / Tax Stamps ────────────────────────────────────

export interface NfaTrust {
  id: number;
  name: string;
  trust_type: string;
  responsible_persons: string | null;
  notes: string | null;
  created_at: string;
}

export function addNfaTrust(data: {
  name: string;
  trust_type: string;
  responsible_persons?: string | null;
  notes?: string | null;
}): number {
  const result = db.runSync(
    `INSERT INTO nfa_trusts (name, trust_type, responsible_persons, notes)
     VALUES (?, ?, ?, ?)`,
    [data.name, data.trust_type, data.responsible_persons ?? null, data.notes ?? null]
  );
  return result.lastInsertRowId as number;
}

export function getAllNfaTrusts(): NfaTrust[] {
  return db.getAllSync('SELECT * FROM nfa_trusts ORDER BY name ASC') as NfaTrust[];
}

export function getNfaTrustById(id: number): NfaTrust | null {
  return db.getFirstSync('SELECT * FROM nfa_trusts WHERE id = ?', [id]) as NfaTrust | null;
}

export function updateNfaTrust(id: number, data: {
  name: string;
  trust_type: string;
  responsible_persons?: string | null;
  notes?: string | null;
}) {
  db.runSync(
    `UPDATE nfa_trusts SET name=?, trust_type=?, responsible_persons=?, notes=?
     WHERE id=?`,
    [data.name, data.trust_type, data.responsible_persons ?? null, data.notes ?? null, id]
  );
}

export function deleteNfaTrust(id: number) {
  // Unlink firearms that reference this trust.
  db.runSync('UPDATE firearms SET trust_id = NULL WHERE trust_id = ?', [id]);
  db.runSync('DELETE FROM nfa_trusts WHERE id = ?', [id]);
}

export function countFirearmsForTrust(trust_id: number): number {
  const r = db.getFirstSync(
    'SELECT COUNT(*) as count FROM firearms WHERE trust_id = ?', [trust_id]
  ) as { count: number };
  return r?.count || 0;
}

export function getAllNfaItems(): Firearm[] {
  return db.getAllSync(
    'SELECT * FROM firearms WHERE is_nfa = 1 ORDER BY date_filed DESC, created_at DESC'
  ) as Firearm[];
}

/**
 * Pending Form 4 / NFA items — anything marked NFA whose ATF status is not
 * yet a terminal state (Approved / Denied). Not filed items bubble up too so
 * the user sees "still need to file this" alongside in-flight stamps.
 */
export function getPendingNfaItems(): Firearm[] {
  return db.getAllSync(
    `SELECT * FROM firearms WHERE is_nfa = 1
       AND (atf_form_status IS NULL
            OR atf_form_status IN ('Not Yet Filed','Pending (eFiled)','Pending (Paper)'))
     ORDER BY date_filed ASC, created_at ASC`
  ) as Firearm[];
}

/** Suppressors awaiting ATF approval (or with no status yet). Suppressors
 *  are always NFA items, so no is_nfa guard is needed. */
export function getPendingNfaSuppressors(): Suppressor[] {
  return db.getAllSync(
    `SELECT * FROM suppressors
       WHERE atf_form_status IS NULL
          OR atf_form_status IN ('Not Yet Filed','Pending (eFiled)','Pending (Paper)')
     ORDER BY date_filed ASC, created_at ASC`
  ) as Suppressor[];
}

/** Point update for the tax stamp image — avoids threading tax_stamp_image
 *  through every addFirearm/updateFirearm signature. */
export function setFirearmTaxStamp(id: number, imagePath: string | null) {
  db.runSync('UPDATE firearms SET tax_stamp_image = ? WHERE id = ?', [imagePath, id]);
}

// ────────────────────────────────────────────────────────────────────────
// ATF form scans — the original filed paperwork kept on file with the item.
// Two slots per item: `front` (the filed form) and `back` (approved
// stamp/back page). Timestamp tracks when the most recent scan landed.
// ────────────────────────────────────────────────────────────────────────

export type AtfFormPage = 'front' | 'back';

function atfFormColumn(page: AtfFormPage): string {
  return page === 'front' ? 'atf_form_front_uri' : 'atf_form_back_uri';
}

export function setFirearmAtfForm(id: number, page: AtfFormPage, imagePath: string | null) {
  const col = atfFormColumn(page);
  db.runSync(
    `UPDATE firearms SET ${col} = ?, atf_form_scanned_at = ? WHERE id = ?`,
    [imagePath, imagePath ? new Date().toISOString() : null, id],
  );
}

export function setSuppressorAtfForm(id: number, page: AtfFormPage, imagePath: string | null) {
  const col = atfFormColumn(page);
  db.runSync(
    `UPDATE suppressors SET ${col} = ?, atf_form_scanned_at = ? WHERE id = ?`,
    [imagePath, imagePath ? new Date().toISOString() : null, id],
  );
}

// ────────────────────────────────────────────────────────────────────────
// Maintenance reminder config (Pro: maintenance_reminders).
// Kept as narrow setters so they don't need to thread through the giant
// updateFirearm signature — same approach used for tax stamps and ATF forms.
// ────────────────────────────────────────────────────────────────────────

export function setFirearmMaintenanceInterval(
  id: number,
  months: number | null,
  rounds: number | null,
) {
  db.runSync(
    'UPDATE firearms SET maintenance_interval_months = ?, maintenance_interval_rounds = ? WHERE id = ?',
    [months, rounds, id],
  );
}

export function setFirearmMaintenanceNotificationId(
  id: number,
  notification_id: string | null,
) {
  db.runSync(
    'UPDATE firearms SET maintenance_notification_id = ? WHERE id = ?',
    [notification_id, id],
  );
}

// ────────────────────────────────────────────────────────────────────────
// Form 4 check-in log
// ────────────────────────────────────────────────────────────────────────

export interface Form4Checkin {
  id: number;
  firearm_id: number;
  checkin_date: string;
  method: string | null;
  note: string | null;
  created_at: string;
}

export function addForm4Checkin(data: {
  firearm_id: number;
  checkin_date: string;
  method?: string | null;
  note?: string | null;
}): number {
  const result = db.runSync(
    `INSERT INTO form4_checkins (firearm_id, checkin_date, method, note)
     VALUES (?, ?, ?, ?)`,
    [data.firearm_id, data.checkin_date, data.method ?? null, data.note ?? null]
  );
  return result.lastInsertRowId as number;
}

export function getForm4Checkins(firearm_id: number): Form4Checkin[] {
  return db.getAllSync(
    'SELECT * FROM form4_checkins WHERE firearm_id = ? ORDER BY checkin_date DESC, id DESC',
    [firearm_id]
  ) as Form4Checkin[];
}

export function deleteForm4Checkin(id: number) {
  db.runSync('DELETE FROM form4_checkins WHERE id = ?', [id]);
}

export function getFirearmsByTrust(trust_id: number): Firearm[] {
  return db.getAllSync(
    'SELECT * FROM firearms WHERE trust_id = ? ORDER BY created_at DESC', [trust_id]
  ) as Firearm[];
}

// ────────────────────────────────────────────────────────────────────────
// Battery logs
// ────────────────────────────────────────────────────────────────────────

export interface BatteryLog {
  id: number;
  firearm_id: number | null;
  accessory_id: number | null;
  device_label: string;
  battery_type: string;
  install_date: string;
  expected_life_months: number;
  replacement_date: string | null;
  notification_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Row type returned by getActiveBatteryLogs — includes the linked firearm's
 *  make/model/nickname and (when the log is tied to an accessory) the
 *  accessory's type/make/model so the hub list can show context without a
 *  second query per row. */
export interface BatteryLogWithFirearm extends BatteryLog {
  firearm_make: string | null;
  firearm_model: string | null;
  firearm_nickname: string | null;
  accessory_type: string | null;
  accessory_make: string | null;
  accessory_model: string | null;
}

export function addBatteryLog(data: {
  firearm_id?: number | null;
  accessory_id?: number | null;
  device_label: string;
  battery_type: string;
  install_date: string;
  expected_life_months: number;
  notification_id?: string | null;
  notes?: string | null;
}): number {
  const r = db.runSync(
    `INSERT INTO battery_logs
     (firearm_id, accessory_id, device_label, battery_type, install_date,
      expected_life_months, notification_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.firearm_id ?? null,
      data.accessory_id ?? null,
      data.device_label,
      data.battery_type,
      data.install_date,
      data.expected_life_months,
      data.notification_id ?? null,
      data.notes ?? null,
    ]
  );
  return r.lastInsertRowId as number;
}

export function updateBatteryLog(id: number, data: {
  firearm_id?: number | null;
  accessory_id?: number | null;
  device_label: string;
  battery_type: string;
  install_date: string;
  expected_life_months: number;
  notification_id?: string | null;
  notes?: string | null;
}) {
  db.runSync(
    `UPDATE battery_logs SET
       firearm_id=?, accessory_id=?, device_label=?, battery_type=?,
       install_date=?, expected_life_months=?, notification_id=?, notes=?
     WHERE id=?`,
    [
      data.firearm_id ?? null,
      data.accessory_id ?? null,
      data.device_label,
      data.battery_type,
      data.install_date,
      data.expected_life_months,
      data.notification_id ?? null,
      data.notes ?? null,
      id,
    ]
  );
}

export function getBatteryLogById(id: number): BatteryLog | null {
  return db.getFirstSync('SELECT * FROM battery_logs WHERE id = ?', [id]) as BatteryLog | null;
}

/** Active = not yet replaced. These drive the hub list and reminders. */
export function getActiveBatteryLogs(): BatteryLogWithFirearm[] {
  return db.getAllSync(`
    SELECT bl.*,
           f.make AS firearm_make,
           f.model AS firearm_model,
           f.nickname AS firearm_nickname,
           a.accessory_type AS accessory_type,
           a.make AS accessory_make,
           a.model AS accessory_model
    FROM battery_logs bl
    LEFT JOIN firearms f ON f.id = bl.firearm_id
    LEFT JOIN accessories a ON a.id = bl.accessory_id
    WHERE bl.replacement_date IS NULL
    ORDER BY bl.install_date ASC
  `) as BatteryLogWithFirearm[];
}

/** Returns the active (unreplaced) battery log tied to an accessory, if any.
 *  Used by the accessory sync helper + the firearm detail screen's status
 *  chips. There is at most one active log per accessory by convention. */
export function getActiveBatteryLogForAccessory(accessory_id: number): BatteryLog | null {
  return db.getFirstSync(
    `SELECT * FROM battery_logs
     WHERE accessory_id = ? AND replacement_date IS NULL
     ORDER BY install_date DESC
     LIMIT 1`,
    [accessory_id]
  ) as BatteryLog | null;
}

/** Full battery history for a firearm — includes BOTH active and replaced
 *  logs, joined with accessory info so the detail screen can label each row
 *  without a second query. Ordered install-date DESC so the currently-active
 *  battery sits on top, followed by older replaced batteries. */
export function getBatteryHistoryForFirearm(firearm_id: number): BatteryLogWithFirearm[] {
  return db.getAllSync(
    `SELECT bl.*,
            f.make AS firearm_make,
            f.model AS firearm_model,
            f.nickname AS firearm_nickname,
            a.accessory_type AS accessory_type,
            a.make AS accessory_make,
            a.model AS accessory_model
     FROM battery_logs bl
     LEFT JOIN firearms f ON f.id = bl.firearm_id
     LEFT JOIN accessories a ON a.id = bl.accessory_id
     WHERE bl.firearm_id = ?
     ORDER BY bl.install_date DESC, bl.id DESC`,
    [firearm_id]
  ) as BatteryLogWithFirearm[];
}

/** Marks a log as replaced. Returns the previous notification_id so the
 *  caller can cancel the scheduled reminder. */
export function markBatteryReplaced(id: number, replacement_date: string): string | null {
  const prev = db.getFirstSync(
    'SELECT notification_id FROM battery_logs WHERE id = ?',
    [id]
  ) as { notification_id: string | null } | null;
  db.runSync(
    'UPDATE battery_logs SET replacement_date = ?, notification_id = NULL WHERE id = ?',
    [replacement_date, id]
  );
  return prev?.notification_id ?? null;
}

/** Updates just the notification_id — used when (re)scheduling a reminder. */
export function setBatteryNotificationId(id: number, notification_id: string | null) {
  db.runSync(
    'UPDATE battery_logs SET notification_id = ? WHERE id = ?',
    [notification_id, id]
  );
}

export function deleteBatteryLog(id: number): string | null {
  const prev = db.getFirstSync(
    'SELECT notification_id FROM battery_logs WHERE id = ?',
    [id]
  ) as { notification_id: string | null } | null;
  db.runSync('DELETE FROM battery_logs WHERE id = ?', [id]);
  return prev?.notification_id ?? null;
}

export function countActiveBatteryLogs(): number {
  const r = db.getFirstSync(
    'SELECT COUNT(*) AS c FROM battery_logs WHERE replacement_date IS NULL'
  ) as { c: number };
  return r?.c ?? 0;
}
// ─── RANGE SESSIONS ───────────────────────────────────────

export interface RangeSession {
  id: number;
  session_date: string;
  location: string | null;
  weather: string | null;
  notes: string | null;
  session_type: string | null;
  temperature: string | null;
  humidity: string | null;
  wind: string | null;
  conditions: string | null;
  match_name: string | null;
  match_url: string | null;
  division: string | null;
  classification: string | null;
  placement: string | null;
  match_score: string | null;
  created_at: string;
}

export interface RangeSessionFirearm {
  id: number;
  session_id: number;
  firearm_id: number;
  ammo_id: number | null;
  rounds_fired: number;
  notes: string | null;
}

/** Used when rendering the session list — includes aggregate metrics rolled
 *  up from the junction table so the list row can render count/rounds
 *  without a per-row query. */
export interface RangeSessionWithStats extends RangeSession {
  firearm_count: number;
  total_rounds: number;
}

/** A joined row used on the session detail/edit screen so each line item
 *  already carries the firearm+ammo labels without chasing foreign keys in
 *  the UI. */
export interface RangeSessionFirearmDetail extends RangeSessionFirearm {
  firearm_make: string;
  firearm_model: string;
  firearm_nickname: string | null;
  ammo_caliber: string | null;
  ammo_brand: string | null;
}

export function getAllRangeSessions(): RangeSessionWithStats[] {
  return db.getAllSync(`
    SELECT rs.*,
           COUNT(rsf.id) AS firearm_count,
           COALESCE(SUM(rsf.rounds_fired), 0) AS total_rounds
    FROM range_sessions rs
    LEFT JOIN range_session_firearms rsf ON rsf.session_id = rs.id
    GROUP BY rs.id
    ORDER BY rs.session_date DESC, rs.id DESC
  `) as RangeSessionWithStats[];
}

export function getRangeSessionById(id: number): RangeSession | null {
  return db.getFirstSync('SELECT * FROM range_sessions WHERE id = ?', [id]) as RangeSession | null;
}

export function getRangeSessionFirearms(session_id: number): RangeSessionFirearmDetail[] {
  return db.getAllSync(`
    SELECT rsf.*,
           f.make AS firearm_make, f.model AS firearm_model, f.nickname AS firearm_nickname,
           a.caliber AS ammo_caliber, a.brand AS ammo_brand
    FROM range_session_firearms rsf
    JOIN firearms f ON f.id = rsf.firearm_id
    LEFT JOIN ammo a ON a.id = rsf.ammo_id
    WHERE rsf.session_id = ?
    ORDER BY rsf.id ASC
  `, [session_id]) as RangeSessionFirearmDetail[];
}

/** Sessions that touched a specific firearm — used on the firearm detail
 *  screen's RANGE SESSIONS list. Carries just the fields needed to render
 *  the row: session date, location, and this firearm's rounds on the trip. */
export interface FirearmRangeAppearance {
  session_id: number;
  session_date: string;
  location: string | null;
  rounds_fired: number;
  line_id: number;
}

export function getRangeSessionsForFirearm(firearm_id: number): FirearmRangeAppearance[] {
  return db.getAllSync(`
    SELECT rs.id AS session_id, rs.session_date, rs.location,
           rsf.rounds_fired, rsf.id AS line_id
    FROM range_session_firearms rsf
    JOIN range_sessions rs ON rs.id = rsf.session_id
    WHERE rsf.firearm_id = ?
    ORDER BY rs.session_date DESC, rs.id DESC
  `, [firearm_id]) as FirearmRangeAppearance[];
}

/** Distinct past locations — most-recent first. Powers the quick-pick chip
 *  row on the add-session screen so frequent ranges stay one tap away. */
export function getRecentRangeLocations(limit = 6): string[] {
  const rows = db.getAllSync(`
    SELECT location FROM range_sessions
    WHERE location IS NOT NULL AND TRIM(location) <> ''
    GROUP BY location
    ORDER BY MAX(session_date) DESC, MAX(id) DESC
    LIMIT ?
  `, [limit]) as { location: string }[];
  return rows.map(r => r.location);
}

interface SessionLineInput {
  firearm_id: number;
  ammo_id?: number | null;
  rounds_fired: number;
  notes?: string | null;
}

/**
 * Persists a new range session plus its per-firearm lines.
 *
 * Side effects (intentional — this is the "logging a trip" action):
 *   - Each firearm's round_count is incremented by rounds_fired.
 *   - Each linked ammo lot's quantity is decremented by rounds_fired
 *     (floored at 0 so overshoot doesn't produce negative stock).
 */
export function addRangeSession(
  session: {
    session_date: string;
    location?: string | null;
    weather?: string | null;
    notes?: string | null;
    session_type?: string | null;
    temperature?: string | null;
    humidity?: string | null;
    wind?: string | null;
    conditions?: string | null;
    match_name?: string | null;
    match_url?: string | null;
    division?: string | null;
    classification?: string | null;
    placement?: string | null;
    match_score?: string | null;
  },
  lines: SessionLineInput[],
): number {
  const result = db.runSync(
    `INSERT INTO range_sessions (session_date, location, weather, notes, session_type, temperature, humidity, wind, conditions, match_name, match_url, division, classification, placement, match_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.session_date,
      session.location ?? null,
      session.weather ?? null,
      session.notes ?? null,
      session.session_type ?? null,
      session.temperature ?? null,
      session.humidity ?? null,
      session.wind ?? null,
      session.conditions ?? null,
      session.match_name ?? null,
      session.match_url ?? null,
      session.division ?? null,
      session.classification ?? null,
      session.placement ?? null,
      session.match_score ?? null,
    ],
  );
  const session_id = result.lastInsertRowId as number;

  for (const line of lines) {
    db.runSync(
      `INSERT INTO range_session_firearms (session_id, firearm_id, ammo_id, rounds_fired, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [session_id, line.firearm_id, line.ammo_id ?? null, line.rounds_fired, line.notes ?? null],
    );
    if (line.rounds_fired > 0) {
      db.runSync(
        'UPDATE firearms SET round_count = COALESCE(round_count, 0) + ? WHERE id = ?',
        [line.rounds_fired, line.firearm_id],
      );
      if (line.ammo_id != null) {
        db.runSync(
          'UPDATE ammo SET quantity = MAX(0, COALESCE(quantity, 0) - ?) WHERE id = ?',
          [line.rounds_fired, line.ammo_id],
        );
      }
    }
  }
  return session_id;
}

/**
 * Replace an existing session and reverse the prior side effects before
 * applying the new ones. We restore (or re-deduct) round counts and ammo
 * quantities based on the diff between old and new lines so editing a
 * session never drifts the derived numbers.
 */
export function updateRangeSession(
  id: number,
  session: {
    session_date: string;
    location?: string | null;
    weather?: string | null;
    notes?: string | null;
    session_type?: string | null;
    temperature?: string | null;
    humidity?: string | null;
    wind?: string | null;
    conditions?: string | null;
    match_name?: string | null;
    match_url?: string | null;
    division?: string | null;
    classification?: string | null;
    placement?: string | null;
    match_score?: string | null;
  },
  lines: SessionLineInput[],
) {
  // 1. Reverse prior line side effects
  const prior = db.getAllSync(
    'SELECT firearm_id, ammo_id, rounds_fired FROM range_session_firearms WHERE session_id = ?',
    [id],
  ) as { firearm_id: number; ammo_id: number | null; rounds_fired: number }[];
  for (const p of prior) {
    if (p.rounds_fired > 0) {
      db.runSync(
        'UPDATE firearms SET round_count = MAX(0, COALESCE(round_count, 0) - ?) WHERE id = ?',
        [p.rounds_fired, p.firearm_id],
      );
      if (p.ammo_id != null) {
        db.runSync(
          'UPDATE ammo SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?',
          [p.rounds_fired, p.ammo_id],
        );
      }
    }
  }

  // 2. Update the session row and wipe old lines
  db.runSync(
    `UPDATE range_sessions
     SET session_date = ?, location = ?, weather = ?, notes = ?, session_type = ?, temperature = ?, humidity = ?, wind = ?, conditions = ?, match_name = ?, match_url = ?, division = ?, classification = ?, placement = ?, match_score = ?
     WHERE id = ?`,
    [
      session.session_date,
      session.location ?? null,
      session.weather ?? null,
      session.notes ?? null,
      session.session_type ?? null,
      session.temperature ?? null,
      session.humidity ?? null,
      session.wind ?? null,
      session.conditions ?? null,
      session.match_name ?? null,
      session.match_url ?? null,
      session.division ?? null,
      session.classification ?? null,
      session.placement ?? null,
      session.match_score ?? null,
      id,
    ],
  );
  db.runSync('DELETE FROM range_session_firearms WHERE session_id = ?', [id]);

  // 3. Re-insert lines with fresh side effects
  for (const line of lines) {
    db.runSync(
      `INSERT INTO range_session_firearms (session_id, firearm_id, ammo_id, rounds_fired, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [id, line.firearm_id, line.ammo_id ?? null, line.rounds_fired, line.notes ?? null],
    );
    if (line.rounds_fired > 0) {
      db.runSync(
        'UPDATE firearms SET round_count = COALESCE(round_count, 0) + ? WHERE id = ?',
        [line.rounds_fired, line.firearm_id],
      );
      if (line.ammo_id != null) {
        db.runSync(
          'UPDATE ammo SET quantity = MAX(0, COALESCE(quantity, 0) - ?) WHERE id = ?',
          [line.rounds_fired, line.ammo_id],
        );
      }
    }
  }
}

/** Deletes a session and reverses its side effects so derived totals stay
 *  consistent. */
export function deleteRangeSession(id: number) {
  const prior = db.getAllSync(
    'SELECT firearm_id, ammo_id, rounds_fired FROM range_session_firearms WHERE session_id = ?',
    [id],
  ) as { firearm_id: number; ammo_id: number | null; rounds_fired: number }[];
  for (const p of prior) {
    if (p.rounds_fired > 0) {
      db.runSync(
        'UPDATE firearms SET round_count = MAX(0, COALESCE(round_count, 0) - ?) WHERE id = ?',
        [p.rounds_fired, p.firearm_id],
      );
      if (p.ammo_id != null) {
        db.runSync(
          'UPDATE ammo SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?',
          [p.rounds_fired, p.ammo_id],
        );
      }
    }
  }
  // Cascades clean up range_session_firearms via FK
  db.runSync('DELETE FROM range_sessions WHERE id = ?', [id]);
}

// ─── RANGE SESSION PHOTOS ───────────────────────────────────────

export interface RangeSessionPhoto {
  id: number;
  session_id: number;
  image_uri: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export function addRangeSessionPhoto(data: {
  session_id: number;
  image_uri: string;
  caption?: string | null;
  sort_order?: number | null;
}): number {
  const result = db.runSync(
    'INSERT INTO range_session_photos (session_id, image_uri, caption, sort_order) VALUES (?, ?, ?, ?)',
    [data.session_id, data.image_uri, data.caption ?? null, data.sort_order ?? 0]
  );
  return result.lastInsertRowId as number;
}

export function getRangeSessionPhotos(session_id: number): RangeSessionPhoto[] {
  return db.getAllSync(
    'SELECT * FROM range_session_photos WHERE session_id = ? ORDER BY sort_order ASC, created_at ASC',
    [session_id]
  ) as RangeSessionPhoto[];
}

export function deleteRangeSessionPhoto(id: number) {
  db.runSync('DELETE FROM range_session_photos WHERE id = ?', [id]);
}

// ─── Dispositions (FFL bound book — transfers out) ──────────────────────

export type DispositionKind = 'firearm' | 'suppressor';

/** Supported disposition reasons. Matches the ATF A&D book "disposition
 *  type" field plus a couple of extras (Gifted, Lost) that the app already
 *  recorded informally. The bound book export just echoes whatever is here. */
export const DISPOSITION_TYPES = [
  'Sold',
  'Transferred',
  'Gifted',
  'Traded',
  'Returned',
  'Destroyed',
  'Stolen',
  'Lost',
] as const;
export type DispositionType = typeof DISPOSITION_TYPES[number];

export interface Disposition {
  id: number;
  item_kind: DispositionKind;
  item_id: number;
  disposition_date: string;
  disposition_type: string;
  to_name: string | null;
  to_address: string | null;
  to_ffl_number: string | null;
  form_4473_serial: string | null;
  sale_price: number | null;
  notes: string | null;
  created_at: string;
}

export interface DispositionInput {
  item_kind: DispositionKind;
  item_id: number;
  disposition_date: string;
  disposition_type: string;
  to_name?: string | null;
  to_address?: string | null;
  to_ffl_number?: string | null;
  form_4473_serial?: string | null;
  sale_price?: number | null;
  notes?: string | null;
}

/** Single-item lookup — most callers only care about "is this item
 *  disposed, and if so what does the record look like?" We only keep one
 *  active disposition per item today; if the table grows past that we
 *  return the most recent by disposition_date, then id. */
export function getDispositionForItem(
  kind: DispositionKind, itemId: number,
): Disposition | null {
  const row = db.getFirstSync(
    `SELECT * FROM dispositions
      WHERE item_kind = ? AND item_id = ?
      ORDER BY disposition_date DESC, id DESC
      LIMIT 1`,
    [kind, itemId],
  ) as Disposition | undefined;
  return row ?? null;
}

/** Bulk lookup keyed by "kind:id" string — used by the bound book
 *  export so we don't hit the DB N times. */
export function getAllDispositionsByItemKey(): Map<string, Disposition> {
  const rows = db.getAllSync(
    `SELECT * FROM dispositions
      ORDER BY disposition_date DESC, id DESC`,
  ) as Disposition[];
  const out = new Map<string, Disposition>();
  for (const r of rows) {
    const key = `${r.item_kind}:${r.item_id}`;
    // First write wins because we ORDER BY newest first — keeps the most
    // recent disposition if multiple exist for the same item.
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

export function insertDisposition(input: DispositionInput): number {
  const res = db.runSync(
    `INSERT INTO dispositions
      (item_kind, item_id, disposition_date, disposition_type,
       to_name, to_address, to_ffl_number, form_4473_serial,
       sale_price, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.item_kind, input.item_id,
      input.disposition_date, input.disposition_type,
      input.to_name ?? null, input.to_address ?? null,
      input.to_ffl_number ?? null, input.form_4473_serial ?? null,
      input.sale_price ?? null, input.notes ?? null,
    ],
  );
  return res.lastInsertRowId as number;
}

export function updateDisposition(id: number, input: DispositionInput): void {
  db.runSync(
    `UPDATE dispositions SET
       item_kind = ?, item_id = ?,
       disposition_date = ?, disposition_type = ?,
       to_name = ?, to_address = ?, to_ffl_number = ?,
       form_4473_serial = ?, sale_price = ?, notes = ?
     WHERE id = ?`,
    [
      input.item_kind, input.item_id,
      input.disposition_date, input.disposition_type,
      input.to_name ?? null, input.to_address ?? null,
      input.to_ffl_number ?? null, input.form_4473_serial ?? null,
      input.sale_price ?? null, input.notes ?? null,
      id,
    ],
  );
}

export function deleteDisposition(id: number): void {
  db.runSync('DELETE FROM dispositions WHERE id = ?', [id]);
}

// ─────────────────────────────────────────────────────────────────────────
// DOPE cards — per-firearm shooting data. A "card" groups a zero + unit
// preference + scope/conditions context, and owns N distance entries.
// ─────────────────────────────────────────────────────────────────────────

export type DopeUnits = 'MOA' | 'MIL';
export const DOPE_UNITS: DopeUnits[] = ['MOA', 'MIL'];

export interface DopeCard {
  id: number;
  firearm_id: number;
  name: string;
  ammo_description: string | null;
  zero_distance_yards: number | null;
  units: DopeUnits;
  scope_notes: string | null;
  conditions_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Includes the owning firearm's make/model + entry count for list views. */
export interface DopeCardWithMeta extends DopeCard {
  firearm_make: string | null;
  firearm_model: string | null;
  firearm_nickname: string | null;
  entry_count: number;
}

export interface DopeCardInput {
  firearm_id: number;
  name: string;
  ammo_description: string | null;
  zero_distance_yards: number | null;
  units: DopeUnits;
  scope_notes: string | null;
  conditions_notes: string | null;
}

/** One shot on the per-distance record. Rendered as a column on the card. */
export interface DopeShot {
  elev: string | null;
  wind: string | null;
  called: string | null;
}

export interface DopeEntry {
  id: number;
  dope_card_id: number;
  distance_yards: number;
  elevation: number | null;            // ELEVATION USED
  windage: number | null;              // WINDAGE USED
  drop_inches: number | null;
  notes: string | null;                // REMARKS
  range_name: string | null;
  light: string | null;
  mirage: string | null;
  temperature: string | null;
  hour_time: string | null;
  hold: string | null;
  elevation_correct: number | null;
  windage_correct: number | null;
  wind_velocity: string | null;
  wind_clock: number | null;           // 1..12
  light_clock: number | null;          // 1..12
  shots_json: string | null;           // JSON-encoded DopeShot[]
}

export interface DopeEntryInput {
  dope_card_id: number;
  distance_yards: number;
  elevation: number | null;
  windage: number | null;
  drop_inches: number | null;
  notes: string | null;
  range_name?: string | null;
  light?: string | null;
  mirage?: string | null;
  temperature?: string | null;
  hour_time?: string | null;
  hold?: string | null;
  elevation_correct?: number | null;
  windage_correct?: number | null;
  wind_velocity?: string | null;
  wind_clock?: number | null;
  light_clock?: number | null;
  shots_json?: string | null;
}

export function getAllDopeCards(): DopeCardWithMeta[] {
  return db.getAllSync(
    `SELECT c.*,
       f.make AS firearm_make,
       f.model AS firearm_model,
       f.nickname AS firearm_nickname,
       (SELECT COUNT(*) FROM dope_entries e WHERE e.dope_card_id = c.id) AS entry_count
     FROM dope_cards c
     JOIN firearms f ON f.id = c.firearm_id
     ORDER BY c.updated_at DESC, c.id DESC`,
  ) as DopeCardWithMeta[];
}

export function getDopeCardsForFirearm(firearmId: number): DopeCard[] {
  return db.getAllSync(
    `SELECT * FROM dope_cards WHERE firearm_id = ? ORDER BY updated_at DESC, id DESC`,
    [firearmId],
  ) as DopeCard[];
}

export function getDopeCardById(id: number): DopeCard | null {
  const row = db.getFirstSync(
    'SELECT * FROM dope_cards WHERE id = ?',
    [id],
  ) as DopeCard | undefined;
  return row ?? null;
}

export function insertDopeCard(input: DopeCardInput): number {
  const res = db.runSync(
    `INSERT INTO dope_cards
       (firearm_id, name, ammo_description, zero_distance_yards,
        units, scope_notes, conditions_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.firearm_id, input.name,
      input.ammo_description ?? null,
      input.zero_distance_yards ?? null,
      input.units, input.scope_notes ?? null, input.conditions_notes ?? null,
    ],
  );
  return res.lastInsertRowId as number;
}

export function updateDopeCard(id: number, input: DopeCardInput): void {
  db.runSync(
    `UPDATE dope_cards SET
       firearm_id = ?, name = ?, ammo_description = ?,
       zero_distance_yards = ?, units = ?,
       scope_notes = ?, conditions_notes = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.firearm_id, input.name,
      input.ammo_description ?? null,
      input.zero_distance_yards ?? null,
      input.units, input.scope_notes ?? null, input.conditions_notes ?? null,
      id,
    ],
  );
}

export function deleteDopeCard(id: number): void {
  db.runSync('DELETE FROM dope_cards WHERE id = ?', [id]);
}

/** Bump the card's updated_at without touching any other field. Call after
 *  mutating entries so the list view re-sorts the card to the top. */
function touchDopeCard(cardId: number): void {
  db.runSync(
    `UPDATE dope_cards SET updated_at = datetime('now') WHERE id = ?`,
    [cardId],
  );
}

export function getDopeEntriesForCard(cardId: number): DopeEntry[] {
  return db.getAllSync(
    `SELECT * FROM dope_entries WHERE dope_card_id = ?
     ORDER BY distance_yards ASC, id ASC`,
    [cardId],
  ) as DopeEntry[];
}

export function insertDopeEntry(input: DopeEntryInput): number {
  const res = db.runSync(
    `INSERT INTO dope_entries
       (dope_card_id, distance_yards, elevation, windage, drop_inches, notes,
        range_name, light, mirage, temperature, hour_time, hold,
        elevation_correct, windage_correct, wind_velocity, wind_clock,
        light_clock, shots_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.dope_card_id, input.distance_yards,
      input.elevation ?? null, input.windage ?? null,
      input.drop_inches ?? null, input.notes ?? null,
      input.range_name ?? null, input.light ?? null, input.mirage ?? null,
      input.temperature ?? null, input.hour_time ?? null, input.hold ?? null,
      input.elevation_correct ?? null, input.windage_correct ?? null,
      input.wind_velocity ?? null, input.wind_clock ?? null,
      input.light_clock ?? null, input.shots_json ?? null,
    ],
  );
  touchDopeCard(input.dope_card_id);
  return res.lastInsertRowId as number;
}

export function updateDopeEntry(id: number, input: DopeEntryInput): void {
  db.runSync(
    `UPDATE dope_entries SET
       distance_yards = ?, elevation = ?, windage = ?,
       drop_inches = ?, notes = ?,
       range_name = ?, light = ?, mirage = ?, temperature = ?,
       hour_time = ?, hold = ?, elevation_correct = ?, windage_correct = ?,
       wind_velocity = ?, wind_clock = ?, light_clock = ?, shots_json = ?
     WHERE id = ?`,
    [
      input.distance_yards,
      input.elevation ?? null, input.windage ?? null,
      input.drop_inches ?? null, input.notes ?? null,
      input.range_name ?? null, input.light ?? null, input.mirage ?? null,
      input.temperature ?? null, input.hour_time ?? null, input.hold ?? null,
      input.elevation_correct ?? null, input.windage_correct ?? null,
      input.wind_velocity ?? null, input.wind_clock ?? null,
      input.light_clock ?? null, input.shots_json ?? null,
      id,
    ],
  );
  touchDopeCard(input.dope_card_id);
}

export function deleteDopeEntry(id: number): void {
  const row = db.getFirstSync(
    'SELECT dope_card_id FROM dope_entries WHERE id = ?',
    [id],
  ) as { dope_card_id: number } | undefined;
  db.runSync('DELETE FROM dope_entries WHERE id = ?', [id]);
  if (row) touchDopeCard(row.dope_card_id);
}

// ─── Competition Matches ─────────────────────────────────────

export const MATCH_TYPES = ['USPSA', 'IDPA', 'Steel Challenge', 'Outlaw'] as const;
export type MatchType = typeof MATCH_TYPES[number];

export const USPSA_DIVISIONS = ['Production', 'Carry Optics', 'Open', 'Limited', 'Single Stack', 'Revolver', 'PCC'] as const;
export const IDPA_DIVISIONS = ['CCP', 'SSP', 'ESP', 'REV', 'CO', 'PCC'] as const;
export const USPSA_CLASSES = ['GM', 'M', 'A', 'B', 'C', 'D', 'U'] as const;
export const IDPA_CLASSES = ['DM', 'MA', 'EX', 'SS', 'MM', 'NV'] as const;

export interface CompetitionMatch {
  id: number;
  match_date: string;
  match_name: string;
  match_type: string;
  practiscore_url: string | null;
  location: string | null;
  firearm_id: number | null;
  ammo_id: number | null;
  division: string | null;
  classification: string | null;
  overall_placement: number | null;
  division_placement: number | null;
  total_stages: number | null;
  overall_score: number | null;
  overall_hit_factor: number | null;
  squad_notes: string | null;
  notes: string | null;
  session_id: number | null;
  created_at: string;
}

export interface CompetitionMatchWithMeta extends CompetitionMatch {
  firearm_name: string | null;
  stage_count: number;
}

export interface CompetitionStage {
  id: number;
  match_id: number;
  stage_number: number;
  stage_name: string | null;
  points: number | null;
  time: number | null;
  hit_factor: number | null;
  penalties: number;
  a_hits: number | null;
  c_hits: number | null;
  d_hits: number | null;
  m_hits: number | null;
  ns_hits: number | null;
  procedural: number;
  points_down: number | null;
  stage_score: number | null;
  best_time: number | null;
  strings_json: string | null;
  stage_placement: number | null;
  notes: string | null;
}

export interface CompetitionMatchInput {
  match_date: string;
  match_name: string;
  match_type: string;
  practiscore_url?: string | null;
  location?: string | null;
  firearm_id?: number | null;
  ammo_id?: number | null;
  division?: string | null;
  classification?: string | null;
  overall_placement?: number | null;
  division_placement?: number | null;
  total_stages?: number | null;
  overall_score?: number | null;
  overall_hit_factor?: number | null;
  squad_notes?: string | null;
  notes?: string | null;
  session_id?: number | null;
}

export interface CompetitionStageInput {
  match_id: number;
  stage_number: number;
  stage_name?: string | null;
  points?: number | null;
  time?: number | null;
  hit_factor?: number | null;
  penalties?: number;
  a_hits?: number | null;
  c_hits?: number | null;
  d_hits?: number | null;
  m_hits?: number | null;
  ns_hits?: number | null;
  procedural?: number;
  points_down?: number | null;
  stage_score?: number | null;
  best_time?: number | null;
  strings_json?: string | null;
  stage_placement?: number | null;
  notes?: string | null;
}

export function getAllCompetitionMatches(): CompetitionMatchWithMeta[] {
  return db.getAllSync(
    `SELECT m.*,
       COALESCE(f.nickname, f.make || ' ' || f.model) as firearm_name,
       (SELECT COUNT(*) FROM competition_stages WHERE match_id = m.id) as stage_count
     FROM competition_matches m
     LEFT JOIN firearms f ON f.id = m.firearm_id
     ORDER BY m.match_date DESC, m.id DESC`
  ) as CompetitionMatchWithMeta[];
}

export function getCompetitionMatchById(id: number): CompetitionMatch | null {
  return db.getFirstSync(
    'SELECT * FROM competition_matches WHERE id = ?', [id]
  ) as CompetitionMatch | undefined ?? null;
}

export function insertCompetitionMatch(input: CompetitionMatchInput): number {
  const result = db.runSync(
    `INSERT INTO competition_matches
     (match_date, match_name, match_type, practiscore_url, location, firearm_id, ammo_id,
      division, classification, overall_placement, division_placement, total_stages,
      overall_score, overall_hit_factor, squad_notes, notes, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.match_date, input.match_name, input.match_type,
     input.practiscore_url ?? null, input.location ?? null,
     input.firearm_id ?? null, input.ammo_id ?? null,
     input.division ?? null, input.classification ?? null,
     input.overall_placement ?? null, input.division_placement ?? null,
     input.total_stages ?? null, input.overall_score ?? null,
     input.overall_hit_factor ?? null, input.squad_notes ?? null,
     input.notes ?? null, input.session_id ?? null]
  );
  return result.lastInsertRowId as number;
}

export function updateCompetitionMatch(id: number, input: CompetitionMatchInput): void {
  db.runSync(
    `UPDATE competition_matches SET
     match_date=?, match_name=?, match_type=?, practiscore_url=?, location=?,
     firearm_id=?, ammo_id=?, division=?, classification=?,
     overall_placement=?, division_placement=?, total_stages=?,
     overall_score=?, overall_hit_factor=?, squad_notes=?, notes=?, session_id=?
     WHERE id=?`,
    [input.match_date, input.match_name, input.match_type,
     input.practiscore_url ?? null, input.location ?? null,
     input.firearm_id ?? null, input.ammo_id ?? null,
     input.division ?? null, input.classification ?? null,
     input.overall_placement ?? null, input.division_placement ?? null,
     input.total_stages ?? null, input.overall_score ?? null,
     input.overall_hit_factor ?? null, input.squad_notes ?? null,
     input.notes ?? null, input.session_id ?? null, id]
  );
}

export function deleteCompetitionMatch(id: number): void {
  db.runSync('DELETE FROM competition_matches WHERE id = ?', [id]);
}

// ─── Competition Stages ──────────────────────────────────────

export function getStagesForMatch(matchId: number): CompetitionStage[] {
  return db.getAllSync(
    'SELECT * FROM competition_stages WHERE match_id = ? ORDER BY stage_number ASC',
    [matchId]
  ) as CompetitionStage[];
}

export function insertCompetitionStage(input: CompetitionStageInput): number {
  const result = db.runSync(
    `INSERT INTO competition_stages
     (match_id, stage_number, stage_name, points, time, hit_factor, penalties,
      a_hits, c_hits, d_hits, m_hits, ns_hits, procedural,
      points_down, stage_score, best_time, strings_json, stage_placement, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.match_id, input.stage_number, input.stage_name ?? null,
     input.points ?? null, input.time ?? null, input.hit_factor ?? null,
     input.penalties ?? 0, input.a_hits ?? null, input.c_hits ?? null,
     input.d_hits ?? null, input.m_hits ?? null, input.ns_hits ?? null,
     input.procedural ?? 0, input.points_down ?? null, input.stage_score ?? null,
     input.best_time ?? null, input.strings_json ?? null,
     input.stage_placement ?? null, input.notes ?? null]
  );
  return result.lastInsertRowId as number;
}

export function updateCompetitionStage(id: number, input: CompetitionStageInput): void {
  db.runSync(
    `UPDATE competition_stages SET
     stage_number=?, stage_name=?, points=?, time=?, hit_factor=?, penalties=?,
     a_hits=?, c_hits=?, d_hits=?, m_hits=?, ns_hits=?, procedural=?,
     points_down=?, stage_score=?, best_time=?, strings_json=?,
     stage_placement=?, notes=?
     WHERE id=?`,
    [input.stage_number, input.stage_name ?? null,
     input.points ?? null, input.time ?? null, input.hit_factor ?? null,
     input.penalties ?? 0, input.a_hits ?? null, input.c_hits ?? null,
     input.d_hits ?? null, input.m_hits ?? null, input.ns_hits ?? null,
     input.procedural ?? 0, input.points_down ?? null, input.stage_score ?? null,
     input.best_time ?? null, input.strings_json ?? null,
     input.stage_placement ?? null, input.notes ?? null, id]
  );
}

export function deleteCompetitionStage(id: number): void {
  db.runSync('DELETE FROM competition_stages WHERE id = ?', [id]);
}
