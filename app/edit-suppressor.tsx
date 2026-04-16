// Edit Suppressor — mirrors app/add-suppressor.tsx exactly, but loads an
// existing row via getSuppressorById, calls updateSuppressor on save, and
// adds a destructive Delete button at the bottom.

import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useCallback } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  updateSuppressor, deleteSuppressor, getSuppressorById,
  resolveImageUri, getAllNfaTrusts, setSuppressorAtfForm,
} from '../lib/database';
import type { NfaTrust } from '../lib/database';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { useEntitlements } from '../lib/useEntitlements';
import { runProGated } from '../lib/paywall';
import { scanAtfForm } from '../lib/atfOcr';
import type { AtfExtracted } from '../lib/atfOcr';
import { saveScanToAtfForms } from '../lib/atfScans';
import { syncWidgets } from '../lib/widgetSync';
import SmartField from '../components/SmartField';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#E05A4B';

const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor'];
const NFA_FORM_TYPES = ['Form 1 (Self-Manufactured)', 'Form 4 (Transfer/Purchase)', 'Form 3 (SOT/Dealer)'];
const ATF_STATUSES = ['Not Yet Filed', 'Pending (eFiled)', 'Pending (Paper)', 'Approved', 'Denied'];
const TRUST_TYPES = ['Individual', 'NFA Trust', 'Corporation', 'Government Entity'];
const MOUNT_TYPES = ['direct_thread', 'qd', 'hybrid'];
const MOUNT_TYPE_LABELS: Record<string, string> = {
  direct_thread: 'Direct Thread',
  qd: 'Quick Detach',
  hybrid: 'Hybrid',
};

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

async function saveImagePermanently(uri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'suppressors');
  if (!dir.exists) dir.create();
  const ext = uri.split('.').pop() ?? 'jpg';
  const filename = `suppressor_${Date.now()}.${ext}`;
  const source = new File(uri);
  const dest = new File(dir, filename);
  source.copy(dest);
  return 'suppressors/' + filename;
}

