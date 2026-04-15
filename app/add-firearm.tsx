import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
  Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { addFirearm, resolveImageUri, getAllFirearms, getAllSuppressors, getAllNfaTrusts, getNfaTrustById, setFirearmAtfForm } from '../lib/database';
import { saveScanToAtfForms } from '../lib/atfScans';
import { syncWidgets } from '../lib/widgetSync';
import type { NfaTrust } from '../lib/database';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { useEntitlements } from '../lib/useEntitlements';
import { showPaywall, runProGated } from '../lib/paywall';
import { scanAtfForm } from '../lib/atfOcr';
import type { AtfExtracted } from '../lib/atfOcr';
import { scanReceipt } from '../lib/receiptOcr';
import type { ReceiptExtracted } from '../lib/receiptOcr';
import { scan4473Form } from '../lib/form4473Ocr';
import type { Form4473Extracted } from '../lib/form4473Ocr';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

// Platform shape only. NFA classifications (Suppressor, SBR, SBS, AOW, MG,
// Destructive Device) live in the NFA ITEM CATEGORY section to avoid the
// earlier redundancy.
const TYPES = ['Handgun', 'Rifle', 'Shotgun', 'PDW', 'PCC', 'Other'];
const ACTION_TYPES = ['Semi-Auto', 'Bolt', 'Pump', 'Lever', 'Revolver', 'Break'];
const TRIGGER_TYPES = ['Standard', 'Binary', 'Forced Reset Trigger', 'Bump-Stock'];
const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor'];
const ACQUISITION_METHODS = ['Purchase', 'Gift', 'Transfer', 'Inheritance'];
const NFA_FORM_TYPES = ['Form 1 (Self-Manufactured)', 'Form 4 (Transfer/Purchase)', 'Form 3 (SOT/Dealer)'];
const NFA_CATEGORIES = ['Suppressor', 'SBR', 'SBS', 'MG', 'AOW', 'Destructive Device'];
const ATF_STATUSES = ['Not Yet Filed', 'Pending (eFiled)', 'Pending (Paper)', 'Approved', 'Denied'];
const TRUST_TYPES = ['Individual', 'NFA Trust', 'Corporation', 'Government Entity'];

/** Auto-format date input as MM/DD/YYYY */
function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  // If user is deleting, just return cleaned text
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

/** Saves to documentDirectory and returns a RELATIVE path for storage. */
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

