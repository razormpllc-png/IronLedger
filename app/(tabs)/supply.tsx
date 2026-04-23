import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getAllAmmo, getAllExpenses, deleteAmmo, deleteExpense, formatDate,
  getTotalAmmoRounds, getTotalAmmoValue, getTotalExpenses, getExpensesByCategory,
  getAmmoRollupsWithFirearmCalibers,
  Ammo, Expense, EXPENSE_CATEGORIES, CaliberRollup,
} from '../../lib/database';
import { syncWidgets } from '../../lib/widgetSync';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const CATEGORY_ICONS: Record<string, string> = {
  'Ammunition': '🎯', 'Accessories': '🔩', 'Range Fees': '🏟️', 'Gunsmithing': '🔧',
  'Cleaning Supplies': '🧹', 'Training': '📚', 'Storage': '🗄️', 'Insurance': '📋', 'Other': '📦',
};

// ── Ammo type inference from caliber ────────────────────────
const SHOTGUN_RE = /\b(gauge|ga\.?|bore)\b|^\.410$/i;
const RIFLE_RE = /\b(5\.56|\.223|\.308|7\.62|6\.5|\.300|\.30-06|\.270|\.243|\.204|\.22-250|\.338|\.375|\.416|\.458|\.50\s?bmg|6mm|6\.8|\.224|\.280|\.257|7mm|\.264|creedmoor|lapua|grendel|valkyrie|prc|blackout|win\s?mag|rem\s?mag|wsm|wssm|nosler)\b/i;

type AmmoKind = 'handgun' | 'rifle' | 'shotgun';

function inferAmmoKind(caliber: string): AmmoKind {
  if (SHOTGUN_RE.test(caliber)) return 'shotgun';
  if (RIFLE_RE.test(caliber)) return 'rifle';
  return 'handgun';
}

