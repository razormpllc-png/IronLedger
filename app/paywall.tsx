// Iron Ledger paywall — Vault / Vault Pro.
//
// Two-tier subscription paywall. Vault (consumer storage tier) and Vault
// Pro (everything in Vault plus the pro toolkit). Each tier has Monthly
// and Yearly options selectable via a single period toggle at the top.
// All four products live in the same App Store Connect subscription
// group ("Iron Ledger") so upgrades / downgrades / period swaps are
// free crossgrades for the user.
//
// The actual purchase plumbing lives in lib/purchases.ts — this file
// is purely UI + state.

import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useEntitlements } from '../lib/useEntitlements';
import type { Feature, OnboardingPath } from '../lib/entitlements';
import type { PaywallMode, HardCapReason } from '../lib/paywall';
import { getOfferingPackages, purchase, restorePurchases, type PackageDisplay } from '../lib/purchases';
import type { ProductKey } from '../lib/purchaseConfig';
import { LINKS, openLink } from '../lib/links';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const SURFACE_HI = '#211A0E';
const BORDER = '#2A2A2A';
const TEXT = '#E8E6DF';
const MUTED = '#777777';

type Tier = 'vault' | 'vault_pro';
type Period = 'monthly' | 'yearly';

// ────────────────────────────────────────────────────────────────────────
// Hero copy — adapts to why the paywall opened.
// ────────────────────────────────────────────────────────────────────────

function getHero(
  mode: PaywallMode,
  reason: HardCapReason | undefined,
  feature: Feature | undefined,
  path: OnboardingPath | null,
): { eyebrow: string; headline: string; subhead: string } {
  if (mode === 'hard_cap') {
    if (reason === 'firearm_limit') {
      return {
        eyebrow: 'YOUR LITE VAULT IS FULL',
        headline: 'Keep building your collection.',
        subhead: 'Vault removes the 5-firearm cap. Vault Pro adds the full pro toolkit.',
      };
    }
    if (reason === 'accessory_limit') {
      return {
        eyebrow: 'ACCESSORY LIMIT REACHED',
        headline: 'Track every accessory.',
        subhead: 'Vault removes the 2-accessory-per-firearm cap and adds smart battery pre-fill.',
      };
    }
    if (reason === 'photo_limit') {
      return {
        eyebrow: 'ONLY ONE PHOTO ON LITE',
        headline: 'Document it all.',
        subhead: 'Vault lets you attach up to 20 photos per firearm.',
      };
    }
  }
  if (mode === 'contextual' && feature) {
    return contextualHero(feature);
  }
  if (mode === 'soft_nudge') {
    return {
      eyebrow: 'YOU’RE BUILDING YOUR VAULT',
      headline: 'Keep the momentum going.',
      subhead: 'Unlock unlimited firearms, photos, documents, and reminders before you hit the Lite cap.',
    };
  }
  return previewHero(path);
}

