// Battery log editor — /battery-log/[id]
//
// Handles both create (id === 'new') and edit. Scheduling a reminder is
// Pro-gated — the editor still saves the log for Lite users, just without a
// push. The hub shows all logs regardless of tier.
//
// When replacing a battery, the hub routes here with query params to pre-seed
// the device + firearm so the user can immediately log the new battery.

import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import FormScrollView from '../../components/FormScrollView';
import {
  addBatteryLog, updateBatteryLog, deleteBatteryLog, getBatteryLogById,
  setBatteryNotificationId,
  getAllFirearms,
} from '../../lib/database';
import type { Firearm } from '../../lib/database';
import { syncWidgets } from '../../lib/widgetSync';
import {
  BATTERY_TYPES, DEFAULT_LIFE_MONTHS, formatDueDate, dueLabel,
} from '../../lib/batteryStats';
import type { BatteryType } from '../../lib/batteryStats';
import {
  scheduleBatteryReminder, cancelBatteryReminder, ensurePermission,
  isAvailable as notificationsAvailable,
} from '../../lib/batteryNotifications';
import { useEntitlements } from '../../lib/useEntitlements';
import { runProGated } from '../../lib/paywall';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const COMMON_DEVICE_LABELS = ['Red Dot', 'Holosun', 'RMR', 'ACOG', 'Light', 'Laser', 'LPVO'];

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

