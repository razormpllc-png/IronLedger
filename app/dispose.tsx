// Disposition entry / edit screen — marks a firearm or suppressor as
// transferred out of inventory. Writes a row into the `dispositions`
// table which the FFL bound book export then uses to populate the
// disposition columns.
//
// Launches as a modal from the firearm/suppressor detail screen. Accepts
// the target item via query params:
//   /dispose?kind=firearm|suppressor&id=N
// If a disposition already exists for that item, the form pre-populates
// from it and the header flips to "Edit Disposition" so the same screen
// handles both new and existing records.

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput,
  TouchableOpacity, Alert, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getDispositionForItem, insertDisposition, updateDisposition, deleteDisposition,
  getFirearmById, getSuppressorById,
  DISPOSITION_TYPES,
  type DispositionKind, type Disposition, type DispositionInput,
  type Firearm, type Suppressor,
} from '../lib/database';
import { generateAndShareBillOfSale, type BillOfSaleData } from '../lib/billOfSale';
import FormScrollView from '../components/FormScrollView';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#FF5722';

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

export default function DisposeScreen() {
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const kind: DispositionKind | null =
    params.kind === 'firearm' || params.kind === 'suppressor' ? params.kind : null;
  const itemId = params.id ? parseInt(String(params.id), 10) : null;

  const [existing, setExisting] = useState<Disposition | null>(null);
  const [itemLabel, setItemLabel] = useState<string>('');
  const [itemRecord, setItemRecord] = useState<Firearm | Suppressor | null>(null);

  const [date, setDate] = useState(todayString());
  const [type, setType] = useState<string>('Sold');
  const [toName, setToName] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [toFfl, setToFfl] = useState('');
  const [form4473, setForm4473] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!kind || !itemId) return;
    try {
      // Resolve a human-friendly label for the header subtitle.
      if (kind === 'firearm') {
        const f = getFirearmById(itemId);
        if (f) {
          setItemLabel(f.nickname || `${f.make} ${f.model}`.trim() || 'Firearm');
          setItemRecord(f);
        }
      } else {
        const s = getSuppressorById(itemId);
        if (s) {
          setItemLabel(`${s.make} ${s.model}`.trim() || 'Suppressor');
          setItemRecord(s);
        }
      }
      const disp = getDispositionForItem(kind, itemId);
      if (disp) {
        setExisting(disp);
        setDate(disp.disposition_date || todayString());
        setType(disp.disposition_type || 'Sold');
        setToName(disp.to_name ?? '');
        setToAddress(disp.to_address ?? '');
        setToFfl(disp.to_ffl_number ?? '');
        setForm4473(disp.form_4473_serial ?? '');
        setSalePrice(disp.sale_price != null ? String(disp.sale_price) : '');
        setNotes(disp.notes ?? '');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load item.');
    }
  }, [kind, itemId]);

  const headerTitle = useMemo(
    () => (existing ? 'Edit Disposition' : 'Dispose / Transfer Out'),
    [existing],
  );

  async function handleBillOfSale() {
    try {
      const data: BillOfSaleData = {
        buyerName: toName.trim() || undefined,
        buyerAddress: toAddress.trim() || undefined,
        buyerFfl: toFfl.trim() || undefined,
        dispositionDate: date.trim() || undefined,
        dispositionType: type || undefined,
        salePrice: salePrice.trim() ? parseFloat(salePrice.replace(/[$,]/g, '')) : null,
        form4473Serial: form4473.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (itemRecord) {
        data.make = itemRecord.make ?? undefined;
        data.model = itemRecord.model ?? undefined;
        data.serialNumber = itemRecord.serial_number ?? undefined;
        data.caliber = itemRecord.caliber ?? undefined;
        if ('type' in itemRecord) data.type = (itemRecord as Firearm).type ?? undefined;
        if ('condition' in itemRecord) data.condition = (itemRecord as Firearm).condition ?? undefined;
      }
      await generateAndShareBillOfSale(data);
    } catch (e: any) {
      Alert.alert('PDF Error', e?.message ?? 'Could not generate Bill of Sale.');
    }
  }

  function handleSave() {
    if (!kind || !itemId) {
      Alert.alert('Missing Context', 'No item specified for disposition.');
      return;
    }
    if (!date.trim()) {
      Alert.alert('Required Field', 'Disposition date is required.');
      return;
    }
    if (!type.trim()) {
      Alert.alert('Required Field', 'Choose a disposition type.');
      return;
    }
    const priceNum = salePrice.trim() ? parseFloat(salePrice.replace(/[$,]/g, '')) : null;
    if (salePrice.trim() && (priceNum == null || isNaN(priceNum))) {
      Alert.alert('Invalid Price', 'Sale price must be a number (or leave blank).');
      return;
    }
    const payload: DispositionInput = {
      item_kind: kind,
      item_id: itemId,
      disposition_date: date.trim(),
      disposition_type: type,
      to_name: toName.trim() || null,
      to_address: toAddress.trim() || null,
      to_ffl_number: toFfl.trim() || null,
      form_4473_serial: form4473.trim() || null,
      sale_price: priceNum,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      if (existing) updateDisposition(existing.id, payload);
      else insertDisposition(payload);
      router.back();
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Could not save disposition.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!existing) return;
    Alert.alert(
      'Undo Disposition?',
      'This removes the disposition record and returns the item to active inventory. The underlying firearm or suppressor record is not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => {
            try {
              deleteDisposition(existing.id);
              router.back();
            } catch (e: any) {
              Alert.alert('Delete Failed', e?.message ?? 'Could not remove disposition.');
            }
          },
        },
      ],
    );
  }

  if (!kind || !itemId) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancelText}>Close</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Disposition</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={{ padding: 24 }}>
          <Text style={{ color: '#aaa', fontSize: 14 }}>
            Missing item context. Open this screen from a firearm or suppressor
            detail screen.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={s.headerTitle}>{headerTitle}</Text>
          {itemLabel ? <Text style={s.headerSub}>{itemLabel}</Text> : null}
        </View>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          <Text style={[s.saveText, saving && { opacity: 0.5 }]}>
            {existing ? 'Update' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <FormScrollView style={s.content}>
          <Text style={s.sectionLabel}>DISPOSITION</Text>
          <View style={s.card}>
            <Field
              label="Date"
              value={date}
              onChange={(t) => setDate(autoFormatDate(t, date))}
              placeholder="MM/DD/YYYY"
              keyboardType="number-pad"
              last
            />
          </View>

          <Text style={s.sectionLabel}>TYPE</Text>
          <View style={s.card}>
            <View style={s.chipRow}>
              {DISPOSITION_TYPES.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[s.chip, type === opt && s.chipActive]}
                  onPress={() => setType(opt)}
                >
                  <Text style={[s.chipText, type === opt && s.chipTextActive]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={s.sectionLabel}>TRANSFERRED TO</Text>
          <View style={s.card}>
            <Field
              label="Name"
              value={toName}
              onChange={setToName}
              placeholder="Buyer or recipient"
            />
            <Field
              label="Address"
              value={toAddress}
              onChange={setToAddress}
              placeholder="City, State or full address"
            />
            <Field
              label="FFL #"
              value={toFfl}
              onChange={setToFfl}
              placeholder="If FFL-to-FFL transfer"
              autoCapitalize="characters"
            />
            <Field
              label="4473 Serial"
              value={form4473}
              onChange={setForm4473}
              placeholder="Form 4473 tracking #"
              autoCapitalize="characters"
              last
            />
          </View>

          <Text style={s.sectionLabel}>FINANCIAL</Text>
          <View style={s.card}>
            <Field
              label="Sale Price"
              value={salePrice}
              onChange={setSalePrice}
              placeholder="0.00"
              keyboardType="decimal-pad"
              prefix="$"
              last
            />
          </View>

          <Text style={s.sectionLabel}>NOTES</Text>
          <View style={s.card}>
            <View style={s.notesWrap}>
              <TextInput
                style={s.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional context — reason, conditions, witnesses…"
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={4}
              />
            </View>
          </View>

          {kind === 'firearm' ? (
            <TouchableOpacity style={s.billOfSaleBtn} onPress={handleBillOfSale}>
              <Text style={s.billOfSaleBtnTxt}>Generate Bill of Sale</Text>
            </TouchableOpacity>
          ) : null}

          {existing ? (
            <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
              <Text style={s.deleteBtnTxt}>Undo Disposition</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={s.footnote}>
            This record is the disposition side of the FFL bound book. It does
            not modify the firearm or suppressor record itself — the item
            stays in your armory as a historical entry (bound book rules
            require keeping the record after disposition).
          </Text>

          <View style={{ height: 40 }} />
        </FormScrollView>
    </SafeAreaView>
  );
}

function Field({
  label, value, onChange, placeholder, keyboardType = 'default',
  prefix, autoCapitalize, last,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  prefix?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  last?: boolean;
}) {
  return (
    <View style={[s.fieldRow, !last && s.fieldBorder]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldRight}>
        {prefix ? <Text style={s.prefix}>{prefix}</Text> : null}
        <TextInput
          style={s.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
        />
      </View>
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
  headerSub: { color: MUTED, fontSize: 11, marginTop: 1 },
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
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12,
  },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel: { color: 'white', fontSize: 14, flex: 1 },
  fieldRight: {
    flexDirection: 'row', alignItems: 'center', flex: 1.5,
    justifyContent: 'flex-end',
  },
  prefix: { color: MUTED, fontSize: 14, marginRight: 4 },
  fieldInput: {
    color: 'white', fontSize: 14, flex: 1, textAlign: 'right',
    paddingVertical: 0,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    backgroundColor: BG,
  },
  chipActive: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { color: '#ccc', fontSize: 13 },
  chipTextActive: { color: '#000', fontWeight: '700' },
  notesWrap: { padding: 12 },
  notesInput: {
    color: 'white', fontSize: 14, minHeight: 80, textAlignVertical: 'top',
  },
  billOfSaleBtn: {
    marginTop: 8, paddingVertical: 14, borderRadius: 10,
    borderWidth: 1, borderColor: GOLD, alignItems: 'center',
  },
  billOfSaleBtnTxt: { color: GOLD, fontSize: 15, fontWeight: '700' },
  deleteBtn: {
    marginTop: 8, paddingVertical: 14, borderRadius: 10,
    borderWidth: 1, borderColor: DANGER, alignItems: 'center',
  },
  deleteBtnTxt: { color: DANGER, fontSize: 15, fontWeight: '700' },
  footnote: {
    color: MUTED, fontSize: 11, lineHeight: 16,
    marginTop: 18, marginBottom: 8,
  },
});
