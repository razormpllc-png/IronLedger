// Entitlements module — single source of truth for Pro feature gating.
// Backed by AsyncStorage for dev; will be wired to RevenueCat in a later step.

import AsyncStorage from '@react-native-async-storage/async-storage';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type Tier = 'lite' | 'pro' | 'founders';

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
  | 'photo_gallery_full';

// What the user chose during onboarding — used to tailor paywall copy.
export type OnboardingPath =
  | 'protect_records'
  | 'track_maintenance'
  | 'manage_nfa'
  | 'plan_range_days';

// ────────────────────────────────────────────────────────────────────────
// Limits per tier
// ────────────────────────────────────────────────────────────────────────

export interface TierLimits {
  maxFirearms: number;           // Infinity for unlimited
  maxPhotosPerFirearm: number;
  maxAccessoriesPerFirearm: number;
}

export const LIMITS: Record<Tier, TierLimits> = {
  lite: {
    maxFirearms: 5,
    maxPhotosPerFirearm: 1,
    maxAccessoriesPerFirearm: 2,
  },
  pro: {
    maxFirearms: Infinity,
    maxPhotosPerFirearm: 20,
    maxAccessoriesPerFirearm: Infinity,
  },
  founders: {
    maxFirearms: Infinity,
    maxPhotosPerFirearm: 20,
    maxAccessoriesPerFirearm: Infinity,
  },
};

// ────────────────────────────────────────────────────────────────────────
// Feature gates
// ────────────────────────────────────────────────────────────────────────

// Every feature in the app either gates on a Pro tier or is free.
// Lite has no Pro features. Pro and Founders have everything.
const PRO_FEATURES: Feature[] = [
  'unlimited_firearms',
  'unlimited_accessories',
  'smart_battery_prefill',
  'battery_reminders',
  'maintenance_reminders',
  'nfa_tracking',
  'atf_ocr',
  'insurance_export',
  'ffl_bound_book',
  'dope_cards',
  'range_day',
  'icloud_sync',
  'ai_recognition',
  'razormp_content',
  'document_storage',
  'photo_gallery_full',
];

export function isProTier(tier: Tier): boolean {
  return tier === 'pro' || tier === 'founders';
}

export function hasFeature(tier: Tier, feature: Feature): boolean {
  if (isProTier(tier)) return true;
  // Lite has access to everything NOT in PRO_FEATURES. Since all gated
  // features are listed, this collapses to a simple check.
  return !PRO_FEATURES.includes(feature);
}

export function limitsFor(tier: Tier): TierLimits {
  return LIMITS[tier];
}

// Display name for UI.
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'lite': return 'Iron Ledger Lite';
    case 'pro': return 'Iron Ledger Pro';
    case 'founders': return 'Founders Lifetime';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Persistence + subscription model
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
  /** True once the user has dismissed (or deep-linked through) the
   *  path-aware dashboard spotlight. Kept separate from onboardingComplete
   *  so we can re-surface the card after a path change. */
  pathSpotlightDismissed: boolean;
  loaded: boolean;
}

class EntitlementsStore {
  // IMPORTANT: cache the snapshot object reference. useSyncExternalStore
  // compares snapshots by ===, so getSnapshot() must return the same object
  // until something actually changes or React will loop infinitely.
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
      if (tierRaw === 'pro' || tierRaw === 'founders' || tierRaw === 'lite') {
        tier = tierRaw;
      }
      if (pathRaw && ['protect_records', 'track_maintenance', 'manage_nfa', 'plan_range_days'].includes(pathRaw)) {
        onboardingPath = pathRaw as OnboardingPath;
      }
      onboardingComplete = completeRaw === 'true';
      pathSpotlightDismissed = spotlightRaw === 'true';
    } catch (e) {
      console.warn('[entitlements] load failed, defaulting to lite', e);
    }
    this.replaceSnapshot({ tier, onboardingPath, onboardingComplete, pathSpotlightDismissed, loaded: true });
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
    // Re-surface the spotlight card when the path changes so the new
    // selection gets its own "start here" nudge.
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

  /** Clear the "user tapped X on the spotlight" flag so the spotlight card
   *  can surface again — called when the user switches focus via
   *  /change-focus so the new path's guidance gets a fresh shot. */
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

export const entitlementsStore = new EntitlementsStore();

// Kick off initial load. Hook consumers will see loaded=false briefly,
// then re-render via subscription when real values land from AsyncStorage.
entitlementsStore.load();
