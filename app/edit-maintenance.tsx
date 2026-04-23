import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import FormScrollView from '../components/FormScrollView';
import {
  getMaintenanceLogById, updateMaintenanceLog, getFirearmById,
  parseDetails, CleaningDetails, InspectionDetails, RepairDetails, UpgradeDetails, RangeSessionDetails,
} from '../lib/database';
import { syncWidgets } from '../lib/widgetSync';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const TYPES = ['Cleaning', 'Inspection', 'Repair', 'Upgrade', 'Range Session', 'Other'];
const TYPE_ICONS: Record<string, string> = {
  'Cleaning': '🧹', 'Inspection': '🔍', 'Repair': '🔧',
  'Upgrade': '⚙️', 'Range Session': '🎯', 'Other': '📋',
};

const CLEANING_TYPES = [
  { label: 'Wipe Down', desc: 'Quick external wipe of surfaces and controls' },
  { label: 'Field Strip', desc: 'Partial disassembly for routine cleaning of major components' },
  { label: 'Deep Clean', desc: 'Full disassembly with thorough cleaning of all parts and internals' },
];

const INSPECTION_REASONS = ['Pre', 'Post', 'Periodic', 'Detailed', 'Safety'];

const PISTOL_COMPONENTS = ['Slide', 'Lower / Frame', 'Barrel', 'Recoil Spring', 'Trigger Assembly', 'Magazine'];
const RIFLE_COMPONENTS = ['Upper Receiver', 'Lower Receiver', 'Barrel', 'Bolt Carrier Group', 'Handguard', 'Stock', 'Trigger Assembly', 'Magazine'];
const SHOTGUN_COMPONENTS = ['Receiver', 'Barrel', 'Bolt', 'Forend', 'Stock', 'Trigger Assembly'];
const REVOLVER_COMPONENTS = ['Frame', 'Cylinder', 'Barrel', 'Trigger Assembly', 'Grips'];
const DEFAULT_COMPONENTS = ['Receiver', 'Barrel', 'Trigger Assembly', 'Stock / Grip'];

const WEATHER_CONDITIONS = ['Clear / Sunny', 'Overcast', 'Rainy', 'Windy', 'Hot (90°F+)', 'Cold (Below 40°F)', 'Indoor Range', 'Night / Low Light'];

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

