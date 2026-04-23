// Range tab — top-level segmented control splits the space into:
//
//   SESSIONS: the round-count / trip log (existing behavior).
//   DOPE:     per-firearm DOPE cards, the new v2 feature.
//
// Both lists share the same FAB — its behavior + pro-gating swaps based
// on which segment is active.

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getAllRangeSessions, deleteRangeSession, formatDate, formatDateShort,
  getAllDopeCards, deleteDopeCard,
  getAllCompetitionMatches, deleteCompetitionMatch,
  RangeSessionWithStats, DopeCardWithMeta, CompetitionMatchWithMeta,
} from '../../lib/database';
import { syncWidgets } from '../../lib/widgetSync';
import { runProGated } from '../../lib/paywall';

// Match type accent colors (same as match detail screen).
const MATCH_TYPE_COLORS: Record<string, string> = {
  USPSA: '#4A90D9',
  IDPA: '#D4912A',
  'Steel Challenge': '#8E6FBF',
  Outlaw: '#5DAF5D',
};

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

type Segment = 'sessions' | 'dope' | 'matches';

function SessionCard({
  item, onPress, onLongPress,
}: {
  item: RangeSessionWithStats;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
    >
      <View style={s.cardIcon}>
        <Text style={s.cardIconText}>🎯</Text>
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardDate}>{formatDate(item.session_date) ?? item.session_date}</Text>
        <Text style={s.cardLocation}>
          {item.location?.trim() ? item.location : 'Location not set'}
        </Text>
        <View style={s.metaRow}>
          <View style={s.metaPill}>
            <Text style={s.metaPillText}>
              {item.firearm_count} {item.firearm_count === 1 ? 'firearm' : 'firearms'}
            </Text>
          </View>
          <View style={s.metaPill}>
            <Text style={s.metaPillText}>
              {item.total_rounds.toLocaleString()} rounds
            </Text>
          </View>
        </View>
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function DopeCardRow({
  item, onPress, onLongPress,
}: {
  item: DopeCardWithMeta;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const firearmLabel =
    item.firearm_nickname?.trim() ||
    [item.firearm_make, item.firearm_model].filter(Boolean).join(' ').trim() ||
    'Firearm';
  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
    >
      <View style={s.cardIcon}>
        <Text style={s.cardIconText}>📐</Text>
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardDate} numberOfLines={1}>{item.name}</Text>
        <Text style={s.cardLocation} numberOfLines={1}>
          {firearmLabel}
          {item.ammo_description ? ` · ${item.ammo_description}` : ''}
        </Text>
        <View style={s.metaRow}>
          <View style={s.metaPill}>
            <Text style={s.metaPillText}>
              {item.zero_distance_yards != null
                ? `Zero ${item.zero_distance_yards} yd`
                : 'Zero —'}
            </Text>
          </View>
          <View style={s.metaPill}>
            <Text style={s.metaPillText}>{item.units}</Text>
          </View>
          <View style={s.metaPill}>
            <Text style={s.metaPillText}>
              {item.entry_count} {item.entry_count === 1 ? 'entry' : 'entries'}
            </Text>
          </View>
        </View>
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function MatchCard({
  item, onPress, onLongPress,
}: {
  item: CompetitionMatchWithMeta;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const typeColor = MATCH_TYPE_COLORS[item.match_type] ?? MUTED;
  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
    >
      <View style={s.cardIcon}>
        <Text style={s.cardIconText}>🏆</Text>
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardDate} numberOfLines={1}>{item.match_name}</Text>
        <Text style={s.cardLocation} numberOfLines={1}>
          {formatDate(item.match_date) ?? item.match_date}
          {item.location ? ` · ${item.location}` : ''}
        </Text>
        <View style={s.metaRow}>
          <View style={[s.metaPill, { backgroundColor: typeColor + '22' }]}>
            <Text style={[s.metaPillText, { color: typeColor }]}>{item.match_type}</Text>
          </View>
          {item.division ? (
            <View style={s.metaPill}>
              <Text style={s.metaPillText}>{item.division}</Text>
            </View>
          ) : null}
          {item.overall_placement != null ? (
            <View style={s.metaPill}>
              <Text style={s.metaPillText}>#{item.overall_placement} Overall</Text>
            </View>
          ) : null}
          {item.stage_count > 0 ? (
            <View style={s.metaPill}>
              <Text style={s.metaPillText}>{item.stage_count} stages</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function RangeScreen() {
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('sessions');
  const [sessions, setSessions] = useState<RangeSessionWithStats[]>([]);
  const [dopeCards, setDopeCards] = useState<DopeCardWithMeta[]>([]);
  const [matches, setMatches] = useState<CompetitionMatchWithMeta[]>([]);

  useFocusEffect(
    useCallback(() => {
      setSessions(getAllRangeSessions());
      setDopeCards(getAllDopeCards());
      setMatches(getAllCompetitionMatches());
    }, [])
  );

  function handleDeleteSession(session: RangeSessionWithStats) {
    Alert.alert(
      'Delete session?',
      `Deleting reverses this session's round counts and ammo deductions. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteRangeSession(session.id);
            setSessions(getAllRangeSessions());
            syncWidgets();
          },
        },
      ],
    );
  }

  function handleDeleteDope(card: DopeCardWithMeta) {
    Alert.alert(
      'Delete DOPE card?',
      `This removes "${card.name}" and every distance entry on it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteDopeCard(card.id);
            setDopeCards(getAllDopeCards());
          },
        },
      ],
    );
  }

  function handleDeleteMatch(match: CompetitionMatchWithMeta) {
    Alert.alert(
      'Delete match?',
      `This removes "${match.match_name}" and all stage scores. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteCompetitionMatch(match.id);
            setMatches(getAllCompetitionMatches());
          },
        },
      ],
    );
  }

  function handleFab() {
    if (segment === 'sessions') {
      router.push('/add-session');
      return;
    }
    if (segment === 'matches') {
      runProGated('competition', () => router.push('/add-match'));
      return;
    }
    // DOPE card creation is Pro-gated. Viewing existing cards stays free
    // so existing users keep read access if they downgrade.
    runProGated('dope_cards', () => router.push('/dope-card'));
  }

  // Top strip aggregates — total sessions, total rounds across all trips,
  // and last session date. Helps users see their range cadence at a glance.
  const totalRounds = sessions.reduce((sum, x) => sum + x.total_rounds, 0);
  const lastSession = sessions[0]?.session_date ?? null;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View>
          <Text style={s.headerSub}>IRON LEDGER</Text>
          <Text style={s.headerTitle}>Range Log</Text>
        </View>
        <Text style={s.countText}>
          {segment === 'sessions'
            ? `${sessions.length} ${sessions.length === 1 ? 'Session' : 'Sessions'}`
            : segment === 'dope'
            ? `${dopeCards.length} ${dopeCards.length === 1 ? 'Card' : 'Cards'}`
            : `${matches.length} ${matches.length === 1 ? 'Match' : 'Matches'}`}
        </Text>
      </View>

      <View style={s.segmentRow}>
        <SegmentButton
          label="Sessions"
          active={segment === 'sessions'}
          onPress={() => setSegment('sessions')}
        />
        <SegmentButton
          label="DOPE"
          active={segment === 'dope'}
          onPress={() => setSegment('dope')}
        />
        <SegmentButton
          label="Matches"
          active={segment === 'matches'}
          onPress={() => setSegment('matches')}
        />
      </View>

      {segment === 'sessions' ? (
        <>
          {sessions.length > 0 ? (
            <View style={s.statStrip}>
              <Stat label="Total Rounds" value={totalRounds.toLocaleString()} />
              <Stat
                label="Last Trip"
                value={lastSession ? (formatDateShort(lastSession) ?? lastSession) : '—'}
              />
              <Stat label="Sessions" value={String(sessions.length)} />
            </View>
          ) : null}

          {sessions.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyIcon}>🎯</Text>
              <Text style={s.emptyTitle}>No range sessions yet</Text>
              <Text style={s.emptySubtitle}>
                Log a trip to track rounds fired, ammo used, and lifetime round counts.
              </Text>
            </View>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <SessionCard
                  item={item}
                  onPress={() => router.push(`/add-session?id=${item.id}`)}
                  onLongPress={() => handleDeleteSession(item)}
                />
              )}
              contentContainerStyle={s.list}
            />
          )}
        </>
      ) : segment === 'dope' ? (
        <>
          {dopeCards.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyIcon}>📐</Text>
              <Text style={s.emptyTitle}>No DOPE cards yet</Text>
              <Text style={s.emptySubtitle}>
                Build a card per rifle + load. Track zero, elevation, and
                wind holds out to distance.
              </Text>
            </View>
          ) : (
            <FlatList
              data={dopeCards}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <DopeCardRow
                  item={item}
                  onPress={() => router.push(`/dope/${item.id}`)}
                  onLongPress={() => handleDeleteDope(item)}
                />
              )}
              contentContainerStyle={s.list}
            />
          )}
        </>
      ) : (
        <>
          {matches.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyIcon}>🏆</Text>
              <Text style={s.emptyTitle}>No matches yet</Text>
              <Text style={s.emptySubtitle}>
                Log USPSA, IDPA, Steel Challenge, and outlaw matches
                with per-stage scores and placement.
              </Text>
            </View>
          ) : (
            <FlatList
              data={matches}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <MatchCard
                  item={item}
                  onPress={() => router.push(`/match/${item.id}`)}
                  onLongPress={() => handleDeleteMatch(item)}
                />
              )}
              contentContainerStyle={s.list}
            />
          )}
        </>
      )}

      <TouchableOpacity
        style={s.fab}
        onPress={handleFab}
        activeOpacity={0.8}
      >
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.statCell}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function SegmentButton({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.segmentBtn, active && s.segmentBtnActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[s.segmentBtnText, active && s.segmentBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  headerSub: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  headerTitle: { color: '#FFF', fontSize: 28, fontWeight: '800', marginTop: 2 },
  countText: { color: '#AAAAAA', fontSize: 13, fontWeight: '500' },
  segmentRow: {
    flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14, gap: 8,
  },
  segmentBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(201,168,76,0.14)',
    borderColor: GOLD,
  },
  segmentBtnText: { color: '#BBB', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  segmentBtnTextActive: { color: GOLD },
  statStrip: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, gap: 10,
  },
  statCell: {
    flex: 1, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, alignItems: 'center',
  },
  statValue: { color: GOLD, fontSize: 16, fontWeight: '800' },
  statLabel: {
    color: MUTED, fontSize: 10, fontWeight: '700',
    letterSpacing: 0.8, marginTop: 4, textTransform: 'uppercase',
  },
  list: { padding: 16, gap: 12, paddingBottom: 100 },
  card: {
    backgroundColor: CARD, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', padding: 14, gap: 14,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconText: { fontSize: 22 },
  cardBody: { flex: 1 },
  cardDate: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  cardLocation: { color: '#AAAAAA', fontSize: 13, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  metaPill: {
    backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  metaPillText: { color: '#AAAAAA', fontSize: 11, fontWeight: '600' },
  chevron: { color: '#444', fontSize: 22, fontWeight: '300' },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingHorizontal: 40,
  },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  emptySubtitle: { color: MUTED, fontSize: 15, textAlign: 'center' },
  fab: {
    position: 'absolute', bottom: 32, right: 24, width: 58, height: 58,
    borderRadius: 29, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: GOLD, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabText: { color: '#000', fontSize: 28, fontWeight: '300', marginTop: -2 },
});
