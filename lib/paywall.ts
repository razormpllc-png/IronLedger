// Imperative paywall trigger.
// Any screen calls showPaywall({ mode, feature?, reason? }) and the router
// opens the paywall modal with the appropriate copy.

import { router } from 'expo-router';
import { entitlementsStore, hasFeature } from './entitlements';
import type { Feature } from './entitlements';

export type PaywallMode = 'preview' | 'soft_nudge' | 'hard_cap' | 'contextual';

// Specific reasons a hard cap fires — drives headline copy on the paywall.
export type HardCapReason = 'firearm_limit' | 'accessory_limit' | 'photo_limit';

export interface PaywallParams {
  mode: PaywallMode;
  feature?: Feature;         // for contextual mode
  reason?: HardCapReason;    // for hard_cap mode
}

export function showPaywall(params: PaywallParams): void {
  const { mode, feature, reason } = params;
  router.push({
    pathname: '/paywall',
    params: {
      mode,
      ...(feature ? { feature } : {}),
      ...(reason ? { reason } : {}),
    },
  });
}

/**
 * Trigger 4 gate (spec §4.6): wrap any Pro-only action. If the user's current
 * tier grants the feature, `run` executes. Otherwise the contextual paywall
 * opens with copy matched to the feature and — when the user has gone through
 * onboarding — audience-aware framing.
 *
 *   runProGated('insurance_export', () => router.push('/insurance'));
 *
 * Returns `true` if the action ran, `false` if the paywall was shown.
 */
export function runProGated(feature: Feature, run: () => void): boolean {
  const tier = entitlementsStore.getTier();
  if (hasFeature(tier, feature)) {
    run();
    return true;
  }
  showPaywall({ mode: 'contextual', feature });
  return false;
}
