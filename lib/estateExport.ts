// Estate planning export
//
// Generates a PDF packaging every firearm + suppressor with the data an
// executor actually needs to settle the estate: purchase date, purchase
// price, current value, provenance (purchased from / dealer), storage
// location, and condition. Items are grouped by storage location so the
// executor can walk physical spaces (home safe / bank / trustee) and tick
// them off one by one.
//
// Distinct from the insurance report: this one is about *provenance and
// liquidation*, not *accessory-level replacement cost*. NFA items are
// tagged so the executor knows which need trustee coordination.
//
// Output: HTML → expo-print → PDF → expo-sharing. Same pipeline as
// lib/trustExport.ts and app/insurance.tsx.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';
import {
  getAllFirearms, getAllSuppressors, getAllNfaTrusts, getAllAmmo, formatDate,
  type Firearm, type Suppressor, type NfaTrust, type Ammo,
} from './database';

/** Categories the user can toggle on the config screen. */
export interface EstateExportOptions {
  includeFirearms: boolean;
  includeSuppressors: boolean;
  includeAmmo: boolean;
  /** IDs to exclude (unchecked in the item picker). */
  excludeFirearmIds?: Set<number>;
  excludeSuppressorIds?: Set<number>;
  excludeAmmoIds?: Set<number>;
}

// HTML-escape user-provided strings so serials, notes, etc. can't break
// the generated markup or inject tags.
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

/** Format a USD amount. Returns empty string when null so callers can
 *  decide to dashOr() it or leave the cell blank. */
function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Discriminated entry so the builder can render both types through the
 *  same row template while preserving type-narrow field access. */
type EstateEntry =
  | { kind: 'firearm'; item: Firearm }
  | { kind: 'suppressor'; item: Suppressor };

/** Normalize empty/whitespace storage locations to a single "Unspecified"
 *  bucket so every row has a home in the grouped report. */
function locationKey(loc: string | null | undefined): string {
  const t = (loc ?? '').trim();
  return t || 'Unspecified Location';
}

interface LocationBucket {
  location: string;
  entries: EstateEntry[];
}

function buildBuckets(firearms: Firearm[], suppressors: Suppressor[]): LocationBucket[] {
  const map = new Map<string, EstateEntry[]>();
  const push = (loc: string, entry: EstateEntry) => {
    const arr = map.get(loc);
    if (arr) arr.push(entry);
    else map.set(loc, [entry]);
  };
  for (const f of firearms) push(locationKey(f.storage_location), { kind: 'firearm', item: f });
  for (const s of suppressors) push(locationKey(s.storage_location), { kind: 'suppressor', item: s });

  // Sort locations alphabetically, pushing the Unspecified bucket to the
  // bottom so specific locations (Home Safe, Bank Box, etc.) come first
  // and blank rows read as "clean this up" not "front-and-center".
  const buckets: LocationBucket[] = [...map.entries()]
    .sort(([a], [b]) => {
      if (a === 'Unspecified Location') return 1;
      if (b === 'Unspecified Location') return -1;
      return a.localeCompare(b);
    })
    .map(([location, entries]) => ({ location, entries }));

  // Within a bucket, firearms before suppressors, each alpha by make/model.
  for (const b of buckets) {
    b.entries.sort((a, z) => {
      if (a.kind !== z.kind) return a.kind === 'firearm' ? -1 : 1;
      const an = `${a.item.make} ${a.item.model}`.toLowerCase();
      const zn = `${z.item.make} ${z.item.model}`.toLowerCase();
      return an.localeCompare(zn);
    });
  }
  return buckets;
}

function nfaLabel(entry: EstateEntry, trusts: Map<number, NfaTrust>): string {
  if (entry.kind === 'firearm' && !entry.item.is_nfa) return 'No';
  const form = entry.item.nfa_form_type ?? (entry.kind === 'suppressor' ? 'Form 4' : '');
  const trust = entry.item.trust_id != null ? trusts.get(entry.item.trust_id) : null;
  const trustName = trust?.name ?? entry.item.trust_name ?? null;
  const parts = ['Yes'];
  if (form) parts.push(form);
  if (trustName) parts.push(`Trust: ${trustName}`);
  return parts.join(' · ');
}

