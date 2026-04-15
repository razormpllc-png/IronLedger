// 4473 OCR — accepts an image URI and attempts to extract the firearm
// description fields from Section B of ATF Form 4473 (Firearms
// Transaction Record): Manufacturer, Model, Serial Number, Type, and
// Caliber / Gauge. Auto-fills the add-firearm form so a user can
// onboard a newly-purchased firearm by snapping a photo of their copy
// of the transfer paperwork.
//
// Mirrors lib/atfOcr.ts and lib/receiptOcr.ts — same stub fallback,
// same `scanXxx(uri) -> Extracted` contract, same lazy MLKit require.

import {
  valueAfterLabel,
  sanitizeSerial,
  sanitizeCaliber,
  inferType,
} from './ocrUtils';

let TextRecognition: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-ml-kit/text-recognition');
  TextRecognition = mod.default ?? mod;
} catch {
  TextRecognition = null;
}

/** True once MLKit is wired up for real scans. */
export const form4473OcrLiveMode = (): boolean => TextRecognition !== null;

export interface Form4473Extracted {
  make: string | null;         // "Glock Inc" / "SIG Sauer"
  model: string | null;        // "G19 Gen5"
  serialNumber: string | null; // "BKSX123"
  type: string | null;         // Handgun | Rifle | Shotgun | Other (mapped)
  caliber: string | null;      // "9mm", ".223 Rem"
  rawText: string | null;
  source: 'mlkit' | 'stub';
}

const EMPTY: Form4473Extracted = {
  make: null,
  model: null,
  serialNumber: null,
  type: null,
  caliber: null,
  rawText: null,
  source: 'stub',
};

/** Heuristic regex extraction from raw OCR text. */
function extractFromText(text: string): Omit<Form4473Extracted, 'rawText' | 'source'> {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // --- Manufacturer / Make ----------------------------------------------
  // 4473 Section B/D field label is "Manufacturer and/or Importer".
  const make = valueAfterLabel(lines, /manufacturer(?:\s*and\/or\s*importer)?/i);

  // --- Model ------------------------------------------------------------
  const model = valueAfterLabel(lines, /\bmodel\b/i);

  // --- Serial Number ----------------------------------------------------
  const serialRaw = valueAfterLabel(lines, /serial\s*(?:no\.?|number|#)?/i);
  const serialNumber = sanitizeSerial(serialRaw);

  // --- Caliber / Gauge --------------------------------------------------
  const caliberRaw = valueAfterLabel(lines, /\b(caliber|gauge)\b/i);
  const caliber = sanitizeCaliber(caliberRaw);

  // --- Type -------------------------------------------------------------
  // Scan the whole document for firearm-type keywords (checkbox fields
  // don't have a label/value pair — the keyword itself is the signal).
  const type = inferType(text);

  return { make, model, serialNumber, type, caliber };
}

/** Try real OCR; fall back to a deterministic mock if MLKit isn't present. */
export async function scan4473Form(imageUri: string): Promise<Form4473Extracted> {
  if (TextRecognition && typeof TextRecognition.recognize === 'function') {
    try {
      const result = await TextRecognition.recognize(imageUri);
      const raw: string = typeof result?.text === 'string' ? result.text : '';
      const extracted = extractFromText(raw);
      return { ...EMPTY, ...extracted, rawText: raw, source: 'mlkit' };
    } catch (e) {
      console.warn('[form4473Ocr] MLKit failed, falling back to stub', e);
    }
  }
  // Stub — sample data so the flow is testable on devices where MLKit
  // isn't available (Expo Go, simulator without the native build).
  return {
    make: 'Glock Inc',
    model: 'G19 Gen5',
    serialNumber: 'SAMPLE' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
    type: 'Handgun',
    caliber: '9mm',
    rawText: '[Stub] OCR unavailable — returning sample data so the flow is testable.',
    source: 'stub',
  };
}
