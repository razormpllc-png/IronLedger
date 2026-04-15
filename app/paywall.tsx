import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEntitlements } from '../lib/useEntitlements';
import type { Feature, OnboardingPath } from '../lib/entitlements';
import type { PaywallMode, HardCapReason } from '../lib/paywall';
import {
  getOfferingPackages,
  purchase,
  restorePurchases,
  PackageDisplay,
} from '../lib/purchases';
import { PackageKey } from '../lib/purchaseConfig';
import { getFoundersStatus, FoundersStatus } from '../lib/foundersCounter';
import { LINKS, openLink } from '../lib/links';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#777777';

// ─────────────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────────────

// Hero copy adapts to why the paywall was triggered.
function getHero(
  mode: PaywallMode,
  reason: HardCapReason | undefined,
  feature: Feature | undefined,
  path: OnboardingPath | null
): { eyebrow: string; headline: string; subhead: string } {
  if (mode === 'hard_cap') {
    if (reason === 'firearm_limit') {
      return {
        eyebrow: 'YOUR LITE VAULT IS FULL',
        headline: 'Keep building your collection.',
        subhead: 'Iron Ledger Pro removes the 5-firearm cap and unlocks the full system.',
      };
    }
    if (reason === 'accessory_limit') {
      return {
        eyebrow: 'ACCESSORY LIMIT REACHED',
        headline: 'Track every accessory.',
        subhead: 'Pro removes the 2-accessory-per-firearm cap and adds smart battery pre-fill.',
      };
    }
    if (reason === 'photo_limit') {
      return {
        eyebrow: 'ONLY ONE PHOTO ON LITE',
        headline: 'Document it all.',
        subhead: 'Pro lets you attach up to 20 photos per firearm.',
      };
    }
  }

  if (mode === 'contextual' && feature) {
    return contextualHero(feature);
  }

  if (mode === 'soft_nudge') {
    return {
      eyebrow: 'YOU\u2019RE BUILDING YOUR VAULT',
      headline: 'Keep the momentum going.',
      subhead: 'Pro unlocks unlimited firearms, photos, documents, and reminders — before you hit the Lite cap.',
    };
  }

  // Preview mode — audience-aware (Trigger 1, post-onboarding).
  return previewHero(path);
}

function contextualHero(feature: Feature): { eyebrow: string; headline: string; subhead: string } {
  const map: Record<Feature, { eyebrow: string; headline: string; subhead: string }> = {
    nfa_tracking: {
      eyebrow: 'NFA TRACKING IS A PRO FEATURE',
      headline: 'Stop refreshing eForms.',
      subhead: 'Track Form 1, 4, 3, 5, and 20 status, days waiting, and approval timelines.',
    },
    atf_ocr: {
      eyebrow: 'ATF FORM OCR IS A PRO FEATURE',
      headline: 'Scan it. Validate it. Done.',
      subhead: 'Pro scans approved ATF forms, extracts fields, and flags mismatches automatically.',
    },
    insurance_export: {
      eyebrow: 'INSURANCE EXPORT IS A PRO FEATURE',
      headline: 'A real report for your insurer.',
      subhead: 'Export PDF, CSV, and encrypted archives with every detail your provider needs.',
    },
    ffl_bound_book: {
      eyebrow: 'FFL BOUND BOOK IS A PRO FEATURE',
      headline: 'ATF-style A&D, one tap away.',
      subhead: 'Acquisition + disposition PDF and CSV, with missing-field flags for every row.',
    },
    dope_cards: {
      eyebrow: 'DOPE CARDS ARE A PRO FEATURE',
      headline: 'Your zero. Your loads. Your data.',
      subhead: 'Build per-firearm DOPE cards across distances, environmental conditions, and ammo.',
    },
    range_day: {
      eyebrow: 'RANGE DAY PLANNING IS A PRO FEATURE',
      headline: 'Never leave the case at home.',
      subhead: 'One-tap packing lists that pull from your inventory and log the session.',
    },
    icloud_sync: {
      eyebrow: 'iCLOUD SYNC IS A PRO FEATURE',
      headline: 'Your iCloud. Your keys.',
      subhead: 'End-to-end encrypted sync across your Apple devices. Never on our servers.',
    },
    ai_recognition: {
      eyebrow: 'AI RECOGNITION IS A PRO FEATURE',
      headline: 'Snap a photo. Get a record.',
      subhead: 'On-device image recognition identifies common optics, lights, and accessories.',
    },
    razormp_content: {
      eyebrow: 'RAZORMP CONTENT IS A PRO FEATURE',
      headline: 'Reviews and scores, right in the app.',
      subhead: 'Matched YouTube reviews and scoreboard integration for the firearms you own.',
    },
    document_storage: {
      eyebrow: 'DOCUMENT STORAGE IS A PRO FEATURE',
      headline: 'Receipts. Registrations. ATF forms.',
      subhead: 'Store every document securely, attached to the right firearm.',
    },
    photo_gallery_full: {
      eyebrow: 'FULL PHOTO GALLERIES ARE PRO',
      headline: 'Up to 20 photos per firearm.',
      subhead: 'Document condition, serial numbers, and every angle of every firearm.',
    },
    battery_reminders: {
      eyebrow: 'BATTERY REMINDERS ARE A PRO FEATURE',
      headline: 'Never show up with a dead red dot.',
      subhead: 'Push reminders on configurable intervals for every battery-powered accessory.',
    },
    maintenance_reminders: {
      eyebrow: 'MAINTENANCE REMINDERS ARE A PRO FEATURE',
      headline: 'Know when it\u2019s time.',
      subhead: 'Round-count thresholds and cleaning intervals with push notifications.',
    },
    smart_battery_prefill: {
      eyebrow: 'SMART BATTERY PRE-FILL IS A PRO FEATURE',
      headline: 'Add an Aimpoint. Get the battery type.',
      subhead: 'Bundled database auto-fills battery type, runtime, and replacement interval.',
    },
    unlimited_firearms: {
      eyebrow: 'UNLIMITED FIREARMS IS A PRO FEATURE',
      headline: 'No cap on your collection.',
      subhead: 'Pro removes the 5-firearm limit.',
    },
    unlimited_accessories: {
      eyebrow: 'UNLIMITED ACCESSORIES IS A PRO FEATURE',
      headline: 'Every rail. Every slot.',
      subhead: 'Pro removes the 2-accessory-per-firearm cap.',
    },
  };
  return map[feature];
}

