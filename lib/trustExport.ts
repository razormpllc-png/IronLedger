// Trust-ready NFA export
//
// Generates a PDF packaging every NFA item (firearm + suppressor) with the
// data an attorney or trustee actually needs: serials, form types, ATF
// control numbers, filing/approval dates, tax stamp amounts, trust name,
// and responsible persons. Items are grouped by trust so a trustee can see
// at a glance what's held in each entity.
//
// Output: HTML → expo-print → PDF → expo-sharing. Mirrors the pipeline in
// app/insurance.tsx so the share sheet behavior is consistent.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';
import {
  getAllNfaItems, getAllSuppressors, getAllNfaTrusts, formatDate,
  type Firearm, type Suppressor, type NfaTrust,
} from './database';

// HTML-escape user-provided strings so serials, notes, and persons names
// can't break the generated markup or inject tags.
function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a value or an em-dash when the field is blank. Used throughout
 *  the table so empty cells read as "intentionally absent" rather than
 *  looking like a layout bug. */
function dashOr(v: string | number | null | undefined): string {
  const s = esc(v);
  return s || '—';
}

/** Discriminated entry so the builder can render both types through the
 *  same row template while preserving type-narrow field access. */
type NfaEntry =
  | { kind: 'firearm'; item: Firearm }
  | { kind: 'suppressor'; item: Suppressor };

/** Bucket of items that share a trust (or are held individually). */
interface TrustBucket {
  /** null means "Held Individually" (no trust_id on any of the items). */
  trust: NfaTrust | null;
  entries: NfaEntry[];
}

