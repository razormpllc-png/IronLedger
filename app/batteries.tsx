// Battery Hub — /batteries
//
// Read-only rollup view of every active battery log in the app. Battery
// tracking itself is driven from the accessory flow (Red Dot / Optic,
// Weapon Light, Laser Sight, IR Device) — whenever a battery-powered
// accessory is saved, `syncAccessoryBatteryLog` creates/updates the log
// behind this screen automatically.
//
// Taps on a row jump to the owning accessory (if any) or to the legacy
// log editor as a fallback. The "Replaced" button still lives here as a
// quick way to log today's replacement from the rollup view without
// hunting through firearms to find the right accessory.

import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getActiveBatteryLogs, markBatteryReplaced, deleteBatteryLog,
  formatDate,
} from '../lib/database';
import type { BatteryLogWithFirearm } from '../lib/database';
import { syncWidgets } from '../lib/widgetSync';
import {
  groupByBucket, bucketFor, dueLabel, formatDueDate,
} from '../lib/batteryStats';
import type { BatteryBucket } from '../lib/batteryStats';
import { cancelBatteryReminder, isAvailable as notificationsAvailable } from '../lib/batteryNotifications';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const BUCKET_COLORS: Record<BatteryBucket, string> = {
  overdue: '#FF5722',
  due_soon: '#FFC107',
  ok: '#4CAF50',
};

const BUCKET_LABELS: Record<BatteryBucket, string> = {
  overdue: 'OVERDUE',
  due_soon: 'DUE SOON',
  ok: 'GOOD',
};

