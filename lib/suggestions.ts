/**
 * Smart autofill suggestions.
 *
 * Provides a single entry point — `getSuggestions(query, source)` — that
 * returns a ranked, deduped list of autocomplete candidates for a given
 * input field. Suggestions come from two places:
 *
 *   1. The user's own past entries (DISTINCT column values across the
 *      relevant SQLite tables). Weighted by frequency so repeated brands
 *      bubble up first.
 *
 *   2. A curated seed list of common firearms/accessory brands, calibers,
 *      and dealer chains so the field is helpful on day one before the
 *      user has any data. Seeds fade as user-data matches dominate.
 *
 * Matching is case-insensitive, prefix-first, with a loose "contains"
 * fallback so typing "jic" still surfaces "Trijicon". Capped at 5
 * suggestions by default — enough to be useful, small enough to fit
 * above the keyboard on an iPhone.
 */
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('ironledger.db');

/** Logical field sources — each maps to a set of (table, column) pairs. */
export type SuggestionSource =
  | 'firearm_make'
  | 'firearm_model'
  | 'firearm_caliber'
  | 'accessory_make'
  | 'accessory_model'
  | 'ammo_brand'
  | 'ammo_caliber'
  | 'suppressor_make'
  | 'suppressor_model'
  | 'suppressor_caliber'
  | 'purchase_location'
  | 'dealer_city_state'
  | 'caliber_any'
  | 'range_location'
  | 'expense_description';

// ── Seed lists ────────────────────────────────────────────────────────

const FIREARM_BRANDS = [
  'Sig Sauer', 'Glock', 'Smith & Wesson', 'Beretta', 'Ruger', 'Springfield Armory',
  'Colt', 'FN Herstal', 'FN America', 'HK', 'Heckler & Koch', 'Daniel Defense',
  'BCM', 'Bravo Company', 'Geissele', 'Aero Precision', 'LWRC', 'Knights Armament',
  'Noveske', 'Larue Tactical', 'Sons of Liberty Gun Works', 'Palmetto State Armory',
  'Remington', 'Winchester', 'Mossberg', 'Benelli', 'Kimber', 'Walther',
  'CZ', 'Steyr', 'Taurus', 'Canik', 'Staccato', 'Wilson Combat', 'Nighthawk Custom',
  'Browning', 'Savage Arms', 'Tikka', 'Barrett', 'Desert Tech', 'Christensen Arms',
  'Anderson Manufacturing', 'Radian', 'Q LLC',
];

const OPTIC_BRANDS = [
  'Trijicon', 'Leupold', 'Vortex', 'Aimpoint', 'EOTech', 'Holosun', 'Sig Sauer',
  'Primary Arms', 'Nightforce', 'Steiner', 'Swarovski', 'Zeiss', 'Schmidt & Bender',
  'Burris', 'Bushnell', 'Athlon', 'Meopta', 'Kahles', 'March', 'Tangent Theta',
  'US Optics', 'ELCAN', 'Specter', 'Unity Tactical', 'Arisaka', 'Scalarworks',
  'Reptilia', 'Badger Ordnance', 'ADM', 'LaRue Tactical', 'Geissele', 'Bobro',
  'Romeo', 'Juliet',
];

const LIGHT_LASER_BRANDS = [
  'Streamlight', 'SureFire', 'Modlite', 'Inforce', 'Olight', 'Cloud Defensive',
  'Arisaka', 'Nightstick', 'Fenix', 'Crimson Trace', 'Viridian', 'Steiner',
  'L3Harris', 'LaserMax', 'DBAL',
];

const SUPPRESSOR_BRANDS = [
  'SilencerCo', 'Dead Air', 'SureFire', 'Huxwrx', 'OSS', 'Rugged Suppressors',
  'Griffin Armament', 'Q LLC', 'Thunder Beast', 'TBAC', 'AAC', 'Gemtech',
  'CGS Group', 'Yankee Hill Machine', 'B&T', 'KGM', 'Enticer', 'Nomad',
  'Hybrid', 'Omega', 'Sandman', 'Banish',
];

