// Purchase service: wraps expo-iap (StoreKit 2 on iOS, Play Billing on Android)
// with no third-party purchase backend. Receipts are validated client-side via
// StoreKit 2's signed Transaction objects. There is intentionally no "stub
// mode" path in production: if products fail to load or a purchase fails, the
// purchase fails — we do NOT silently grant entitlement (that's the bug Apple
// flagged in build 17 review).

import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  ErrorCode,
  type Product,
  type ProductSubscription,
  type Purchase,
  type PurchaseIOS,
  type PurchaseError,
} from 'expo-iap';

import { entitlementsStore, Tier } from './entitlements';
import {
  PRODUCT_IDS,
  productIdToTier,
  type ProductKey,
  FALLBACK_PRICES,
} from './purchaseConfig';

// ────────────────────────────────────────────────────────────────────────
// Public types (preserved across rewrites — paywall components depend on
// these shapes, so changing them ripples into UI code).
// ────────────────────────────────────────────────────────────────────────

export interface PackageDisplay {
  /** Stable key the UI uses to identify this product (e.g. 'vault_yearly') */
  key: ProductKey;
  /** Localized price string from StoreKit, e.g. "$24.99". Falls back to a
   *  static string when the store hasn't loaded yet. */
  priceString: string;
  /** Raw product reference. Opaque to UI; passed back into purchase(). */
  raw: ProductSubscription | null;
}

export interface PurchaseResult {
  success: boolean;
  tier: Tier;
  cancelled?: boolean;
  error?: string;
}

export interface SubscriptionSummary {
  live: boolean;
  productId: string | null;
  periodType: string | null;
  expiresAt: string | null;
  willRenew: boolean | null;
  store: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// Module state
// ────────────────────────────────────────────────────────────────────────

let initialized = false;
let connectionReady = false;
let cachedProducts: Map<string, ProductSubscription> = new Map();
let purchaseSub: { remove: () => void } | null = null;
let errorSub: { remove: () => void } | null = null;

// ────────────────────────────────────────────────────────────────────────
// Init / teardown
// ────────────────────────────────────────────────────────────────────────

/**
 * Connect to the platform store, fetch the catalog, sync any active
 * entitlements, and start listening for transaction updates. Safe to call
 * multiple times — idempotent.
 */
export async function initPurchases(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    connectionReady = await initConnection();
    if (!connectionReady) {
      console.warn('[purchases] initConnection returned false');
      return;
    }

    // Fetch the catalog so the paywall has localized prices ready.
    await loadProductCatalog();

    // Replay any historical purchases — the user may have bought on another
    // device or reinstalled. This is what flips a returning subscriber to
    // their correct tier on cold start.
    await syncFromAvailablePurchases();

    // Listen for transactions that complete after we asked for them. On iOS
    // this also fires for Ask-to-Buy approvals and family-sharing changes.
    purchaseSub = purchaseUpdatedListener(handleTransactionUpdate);
    errorSub = purchaseErrorListener(err => {
      // User-cancel is normal; everything else is worth a warning.
      if (err.code !== ErrorCode.UserCancelled) {
        console.warn('[purchases] transaction error', err.code, err.message);
      }
    });
  } catch (e) {
    console.warn('[purchases] init failed', e);
  }
}

export async function teardownPurchases(): Promise<void> {
  purchaseSub?.remove();
  errorSub?.remove();
  purchaseSub = null;
  errorSub = null;
  if (connectionReady) {
    try { await endConnection(); } catch {}
  }
  connectionReady = false;
  initialized = false;
}

