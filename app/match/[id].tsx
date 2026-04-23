// Competition match detail — shows match info, results summary, and
// per-stage score breakdown. Supports adding/editing/deleting stages and
// navigating back to edit the match itself.

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Modal, TextInput, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  getCompetitionMatchById, deleteCompetitionMatch,
  getStagesForMatch, insertCompetitionStage, updateCompetitionStage, deleteCompetitionStage,
  getFirearmById, formatDate,
  type CompetitionMatch, type CompetitionStage, type CompetitionStageInput,
  type Firearm,
} from '../../lib/database';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#FF5722';

// Match type accent colors — same idea as armory type badges.
const TYPE_COLORS: Record<string, string> = {
  USPSA: '#4A90D9',
  IDPA: '#D4912A',
  'Steel Challenge': '#8E6FBF',
  Outlaw: '#5DAF5D',
};

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = parseInt(String(id), 10);

  const [match, setMatch] = useState<CompetitionMatch | null>(null);
  const [stages, setStages] = useState<CompetitionStage[]>([]);
  const [firearm, setFirearm] = useState<Firearm | null>(null);

  // Stage editor modal
  const [stageModal, setStageModal] = useState(false);
  const [editingStage, setEditingStage] = useState<CompetitionStage | null>(null);
  const [stageNum, setStageNum] = useState('');
  const [stageName, setStageName] = useState('');
  const [stageTime, setStageTime] = useState('');
  const [stagePoints, setStagePoints] = useState('');
  const [stageHF, setStageHF] = useState('');
  const [stagePenalties, setStagePenalties] = useState('');
  const [stageA, setStageA] = useState('');
  const [stageC, setStageC] = useState('');
  const [stageD, setStageD] = useState('');
  const [stageM, setStageM] = useState('');
  const [stageNS, setStageNS] = useState('');
  const [stageProcedural, setStageProcedural] = useState('');
  const [stagePointsDown, setStagePointsDown] = useState('');
  const [stageScore, setStageScore] = useState('');
  const [stagePlacement, setStagePlacement] = useState('');
  const [stageNotes, setStageNotes] = useState('');

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [matchId])
  );

  function reload() {
    const m = getCompetitionMatchById(matchId);
    setMatch(m);
    if (m) {
      setStages(getStagesForMatch(m.id));
      if (m.firearm_id) {
        try { setFirearm(getFirearmById(m.firearm_id)); } catch { setFirearm(null); }
      } else {
        setFirearm(null);
      }
    }
  }

  function handleDeleteMatch() {
    Alert.alert('Delete match?', 'This removes the match and all stage scores. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteCompetitionMatch(matchId);
          router.back();
        },
      },
    ]);
  }

  // ─── Stage modal ───────────────────────────────────────────────

  function openAddStage() {
    setEditingStage(null);
    const nextNum = stages.length > 0 ? Math.max(...stages.map(s => s.stage_number)) + 1 : 1;
    setStageNum(String(nextNum));
    setStageName('');
    setStageTime('');
    setStagePoints('');
    setStageHF('');
    setStagePenalties('');
    setStageA(''); setStageC(''); setStageD(''); setStageM(''); setStageNS('');
    setStageProcedural('');
    setStagePointsDown('');
    setStageScore('');
    setStagePlacement('');
    setStageNotes('');
    setStageModal(true);
  }

  function openEditStage(stage: CompetitionStage) {
    setEditingStage(stage);
    setStageNum(String(stage.stage_number));
    setStageName(stage.stage_name ?? '');
    setStageTime(stage.time != null ? String(stage.time) : '');
    setStagePoints(stage.points != null ? String(stage.points) : '');
    setStageHF(stage.hit_factor != null ? String(stage.hit_factor) : '');
    setStagePenalties(stage.penalties ? String(stage.penalties) : '');
    setStageA(stage.a_hits != null ? String(stage.a_hits) : '');
    setStageC(stage.c_hits != null ? String(stage.c_hits) : '');
    setStageD(stage.d_hits != null ? String(stage.d_hits) : '');
    setStageM(stage.m_hits != null ? String(stage.m_hits) : '');
    setStageNS(stage.ns_hits != null ? String(stage.ns_hits) : '');
    setStageProcedural(stage.procedural ? String(stage.procedural) : '');
    setStagePointsDown(stage.points_down != null ? String(stage.points_down) : '');
    setStageScore(stage.stage_score != null ? String(stage.stage_score) : '');
    setStagePlacement(stage.stage_placement != null ? String(stage.stage_placement) : '');
    setStageNotes(stage.notes ?? '');
    setStageModal(true);
  }

  function handleSaveStage() {
    const num = parseInt(stageNum);
    if (!num || num < 1) {
      Alert.alert('Invalid stage number');
      return;
    }

    const input: CompetitionStageInput = {
      match_id: matchId,
      stage_number: num,
      stage_name: stageName.trim() || null,
      time: stageTime ? parseFloat(stageTime) : null,
      points: stagePoints ? parseFloat(stagePoints) : null,
      hit_factor: stageHF ? parseFloat(stageHF) : null,
      penalties: stagePenalties ? parseInt(stagePenalties) : 0,
      a_hits: stageA ? parseInt(stageA) : null,
      c_hits: stageC ? parseInt(stageC) : null,
      d_hits: stageD ? parseInt(stageD) : null,
      m_hits: stageM ? parseInt(stageM) : null,
      ns_hits: stageNS ? parseInt(stageNS) : null,
      procedural: stageProcedural ? parseInt(stageProcedural) : 0,
      points_down: stagePointsDown ? parseFloat(stagePointsDown) : null,
      stage_score: stageScore ? parseFloat(stageScore) : null,
      stage_placement: stagePlacement ? parseInt(stagePlacement) : null,
      notes: stageNotes.trim() || null,
    };

    try {
      if (editingStage) {
        updateCompetitionStage(editingStage.id, input);
      } else {
        insertCompetitionStage(input);
      }
      setStageModal(false);
      reload();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save stage.');
    }
  }

  function handleDeleteStage(stage: CompetitionStage) {
    Alert.alert('Delete stage?', `Remove Stage ${stage.stage_number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteCompetitionStage(stage.id);
          reload();
        },
      },
    ]);
  }

  if (!match) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backText}>‹ Back</Text>
          </TouchableOpacity>
        </View>
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>Match not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const typeColor = TYPE_COLORS[match.match_type] ?? MUTED;
  const firearmLabel = firearm
    ? (firearm.nickname?.trim() || `${firearm.make} ${firearm.model}`.trim())
    : null;

  const isUSPSA = match.match_type === 'USPSA';
  const isIDPA = match.match_type === 'IDPA';

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={() => router.push(`/add-match?id=${match.id}`)}>
            <Text style={s.editText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteMatch}>
            <Text style={s.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* Match header */}
        <View style={s.matchHeader}>
          <View style={[s.typeBadge, { backgroundColor: typeColor + '22', borderColor: typeColor }]}>
            <Text style={[s.typeBadgeText, { color: typeColor }]}>{match.match_type}</Text>
          </View>
          <Text style={s.matchName}>{match.match_name}</Text>
          <Text style={s.matchDate}>{formatDate(match.match_date) ?? match.match_date}</Text>
          {match.location ? <Text style={s.matchLocation}>{match.location}</Text> : null}
        </View>

        {/* Results summary */}
        <View style={s.resultsStrip}>
          {match.overall_placement != null ? (
            <ResultStat label="Overall" value={`#${match.overall_placement}`} accent />
          ) : null}
          {match.division_placement != null ? (
            <ResultStat label="Division" value={`#${match.division_placement}`} />
          ) : null}
          {match.overall_hit_factor != null ? (
            <ResultStat label="Hit Factor" value={match.overall_hit_factor.toFixed(4)} />
          ) : null}
          {match.overall_score != null ? (
            <ResultStat label="Score" value={String(match.overall_score)} />
          ) : null}
        </View>

        {/* Details card */}
        <View style={s.card}>
          {match.division ? (
            <DetailRow label="Division" value={match.division} />
          ) : null}
          {match.classification ? (
            <DetailRow label="Class" value={match.classification} />
          ) : null}
          {firearmLabel ? (
            <DetailRow label="Firearm" value={firearmLabel} />
          ) : null}
          {match.total_stages != null ? (
            <DetailRow label="Stages" value={String(match.total_stages)} />
          ) : null}
          {match.practiscore_url ? (
            <TouchableOpacity onPress={() => Linking.openURL(match.practiscore_url!)}>
              <DetailRow label="PractiScore" value="Open Link ↗" valueColor={GOLD} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Notes */}
        {match.squad_notes ? (
          <View style={s.card}>
            <Text style={s.notesLabel}>SQUAD NOTES</Text>
            <Text style={s.notesText}>{match.squad_notes}</Text>
          </View>
        ) : null}
        {match.notes ? (
          <View style={s.card}>
            <Text style={s.notesLabel}>MATCH NOTES</Text>
            <Text style={s.notesText}>{match.notes}</Text>
          </View>
        ) : null}

        {/* Stages */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>STAGES ({stages.length})</Text>
          <TouchableOpacity onPress={openAddStage}>
            <Text style={s.addStageText}>+ Add Stage</Text>
          </TouchableOpacity>
        </View>

        {stages.length === 0 ? (
          <View style={s.stageEmpty}>
            <Text style={s.stageEmptyText}>No stages logged yet.</Text>
            <Text style={s.stageEmptyHint}>Tap "+ Add Stage" to enter per-stage scores.</Text>
          </View>
        ) : (
          stages.map((stage) => (
            <TouchableOpacity
              key={stage.id}
              style={s.stageCard}
              onPress={() => openEditStage(stage)}
              onLongPress={() => handleDeleteStage(stage)}
              activeOpacity={0.75}
            >
              <View style={s.stageNumBadge}>
                <Text style={s.stageNumText}>{stage.stage_number}</Text>
              </View>
              <View style={s.stageBody}>
                <Text style={s.stageTitle}>
                  {stage.stage_name || `Stage ${stage.stage_number}`}
                </Text>
                <View style={s.stageMetaRow}>
                  {stage.time != null ? (
                    <Text style={s.stageMeta}>{stage.time.toFixed(2)}s</Text>
                  ) : null}
                  {stage.hit_factor != null ? (
                    <Text style={s.stageMeta}>HF {stage.hit_factor.toFixed(4)}</Text>
                  ) : null}
                  {stage.points != null ? (
                    <Text style={s.stageMeta}>{stage.points} pts</Text>
                  ) : null}
                  {stage.points_down != null ? (
                    <Text style={s.stageMeta}>{stage.points_down} down</Text>
                  ) : null}
                  {stage.stage_placement != null ? (
                    <Text style={s.stageMeta}>#{stage.stage_placement}</Text>
                  ) : null}
                </View>
                {/* Hit breakdown for USPSA */}
                {isUSPSA && (stage.a_hits != null || stage.c_hits != null || stage.d_hits != null || stage.m_hits != null) ? (
                  <View style={s.stageHitsRow}>
                    {stage.a_hits != null ? <Text style={s.hitBadgeA}>A:{stage.a_hits}</Text> : null}
                    {stage.c_hits != null ? <Text style={s.hitBadgeC}>C:{stage.c_hits}</Text> : null}
                    {stage.d_hits != null ? <Text style={s.hitBadgeD}>D:{stage.d_hits}</Text> : null}
                    {stage.m_hits != null ? <Text style={s.hitBadgeM}>M:{stage.m_hits}</Text> : null}
                    {stage.ns_hits != null && stage.ns_hits > 0 ? <Text style={s.hitBadgeM}>NS:{stage.ns_hits}</Text> : null}
                  </View>
                ) : null}
                {stage.penalties > 0 || stage.procedural > 0 ? (
                  <Text style={s.penaltyText}>
                    {[
                      stage.penalties > 0 ? `${stage.penalties} penalty` : '',
                      stage.procedural > 0 ? `${stage.procedural} procedural` : '',
                    ].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* ─── Stage Editor Modal ─────────────────────────────── */}
      <Modal visible={stageModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setStageModal(false)}>
                <Text style={s.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.modalTitle}>
                {editingStage ? `Edit Stage ${editingStage.stage_number}` : 'Add Stage'}
              </Text>
              <TouchableOpacity onPress={handleSaveStage}>
                <Text style={s.modalSave}>Save</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
              <View style={s.modalRow}>
                <ModalField label="Stage #" value={stageNum} onChange={setStageNum} keyboardType="number-pad" width={80} />
                <ModalField label="Name" value={stageName} onChange={setStageName} placeholder="e.g. El Prez" flex />
              </View>

              <Text style={s.modalSectionLabel}>RESULTS</Text>
              <View style={s.modalRow}>
                <ModalField label="Time (s)" value={stageTime} onChange={setStageTime} keyboardType="decimal-pad" flex />
                <ModalField label="Points" value={stagePoints} onChange={setStagePoints} keyboardType="decimal-pad" flex />
                <ModalField label="Hit Factor" value={stageHF} onChange={setStageHF} keyboardType="decimal-pad" flex />
              </View>
              <View style={s.modalRow}>
                <ModalField label="Stage Score" value={stageScore} onChange={setStageScore} keyboardType="decimal-pad" flex />
                <ModalField label="Placement" value={stagePlacement} onChange={setStagePlacement} keyboardType="number-pad" flex />
              </View>

              {(isUSPSA || isIDPA) ? (
                <>
                  <Text style={s.modalSectionLabel}>
                    {isUSPSA ? 'HITS (A / C / D / M / NS)' : 'POINTS DOWN'}
                  </Text>
                  {isUSPSA ? (
                    <View style={s.modalRow}>
                      <ModalField label="A" value={stageA} onChange={setStageA} keyboardType="number-pad" flex />
                      <ModalField label="C" value={stageC} onChange={setStageC} keyboardType="number-pad" flex />
                      <ModalField label="D" value={stageD} onChange={setStageD} keyboardType="number-pad" flex />
                      <ModalField label="M" value={stageM} onChange={setStageM} keyboardType="number-pad" flex />
                      <ModalField label="NS" value={stageNS} onChange={setStageNS} keyboardType="number-pad" flex />
                    </View>
                  ) : (
                    <View style={s.modalRow}>
                      <ModalField label="Points Down" value={stagePointsDown} onChange={setStagePointsDown} keyboardType="decimal-pad" flex />
                    </View>
                  )}
                </>
              ) : null}

              <Text style={s.modalSectionLabel}>PENALTIES</Text>
              <View style={s.modalRow}>
                <ModalField label="Penalties" value={stagePenalties} onChange={setStagePenalties} keyboardType="number-pad" flex />
                <ModalField label="Procedurals" value={stageProcedural} onChange={setStageProcedural} keyboardType="number-pad" flex />
              </View>

              <Text style={s.modalSectionLabel}>NOTES</Text>
              <TextInput
                style={s.modalNotesInput}
                value={stageNotes}
                onChangeText={setStageNotes}
                placeholder="Stage notes…"
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={3}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function ResultStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={s.resultCell}>
      <Text style={[s.resultValue, accent && { color: GOLD, fontSize: 20 }]}>{value}</Text>
      <Text style={s.resultLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

function ModalField({ label, value, onChange, placeholder, keyboardType, width, flex }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; width?: number; flex?: boolean;
}) {
  return (
    <View style={[{ marginBottom: 10 }, width ? { width } : flex ? { flex: 1 } : undefined]}>
      <Text style={s.modalFieldLabel}>{label}</Text>
      <TextInput
        style={s.modalFieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? '—'}
        placeholderTextColor={MUTED}
        keyboardType={keyboardType ?? 'default'}
        autoCorrect={false}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backText: { color: GOLD, fontSize: 16, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 16 },
  editText: { color: GOLD, fontSize: 15, fontWeight: '600' },
  deleteText: { color: DANGER, fontSize: 15, fontWeight: '600' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },

  // Match header
  matchHeader: { marginBottom: 16, alignItems: 'flex-start' },
  typeBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, marginBottom: 8,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  matchName: { color: '#FFF', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  matchDate: { color: '#AAA', fontSize: 14 },
  matchLocation: { color: MUTED, fontSize: 13, marginTop: 2 },

  // Results strip
  resultsStrip: {
    flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap',
  },
  resultCell: {
    flex: 1, minWidth: 70, backgroundColor: SURFACE, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER, paddingVertical: 12, alignItems: 'center',
  },
  resultValue: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  resultLabel: {
    color: MUTED, fontSize: 9, fontWeight: '700',
    letterSpacing: 0.6, marginTop: 4, textTransform: 'uppercase',
  },

  // Details card
  card: {
    backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    marginBottom: 12, overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  detailLabel: { color: '#AAA', fontSize: 13 },
  detailValue: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  // Notes
  notesLabel: {
    color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 1,
    paddingHorizontal: 14, paddingTop: 12, marginBottom: 4,
  },
  notesText: { color: '#CCC', fontSize: 13, lineHeight: 19, paddingHorizontal: 14, paddingBottom: 12 },

  // Stages section
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, marginBottom: 12,
  },
  sectionLabel: {
    color: GOLD, fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
  },
  addStageText: { color: GOLD, fontSize: 13, fontWeight: '600' },

  stageEmpty: {
    backgroundColor: SURFACE, borderRadius: 10, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  stageEmptyText: { color: '#AAA', fontSize: 14, fontWeight: '600' },
  stageEmptyHint: { color: MUTED, fontSize: 12, marginTop: 4, textAlign: 'center' },

  stageCard: {
    backgroundColor: SURFACE, borderRadius: 10, flexDirection: 'row',
    alignItems: 'center', padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: BORDER,
  },
  stageNumBadge: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  stageNumText: { color: GOLD, fontSize: 15, fontWeight: '800' },
  stageBody: { flex: 1 },
  stageTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  stageMetaRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  stageMeta: { color: '#AAA', fontSize: 12 },
  stageHitsRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  hitBadgeA: {
    color: '#4CAF50', fontSize: 11, fontWeight: '700',
    backgroundColor: 'rgba(76,175,80,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  hitBadgeC: {
    color: '#FFC107', fontSize: 11, fontWeight: '700',
    backgroundColor: 'rgba(255,193,7,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  hitBadgeD: {
    color: '#FF9800', fontSize: 11, fontWeight: '700',
    backgroundColor: 'rgba(255,152,0,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  hitBadgeM: {
    color: DANGER, fontSize: 11, fontWeight: '700',
    backgroundColor: 'rgba(255,87,34,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  penaltyText: { color: DANGER, fontSize: 11, marginTop: 3 },
  chevron: { color: '#444', fontSize: 22, fontWeight: '300', marginLeft: 8 },

  // Empty state (match not found)
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },

  // ─── Stage Modal ───────────────────────────────────────────
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: BG, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalCancel: { color: MUTED, fontSize: 15 },
  modalTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  modalSave: { color: GOLD, fontSize: 15, fontWeight: '700' },
  modalBody: { padding: 16, paddingBottom: 40 },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalSectionLabel: {
    color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 1,
    marginTop: 12, marginBottom: 6,
  },
  modalFieldLabel: { color: '#AAA', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  modalFieldInput: {
    backgroundColor: SURFACE, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    color: '#FFF', fontSize: 14, paddingHorizontal: 10, paddingVertical: 10,
  },
  modalNotesInput: {
    backgroundColor: SURFACE, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    color: '#FFF', fontSize: 14, paddingHorizontal: 10, paddingVertical: 10,
    minHeight: 60, textAlignVertical: 'top',
  },
});