function contextualHero(feature: Feature): { eyebrow: string; headline: string; subhead: string } {
  const proFeatures: Feature[] = [
    'nfa_tracking', 'atf_ocr', 'insurance_export', 'ffl_bound_book',
    'dope_cards', 'range_day', 'competition_module', 'estate_export',
    'ffl_bound_book_audit',
  ];
  const isPro = proFeatures.includes(feature);

  const map: Record<Feature, { eyebrow: string; headline: string; subhead: string }> = {
    nfa_tracking: {
      eyebrow: 'NFA TRACKING IS A VAULT PRO FEATURE',
      headline: 'Stop refreshing eForms.',
      subhead: 'Track Form 1, 4, 3, 5, and 20 status, days waiting, and approval timelines.',
    },
    atf_ocr: {
      eyebrow: 'ATF FORM OCR IS A VAULT PRO FEATURE',
      headline: 'Scan it. Validate it. Done.',
      subhead: 'Vault Pro scans approved ATF forms, extracts fields, and flags mismatches automatically.',
    },
    insurance_export: {
      eyebrow: 'INSURANCE EXPORT IS A VAULT PRO FEATURE',
      headline: 'A real report for your insurer.',
      subhead: 'Export PDF, CSV, and encrypted archives with every detail your provider needs.',
    },
    ffl_bound_book: {
      eyebrow: 'FFL BOUND BOOK IS A VAULT PRO FEATURE',
      headline: 'ATF-style A&D, one tap away.',
      subhead: 'Acquisition + disposition PDF and CSV, with missing-field flags for every row.',
    },
    dope_cards: {
      eyebrow: 'DOPE CARDS ARE A VAULT PRO FEATURE',
      headline: 'Your zero. Your loads. Your data.',
      subhead: 'Build per-firearm DOPE cards across distances, conditions, and ammo.',
    },
    range_day: {
      eyebrow: 'RANGE DAY PLANNING IS A VAULT PRO FEATURE',
      headline: 'Never leave the case at home.',
      subhead: 'One-tap packing lists that pull from your inventory and log the session.',
    },
    competition_module: {
      eyebrow: 'COMPETITION MODULE IS A VAULT PRO FEATURE',
      headline: 'Score every match.',
      subhead: 'USPSA, IDPA, Steel Challenge — full match tracking with per-stage scoring.',
    },
    estate_export: {
      eyebrow: 'ESTATE PLANNING EXPORT IS A VAULT PRO FEATURE',
      headline: 'Make the handoff easy.',
      subhead: 'A configurable PDF your executor can actually use.',
    },
    ffl_bound_book_audit: {
      eyebrow: 'FFL AUDIT IS A VAULT PRO FEATURE',
      headline: 'Audit-ready in one screen.',
      subhead: 'Missing-field flags, A&D balance check, full export.',
    },
    icloud_sync: {
      eyebrow: 'iCLOUD SYNC IS A VAULT FEATURE',
      headline: 'Your iCloud. Your keys.',
      subhead: 'End-to-end encrypted sync across your Apple devices.',
    },
    ai_recognition: {
      eyebrow: 'AI RECOGNITION IS A VAULT FEATURE',
      headline: 'Snap a photo. Get a record.',
      subhead: 'On-device image recognition identifies common optics, lights, and accessories.',
    },
    razormp_content: {
      eyebrow: 'RAZORMP CONTENT IS A VAULT FEATURE',
      headline: 'Reviews and scores, right in the app.',
      subhead: 'Matched YouTube reviews and scoreboard integration for the firearms you own.',
    },
    document_storage: {
      eyebrow: 'DOCUMENT STORAGE IS A VAULT FEATURE',
      headline: 'Receipts. Registrations. ATF forms.',
      subhead: 'Store every document securely, attached to the right firearm.',
    },
    photo_gallery_full: {
      eyebrow: 'FULL PHOTO GALLERIES ARE A VAULT FEATURE',
      headline: 'Up to 20 photos per firearm.',
      subhead: 'Document condition, serials, and every angle.',
    },
    battery_reminders: {
      eyebrow: 'BATTERY REMINDERS ARE A VAULT FEATURE',
      headline: 'Never show up with a dead red dot.',
      subhead: 'Push reminders on configurable intervals.',
    },
    maintenance_reminders: {
      eyebrow: 'MAINTENANCE REMINDERS ARE A VAULT FEATURE',
      headline: 'Know when it’s time.',
      subhead: 'Round-count thresholds and cleaning intervals with push notifications.',
    },
    smart_battery_prefill: {
      eyebrow: 'SMART BATTERY PRE-FILL IS A VAULT FEATURE',
      headline: 'Add an Aimpoint. Get the battery type.',
      subhead: 'Bundled database auto-fills battery type, runtime, and replacement interval.',
    },
    unlimited_firearms: {
      eyebrow: 'UNLIMITED FIREARMS IS A VAULT FEATURE',
      headline: 'No cap on your collection.',
      subhead: 'Vault removes the 5-firearm limit.',
    },
    unlimited_accessories: {
      eyebrow: 'UNLIMITED ACCESSORIES IS A VAULT FEATURE',
      headline: 'Every rail. Every slot.',
      subhead: 'Vault removes the 2-accessory-per-firearm cap.',
    },
  };

  return map[feature] ?? {
    eyebrow: isPro ? 'VAULT PRO FEATURE' : 'VAULT FEATURE',
    headline: isPro ? 'Built for serious owners.' : 'Built for the everyday vault.',
    subhead: isPro
      ? 'NFA, DOPE, insurance, FFL, competition — every pro tool in one place.'
      : 'Unlimited firearms, photos, documents, and reminders.',
  };
}