function firearmRow(f: Firearm, nfa: string): string {
  const name = esc(f.nickname || `${f.make} ${f.model}`);
  const dealer = [f.purchased_from, f.dealer_city_state].filter(Boolean).join(' · ');
  return `
    <tr>
      <td class="v">${name}</td>
      <td class="v">Firearm</td>
      <td class="v">${dashOr(f.make)} ${esc(f.model)}</td>
      <td class="v">${dashOr(f.caliber)}</td>
      <td class="mono">${dashOr(f.serial_number)}</td>
      <td class="v">${dashOr(formatDate(f.purchase_date))}</td>
      <td class="v">${dashOr(dealer)}</td>
      <td class="num">${dashOr(money(f.purchase_price))}</td>
      <td class="num">${dashOr(money(f.current_value))}</td>
      <td class="v">${dashOr(f.condition_rating)}</td>
      <td class="v">${esc(nfa)}</td>
    </tr>`;
}

function suppressorRow(s: Suppressor, nfa: string): string {
  const name = esc(`${s.make} ${s.model}`);
  const dealer = [s.purchased_from, s.dealer_city_state].filter(Boolean).join(' · ');
  return `
    <tr>
      <td class="v">${name}</td>
      <td class="v">Suppressor</td>
      <td class="v">${dashOr(s.make)} ${esc(s.model)}</td>
      <td class="v">${dashOr(s.caliber)}</td>
      <td class="mono">${dashOr(s.serial_number)}</td>
      <td class="v">${dashOr(formatDate(s.purchase_date))}</td>
      <td class="v">${dashOr(dealer)}</td>
      <td class="num">${dashOr(money(s.purchase_price))}</td>
      <td class="num">${dashOr(money(s.current_value))}</td>
      <td class="v">${dashOr(s.condition_rating)}</td>
      <td class="v">${esc(nfa)}</td>
    </tr>`;
}