const AMMO_BRANDS = [
  'Federal', 'Winchester', 'Hornady', 'Sig Sauer', 'Speer', 'Remington',
  'PMC', 'CCI', 'Fiocchi', 'Magtech', 'Prvi Partizan', 'PPU', 'Lapua',
  'Norma', 'Nosler', 'Barnes', 'Black Hills', 'Wilson Combat', 'Underwood',
  'Buffalo Bore', 'Liberty', 'Atomic', 'Aguila', 'Blazer', 'American Eagle',
  'Gold Medal', 'Match King', 'NovX', 'Geco', 'S&B', 'Sellier & Bellot',
];

const CALIBERS = [
  '9mm', '.45 ACP', '.40 S&W', '.380 ACP', '10mm', '.357 Magnum', '.357 Sig',
  '.38 Special', '.44 Magnum', '.22 LR', '.22 WMR', '.25 ACP',
  '5.56 NATO', '.223 Remington', '.300 Blackout', '.300 BLK', '6.5 Creedmoor',
  '6.5 Grendel', '6mm ARC', '6mm Creedmoor', '.308 Winchester', '.30-06 Springfield',
  '7.62x39', '7.62x51 NATO', '.300 Win Mag', '.338 Lapua', '.50 BMG',
  '5.7x28', '4.6x30', '.224 Valkyrie', '.277 Fury', '.22 Hornet', '12 Gauge',
  '20 Gauge', '16 Gauge', '28 Gauge', '.410 Bore',
];

const DEALER_CHAINS = [
  'Palmetto State Armory', 'Brownells', 'Optics Planet', 'Midway USA',
  'Cabela\'s', 'Bass Pro Shops', 'Academy Sports', 'Sportsman\'s Warehouse',
  'Scheels', 'Big 5 Sporting Goods', 'Gunbroker', 'Rainier Arms', 'Primary Arms',
  'Euro Optic', 'SWFA', 'Atlantic Firearms', 'Classic Firearms', 'Grab A Gun',
  'Buds Gun Shop', 'Silencer Shop', 'Omaha Outdoors', 'Botach', 'LA Police Gear',
  'Amazon', 'Walmart',
];

// Common expense line items — seed so the first session is still useful.
const EXPENSE_DESCRIPTIONS = [
  'Range fee', 'Lane rental', 'Ammo', 'Cleaning supplies', 'Holster',
  'Magazine', 'Spare parts', 'Gunsmithing', 'Optic', 'Light', 'Mount',
  'Sling', 'Case', 'Safe storage', 'Insurance premium', 'CCW renewal',
  'Class / training', 'Match entry fee', 'Ear pro', 'Eye pro',
];

const SEEDS: Record<SuggestionSource, string[]> = {
  firearm_make: FIREARM_BRANDS,
  firearm_model: [],
  firearm_caliber: CALIBERS,
  accessory_make: [...OPTIC_BRANDS, ...LIGHT_LASER_BRANDS, ...FIREARM_BRANDS],
  accessory_model: [],
  ammo_brand: AMMO_BRANDS,
  ammo_caliber: CALIBERS,
  suppressor_make: SUPPRESSOR_BRANDS,
  suppressor_model: [],
  suppressor_caliber: CALIBERS,
  purchase_location: DEALER_CHAINS,
  dealer_city_state: [],
  caliber_any: CALIBERS,
  range_location: [],
  expense_description: EXPENSE_DESCRIPTIONS,
};

// ── DB queries ────────────────────────────────────────────────────────

/** Pull DISTINCT column values from a table, ordered by frequency.
 *  Wrapped in try/catch so a missing table (older DB versions) returns
 *  [] instead of throwing — callers should degrade gracefully to seed
 *  list alone. */
