---
name: eas-build
description: "iOS build and TestFlight submission workflow for Iron Ledger. Use this skill whenever the user wants to: push a new build, submit to TestFlight, deploy to App Store Connect, run an EAS build, check build status or logs, fix a failed build, or prepare a release for testers. Also trigger when the user says 'build', 'submit', 'deploy', 'push to testers', 'TestFlight', 'App Store Connect', or 'new version'. This skill covers the full pipeline from code commit through TestFlight availability."
---

# EAS Build & TestFlight Submission

This skill captures the repeatable workflow for shipping new Iron Ledger builds to TestFlight testers via Expo Application Services (EAS).

## Important: Sandbox Limitation

Edits made in the Cowork sandbox mount (`/sessions/.../mnt/IronLedger`) do NOT reliably sync back to the user's Mac. When fixes involve code changes, always provide the user with terminal commands (sed, perl, or a shell script) to run directly on their Mac at `~/IronLedger/`. Never assume sandbox edits will reach the actual build.

## Project Details

- **App name:** Iron Ledger
- **Bundle ID:** com.razormp.ironledger
- **EAS Project ID:** 1c6912af-0bf2-452c-879a-f90d0265651d
- **GitHub repo:** https://github.com/razormpllc-png/IronLedger.git (remote: origin, branch: main)
- **Local path on Mac:** ~/IronLedger/
- **Stack:** React Native + Expo SDK 54, expo-router, expo-sqlite
- **EAS profiles:** `development` (dev client), `preview` (internal), `production` (App Store + auto-increment)

## The Build Pipeline

### Step 1: Verify the code compiles locally

Before pushing, always have the user confirm Metro bundler starts clean:

```bash
cd ~/IronLedger
npx expo start
```

Look for: no red errors in the terminal. The user can press `q` to quit once confirmed.

If there are errors, fix them first. Common issues:
- **JSX tag mismatches** — opening `<FormScrollView>` with closing `</ScrollView>` or vice versa. Check that every custom component's opening and closing tags match.
- **Missing packages** — "Unable to resolve X" errors. Fix with `npx expo install <package-name>`.
- **Ternary/syntax errors** — malformed JSX ternaries. Check bracket/paren matching.

### Step 2: Stage, commit, and push

```bash
cd ~/IronLedger
git add -A
git commit -m "description of changes"
git push origin main
```

Use descriptive commit messages. If there are multiple logical changes, consider separate commits. The user prefers `git add -A` for simplicity — they are a solo developer, not a team workflow.

### Step 3: Trigger the EAS build with auto-submit

For TestFlight (production profile, auto-submits to App Store Connect):

```bash
eas build --platform ios --auto-submit
```

This does three things:
1. Uploads the project to EAS build servers
2. Builds the iOS binary in the cloud
3. Automatically submits the resulting `.ipa` to App Store Connect

The build takes roughly 10-20 minutes. The terminal will show a URL to track progress on expo.dev.

**Profile notes:**
- `--profile production` is the default and includes `autoIncrement: true` (bumps build number automatically)
- Do NOT use `--profile preview` for TestFlight — that's for internal/ad-hoc distribution only
- The `--auto-submit` flag requires App Store Connect credentials to be configured in EAS (already set up)

### Step 4: Monitor the build

Check build status:

```bash
eas build:list --platform ios --limit 5
```

Or check a specific build's logs if it fails:

```bash
eas build:list --platform ios --limit 1 --json
```

Then grab the `logsUrl` from the JSON output and curl it to see what went wrong:

```bash
curl -s "<logsUrl>" | tail -50
```

### Step 5: Handle build failures

The most common failure point is the **Bundle JavaScript** phase — this means there's a syntax error in the code that Metro catches during bundling. The error message will include the file name and line number.

**Typical failure pattern:**
1. Build starts, installs deps, runs through Xcode phases
2. Fails at "Bundle JavaScript" with a SyntaxError
3. The error shows the exact file and line: `SyntaxError: /Users/expo/workingdir/build/app/some-file.tsx: ...`

**To fix:**
1. Read the error message for the file and line number
2. Note: the path `/Users/expo/workingdir/build/` maps to the project root — so `app/some-file.tsx` is the local file
3. Provide the user with a targeted fix command (sed/perl) to run on their Mac
4. Have them commit, push, and rebuild

**When providing fix commands, always use line-targeted replacements** (e.g., `sed -i '' '622s|old|new|'`) rather than global replacements (`sed -i '' 's|old|new|g'`) to avoid over-replacement in files that reuse similar patterns.

### Step 6: TestFlight availability

Once the build succeeds and auto-submits:
1. It appears in App Store Connect under TestFlight within a few minutes
2. Apple runs a brief automated review (usually <1 hour for TestFlight)
3. Once processed, testers in the TestFlight group get a notification to update
4. If there's a "What to Test" field to fill in, the user can paste release notes there

## Tester Update Notes

When preparing release notes for testers, create a markdown file at `docs/tester-update-vX.X.md` with:
- Version number and date
- What's new (features added)
- What's fixed (bugs resolved)
- Known issues (if any)
- How to test (specific things to try)

## Quick Reference Commands

```bash
# Full pipeline (run on Mac)
cd ~/IronLedger
npx expo start                          # verify clean compile, then quit
git add -A && git commit -m "message"   # commit changes
git push origin main                    # push to GitHub
eas build --platform ios --auto-submit  # build + submit to TestFlight

# Diagnostics
eas build:list --platform ios --limit 5         # recent builds
eas build:list --platform ios --limit 1 --json  # latest build details + log URL
eas whoami                                       # verify EAS login
eas project:info                                 # verify project config
```
