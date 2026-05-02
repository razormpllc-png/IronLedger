// Entitlements module — single source of truth for paid feature gating.
// Backed by AsyncStorage. Updated for the Vault / Vault Pro 2-tier model
// (replacing the old pro / founders model). Existing users with stored
// 'pro' or 'founders' values are migrated on load — see load() below.

import AsyncStorage from '@react-native-async-storage/async-storage';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/** The paid tier the user is on. Order matters for tierLabel display and
 *  for the upgrade ladder logic in lib/purchases.ts. */
export type Tier = 'lite' | 'vault' | 'vault_pro';

export type Feature =
  | 'unlimited_firearms'
  | 'unlimited_accessories'
  | 'smart_battery_prefill'
  | 'battery_reminders'
  | 'maintenance_reminders'
  | 'nfa_tracking'
  | 'atf_ocr'
  | 'insurance_export'
  | 'ffl_bound_book'
  | 'dope_cards'
  | 'range_day'
  | 'icloud_sync'
  | 'ai_recognition'
  | 'razormp_content'
  | 'document_storage'
  | 'photo_gallery_full'
  // Pro-only (Vault Pro tier) features:
  | 'competition_module'
  | 'estate_export'
  | 'ffl_bound_book_audit';

export type OnboardingPath =
  | 'protect_records'
  | 'track_maintenance'
  | 'manage_nfa'
  | 'plan_range_days';

// ────────────────────────────────────────────────────────────────────────
// Limits per tier
// ────────────────────────────────────────────────────────────────────────

export interface TierLimits {
  maxFirearms: number;
  maxPhotosPerFirearm: number;
  maxAccessoriesPerFirearm: number;
}

export const LIMITS: Record<Tier, TierLimits> = {
  lite: {
    maxFirearms: 5,
    maxPhotosPerFirearm: 1,
    maxAccessoriesPerFirearm: 2,
  },
  vault: {
    maxFirearms: Infinity,
    maxPhotosPerFirearm: 20,
    maxAccessoriesPerFirearm: Infinity,
  },
  vault_pro: {
    maxFirearms: Infinity,
    maxPhotosPerFirearm: 20,
    maxAccessoriesPerFirearm: Infinity,
  },
};

// ────────────────────────────────────────────────────────────────────────
// Feature gates
// ────────────────────────────────────────────────────────────────────────

// Features available on Vault and above.
const VAULT_FEATURES: Feature[] = [
  'unlimited_firearms',
  'unlimited_accessories',
  'smart_battery_prefill',
  'battery_reminders',
  'maintenance_reminders',
  'icloud_sync',
  'document_storage',
  'photo_gallery_full',
  'razormp_content',
  'ai_recognition',
];

// Features ONLY available on Vault Pro.
const VAULT_PRO_FEATURES: Feature[] = [
  'nfa_tracking',
  'atf_ocr',
  'insurance_export',
  'ffl_bound_book',
  'dope_cards',
  'range_day',
  'competition_module',
  'estate_export',
  'ffl_bound_book_audit',
];

export function isPaidTier(tier: Tier): boolean {
  return tier === 'vault' || tier === 'vault_pro';
}

export function hasFeature(tier: Tier, feature: Feature): boolean {
  if (tier === 'vault_pro') return true; // Pro gets everything.
  if (tier === 'vault') return VAULT_FEATURES.includes(feature);
  // Lite has access to anything not in either paid bucket.
  return !VAULT_FEATURES.includes(feature) && !VAULT_PRO_FEATURES.includes(feature);
}

export function limitsFor(tier: Tier): TierLimits {
  return LIMITS[tier];
}

// Display name for UI.
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'lite': return 'Lite';
    case 'vault': return 'Vault';
    case 'vault_pro': return 'Vault Pro';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  tier: 'entitlements.tier',
  onboardingPath: 'entitlements.onboardingPath',
  onboardingComplete: 'entitlements.onboardingComplete',
  pathSpotlightDismissed: 'entitlements.pathSpotlightDismissed',
} as const;

type Listener = () => void;

export interface EntitlementsSnapshot {
  tier: Tier;
  onboardingPath: OnboardingPath | null;
  onboardingComplete: boolean;
  pathSpotlightDismissed: boolean;
  loaded: boolean;
}

class EntitlementsStore {
  private snapshot: EntitlementsSnapshot = {
    tier: 'lite',
    onboardingPath: null,
    onboardingComplete: false,
    pathSpotlightDismissed: false,
    loaded: false,
  };
  private listeners = new Set<Listener>();

