import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getAccessoryById, updateAccessory, deleteAccessory, ACCESSORY_TYPES, resolveImageUri,
  getActiveBatteryLogForAccessory, deleteBatteryLog,
} from '../lib/database';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { syncAccessoryBatteryLog } from '../lib/accessoryBatterySync';
import { cancelBatteryReminder } from '../lib/batteryNotifications';
import { syncWidgets } from '../lib/widgetSync';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

const POWER_TYPES = ['disposable', 'rechargeable_internal', 'rechargeable_swappable', 'dual_solar'] as const;
const POWER_LABELS: Record<string, string> = {
  disposable: 'Disposable Battery', rechargeable_internal: 'Rechargeable (Internal)',
  rechargeable_swappable: 'Rechargeable (Swappable)', dual_solar: 'Dual Solar + Battery',
};
const BATTERY_SIZES = ['CR2032', 'CR123A', 'AA', 'AAA', 'CR2354', 'N-cell', 'Other'];
const CELL_TYPES = ['18650', '21700', '16340', '26650', 'Other'];
const CONNECTOR_TYPES = ['USB-C', 'Micro-USB', 'Lightning', 'Proprietary'];
const LASER_COLORS = ['Red', 'Green', 'IR'];
const IR_TYPES = ['Illuminator', 'Laser', 'Combo'];
const NFA_FORM_TYPES = ['Form 1', 'Form 4', 'Form 3'];
const ATF_STATUSES = ['Not Yet Filed', 'Pending (eFiled)', 'Pending (Paper)', 'Approved', 'Denied'];
const TRIGGER_SUBTYPES = ['Standard', 'Binary', 'Forced Reset Trigger', 'Bump-Stock', 'Match', 'Competition', 'Drop-In', 'Other'];
const SUPPRESSOR_MOUNTS: { key: 'direct_thread' | 'qd' | 'hybrid'; label: string }[] = [
  { key: 'direct_thread', label: 'Direct Thread' },
  { key: 'qd', label: 'QD' },
  { key: 'hybrid', label: 'Hybrid' },
];
const STOCK_SUBTYPES: { key: 'fixed' | 'folding' | 'collapsible' | 'adjustable'; label: string }[] = [
  { key: 'fixed', label: 'Fixed' },
  { key: 'folding', label: 'Folding' },
  { key: 'collapsible', label: 'Collapsible' },
  { key: 'adjustable', label: 'Adjustable' },
];
const TRIGGER_SHAPES: { key: 'flat' | 'curved'; label: string }[] = [
  { key: 'flat', label: 'Flat' },
  { key: 'curved', label: 'Curved' },
];
const TRIGGER_STAGES: { key: 'single' | 'two_stage'; label: string }[] = [
  { key: 'single', label: 'Single Stage' },
  { key: 'two_stage', label: 'Two Stage' },
];
const SLING_POINTS: { key: '1_point' | '2_point' | '3_point' | 'convertible'; label: string }[] = [
  { key: '1_point', label: '1-Point' },
  { key: '2_point', label: '2-Point' },
  { key: '3_point', label: '3-Point' },
  { key: 'convertible', label: 'Convertible' },
];

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

async function saveImagePermanently(uri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'accessories');
  if (!dir.exists) dir.create();
  const ext = uri.split('.').pop() ?? 'jpg';
  const filename = `acc_${Date.now()}.${ext}`;
  const source = new File(uri);
  const dest = new File(dir, filename);
  source.copy(dest);
  return 'accessories/' + filename;
}