/** Renders a tiny bullet / shell silhouette as pure Views (no images needed). */
function BulletIcon({ kind, dimmed }: { kind: AmmoKind; dimmed?: boolean }) {
  const opacity = dimmed ? 0.5 : 1;
  if (kind === 'shotgun') {
    // Shotgun shell — wide cylinder with brass base
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
        {/* Hull (red) */}
        <View style={{ width: 14, height: 16, backgroundColor: '#C0392B', borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
        {/* Brass base */}
        <View style={{ width: 16, height: 6, backgroundColor: GOLD, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
      </View>
    );
  }
  if (kind === 'rifle') {
    // Rifle round — pointed bullet + long brass case
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
        {/* Bullet tip (pointed) */}
        <View style={{ width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 6,
          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#D4912A' }} />
        {/* Bullet body */}
        <View style={{ width: 8, height: 4, backgroundColor: '#D4912A' }} />
        {/* Case */}
        <View style={{ width: 8, height: 14, backgroundColor: GOLD, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 }} />
      </View>
    );
  }
  // Handgun — stubby round-nose bullet + short case (9mm style)
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      {/* Bullet (round nose) */}
      <View style={{ width: 8, height: 5, backgroundColor: '#D4912A', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
      {/* Case */}
      <View style={{ width: 8, height: 10, backgroundColor: GOLD, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 }} />
    </View>
  );
}

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function AmmoCard({ item, onPress, onDelete }: { item: Ammo; onPress: () => void; onDelete: () => void }) {
  const costPerRound = item.cost_per_box && item.rounds_per_box
    ? (item.cost_per_box / item.rounds_per_box) : null;
  const threshold = item.low_stock_threshold ?? 100;
  const isLow = item.quantity <= threshold && item.quantity > 0;
  const isEmpty = item.quantity === 0;
  const kind = inferAmmoKind(item.caliber);
  return (
    <TouchableOpacity style={[s.card, isLow && s.cardLow, isEmpty && s.cardEmpty]} onPress={onPress} activeOpacity={0.75}>
      <View style={[s.ammoIcon, isLow && s.ammoIconLow, isEmpty && s.ammoIconEmpty]}>
        {isEmpty ? <Text style={s.ammoIconText}>⚠️</Text>
        : isLow ? <Text style={s.ammoIconText}>⚡</Text>
        : <BulletIcon kind={kind} />}
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardTitle}>{item.caliber}{item.grain ? ` ${item.grain}gr` : ''}</Text>
        {item.brand ? <Text style={s.cardSub}>{item.brand}{item.type ? ` · ${item.type}` : ''}</Text> : null}
        <View style={s.ammoMeta}>
          <Text style={[s.ammoQty, isLow && s.ammoQtyLow, isEmpty && s.ammoQtyEmpty]}>
            {item.quantity.toLocaleString()} rds
          </Text>
          {isLow && !isEmpty ? <Text style={s.lowBadge}>LOW STOCK</Text> : null}
          {isEmpty ? <Text style={s.emptyBadge}>OUT OF STOCK</Text> : null}
          {costPerRound && !isLow && !isEmpty ? <Text style={s.ammoCpr}>{(costPerRound * 100).toFixed(1)}¢/rd</Text> : null}
        </View>
      </View>
      <TouchableOpacity onPress={onDelete} style={s.deleteBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.deleteText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function ExpenseCard({ item, onPress, onDelete }: { item: Expense; onPress: () => void; onDelete: () => void }) {
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.75}>
      <View style={s.ammoIcon}><Text style={s.ammoIconText}>{CATEGORY_ICONS[item.category] || '📦'}</Text></View>
      <View style={s.cardBody}>
        <View style={s.expenseHeader}>
          <Text style={s.cardTitle}>{item.category}</Text>
          <Text style={s.expenseAmt}>{fmt(item.amount)}</Text>
        </View>
        {item.description ? <Text style={s.cardSub} numberOfLines={1}>{item.description}</Text> : null}
        <Text style={s.expenseDate}>{formatDate(item.date) ?? item.date}</Text>
      </View>
      <TouchableOpacity onPress={onDelete} style={s.deleteBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.deleteText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function SupplyScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'ammo' | 'expenses'>('ammo');
  const [ammo, setAmmo] = useState<Ammo[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [ammoValue, setAmmoValue] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [byCategory, setByCategory] = useState<{ category: string; total: number }[]>([]);
  const [rollups, setRollups] = useState<CaliberRollup[]>([]);
  // Caliber filter — when set, the ammo list narrows to that caliber and the
  // selected roll-up row highlights. Tap the same row again (or "All") to clear.
  const [caliberFilter, setCaliberFilter] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setAmmo(getAllAmmo());
      setExpenses(getAllExpenses());
      setTotalRounds(getTotalAmmoRounds());
      setAmmoValue(getTotalAmmoValue());
      setTotalSpent(getTotalExpenses());
      setByCategory(getExpensesByCategory());
      setRollups(getAmmoRollupsWithFirearmCalibers());
    }, [])
  );

  function refreshAmmo() {
    setAmmo(getAllAmmo());
    setTotalRounds(getTotalAmmoRounds());
    setAmmoValue(getTotalAmmoValue());
    setRollups(getAmmoRollupsWithFirearmCalibers());
  }

  function handleDeleteAmmo(id: number) {
    Alert.alert('Delete Ammo', 'Remove this ammo entry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteAmmo(id); refreshAmmo(); syncWidgets(); } },
    ]);
  }

  const filteredAmmo = caliberFilter
    ? ammo.filter(a => a.caliber === caliberFilter)
    : ammo;

  function handleDeleteExpense(id: number) {
    Alert.alert('Delete Expense', 'Remove this expense?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteExpense(id); setExpenses(getAllExpenses()); setTotalSpent(getTotalExpenses()); setByCategory(getExpensesByCategory()); } },
    ]);
  }

  const maxCat = Math.max(...byCategory.map(c => c.total), 1);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View>
          <Text style={s.headerSub}>IRON LEDGER</Text>
          <Text style={s.headerTitle}>Supply</Text>
        </View>
      </View>

      {/* Segment toggle */}
      <View style={s.segmentRow}>
        <TouchableOpacity style={[s.segment, tab === 'ammo' && s.segmentActive]} onPress={() => setTab('ammo')}>
          <Text style={[s.segmentText, tab === 'ammo' && s.segmentTextActive]}>Ammo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.segment, tab === 'expenses' && s.segmentActive]} onPress={() => setTab('expenses')}>
          <Text style={[s.segmentText, tab === 'expenses' && s.segmentTextActive]}>Expenses</Text>
        </TouchableOpacity>
      </View>

      {tab === 'ammo' ? (
        <>
          {/* Ammo stats */}
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statLabel}>On Hand</Text>
              <Text style={s.statValue}>{totalRounds.toLocaleString()}</Text>
              <Text style={s.statUnit}>rounds</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>Inventory Value</Text>
              <Text style={s.statValue}>{fmt(ammoValue)}</Text>
              <Text style={s.statUnit}>estimated</Text>
            </View>
          </View>

          {ammo.length === 0 && rollups.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyIcon}>🎯</Text>
              <Text style={s.emptyTitle}>No Ammo Tracked</Text>
              <Text style={s.emptySub}>Tap + to add your first ammo entry</Text>
            </View>
          ) : (
            <>
              {/* Caliber roll-ups — one row per caliber you own ammo in OR
                  own a firearm in. Calibers with zero rounds (firearm but no
                  ammo recorded) render in empty/red state with a NEED TO BUY
                  badge; tapping them opens Add Ammo prefilled with the
                  caliber. Calibers that have ammo filter the list below. */}
              {rollups.length > 0 ? (
                <View style={s.rollupCard}>
                  <View style={s.rollupHeaderRow}>
                    <Text style={s.rollupHeader}>BY CALIBER</Text>
                    {caliberFilter ? (
                      <TouchableOpacity onPress={() => setCaliberFilter(null)}>
                        <Text style={s.rollupClear}>Show all ›</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {rollups.map((r, i, arr) => {
                    const active = caliberFilter === r.caliber;
                    const isEmpty = r.rounds === 0;
                    const dotColor = isEmpty ? '#FF3B30' : r.anyLow ? '#FFC107' : '#4CAF50';
                    const onRowPress = () => {
                      if (isEmpty) {
                        router.push(`/add-ammo?caliber=${encodeURIComponent(r.caliber)}`);
                        return;
                      }
                      setCaliberFilter(active ? null : r.caliber);
                    };
                    return (
                      <TouchableOpacity
                        key={r.caliber}
                        style={[
                          s.rollupRow,
                          i < arr.length - 1 && s.rollupRowBorder,
                          active && s.rollupRowActive,
                          isEmpty && s.rollupRowEmpty,
                        ]}
                        onPress={onRowPress}
                        activeOpacity={0.75}
                      >
                        <View style={[s.rollupDot, { backgroundColor: dotColor }]} />
                        <Text style={[
                          s.rollupCaliber,
                          active && s.rollupCaliberActive,
                          isEmpty && s.rollupCaliberEmpty,
                        ]}>{r.caliber}</Text>
                        {isEmpty ? (
                          <Text style={s.rollupBuyBadge}>NEED TO BUY</Text>
                        ) : (
                          <Text style={s.rollupLots}>{r.lots} lot{r.lots === 1 ? '' : 's'}</Text>
                        )}
                        <Text style={[
                          s.rollupRounds,
                          active && s.rollupRoundsActive,
                          isEmpty && s.rollupRoundsEmpty,
                        ]}>
                          {r.rounds.toLocaleString()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              <FlatList data={filteredAmmo} keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <AmmoCard item={item} onPress={() => router.push(`/edit-ammo?id=${item.id}`)} onDelete={() => handleDeleteAmmo(item.id)} />
                )}
                ListEmptyComponent={
                  caliberFilter ? (
                    <View style={s.filterEmpty}>
                      <Text style={s.filterEmptyText}>No lots for {caliberFilter}</Text>
                      <TouchableOpacity onPress={() => setCaliberFilter(null)}>
                        <Text style={s.filterEmptyClear}>Show all calibers</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null
                }
                contentContainerStyle={s.list} />
            </>
          )}
        </>
      ) : (
        <>
          {/* Expense stats */}
          <View style={s.statsRow}>
            <View style={[s.statCard, { flex: 1 }]}>
              <Text style={s.statLabel}>Total Spent</Text>
              <Text style={s.statValue}>{fmt(totalSpent)}</Text>
            </View>
          </View>

          {byCategory.length > 0 && (
            <View style={s.breakdownCard}>
              {byCategory.map((c, i, arr) => (
                <View key={c.category} style={[s.barRow, i < arr.length - 1 && s.barRowBorder]}>
                  <Text style={s.barIcon}>{CATEGORY_ICONS[c.category] || '📦'}</Text>
                  <Text style={s.barLabel}>{c.category}</Text>
                  <View style={s.barTrack}>
                    <View style={[s.barFill, { width: `${(c.total / maxCat) * 100}%` }]} />
                  </View>
                  <Text style={s.barValue}>{fmt(c.total)}</Text>
                </View>
              ))}
            </View>
          )}

          {expenses.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyIcon}>💰</Text>
              <Text style={s.emptyTitle}>No Expenses</Text>
              <Text style={s.emptySub}>Tap + to log an expense</Text>
            </View>
          ) : (
            <FlatList data={expenses} keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <ExpenseCard item={item} onPress={() => router.push(`/edit-expense?id=${item.id}`)} onDelete={() => handleDeleteExpense(item.id)} />
              )}
              contentContainerStyle={s.list} />
          )}
        </>
      )}

      <TouchableOpacity style={s.fab} onPress={() => router.push(tab === 'ammo' ? '/add-ammo' : '/add-expense')} activeOpacity={0.8}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  headerSub: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  headerTitle: { color: '#FFF', fontSize: 28, fontWeight: '800', marginTop: 2 },
  segmentRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: CARD,
    borderRadius: 10, padding: 3, borderWidth: 1, borderColor: BORDER },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#1E1A10' },
  segmentText: { color: MUTED, fontSize: 14, fontWeight: '600' },
  segmentTextActive: { color: GOLD },
  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 14, marginBottom: 6 },
  statCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  statValue: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  statUnit: { color: MUTED, fontSize: 11, marginTop: 2 },
  breakdownCard: { backgroundColor: CARD, borderRadius: 14, marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    padding: 12, borderWidth: 1, borderColor: BORDER },
  barRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  barRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  barIcon: { fontSize: 16, width: 24, textAlign: 'center' },
  barLabel: { color: '#AAA', fontSize: 12, width: 80 },
  barTrack: { flex: 1, height: 6, backgroundColor: '#252525', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: GOLD },
  barValue: { color: '#FFF', fontSize: 12, fontWeight: '700', width: 60, textAlign: 'right' },
  rollupCard: { backgroundColor: CARD, borderRadius: 14, marginHorizontal: 16, marginTop: 8,
    marginBottom: 4, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  rollupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  rollupHeader: { color: GOLD, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  rollupClear: { color: GOLD, fontSize: 12, fontWeight: '700' },
  rollupRow: { flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10 },
  rollupRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rollupRowActive: { backgroundColor: 'rgba(201,168,76,0.08)' },
  rollupRowEmpty: { backgroundColor: 'rgba(255,59,48,0.06)' },
  rollupDot: { width: 8, height: 8, borderRadius: 4 },
  rollupCaliber: { color: '#FFF', fontSize: 14, fontWeight: '700', flex: 1 },
  rollupCaliberActive: { color: GOLD },
  rollupCaliberEmpty: { color: '#FF3B30' },
  rollupLots: { color: MUTED, fontSize: 12 },
  rollupBuyBadge: { color: '#FF3B30', fontSize: 10, fontWeight: '800', letterSpacing: 0.6,
    backgroundColor: 'rgba(255,59,48,0.15)', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, overflow: 'hidden' },
  rollupRounds: { color: GOLD, fontSize: 14, fontWeight: '800', minWidth: 56, textAlign: 'right' },
  rollupRoundsActive: { color: GOLD },
  rollupRoundsEmpty: { color: '#FF3B30' },
  filterEmpty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  filterEmptyText: { color: MUTED, fontSize: 14 },
  filterEmptyClear: { color: GOLD, fontSize: 13, fontWeight: '700' },
  list: { padding: 16, gap: 10, paddingBottom: 100 },
  card: { backgroundColor: CARD, borderRadius: 14, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderWidth: 1, borderColor: 'transparent' },
  cardLow: { borderColor: 'rgba(255,193,7,0.4)', backgroundColor: 'rgba(255,193,7,0.05)' },
  cardEmpty: { borderColor: 'rgba(255,59,48,0.4)', backgroundColor: 'rgba(255,59,48,0.05)' },
  ammoIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)', alignItems: 'center', justifyContent: 'center' },
  ammoIconText: { fontSize: 20 },
  cardBody: { flex: 1 },
  cardTitle: { color: '#FFF', fontSize: 15, fontWeight: '700', marginBottom: 2 },
  cardSub: { color: '#888', fontSize: 13, marginBottom: 4 },
  ammoMeta: { flexDirection: 'row', gap: 12 },
  ammoQty: { color: GOLD, fontSize: 13, fontWeight: '700' },
  ammoQtyLow: { color: '#FFC107' },
  ammoQtyEmpty: { color: '#FF3B30' },
  lowBadge: { color: '#FFC107', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, backgroundColor: 'rgba(255,193,7,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  emptyBadge: { color: '#FF3B30', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, backgroundColor: 'rgba(255,59,48,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  ammoIconLow: { backgroundColor: 'rgba(255,193,7,0.12)', borderColor: 'rgba(255,193,7,0.3)' },
  ammoIconEmpty: { backgroundColor: 'rgba(255,59,48,0.12)', borderColor: 'rgba(255,59,48,0.3)' },
  ammoCpr: { color: MUTED, fontSize: 13 },
  expenseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  expenseAmt: { color: GOLD, fontSize: 15, fontWeight: '700' },
  expenseDate: { color: MUTED, fontSize: 12, marginTop: 2 },
  deleteBtn: { padding: 4 },
  deleteText: { color: '#555', fontSize: 16 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  emptySub: { color: MUTED, fontSize: 15, textAlign: 'center', paddingHorizontal: 40 },
  fab: { position: 'absolute', bottom: 32, right: 24, width: 58, height: 58, borderRadius: 29,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
    shadowColor: GOLD, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
  fabText: { color: '#000', fontSize: 28, fontWeight: '300', marginTop: -2 },
});
