// Form 4 Tracker — /form-4-tracker
//
// Dedicated view for NFA items (firearms + suppressors) that aren't yet
// approved. Shows a wait-time summary strip (pending / oldest / avg wait)
// and lists every pending item sorted by days-in-queue descending so the
// user sees stale filings first. Tap a row to jump to the item's detail.
// Check-ins are currently firearm-only; the button is hidden on suppressor
// rows until the suppressor_checkins table lands.
//
// Pro-gated via `nfa_tracking` — Lite users who somehow land here see a
// paywall promo card since they can't have NFA items.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getPendingNfaItems, getPendingNfaSuppressors, addForm4Checkin, getForm4Checkins, formatDate,
} from '../lib/database';
import type { Firearm, Suppressor } from '../lib/database';
import {
  computeWaitTimeStats, daysWaiting, projectApprovalDate, formatProjectedDate,
  type NfaTrackable,
} from '../lib/nfaStats';
import { useEntitlements } from '../lib/useEntitlements';
import { showPaywall } from '../lib/paywall';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const AMBER = '#FFC107';
const GREEN = '#4CAF50';
const RED = '#FF5722';

const CHECK_METHODS = ['eForms', 'Phone', 'Dealer', 'Other'];

/** Unified pending-item entry so the list can render both firearms and
 *  suppressors through the same card. `kind` drives icons + routing. */
type PendingEntry =
  | { kind: 'firearm'; item: Firearm }
  | { kind: 'suppressor'; item: Suppressor };

/** Color the "days waiting" chip so stale filings pop.
 *  0–180: amber, 181–365: orange, 366+: red. */
function daysChipColor(days: number | null): string {
  if (days === null) return MUTED;
  if (days >= 366) return RED;
  if (days >= 181) return '#FF9800';
  return AMBER;
}

