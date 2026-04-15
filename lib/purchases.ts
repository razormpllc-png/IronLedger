// Purchase service: wraps RevenueCat with a graceful fallback.
//
// While PURCHASES_ENABLED is false, the module runs in "stub mode": prices
// are the fallback strings in purchaseConfig, and purchase() just flips the
// local tier so we can demo the full UX without a native build. The moment
// PURCHASES_ENABLED flips to true AND `react-native-purchases` is installed,
// every call routes to RevenueCat and the local tier becomes a mirror of
// RevenueCat's customer entitlements.

import { Platform, Linking } from 'react-native';
import { entitlementsStore, Tier } from './entitlements';
import {
  PURCHASES_ENABLED,
  REVENUECAT_API_KEYS,
  ENTITLEMENT_IDS,
  PACKAGE_IDS,
  PackageKey,
  FALLBACK_PRICES,
} from './purchaseConfig';

// Dynamic import guard. react-native-purchases is not in package.json until
// the user installs it; without this guard, Metro would throw at bundle time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Purchases: any = null;
let PurchasesError: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-purchases');
  Purchases = mod.default ?? mod;
  PurchasesError = mod.PurchasesError;
} catch {
  // react-native-purchases not installed yet. Stub mode will handle it.
}

export interface PackageDisplay {
  key: PackageKey;
  priceString: string;
  // Raw package reference handed back to purchase() unchanged. Opaque to UI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any | null;
}

export interface PurchaseResult {
  success: boolean;
  tier: Tier;
  cancelled?: boolean;
  error?: string;
}

let initialized = false;

/**
 * Configure RevenueCat with the platform API key and start listening for
 * customer info updates. Safe to call multiple times.
 */
export async function initPurchases(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!isLive()) {
    if (__DEV__) console.log('[purchases] stub mode — RevenueCat not active');
    return;
  }

  const apiKey =
    Platform.OS === 'ios' ? REVENUECAT_API_KEYS.ios : REVENUECAT_API_KEYS.android;

  if (!apiKey) {
    console.warn('[purchases] PURCHASES_ENABLED=true but no API key for', Platform.OS);
    return;
  }

  try {
    // Reasonable log level defaults. Users can flip to VERBOSE while debugging.
    if (Purchases.setLogLevel && Purchases.LOG_LEVEL) {
      Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.WARN : Purchases.LOG_LEVEL.ERROR);
    }
    await Purchases.configure({ apiKey });

    // Pull current entitlements once at boot so an already-subscribed user
    // lands straight on Pro without hitting a purchase flow.
    const info = await Purchases.getCustomerInfo();
    await syncTierFromCustomerInfo(info);

    // Keep the local store in lockstep with RC's server-side truth.
    Purchases.addCustomerInfoUpdateListener((next: unknown) => {
      syncTierFromCustomerInfo(next).catch(e =>
        console.warn('[purchases] sync failed', e)
      );
    });
  } catch (e) {
    console.warn('[purchases] init failed', e);
  }
}

/**
 * Fetch the current default offering and return display-ready packages for
 * the paywall. Always returns entries for all three keys — raw is null when
 * a package is missing (either stub mode or misconfigured offering).
 */
export async function getOfferingPackages(): Promise<Record<PackageKey, PackageDisplay>> {
  const out: Record<PackageKey, PackageDisplay> = {
    monthly: { key: 'monthly', priceString: FALLBACK_PRICES.monthly, raw: null },
    annual: { key: 'annual', priceString: FALLBACK_PRICES.annual, raw: null },
    lifetime: { key: 'lifetime', priceString: FALLBACK_PRICES.lifetime, raw: null },
  };

  if (!isLive()) return out;

  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    if (!current) return out;

    for (const key of Object.keys(out) as PackageKey[]) {
      const rcId = PACKAGE_IDS[key];
      // availablePackages is an array with identifiers like $rc_monthly etc.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pkg = current.availablePackages?.find((p: any) => p.identifier === rcId);
      if (pkg) {
        out[key] = {
          key,
          priceString: pkg.product?.priceString ?? FALLBACK_PRICES[key],
          raw: pkg,
        };
      }
    }
  } catch (e) {
    console.warn('[purchases] getOfferings failed, using fallback prices', e);
  }

  return out;
}

/**
 * Start a purchase flow. In stub mode this just flips the local tier so we
 * can demo without native IAP. In live mode this runs the real RevenueCat
 * purchase sheet and syncs the tier from the returned customerInfo.
 */
