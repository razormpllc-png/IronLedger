// Estate Planning — configuration screen
//
// Lets the user choose which categories and individual items to include
// before generating the estate export PDF. Replaces the old one-click
// export so users have control over what appears in the document.

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  SectionList, Switch, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  getAllFirearms, getAllSuppressors, getAllAmmo,
  type Firearm, type Suppressor, type Ammo,
} from '../lib/database';
import { generateEstateExport, type EstateExportOptions } from '../lib/estateExport';
import { runProGated } from '../lib/paywall';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

interface CheckableFirearm extends Firearm { checked: boolean }
interface CheckableSuppressor extends Suppressor { checked: boolean }
interface CheckableAmmo extends Ammo { checked: boolean }

type Section =
  | { title: string; key: 'firearms'; enabled: boolean; data: CheckableFirearm[] }
  | { title: string; key: 'suppressors'; enabled: boolean; data: CheckableSuppressor[] }
  | { title: string; key: 'ammo'; enabled: boolean; data: CheckableAmmo[] };

export default function EstateConfigScreen() {
  const [firearms, setFirearms] = useState<CheckableFirearm[]>([]);
  const [suppressors, setSuppressors] = useState<CheckableSuppressor[]>([]);
  const [ammo, setAmmo] = useState<CheckableAmmo[]>([]);

  const [includeFirearms, setIncludeFirearms] = useState(true);
  const [includeSuppressors, setIncludeSuppressors] = useState(true);
  const [includeAmmo, setIncludeAmmo] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    try {
      setFirearms(getAllFirearms().map(f => ({ ...f, checked: true })));
      setSuppressors(getAllSuppressors().map(s => ({ ...s, checked: true })));
      setAmmo(getAllAmmo().map(a => ({ ...a, checked: true })));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load inventory.');
    }
  }, []);

  function toggleFirearm(id: number) {
    setFirearms(prev => prev.map(f => f.id === id ? { ...f, checked: !f.checked } : f));
  }
  function toggleSuppressor(id: number) {
    setSuppressors(prev => prev.map(s => s.id === id ? { ...s, checked: !s.checked } : s));
  }
  function toggleAmmo(id: number) {
    setAmmo(prev => prev.map(a => a.id === id ? { ...a, checked: !a.checked } : a));
  }

  function toggleAllInSection(key: string, value: boolean) {
    if (key === 'firearms') setFirearms(prev => prev.map(f => ({ ...f, checked: value })));
    if (key === 'suppressors') setSuppressors(prev => prev.map(s => ({ ...s, checked: value })));
    if (key === 'ammo') setAmmo(prev => prev.map(a => ({ ...a, checked: value })));
  }

  const sections: Section[] = [
    { title: `Firearms (${firearms.filter(f => f.checked).length}/${firearms.length})`, key: 'firearms', enabled: includeFirearms, data: includeFirearms ? firearms : [] },
    { title: `Suppressors (${suppressors.filter(s => s.checked).length}/${suppressors.length})`, key: 'suppressors', enabled: includeSuppressors, data: includeSuppressors ? suppressors : [] },
    { title: `Ammunition (${ammo.filter(a => a.checked).length}/${ammo.length})`, key: 'ammo', enabled: includeAmmo, data: includeAmmo ? ammo : [] },
  ];

  const totalSelected =
    (includeFirearms ? firearms.filter(f => f.checked).length : 0) +
    (includeSuppressors ? suppressors.filter(s => s.checked).length : 0) +
    (includeAmmo ? ammo.filter(a => a.checked).length : 0);

  async function handleGenerate() {
    if (totalSelected === 0) {
      Alert.alert('Nothing Selected', 'Select at least one item to include in the export.');
      return;
    }
    runProGated('insurance_export', async () => {
      setGenerating(true);
      try {
        const opts: EstateExportOptions = {
          includeFirearms,
          includeSuppressors,
          includeAmmo,
          excludeFirearmIds: new Set(firearms.filter(f => !f.checked).map(f => f.id)),
          excludeSuppressorIds: new Set(suppressors.filter(s => !s.checked).map(s => s.id)),
          excludeAmmoIds: new Set(ammo.filter(a => !a.checked).map(a => a.id)),
        };
        const result = await generateEstateExport(opts);
        if (!result.ok && result.reason === 'empty') {
          Alert.alert('Nothing to Export', 'All selected categories are empty.');
        }
      } catch (e: any) {
        Alert.alert('Export Failed', e?.message ?? 'Could not generate the PDF.');
      } finally {
        setGenerating(false);
      }
    });
  }

  function firearmLabel(f: Firearm): string {
    return f.nickname?.trim() || `${f.make ?? ''} ${f.model ?? ''}`.trim() || 'Unknown';
  }
  function suppressorLabel(s: Suppressor): string {
    return `${s.make ?? ''} ${s.model ?? ''}`.trim() || 'Unknown';
  }
  function ammoLabel(a: Ammo): string {
    return `${a.brand ?? ''} ${a.caliber ?? ''} ${a.grain ? a.grain + 'gr' : ''}`.trim() || 'Unknown';
  }

  function renderItem({ item, section }: { item: any; section: Section }) {
    const key = section.key;
    const checked = item.checked;
    const label = key === 'firearms' ? firearmLabel(item)
      : key === 'suppressors' ? suppressorLabel(item)
      : ammoLabel(item);
    const sub = key === 'firearms'
      ? [item.caliber, item.serial_number].filter(Boolean).join(' · ')
      : key === 'suppressors'
      ? [item.caliber, item.serial_number].filter(Boolean).join(' · ')
      : item.quantity != null ? `${item.quantity} rounds` : '';
    const toggle = key === 'firearms' ? () => toggleFirearm(item.id)
      : key === 'suppressors' ? () => toggleSuppressor(item.id)
      : () => toggleAmmo(item.id);

    return (
      <TouchableOpacity style={s.itemRow} onPress={toggle} activeOpacity={0.7}>
        <View style={[s.checkbox, checked && s.checkboxChecked]}>
          {checked ? <Text style={s.checkmark}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.itemLabel, !checked && s.itemLabelDim]}>{label}</Text>
          {sub ? <Text style={s.itemSub}>{sub}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  }

  function renderSectionHeader({ section }: { section: Section }) {
    const toggleEnabled = section.key === 'firearms'
      ? () => setIncludeFirearms(!includeFirearms)
      : section.key === 'suppressors'
      ? () => setIncludeSuppressors(!includeSuppressors)
      : () => setIncludeAmmo(!includeAmmo);

    const allChecked = section.data.length > 0 && section.data.every((d: any) => d.checked);
    const toggleAll = () => toggleAllInSection(section.key, !allChecked);

    return (
      <View style={s.sectionHeader}>
        <View style={s.sectionLeft}>
          <Switch
            value={section.enabled}
            onValueChange={toggleEnabled}
            trackColor={{ false: '#333', true: GOLD }}
            thumbColor="#fff"
          />
          <Text style={s.sectionTitle}>{section.title}</Text>
        </View>
        {section.enabled && section.data.length > 0 ? (
          <TouchableOpacity onPress={toggleAll}>
            <Text style={s.selectAllBtn}>{allChecked ? 'Deselect All' : 'Select All'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Estate Export</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={s.description}>
        Choose which items to include in your estate planning PDF.
        The document is designed for your executor or next of kin.
      </Text>

      <SectionList
        sections={sections as any}
        keyExtractor={(item: any) => `${item.id}`}
        renderItem={renderItem as any}
        renderSectionHeader={renderSectionHeader as any}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={null}
      />

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.generateBtn, (generating || totalSelected === 0) && s.generateBtnDisabled]}
          onPress={handleGenerate}
          disabled={generating || totalSelected === 0}
          activeOpacity={0.8}
        >
          {generating ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.generateBtnText}>
              Generate PDF ({totalSelected} item{totalSelected !== 1 ? 's' : ''})
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  description: {
    color: '#888', fontSize: 13, lineHeight: 18,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
    marginTop: 8,
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { color: GOLD, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  selectAllBtn: { color: GOLD, fontSize: 12, fontWeight: '600' },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 1.5, borderColor: MUTED,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: GOLD, borderColor: GOLD },
  checkmark: { color: '#000', fontSize: 14, fontWeight: '800' },
  itemLabel: { color: 'white', fontSize: 14 },
  itemLabelDim: { color: MUTED },
  itemSub: { color: MUTED, fontSize: 11, marginTop: 1 },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 34,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  generateBtn: {
    backgroundColor: GOLD, paddingVertical: 16, borderRadius: 12,
    alignItems: 'center',
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