export default function BatteryHub() {
  const router = useRouter();
  const [logs, setLogs] = useState<BatteryLogWithFirearm[]>([]);

  useFocusEffect(
    useCallback(() => {
      setLogs(getActiveBatteryLogs());
    }, [])
  );

  const groups = useMemo(() => groupByBucket(logs), [logs]);
  const overdueCount = groups.overdue.length;
  const dueSoonCount = groups.due_soon.length;
  const okCount = groups.ok.length;

  function handleReplaced(log: BatteryLogWithFirearm) {
    const accessoryLinked = log.accessory_id != null;
    Alert.alert(
      'Mark as replaced?',
      accessoryLinked
        ? `This closes out the current log for ${log.device_label}. Today's date will be the replacement date.\n\nOpen the accessory to log the new battery's install date.`
        : `This closes out the current log for ${log.device_label}. Today's date will be the replacement date.\n\nYou'll then create a fresh log for the new battery.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Replaced',
          onPress: async () => {
            const today = new Date().toISOString().slice(0, 10);
            const prevNotifId = markBatteryReplaced(log.id, today);
            await cancelBatteryReminder(prevNotifId);
            syncWidgets();
            if (accessoryLinked) {
              // The new log gets spawned the next time the user updates
              // `date_battery_replaced` on the accessory. Jump them there.
              router.push(`/edit-accessory?id=${log.accessory_id}`);
            } else {
              // Legacy standalone log — fall back to the editor.
              router.push({
                pathname: '/battery-log/new',
                params: {
                  prefillFirearmId: log.firearm_id != null ? String(log.firearm_id) : '',
                  prefillDeviceLabel: log.device_label,
                  prefillBatteryType: log.battery_type,
                  prefillExpectedLifeMonths: String(log.expected_life_months),
                },
              });
            }
            setLogs(getActiveBatteryLogs());
          },
        },
      ]
    );
  }

  function handleLongPress(log: BatteryLogWithFirearm) {
    Alert.alert(
      'Delete battery log?',
      `${log.device_label} (${log.battery_type}) will be removed permanently.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const prevNotifId = deleteBatteryLog(log.id);
            await cancelBatteryReminder(prevNotifId);
            setLogs(getActiveBatteryLogs());
            syncWidgets();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Text style={s.headerBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Batteries</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Summary strip */}
        <View style={s.summaryRow}>
          <View style={[s.summaryCard, { borderColor: logs.length ? BORDER : BORDER }]}>
            <Text style={s.summaryLabel}>Tracked</Text>
            <Text style={s.summaryValue}>{logs.length}</Text>
          </View>
          <View style={[s.summaryCard, overdueCount > 0 && { borderColor: BUCKET_COLORS.overdue }]}>
            <Text style={s.summaryLabel}>Overdue</Text>
            <Text style={[s.summaryValue, { color: overdueCount > 0 ? BUCKET_COLORS.overdue : '#FFFFFF' }]}>{overdueCount}</Text>
          </View>
          <View style={[s.summaryCard, dueSoonCount > 0 && { borderColor: BUCKET_COLORS.due_soon }]}>
            <Text style={s.summaryLabel}>Due Soon</Text>
            <Text style={[s.summaryValue, { color: dueSoonCount > 0 ? BUCKET_COLORS.due_soon : '#FFFFFF' }]}>{dueSoonCount}</Text>
          </View>
        </View>

        {!notificationsAvailable() && logs.length > 0 && (
          <View style={s.noticeCard}>
            <Text style={s.noticeText}>
              Install `expo-notifications` to get OS-level reminders. Until then,
              batteries due in the next 30 days show up here when you open the app.
            </Text>
          </View>
        )}

        {logs.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>No batteries tracked</Text>
            <Text style={s.emptySub}>
              Battery tracking starts automatically when you add a Red Dot,
              Weapon Light, Laser, or IR Device to a firearm and set a
              battery replacement date.
            </Text>
          </View>
        ) : (
          (['overdue', 'due_soon', 'ok'] as BatteryBucket[]).map((bucket) => {
            const rows = groups[bucket];
            if (rows.length === 0) return null;
            return (
              <View key={bucket} style={{ marginBottom: 20 }}>
                <View style={s.sectionHeader}>
                  <View style={[s.bucketDot, { backgroundColor: BUCKET_COLORS[bucket] }]} />
                  <Text style={[s.sectionLabel, { color: BUCKET_COLORS[bucket] }]}>
                    {BUCKET_LABELS[bucket]} · {rows.length}
                  </Text>
                </View>
                <View style={s.card}>
                  {rows.map((log, i) => (
                    <Row
                      key={log.id}
                      log={log}
                      last={i === rows.length - 1}
                      onPress={() => {
                        // Prefer routing to the owning accessory so edits
                        // stay in the primary flow. Fall back to the
                        // legacy editor for orphaned / standalone logs.
                        if (log.accessory_id != null) {
                          router.push(`/edit-accessory?id=${log.accessory_id}`);
                        } else {
                          router.push(`/battery-log/${log.id}`);
                        }
                      }}
                      onMarkReplaced={() => handleReplaced(log)}
                      onLongPress={() => handleLongPress(log)}
                    />
                  ))}
                </View>
              </View>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  log, last, onPress, onMarkReplaced, onLongPress,
}: {
  log: BatteryLogWithFirearm;
  last: boolean;
  onPress: () => void;
  onMarkReplaced: () => void;
  onLongPress: () => void;
}) {
  const bucket = bucketFor(log);
  const title = log.device_label;
  // Context = owning firearm (nickname preferred → make/model). Accessory
  // type is rendered as a secondary tag so the user can tell at a glance
  // this is a "Red Dot on Glock 19" style grouping.
  const firearmContext =
    log.firearm_nickname ||
    (log.firearm_make || log.firearm_model
      ? `${log.firearm_make ?? ''} ${log.firearm_model ?? ''}`.trim()
      : null) ||
    'Standalone';
  const accessoryTag = log.accessory_type || null;
  const context = accessoryTag
    ? `${accessoryTag} · ${firearmContext}`
    : firearmContext;

  return (
    <View style={[s.row, !last && s.rowBorder]}>
      <TouchableOpacity
        style={s.rowMain}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        activeOpacity={0.6}
      >
        <View style={[s.rowDot, { backgroundColor: BUCKET_COLORS[bucket] }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={s.rowSub} numberOfLines={1}>
            {context} · {log.battery_type}
          </Text>
          <Text style={[s.rowDue, { color: BUCKET_COLORS[bucket] }]}>
            {dueLabel(log)} · Due {formatDueDate(log)}
          </Text>
          <Text style={s.rowInstalled}>
            Installed {formatDate(log.install_date) ?? log.install_date}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={s.replaceBtn} onPress={onMarkReplaced} activeOpacity={0.6}>
        <Text style={s.replaceBtnText}>Replaced</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  headerBtn: { minWidth: 70 },
  headerBtnText: { color: MUTED, fontSize: 15 },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
  },
  summaryLabel: { color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  summaryValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  noticeCard: {
    backgroundColor: '#1A1610', borderRadius: 10, borderWidth: 1, borderColor: '#3A2C18',
    padding: 12, marginBottom: 16,
  },
  noticeText: { color: '#C9A84C', fontSize: 12, lineHeight: 17 },
  emptyCard: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 24, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', marginTop: 16,
  },
  emptyTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  emptySub: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 16 },
  emptyBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  emptyBtnText: { color: '#0D0D0D', fontSize: 14, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  bucketDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  card: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowDot: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  rowTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  rowSub: { color: '#AAAAAA', fontSize: 12, marginTop: 2 },
  rowDue: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  rowInstalled: { color: MUTED, fontSize: 11, marginTop: 2 },
  replaceBtn: {
    paddingHorizontal: 12, justifyContent: 'center', borderLeftWidth: 1,
    borderLeftColor: BORDER, backgroundColor: '#141414',
  },
  replaceBtnText: { color: GOLD, fontSize: 12, fontWeight: '700' },
});
