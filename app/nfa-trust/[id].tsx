// Trust editor — /nfa-trust/[id]
//
// Handles both create (id === 'new') and edit. Deletes unlink any linked
// firearms automatically via deleteNfaTrust().

import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addNfaTrust, updateNfaTrust, deleteNfaTrust, getNfaTrustById,
  countFirearmsForTrust,
} from '../../lib/database';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const TRUST_TYPES = ['Individual', 'NFA Trust', 'Corporation', 'Government Entity'];

export default function TrustEditor() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const numericId = isNew ? null : Number(id);

  const [name, setName] = useState('');
  const [trustType, setTrustType] = useState('NFA Trust');
  const [responsiblePersons, setResponsiblePersons] = useState('');
  const [notes, setNotes] = useState('');
  const [linkedCount, setLinkedCount] = useState(0);

  useEffect(() => {
    if (isNew || numericId === null) return;
    const t = getNfaTrustById(numericId);
    if (!t) {
      Alert.alert('Not found', 'This trust no longer exists.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return;
    }
    setName(t.name);
    setTrustType(t.trust_type);
    setResponsiblePersons(t.responsible_persons ?? '');
    setNotes(t.notes ?? '');
    setLinkedCount(countFirearmsForTrust(numericId));
  }, [isNew, numericId]);

  function handleSave() {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a name for the trust or entity.');
      return;
    }
    const payload = {
      name: name.trim(),
      trust_type: trustType,
      responsible_persons: responsiblePersons.trim() || null,
      notes: notes.trim() || null,
    };
    if (isNew) {
      addNfaTrust(payload);
    } else if (numericId !== null) {
      updateNfaTrust(numericId, payload);
    }
    router.back();
  }

  function handleDelete() {
    if (isNew || numericId === null) return;
    const warn = linkedCount > 0
      ? `This trust is linked to ${linkedCount} firearm${linkedCount === 1 ? '' : 's'}. Deleting unlinks them but keeps the firearms.`
      : 'This cannot be undone.';
    Alert.alert('Delete trust?', warn, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteNfaTrust(numericId);
          router.back();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>{isNew ? 'New Trust' : 'Edit Trust'}</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={s.save}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={s.sectionLabel}>IDENTITY</Text>
          <View style={s.card}>
            <Field label="Name" value={name} onChange={setName} placeholder="e.g. Smith Family Trust" last />
          </View>

          <Text style={s.sectionLabel}>TYPE</Text>
          <View style={s.chipRow}>
            {TRUST_TYPES.map(t => (
              <TouchableOpacity
                key={t}
                style={[s.chip, trustType === t && s.chipActive]}
                onPress={() => setTrustType(t)}
              >
                <Text style={[s.chipText, trustType === t && s.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>RESPONSIBLE PERSONS</Text>
          <View style={s.card}>
            <TextInput
              style={s.textArea}
              value={responsiblePersons}
              onChangeText={setResponsiblePersons}
              placeholder="Comma-separated list — e.g. John Smith, Jane Smith"
              placeholderTextColor={MUTED}
              multiline
              textAlignVertical="top"
            />
          </View>

          <Text style={s.sectionLabel}>NOTES</Text>
          <View style={s.card}>
            <TextInput
              style={s.textArea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Attorney, EIN, filing cabinet location, etc."
              placeholderTextColor={MUTED}
              multiline
              textAlignVertical="top"
            />
          </View>

          {!isNew && (
            <>
              <Text style={s.linkedInfo}>
                {linkedCount === 0
                  ? 'Not yet linked to any firearms.'
                  : `Linked to ${linkedCount} firearm${linkedCount === 1 ? '' : 's'}.`}
              </Text>
              <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
                <Text style={s.deleteText}>Delete Trust</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label, value, onChange, placeholder, last,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; last?: boolean;
}) {
  return (
    <View style={[s.fieldRow, !last && s.fieldBorder]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        autoCorrect={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  cancel: { color: MUTED, fontSize: 16 },
  title: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  save: { color: GOLD, fontSize: 16, fontWeight: '700' },
  scroll: { padding: 16, paddingTop: 20 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: SURFACE, borderRadius: 12, marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 50 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel: { color: '#AAAAAA', fontSize: 15, width: 100 },
  fieldInput: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 12, textAlign: 'right' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: '#333' },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
  textArea: { color: '#FFF', fontSize: 15, padding: 16, minHeight: 90 },
  linkedInfo: { color: MUTED, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  deleteBtn: {
    padding: 16, borderRadius: 14, backgroundColor: 'rgba(255,59,48,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)', alignItems: 'center', marginBottom: 20,
  },
  deleteText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
});
