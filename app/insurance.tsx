import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Share, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import {
  getAllFirearms, getAccessoriesByFirearm, getFirearmPhotos,
  resolveImageUri, formatDate,
  Firearm, Accessory,
} from '../lib/database';
import { useEntitlements } from '../lib/useEntitlements';
import { showPaywall } from '../lib/paywall';

// HTML-escape user-provided strings so serials, notes, etc. can't break the
// generated PDF markup.
function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── helpers ────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * Read an on-device image file and return it as an HTML-embeddable data
 * URI. Returns null if the file is missing or unreadable — callers fall
 * back to a text "(photo not embedded)" note so the report still renders.
 *
 * We use the legacy FileSystem API here because `readAsStringAsync` with
 * base64 encoding is the most direct route; the modern File class only
 * exposes ArrayBuffer, which would require extra encoding gymnastics.
 */
async function imageToDataUri(stored: string | null): Promise<string | null> {
  const abs = resolveImageUri(stored);
  if (!abs) return null;
  try {
    const ext = (abs.split('.').pop() ?? 'jpg').toLowerCase();
    const mime =
      ext === 'png' ? 'image/png' :
      ext === 'heic' ? 'image/heic' :
      ext === 'webp' ? 'image/webp' :
      'image/jpeg';
    const base64 = await FileSystem.readAsStringAsync(abs, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    console.warn('[insurance] failed to embed image', stored, e);
    return null;
  }
}

/**
 * Flatten an Accessory list into a short, print-friendly summary line
 * per row. Keeps the HTML table light even when a rifle has a stack of
 * optics/lights/lasers/suppressors attached.
 */
function accessoryRows(accs: Accessory[]): string {
  if (!accs.length) return '';
  const esc2 = esc;
  const rows = accs.map(a => {
    const label = [a.make, a.model].filter(Boolean).join(' ').trim() || '—';
    const ser = a.serial_number ? ` · SN ${a.serial_number}` : '';
    return `<tr>
      <td class="k">${esc2(a.accessory_type)}</td>
      <td class="v">${esc2(label)}${esc2(ser)}</td>
    </tr>`;
  }).join('');
  return `
    <div class="sub">Accessories (${accs.length})</div>
    <table>${rows}</table>`;
}

function buildShareText(firearms: Firearm[]): string {
  const total = firearms.reduce((s, f) => s + (f.current_value ?? 0), 0);
  const purchaseTotal = firearms.reduce((s, f) => s + (f.purchase_price ?? 0), 0);
  const nfaCount = firearms.filter(f => f.is_nfa).length;
  const date  = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  let txt = `IRON LEDGER — FIREARMS INSURANCE REPORT\n`;
  txt += `Generated: ${date}\n`;
  txt += `${'─'.repeat(42)}\n\n`;
  txt += `SUMMARY\n`;
  txt += `Total Firearms: ${firearms.length}\n`;
  if (nfaCount > 0) txt += `NFA Items: ${nfaCount}\n`;
  txt += `Total Declared Value: ${fmt(total)}\n`;
  if (purchaseTotal > 0) txt += `Total Purchase Cost: ${fmt(purchaseTotal)}\n`;
  txt += `\n${'─'.repeat(42)}\n\n`;
  txt += `FIREARM DETAILS\n\n`;

  firearms.forEach((f, i) => {
    const name = f.nickname ? `${f.nickname} (${f.make} ${f.model})` : `${f.make} ${f.model}`;
    txt += `${i + 1}. ${name}\n`;
    txt += `   Type:         ${f.type}${f.action_type ? ` · ${f.action_type}` : ''}\n`;
    if (f.trigger_type)            txt += `   Trigger:      ${f.trigger_type}\n`;
    txt += `   Caliber:      ${f.caliber}\n`;
    txt += `   Serial #:     ${f.serial_number || 'N/A'}\n`;
    txt += `   Condition:    ${f.condition_rating || 'N/A'}\n`;
    if (f.storage_location)    txt += `   Storage:      ${f.storage_location}\n`;
    if (f.round_count)         txt += `   Round Count:  ${f.round_count.toLocaleString()}\n`;
    txt += `\n`;
    // Acquisition
    if (f.acquisition_method || f.purchase_date || f.purchased_from) {
      txt += `   — Acquisition —\n`;
      if (f.acquisition_method)  txt += `   Method:       ${f.acquisition_method}\n`;
      if (f.purchase_date)       txt += `   Date:         ${formatDate(f.purchase_date) ?? f.purchase_date}\n`;
      if (f.purchased_from)      txt += `   From:         ${f.purchased_from}\n`;
      if (f.dealer_city_state)   txt += `   Dealer Loc:   ${f.dealer_city_state}\n`;
    }
    // Financial
    if (f.purchase_price || f.current_value) {
      txt += `   — Valuation —\n`;
      if (f.purchase_price) txt += `   Purchase:     ${fmt(f.purchase_price)}\n`;
      if (f.current_value)  txt += `   Current Val:  ${fmt(f.current_value)}\n`;
    }
    // NFA
    if (f.is_nfa) {
      txt += `   — NFA / Tax Stamp —\n`;
      if (f.nfa_form_type)      txt += `   Form:         ${f.nfa_form_type}\n`;
      if (f.nfa_item_category)  txt += `   Category:     ${f.nfa_item_category}\n`;
      if (f.atf_form_status)    txt += `   ATF Status:   ${f.atf_form_status}\n`;
      if (f.atf_control_number) txt += `   Control #:    ${f.atf_control_number}\n`;
      if (f.date_filed)         txt += `   Filed:        ${formatDate(f.date_filed) ?? f.date_filed}\n`;
      if (f.date_approved)      txt += `   Approved:     ${formatDate(f.date_approved) ?? f.date_approved}\n`;
      if (f.tax_paid_amount)    txt += `   Tax Paid:     $${f.tax_paid_amount}\n`;
      if (f.trust_type)         txt += `   Ownership:    ${f.trust_type}\n`;
      if (f.trust_name)         txt += `   Trust Name:   ${f.trust_name}\n`;
    }
    if (f.notes) txt += `   Notes:        ${f.notes}\n`;
    txt += `\n`;
  });

  txt += `${'─'.repeat(42)}\n`;
  txt += `Iron Ledger — Powered by RazorMP\n`;
  txt += `For insurance purposes only.\n`;
  return txt;
}

// Per-firearm embed data, prepared off the main render path so the HTML
// builder stays synchronous.
interface FirearmEmbed {
  heroDataUri: string | null;   // base64 hero photo for the firearm
  galleryDataUris: string[];    // up to N additional gallery photos
  accessories: Accessory[];
}

// Build HTML for expo-print. Uses a print-friendly layout (letter paper, 0.5in
// margins) and mirrors the fields in buildShareText so both outputs stay in
// sync. All user-provided strings are passed through esc() first.
function buildReportHtml(
  firearms: Firearm[],
  embeds: Map<number, FirearmEmbed>,
): string {
  const total         = firearms.reduce((s, f) => s + (f.current_value ?? 0), 0);
  const purchaseTotal = firearms.reduce((s, f) => s + (f.purchase_price ?? 0), 0);
  const nfaCount      = firearms.filter(f => f.is_nfa).length;
  const date          = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const rows = (pairs: Array<[string, string | number | null | undefined]>) =>
    pairs
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`)
      .join('');

  const firearmBlocks = firearms.map((f, i) => {
    const name = f.nickname ? `${f.nickname} (${f.make} ${f.model})` : `${f.make} ${f.model}`;

    const core = rows([
      ['Type',       `${f.type}${f.action_type ? ' · ' + f.action_type : ''}`],
      ['Trigger',    f.trigger_type],
      ['Caliber',    f.caliber],
      ['Serial #',   f.serial_number || 'N/A'],
      ['Condition',  f.condition_rating || 'N/A'],
      ['Storage',    f.storage_location],
      ['Round Count', f.round_count ? f.round_count.toLocaleString() : null],
    ]);

    const hasAcq = f.acquisition_method || f.purchase_date || f.purchased_from || f.dealer_city_state;
    const acq = hasAcq ? `
      <div class="sub">Acquisition</div>
      <table>${rows([
        ['Method',       f.acquisition_method],
        ['Date',         f.purchase_date ? (formatDate(f.purchase_date) ?? f.purchase_date) : null],
        ['From',         f.purchased_from],
        ['Dealer Loc',   f.dealer_city_state],
      ])}</table>` : '';

    const hasVal = f.purchase_price || f.current_value;
    const val = hasVal ? `
      <div class="sub">Valuation</div>
      <table>${rows([
        ['Purchase',    f.purchase_price ? fmt(f.purchase_price) : null],
        ['Current Val', f.current_value  ? fmt(f.current_value)  : null],
      ])}</table>` : '';

    const nfa = f.is_nfa ? `
      <div class="sub">NFA / Tax Stamp</div>
      <table>${rows([
        ['Form',       f.nfa_form_type],
        ['Category',   f.nfa_item_category],
        ['ATF Status', f.atf_form_status],
        ['Control #',  f.atf_control_number],
        ['Filed',      f.date_filed    ? (formatDate(f.date_filed)    ?? f.date_filed)    : null],
        ['Approved',   f.date_approved ? (formatDate(f.date_approved) ?? f.date_approved) : null],
        ['Tax Paid',   f.tax_paid_amount ? `$${f.tax_paid_amount}` : null],
        ['Ownership',  f.trust_type],
        ['Trust Name', f.trust_name],
      ])}</table>` : '';

    const notes = f.notes ? `<div class="notes"><strong>Notes:</strong> ${esc(f.notes)}</div>` : '';

    const embed = embeds.get(f.id);
    const heroImg = embed?.heroDataUri
      ? `<div class="hero"><img src="${embed.heroDataUri}" alt="${esc(name)}"/></div>`
      : '';
    const gallery = embed?.galleryDataUris?.length
      ? `<div class="gallery">${embed.galleryDataUris
          .map(u => `<img src="${u}" alt=""/>`).join('')}</div>`
      : '';
    const accs = embed?.accessories?.length ? accessoryRows(embed.accessories) : '';

    return `
      <section class="firearm">
        <h2>${i + 1}. ${esc(name)}</h2>
        ${heroImg}
        <table>${core}</table>
        ${acq}${val}${accs}${nfa}${gallery}${notes}
      </section>`;
  }).join('');

  const summaryRows = rows([
    ['Total Firearms',       firearms.length],
    ['NFA Items',            nfaCount > 0 ? nfaCount : null],
    ['Total Declared Value', fmt(total)],
    ['Total Purchase Cost',  purchaseTotal > 0 ? fmt(purchaseTotal) : null],
  ]);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Iron Ledger — Insurance Report</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif;
         color: #111; font-size: 11pt; line-height: 1.45;
         margin: 0; padding: 0; }
  header { border-bottom: 2px solid #c9a84c; padding-bottom: 12px; margin-bottom: 20px; }
  header .brand { color: #c9a84c; letter-spacing: 3px; font-size: 10pt; font-weight: 700; }
  header h1 { font-size: 22pt; margin: 2px 0 4px 0; }
  header .meta { color: #555; font-size: 10pt; }
  .summary { background: #faf7ec; border: 1px solid #e6d999; border-radius: 6px;
             padding: 14px 18px; margin-bottom: 22px; }
  .summary h3 { margin: 0 0 8px 0; font-size: 11pt; letter-spacing: 1.5px;
                color: #8a6f1a; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 6px 0; }
  td.k { color: #666; width: 38%; padding: 3px 0; vertical-align: top; }
  td.v { color: #111; padding: 3px 0; vertical-align: top; }
  .firearm { page-break-inside: avoid; margin-bottom: 18px;
             padding-bottom: 14px; border-bottom: 1px solid #ddd; }
  .firearm:last-of-type { border-bottom: none; }
  .firearm h2 { font-size: 13pt; margin: 0 0 8px 0; color: #111; }
  .sub { font-size: 9pt; font-weight: 700; color: #8a6f1a;
         letter-spacing: 1.2px; text-transform: uppercase;
         margin: 10px 0 4px 0; }
  .notes { margin-top: 8px; font-size: 10pt; color: #333;
           background: #f7f7f2; padding: 8px 10px; border-radius: 4px; }
  .hero { margin: 4px 0 10px 0; }
  .hero img { max-width: 100%; max-height: 260px; border-radius: 4px;
              border: 1px solid #ddd; display: block; }
  .gallery { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .gallery img { width: 31%; max-height: 120px; object-fit: cover;
                 border: 1px solid #ddd; border-radius: 3px; }
  .signature { margin-top: 30px; padding: 18px; border: 1px solid #ccc;
               border-radius: 6px; background: #fafafa; }
  .signature h3 { margin: 0 0 10px 0; font-size: 10pt; color: #8a6f1a;
                  letter-spacing: 1.5px; text-transform: uppercase; }
  .signature .row { display: flex; gap: 24px; margin-top: 14px; font-size: 10pt; color: #666; }
  .signature .line { flex: 1; border-bottom: 1px solid #999; padding-bottom: 4px;
                     min-height: 22px; }
  .signature .caption { font-size: 8pt; color: #888; margin-top: 4px;
                        letter-spacing: 1px; text-transform: uppercase; }
  footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #c9a84c;
           color: #666; font-size: 9pt; text-align: center; }
</style>
</head>
<body>
  <header>
    <div class="brand">IRON LEDGER</div>
    <h1>Firearms Insurance Report</h1>
    <div class="meta">Generated ${esc(date)} · Powered by RazorMP</div>
  </header>
  <div class="summary">
    <h3>Summary</h3>
    <table>${summaryRows}</table>
  </div>
  ${firearmBlocks || '<p style="color:#666">No firearms recorded.</p>'}
  <section class="signature">
    <h3>Certification</h3>
    <p style="font-size: 9pt; color: #444; margin: 0;">
      I, the undersigned, certify that the firearms listed above are my
      property and that the details provided are accurate to the best of
      my knowledge as of the date of this report.
    </p>
    <div class="row">
      <div>
        <div class="line">&nbsp;</div>
        <div class="caption">Owner signature</div>
      </div>
      <div style="flex: 0 0 160px;">
        <div class="line">&nbsp;</div>
        <div class="caption">Date</div>
      </div>
    </div>
  </section>
  <footer>For insurance documentation purposes only.</footer>
</body>
</html>`;
}

// ─── component ──────────────────────────────────────────────
export default function InsuranceScreen() {
  const router    = useRouter();
  const ent       = useEntitlements();
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [loading,  setLoading]  = useState(false);

  useFocusEffect(useCallback(() => {
    setFirearms(getAllFirearms());
  }, []));

  const totalValue = firearms.reduce((s, f) => s + (f.current_value ?? 0), 0);

  /**
   * Preload embeds (hero photo + gallery + accessories) per firearm.
   * Photo reads are async and potentially slow on a large collection,
   * so we do them up-front in parallel and keep the HTML builder sync.
   *
   * Gallery is capped at 4 photos per firearm and each image is capped
   * on the CSS side at ~120px to keep the PDF size reasonable — a
   * 50-firearm report with high-res photos can otherwise balloon to
   * tens of megabytes and choke the share sheet.
   */
  async function preloadEmbeds(items: Firearm[]): Promise<Map<number, FirearmEmbed>> {
    const out = new Map<number, FirearmEmbed>();
    await Promise.all(items.map(async (f) => {
      const hero = await imageToDataUri(f.image_uri);
      // Pull gallery photos (if the multi-photo table has any for this
      // firearm) and cap at 4 for the PDF. Skip the file referenced by
      // image_uri — it's already shown as the hero.
      const photos = getFirearmPhotos(f.id);
      const unique = photos.filter(p => p.image_uri !== f.image_uri).slice(0, 4);
      const gallery: string[] = [];
      for (const p of unique) {
        const uri = await imageToDataUri(p.image_uri);
        if (uri) gallery.push(uri);
      }
      const accessories = getAccessoriesByFirearm(f.id);
      out.set(f.id, { heroDataUri: hero, galleryDataUris: gallery, accessories });
    }));
    return out;
  }

  // Primary action: generate a proper PDF via expo-print, then hand it to
  // expo-sharing so the native share sheet offers "Save to Files", "Mail",
  // AirDrop, etc. If PDF generation or sharing fails on the device we fall
  // back to the plain-text Share.share() path so the user is never stuck.
  async function handleSharePdf() {
    setLoading(true);
    try {
      const latest = getAllFirearms();
      setFirearms(latest);
      const embeds = await preloadEmbeds(latest);
      const html = buildReportHtml(latest, embeds);
      const { uri } = await Print.printToFileAsync({ html, base64: false });

      // Rename the generated file so the share sheet shows a meaningful
      // title/filename ("Iron Ledger Insurance 2026-04-14.pdf") rather
      // than expo-print's opaque tempfile name.
      let shareUri = uri;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const pretty = new File(Paths.cache, `Iron Ledger Insurance ${today}.pdf`);
        if (pretty.exists) pretty.delete();
        new File(uri).copy(pretty);
        shareUri = pretty.uri;
      } catch {
        // Rename is best-effort. If the filesystem copy fails we just
        // share the original tempfile — still a valid PDF.
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(shareUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Iron Ledger — Insurance Report',
          UTI: 'com.adobe.pdf',
        });
      } else {
        // Fallback: device doesn't support native sharing of files.
        await Share.share({
          title:   'Iron Ledger — Insurance Report',
          message: buildShareText(latest),
        });
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not generate the PDF.');
    } finally {
      setLoading(false);
    }
  }

  async function handleShareText() {
    setLoading(true);
    try {
      const latest = getAllFirearms();
      setFirearms(latest);
      await Share.share({
        title:   'Iron Ledger — Insurance Report',
        message: buildShareText(latest),
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not share report.');
    } finally {
      setLoading(false);
    }
  }

  // Deep-link / direct-nav safety: the dashboard tile is already wrapped in
  // runProGated, but a Lite user who reaches this route any other way
  // (deep link, history, future Recents list) sees a feature-matched
  // paywall stub instead of the generator itself.
  if (!ent.isPro) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.back}>
            <Text style={s.backTxt}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Insurance Report</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={s.proGate}>
          <Text style={s.proGateIcon}>📎</Text>
          <Text style={s.proGateTitle}>Insurance Export is Pro</Text>
          <Text style={s.proGateSub}>
            Generate a PDF, CSV, or encrypted archive with every detail your insurer needs —
            photos, serials, accessories, and valuations.
          </Text>
          <TouchableOpacity
            style={s.proGateCta}
            onPress={() => showPaywall({ mode: 'contextual', feature: 'insurance_export' })}
            activeOpacity={0.85}
          >
            <Text style={s.proGateCtaText}>See Pro Features</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Text style={s.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Insurance Report</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* summary card */}
        <View style={s.summaryCard}>
          <Text style={s.summaryLabel}>IRON LEDGER</Text>
          <Text style={s.summaryBrand}>Powered by RazorMP</Text>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.stat}>
              <Text style={s.statNum}>{firearms.length}</Text>
              <Text style={s.statLbl}>Firearms</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statNum}>{fmt(totalValue)}</Text>
              <Text style={s.statLbl}>Total Value</Text>
            </View>
          </View>
        </View>

        {/* export buttons — PDF primary, text secondary */}
        <TouchableOpacity style={s.shareBtn} onPress={handleSharePdf} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={s.shareTxt}>📄  Export PDF</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.textBtn} onPress={handleShareText} disabled={loading}>
          <Text style={s.textBtnTxt}>Share as Text</Text>
        </TouchableOpacity>
        <Text style={s.hint}>
          PDF saves or emails the full report. Text works anywhere — Mail, Messages, Notes.
        </Text>
        {/* firearm list */}
        {firearms.map((f) => {
          const name = f.nickname || `${f.make} ${f.model}`;
          const sub = f.nickname ? `${f.make} ${f.model}` : null;
          return (
            <View key={f.id} style={s.card}>
              <View style={s.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardName}>{name}</Text>
                  {sub ? <Text style={s.cardSub}>{sub}</Text> : null}
                </View>
                {f.current_value ? <Text style={s.cardValue}>{fmt(f.current_value)}</Text> : null}
              </View>
              <View style={s.cardRow}>
                <Text style={s.cardLbl}>Type</Text>
                <Text style={s.cardVal}>{f.type}{f.action_type ? ` · ${f.action_type}` : ''}</Text>
              </View>
              {f.trigger_type ? (
                <View style={s.cardRow}>
                  <Text style={s.cardLbl}>Trigger</Text>
                  <Text style={s.cardVal}>{f.trigger_type}</Text>
                </View>
              ) : null}
              <View style={s.cardRow}>
                <Text style={s.cardLbl}>Caliber</Text>
                <Text style={s.cardVal}>{f.caliber}</Text>
              </View>
              <View style={s.cardRow}>
                <Text style={s.cardLbl}>Serial #</Text>
                <Text style={s.cardVal}>{f.serial_number || '—'}</Text>
              </View>
              <View style={s.cardRow}>
                <Text style={s.cardLbl}>Condition</Text>
                <Text style={s.cardVal}>{f.condition_rating || '—'}</Text>
              </View>
              {f.storage_location ? (
                <View style={s.cardRow}>
                  <Text style={s.cardLbl}>Storage</Text>
                  <Text style={s.cardVal}>{f.storage_location}</Text>
                </View>
              ) : null}
              {f.purchase_price ? (
                <View style={s.cardRow}>
                  <Text style={s.cardLbl}>Purchase Price</Text>
                  <Text style={s.cardVal}>{fmt(f.purchase_price)}</Text>
                </View>
              ) : null}
              {f.purchased_from ? (
                <View style={s.cardRow}>
                  <Text style={s.cardLbl}>Purchased From</Text>
                  <Text style={s.cardVal}>{f.purchased_from}</Text>
                </View>
              ) : null}
              {f.dealer_city_state ? (
                <View style={s.cardRow}>
                  <Text style={s.cardLbl}>Dealer Location</Text>
                  <Text style={s.cardVal}>{f.dealer_city_state}</Text>
                </View>
              ) : null}
              {f.is_nfa ? (
                <View style={s.nfaBadge}>
                  <Text style={s.nfaBadgeText}>NFA</Text>
                  {f.atf_form_status ? <Text style={s.nfaStatus}>{f.atf_form_status}</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
  back:        { width: 60 },
  backTxt:     { color: '#c9a84c', fontSize: 17 },
  title:       { color: '#fff', fontSize: 20, fontWeight: '700' },
  proGate:     { flex: 1, alignItems: 'center', justifyContent: 'center',
                 paddingHorizontal: 32, paddingBottom: 60 },
  proGateIcon: { fontSize: 48, marginBottom: 16 },
  proGateTitle:{ color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  proGateSub:  { color: '#9C9C9C', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  proGateCta:  { backgroundColor: '#c9a84c', borderRadius: 12, paddingVertical: 14,
                 paddingHorizontal: 32 },
  proGateCtaText: { color: '#0D0D0D', fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  scroll:      { paddingHorizontal: 20 },
  summaryCard: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 24,
                 marginBottom: 20, borderWidth: 1, borderColor: '#c9a84c' },
  summaryLabel:{ color: '#c9a84c', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  summaryBrand:{ color: '#888', fontSize: 12, marginBottom: 16 },
  divider:     { height: 1, backgroundColor: '#333', marginBottom: 16 },
  row:         { flexDirection: 'row', justifyContent: 'space-around' },
  stat:        { alignItems: 'center' },
  statNum:     { color: '#fff', fontSize: 22, fontWeight: '700' },
  statLbl:     { color: '#888', fontSize: 12, marginTop: 4 },
  shareBtn:    { backgroundColor: '#c9a84c', borderRadius: 12, paddingVertical: 16,
                 alignItems: 'center', marginBottom: 8 },
  shareTxt:    { color: '#000', fontSize: 17, fontWeight: '700' },
  textBtn:     { borderRadius: 12, paddingVertical: 12, alignItems: 'center',
                 borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 10 },
  textBtnTxt:  { color: '#c9a84c', fontSize: 14, fontWeight: '600' },
  hint:        { color: '#555', fontSize: 12, textAlign: 'center', marginBottom: 24 },
  card:        { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16,
                 marginBottom: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  cardName:    { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  cardValue:   { color: '#c9a84c', fontSize: 16, fontWeight: '700' },
  cardSub:     { color: '#888', fontSize: 13, marginTop: 2 },
  cardRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  cardLbl:     { color: '#888', fontSize: 13 },
  cardVal:     { color: '#ccc', fontSize: 13 },
  nfaBadge:    { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10,
                 borderTopWidth: 1, borderTopColor: '#2a2a2a', gap: 8 },
  nfaBadgeText:{ color: '#c9a84c', fontSize: 11, fontWeight: '700', letterSpacing: 1,
                 backgroundColor: 'rgba(201,168,76,0.15)', paddingHorizontal: 8, paddingVertical: 3,
                 borderRadius: 4, overflow: 'hidden' },
  nfaStatus:   { color: '#888', fontSize: 12 },
});