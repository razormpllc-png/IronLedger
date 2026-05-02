// Bulk Import — CSV / Excel → Firearms
//
// Three-step flow:
//   1. Pick a file (CSV, TSV, or XLSX)
//   2. Map columns → Iron Ledger fields
//   3. Preview rows + confirm import

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, StyleSheet,
  ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  parseFile, guessFieldMapping, rowsToFirearms,
  IMPORTABLE_FIELDS, ImportableField, ParsedFile, ImportedFirearm,
} from '../lib/importParser';
import { addFirearm } from '../lib/database';
import { syncWidgets } from '../lib/widgetSync';
import { useFeatureGate } from '../hooks/useFeatureGate';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const SUCCESS = '#4CAF50';
const DANGER = '#FF5722';

type Step = 'pick' | 'map' | 'preview' | 'done';

export default function ImportScreen() {
  useFeatureGate('vault');
  const [step, setStep] = useState<Step>('pick');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ImportableField[]>([]);
  const [preview, setPreview] = useState<ImportedFirearm[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [pickerCol, setPickerCol] = useState<number | null>(null);

  // ── Step 1: Pick file ───────────────────────────────────────
  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'text/tab-separated-values',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setLoading(true);
      setFileName(asset.name);

      const ext = asset.name.toLowerCase().split('.').pop() ?? '';

      if (ext === 'xlsx' || ext === 'xls') {
        Alert.alert(
          'Excel File Detected',
          'For best results, save your spreadsheet as CSV first:\n\n' +
          'In Excel: File → Save As → CSV\n' +
          'In Google Sheets: File → Download → CSV\n\n' +
          'Then import the CSV file here.',
          [{ text: 'OK' }],
        );
        setLoading(false);
        return;
      }

      // Read the file as text
      const content = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'utf8',
      });

      if (!content.trim()) {
        Alert.alert('Empty File', 'The selected file appears to be empty.');
        setLoading(false);
        return;
      }

      const file = parseFile(content, asset.name);

      if (file.headers.length === 0) {
        Alert.alert('No Data', 'Could not detect any columns in this file.');
        setLoading(false);
        return;
      }

      if (file.rows.length === 0) {
        Alert.alert('No Rows', 'The file has headers but no data rows.');
        setLoading(false);
        return;
      }

      setParsed(file);
      setMapping([...file.mapping]);
      setStep('map');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to read file.');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Column mapping ──────────────────────────────────
  function handleMappingDone() {
    if (!parsed) return;

    // Validate: must have at least make or model mapped
    const hasMake = mapping.includes('make');
    const hasModel = mapping.includes('model');
    if (!hasMake && !hasModel) {
      Alert.alert(
        'Missing Required Fields',
        'You need to map at least "Make" or "Model" so we know what each firearm is.',
      );
      return;
    }

    const { valid, skipped } = rowsToFirearms(parsed.rows, mapping);
    setPreview(valid);
    setSkippedCount(skipped);
    setStep('preview');
  }

  function updateMapping(colIndex: number, field: ImportableField) {
    setMapping(prev => {
      const next = [...prev];
      // If this field is already assigned elsewhere (and it's not 'skip'),
      // clear the old assignment
      if (field !== 'skip') {
        const existingIdx = next.indexOf(field);
        if (existingIdx !== -1 && existingIdx !== colIndex) {
          next[existingIdx] = 'skip';
        }
      }
      next[colIndex] = field;
      return next;
    });
    setPickerCol(null);
  }

  // ── Step 3: Import ─────────────────────────────────────────
  function handleImport() {
    Alert.alert(
      'Confirm Import',
      `This will add ${preview.length} firearm${preview.length === 1 ? '' : 's'} to your Armory. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: () => {
            setLoading(true);
            try {
              let count = 0;
              for (const f of preview) {
                addFirearm({
                  make: f.make,
                  model: f.model,
                  caliber: f.caliber,
                  serial_number: f.serial_number,
                  type: f.type,
                  nickname: f.nickname,
                  purchase_date: f.purchase_date,
                  purchase_price: f.purchase_price,
                  current_value: f.current_value,
                  condition_rating: f.condition_rating,
                  action_type: f.action_type,
                  trigger_type: f.trigger_type,
                  storage_location: f.storage_location,
                  round_count: f.round_count ?? 0,
                  notes: f.notes,
                });
                count++;
              }
              syncWidgets();
              setImportedCount(count);
              setStep('done');
            } catch (e: any) {
              Alert.alert('Import Failed', e?.message ?? 'An error occurred during import.');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.cancelText}>{step === 'done' ? 'Close' : 'Cancel'}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Import Firearms</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Progress bar */}
      <View style={s.progressRow}>
        {(['pick', 'map', 'preview'] as const).map((s2, i) => {
          const stepIdx = ['pick', 'map', 'preview', 'done'].indexOf(step);
          const thisIdx = i;
          const active = stepIdx >= thisIdx;
          return (
            <View key={s2} style={[s.progressDot, active && s.progressDotActive]}>
              <Text style={[s.progressNum, active && s.progressNumActive]}>{i + 1}</Text>
            </View>
          );
        })}
        <View style={s.progressLine} />
      </View>
      <Text style={s.stepLabel}>
        {step === 'pick' ? 'Select File' :
         step === 'map' ? 'Map Columns' :
         step === 'preview' ? 'Review & Import' : 'Complete'}
      </Text>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={s.loadingText}>Processing…</Text>
        </View>
      ) : step === 'pick' ? (
        <View style={s.center}>
          <Text style={s.pickIcon}>📄</Text>
          <Text style={s.pickTitle}>Import from Spreadsheet</Text>
          <Text style={s.pickDesc}>
            Select a CSV or text file exported from Excel, Google Sheets,
            or any spreadsheet app. We'll help you map the columns.
          </Text>
          <TouchableOpacity style={s.pickBtn} onPress={handlePickFile}>
            <Text style={s.pickBtnText}>Choose File</Text>
          </TouchableOpacity>
          <Text style={s.pickHint}>
            Supported: .csv, .tsv, .txt{'\n'}
            Tip: In Google Sheets, go to File → Download → CSV
          </Text>
        </View>
      ) : step === 'map' ? (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }}>
          <Text style={s.mapIntro}>
            We found <Text style={s.bold}>{parsed!.headers.length} columns</Text> and{' '}
            <Text style={s.bold}>{parsed!.rows.length} rows</Text> in{' '}
            <Text style={s.bold}>{fileName}</Text>.
            {'\n\n'}Match each column to the right field. Anything marked "Skip" won't be imported.
          </Text>

          {parsed!.headers.map((header, idx) => {
            const field = mapping[idx] ?? 'skip';
            const fieldLabel = IMPORTABLE_FIELDS.find(f => f.key === field)?.label ?? 'Skip';
            const sample = parsed!.rows.slice(0, 3).map(r => r[idx] ?? '').filter(Boolean).join(', ');
            const isMatched = field !== 'skip';
            return (
              <View key={idx} style={s.mapCard}>
                <View style={s.mapCardTop}>
                  <View style={s.mapColInfo}>
                    <Text style={s.mapColHeader}>"{header}"</Text>
                    {sample ? <Text style={s.mapSample} numberOfLines={1}>e.g. {sample}</Text> : null}
                  </View>
                  <Text style={s.mapArrow}>→</Text>
                  <TouchableOpacity
                    style={[s.mapFieldBtn, isMatched && s.mapFieldBtnActive]}
                    onPress={() => setPickerCol(idx)}
                  >
                    <Text style={[s.mapFieldBtnText, isMatched && s.mapFieldBtnTextActive]}>
                      {fieldLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          <TouchableOpacity style={s.primaryBtn} onPress={handleMappingDone}>
            <Text style={s.primaryBtnText}>Continue to Preview</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : step === 'preview' ? (
        <View style={{ flex: 1 }}>
          <View style={s.previewStats}>
            <View style={s.previewStat}>
              <Text style={s.previewStatVal}>{preview.length}</Text>
              <Text style={s.previewStatLabel}>Ready to import</Text>
            </View>
            {skippedCount > 0 ? (
              <View style={s.previewStat}>
                <Text style={[s.previewStatVal, { color: DANGER }]}>{skippedCount}</Text>
                <Text style={s.previewStatLabel}>Skipped (missing data)</Text>
              </View>
            ) : null}
          </View>

          <FlatList
            data={preview}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
            renderItem={({ item, index }) => (
              <View style={s.previewCard}>
                <View style={s.previewCardHeader}>
                  <Text style={s.previewCardNum}>#{index + 1}</Text>
                  <Text style={s.previewCardName}>{item.make} {item.model}</Text>
                </View>
                <View style={s.previewTagRow}>
                  {item.type ? <View style={s.previewTag}><Text style={s.previewTagText}>{item.type}</Text></View> : null}
                  {item.caliber ? <View style={s.previewTag}><Text style={s.previewTagText}>{item.caliber}</Text></View> : null}
                  {item.serial_number ? <View style={s.previewTag}><Text style={s.previewTagText}>S/N: {item.serial_number}</Text></View> : null}
                </View>
                {item.purchase_price ? <Text style={s.previewDetail}>Price: ${item.purchase_price.toLocaleString()}</Text> : null}
                {item.storage_location ? <Text style={s.previewDetail}>Storage: {item.storage_location}</Text> : null}
                {item.notes ? <Text style={s.previewDetail} numberOfLines={1}>Notes: {item.notes}</Text> : null}
              </View>
            )}
          />

          <View style={s.bottomBar}>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => setStep('map')}>
              <Text style={s.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={handleImport}>
              <Text style={s.primaryBtnText}>Import {preview.length} Firearms</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* Done */
        <View style={s.center}>
          <Text style={s.doneIcon}>✓</Text>
          <Text style={s.doneTitle}>Import Complete</Text>
          <Text style={s.doneDesc}>
            {importedCount} firearm{importedCount === 1 ? '' : 's'} added to your Armory.
            {skippedCount > 0 ? `\n${skippedCount} row${skippedCount === 1 ? '' : 's'} skipped (missing make/model).` : ''}
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()}>
            <Text style={s.primaryBtnText}>Go to Armory</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Field picker modal */}
      <Modal visible={pickerCol !== null} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>
              Map "{parsed?.headers[pickerCol ?? 0] ?? ''}" to:
            </Text>
            <FlatList
              data={IMPORTABLE_FIELDS}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => {
                const isActive = mapping[pickerCol ?? 0] === item.key;
                // Check if another column already uses this field
                const usedByOther = item.key !== 'skip' &&
                  mapping.some((m, i) => m === item.key && i !== pickerCol);
                return (
                  <TouchableOpacity
                    style={[s.modalOption, isActive && s.modalOptionActive]}
                    onPress={() => updateMapping(pickerCol!, item.key)}
                  >
                    <Text style={[
                      s.modalOptionText,
                      isActive && s.modalOptionTextActive,
                      usedByOther && s.modalOptionTextUsed,
                    ]}>
                      {item.label}
                      {usedByOther ? ' (will swap)' : ''}
                    </Text>
                    {isActive ? <Text style={s.modalCheck}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={s.modalCancel} onPress={() => setPickerCol(null)}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  // Progress indicators
  progressRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingTop: 20, paddingBottom: 8, gap: 32, position: 'relative',
  },
  progressLine: {
    position: 'absolute', top: 35, left: '25%', right: '25%',
    height: 2, backgroundColor: BORDER, zIndex: -1,
  },
  progressDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: SURFACE, borderWidth: 2, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  progressDotActive: { borderColor: GOLD, backgroundColor: 'rgba(201,168,76,0.15)' },
  progressNum: { color: MUTED, fontSize: 12, fontWeight: '700' },
  progressNumActive: { color: GOLD },
  stepLabel: {
    color: '#aaa', fontSize: 13, fontWeight: '600',
    textAlign: 'center', marginBottom: 16,
  },
  // Shared
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  bold: { fontWeight: '700', color: GOLD },
  loadingText: { color: MUTED, fontSize: 14, marginTop: 12 },
  // Step 1: Pick
  pickIcon: { fontSize: 56, marginBottom: 16 },
  pickTitle: { color: 'white', fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  pickDesc: { color: '#999', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  pickBtn: {
    backgroundColor: GOLD, paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 12,
  },
  pickBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  pickHint: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  // Step 2: Map
  mapIntro: { color: '#bbb', fontSize: 13, lineHeight: 20, marginBottom: 20 },
  mapCard: {
    backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1,
    borderColor: BORDER, marginBottom: 10, padding: 14,
  },
  mapCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mapColInfo: { flex: 1 },
  mapColHeader: { color: 'white', fontSize: 14, fontWeight: '600' },
  mapSample: { color: MUTED, fontSize: 11, marginTop: 3 },
  mapArrow: { color: MUTED, fontSize: 16 },
  mapFieldBtn: {
    backgroundColor: BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 100, alignItems: 'center',
  },
  mapFieldBtnActive: { borderColor: GOLD, backgroundColor: 'rgba(201,168,76,0.1)' },
  mapFieldBtnText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  mapFieldBtnTextActive: { color: GOLD },
  // Step 3: Preview
  previewStats: {
    flexDirection: 'row', gap: 16, padding: 16, justifyContent: 'center',
  },
  previewStat: { alignItems: 'center' },
  previewStatVal: { color: SUCCESS, fontSize: 28, fontWeight: '800' },
  previewStatLabel: { color: MUTED, fontSize: 11, marginTop: 2 },
  previewCard: {
    backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1,
    borderColor: BORDER, padding: 14, marginBottom: 8,
  },
  previewCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  previewCardNum: { color: MUTED, fontSize: 11, fontWeight: '700' },
  previewCardName: { color: 'white', fontSize: 15, fontWeight: '700', flex: 1 },
  previewTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  previewTag: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  previewTagText: { color: '#888', fontSize: 11, fontWeight: '600' },
  previewDetail: { color: MUTED, fontSize: 12, marginTop: 2 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 36,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  // Buttons
  primaryBtn: {
    backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 24, flex: 1, alignItems: 'center',
  },
  primaryBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center',
  },
  secondaryBtnText: { color: '#ccc', fontSize: 15, fontWeight: '600' },
  // Done
  doneIcon: {
    color: SUCCESS, fontSize: 56, fontWeight: '700',
    width: 80, height: 80, lineHeight: 80, textAlign: 'center',
    backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: 40,
    overflow: 'hidden', marginBottom: 16,
  },
  doneTitle: { color: 'white', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  doneDesc: { color: '#999', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  // Modal
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: SURFACE, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '70%',
  },
  modalTitle: {
    color: 'white', fontSize: 16, fontWeight: '700',
    marginBottom: 16, textAlign: 'center',
  },
  modalOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalOptionActive: { backgroundColor: 'rgba(201,168,76,0.1)' },
  modalOptionText: { color: 'white', fontSize: 15 },
  modalOptionTextActive: { color: GOLD, fontWeight: '600' },
  modalOptionTextUsed: { color: MUTED },
  modalCheck: { color: GOLD, fontSize: 18, fontWeight: '700' },
  modalCancel: {
    marginTop: 12, paddingVertical: 14, alignItems: 'center',
    backgroundColor: BG, borderRadius: 12,
  },
  modalCancelText: { color: '#ccc', fontSize: 16, fontWeight: '600' },
});
