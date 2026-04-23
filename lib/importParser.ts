/**
 * CSV / Excel import parser for Iron Ledger.
 *
 * Accepts raw file content (string for CSV, base64 for XLSX) and returns
 * a uniform { headers, rows } structure the import screen can display
 * and map to database fields.
 */

// ── CSV parsing ─────────────────────────────────────────────
// Handles quoted fields, commas inside quotes, and newlines inside quotes.
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(cell.trim());
        if (row.some(c => c !== '')) lines.push(row);
        row = [];
        cell = '';
        if (ch === '\r') i++; // skip \n after \r
      } else {
        cell += ch;
      }
    }
  }
  // Last row
  row.push(cell.trim());
  if (row.some(c => c !== '')) lines.push(row);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0];
  const rows = lines.slice(1);
  return { headers, rows };
}

// ── TSV parsing ─────────────────────────────────────────────
function parseTSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split('\t').map(c => c.trim()));
  return { headers, rows };
}

// ── XLSX parsing (SheetJS-style, using a lightweight approach) ───
// We use a minimal approach: since SheetJS is large, we convert XLSX
// to CSV on-device using the xlsx library if available, otherwise
// we require CSV format. The import screen will handle the library check.
//
// For now, this module focuses on CSV/TSV which covers the primary use
// case. XLSX support is handled in the import screen via dynamic import.

// ── Field mapping ───────────────────────────────────────────
// The "smart matcher" — given a column header from the user's file,
// guess which Iron Ledger field it maps to.

export type ImportableField =
  | 'make' | 'model' | 'caliber' | 'serial_number' | 'type'
  | 'purchase_date' | 'purchase_price' | 'current_value'
  | 'condition_rating' | 'notes' | 'nickname' | 'action_type'
  | 'trigger_type' | 'storage_location' | 'round_count'
  | 'skip';

export const IMPORTABLE_FIELDS: { key: ImportableField; label: string }[] = [
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'caliber', label: 'Caliber' },
  { key: 'serial_number', label: 'Serial Number' },
  { key: 'type', label: 'Type' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'purchase_date', label: 'Purchase Date' },
  { key: 'purchase_price', label: 'Purchase Price' },
  { key: 'current_value', label: 'Current Value' },
  { key: 'condition_rating', label: 'Condition' },
  { key: 'action_type', label: 'Action Type' },
  { key: 'trigger_type', label: 'Trigger Type' },
  { key: 'storage_location', label: 'Storage Location' },
  { key: 'round_count', label: 'Round Count' },
  { key: 'notes', label: 'Notes' },
  { key: 'skip', label: '— Skip Column —' },
];

// Fuzzy header → field matching. Handles common naming patterns from
// popular spreadsheet templates and FFL-style bound books.
const HEADER_PATTERNS: [RegExp, ImportableField][] = [
  [/\b(make|manufacturer|mfg|brand)\b/i, 'make'],
  [/\b(model|firearm\s*name)\b/i, 'model'],
  [/\b(cal(iber)?|gauge|chambering)\b/i, 'caliber'],
  [/\b(serial|s\/?n|serial\s*#|serial\s*num)/i, 'serial_number'],
  [/\b(type|category|class|platform)\b/i, 'type'],
  [/\b(nick\s*name|alias|name)\b/i, 'nickname'],
  [/\b(purchase\s*date|date\s*(purchased|acquired|bought)|acq.*date|buy\s*date)\b/i, 'purchase_date'],
  [/\b(purchase\s*price|cost|price\s*paid|paid|buy\s*price)\b/i, 'purchase_price'],
  [/\b(current\s*value|value|worth|market\s*value|est.*value)\b/i, 'current_value'],
  [/\b(condition|cond(\.)?|rating)\b/i, 'condition_rating'],
  [/\b(action|action\s*type)\b/i, 'action_type'],
  [/\b(trigger|trigger\s*type)\b/i, 'trigger_type'],
  [/\b(storage|location|safe|stored)\b/i, 'storage_location'],
  [/\b(round\s*count|rounds?\s*fired|total\s*rounds)\b/i, 'round_count'],
  [/\b(notes?|comments?|remarks?|description)\b/i, 'notes'],
];

export function guessFieldMapping(headers: string[]): ImportableField[] {
  return headers.map((h) => {
    const norm = h.trim();
    for (const [regex, field] of HEADER_PATTERNS) {
      if (regex.test(norm)) return field;
    }
    return 'skip';
  });
}

export interface ParsedFile {
  headers: string[];
  rows: string[][];
  mapping: ImportableField[];
}

export function parseFile(
  content: string,
  filename: string,
): ParsedFile {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  let result: { headers: string[]; rows: string[][] };

  if (ext === 'tsv' || ext === 'txt') {
    result = parseTSV(content);
  } else {
    // Default to CSV parsing (also works for .csv files)
    result = parseCSV(content);
  }

  const mapping = guessFieldMapping(result.headers);
  return { ...result, mapping };
}

// ── Row → Firearm record conversion ────────────────────────
export interface ImportedFirearm {
  make: string;
  model: string;
  caliber?: string | null;
  serial_number?: string | null;
  type?: string | null;
  nickname?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  current_value?: number | null;
  condition_rating?: string | null;
  action_type?: string | null;
  trigger_type?: string | null;
  storage_location?: string | null;
  round_count?: number;
  notes?: string | null;
}

export function rowsToFirearms(
  rows: string[][],
  mapping: ImportableField[],
): { valid: ImportedFirearm[]; skipped: number } {
  const valid: ImportedFirearm[] = [];
  let skipped = 0;

  for (const row of rows) {
    const record: Record<string, string> = {};
    for (let i = 0; i < mapping.length; i++) {
      const field = mapping[i];
      if (field !== 'skip' && i < row.length) {
        record[field] = row[i];
      }
    }

    // Must have at least make and model
    const make = (record.make ?? '').trim();
    const model = (record.model ?? '').trim();
    if (!make && !model) {
      skipped++;
      continue;
    }

    const firearm: ImportedFirearm = {
      make: make || 'Unknown',
      model: model || 'Unknown',
      caliber: record.caliber?.trim() || null,
      serial_number: record.serial_number?.trim() || null,
      type: record.type?.trim() || null,
      nickname: record.nickname?.trim() || null,
      purchase_date: record.purchase_date?.trim() || null,
      purchase_price: record.purchase_price ? parseFloat(record.purchase_price.replace(/[$,]/g, '')) || null : null,
      current_value: record.current_value ? parseFloat(record.current_value.replace(/[$,]/g, '')) || null : null,
      condition_rating: record.condition_rating?.trim() || null,
      action_type: record.action_type?.trim() || null,
      trigger_type: record.trigger_type?.trim() || null,
      storage_location: record.storage_location?.trim() || null,
      round_count: record.round_count ? parseInt(record.round_count.replace(/[,]/g, ''), 10) || 0 : 0,
      notes: record.notes?.trim() || null,
    };
    valid.push(firearm);
  }

  return { valid, skipped };
}