function distinctFromTable(table: string, column: string): string[] {
  try {
    const rows = db.getAllSync<{ v: string; n: number }>(
      `SELECT ${column} as v, COUNT(*) as n FROM ${table}
       WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''
       GROUP BY ${column}
       ORDER BY n DESC`,
    );
    return rows.map((r) => r.v);
  } catch {
    return [];
  }
}

/** Aggregate user history for a given source, combining multiple
 *  (table, column) pairs where relevant. */
function historyFor(source: SuggestionSource): string[] {
  switch (source) {
    case 'firearm_make':       return distinctFromTable('firearms', 'make');
    case 'firearm_model':      return distinctFromTable('firearms', 'model');
    case 'firearm_caliber':    return distinctFromTable('firearms', 'caliber');
    case 'accessory_make':     return distinctFromTable('accessories', 'make');
    case 'accessory_model':    return distinctFromTable('accessories', 'model');
    case 'ammo_brand':         return distinctFromTable('ammo', 'brand');
    case 'ammo_caliber':       return distinctFromTable('ammo', 'caliber');
    case 'suppressor_make':    return distinctFromTable('suppressors', 'make');
    case 'suppressor_model':   return distinctFromTable('suppressors', 'model');
    case 'suppressor_caliber': return distinctFromTable('suppressors', 'caliber');
    case 'purchase_location':
      return [
        ...distinctFromTable('firearms', 'purchased_from'),
        ...distinctFromTable('accessories', 'purchased_from'),
        ...distinctFromTable('suppressors', 'purchased_from'),
      ];
    case 'dealer_city_state':
      return [
        ...distinctFromTable('firearms', 'dealer_city_state'),
        ...distinctFromTable('accessories', 'dealer_city_state'),
        ...distinctFromTable('suppressors', 'dealer_city_state'),
      ];
    case 'caliber_any':
      return [
        ...distinctFromTable('firearms', 'caliber'),
        ...distinctFromTable('ammo', 'caliber'),
        ...distinctFromTable('suppressors', 'caliber'),
      ];
    case 'range_location':      return distinctFromTable('range_sessions', 'location');
    case 'expense_description': return distinctFromTable('expenses', 'description');
  }
}

// ── Ranking ───────────────────────────────────────────────────────────

/** Case-insensitive prefix match (score 2), contains match (score 1),
 *  no match (null). Prefix beats contains so "Trij" → Trijicon ranks
 *  above something like "Strij..." that only contains the substring. */
function matchScore(candidate: string, query: string): number | null {
  if (!query) return 0; // no query = show all
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();
  if (c.startsWith(q)) return 2;
  if (c.includes(q)) return 1;
  return null;
}

/** Public entry point. Returns ranked suggestions for `query` against
 *  `source`. History entries always beat seed entries at equal match
 *  score — we respect what the user has actually typed before. */
export function getSuggestions(
  query: string,
  source: SuggestionSource,
  limit: number = 5,
): string[] {
  const history = historyFor(source);
  const seeds = SEEDS[source] ?? [];

  // Dedupe: history wins if same (case-insensitive) value exists in seeds.
  const seen = new Set<string>();
  const canonical = (s: string) => s.trim().toLowerCase();

  type Scored = { value: string; score: number; isHistory: boolean; order: number };
  const out: Scored[] = [];

  history.forEach((v, i) => {
    const key = canonical(v);
    if (seen.has(key)) return;
    const score = matchScore(v, query);
    if (score === null) return;
    seen.add(key);
    // Boost history by +10 so it always ranks above seeds at equivalent
    // match quality; within history, earlier (more frequent) entries win.
    out.push({ value: v, score: score + 10, isHistory: true, order: i });
  });

  seeds.forEach((v, i) => {
    const key = canonical(v);
    if (seen.has(key)) return;
    const score = matchScore(v, query);
    if (score === null) return;
    seen.add(key);
    out.push({ value: v, score, isHistory: false, order: i });
  });

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isHistory !== b.isHistory) return a.isHistory ? -1 : 1;
    return a.order - b.order;
  });

  return out.slice(0, limit).map((x) => x.value);
}
