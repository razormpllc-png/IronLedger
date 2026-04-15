// DOPE card create / edit modal. Card-level fields only — the distance
// entries live on the detail screen so this stays a quick setup flow.
//
// Accepts optional query params:
//   /dope-card                     → new card, pick any firearm
//   /dope-card?id=N                → edit card N
//   /dope-card?firearmId=N         → new card pre-scoped to firearm N
//                                    (used by the firearm detail screen)

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, KeyboardAvoidingView,
  TouchableOpacity, Platform, Alert, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getAllFirearms, getDopeCardById,
  insertDopeCard, updateDopeCard,
  Firearm, DopeCard, DOPE_UNITS, DopeUnits, DopeCardInput,
} from '../lib/database';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#FF5722';

export default function DopeCardScreen() {
  const params = useLocalSearchParams<{ id?: string; firearmId?: string }>();
  const editingId = params.id ? parseInt(String(params.id), 10) : null;
  const prefillFirearmId = params.firearmId ? parseInt(String(params.firearmId), 10) : null;

  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [existing, setExisting] = useState<DopeCard | null>(null);

  const [firearmId, setFirearmId] = useState<number | null>(prefillFirearmId);
  const [name, setName] = useState('');
  const [ammo, setAmmo] = useState('');
  const [zero, setZero] = useState('');
  const [units, setUnits] = useState<DopeUnits>('MOA');
  const [scope, setScope] = useState('');
  const [conditions, setConditions] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      // DOPE cards are a rifle-shooting concept — filter to rifles only.
      setFirearms(
        getAllFirearms().filter((f) => (f.type ?? '').toLowerCase() === 'rifle'),
      );
      if (editingId != null) {
        const row = getDopeCardById(editingId);
        if (row) {
          setExisting(row);
          setFirearmId(row.firearm_id);
          setName(row.name);
          setAmmo(row.ammo_description ?? '');
          setZero(row.zero_distance_yards != null ? String(row.zero_distance_yards) : '');
          setUnits(row.units);
          setScope(row.scope_notes ?? '');
          setConditions(row.conditions_notes ?? '');
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load card.');
    }
  }, [editingId]);

  const headerTitle = useMemo(
    () => (existing ? 'Edit DOPE Card' : 'New DOPE Card'),
    [existing],
  );

  function firearmLabel(f: Firearm): string {
    return f.nickname?.trim() || `${f.make} ${f.model}`.trim() || `Firearm #${f.id}`;
  }

  function handleSave() {
    if (firearmId == null) {
      Alert.alert('Pick a Firearm', 'A DOPE card has to belong to a firearm.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Card Label Required', 'Give this card a short label — e.g. "Match · 77gr OTM".');
      return;
    }
    let zeroNum: number | null = null;
    if (zero.trim()) {
      const n = parseFloat(zero);
      if (isNaN(n) || n < 0) {
        Alert.alert('Invalid Zero', 'Zero distance must be a positive number of yards.');
        return;
      }
      zeroNum = n;
    }

    const payload: DopeCardInput = {
      firearm_id: firearmId,
      name: name.trim(),
      ammo_description: ammo.trim() || null,
      zero_distance_yards: zeroNum,
      units,
      scope_notes: scope.trim() || null,
      conditions_notes: conditions.trim() || null,
    };
    setSaving(true);
    try {
      if (existing) {
        updateDopeCard(existing.id, payload);
        router.back();
      } else {
        const newId = insertDopeCard(payload);
        router.replace(`/dope/${newId}`);
      }
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Could not save DOPE card.');
    } finally {
      setSaving(false);
    }
  }

  if (firearms.length === 0) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancelText}>Close</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>New DOPE Card</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={{ padding: 24 }}>
          <Text style={{ color: '#aaa', fontSize: 14, lineHeight: 20 }}>
            You haven't added any rifles yet. DOPE cards are built per
            rifle — add one from the Armory tab (type "Rifle"), then come
            back here to build a card for it.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>{headerTitle}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={[s.saveText, saving && { opacity: 0.5 }]}>
              {existing ? 'Update' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.content} showsVerticalScrollIndicator={false}>
          <Text style={s.sectionLabel}>FIREARM</Text>
          <View style={s.card}>
            {firearms.map((f, i) => (
              <TouchableOpacity
                key={f.id}
                style={[
                  s.firearmRow,
                  i < firearms.length - 1 && s.firearmRowBorder,
                  firearmId === f.id && s.firearmRowActive,
                ]}
                onPress={() => setFirearmId(f.id)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.firearmName}>{firearmLabel(f)}</Text>
                  <Text style={s.firearmSub}>
                    {[f.caliber, f.type].filter(Boolean).join(' · ') || '—'}
                  </Text>
                </View>
                {firearmId === f.id ? <Text style={s.check}>✓</Text> : null}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>CARD LABEL</Text>
          <View style={s.card}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Match · 77gr OTM · Bushnell"
              placeholderTextColor={MUTED}
              autoCapitalize="words"
              maxLength={80}
            />
          </View>
          <Text style={s.helper}>
            A nickname for this card — lets you tell apart multiple cards
            on the same rifle (different load, scope, or purpose).
          </Text>

          <Text style={s.sectionLabel}>AMMO</Text>
          <View style={s.card}>
            <TextInput
              style={s.input}
              value={ammo}
              onChangeText={setAmmo}
              placeholder="Optional — manufacturer / grain / lot"
              placeholderTextColor={MUTED}
              maxLength={80}
            />
          </View>

          <Text style={s.sectionLabel}>ZERO</Text>
          <View style={s.card}>
            <View style={s.inlineRow}>
              <TextInput
                style={s.inlineInput}
                value={zero}
                onChangeText={setZero}
                placeholder="100"
                placeholderTextColor={MUTED}
                keyboardType="decimal-pad"
                maxLength={5}
              />
              <Text style={s.inlineUnit}>yards</Text>
            </View>
          </View>

          <Text style={s.sectionLabel}>UNITS</Text>
          <View style={s.card}>
            <View style={s.chipRow}>
              {DOPE_UNITS.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[s.chip, units === u && s.chipActive]}
                  onPress={() => setUnits(u)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipText, units === u && s.chipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={s.sectionLabel}>SCOPE</Text>
          <View style={s.card}>
            <TextInput
              style={s.input}
              value={scope}
              onChangeText={setScope}
              placeholder="Optional — make/model, click value, reticle"
              placeholderTextColor={MUTED}
              maxLength={120}
            />
          </View>

          <Text style={s.sectionLabel}>CONDITIONS</Text>
          <View style={[s.card, s.notesCard]}>
            <TextInput
              style={s.notesInput}
              value={conditions}
              onChangeText={setConditions}
              placeholder="Temp, altitude, humidity, wind reference, DA, notes…"
              placeholderTextColor={MUTED}
              multiline
              numberOfLines={4}
            />
          </View>

          <Text style={s.footnote}>
            The card stores the context. Add distances (elevation / wind holds)
            on the detail screen after saving.
          </Text>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  cancelText: { color: MUTED, fontSize: 16, width: 60 },
  headerTitle: { color: 'white', fontSize: 17, fontWeight: '600' },
  saveText: { color: GOLD, fontSize: 16, fontWeight: '600', width: 60, textAlign: 'right' },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    color: GOLD, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.2, marginBottom: 10, marginTop: 8,
  },
  card: {
    backgroundColor: SURFACE, borderRadius: 8, borderWidth: 1,
    borderColor: BORDER, marginBottom: 16, overflow: 'hidden',
  },
  firearmRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  firearmRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  firearmRowActive: { backgroundColor: 'rgba(201,168,76,0.08)' },
  firearmName: { color: 'white', fontSize: 14, fontWeight: '600' },
  firearmSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  check: { color: GOLD, fontSize: 18, fontWeight: '700', marginLeft: 12 },
  input: {
    color: 'white', fontSize: 14,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  inlineRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  inlineInput: {
    color: 'white', fontSize: 14, flex: 1,
  },
  inlineUnit: { color: MUTED, fontSize: 13 },
  chipRow: { flexDirection: 'row', gap: 8, padding: 12, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: BG,
  },
  chipActive: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { color: '#ccc', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#000', fontWeight: '700' },
  notesCard: { padding: 12 },
  notesInput: {
    color: 'white', fontSize: 14, minHeight: 80, textAlignVertical: 'top',
  },
  footnote: {
    color: MUTED, fontSize: 11, lineHeight: 16,
    marginTop: 4, marginBottom: 8,
  },
  helper: {
    color: '#888', fontSize: 11, lineHeight: 16,
    marginTop: -10, marginBottom: 16,
  },
  // Unused helpers kept for parity with dispose.tsx styling vocabulary.
  danger: { color: DANGER },
});
