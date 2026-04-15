// Deep-link router — maps incoming `ironledger://...` URLs to in-app
// screens. Called from _layout.tsx on cold start (getInitialURL) and on
// every warm-state URL event (addEventListener).
//
// URLs are emitted by the iOS Home Screen widgets (ios/IronLedgerWidgets)
// and by any external `ironledger://` link (push notifications in the
// future, share sheet intents, etc.). Keep the route table co-located
// with the widget targets so it's obvious where a given path lands.

import { router } from 'expo-router';

/**
 * Known widget deep links. Keep in sync with:
 *   ios/IronLedgerWidgets/Form4Widget.swift  → ironledger://form-4-tracker
 *   ios/IronLedgerWidgets/BatteryWidget.swift → ironledger://batteries
 *   ios/IronLedgerWidgets/AmmoWidget.swift    → ironledger://supply
 *   ios/IronLedgerWidgets/ArmoryWidget.swift  → ironledger://   (root)
 */
const ROUTES: Record<string, string> = {
  'form-4-tracker': '/form-4-tracker',
  'batteries': '/batteries',
  'supply': '/(tabs)/supply',
  'armory': '/(tabs)',
  'range': '/(tabs)/range',
};

/**
 * Parse an `ironledger://<host>[/path]` URL and return the app route it
 * should navigate to. Returns null for unknown hosts (we no-op rather
 * than risk pushing users to an undefined route).
 *
 * Accepts a couple of URL shapes so cold-start and warm-state listeners
 * can pass the string through verbatim:
 *   ironledger://form-4-tracker
 *   ironledger://form-4-tracker/
 *   ironledger://form-4-tracker?src=widget
 *   ironledger:///form-4-tracker   (some iOS versions normalise like this)
 */
export function resolveDeepLink(url: string): string | null {
  if (!url) return null;
  // Strip the scheme so we can treat the remainder as `host[/path]`.
  const afterScheme = url.replace(/^ironledger:\/\//i, '');
  // Drop any query string or fragment — we don't use params today.
  const noQuery = afterScheme.split(/[?#]/)[0];
  // Collapse leading slashes (ironledger:/// form).
  const trimmed = noQuery.replace(/^\/+/, '');
  // Empty path → armory root. Matches the Armory widget's widgetURL.
  if (trimmed === '') return ROUTES.armory;
  // First path segment is the route key.
  const [key] = trimmed.split('/');
  return ROUTES[key] ?? null;
}

/**
 * Navigate the app to the given URL, if we can resolve it. Returns
 * true if a route was pushed, false otherwise — the caller can decide
 * whether to log unknown URLs.
 */
export function handleDeepLink(url: string): boolean {
  const target = resolveDeepLink(url);
  if (!target) {
    console.warn('[deepLinks] ignoring unknown URL:', url);
    return false;
  }
  // `push` rather than `replace` so the user can hit back to the
  // armory/home from the deep-linked screen.
  router.push(target as any);
  return true;
}