function Field({ label, value, onChange, placeholder, keyboardType, last, multiline }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; last?: boolean; multiline?: boolean;
}) {
  return (
    <View style={[st.fieldWrap, !last && st.fieldBorder]}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TextInput
        style={[st.fieldInput, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={MUTED}
        keyboardType={keyboardType} multiline={multiline}
      />
    </View>
  );
}

export default function EditAccessory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [selectedType, setSelectedType] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);

  const [powerType, setPowerType] = useState('');
  const [batteryType, setBatteryType] = useState('');
  const [batteryQty, setBatteryQty] = useState('1');
  const [dateBatteryReplaced, setDateBatteryReplaced] = useState('');
  const [replacementDays, setReplacementDays] = useState('');
  const [chargeConnector, setChargeConnector] = useState('');
  const [dateLastCharged, setDateLastCharged] = useState('');
  const [cellType, setCellType] = useState('');

  const [mount, setMount] = useState('');
  const [brightness, setBrightness] = useState('');
  const [zeroDistance, setZeroDistance] = useState('');
  const [lumens, setLumens] = useState('');
  const [mountPosition, setMountPosition] = useState('');
  const [laserColor, setLaserColor] = useState('');
  const [laserMount, setLaserMount] = useState('');
  const [irType, setIrType] = useState('');

  const [suppCaliber, setSuppCaliber] = useState('');
  const [nfaFormType, setNfaFormType] = useState('');
  const [atfStatus, setAtfStatus] = useState('');
  const [atfControlNumber, setAtfControlNumber] = useState('');
  const [dateFiled, setDateFiled] = useState('');
  const [dateApproved, setDateApproved] = useState('');
  const [taxPaid, setTaxPaid] = useState('');
  const [suppLength, setSuppLength] = useState('');
  const [suppWeight, setSuppWeight] = useState('');
  const [suppThreadPitch, setSuppThreadPitch] = useState('');
  const [suppMountType, setSuppMountType] = useState<'' | 'direct_thread' | 'qd' | 'hybrid'>('');
  const [suppFullAuto, setSuppFullAuto] = useState(false);

  const [adjustable, setAdjustable] = useState(false);
  const [lengthOfPull, setLengthOfPull] = useState('');
  const [stockSubtype, setStockSubtype] = useState<'' | 'fixed' | 'folding' | 'collapsible' | 'adjustable'>('');
  const [bufferTubeType, setBufferTubeType] = useState('');
  const [stockMaterial, setStockMaterial] = useState('');

  const [texture, setTexture] = useState('');
  const [gripColor, setGripColor] = useState('');
  const [gripAngle, setGripAngle] = useState('');
  const [hasBeavertail, setHasBeavertail] = useState(false);
  const [hasFingerGrooves, setHasFingerGrooves] = useState(false);

  const [pullWeight, setPullWeight] = useState('');
  const [shoeMaterial, setShoeMaterial] = useState('');
  const [triggerSubtype, setTriggerSubtype] = useState('');
  const [triggerShape, setTriggerShape] = useState<'' | 'flat' | 'curved'>('');
  const [triggerStages, setTriggerStages] = useState<'' | 'single' | 'two_stage'>('');
  const [resetLength, setResetLength] = useState('');

  const [magCapacity, setMagCapacity] = useState('');
  const [magMaterial, setMagMaterial] = useState('');
  const [magCount, setMagCount] = useState('');
  const [magVariant, setMagVariant] = useState('');
  const [magAntiTilt, setMagAntiTilt] = useState(false);
  const [magFitsModels, setMagFitsModels] = useState('');

  const [attachmentType, setAttachmentType] = useState('');
  const [slingPoints, setSlingPoints] = useState<'' | '1_point' | '2_point' | '3_point' | 'convertible'>('');
  const [slingMaterial, setSlingMaterial] = useState('');
  const [slingQd, setSlingQd] = useState(false);

  const hasBattery = ['Red Dot / Optic', 'Weapon Light', 'Laser Sight', 'IR Device'].includes(selectedType);

  useEffect(() => {
    if (!id) return;
    const a = getAccessoryById(Number(id));
    if (!a) return;
    setSelectedType(a.accessory_type || '');
    setMake(a.make || '');
    setModel(a.model || '');
    setSerialNumber(a.serial_number || '');
    setNotes(a.notes || '');
    setImageUri(a.image_uri || null);

    if (a.details) {
      try {
        const d = JSON.parse(a.details);
        // Battery fields
        if (d.power_type) setPowerType(d.power_type);
        if (d.battery_type) setBatteryType(d.battery_type);
        if (d.battery_qty) setBatteryQty(String(d.battery_qty));
        if (d.date_battery_replaced) setDateBatteryReplaced(d.date_battery_replaced);
        if (d.replacement_interval_days) setReplacementDays(String(d.replacement_interval_days));
        if (d.charge_connector) setChargeConnector(d.charge_connector);
        if (d.date_last_charged) setDateLastCharged(d.date_last_charged);
        if (d.cell_type) setCellType(d.cell_type);
        // Optic
        if (d.mount) setMount(d.mount);
        if (d.brightness_settings) setBrightness(d.brightness_settings);
        if (d.zero_distance) setZeroDistance(d.zero_distance);
        // Light
        if (d.lumens) setLumens(d.lumens);
        if (d.mount_position) setMountPosition(d.mount_position);
        // Laser
        if (d.color) setLaserColor(d.color);
        if (d.mount && a.accessory_type === 'Laser Sight') setLaserMount(d.mount);
        // IR
        if (d.ir_type) setIrType(d.ir_type);
        // Suppressor
        if (d.caliber) setSuppCaliber(d.caliber);
        if (d.nfa_form_type) setNfaFormType(d.nfa_form_type);
        if (d.atf_status) setAtfStatus(d.atf_status);
        if (d.atf_control_number) setAtfControlNumber(d.atf_control_number);
        if (d.date_filed) setDateFiled(d.date_filed);
        if (d.date_approved) setDateApproved(d.date_approved);
        if (d.tax_paid) setTaxPaid(String(d.tax_paid));
        if (d.length_inches) setSuppLength(d.length_inches);
        if (d.weight_oz) setSuppWeight(d.weight_oz);
        if (d.thread_pitch) setSuppThreadPitch(d.thread_pitch);
        if (d.mount_type) setSuppMountType(d.mount_type);
        if (d.full_auto_rated !== undefined) setSuppFullAuto(!!d.full_auto_rated);
        // Stock
        if (d.adjustable !== undefined) setAdjustable(d.adjustable);
        if (d.length_of_pull) setLengthOfPull(d.length_of_pull);
        if (d.subtype && a.accessory_type === 'Stock / Brace') setStockSubtype(d.subtype);
        if (d.buffer_tube_type) setBufferTubeType(d.buffer_tube_type);
        if (d.material && a.accessory_type === 'Stock / Brace') setStockMaterial(d.material);
        // Grip
        if (d.texture) setTexture(d.texture);
        if (d.color && a.accessory_type === 'Grip / Grip Module') setGripColor(d.color);
        if (d.angle_deg) setGripAngle(d.angle_deg);
        if (d.has_beavertail !== undefined) setHasBeavertail(!!d.has_beavertail);
        if (d.finger_grooves !== undefined) setHasFingerGrooves(!!d.finger_grooves);
        // Trigger
        if (d.pull_weight) setPullWeight(d.pull_weight);
        if (d.shoe_material) setShoeMaterial(d.shoe_material);
        if (d.trigger_type) setTriggerSubtype(d.trigger_type);
        if (d.shape && a.accessory_type === 'Trigger') setTriggerShape(d.shape);
        if (d.stages) setTriggerStages(d.stages);
        if (d.reset_length) setResetLength(d.reset_length);
        // Magazine
        if (d.capacity) setMagCapacity(String(d.capacity));
        if (d.material && a.accessory_type === 'Magazine') setMagMaterial(d.material);
        if (d.count_owned) setMagCount(String(d.count_owned));
        if (d.manufacturer_variant) setMagVariant(d.manufacturer_variant);
        if (d.anti_tilt_follower !== undefined) setMagAntiTilt(!!d.anti_tilt_follower);
        if (d.fits_models) setMagFitsModels(d.fits_models);
        // Sling
        if (d.attachment_type) setAttachmentType(d.attachment_type);
        if (d.points) setSlingPoints(d.points);
        if (d.material && a.accessory_type === 'Sling') setSlingMaterial(d.material);
        if (d.qd_hardware !== undefined) setSlingQd(!!d.qd_hardware);
      } catch (_) {}
    }
  }, [id]);

  async function pickImage() {
    Alert.alert('Photo', 'Choose an option', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission Required', 'Camera access is needed.'); return; }
          try {
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 3], quality: 0.8 });
            if (!result.canceled) { const saved = await saveImagePermanently(result.assets[0].uri); setImageUri(saved); }
          } catch (e: any) { Alert.alert('Error', e.message); }
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          try {
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 3], quality: 0.8 });
            if (!result.canceled) { const saved = await saveImagePermanently(result.assets[0].uri); setImageUri(saved); }
          } catch (e: any) { Alert.alert('Error', e.message); }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function buildDetails(): string | null {
    let d: any = {};
    if (selectedType === 'Red Dot / Optic') {
      d = { mount, brightness_settings: brightness, zero_distance: zeroDistance };
    } else if (selectedType === 'Weapon Light') {
      d = { lumens, mount_position: mountPosition };
    } else if (selectedType === 'Laser Sight') {
      d = { color: laserColor, mount: laserMount };
    } else if (selectedType === 'IR Device') {
      d = { ir_type: irType };
    } else if (selectedType === 'Suppressor') {
      d = {
        caliber: suppCaliber, nfa_form_type: nfaFormType, atf_status: atfStatus,
        atf_control_number: atfControlNumber, date_filed: dateFiled, date_approved: dateApproved,
        tax_paid: taxPaid ? parseFloat(taxPaid) : undefined,
        length_inches: suppLength, weight_oz: suppWeight, thread_pitch: suppThreadPitch,
        mount_type: suppMountType || undefined,
        full_auto_rated: suppFullAuto || undefined,
      };
    } else if (selectedType === 'Stock / Brace') {
      d = {
        adjustable, length_of_pull: lengthOfPull,
        subtype: stockSubtype || undefined,
        buffer_tube_type: bufferTubeType, material: stockMaterial,
      };
    } else if (selectedType === 'Grip / Grip Module') {
      d = {
        texture, color: gripColor,
        angle_deg: gripAngle,
        has_beavertail: hasBeavertail || undefined,
        finger_grooves: hasFingerGrooves || undefined,
      };
    } else if (selectedType === 'Trigger') {
      d = {
        pull_weight: pullWeight, shoe_material: shoeMaterial, trigger_type: triggerSubtype,
        shape: triggerShape || undefined,
        stages: triggerStages || undefined,
        reset_length: resetLength,
      };
    } else if (selectedType === 'Magazine') {
      d = {
        capacity: magCapacity ? parseInt(magCapacity) : undefined, material: magMaterial,
        count_owned: magCount ? parseInt(magCount) : undefined,
        manufacturer_variant: magVariant,
        anti_tilt_follower: magAntiTilt || undefined,
        fits_models: magFitsModels,
      };
    } else if (selectedType === 'Sling') {
      d = {
        attachment_type: attachmentType,
        points: slingPoints || undefined,
        material: slingMaterial,
        qd_hardware: slingQd || undefined,
      };
    }
    if (hasBattery && powerType) {
      d.power_type = powerType;
      if (powerType === 'disposable' || powerType === 'dual_solar') {
        d.battery_type = batteryType; d.battery_qty = batteryQty ? parseInt(batteryQty) : 1;
        d.date_battery_replaced = dateBatteryReplaced; d.replacement_interval_days = replacementDays ? parseInt(replacementDays) : undefined;
      }
      if (powerType === 'rechargeable_internal') {
        d.charge_connector = chargeConnector; d.date_last_charged = dateLastCharged;
        d.replacement_interval_days = replacementDays ? parseInt(replacementDays) : undefined;
      }
      if (powerType === 'rechargeable_swappable') {
        d.cell_type = cellType; d.battery_qty = batteryQty ? parseInt(batteryQty) : 1;
        d.date_battery_replaced = dateBatteryReplaced; d.replacement_interval_days = replacementDays ? parseInt(replacementDays) : undefined;
      }
    }
    const clean: any = {};
    for (const [k, v] of Object.entries(d)) { if (v !== '' && v !== undefined && v !== null) clean[k] = v; }
    return Object.keys(clean).length ? JSON.stringify(clean) : null;
  }

  async function handleSave() {
    if (!selectedType) { Alert.alert('Required', 'Select an accessory type.'); return; }
    const accessoryId = Number(id);
    const detailsJson = buildDetails();
    updateAccessory(accessoryId, {
      accessory_type: selectedType,
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      serial_number: serialNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      image_uri: imageUri || undefined,
      details: detailsJson,
    });

    // Keep the linked battery_log in sync. Needs the accessory's firearm id
    // (not on the form), so look it up after the update.
    try {
      const saved = getAccessoryById(accessoryId);
      if (saved) {
        const parsed = detailsJson ? JSON.parse(detailsJson) : null;
        await syncAccessoryBatteryLog({
          accessoryId,
          firearmId: saved.firearm_id,
          accessoryType: selectedType,
          accessoryMake: make.trim() || null,
          accessoryModel: model.trim() || null,
          parsedDetails: parsed,
        });
      }
    } catch (e) {
      console.warn('[edit-accessory] syncAccessoryBatteryLog failed', e);
    }

    syncWidgets();
    router.back();
  }

  function handleDelete() {
    Alert.alert('Delete Accessory', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // Clean up any linked battery log + its scheduled reminder before
          // dropping the accessory. Without this the log survives with a
          // NULL accessory_id (ON DELETE SET NULL) and would still fire.
          try {
            const existingLog = getActiveBatteryLogForAccessory(Number(id));
            if (existingLog) {
              await cancelBatteryReminder(existingLog.notification_id);
              deleteBatteryLog(existingLog.id);
            }
          } catch (e) {
            console.warn('[edit-accessory] battery cleanup failed', e);
          }
          deleteAccessory(Number(id));
          syncWidgets();
          router.back();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={st.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={st.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={st.title}>Edit Accessory</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={st.save}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={st.imagePicker} onPress={pickImage}>
            {imageUri ? (
              <Image source={{ uri: resolveImageUri(imageUri)! }} style={st.imagePreview} />
            ) : (
              <Text style={st.imageText}>＋ Add Photo</Text>
            )}
          </TouchableOpacity>

          <Text style={st.sectionLabel}>ACCESSORY TYPE</Text>
          <View style={st.chipRow}>
            {ACCESSORY_TYPES.map((t) => (
              <TouchableOpacity key={t}
                style={[st.chip, selectedType === t && st.chipActive]}
                onPress={() => setSelectedType(selectedType === t ? '' : t)}>
                <Text style={[st.chipText, selectedType === t && st.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {selectedType ? (
            <>
              <View style={st.card}>
                <Field label="Make" value={make} onChange={setMake} placeholder="e.g. Trijicon, SureFire" />
                <Field label="Model" value={model} onChange={setModel} placeholder="e.g. RMR Type 2" />
                {selectedType === 'Suppressor' || selectedType === 'Other' ? (
                  <Field label="Serial Number" value={serialNumber} onChange={setSerialNumber} placeholder="If applicable" last />
                ) : <View />}
              </View>

              {selectedType === 'Red Dot / Optic' && (
                <>
                  <Text style={st.sectionLabel}>OPTIC DETAILS</Text>
                  <View style={st.card}>
                    <Field label="Mount Type" value={mount} onChange={setMount} placeholder="e.g. Picatinny, RMR cut" />
                    <Field label="Brightness Settings" value={brightness} onChange={setBrightness} placeholder="e.g. 10 levels + NV" />
                    <Field label="Zero Distance" value={zeroDistance} onChange={setZeroDistance} placeholder="e.g. 25 yards" last />
                  </View>
                </>
              )}

              {selectedType === 'Weapon Light' && (
                <>
                  <Text style={st.sectionLabel}>LIGHT DETAILS</Text>
                  <View style={st.card}>
                    <Field label="Lumens" value={lumens} onChange={setLumens} placeholder="e.g. 1000" keyboardType="number-pad" />
                    <Field label="Mount Position" value={mountPosition} onChange={setMountPosition} placeholder="e.g. Rail, M-LOK" last />
                  </View>
                </>
              )}

              {selectedType === 'Laser Sight' && (
                <>
                  <Text style={st.sectionLabel}>LASER DETAILS</Text>
                  <View style={st.chipRow}>
                    {LASER_COLORS.map((c) => (
                      <TouchableOpacity key={c} style={[st.chip, laserColor === c && st.chipActive]}
                        onPress={() => setLaserColor(laserColor === c ? '' : c)}>
                        <Text style={[st.chipText, laserColor === c && st.chipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={st.card}>
                    <Field label="Mount" value={laserMount} onChange={setLaserMount} placeholder="e.g. Rail, trigger guard" last />
                  </View>
                </>
              )}

              {selectedType === 'IR Device' && (
                <>
                  <Text style={st.sectionLabel}>IR DEVICE TYPE</Text>
                  <View style={st.chipRow}>
                    {IR_TYPES.map((t) => (
                      <TouchableOpacity key={t} style={[st.chip, irType === t && st.chipActive]}
                        onPress={() => setIrType(irType === t ? '' : t)}>
                        <Text style={[st.chipText, irType === t && st.chipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {selectedType === 'Suppressor' && (
                <>
                  <Text style={st.sectionLabel}>SUPPRESSOR SPECS</Text>
                  <View style={st.card}>
                    <Field label="Caliber" value={suppCaliber} onChange={setSuppCaliber} placeholder="e.g. 5.56, .30 cal, .45" />
                    <Field label="Length" value={suppLength} onChange={setSuppLength} placeholder="e.g. 7.0 inches" />
                    <Field label="Weight" value={suppWeight} onChange={setSuppWeight} placeholder="e.g. 14.2 oz" />
                    <Field label="Thread Pitch" value={suppThreadPitch} onChange={setSuppThreadPitch} placeholder="e.g. 1/2x28, 5/8x24" />
                    <View style={st.fieldWrap}>
                      <Text style={st.fieldLabel}>Mount Type</Text>
                      <View style={[st.chipRow, { marginTop: 6 }]}>
                        {SUPPRESSOR_MOUNTS.map((m) => (
                          <TouchableOpacity key={m.key} style={[st.chipSm, suppMountType === m.key && st.chipActive]}
                            onPress={() => setSuppMountType(suppMountType === m.key ? '' : m.key)}>
                            <Text style={[st.chipSmText, suppMountType === m.key && st.chipTextActive]}>{m.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity style={[st.toggleRow, { borderBottomWidth: 0 }]} onPress={() => setSuppFullAuto(!suppFullAuto)}>
                      <Text style={st.fieldLabel}>Full-Auto Rated</Text>
                      <View style={[st.toggle, suppFullAuto && st.toggleOn]}>
                        <View style={[st.toggleKnob, suppFullAuto && st.toggleKnobOn]} />
                      </View>
                    </TouchableOpacity>
                  </View>
                  <Text style={st.sectionLabel}>NFA PAPERWORK</Text>
                  <View style={st.card}>
                    <View style={st.fieldWrap}>
                      <Text style={st.fieldLabel}>NFA Form</Text>
                      <View style={[st.chipRow, { marginTop: 6 }]}>
                        {NFA_FORM_TYPES.map((f) => (
                          <TouchableOpacity key={f} style={[st.chipSm, nfaFormType === f && st.chipActive]}
                            onPress={() => setNfaFormType(nfaFormType === f ? '' : f)}>
                            <Text style={[st.chipSmText, nfaFormType === f && st.chipTextActive]}>{f}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={st.fieldWrap}>
                      <Text style={st.fieldLabel}>ATF Status</Text>
                      <View style={[st.chipRow, { marginTop: 6 }]}>
                        {ATF_STATUSES.map((s) => (
                          <TouchableOpacity key={s} style={[st.chipSm, atfStatus === s && st.chipActive]}
                            onPress={() => setAtfStatus(atfStatus === s ? '' : s)}>
                            <Text style={[st.chipSmText, atfStatus === s && st.chipTextActive]}>{s}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <Field label="ATF Control #" value={atfControlNumber} onChange={setAtfControlNumber} />
                    <Field label="Date Filed" value={dateFiled} onChange={(v) => setDateFiled(autoFormatDate(v, dateFiled))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                    <Field label="Date Approved" value={dateApproved} onChange={(v) => setDateApproved(autoFormatDate(v, dateApproved))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                    <Field label="Tax Paid ($)" value={taxPaid} onChange={setTaxPaid} placeholder="e.g. 200" keyboardType="decimal-pad" last />
                  </View>
                </>
              )}

              {selectedType === 'Stock / Brace' && (
                <>
                  <Text style={st.sectionLabel}>STOCK / BRACE TYPE</Text>
                  <View style={st.chipRow}>
                    {STOCK_SUBTYPES.map((m) => (
                      <TouchableOpacity key={m.key} style={[st.chip, stockSubtype === m.key && st.chipActive]}
                        onPress={() => setStockSubtype(stockSubtype === m.key ? '' : m.key)}>
                        <Text style={[st.chipText, stockSubtype === m.key && st.chipTextActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={st.sectionLabel}>STOCK / BRACE DETAILS</Text>
                  <View style={st.card}>
                    <TouchableOpacity style={st.toggleRow} onPress={() => setAdjustable(!adjustable)}>
                      <Text style={st.fieldLabel}>Adjustable</Text>
                      <View style={[st.toggle, adjustable && st.toggleOn]}>
                        <View style={[st.toggleKnob, adjustable && st.toggleKnobOn]} />
                      </View>
                    </TouchableOpacity>
                    <Field label="Length of Pull" value={lengthOfPull} onChange={setLengthOfPull} placeholder="e.g. 13.5 inches" />
                    <Field label="Buffer Tube Type" value={bufferTubeType} onChange={setBufferTubeType} placeholder="e.g. Mil-Spec, Commercial, Pistol" />
                    <Field label="Material" value={stockMaterial} onChange={setStockMaterial} placeholder="e.g. Polymer, Aluminum, Wood" last />
                  </View>
                </>
              )}

              {selectedType === 'Grip / Grip Module' && (
                <>
                  <Text style={st.sectionLabel}>GRIP DETAILS</Text>
                  <View style={st.card}>
                    <Field label="Texture" value={texture} onChange={setTexture} placeholder="e.g. Stippled, Rubberized" />
                    <Field label="Color" value={gripColor} onChange={setGripColor} placeholder="e.g. Black, FDE" />
                    <Field label="Grip Angle" value={gripAngle} onChange={setGripAngle} placeholder="e.g. 18° or 25°" />
                    <TouchableOpacity style={st.toggleRow} onPress={() => setHasBeavertail(!hasBeavertail)}>
                      <Text style={st.fieldLabel}>Beavertail</Text>
                      <View style={[st.toggle, hasBeavertail && st.toggleOn]}>
                        <View style={[st.toggleKnob, hasBeavertail && st.toggleKnobOn]} />
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={[st.toggleRow, { borderBottomWidth: 0 }]} onPress={() => setHasFingerGrooves(!hasFingerGrooves)}>
                      <Text style={st.fieldLabel}>Finger Grooves</Text>
                      <View style={[st.toggle, hasFingerGrooves && st.toggleOn]}>
                        <View style={[st.toggleKnob, hasFingerGrooves && st.toggleKnobOn]} />
                      </View>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {selectedType === 'Trigger' && (
                <>
                  <Text style={st.sectionLabel}>TRIGGER TYPE</Text>
                  <View style={st.chipRow}>
                    {TRIGGER_SUBTYPES.map((t) => (
                      <TouchableOpacity key={t} style={[st.chip, triggerSubtype === t && st.chipActive]}
                        onPress={() => setTriggerSubtype(triggerSubtype === t ? '' : t)}>
                        <Text style={[st.chipText, triggerSubtype === t && st.chipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={st.sectionLabel}>SHOE SHAPE</Text>
                  <View style={st.chipRow}>
                    {TRIGGER_SHAPES.map((m) => (
                      <TouchableOpacity key={m.key} style={[st.chip, triggerShape === m.key && st.chipActive]}
                        onPress={() => setTriggerShape(triggerShape === m.key ? '' : m.key)}>
                        <Text style={[st.chipText, triggerShape === m.key && st.chipTextActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={st.sectionLabel}>STAGES</Text>
                  <View style={st.chipRow}>
                    {TRIGGER_STAGES.map((m) => (
                      <TouchableOpacity key={m.key} style={[st.chip, triggerStages === m.key && st.chipActive]}
                        onPress={() => setTriggerStages(triggerStages === m.key ? '' : m.key)}>
                        <Text style={[st.chipText, triggerStages === m.key && st.chipTextActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={st.sectionLabel}>TRIGGER DETAILS</Text>
                  <View style={st.card}>
                    <Field label="Pull Weight" value={pullWeight} onChange={setPullWeight} placeholder="e.g. 3.5 lbs" />
                    <Field label="Shoe Material" value={shoeMaterial} onChange={setShoeMaterial} placeholder="e.g. Aluminum, Polymer" />
                    <Field label="Reset Length" value={resetLength} onChange={setResetLength} placeholder="e.g. Short, 0.05 inches" last />
                  </View>
                </>
              )}

              {selectedType === 'Magazine' && (
                <>
                  <Text style={st.sectionLabel}>MAGAZINE DETAILS</Text>
                  <View style={st.card}>
                    <Field label="Capacity" value={magCapacity} onChange={setMagCapacity} placeholder="e.g. 30" keyboardType="number-pad" />
                    <Field label="Material" value={magMaterial} onChange={setMagMaterial} placeholder="e.g. Steel, Polymer" />
                    <Field label="Manufacturer Variant" value={magVariant} onChange={setMagVariant} placeholder="e.g. PMAG M3 Gen M3" />
                    <Field label="Fits Models" value={magFitsModels} onChange={setMagFitsModels} placeholder="e.g. AR-15, SR25, AK47" />
                    <Field label="Count Owned" value={magCount} onChange={setMagCount} placeholder="e.g. 5" keyboardType="number-pad" />
                    <TouchableOpacity style={[st.toggleRow, { borderBottomWidth: 0 }]} onPress={() => setMagAntiTilt(!magAntiTilt)}>
                      <Text style={st.fieldLabel}>Anti-Tilt Follower</Text>
                      <View style={[st.toggle, magAntiTilt && st.toggleOn]}>
                        <View style={[st.toggleKnob, magAntiTilt && st.toggleKnobOn]} />
                      </View>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {selectedType === 'Sling' && (
                <>
                  <Text style={st.sectionLabel}>SLING POINTS</Text>
                  <View style={st.chipRow}>
                    {SLING_POINTS.map((m) => (
                      <TouchableOpacity key={m.key} style={[st.chip, slingPoints === m.key && st.chipActive]}
                        onPress={() => setSlingPoints(slingPoints === m.key ? '' : m.key)}>
                        <Text style={[st.chipText, slingPoints === m.key && st.chipTextActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={st.sectionLabel}>SLING DETAILS</Text>
                  <View style={st.card}>
                    <Field label="Attachment Type" value={attachmentType} onChange={setAttachmentType} placeholder="e.g. QD, HK hook, Paracord" />
                    <Field label="Material" value={slingMaterial} onChange={setSlingMaterial} placeholder="e.g. Nylon, Webbing, Leather" />
                    <TouchableOpacity style={[st.toggleRow, { borderBottomWidth: 0 }]} onPress={() => setSlingQd(!slingQd)}>
                      <Text style={st.fieldLabel}>QD Hardware</Text>
                      <View style={[st.toggle, slingQd && st.toggleOn]}>
                        <View style={[st.toggleKnob, slingQd && st.toggleKnobOn]} />
                      </View>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {hasBattery && (
                <>
                  <Text style={st.sectionLabel}>POWER SOURCE</Text>
                  <View style={st.chipRow}>
                    {POWER_TYPES.map((p) => (
                      <TouchableOpacity key={p} style={[st.chip, powerType === p && st.chipActive]}
                        onPress={() => setPowerType(powerType === p ? '' : p)}>
                        <Text style={[st.chipText, powerType === p && st.chipTextActive]}>{POWER_LABELS[p]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {(powerType === 'disposable' || powerType === 'dual_solar') && (
                    <View style={st.card}>
                      <View style={st.fieldWrap}>
                        <Text style={st.fieldLabel}>Battery Type</Text>
                        <View style={[st.chipRow, { marginTop: 6 }]}>
                          {BATTERY_SIZES.map((b) => (
                            <TouchableOpacity key={b} style={[st.chipSm, batteryType === b && st.chipActive]}
                              onPress={() => setBatteryType(batteryType === b ? '' : b)}>
                              <Text style={[st.chipSmText, batteryType === b && st.chipTextActive]}>{b}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <Field label="Qty per Device" value={batteryQty} onChange={setBatteryQty} keyboardType="number-pad" />
                      <Field label="Date Last Replaced" value={dateBatteryReplaced} onChange={(v) => setDateBatteryReplaced(autoFormatDate(v, dateBatteryReplaced))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                      <Field label="Replace Every (days)" value={replacementDays} onChange={setReplacementDays} placeholder="e.g. 365" keyboardType="number-pad" last />
                    </View>
                  )}

                  {powerType === 'rechargeable_internal' && (
                    <View style={st.card}>
                      <View style={st.fieldWrap}>
                        <Text style={st.fieldLabel}>Connector</Text>
                        <View style={[st.chipRow, { marginTop: 6 }]}>
                          {CONNECTOR_TYPES.map((c) => (
                            <TouchableOpacity key={c} style={[st.chipSm, chargeConnector === c && st.chipActive]}
                              onPress={() => setChargeConnector(chargeConnector === c ? '' : c)}>
                              <Text style={[st.chipSmText, chargeConnector === c && st.chipTextActive]}>{c}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <Field label="Date Last Charged" value={dateLastCharged} onChange={(v) => setDateLastCharged(autoFormatDate(v, dateLastCharged))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                      <Field label="Charge Reminder (days)" value={replacementDays} onChange={setReplacementDays} placeholder="e.g. 30" keyboardType="number-pad" last />
                    </View>
                  )}

                  {powerType === 'rechargeable_swappable' && (
                    <View style={st.card}>
                      <View style={st.fieldWrap}>
                        <Text style={st.fieldLabel}>Cell Type</Text>
                        <View style={[st.chipRow, { marginTop: 6 }]}>
                          {CELL_TYPES.map((c) => (
                            <TouchableOpacity key={c} style={[st.chipSm, cellType === c && st.chipActive]}
                              onPress={() => setCellType(cellType === c ? '' : c)}>
                              <Text style={[st.chipSmText, cellType === c && st.chipTextActive]}>{c}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <Field label="Qty per Device" value={batteryQty} onChange={setBatteryQty} keyboardType="number-pad" />
                      <Field label="Date Cells Swapped" value={dateBatteryReplaced} onChange={(v) => setDateBatteryReplaced(autoFormatDate(v, dateBatteryReplaced))} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
                      <Field label="Swap Interval (days)" value={replacementDays} onChange={setReplacementDays} placeholder="e.g. 90" keyboardType="number-pad" last />
                    </View>
                  )}
                </>
              )}

              <Text style={st.sectionLabel}>NOTES</Text>
              <View style={st.card}>
                <Field label="Notes" value={notes} onChange={setNotes} placeholder="Mount torque, zero history, firmware..." multiline last />
              </View>

              {/* Delete button */}
              <TouchableOpacity style={st.deleteBtn} onPress={handleDelete}>
                <Text style={st.deleteText}>Delete Accessory</Text>
              </TouchableOpacity>
            </>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container:    { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  cancel:       { color: GOLD, fontSize: 17 },
  title:        { color: '#fff', fontSize: 18, fontWeight: '700' },
  save:         { color: GOLD, fontSize: 17, fontWeight: '700' },
  scroll:       { paddingHorizontal: 20, paddingBottom: 40 },
  imagePicker:  { width: 120, height: 90, borderRadius: 12, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 16, overflow: 'hidden' },
  imagePreview: { width: '100%', height: '100%' },
  imageText:    { color: MUTED, fontSize: 14 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 20, marginBottom: 8 },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE },
  chipActive:   { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipText:     { color: '#888', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: GOLD },
  chipSm:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE },
  chipSmText:   { color: '#888', fontSize: 12, fontWeight: '600' },
  card:         { backgroundColor: SURFACE, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 4 },
  fieldWrap:    { paddingVertical: 10 },
  fieldBorder:  { borderBottomWidth: 1, borderBottomColor: BORDER },
  fieldLabel:   { color: '#888', fontSize: 12, marginBottom: 6 },
  fieldInput:   { color: '#fff', fontSize: 16 },
  toggleRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  toggle:       { width: 48, height: 28, borderRadius: 14, backgroundColor: '#333', justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:     { backgroundColor: GOLD },
  toggleKnob:   { width: 22, height: 22, borderRadius: 11, backgroundColor: '#888' },
  toggleKnobOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
  deleteBtn:    { marginTop: 24, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#5a2020', alignItems: 'center' },
  deleteText:   { color: '#ff4444', fontSize: 16, fontWeight: '600' },
});