function todayMMDDYYYY(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function BatteryLogEditor() {
  const router = useRouter();
  const ent = useEntitlements();
  const params = useLocalSearchParams<{
    id: string;
    prefillFirearmId?: string;
    prefillDeviceLabel?: string;
    prefillBatteryType?: string;
    prefillExpectedLifeMonths?: string;
  }>();
  const isNew = params.id === 'new';
  const numericId = isNew ? null : Number(params.id);

  const [firearmId, setFirearmId] = useState<number | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [batteryType, setBatteryType] = useState<BatteryType>('CR2032');
  const [installDate, setInstallDate] = useState(todayMMDDYYYY());
  const [expectedLifeMonths, setExpectedLifeMonths] = useState('12');
  const [notes, setNotes] = useState('');
  const [prevNotifId, setPrevNotifId] = useState<string | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);

  // Reload firearms list on focus so newly-added firearms show up.
  useFocusEffect(
    useCallback(() => {
      setFirearms(getAllFirearms());
    }, [])
  );

  // Populate on mount — either from an existing record or from hub prefill params.
  useEffect(() => {
    if (!isNew && numericId !== null) {
      const log = getBatteryLogById(numericId);
      if (!log) {
        Alert.alert('Not found', 'This battery log no longer exists.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      setFirearmId(log.firearm_id);
      setDeviceLabel(log.device_label);
      // Guard: saved string might not be in the TYPES list anymore.
      if ((BATTERY_TYPES as readonly string[]).includes(log.battery_type)) {
        setBatteryType(log.battery_type as BatteryType);
      } else {
        setBatteryType('Other');
      }
      setInstallDate(log.install_date);
      setExpectedLifeMonths(String(log.expected_life_months));
      setNotes(log.notes ?? '');
      setPrevNotifId(log.notification_id);
      return;
    }
    // Prefill for "replace" flow
    if (params.prefillFirearmId) {
      const n = Number(params.prefillFirearmId);
      if (!Number.isNaN(n)) setFirearmId(n);
    }
    if (params.prefillDeviceLabel) setDeviceLabel(params.prefillDeviceLabel);
    if (params.prefillBatteryType && (BATTERY_TYPES as readonly string[]).includes(params.prefillBatteryType)) {
      setBatteryType(params.prefillBatteryType as BatteryType);
    }
    if (params.prefillExpectedLifeMonths) setExpectedLifeMonths(params.prefillExpectedLifeMonths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, numericId]);

  // When battery type changes on a NEW log, re-seed the expected life
  // default (so the user picks CR2032 and gets 12 months automatically).
  // On edit, we respect the saved value.
  function handleBatteryTypeChange(next: BatteryType) {
    setBatteryType(next);
    if (isNew) {
      setExpectedLifeMonths(String(DEFAULT_LIFE_MONTHS[next]));
    }
  }

  async function handleSave() {
    if (!deviceLabel.trim()) {
      Alert.alert('Required', 'Please enter a device label (e.g. "RDS", "WML").');
      return;
    }
    if (!installDate.trim()) {
      Alert.alert('Required', 'Please enter the install date.');
      return;
    }
    const months = parseInt(expectedLifeMonths, 10);
    if (!Number.isFinite(months) || months <= 0) {
      Alert.alert('Invalid', 'Expected life (months) must be a positive number.');
      return;
    }

    const payload = {
      firearm_id: firearmId,
      device_label: deviceLabel.trim(),
      battery_type: batteryType,
      install_date: installDate.trim(),
      expected_life_months: months,
      notes: notes.trim() || null,
    };

    let savedId: number;
    if (isNew) {
      savedId = addBatteryLog(payload);
    } else if (numericId !== null) {
      updateBatteryLog(numericId, {
        ...payload,
        notification_id: prevNotifId, // preserve any existing scheduled reminder id
      });
      savedId = numericId;
    } else {
      router.back();
      return;
    }
    syncWidgets();

    // Try to schedule a reminder. Pro-only; Lite users just save the log.
    const tryReschedule = async () => {
      // Cancel any previous notification (dates / lifespan may have changed).
      if (prevNotifId) await cancelBatteryReminder(prevNotifId);
      if (!notificationsAvailable()) return;
      const granted = await ensurePermission();
      if (!granted) return;
      const stub = {
        id: savedId,
        firearm_id: firearmId,
        accessory_id: null,
        device_label: payload.device_label,
        battery_type: payload.battery_type,
        install_date: payload.install_date,
        expected_life_months: payload.expected_life_months,
        replacement_date: null,
        notification_id: null,
        notes: payload.notes,
        created_at: '',
      };
      const newId = await scheduleBatteryReminder(stub);
      setBatteryNotificationId(savedId, newId);
    };

    if (ent.isPro) {
      await tryReschedule();
      router.back();
    } else {
      // Offer the user the Pro upgrade when they try to save a reminder.
      // If they cancel the paywall, we still save the log — reminders are the
      // only Pro-gated part of the flow.
      const openedPaywall = !runProGated('battery_reminders', async () => {
        await tryReschedule();
        router.back();
      });
      if (openedPaywall) {
        // paywall shown (not pro); log is already persisted, just go back once
        // the paywall is dismissed. We do this on a microtask so the modal
        // animation can start first.
        setTimeout(() => router.back(), 150);
      }
    }
  }

  async function handleDelete() {
    if (isNew || numericId === null) return;
    Alert.alert('Delete battery log?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const nid = deleteBatteryLog(numericId);
          await cancelBatteryReminder(nid);
          syncWidgets();
          router.back();
        },
      },
    ]);
  }

  // Preview what the due date would be with the current install + life fields.
  const previewLog = {
    id: 0, firearm_id: null, accessory_id: null,
    device_label: deviceLabel || 'Device',
    battery_type: batteryType,
    install_date: installDate,
    expected_life_months: parseInt(expectedLifeMonths, 10) || 0,
    replacement_date: null, notification_id: null, notes: null, created_at: '',
  };
  const dueStr = formatDueDate(previewLog);
  const dueLbl = previewLog.expected_life_months > 0 ? dueLabel(previewLog) : '—';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>{isNew ? 'New Battery Log' : 'Edit Battery Log'}</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={s.save}>Save</Text>
        </TouchableOpacity>
      </View>

      <FormScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>DEVICE</Text>
          <View style={s.card}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Label</Text>
              <TextInput
                style={s.fieldInput}
                value={deviceLabel}
                onChangeText={setDeviceLabel}
                placeholder='e.g. "RDS on G19"'
                placeholderTextColor={MUTED}
                autoCorrect={false}
              />
            </View>
          </View>
          <View style={s.chipRow}>
            {COMMON_DEVICE_LABELS.map((label) => (
              <TouchableOpacity
                key={label}
                style={[s.chip, deviceLabel === label && s.chipActive]}
                onPress={() => setDeviceLabel(label)}
              >
                <Text style={[s.chipText, deviceLabel === label && s.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>ATTACHED TO FIREARM</Text>
          <View style={s.chipRow}>
            <TouchableOpacity
              style={[s.chip, firearmId === null && s.chipActive]}
              onPress={() => setFirearmId(null)}
            >
              <Text style={[s.chipText, firearmId === null && s.chipTextActive]}>Standalone</Text>
            </TouchableOpacity>
            {firearms.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[s.chip, firearmId === f.id && s.chipActive]}
                onPress={() => setFirearmId(f.id)}
              >
                <Text style={[s.chipText, firearmId === f.id && s.chipTextActive]} numberOfLines={1}>
                  {f.nickname || `${f.make} ${f.model}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>BATTERY TYPE</Text>
          <View style={s.chipRow}>
            {BATTERY_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.chip, batteryType === t && s.chipActive]}
                onPress={() => handleBatteryTypeChange(t)}
              >
                <Text style={[s.chipText, batteryType === t && s.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>SCHEDULE</Text>
          <View style={s.card}>
            <View style={[s.fieldRow, s.fieldBorder]}>
              <Text style={s.fieldLabel}>Install Date</Text>
              <TextInput
                style={s.fieldInput}
                value={installDate}
                onChangeText={(v) => setInstallDate(autoFormatDate(v, installDate))}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
              />
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Expected Life (months)</Text>
              <TextInput
                style={s.fieldInput}
                value={expectedLifeMonths}
                onChangeText={(v) => setExpectedLifeMonths(v.replace(/\D/g, ''))}
                placeholder="12"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
              />
            </View>
          </View>

          {/* Live preview of the due date so the user can sanity-check the math */}
          <View style={s.previewCard}>
            <Text style={s.previewLabel}>Replacement due</Text>
            <Text style={s.previewValue}>{dueStr}</Text>
            <Text style={s.previewSub}>{dueLbl}</Text>
            {!ent.isPro && (
              <Text style={s.previewNote}>
                Pro users also get a push reminder a few hours before the due date.
              </Text>
            )}
            {ent.isPro && !notificationsAvailable() && (
              <Text style={s.previewNote}>
                Push reminders require `expo-notifications` in this build.
              </Text>
            )}
          </View>

          <Text style={s.sectionLabel}>NOTES</Text>
          <View style={s.card}>
            <TextInput
              style={s.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Brand, optional brightness setting, where you bought them..."
              placeholderTextColor={MUTED}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {!isNew && (
            <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
              <Text style={s.deleteBtnText}>Delete Battery Log</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 80 }} />
        </FormScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  cancel: { color: MUTED, fontSize: 16 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  save: { color: GOLD, fontSize: 16, fontWeight: '700' },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: SURFACE, borderRadius: 12, marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 50 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel: { color: '#AAAAAA', fontSize: 15, width: 150 },
  fieldInput: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 12, textAlign: 'right' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: '#333333' },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
  previewCard: {
    backgroundColor: '#1A1510', borderRadius: 12, borderWidth: 1, borderColor: '#3A2C18',
    padding: 14, marginBottom: 20,
  },
  previewLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  previewValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 4 },
  previewSub: { color: GOLD, fontSize: 13, fontWeight: '600', marginTop: 2 },
  previewNote: { color: MUTED, fontSize: 11, marginTop: 8, lineHeight: 16 },
  notesInput: { color: '#FFFFFF', fontSize: 15, padding: 16, minHeight: 80 },
  deleteBtn: {
    backgroundColor: 'transparent', borderRadius: 10, borderWidth: 1, borderColor: '#3A1A1A',
    paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  deleteBtnText: { color: '#FF5722', fontSize: 14, fontWeight: '600' },
});
