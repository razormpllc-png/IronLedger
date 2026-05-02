// IAP configuration for Iron Ledger.
// ───────────────────────────────────────────────────────────────────────
// Product IDs MUST match what's configured in App Store Connect under
// Features → In-App Purchases → Subscriptions. Iron Ledger uses one
// subscription group ("Iron Ledger") with 4 levels:
//   Level 1: Vault Monthly
//   Level 2: Vault Yearly
//   Level 3: Vault Pro Monthly
//   Level 4: Vault Pro Yearly
// All 4 in the same group means upgrades / downgrades / period swaps
// are free crossgrades for the user.
// ───────────────────────────────────────────────────────────────────────

import type { Tier } from './entitlements';

/** Stable keys used by paywall UI to refer to specific products. */
export type ProductKey =
  | 'vault_monthly'
  | 'vault_yearly'
  | 'vault_pro_monthly'
  | 'vault_pro_yearly';

/** App Store Connect product IDs. Verified against ASC on 2026-05-02. */
export const PRODUCT_IDS: Record<ProductKey, string> = {
  vault_monthly:     'com.razormp.ironledger.vault.monthly',
  vault_yearly:      'com.razormp.ironledger.vault.yearly',
  vault_pro_monthly: 'com.razormp.ironledger.vaultpro.monthly',
  vault_pro_yearly:  'com.razormp.ironledger.vaultpro.yearly',
};

/** Reverse map for quick lookup. */
const PRODUCT_ID_TO_KEY: Record<string, ProductKey> = Object.fromEntries(
  Object.entries(PRODUCT_IDS).map(([k, v]) => [v, k as ProductKey])
);

/** Map a raw store product ID to the entitlement tier it grants. Returns
 *  'lite' for any unknown product (defensive — should never happen if the
 *  catalog matches PRODUCT_IDS, but we don't want a typo to silently grant
 *  the wrong tier). */
export function productIdToTier(productId: string): Tier {
  const key = PRODUCT_ID_TO_KEY[productId];
  if (!key) return 'lite';
  if (key === 'vault_pro_monthly' || key === 'vault_pro_yearly') return 'vault_pro';
  if (key === 'vault_monthly' || key === 'vault_yearly') return 'vault';
  return 'lite';
}

/** Static prices used when StoreKit hasn't returned the catalog yet. Real
 *  localized prices replace these. */
export const FALLBACK_PRICES: Record<ProductKey, string> = {
  vault_monthly:     '$2.99 / month',
  vault_yearly:      '$24.99 / year',
  vault_pro_monthly: '$4.99 / month',
  vault_pro_yearly:  '$39.99 / year',
};
