# RevenueCat Setup — Iron Ledger

This app's purchase flow is scaffolded end-to-end but runs in **stub mode** by default. In stub mode the paywall flips the local tier without any real IAP charge, which is ideal for building out downstream gates. To ship real purchases, complete every step below.

## 1. App Store Connect (iOS)

Create the app, then under **Features → In-App Purchases** add:

| RevenueCat package | Product ID (recommended)        | Type                    |
| ------------------ | -------------------------------- | ----------------------- |
| `$rc_monthly`      | `com.razormp.ironledger.pro.m`   | Auto-renewable (1 mo)   |
| `$rc_annual`       | `com.razormp.ironledger.pro.y`   | Auto-renewable (1 yr)   |
| `$rc_lifetime`     | `com.razormp.ironledger.founders`| Non-consumable          |

Set prices in your preferred tier. The app reads localized prices from RevenueCat at runtime, so display is automatic.

Generate an **App Store In-App Purchase shared secret** and keep it handy for step 3.

## 2. Google Play Console (Android — when ready)

Mirror the same three products with identical IDs. Auto-renewing subscriptions for monthly/annual, managed product for lifetime.

## 3. RevenueCat dashboard

- Create a project named "Iron Ledger".
- Add **Apple App Store** app: paste the bundle ID and the App Store shared secret.
- Add **Google Play Store** app when Android is ready.
- Go to **Entitlements** and create two:
  - `pro` — attach the monthly and annual products.
  - `founders` — attach the lifetime product. Also attach `pro` as an included entitlement so Founders users pass any `pro` gate.
- Go to **Offerings** and create one offering named **default** (marked Current). Add three packages:
  - Monthly (`$rc_monthly`) — attach the monthly products.
  - Annual (`$rc_annual`) — attach the annual products.
  - Lifetime (`$rc_lifetime`) — attach the lifetime products.
- Copy both **Public SDK keys** (iOS `appl_…`, Android `goog_…`).

## 4. Wire keys into the app

Edit `lib/purchaseConfig.ts`:

```ts
export const PURCHASES_ENABLED = true;

export const REVENUECAT_API_KEYS = {
  ios: 'appl_YOUR_KEY_HERE',
  android: 'goog_YOUR_KEY_HERE',
};
```

If the product IDs inside RevenueCat differ from the defaults, update `PACKAGE_IDS` in the same file. Entitlement IDs match the names you used in the RC dashboard; keep `pro` and `founders` unless you changed them.

## 5. Install the SDK and rebuild

```bash
npm install react-native-purchases
npx expo prebuild --clean
npx expo run:ios         # or run:android
```

RevenueCat is a native module, so Expo Go will not work — a dev build is required. After prebuild you can continue iterating with `npx expo start --dev-client`.

## 6. Test

Create a sandbox tester in App Store Connect. Log the iPhone into **Settings → App Store → Sandbox Account**. Run the app, hit a paywall, select a plan, confirm. The paywall will auto-dismiss and the tier will flip based on RevenueCat's customer entitlements.

Restore flow: sign the same Apple ID into a fresh install, hit the paywall, tap **Restore purchases**. You should see a confirmation alert and the paywall should dismiss.

## Architecture notes

- `lib/purchases.ts` is the only thing that imports `react-native-purchases`. It uses a `require` guard so the app compiles cleanly even when the package isn't installed yet.
- RevenueCat's `customerInfo.entitlements.active` is the source of truth for tier. The local `entitlementsStore` mirrors it. If you cancel in sandbox, RC pushes an update and the local tier drops back to `lite` automatically.
- The dev tier override on the dashboard still works even when `PURCHASES_ENABLED=true`, but any RC customer-info push will overwrite a manual flip — that's intentional.
- Founders entitlement beats Pro in the reducer, so a user who holds both sees `founders`.
