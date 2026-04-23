// Suppressor detail screen — a trimmed analog of app/firearm/[id].tsx.
// Shows identification, NFA paperwork (Form 4 / tax stamp / approval date
// are first-class per the design spec), trust/ownership, physical specs,
// purchase, and the free-text host_notes. Edit/Delete via header action
// and a bottom destructive button. Firearms linkage is intentionally
// one-way and fuzzy: host_notes is the source of truth.

import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useCallback } from 'react';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  getSuppressorById, deleteSuppressor, resolveImageUri, formatDate,
  getDispositionForItem,
  Suppressor, Disposition,
} from '../../lib/database';
import { syncWidgets } from '../../lib/widgetSync';
import AtfFormSection from '../../components/AtfFormSection';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#E05A4B';

const MOUNT_TYPE_LABELS: Record<string, string> = {
  direct_thread: 'Direct Thread',
  qd: 'Quick Detach',
  hybrid: 'Hybrid',
};

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DetailRow({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  if (value == null || value === '') return null;
  return (
    <View style={[s.row, !last && s.rowBorder]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={3}>{value}</Text>
    </View>
  );
}

export default function SuppressorDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const suppressorId = Number(id);
  const [suppressor, setSuppressor] = useState<Suppressor | null>(null);
  const [disposition, setDisposition] = useState<Disposition | null>(null);

  const reloadSuppressor = useCallback(() => {
    if (!Number.isFinite(suppressorId)) return;
    const row = getSuppressorById(suppressorId);
    setSuppressor(row);
    setDisposition(row ? getDispositionForItem('suppressor', row.id) : null);
  }, [suppressorId]);

  useFocusEffect(useCallback(() => {
    reloadSuppressor();
  }, [reloadSuppressor]));

  function handleDelete() {
    if (!suppressor) return;
    Alert.alert(
      'Delete Suppressor',
      `Permanently delete "${suppressor.make} ${suppressor.model}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteSuppressor(suppressorId);
            syncWidgets();
            router.back();
          },
        },
      ]
    );
  }

  if (!suppressor) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
          <Text style={s.headerTitle}>Suppressor</Text>
          <View style={{ width: 50 }} />
        </View>
        <View style={s.emptyState}>
          <Text style={s.emptyText}>Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const img = suppressor.image_uri ? resolveImageUri(suppressor.image_uri) : null;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{suppressor.make} {suppressor.model}</Text>
        <TouchableOpacity onPress={() => router.push(`/edit-suppressor?id=${suppressorId}`)}>
          <Text style={s.edit}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.heroBox}>
          {img ? (
            <Image source={{ uri: img }} style={s.hero} resizeMode="cover" />
          ) : (
            <View style={s.heroPlaceholder}>
              <Image source={require('../../assets/Icon.png')} style={s.heroIconImg} />
            </View>
          )}
          <View style={s.badge}><Text style={s.badgeText}>SUPPRESSOR</Text></View>
        </View>

        <View style={s.titleBlock}>
          <Text style={s.makeModel}>{suppressor.make} {suppressor.model}</Text>
          {disposition ? (
            <View style={s.dispPill}>
              <Text style={s.dispPillText}>
                DISPOSED · {disposition.disposition_type.toUpperCase()}
              </Text>
            </View>
          ) : null}
          <View style={s.tagRow}>
            {suppressor.caliber ? (
              <View style={s.tag}><Text style={s.tagText}>{suppressor.caliber}</Text></View>
            ) : null}
            {suppressor.condition_rating ? (
              <View style={[s.tag, s.conditionTag]}>
                <Text style={s.conditionText}>{suppressor.condition_rating}</Text>
              </View>
            ) : null}
            {suppressor.full_auto_rated ? (
              <View style={[s.tag, s.faTag]}>
                <Text style={s.faText}>FULL-AUTO RATED</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Text style={s.sectionLabel}>IDENTIFICATION</Text>
        <View style={s.card}>
          <DetailRow label="Make" value={suppressor.make} />
          <DetailRow label="Model" value={suppressor.model} />
          <DetailRow label="Caliber" value={suppressor.caliber} />
          <DetailRow label="Serial #" value={suppressor.serial_number} last />
        </View>

        {suppressor.host_notes ? (
          <>
            <Text style={s.sectionLabel}>HOST PLATFORMS</Text>
            <View style={[s.card, s.notesCard]}>
              <Text style={s.notesText}>{suppressor.host_notes}</Text>
            </View>
          </>
        ) : null}

        <Text style={s.sectionLabel}>NFA PAPERWORK</Text>
        <View style={s.card}>
          <DetailRow label="Form Type" value={suppressor.nfa_form_type} />
          <DetailRow label="ATF Status" value={suppressor.atf_form_status} />
          <DetailRow label="Control #" value={suppressor.atf_control_number} />
          <DetailRow label="Date Filed" value={formatDate(suppressor.date_filed)} />
          <DetailRow label="Date Approved" value={formatDate(suppressor.date_approved)} />
          <DetailRow label="Tax Paid" value={suppressor.tax_paid_amount != null ? formatMoney(suppressor.tax_paid_amount) : null} last />
        </View>

        <AtfFormSection
          kind="suppressor"
          ownerId={suppressor.id}
          frontUri={suppressor.atf_form_front_uri}
          backUri={suppressor.atf_form_back_uri}
          scannedAt={suppressor.atf_form_scanned_at}
          onChange={reloadSuppressor}
        />

        {(suppressor.trust_type || suppressor.trust_name || suppressor.responsible_persons) ? (
          <>
            <Text style={s.sectionLabel}>TRUST / OWNERSHIP</Text>
            <View style={s.card}>
              <DetailRow label="Trust Type" value={suppressor.trust_type} />
              <DetailRow label="Trust Name" value={suppressor.trust_name} />
              <DetailRow label="RPs" value={suppressor.responsible_persons} last />
            </View>
          </>
        ) : null}

        <Text style={s.sectionLabel}>PHYSICAL SPECS</Text>
        <View style={s.card}>
          <DetailRow label="Length" value={suppressor.length_inches ? `${suppressor.length_inches} in` : null} />
          <DetailRow label="Weight" value={suppressor.weight_oz ? `${suppressor.weight_oz} oz` : null} />
          <DetailRow label="Thread Pitch" value={suppressor.thread_pitch} />
          <DetailRow label="Mount" value={suppressor.mount_type ? MOUNT_TYPE_LABELS[suppressor.mount_type] ?? suppressor.mount_type : null} />
          <DetailRow label="End Cap" value={suppressor.end_cap_type} />
          <DetailRow label="End Cap Notes" value={suppressor.end_cap_notes} last />
        </View>

        <Text style={s.sectionLabel}>PURCHASE</Text>
        <View style={s.card}>
          <DetailRow label="Date" value={formatDate(suppressor.purchase_date)} />
          <DetailRow label="From" value={suppressor.purchased_from} />
          <DetailRow label="Location" value={suppressor.dealer_city_state} />
          <DetailRow label="Price" value={suppressor.purchase_price != null ? formatMoney(suppressor.purchase_price) : null} />
          <DetailRow label="Current Value" value={suppressor.current_value != null ? formatMoney(suppressor.current_value) : null} last />
        </View>

        {(suppressor.round_count > 0 || suppressor.storage_location) ? (
          <>
            <Text style={s.sectionLabel}>USAGE</Text>
            <View style={s.card}>
              <DetailRow label="Round Count" value={suppressor.round_count > 0 ? String(suppressor.round_count) : null} />
              <DetailRow label="Storage" value={suppressor.storage_location} last />
            </View>
          </>
        ) : null}

        {suppressor.notes ? (
          <>
            <Text style={s.sectionLabel}>NOTES</Text>
            <View style={[s.card, s.notesCard]}>
              <Text style={s.notesText}>{suppressor.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Disposition — presence of a row means this suppressor has left
            inventory. Populates the bound-book disposition columns. */}
        {disposition ? (
          <>
            <Text style={s.sectionLabel}>DISPOSITION</Text>
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.8}
              onPress={() =>
                router.push(`/dispose?kind=suppressor&id=${suppressor.id}`)
              }
            >
              <DetailRow label="Type" value={disposition.disposition_type} />
              <DetailRow label="Date" value={formatDate(disposition.disposition_date) ?? disposition.disposition_date} />
              <DetailRow label="To" value={disposition.to_name} />
              <DetailRow label="Address" value={disposition.to_address} />
              <DetailRow label="FFL #" value={disposition.to_ffl_number} />
              <DetailRow label="4473 Serial" value={disposition.form_4473_serial} />
              <DetailRow
                label="Sale Price"
                value={disposition.sale_price != null ? formatMoney(disposition.sale_price) : null}
              />
              <DetailRow label="Notes" value={disposition.notes} last />
              <Text style={s.dispEditHint}>Tap to edit or undo</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={s.disposeBtn}
            activeOpacity={0.8}
            onPress={() => router.push(`/dispose?kind=suppressor&id=${suppressor.id}`)}
          >
            <Text style={s.disposeBtnText}>Transfer Out / Dispose…</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
          <Text style={s.deleteBtnText}>Delete Suppressor</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  back: { color: GOLD, fontSize: 16, fontWeight: '600', width: 50 },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  edit: { color: GOLD, fontSize: 15, fontWeight: '700', width: 50, textAlign: 'right' },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  heroBox: { width: '100%', height: 220, borderRadius: 14, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, marginBottom: 16 },
  hero: { width: '100%', height: '100%' },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroIconImg: { width: 72, height: 72, borderRadius: 16, opacity: 0.85 },
  badge: { position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(201,168,76,0.92)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { color: '#000', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  titleBlock: { marginBottom: 20 },
  makeModel: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginBottom: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#BBB', fontSize: 12, fontWeight: '600' },
  conditionTag: { backgroundColor: 'rgba(201,168,76,0.15)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)' },
  conditionText: { color: GOLD, fontSize: 12, fontWeight: '700' },
  faTag: { backgroundColor: 'rgba(224,90,75,0.12)', borderWidth: 1, borderColor: 'rgba(224,90,75,0.5)' },
  faText: { color: DANGER, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: SURFACE, borderRadius: 12, marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  notesCard: { padding: 14 },
  notesText: { color: '#DDDDDD', fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 46, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rowLabel: { color: '#AAAAAA', fontSize: 14, width: 120 },
  rowValue: { flex: 1, color: '#FFFFFF', fontSize: 14, textAlign: 'right' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: MUTED, fontSize: 16 },
  deleteBtn: { backgroundColor: 'rgba(224,90,75,0.1)', borderWidth: 1, borderColor: DANGER,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  deleteBtnText: { color: DANGER, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  dispPill: {
    alignSelf: 'flex-start', marginBottom: 10,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
    backgroundColor: 'rgba(255, 87, 34, 0.14)',
    borderWidth: 1, borderColor: '#FF5722',
  },
  dispPillText: { color: '#FF8A65', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  dispEditHint: {
    color: MUTED, fontSize: 11, textAlign: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER,
  },
  disposeBtn: {
    marginTop: 8, paddingVertical: 14, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE,
    alignItems: 'center',
  },
  disposeBtnText: { color: GOLD, fontSize: 14, fontWeight: '600' },
});
