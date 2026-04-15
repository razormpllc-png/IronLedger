// React hook that exposes the current entitlements state and helpers.
// Re-renders any component when tier or onboarding state changes.

import { useSyncExternalStore } from 'react';
import {
  entitlementsStore,
  hasFeature as hasFeatureImpl,
  limitsFor,
  isProTier,
  tierLabel,
  Feature,
  Tier,
  TierLimits,
  OnboardingPath,
} from './entitlements';

// These helpers must be module-scoped (stable refs) so useSyncExternalStore
// doesn't treat them as changing on every render.
const getSnapshot = () => entitlementsStore.getSnapshot();
const subscribe = (listener: () => void) => entitlementsStore.subscribe(listener);

export interface UseEntitlementsResult {
  // State
  tier: Tier;
  onboardingPath: OnboardingPath | null;
  onboardingComplete: boolean;
  pathSpotlightDismissed: boolean;
  loaded: boolean;

  // Derived
  isPro: boolean;
  label: string;
  limits: TierLimits;

  // Checks
  has: (feature: Feature) => boolean;

  // Mutations
  setTier: (tier: Tier) => Promise<void>;
  setOnboardingPath: (path: OnboardingPath) => Promise<void>;
  setOnboardingComplete: (complete: boolean) => Promise<void>;
  dismissPathSpotlight: () => Promise<void>;

  // Dev
  devReset: () => Promise<void>;
}

export function useEntitlements(): UseEntitlementsResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    tier: snap.tier,
    onboardingPath: snap.onboardingPath,
    onboardingComplete: snap.onboardingComplete,
    pathSpotlightDismissed: snap.pathSpotlightDismissed,
    loaded: snap.loaded,

    isPro: isProTier(snap.tier),
    label: tierLabel(snap.tier),
    limits: limitsFor(snap.tier),

    has: (feature: Feature) => hasFeatureImpl(snap.tier, feature),

    setTier: (tier: Tier) => entitlementsStore.setTier(tier),
    setOnboardingPath: (path: OnboardingPath) => entitlementsStore.setOnboardingPath(path),
    setOnboardingComplete: (complete: boolean) => entitlementsStore.setOnboardingComplete(complete),
    dismissPathSpotlight: () => entitlementsStore.dismissPathSpotlight(),

    devReset: () => entitlementsStore.devReset(),
  };
}
