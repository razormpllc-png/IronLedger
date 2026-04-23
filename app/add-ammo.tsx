import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import FormScrollView from '../components/FormScrollView';
import { addAmmo, getAllFirearms, Firearm } from '../lib/database';
import { useAutoSave } from '../lib/useDraft';
import { syncWidgets } from '../lib/widgetSync';
import SmartField from '../components/SmartField';
import { suggestedGrains } from '../lib/grainSuggestions';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

export default function AddAmmoScreen() {
  // Optional ?caliber= prefills when landing here from the Supply screen's
  // "need to buy" indicator for a firearm-only caliber.
  const params = useLocalSearchParams<{ caliber?: string }>();
  const [caliber, setCaliber] = useState((params.caliber as string) || '');
  const [brand, setBrand] = useState('');
  const [grain, setGrain] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [roundsPerBox, setRoundsPerBox] = useState('50');
  const [costPerBox, setCostPerBox] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('100');
  const [notes, setNotes] = useState('');
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [pairedIds, setPairedIds] = useState<number[]>([]);

  // Handload fields
  const [isHandload, setIsHandload] = useState(false);
  const [powderBrand, setPowderBrand] = useState('');
  const [powderType, setPowderType] = useState('');
  const [chargeWeight, setChargeWeight] = useState('');
  const [bulletBrand, setBulletBrand] = useState('');
  const [bulletWeight, setBulletWeight] = useState('');
  const [bulletType, setBulletType] = useState('');
  const [brassBrand, setBrassBrand] = useState('');
  const [brassTimesFired, setBrassTimesFired] = useState('');
  const [primerBrand, setPrimerBrand] = useState('');
  const [primerType, setPrimerType] = useState('');
  const [coal, setCoal] = useState('');
  const [cbto, setCbto] = useState('');
  const [velocityFps, setVelocityFps] = useState('');
  const [velocitySd, setVelocitySd] = useState('');
  const [velocityEs, setVelocityEs] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [loadNotes, setLoadNotes] = useState('');

  const typeOptions = ['FMJ', 'JHP', 'SP', 'Match', 'Buckshot', 'Slug', 'Other'];

  // ── Auto-save draft ──────────────────────────────────────
  const formSnapshot = useMemo(() => ({
    caliber, brand, grain, type, quantity, roundsPerBox, costPerBox, lowStockThreshold, notes, pairedIds,
    isHandload, powderBrand, powderType, chargeWeight, bulletBrand, bulletWeight, bulletType,
    brassBrand, brassTimesFired, primerBrand, primerType, coal, cbto, velocityFps, velocitySd, velocityEs, groupSize, loadNotes,
  }), [
    caliber, brand, grain, type, quantity, roundsPerBox, costPerBox, lowStockThreshold, notes, pairedIds,
    isHandload, powderBrand, powderType, chargeWeight, bulletBrand, bulletWeight, bulletType,
    brassBrand, brassTimesFired, primerBrand, primerType, coal, cbto, velocityFps, velocitySd, velocityEs, groupSize, loadNotes,
  ]);
  const { restored, clearDraft } = useAutoSave('add-ammo', formSnapshot);

  useEffect(() => {
    if (!restored) return;
    setCaliber(restored.caliber ?? '');
    setBrand(restored.brand ?? '');
    setGrain(restored.grain ?? '');
    setType(restored.type ?? null);
    setQuantity(restored.quantity ?? '');
    setRoundsPerBox(restored.roundsPerBox ?? '50');
    setCostPerBox(restored.costPerBox ?? '');
    setLowStockThreshold(restored.lowStockThreshold ?? '100');
    setNotes(restored.notes ?? '');
    setPairedIds(restored.pairedIds ?? []);
    setIsHandload(restored.isHandload ?? false);
    setPowderBrand(restored.powderBrand ?? '');
    setPowderType(restored.powderType ?? '');
    setChargeWeight(restored.chargeWeight ?? '');
    setBulletBrand(restored.bulletBrand ?? '');
    setBulletWeight(restored.bulletWeight ?? '');
    setBulletType(restored.bulletType ?? '');
    setBrassBrand(restored.brassBrand ?? '');
    setBrassTimesFired(restored.brassTimesFired ?? '');
    setPrimerBrand(restored.primerBrand ?? '');
    setPrimerType(restored.primerType ?? '');
    setCoal(restored.coal ?? '');
    setCbto(restored.cbto ?? '');
    setVelocityFps(restored.velocityFps ?? '');
    setVelocitySd(restored.velocitySd ?? '');
    setVelocityEs(restored.velocityEs ?? '');
    setGroupSize(restored.groupSize ?? '');
    setLoadNotes(restored.loadNotes ?? '');
  }, [restored]);

  useEffect(() => {
    try { setFirearms(getAllFirearms()); } catch {}
  }, []);

  function togglePaired(id: number) {
    setPairedIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function handleSave() {
    if (!caliber.trim()) {
      Alert.alert('Error', 'Caliber is required');
      return;
    }
    if (!quantity.trim()) {
      Alert.alert('Error', 'Quantity is required');
      return;
    }

    try {
      addAmmo({
        caliber: caliber.trim(),
        brand: brand.trim() || null,
        grain: grain ? parseInt(grain) : null,
        type: type || null,
        quantity: parseInt(quantity),
        rounds_per_box: roundsPerBox ? parseInt(roundsPerBox) : null,
        cost_per_box: costPerBox ? parseFloat(costPerBox) : null,
        low_stock_threshold: lowStockThreshold ? parseInt(lowStockThreshold) : 100,
        paired_firearm_ids: pairedIds.length > 0 ? pairedIds : null,
        notes: notes.trim() || null,
        is_handload: isHandload ? 1 : 0,
        powder_brand: powderBrand.trim() || null,
        powder_type: powderType.trim() || null,
        charge_weight: chargeWeight ? parseFloat(chargeWeight) : null,
        bullet_brand: bulletBrand.trim() || null,
        bullet_weight: bulletWeight ? parseFloat(bulletWeight) : null,
        bullet_type: bulletType.trim() || null,
        brass_brand: brassBrand.trim() || null,
        brass_times_fired: brassTimesFired ? parseInt(brassTimesFired) : null,
        primer_brand: primerBrand.trim() || null,
        primer_type: primerType.trim() || null,
        coal: coal ? parseFloat(coal) : null,
        cbto: cbto ? parseFloat(cbto) : null,
        velocity_fps: velocityFps ? parseFloat(velocityFps) : null,
        velocity_sd: velocitySd ? parseFloat(velocitySd) : null,
        velocity_es: velocityEs ? parseFloat(velocityEs) : null,
        group_size: groupSize.trim() || null,
        load_notes: loadNotes.trim() || null,
      });
      syncWidgets();
      clearDraft();
      router.back();
    } catch (error) {
      Alert.alert('Error', 'Failed to add ammo');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Ammo</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <FormScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
          {/* Basic Info Section */}
          <Text style={styles.sectionLabel}>BASIC INFO</Text>
          <View style={styles.card}>
            <SmartField
              label="Caliber"
              value={caliber}
              onChange={setCaliber}
              source="ammo_caliber"
              placeholder="e.g. 9mm, .223, 12ga"
            />
            <SmartField
              label="Brand"
              value={brand}
              onChange={setBrand}
              source="ammo_brand"
              placeholder="e.g. Federal, Hornady"
              last
            />
          </View>

          {/* Factory / Handload Toggle */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                !isHandload && styles.toggleBtnActive,
              ]}
              onPress={() => setIsHandload(false)}
            >
              <Text
                style={[
                  styles.toggleBtnText,
                  !isHandload && styles.toggleBtnTextActive,
                ]}
              >
                Factory
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                isHandload && styles.toggleBtnActive,
              ]}
              onPress={() => setIsHandload(true)}
            >
              <Text
                style={[
                  styles.toggleBtnText,
                  isHandload && styles.toggleBtnTextActive,
                ]}
              >
                Handload
              </Text>
            </TouchableOpacity>
          </View>

          {/* Specifications Section */}
          <Text style={styles.sectionLabel}>SPECIFICATIONS</Text>
          <View style={styles.card}>
            <Field
              label="Grain"
              value={grain}
              onChange={setGrain}
              keyboardType="number-pad"
            />
            {suggestedGrains(caliber).length > 0 && (
              <View style={styles.grainRow}>
                {suggestedGrains(caliber).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.grainChip, grain === String(g) && styles.grainChipActive]}
                    onPress={() => setGrain(String(g))}
                  >
                    <Text style={[styles.grainChipText, grain === String(g) && styles.grainChipTextActive]}>
                      {g}gr
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={styles.subLabel}>Type</Text>
            <View style={styles.chipRow}>
              {typeOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.chip,
                    type === option && styles.chipActive,
                  ]}
                  onPress={() => setType(type === option ? null : option)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      type === option && styles.chipTextActive,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Load Data Section — Only shown when handload is true */}
          {isHandload && (
            <>
              <Text style={styles.sectionLabel}>LOAD DATA</Text>

              {/* Powder Card */}
              <View style={styles.card}>
                <Field
                  label="Powder Brand"
                  value={powderBrand}
                  onChange={setPowderBrand}
                  placeholder="e.g. Hodgdon, IMR"
                />
                <Field
                  label="Powder Type"
                  value={powderType}
                  onChange={setPowderType}
                  placeholder="e.g. H4831SC"
                />
                <Field
                  label="Charge Weight"
                  value={chargeWeight}
                  onChange={setChargeWeight}
                  keyboardType="decimal-pad"
                  placeholder="grains"
                  last
                />
              </View>

              {/* Projectile Card */}
              <View style={styles.card}>
                <Field
                  label="Bullet Brand"
                  value={bulletBrand}
                  onChange={setBulletBrand}
                  placeholder="e.g. Sierra, Hornady"
                />
                <Field
                  label="Bullet Weight"
                  value={bulletWeight}
                  onChange={setBulletWeight}
                  keyboardType="number-pad"
                  placeholder="grains"
                />
                <Field
                  label="Bullet Type"
                  value={bulletType}
                  onChange={setBulletType}
                  placeholder="e.g. 77gr BTHP"
                  last
                />
              </View>

              {/* Brass Card */}
              <View style={styles.card}>
                <Field
                  label="Brass Brand"
                  value={brassBrand}
                  onChange={setBrassBrand}
                  placeholder="e.g. Lapua, Starline"
                />
                <Field
                  label="Times Fired"
                  value={brassTimesFired}
                  onChange={setBrassTimesFired}
                  keyboardType="number-pad"
                  placeholder="number of times"
                  last
                />
              </View>

              {/* Primer Card */}
              <View style={styles.card}>
                <Field
                  label="Primer Brand"
                  value={primerBrand}
                  onChange={setPrimerBrand}
                  placeholder="e.g. CCI, Federal"
                />
                <Field
                  label="Primer Type"
                  value={primerType}
                  onChange={setPrimerType}
                  placeholder="e.g. 200 Large Rifle Magnum"
                  last
                />
              </View>

              {/* Measurements Card */}
              <View style={styles.card}>
                <Field
                  label="COAL"
                  value={coal}
                  onChange={setCoal}
                  keyboardType="decimal-pad"
                  placeholder="Cartridge Overall Length"
                />
                <Field
                  label="CBTO"
                  value={cbto}
                  onChange={setCbto}
                  keyboardType="decimal-pad"
                  placeholder="Case Base to Ogive"
                  last
                />
              </View>

              {/* Chronograph Card */}
              <View style={styles.card}>
                <Field
                  label="Velocity"
                  value={velocityFps}
                  onChange={setVelocityFps}
                  keyboardType="number-pad"
                  placeholder="fps"
                />
                <Field
                  label="SD"
                  value={velocitySd}
                  onChange={setVelocitySd}
                  keyboardType="decimal-pad"
                  placeholder="Standard Deviation"
                />
                <Field
                  label="ES"
                  value={velocityEs}
                  onChange={setVelocityEs}
                  keyboardType="decimal-pad"
                  placeholder="Extreme Spread"
                />
                <Field
                  label="Group Size"
                  value={groupSize}
                  onChange={setGroupSize}
                  placeholder="e.g. 0.5 MOA @ 100yd"
                  last
                />
              </View>

              {/* Load Notes Card */}
              <View style={styles.card}>
                <View style={styles.notesContainer}>
                  <TextInput
                    style={styles.notesInput}
                    value={loadNotes}
                    onChangeText={setLoadNotes}
                    placeholder="Add any load-specific notes..."
                    placeholderTextColor={MUTED}
                    multiline
                    numberOfLines={4}
                  />
                </View>
              </View>
            </>
          )}

          {/* Quantity Section */}
          <Text style={styles.sectionLabel}>QUANTITY</Text>
          <View style={styles.card}>
            <Field
              label="Quantity"
              value={quantity}
              onChange={setQuantity}
              keyboardType="number-pad"
              placeholder="Total rounds"
            />
            <Field
              label="Rounds Per Box"
              value={roundsPerBox}
              onChange={setRoundsPerBox}
              keyboardType="number-pad"
            />
            <Field
              label="Low Stock Alert"
              value={lowStockThreshold}
              onChange={setLowStockThreshold}
              keyboardType="number-pad"
              placeholder="100"
              last
            />
          </View>

          {/* Cost Section */}
          <Text style={styles.sectionLabel}>COST</Text>
          <View style={styles.card}>
            <Field
              label="Cost Per Box"
              value={costPerBox}
              onChange={setCostPerBox}
              keyboardType="decimal-pad"
              prefix="$"
              last
            />
          </View>

          {/* Pair to Firearms Section — defaults to "any firearm with a
              matching caliber". Selecting one or more firearms narrows this
              lot to only those hosts. */}
          {firearms.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>PAIR TO FIREARMS</Text>
              <View style={styles.card}>
                <Text style={styles.pairHint}>
                  {pairedIds.length === 0
                    ? 'Available to any firearm with a matching caliber. Select specific firearms to narrow.'
                    : `Only the ${pairedIds.length} selected firearm${pairedIds.length === 1 ? '' : 's'} will see this lot.`}
                </Text>
                <View style={styles.chipRow}>
                  {firearms.map((f) => {
                    const active = pairedIds.includes(f.id);
                    const label = f.nickname || `${f.make} ${f.model}`;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => togglePaired(f.id)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {label}{f.caliber ? ` · ${f.caliber}` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          ) : null}

          {/* Notes Section */}
          <Text style={styles.sectionLabel}>NOTES</Text>
          <View style={styles.card}>
            <View style={styles.notesContainer}>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Add any additional notes..."
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={4}
              />
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </FormScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType = 'default', prefix, last }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  prefix?: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.fieldRow, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRight}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          keyboardType={keyboardType}
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  cancelText: {
    color: MUTED,
    fontSize: 16,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  saveText: {
    color: GOLD,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 8,
  },
  subLabel: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  fieldLabel: {
    color: 'white',
    fontSize: 14,
    flex: 1,
  },
  fieldRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  prefix: {
    color: MUTED,
    fontSize: 14,
    marginRight: 4,
  },
  fieldInput: {
    color: 'white',
    fontSize: 14,
    padding: 0,
    textAlign: 'right',
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  chipText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: BG,
    fontWeight: '600',
  },
  pairHint: {
    color: MUTED,
    fontSize: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    lineHeight: 16,
  },
  notesContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notesInput: {
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    padding: 10,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  grainRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 6,
  },
  grainChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'transparent',
  },
  grainChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  grainChipText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  grainChipTextActive: {
    color: BG,
  },
  bottomSpacer: {
    height: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  toggleBtnText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleBtnTextActive: {
    color: BG,
  },
});