/** Build the buckets from DB content. Pure — easy to unit-test later. */
function buildBuckets(
  firearms: Firearm[],
  suppressors: Suppressor[],
  trusts: NfaTrust[],
): TrustBucket[] {
  const byTrust = new Map<number, TrustBucket>();
  const individual: NfaEntry[] = [];

  const place = (entry: NfaEntry, trust_id: number | null) => {
    if (trust_id == null) { individual.push(entry); return; }
    const trust = trusts.find(t => t.id === trust_id) ?? null;
    if (!trust) { individual.push(entry); return; }
    const existing = byTrust.get(trust_id);
    if (existing) existing.entries.push(entry);
    else byTrust.set(trust_id, { trust, entries: [entry] });
  };

  for (const f of firearms) place({ kind: 'firearm', item: f }, f.trust_id);
  for (const s of suppressors) place({ kind: 'suppressor', item: s }, s.trust_id);

  // Sort trusts alphabetically for stable output, then individual bucket
  // last. Within a bucket, firearms before suppressors, each sorted by
  // make/model for the attorney's eye.
  const buckets: TrustBucket[] = [...byTrust.values()]
    .sort((a, b) => (a.trust?.name ?? '').localeCompare(b.trust?.name ?? ''));
  if (individual.length > 0) {
    buckets.push({ trust: null, entries: individual });
  }
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

/** Turn a Firearm row into the table cells for one report line. */
function firearmRow(f: Firearm): string {
  const formType = f.nfa_form_type || f.nfa_item_category || 'NFA';
  const status = f.atf_form_status ?? (f.date_approved ? 'Approved' : (f.date_filed ? 'Pending' : 'Not Yet Filed'));
  const tax = f.tax_paid_amount != null ? `$${f.tax_paid_amount.toFixed(0)}` : '';
  return `
    <tr>
      <td class="v">${esc(f.nickname || `${f.make} ${f.model}`)}</td>
      <td class="v">Firearm</td>
      <td class="v">${dashOr(f.make)} ${esc(f.model)}</td>
      <td class="v">${dashOr(f.caliber)}</td>
      <td class="mono">${dashOr(f.serial_number)}</td>
      <td class="v">${esc(formType)}</td>
      <td class="v">${esc(status)}</td>
      <td class="mono">${dashOr(f.atf_control_number)}</td>
      <td class="v">${dashOr(formatDate(f.date_filed))}</td>
      <td class="v">${dashOr(formatDate(f.date_approved))}</td>
      <td class="v">${dashOr(tax)}</td>
    </tr>`;
}

/** Turn a Suppressor row into a table cell row. Structurally similar to
 *  firearmRow but suppressors have no nickname/item_category. */
function suppressorRow(s: Suppressor): string {
  const formType = s.nfa_form_type || 'Form 4';
  const status = s.atf_form_status ?? (s.date_approved ? 'Approved' : (s.date_filed ? 'Pending' : 'Not Yet Filed'));
  const tax = s.tax_paid_amount != null ? `$${s.tax_paid_amount.toFixed(0)}` : '';
  return `
    <tr>
      <td class="v">${esc(`${s.make} ${s.model}`)}</td>
      <td class="v">Suppressor</td>
      <td class="v">${dashOr(s.make)} ${esc(s.model)}</td>
      <td class="v">${dashOr(s.caliber)}</td>
      <td class="mono">${dashOr(s.serial_number)}</td>
      <td class="v">${esc(formType)}</td>
      <td class="v">${esc(status)}</td>
      <td class="mono">${dashOr(s.atf_control_number)}</td>
      <td class="v">${dashOr(formatDate(s.date_filed))}</td>
      <td class="v">${dashOr(formatDate(s.date_approved))}</td>
      <td class="v">${dashOr(tax)}</td>
    </tr>`;
}

/** Compose the per-entry responsible-persons text. Trust-level persons
 *  take precedence; if the item itself has a more specific list we
 *  include both with labels so the attorney can reconcile any drift. */
function responsiblePersonsFor(entry: NfaEntry, trust: NfaTrust | null): string {
  const item = entry.item;
  const itemRP = item.responsible_persons?.trim() || '';
  const trustRP = trust?.responsible_persons?.trim() || '';
  if (!itemRP && !trustRP) return '—';
  if (itemRP && trustRP && itemRP !== trustRP) {
    return `Trust: ${esc(trustRP)}<br/>Item: ${esc(itemRP)}`;
  }
  return esc(itemRP || trustRP);
}

/** Render one bucket (trust or "Held Individually") as its own section. */
function renderBucket(bucket: TrustBucket): string {
  const title = bucket.trust ? bucket.trust.name : 'Held Individually (No Trust)';
  const trustType = bucket.trust?.trust_type ?? '';
  const rows = bucket.entries.map(e =>
    e.kind === 'firearm' ? firearmRow(e.item) : suppressorRow(e.item)
  ).join('');

  // Per-item responsible-persons list rendered as a supplementary block
  // below the main table. Attorneys need this visible per-item because
  // Form 4s list responsible persons on the stamp itself.
  const rpRows = bucket.entries.map(e => {
    const label = e.kind === 'firearm'
      ? (e.item.nickname || `${e.item.make} ${e.item.model}`)
      : `${e.item.make} ${e.item.model}`;
    const serial = e.item.serial_number ? ` · SN ${esc(e.item.serial_number)}` : '';
    return `
      <tr>
        <td class="v">${esc(label)}${serial}</td>
        <td class="v">${responsiblePersonsFor(e, bucket.trust)}</td>
      </tr>`;
  }).join('');

  return `
    <section class="bucket">
      <div class="bucket-header">
        <h2>${esc(title)}</h2>
        ${trustType ? `<span class="trust-type">${esc(trustType)}</span>` : ''}
      </div>
      ${bucket.trust?.responsible_persons
        ? `<div class="trust-rp"><span class="k">Trust Responsible Persons:</span> ${esc(bucket.trust.responsible_persons)}</div>`
        : ''}
      <div class="bucket-count">${bucket.entries.length} item${bucket.entries.length === 1 ? '' : 's'}</div>

      <table class="main">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Make / Model</th>
            <th>Caliber</th>
            <th>Serial #</th>
            <th>Form</th>
            <th>Status</th>
            <th>ATF Ctrl #</th>
            <th>Filed</th>
            <th>Approved</th>
            <th>Tax</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="sub">Responsible Persons by Item</div>
      <table class="rp">
        <thead>
          <tr><th>Item</th><th>Responsible Persons</th></tr>
        </thead>
        <tbody>${rpRows}</tbody>
      </table>
    </section>
  `;
}

/** Build the full report HTML. Kept sync — no I/O. */
function buildHtml(buckets: TrustBucket[]): string {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const totalFirearms = buckets.reduce((n, b) => n + b.entries.filter(e => e.kind === 'firearm').length, 0);
  const totalSuppressors = buckets.reduce((n, b) => n + b.entries.filter(e => e.kind === 'suppressor').length, 0);
  const totalItems = totalFirearms + totalSuppressors;

  const sections = buckets.map(renderBucket).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>NFA Trust Export — ${esc(todayStr)}</title>
  <style>
    @page { size: letter landscape; margin: 0.5in; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
           color: #111; font-size: 10px; line-height: 1.4; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 4px 0; letter-spacing: 0.5px; }
    h2 { font-size: 15px; margin: 0; }
    .header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 18px; }
    .subtitle { color: #555; font-size: 11px; margin-top: 4px; }
    .meta { margin-top: 8px; font-size: 10px; color: #333; }
    .meta span { margin-right: 18px; }
    .meta b { color: #111; }
    .bucket { margin-bottom: 24px; page-break-inside: avoid; }
    .bucket-header { display: flex; align-items: baseline; gap: 10px;
                     border-bottom: 1px solid #999; padding-bottom: 4px; margin-bottom: 6px; }
    .trust-type { color: #555; font-size: 10px; font-weight: normal; }
    .trust-rp { font-size: 10px; margin-bottom: 6px; color: #222; }
    .trust-rp .k { font-weight: 600; }
    .bucket-count { color: #666; font-size: 10px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th { background: #EEE; font-weight: 700; font-size: 9px; letter-spacing: 0.3px;
         text-align: left; padding: 5px 6px; border-bottom: 1px solid #999; }
    td { padding: 5px 6px; border-bottom: 1px solid #DDD; vertical-align: top; font-size: 10px; }
    td.v { }
    td.mono { font-family: "Menlo", "SF Mono", monospace; font-size: 10px; }
    .sub { font-size: 10px; font-weight: 700; margin-top: 8px; margin-bottom: 4px; color: #333; }
    table.rp th { font-size: 9px; }
    .empty { padding: 40px; text-align: center; color: #666; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #CCC;
              font-size: 9px; color: #666; line-height: 1.5; }
    .footer b { color: #333; }
  </style>
</head>
<body>
  <div class="header">
    <h1>NFA Trust &amp; Estate Export</h1>
    <div class="subtitle">Prepared for attorney / trustee review</div>
    <div class="meta">
      <span><b>Generated:</b> ${esc(todayStr)}</span>
      <span><b>Total Items:</b> ${totalItems}</span>
      <span><b>Firearms:</b> ${totalFirearms}</span>
      <span><b>Suppressors:</b> ${totalSuppressors}</span>
      <span><b>Trusts:</b> ${buckets.filter(b => b.trust).length}</span>
    </div>
  </div>

  ${buckets.length === 0
    ? `<div class="empty">No NFA items on file.</div>`
    : sections}

  <div class="footer">
    <b>About this document:</b> This report lists every NFA item tracked in the Iron Ledger app
    as of the generation date, grouped by gun trust where applicable. Serial numbers, ATF control
    numbers, filing dates, approval dates, and responsible persons are captured verbatim from the
    user's records. Accuracy is the owner's responsibility; verify against original Form 1, Form 3,
    and Form 4 stamps before relying on this document for legal or estate purposes.
    <br/><br/>
    <b>Not legal advice.</b> Iron Ledger is a record-keeping tool and does not provide legal,
    tax, or estate planning advice. Consult a licensed attorney for trust formation, estate
    planning, and NFA compliance matters.
  </div>
</body>
</html>`;
}

/**
 * Main entry point. Gathers all data, generates the PDF, and hands it to
 * the native share sheet. Returns true on success, false if the user
 * cancelled or the device has no data to export.
 *
 * Throws on unexpected errors so the caller can surface a friendly alert.
 */
export async function generateTrustExport(): Promise<{ ok: true; uri: string } | { ok: false; reason: 'empty' | 'share-unavailable' }> {
  const firearms = getAllNfaItems();
  const suppressors = getAllSuppressors();
  const trusts = getAllNfaTrusts();

  if (firearms.length === 0 && suppressors.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const buckets = buildBuckets(firearms, suppressors, trusts);
  const html = buildHtml(buckets);

  const { uri } = await Print.printToFileAsync({ html, base64: false });

  // Rename so the share sheet shows a meaningful filename rather than
  // expo-print's opaque tempfile. Best-effort — fall back to raw uri.
  let shareUri = uri;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pretty = new File(Paths.cache, `Iron Ledger NFA Trust Export ${today}.pdf`);
    if (pretty.exists) pretty.delete();
    new File(uri).copy(pretty);
    shareUri = pretty.uri;
  } catch {
    // Rename failures are non-fatal; the raw uri is still a valid PDF.
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Iron Ledger — NFA Trust Export',
      UTI: 'com.adobe.pdf',
    });
    return { ok: true, uri: shareUri };
  }

  // Fallback: device doesn't support native file sharing. Hand off a
  // plain share so the user still gets *something*. Not ideal but
  // better than swallowing the output.
  await Share.share({
    title: 'Iron Ledger — NFA Trust Export',
    message: `Generated NFA trust export with ${firearms.length} firearm(s) and ${suppressors.length} suppressor(s). PDF saved to: ${shareUri}`,
  });
  return { ok: false, reason: 'share-unavailable' };
}
