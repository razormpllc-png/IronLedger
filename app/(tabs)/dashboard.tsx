import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getAllFirearms, getTotalRoundsFired, getRoundsPerFirearm, getAllNfaItems,
  getPendingNfaItems, getPendingNfaSuppressors, getAllSuppressors,
  getActiveBatteryLogs, getAmmoRollupsByCaliber, Firearm,
} from '../../lib/database';
import type { Suppressor } from '../../lib/database';
import { daysWaiting } from '../../lib/nfaStats';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CaliberRollup } from '../../lib/database';
import type { BatteryLogWithFirearm } from '../../lib/database';
import { bucketFor, dueLabel, parseDateLoose } from '../../lib/batteryStats';
import type { BatteryBucket } from '../../lib/batteryStats';
import { getMaintenanceRollup } from '../../lib/maintenanceStats';
import type { MaintenanceRollup } from '../../lib/maintenanceStats';
import { markAccessoryBatteryReplacedToday } from '../../lib/accessoryBatterySync';
import { syncWidgets } from '../../lib/widgetSync';
import { useEntitlements } from '../../lib/useEntitlements';
import type { Tier, OnboardingPath } from '../../lib/entitlements';
import { runProGated } from '../../lib/paywall';
// Estate config screen handles export now — navigated via router.push('/estate-config')

// Path-aware spotlight metadata. Drives the "your path" card at the top of
// the dashboard so the onboarding selection actually changes what the user
// sees on first launch, not just what the paywall says.
const PATH_SPOTLIGHT: Record<OnboardingPath, {
  icon: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  route: string;
}> = {
  protect_records: {
    icon: '🛡',
    eyebrow: 'YOUR PATH · PROTECT RECORDS',
    title: 'Lock in your collection',
    subtitle: 'Add a firearm with serials and photos — then you can export an insurance-ready PDF anytime.',
    cta: 'Add a firearm',
    route: '/add-firearm',
  },
  track_maintenance: {
    icon: '⚙',
    eyebrow: 'YOUR PATH · MAINTENANCE',
    title: 'Stay on top of batteries & service',
    subtitle: 'Open the Batteries hub to log optic and accessory batteries and get reminded before they die.',
    cta: 'Open Batteries',
    route: '/batteries',
  },
  manage_nfa: {
    icon: '📜',
    eyebrow: 'YOUR PATH · NFA',
    title: 'Track your Form 4 queue',
    subtitle: 'See pending stamps, days-waiting, and approval dates in one place — built for SBRs, suppressors, and SBS.',
    cta: 'Open Form 4 Tracker',
    route: '/form-4-tracker',
  },
  plan_range_days: {
    icon: '🎯',
    eyebrow: 'YOUR PATH · RANGE DAYS',
    title: 'Plan your next trip',
    subtitle: 'Log a range session — pick firearms, count rounds, and keep a running history of your shooting.',
    cta: 'Log a range session',
    route: '/add-session',
  },
};

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const CONDITION_COLORS: Record<string, string> = {
  'Excellent': '#4CAF50', 'Good': '#8BC34A', 'Fair': '#FFC107', 'Poor': '#FF5722',
};
// Widget colors mirror the battery hub + firearm detail chips so the signal
// is consistent across every surface.
const BATTERY_COLORS: Record<BatteryBucket, string> = {
  overdue: '#FF5722',
  due_soon: '#FFC107',
  ok: '#4CAF50',
};

/** Computed due date in epoch-ms for sort ordering. Install date plus the
 *  expected life in months, clamped to Infinity when unparseable so bad
 *  rows sink to the bottom rather than crashing the sort. */
function dueDateEpoch(log: BatteryLogWithFirearm): number {
  const d = parseDateLoose(log.install_date);
  if (!d) return Infinity;
  d.setMonth(d.getMonth() + (log.expected_life_months ?? 0));
  return d.getTime();
}

/** "Holosun 507C on Glock 19" — falls back to accessory type or device_label
 *  when optional fields are missing, so the widget never renders a blank row. */
function composeLogLabel(log: BatteryLogWithFirearm): { acc: string; firearm: string | null } {
  const acc =
    [log.accessory_make, log.accessory_model].filter(Boolean).join(' ') ||
    log.accessory_type ||
    log.device_label ||
    'Battery';
  const firearm =
    log.firearm_nickname ||
    ([log.firearm_make, log.firearm_model].filter(Boolean).join(' ') || null);
  return { acc, firearm };
}

