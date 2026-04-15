import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, TextInput, ScrollView, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  initDB, getAllFirearms, getAllSuppressors, getActiveBatteryLogs,
  resolveImageUri, Firearm, Suppressor,
} from '../../lib/database';
import { bucketFor } from '../../lib/batteryStats';
import type { BatteryBucket } from '../../lib/batteryStats';
import { useEntitlements } from '../../lib/useEntitlements';
import { showPaywall } from '../../lib/paywall';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const TYPES = ['All', 'Handgun', 'Rifle', 'Shotgun', 'PDW', 'PCC', 'Suppressor', 'NFA', 'Other'];
const NFA_TYPES = ['Suppressor', 'SBR', 'SBS', 'AOW'];
const CONDITION_ORDER = ['Excellent', 'Good', 'Fair', 'Poor'];

// Battery chip colors — only overdue and due_soon surface on the tile (a green
// "ok" badge on every battery-tracked firearm would just be visual noise).
const BATTERY_CHIP_COLORS: Record<BatteryBucket, string> = {
  overdue: '#FF5722',
  due_soon: '#FFC107',
  ok: '#4CAF50',
};
const BATTERY_CHIP_LABELS: Record<BatteryBucket, string> = {
  overdue: 'Battery overdue',
  due_soon: 'Battery due soon',
  ok: 'Battery OK',
};

let dbReady = false;

// Discriminated union so the FlatList can render both entity types
// through a single path. `sortKey` lets us co-sort on name/date/value
// without special-casing each kind.
type ArmoryItem =
  | { kind: 'firearm'; data: Firearm }
  | { kind: 'suppressor'; data: Suppressor };

