// Onboarding path selector (spec §4.8).
// First-launch flow that asks the user what brought them to Iron Ledger.
// The selected path is stored on the entitlements store and used by the
// paywall to show audience-aware copy at Triggers 2, 3, and 4.

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useEntitlements } from '../lib/useEntitlements';
import type { OnboardingPath } from '../lib/entitlements';
import { showPaywall } from '../lib/paywall';

const GOLD = '#C9A84C';
const GOLD_DIM = '#8A7634';
const BG = '#0D0D0D';
const CARD = '#151515';
const CARD_ACTIVE = '#1E1A10';
const BORDER = '#262626';
const TEXT = '#E8E6DF';
const MUTED = '#8A8A8A';

interface PathOption {
  id: OnboardingPath;
  title: string;
  blurb: string;
  icon: string;
}

const OPTIONS: PathOption[] = [
  {
    id: 'protect_records',
    title: 'Protect my collection records',
    blurb: 'Keep serials, photos, and paperwork organized and insurance-ready.',
    icon: '🛡',
  },
  {
    id: 'track_maintenance',
    title: 'Track maintenance and batteries',
    blurb: 'Never miss a cleaning, service interval, or optic battery swap.',
    icon: '⚙',
  },
  {
    id: 'manage_nfa',
    title: 'Manage NFA items',
    blurb: 'Store Form 1/4 approvals, stamp dates, and trust documents in one place.',
    icon: '📜',
  },
  {
    id: 'plan_range_days',
    title: 'Plan range days',
    blurb: 'Build DOPE cards, track ammo, and plan every trip to the line.',
    icon: '🎯',
  },
];

export default function OnboardingScreen() {
  const ent = useEntitlements();
  const [selected, setSelected] = useState<OnboardingPath | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await ent.setOnboardingPath(selected);
      await ent.setOnboardingComplete(true);
      // Land on the Dashboard (not the default Armory tab) so the user
      // immediately sees the path-aware spotlight card that matches the
      // tile they just picked.
      router.replace('/(tabs)/dashboard');
      // Trigger 1 (spec §4.6): soft preview after onboarding — audience-aware
      // copy keyed off the path they just picked. Pro/Founders skip it.
      if (!ent.isPro) {
        setTimeout(() => showPaywall({ mode: 'preview' }), 300);
      }
    } catch (e) {
      console.warn('[onboarding] failed to save path', e);
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Image source={require('../assets/Icon.png')} style={s.icon} />
          <Text style={s.brand}>IRON LEDGER</Text>
          <Text style={s.welcome}>Welcome.</Text>
          <Text style={s.sub}>
            What brings you here? Pick the one that matters most — we'll tailor the app around it.
            You can change your mind later.
          </Text>
        </View>

        <View style={s.options}>
          {OPTIONS.map((opt) => {
            const active = selected === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[s.card, active && s.cardActive]}
                activeOpacity={0.85}
                onPress={() => setSelected(opt.id)}
              >
                <View style={s.cardRow}>
                  <Text style={s.cardIcon}>{opt.icon}</Text>
                  <View style={s.cardText}>
                    <Text style={[s.cardTitle, active && s.cardTitleActive]}>
                      {opt.title}
                    </Text>
                    <Text style={s.cardBlurb}>{opt.blurb}</Text>
                  </View>
                  <View style={[s.check, active && s.checkActive]}>
                    {active && <Text style={s.checkMark}>✓</Text>}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[s.cta, (!selected || submitting) && s.ctaDisabled]}
          onPress={handleContinue}
          disabled={!selected || submitting}
          activeOpacity={0.85}
        >
          <Text style={[s.ctaText, (!selected || submitting) && s.ctaTextDisabled]}>
            {submitting ? 'Loading…' : 'Enter Iron Ledger'}
          </Text>
        </TouchableOpacity>

        <Text style={s.footer}>
          Your entries stay on this device. No accounts, no cloud, no data mining.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  icon: { width: 72, height: 72, borderRadius: 16, marginBottom: 12 },
  brand: {
    color: GOLD,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 20,
  },
  welcome: {
    color: TEXT,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 10,
  },
  sub: {
    color: MUTED,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  options: { gap: 12, marginBottom: 20 },
  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  cardActive: {
    backgroundColor: CARD_ACTIVE,
    borderColor: GOLD,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardIcon: {
    fontSize: 26,
    width: 34,
    textAlign: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardTitleActive: { color: GOLD },
  cardBlurb: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkActive: {
    borderColor: GOLD,
    backgroundColor: GOLD,
  },
  checkMark: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '900',
  },
  cta: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: 'center',
  },
  ctaDisabled: {
    backgroundColor: GOLD_DIM,
    opacity: 0.55,
  },
  ctaText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ctaTextDisabled: { color: '#2A2A2A' },
  footer: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
});
