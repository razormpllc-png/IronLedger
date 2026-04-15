// NFA Trusts list — /nfa-trusts
//
// Lists every trust/ownership entity the user has defined, with a count of
// firearms currently linked to each. Tap a row to edit, tap + to create.

import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { getAllNfaTrusts, countFirearmsForTrust } from '../lib/database';
import type { NfaTrust } from '../lib/database';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

export default function NfaTrusts() {
  const router = useRouter();
  const [trusts, setTrusts] = useState<NfaTrust[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});

  useFocusEffect(
    useCallback(() => {
      const list = getAllNfaTrusts();
      setTrusts(list);
      const nextCounts: Record<number, number> = {};
      for (const t of list) nextCounts[t.id] = countFirearmsForTrust(t.id);
      setCounts(nextCounts);
    }, [])
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Trusts & RPs</Text>
        <TouchableOpacity onPress={() => router.push('/nfa-trust/new')}>
          <Text style={s.add}>＋ New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.hint}>
          Define a trust or entity once here, then pick it from the dropdown on any NFA
          firearm. Edits cascade to every linked item automatically.
        </Text>

        {trusts.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyEmoji}>🏛️</Text>
            <Text style={s.emptyTitle}>No trusts yet</Text>
            <Text style={s.emptySub}>
              Start by adding your NFA trust or corporation so you can reuse it across stamps.
            </Text>
            <TouchableOpacity style={s.emptyCta} onPress={() => router.push('/nfa-trust/new')}>
              <Text style={s.emptyCtaText}>Add Trust</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {trusts.map((t, i) => (
              <TouchableOpacity
                key={t.id}
                style={[s.row, i < trusts.length - 1 && s.rowBorder]}
                onPress={() => router.push(`/nfa-trust/${t.id}`)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{t.name}</Text>
                  <Text style={s.rowSub}>{t.trust_type}</Text>
                  {t.responsible_persons ? (
                    <Text style={s.rowRps} numberOfLines={1}>
                      RPs: {t.responsible_persons}
                    </Text>
                  ) : null}
                </View>
                <View style={s.rowRight}>
                  <View style={s.countBadge}>
                    <Text style={s.countText}>{counts[t.id] ?? 0}</Text>
                  </View>
                  <Text style={s.chev}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
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
  add: { color: GOLD, fontSize: 15, fontWeight: '700' },
  scroll: { padding: 16, paddingTop: 20 },
  hint: { color: MUTED, fontSize: 13, lineHeight: 19, paddingHorizontal: 4, marginBottom: 20 },
  list: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rowName: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  rowSub: { color: GOLD, fontSize: 12, marginTop: 2, fontWeight: '600' },
  rowRps: { color: MUTED, fontSize: 12, marginTop: 4 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: {
    backgroundColor: '#2A2115', borderColor: '#3A2C18', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, minWidth: 28, alignItems: 'center',
  },
  countText: { color: GOLD, fontSize: 12, fontWeight: '700' },
  chev: { color: '#444', fontSize: 20 },
  emptyCard: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 24,
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
