# iOS Home Screen Widgets — Setup Guide

Four widgets: **Form 4 Tracker**, **Battery Status**, **Ammo Stock**, **Armory**.
All source written; below are the one-time Xcode + Apple Developer portal steps.

---

## 1. Apple Developer portal — App Group

1. Open https://developer.apple.com → Certificates, Identifiers & Profiles.
2. **Identifiers → App Groups → +** → name `Iron Ledger Shared`,
   identifier **`group.com.razormp.ironledger`** (exact match — used in
   every entitlements file and in `SharedDefaults.groupId`).
3. **Identifiers → App IDs → `com.razormp.ironledger`** → enable
   **App Groups** and select the group above.
4. Create a new **App ID** for the widget extension:
   `com.razormp.ironledger.IronLedgerWidgets` — enable App Groups and
   select the same group.
5. Regenerate / redownload both provisioning profiles.

## 2. Xcode — add the widget target

Open `ios/IronLedger.xcworkspace`.

1. **File → New → Target → Widget Extension**. Name: `IronLedgerWidgets`.
   Uncheck "Include Configuration Intent". Finish.
2. Xcode creates a default folder with sample files — **delete the
   generated Swift/Info.plist/entitlements** Xcode just created. The real
   sources already live at `ios/IronLedgerWidgets/`.
3. In the target's **Build Phases → Compile Sources**, make sure these
   files are listed (drag them in if not):
   - `Payload.swift`
   - `Provider.swift`
   - `Theme.swift`
   - `Form4Widget.swift`
   - `BatteryWidget.swift`
   - `AmmoWidget.swift`
   - `ArmoryWidget.swift`
   - `IronLedgerWidgetsBundle.swift`
4. Set the target's **Info.plist** to `ios/IronLedgerWidgets/Info.plist`
   (General → Deployment Info → iOS Deployment Target **14.0+**, recommend 17.0).
5. **Signing & Capabilities → + Capability → App Groups** → check
   `group.com.razormp.ironledger`. Verify
   `CODE_SIGN_ENTITLEMENTS = IronLedgerWidgets/IronLedgerWidgets.entitlements`.

## 3. Xcode — main app target updates

Select the **IronLedger** target (main app):

1. **Signing & Capabilities → + Capability → App Groups** → check
   `group.com.razormp.ironledger`. Confirm
   `CODE_SIGN_ENTITLEMENTS = IronLedger/IronLedger.entitlements` (already
   populated).
2. **Build Phases → Compile Sources** → add:
   - `IronLedger/IronLedgerWidgets.swift`
   - `IronLedger/IronLedgerWidgets.m`
3. Verify the bridging header is set
   (Build Settings → Objective-C Bridging Header → `IronLedger/IronLedger-Bridging-Header.h`).

## 4. Verify

1. Build & run on a real device (widgets render on the simulator but App
   Group writes sometimes silently fail — always smoke-test on hardware).
2. Open the app → any tab focus triggers a `syncWidgets()` write.
3. Long-press Home Screen → **+** → search "Iron Ledger" → you should
   see all four widgets with small + medium families.
4. If a widget shows placeholder data ("No pending stamps" when you
   expect one), the App Group likely isn't wired — double-check
   entitlements on both targets and that the group ID matches byte for
   byte everywhere.

## 5. EAS builds

Using EAS Build? Add these to `eas.json` (or use the Expo config plugin
path — I can write one if you prefer managed signing):

- `credentialsSource: remote` picks up the new provisioning profiles
  automatically on next build.
- Alternatively `eas credentials` → reconfigure iOS → select "set up a
  new adhoc/appstore profile" and EAS will regenerate with the App Group
  entitlement baked in.

## File map (already on disk)

```
ios/IronLedger/IronLedger.entitlements          # App Group added
ios/IronLedger/IronLedger-Bridging-Header.h     # RN bridge header exposed
ios/IronLedger/IronLedgerWidgets.swift          # JS-bridge NativeModule (Swift)
ios/IronLedger/IronLedgerWidgets.m              # RCT_EXTERN_MODULE shim

ios/IronLedgerWidgets/IronLedgerWidgets.entitlements
ios/IronLedgerWidgets/Info.plist
ios/IronLedgerWidgets/Payload.swift             # Shared payload model
ios/IronLedgerWidgets/Provider.swift            # TimelineProvider
ios/IronLedgerWidgets/Theme.swift               # Colors + shared bits
ios/IronLedgerWidgets/Form4Widget.swift
ios/IronLedgerWidgets/BatteryWidget.swift
ios/IronLedgerWidgets/AmmoWidget.swift
ios/IronLedgerWidgets/ArmoryWidget.swift
ios/IronLedgerWidgets/IronLedgerWidgetsBundle.swift  # @main bundle

lib/widgetData.ts                               # Payload builder
lib/widgetSync.ts                               # JS → native bridge (2s debounce)
```

## Additional mutation points to wire (nice-to-have follow-up)

`syncWidgets()` already fires on dashboard focus + "Replaced Today".
Good hooks to add next for sub-second freshness:

- `add-firearm.tsx` save handler
- `edit-firearm.tsx` save handler
- `add-ammo.tsx`, `edit-ammo.tsx` save + deduct flows
- `add-session.tsx` save handler
- Form 4 status transition to "Approved"
- Battery log close/replace flows

Each is a one-liner: `import { syncWidgets } from '../lib/widgetSync'`
then call `syncWidgets()` after the DB write.