const TIER_OPTIONS: { key: Tier; label: string }[] = [
  { key: 'lite', label: 'Lite' },
  { key: 'pro', label: 'Pro' },
  { key: 'founders', label: 'Founders' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const ent = useEntitlements();
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [roundsPerFirearm, setRoundsPerFirearm] = useState<{ firearm_id: number; make: string; model: string; total: number }[]>([]);
  const [nfaItems, setNfaItems] = useState<Firearm[]>([]);
  const [pendingFirearms, setPendingFirearms] = useState<Firearm[]>([]);
  const [pendingSuppressors, setPendingSuppressors] = useState<Suppressor[]>([]);
  const [allSuppressors, setAllSuppressors] = useState<Suppressor[]>([]);
  function handleEstateExport() {
    router.push('/estate-config');
  }
  const [batteryLogs, setBatteryLogs] = useState<BatteryLogWithFirearm[]>([]);
  const [maintRollup, setMaintRollup] = useState<MaintenanceRollup>({
    entries: [], overdue: 0, dueSoon: 0, pending: 0, total: 0,
  });
  const [ammoRollups, setAmmoRollups] = useState<CaliberRollup[]>([]);
  // Rounds Fired date range — ISO bounds, both optional so the user can pick
  // "everything before X" or "everything after Y" as well as a closed window.
  // Null on both means "All time" and the section header renders that label.
  const [roundsStartIso, setRoundsStartIso] = useState<string | null>(null);
  const [roundsEndIso, setRoundsEndIso] = useState<string | null>(null);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  // Local draft values for the picker modal — text form (MM/DD/YYYY) so users
  // can type freely without the parent state flickering on every keystroke.
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  useFocusEffect(
    useCallback(() => {
      const all = getAllFirearms();
      setFirearms(all);
      const range = { startIso: roundsStartIso, endIso: roundsEndIso };
      setTotalRounds(getTotalRoundsFired(range));
      setRoundsPerFirearm(getRoundsPerFirearm(range));
      setNfaItems(getAllNfaItems());
      setPendingFirearms(getPendingNfaItems());
      const sups = getAllSuppressors();
      setAllSuppressors(sups);
      setPendingSuppressors(getPendingNfaSuppressors());
      setBatteryLogs(getActiveBatteryLogs());
      setMaintRollup(getMaintenanceRollup());
      setAmmoRollups(getAmmoRollupsByCaliber());
      // Refresh the Home Screen widget payload whenever the dashboard comes
      // into focus. Debounced inside syncWidgets so opening the app rapidly
      // doesn't thrash the WidgetKit reload API.
      syncWidgets();
    }, [roundsStartIso, roundsEndIso])
  );

  /** MM/DD/YYYY → YYYY-MM-DD (null if unparseable). */
  function parseMdyToIso(s: string): string | null {
    const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[1]}-${m[2]}`;
  }

  /** YYYY-MM-DD → short US format for header badge. */
  function formatIsoShort(iso: string): string {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
  }

  function openRangePicker() {
    // Seed drafts from the current applied range so the modal opens with the
    // active values already filled in.
    setDraftStart(roundsStartIso ? formatIsoFull(roundsStartIso) : '');
    setDraftEnd(roundsEndIso ? formatIsoFull(roundsEndIso) : '');
    setRangePickerOpen(true);
  }

  /** YYYY-MM-DD → MM/DD/YYYY for the text inputs. */
  function formatIsoFull(iso: string): string {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${m[2]}/${m[3]}/${m[1]}`;
  }

  function applyRange() {
    const startParsed = draftStart.trim() ? parseMdyToIso(draftStart) : null;
    const endParsed = draftEnd.trim() ? parseMdyToIso(draftEnd) : null;
    if (draftStart.trim() && !startParsed) {
      Alert.alert('Invalid start date', 'Use MM/DD/YYYY format');
      return;
    }
    if (draftEnd.trim() && !endParsed) {
      Alert.alert('Invalid end date', 'Use MM/DD/YYYY format');
      return;
    }
    if (startParsed && endParsed && startParsed > endParsed) {
      Alert.alert('Range error', 'Start date must be on or before end date');
      return;
    }
    setRoundsStartIso(startParsed);
    setRoundsEndIso(endParsed);
    setRangePickerOpen(false);
  }

  function clearRange() {
    setRoundsStartIso(null);
    setRoundsEndIso(null);
    setRangePickerOpen(false);
  }

  function autoFormatDateLocal(text: string, prev: string): string {
    const digits = text.replace(/\D/g, '');
    if (text.length < prev.length) return text;
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
  }

  // Header label reflecting the active range. "All Time" when unbounded;
  // otherwise a short "01/15/26 → 04/14/26" badge (open bounds show ∞).
  const rangeLabel = (() => {
    if (!roundsStartIso && !roundsEndIso) return 'All Time';
    const start = roundsStartIso ? formatIsoShort(roundsStartIso) : '∞';
    const end = roundsEndIso ? formatIsoShort(roundsEndIso) : '∞';
    return `${start} → ${end}`;
  })();

  // Low-stock ammo widget — surfaces calibers where at least one lot is
  // empty or below its threshold. Empty calibers sort to the top. Capped
  // at 3 so the dashboard stays calm.
  const urgentAmmo = ammoRollups
    .filter(r => r.anyEmpty || r.anyLow)
    .sort((a, b) => {
      if (a.anyEmpty !== b.anyEmpty) return a.anyEmpty ? -1 : 1;
      return a.rounds - b.rounds;
    })
    .slice(0, 3);

  // "Pending" = the open Form 4/1/5 queue, i.e. anything not yet approved or
  // denied. Matches the Form 4 Tracker's DB-side definition (unfiled +
  // in-flight), so dashboard counts line up with what the tracker screen
  // actually shows. daysWaiting() returns null for unfiled items, so
  // oldestPendingDays still only reflects truly in-flight stamps.
  const nfaPendingTrackables: { date_filed: string | null; date_approved: string | null; atf_form_status: string | null }[] = [
    ...pendingFirearms,
    ...pendingSuppressors,
  ];
  const nfaPending = nfaPendingTrackables.length;
  // Oldest pending stamp's days-in-queue — drives the Form 4 tracker tile
  // subtitle so the user knows how stale the queue is at a glance.
  const oldestPendingDays = nfaPendingTrackables.reduce<number | null>((max, f) => {
    const d = daysWaiting(f);
    if (d === null) return max;
    return max === null ? d : Math.max(max, d);
  }, null);

  // Battery urgency — drives the Batteries tile subtitle and the red dot.
  const batteryOverdue = batteryLogs.filter(l => bucketFor(l) === 'overdue').length;
  const batteryDueSoon = batteryLogs.filter(l => bucketFor(l) === 'due_soon').length;

  // Urgent widget: show overdue + due_soon logs, sorted earliest-due first
  // (which naturally places the most-overdue at the top), capped at 3.
  // Filtered to accessory-linked logs so the one-tap "Replaced Today" works —
  // non-accessory logs still appear in the full Batteries hub.
  const urgentBatteries: BatteryLogWithFirearm[] = batteryLogs
    .filter(l => {
      const b = bucketFor(l);
      return (b === 'overdue' || b === 'due_soon') && l.accessory_id != null;
    })
    .sort((a, b) => dueDateEpoch(a) - dueDateEpoch(b))
    .slice(0, 3);

  /** One-tap "Replaced Today" from the dashboard widget. Confirms, closes
   *  the old log, schedules the next reminder, and re-pulls active logs so
   *  the row disappears (or falls out of the urgent window) immediately. */
  function handleWidgetReplaced(log: BatteryLogWithFirearm) {
    if (log.accessory_id == null) return;
    const { acc } = composeLogLabel(log);
    Alert.alert(
      'Log battery replacement?',
      `Stamp today as the new replacement date for ${acc}. The next reminder will be rescheduled automatically.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replaced Today',
          onPress: async () => {
            try {
              await markAccessoryBatteryReplacedToday(log.accessory_id as number);
            } catch (e) {
              console.warn('[dashboard] replaced-today failed', e);
            }
            setBatteryLogs(getActiveBatteryLogs());
            syncWidgets();
          },
        },
      ]
    );
  }

  const totalValue = firearms.reduce((sum, f) => sum + (f.current_value || 0), 0);
  const totalCost = firearms.reduce((sum, f) => sum + (f.purchase_price || 0), 0);
  const gainLoss = totalValue - totalCost;

  const byType: Record<string, number> = {};
  firearms.forEach(f => { const t = f.type || 'Other'; byType[t] = (byType[t] || 0) + 1; });
  const maxType = Math.max(...Object.values(byType), 1);

  const byCondition: Record<string, number> = {};
  firearms.forEach(f => { if (f.condition_rating) byCondition[f.condition_rating] = (byCondition[f.condition_rating] || 0) + 1; });
  const maxCondition = Math.max(...Object.values(byCondition), 1);

  const maxRounds = Math.max(...roundsPerFirearm.map(r => r.total), 1);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.headerSub}>IRON LEDGER</Text>
        <Text style={s.headerTitle}>Dashboard</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Path-aware "start here" card — surfaces the feature that matches
            the user's onboarding selection. Dismisses on CTA tap or X. Re-
            appears automatically if the user changes their path later.
            Also auto-suppressed once the user has already done the thing
            the card is asking for (has firearms, logged batteries, etc.)
            so it doesn't linger on an armory that's already set up. */}
        {ent.onboardingPath && !ent.pathSpotlightDismissed && (() => {
          switch (ent.onboardingPath) {
            case 'protect_records':  return firearms.length === 0;
            case 'track_maintenance': return batteryLogs.length === 0;
            case 'manage_nfa':        return nfaItems.length === 0 && pendingSuppressors.length === 0;
            case 'plan_range_days':   return totalRounds === 0;
            default: return true;
          }
        })() ? (() => {
          const sp = PATH_SPOTLIGHT[ent.onboardingPath];
          return (
            <View style={s.spotlight}>
              <TouchableOpacity
                style={s.spotlightClose}
                onPress={() => ent.dismissPathSpotlight()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.spotlightCloseText}>×</Text>
              </TouchableOpacity>
              <Text style={s.spotlightIcon}>{sp.icon}</Text>
              <Text style={s.spotlightEyebrow}>{sp.eyebrow}</Text>
              <Text style={s.spotlightTitle}>{sp.title}</Text>
              <Text style={s.spotlightSub}>{sp.subtitle}</Text>
              <TouchableOpacity
                style={s.spotlightCta}
                activeOpacity={0.85}
                onPress={() => {
                  // Don't dismiss on CTA — if the user taps through but
                  // bails out before completing the action, the spotlight
                  // should still be there next time. The auto-suppress
                  // condition will hide it once they actually follow through.
                  router.push(sp.route as any);
                }}
              >
                <Text style={s.spotlightCtaText}>{sp.cta}</Text>
              </TouchableOpacity>
            </View>
          );
        })() : null}

        <Text style={s.sectionLabel}>COLLECTION VALUE</Text>
        <View style={s.statsRow}>
          <View style={[s.statCard, { flex: 1 }]}>
            <Text style={s.statLabel}>Total Value</Text>
            <Text style={s.statValue}>${totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}</Text>
          </View>
          <View style={[s.statCard, { flex: 1 }]}>
            <Text style={s.statLabel}>Total Cost</Text>
            <Text style={s.statValue}>${totalCost.toLocaleString('en-US', { minimumFractionDigits: 0 })}</Text>
          </View>
        </View>
        <View style={[s.card, s.gainCard]}>
          <Text style={s.statLabel}>Gain / Loss</Text>
          <Text style={[s.gainValue, { color: gainLoss >= 0 ? '#4CAF50' : '#FF5722' }]}>
            {gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString('en-US', { minimumFractionDigits: 0 })}
          </Text>
        </View>

        <View style={s.roundsHeader}>
          <Text style={s.sectionLabel}>ROUNDS FIRED</Text>
          <TouchableOpacity style={s.rangeBtn} onPress={openRangePicker}>
            <Text style={s.rangeBtnIcon}>📅</Text>
            <Text style={s.rangeBtnText}>{rangeLabel}</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.card, s.gainCard]}>
          <Text style={s.statLabel}>
            Total Rounds {roundsStartIso || roundsEndIso ? 'in Range' : 'Logged'}
          </Text>
          <Text style={s.roundsTotal}>{totalRounds.toLocaleString()}</Text>
        </View>
        {roundsPerFirearm.some(r => r.total > 0) && (
          <View style={s.card}>
            {roundsPerFirearm.filter(r => r.total > 0).map((r, i, arr) => (
              <View key={r.firearm_id} style={[s.barRow, i < arr.length - 1 && s.barRowBorder]}>
                <Text style={s.barLabel} numberOfLines={1}>{r.make} {r.model}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${(r.total / maxRounds) * 100}%`, backgroundColor: GOLD }]} />
                </View>
                <Text style={s.barValue}>{r.total.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}<Text style={s.sectionLabel}>BY TYPE</Text>
        <View style={s.card}>
          {Object.entries(byType).map(([type, count], i, arr) => (
            <View key={type} style={[s.barRow, i < arr.length - 1 && s.barRowBorder]}>
              <Text style={s.barLabel}>{type}</Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${(count / maxType) * 100}%`, backgroundColor: GOLD }]} />
              </View>
              <Text style={s.barValue}>{count}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>BY CONDITION</Text>
        <View style={s.card}>
          {Object.entries(byCondition).map(([cond, count], i, arr) => (
            <View key={cond} style={[s.barRow, i < arr.length - 1 && s.barRowBorder]}>
              <Text style={s.barLabel}>{cond}</Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${(count / maxCondition) * 100}%`, backgroundColor: CONDITION_COLORS[cond] || GOLD }]} />
              </View>
              <Text style={s.barValue}>{count}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>REPORTS</Text>
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() =>
            runProGated('insurance_export', () => router.push('/insurance'))
          }
        >
          <Text style={s.insuranceIcon}>📋</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>Generate Insurance Report</Text>
              {!ent.isPro && <View style={s.proPill}><Text style={s.proPillText}>PRO</Text></View>}
            </View>
            <Text style={s.insuranceSub}>Export a PDF for your insurance provider</Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* Estate Planning Export — executor-focused PDF grouped by storage
            location. Uses the same insurance_export entitlement since both
            are whole-armory PDF deliverables; can split later if paywall
            copy needs to differentiate. */}
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() => handleEstateExport()}
          activeOpacity={0.75}
        >
          <Text style={s.insuranceIcon}>🗂️</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>Estate Planning Export</Text>
              {!ent.isPro && <View style={s.proPill}><Text style={s.proPillText}>PRO</Text></View>}
            </View>
            <Text style={s.insuranceSub}>PDF for your executor — provenance, values, storage locations</Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* FFL Bound Book (Preview) — ATF-style A&D export. Gated on its
            own `ffl_bound_book` entitlement so the FFL/Dealer paywall copy
            stays distinct from the insurance export. */}
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() =>
            runProGated('ffl_bound_book', () => router.push('/ffl-bound-book'))
          }
          activeOpacity={0.75}
        >
          <Text style={s.insuranceIcon}>📒</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>FFL Bound Book</Text>
              {!ent.isPro && <View style={s.proPill}><Text style={s.proPillText}>PRO</Text></View>}
              <View style={s.previewPill}><Text style={s.previewPillText}>PREVIEW</Text></View>
            </View>
            <Text style={s.insuranceSub}>ATF-style Acquisition &amp; Disposition export — PDF or CSV</Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* Subscription — App Store Review requirement: user must be able
            to manage billing and restore purchases from inside the app.
            Links to /subscription which wraps RevenueCat + platform deep
            links. Free for everyone; shows "See Plans" CTA for Lite. */}
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() => router.push('/subscription')}
        >
          <Text style={s.insuranceIcon}>💳</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>Subscription</Text>
              {ent.isPro ? (
                <View style={s.proPill}>
                  <Text style={s.proPillText}>
                    {ent.tier === 'founders' ? 'FOUNDER' : 'PRO'}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={s.insuranceSub}>
              {ent.isPro
                ? 'Manage billing, restore purchases'
                : 'See Pro plans · Restore purchases'}
            </Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* Backup & Restore — free, always available. Export every table +
            photos as a JSON blob, or restore from a previous export. */}
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() => router.push('/backup')}
        >
          <Text style={s.insuranceIcon}>📦</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>Backup & Restore</Text>
            </View>
            <Text style={s.insuranceSub}>Save or restore your entire armory as JSON</Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* Change Focus — honors the spec §4.8 promise ("You can change your
            mind later") by letting users re-pick their onboarding path
            without re-running the whole flow. Only shows once the user has
            picked a path at all (pre-onboarding, it's meaningless). */}
        {ent.onboardingPath ? (
          <TouchableOpacity
            style={s.insuranceBtn}
            onPress={() => router.push('/change-focus')}
          >
            <Text style={s.insuranceIcon}>🎯</Text>
            <View style={{ flex: 1 }}>
              <View style={s.insuranceTitleRow}>
                <Text style={s.insuranceTitle}>Change Focus</Text>
              </View>
              <Text style={s.insuranceSub}>
                Re-tune the dashboard around a different goal
              </Text>
            </View>
            <Text style={s.insuranceChevron}>›</Text>
          </TouchableOpacity>
        ) : null}

        {/* NFA Hub — always visible. Lite users can peek the hub but adding
            items is still gated via the per-firearm NFA toggle. */}
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() =>
            runProGated('nfa_tracking', () => router.push('/nfa'))
          }
        >
          <Text style={s.insuranceIcon}>🎟️</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>NFA Hub</Text>
              {!ent.isPro && <View style={s.proPill}><Text style={s.proPillText}>PRO</Text></View>}
              {(nfaItems.length + allSuppressors.length) > 0 && (
                <View style={s.countPill}>
                  <Text style={s.countPillText}>{nfaItems.length + allSuppressors.length}</Text>
                </View>
              )}
            </View>
            <Text style={s.insuranceSub}>
              {(nfaItems.length + allSuppressors.length) === 0
                ? 'Track tax stamps, wait times, and trusts'
                : nfaPending > 0
                  ? `${nfaPending} pending · wait-time stats inside`
                  : `${nfaItems.length + allSuppressors.length} stamp${(nfaItems.length + allSuppressors.length) === 1 ? '' : 's'} logged`}
            </Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* Form 4 Tracker — only surfaces when something is in-flight. Keeps
            the dashboard calm for users with no pending stamps. */}
        {nfaPending > 0 ? (
          <TouchableOpacity
            style={s.insuranceBtn}
            onPress={() => router.push('/form-4-tracker')}
          >
            <Text style={s.insuranceIcon}>🏷️</Text>
            <View style={{ flex: 1 }}>
              <View style={s.insuranceTitleRow}>
                <Text style={s.insuranceTitle}>Form 4 Tracker</Text>
                <View style={s.countPill}>
                  <Text style={s.countPillText}>{nfaPending}</Text>
                </View>
              </View>
              <Text style={s.insuranceSub}>
                {oldestPendingDays !== null
                  ? `${nfaPending} in queue · oldest ${oldestPendingDays}d`
                  : `${nfaPending} pending stamp${nfaPending === 1 ? '' : 's'}`}
              </Text>
            </View>
            <Text style={s.insuranceChevron}>›</Text>
          </TouchableOpacity>
        ) : null}

        {/* Low-stock ammo widget — renders only when at least one caliber
            has an empty or below-threshold lot. Tap a row to jump to Supply;
            tap "See all" to open Supply with the full list. */}
        {urgentAmmo.length > 0 ? (
          <View style={s.battWidget}>
            <View style={s.battWidgetHeaderRow}>
              <Text style={s.battWidgetHeader}>AMMO RUNNING LOW</Text>
              <TouchableOpacity onPress={() => router.push('/supply')}>
                <Text style={s.battWidgetSeeAll}>See all ›</Text>
              </TouchableOpacity>
            </View>
            {urgentAmmo.map((r, i, arr) => {
              const color = r.anyEmpty ? '#FF5722' : '#FFC107';
              const label = r.anyEmpty ? 'OUT OF STOCK' : 'LOW';
              return (
                <TouchableOpacity
                  key={r.caliber}
                  style={[s.battWidgetRow, i < arr.length - 1 && s.battWidgetRowBorder]}
                  onPress={() => router.push('/supply')}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.battWidgetTopRow}>
                      <View style={[s.battWidgetDot, { backgroundColor: color }]} />
                      <Text style={s.battWidgetAcc} numberOfLines={1}>{r.caliber}</Text>
                    </View>
                    <Text style={[s.battWidgetDue, { color }]} numberOfLines={1}>
                      🎯 {r.rounds.toLocaleString()} rds · {r.lots} lot{r.lots === 1 ? '' : 's'} · {label}
                    </Text>
                  </View>
                  <Text style={s.ammoWidgetChevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* Urgent-battery widget — only renders when at least one accessory-
            linked battery is overdue or due_soon. Each row pairs a colored
            bucket chip with a "Replaced Today" button so the user can clear
            the flag without leaving the dashboard. */}
        {urgentBatteries.length > 0 ? (
          <View style={s.battWidget}>
            <View style={s.battWidgetHeaderRow}>
              <Text style={s.battWidgetHeader}>NEEDS ATTENTION</Text>
              <TouchableOpacity onPress={() => router.push('/batteries')}>
                <Text style={s.battWidgetSeeAll}>See all ›</Text>
              </TouchableOpacity>
            </View>
            {urgentBatteries.map((log, i, arr) => {
              const bucket = bucketFor(log);
              const { acc, firearm } = composeLogLabel(log);
              const color = BATTERY_COLORS[bucket];
              return (
                <View
                  key={log.id}
                  style={[s.battWidgetRow, i < arr.length - 1 && s.battWidgetRowBorder]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.battWidgetTopRow}>
                      <View style={[s.battWidgetDot, { backgroundColor: color }]} />
                      <Text style={s.battWidgetAcc} numberOfLines={1}>{acc}</Text>
                    </View>
                    {firearm ? (
                      <Text style={s.battWidgetFirearm} numberOfLines={1}>on {firearm}</Text>
                    ) : null}
                    <Text style={[s.battWidgetDue, { color }]} numberOfLines={1}>
                      🔋 {log.battery_type} · {dueLabel(log)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.battWidgetBtn, bucket === 'overdue' && s.battWidgetBtnUrgent]}
                    onPress={() => handleWidgetReplaced(log)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[s.battWidgetBtnText, bucket === 'overdue' && s.battWidgetBtnTextUrgent]}
                    >
                      Replaced{'\n'}Today
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Batteries Hub — free to view. Reminders are Pro. */}
        <TouchableOpacity
          style={s.insuranceBtn}
          onPress={() => router.push('/batteries')}
        >
          <Text style={s.insuranceIcon}>🔋</Text>
          <View style={{ flex: 1 }}>
            <View style={s.insuranceTitleRow}>
              <Text style={s.insuranceTitle}>Batteries</Text>
              {batteryOverdue > 0 && (
                <View style={[s.countPill, { backgroundColor: '#2A1010', borderColor: '#5A1F1F' }]}>
                  <Text style={[s.countPillText, { color: '#FF5722' }]}>
                    {batteryOverdue} overdue
                  </Text>
                </View>
              )}
            </View>
            <Text style={s.insuranceSub}>
              {batteryLogs.length === 0
                ? 'Track optic, light, and laser batteries'
                : batteryOverdue > 0
                  ? `${batteryOverdue} overdue · ${batteryDueSoon} due soon`
                  : batteryDueSoon > 0
                    ? `${batteryDueSoon} due in the next 30 days`
                    : `${batteryLogs.length} tracked · all good`}
            </Text>
          </View>
          <Text style={s.insuranceChevron}>›</Text>
        </TouchableOpacity>

        {/* Maintenance rollup — only surfaces when the user has set an
            interval on at least one firearm. Keeps the dashboard calm for
            new users who haven't opted into reminders yet. Tapping any
            row jumps to that firearm's detail screen so they can log
            maintenance or adjust the interval. */}
        {maintRollup.total > 0 ? (
          <>
            {(maintRollup.overdue > 0 || maintRollup.dueSoon > 0) ? (
              <View style={s.battWidget}>
                <View style={s.battWidgetHeaderRow}>
                  <Text style={s.battWidgetHeader}>MAINTENANCE DUE</Text>
                </View>
                {maintRollup.entries
                  .filter(e => e.bucket === 'overdue' || e.bucket === 'due_soon')
                  .slice(0, 3)
                  .map((e, i, arr) => {
                    const color = e.bucket === 'overdue' ? '#FF5722' : '#FFC107';
                    const label = e.firearm.nickname?.trim()
                      || `${e.firearm.make} ${e.firearm.model}`;
                    return (
                      <TouchableOpacity
                        key={e.firearm.id}
                        style={[s.battWidgetRow, i < arr.length - 1 && s.battWidgetRowBorder]}
                        onPress={() => router.push(`/firearm/${e.firearm.id}`)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={s.battWidgetTopRow}>
                            <View style={[s.battWidgetDot, { backgroundColor: color }]} />
                            <Text style={s.battWidgetAcc} numberOfLines={1}>{label}</Text>
                          </View>
                          <Text style={[s.battWidgetDue, { color }]} numberOfLines={1}>
                            🔧 {e.label}
                          </Text>
                        </View>
                        <Text style={s.insuranceChevron}>›</Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            ) : null}

            <TouchableOpacity
              style={s.insuranceBtn}
              onPress={() => {
                // Jump to the first entry that needs attention; if every
                // firearm is on track, fall through to the firearms tab.
                const first = maintRollup.entries.find(
                  e => e.bucket === 'overdue' || e.bucket === 'due_soon' || e.bucket === 'pending',
                ) ?? maintRollup.entries[0];
                if (first) {
                  router.push(`/firearm/${first.firearm.id}`);
                } else {
                  router.push('/(tabs)/');
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={s.insuranceIcon}>🔧</Text>
              <View style={{ flex: 1 }}>
                <View style={s.insuranceTitleRow}>
                  <Text style={s.insuranceTitle}>Maintenance</Text>
                  {maintRollup.overdue > 0 ? (
                    <View style={[s.countPill, { backgroundColor: '#2A1010', borderColor: '#5A1F1F' }]}>
                      <Text style={[s.countPillText, { color: '#FF5722' }]}>
                        {maintRollup.overdue} overdue
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.insuranceSub}>
                  {maintRollup.overdue > 0
                    ? `${maintRollup.overdue} overdue · ${maintRollup.dueSoon} due soon`
                    : maintRollup.dueSoon > 0
                      ? `${maintRollup.dueSoon} due in the next 30 days`
                      : maintRollup.pending > 0
                        ? `${maintRollup.pending} awaiting first log`
                        : `${maintRollup.total} tracked · all good`}
                </Text>
              </View>
              <Text style={s.insuranceChevron}>›</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {__DEV__ && (
          <View style={s.devSection}>
            <Text style={s.devLabel}>DEV · TIER OVERRIDE</Text>
            <View style={s.devCard}>
              <Text style={s.devCurrent}>Current: {ent.label}</Text>
              <View style={s.devRow}>
                {TIER_OPTIONS.map(opt => {
                  const active = ent.tier === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[s.devChip, active && s.devChipActive]}
                      onPress={() => ent.setTier(opt.key)}
                    >
                      <Text style={[s.devChipText, active && s.devChipTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.devMetaRow}>
                <Text style={s.devMeta}>Firearms cap: {ent.limits.maxFirearms === Infinity ? '∞' : ent.limits.maxFirearms}</Text>
                <Text style={s.devMeta}>Photos: {ent.limits.maxPhotosPerFirearm}</Text>
                <Text style={s.devMeta}>Acc: {ent.limits.maxAccessoriesPerFirearm === Infinity ? '∞' : ent.limits.maxAccessoriesPerFirearm}</Text>
              </View>
              <Text style={s.devMeta}>Path: {ent.onboardingPath ?? '— not set —'}</Text>
              <TouchableOpacity
                style={s.devReplayBtn}
                onPress={async () => {
                  await ent.setOnboardingComplete(false);
                  router.replace('/onboarding');
                }}
              >
                <Text style={s.devReplayText}>Replay onboarding</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.devResetBtn}
                onPress={async () => {
                  await ent.devReset();
                  router.replace('/onboarding');
                }}
              >
                <Text style={s.devResetText}>Reset entitlements</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Rounds Fired date range picker. Two MM/DD/YYYY inputs; either bound
          may be left blank to create an open-ended range. Apply validates
          format + ordering before committing to state. */}
      <Modal
        visible={rangePickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setRangePickerOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalBackdrop}
        >
          <TouchableOpacity
            style={s.modalBackdropTap}
            activeOpacity={1}
            onPress={() => setRangePickerOpen(false)}
          />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Date Range</Text>
            <Text style={s.modalSub}>Leave a field blank for an open-ended range.</Text>

            <Text style={s.modalLabel}>Start (MM/DD/YYYY)</Text>
            <TextInput
              style={s.modalInput}
              placeholder="01/01/2025"
              placeholderTextColor="#444"
              keyboardType="number-pad"
              value={draftStart}
              onChangeText={t => setDraftStart(autoFormatDateLocal(t, draftStart))}
              maxLength={10}
            />

            <Text style={s.modalLabel}>End (MM/DD/YYYY)</Text>
            <TextInput
              style={s.modalInput}
              placeholder="12/31/2025"
              placeholderTextColor="#444"
              keyboardType="number-pad"
              value={draftEnd}
              onChangeText={t => setDraftEnd(autoFormatDateLocal(t, draftEnd))}
              maxLength={10}
            />

            <View style={s.modalBtnRow}>
              <TouchableOpacity style={[s.modalBtn, s.modalBtnGhost]} onPress={clearRange}>
                <Text style={s.modalBtnGhostText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnGhost]}
                onPress={() => setRangePickerOpen(false)}
              >
                <Text style={s.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.modalBtnPrimary]} onPress={applyRange}>
                <Text style={s.modalBtnPrimaryText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  headerSub: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  headerTitle: { color: '#FFF', fontSize: 28, fontWeight: '800', marginTop: 2 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statCard: { backgroundColor: SURFACE, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: BORDER },
  card: { backgroundColor: SURFACE, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: BORDER },
  gainCard: { marginBottom: 20 },
  statLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  statValue: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  gainValue: { fontSize: 26, fontWeight: '800', marginTop: 4 },
  roundsTotal: { color: GOLD, fontSize: 32, fontWeight: '800', marginTop: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  barRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  barLabel: { color: '#AAAAAA', fontSize: 13, width: 110 },
  barTrack: { flex: 1, height: 8, backgroundColor: '#252525', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barValue: { color: '#FFF', fontSize: 13, fontWeight: '700', width: 40, textAlign: 'right' },
  insuranceBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: SURFACE,
    borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: BORDER },
  insuranceIcon: { fontSize: 28 },
  insuranceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insuranceTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  insuranceSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  insuranceChevron: { color: '#444', fontSize: 22 },
  proPill: { backgroundColor: '#2A2115', borderColor: '#3A2C18', borderWidth: 1,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proPillText: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  previewPill: { backgroundColor: 'rgba(245, 197, 24, 0.12)', borderColor: '#5C4800',
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  previewPillText: { color: '#F5C518', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  spotlight: {
    backgroundColor: '#1E1A10', borderRadius: 14, borderWidth: 1, borderColor: GOLD,
    padding: 18, marginBottom: 20, position: 'relative',
  },
  spotlightClose: {
    position: 'absolute', top: 6, right: 10,
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
  },
  spotlightCloseText: { color: MUTED, fontSize: 22, fontWeight: '400', lineHeight: 24 },
  spotlightIcon: { fontSize: 26, marginBottom: 6 },
  spotlightEyebrow: { color: GOLD, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  spotlightTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  spotlightSub: { color: '#CCCCCC', fontSize: 13, lineHeight: 18, marginBottom: 14 },
  spotlightCta: {
    alignSelf: 'flex-start', backgroundColor: GOLD,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  spotlightCtaText: { color: '#0D0D0D', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  countPill: { backgroundColor: '#1E1E1E', borderColor: BORDER, borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1, minWidth: 22, alignItems: 'center' },
  countPillText: { color: '#CCCCCC', fontSize: 11, fontWeight: '700' },

  // Urgent-battery widget (renders above the Batteries nav tile)
  battWidget: { backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
    borderColor: BORDER, marginBottom: 12, overflow: 'hidden' },
  battWidgetHeaderRow: { flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 12,
    paddingBottom: 6 },
  battWidgetHeader: { color: GOLD, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  battWidgetSeeAll: { color: GOLD, fontSize: 12, fontWeight: '700' },
  battWidgetRow: { flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12 },
  battWidgetRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  battWidgetTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  battWidgetDot: { width: 8, height: 8, borderRadius: 4 },
  battWidgetAcc: { color: '#FFF', fontSize: 14, fontWeight: '700', flex: 1 },
  battWidgetFirearm: { color: MUTED, fontSize: 11, marginTop: 2, marginLeft: 14 },
  battWidgetDue: { fontSize: 11, fontWeight: '700', marginTop: 3, marginLeft: 14 },
  battWidgetBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#141414', borderWidth: 1, borderColor: BORDER, minWidth: 78,
    alignItems: 'center' },
  battWidgetBtnUrgent: { backgroundColor: 'rgba(255,87,34,0.12)', borderColor: 'rgba(255,87,34,0.35)' },
  battWidgetBtnText: { color: GOLD, fontSize: 11, fontWeight: '800', textAlign: 'center',
    lineHeight: 13 },
  battWidgetBtnTextUrgent: { color: '#FF5722' },
  ammoWidgetChevron: { color: '#444', fontSize: 22, marginLeft: 8 },

  // Dev-only entitlement toggle
  devSection: { marginTop: 8 },
  devLabel: { color: '#FF5722', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  devCard: { backgroundColor: SURFACE, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#3A2A1A', marginBottom: 20 },
  devCurrent: { color: '#FFF', fontSize: 14, fontWeight: '700', marginBottom: 12 },
  devRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  devChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: BORDER, alignItems: 'center', backgroundColor: '#121212' },
  devChipActive: { borderColor: GOLD, backgroundColor: '#2A2115' },
  devChipText: { color: '#888', fontSize: 13, fontWeight: '600' },
  devChipTextActive: { color: GOLD },
  devMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  devMeta: { color: MUTED, fontSize: 11 },
  devResetBtn: { paddingVertical: 8, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#3A2A1A' },
  devResetText: { color: '#FF5722', fontSize: 12, fontWeight: '600' },
  devReplayBtn: { paddingVertical: 8, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#3A3420', marginTop: 6 },
  devReplayText: { color: '#C9A84C', fontSize: 12, fontWeight: '600' },

  // Rounds Fired header + range button
  roundsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 4,
  },
  rangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#141414',
  },
  rangeBtnIcon: { fontSize: 12 },
  rangeBtnText: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },

  // Date range modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalBackdropTap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    marginBottom: 12,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: MUTED, fontSize: 12, marginBottom: 16 },
  modalLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginTop: 6 },
  modalInput: {
    backgroundColor: '#121212',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 15,
    marginBottom: 4,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  modalBtnGhost: { backgroundColor: '#141414', borderWidth: 1, borderColor: BORDER },
  modalBtnGhostText: { color: '#AAA', fontSize: 13, fontWeight: '700' },
  modalBtnPrimary: { backgroundColor: GOLD },
  modalBtnPrimaryText: { color: '#0D0D0D', fontSize: 13, fontWeight: '800' },
});