function previewHero(path: OnboardingPath | null): { eyebrow: string; headline: string; subhead: string } {
  switch (path) {
    case 'manage_nfa':
      return {
        eyebrow: 'IRON LEDGER PRO',
        headline: 'Built for NFA owners.',
        subhead: 'Full ATF form lifecycle, OCR validation, and community wait-time tracking.',
      };
    case 'track_maintenance':
      return {
        eyebrow: 'IRON LEDGER PRO',
        headline: 'Stay ahead of maintenance.',
        subhead: 'Battery reminders, round-count thresholds, and per-platform service schedules.',
      };
    case 'plan_range_days':
      return {
        eyebrow: 'IRON LEDGER PRO',
        headline: 'Plan every range day.',
        subhead: 'Packing lists, DOPE cards, session logs, and automatic maintenance updates.',
      };
    case 'protect_records':
    default:
      return {
        eyebrow: 'IRON LEDGER PRO',
        headline: 'Protect every record.',
        subhead: 'Insurance exports, document storage, iCloud-encrypted sync, and unlimited photos.',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Feature list (shown on every paywall)
// ─────────────────────────────────────────────────────────────────────

const FEATURE_ROWS: { icon: string; title: string; sub: string }[] = [
  { icon: 'UNL', title: 'Unlimited firearms', sub: 'No cap on your collection.' },
  { icon: 'NFA', title: 'Full NFA tracking', sub: 'Form 1/4/3/5/20 lifecycle with OCR.' },
  { icon: 'BAT', title: 'Smart battery pre-fill', sub: 'Bundled database + reminders.' },
  { icon: 'DOC', title: 'Insurance & document export', sub: 'PDF, CSV, encrypted archive.' },
  { icon: 'DOP', title: 'DOPE cards + Range Day', sub: 'Ballistic data and trip planning.' },
  { icon: 'CLD', title: 'Private iCloud sync', sub: 'E2E encrypted. Your keys, not ours.' },
];

// ─────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const router = useRouter();
  const ent = useEntitlements();
  const params = useLocalSearchParams<{ mode?: string; feature?: string; reason?: string }>();

  const mode = (params.mode as PaywallMode) || 'preview';
  const feature = params.feature as Feature | undefined;
  const reason = params.reason as HardCapReason | undefined;

  const hero = getHero(mode, reason, feature, ent.onboardingPath);

  // Selected plan maps directly onto a PackageKey from purchaseConfig.
  // 'annual' is the recommended default.
  const [selected, setSelected] = useState<PackageKey>('annual');
  const [packages, setPackages] = useState<Record<PackageKey, PackageDisplay> | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [founders, setFounders] = useState<FoundersStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOfferingPackages()
      .then(pkgs => { if (!cancelled) setPackages(pkgs); })
      .catch(e => console.warn('[paywall] load offerings failed', e));
    return () => { cancelled = true; };
  }, []);

  // Poll the Cloudflare founders counter. Silent no-op in stub mode (URL
  // empty or endpoint unreachable). Re-polls every 30s so a user lingering
  // on the paywall sees slots drop in near-realtime on launch day.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getFoundersStatus().then(s => { if (!cancelled) setFounders(s); });
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // If the Founders pool sells out while this paywall is open and the user
  // had lifetime selected, bump them over to Annual so the CTA remains valid.
  useEffect(() => {
    if (founders?.soldOut && selected === 'lifetime') setSelected('annual');
  }, [founders?.soldOut, selected]);

  const foundersSoldOut = !!founders?.soldOut;
  const foundersRemaining = founders?.remaining ?? null;

  async function handleUnlock() {
    if (!packages || purchasing || restoring) return;
    if (selected === 'lifetime' && foundersSoldOut) {
      Alert.alert(
        'Founders sold out',
        'All Founders Lifetime slots have been claimed. Pick Annual or Monthly to unlock Pro now.'
      );
      return;
    }
    setPurchasing(true);
    try {
      const result = await purchase(packages[selected]);
      if (result.success) {
        Alert.alert(
          result.tier === 'founders' ? 'Welcome, Founder' : 'Welcome to Pro',
          result.tier === 'founders'
            ? 'Your Founders entitlement is active forever.'
            : 'Your Pro entitlement is active. Thanks for the support.'
        );
        router.back();
      } else if (!result.cancelled && result.error) {
        Alert.alert('Purchase failed', result.error);
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
        Alert.alert('Restore failed', result.error ?? 'Could not restore purchases.');
        return;
      }
      if (result.tier === 'pro' || result.tier === 'founders') {
        Alert.alert(
          'Purchases restored',
          result.tier === 'founders' ? 'Founders entitlement restored.' : 'Pro entitlement restored.'
        );
        router.back();
      } else {
        Alert.alert('Nothing to restore', 'No active Iron Ledger purchases were found on this account.');
      }
    } finally {
      setRestoring(false);
    }
  }

  const monthlyPrice = packages?.monthly.priceString ?? '$4.99 / month';
  const annualPrice = packages?.annual.priceString ?? '$34.99 / year';
  const lifetimePrice = packages?.lifetime.priceString ?? '$79.99 once';
  const ctaLabel = purchasing
    ? 'Processing…'
    : selected === 'lifetime'
      ? 'Unlock Founders Lifetime'
      : 'Unlock Iron Ledger Pro';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Close button — always present so the user can dismiss any paywall. */}
        <View style={s.closeRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={16}>
            <Text style={s.closeX}>×</Text>
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={s.hero}>
          <Text style={s.eyebrow}>{hero.eyebrow}</Text>
          <Text style={s.headline}>{hero.headline}</Text>
          <Text style={s.subhead}>{hero.subhead}</Text>
        </View>

        {/* Feature list */}
        <View style={s.featureCard}>
          {FEATURE_ROWS.map((row, i) => (
            <View key={row.title} style={[s.featureRow, i < FEATURE_ROWS.length - 1 && s.featureRowBorder]}>
              <View style={s.featureBadge}><Text style={s.featureBadgeText}>{row.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.featureTitle}>{row.title}</Text>
                <Text style={s.featureSub}>{row.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Pricing */}
        <Text style={s.sectionLabel}>CHOOSE A PLAN</Text>

        <TouchableOpacity
          style={[s.priceCard, selected === 'annual' && s.priceCardActive]}
          onPress={() => setSelected('annual')}
          disabled={purchasing}
        >
          <View style={{ flex: 1 }}>
            <View style={s.priceTitleRow}>
              <Text style={s.priceTitle}>Annual</Text>
              <View style={s.savePill}><Text style={s.savePillText}>SAVE 42%</Text></View>
            </View>
            <Text style={s.priceSub}>{annualPrice}</Text>
          </View>
          <View style={[s.radio, selected === 'annual' && s.radioActive]} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.priceCard, selected === 'monthly' && s.priceCardActive]}
          onPress={() => setSelected('monthly')}
          disabled={purchasing}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.priceTitle}>Monthly</Text>
            <Text style={s.priceSub}>{monthlyPrice}</Text>
          </View>
          <View style={[s.radio, selected === 'monthly' && s.radioActive]} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            s.priceCard,
            selected === 'lifetime' && s.priceCardActive,
            s.foundersCard,
            foundersSoldOut && s.priceCardSoldOut,
          ]}
          onPress={() => { if (!foundersSoldOut) setSelected('lifetime'); }}
          disabled={purchasing || foundersSoldOut}
          activeOpacity={foundersSoldOut ? 1 : 0.7}
        >
          <View style={{ flex: 1 }}>
            <View style={s.priceTitleRow}>
              <Text style={[s.priceTitle, foundersSoldOut && s.priceTitleDim]}>
                Founders Lifetime
              </Text>
              {foundersSoldOut ? (
                <View style={s.soldOutPill}><Text style={s.soldOutText}>SOLD OUT</Text></View>
              ) : foundersRemaining !== null ? (
                <View style={s.limitedPill}>
                  <Text style={s.limitedText}>
                    {foundersRemaining} / {founders!.cap} LEFT
                  </Text>
                </View>
              ) : (
                <View style={s.limitedPill}><Text style={s.limitedText}>LIMITED</Text></View>
              )}
            </View>
            <Text style={[s.priceSub, foundersSoldOut && s.priceSubDim]}>
              {foundersSoldOut
                ? 'All Founders slots claimed. Pro subscriptions still available.'
                : `${lifetimePrice} · all Pro features forever`}
            </Text>
          </View>
          <View
            style={[
              s.radio,
              selected === 'lifetime' && !foundersSoldOut && s.radioActive,
              foundersSoldOut && s.radioDim,
            ]}
          />
        </TouchableOpacity>

        {/* CTA */}
        <TouchableOpacity
          style={[s.cta, purchasing && s.ctaDisabled]}
          onPress={handleUnlock}
          disabled={purchasing || restoring}
          activeOpacity={0.85}
        >
          {purchasing ? (
            <View style={s.ctaBusy}>
              <ActivityIndicator color="#0D0D0D" />
              <Text style={s.ctaText}>Processing…</Text>
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
          Subscriptions auto-renew unless canceled at least 24 hours before the end of the current period.
          Manage subscriptions in your App Store account settings.
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

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  closeX: { color: '#888', fontSize: 32, fontWeight: '400', lineHeight: 32 },

  hero: { marginTop: 12, marginBottom: 24 },
  eyebrow: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, marginBottom: 10 },
  headline: { color: '#FFF', fontSize: 28, fontWeight: '800', lineHeight: 34, marginBottom: 10 },
  subhead: { color: '#BBB', fontSize: 15, lineHeight: 21 },

  featureCard: { backgroundColor: SURFACE, borderRadius: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 24 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  featureRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  featureBadge: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#2A2115', borderWidth: 1, borderColor: '#3A2C18', alignItems: 'center', justifyContent: 'center' },
  featureBadgeText: { color: GOLD, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  featureTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  featureSub: { color: MUTED, fontSize: 12, marginTop: 2 },

  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10, marginTop: 4 },

  priceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: BORDER, marginBottom: 10,
  },
  priceCardActive: { borderColor: GOLD, backgroundColor: '#211A0E' },
  priceCardSoldOut: { opacity: 0.55 },
  foundersCard: {},
  priceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  priceTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  priceTitleDim: { color: '#888' },
  priceSub: { color: '#999', fontSize: 12, marginTop: 4 },
  priceSubDim: { color: '#666' },
  savePill: { backgroundColor: '#1E3A1E', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  savePillText: { color: '#4CAF50', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  limitedPill: { backgroundColor: '#3A1E1E', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  limitedText: { color: '#FF8A65', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  soldOutPill: { backgroundColor: '#2A2A2A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  soldOutText: { color: '#888', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#444' },
  radioActive: { borderColor: GOLD, backgroundColor: GOLD },
  radioDim: { borderColor: '#333' },

  cta: {
    backgroundColor: GOLD, paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 16,
  },
  ctaDisabled: { opacity: 0.7 },
  ctaBusy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: { color: '#0D0D0D', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },

  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 },
  legalLink: { color: GOLD, fontSize: 13, fontWeight: '600' },
  legalDimmed: { opacity: 0.5 },
  legalDot: { color: '#555', fontSize: 13 },
  legalText: { color: '#999', fontSize: 13 },

  finePrint: { color: '#555', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 16, paddingHorizontal: 10 },

  notNowBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  notNowText: { color: '#888', fontSize: 14 },
});
