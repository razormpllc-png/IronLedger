// FFL Acquisition & Disposition (Bound Book) Export — scoped first cut
//
// An FFL's "bound book" is the permanent ATF-required record of every
// firearm that enters (acquisition) or leaves (disposition) inventory.
// This module builds the acquisition side of that record from the data
// Iron Ledger already captures, exports as both PDF (for physical audit
// copies) and CSV (for import into bound-book software), and flags every
// row that's missing an ATF-required field so the dealer can clean up
// records before submission.
//
// This is a PREVIEW feature — dedicated FFL tier will add acquisition FFL
// numbers, importer fields, multi-user access, and per-dealer scoping.
// Disposition tracking landed in the first cut; those columns populate
// from the `dispositions` table when the user marks an item disposed.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';
import {
  getAllFirearms, getAllSuppressors, formatDate,
  getAllDispositionsByItemKey,
  type Firearm, type Suppressor, type Disposition,
} from './database';

function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dashOr(v: string | number | null | undefined): string {
  const s = esc(v);
  return s || '—';
}

/** Escape a CSV cell. Wraps in quotes and doubles internal quotes per RFC 4180. */
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Shape the bound book actually displays. One row per firearm or
 *  suppressor, acquisition-populated, disposition-blank. */
interface BoundBookRow {
  kind: 'firearm' | 'suppressor';
  /** Underlying firearm.id / suppressor.id — used to deep-link flagged
   *  rows back to the detail screen so the user can patch missing fields. */
  itemId: number;
  /** Display label used when the row is listed in the UI (e.g. "CZ P-10 C"
   *  or a nickname). Not part of the CSV/PDF output. */
  displayLabel: string;
  // Acquisition
  acqDate: string | null;
  acqFromName: string | null;
  acqFromAddress: string | null;
  acqFromFfl: string | null;       // Always null for v1 (field missing)
  manufacturer: string | null;
  importer: string | null;          // Always null for v1
  model: string | null;
  serial: string | null;
  type: string | null;              // "Rifle" / "Pistol" / "Suppressor" / etc.
  caliber: string | null;
  // Disposition — always blank in preview
  dispDate: string | null;
  dispToName: string | null;
  dispToAddress: string | null;
  dispToFfl: string | null;
  disp4473Serial: string | null;
  // Validation
  missingFields: string[];
}

/** ATF-required fields for a complete acquisition row. Anything missing
 *  gets flagged so the dealer can patch it before audit. */
const REQUIRED_ACQUISITION = [
  'acqDate', 'manufacturer', 'model', 'serial', 'type', 'caliber',
] as const;

function firearmLabel(f: Firearm): string {
  return (f.nickname && f.nickname.trim())
    || [f.make, f.model].filter(Boolean).join(' ').trim()
    || `Firearm #${f.id}`;
}

function suppressorLabel(s: Suppressor): string {
  return [s.make, s.model].filter(Boolean).join(' ').trim()
    || `Suppressor #${s.id}`;
}

function applyDisposition(row: BoundBookRow, disp: Disposition | undefined): void {
  if (!disp) return;
  row.dispDate = disp.disposition_date;
  // "To" name uses the destination party; disposition_type is appended so
  // the ATF row makes sense at a glance ("John Doe — Sold").
  const whoParts = [disp.to_name, disp.disposition_type].filter(Boolean);
  row.dispToName = whoParts.length ? whoParts.join(' — ') : disp.disposition_type;
  row.dispToAddress = disp.to_address;
  row.dispToFfl = disp.to_ffl_number;
  row.disp4473Serial = disp.form_4473_serial;
}

function buildFirearmRow(f: Firearm, disp?: Disposition): BoundBookRow {
  const row: BoundBookRow = {
    kind: 'firearm',
    itemId: f.id,
    displayLabel: firearmLabel(f),
    acqDate: f.purchase_date,
    acqFromName: f.purchased_from,
    acqFromAddress: f.dealer_city_state,
    acqFromFfl: null,
    manufacturer: f.make,
    importer: null,
    model: f.model,
    serial: f.serial_number,
    type: f.type,
    caliber: f.caliber,
    dispDate: null, dispToName: null, dispToAddress: null,
    dispToFfl: null, disp4473Serial: null,
    missingFields: [],
  };
  applyDisposition(row, disp);
  row.missingFields = REQUIRED_ACQUISITION.filter(k => {
    const v = row[k];
    return v === null || v === undefined || String(v).trim() === '';
  });
  return row;
}