export default function EditMaintenance() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [selectedType, setSelectedType] = useState('Cleaning');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [firearmType, setFirearmType] = useState('');

  // Cleaning
  const [cleaningType, setCleaningType] = useState('Wipe Down');
  const [solvents, setSolvents] = useState('');
  const [partsReplaced, setPartsReplaced] = useState('');

  // Inspection
  const [inspectionReason, setInspectionReason] = useState('Pre');

  // Repair
  const [roundsFired, setRoundsFired] = useState('');
  const [repairsMade, setRepairsMade] = useState('');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);

  // Upgrade
  const [upgradeDesc, setUpgradeDesc] = useState('');

  // Range Session
  const [rangeRounds, setRangeRounds] = useState('');
  const [duration, setDuration] = useState('');
  const [conditions, setConditions] = useState('');

  useEffect(() => {
    if (!id) return;
    const log = getMaintenanceLogById(Number(id));
    if (!log) return;

    setSelectedType(log.type || 'Cleaning');
    setDate(log.date || '');
    setNotes(log.notes || '');

    // Load firearm type for component list
    const firearm = getFirearmById(log.firearm_id);
    if (firearm?.type) setFirearmType(firearm.type);

    // Populate type-specific fields from details JSON
    switch (log.type) {
      case 'Cleaning': {
        const d = parseDetails<CleaningDetails>(log);
        if (d) {
          setCleaningType(d.cleaning_type || 'Wipe Down');
          setSolvents(d.solvents || '');
          setPartsReplaced(d.parts_replaced || '');
        }
        break;
      }
      case 'Inspection': {
        const d = parseDetails<InspectionDetails>(log);
        if (d) setInspectionReason(d.reason || 'Pre');
        break;
      }
      case 'Repair': {
        const d = parseDetails<RepairDetails>(log);
        setRoundsFired(log.rounds_fired ? String(log.rounds_fired) : '');
        if (d) {
          setRepairsMade(d.repairs_made || '');
          setSelectedComponents(d.components ? d.components.split(', ').filter(Boolean) : []);
        }
        break;
      }
      case 'Upgrade': {
        const d = parseDetails<UpgradeDetails>(log);
        if (d) setUpgradeDesc(d.description || '');
        break;
      }
      case 'Range Session': {
        const d = parseDetails<RangeSessionDetails>(log);
        setRangeRounds(log.rounds_fired ? String(log.rounds_fired) : '');
        if (d) {
          setDuration(d.duration || '');
          setConditions(d.conditions || '');
        }
        break;
      }
    }
  }, [id]);

  function getComponentsList(): string[] {
    const t = firearmType.toLowerCase();
    if (t.includes('pistol')) return PISTOL_COMPONENTS;
    if (t.includes('rifle') || t.includes('sbr') || t.includes('nfa')) return RIFLE_COMPONENTS;
    if (t.includes('shotgun')) return SHOTGUN_COMPONENTS;
    if (t.includes('revolver')) return REVOLVER_COMPONENTS;
    return DEFAULT_COMPONENTS;
  }

  function toggleComponent(c: string) {
    setSelectedComponents(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  }

  function buildDetails(): object | null {
    switch (selectedType) {
      case 'Cleaning':
        return { cleaning_type: cleaningType, solvents: solvents.trim(), parts_replaced: partsReplaced.trim() };
      case 'Inspection':
        return { reason: inspectionReason };
      case 'Repair':
        return { repairs_made: repairsMade.trim(), components: selectedComponents.join(', ') };
      case 'Upgrade':
        return { description: upgradeDesc.trim() };
      case 'Range Session':
        return { duration: duration.trim(), conditions: conditions };
      default:
        return null;
    }
  }

  function getRoundsForSave(): number | null {
    if (selectedType === 'Repair' && roundsFired) return parseInt(roundsFired);
    if (selectedType === 'Range Session' && rangeRounds) return parseInt(rangeRounds);
    return null;
  }

  function handleSave() {
    if (!date.trim()) {
      Alert.alert('Required', 'Please enter a date.');
      return;
    }
    updateMaintenanceLog(Number(id), {
      date: date.trim(),
      type: selectedType,
      rounds_fired: getRoundsForSave(),
      notes: notes.trim() || null,
      details: buildDetails(),
    });
    syncWidgets();
    router.back();
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Edit Entry</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={s.save}>Save</Text>
        </TouchableOpacity>
      </View>
      <FormScrollView contentContainerStyle={s.scroll}>

          <Text style={s.sectionLabel}>TYPE</Text>
          <View style={s.typeGrid}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t}
                style={[s.typeCard, selectedType === t && s.typeCardActive]}
                onPress={() => setSelectedType(t)}>
                <Text style={s.typeIcon}>{TYPE_ICONS[t]}</Text>
                <Text style={[s.typeLabel, selectedType === t && s.typeLabelActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>DATE</Text>
          <View style={s.card}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Date</Text>
              <TextInput style={s.fieldInput} value={date} onChangeText={(v) => setDate(autoFormatDate(v, date))}
                placeholder="MM/DD/YYYY" placeholderTextColor={MUTED}
                keyboardType="number-pad" autoCorrect={false} />
            </View>
          </View>

          {/* ── CLEANING ── */}
          {selectedType === 'Cleaning' && (
            <>
              <Text style={s.sectionLabel}>CLEANING TYPE</Text>
              {CLEANING_TYPES.map((ct) => (
                <TouchableOpacity key={ct.label}
                  style={[s.optionCard, cleaningType === ct.label && s.optionCardActive]}
                  onPress={() => setCleaningType(ct.label)}>
                  <Text style={[s.optionTitle, cleaningType === ct.label && s.optionTitleActive]}>{ct.label}</Text>
                  <Text style={s.optionDesc}>{ct.desc}</Text>
                </TouchableOpacity>
              ))}
              <Text style={s.sectionLabel}>SOLVENTS / LUBRICANTS</Text>
              <View style={s.card}>
                <TextInput style={s.notesInput} value={solvents} onChangeText={setSolvents}
                  placeholder="e.g. Hoppe's No. 9, CLP, RemOil..." placeholderTextColor={MUTED}
                  multiline textAlignVertical="top" />
              </View>
              <Text style={s.sectionLabel}>PARTS REPLACED</Text>
              <View style={s.card}>
                <TextInput style={s.notesInput} value={partsReplaced} onChangeText={setPartsReplaced}
                  placeholder="e.g. Recoil spring, O-ring..." placeholderTextColor={MUTED}
                  multiline textAlignVertical="top" />
              </View>
            </>
          )}

          {/* ── INSPECTION ── */}
          {selectedType === 'Inspection' && (
            <>
              <Text style={s.sectionLabel}>REASON FOR INSPECTION</Text>
              <View style={s.chipRow}>
                {INSPECTION_REASONS.map((r) => (
                  <TouchableOpacity key={r}
                    style={[s.chip, inspectionReason === r && s.chipActive]}
                    onPress={() => setInspectionReason(r)}>
                    <Text style={[s.chipText, inspectionReason === r && s.chipTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ── REPAIR ── */}
          {selectedType === 'Repair' && (
            <>
              <Text style={s.sectionLabel}>ROUND COUNT</Text>
              <View style={s.card}>
                <View style={s.fieldRow}>
                  <Text style={s.fieldLabel}>Rounds Fired</Text>
                  <TextInput style={s.fieldInput} value={roundsFired} onChangeText={setRoundsFired}
                    placeholder="Total at time of repair" placeholderTextColor={MUTED} keyboardType="number-pad" />
                </View>
              </View>
              <Text style={s.sectionLabel}>COMPONENTS ({(firearmType || 'General').toUpperCase()})</Text>
              <View style={s.chipRow}>
                {getComponentsList().map((c) => (
                  <TouchableOpacity key={c}
                    style={[s.chip, selectedComponents.includes(c) && s.chipActive]}
                    onPress={() => toggleComponent(c)}>
                    <Text style={[s.chipText, selectedComponents.includes(c) && s.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.sectionLabel}>REPAIRS MADE</Text>
              <View style={s.card}>
                <TextInput style={s.notesInput} value={repairsMade} onChangeText={setRepairsMade}
                  placeholder="Describe repairs performed..." placeholderTextColor={MUTED}
                  multiline textAlignVertical="top" />
              </View>
            </>
          )}

          {/* ── UPGRADE ── */}
          {selectedType === 'Upgrade' && (
            <>
              <Text style={s.sectionLabel}>UPGRADE DETAILS</Text>
              <View style={s.card}>
                <TextInput style={[s.notesInput, { minHeight: 140 }]} value={upgradeDesc} onChangeText={setUpgradeDesc}
                  placeholder="Describe the upgrade — sights, trigger, grips, barrel, optic, light, etc."
                  placeholderTextColor={MUTED} multiline textAlignVertical="top" />
              </View>
            </>
          )}

          {/* ── RANGE SESSION ── */}
          {selectedType === 'Range Session' && (
            <>
              <Text style={s.sectionLabel}>SESSION INFO</Text>
              <View style={s.card}>
                <View style={s.fieldRow}>
                  <Text style={s.fieldLabel}>Rounds Fired</Text>
                  <TextInput style={s.fieldInput} value={rangeRounds} onChangeText={setRangeRounds}
                    placeholder="0" placeholderTextColor={MUTED} keyboardType="number-pad" />
                </View>
                <View style={[s.fieldRow, s.fieldBorder]}>
                  <Text style={s.fieldLabel}>Duration</Text>
                  <TextInput style={s.fieldInput} value={duration} onChangeText={setDuration}
                    placeholder="e.g. 1.5 hours" placeholderTextColor={MUTED} />
                </View>
              </View>
              <Text style={s.sectionLabel}>CONDITIONS</Text>
              <View style={s.chipRow}>
                {WEATHER_CONDITIONS.map((w) => (
                  <TouchableOpacity key={w}
                    style={[s.chip, conditions === w && s.chipActive]}
                    onPress={() => setConditions(conditions === w ? '' : w)}>
                    <Text style={[s.chipText, conditions === w && s.chipTextActive]}>{w}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ── NOTES (all types) ── */}
          <Text style={s.sectionLabel}>NOTES</Text>
          <View style={s.card}>
            <TextInput style={s.notesInput} value={notes} onChangeText={setNotes}
              placeholder={selectedType === 'Other' ? 'Describe what was done...' : 'Any additional observations...'}
              placeholderTextColor={MUTED} multiline numberOfLines={5} textAlignVertical="top" />
          </View>

          <View style={{ height: 60 }} />
        </FormScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  cancel: { color: MUTED, fontSize: 16 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  save: { color: GOLD, fontSize: 16, fontWeight: '700' },
  scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  typeCard: { width: '30%', backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, alignItems: 'center', paddingVertical: 14, gap: 6 },
  typeCardActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  typeIcon: { fontSize: 24 },
  typeLabel: { color: '#888', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  typeLabelActive: { color: GOLD },
  card: { backgroundColor: SURFACE, borderRadius: 12, marginBottom: 20,
    overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 50 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  fieldLabel: { color: '#AAAAAA', fontSize: 15, width: 130 },
  fieldInput: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 12, textAlign: 'right' },
  notesInput: { color: '#FFFFFF', fontSize: 15, padding: 16, minHeight: 80 },
  optionCard: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 10 },
  optionCardActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  optionTitle: { color: '#AAAAAA', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  optionTitleActive: { color: GOLD },
  optionDesc: { color: MUTED, fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: '#333333' },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
});
