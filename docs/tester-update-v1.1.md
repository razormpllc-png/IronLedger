# Iron Ledger v1.1 — TestFlight Update

**Build Date:** April 22, 2026
**What to test:** This build includes every remaining v1.1 feature. It's a big one — please focus on the areas you use most, but everything listed below is new or changed.

---

## New Features

### Competition Module
A full match tracking system lives under **Range Log → Matches** (new third tab). Log USPSA, IDPA, Steel Challenge, and Outlaw matches with:

- Match type selection with division and classification chips that adapt per discipline
- Overall and division placement, hit factor, score
- Firearm and ammo linking from your armory and supply
- PractiScore URL field (opens in Safari)
- Per-stage score entry with A/C/D/M hit counts (USPSA), points down (IDPA), time, hit factor, penalties, and procedurals
- Squad notes and match notes

**How to test:** Go to Range Log → tap "Matches" → tap + to create a match → save → add stages from the detail screen. Long-press a match or stage to delete.

### Estate Planning — Configurable Output
Estate export now goes through a configuration screen where you choose what to include:

- Toggle entire categories on/off (Firearms, Suppressors, Ammunition)
- Select/deselect individual items within each category
- Select All / Deselect All at the top
- Item count shown on the Generate button
- PDF output only includes your selections

**How to test:** Dashboard → Estate Planning → you should land on the new config screen instead of immediately generating a PDF.

### Bill of Sale PDF
Generate a professional Bill of Sale document when transferring a firearm out.

- Available from the Dispose screen (after filling transfer details) and from the firearm detail screen's disposition card
- Pre-fills seller info, firearm details (make/model/serial/caliber), and transaction date
- Includes signature blocks and legal disclaimer
- Shares as PDF via the system share sheet

**How to test:** Go to a firearm → Dispose → fill in the form → tap "Generate Bill of Sale." Also check the firearm detail screen for any disposed firearm — the button appears below the disposition card.

### Bulk Import (CSV/Spreadsheet)
Import firearms from a CSV or TSV file with a three-step flow:

- Step 1: Pick a file from your device
- Step 2: Map columns — the app auto-guesses which columns are make, model, caliber, serial, etc. You can override any mapping
- Step 3: Preview cards for every row before importing

**How to test:** Armory → tap + → "Import from Spreadsheet." Try a CSV with columns like Make, Model, Caliber, Serial Number, Purchase Price.

### Ammo — Reloading Load Data
The ammo add/edit screens now have a **Factory / Handload** toggle. Selecting Handload reveals load data fields:

- Powder (brand, type, charge weight)
- Bullet (brand, weight, type)
- Brass (brand, times fired)
- Primer (brand/type)
- COAL and CBTO measurements
- Velocity, SD, ES from chrono
- Group size and load development notes

**How to test:** Supply → + ammo → toggle to "Handload" → fill in load data → save → verify it shows on the detail/edit screen.

### Insurance Report — Selectable Items
The insurance export now lets you choose which firearms to include:

- Select All / Deselect All toggle at the top
- Tap any firearm card to check/uncheck it (unchecked items dim)
- Summary shows "X / Y Selected"
- PDF and text exports only include selected firearms

**How to test:** Dashboard → Insurance Report → try selecting/deselecting items → export as PDF and verify only selected items appear.

### Personal vs Business Firearm Designation
When the FFL module is active, add/edit firearm screens now show an **Ownership** section:

- Personal / Business chip toggle
- Defaults to Personal
- Shows on firearm detail screen under Acquisition
- Filters can distinguish personal collection from FFL inventory

**How to test:** Add or edit a firearm → look for the OWNERSHIP section above Acquisition → toggle between Personal and Business → save → check the detail screen.

### DOPE Card Weather Auto-Fill
DOPE card conditions field now has a **📍 Auto-Fill** button that pulls current weather from your location:

- Temperature, humidity, wind speed/direction, and conditions
- Appends to existing text (doesn't overwrite)
- Uses Open-Meteo API (free, no key needed) + device location

**How to test:** Open or create a DOPE card → tap "📍 Auto-Fill" next to CONDITIONS → grant location permission → weather should populate. **Note:** Requires `expo-location` — run `npx expo install expo-location` if not already installed.

### Suppressor End Cap Tracking
Add/edit suppressor screens now include end cap options:

- Type chips: Flat, Angled, Flash Hider, Sacrificial, None
- End cap notes field
- Shows as a tag on Armory suppressor cards (when not "None")

**How to test:** Add or edit a suppressor → select an end cap type → save → check the Armory card for the end cap tag.

---

## Bug Fixes & UX Improvements

### Keyboard No Longer Blocks Bottom Fields
All 17 form screens now use a new `FormScrollView` component with native keyboard inset handling. Fields near the bottom of the screen stay visible when the keyboard opens.

### Auto-Save Drafts
All add screens now auto-save your form data as you type. If you navigate away, get a phone call, or the app backgrounds, your draft is preserved. When you return, you'll be prompted to resume where you left off.

### Date Overflow on Range Log
The "Last Trip" stat on the Range Log screen no longer overflows its container. Dates now display in abbreviated format (e.g., "Apr 22, 2026" instead of "April 22, 2026").

### Onboarding Prompt Updated
First-launch welcome screen now says "Where would you like to start?" instead of "What brings you here..."

### Armory — Color-Coded Type Badges
Firearm cards on the Armory screen now have color-coded type badges: blue for Handgun, orange for Rifle, purple for Shotgun. Makes it easy to scan your collection at a glance.

### Armory — Disposition Badges & Filter
Transferred/disposed firearms show a colored status badge (e.g., "SOLD", "TRANSFERRED") with dimmed styling. A status filter row below the type chips defaults to "In Collection" so disposed items stay out of the way.

### Round Count Display
Each firearm now shows a cumulative round count on the detail screen and as subtle text on the Armory card. Derived from range session logs.

### Tap-to-Expand Photos
Tapping a photo on the firearm detail screen now opens a full-screen viewer with navigation arrows.

---

## Known Issues

- **TrueGunValue link:** The "Look up on TrueGunValue" link on firearm screens may not open in the Simulator. This works on physical devices — it's a Simulator networking limitation.
- **Weather auto-fill:** Requires `expo-location` to be installed. If you get a module error, run `npx expo install expo-location`.

---

## What to Focus On

1. **Competition Module** — This is the biggest new feature. Try the full flow: create a match, add stages, edit them, delete one, check the match list on the Range tab.
2. **Estate Planning config** — Make sure the selection screen works correctly and the PDF output matches your selections.
3. **Auto-save** — Partially fill any add form, swipe back or background the app, then re-open. Your draft should be there.
4. **Bill of Sale** — Generate one and check the PDF looks correct with all fields populated.

Report any issues via TestFlight feedback or the usual channels.
