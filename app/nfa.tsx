// NFA Hub — /nfa
//
// Timeline view of every NFA-marked firearm grouped by status
// (pending / approved / denied / unfiled), with personal wait-time stats
// computed from approved items. Pro-gated via `nfa_tracking` — Lite users
// see a paywall preview on tap.

import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { getAllNfaItems, getAllSuppressors, formatDate } from '../lib/database';
import type { Firearm, Suppressor } from '../lib/database';
import {
  groupByStatus, computeWaitTimeStats, waitTimeDays, daysWaiting,
  projectApprovalDate, formatProjectedDate,
} from '../lib/nfaStats';
import type { NfaBucket } from '../lib/nfaStats';
import { useEntitlements } from '../lib/useEntitlements';
import { runProGated } from '../lib/paywall';
import { generateTrustExport } from '../lib/trustExport';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const BUCKET_COLORS: Record<NfaBucket, string> = {
  pending: '#FFC107',
  approved: '#4CAF50',
  denied: '#FF5722',
  unfiled: '#666666',
};

/** Discriminated NFA entry so the hub can render firearms and suppressors
 *  through the same row template while keeping type-narrow field access. */
type NfaEntry =
  | { kind: 'firearm'; item: Firearm }
  | { kind: 'suppressor'; item: Suppressor };

