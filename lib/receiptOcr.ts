// Receipt OCR — accepts an image URI and attempts to extract the vendor,
// purchase date, purchase price, and (optionally) the dealer city/state
// line so the user can one-tap-apply them into the add-firearm form.
//
// Mirrors the atfOcr.ts contract so the add-firearm call site feels
// identical. Ships in stub mode when ML Kit isn't wired into the build;
// the same `require` trick lets us upgrade to live OCR without changing
// any callers.
//
// Heuristics are tuned for US FFL / gun-shop receipts but degrade
// gracefully on generic retail receipts. When a field can't be parsed
// with high confidence, it is left null and the user is asked to fill
// it in manually — better than pre-filling with nonsense.

import {
  valueAfterLabel,
  sanitizeSerial,
  pickBestSerial,
  sanitizeCaliber,
  inferType,
  findBrand,
  extractCaliberToken,
} from './ocrUtils';

let TextRecognition: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-ml-kit/text-recognition');
  TextRecognition = mod.default ?? mod;
} catch {
  TextRecognition = null;
}

/** True once MLKit is wired up for real scans. Mirrors atfOcr.ocrLiveMode(). */
export const receiptOcrLiveMode = (): boolean => TextRecognition !== null;

export interface ReceiptExtracted {
  vendor: string | null;         // "Gunbusters LLC"
  dealerCityState: string | null; // "Austin, TX"
  purchaseDate: string | null;   // MM/DD/YYYY
  purchasePrice: string | null;  // "899.99" (no $)
  // --- Firearm identification (populated when the receipt lists the item) ---
  // These mirror the Form 4473 OCR fields so `applyReceiptExtraction` can
  // fill the identification section of add-firearm without a separate scan.
  // Any of these may be null if the receipt didn't include them.
  make: string | null;           // "Glock Inc"
  model: string | null;          // "G19 Gen5"
  serialNumber: string | null;   // "BKSX123"
  caliber: string | null;        // "9mm"
  type: string | null;           // Handgun · Rifle · Shotgun · ...
  rawText: string | null;
  source: 'mlkit' | 'stub';
}

const EMPTY: ReceiptExtracted = {
  vendor: null,
  dealerCityState: null,
  purchaseDate: null,
  purchasePrice: null,
  make: null,
  model: null,
  serialNumber: null,
  caliber: null,
  type: null,
  rawText: null,
  source: 'stub',
};

/** Convert a loose date to MM/DD/YYYY. Accepts /, -, or . separators.
 *  Handles both US-style (MM/DD/YYYY) and ISO (YYYY-MM-DD) formats. */
function normalizeUsDate(raw: string): string | null {
  const trimmed = raw.trim();
  // ISO format first: YYYY-MM-DD or YYYY/MM/DD.
  const iso = trimmed.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (iso) {
    const [, yy, mm, dd] = iso;
    return buildUsDate(mm, dd, yy);
  }
  // US format: MM/DD/YYYY (or 2-digit year).
  const us = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (us) {
    const [, mm, dd, yyRaw] = us;
    const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
    return buildUsDate(mm, dd, yy);
  }
  return null;
}

/** Validate & format a US-style date. Returns null if out of range. */
function buildUsDate(mm: string, dd: string, yyyy: string): string | null {
  const mmN = parseInt(mm, 10);
  const ddN = parseInt(dd, 10);
  const yyN = parseInt(yyyy, 10);
  if (mmN < 1 || mmN > 12 || ddN < 1 || ddN > 31) return null;
  // Reject dates more than 1 year in the future or before 1990 — almost
  // certainly an OCR misread (serial number, SKU, etc.).
  const now = new Date();
  if (yyN < 1990 || yyN > now.getFullYear() + 1) return null;
  return `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}/${yyyy}`;
}

