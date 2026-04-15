// ATF form OCR — accepts an image URI and attempts to extract the form
// type, control number, and key dates.
//
// SHIPS IN STUB MODE. On-device text recognition via @react-native-ml-kit/text-recognition
// isn't available in the Expo Go runtime, so this module resolves the dep
// lazily through `require` and falls back to a deterministic mock parse
// when the native module isn't installed. Once the dev runs
// `expo install @react-native-ml-kit/text-recognition` and rebuilds, the
// real pipeline takes over automatically — no call-site changes needed.

import {
  valueAfterLabel, pickBestSerial, sanitizeCaliber, findBrand, extractCaliberToken,
} from './ocrUtils';

let TextRecognition: any = null;
try {
  // Wrapped so a missing install just leaves TextRecognition = null.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-ml-kit/text-recognition');
  TextRecognition = mod.default ?? mod;
} catch {
  TextRecognition = null;
}

/** True once MLKit is wired up for real scans. */
export const ocrLiveMode = (): boolean => TextRecognition !== null;

export type AtfFormType = 'Form 1 (Self-Manufactured)' | 'Form 4 (Transfer/Purchase)' | 'Form 3 (SOT/Dealer)';

export interface AtfExtracted {
  formType: AtfFormType | null;
  controlNumber: string | null;
  dateFiled: string | null;      // MM/DD/YYYY
  dateApproved: string | null;   // MM/DD/YYYY
  itemCategory: string | null;   // Suppressor, SBR, etc.
  taxPaid: string | null;        // '200.00' | '5.00'
  // Description-of-firearm block fields on Form 1 / Form 4.
  make: string | null;
  model: string | null;
  caliber: string | null;
  serialNumber: string | null;
  rawText: string | null;        // full recognized text for debugging
  source: 'mlkit' | 'stub';
}

const EMPTY: AtfExtracted = {
  formType: null,
  controlNumber: null,
  dateFiled: null,
  dateApproved: null,
  itemCategory: null,
  taxPaid: null,
  make: null,
  model: null,
  caliber: null,
  serialNumber: null,
  rawText: null,
  source: 'stub',
};

/** Convert a loose date to MM/DD/YYYY. */
function normalizeUsDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (!m) return null;
  const [, mm, dd, yyRaw] = m;
  const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  return `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}/${yy}`;
}