  async load(): Promise<void> {
    if (this.snapshot.loaded) return;

    let tier: Tier = 'lite';
    let onboardingPath: OnboardingPath | null = null;
    let onboardingComplete = false;
    let pathSpotlightDismissed = false;

    try {
      const [tierRaw, pathRaw, completeRaw, spotlightRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.tier),
        AsyncStorage.getItem(STORAGE_KEYS.onboardingPath),
        AsyncStorage.getItem(STORAGE_KEYS.onboardingComplete),
        AsyncStorage.getItem(STORAGE_KEYS.pathSpotlightDismissed),
      ]);

      // Migrate legacy values from the pro/founders model. Anyone who had
      // 'pro' becomes 'vault'; 'founders' (lifetime) becomes 'vault_pro'
      // since founders had everything. After lib/purchases.ts runs its
      // restore on app start, the real receipt-derived tier overrides this
      // anyway — this is just to avoid a flicker through Lite for legacy
      // installs.
      tier = migrateLegacyTier(tierRaw);

      if (pathRaw && ['protect_records', 'track_maintenance', 'manage_nfa', 'plan_range_days'].includes(pathRaw)) {
        onboardingPath = pathRaw as OnboardingPath;
      }
      onboardingComplete = completeRaw === 'true';
      pathSpotlightDismissed = spotlightRaw === 'true';
    } catch (e) {
      console.warn('[entitlements] load failed, defaulting to lite', e);
    }

    this.replaceSnapshot({
      tier,
      onboardingPath,
      onboardingComplete,
      pathSpotlightDismissed,
      loaded: true,
    });
  }

  getSnapshot(): EntitlementsSnapshot { return this.snapshot; }
  getTier(): Tier { return this.snapshot.tier; }
  getOnboardingPath(): OnboardingPath | null { return this.snapshot.onboardingPath; }
  isOnboardingComplete(): boolean { return this.snapshot.onboardingComplete; }
  isLoaded(): boolean { return this.snapshot.loaded; }

  async setTier(tier: Tier): Promise<void> {
    if (this.snapshot.tier === tier) return;
    this.replaceSnapshot({ ...this.snapshot, tier });
    await AsyncStorage.setItem(STORAGE_KEYS.tier, tier);
  }

  async setOnboardingPath(path: OnboardingPath): Promise<void> {
    if (this.snapshot.onboardingPath === path) return;
    this.replaceSnapshot({
      ...this.snapshot,
      onboardingPath: path,
      pathSpotlightDismissed: false,
    });
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.onboardingPath, path),
      AsyncStorage.removeItem(STORAGE_KEYS.pathSpotlightDismissed),
    ]);
  }

  async dismissPathSpotlight(): Promise<void> {
    if (this.snapshot.pathSpotlightDismissed) return;
    this.replaceSnapshot({ ...this.snapshot, pathSpotlightDismissed: true });
    await AsyncStorage.setItem(STORAGE_KEYS.pathSpotlightDismissed, 'true');
  }

  async resetPathSpotlightDismissed(): Promise<void> {
    if (!this.snapshot.pathSpotlightDismissed) return;
    this.replaceSnapshot({ ...this.snapshot, pathSpotlightDismissed: false });
    await AsyncStorage.removeItem(STORAGE_KEYS.pathSpotlightDismissed);
  }

  async setOnboardingComplete(complete: boolean): Promise<void> {
    if (this.snapshot.onboardingComplete === complete) return;
    this.replaceSnapshot({ ...this.snapshot, onboardingComplete: complete });
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, complete ? 'true' : 'false');
  }

  async devReset(): Promise<void> {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.tier),
      AsyncStorage.removeItem(STORAGE_KEYS.onboardingPath),
      AsyncStorage.removeItem(STORAGE_KEYS.onboardingComplete),
      AsyncStorage.removeItem(STORAGE_KEYS.pathSpotlightDismissed),
    ]);
    this.replaceSnapshot({
      tier: 'lite',
      onboardingPath: null,
      onboardingComplete: false,
      pathSpotlightDismissed: false,
      loaded: true,
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private replaceSnapshot(next: EntitlementsSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach(l => { try { l(); } catch {} });
  }
}

function migrateLegacyTier(raw: string | null): Tier {
  if (raw === 'vault' || raw === 'vault_pro' || raw === 'lite') return raw;
  if (raw === 'pro') return 'vault';
  if (raw === 'founders') return 'vault_pro';
  return 'lite';
}

export const entitlementsStore = new EntitlementsStore();
entitlementsStore.load();

// ────────────────────────────────────────────────────────────────────────
// Backward-compat re-exports — old code may import these names. Remove
// once all references are updated.
// ────────────────────────────────────────────────────────────────────────

/** @deprecated use isPaidTier */
export const isProTier = isPaidTier;