function renderBucket(bucket: LocationBucket, trusts: Map<number, NfaTrust>): string {
  const rows = bucket.entries.map(e => {
    const nfa = nfaLabel(e, trusts);
    return e.kind === 'firearm' ? firearmRow(e.item, nfa) : suppressorRow(e.item, nfa);
  }).join('');

  // Per-bucket subtotal of purchase vs. current value so the executor sees
  // appreciation/depreciation at the location level (e.g. safe full of
  // appreciating suppressors vs. a depreciated carry collection).
  const purchaseTotal = bucket.entries.reduce<number>((sum, e) => sum + (e.item.purchase_price ?? 0), 0);
  const currentTotal = bucket.entries.reduce<number>((sum, e) => sum + (e.item.current_value ?? 0), 0);

  return `
    <section class="bucket">
      <div class="bucket-header">
        <h2>${esc(bucket.location)}</h2>
        <span class="bucket-count">${bucket.entries.length} item${bucket.entries.length === 1 ? '' : 's'}</span>
      </div>

      <table class="main">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Make / Model</th>
            <th>Caliber</th>
            <th>Serial #</th>
            <th>Purchased</th>
            <th>From</th>
            <th class="num">Purchase Price</th>
            <th class="num">Current Value</th>
            <th>Condition</th>
            <th>NFA</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="7" class="foot-label">Subtotal — ${esc(bucket.location)}</td>
            <td class="num foot-num">${esc(money(purchaseTotal))}</td>
            <td class="num foot-num">${esc(money(currentTotal))}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
}

function buildHtml(buckets: LocationBucket[], trusts: NfaTrust[], ammoSection: string = ''): string {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const trustMap = new Map(trusts.map(t => [t.id, t]));

  const totalFirearms = buckets.reduce((n, b) => n + b.entries.filter(e => e.kind === 'firearm').length, 0);
  const totalSuppressors = buckets.reduce((n, b) => n + b.entries.filter(e => e.kind === 'suppressor').length, 0);
  const totalItems = totalFirearms + totalSuppressors;
  const grandPurchase = buckets.reduce((n, b) =>
    n + b.entries.reduce<number>((s, e) => s + (e.item.purchase_price ?? 0), 0), 0);
  const grandCurrent = buckets.reduce((n, b) =>
    n + b.entries.reduce<number>((s, e) => s + (e.item.current_value ?? 0), 0), 0);
  const delta = grandCurrent - grandPurchase;
  const deltaSign = delta >= 0 ? '+' : '−';

  const nfaCount = buckets.reduce((n, b) =>
    n + b.entries.filter(e =>
      (e.kind === 'firearm' && e.item.is_nfa) || e.kind === 'suppressor'
    ).length, 0);

  const sections = buckets.map(b => renderBucket(b, trustMap)).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Estate Planning Export — ${esc(todayStr)}</title>
  <style>
    @page { size: letter landscape; margin: 0.5in; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
           color: #111; font-size: 10px; line-height: 1.4; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 4px 0; letter-spacing: 0.5px; }
    h2 { font-size: 14px; margin: 0; }
    .header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
    .subtitle { color: #555; font-size: 11px; margin-top: 4px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
    .stat { border: 1px solid #AAA; padding: 6px 10px; border-radius: 4px; min-width: 110px; }
    .stat .label { color: #555; font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase; }
    .stat .value { color: #111; font-size: 14px; font-weight: 700; margin-top: 2px; }
    .stat .delta-pos { color: #006400; }
    .stat .delta-neg { color: #8B0000; }
    .bucket { margin-bottom: 20px; page-break-inside: avoid; }
    .bucket-header { display: flex; align-items: baseline; justify-content: space-between;
                     border-bottom: 1px solid #999; padding-bottom: 4px; margin-bottom: 6px; }
    .bucket-count { color: #555; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #EEE; font-weight: 700; font-size: 9px; letter-spacing: 0.3px;
         text-align: left; padding: 5px 6px; border-bottom: 1px solid #999; }
    th.num { text-align: right; }
    td { padding: 5px 6px; border-bottom: 1px solid #DDD; vertical-align: top; font-size: 10px; }
    td.num { text-align: right; white-space: nowrap; }
    td.mono { font-family: "Menlo", "SF Mono", monospace; font-size: 10px; }
    tfoot td { background: #F6F6F6; font-size: 10px; border-top: 1px solid #999;
               border-bottom: 1px solid #999; padding: 6px; }
    .foot-label { font-weight: 700; text-align: right; color: #333; }
    .foot-num { font-weight: 700; color: #111; }
    .empty { padding: 40px; text-align: center; color: #666; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #CCC;
              font-size: 9px; color: #666; line-height: 1.5; }
    .footer b { color: #333; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Estate Planning Export</h1>
    <div class="subtitle">Prepared for executor / next of kin</div>
    <div class="summary">
      <div class="stat">
        <div class="label">Generated</div>
        <div class="value" style="font-size:11px;">${esc(todayStr)}</div>
      </div>
      <div class="stat">
        <div class="label">Total Items</div>
        <div class="value">${totalItems}</div>
      </div>
      <div class="stat">
        <div class="label">Firearms</div>
        <div class="value">${totalFirearms}</div>
      </div>
      <div class="stat">
        <div class="label">Suppressors</div>
        <div class="value">${totalSuppressors}</div>
      </div>
      <div class="stat">
        <div class="label">NFA Items</div>
        <div class="value">${nfaCount}</div>
      </div>
      <div class="stat">
        <div class="label">Total Purchase</div>
        <div class="value">${esc(money(grandPurchase)) || '—'}</div>
      </div>
      <div class="stat">
        <div class="label">Total Current</div>
        <div class="value">${esc(money(grandCurrent)) || '—'}</div>
      </div>
      <div class="stat">
        <div class="label">Unrealized</div>
        <div class="value ${delta >= 0 ? 'delta-pos' : 'delta-neg'}">
          ${grandPurchase === 0 && grandCurrent === 0 ? '—' : `${deltaSign}${esc(money(Math.abs(delta)))}`}
        </div>
      </div>
    </div>
  </div>

  ${buckets.length === 0 && !ammoSection
    ? `<div class="empty">No firearms or suppressors on file.</div>`
    : sections}

  ${ammoSection}

  <div class="footer">
    <b>About this document:</b> This estate export lists every firearm and suppressor tracked in
    the Iron Ledger app as of the generation date, grouped by storage location. NFA items are
    tagged with their form type and trust (where applicable). Current values reflect the owner's
    last manual update and should be re-appraised before probate or sale.
    <br/><br/>
    <b>For NFA items:</b> Transfer of NFA-regulated firearms and suppressors upon death requires
    ATF paperwork (typically Form 5). If the items are held in a gun trust, contact the successor
    trustee named in the trust. A separate "NFA Trust Export" is available in the NFA Hub with
    additional compliance detail for an attorney or trustee.
    <br/><br/>
    <b>Not legal or financial advice.</b> Iron Ledger is a record-keeping tool. Consult a licensed
    attorney, appraiser, and/or estate planner before making decisions based on this document.
  </div>
</body>
</html>`;
}

