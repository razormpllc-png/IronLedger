// Backup & Restore — /backup
//
// User-facing wrapper around lib/backup.ts. Two buttons:
//   • Export  — dump every table + photos to a JSON file, hand it to the
//               share sheet (AirDrop / save to Files / iCloud).
//   • Restore — pick a previously-exported JSON file, wipe the DB, and
//               re-insert every row. Photos are rewritten to fresh paths.
//
// Restore is destructive, so we front it with a two-step confirmation and
// state the row count about to be overwritten.

import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as Sharing from 'expo-sharing';
// Lazy-require expo-document-picker so a fresh clone without `npm install`
// (or an older bundle) still typechecks and runs — we surface a friendly
// alert at call-time if the native module is missing.
let DocumentPicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DocumentPicker = require('expo-document-picker');
} catch {
  DocumentPicker = null;
}
import {
  exportToJson,
  writeBackupToCache,
  importFromFile,
  BACKUP_VERSION,
} from '../lib/backup';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#888888';
const DANGER = '#E05A3A';

export default function Backup() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'export' | 'import'>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [lastRestore, setLastRestore] = useState<string | null>(null);

  async function handleExport() {
    if (busy) return;
    setBusy('export');
    try {
      const backup = await exportToJson();
      const path = await writeBackupToCache(backup);

      let rows = 0;
      for (const arr of Object.values(backup.tables)) rows += arr.length;
      const photos = Object.keys(backup.photos).length;
      setLastExport(`${rows} rows · ${photos} photo${photos === 1 ? '' : 's'}`);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: 'Save Iron Ledger backup',
          UTI: 'public.json',
        });
      } else {
        Alert.alert('Export saved', `Backup written to:\n${path}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    if (busy) return;
    if (!DocumentPicker) {
      Alert.alert(
        'Restore unavailable',
        'The document picker module is not installed in this build. Run `npm install` and rebuild the app to enable restoring from a file.',
      );
      return;
    }
    // First gate: pick the file before the big warning so the user sees
    // the filename in the dialog and knows we actually found something.
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'public.json', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset?.uri) return;

    Alert.alert(
      'Restore from backup?',
      `This will ERASE every firearm, log, photo, and session currently in Iron Ledger and replace them with the contents of:\n\n${asset.name ?? 'backup file'}\n\nThis cannot be undone. Export a backup of your current data first if you want to keep it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase & Restore',
          style: 'destructive',
          onPress: () => confirmRestore(asset.uri, asset.name ?? 'backup'),
        },
      ],
    );
  }

  async function confirmRestore(uri: string, name: string) {
    setBusy('import');
    try {
      const result = await importFromFile(uri);
      let rows = 0;
      for (const n of Object.values(result.tables)) rows += n;
      setLastRestore(
        `${rows} rows · ${result.photosWritten} photo${result.photosWritten === 1 ? '' : 's'}`,
      );
      Alert.alert(
        'Restore complete',
        `Restored ${rows} rows from ${name}.` +
          (result.photosSkipped > 0
            ? `\n\n${result.photosSkipped} photo(s) could not be restored.`
            : ''),
      );
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Backup & Restore</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>
          Export every firearm, log, photo, accessory, and session to a single JSON file.
          Use it as a safety net before a risky change, to move to a new phone, or just to
          keep a copy somewhere outside the app.
        </Text>

        <Text style={s.sectionLabel}>EXPORT</Text>
        <TouchableOpacity
          style={[s.bigBtn, busy === 'export' && s.bigBtnBusy]}
          onPress={handleExport}
          disabled={!!busy}
          activeOpacity={0.8}
        >
          {busy === 'export' ? (
            <ActivityIndicator color={GOLD} />
          ) : (
            <>
              <Text style={s.bigBtnIcon}>📦</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.bigBtnTitle}>Export Backup</Text>
                <Text style={s.bigBtnSub}>
                  JSON + embedded photos · schema v{BACKUP_VERSION}
                </Text>
              </View>
              <Text style={s.bigBtnChevron}>›</Text>
            </>
          )}
        </TouchableOpacity>
        {lastExport ? <Text style={s.stat}>Last export: {lastExport}</Text> : null}

        <Text style={s.sectionLabel}>RESTORE</Text>
        <View style={s.warn}>
          <Text style={s.warnTitle}>⚠️  Destructive</Text>
          <Text style={s.warnBody}>
            Restoring REPLACES all current data. Any firearm, log, or photo not in the
            backup file will be erased. Export a fresh backup first if you're not sure.
          </Text>
        </View>
        <TouchableOpacity
          style={[s.bigBtn, s.bigBtnDanger, busy === 'import' && s.bigBtnBusy]}
          onPress={handleRestore}
          disabled={!!busy}
          activeOpacity={0.8}
        >
          {busy === 'import' ? (
            <ActivityIndicator color={DANGER} />
          ) : (
            <>
              <Text style={s.bigBtnIcon}>♻️</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.bigBtnTitle, { color: DANGER }]}>Restore From File…</Text>
                <Text style={s.bigBtnSub}>Pick a previous Iron Ledger JSON backup</Text>
              </View>
              <Text style={[s.bigBtnChevron, { color: DANGER }]}>›</Text>
            </>
          )}
        </TouchableOpacity>
        {lastRestore ? <Text style={s.stat}>Last restore: {lastRestore}</Text> : null}

        <Text style={s.footer}>
          Backups are plain JSON. Photos are embedded as base64 so the file is
          self-contained — no external links to break.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  back: { color: GOLD, fontSize: 16, width: 60 },
  title: { color: GOLD, fontSize: 18, fontWeight: '700', letterSpacing: 1.5 },
  scroll: { padding: 20, paddingBottom: 40 },
  intro: { color: MUTED, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  sectionLabel: {
    color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 2,
    marginTop: 18, marginBottom: 8,
  },
  bigBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 14, padding: 16, gap: 14,
  },
  bigBtnBusy: { opacity: 0.6 },
  bigBtnDanger: { borderColor: DANGER + '66' },
  bigBtnIcon: { fontSize: 28 },
  bigBtnTitle: { color: '#EAEAEA', fontSize: 16, fontWeight: '700' },
  bigBtnSub: { color: MUTED, fontSize: 13, marginTop: 2 },
  bigBtnChevron: { color: GOLD, fontSize: 26 },
  stat: { color: MUTED, fontSize: 12, marginTop: 8, marginLeft: 4 },
  warn: {
    backgroundColor: '#2A1A14', borderColor: DANGER + '55', borderWidth: 1,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  warnTitle: { color: DANGER, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  warnBody: { color: '#D8B8AC', fontSize: 13, lineHeight: 18 },
  footer: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 24 },
});
