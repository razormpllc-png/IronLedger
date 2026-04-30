// One-time prompt surfaced on the firearm detail screen when ATF Rule 11P
// applies — i.e. the firearm is currently classified as an SBR and carries
// a brace accessory. Two affordances: revert to Handgun (commits the change
// and supersedes the ATF form record) or keep as SBR (silences the banner).
//
// Trigger logic + persistence live in lib/database.ts; this component is
// purely presentational — it renders nothing if `visible` is false.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const GOLD = '#C9A84C';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#9C9C9C';

interface Props {
  visible: boolean;
  onUpdateToPistol: () => void;
  onKeepAsSbr: () => void;
}

export default function BraceReclassificationBanner({
  visible, onUpdateToPistol, onKeepAsSbr,
}: Props) {
  if (!visible) return null;
  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Text style={s.icon}>ⓘ</Text>
        <Text style={s.headline}>Classification may have changed</Text>
      </View>
      <Text style={s.body}>
        ATF no longer classifies pistols with stabilizing braces as SBRs.
        You may want to update this firearm's NFA classification.
      </Text>
      <View style={s.btnRow}>
        <TouchableOpacity
          style={[s.btn, s.btnPrimary]}
          onPress={onUpdateToPistol}
          activeOpacity={0.8}
        >
          <Text style={s.btnPrimaryText}>Update to Pistol</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, s.btnGhost]}
          onPress={onKeepAsSbr}
          activeOpacity={0.8}
        >
          <Text style={s.btnGhostText}>Keep as SBR</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    padding: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  icon: { color: GOLD, fontSize: 18, fontWeight: '700' },
  headline: { color: '#FFF', fontSize: 15, fontWeight: '700', flex: 1 },
  body: { color: MUTED, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: GOLD },
  btnPrimaryText: { color: '#0D0D0D', fontSize: 14, fontWeight: '700' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER },
  btnGhostText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
