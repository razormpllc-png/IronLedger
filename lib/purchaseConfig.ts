// RevenueCat configuration for Iron Ledger.
// ---------------------------------------------------------------------------
// HOW TO ACTIVATE REAL PURCHASES
// ---------------------------------------------------------------------------
// 1. Create a RevenueCat project at https://app.revenuecat.com
// 2. Create an App Store Connect app (Iron Ledger) and a Google Play Console
//    app if/when shipping Android, and configure IAP products there.
// 3. In RevenueCat:
//    - Add an "Apple App Store" app, upload the in-app purchase shared secret,
//      and link the app's bundle ID.
//    - Add a "Google Play Store" app when needed.
//    - Create three entitlements: `pro` (monthly + annual) and `founders`
//      (non-consumable lifetime). Note: both `pro` and `founders` unlock the
//      same pro feature set. We use a separate entitlement so we can show
//      the FOUNDER badge and lock out founders restockings after the cap.
//    - Build an Offering named "default" containing three packages:
//        monthly      -> annual pro monthly plan
//        annual       -> annual pro annual plan (default highlighted)
//        lifetime     -> founders lifetime non-consumable
// 4. Copy the API keys below. Public SDK keys only — never service keys.
// 5. `npm install react-native-purchases` and run `npx expo prebuild --clean`
//    to regenerate the native projects. RevenueCat requires a dev build; it
//    does not work in Expo Go.
// 6. Flip PURCHASES_ENABLED to true below.
// ---------------------------------------------------------------------------

// Flipped to true once keys are configured and `react-native-purchases` is
// installed. Also auto-activates if the caller sets EXPO_PUBLIC_PURCHASES=1
// at build time — useful for staging/prod builds without editing source.
export const PURCHASES_ENABLED: boolean =
  process.env.EXPO_PUBLIC_PURCHASES === '1' ||
  process.env.EXPO_PUBLIC_PURCHASES === 'true' ||
  false;

// Public SDK keys. Never check in service keys. EXPO_PUBLIC_* env vars are
// inlined at build time, so CI can provide per-environment keys without the
// repo carrying them. Local dev can leave these blank.
export const REVENUECAT_API_KEYS = {
  ios: process.env.EXPO_PUBLIC_RC_IOS_KEY ?? '', // appl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  android: process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '', // goog_XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
};

// Entitlement identifiers configured in the RevenueCat dashboard.
export const ENTITLEMENT_IDS = {
  pro: 'pro',
  founders: 'founders',
} as const;

// Package identifiers inside the default Offering.
export const PACKAGE_IDS = {
  monthly: '$rc_monthly',
  annual: '$rc_annual',
  lifetime: '$rc_lifetime',
} as const;

export type PackageKey = keyof typeof PACKAGE_IDS;

// Fallback display pricing used when offerings have not loaded yet or when
// purchases are disabled. Real localized prices replace these at runtime.
export const FALLBACK_PRICES: Record<PackageKey, string> = {
  monthly: '$4.99 / month',
  annual: '$34.99 / year',
  lifetime: '$79.99 once',
};

// ---------------------------------------------------------------------------
// FOUNDERS COUNTER
// ---------------------------------------------------------------------------
// Cloudflare Worker that tracks claimed Founders lifetime slots. Empty string
// = stub mode (paywall shows static "First 1,000 customers" line). When
// populated, paywall polls this endpoint on mount to show remaining count
// and disables the CTA when sold out. See FOUNDERS_SETUP.md.
export const FOUNDERS_COUNTER_URL: string =
  process.env.EXPO_PUBLIC_FOUNDERS_COUNTER_URL ?? '';

// Total Founders slots available. Worker returns `claimed`; the client
// computes `remaining = cap - claimed` if the worker does not include it.
export const FOUNDERS_CAP = 1000;