export default function NfaHub() {
  const router = useRouter();
  const ent = useEntitlements();
  const [items, setItems] = useState<NfaEntry[]>([]);
  const [exporting, setExporting] = useState(false);

  async function handleTrustExport() {
    // Guard: offer the attorney-ready PDF as a Pro feature. Lite users get
    // the standard paywall preview.
    runProGated('nfa_tracking', async () => {
      if (exporting) return;
      setExporting(true);
      try {
        const result = await generateTrustExport();
        if (!result.ok && result.reason === 'empty') {
          Alert.alert(
            'Nothing to Export',
            'Add an NFA firearm or suppressor first, then try again.',
          );
        }
      } catch (e: any) {
        Alert.alert('Export Failed', e?.message ?? 'Could not generate the PDF. Please try again.');
      } finally {
        setExporting(false);
      }
    });
  }

  useFocusEffect(
    useCallback(() => {
      const firearms = getAllNfaItems();
      const suppressors = getAllSuppressors();
      setItems([
        ...firearms.map((f): NfaEntry => ({ kind: 'firearm', item: f })),
        ...suppressors.map((s): NfaEntry => ({ kind: 'suppressor', item: s })),
      ]);
    }, [])
  );

  // Group + stat helpers operate on the underlying NfaTrackable shape.
  // We keep parallel arrays: one of entries (for rendering with type-narrow
  // access) and one of plain items (for the generic helpers).
  const entryByItem = useMemo(() => {
    const map = new Map<any, NfaEntry>();
    for (const e of items) map.set(e.item, e);
    return map;
  }, [items]);
  const trackables = useMemo(() => items.map(e => e.item), [items]);
  const groups = useMemo(() => groupByStatus(trackables), [trackables]);
  const stats = useMemo(() => computeWaitTimeStats(trackables), [trackables]);

  // Aggregate counts for the header summary strip.
  const pendingCount = trackables.filter(f => f.atf_form_status?.toLowerCase().includes('pending') || (f.date_filed && !f.date_approved)).length;
  const approvedCount = trackables.filter(f => f.atf_form_status?.toLowerCase().includes('approved') || f.date_approved).length;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>NFA Hub</Text>
        <TouchableOpacity onPress={() => router.push('/nfa-trusts')}>
          <Text style={s.headerAction}>Trusts</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Summary strip */}
        <View style={s.summaryRow}>
          <SummaryCard label="Total" value={trackables.length.toString()} />
          <SummaryCard label="Pending" value={pendingCount.toString()} color="#FFC107" />
          <SummaryCard label="Approved" value={approvedCount.toString()} color="#4CAF50" />
        </View>

        {/* Trust-ready export — hands the attorney a single PDF with every
            NFA item, grouped by trust, with serials + stamps + responsible
            persons. Pro-gated. */}
        <TouchableOpacity
          style={s.exportBtn}
          onPress={handleTrustExport}
          disabled={exporting}
          activeOpacity={0.75}
        >
          <Text style={s.exportIcon}>📎</Text>
          <View style={{ flex: 1 }}>
            <View style={s.exportTitleRow}>
              <Text style={s.exportTitle}>Export for Attorney / Trustee</Text>
              {!ent.isPro && <View style={s.proPill}><Text style={s.proPillText}>PRO</Text></View>}
            </View>
            <Text style={s.exportSub}>
              PDF of every NFA item grouped by trust — serials, stamps, responsible persons.
            </Text>
          </View>
          {exporting ? (
            <ActivityIndicator color={GOLD} />
          ) : (
            <Text style={s.exportChevron}>›</Text>
          )}
        </TouchableOpacity>

        {/* Wait-time stats */}
        {stats.count > 0 ? (
          <>
            <Text style={s.sectionLabel}>YOUR WAIT TIMES</Text>
            <View style={s.card}>
              <View style={s.statsGrid}>
                <StatBlock label="Avg" value={stats.avg !== null ? `${stats.avg}d` : '—'} />
                <StatBlock label="Median" value={stats.median !== null ? `${stats.median}d` : '—'} />
                <StatBlock label="Fastest" value={stats.min !== null ? `${stats.min}d` : '—'} />
                <StatBlock label="Slowest" value={stats.max !== null ? `${stats.max}d` : '—'} />
              </View>
              <Text style={s.statsSub}>
                Based on {stats.count} approved {stats.count === 1 ? 'item' : 'items'}.
              </Text>
            </View>
          </>
        ) : trackables.length > 0 ? (
          <View style={s.card}>
            <Text style={s.emptyStatsText}>
              Wait-time stats unlock once you log an approval date on one of your NFA items.
            </Text>
          </View>
        ) : null}

        {/* Groups */}
        {trackables.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyEmoji}>🎟️</Text>
            <Text style={s.emptyTitle}>No NFA items yet</Text>
            <Text style={s.emptySub}>
              Flip the NFA toggle on any firearm to track its tax stamp. Approved stamps power your wait-time stats.
            </Text>
            <TouchableOpacity style={s.emptyCta} onPress={() => router.push('/add-firearm')}>
              <Text style={s.emptyCtaText}>Add NFA Item</Text>
            </TouchableOpacity>
          </View>
        ) : (
          groups.map(group => (
            <View key={group.bucket} style={{ marginBottom: 20 }}>
              <View style={s.groupHeader}>
                <View style={[s.groupDot, { backgroundColor: BUCKET_COLORS[group.bucket] }]} />
                <Text style={s.groupLabel}>{group.label}</Text>
                <Text style={s.groupCount}>{group.items.length}</Text>
              </View>
              <View style={s.groupCard}>
                {group.items.map((item, i) => {
                  const entry = entryByItem.get(item);
                  if (!entry) return null;
                  return (
                    <NfaRow
                      key={`${entry.kind}-${entry.item.id}`}
                      entry={entry}
                      bucket={group.bucket}
                      statsAvg={stats.avg}
                      last={i === group.items.length - 1}
                      onPress={() =>
                        entry.kind === 'firearm'
                          ? router.push(`/firearm/${entry.item.id}`)
                          : router.push(`/suppressor/${entry.item.id}`)
                      }
                    />
                  );
                })}
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.sumCard}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={[s.sumValue, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.statBlock}>
      <Text style={s.statBlockValue}>{value}</Text>
      <Text style={s.statBlockLabel}>{label}</Text>
    </View>
  );
}

function NfaRow({
  entry, bucket, statsAvg, last, onPress,
}: {
  entry: NfaEntry;
  bucket: NfaBucket;
  statsAvg: number | null;
  last: boolean;
  onPress: () => void;
}) {
  const item = entry.item;
  // Firearms carry a nickname + item_category; suppressors fall back to
  // make/model and a "Suppressor · Form X" subtitle.
  const name = entry.kind === 'firearm'
    ? (entry.item.nickname ?? `${entry.item.make} ${entry.item.model}`)
    : `${entry.item.make} ${entry.item.model}`;
  const category = entry.kind === 'firearm'
    ? (entry.item.nfa_item_category ?? entry.item.nfa_form_type ?? 'NFA')
    : `Suppressor${entry.item.nfa_form_type ? ` · ${entry.item.nfa_form_type}` : ''}`;

  let meta: string | null = null;
  let metaColor = MUTED;

  if (bucket === 'approved') {
    const w = waitTimeDays(item);
    if (w !== null) {
      meta = `${w}-day wait · approved ${formatDate(item.date_approved) ?? item.date_approved}`;
      metaColor = '#4CAF50';
    } else if (item.date_approved) {
      meta = `Approved ${formatDate(item.date_approved) ?? item.date_approved}`;
      metaColor = '#4CAF50';
    }
  } else if (bucket === 'pending') {
    const d = daysWaiting(item);
    if (d !== null) {
      const projected = projectApprovalDate(item.date_filed, { count: 1, avg: statsAvg, median: null, min: null, max: null, fastest: null, slowest: null } as any);
      const projStr = formatProjectedDate(projected);
      meta = projStr
        ? `${d} days waiting · est. ~${projStr}`
        : `${d} days waiting`;
      metaColor = '#FFC107';
    } else {
      meta = 'Filed — no date recorded';
    }
  } else if (bucket === 'denied') {
    meta = 'Denied';
    metaColor = '#FF5722';
  } else if (bucket === 'unfiled') {
    meta = 'Not yet filed';
  }

  // Superseded ATF form records (post brace-reclassification) stay visible
  // here as historical audit rows but render dimmed with a clear badge.
  const superseded = entry.kind === 'firearm' && !!entry.item.superseded;

  return (
    <TouchableOpacity
      style={[s.row, !last && s.rowBorder, superseded && s.rowSuperseded]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <View style={s.rowTitleRow}>
          <Text style={s.rowName} numberOfLines={1}>{name}</Text>
          {entry.kind === 'suppressor' ? (
            <View style={s.kindBadge}>
              <Text style={s.kindBadgeText}>SUPPRESSOR</Text>
            </View>
          ) : null}
          {superseded ? (
            <View style={s.supersededBadge}>
              <Text style={s.supersededBadgeText}>SUPERSEDED</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.rowSub} numberOfLines={1}>{category}</Text>
        {meta ? <Text style={[s.rowMeta, { color: metaColor }]}>{meta}</Text> : null}
      </View>
      <Text style={s.chev}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  back: { color: GOLD, fontSize: 17 },
  title: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  headerAction: { color: GOLD, fontSize: 15, fontWeight: '600' },
  scroll: { padding: 16, paddingTop: 20 },

  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE, borderRadius: 12, padding: 14, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER,
  },
  exportIcon: { fontSize: 22 },
  exportTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exportTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  exportSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  exportChevron: { color: MUTED, fontSize: 20 },
  proPill: {
    backgroundColor: '#1E1A10', borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  proPillText: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindBadge: {
    backgroundColor: '#1E1A10', borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  kindBadgeText: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  supersededBadge: {
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: MUTED,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  supersededBadgeText: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  rowSuperseded: { opacity: 0.55 },

  sumCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
  },
  sumLabel: { color: MUTED, fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 6 },
  sumValue: { color: '#FFF', fontSize: 22, fontWeight: '800' },

  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: SURFACE, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: BORDER },

  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  statBlock: { flex: 1, alignItems: 'center' },
  statBlockValue: { color: GOLD, fontSize: 20, fontWeight: '800' },
  statBlockLabel: { color: MUTED, fontSize: 11, fontWeight: '600', marginTop: 2, letterSpacing: 0.5 },
  statsSub: { color: MUTED, fontSize: 12, textAlign: 'center' },
  emptyStatsText: { color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 8 },

  groupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingHorizontal: 4, gap: 8 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupLabel: { color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  groupCount: { color: MUTED, fontSize: 13, fontWeight: '600' },

  groupCard: { backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rowName: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  rowSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  rowMeta: { fontSize: 12, marginTop: 6, fontWeight: '600' },
  chev: { color: '#444', fontSize: 20 },

  emptyCard: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 24, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
  },
  emptyEmoji: { fontSize: 36, marginBottom: 10 },
  emptyTitle: { color: '#FFF', fontSize: 17, fontWeight: '700', marginBottom: 6 },
  emptySub: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 16 },
  emptyCta: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: GOLD, backgroundColor: '#1E1A10',
  },
  emptyCtaText: { color: GOLD, fontSize: 14, fontWeight: '700' },
});