/** US state abbreviations — used to spot a "City, ST" line. */
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/** Price parsed from a line of text. Returns a string "123.45" or null. */
function parsePriceOnLine(line: string): string | null {
  // Normalise OCR artefacts before regex matching:
  //   "$1390. 08"  → "$1390.08"   (MLKit sometimes inserts a space after `.`)
  //   "$1, 287.11" → "$1,287.11"  (and after `,` too)
  const normalized = line
    .replace(/(\d)\.\s+(\d{2})\b/g, '$1.$2')
    .replace(/(\d),\s+(\d{3})/g, '$1,$2');
  // Require a decimal so raw integers (SKUs, qty, credit-card digits) don't
  // accidentally parse as prices. Match the LONGEST leading-digit run so
  // "1287.11" captures as a single token (not "287.11" via backtracking).
  const matches = [...normalized.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})\b/g)];
  if (matches.length === 0) return null;
  // Prefer the RIGHTMOST currency-looking token (amount column on receipts).
  const raw = matches[matches.length - 1][1].replace(/,/g, '');
  if (!/^\d+\.\d{2}$/.test(raw)) return null;
  const n = parseFloat(raw);
  if (!isFinite(n) || n <= 0) return null;
  return raw;
}

/** Heuristic regex extraction from raw OCR text. */
function extractFromText(text: string): Omit<ReceiptExtracted, 'rawText' | 'source'> {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // --- Price ------------------------------------------------------------
  // Walk lines looking for TOTAL / AMOUNT DUE / GRAND TOTAL, skipping
  // obvious distractors (subtotal, tax, tip, change, tendered).
  let purchasePrice: string | null = null;
  const distractor = /\b(sub\s*total|tax|tip|change|tender|cash|balance|due)\b/i;
  const totalCue = /\b(grand\s*total|total|amount\s*due|amount\s*charged|charge\s*total|balance\s*due)\b/i;

  // Stop-words that signal we've walked past the totals block into the
  // payment-method section (where we'd start picking up credit-card
  // amounts or change-due which aren't the item total).
  const paymentCue = /\b(credit\s*card|debit\s*card|visa|mastercard|amex|american\s*express|discover|cash\s*tendered|change\s*due|tender|card\s*#|account|auth|approval|ref\s*#)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!totalCue.test(line)) continue;
    if (distractor.test(line) && !/grand\s*total|amount\s*due|charge\s*total/i.test(line)) continue;
    // Case 1 — total on the SAME line as the label ("Total  $394.19").
    const same = parsePriceOnLine(line);
    if (same) { purchasePrice = same; break; }
    // Case 2 — two-column layout: the label sits in the left column and
    // the value sits in a price-only line further down in the right
    // column. Walk forward up to ~30 lines collecting prices, stopping
    // when we hit a payment-method line. The LAST price in that run is
    // the total (it sits after subtotal/discount/tax in the right column).
    let lastPrice: string | null = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
      const nextLine = lines[j];
      if (paymentCue.test(nextLine)) break;
      const p = parsePriceOnLine(nextLine);
      if (p) lastPrice = p;
    }
    if (lastPrice) { purchasePrice = lastPrice; break; }
  }

  // Sanity floor — real firearm receipts never total under $25. If the
  // "Total" line parse produced something suspiciously small (OCR noise
  // swallowed leading digits, picked up a line like "$02.00" that isn't
  // actually the total), discard it and let the fallback below take over.
  if (purchasePrice && parseFloat(purchasePrice) < 25) {
    purchasePrice = null;
  }

  // Fallback: pick the largest currency-looking amount on the whole
  // receipt. Works reasonably well for receipts without explicit total
  // cues (e.g., a handwritten invoice) AND when the Total cue misfired.
  if (!purchasePrice) {
    let max = 0;
    for (const line of lines) {
      if (distractor.test(line)) continue;
      const p = parsePriceOnLine(line);
      if (!p) continue;
      const n = parseFloat(p);
      if (n > max) { max = n; purchasePrice = p; }
    }
  }

  // --- Date -------------------------------------------------------------
  // First normalizable date on the receipt wins. Most receipts print the
  // transaction date in the header; even if not, the first date is
  // usually the purchase date (return windows, warranty expiry come later).
  let purchaseDate: string | null = null;
  for (const line of lines) {
    // Try US-style (MM/DD/YYYY) first, then ISO (YYYY-MM-DD) — OCR often
    // misreads an MM digit ("07" → "97") but the credit-card block
    // usually includes a cleaner ISO-format transaction date.
    const us = line.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
    if (us) {
      const normalized = normalizeUsDate(us[1]);
      if (normalized) { purchaseDate = normalized; break; }
    }
    // Tolerate OCR-inserted whitespace around the separators:
    // "2025-12 -02" shows up as "2025-12 -02" in raw text.
    const iso = line.match(/\b(\d{4})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\b/);
    if (iso) {
      const normalized = normalizeUsDate(`${iso[1]}-${iso[2]}-${iso[3]}`);
      if (normalized) { purchaseDate = normalized; break; }
    }
  }

  // --- Vendor -----------------------------------------------------------
  // Vendor extraction is noisy — MLKit often mangles logos and decorative
  // text in the header block ("ATATDIS" instead of "Scottsdale Tactical").
  // Strategy: prefer lines in the first ~10 that contain strong FFL-name
  // signals (LLC, Inc, Tactical, Firearms, Gun, Arms, Armory, Outfitters,
  // Shop, Sporting, Trading, Gunworks, Rifles, Pistols). If none found,
  // fall back to the "first legible line" heuristic.
  const FFL_KEYWORDS = /\b(llc|l\.l\.c\.|inc|incorporated|co\.?|corp\.?|ltd|company|tactical|firearms?|gun(?:s|works|shop|smith)?|arms?|armory|armoury|outfitters?|sporting|trading|pawn|shooters?|range|rifles?|pistols?|ammo)\b/i;
  const isJunkForVendor = (s: string): boolean => {
    if (/\d{3}[-\s.]\d{3}[-\s.]\d{4}/.test(s)) return true;   // phone
    if (/\b\d{5}(-\d{4})?\b/.test(s)) return true;            // zip
    if (/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(s)) return true; // date
    if (/\$\s?\d/.test(s)) return true;                       // price
    if (/@/.test(s)) return true;                             // email
    if (/^www\.|\.com\b|https?:/i.test(s)) return true;       // URL
    const letters = (s.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3) return true;
    return false;
  };

  let vendor: string | null = null;
  // Pass A — strong FFL keyword match in top 10 lines.
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const candidate = lines[i];
    if (isJunkForVendor(candidate)) continue;
    if (!FFL_KEYWORDS.test(candidate)) continue;
    vendor = candidate.replace(/[.,;:]+$/, '').slice(0, 60).trim();
    break;
  }
  // Pass B — fallback: first legible line in top 3.
  if (!vendor) {
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const candidate = lines[i];
      if (isJunkForVendor(candidate)) continue;
      // Extra guard: reject lines that look like OCR gibberish (too many
      // consecutive consonants or no vowels at all).
      const lower = candidate.toLowerCase();
      if (!/[aeiou]/.test(lower)) continue;
      vendor = candidate.replace(/[.,;:]+$/, '').slice(0, 60).trim();
      break;
    }
  }

  // --- City, State ------------------------------------------------------
  // Look for a "City, ST" pattern in the first ~8 lines (receipt header).
  let dealerCityState: string | null = null;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const m = lines[i].match(/([A-Za-z][A-Za-z .'-]+?),\s*([A-Z]{2})\b/);
    if (!m) continue;
    const state = m[2];
    if (!US_STATES.has(state)) continue;
    const city = m[1].trim();
    if (city.length < 2 || city.length > 40) continue;
    dealerCityState = `${city}, ${state}`;
    break;
  }

  // --- Firearm identification ------------------------------------------
  // Most FFL receipts include the make/model/serial/caliber either as a
  // labeled block ("SN:", "Serial #:", "Mfr:", etc.) or as a single
  // itemized line ("GLOCK 19 GEN5 9MM SN BKSX123   $599.99"). Try labels
  // first — they're much more reliable — then fall back to line parsing
  // using the brand-token dictionary.
  const ident = extractIdentification(lines, text);

  return {
    vendor,
    dealerCityState,
    purchaseDate,
    purchasePrice,
    make: ident.make,
    model: ident.model,
    serialNumber: ident.serialNumber,
    caliber: ident.caliber,
    type: ident.type,
  };
}

interface Identification {
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  caliber: string | null;
  type: string | null;
}

/**
 * Extract firearm identification fields from an FFL receipt. Receipts
 * aren't as structured as a 4473, so we use two passes:
 *
 *   1. Labeled-block pass — pulls "Mfr: Glock", "Serial #: BKSX123",
 *      "Caliber: 9mm", etc.
 *   2. Itemized-line pass — finds a line that contains a known brand
 *      token and tries to pick apart model / caliber / serial from it.
 *
 * Fields from pass 1 take precedence over pass 2 when both fire — the
 * labeled form is almost always cleaner.
 */
function extractIdentification(lines: string[], text: string): Identification {
  // --- Pass 1: label matching -----------------------------------------
  const makeLabel = valueAfterLabel(lines, /\b(?:manufacturer|mfr|mfg|make)\b/i);
  const modelLabel = valueAfterLabel(lines, /\bmodel\b/i);
  const serialLabel = valueAfterLabel(lines, /\b(?:serial\s*(?:no\.?|number|#)?|sn\b|ser\s*#?)/i);
  const caliberLabel = valueAfterLabel(lines, /\b(caliber|cal\.?|gauge|ga\.?)\b/i);

  let make = cleanMake(makeLabel);
  let model = cleanModel(modelLabel);
  // Use pickBestSerial so combined columns like "UPC / Serial #" →
  // "860007987373 / HP250149" correctly yield "HP250149" instead of being
  // rejected wholesale for containing a slash.
  let serialNumber = pickBestSerial(serialLabel);
  let caliber = sanitizeCaliber(caliberLabel) ?? extractCaliberToken(caliberLabel ?? '');

  // --- Pass 2: itemized line fallback ---------------------------------
  // Only runs for fields that pass 1 couldn't fill. Scans every line for
  // a brand token; the first hit that yields plausible data wins.
  if (!make || !model || !serialNumber || !caliber) {
    for (const line of lines) {
      const brand = findBrand(line);
      if (!brand) continue;

      // If we don't already have a make, use this brand.
      if (!make) make = brand;

      // Strip the brand from the line to look at whatever comes after.
      const brandRe = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}\\b`, 'i');
      const after = line.replace(brandRe, '').trim();

      // Caliber — any caliber-ish token in the remainder.
      if (!caliber) {
        const cal = extractCaliberToken(after);
        if (cal) caliber = sanitizeCaliber(cal) ?? cal;
      }

      // Serial — prefer an explicit "SN" / "Serial" cue on the same line.
      if (!serialNumber) {
        const snMatch = after.match(/(?:\bsn\b|\bserial\b|#)\s*[:#]?\s*([A-Z0-9-]{3,20})/i);
        if (snMatch) serialNumber = sanitizeSerial(snMatch[1]);
      }

      // Model — whatever alphanumeric chunk sits between the brand and the
      // first price/caliber/serial marker. Very rough but usually correct.
      if (!model) {
        // Drop the price column (anything after the first $ or a trailing
        // dollar amount) and any caliber/serial tokens.
        let guess = after
          .replace(/\$\s*\d[\d,]*(?:\.\d{2})?.*$/, '')
          .replace(/(?:\bsn\b|\bserial\b)\s*[:#]?\s*[A-Z0-9-]{3,20}/i, '')
          .replace(extractCaliberToken(after) ?? '', '')
          .replace(/\s{2,}/g, ' ')
          .replace(/[-:#,]+$/, '')
          .trim();
        if (guess.length >= 2 && guess.length <= 40) {
          model = cleanModel(guess);
        }
      }

      if (make && model && serialNumber && caliber) break;
    }
  }

  // --- Pass 3: tabular itemized row (no brand match) ------------------
  // Many FFL receipts use an itemized table with columns like
  //   "Item   UPC / Serial #   Qty   Price"
  // and a data row like
  //   "Fusion XP Comp   7890049493188 / TK670-25EE05029   1   $1287.11"
  // Neither a brand token nor a "Serial:" label is present, so Passes 1
  // and 2 miss everything. This pass looks for lines that contain BOTH
  // a price-like token AND a mixed alphanumeric token (letters + digits),
  // which is a strong signal for an itemized firearm row.
  if (!serialNumber || !model) {
    for (const line of lines) {
      // Needs a price to qualify as an itemized row.
      if (!/\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\b/.test(line)) continue;
      // Skip obvious non-item rows (subtotal/tax/total/change etc.).
      if (/\b(sub\s*total|total|tax|change|balance|due|tender|cash|card|visa|mastercard|amex|discover|credit|debit)\b/i.test(line)) continue;

      // Grab alphanumeric-dash tokens. A serial has BOTH letters and
      // digits (distinguishes it from a 12–14 digit UPC/barcode).
      const tokens = (line.match(/\b[A-Z0-9-]{5,20}\b/gi) ?? [])
        .map(t => t.toUpperCase());
      // Require ≥2 digits. Real firearm serials are digit-heavy; a token
      // like "SABA8" (1 digit) is almost always a product-name fragment,
      // not a serial.
      const serialCandidate = tokens.find(t => {
        if (!/[A-Z]/.test(t)) return false;
        if (/^(USD|QTY|UPC|SKU|TAG|SN)$/.test(t)) return false;
        const digitCount = (t.match(/\d/g) ?? []).length;
        return digitCount >= 2;
      });

      if (!serialNumber && serialCandidate) {
        const cleaned = sanitizeSerial(serialCandidate);
        if (cleaned) serialNumber = cleaned;
      }

      // Model — everything on the line that looks like a product name.
      // Strategy: drop the price column, drop any UPC/serial tokens,
      // keep the leading alphabetic run.
      //
      // IMPORTANT: only try to pull a model out of this line if we ALSO
      // found a serial token on it. A "price-bearing line without a
      // serial" is almost always noise (tax, discount, notes, etc.) and
      // produces garbage models like "Notes: 1" or "Qty: 1 Each".
      if (!model && serialCandidate) {
        let guess = line
          .replace(/\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}.*$/, '') // trim at first price
          .replace(/\b\d{10,14}\b/g, '')                      // strip UPCs
          .replace(/\b[A-Z0-9-]{5,20}\b/gi, t => {            // strip serials
            return /[A-Z]/i.test(t) && /\d/.test(t) ? '' : t;
          })
          .replace(/\s*\/\s*/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .replace(/^[\s-]+|[\s\-:#,]+$/g, '')
          .trim();
        // Must start with a letter and look like a product name.
        if (/^[A-Za-z]/.test(guess) && guess.length >= 3 && guess.length <= 40) {
          model = cleanModel(guess);
        }
      }

      // Caliber — check the line for a caliber token we might have missed.
      if (!caliber) {
        const cal = extractCaliberToken(line);
        if (cal) caliber = sanitizeCaliber(cal) ?? cal;
      }

      if (serialNumber && model) break;
    }
  }

  // --- Type inference -------------------------------------------------
  // Receipts sometimes say "PISTOL" or "RIFLE" on the line item; fall
  // back to scanning the whole document so "Pistol — Glock 19" works too.
  const type = inferType(text);

  return { make, model, serialNumber, caliber, type };
}

/** Manufacturer names sometimes come with trailing "INC" / "LLC" cruft. */
function cleanMake(raw: string | null): string | null {
  if (!raw) return null;
  let v = raw.replace(/[.,;:]+$/, '').trim();
  if (v.length < 2 || v.length > 40) return null;
  return v;
}

/** Model strings are free-text on receipts; strip trailing punctuation. */
function cleanModel(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/[.,;:]+$/, '').trim();
  if (v.length < 1 || v.length > 40) return null;
  return v;
}

/** Try real OCR; fall back to a deterministic mock if MLKit isn't present. */
export async function scanReceipt(imageUri: string): Promise<ReceiptExtracted> {
  if (TextRecognition && typeof TextRecognition.recognize === 'function') {
    try {
      const result = await TextRecognition.recognize(imageUri);
      const raw: string = typeof result?.text === 'string' ? result.text : '';
      const extracted = extractFromText(raw);
      return { ...EMPTY, ...extracted, rawText: raw, source: 'mlkit' };
    } catch (e) {
      console.warn('[receiptOcr] MLKit failed, falling back to stub', e);
    }
  }
  // Stub — sample data so the flow is testable on devices where MLKit
  // isn't available (Expo Go, simulator without the native build).
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return {
    vendor: 'Sample Gun Shop LLC',
    dealerCityState: 'Austin, TX',
    purchaseDate: `${mm}/${dd}/${today.getFullYear()}`,
    purchasePrice: '899.99',
    make: 'Glock',
    model: 'G19 Gen5',
    serialNumber: 'STUB' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
    caliber: '9mm',
    type: 'Handgun',
    rawText: '[Stub] OCR unavailable — returning sample data so the flow is testable.',
    source: 'stub',
  };
}
