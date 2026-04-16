import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, ScrollView, KeyboardAvoidingView,
  TouchableOpacity, Platform, Alert, StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addRangeSession, updateRangeSession,
  getRangeSessionById, getRangeSessionFirearms,
  getAllFirearms, getAllAmmo, getRecentRangeLocations,
  Firearm, Ammo,
} from '../lib/database';
import { useAutoSave } from '../lib/useDraft';
import { syncWidgets } from '../lib/widgetSync';
import SuggestionRow from '../components/SuggestionRow';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

function todayDisplay(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Convert "MM/DD/YYYY" → "YYYY-MM-DD" for storage. Falls back to today's
 *  ISO string when the input is unparseable so a save never fails on date. */
function toIsoDate(mdy: string): string {
  const m = mdy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function fromIsoDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

interface Line {
  // Stable key used by React — generated client-side. Not persisted.
  key: string;
  firearm_id: number | null;
  ammo_id: number | null;
  rounds_fired: string;
  notes: string;
}

function makeLineKey(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function AddSessionScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId !== null;

  const [date, setDate] = useState(todayDisplay());
  const [location, setLocation] = useState('');
  const [weather, setWeather] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { key: makeLineKey(), firearm_id: null, ammo_id: null, rounds_fired: '', notes: '' },
  ]);

  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [ammoLots, setAmmoLots] = useState<Ammo[]>([]);
  const [recentLocations, setRecentLocations] = useState<string[]>([]);

  // Which line is currently being edited in the picker modal. The same modal
  // is reused for both firearm and ammo picks — `pickerKind` disambiguates.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<'firearm' | 'ammo'>('firearm');
  const [pickerLineKey, setPickerLineKey] = useState<string | null>(null);

  // ── Auto-save draft ──────────────────────────────────────
  const formSnapshot = useMemo(() => ({
    date, location, weather, notes,
  }), [
    date, location, weather, notes,
  ]);
  const { restored, clearDraft } = useAutoSave('add-session', formSnapshot);

  useEffect(() => {
    if (!restored) return;
    setDate(restored.date ?? todayDisplay());
    setLocation(restored.location ?? '');
    setWeather(restored.weather ?? '');
    setNotes(restored.notes ?? '');
  }, [restored]);

  useEffect(() => {
    try {
      setFirearms(getAllFirearms());
      setAmmoLots(getAllAmmo());
      setRecentLocations(getRecentRangeLocations());

      if (isEdit && editingId != null) {
        const session = getRangeSessionById(editingId);
        if (session) {
          setDate(fromIsoDate(session.session_date));
          setLocation(session.location ?? '');
          setWeather(session.weather ?? '');
          setNotes(session.notes ?? '');
          const existingLines = getRangeSessionFirearms(editingId);
          if (existingLines.length > 0) {
            setLines(existingLines.map(l => ({
              key: makeLineKey(),
              firearm_id: l.firearm_id,
              ammo_id: l.ammo_id,
              rounds_fired: String(l.rounds_fired),
              notes: l.notes ?? '',
            })));
          }
        }
      }
    } catch {
      Alert.alert('Error', 'Could not load data');
    }
  }, [isEdit, editingId]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines(prev => (prev.length <= 1 ? prev : prev.filter(l => l.key !== key)));
  }

  function addLine() {
    setLines(prev => [
      ...prev,
      { key: makeLineKey(), firearm_id: null, ammo_id: null, rounds_fired: '', notes: '' },
    ]);
  }

  function openFirearmPicker(key: string) {
    setPickerKind('firearm');
    setPickerLineKey(key);
    setPickerOpen(true);
  }

  function openAmmoPicker(key: string) {
    setPickerKind('ammo');
    setPickerLineKey(key);
    setPickerOpen(true);
  }

  function selectPickerValue(id: number | null) {
    if (!pickerLineKey) return;
    if (pickerKind === 'firearm') updateLine(pickerLineKey, { firearm_id: id });
    else updateLine(pickerLineKey, { ammo_id: id });
    setPickerOpen(false);
  }

  function firearmLabel(id: number | null): string {
    if (id == null) return 'Tap to choose';
    const f = firearms.find(x => x.id === id);
    if (!f) return 'Unknown firearm';
    return f.nickname ? `${f.nickname} (${f.make} ${f.model})` : `${f.make} ${f.model}`;
  }

  function ammoLabel(id: number | null): string {
    if (id == null) return 'None';
    const a = ammoLots.find(x => x.id === id);
    if (!a) return 'Unknown ammo';
    const parts = [a.brand, a.caliber, a.grain ? `${a.grain}gr` : null].filter(Boolean);
    return parts.join(' · ');
  }

  // Filter ammo lots down to the caliber of the line's firearm (if picked).
  // Shown in the picker so users don't accidentally deduct .45 from their 9mm lot.
  function ammoOptionsForLine(key: string): Ammo[] {
    const line = lines.find(l => l.key === key);
    if (!line || line.firearm_id == null) return ammoLots;
    const firearm = firearms.find(f => f.id === line.firearm_id);
    if (!firearm?.caliber) return ammoLots;
    const match = ammoLots.filter(a => a.caliber === firearm.caliber);
    return match.length > 0 ? match : ammoLots;
  }

  function validate(): string | null {
    if (!date.trim()) return 'Date is required';
    const cleanedLines = lines.filter(l => l.firearm_id != null || l.rounds_fired.trim());
    if (cleanedLines.length === 0) return 'Add at least one firearm to log';
    for (const l of cleanedLines) {
      if (l.firearm_id == null) return 'Every line needs a firearm — tap to choose one';
      const n = Number(l.rounds_fired);
      if (!Number.isFinite(n) || n < 0) return 'Rounds fired must be 0 or a positive number';
    }
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) {
      Alert.alert('Hold up', err);
      return;
    }

    const cleanedLines = lines
      .filter(l => l.firearm_id != null)
      .map(l => ({
        firearm_id: l.firearm_id as number,
        ammo_id: l.ammo_id,
        rounds_fired: Number(l.rounds_fired || '0'),
        notes: l.notes.trim() || null,
      }));

    const sessionPayload = {
      session_date: toIsoDate(date),
      location: location.trim() || null,
      weather: weather.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      if (isEdit && editingId != null) {
        updateRangeSession(editingId, sessionPayload, cleanedLines);
      } else {
        addRangeSession(sessionPayload, cleanedLines);
      }
      syncWidgets();
      clearDraft();
      router.back();
    } catch (e) {
      Alert.alert('Save failed', 'Could not save this range session.');
    }
  }

  // Rolled-up preview shown at the bottom of the screen so the user sees
  // exactly what will happen to round counts and ammo stock before saving.
  const totalRounds = lines.reduce(
    (sum, l) => sum + (Number.isFinite(Number(l.rounds_fired)) ? Number(l.rounds_fired) : 0),
    0,
  );

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
          <Text style={s.headerTitle}>{isEdit ? 'Edit Session' : 'New Session'}</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={s.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={s.content}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={s.sectionLabel}>TRIP</Text>
          <View style={s.card}>
            <Row
              label="Date"
              value={date}
              onChange={(v) => setDate(autoFormatDate(v, date))}
              placeholder="MM/DD/YYYY"
              keyboardType="number-pad"
            />
            <Row
              label="Location"
              value={location}
              onChange={setLocation}
              placeholder="Range name"
            />
            <Row
              label="Weather"
              value={weather}
              onChange={setWeather}
              placeholder="Sunny · 72°"
              last
            />
          </View>

          <SuggestionRow source="range_location" query={location} onPick={setLocation} />

          {recentLocations.length > 0 ? (
            <View style={s.quickRow}>
              {recentLocations.map(loc => (
                <TouchableOpacity
                  key={loc}
                  style={[s.quickChip, location === loc && s.quickChipActive]}
                  onPress={() => setLocation(loc)}
                >
                  <Text style={[s.quickChipText, location === loc && s.quickChipTextActive]}>
                    {loc}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <Text style={s.sectionLabel}>FIREARMS SHOT</Text>
          {lines.map((line, idx) => {
            const isLast = idx === lines.length - 1;
            return (
              <View key={line.key} style={s.lineCard}>
                <View style={s.lineHead}>
                  <Text style={s.lineHeadText}>Line {idx + 1}</Text>
                  {lines.length > 1 ? (
                    <TouchableOpacity onPress={() => removeLine(line.key)}>
                      <Text style={s.removeText}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <TouchableOpacity style={s.pickerBtn} onPress={() => openFirearmPicker(line.key)}>
                  <Text style={s.pickerLabel}>Firearm</Text>
                  <Text
                    style={[s.pickerValue, line.firearm_id == null && s.pickerPlaceholder]}
                    numberOfLines={1}
                  >
                    {firearmLabel(line.firearm_id)}
                  </Text>
                  <Text style={s.pickerChev}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.pickerBtn} onPress={() => openAmmoPicker(line.key)}>
                  <Text style={s.pickerLabel}>Ammo</Text>
                  <Text
                    style={[s.pickerValue, line.ammo_id == null && s.pickerPlaceholder]}
                    numberOfLines={1}
                  >
                    {ammoLabel(line.ammo_id)}
                  </Text>
                  <Text style={s.pickerChev}>›</Text>
                </TouchableOpacity>

                <View style={s.inlineRow}>
                  <Text style={s.inlineLabel}>Rounds</Text>
                  <TextInput
                    style={s.inlineInput}
                    value={line.rounds_fired}
                    onChangeText={(v) => updateLine(line.key, { rounds_fired: v.replace(/[^0-9]/g, '') })}
                    placeholder="0"
                    placeholderTextColor={MUTED}
                    keyboardType="number-pad"
                  />
                </View>

                <TextInput
                  style={s.lineNote}
                  value={line.notes}
                  onChangeText={(v) => updateLine(line.key, { notes: v })}
                  placeholder="Notes (optional)"
                  placeholderTextColor={MUTED}
                  multiline
                />
                {!isLast ? <View style={{ height: 10 }} /> : null}
              </View>
            );
          })}

          <TouchableOpacity style={s.addLineBtn} onPress={addLine}>
            <Text style={s.addLineText}>＋ Add Firearm</Text>
          </TouchableOpacity>

          <Text style={s.sectionLabel}>TRIP NOTES</Text>
          <View style={s.card}>
            <View style={s.notesContainer}>
              <TextInput
                style={s.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="How did the session go?"
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={4}
              />
            </View>
          </View>

          {totalRounds > 0 ? (
            <View style={s.summaryCard}>
              <Text style={s.summaryText}>
                On save: {totalRounds} round{totalRounds === 1 ? '' : 's'} added to lifetime counts
                {lines.some(l => l.ammo_id != null) ? ', linked ammo lots decremented' : ''}.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Firearm / ammo picker modal — shared by both kinds, filtered in
            the options list for ammo based on the line's firearm caliber. */}
        <Modal
          visible={pickerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={s.modalBackdrop}>
            <View style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>
                {pickerKind === 'firearm' ? 'Pick a Firearm' : 'Pick Ammo (optional)'}
              </Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {pickerKind === 'ammo' ? (
                  <TouchableOpacity style={s.pickerRow} onPress={() => selectPickerValue(null)}>
                    <Text style={s.pickerRowText}>None (don't deduct from stock)</Text>
                  </TouchableOpacity>
                ) : null}
                {pickerKind === 'firearm'
                  ? firearms.map(f => (
                      <TouchableOpacity key={f.id} style={s.pickerRow} onPress={() => selectPickerValue(f.id)}>
                        <Text style={s.pickerRowText}>
                          {f.nickname ? `${f.nickname} · ` : ''}{f.make} {f.model}
                        </Text>
                        {f.caliber ? <Text style={s.pickerRowSub}>{f.caliber}</Text> : null}
                      </TouchableOpacity>
                    ))
                  : (pickerLineKey ? ammoOptionsForLine(pickerLineKey) : ammoLots).map(a => (
                      <TouchableOpacity key={a.id} style={s.pickerRow} onPress={() => selectPickerValue(a.id)}>
                        <Text style={s.pickerRowText}>
                          {a.brand ? `${a.brand} · ` : ''}{a.caliber}
                          {a.grain ? ` · ${a.grain}gr` : ''}
                        </Text>
                        <Text style={s.pickerRowSub}>{a.quantity} rounds on hand</Text>
                      </TouchableOpacity>
                    ))
                }
                {pickerKind === 'firearm' && firearms.length === 0 ? (
                  <Text style={s.emptyPicker}>No firearms yet — add one first.</Text>
                ) : null}
                {pickerKind === 'ammo' && ammoLots.length === 0 ? (
                  <Text style={s.emptyPicker}>No ammo lots yet.</Text>
                ) : null}
              </ScrollView>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnGhost]}
                onPress={() => setPickerOpen(false)}
              >
                <Text style={s.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ label, value, onChange, placeholder, keyboardType = 'default', last }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  last?: boolean;
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
        keyboardType={keyboardType}
        autoCorrect={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  cancelText: { color: MUTED, fontSize: 16 },
  headerTitle: { color: 'white', fontSize: 18, fontWeight: '600' },
  saveText: { color: GOLD, fontSize: 16, fontWeight: '600' },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    color: GOLD, fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
    marginBottom: 10, marginTop: 8,
  },
  card: {
    backgroundColor: SURFACE, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    marginBottom: 14, overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12,
  },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel: { color: 'white', fontSize: 14, width: 90 },
  fieldInput: { color: 'white', fontSize: 14, flex: 1, padding: 0, textAlign: 'right' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  quickChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE,
  },
  quickChipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  quickChipText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  quickChipTextActive: { color: GOLD },
  lineCard: {
    backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    padding: 12, marginBottom: 10,
  },
  lineHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  lineHeadText: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  removeText: { color: '#FF5722', fontSize: 12, fontWeight: '600' },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8,
  },
  pickerLabel: { color: MUTED, fontSize: 13, width: 60 },
  pickerValue: { color: 'white', fontSize: 14, flex: 1 },
  pickerPlaceholder: { color: MUTED, fontStyle: 'italic' },
  pickerChev: { color: MUTED, fontSize: 18 },
  inlineRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  inlineLabel: { color: MUTED, fontSize: 13, width: 60 },
  inlineInput: {
    flex: 1, color: 'white', fontSize: 14, padding: 0, textAlign: 'right',
  },
  lineNote: {
    color: 'white', fontSize: 13, marginTop: 10,
    borderWidth: 1, borderColor: BORDER, borderRadius: 6, padding: 8, minHeight: 40,
    textAlignVertical: 'top',
  },
  addLineBtn: {
    alignItems: 'center', paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: GOLD, backgroundColor: '#1E1A10',
    marginBottom: 18,
  },
  addLineText: { color: GOLD, fontSize: 14, fontWeight: '700' },
  notesContainer: { paddingHorizontal: 14, paddingVertical: 12 },
  notesInput: {
    color: 'white', fontSize: 14,
    borderWidth: 1, borderColor: BORDER, borderRadius: 6,
    padding: 10, minHeight: 80, textAlignVertical: 'top',
  },
  summaryCard: {
    backgroundColor: 'rgba(201,168,76,0.08)', borderColor: 'rgba(201,168,76,0.3)',
    borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 4,
  },
  summaryText: { color: GOLD, fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: BG, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: BORDER,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#444', marginBottom: 12,
  },
  modalTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  pickerRow: {
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  pickerRowText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  pickerRowSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  emptyPicker: { color: MUTED, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  modalBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  modalBtnGhost: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  modalBtnGhostText: { color: '#CCCCCC', fontSize: 15, fontWeight: '600' },
});
