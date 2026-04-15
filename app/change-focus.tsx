// Change Focus — /change-focus
//
// Lets a user switch the onboarding path they originally picked without
// re-running the whole onboarding flow. Spec §4.8 promises "You can change
// your mind later" — this screen honors that. Does NOT reset
// onboardingComplete and does NOT re-trigger the preview paywall.
//
// UI mirrors the onboarding path cards so the chosen option feels
// consistent across first-launch and later-change contexts. The spotlight
// dismiss flag is cleared on save so the new path's spotlight card gets a
// fresh shot at the dashboard.

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useEntitlements } from '../lib/useEntitlements';
import { entitlementsStore } from '../lib/entitlements';
import type { OnboardingPath } from '../lib/entitlements';

const GOLD = '#C9A84C';
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

// Kept in sync with the onboarding screen — same wording so users who
// revisit recognize their original choices.
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

export default function ChangeFocusScreen() {
  const ent = useEntitlements();
  const [selected, setSelected] = useState<OnboardingPath | null>(
    ent.onboardingPath,
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await ent.setOnboardingPath(selected);
      // Reset the spotlight dismiss flag so the new path's spotlight card
      // gets a fresh shot on the dashboard. Users typically expect changing
      // focus to refresh the dashboard guidance.
      if (ent.pathSpotlightDismissed) {
        await entitlementsStore.resetPathSpotlightDismissed();
      }
      router.back();
    } catch (e) {
      console.warn('[change-focus] failed to save path', e);
      setSaving(false);
    }
  }

  const changed = selected !== ent.onboardingPath;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancel}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Change Focus</Text>
          <View style={{ width: 60 }} />
        </View>

        <Text style={s.intro}>
          Pick the goal that matters most right now. The dashboard, spotlight
          card, and paywall copy will re-tune around it. You can change this
          again anytime.
        </Text>

        <View style={s.options}>
          {OPTIONS.map((opt) => {
            const active = selected === opt.id;
            const current = ent.onboardingPath === opt.id;
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
                    <View style={s.cardTitleRow}>
                      <Text style={[s.cardTitle, active && s.cardTitleActive]}>
                        {opt.title}
                      </Text>
                      {current && (
                        <View style={s.currentPill}>
                          <Text style={s.currentPillText}>CURRENT</Text>
                        </View>
                      )}
                    </View>
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
          style={[s.cta, (!changed || saving) && s.ctaDisabled]}
          onPress={handleSave}
          disabled={!changed || saving}
          activeOpacity={0.85}
        >
          <Text
            style={[s.ctaText, (!changed || saving) && s.ctaTextDisabled]}
          >
            {saving ? 'Saving…' : changed ? 'Save Focus' : 'No Changes'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cancel: { color: GOLD, fontSize: 16, width: 60 },
  title: { color: TEXT, fontSize: 18, fontWeight: '700' },
  intro: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  options: { gap: 12, marginBottom: 20 },
  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  cardActive: { backgroundColor: CARD_ACTIVE, borderColor: GOLD },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardIcon: { fontSize: 26, width: 34, textAlign: 'center' },
  cardText: { flex: 1 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: '700' },
  cardTitleActive: { color: GOLD },
  cardBlurb: { color: MUTED, fontSize: 13, lineHeight: 18 },
  currentPill: {
    backgroundColor: '#2A2115',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3A2C18',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  currentPillText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
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
  checkActive: { borderColor: GOLD, backgroundColor: GOLD },
  checkMark: { color: '#0D0D0D', fontSize: 14, fontWeight: '900' },
  cta: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#8A7634', opacity: 0.55 },
  ctaText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ctaTextDisabled: { color: '#2A2A2A' },
});
