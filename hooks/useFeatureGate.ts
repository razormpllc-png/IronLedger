// Legacy compatibility shim. Original useFeatureGate was deleted in the
// expo-iap migration but two screens still import it. Re-implements tier-
// based gating using the current useEntitlements + showPaywall flow.

import { useEffect } from 'react';
import { useEntitlements } from '../lib/useEntitlements';
import { showPaywall } from '../lib/paywall';
import type { Tier } from '../lib/entitlements';

type LegacyTier = 'lite' | 'vault' | 'vaultpro' | 'vault_pro';

const TIER_ORDER: Record<Tier, number> = {
  lite: 0,
  vault: 1,
  vault_pro: 2,
};

function normalize(t: LegacyTier): Tier {
  if (t === 'vaultpro') return 'vault_pro';
  return t as Tier;
}

export function useFeatureGate(requiredTier: LegacyTier): void {
  const ent = useEntitlements();
  useEffect(() => {
    if (!ent.loaded) return;
    const required = normalize(requiredTier);
    if (TIER_ORDER[ent.tier] < TIER_ORDER[required]) {
      showPaywall({ mode: 'soft_nudge' });
    }
  }, [ent.loaded, ent.tier, requiredTier]);
}