export async function purchase(pkg: PackageDisplay): Promise<PurchaseResult> {
  if (!isLive() || !pkg.raw) {
    const tier: Tier = pkg.key === 'lifetime' ? 'founders' : 'pro';
    await entitlementsStore.setTier(tier);
    return { success: true, tier };
  }

  try {
    const res = await Purchases.purchasePackage(pkg.raw);
    const info = res?.customerInfo ?? res;
    const tier = await syncTierFromCustomerInfo(info);
    return { success: true, tier };
  } catch (e) {
    // RevenueCat surfaces a standardized `userCancelled` boolean.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    if (err?.userCancelled) {
      return { success: false, tier: entitlementsStore.getTier(), cancelled: true };
    }
    console.warn('[purchases] purchase failed', err);
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: err?.message ?? 'Purchase failed',
    };
  }
}

/**
 * Restore any entitlements tied to the user's store account. No-op in stub.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isLive()) {
    return {
      success: true,
      tier: entitlementsStore.getTier(),
    };
  }

  try {
    const info = await Purchases.restorePurchases();
    const tier = await syncTierFromCustomerInfo(info);
    return { success: true, tier };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    console.warn('[purchases] restore failed', err);
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: err?.message ?? 'Restore failed',
    };
  }
}

/**
 * Read the active entitlements off a RevenueCat CustomerInfo object and
 * reduce them into a single Tier. Founders beats Pro beats Lite.
 */
async function syncTierFromCustomerInfo(info: unknown): Promise<Tier> {
  const active = readActiveEntitlements(info);
  let tier: Tier = 'lite';
  if (active.has(ENTITLEMENT_IDS.founders)) tier = 'founders';
  else if (active.has(ENTITLEMENT_IDS.pro)) tier = 'pro';
  await entitlementsStore.setTier(tier);
  return tier;
}

function readActiveEntitlements(info: unknown): Set<string> {
  const out = new Set<string>();
  if (!info || typeof info !== 'object') return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = (info as any).entitlements?.active;
  if (!active) return out;
  for (const id of Object.keys(active)) out.add(id);
  return out;
}

function isLive(): boolean {
  return PURCHASES_ENABLED && !!Purchases;
}

/**
 * Exposed for diagnostics (e.g. a dev panel). Returns whether the live
 * RevenueCat pipeline is actually wired.
 */
export function purchasesLiveMode(): boolean {
  return isLive();
}

// Export for places that want to show fallback pricing without touching RC
// at all (e.g. rendering the paywall before offerings have loaded).
export { FALLBACK_PRICES };

// ────────────────────────────────────────────────────────────────────────
// Subscription management surface area — used by /subscription screen.
// ────────────────────────────────────────────────────────────────────────

/** Summary of the active subscription pulled from RevenueCat. All fields
 *  are optional so the UI can show partial info gracefully. */
export interface SubscriptionSummary {
  live: boolean;              // True when we're talking to real RC
  productId: string | null;   // e.g. 'ironledger.pro.annual'
  periodType: string | null;  // 'normal' | 'trial' | 'intro'
  expiresAt: string | null;   // ISO timestamp when the current period ends
  willRenew: boolean | null;
  store: string | null;       // 'APP_STORE' | 'PLAY_STORE' | 'PROMOTIONAL' etc.
}

/** Pull the current subscription summary. In stub mode (or when nothing is
 *  active) returns a minimal shape with `live: false`. Safe to call from
 *  any screen — no side effects. */
export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
  const base: SubscriptionSummary = {
    live: isLive(),
    productId: null,
    periodType: null,
    expiresAt: null,
    willRenew: null,
    store: null,
  };
  if (!isLive()) return base;
  try {
    const info = await Purchases.getCustomerInfo();
    // Prefer the active pro entitlement; fall back to founders (lifetime).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const active: Record<string, any> = info?.entitlements?.active ?? {};
    const ent = active[ENTITLEMENT_IDS.pro] ?? active[ENTITLEMENT_IDS.founders];
    if (!ent) return base;
    return {
      live: true,
      productId: ent.productIdentifier ?? null,
      periodType: ent.periodType ?? null,
      expiresAt: ent.expirationDate ?? null,
      willRenew: ent.willRenew ?? null,
      store: ent.store ?? null,
    };
  } catch (e) {
    console.warn('[purchases] getSubscriptionSummary failed', e);
    return base;
  }
}

/** Open the platform-managed subscription page so the user can change plan
 *  or cancel. iOS pops the App Store subscriptions sheet; Android opens the
 *  Play Store subscriptions page. Returns true if the URL was dispatched. */
export async function openManageSubscriptions(): Promise<boolean> {
  const url = Platform.OS === 'ios'
    ? 'itms-apps://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
  try {
    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.warn('[purchases] openManageSubscriptions failed', e);
    return false;
  }
}