export default function EditSuppressor() {
  const ent = useEntitlements();
  const { id } = useLocalSearchParams<{ id: string }>();
  const suppressorId = Number(id);

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [caliber, setCaliber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [selectedCondition, setSelectedCondition] = useState('');
  const [purchasedFrom, setPurchasedFrom] = useState('');
  const [dealerCityState, setDealerCityState] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [roundCount, setRoundCount] = useState('');
  const [notes, setNotes] = useState('');
  const [hostNotes, setHostNotes] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [nfaFormType, setNfaFormType] = useState('');
  const [atfStatus, setAtfStatus] = useState('');
  const [atfControlNumber, setAtfControlNumber] = useState('');
  const [dateFiled, setDateFiled] = useState('');
  const [dateApproved, setDateApproved] = useState('');
  const [taxPaid, setTaxPaid] = useState('');
  const [trustType, setTrustType] = useState('');
  const [trustId, setTrustId] = useState<number | null>(null);
  const [trusts, setTrusts] = useState<NfaTrust[]>([]);
  const [lengthInches, setLengthInches] = useState('');
  const [weightOz, setWeightOz] = useState('');
  const [threadPitch, setThreadPitch] = useState('');
  const [mountType, setMountType] = useState('');
  const [fullAutoRated, setFullAutoRated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);

  function handleAtfScan() {
    runProGated('atf_ocr', () => runAtfScan());
  }

  async function runAtfScan() {
    const result = await new Promise<ImagePicker.ImagePickerResult | null>((resolve) => {
      Alert.alert('Scan ATF Form', 'Choose a source', [
        {
          text: 'Camera',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission Required', 'Camera access is needed to scan forms.');
              resolve(null); return;
            }
            try {
              resolve(await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false, quality: 0.9,
              }));
            } catch { resolve(null); }
          },
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission Required', 'Photo library access is needed.');
              resolve(null); return;
            }
            resolve(await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false, quality: 0.9,
            }));
          },
        },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    });
    if (!result || result.canceled) return;

    setOcrRunning(true);
    try {
      const scanUri = result.assets[0].uri;
      const extracted = await scanAtfForm(scanUri);
      applyAtfExtraction(extracted, scanUri);
    } catch {
      Alert.alert('Scan failed', 'Could not read the form. Try a clearer photo.');
    } finally {
      setOcrRunning(false);
    }
  }

  function applyAtfExtraction(x: AtfExtracted, scanUri?: string) {
    const idLines = [
      x.make ? `Make: ${x.make}` : null,
      x.model ? `Model: ${x.model}` : null,
      x.caliber ? `Caliber: ${x.caliber}` : null,
      x.serialNumber ? `Serial: ${x.serialNumber}` : null,
    ].filter(Boolean);
    const nfaLines = [
      x.formType ? `Form: ${x.formType}` : null,
      x.itemCategory ? `Category: ${x.itemCategory}` : null,
      x.controlNumber ? `Control #: ${x.controlNumber}` : null,
      x.dateFiled ? `Filed: ${x.dateFiled}` : null,
      x.dateApproved ? `Approved: ${x.dateApproved}` : null,
      x.taxPaid ? `Tax: $${x.taxPaid}` : null,
    ].filter(Boolean);
    const sections: string[] = [];
    if (idLines.length) sections.push('— Description —\n' + idLines.join('\n'));
    if (nfaLines.length) sections.push('— NFA —\n' + nfaLines.join('\n'));
    const summary = sections.join('\n\n');

    const sourceNote = x.source === 'stub'
      ? '\n\n(Sample data — OCR could not read this image. Try a clearer, straight-on photo in good light.)'
      : '';

    // In the edit flow we overwrite by default — the user tapped scan
    // specifically to update the fields, so quiet "only fill if empty"
    // would be surprising. Still shown in the confirm dialog first.
    Alert.alert(
      'Apply scanned values?',
      (summary || 'No fields detected.') + sourceNote,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply', onPress: () => {
            if (x.make) setMake(x.make);
            if (x.model) setModel(x.model);
            if (x.caliber) setCaliber(x.caliber);
            if (x.serialNumber) setSerialNumber(x.serialNumber);
            if (x.formType) setNfaFormType(x.formType);
            if (x.controlNumber) setAtfControlNumber(x.controlNumber);
            if (x.dateFiled) setDateFiled(x.dateFiled);
            if (x.dateApproved) {
              setDateApproved(x.dateApproved);
              setAtfStatus('Approved');
            } else if (x.dateFiled && !atfStatus) {
              setAtfStatus('Pending (eFiled)');
            }
            if (x.taxPaid) setTaxPaid(x.taxPaid);
            // Auto-attach the scan to the ATF Form On File slot so the
            // user doesn't have to rescan just to keep a copy.
            if (scanUri && Number.isFinite(suppressorId)) {
              saveScanToAtfForms(scanUri)
                .then(stored => setSuppressorAtfForm(suppressorId, 'front', stored))
                .catch(e => console.warn('[edit-suppressor] ATF auto-attach failed', e));
            }
          },
        },
      ],
    );
  }

  // Load once on mount. We don't re-pull on refocus because the user is
  // actively editing and we'd clobber their in-progress changes.
  useFocusEffect(useCallback(() => {
    setTrusts(getAllNfaTrusts());
    if (loaded || !Number.isFinite(suppressorId)) return;
    const row = getSuppressorById(suppressorId);
    if (!row) {
      Alert.alert('Not found', 'This suppressor no longer exists.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return;
    }
    setMake(row.make ?? '');
    setModel(row.model ?? '');
    setCaliber(row.caliber ?? '');
    setSerialNumber(row.serial_number ?? '');
    setPurchaseDate(row.purchase_date ?? '');
    setPurchasePrice(row.purchase_price != null ? String(row.purchase_price) : '');
    setCurrentValue(row.current_value != null ? String(row.current_value) : '');
    setSelectedCondition(row.condition_rating ?? '');
    setPurchasedFrom(row.purchased_from ?? '');
    setDealerCityState(row.dealer_city_state ?? '');
    setStorageLocation(row.storage_location ?? '');
    setRoundCount(row.round_count ? String(row.round_count) : '');
    setNotes(row.notes ?? '');
    setHostNotes(row.host_notes ?? '');
    setImageUri(row.image_uri ?? null);
    setNfaFormType(row.nfa_form_type ?? '');
    setAtfStatus(row.atf_form_status ?? '');
    setAtfControlNumber(row.atf_control_number ?? '');
    setDateFiled(row.date_filed ?? '');
    setDateApproved(row.date_approved ?? '');
    setTaxPaid(row.tax_paid_amount != null ? String(row.tax_paid_amount) : '');
    setTrustType(row.trust_type ?? '');
    setTrustId(row.trust_id);
    setLengthInches(row.length_inches ?? '');
    setWeightOz(row.weight_oz ?? '');
    setThreadPitch(row.thread_pitch ?? '');
    setMountType(row.mount_type ?? '');
    setFullAutoRated(!!row.full_auto_rated);
    setLoaded(true);
  }, [suppressorId, loaded]));

  const pickedTrust = trustId !== null ? trusts.find(t => t.id === trustId) ?? null : null;

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.85,
    });
    if (result.canceled) return;
    const saved = await saveImagePermanently(result.assets[0].uri);
    setImageUri(saved);
  }

  function handleSave() {
    if (!make.trim() || !model.trim()) {
      Alert.alert('Missing info', 'Make and model are required.');
      return;
    }
    updateSuppressor(suppressorId, {
      make: make.trim(),
      model: model.trim(),
      serial_number: serialNumber.trim() || null,
      caliber: caliber.trim() || null,
      purchase_date: purchaseDate.trim() || null,
      purchase_price: purchasePrice ? parseFloat(purchasePrice) : null,
      current_value: currentValue ? parseFloat(currentValue) : null,
      condition_rating: selectedCondition || null,
      notes: notes.trim() || null,
      image_uri: imageUri,
      purchased_from: purchasedFrom.trim() || null,
      dealer_city_state: dealerCityState.trim() || null,
      storage_location: storageLocation.trim() || null,
      round_count: roundCount ? parseInt(roundCount, 10) || 0 : 0,
      nfa_form_type: nfaFormType || null,
      atf_form_status: atfStatus || null,
      atf_control_number: atfControlNumber.trim() || null,
      date_filed: dateFiled.trim() || null,
      date_approved: dateApproved.trim() || null,
      tax_paid_amount: taxPaid ? parseFloat(taxPaid) : null,
      trust_type: pickedTrust ? pickedTrust.trust_type : (trustType || null),
      trust_name: pickedTrust ? pickedTrust.name : null,
      responsible_persons: pickedTrust ? pickedTrust.responsible_persons : null,
      trust_id: trustId,
      length_inches: lengthInches.trim() || null,
      weight_oz: weightOz.trim() || null,
      thread_pitch: threadPitch.trim() || null,
      mount_type: mountType || null,
      full_auto_rated: fullAutoRated ? 1 : 0,
      host_notes: hostNotes.trim() || null,
    });
    syncWidgets();
    router.back();
  }

  function handleDelete() {
    Alert.alert(
      'Delete Suppressor',
      `Permanently delete "${make} ${model}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteSuppressor(suppressorId);
            syncWidgets();
            // Pop twice: close this screen and the now-stale detail screen.
            router.back();
            router.back();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Edit Suppressor</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={styles.save}>Save</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <TouchableOpacity style={styles.photoBox} onPress={pickImage} activeOpacity={0.8}>
            {imageUri ? (
              <View style={{ flex: 1 }}>
                <Image source={{ uri: resolveImageUri(imageUri) ?? undefined }} style={styles.photo} />
                <View style={styles.photoOverlay}>
                  <Text style={styles.photoOverlayText}>Tap to change</Text>
                </View>
              </View>
            ) : (
              <View style={styles.photoPlaceholder}>
                <Image source={require('../assets/Icon.png')} style={styles.photoIconImg} />
                <Text style={styles.photoLabel}>Add Photo</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>IDENTIFICATION</Text>
          <View style={styles.card}>
            <SmartField label="Make" value={make} onChange={setMake} source="suppressor_make" placeholder="e.g. SilencerCo" />
            <SmartField label="Model" value={model} onChange={setModel} source="suppressor_model" placeholder="e.g. Omega 36M" />
            <SmartField label="Caliber" value={caliber} onChange={setCaliber} source="suppressor_caliber" placeholder="e.g. .30 cal, multi-caliber" />
            <Field label="Serial Number" value={serialNumber} onChange={setSerialNumber} placeholder="On the can" autoCapitalize="characters" last />
          </View>

          <Text style={styles.sectionLabel}>CONDITION</Text>
          <View style={styles.chipRow}>
            {CONDITIONS.map(c => (
              <TouchableOpacity key={c}
                style={[styles.chip, selectedCondition === c && styles.chipActive]}
                onPress={() => setSelectedCondition(selectedCondition === c ? '' : c)}>
                <Text style={[styles.chipText, selectedCondition === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>HOST PLATFORMS</Text>
          <View style={styles.card}>
            <TextInput
              style={styles.notesInput}
              value={hostNotes} onChangeText={setHostNotes}
              placeholder='Free-text — e.g. "Runs on my Rattler and my Scar 17"'
              placeholderTextColor={MUTED}
              multiline numberOfLines={3} textAlignVertical="top"
            />
          </View>

          <Text style={styles.sectionLabel}>NFA PAPERWORK</Text>
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={handleAtfScan}
            disabled={ocrRunning}
            activeOpacity={0.8}>
            {ocrRunning ? (
              <ActivityIndicator color={GOLD} />
            ) : (
              <Text style={styles.scanBtnText}>
                📷  Scan ATF Form / Tax Stamp{!ent.isPro ? '  ·  PRO' : ''}
              </Text>
            )}
          </TouchableOpacity>
          <View style={styles.chipRow}>
            {NFA_FORM_TYPES.map(f => (
              <TouchableOpacity key={f}
                style={[styles.chip, nfaFormType === f && styles.chipActive]}
                onPress={() => setNfaFormType(nfaFormType === f ? '' : f)}>
                <Text style={[styles.chipText, nfaFormType === f && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.chipRow}>
            {ATF_STATUSES.map(s => (
              <TouchableOpacity key={s}
                style={[styles.chip, atfStatus === s && styles.chipActive]}
                onPress={() => setAtfStatus(atfStatus === s ? '' : s)}>
                <Text style={[styles.chipText, atfStatus === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.card}>
            <Field label="ATF Control #" value={atfControlNumber} onChange={setAtfControlNumber} autoCapitalize="characters" />
            <Field label="Date Filed"
              value={dateFiled}
              onChange={(v) => setDateFiled(autoFormatDate(v, dateFiled))}
              placeholder="MM/DD/YYYY" keyboardType="number-pad" />
            <Field label="Date Approved"
              value={dateApproved}
              onChange={(v) => setDateApproved(autoFormatDate(v, dateApproved))}
              placeholder="MM/DD/YYYY" keyboardType="number-pad" />
            <Field label="Tax Paid" value={taxPaid} onChange={setTaxPaid} placeholder="0.00" keyboardType="decimal-pad" prefix="$" last />
          </View>

          <Text style={styles.sectionLabel}>TRUST / OWNERSHIP</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, trustId === null && styles.chipActive]}
              onPress={() => { setTrustId(null); setTrustType(''); }}>
              <Text style={[styles.chipText, trustId === null && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
            {trusts.map(t => (
              <TouchableOpacity
                key={t.id}
                style={[styles.chip, trustId === t.id && styles.chipActive]}
                onPress={() => {
                  if (trustId === t.id) { setTrustId(null); }
                  else { setTrustId(t.id); setTrustType(t.trust_type); }
                }}>
                <Text style={[styles.chipText, trustId === t.id && styles.chipTextActive]}>{t.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.chip, styles.chipNew]}
              onPress={() => router.push('/nfa-trust/new')}>
              <Text style={[styles.chipText, styles.chipNewText]}>＋ New Trust</Text>
            </TouchableOpacity>
          </View>
          {pickedTrust && (
            <View style={styles.card}>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Type</Text>
                <Text style={styles.fieldReadonly}>{pickedTrust.trust_type}</Text>
              </View>
              {pickedTrust.responsible_persons ? (
                <View style={[styles.fieldRow, { borderTopWidth: 1, borderTopColor: BORDER }]}>
                  <Text style={styles.fieldLabel}>RPs</Text>
                  <Text style={styles.fieldReadonly} numberOfLines={2}>{pickedTrust.responsible_persons}</Text>
                </View>
              ) : null}
            </View>
          )}
          {!pickedTrust && (
            <View style={styles.chipRow}>
              {TRUST_TYPES.map(t => (
                <TouchableOpacity key={t}
                  style={[styles.chip, trustType === t && styles.chipActive]}
                  onPress={() => setTrustType(trustType === t ? '' : t)}>
                  <Text style={[styles.chipText, trustType === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>PHYSICAL SPECS</Text>
          <View style={styles.card}>
            <Field label="Length (in)" value={lengthInches} onChange={setLengthInches} placeholder="e.g. 7.5" keyboardType="decimal-pad" />
            <Field label="Weight (oz)" value={weightOz} onChange={setWeightOz} placeholder="e.g. 12.3" keyboardType="decimal-pad" />
            <Field label="Thread Pitch" value={threadPitch} onChange={setThreadPitch} placeholder="e.g. 5/8-24" last />
          </View>
          <View style={styles.chipRow}>
            {MOUNT_TYPES.map(m => (
              <TouchableOpacity key={m}
                style={[styles.chip, mountType === m && styles.chipActive]}
                onPress={() => setMountType(mountType === m ? '' : m)}>
                <Text style={[styles.chipText, mountType === m && styles.chipTextActive]}>{MOUNT_TYPE_LABELS[m]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.nfaToggle, fullAutoRated && styles.nfaToggleActive]}
            onPress={() => setFullAutoRated(!fullAutoRated)}>
            <Text style={[styles.nfaToggleText, fullAutoRated && styles.nfaToggleTextActive]}>
              {fullAutoRated ? '✓ Full-Auto Rated' : 'Full-Auto Rated?'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>PURCHASE</Text>
          <View style={styles.card}>
            <Field label="Purchase Date"
              value={purchaseDate}
              onChange={(v) => setPurchaseDate(autoFormatDate(v, purchaseDate))}
              placeholder="MM/DD/YYYY" keyboardType="number-pad" />
            <SmartField label="Purchased From" value={purchasedFrom} onChange={setPurchasedFrom} source="purchase_location" placeholder="Dealer / SOT" />
            <Field label="City, State" value={dealerCityState} onChange={setDealerCityState} placeholder="e.g. Austin, TX" />
            <Field label="Purchase Price" value={purchasePrice} onChange={setPurchasePrice} placeholder="0.00" keyboardType="decimal-pad" prefix="$" />
            <Field label="Current Value" value={currentValue} onChange={setCurrentValue} placeholder="0.00" keyboardType="decimal-pad" prefix="$" last />
          </View>

          <Text style={styles.sectionLabel}>USAGE</Text>
          <View style={styles.card}>
            <Field label="Round Count" value={roundCount} onChange={setRoundCount} placeholder="0" keyboardType="number-pad" />
            <Field label="Storage Location" value={storageLocation} onChange={setStorageLocation} placeholder="Safe A, shelf 2" last />
          </View>

          <Text style={styles.sectionLabel}>NOTES</Text>
          <View style={styles.card}>
            <TextInput style={styles.notesInput} value={notes} onChangeText={setNotes}
              placeholder="Known quirks, service history, accessories..." placeholderTextColor={MUTED}
              multiline numberOfLines={4} textAlignVertical="top" />
          </View>

          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
            <Text style={styles.deleteBtnText}>Delete Suppressor</Text>
          </TouchableOpacity>

          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType = 'default', prefix, last, autoCapitalize = 'sentences' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; prefix?: string; last?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={[styles.fieldRow, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRight}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput style={styles.fieldInput} value={value} onChangeText={onChange}
          placeholder={placeholder} placeholderTextColor={MUTED}
          keyboardType={keyboardType} autoCorrect={false} autoCapitalize={autoCapitalize} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  cancel: { color: MUTED, fontSize: 16 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  save: { color: GOLD, fontSize: 16, fontWeight: '700' },
  scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 },
  photoBox: { width: '100%', height: 200, borderRadius: 12, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, marginBottom: 20 },
  photo: { width: '100%', height: '100%' },
  photoOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, alignItems: 'center' },
  photoOverlayText: { color: '#FFFFFF', fontSize: 13 },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoIconImg: { width: 56, height: 56, borderRadius: 14 },
  photoLabel: { color: MUTED, fontSize: 15 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: SURFACE, borderRadius: 12, marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 50 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel: { color: '#AAAAAA', fontSize: 15, width: 130 },
  fieldRight: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  prefix: { color: '#AAAAAA', fontSize: 15, marginRight: 2 },
  fieldInput: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 12, textAlign: 'right' },
  fieldReadonly: { flex: 1, color: '#DDDDDD', fontSize: 14, textAlign: 'right' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: '#333333' },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
  chipNew: { borderStyle: 'dashed', borderColor: GOLD, backgroundColor: 'transparent' },
  chipNewText: { color: GOLD, fontWeight: '600' },
  notesInput: { color: '#FFFFFF', fontSize: 15, padding: 16, minHeight: 100 },
  nfaToggle: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 16, marginBottom: 16, marginTop: 8 },
  nfaToggleActive: { backgroundColor: '#1A1510', borderColor: GOLD },
  nfaToggleText: { color: '#888888', fontSize: 15, fontWeight: '600' },
  nfaToggleTextActive: { color: GOLD },
  deleteBtn: { backgroundColor: 'rgba(224,90,75,0.1)', borderWidth: 1, borderColor: DANGER,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  deleteBtnText: { color: DANGER, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  scanBtn: { backgroundColor: '#1E1A10', borderRadius: 12, borderWidth: 1, borderColor: GOLD,
    padding: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 16, minHeight: 50 },
  scanBtnText: { color: GOLD, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