/** Heuristic regex extraction from raw OCR text. */
function extractFromText(text: string): Omit<AtfExtracted, 'rawText' | 'source'> {
  const lc = text.toLowerCase();

  // Form type — the ATF prints the form number prominently in the header.
  let formType: AtfFormType | null = null;
  if (/form\s*1\b|application\s+to\s+make\b/i.test(text)) formType = 'Form 1 (Self-Manufactured)';
  else if (/form\s*4\b|application\s+for\s+tax\s+paid\s+transfer/i.test(text)) formType = 'Form 4 (Transfer/Purchase)';
  else if (/form\s*3\b|tax[- ]exempt\s+transfer/i.test(text)) formType = 'Form 3 (SOT/Dealer)';

  // Control number — ATF uses either a numeric eForm id or an alphanumeric
  // "Control Number" string. Allow both.
  let controlNumber: string | null = null;
  const ctrlMatch =
    text.match(/control\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9-]{6,})/i) ??
    text.match(/transaction\s*(?:id|no\.?)\s*[:\-]?\s*([A-Z0-9-]{6,})/i);
  if (ctrlMatch) controlNumber = ctrlMatch[1].trim();

  // Dates — grab the first two MM/DD/YYYY-looking strings.
  const dates = text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/g) ?? [];
  const normalized = dates.map(normalizeUsDate).filter((x): x is string => x !== null);
  const dateFiled = normalized[0] ?? null;
  // Only treat a second date as "approved" if we also see that word nearby.
  const dateApproved = /approv/i.test(text) && normalized[1] ? normalized[1] : null;

  // Category — match against ATF's standard item labels.
  const CATEGORIES = ['Suppressor', 'Silencer', 'SBR', 'SBS', 'Machine Gun', 'MG', 'AOW', 'Destructive Device'];
  let itemCategory: string | null = null;
  for (const c of CATEGORIES) {
    if (lc.includes(c.toLowerCase())) {
      // Normalize "Silencer" → "Suppressor", "Machine Gun" → "MG".
      itemCategory = c === 'Silencer' ? 'Suppressor' : c === 'Machine Gun' ? 'MG' : c;
      break;
    }
  }

  // Tax paid — $200 (stamp) or $5 (AOW).
  let taxPaid: string | null = null;
  if (/\$?\s?200\.?00?\b/.test(text)) taxPaid = '200.00';
  else if (/\$?\s?5\.?00\b/.test(text)) taxPaid = '5.00';

  // Description-of-firearm block. Form 4 box 4 uses labeled columns:
  //   4a Name and Location of Manufacturer…
  //   4b Type of Firearm   4c Caliber/Gauge
  //   4d Model             4e Barrel Length   4f Overall Length
  //   4g Serial Number
  // Form 1 uses a near-identical box 4 layout. Label matching handles
  // both label-on-same-line and label-on-its-own-line layouts via
  // valueAfterLabel from ocrUtils.
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const makeRaw = valueAfterLabel(
    lines,
    /\b(?:4a\.?\s*)?(?:name\s+and\s+location\s+of\s+)?(?:manufacturer|importer|mfr|mfg)\b/i,
  );
  // The "Name and Location of Manufacturer" column often contains both
  // the name and a city/state line — take the first token-ish brand
  // hit if one matches the dictionary; otherwise take the first line
  // and trim trailing address bits.
  let make: string | null = null;
  if (makeRaw) {
    const brand = findBrand(makeRaw);
    if (brand) make = brand;
    else {
      // Drop trailing address fragments (city, state, zip).
      const cleaned = makeRaw.split(/,|\s{2,}|\n/)[0].trim();
      if (cleaned.length >= 2 && cleaned.length <= 40) make = cleaned;
    }
  }
  // Fallback — sometimes the manufacturer label isn't captured cleanly
  // but the form body still contains a brand name we know about.
  if (!make) make = findBrand(text);

  const modelRaw = valueAfterLabel(
    lines,
    /\b(?:4d\.?\s*)?model\b/i,
  );
  const model = modelRaw && modelRaw.length <= 40 ? modelRaw : null;

  const caliberRaw = valueAfterLabel(
    lines,
    /\b(?:4c\.?\s*)?(?:caliber|gauge|cal\b|cal\/gauge|caliber\/gauge)\b/i,
  );
  // Prefer the labeled column; fall back to a free-form token search
  // across the whole text so a Form 4 with noisy column OCR still
  // yields something.
  const caliber =
    sanitizeCaliber(caliberRaw) ??
    extractCaliberToken(text);

  const serialRaw = valueAfterLabel(
    lines,
    /\b(?:4g\.?\s*)?serial\s*(?:number|no\.?|#)?\b/i,
  );
  const serialNumber = pickBestSerial(serialRaw);

  return {
    formType, controlNumber, dateFiled, dateApproved, itemCategory, taxPaid,
    make, model, caliber, serialNumber,
  };
}

/** Try real OCR; fall back to a deterministic mock if MLKit isn't present. */
export async function scanAtfForm(imageUri: string): Promise<AtfExtracted> {
  if (TextRecognition && typeof TextRecognition.recognize === 'function') {
    try {
      const result = await TextRecognition.recognize(imageUri);
      const raw: string = typeof result?.text === 'string' ? result.text : '';
      const extracted = extractFromText(raw);
      return { ...EMPTY, ...extracted, rawText: raw, source: 'mlkit' };
    } catch (e) {
      console.warn('[atfOcr] MLKit failed, falling back to stub', e);
    }
  }
  // Stub — returns a sample extraction so the UI flow is testable in dev.
  // The user can accept, reject, or edit the fields before saving.
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return {
    formType: 'Form 4 (Transfer/Purchase)',
    controlNumber: 'SAMPLE-OCR-' + Math.floor(Math.random() * 1e6).toString().padStart(6, '0'),
    dateFiled: `${mm}/${dd}/${today.getFullYear()}`,
    dateApproved: null,
    itemCategory: 'Suppressor',
    taxPaid: '200.00',
    make: 'SilencerCo',
    model: 'Omega 36M',
    caliber: '.30',
    serialNumber: 'SAMPLE-SN-' + Math.floor(Math.random() * 1e5).toString().padStart(5, '0'),
    rawText: '[Stub] OCR unavailable — returning sample data so the flow is testable.',
    source: 'stub',
  };
}
