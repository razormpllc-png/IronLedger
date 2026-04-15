// Subscription — /subscription
//
// Central screen for managing the user's Iron Ledger tier. Fulfills the
// App Store Review "user must be able to manage their subscription"
// requirement by surfacing Restore Purchases and a deep link to the
// platform-managed subscription page.
//
// Works in both stub mode (PURCHASES_ENABLED=false) and live mode. In stub
// mode the "Live mode" indicator flips off and the manage link still works
// — it just takes the user to an empty App Store subscriptions sheet.

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useEntitlements } from '../lib/useEntitlements';
import { entitlementsStore, tierLabel } from '../lib/entitlements';
import {
  restorePurchases, openManageSubscriptions, purchasesLiveMode,
  getSubscriptionSummary, SubscriptionSummary,
} from '../lib/purchases';
import { showPaywall } from '../lib/paywall';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#E8E6DF';
const MUTED = '#8A8A8A';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return null; }
}

export default function SubscriptionScreen() {
  const ent = useEntitlements();
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'restore' | 'manage'>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await getSubscriptionSummary());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  async function handleRestore() {
    if (busy) return;
    setBusy('restore');
    try {
      const res = await restorePurchases();
      await loadSummary();
      if (res.success) {
        if (res.tier === 'lite') {
          Alert.alert(
            'No Purchases Found',
            'We didn\'t find any active purchases tied to this store account.',
          );
        } else {
          Alert.alert(
            'Restored',
            `You're on ${tierLabel(res.tier)}.`,
          );
        }
      } else if (!res.cancelled) {
        Alert.alert('Restore Failed', res.error ?? 'Please try again.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleManage() {
    if (busy) return;
    setBusy('manage');
    try {
      const ok = await openManageSubscriptions();
      if (!ok) {
        Alert.alert(
          'Could Not Open',
          'Open the App Store or Play Store subscriptions page manually to make changes.',
        );
      }
    } finally {
      setBusy(null);
    }
  }

  function handleDevReset() {
    Alert.alert(
      'Reset Entitlements',
      'This clears your tier, onboarding path, and spotlight state. Dev-only — will not affect any real store subscription.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await entitlementsStore.devReset();
            await loadSummary();
          },
        },
      ],
    );
  }

  const live = purchasesLiveMode();
  const expires = formatDate(summary?.expiresAt ?? null);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancel}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Subscription</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Current tier card */}
        <View style={s.tierCard}>
          <Text style={s.tierLabel}>CURRENT PLAN</Text>
          <Text style={s.tierName}>{tierLabel(ent.tier)}</Text>
          {ent.isPro ? (
            <Text style={s.tierSub}>
              Every Pro feature is unlocked. Manage billing below.
            </Text>
          ) : (
            <Text style={s.tierSub}>
              Upgrade to unlock unlimited firearms, NFA tracking, DOPE cards,
              insurance & bound-book exports, and more.
            </Text>
          )}
          {!ent.isPro ? (
            <TouchableOpacity
              style={s.upgradeBtn}
              activeOpacity={0.85}
              onPress={() => showPaywall({ mode: 'contextual' })}
            >
              <Text style={s.upgradeBtnText}>See Pro Plans</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Billing summary — only shown when live mode returns real data. */}
        {loading ? (
          <View style={s.loadingRow}>
            <ActivityIndicator color={GOLD} />
          </View>
        ) : live && summary && (summary.productId || summary.expiresAt) ? (
          <View style={s.detailCard}>
            <Text style={s.detailLabel}>BILLING</Text>
            {summary.productId ? (
              <Row k="Product" v={summary.productId} />
            ) : null}
            {summary.store ? <Row k="Store" v={summary.store} /> : null}
            {summary.periodType ? (
              <Row k="Period" v={summary.periodType} />
            ) : null}
            {expires ? (
              <Row
                k={summary.willRenew === false ? 'Expires' : 'Renews'}
                v={expires}
              />
            ) : null}
            {summary.willRenew === false ? (
              <Text style={s.detailNote}>
                Auto-renew is off — your access ends on the date above.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Actions */}
        <TouchableOpacity
          style={s.row}
          onPress={handleManage}
          disabled={busy !== null}
          activeOpacity={0.8}
        >
          <Text style={s.rowIcon}>💳</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Manage Subscription</Text>
            <Text style={s.rowSub}>
              Change plan or cancel in the App Store / Play Store.
            </Text>
          </View>
          {busy === 'manage'
            ? <ActivityIndicator color={GOLD} />
            : <Text style={s.rowChev}>›</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.row}
          onPress={handleRestore}
          disabled={busy !== null}
          activeOpacity={0.8}
        >
          <Text style={s.rowIcon}>🔁</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Restore Purchases</Text>
            <Text style={s.rowSub}>
              Re-apply purchases tied to your store account.
            </Text>
          </View>
          {busy === 'restore'
            ? <ActivityIndicator color={GOLD} />
            : <Text style={s.rowChev}>›</Text>}
        </TouchableOpacity>

        {/* Dev-only diagnostics. __DEV__ is a Metro global. */}
        {__DEV__ ? (
          <View style={s.devCard}>
            <Text style={s.devLabel}>DEVELOPER</Text>
            <Text style={s.devRow}>
              Purchases mode: <Text style={s.devRowVal}>{live ? 'LIVE' : 'STUB'}</Text>
            </Text>
            <Text style={s.devRow}>
              Stored tier: <Text style={s.devRowVal}>{ent.tier}</Text>
            </Text>
            <TouchableOpacity
              style={s.devBtn}
              onPress={handleDevReset}
              activeOpacity={0.8}
            >
              <Text style={s.devBtnText}>Reset Entitlements</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailKey}>{k}</Text>
      <Text style={s.detailVal} numberOfLines={1}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  cancel: { color: GOLD, fontSize: 16, width: 60 },
  title: { color: TEXT, fontSize: 18, fontWeight: '700' },

  tierCard: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
    borderColor: BORDER, padding: 18, marginBottom: 16,
  },
  tierLabel: {
    color: GOLD, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, marginBottom: 8,
  },
  tierName: { color: TEXT, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  tierSub: { color: MUTED, fontSize: 13, lineHeight: 19 },
  upgradeBtn: {
    marginTop: 16, backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  upgradeBtnText: {
    color: '#0D0D0D', fontSize: 15, fontWeight: '800', letterSpacing: 0.4,
  },

  loadingRow: { paddingVertical: 20, alignItems: 'center' },
  detailCard: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
    borderColor: BORDER, padding: 16, marginBottom: 16,
  },
  detailLabel: {
    color: GOLD, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, marginBottom: 10,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER,
  },
  detailKey: { color: MUTED, fontSize: 13 },
  detailVal: { color: TEXT, fontSize: 13, fontWeight: '600', maxWidth: '60%' },
  detailNote: { color: '#F5C518', fontSize: 12, marginTop: 10, lineHeight: 17 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
    borderColor: BORDER, padding: 16, marginBottom: 12,
  },
  rowIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  rowTitle: { color: TEXT, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  rowSub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  rowChev: { color: '#555', fontSize: 22 },

  devCard: {
    marginTop: 16, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#3A2C18', backgroundColor: '#1A1510',
  },
  devLabel: {
    color: GOLD, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.4, marginBottom: 10,
  },
  devRow: { color: MUTED, fontSize: 12, marginBottom: 4 },
  devRowVal: { color: TEXT, fontFamily: 'Menlo', fontWeight: '700' },
  devBtn: {
    marginTop: 10, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#5C4800', alignItems: 'center',
  },
  devBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },
});
