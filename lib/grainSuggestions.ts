/**
 * Common grain weights by caliber for quick-select suggestions.
 * Used by add-ammo and edit-ammo screens.
 */

const GRAIN_MAP: [RegExp, number[]][] = [
  [/^9\s?mm/i, [115, 124, 147]],
  [/^\.45\s?(acp|auto)/i, [185, 200, 230]],
  [/^\.40\s?s&?w/i, [155, 165, 180]],
  [/^\.380/i, [90, 95, 100]],
  [/^\.38\s?(spe|spl|\+p)/i, [125, 130, 148, 158]],
  [/^\.357\s?mag/i, [125, 158]],
  [/^10\s?mm/i, [155, 165, 180, 200]],
  [/^\.44\s?mag/i, [180, 240, 300]],
  [/^\.22\s?(lr|long)/i, [36, 40]],
  [/^(\.223|5\.56)/i, [55, 62, 69, 77]],
  [/^(\.308|7\.62\s?x\s?51)/i, [147, 150, 168, 175, 180]],
  [/^\.300\s?(blk|black|aac|whisper)/i, [110, 125, 220]],
  [/^6\.5\s?(cm|creed|prc)/i, [120, 130, 140, 147]],
  [/^\.30-06/i, [150, 168, 180]],
  [/^\.270/i, [130, 150]],
  [/^\.243/i, [87, 100]],
  [/^7\s?mm/i, [140, 150, 168, 175]],
  [/^\.338/i, [225, 250, 300]],
  [/^\.204/i, [32, 40]],
  [/^6\.8\s?(spc|western)/i, [85, 95, 110, 175]],
  [/^\.350\s?legend/i, [145, 160, 180]],
  [/^\.450\s?bush/i, [250, 260, 300]],
  [/^\.50\s?(bmg|beowulf)/i, [350, 647, 661]],
];

export function suggestedGrains(caliber: string): number[] {
  const norm = caliber.trim();
  if (!norm) return [];
  for (const [re, grains] of GRAIN_MAP) {
    if (re.test(norm)) return grains;
  }
  return [];
}