function buildSuppressorRow(s: Suppressor, disp?: Disposition): BoundBookRow {
  const row: BoundBookRow = {
    kind: 'suppressor',
    itemId: s.id,
    displayLabel: suppressorLabel(s),
    acqDate: s.purchase_date,
    acqFromName: s.purchased_from,
    acqFromAddress: s.dealer_city_state,
    acqFromFfl: null,
    manufacturer: s.make,
    importer: null,
    model: s.model,
    serial: s.serial_number,
    type: 'Silencer',  // ATF's formal term for suppressors on Form 4473
    caliber: s.caliber,
    dispDate: null, dispToName: null, dispToAddress: null,
    dispToFfl: null, disp4473Serial: null,
    missingFields: [],
  };
  applyDisposition(row, disp);
  row.missingFields = REQUIRED_ACQUISITION.filter(k => {
    const v = row[k];
    return v === null || v === undefined || String(v).trim() === '';
  });
  return row;
}

/** Build + sort the full bound book. Oldest acquisitions first (standard
 *  A&D book convention) with blank-date rows at the bottom. */
function buildRows(): BoundBookRow[] {
  const firearms = getAllFirearms();
  const suppressors = getAllSuppressors();
  const dispositions = getAllDispositionsByItemKey();
  const rows: BoundBookRow[] = [
    ...firearms.map(f => buildFirearmRow(f, dispositions.get(`firearm:${f.id}`))),
    ...suppressors.map(s => buildSuppressorRow(s, dispositions.get(`suppressor:${s.id}`))),
  ];
  rows.sort((a, b) => {
    if (!a.acqDate && !b.acqDate) return 0;
    if (!a.acqDate) return 1;
    if (!b.acqDate) return -1;
    return a.acqDate.localeCompare(b.acqDate);
  });
  return rows;
}

// ─── PDF ────────────────────────────────────────────────────────────────

function renderPdfRow(row: BoundBookRow, idx: number): string {
  const flagged = row.missingFields.length > 0;
  return `
    <tr class="${flagged ? 'flagged' : ''}">
      <td class="num">${idx + 1}</td>
      <td>${dashOr(formatDate(row.acqDate))}</td>
      <td>${dashOr(row.acqFromName)}</td>
      <td>${dashOr(row.acqFromAddress)}</td>
      <td class="mono">${dashOr(row.acqFromFfl)}</td>
      <td>${dashOr(row.manufacturer)}</td>
      <td>${dashOr(row.importer)}</td>
      <td>${dashOr(row.model)}</td>
      <td class="mono">${dashOr(row.serial)}</td>
      <td>${dashOr(row.type)}</td>
      <td>${dashOr(row.caliber)}</td>
      <td>${dashOr(formatDate(row.dispDate))}</td>
      <td>${dashOr(row.dispToName)}</td>
      <td>${dashOr(row.dispToAddress)}</td>
      <td class="mono">${dashOr(row.dispToFfl)}</td>
      <td class="mono">${dashOr(row.disp4473Serial)}</td>
    </tr>`;
}