function FirearmCard({
  item, onPress, batteryBucket,
}: {
  item: Firearm;
  onPress: () => void;
  batteryBucket?: BatteryBucket | null;
}) {
  const [imgError, setImgError] = useState(false);
  const showBatteryChip = batteryBucket === 'overdue' || batteryBucket === 'due_soon';
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.75}>
      {item.image_uri && !imgError ? (
        <Image source={{ uri: resolveImageUri(item.image_uri) ?? undefined }} style={s.cardImage} onError={() => setImgError(true)} />
      ) : (
        <View style={s.iconBox}><Image source={require('../../assets/Icon.png')} style={s.iconImg} /></View>
      )}
      <View style={s.cardBody}>
        <Text style={s.cardName}>{item.make} {item.model}</Text>
        <View style={s.tagRow}>
          {item.type ? <View style={s.tag}><Text style={s.tagText}>{item.type}</Text></View> : null}
          {item.caliber ? <View style={s.tag}><Text style={s.tagText}>{item.caliber}</Text></View> : null}
          {item.condition_rating ? (
            <View style={[s.tag, s.conditionTag]}>
              <Text style={s.conditionText}>{item.condition_rating}</Text>
            </View>
          ) : null}
          {showBatteryChip ? (
            <View style={[s.tag, s.batteryTag, { borderColor: BATTERY_CHIP_COLORS[batteryBucket!] }]}>
              <Text style={[s.batteryTagText, { color: BATTERY_CHIP_COLORS[batteryBucket!] }]}>
                🔋 {BATTERY_CHIP_LABELS[batteryBucket!]}
              </Text>
            </View>
          ) : null}
        </View>
        {item.serial_number ? <Text style={s.serial}>S/N: {item.serial_number}</Text> : null}
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// Suppressors get their own card so we can show a gold SUPPRESSOR badge
// and the tax-stamp / ATF status info that matters for NFA items at a
// glance — rather than shoehorning those fields into FirearmCard.
function SuppressorCard({ item, onPress }: { item: Suppressor; onPress: () => void }) {
  const [imgError, setImgError] = useState(false);
  const approved = item.atf_form_status === 'Approved';
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.75}>
      {item.image_uri && !imgError ? (
        <Image source={{ uri: resolveImageUri(item.image_uri) ?? undefined }} style={s.cardImage} onError={() => setImgError(true)} />
      ) : (
        <View style={s.iconBox}><Image source={require('../../assets/Icon.png')} style={s.iconImg} /></View>
      )}
      <View style={s.cardBody}>
        <Text style={s.cardName}>{item.make} {item.model}</Text>
        <View style={s.tagRow}>
          <View style={[s.tag, s.suppressorBadge]}>
            <Text style={s.suppressorBadgeText}>SUPPRESSOR</Text>
          </View>
          {item.caliber ? <View style={s.tag}><Text style={s.tagText}>{item.caliber}</Text></View> : null}
          {item.atf_form_status ? (
            <View style={[s.tag, approved ? s.atfApprovedTag : s.atfPendingTag]}>
              <Text style={[s.tagText, approved ? s.atfApprovedText : s.atfPendingText]}>
                {item.atf_form_status}
              </Text>
            </View>
          ) : null}
          {item.condition_rating ? (
            <View style={[s.tag, s.conditionTag]}>
              <Text style={s.conditionText}>{item.condition_rating}</Text>
            </View>
          ) : null}
        </View>
        {item.serial_number ? <Text style={s.serial}>S/N: {item.serial_number}</Text> : null}
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function ArmoryScreen() {
  const router = useRouter();
  const ent = useEntitlements();
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [suppressors, setSuppressors] = useState<Suppressor[]>([]);
  // Worst battery bucket per firearm_id, so the Armory tile can surface an
  // at-a-glance chip without each card hitting the DB itself.
  const [batteryBuckets, setBatteryBuckets] = useState<Record<number, BatteryBucket>>({});
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('All');
  const [sortBy, setSortBy] = useState<'name' | 'value' | 'date' | 'condition'>('date');

  function handleAddPress() {
    // Combined cap — firearms and suppressors share the Lite 5-item limit
    // since they're both top-level inventory items.
    const totalItems = firearms.length + suppressors.length;
    if (totalItems >= ent.limits.maxFirearms) {
      showPaywall({ mode: 'hard_cap', reason: 'firearm_limit' });
      return;
    }
    Alert.alert('Add to Armory', 'What are you adding?', [
      { text: 'Firearm', onPress: () => router.push('/add-firearm') },
      { text: 'Suppressor', onPress: () => router.push('/add-suppressor') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  useFocusEffect(
    useCallback(() => {
      if (!dbReady) { initDB(); dbReady = true; }
      setFirearms(getAllFirearms());
      setSuppressors(getAllSuppressors());
      // Roll up battery logs → worst bucket per firearm. We rank
      // overdue > due_soon > ok so a single overdue accessory on a
      // firearm surfaces as the chip color for the whole tile.
      const RANK: Record<BatteryBucket, number> = { overdue: 3, due_soon: 2, ok: 1 };
      const worst: Record<number, BatteryBucket> = {};
      for (const log of getActiveBatteryLogs()) {
        if (log.firearm_id == null) continue;
        const b = bucketFor(log);
        const prev = worst[log.firearm_id];
        if (!prev || RANK[b] > RANK[prev]) worst[log.firearm_id] = b;
      }
      setBatteryBuckets(worst);
    }, [])
  );

  const SORT_LABELS: Record<string, string> = {
    name: 'Name', value: 'Value', date: 'Date', condition: 'Condition',
  };

  function handleSort() {
    Alert.alert('Sort By', '', [
      { text: 'Name (A → Z)', onPress: () => setSortBy('name') },
      { text: 'Value (High → Low)', onPress: () => setSortBy('value') },
      { text: 'Date Added (Newest)', onPress: () => setSortBy('date') },
      { text: 'Condition (Best First)', onPress: () => setSortBy('condition') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Firearm filtering — unchanged from the pre-suppressor version.
  const firearmsFiltered = firearms.filter((f) => {
    const typeList = f.type ? f.type.split(', ') : [];
    let matchesType = false;
    if (activeType === 'All') matchesType = true;
    else if (activeType === 'Suppressor') matchesType = false; // suppressors aren't firearms
    else if (activeType === 'NFA') matchesType = typeList.some(t => NFA_TYPES.includes(t)) || !!f.is_nfa;
    else matchesType = typeList.includes(activeType);

    const q = search.toLowerCase();
    const matchesSearch = !q ||
      f.make?.toLowerCase().includes(q) ||
      f.model?.toLowerCase().includes(q) ||
      f.caliber?.toLowerCase().includes(q) ||
      f.serial_number?.toLowerCase().includes(q) ||
      f.condition_rating?.toLowerCase().includes(q) ||
      f.type?.toLowerCase().includes(q) ||
      f.nickname?.toLowerCase().includes(q) ||
      f.action_type?.toLowerCase().includes(q) ||
      f.trigger_type?.toLowerCase().includes(q) ||
      f.storage_location?.toLowerCase().includes(q);
    return matchesType && matchesSearch;
  });

  // Suppressors only show under All, Suppressor, and NFA chips. Search
  // extends across the fields a user is most likely to recall.
  const suppressorsFiltered = suppressors.filter((sup) => {
    let matchesType = false;
    if (activeType === 'All' || activeType === 'Suppressor' || activeType === 'NFA') matchesType = true;
    else matchesType = false;

    const q = search.toLowerCase();
    const matchesSearch = !q ||
      sup.make?.toLowerCase().includes(q) ||
      sup.model?.toLowerCase().includes(q) ||
      sup.caliber?.toLowerCase().includes(q) ||
      sup.serial_number?.toLowerCase().includes(q) ||
      sup.condition_rating?.toLowerCase().includes(q) ||
      sup.host_notes?.toLowerCase().includes(q) ||
      sup.atf_form_status?.toLowerCase().includes(q) ||
      sup.trust_name?.toLowerCase().includes(q) ||
      sup.storage_location?.toLowerCase().includes(q);
    return matchesType && matchesSearch;
  });

  // Combine + co-sort. Firearms and suppressors interleave by the active
  // sort order; the default (date) falls back to insertion-order id since
  // both tables use AUTOINCREMENT so higher id == newer.
  const combined: ArmoryItem[] = [
    ...firearmsFiltered.map((f): ArmoryItem => ({ kind: 'firearm', data: f })),
    ...suppressorsFiltered.map((sup): ArmoryItem => ({ kind: 'suppressor', data: sup })),
  ];

  combined.sort((a, b) => {
    if (sortBy === 'name') {
      const an = `${a.data.make} ${a.data.model}`;
      const bn = `${b.data.make} ${b.data.model}`;
      return an.localeCompare(bn);
    }
    if (sortBy === 'value') {
      return (b.data.current_value || 0) - (a.data.current_value || 0);
    }
    if (sortBy === 'condition') {
      return CONDITION_ORDER.indexOf(a.data.condition_rating || '')
        - CONDITION_ORDER.indexOf(b.data.condition_rating || '');
    }
    return (b.data.id || 0) - (a.data.id || 0); // date: newest first
  });

  const totalItems = firearms.length + suppressors.length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View>
          <Text style={s.headerSub}>IRON LEDGER</Text>
          <Text style={s.headerTitle}>My Armory</Text>
        </View>
        <Text style={s.countText}>
          {combined.length} {combined.length === 1 ? 'Item' : 'Items'}
        </Text>
      </View>
      <View style={s.searchRow}>
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch}
          placeholder="Search make, model, caliber, type..." placeholderTextColor="#7A7A7A"
          clearButtonMode="while-editing" autoCorrect={false} />
        <TouchableOpacity style={s.sortBtn} onPress={handleSort}>
          <Text style={s.sortBtnIcon}>⇅</Text>
          <Text style={s.sortBtnLabel}>{SORT_LABELS[sortBy]}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.typeScroll} contentContainerStyle={s.typeChips}>
        {TYPES.map((t) => (
          <TouchableOpacity key={t} style={[s.typeChip, activeType === t && s.typeChipActive]} onPress={() => setActiveType(t)}>
            <Text style={[s.typeChipText, activeType === t && s.typeChipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {combined.length === 0 ? (
        <View style={s.emptyState}>
          {totalItems === 0 ? (
            <Image source={require('../../assets/Icon.png')} style={s.emptyImg} />
          ) : (
            <Text style={s.emptyIcon}>🔍</Text>
          )}
          <Text style={s.emptyTitle}>{totalItems === 0 ? 'Your Armory is Empty' : 'No Results'}</Text>
          <Text style={s.emptySubtitle}>
            {totalItems === 0 ? 'Tap the + button to add your first firearm or suppressor' : 'Try a different search or filter'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={combined}
          keyExtractor={(item) => `${item.kind}-${item.data.id}`}
          renderItem={({ item }) => {
            if (item.kind === 'firearm') {
              return (
                <FirearmCard
                  item={item.data}
                  onPress={() => router.push(`/firearm/${item.data.id}`)}
                  batteryBucket={item.data.id != null ? batteryBuckets[item.data.id] ?? null : null}
                />
              );
            }
            return (
              <SuppressorCard
                item={item.data}
                onPress={() => router.push(`/suppressor/${item.data.id}`)}
              />
            );
          }}
          contentContainerStyle={s.list} />
      )}
      <TouchableOpacity style={s.fab} onPress={handleAddPress} activeOpacity={0.8}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  headerSub: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  headerTitle: { color: '#FFF', fontSize: 28, fontWeight: '800', marginTop: 2 },
  countText: { color: '#AAAAAA', fontSize: 13, fontWeight: '500' },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 10 },
  searchInput: { flex: 1, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    color: '#FFF', fontSize: 15, paddingHorizontal: 14, paddingVertical: 10 },
  sortBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: CARD,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  sortBtnIcon: { color: GOLD, fontSize: 16 },
  sortBtnLabel: { color: '#CCCCCC', fontSize: 11, fontWeight: '700' },
  // Horizontal filter row — `flexShrink: 0` prevents the FlatList below from
  // vertically compressing this row when many armory tiles are present, and
  // `alignItems: 'center'` lets each chip sit within the row without clipping.
  typeScroll: { flexGrow: 0, flexShrink: 0, marginTop: 8 },
  typeChips: { paddingHorizontal: 16, gap: 8, paddingVertical: 6, alignItems: 'center' },
  typeChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: CARD, borderWidth: 1, borderColor: '#3A3A3A' },
  typeChipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  typeChipText: { color: '#CCCCCC', fontSize: 13, fontWeight: '600' },
  typeChipTextActive: { color: GOLD, fontWeight: '700' },
  list: { padding: 16, gap: 12, paddingBottom: 100 },
  card: { backgroundColor: CARD, borderRadius: 14, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 14 },
  cardImage: { width: 52, height: 52, borderRadius: 10 },
  iconBox: { width: 52, height: 52, borderRadius: 12, backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)', alignItems: 'center', justifyContent: 'center' },
  iconImg: { width: 32, height: 32, borderRadius: 8 },
  cardBody: { flex: 1 },
  cardName: { color: '#FFF', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  tag: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: '#888', fontSize: 11, fontWeight: '600' },
  conditionTag: { backgroundColor: 'rgba(201,168,76,0.15)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)' },
  conditionText: { color: GOLD, fontSize: 11, fontWeight: '600' },
  batteryTag: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1 },
  batteryTagText: { fontSize: 11, fontWeight: '700' },
  suppressorBadge: { backgroundColor: GOLD, borderRadius: 4, paddingHorizontal: 7 },
  suppressorBadgeText: { color: '#000', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  atfApprovedTag: { backgroundColor: 'rgba(76,175,80,0.15)', borderWidth: 1, borderColor: 'rgba(76,175,80,0.4)' },
  atfApprovedText: { color: '#4CAF50' },
  atfPendingTag: { backgroundColor: 'rgba(255,193,7,0.12)', borderWidth: 1, borderColor: 'rgba(255,193,7,0.4)' },
  atfPendingText: { color: '#FFC107' },
  serial: { color: MUTED, fontSize: 12, marginTop: 2 },
  chevron: { color: '#444', fontSize: 22, fontWeight: '300' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 56 },
  emptyImg: { width: 80, height: 80, borderRadius: 18, marginBottom: 4 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  emptySubtitle: { color: MUTED, fontSize: 15, textAlign: 'center', paddingHorizontal: 40 },
  fab: { position: 'absolute', bottom: 32, right: 24, width: 58, height: 58, borderRadius: 29,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
    shadowColor: GOLD, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
  fabText: { color: '#000', fontSize: 28, fontWeight: '300', marginTop: -2 },
});
