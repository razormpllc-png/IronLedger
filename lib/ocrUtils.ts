// Shared OCR helpers used by both lib/receiptOcr.ts and lib/form4473Ocr.ts.
// Extracted so the two scanners stay in sync on label-matching semantics,
// serial/caliber sanitisation, and firearm-type mapping. If you add a
// brand to BRAND_TOKENS or a new type keyword to TYPE_MAP, both scanners
// pick it up automatically.

/**
 * Pull the value that follows a labeled field on a receipt-style line.
 * Handles three common OCR layouts:
 *   "Manufacturer: Glock Inc"
 *   "Manufacturer  Glock Inc"
 *   "Manufacturer"   (value on the NEXT non-empty line)
 *
 * Returns null when nothing plausible follows the label.
 *
 * The `skipNeighborLabel` regex lets callers avoid swallowing an adjacent
 * column label when falling through to the next line (e.g. after
 * "Manufacturer", the next line might be "Model" — we want to skip that
 * and keep scanning rather than return "Model" as the manufacturer value).
 */
export function valueAfterLabel(
  lines: string[],
  labelRe: RegExp,
  skipNeighborLabel: RegExp = /^(manufacturer|importer|model|serial|caliber|gauge|type|country|mfr|mfg|sn|cal)/i,
): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(labelRe);
    if (!m) continue;
    // Prefer same-line content after the match.
    const tail = line.slice(m.index! + m[0].length).replace(/^[\s:–—#-]+/, '').trim();
    if (tail && tail.length >= 1 && tail.length <= 60) {
      return tail;
    }
    // Fall back to next non-empty line, skipping labels that belong to
    // neighbouring columns.
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (skipNeighborLabel.test(next)) continue;
      if (next.length > 60) return null;
      return next;
    }
    return null;
  }
  return null;
}

/** Serial numbers are usually alphanumeric, 3–20 chars, no spaces. */
export function sanitizeSerial(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, '').replace(/[.,;:]+$/, '').toUpperCase();
  if (!/^[A-Z0-9-]{3,20}$/.test(cleaned)) return null;
  // Reject obvious non-serials (all digits short enough to be a qty, all same
  // char, etc.) to cut down on false positives from column numbers.
  if (/^\d{1,2}$/.test(cleaned)) return null;
  if (/^(.)\1+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Pick the best serial candidate from a raw label value. Handles combined
 * columns like "UPC / Serial #" where the raw is "860007987373 / HP250149":
 * splits on common separators, rejects pure-digit UPC-like tokens (UPCs are
 * 12–14 digits, no letters), and prefers tokens with letter+digit mix.
 */
export function pickBestSerial(raw: string | null): string | null {
  if (!raw) return null;
  // Split on slash, pipe, comma, or runs of whitespace.
  const parts = raw.split(/[\s\/,|]+/).map(s => s.trim()).filter(Boolean);
  // First pass — prefer mixed letter+digit tokens with ≥2 digits.
  for (const p of parts) {
    const s = sanitizeSerial(p);
    if (!s) continue;
    const digitCount = (s.match(/\d/g) ?? []).length;
    const letterCount = (s.match(/[A-Z]/g) ?? []).length;
    if (letterCount >= 1 && digitCount >= 2) return s;
  }
  // Second pass — any token that sanitizes cleanly.
  for (const p of parts) {
    const s = sanitizeSerial(p);
    if (s) return s;
  }
  // Last resort — try the whole string (handles "TK670-25E05029" unchanged).
  return sanitizeSerial(raw);
}

/** Caliber strings vary widely; normalise obvious OCR artefacts. */
export function sanitizeCaliber(raw: string | null): string | null {
  if (!raw) return null;
  // Trim to the first comma or slash — "9mm, Luger" / "9mm / 9x19".
  const primary = raw.split(/[,\/]/)[0].trim();
  if (primary.length < 2 || primary.length > 24) return null;
  // Every real caliber contains a digit (9mm, .223, 12ga, 6.5 Creedmoor,
  // .45 ACP, etc.). Rejects false positives like "LLC", "MAG POUCH",
  // "NEW", "USED" that sometimes land in a caliber column.
  if (!/\d/.test(primary)) return null;
  return primary;
}

/**
 * Firearm-type keywords map to the in-app TYPES chip set:
 * Handgun · Rifle · Shotgun · PDW · PCC · Other.
 */
export const TYPE_MAP: Array<[RegExp, string]> = [
  [/\bpistol\b/i, 'Handgun'],
  [/\brevolver\b/i, 'Handgun'],
  [/\bhandgun\b/i, 'Handgun'],
  [/\brifle\b/i, 'Rifle'],
  [/\bshotgun\b/i, 'Shotgun'],
  [/\bpcc\b/i, 'PCC'],
  [/\bpdw\b/i, 'PDW'],
  [/\breceiver\b/i, 'Other'],
  [/\bframe\b/i, 'Other'],
  [/\bany\s*other\s*weapon\b|\baow\b/i, 'Other'],
];

export function inferType(text: string): string | null {
  for (const [re, label] of TYPE_MAP) {
    if (re.test(text)) return label;
  }
  return null;
}

/**
 * Known firearm makers. Matched as whole tokens, case-insensitive.
 * Order matters — longer multi-word names should come before prefixes
 * that would otherwise swallow them ("Smith & Wesson" before "Smith").
 * Stored with their canonical display form; the match is case-insensitive.
 */
export const BRAND_TOKENS: string[] = [
  // Multi-word first (match greedily).
  'Smith & Wesson',
  'Daniel Defense',
  'Rock River',
  'Palmetto State',
  'Aero Precision',
  'Wilson Combat',
  'Nighthawk Custom',
  'Les Baer',
  'Barrett Firearms',
  'Henry Repeating',
  'SIG Sauer', 'Sig Sauer',
  'Heckler & Koch',
  'FN Herstal',
  'Fusion Firearms',
  'Jacob Grey',

  // Single-token brands.
  'Glock',
  'SIG', 'Sig',
  'Beretta',
  'CZ',
  'FN',
  'HK', 'H&K',
  'Colt',
  'Ruger',
  'Springfield',
  'Kimber',
  'Walther',
  'Taurus',
  'Canik',
  'Mossberg',
  'Remington',
  'Winchester',
  'Henry',
  'Savage',
  'Tikka',
  'Bergara',
  'Sako',
  'BCM',
  'LWRC',
  'Palmetto',
  'PSA',
  'Noveske',
  'Geissele',
  'Stag',
  'Diamondback',
  'Kel-Tec', 'Keltec',
  'Hi-Point',
  'Browning',
  'Benelli',
  'Barrett',
  'IWI',
  'Arsenal',
  'Zastava',
  'Century',
  'Anderson',
  'Spikes',
  'Radical',
  'Franchi',
  'Stoeger',
  'Weatherby',
  'Marlin',
  'Masterpiece Arms',
  'Sphinx',
  'STI', 'Staccato',
  'Nemo',
  'POF',
  'Rossi',
  'Cimarron',
  'Uberti',
  'Inland',
  'Auto-Ordnance',
  'Armscor',
  'Fusion',
];

/**
 * Find the first brand token present in the given text. Returns the
 * canonical cased form (from BRAND_TOKENS) so downstream display is
 * consistent, regardless of what the OCR emitted.
 */
export function findBrand(text: string): string | null {
  for (const brand of BRAND_TOKENS) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) return brand;
  }
  return null;
}

