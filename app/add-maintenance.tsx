import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addMaintenanceLog, getAmmoByCaliber, getDistinctCalibers, deductAmmo,
  getFirearmById, getAllAmmo, Ammo,
  setFirearmMaintenanceNotificationId,
} from '../lib/database';
import { syncWidgets } from '../lib/widgetSync';
import { entitlementsStore } from '../lib/entitlements';
import { hasFeature } from '../lib/entitlements';
import {
  scheduleMaintenanceReminder, cancelMaintenanceReminder,
} from '../lib/maintenanceNotifications';

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

function todayString() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function AddMaintenance() {
  const { firearm_id, firearm_type } = useLocalSearchParams<{ firearm_id: string; firearm_type?: string }>();
  const [selectedType, setSelectedType] = useState('Cleaning');
  const [date, setDate] = useState(todayString());
  const [notes, setNotes] = useState('');

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
  const [deductFromInventory, setDeductFromInventory] = useState(true);
  const [selectedAmmoId, setSelectedAmmoId] = useState<number | null>(null);
  const [ammoOptions, setAmmoOptions] = useState<Ammo[]>([]);

  // Load matching ammo when component mounts
  useEffect(() => {
    const firearm = getFirearmById(Number(firearm_id));
    const allAmmo = getAllAmmo();
    if (firearm?.caliber) {
      const matching = allAmmo.filter(a =>
        a.caliber.toLowerCase() === firearm.caliber!.toLowerCase()
      );
      if (matching.length > 0) {
        setAmmoOptions(matching);
        setSelectedAmmoId(matching[0].id);
      } else {
        setAmmoOptions(allAmmo);
      }
    } else {
      setAmmoOptions(allAmmo);
    }
  }, [firearm_id]);

  function getComponentsList(): string[] {
    const t = (firearm_type || '').toLowerCase();
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

  function saveLog() {
    addMaintenanceLog({
      firearm_id: Number(firearm_id),
      date: date.trim(),
      type: selectedType,
      rounds_fired: getRoundsForSave(),
      notes: notes.trim() || null,
      details: buildDetails(),
    });
    syncWidgets();
    // Re-arm the maintenance reminder for this firearm, anchored off the
    // log we just saved. Pro-only — Lite users can still log maintenance,
    // they just don't get push reminders (downgrade-safe: read-free,
    // write-gated). Silent async so save stays snappy.
    rearmMaintenanceReminder();
  }

  function rearmMaintenanceReminder() {
    const tier = entitlementsStore.getTier();
    if (!hasFeature(tier, 'maintenance_reminders')) return;
    const fid = Number(firearm_id);
    const firearm = getFirearmById(fid);
    if (!firearm || !firearm.maintenance_interval_months) return;
    // Cancel any prior pending notification, then schedule a fresh one
    // off the log date the user just entered (not today — the user may
    // be back-dating a log). Silent best-effort.
    (async () => {
      try {
        await cancelMaintenanceReminder(firearm.maintenance_notification_id);
        const newId = await scheduleMaintenanceReminder(firearm, date.trim());
        setFirearmMaintenanceNotificationId(fid, newId);
      } catch (e) {
        console.warn('[add-maintenance] reminder reschedule failed', e);
      }
    })();
  }

  function handleSave() {
    if (!date.trim()) {
      Alert.alert('Required', 'Please enter a date.');
      return;
    }

    const rounds = getRoundsForSave();

    // For Range Session with rounds and ammo deduction enabled
    if (selectedType === 'Range Session' && rounds && rounds > 0 && deductFromInventory && selectedAmmoId) {
      const ammo = ammoOptions.find(a => a.id === selectedAmmoId);
      const ammoLabel = ammo ? `${ammo.caliber}${ammo.brand ? ` (${ammo.brand})` : ''}` : 'selected ammo';

      Alert.alert(
        'Deduct from Inventory?',
        `Deduct ${rounds} rounds of ${ammoLabel} from your ammo supply?`,
        [
          {
            text: 'Skip',
            style: 'cancel',
            onPress: () => {
              saveLog();
              router.back();
            },
          },
          {
            text: 'Deduct',
            onPress: () => {
              saveLog();
              const result = deductAmmo(selectedAmmoId, rounds);
              if (result.newQty === 0) {
                Alert.alert(
                  '⚠️ Out of Stock',
                  `${ammoLabel} is now OUT OF STOCK (0 rounds remaining).`,
                  [{ text: 'OK', onPress: () => router.back() }]
                );
              } else if (result.isLow) {
                Alert.alert(
                  '⚡ Low Stock Warning',
                  `${ammoLabel} is running low: ${result.newQty} rounds remaining (threshold: ${result.threshold}).`,
                  [{ text: 'OK', onPress: () => router.back() }]
                );
              } else {
                router.back();
              }
            },
          },
        ]
      );
      return;
    }

    saveLog();
    router.back();
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>Add Entry</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={s.save}>Save</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

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
              <Text style={s.sectionLabel}>COMPONENTS ({(firearm_type || 'General').toUpperCase()})</Text>
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

              {/* Ammo Deduction */}
              <Text style={s.sectionLabel}>AMMO INVENTORY</Text>
              <TouchableOpacity
                style={[s.deductToggle, deductFromInventory && s.deductToggleActive]}
                onPress={() => setDeductFromInventory(!deductFromInventory)}>
                <Text style={[s.deductToggleText, deductFromInventory && s.deductToggleTextActive]}>
                  {deductFromInventory ? '✓  Deduct rounds from inventory' : '○  Deduct rounds from inventory'}
                </Text>
              </TouchableOpacity>

              {deductFromInventory && ammoOptions.length > 0 && (
                <View style={s.ammoPickerWrap}>
                  {ammoOptions.map((a) => (
                    <TouchableOpacity key={a.id}
                      style={[s.ammoOption, selectedAmmoId === a.id && s.ammoOptionActive]}
                      onPress={() => setSelectedAmmoId(a.id)}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.ammoOptionCaliber, selectedAmmoId === a.id && s.ammoOptionCaliberActive]}>
                          {a.caliber}{a.grain ? ` ${a.grain}gr` : ''}
                        </Text>
                        {a.brand ? <Text style={s.ammoOptionBrand}>{a.brand}{a.type ? ` · ${a.type}` : ''}</Text> : null}
                      </View>
                      <Text style={[s.ammoOptionQty, a.quantity <= (a.low_stock_threshold ?? 100) && { color: '#FFC107' }, a.quantity === 0 && { color: '#FF3B30' }]}>
                        {a.quantity.toLocaleString()} rds
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {deductFromInventory && ammoOptions.length === 0 && (
                <View style={s.noAmmoNotice}>
                  <Text style={s.noAmmoText}>No ammo in inventory. Add ammo from the Supply tab first.</Text>
                </View>
              )}

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
        </ScrollView>
      </KeyboardAvoidingView>
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
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
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
  // Option cards (cleaning types)
  optionCard: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 10 },
  optionCardActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  optionTitle: { color: '#AAAAAA', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  optionTitleActive: { color: GOLD },
  optionDesc: { color: MUTED, fontSize: 13, lineHeight: 18 },
  // Chips (inspection reasons, components, weather)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: '#333333' },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
  // Ammo deduction styles
  deductToggle: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 14, marginBottom: 12 },
  deductToggleActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  deductToggleText: { color: '#888888', fontSize: 15, fontWeight: '600' },
  deductToggleTextActive: { color: GOLD },
  ammoPickerWrap: { marginBottom: 20, gap: 8 },
  ammoOption: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 14, flexDirection: 'row', alignItems: 'center' },
  ammoOptionActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  ammoOptionCaliber: { color: '#AAAAAA', fontSize: 15, fontWeight: '700' },
  ammoOptionCaliberActive: { color: '#FFFFFF' },
  ammoOptionBrand: { color: MUTED, fontSize: 13, marginTop: 2 },
  ammoOptionQty: { color: GOLD, fontSize: 14, fontWeight: '700', marginLeft: 12 },
  noAmmoNotice: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 16, marginBottom: 20, alignItems: 'center' },
  noAmmoText: { color: MUTED, fontSize: 14, textAlign: 'center' },
});