/**
 * Main entry point. Gathers all data, generates the PDF, and hands it to
 * the native share sheet. Returns a success/failure sentinel so the
 * caller can decide what to alert.
 */
/** Render an ammo inventory section for the estate export. */
function renderAmmoSection(ammoList: Ammo[]): string {
  if (ammoList.length === 0) return '';
  const rows = ammoList.map(a => {
    const name = esc(`${a.brand ?? ''} ${a.caliber ?? ''} ${a.grain ? a.grain + 'gr' : ''}`.trim() || 'Unknown');
    return `<tr>
      <td class="v">${name}</td>
      <td class="v">${dashOr(a.caliber)}</td>
      <td class="v">${dashOr(a.brand)}</td>
      <td class="num">${a.grain ?? '—'}</td>
      <td class="num">${a.quantity?.toLocaleString() ?? '—'}</td>
      <td class="v">${dashOr(a.lot_number)}</td>
      <td class="v">${a.is_handload ? 'Handload' : 'Factory'}</td>
    </tr>`;
  }).join('');
  const totalQty = ammoList.reduce((n, a) => n + (a.quantity ?? 0), 0);
  return `
    <section class="bucket">
      <div class="bucket-header">
        <h2>Ammunition Inventory</h2>
        <span class="bucket-count">${ammoList.length} type${ammoList.length === 1 ? '' : 's'}, ${totalQty.toLocaleString()} total rounds</span>
      </div>
      <table class="main">
        <thead><tr>
          <th>Description</th><th>Caliber</th><th>Brand</th>
          <th class="num">Grain</th><th class="num">Qty</th><th>Lot #</th><th>Type</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

export async function generateEstateExport(opts?: EstateExportOptions): Promise<
  { ok: true; uri: string } | { ok: false; reason: 'empty' | 'share-unavailable' }
> {
  const options: EstateExportOptions = opts ?? {
    includeFirearms: true, includeSuppressors: true, includeAmmo: false,
  };

  let firearms = options.includeFirearms ? getAllFirearms() : [];
  let suppressors = options.includeSuppressors ? getAllSuppressors() : [];
  let ammo = options.includeAmmo ? getAllAmmo() : [];
  const trusts = getAllNfaTrusts();

  // Apply per-item exclusions
  if (options.excludeFirearmIds?.size) {
    firearms = firearms.filter(f => !options.excludeFirearmIds!.has(f.id));
  }
  if (options.excludeSuppressorIds?.size) {
    suppressors = suppressors.filter(s => !options.excludeSuppressorIds!.has(s.id));
  }
  if (options.excludeAmmoIds?.size) {
    ammo = ammo.filter(a => !options.excludeAmmoIds!.has(a.id));
  }

  if (firearms.length === 0 && suppressors.length === 0 && ammo.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const buckets = buildBuckets(firearms, suppressors);
  const ammoHtml = renderAmmoSection(ammo);
  const html = buildHtml(buckets, trusts, ammoHtml);

  const { uri } = await Print.printToFileAsync({ html, base64: false });

  // Rename so the share sheet shows a meaningful filename rather than
  // expo-print's opaque tempfile. Best-effort — fall back to raw uri.
  let shareUri = uri;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pretty = new File(Paths.cache, `Iron Ledger Estate Export ${today}.pdf`);
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
      dialogTitle: 'Iron Ledger — Estate Export',
      UTI: 'com.adobe.pdf',
    });
    return { ok: true, uri: shareUri };
  }

  await Share.share({
    title: 'Iron Ledger — Estate Export',
    message: `Generated estate export with ${firearms.length} firearm(s) and ${suppressors.length} suppressor(s). PDF saved to: ${shareUri}`,
  });
  return { ok: false, reason: 'share-unavailable' };
}
