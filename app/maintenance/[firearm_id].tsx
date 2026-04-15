import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  getFirearmById, getMaintenanceLogs, deleteMaintenanceLog, formatDate,
  parseDetails, CleaningDetails, InspectionDetails, RepairDetails, UpgradeDetails, RangeSessionDetails,
  MaintenanceLog, Firearm,
} from '../../lib/database';
import { syncWidgets } from '../../lib/widgetSync';
import { SafeAreaView } from 'react-native-safe-area-context';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const TYPE_ICONS: Record<string, string> = {
  'Cleaning': '🧹', 'Inspection': '🔍', 'Repair': '🔧',
  'Upgrade': '⚙️', 'Range Session': '🎯', 'Other': '📋',
};

function getDetailSummary(log: MaintenanceLog): string | null {
  switch (log.type) {
    case 'Cleaning': {
      const d = parseDetails<CleaningDetails>(log);
      return d?.cleaning_type || null;
    }
    case 'Inspection': {
      const d = parseDetails<InspectionDetails>(log);
      return d?.reason ? `${d.reason} Inspection` : null;
    }
    case 'Repair': {
      const d = parseDetails<RepairDetails>(log);
      return d?.components || null;
    }
    case 'Upgrade': {
      const d = parseDetails<UpgradeDetails>(log);
      return d?.description || null;
    }
    case 'Range Session': {
      const d = parseDetails<RangeSessionDetails>(log);
      const parts: string[] = [];
      if (log.rounds_fired) parts.push(`${log.rounds_fired} rds`);
      if (d?.duration) parts.push(d.duration);
      if (d?.conditions) parts.push(d.conditions);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    default:
      return null;
  }
}

function LogCard({ log, onEdit, onDelete }: { log: MaintenanceLog; onEdit: () => void; onDelete: () => void }) {
  const detail = getDetailSummary(log);
  return (
    <TouchableOpacity style={s.card} onPress={onEdit} activeOpacity={0.75}>
      <View style={s.iconBox}>
        <Text style={s.iconText}>{TYPE_ICONS[log.type || ''] || '📋'}</Text>
      </View>
      <View style={s.cardBody}>
        <View style={s.cardHeader}>
          <Text style={s.cardType}>{log.type}</Text>
          <Text style={s.cardDate}>{formatDate(log.date) ?? log.date}</Text>
        </View>
        {detail ? <Text style={s.detail} numberOfLines={1}>{detail}</Text> : null}
        {log.rounds_fired && log.type !== 'Range Session' ? <Text style={s.rounds}>🎯 {log.rounds_fired} rounds</Text> : null}
        {log.notes ? <Text style={s.notes} numberOfLines={2}>{log.notes}</Text> : null}
      </View>
      <TouchableOpacity onPress={onDelete} style={s.deleteBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.deleteText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function MaintenanceLogScreen() {
  const { firearm_id } = useLocalSearchParams<{ firearm_id: string }>();
  const router = useRouter();
  const [firearm, setFirearm] = useState<Firearm | null>(null);
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);

  useFocusEffect(
    useCallback(() => {
      const id = Number(firearm_id);
      setFirearm(getFirearmById(id));
      setLogs(getMaintenanceLogs(id));
    }, [firearm_id])
  );

  function handleDelete(id: number) {
    Alert.alert('Delete Entry', 'Remove this maintenance record?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        deleteMaintenanceLog(id);
        setLogs(getMaintenanceLogs(Number(firearm_id)));
        syncWidgets();
      }},
    ]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Maintenance Log</Text>
          {firearm ? <Text style={s.headerSub}>{firearm.make} {firearm.model}</Text> : null}
        </View>
        <TouchableOpacity onPress={() => router.push(`/add-maintenance?firearm_id=${firearm_id}&firearm_type=${encodeURIComponent(firearm?.type || '')}`)}>
          <Text style={s.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>
      {logs.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🔧</Text>
          <Text style={s.emptyTitle}>No Entries Yet</Text>
          <Text style={s.emptySub}>Tap + Add to log a cleaning or service</Text>
        </View>
      ) : (
        <FlatList data={logs} keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <LogCard log={item} onEdit={() => router.push(`/edit-maintenance?id=${item.id}`)} onDelete={() => handleDelete(item.id)} />}
          contentContainerStyle={s.list} />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  back: { color: GOLD, fontSize: 17 },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  headerSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  addBtn: { color: GOLD, fontSize: 16, fontWeight: '700' },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: CARD, borderRadius: 14, flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 20 },
  cardBody: { flex: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardType: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  cardDate: { color: MUTED, fontSize: 13 },
  detail: { color: '#AAAAAA', fontSize: 13, marginBottom: 4 },
  rounds: { color: GOLD, fontSize: 13, marginBottom: 4 },
  notes: { color: '#888', fontSize: 13, lineHeight: 18 },
  deleteBtn: { padding: 4 },
  deleteText: { color: '#555', fontSize: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  emptySub: { color: MUTED, fontSize: 15, textAlign: 'center', paddingHorizontal: 40 },
});