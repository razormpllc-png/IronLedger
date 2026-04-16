import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
  Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  getFirearmById, updateFirearm, resolveImageUri,
  getAllNfaTrusts, setFirearmTaxStamp, setFirearmAtfForm,
} from '../lib/database';
import type { NfaTrust } from '../lib/database';
import { syncWidgets } from '../lib/widgetSync';
import SmartField from '../components/SmartField';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { useEntitlements } from '../lib/useEntitlements';
import { runProGated } from '../lib/paywall';
import { scanAtfForm } from '../lib/atfOcr';
import type { AtfExtracted } from '../lib/atfOcr';
import { saveScanToAtfForms } from '../lib/atfScans';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

// Platform shape only. NFA classifications (Suppressor, SBR, SBS, AOW, MG,
// Destructive Device) live in the NFA ITEM CATEGORY section.
const TYPES = ['Handgun', 'Rifle', 'Shotgun', 'PDW', 'PCC', 'Other'];
// Legacy values that used to live on the type field. When encountered on
// load we migrate them into NFA categories and enable the NFA flag.
const LEGACY_NFA_TYPES = new Set(['Suppressor', 'SBR', 'SBS', 'AOW']);
const ACTION_TYPES = ['Semi-Auto', 'Bolt', 'Pump', 'Lever', 'Revolver', 'Break'];
const TRIGGER_TYPES = ['Standard', 'Binary', 'Forced Reset Trigger', 'Bump-Stock'];
const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor'];
const ACQUISITION_METHODS = ['Purchase', 'Gift', 'Transfer', 'Inheritance'];
const NFA_FORM_TYPES = ['Form 1 (Self-Manufactured)', 'Form 4 (Transfer/Purchase)', 'Form 3 (SOT/Dealer)'];
const NFA_CATEGORIES = ['Suppressor', 'SBR', 'SBS', 'MG', 'AOW', 'Destructive Device'];
const ATF_STATUSES = ['Not Yet Filed', 'Pending (eFiled)', 'Pending (Paper)', 'Approved', 'Denied'];
const TRUST_TYPES = ['Individual', 'NFA Trust', 'Corporation', 'Government Entity'];

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

async function saveImagePermanently(uri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'firearms');
  if (!dir.exists) dir.create();
  const ext = uri.split('.').pop() ?? 'jpg';
  const filename = `firearm_${Date.now()}.${ext}`;
  const source = new File(uri);
  const dest = new File(dir, filename);
  source.copy(dest);
  return 'firearms/' + filename;
}