function previewHero(path: OnboardingPath | null): { eyebrow: string; headline: string; subhead: string } {
  switch (path) {
    case 'manage_nfa': return {
      eyebrow: 'IRON LEDGER VAULT',
      headline: 'Built for NFA owners.',
      subhead: 'Vault Pro covers ATF form lifecycle, OCR validation, and wait-time tracking.',
    };
    case 'track_maintenance': return {
      eyebrow: 'IRON LEDGER VAULT',
      headline: 'Stay ahead of maintenance.',
      subhead: 'Battery reminders, round-count thresholds, and per-platform service schedules.',
    };
    case 'plan_range_days': return {
      eyebrow: 'IRON LEDGER VAULT',
      headline: 'Plan every range day.',
      subhead: 'Vault Pro adds packing lists, DOPE cards, and session logging.',
    };
    case 'protect_records':
    default: return {
      eyebrow: 'IRON LEDGER VAULT',
      headline: 'Protect every record.',
      subhead: 'Encrypted iCloud sync, document storage, and unlimited photos.',
    };
  }
}

const VAULT_BULLETS = [
  'Unlimited firearms & NFA items',
  'Unlimited range sessions',
  'Spreadsheet import',
  'Backup & restore',
  'Unlimited batteries & maintenance',
];

const VAULT_PRO_BULLETS = [
  'NFA Hub + Form 4 tracker',
  'Competition module',
  'DOPE cards',
  'Insurance PDF export',
  'Estate planning export',
  'FFL bound book audit',
];