/**
 * Known decimal calibers. Restricting decimal matches to this set avoids
 * false positives from price decimals (".99", ".11", ".08") and other
 * non-caliber decimals that plague FFL receipts.
 */
const DECIMAL_CALIBERS: Set<string> = new Set([
  '.17', '.22', '.220', '.223', '.224', '.243', '.25', '.257', '.260', '.264',
  '.270', '.277', '.284', '.30', '.300', '.303', '.308', '.32', '.327', '.338',
  '.35', '.357', '.375', '.38', '.380', '.40', '.410', '.416', '.44', '.444',
  '.45', '.450', '.454', '.458', '.460', '.475', '.480', '.50', '.500',
]);

/**
 * Pull a caliber-looking token from a free-form string. Recognises:
 *   9mm · 9 mm · 10mm · .223 · .223 Rem · 5.56 · 5.56x45 · .45 ACP ·
 *   7.62x39 · 12 GA · 12ga · 20 Gauge · .22 LR · .308 · 6.5 Creedmoor
 *
 * Plain-decimal matches (like ".223") are cross-checked against the
 * known-calibers set so price decimals like ".99" don't sneak through.
 */
export function extractCaliberToken(text: string): string | null {
  // Try the most specific patterns first so "9mm Luger" beats "9mm".
  // These contextual patterns (ACP, Rem, Luger, etc.) are unambiguous
  // and don't need the known-caliber filter.
  const contextualPatterns: RegExp[] = [
    /\b\d{1,2}\.\d{1,2}\s*[xX]\s*\d{1,3}\b/,                 // 5.56x45, 7.62x39
    /\.\d{2,3}\s*(?:ACP|Auto|Rem|Win|Spl|Special|LR|Mag|Magnum|BLK|Blackout|Creedmoor|WSM|WSSM|WCF|Colt|S&W)\b/i,
    /\b\d{1,2}\s*mm\s*(?:Luger|Parabellum|Para|Auto|Makarov|NATO)\b/i,
    /\b\d{1,2}\.\d{1,2}\s*(?:Creedmoor|Grendel|PRC|ARC|NATO)\b/i, // 6.5 Creedmoor
    /\b\d{1,2}\s*mm\b/i,                                      // 9mm, 10mm
    /\b\d{1,2}\s*ga(?:uge)?\b/i,                              // 12ga, 20 Gauge
  ];
  for (const re of contextualPatterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }

  // Plain-decimal match — only accept if it matches a known caliber and
  // isn't preceded by a digit (avoids pulling ".99" out of "$1287.99").
  const decRe = /(^|[^\d,])(\.\d{2,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = decRe.exec(text)) !== null) {
    const candidate = m[2];
    if (DECIMAL_CALIBERS.has(candidate)) return candidate;
  }
  return null;
}