async function loadProductCatalog(): Promise<void> {
  const skus = Object.values(PRODUCT_IDS);
  // All 4 of our products are subscriptions — see purchaseConfig.ts.
  const products = (await fetchProducts({ skus, type: 'subs' })) as
    ProductSubscription[];
  cachedProducts = new Map((products ?? []).map(p => [p.id, p]));
  if (__DEV__) {
    console.log('[purchases] loaded', cachedProducts.size, 'of', skus.length, 'products');
    if (cachedProducts.size < skus.length) {
      const missing = skus.filter(s => !cachedProducts.has(s));
      console.warn('[purchases] missing products in store:', missing);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Catalog accessor — used by paywall to render prices.
// ────────────────────────────────────────────────────────────────────────

export async function getOfferingPackages(): Promise<Record<ProductKey, PackageDisplay>> {
  // Lazy refresh the catalog if we don't have it yet (e.g. paywall opens
  // before initPurchases finished). Failure is non-fatal — fallback prices
  // render fine.
  if (cachedProducts.size === 0 && connectionReady) {
    try { await loadProductCatalog(); } catch {}
  }

  const out = {} as Record<ProductKey, PackageDisplay>;
  for (const key of Object.keys(PRODUCT_IDS) as ProductKey[]) {
    const sku = PRODUCT_IDS[key];
    const raw = cachedProducts.get(sku) ?? null;
    out[key] = {
      key,
      priceString: raw?.displayPrice ?? FALLBACK_PRICES[key],
      raw,
    };
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Purchase
// ────────────────────────────────────────────────────────────────────────

/**
 * Run the platform purchase sheet for the given package. Returns a result
 * the UI can act on. Critically, this NEVER grants entitlement on its own
 * decision — entitlement is granted only after a verified transaction
 * arrives via the purchaseUpdatedListener.
 */
export async function purchase(pkg: PackageDisplay): Promise<PurchaseResult> {
  // Production guard: if we have no product reference, the store didn't
  // load this SKU and there is nothing to purchase. Fail loudly rather
  // than fake-grant.
  if (!pkg.raw) {
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: 'This product is currently unavailable. Please try again later.',
    };
  }
  if (!connectionReady) {
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: 'Store is not available. Please try again later.',
    };
  }

  try {
    // All Iron Ledger products are auto-renewing subscriptions, so type is
    // always 'subs'. On Android, subscriptions require offerTokens which
    // expo-iap surfaces on Product via subscriptionOfferDetailsAndroid.
    const offerDetails =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((pkg.raw as any).subscriptionOfferDetailsAndroid ?? []) as Array<{
        offerToken: string;
      }>;

    // requestPurchase fires the platform sheet. The actual transaction
    // arrives asynchronously through purchaseUpdatedListener. We await it
    // here only to surface user-cancel synchronously.
    await requestPurchase({
      request: {
        ios: { sku: pkg.raw.id },
        android: {
          skus: [pkg.raw.id],
          subscriptionOffers: offerDetails.map(o => ({
            sku: pkg.raw!.id,
            offerToken: o.offerToken,
          })),
        },
      },
      type: 'subs',
    });

    // The listener will sync entitlements within ~milliseconds. Wait briefly
    // so the UI gets a current tier value back rather than stale.
    await waitForTier(productIdToTier(pkg.raw.id), 4000);

    return { success: true, tier: entitlementsStore.getTier() };
  } catch (e) {
    const err = e as PurchaseError | Error;
    if ((err as PurchaseError).code === ErrorCode.UserCancelled) {
      return { success: false, tier: entitlementsStore.getTier(), cancelled: true };
    }
    console.warn('[purchases] purchase failed', err);
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: err.message ?? 'Purchase failed',
    };
  }
}

/**
 * Wait until the entitlements store reports a tier matching `expected` (or
 * any tier upgrade), up to `timeoutMs`. Returns when the listener has
 * processed the new transaction so the caller can read a fresh tier.
 */
function waitForTier(expected: Tier, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    if (entitlementsStore.getTier() === expected) return resolve();
    const t = setTimeout(() => {
      unsub();
      resolve();
    }, timeoutMs);
    const unsub = entitlementsStore.subscribe(() => {
      if (entitlementsStore.getTier() === expected) {
        clearTimeout(t);
        unsub();
        resolve();
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────
// Restore
// ────────────────────────────────────────────────────────────────────────

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!connectionReady) {
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: 'Store is not available.',
    };
  }
  try {
    const tier = await syncFromAvailablePurchases();
    return { success: true, tier };
  } catch (e) {
    const err = e as Error;
    console.warn('[purchases] restore failed', err);
    return {
      success: false,
      tier: entitlementsStore.getTier(),
      error: err.message ?? 'Restore failed',
    };
  }
}

async function syncFromAvailablePurchases(): Promise<Tier> {
  const purchases = await getAvailablePurchases();
  const tier = highestTierFrom(purchases);
  await entitlementsStore.setTier(tier);
  return tier;
}

function highestTierFrom(purchases: Purchase[]): Tier {
  let best: Tier = 'lite';
  for (const p of purchases) {
    // Apple 2.1(b) defense: only count fully purchased transactions.
    if (p.purchaseState !== 'purchased') continue;
    const t = productIdToTier(p.productId);
    if (t === 'vault_pro') return 'vault_pro';
    if (t === 'vault' && best === 'lite') best = 'vault';
  }
  return best;
}

// ────────────────────────────────────────────────────────────────────────
// Transaction listener — the ONLY place that grants entitlement.
// ────────────────────────────────────────────────────────────────────────

async function handleTransactionUpdate(purchase: Purchase): Promise<void> {
  try {
    // ────────────────────────────────────────────────────────────────────
    // Apple 2.1(b) defense: ONLY grant entitlement on a fully purchased
    // transaction. expo-iap's listener also fires for 'pending' (Ask-to-Buy,
    // SCA challenges) and 'unknown' states. Granting on those is the silent-
    // grant bug Apple rejected in build 17. Do not change this gate.
    // ────────────────────────────────────────────────────────────────────
    if (purchase.purchaseState !== 'purchased') {
      if (__DEV__) {
        console.log('[purchases] skip non-purchased state:', purchase.purchaseState, purchase.productId);
      }
      return;
    }
    const tier = productIdToTier(purchase.productId);
    if (tier !== 'lite') {
      const current = entitlementsStore.getTier();
      const next = pickHigher(current, tier);
      await entitlementsStore.setTier(next);
    }
    await finishTransaction({ purchase, isConsumable: false });
  } catch (e) {
    console.warn('[purchases] handleTransactionUpdate failed', e);
  }
}

function pickHigher(a: Tier, b: Tier): Tier {
  const rank: Record<Tier, number> = { lite: 0, vault: 1, vault_pro: 2 };
  return rank[a] >= rank[b] ? a : b;
}

// ────────────────────────────────────────────────────────────────────────
// Subscription management surface area — used by /subscription screen.
// ────────────────────────────────────────────────────────────────────────

export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
  const base: SubscriptionSummary = {
    live: connectionReady,
    productId: null,
    periodType: null,
    expiresAt: null,
    willRenew: null,
    store: Platform.OS === 'ios' ? 'APP_STORE' : 'PLAY_STORE',
  };

  if (!connectionReady) return base;

  try {
    const allPurchases = await getAvailablePurchases();
    // Apple 2.1(b) defense: only show fully purchased subscriptions in the
    // management screen. Pending/unknown shouldn't display as active.
    const purchases = allPurchases.filter(p => p.purchaseState === 'purchased');
    if (purchases.length === 0) return base;

    const ranked = [...purchases].sort((a, b) => {
      const ta = productIdToTier(a.productId);
      const tb = productIdToTier(b.productId);
      const rank: Record<Tier, number> = { lite: 0, vault: 1, vault_pro: 2 };
      return rank[tb] - rank[ta];
    });
    const top = ranked[0] as Purchase;

    // Narrow to PurchaseIOS only when this purchase came from the App Store;
    // expirationDateIOS doesn't exist on the Android variant.
    const iosFields = top.store === 'apple' ? (top as PurchaseIOS) : null;
    const expiresAt = iosFields?.expirationDateIOS
      ? new Date(iosFields.expirationDateIOS).toISOString()
      : null;

    return {
      live: true,
      productId: top.productId,
      periodType: 'normal',
      expiresAt,
      willRenew: top.isAutoRenewing,
      store: base.store,
    };
  } catch (e) {
    console.warn('[purchases] getSubscriptionSummary failed', e);
    return base;
  }
}

export async function openManageSubscriptions(): Promise<boolean> {
  const { Linking } = require('react-native');
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

/** True when we have a working store connection. Used by /subscription
 *  screen to decide whether to show "billing details". */
export function purchasesLiveMode(): boolean {
  return connectionReady;
}

export { FALLBACK_PRICES };