function buildPdfHtml(rows: BoundBookRow[]): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const body = rows.map(renderPdfRow).join('');
  const flaggedCount = rows.filter(r => r.missingFields.length > 0).length;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>FFL Bound Book — ${esc(today)}</title>
  <style>
    @page { size: 11in 17in landscape; margin: 0.4in; }
    body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
           color: #111; font-size: 9px; line-height: 1.3; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 4px 0; letter-spacing: 0.5px; }
    .subtitle { color: #555; font-size: 11px; margin-top: 4px; }
    .preview-banner { background: #FFF3CD; border: 1px solid #F5C518; color: #5C4800;
                      padding: 6px 10px; margin: 8px 0 12px 0; font-size: 10px;
                      border-radius: 4px; }
    .preview-banner b { color: #3B2E00; }
    .header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
    .meta { margin-top: 6px; font-size: 10px; color: #333; }
    .meta span { margin-right: 16px; }
    .meta b { color: #111; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #222; color: #FFF; font-weight: 700; font-size: 8px;
         letter-spacing: 0.3px; text-align: left; padding: 5px 4px;
         border: 1px solid #000; vertical-align: bottom; }
    th.group { background: #444; text-align: center; }
    td { padding: 4px 4px; border: 1px solid #999; vertical-align: top; font-size: 9px; }
    td.num { text-align: right; font-family: "Menlo", monospace; }
    td.mono { font-family: "Menlo", "SF Mono", monospace; font-size: 9px; }
    tr.flagged td { background: #FFF3CD; }
    .legend { font-size: 9px; color: #666; margin-top: 10px; line-height: 1.5; }
    .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #CCC;
              font-size: 8px; color: #666; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Acquisition &amp; Disposition Record (Bound Book)</h1>
    <div class="subtitle">ATF-style A&amp;D export</div>
    <div class="meta">
      <span><b>Generated:</b> ${esc(today)}</span>
      <span><b>Total Entries:</b> ${rows.length}</span>
      <span><b>Flagged (incomplete):</b> ${flaggedCount}</span>
    </div>
  </div>

  <div class="preview-banner">
    <b>Preview feature.</b> This export populates acquisition and disposition
    columns from your Iron Ledger records. Acquisition FFL numbers and
    importer fields require the upcoming FFL tier — those two columns remain
    blank below. Rows highlighted in yellow are missing one or more required
    acquisition fields. This is <u>not</u> a substitute for a compliant bound book.
  </div>

  <table>
    <thead>
      <tr>
        <th rowspan="2">#</th>
        <th colspan="5" class="group">Acquisition</th>
        <th colspan="2" class="group">Firearm Description</th>
        <th colspan="2" class="group">Identifier</th>
        <th colspan="2" class="group">Type</th>
        <th colspan="5" class="group">Disposition</th>
      </tr>
      <tr>
        <th>Date</th>
        <th>From (Name)</th>
        <th>From (Address)</th>
        <th>From (FFL #)</th>
        <th>Manufacturer</th>
        <th>Importer</th>
        <th>Model</th>
        <th>Serial #</th>
        <th>Type</th>
        <th>Caliber</th>
        <th>Date</th>
        <th>To (Name)</th>
        <th>To (Address)</th>
        <th>To (FFL #)</th>
        <th>4473 Serial</th>
      </tr>
    </thead>
    <tbody>
      ${rows.length === 0
        ? `<tr><td colspan="16" style="text-align:center; color:#666; padding:20px;">No entries. Add firearms or suppressors to populate the bound book.</td></tr>`
        : body}
    </tbody>
  </table>

  <div class="legend">
    Yellow rows are flagged because one or more ATF-required acquisition fields are missing
    (date, manufacturer, model, serial, type, caliber). Review and patch those firearms
    before relying on this export.
  </div>

  <div class="footer">
    <b>Not a certified record.</b> This export is a data snapshot from the Iron Ledger app and
    does not constitute a compliant ATF bound book. FFLs must maintain their A&amp;D records
    per 27 CFR §478.125 using ATF-approved electronic or paper methods. Use this export as a
    reconciliation aid only.
  </div>
</body>
</html>`;
}

// ─── CSV ────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'Entry #',
  'Acq Date', 'Acq From (Name)', 'Acq From (Address)', 'Acq From (FFL #)',
  'Manufacturer', 'Importer', 'Model', 'Serial #', 'Type', 'Caliber',
  'Disp Date', 'Disp To (Name)', 'Disp To (Address)', 'Disp To (FFL #)',
  'Disp 4473 Serial',
  'Missing Fields',
];

function buildCsv(rows: BoundBookRow[]): string {
  const lines: string[] = [CSV_HEADERS.map(csvCell).join(',')];
  rows.forEach((r, i) => {
    lines.push([
      i + 1,
      r.acqDate, r.acqFromName, r.acqFromAddress, r.acqFromFfl,
      r.manufacturer, r.importer, r.model, r.serial, r.type, r.caliber,
      r.dispDate, r.dispToName, r.dispToAddress, r.dispToFfl,
      r.disp4473Serial,
      r.missingFields.join('; '),
    ].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

// ─── Public entry points ───────────────────────────────────────────────

export interface BoundBookSummary {
  rows: number;
  flagged: number;
}

/** Short, user-facing shape describing a flagged entry — enough to render
 *  a tappable list row that routes back to the item's detail screen. */
export interface FlaggedEntry {
  kind: 'firearm' | 'suppressor';
  itemId: number;
  label: string;
  missing: string[];  // human-readable field labels
}

/** Map the internal BoundBookRow field names to the labels we want to
 *  show in the UI ("Acq Date" rather than "acqDate"). Keeping this here
 *  (not on the screen) means the PDF/CSV and the on-screen list stay in
 *  sync if we ever rename a required field. */
const FIELD_LABELS: Record<string, string> = {
  acqDate: 'Acquisition date',
  manufacturer: 'Manufacturer',
  model: 'Model',
  serial: 'Serial #',
  type: 'Type',
  caliber: 'Caliber',
};

export function getBoundBookSummary(): BoundBookSummary {
  const rows = buildRows();
  return {
    rows: rows.length,
    flagged: rows.filter(r => r.missingFields.length > 0).length,
  };
}

/** All rows with one or more missing ATF-required fields, ordered the same
 *  way they appear in the PDF (oldest acquisition first, undated last). */
export function getFlaggedEntries(): FlaggedEntry[] {
  return buildRows()
    .filter(r => r.missingFields.length > 0)
    .map(r => ({
      kind: r.kind,
      itemId: r.itemId,
      label: r.displayLabel,
      missing: r.missingFields.map(k => FIELD_LABELS[k] ?? k),
    }));
}

export async function generateBoundBookPdf(): Promise<
  { ok: true; uri: string } | { ok: false; reason: 'empty' | 'share-unavailable' }
> {
  const rows = buildRows();
  if (rows.length === 0) return { ok: false, reason: 'empty' };

  const html = buildPdfHtml(rows);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  let shareUri = uri;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pretty = new File(Paths.cache, `Iron Ledger Bound Book ${today}.pdf`);
    if (pretty.exists) pretty.delete();
    new File(uri).copy(pretty);
    shareUri = pretty.uri;
  } catch {
    // Rename failures are non-fatal.
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Iron Ledger — FFL Bound Book',
      UTI: 'com.adobe.pdf',
    });
    return { ok: true, uri: shareUri };
  }

  await Share.share({
    title: 'Iron Ledger — FFL Bound Book',
    message: `Bound book exported with ${rows.length} entries. PDF saved to: ${shareUri}`,
  });
  return { ok: false, reason: 'share-unavailable' };
}

export async function generateBoundBookCsv(): Promise<
  { ok: true; uri: string } | { ok: false; reason: 'empty' | 'share-unavailable' }
> {
  const rows = buildRows();
  if (rows.length === 0) return { ok: false, reason: 'empty' };

  const csv = buildCsv(rows);
  const today = new Date().toISOString().slice(0, 10);
  const csvFile = new File(Paths.cache, `Iron Ledger Bound Book ${today}.csv`);
  try {
    if (csvFile.exists) csvFile.delete();
  } catch {
    // ignore — we'll try to write over whatever's there.
  }
  csvFile.create();
  csvFile.write(csv);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(csvFile.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Iron Ledger — FFL Bound Book (CSV)',
      UTI: 'public.comma-separated-values-text',
    });
    return { ok: true, uri: csvFile.uri };
  }

  await Share.share({
    title: 'Iron Ledger — FFL Bound Book (CSV)',
    message: `Bound book CSV exported with ${rows.length} entries. File saved to: ${csvFile.uri}`,
  });
  return { ok: false, reason: 'share-unavailable' };
}