export default function EditFirearm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ent = useEntitlements();
  const [nickname, setNickname] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [caliber, setCaliber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [actionType, setActionType] = useState('');
  const [triggerType, setTriggerType] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [selectedCondition, setSelectedCondition] = useState('');
  const [acquisitionMethod, setAcquisitionMethod] = useState('');
  const [purchasedFrom, setPurchasedFrom] = useState('');
  const [dealerCityState, setDealerCityState] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [roundCount, setRoundCount] = useState('');
  const [notes, setNotes] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  // NFA
  const [isNfa, setIsNfa] = useState(false);
  const [nfaFormType, setNfaFormType] = useState('');
  const [nfaCategories, setNfaCategories] = useState<string[]>([]);
  const [atfStatus, setAtfStatus] = useState('');
  const [atfControlNumber, setAtfControlNumber] = useState('');
  const [dateFiled, setDateFiled] = useState('');
  const [dateApproved, setDateApproved] = useState('');
  const [taxPaid, setTaxPaid] = useState('');
  const [trustType, setTrustType] = useState('');
  const [trustName, setTrustName] = useState('');
  const [responsiblePersons, setResponsiblePersons] = useState('');
  const [trustId, setTrustId] = useState<number | null>(null);
  const [trusts, setTrusts] = useState<NfaTrust[]>([]);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [taxStampImage, setTaxStampImage] = useState<string | null>(null);

  // Reload trusts when screen regains focus — so a trust created in the nested
  // /nfa-trust/new modal shows up without remount.
  useFocusEffect(
    useCallback(() => {
      setTrusts(getAllNfaTrusts());
    }, [])
  );

  const pickedTrust = trustId !== null ? trusts.find(t => t.id === trustId) ?? null : null;

  function toggleFirearmType(t: string) {
    const active = selectedTypes.includes(t);
    setSelectedTypes(active ? selectedTypes.filter(x => x !== t) : [...selectedTypes, t]);
  }

  useEffect(() => {
    if (!id) return;
    const f = getFirearmById(Number(id));
    if (!f) return;
    setNickname(f.nickname || '');
    setMake(f.make || '');
    setModel(f.model || '');
    setCaliber(f.caliber || '');
    setSerialNumber(f.serial_number || '');
    // Split the stored type string and migrate any legacy NFA classifications
    // (Suppressor, SBR, SBS, AOW) out of the type chip set and into the NFA
    // category chips. Keeps old records intelligible after the cleanup.
    const rawTypes = f.type ? f.type.split(', ').filter(Boolean) : [];
    const platformTypes = rawTypes.filter(t => !LEGACY_NFA_TYPES.has(t));
    const migratedNfaCats = rawTypes.filter(t => LEGACY_NFA_TYPES.has(t));
    setSelectedTypes(platformTypes);
    setActionType(f.action_type || '');
    setTriggerType(f.trigger_type || '');
    setPurchaseDate(f.purchase_date || '');
    setPurchasePrice(f.purchase_price ? String(f.purchase_price) : '');
    setCurrentValue(f.current_value ? String(f.current_value) : '');
    setSelectedCondition(f.condition_rating || '');
    setAcquisitionMethod(f.acquisition_method || '');
    setPurchasedFrom(f.purchased_from || '');
    setDealerCityState(f.dealer_city_state || '');
    setStorageLocation(f.storage_location || '');
    setRoundCount(f.round_count ? String(f.round_count) : '');
    setNotes(f.notes || '');
    setImageUri(f.image_uri || null);
    setIsNfa(!!f.is_nfa || migratedNfaCats.length > 0);
    setNfaFormType(f.nfa_form_type || '');
    const savedCats = f.nfa_item_category ? f.nfa_item_category.split(', ').filter(Boolean) : [];
    const mergedCats = Array.from(new Set([...savedCats, ...migratedNfaCats]));
    setNfaCategories(mergedCats);
    setAtfStatus(f.atf_form_status || '');
    setAtfControlNumber(f.atf_control_number || '');
    setDateFiled(f.date_filed || '');
    setDateApproved(f.date_approved || '');
    setTaxPaid(f.tax_paid_amount ? String(f.tax_paid_amount) : '');
    setTrustType(f.trust_type || '');
    setTrustName(f.trust_name || '');
    setResponsiblePersons(f.responsible_persons || '');
    setTrustId(f.trust_id ?? null);
    setTaxStampImage(f.tax_stamp_image || null);
  }, [id]);

  /**
   * Approval celebration + stamp capture. Fires when user flips ATF status
   * to "Approved" — offers to upload a tax stamp photo (stored via the
   * dedicated setFirearmTaxStamp helper, so it persists even before the
   * full form save). Also auto-seeds date_approved with today if blank.
   */
  function handleStatusPick(st: string) {
    const next = atfStatus === st ? '' : st;
    setAtfStatus(next);
    if (next !== 'Approved' || atfStatus === 'Approved') return;

    // Auto-seed today's date if user hasn't entered one
    if (!dateApproved.trim()) {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setDateApproved(`${mm}/${dd}/${d.getFullYear()}`);
    }

    Alert.alert(
      '🎉 Stamp Approved!',
      'Upload a photo of your tax stamp for your records?',
      [
        { text: 'Skip', style: 'cancel' },
        { text: 'Upload Photo', onPress: pickTaxStamp },
      ],
    );
  }

  async function pickTaxStamp() {
    Alert.alert('Tax Stamp', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Camera access is needed.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false, quality: 0.9,
          });
          if (!result.canceled) await saveTaxStamp(result.assets[0].uri);
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Photo library access is needed.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false, quality: 0.9,
          });
          if (!result.canceled) await saveTaxStamp(result.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function saveTaxStamp(uri: string) {
    try {
      const saved = await saveImagePermanently(uri);
      setTaxStampImage(saved);
      if (id) setFirearmTaxStamp(Number(id), saved);
    } catch {
      Alert.alert('Save failed', 'Could not save the stamp image.');
    }
  }

  /** Launch OCR scan — Pro feature. */
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
    } catch (e) {
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

    Alert.alert(
      'Apply scanned values?',
      (summary || 'No fields detected.') + sourceNote,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply', onPress: () => {
            setIsNfa(true);
            // Edit flow overwrites to match the user's intent in re-scanning.
            if (x.make) setMake(x.make);
            if (x.model) setModel(x.model);
            if (x.caliber) setCaliber(x.caliber);
            if (x.serialNumber) setSerialNumber(x.serialNumber);
            if (x.formType) setNfaFormType(x.formType);
            if (x.itemCategory) {
              setNfaCategories(prev => prev.includes(x.itemCategory!) ? prev : [...prev, x.itemCategory!]);
            }
            if (x.controlNumber) setAtfControlNumber(x.controlNumber);
            if (x.dateFiled) setDateFiled(x.dateFiled);
            if (x.dateApproved) {
              setDateApproved(x.dateApproved);
              setAtfStatus('Approved');
            } else if (x.dateFiled && !atfStatus) {
              setAtfStatus('Pending (eFiled)');
            }
            if (x.taxPaid) setTaxPaid(x.taxPaid);
            // Auto-attach the scanned image to the ATF Form On File slot
            // so the user doesn't have to scan a second time just to keep
            // the copy. Silent — don't block the Apply tap on file I/O.
            if (scanUri && id) {
              saveScanToAtfForms(scanUri)
                .then(stored => setFirearmAtfForm(Number(id), 'front', stored))
                .catch(e => console.warn('[edit-firearm] ATF auto-attach failed', e));
            }
          },
        },
      ],
    );
  }

  async function pickImage() {
    Alert.alert('Photo', 'Choose an option', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Camera access is needed.');
            return;
          }
          try {
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: true, aspect: [4, 3], quality: 0.8,
            });
            if (!result.canceled) {
              const saved = await saveImagePermanently(result.assets[0].uri);
              setImageUri(saved);
            }
          } catch { Alert.alert('Camera Unavailable', 'Use Photo Library instead.'); }
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Photo library access is needed.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true, aspect: [4, 3], quality: 0.8,
          });
          if (!result.canceled) {
            const saved = await saveImagePermanently(result.assets[0].uri);
            setImageUri(saved);
          }
        },
      },
      { text: 'Remove Photo', style: 'destructive', onPress: () => setImageUri(null) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleSave() {
    if (!make.trim() || !model.trim()) {
      Alert.alert('Required Fields', 'Make and Model are required.');
      return;
    }
    // Soft NFA validation — warn if key ATF fields are blank.
    if (isNfa && (!nfaFormType || !atfStatus)) {
      const missing = [
        !nfaFormType ? 'Form type' : null,
        !atfStatus ? 'ATF status' : null,
      ].filter(Boolean).join(' · ');
      Alert.alert(
        'Missing NFA fields',
        `This item is marked NFA but is missing: ${missing}.\n\nSave anyway?`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Save anyway', style: 'destructive', onPress: () => persistFirearm() },
        ],
      );
      return;
    }
    persistFirearm();
  }

  function persistFirearm() {
    const now = new Date().toISOString().slice(0, 10);
    updateFirearm(Number(id), {
      make: make.trim(), model: model.trim(),
      caliber: caliber.trim() || undefined,
      serial_number: serialNumber.trim() || undefined,
      type: selectedTypes.length ? selectedTypes.join(', ') : undefined,
      purchase_date: purchaseDate.trim() || undefined,
      purchase_price: purchasePrice ? parseFloat(purchasePrice) : undefined,
      current_value: currentValue ? parseFloat(currentValue) : undefined,
      condition_rating: selectedCondition || undefined,
      notes: notes.trim() || undefined,
      image_uri: imageUri || undefined,
      nickname: nickname.trim() || undefined,
      action_type: actionType || undefined,
      trigger_type: triggerType || undefined,
      acquisition_method: acquisitionMethod || undefined,
      purchased_from: purchasedFrom.trim() || undefined,
      dealer_city_state: dealerCityState.trim() || undefined,
      storage_location: storageLocation.trim() || undefined,
      round_count: roundCount ? parseInt(roundCount) : 0,
      value_last_updated: currentValue ? now : undefined,
      is_nfa: isNfa ? 1 : 0,
      nfa_form_type: nfaFormType || undefined,
      nfa_item_category: nfaCategories.length ? nfaCategories.join(', ') : undefined,
      atf_form_status: atfStatus || undefined,
      atf_control_number: atfControlNumber.trim() || undefined,
      date_filed: dateFiled.trim() || undefined,
      date_approved: dateApproved.trim() || undefined,
      tax_paid_amount: taxPaid ? parseFloat(taxPaid) : undefined,
      trust_type: pickedTrust?.trust_type ?? (trustType || undefined),
      trust_name: pickedTrust?.name ?? (trustName.trim() || undefined),
      responsible_persons: pickedTrust?.responsible_persons ?? (responsiblePersons.trim() || undefined),
      trust_id: trustId ?? undefined,
    });
    syncWidgets();
    router.back();
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>Edit Firearm</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={s.save}>Save</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <TouchableOpacity style={s.photoBox} onPress={pickImage} activeOpacity={0.8}>
            {imageUri ? (
              <View style={{ flex: 1 }}>
                <Image source={{ uri: resolveImageUri(imageUri) ?? undefined }} style={s.photo} />
                <View style={s.photoOverlay}>
                  <Text style={s.photoOverlayText}>Tap to change</Text>
                </View>
              </View>
            ) : (
              <View style={s.photoPlaceholder}>
                <Image source={require('../assets/Icon.png')} style={s.photoIconImg} />
                <Text style={s.photoLabel}>Add Photo</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={s.sectionLabel}>IDENTIFICATION</Text>
          <View style={s.card}>
            <Field label="Nickname" value={nickname} onChange={setNickname} placeholder="e.g. Home Defense Glock" />
            <SmartField label="Make" value={make} onChange={setMake} source="firearm_make" placeholder="e.g. Glock" />
            <SmartField label="Model" value={model} onChange={setModel} source="firearm_model" placeholder="e.g. G19 Gen 5" />
            <SmartField label="Caliber" value={caliber} onChange={setCaliber} source="firearm_caliber" placeholder="e.g. 9mm, .45 ACP" />
            <Field label="Serial Number" value={serialNumber} onChange={setSerialNumber} placeholder="Optional" autoCapitalize="characters" last />
          </View>

          <Text style={s.sectionLabel}>FIREARM TYPE (select all that apply)</Text>
          <View style={s.chipRow}>
            {TYPES.map((t) => {
              const active = selectedTypes.includes(t);
              return (
                <TouchableOpacity key={t} style={[s.chip, active && s.chipActive]}
                  onPress={() => toggleFirearmType(t)}>
                  <Text style={[s.chipText, active && s.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.sectionLabel}>ACTION TYPE</Text>
          <View style={s.chipRow}>
            {ACTION_TYPES.map((a) => (
              <TouchableOpacity key={a} style={[s.chip, actionType === a && s.chipActive]}
                onPress={() => setActionType(actionType === a ? '' : a)}>
                <Text style={[s.chipText, actionType === a && s.chipTextActive]}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>TRIGGER TYPE</Text>
          <View style={s.chipRow}>
            {TRIGGER_TYPES.map((t) => (
              <TouchableOpacity key={t} style={[s.chip, triggerType === t && s.chipActive]}
                onPress={() => setTriggerType(triggerType === t ? '' : t)}>
                <Text style={[s.chipText, triggerType === t && s.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>CONDITION</Text>
          <View style={s.chipRow}>
            {CONDITIONS.map((c) => (
              <TouchableOpacity key={c} style={[s.chip, selectedCondition === c && s.chipActive]}
                onPress={() => setSelectedCondition(selectedCondition === c ? '' : c)}>
                <Text style={[s.chipText, selectedCondition === c && s.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>ACQUISITION</Text>
          <View style={s.chipRow}>
            {ACQUISITION_METHODS.map((m) => (
              <TouchableOpacity key={m} style={[s.chip, acquisitionMethod === m && s.chipActive]}
                onPress={() => setAcquisitionMethod(acquisitionMethod === m ? '' : m)}>
                <Text style={[s.chipText, acquisitionMethod === m && s.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.card}>
            <Field label="Purchase Date" value={purchaseDate} onChange={(v) => setPurchaseDate(autoFormatDate(v, purchaseDate))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
            <SmartField label="Purchased From" value={purchasedFrom} onChange={setPurchasedFrom} source="purchase_location" placeholder="Dealer, FFL, private seller" />
            <SmartField label="Dealer City & State" value={dealerCityState} onChange={setDealerCityState} source="dealer_city_state" placeholder="e.g. Houston, TX" last />
          </View>

          <Text style={s.sectionLabel}>FINANCIAL</Text>
          <View style={s.card}>
            <Field label="Purchase Price" value={purchasePrice} onChange={setPurchasePrice} placeholder="0.00" keyboardType="decimal-pad" prefix="$" />
            <Field label="Current Value" value={currentValue} onChange={setCurrentValue} placeholder="0.00" keyboardType="decimal-pad" prefix="$" last />
          </View>
          {purchasePrice && !currentValue ? (
            <TouchableOpacity
              style={s.linkBtn}
              onPress={() => setCurrentValue(purchasePrice)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.linkBtnText}>Use purchase price as current value</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={s.sectionLabel}>STORAGE & TRACKING</Text>
          <View style={s.card}>
            <Field label="Storage Location" value={storageLocation} onChange={setStorageLocation} placeholder="e.g. Safe 1, Bedroom" />
            <Field label="Round Count" value={roundCount} onChange={setRoundCount} placeholder="Lifetime rounds fired" keyboardType="number-pad" last />
          </View>

          {/* ── NFA SECTION ── */}
          {/* Scan shortcut sits ABOVE the toggle so a successful scan can
              flip NFA on for the user. Pro-gated. */}
          <TouchableOpacity
            style={s.scanBtn}
            onPress={handleAtfScan}
            disabled={ocrRunning}
            activeOpacity={0.8}>
            {ocrRunning ? (
              <ActivityIndicator color={GOLD} />
            ) : (
              <Text style={s.scanBtnText}>
                📷  Scan ATF Form{!ent.isPro ? '  ·  PRO' : ''}
              </Text>
            )}
          </TouchableOpacity>

          {/* Flipping on NFA is Pro-gated. Turning it off stays free so a user */}
          {/* who downgraded can still clear existing NFA entries. */}
          <TouchableOpacity
            style={[s.nfaToggle, isNfa && s.nfaToggleActive]}
            onPress={() => {
              if (isNfa) {
                setIsNfa(false);
                return;
              }
              runProGated('nfa_tracking', () => setIsNfa(true));
            }}>
            <Text style={[s.nfaToggleText, isNfa && s.nfaToggleTextActive]}>
              {isNfa ? '✓  NFA / Tax Stamp Item' : '○  NFA / Tax Stamp Item'}
              {!isNfa && !ent.isPro && '  ·  PRO'}
            </Text>
          </TouchableOpacity>

          {isNfa && (
            <>
              <Text style={s.sectionLabel}>NFA FORM TYPE</Text>
              <View style={s.chipRow}>
                {NFA_FORM_TYPES.map((f) => (
                  <TouchableOpacity key={f} style={[s.chip, nfaFormType === f && s.chipActive]}
                    onPress={() => setNfaFormType(nfaFormType === f ? '' : f)}>
                    <Text style={[s.chipText, nfaFormType === f && s.chipTextActive]}>{f}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.sectionLabel}>NFA ITEM CATEGORY (select all that apply)</Text>
              <View style={s.chipRow}>
                {NFA_CATEGORIES.map((c) => {
                  const active = nfaCategories.includes(c);
                  return (
                    <TouchableOpacity key={c} style={[s.chip, active && s.chipActive]}
                      onPress={() => setNfaCategories(active ? nfaCategories.filter(x => x !== c) : [...nfaCategories, c])}>
                      <Text style={[s.chipText, active && s.chipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={s.sectionLabel}>ATF STATUS</Text>
              <View style={s.chipRow}>
                {ATF_STATUSES.map((st) => (
                  <TouchableOpacity key={st} style={[s.chip, atfStatus === st && s.chipActive]}
                    onPress={() => handleStatusPick(st)}>
                    <Text style={[s.chipText, atfStatus === st && s.chipTextActive]}>{st}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.card}>
                <Field label="ATF Control #" value={atfControlNumber} onChange={setAtfControlNumber} placeholder="eForms or paper tracking" />
                <Field label="Date Filed" value={dateFiled} onChange={(v) => setDateFiled(autoFormatDate(v, dateFiled))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                <Field label="Date Approved" value={dateApproved} onChange={(v) => setDateApproved(autoFormatDate(v, dateApproved))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                <Field label="Tax Paid" value={taxPaid} onChange={setTaxPaid} placeholder="200.00" keyboardType="decimal-pad" prefix="$" last />
              </View>

              <Text style={s.sectionLabel}>TAX STAMP</Text>
              <View style={s.stampRow}>
                {taxStampImage ? (
                  <Image source={{ uri: resolveImageUri(taxStampImage) ?? undefined }} style={s.stampImage} />
                ) : (
                  <View style={s.stampPlaceholder}><Text style={s.stampPlaceholderText}>🏷️</Text></View>
                )}
                <View style={{ flex: 1, gap: 8 }}>
                  <TouchableOpacity style={s.stampBtn} onPress={pickTaxStamp}>
                    <Text style={s.stampBtnText}>{taxStampImage ? 'Replace Stamp Photo' : 'Upload Stamp Photo'}</Text>
                  </TouchableOpacity>
                  {taxStampImage ? (
                    <TouchableOpacity onPress={() => {
                      setTaxStampImage(null);
                      if (id) setFirearmTaxStamp(Number(id), null);
                    }}>
                      <Text style={s.stampRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <Text style={s.sectionLabel}>TRUST / OWNERSHIP</Text>
              {/* Picker backed by nfa_trusts. Editing an existing record
                  preserves legacy free-text trust fields if no trust was
                  linked. "+ New Trust" opens the trust editor modal. */}
              <View style={s.chipRow}>
                <TouchableOpacity
                  style={[s.chip, trustId === null && s.chipActive]}
                  onPress={() => { setTrustId(null); }}>
                  <Text style={[s.chipText, trustId === null && s.chipTextActive]}>None</Text>
                </TouchableOpacity>
                {trusts.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[s.chip, trustId === t.id && s.chipActive]}
                    onPress={() => {
                      if (trustId === t.id) {
                        setTrustId(null);
                      } else {
                        setTrustId(t.id);
                        setTrustType(t.trust_type);
                      }
                    }}>
                    <Text style={[s.chipText, trustId === t.id && s.chipTextActive]}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[s.chip, s.chipNew]}
                  onPress={() => router.push('/nfa-trust/new')}>
                  <Text style={[s.chipText, s.chipNewText]}>＋ New Trust</Text>
                </TouchableOpacity>
              </View>
              {pickedTrust ? (
                <View style={s.card}>
                  <View style={s.fieldRow}>
                    <Text style={s.fieldLabel}>Type</Text>
                    <Text style={s.fieldReadonly}>{pickedTrust.trust_type}</Text>
                  </View>
                  {pickedTrust.responsible_persons ? (
                    <View style={[s.fieldRow, { borderTopWidth: 1, borderTopColor: BORDER }]}>
                      <Text style={s.fieldLabel}>RPs</Text>
                      <Text style={s.fieldReadonly} numberOfLines={2}>{pickedTrust.responsible_persons}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (trustType || trustName || responsiblePersons) ? (
                /* Legacy free-text fallback for firearms that were edited before
                   the trust picker existed. Lets the user view/clean up old data. */
                <View style={s.card}>
                  <Field label="Trust Name" value={trustName} onChange={setTrustName} placeholder="Name of trust or entity" />
                  <Field label="Resp. Persons" value={responsiblePersons} onChange={setResponsiblePersons} placeholder="Names (comma separated)" last />
                </View>
              ) : null}
            </>
          )}

          <Text style={s.sectionLabel}>NOTES</Text>
          <View style={s.card}>
            <TextInput style={s.notesInput} value={notes} onChangeText={setNotes}
              placeholder="Provenance, purchase story, known quirks..." placeholderTextColor={MUTED}
              multiline numberOfLines={4} textAlignVertical="top" />
          </View>
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
    <View style={[s.fieldRow, !last && s.fieldBorder]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldRight}>
        {prefix ? <Text style={s.prefix}>{prefix}</Text> : null}
        <TextInput style={s.fieldInput} value={value} onChangeText={onChange}
          placeholder={placeholder} placeholderTextColor={MUTED}
          keyboardType={keyboardType} autoCorrect={false} autoCapitalize={autoCapitalize} />
      </View>
    </View>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: '#333333' },
  chipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText: { color: '#888888', fontSize: 14 },
  chipTextActive: { color: GOLD, fontWeight: '600' },
  notesInput: { color: '#FFFFFF', fontSize: 15, padding: 16, minHeight: 100 },
  nfaToggle: { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 16, marginBottom: 16, marginTop: 8 },
  nfaToggleActive: { backgroundColor: '#1A1510', borderColor: GOLD },
  nfaToggleText: { color: '#888888', fontSize: 15, fontWeight: '600' },
  nfaToggleTextActive: { color: GOLD },
  scanBtn: {
    backgroundColor: '#1E1A10', borderRadius: 12, borderWidth: 1, borderColor: GOLD,
    padding: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 16, minHeight: 50,
  },
  scanBtnText: { color: GOLD, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  chipNew: { borderStyle: 'dashed', borderColor: GOLD, backgroundColor: 'transparent' },
  chipNewText: { color: GOLD, fontWeight: '600' },
  fieldReadonly: { flex: 1, color: '#DDDDDD', fontSize: 14, textAlign: 'right' },
  linkBtn: { alignSelf: 'flex-end', marginTop: -12, marginBottom: 20, paddingVertical: 4, paddingHorizontal: 8 },
  linkBtnText: { color: GOLD, fontSize: 13, fontWeight: '600' },
  stampRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  stampImage: { width: 80, height: 80, borderRadius: 10, backgroundColor: SURFACE },
  stampPlaceholder: {
    width: 80, height: 80, borderRadius: 10, backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  stampPlaceholderText: { fontSize: 32 },
  stampBtn: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: '#1E1A10', borderWidth: 1, borderColor: GOLD, alignItems: 'center',
  },
  stampBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  stampRemoveText: { color: '#FF5722', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
