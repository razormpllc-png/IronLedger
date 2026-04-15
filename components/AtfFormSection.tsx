// Shared "ATF Form on File" section for NFA detail screens. Handles two
// scan slots — FRONT (filed form) and BACK (approved stamp/back page) —
// with attach / view / replace / remove actions. Attach is gated on the
// `document_storage` Pro feature; view of an existing scan stays free so
// downgraded users don't lose access to paperwork they already stored.
//
// Writes land through setFirearmAtfForm / setSuppressorAtfForm depending
// on the `kind` prop. Images are copied into documentDirectory/atf_forms/
// and stored as relative paths, same pattern as tax_stamp_image.

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Alert,
  Modal, Pressable, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  resolveImageUri, setFirearmAtfForm, setSuppressorAtfForm, AtfFormPage,
} from '../lib/database';
import { runProGated } from '../lib/paywall';
import { saveScanToAtfForms } from '../lib/atfScans';

const GOLD = '#C9A84C';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#FF5722';

export type AtfOwnerKind = 'firearm' | 'suppressor';

interface Props {
  kind: AtfOwnerKind;
  ownerId: number;
  frontUri: string | null;
  backUri: string | null;
  scannedAt: string | null;
  onChange: () => void; // parent reloads the row after mutation
}

function writeScan(
  kind: AtfOwnerKind, ownerId: number, page: AtfFormPage, path: string | null,
) {
  if (kind === 'firearm') setFirearmAtfForm(ownerId, page, path);
  else setSuppressorAtfForm(ownerId, page, path);
}

export default function AtfFormSection(props: Props) {
  const { kind, ownerId, frontUri, backUri, scannedAt, onChange } = props;
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  async function pickAndSave(page: AtfFormPage) {
    Alert.alert(
      page === 'front' ? 'Filed Form Scan' : 'Approved Stamp Scan',
      'Choose a source',
      [
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
            if (!result.canceled) await persist(page, result.assets[0].uri);
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
            if (!result.canceled) await persist(page, result.assets[0].uri);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function persist(page: AtfFormPage, uri: string) {
    try {
      const saved = await saveScanToAtfForms(uri);
      writeScan(kind, ownerId, page, saved);
      onChange();
    } catch (e) {
      Alert.alert('Save failed', 'Could not save the ATF form scan.');
    }
  }

  function handleSlotTap(page: AtfFormPage, current: string | null) {
    if (current) {
      Alert.alert(
        page === 'front' ? 'Filed Form' : 'Approved Stamp',
        undefined,
        [
          { text: 'View', onPress: () => setViewerUri(resolveImageUri(current)) },
          { text: 'Replace', onPress: () => runProGated('document_storage', () => pickAndSave(page)) },
          {
            text: 'Remove', style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Remove scan?',
                'This deletes the reference from this item. The image stays in the backup file if you already exported one.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove', style: 'destructive',
                    onPress: () => {
                      writeScan(kind, ownerId, page, null);
                      onChange();
                    },
                  },
                ],
              );
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      runProGated('document_storage', () => pickAndSave(page));
    }
  }

  const scannedLabel = scannedAt
    ? `Last scan: ${formatScanned(scannedAt)}`
    : 'Keep the filed form and approved stamp on file with this item.';

  return (
    <>
      <Text style={s.sectionLabel}>ATF FORM ON FILE</Text>
      <View style={s.card}>
        <Text style={s.helper}>{scannedLabel}</Text>
        <View style={s.slotRow}>
          <Slot
            title="FILED FORM"
            sub="Front of the form you submitted"
            uri={frontUri}
            onPress={() => handleSlotTap('front', frontUri)}
          />
          <Slot
            title="APPROVED STAMP"
            sub="Approved back page / tax stamp"
            uri={backUri}
            onPress={() => handleSlotTap('back', backUri)}
          />
        </View>
      </View>

      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <Pressable style={s.viewerBackdrop} onPress={() => setViewerUri(null)}>
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={s.viewerImage} resizeMode="contain" />
          ) : <ActivityIndicator color={GOLD} />}
          <Text style={s.viewerHint}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </>
  );
}

function formatScanned(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch { return iso; }
}

function Slot({
  title, sub, uri, onPress,
}: {
  title: string; sub: string; uri: string | null; onPress: () => void;
}) {
  const resolved = resolveImageUri(uri);
  return (
    <TouchableOpacity style={s.slot} onPress={onPress} activeOpacity={0.8}>
      {resolved ? (
        <Image source={{ uri: resolved }} style={s.slotImage} resizeMode="cover" />
      ) : (
        <View style={s.slotEmpty}>
          <Text style={s.slotPlus}>+</Text>
          <Text style={s.slotPlusSub}>Tap to scan</Text>
        </View>
      )}
      <View style={s.slotLabelWrap}>
        <Text style={s.slotTitle}>{title}</Text>
        <Text style={s.slotSub}>{uri ? 'On file · tap to manage' : sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  sectionLabel: {
    color: GOLD, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, marginBottom: 8, marginTop: 18,
    marginHorizontal: 16,
  },
  card: {
    backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    marginHorizontal: 16, padding: 14,
  },
  helper: { color: '#9C9C9C', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  slotRow: { flexDirection: 'row', gap: 10 },
  slot: {
    flex: 1, borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER, backgroundColor: '#0F0F0F',
  },
  slotImage: { width: '100%', height: 120, backgroundColor: '#000' },
  slotEmpty: {
    width: '100%', height: 120, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  slotPlus: { color: GOLD, fontSize: 34, fontWeight: '200' },
  slotPlusSub: { color: MUTED, fontSize: 11, fontWeight: '600', marginTop: -2 },
  slotLabelWrap: { padding: 10 },
  slotTitle: { color: 'white', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  slotSub: { color: MUTED, fontSize: 10, marginTop: 3 },

  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12,
  },
  viewerImage: { width: '100%', height: '85%' },
  viewerHint: { color: MUTED, fontSize: 12 },
});
