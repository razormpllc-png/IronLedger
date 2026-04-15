/**
 * External URLs for Iron Ledger.
 *
 * Hosted under razormp.com/ironledger/* for now — funnels users to the main
 * site while keeping Iron Ledger discoverable at its own subpath. If we ever
 * flip to a dedicated ironledger.com, a single 301 at the root of razormp.com
 * swaps everything without touching app code. Apple requires support +
 * privacy URLs for App Store review; terms is required once auto-renewing
 * subscriptions ship.
 */

import { Linking } from 'react-native';

export const LINKS = {
  website: 'https://www.razormp.com/ironledger',
  support: 'https://www.razormp.com/ironledger/support',
  privacy: 'https://www.razormp.com/ironledger/privacy',
  terms: 'https://www.razormp.com/ironledger/terms',
  // App Store listing — App ID is set once the app goes live. Placeholder
  // app-store URL works on device because iOS opens the store app directly.
  appStore: 'https://apps.apple.com/app/id6762285021',
  // Contact fallback (mailto) if the support page is down.
  supportEmail: 'mailto:support@razormp.com?subject=Iron%20Ledger%20Support',
} as const;

/** Open an external URL in the device's default browser. Swallows failures
 *  silently so UI buttons don't throw — worst case the user sees nothing
 *  happen and can retry. */
export async function openLink(url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  } catch {
    // noop — link opening shouldn't crash the app
  }
}