export default function AddFirearm() {
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
  // Picked trust. When non-null, the free-text trust fields are hidden and
  // derived from this object on save.
  const [trustId, setTrustId] = useState<number | null>(null);
  const [trusts, setTrusts] = useState<NfaTrust[]>([]);
  const [ocrRunning, setOcrRunning] = useState(false);
  // Holds the raw URI of the most recent ATF scan the user accepted. We
  // wait until the firearm row is inserted (so we have an ID) before
  // copying it into atf_forms/ and writing the slot reference.
  const [pendingAtfScanUri, setPendingAtfScanUri] = useState<string | null>(null);
  const [receiptOcrRunning, setReceiptOcrRunning] = useState(false);
  const [form4473OcrRunning, setForm4473OcrRunning] = useState(false);

  // Reload trusts whenever this screen regains focus — so a trust created
  // in the nested /nfa-trust/new modal immediately shows up in the picker.
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

  async function pickImage() {
    Alert.alert('Add Photo', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Camera access is needed to take photos.');
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
            Alert.alert('Permission Required', 'Photo library access is needed to select photos.');
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
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  /** Launch OCR scan — Pro feature. */
  function handleAtfScan() {
    if (!runProGated('atf_ocr', () => runAtfScan())) {
      // runProGated already showed the paywall; nothing else to do.
    }
  }

  async function runAtfScan(onAfter?: () => void) {
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
    if (!result || result.canceled) { onAfter?.(); return; }

    setOcrRunning(true);
    try {
      const scanUri = result.assets[0].uri;
      const extracted = await scanAtfForm(scanUri);
      applyAtfExtraction(extracted, onAfter, scanUri);
    } catch (e) {
      Alert.alert('Scan failed', 'Could not read the form. Try a clearer photo.', [
        { text: 'OK', onPress: () => onAfter?.() },
      ]);
    } finally {
      setOcrRunning(false);
    }
  }

  function applyAtfExtraction(x: AtfExtracted, onAfter?: () => void, scanUri?: string) {
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
        { text: 'Cancel', style: 'cancel', onPress: () => onAfter?.() },
        {
          text: 'Apply', onPress: () => {
            setIsNfa(true);
            // Add flow: only fill empty fields so a noisy scan can't
            // clobber values the user already typed.
            if (x.make && !make) setMake(x.make);
            if (x.model && !model) setModel(x.model);
            if (x.caliber && !caliber) setCaliber(x.caliber);
            if (x.serialNumber && !serialNumber) setSerialNumber(x.serialNumber);
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
            // Stash the scanned image so persistFirearm can auto-attach
            // it to the new row's ATF Form On File slot.
            if (scanUri) setPendingAtfScanUri(scanUri);
            onAfter?.();
          },
        },
      ],
    );
  }

  /** Launch receipt scan — Pro feature, same gate as ATF scan. */
  function handleReceiptScan() {
    runProGated('atf_ocr', () => runReceiptScan());
  }

  async function runReceiptScan(onAfter?: () => void) {
    const result = await new Promise<ImagePicker.ImagePickerResult | null>((resolve) => {
      Alert.alert('Scan Receipt', 'Choose a source', [
        {
          text: 'Camera',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission Required', 'Camera access is needed to scan receipts.');
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
    if (!result || result.canceled) { onAfter?.(); return; }

    setReceiptOcrRunning(true);
    try {
      const extracted = await scanReceipt(result.assets[0].uri);
      applyReceiptExtraction(extracted, onAfter);
    } catch (e) {
      Alert.alert('Scan failed', 'Could not read the receipt. Try a clearer photo.', [
        { text: 'OK', onPress: () => onAfter?.() },
      ]);
    } finally {
      setReceiptOcrRunning(false);
    }
  }

  function applyReceiptExtraction(x: ReceiptExtracted, onAfter?: () => void) {
    // Receipts now surface both purchase fields AND identification fields
    // (make/model/serial/caliber/type) when the FFL itemised the firearm.
    // Group the summary by section so the user can see at a glance what
    // the scanner picked up.
    const idLines = [
      x.make ? `Make: ${x.make}` : null,
      x.model ? `Model: ${x.model}` : null,
      x.serialNumber ? `Serial: ${x.serialNumber}` : null,
      x.caliber ? `Caliber: ${x.caliber}` : null,
      x.type ? `Type: ${x.type}` : null,
    ].filter(Boolean);
    const purchaseLines = [
      x.vendor ? `Vendor: ${x.vendor}` : null,
      x.dealerCityState ? `Location: ${x.dealerCityState}` : null,
      x.purchaseDate ? `Date: ${x.purchaseDate}` : null,
      x.purchasePrice ? `Price: $${x.purchasePrice}` : null,
    ].filter(Boolean);

    const sections: string[] = [];
    if (idLines.length) sections.push('— Firearm —\n' + idLines.join('\n'));
    if (purchaseLines.length) sections.push('— Purchase —\n' + purchaseLines.join('\n'));
    const summary = sections.join('\n\n');

    const sourceNote = x.source === 'stub'
      ? '\n\n(Sample data — OCR could not read this image. Try a clearer, straight-on photo in good light.)'
      : '';

    // When live OCR ran, always offer a debug button so the user can copy
    // the raw text back for heuristic tuning when anything looks off.
    const canDebug = x.source === 'mlkit' && !!x.rawText;

    const showRawText = () => {
      Alert.alert(
        'Raw OCR text',
        (x.rawText ?? '(empty)').slice(0, 2000),
        [
          {
            text: 'Copy',
            onPress: () => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const RN = require('react-native');
                const Clipboard = RN.Clipboard;
                if (Clipboard?.setString) Clipboard.setString(x.rawText ?? '');
              } catch {}
              applyReceiptExtraction(x, onAfter);
            },
          },
          { text: 'Back', onPress: () => applyReceiptExtraction(x, onAfter) },
        ],
      );
    };

    const buttons: any[] = [
      { text: 'Cancel', style: 'cancel', onPress: () => onAfter?.() },
    ];
    if (canDebug) buttons.push({ text: 'Show raw text', onPress: showRawText });
    buttons.push({
      text: 'Apply', onPress: () => {
            // Identification fields — only fill if the user hasn't already
            // typed something. Protects against a noisy receipt overwriting
            // good data the user entered by hand.
            if (x.make && !make) setMake(x.make);
            if (x.model && !model) setModel(x.model);
            if (x.serialNumber && !serialNumber) setSerialNumber(x.serialNumber);
            if (x.caliber && !caliber) setCaliber(x.caliber);
            if (x.type) {
              setSelectedTypes(prev => prev.includes(x.type!) ? prev : [...prev, x.type!]);
            }
            // Purchase fields — same "only fill if empty" guard.
            if (x.vendor && !purchasedFrom) setPurchasedFrom(x.vendor);
            if (x.dealerCityState && !dealerCityState) setDealerCityState(x.dealerCityState);
            if (x.purchaseDate && !purchaseDate) setPurchaseDate(x.purchaseDate);
            if (x.purchasePrice && !purchasePrice) setPurchasePrice(x.purchasePrice);
            // Buying from a dealer on a receipt implies Purchase acquisition.
            if (!acquisitionMethod) setAcquisitionMethod('Purchase');
            onAfter?.();
          },
    });

    Alert.alert(
      'Apply scanned values?',
      (summary || 'No fields detected.') + sourceNote,
      buttons,
    );
  }

  /** Launch 4473 scan — Pro feature, same gate as ATF scan. */
  function handleForm4473Scan() {
    runProGated('atf_ocr', () => runForm4473Scan());
  }

  async function runForm4473Scan(onAfter?: () => void) {
    const result = await new Promise<ImagePicker.ImagePickerResult | null>((resolve) => {
      Alert.alert('Scan 4473', 'Choose a source', [
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
    if (!result || result.canceled) { onAfter?.(); return; }

    setForm4473OcrRunning(true);
    try {
      const extracted = await scan4473Form(result.assets[0].uri);
      applyForm4473Extraction(extracted, onAfter);
    } catch (e) {
      Alert.alert('Scan failed', 'Could not read the 4473. Try a clearer photo.', [
        { text: 'OK', onPress: () => onAfter?.() },
      ]);
    } finally {
      setForm4473OcrRunning(false);
    }
  }

  function applyForm4473Extraction(x: Form4473Extracted, onAfter?: () => void) {
    const summary = [
      x.make ? `Make: ${x.make}` : null,
      x.model ? `Model: ${x.model}` : null,
      x.serialNumber ? `Serial: ${x.serialNumber}` : null,
      x.type ? `Type: ${x.type}` : null,
      x.caliber ? `Caliber: ${x.caliber}` : null,
    ].filter(Boolean).join('\n');

    const sourceNote = x.source === 'stub'
      ? '\n\n(Sample data — OCR could not read this image. Try a clearer, straight-on photo in good light.)'
      : '';

    Alert.alert(
      'Apply scanned values?',
      (summary || 'No fields detected.') + sourceNote,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => onAfter?.() },
        {
          text: 'Apply', onPress: () => {
            if (x.make) setMake(x.make);
            if (x.model) setModel(x.model);
            if (x.serialNumber) setSerialNumber(x.serialNumber);
            if (x.caliber) setCaliber(x.caliber);
            if (x.type) {
              // Type chips are multi-select; add without duplicates.
              setSelectedTypes(prev => prev.includes(x.type!) ? prev : [...prev, x.type!]);
            }
            onAfter?.();
          },
        },
      ],
    );
  }

  /**
   * Paperwork wizard — receipt-first flow. Most US FFLs use e-4473 now, so
   * the paper 4473 scan has been demoted to a rarely-used escape hatch
   * (still available via the smaller "Paper 4473" button below). The
   * happy path is: scan receipt → optional ATF form (for NFA items) →
   * done. One Pro gate at the entry.
   */
  function handlePaperworkWizard() {
    runProGated('atf_ocr', () => startPaperworkWizard());
  }

  function startPaperworkWizard() {
    Alert.alert(
      'Scan Paperwork',
      "Snap a photo of your purchase receipt and we'll fill in the firearm details and purchase info in one go.\n\n" +
        "If this is an NFA item (suppressor, SBR, SBS, MG, AOW, DD), you can also scan the ATF Form 1/4 afterward.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Scan Receipt', onPress: () => runReceiptScan(() => wizardStepAtf()) },
      ],
    );
  }

  function wizardStepAtf() {
    Alert.alert(
      'NFA paperwork?',
      'Is this an NFA item (suppressor, SBR, SBS, MG, AOW, DD)? ' +
        'If so, scan the ATF form to fill tax stamp details.',
      [
        { text: 'Not NFA', style: 'cancel', onPress: () => wizardFinish() },
        { text: 'Scan ATF Form', onPress: () => runAtfScan(() => wizardFinish()) },
      ],
    );
  }

  function wizardFinish() {
    Alert.alert(
      'All set',
      'Review the filled fields below, add a photo if you like, then tap Save.',
    );
  }

  function handleSave() {
    if (!make.trim() || !model.trim()) {
      Alert.alert('Required Fields', 'Make and Model are required.');
      return;
    }
    // Soft NFA validation — warn if key ATF fields are blank so the user
    // can go back and fill them, but don't block the save.
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
    const newId = addFirearm({
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

    // Auto-attach the accepted ATF scan to the new row's "ATF Form on File"
    // slot so the user doesn't have to rescan to keep a copy on record.
    if (pendingAtfScanUri) {
      saveScanToAtfForms(pendingAtfScanUri)
        .then(stored => setFirearmAtfForm(newId, 'front', stored))
        .catch(e => console.warn('[add-firearm] ATF auto-attach failed', e));
    }

    syncWidgets();

    // Trigger 2 (spec §4.6): soft nudge once the user's combined vault
    // (firearms + suppressors) hits 3 — warms them up before the hard cap.
    // Pro/Founders users are skipped.
    const newTotal = getAllFirearms().length + getAllSuppressors().length;
    if (!ent.isPro && newTotal === 3) {
      router.back();
      // Let the dismiss animation finish before layering the paywall on top.
      setTimeout(() => showPaywall({ mode: 'soft_nudge' }), 250);
      return;
    }

    router.back();
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Add Firearm</Text>
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

          {/* Hero: "Scan Paperwork" — receipt-first flow. Most FFLs run
              e-4473 now so the customer only gets a receipt; that one
              photo fills make/model/serial/caliber/type AND the purchase
              fields. NFA items get an optional ATF Form step after. */}
          <TouchableOpacity
            style={styles.wizardBtn}
            onPress={handlePaperworkWizard}
            disabled={ocrRunning || receiptOcrRunning || form4473OcrRunning}
            activeOpacity={0.85}>
            <Text style={styles.wizardBtnText}>
              ⚡  Scan Receipt{!ent.isPro ? '  ·  PRO' : ''}
            </Text>
            <Text style={styles.wizardBtnSub}>
              Fills firearm details + purchase info from one photo
            </Text>
          </TouchableOpacity>

          {/* Paper 4473 escape hatch — rarely used, since the vast majority
              of FFLs submit 4473s electronically now. Small text-link
              style so it doesn't compete with the receipt scan above. */}
          <TouchableOpacity
            onPress={handleForm4473Scan}
            disabled={form4473OcrRunning}
            activeOpacity={0.6}
            style={styles.paper4473Link}>
            {form4473OcrRunning ? (
              <ActivityIndicator color={GOLD} size="small" />
            ) : (
              <Text style={styles.paper4473LinkText}>
                Have a paper 4473 instead? Scan it →
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>IDENTIFICATION</Text>
          <View style={styles.card}>
            <Field label="Nickname" value={nickname} onChange={setNickname} placeholder="e.g. Home Defense Glock" />
            <Field label="Make" value={make} onChange={setMake} placeholder="e.g. Glock" />
            <Field label="Model" value={model} onChange={setModel} placeholder="e.g. G19 Gen 5" />
            <Field label="Caliber" value={caliber} onChange={setCaliber} placeholder="e.g. 9mm, .45 ACP" />
            <Field label="Serial Number" value={serialNumber} onChange={setSerialNumber} placeholder="Optional" autoCapitalize="characters" last />
          </View>

          <Text style={styles.sectionLabel}>FIREARM TYPE (select all that apply)</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => {
              const active = selectedTypes.includes(t);
              return (
                <TouchableOpacity key={t}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleFirearmType(t)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>ACTION TYPE</Text>
          <View style={styles.chipRow}>
            {ACTION_TYPES.map((a) => (
              <TouchableOpacity key={a}
                style={[styles.chip, actionType === a && styles.chipActive]}
                onPress={() => setActionType(actionType === a ? '' : a)}>
                <Text style={[styles.chipText, actionType === a && styles.chipTextActive]}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>TRIGGER TYPE</Text>
          <View style={styles.chipRow}>
            {TRIGGER_TYPES.map((t) => (
              <TouchableOpacity key={t}
                style={[styles.chip, triggerType === t && styles.chipActive]}
                onPress={() => setTriggerType(triggerType === t ? '' : t)}>
                <Text style={[styles.chipText, triggerType === t && styles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>CONDITION</Text>
          <View style={styles.chipRow}>
            {CONDITIONS.map((c) => (
              <TouchableOpacity key={c}
                style={[styles.chip, selectedCondition === c && styles.chipActive]}
                onPress={() => setSelectedCondition(selectedCondition === c ? '' : c)}>
                <Text style={[styles.chipText, selectedCondition === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>ACQUISITION</Text>
          <View style={styles.chipRow}>
            {ACQUISITION_METHODS.map((m) => (
              <TouchableOpacity key={m}
                style={[styles.chip, acquisitionMethod === m && styles.chipActive]}
                onPress={() => setAcquisitionMethod(acquisitionMethod === m ? '' : m)}>
                <Text style={[styles.chipText, acquisitionMethod === m && styles.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.card}>
            <Field label="Purchase Date" value={purchaseDate} onChange={(v) => setPurchaseDate(autoFormatDate(v, purchaseDate))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
            <Field label="Purchased From" value={purchasedFrom} onChange={setPurchasedFrom} placeholder="Dealer, FFL, private seller" />
            <Field label="Dealer City & State" value={dealerCityState} onChange={setDealerCityState} placeholder="e.g. Houston, TX" last />
          </View>

          {/* Receipt scan auto-fills Purchase Date, Purchased From, Dealer
              City/State, and Purchase Price in one shot. Shares the same
              Pro gate as ATF scan since both are OCR features. */}
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={handleReceiptScan}
            disabled={receiptOcrRunning}
            activeOpacity={0.8}>
            {receiptOcrRunning ? (
              <ActivityIndicator color={GOLD} />
            ) : (
              <Text style={styles.scanBtnText}>
                📸  Scan Receipt{!ent.isPro ? '  ·  PRO' : ''}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>FINANCIAL</Text>
          <View style={styles.card}>
            <Field label="Purchase Price" value={purchasePrice} onChange={setPurchasePrice} placeholder="0.00" keyboardType="decimal-pad" prefix="$" />
            <Field label="Current Value" value={currentValue} onChange={setCurrentValue} placeholder="0.00" keyboardType="decimal-pad" prefix="$" last />
          </View>
          {purchasePrice && !currentValue ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => setCurrentValue(purchasePrice)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.linkBtnText}>Use purchase price as current value</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.sectionLabel}>STORAGE & TRACKING</Text>
          <View style={styles.card}>
            <Field label="Storage Location" value={storageLocation} onChange={setStorageLocation} placeholder="e.g. Safe 1, Bedroom" />
            <Field label="Round Count" value={roundCount} onChange={setRoundCount} placeholder="Lifetime rounds fired" keyboardType="number-pad" last />
          </View>

          {/* ── NFA SECTION ── */}
          {/* Scan shortcut sits ABOVE the toggle so a successful scan can
              flip NFA on for the user. Pro-gated. */}
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={handleAtfScan}
            disabled={ocrRunning}
            activeOpacity={0.8}>
            {ocrRunning ? (
              <ActivityIndicator color={GOLD} />
            ) : (
              <Text style={styles.scanBtnText}>
                📷  Scan ATF Form{!ent.isPro ? '  ·  PRO' : ''}
              </Text>
            )}
          </TouchableOpacity>

          {/* Flipping on NFA is Pro-gated. Turning it off stays free. */}
          <TouchableOpacity
            style={[styles.nfaToggle, isNfa && styles.nfaToggleActive]}
            onPress={() => {
              if (isNfa) {
                setIsNfa(false);
                return;
              }
              runProGated('nfa_tracking', () => setIsNfa(true));
            }}>
            <Text style={[styles.nfaToggleText, isNfa && styles.nfaToggleTextActive]}>
              {isNfa ? '✓  NFA / Tax Stamp Item' : '○  NFA / Tax Stamp Item'}
              {!isNfa && !ent.isPro && '  ·  PRO'}
            </Text>
          </TouchableOpacity>

          {isNfa && (
            <>
              <Text style={styles.sectionLabel}>NFA FORM TYPE</Text>
              <View style={styles.chipRow}>
                {NFA_FORM_TYPES.map((f) => (
                  <TouchableOpacity key={f}
                    style={[styles.chip, nfaFormType === f && styles.chipActive]}
                    onPress={() => setNfaFormType(nfaFormType === f ? '' : f)}>
                    <Text style={[styles.chipText, nfaFormType === f && styles.chipTextActive]}>{f}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionLabel}>NFA ITEM CATEGORY (select all that apply)</Text>
              <View style={styles.chipRow}>
                {NFA_CATEGORIES.map((c) => {
                  const active = nfaCategories.includes(c);
                  return (
                    <TouchableOpacity key={c}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setNfaCategories(active ? nfaCategories.filter(x => x !== c) : [...nfaCategories, c])}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>ATF STATUS</Text>
              <View style={styles.chipRow}>
                {ATF_STATUSES.map((s) => (
                  <TouchableOpacity key={s}
                    style={[styles.chip, atfStatus === s && styles.chipActive]}
                    onPress={() => setAtfStatus(atfStatus === s ? '' : s)}>
                    <Text style={[styles.chipText, atfStatus === s && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.card}>
                <Field label="ATF Control #" value={atfControlNumber} onChange={setAtfControlNumber} placeholder="eForms or paper tracking" />
                <Field label="Date Filed" value={dateFiled} onChange={(v) => setDateFiled(autoFormatDate(v, dateFiled))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                <Field label="Date Approved" value={dateApproved} onChange={(v) => setDateApproved(autoFormatDate(v, dateApproved))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                <Field label="Tax Paid" value={taxPaid} onChange={setTaxPaid} placeholder="200.00" keyboardType="decimal-pad" prefix="$" last />
              </View>

              <Text style={styles.sectionLabel}>TRUST / OWNERSHIP</Text>
              {/* Picker backed by nfa_trusts. "None" clears the link and falls
                  back to a personal/individual item. "+ New Trust" opens the
                  trust editor modal — on return, useFocusEffect reloads the
                  list so it shows up here. */}
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, trustId === null && styles.chipActive]}
                  onPress={() => { setTrustId(null); setTrustType(''); }}>
                  <Text style={[styles.chipText, trustId === null && styles.chipTextActive]}>None</Text>
                </TouchableOpacity>
                {trusts.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.chip, trustId === t.id && styles.chipActive]}
                    onPress={() => {
                      if (trustId === t.id) {
                        setTrustId(null);
                      } else {
                        setTrustId(t.id);
                        setTrustType(t.trust_type);
                      }
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
                    <View style={[styles.fieldRow, styles.fieldBorder, { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: BORDER }]}>
                      <Text style={styles.fieldLabel}>RPs</Text>
                      <Text style={styles.fieldReadonly} numberOfLines={2}>{pickedTrust.responsible_persons}</Text>
                    </View>
                  ) : null}
                </View>
              )}
            </>
          )}

          <Text style={styles.sectionLabel}>NOTES</Text>
          <View style={styles.card}>
            <TextInput style={styles.notesInput} value={notes} onChangeText={setNotes}
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
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
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
  paper4473Link: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12,
  },
  paper4473LinkText: {
    color: '#888888', fontSize: 13, fontWeight: '500',
    textDecorationLine: 'underline', textDecorationColor: '#444444',
  },
  wizardBtn: {
    backgroundColor: GOLD, borderRadius: 12, borderWidth: 1, borderColor: GOLD,
    paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, minHeight: 60,
  },
  wizardBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  wizardBtnSub: { color: '#2A2010', fontSize: 11, fontWeight: '600', marginTop: 2 },
  chipNew: { borderStyle: 'dashed', borderColor: GOLD, backgroundColor: 'transparent' },
  chipNewText: { color: GOLD, fontWeight: '600' },
  fieldReadonly: { flex: 1, color: '#DDDDDD', fontSize: 14, textAlign: 'right' },
  linkBtn: { alignSelf: 'flex-end', marginTop: -12, marginBottom: 20, paddingVertical: 4, paddingHorizontal: 8 },
  linkBtnText: { color: GOLD, fontSize: 13, fontWeight: '600' },
});