export default function PaywallScreen() {
  const router = useRouter();
  const ent = useEntitlements();
  const params = useLocalSearchParams<{ mode?: string; feature?: string; reason?: string }>();
  const mode = (params.mode as PaywallMode) || 'preview';
  const feature = params.feature as Feature | undefined;
  const reason = params.reason as HardCapReason | undefined;
  const hero = getHero(mode, reason, feature, ent.onboardingPath);

  const [period, setPeriod] = useState<Period>('yearly');
  const [selectedTier, setSelectedTier] = useState<Tier>('vault_pro');

  const [packages, setPackages] = useState<Record<ProductKey, PackageDisplay> | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOfferingPackages()
      .then(pkgs => { if (!cancelled) setPackages(pkgs); })
      .catch(e => console.warn('[paywall] load offerings failed', e));
    return () => { cancelled = true; };
  }, []);

  const selectedPackage = useMemo<PackageDisplay | null>(() => {
    if (!packages) return null;
    const key: ProductKey =
      selectedTier === 'vault_pro' && period === 'yearly'  ? 'vault_pro_yearly'  :
      selectedTier === 'vault_pro' && period === 'monthly' ? 'vault_pro_monthly' :
      selectedTier === 'vault'     && period === 'yearly'  ? 'vault_yearly'      :
                                                             'vault_monthly';
    return packages[key];
  }, [packages, selectedTier, period]);

  const vaultPrice = packages
    ? (period === 'yearly' ? packages.vault_yearly.priceString : packages.vault_monthly.priceString)
    : (period === 'yearly' ? '$24.99 / year' : '$2.99 / month');
  const vaultProPrice = packages
    ? (period === 'yearly' ? packages.vault_pro_yearly.priceString : packages.vault_pro_monthly.priceString)
    : (period === 'yearly' ? '$39.99 / year' : '$4.99 / month');

  async function handleSubscribe() {
    if (!selectedPackage || purchasing || restoring) return;
    setPurchasing(true);
    try {
      const result = await purchase(selectedPackage);
      if (result.success) {
        const tierLabel = result.tier === 'vault_pro' ? 'Vault Pro' : 'Vault';
        Alert.alert(
          `Welcome to ${tierLabel}`,
          `Your ${tierLabel} entitlement is active.`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else if (!result.cancelled && result.error) {
        Alert.alert('Purchase Failed', result.error);
      }
    } finally {
      setPurchasing(false);
    }
  }

  async function handleRestore() {
    if (restoring || purchasing) return;
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (!result.success) {
        Alert.alert('Restore Failed', result.error ?? 'Could not restore purchases.');
        return;
      }
      if (result.tier === 'vault' || result.tier === 'vault_pro') {
        const tierLabel = result.tier === 'vault_pro' ? 'Vault Pro' : 'Vault';
        Alert.alert(
          'Purchases Restored',
          `${tierLabel} entitlement restored.`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        Alert.alert(
          'Nothing to Restore',
          'No active Iron Ledger purchases were found on this account.',
        );
      }
    } finally {
      setRestoring(false);
    }
  }

  const ctaLabel = purchasing
    ? 'Processing…'
    : selectedTier === 'vault_pro' ? 'Subscribe to Vault Pro' : 'Subscribe to Vault';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.closeRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={16}>
            <Text style={s.closeX}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={s.hero}>
          <Text style={s.eyebrow}>{hero.eyebrow}</Text>
          <Text style={s.headline}>{hero.headline}</Text>
          <Text style={s.subhead}>{hero.subhead}</Text>
        </View>

        <View style={s.periodToggle}>
          <TouchableOpacity
            style={[s.periodBtn, period === 'monthly' && s.periodBtnActive]}
            onPress={() => setPeriod('monthly')}
            disabled={purchasing}
          >
            <Text style={[s.periodBtnText, period === 'monthly' && s.periodBtnTextActive]}>Monthly</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.periodBtn, period === 'yearly' && s.periodBtnActive]}
            onPress={() => setPeriod('yearly')}
            disabled={purchasing}
          >
            <Text style={[s.periodBtnText, period === 'yearly' && s.periodBtnTextActive]}>
              Yearly
            </Text>
            <View style={s.savePill}><Text style={s.savePillText}>SAVE</Text></View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[s.tierCard, selectedTier === 'vault' && s.tierCardActive]}
          onPress={() => setSelectedTier('vault')}
          disabled={purchasing}
        >
          <View style={s.tierHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.tierName}>Vault</Text>
              <Text style={s.tierTagline}>Unlimited storage for the everyday owner.</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.tierPrice}>{vaultPrice}</Text>
              <Text style={s.tierPriceSub}>{period === 'yearly' ? 'per year' : 'per month'}</Text>
            </View>
            <View style={[s.radio, selectedTier === 'vault' && s.radioActive]} />
          </View>
          <View style={s.bulletList}>
            {VAULT_BULLETS.map(b => (
              <View key={b} style={s.bulletRow}>
                <Text style={s.bulletCheck}>✓</Text>
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[s.tierCard, s.tierCardPro, selectedTier === 'vault_pro' && s.tierCardActive]}
          onPress={() => setSelectedTier('vault_pro')}
          disabled={purchasing}
        >
          <View style={s.tierHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.tierName}>Vault Pro</Text>
              <Text style={s.tierTagline}>Everything in Vault plus the pro toolkit.</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.tierPrice}>{vaultProPrice}</Text>
              <Text style={s.tierPriceSub}>{period === 'yearly' ? 'per year' : 'per month'}</Text>
            </View>
            <View style={[s.radio, selectedTier === 'vault_pro' && s.radioActive]} />
          </View>
          <View style={s.bulletList}>
            {VAULT_PRO_BULLETS.map(b => (
              <View key={b} style={s.bulletRow}>
                <Text style={s.bulletCheck}>✓</Text>
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.cta, (purchasing || !packages) && s.ctaDisabled]}
          onPress={handleSubscribe}
          disabled={purchasing || restoring || !packages}
          activeOpacity={0.85}
        >
          {purchasing ? (
            <View style={s.ctaBusy}>
              <ActivityIndicator color="#0D0D0D" />
              <Text style={s.ctaText}>{ctaLabel}</Text>
            </View>
          ) : (
            <Text style={s.ctaText}>{ctaLabel}</Text>
          )}
        </TouchableOpacity>

        <View style={s.legalRow}>
          <TouchableOpacity onPress={handleRestore} disabled={restoring || purchasing}>
            <Text style={[s.legalLink, (restoring || purchasing) && s.legalDimmed]}>
              {restoring ? 'Restoring…' : 'Restore purchases'}
            </Text>
          </TouchableOpacity>
          <Text style={s.legalDot}>·</Text>
          <Text style={s.legalText}>Cancel anytime</Text>
        </View>

        <Text style={s.finePrint}>
          Subscriptions auto-renew unless canceled at least 24 hours before
          the end of the current period. Manage subscriptions in your App
          Store account settings.
        </Text>

        <View style={s.legalRow}>
          <TouchableOpacity onPress={() => openLink(LINKS.terms)}>
            <Text style={s.legalLink}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={s.legalDot}>·</Text>
          <TouchableOpacity onPress={() => openLink(LINKS.privacy)}>
            <Text style={s.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  closeX: { color: '#888', fontSize: 32, fontWeight: '400', lineHeight: 32 },

  hero: { marginTop: 8, marginBottom: 20 },
  eyebrow: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, marginBottom: 10 },
  headline: { color: '#FFF', fontSize: 26, fontWeight: '800', lineHeight: 32, marginBottom: 8 },
  subhead: { color: '#BBB', fontSize: 14, lineHeight: 20 },

  periodToggle: {
    flexDirection: 'row',
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 4,
    marginBottom: 16,
  },
  periodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  periodBtnActive: { backgroundColor: SURFACE_HI },
  periodBtnText: { color: MUTED, fontSize: 14, fontWeight: '700', letterSpacing: 0.4 },
  periodBtnTextActive: { color: GOLD },
  savePill: { backgroundColor: '#1E3A1E', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  savePillText: { color: '#4CAF50', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  tierCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
  },
  tierCardPro: { backgroundColor: '#1A1510' },
  tierCardActive: { borderColor: GOLD, backgroundColor: SURFACE_HI },

  tierHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  tierName: { color: '#FFF', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  tierTagline: { color: '#999', fontSize: 12, lineHeight: 17 },
  tierPrice: { color: GOLD, fontSize: 18, fontWeight: '800' },
  tierPriceSub: { color: '#999', fontSize: 11, marginTop: 2 },

  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#444', marginTop: 4 },
  radioActive: { borderColor: GOLD, backgroundColor: GOLD },

  bulletList: { gap: 8, marginTop: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletCheck: { color: GOLD, fontSize: 14, fontWeight: '700', width: 16 },
  bulletText: { color: TEXT, fontSize: 13, flex: 1, lineHeight: 18 },

  cta: {
    backgroundColor: GOLD,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaBusy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: { color: '#0D0D0D', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },

  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 },
  legalLink: { color: GOLD, fontSize: 13, fontWeight: '600' },
  legalDimmed: { opacity: 0.5 },
  legalDot: { color: '#555', fontSize: 13 },
  legalText: { color: '#999', fontSize: 13 },
  finePrint: { color: '#555', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 16, paddingHorizontal: 10 },
});