export default function Form4Tracker() {
  const router = useRouter();
  const ent = useEntitlements();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [checkinTarget, setCheckinTarget] = useState<Firearm | null>(null);

  useFocusEffect(
    useCallback(() => {
      const firearms = getPendingNfaItems();
      const suppressors = getPendingNfaSuppressors();
      const merged: PendingEntry[] = [
        ...firearms.map((f): PendingEntry => ({ kind: 'firearm', item: f })),
        ...suppressors.map((s): PendingEntry => ({ kind: 'suppressor', item: s })),
      ];
      setEntries(merged);
    }, [])
  );

  // Stats are computed off ALL pending trackables. Pending rows don't have
  // date_approved, so until we pull approved history this mostly surfaces
  // "oldest in queue" — which is the most actionable number anyway.
  const trackables: NfaTrackable[] = useMemo(() => entries.map(e => e.item), [entries]);
  const stats = useMemo(() => computeWaitTimeStats(trackables), [trackables]);

  // Sort pending items by days-in-queue DESC so stale filings surface first.
  // Rows without a filed date sink to the bottom.
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const da = daysWaiting(a.item);
      const db = daysWaiting(b.item);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
  }, [entries]);

  const oldest = sorted.length > 0 ? daysWaiting(sorted[0].item) : null;

  function refresh() {
    const firearms = getPendingNfaItems();
    const suppressors = getPendingNfaSuppressors();
    setEntries([
      ...firearms.map((f): PendingEntry => ({ kind: 'firearm', item: f })),
      ...suppressors.map((s): PendingEntry => ({ kind: 'suppressor', item: s })),
    ]);
  }

  function openCheckin(f: Firearm) {
    setCheckinTarget(f);
  }

  function closeCheckin() {
    setCheckinTarget(null);
    refresh();
  }

  if (!ent.isPro) {
    return (
      <SafeAreaView style={s.safe}>
        <Header onBack={() => router.back()} />
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🏷️</Text>
          <Text style={s.emptyTitle}>Form 4 Tracker is Pro</Text>
          <Text style={s.emptySub}>Track pending stamps, wait times, and ATF check-ins.</Text>
          <TouchableOpacity style={s.upgradeBtn} onPress={() => showPaywall({ mode: 'contextual', feature: 'nfa_tracking' })}>
            <Text style={s.upgradeBtnText}>See Pro Features</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <Header onBack={() => router.back()} />

      {/* Summary strip */}
      <View style={s.summaryRow}>
        <Stat label="Pending" value={String(entries.length)} accent={AMBER} />
        <Stat
          label="Oldest"
          value={oldest !== null ? `${oldest}d` : '—'}
          accent={daysChipColor(oldest)}
        />
        <Stat
          label="Avg wait"
          value={stats.avg !== null ? `${stats.avg}d` : '—'}
          accent={GREEN}
        />
      </View>

      {sorted.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>✅</Text>
          <Text style={s.emptyTitle}>No Pending Stamps</Text>
          <Text style={s.emptySub}>Filed Form 1s, Form 4s, and Form 3s will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(e) => `${e.kind}-${e.item.id}`}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <PendingCard
              entry={item}
              stats={stats}
              onPress={() => {
                if (item.kind === 'firearm') router.push(`/firearm/${item.item.id}`);
                else router.push(`/suppressor/${item.item.id}`);
              }}
              onLogCheckin={item.kind === 'firearm' ? () => openCheckin(item.item) : undefined}
            />
          )}
        />
      )}

      <CheckinSheet firearm={checkinTarget} onClose={closeCheckin} />
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity onPress={onBack}>
        <Text style={s.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={s.title}>Form 4 Tracker</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statValue, { color: accent }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function PendingCard({
  entry, stats, onPress, onLogCheckin,
}: {
  entry: PendingEntry;
  stats: ReturnType<typeof computeWaitTimeStats>;
  onPress: () => void;
  onLogCheckin?: () => void;
}) {
  const item = entry.item;
  const days = daysWaiting(item);
  const projected = projectApprovalDate(item.date_filed, stats);
  const projectedLabel = formatProjectedDate(projected);

  // Firearm-specific metadata; suppressors use their own shape.
  const isFirearm = entry.kind === 'firearm';
  const title = isFirearm
    ? ((entry.item.nickname || `${entry.item.make} ${entry.item.model}`))
    : `${entry.item.make} ${entry.item.model}`;
  const subtitleParts = isFirearm
    ? [entry.item.nfa_form_type, entry.item.nfa_item_category]
    : [entry.item.nfa_form_type, 'Suppressor'];
  const subtitle = subtitleParts.filter(Boolean).join(' · ');
  const filedLabel = formatDate(item.date_filed) ?? 'Not filed';
  const checkinCount = isFirearm ? getForm4Checkins(entry.item.id).length : 0;

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.75}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={s.titleRow}>
            <Text style={s.cardTitle} numberOfLines={1}>{title}</Text>
            {!isFirearm ? (
              <View style={s.kindBadge}>
                <Text style={s.kindBadgeText}>SUPPRESSOR</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? <Text style={s.cardSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={[s.daysPill, { backgroundColor: daysChipColor(days) + '22', borderColor: daysChipColor(days) }]}>
          <Text style={[s.daysPillText, { color: daysChipColor(days) }]}>
            {days !== null ? `${days}d` : '—'}
          </Text>
        </View>
      </View>

      <View style={s.cardRow}>
        <Text style={s.metaLabel}>Filed</Text>
        <Text style={s.metaValue}>{filedLabel}</Text>
      </View>
      {item.atf_control_number ? (
        <View style={s.cardRow}>
          <Text style={s.metaLabel}>Control #</Text>
          <Text style={s.metaValue} numberOfLines={1}>{item.atf_control_number}</Text>
        </View>
      ) : null}
      {projectedLabel ? (
        <View style={s.cardRow}>
          <Text style={s.metaLabel}>Est. approval</Text>
          <Text style={s.metaValue}>{projectedLabel}</Text>
        </View>
      ) : null}

      {isFirearm ? (
        <View style={s.cardFooter}>
          <Text style={s.checkinCount}>
            {checkinCount > 0 ? `🕑  ${checkinCount} check-in${checkinCount === 1 ? '' : 's'}` : 'No check-ins'}
          </Text>
          {onLogCheckin ? (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation?.(); onLogCheckin(); }}
              style={s.checkinBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.checkinBtnText}>+ Check-in</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function CheckinSheet({ firearm, onClose }: { firearm: Firearm | null; onClose: () => void }) {
  const [method, setMethod] = useState<string>('eForms');
  const [note, setNote] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  function handleSave() {
    if (!firearm) return;
    try {
      addForm4Checkin({
        firearm_id: firearm.id,
        checkin_date: today,
        method,
        note: note.trim() || null,
      });
      setNote('');
      setMethod('eForms');
      onClose();
    } catch (e) {
      Alert.alert('Save failed', 'Could not log the check-in.');
    }
  }

  return (
    <Modal visible={!!firearm} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Log ATF Check-in</Text>
          <Text style={s.modalSub}>
            {firearm ? (firearm.nickname || `${firearm.make} ${firearm.model}`) : ''}
          </Text>

          <Text style={s.sectionLabel}>METHOD</Text>
          <View style={s.chipRow}>
            {CHECK_METHODS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.chip, method === m && s.chipActive]}
                onPress={() => setMethod(m)}>
                <Text style={[s.chipText, method === m && s.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>NOTE</Text>
          <TextInput
            style={s.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Still in pending status, CSR confirmed no flags"
            placeholderTextColor={MUTED}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalCancel} onPress={onClose}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalSave} onPress={handleSave}>
              <Text style={s.modalSaveText}>Save Check-in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  back: { color: GOLD, fontSize: 17, width: 60 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  summaryRow: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 16,
  },
  statBox: {
    flex: 1, backgroundColor: CARD, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: BORDER,
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { color: MUTED, fontSize: 12, marginTop: 2, letterSpacing: 0.8 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: CARD, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  kindBadge: {
    backgroundColor: '#1E1A10', borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  kindBadgeText: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  daysPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  daysPillText: { fontSize: 13, fontWeight: '700' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  metaLabel: { color: MUTED, fontSize: 13 },
  metaValue: { color: '#DDD', fontSize: 13, flex: 1, textAlign: 'right', marginLeft: 12 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER,
  },
  checkinCount: { color: MUTED, fontSize: 12 },
  checkinBtn: {
    backgroundColor: '#1E1A10', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: GOLD,
  },
  checkinBtnText: { color: GOLD, fontSize: 13, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  emptySub: { color: MUTED, fontSize: 15, textAlign: 'center' },
  upgradeBtn: {
    backgroundColor: GOLD, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8,
  },
  upgradeBtnText: { color: BG, fontSize: 15, fontWeight: '700' },

  // Check-in modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: BG, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  modalHandle: {
    width: 40, height: 4, backgroundColor: '#444', borderRadius: 2,
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  modalSub: { color: MUTED, fontSize: 13, marginTop: 4, marginBottom: 16 },
  sectionLabel: {
    color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    marginBottom: 8, marginTop: 12,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: CARD, borderWidth: 1, borderColor: '#333',
  },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
  noteInput: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 10,
    color: '#FFF', fontSize: 15, padding: 12, minHeight: 80, marginTop: 4,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  modalCancelText: { color: MUTED, fontSize: 15, fontWeight: '600' },
  modalSave: {
    flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: GOLD,
  },
  modalSaveText: { color: BG, fontSize: 15, fontWeight: '700' },
});
