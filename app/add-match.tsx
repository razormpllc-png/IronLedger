// Add / Edit Competition Match screen
//
// Supports USPSA, IDPA, Steel Challenge, and Outlaw match types.
// Division and classification options adapt per match type.
// Links to a firearm from the armory and optionally to an ammo lot.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getAllFirearms, getAllAmmo,
  getCompetitionMatchById, insertCompetitionMatch, updateCompetitionMatch,
  MATCH_TYPES, USPSA_DIVISIONS, IDPA_DIVISIONS, USPSA_CLASSES, IDPA_CLASSES,
  type Firearm, type Ammo, type CompetitionMatch, type CompetitionMatchInput,
} from '../lib/database';
import { useAutoSave } from '../lib/useDraft';
import SuggestionRow from '../components/SuggestionRow';
import FormScrollView from '../components/FormScrollView';

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

function todayString(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function AddMatchScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? parseInt(String(params.id), 10) : null;

  const [existing, setExisting] = useState<CompetitionMatch | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [ammoList, setAmmoList] = useState<Ammo[]>([]);
  const [saving, setSaving] = useState(false);

  // Form state
  const [matchDate, setMatchDate] = useState(todayString());
  const [matchName, setMatchName] = useState('');
  const [matchType, setMatchType] = useState<string>('USPSA');
  const [practiscoreUrl, setPractiscoreUrl] = useState('');
  const [location, setLocation] = useState('');
  const [firearmId, setFirearmId] = useState<number | null>(null);
  const [ammoId, setAmmoId] = useState<number | null>(null);
  const [division, setDivision] = useState('');
  const [classification, setClassification] = useState('');
  const [overallPlacement, setOverallPlacement] = useState('');
  const [divisionPlacement, setDivisionPlacement] = useState('');
  const [totalStages, setTotalStages] = useState('');
  const [overallScore, setOverallScore] = useState('');
  const [overallHitFactor, setOverallHitFactor] = useState('');
  const [squadNotes, setSquadNotes] = useState('');
  const [notes, setNotes] = useState('');

  // Auto-save
  const screenKey = editingId ? `match-${editingId}` : 'add-match';
  const formSnapshot = useMemo(() => ({
    matchDate, matchName, matchType, practiscoreUrl, location,
    firearmId, ammoId, division, classification,
    overallPlacement, divisionPlacement, totalStages,
    overallScore, overallHitFactor, squadNotes, notes,
  }), [
    matchDate, matchName, matchType, practiscoreUrl, location,
    firearmId, ammoId, division, classification,
    overallPlacement, divisionPlacement, totalStages,
    overallScore, overallHitFactor, squadNotes, notes,
  ]);
  const { restored, clearDraft } = useAutoSave(screenKey, formSnapshot);

  useEffect(() => {
    if (!restored) return;
    setMatchDate(restored.matchDate ?? todayString());
    setMatchName(restored.matchName ?? '');
    setMatchType(restored.matchType ?? 'USPSA');
    setPractiscoreUrl(restored.practiscoreUrl ?? '');
    setLocation(restored.location ?? '');
    setFirearmId(restored.firearmId ?? null);
    setAmmoId(restored.ammoId ?? null);
    setDivision(restored.division ?? '');
    setClassification(restored.classification ?? '');
    setOverallPlacement(restored.overallPlacement ?? '');
    setDivisionPlacement(restored.divisionPlacement ?? '');
    setTotalStages(restored.totalStages ?? '');
    setOverallScore(restored.overallScore ?? '');
    setOverallHitFactor(restored.overallHitFactor ?? '');
    setSquadNotes(restored.squadNotes ?? '');
    setNotes(restored.notes ?? '');
  }, [restored]);

  useEffect(() => {
    try {
      setFirearms(getAllFirearms());
      setAmmoList(getAllAmmo());
      if (editingId != null) {
        const m = getCompetitionMatchById(editingId);
        if (m) {
          setExisting(m);
          setMatchDate(m.match_date);
          setMatchName(m.match_name);
          setMatchType(m.match_type);
          setPractiscoreUrl(m.practiscore_url ?? '');
          setLocation(m.location ?? '');
          setFirearmId(m.firearm_id);
          setAmmoId(m.ammo_id);
          setDivision(m.division ?? '');
          setClassification(m.classification ?? '');
          setOverallPlacement(m.overall_placement != null ? String(m.overall_placement) : '');
          setDivisionPlacement(m.division_placement != null ? String(m.division_placement) : '');
          setTotalStages(m.total_stages != null ? String(m.total_stages) : '');
          setOverallScore(m.overall_score != null ? String(m.overall_score) : '');
          setOverallHitFactor(m.overall_hit_factor != null ? String(m.overall_hit_factor) : '');
          setSquadNotes(m.squad_notes ?? '');
          setNotes(m.notes ?? '');
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load data.');
    }
  }, [editingId]);

  const divisions = matchType === 'USPSA' ? USPSA_DIVISIONS
    : matchType === 'IDPA' ? IDPA_DIVISIONS
    : [];
  const classes = matchType === 'USPSA' ? USPSA_CLASSES
    : matchType === 'IDPA' ? IDPA_CLASSES
    : [];

  function firearmLabel(f: Firearm): string {
    return f.nickname?.trim() || `${f.make} ${f.model}`.trim() || `Firearm #${f.id}`;
  }

  function ammoLabel(a: Ammo): string {
    return `${a.brand ?? ''} ${a.caliber ?? ''} ${a.grain ? a.grain + 'gr' : ''}`.trim() || `Ammo #${a.id}`;
  }

  function handleSave() {
    if (!matchName.trim()) {
      Alert.alert('Match Name Required', 'Give the match a name.');
      return;
    }
    if (!matchDate.trim()) {
      Alert.alert('Date Required', 'Enter the match date.');
      return;
    }

    const payload: CompetitionMatchInput = {
      match_date: matchDate.trim(),
      match_name: matchName.trim(),
      match_type: matchType,
      practiscore_url: practiscoreUrl.trim() || null,
      location: location.trim() || null,
      firearm_id: firearmId,
      ammo_id: ammoId,
      division: division || null,
      classification: classification || null,
      overall_placement: overallPlacement ? parseInt(overallPlacement) : null,
      division_placement: divisionPlacement ? parseInt(divisionPlacement) : null,
      total_stages: totalStages ? parseInt(totalStages) : null,
      overall_score: overallScore ? parseFloat(overallScore) : null,
      overall_hit_factor: overallHitFactor ? parseFloat(overallHitFactor) : null,
      squad_notes: squadNotes.trim() || null,
      notes: notes.trim() || null,
    };

    setSaving(true);
    try {
      if (existing) {
        updateCompetitionMatch(existing.id, payload);
        clearDraft();
        router.back();
      } else {
        const newId = insertCompetitionMatch(payload);
        clearDraft();
        router.replace(`/match/${newId}`);
      }
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Could not save match.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{existing ? 'Edit Match' : 'New Match'}</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          <Text style={[s.saveText, saving && { opacity: 0.5 }]}>
            {existing ? 'Update' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <FormScrollView style={s.content} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Match Type */}
        <Text style={s.sectionLabel}>MATCH TYPE</Text>
        <View style={s.chipRow}>
          {MATCH_TYPES.map((t) => (
            <TouchableOpacity key={t} style={[s.chip, matchType === t && s.chipActive]}
              onPress={() => { setMatchType(t); setDivision(''); setClassification(''); }}>
              <Text style={[s.chipText, matchType === t && s.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Match Details */}
        <Text style={s.sectionLabel}>MATCH DETAILS</Text>
        <View style={s.card}>
          <Field label="Match Name" value={matchName} onChange={setMatchName} placeholder="e.g. Area 3 Championship" />
          <Field label="Date" value={matchDate} onChange={(v) => setMatchDate(autoFormatDate(v, matchDate))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
          <Field label="Location" value={location} onChange={setLocation} placeholder="Range or club name" />
          <Field label="PractiScore URL" value={practiscoreUrl} onChange={setPractiscoreUrl} placeholder="https://practiscore.com/..." autoCapitalize="none" last />
        </View>

        {/* Division & Class */}
        {divisions.length > 0 ? (
          <>
            <Text style={s.sectionLabel}>DIVISION</Text>
            <View style={s.chipRow}>
              {divisions.map((d) => (
                <TouchableOpacity key={d} style={[s.chip, division === d && s.chipActive]}
                  onPress={() => setDivision(division === d ? '' : d)}>
                  <Text style={[s.chipText, division === d && s.chipTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={s.sectionLabel}>DIVISION</Text>
            <View style={s.card}>
              <Field label="Division" value={division} onChange={setDivision} placeholder="Division name" last />
            </View>
          </>
        )}

        {classes.length > 0 ? (
          <>
            <Text style={s.sectionLabel}>CLASSIFICATION</Text>
            <View style={s.chipRow}>
              {classes.map((c) => (
                <TouchableOpacity key={c} style={[s.chip, classification === c && s.chipActive]}
                  onPress={() => setClassification(classification === c ? '' : c)}>
                  <Text style={[s.chipText, classification === c && s.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {/* Results */}
        <Text style={s.sectionLabel}>RESULTS</Text>
        <View style={s.card}>
          <Field label="Overall Place" value={overallPlacement} onChange={setOverallPlacement} placeholder="#" keyboardType="number-pad" />
          <Field label="Division Place" value={divisionPlacement} onChange={setDivisionPlacement} placeholder="#" keyboardType="number-pad" />
          <Field label="Stages" value={totalStages} onChange={setTotalStages} placeholder="# of stages" keyboardType="number-pad" />
          {matchType === 'USPSA' || matchType === 'Outlaw' ? (
            <Field label="Hit Factor" value={overallHitFactor} onChange={setOverallHitFactor} placeholder="Overall HF" keyboardType="decimal-pad" />
          ) : null}
          <Field label="Score" value={overallScore} onChange={setOverallScore} placeholder="Total points or %" keyboardType="decimal-pad" last />
        </View>

        {/* Firearm */}
        {firearms.length > 0 ? (
          <>
            <Text style={s.sectionLabel}>GUN USED</Text>
            <View style={s.card}>
              {firearms.map((f, i) => (
                <TouchableOpacity
                  key={f.id}
                  style={[s.firearmRow, i < firearms.length - 1 && s.firearmRowBorder,
                    firearmId === f.id && s.firearmRowActive]}
                  onPress={() => setFirearmId(firearmId === f.id ? null : f.id)}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.firearmName}>{firearmLabel(f)}</Text>
                    <Text style={s.firearmSub}>{[f.caliber, f.type].filter(Boolean).join(' · ') || '—'}</Text>
                  </View>
                  {firearmId === f.id ? <Text style={s.check}>✓</Text> : null}
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {/* Squad & Notes */}
        <Text style={s.sectionLabel}>NOTES</Text>
        <View style={[s.card, { padding: 12 }]}>
          <TextInput style={s.notesInput} value={squadNotes} onChangeText={setSquadNotes}
            placeholder="Squad, bay assignments, weather notes…" placeholderTextColor={MUTED}
            multiline numberOfLines={3} />
        </View>
        <View style={[s.card, { padding: 12 }]}>
          <TextInput style={s.notesInput} value={notes} onChangeText={setNotes}
            placeholder="Match notes, takeaways, what to work on…" placeholderTextColor={MUTED}
            multiline numberOfLines={4} />
        </View>

        <Text style={s.footnote}>
          Add per-stage scores on the match detail screen after saving.
        </Text>
      </FormScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType = 'default', autoCapitalize, last }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; autoCapitalize?: any; last?: boolean;
}) {
  return (
    <View style={[s.fieldRow, !last && s.fieldBorder]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={s.fieldInput} value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={MUTED}
        keyboardType={keyboardType} autoCapitalize={autoCapitalize}
        autoCorrect={false} />
    </View>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: BG,
  },
  chipActive: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { color: '#ccc', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#000', fontWeight: '700' },
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12,
  },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel: { color: 'white', fontSize: 14, flex: 1 },
  fieldInput: {
    color: 'white', fontSize: 14, flex: 1.5, textAlign: 'right', paddingVertical: 0,
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
  notesInput: { color: 'white', fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
  footnote: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: 4, marginBottom: 8 },
});
