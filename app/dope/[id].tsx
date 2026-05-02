// DOPE card detail — renders each entry as a rifle data card that mimics
// the classic USMC paper Rifle Data Card layout:
//
//   ┌───────────────────────────────────────────────┬──────────────────┐
//   │ RIFLE DATA CARD    DISTANCE ___ M / ___ YD    │  ELEV / WIND     │
//   ├──────────┬──────────────────────────────────┬─┘   USED  CORRECT  │
//   │ RANGE    │ RIFLE AND SCOPE DESC             │                    │
//   ├──────┬───┴──┬────────┬───────┬──────┬──────┐                    │
//   │ AMMO │ LIGHT│ MIRAGE │ TEMP  │ HOUR │ HOLD │                    │
//   ├──────┴──────┼────────┴───────┴──────┴──────┘                    │
//   │ LIGHT CLOCK │ WIND CLOCK (vel / direction)   TARGET + SHOT PLC   │
//   ├─────────────┴────────────────────────────────────────────────────┤
//   │ SHOT  1  2  3  4  5  6  7  8  9 10     REMARKS                   │
//   │ ELEV  …                                                          │
//   │ WIND  …                                                          │
//   │ CALL  …                                                          │
//   ├──────────────────────────────────────────────────────────────────┤
//   │  [1] [2] [3] [4] [5] [6] [7] [8] [9] [10]                        │
//   └──────────────────────────────────────────────────────────────────┘
//
// We stretch the layout vertically to fit a phone — rows stack, but the
// visual feel (cream paper, black rules, stencil caps) is preserved.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getDopeCardById, getFirearmById, deleteDopeCard,
  getDopeEntriesForCard, insertDopeEntry, updateDopeEntry, deleteDopeEntry,
  DopeCard, DopeEntry, DopeShot, Firearm,
} from '../../lib/database';
import { useFeatureGate } from '../../hooks/useFeatureGate';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const DANGER = '#FF5722';

// Paper-card palette — evokes a photocopied rifle data card on the phone.
const PAPER = '#F5F1E6';
const INK = '#0B0B0B';
const INK_SOFT = '#3D3D3D';
const RULE = '#1C1C1C';

const SHOT_COUNT = 10;

function parseShots(json: string | null): DopeShot[] {
  if (!json) return emptyShots();
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return emptyShots();
    const out: DopeShot[] = [];
    for (let i = 0; i < SHOT_COUNT; i++) {
      const s = arr[i] ?? {};
      out.push({
        elev: typeof s.elev === 'string' ? s.elev : null,
        wind: typeof s.wind === 'string' ? s.wind : null,
        called: typeof s.called === 'string' ? s.called : null,
      });
    }
    return out;
  } catch {
    return emptyShots();
  }
}

function emptyShots(): DopeShot[] {
  return Array.from({ length: SHOT_COUNT }, () => ({ elev: null, wind: null, called: null }));
}

function shotsEmpty(shots: DopeShot[]): boolean {
  return shots.every((s) => !s.elev && !s.wind && !s.called);
}

export default function DopeDetailScreen() {
  useFeatureGate('vaultpro');
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardId = parseInt(String(id), 10);

  const [card, setCard] = useState<DopeCard | null>(null);
  const [firearm, setFirearm] = useState<Firearm | null>(null);
  const [entries, setEntries] = useState<DopeEntry[]>([]);
  const [editing, setEditing] = useState<DopeEntry | 'new' | null>(null);

  const load = useCallback(() => {
    try {
      const c = getDopeCardById(cardId);
      if (!c) {
        router.back();
        return;
      }
      setCard(c);
      setFirearm(getFirearmById(c.firearm_id));
      setEntries(getDopeEntriesForCard(cardId));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load DOPE card.');
    }
  }, [cardId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rifleScopeDesc = useMemo(() => {
    if (!firearm) return '';
    const name = firearm.nickname?.trim()
      || [firearm.make, firearm.model].filter(Boolean).join(' ').trim()
      || `Firearm #${firearm.id}`;
    const parts: string[] = [name];
    if (firearm.caliber) parts.push(firearm.caliber);
    if (card?.scope_notes) parts.push(card.scope_notes);
    return parts.join(' · ');
  }, [firearm, card]);

  function handleDeleteCard() {
    if (!card) return;
    Alert.alert(
      'Delete DOPE card?',
      `This removes "${card.name}" and every entry on it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteDopeCard(card.id);
            router.back();
          },
        },
      ],
    );
  }

  // ── Export helpers ──────────────────────────────────────────
  async function exportAsCSV() {
    if (!card) return;
    const unitLabel = card.units === 'moa' ? 'MOA' : card.units === 'mils' ? 'MILS' : 'IPHY';
    const rows: string[] = [
      `"Distance (yd)","Elevation (${unitLabel})","Windage (${unitLabel})","Notes"`,
    ];
    for (const e of entries) {
      const dist = String(e.distance_yards);
      const elev = e.elevation != null ? String(e.elevation) : '';
      const wind = e.windage != null ? String(e.windage) : '';
      const notes = (e.notes ?? '').replace(/"/g, '""');
      rows.push(`${dist},${elev},${wind},"${notes}"`);
    }
    const csv = rows.join('\n');
    const filename = `${card.name.replace(/[^a-zA-Z0-9]/g, '_')}_DOPE.csv`;
    const path = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(path, csv);
    await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  }

  async function exportAsPDF() {
    if (!card) return;
    const unitLabel = card.units === 'moa' ? 'MOA' : card.units === 'mils' ? 'MILS' : 'IPHY';
    const gunDesc = rifleScopeDesc || 'Unknown Firearm';
    const entryRows = entries.map((e) => `
      <tr>
        <td style="font-weight:700;text-align:center">${e.distance_yards}</td>
        <td style="text-align:center">${e.elevation ?? '—'}</td>
        <td style="text-align:center">${e.windage ?? '—'}</td>
        <td style="font-size:9px;color:#555">${e.notes ?? ''}</td>
      </tr>`).join('');

    const html = `
      <html><head><style>
        body { font-family: 'Courier New', monospace; margin: 20px; color: #111; }
        h1 { font-size: 18px; text-transform: uppercase; letter-spacing: 2px; border-bottom: 3px solid #000; padding-bottom: 6px; margin-bottom: 4px; }
        .meta { font-size: 11px; color: #444; margin-bottom: 16px; }
        .meta span { margin-right: 18px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #111; color: #fff; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; text-align: center; }
        td { padding: 6px 8px; border-bottom: 1px solid #ccc; font-size: 12px; }
        tr:nth-child(even) { background: #f5f1e6; }
        .footer { margin-top: 20px; font-size: 9px; color: #999; text-align: center; }
      </style></head><body>
        <h1>${card.name}</h1>
        <div class="meta">
          <span><b>Firearm:</b> ${gunDesc}</span>
          ${card.ammo_description ? `<span><b>Ammo:</b> ${card.ammo_description}</span>` : ''}
          ${card.zero_distance_yards ? `<span><b>Zero:</b> ${card.zero_distance_yards} yd</span>` : ''}
          <span><b>Units:</b> ${unitLabel}</span>
        </div>
        <table>
          <tr>
            <th style="width:15%">Dist (yd)</th>
            <th style="width:20%">Elev (${unitLabel})</th>
            <th style="width:20%">Wind (${unitLabel})</th>
            <th>Notes</th>
          </tr>
          ${entryRows}
        </table>
        <div class="footer">Exported from Iron Ledger</div>
      </body></html>
    `;

    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }

  function handleExport() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Export as PDF', 'Export as CSV', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) exportAsPDF().catch((e) => Alert.alert('Export Failed', String(e)));
          if (idx === 1) exportAsCSV().catch((e) => Alert.alert('Export Failed', String(e)));
        },
      );
    } else {
      Alert.alert('Export DOPE Card', 'Choose a format', [
        { text: 'PDF', onPress: () => exportAsPDF().catch((e) => Alert.alert('Export Failed', String(e))) },
        { text: 'CSV', onPress: () => exportAsCSV().catch((e) => Alert.alert('Export Failed', String(e))) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  if (!card) {
    return <SafeAreaView style={s.container} />;
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{card.name}</Text>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <TouchableOpacity onPress={handleExport}>
            <Text style={s.edit}>⇪</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/dope-card?id=${card.id}`)}>
            <Text style={s.edit}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={s.content} showsVerticalScrollIndicator={false}>
        {/* Top-level summary badges for context in the dark-app chrome */}
        <View style={s.summary}>
          <Text style={s.summaryAmmo}>
            {card.ammo_description ?? rifleScopeDesc}
          </Text>
          <View style={s.summaryRow}>
            <SummaryPill
              label="ZERO"
              value={card.zero_distance_yards != null ? `${card.zero_distance_yards} yd` : '—'}
            />
            <SummaryPill label="UNITS" value={card.units} />
            <SummaryPill label="ENTRIES" value={String(entries.length)} />
          </View>
        </View>

        {entries.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No data cards filled yet</Text>
            <Text style={s.emptySub}>
              Tap + to fill a rifle data card for a distance you've shot.
            </Text>
          </View>
        ) : (
          entries.map((entry) => (
            <TouchableOpacity
              key={entry.id}
              activeOpacity={0.9}
              onPress={() => setEditing(entry)}
            >
              <PaperDopeCard
                card={card}
                entry={entry}
                rifleScopeDesc={rifleScopeDesc}
              />
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity style={s.deleteCardBtn} onPress={handleDeleteCard}>
          <Text style={s.deleteCardText}>Delete DOPE card</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>

      <TouchableOpacity
        style={s.fab}
        onPress={() => setEditing('new')}
        activeOpacity={0.8}
      >
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>

      <EntryEditor
        visible={editing !== null}
        entry={editing === 'new' ? null : editing}
        cardId={card.id}
        unitLabel={card.units}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// PaperDopeCard — the heart of this screen. Styled to look like the USMC
// rifle data card printed on cream paper.
// ---------------------------------------------------------------------------

function PaperDopeCard({
  card, entry, rifleScopeDesc,
}: {
  card: DopeCard;
  entry: DopeEntry;
  rifleScopeDesc: string;
}) {
  const shots = parseShots(entry.shots_json);
  const meters = Math.round(entry.distance_yards * 0.9144);
  const unit = card.units;

  return (
    <View style={p.card}>
      {/* ── Top bar: title + distance ─────────────────────────── */}
      <View style={p.topBar}>
        <Text style={p.titleCell}>RIFLE DATA CARD</Text>
        <View style={p.distanceCell}>
          <Text style={p.fieldLabel}>DISTANCE TO TARGET</Text>
          <View style={p.distanceRow}>
            <Text style={p.distanceValue}>{meters}</Text>
            <Text style={p.distanceUnit}>M.</Text>
            <Text style={p.distanceValue}>{entry.distance_yards}</Text>
            <Text style={p.distanceUnit}>YD.</Text>
          </View>
        </View>
      </View>

      {/* ── Range / Rifle+Scope / Elevation / Windage ─────────── */}
      <View style={p.row}>
        <Cell flex={1} label="RANGE" value={entry.range_name} />
        <Cell flex={2} label="RIFLE AND SCOPE DESC" value={rifleScopeDesc} />
        <SplitCell
          flex={1.4}
          heading="ELEVATION"
          leftLabel="USED"
          rightLabel="CORRECT"
          leftValue={fmtNum(entry.elevation, unit)}
          rightValue={fmtNum(entry.elevation_correct, unit)}
        />
        <SplitCell
          flex={1.4}
          heading="WINDAGE"
          leftLabel="USED"
          rightLabel="CORRECT"
          leftValue={fmtNum(entry.windage, unit)}
          rightValue={fmtNum(entry.windage_correct, unit)}
        />
      </View>

      {/* ── Conditions strip: AMMO | LIGHT | MIRAGE | TEMP | HOUR | HOLD ── */}
      <View style={p.row}>
        <Cell flex={1.4} label="AMMO" value={card.ammo_description} />
        <Cell flex={1} label="LIGHT" value={entry.light} />
        <Cell flex={1} label="MIRAGE" value={entry.mirage} />
        <Cell flex={1} label="TEMP" value={entry.temperature} />
        <Cell flex={1} label="HOUR" value={entry.hour_time} />
        <Cell flex={1} label="HOLD" value={entry.hold} />
      </View>

      {/* ── Clocks row: LIGHT CONDITIONS / WIND CONDITIONS / TARGET ── */}
      <View style={p.row}>
        <View style={[p.cell, { flex: 1.2 }]}>
          <Text style={p.cellLabel}>LIGHT CONDITIONS</Text>
          <ClockDiagram hour={entry.light_clock} />
        </View>
        <View style={[p.cell, { flex: 1.4 }]}>
          <Text style={p.cellLabel}>WIND CONDITIONS</Text>
          <ClockDiagram hour={entry.wind_clock} />
          <View style={p.windSub}>
            <Text style={p.windSubText}>
              VELOCITY {entry.wind_velocity?.trim() || '—'}
            </Text>
            <Text style={p.windSubText}>
              DIRECTION {entry.wind_clock ? `${entry.wind_clock} o'clock` : '—'}
            </Text>
          </View>
        </View>
        <View style={[p.cell, { flex: 1.4 }]}>
          <Text style={p.cellLabel}>TARGET SKETCH · SHOT PLACEMENT</Text>
          <ShotPlacementDots />
        </View>
      </View>

      {/* ── Shot grid: 10 shots × [ELEV / WIND / SHOT CALLED] ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={p.gridRow}>
            <GridHead label="SHOT" width={52} />
            {shots.map((_, i) => (
              <GridHead key={i} label={String(i + 1)} width={42} />
            ))}
            <GridHead label="REMARKS" width={140} borderRight={false} />
          </View>
          <View style={p.gridRow}>
            <GridLabel label="ELEV" width={52} />
            {shots.map((sh, i) => (
              <GridValue key={`e${i}`} value={sh.elev} width={42} />
            ))}
            <GridValue value={entry.notes} width={140} borderRight={false} multiline />
          </View>
          <View style={p.gridRow}>
            <GridLabel label="WIND" width={52} />
            {shots.map((sh, i) => (
              <GridValue key={`w${i}`} value={sh.wind} width={42} />
            ))}
            <GridValue value={null} width={140} borderRight={false} />
          </View>
          <View style={[p.gridRow, { minHeight: 56 }]}>
            <GridLabel label="SHOT\nCALLED" width={52} multiline />
            {shots.map((sh, i) => (
              <GridValue key={`c${i}`} value={sh.called} width={42} multiline />
            ))}
            <GridValue value={null} width={140} borderRight={false} />
          </View>
        </View>
      </ScrollView>

      {/* ── Bottom row: ten numbered shot placement cells ─────────────── */}
      <View style={p.placementRow}>
        {Array.from({ length: SHOT_COUNT }).map((_, i) => (
          <View key={i} style={p.placementCell}>
            <Text style={p.placementNum}>{i + 1}</Text>
          </View>
        ))}
      </View>

      <Text style={p.footer}>
        Tap card to edit. Long-press ↓ to delete.
      </Text>
    </View>
  );
}

function fmtNum(v: number | null, unit: string): string {
  if (v == null) return '';
  return `${v} ${unit}`;
}

function Cell({
  flex, label, value,
}: { flex: number; label: string; value: string | null | undefined }) {
  return (
    <View style={[p.cell, { flex }]}>
      <Text style={p.cellLabel}>{label}</Text>
      <Text style={p.cellValue}>{value && value.trim() ? value : ' '}</Text>
    </View>
  );
}

function SplitCell({
  flex, heading, leftLabel, rightLabel, leftValue, rightValue,
}: {
  flex: number;
  heading: string;
  leftLabel: string;
  rightLabel: string;
  leftValue: string;
  rightValue: string;
}) {
  return (
    <View style={[p.cell, { flex }]}>
      <Text style={p.cellLabel}>{heading}</Text>
      <View style={p.splitRow}>
        <View style={p.splitHalf}>
          <Text style={p.splitLabel}>{leftLabel}</Text>
          <Text style={p.splitValue}>{leftValue || ' '}</Text>
        </View>
        <View style={[p.splitHalf, p.splitHalfBorder]}>
          <Text style={p.splitLabel}>{rightLabel}</Text>
          <Text style={p.splitValue}>{rightValue || ' '}</Text>
        </View>
      </View>
    </View>
  );
}

function ClockDiagram({ hour }: { hour: number | null }) {
  // Simple clock: a ring with 12/3/6/9 labeled and a marker on the chosen hour.
  const SIZE = 66;
  const R = SIZE / 2 - 4;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const h = hour && hour >= 1 && hour <= 12 ? hour : null;
  // 12 o'clock is top. Each hour = 30°. Convert to radians with -π/2 offset.
  const angle = h != null ? ((h % 12) * 30 - 90) * (Math.PI / 180) : null;
  const mx = angle != null ? cx + R * 0.72 * Math.cos(angle) : null;
  const my = angle != null ? cy + R * 0.72 * Math.sin(angle) : null;

  return (
    <View style={[p.clockWrap, { width: SIZE + 6, height: SIZE + 6 }]}>
      <View style={[p.clockRing, { width: SIZE, height: SIZE, borderRadius: SIZE / 2 }]}>
        <Text style={[p.clockNum, { top: 2, left: SIZE / 2 - 4 }]}>12</Text>
        <Text style={[p.clockNum, { top: SIZE / 2 - 6, right: 3 }]}>3</Text>
        <Text style={[p.clockNum, { bottom: 2, left: SIZE / 2 - 3 }]}>6</Text>
        <Text style={[p.clockNum, { top: SIZE / 2 - 6, left: 3 }]}>9</Text>
        {mx != null && my != null ? (
          <View
            style={[
              p.clockMark,
              { left: mx - 4, top: my - 4 },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

function ShotPlacementDots() {
  return (
    <View style={p.placementMini}>
      <View style={p.placementTarget} />
      <Text style={p.placementNote}>Tap entry to mark shots</Text>
    </View>
  );
}

function GridHead({
  label, width, borderRight = true,
}: { label: string; width: number; borderRight?: boolean }) {
  return (
    <View style={[
      p.gridCell,
      p.gridHead,
      { width },
      !borderRight && { borderRightWidth: 0 },
    ]}>
      <Text style={p.gridHeadText}>{label}</Text>
    </View>
  );
}

function GridLabel({
  label, width, multiline,
}: { label: string; width: number; multiline?: boolean }) {
  return (
    <View style={[p.gridCell, p.gridHead, { width }]}>
      <Text style={p.gridHeadText}>{label.replace(/\\n/g, '\n')}</Text>
    </View>
  );
}

function GridValue({
  value, width, borderRight = true, multiline,
}: { value: string | null; width: number; borderRight?: boolean; multiline?: boolean }) {
  return (
    <View style={[
      p.gridCell,
      { width },
      !borderRight && { borderRightWidth: 0 },
    ]}>
      <Text
        style={p.gridValueText}
        numberOfLines={multiline ? 3 : 1}
      >
        {value && value.trim() ? value : ' '}
      </Text>
    </View>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.pill}>
      <Text style={s.pillLabel}>{label}</Text>
      <Text style={s.pillValue}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Entry editor modal — fuller form now matching the paper card's fields.
// ---------------------------------------------------------------------------

function EntryEditor({
  visible, entry, cardId, unitLabel, onClose, onSaved,
}: {
  visible: boolean;
  entry: DopeEntry | null;
  cardId: number;
  unitLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [distance, setDistance] = useState('');
  const [rangeName, setRangeName] = useState('');
  const [light, setLight] = useState('');
  const [mirage, setMirage] = useState('');
  const [temperature, setTemperature] = useState('');
  const [hour, setHour] = useState('');
  const [hold, setHold] = useState('');
  const [elevUsed, setElevUsed] = useState('');
  const [elevCorrect, setElevCorrect] = useState('');
  const [windUsed, setWindUsed] = useState('');
  const [windCorrect, setWindCorrect] = useState('');
  const [windVelocity, setWindVelocity] = useState('');
  const [windClock, setWindClock] = useState<number | null>(null);
  const [lightClock, setLightClock] = useState<number | null>(null);
  const [remarks, setRemarks] = useState('');
  const [shots, setShots] = useState<DopeShot[]>(emptyShots());

  React.useEffect(() => {
    if (!visible) return;
    if (entry) {
      setDistance(String(entry.distance_yards));
      setRangeName(entry.range_name ?? '');
      setLight(entry.light ?? '');
      setMirage(entry.mirage ?? '');
      setTemperature(entry.temperature ?? '');
      setHour(entry.hour_time ?? '');
      setHold(entry.hold ?? '');
      setElevUsed(entry.elevation != null ? String(entry.elevation) : '');
      setElevCorrect(entry.elevation_correct != null ? String(entry.elevation_correct) : '');
      setWindUsed(entry.windage != null ? String(entry.windage) : '');
      setWindCorrect(entry.windage_correct != null ? String(entry.windage_correct) : '');
      setWindVelocity(entry.wind_velocity ?? '');
      setWindClock(entry.wind_clock ?? null);
      setLightClock(entry.light_clock ?? null);
      setRemarks(entry.notes ?? '');
      setShots(parseShots(entry.shots_json));
    } else {
      setDistance('');
      setRangeName('');
      setLight('');
      setMirage('');
      setTemperature('');
      setHour('');
      setHold('');
      setElevUsed('');
      setElevCorrect('');
      setWindUsed('');
      setWindCorrect('');
      setWindVelocity('');
      setWindClock(null);
      setLightClock(null);
      setRemarks('');
      setShots(emptyShots());
    }
  }, [visible, entry]);

  function parseOpt(str: string): number | null | 'err' {
    const t = str.trim();
    if (!t) return null;
    const n = parseFloat(t);
    return isNaN(n) ? 'err' : n;
  }

  function handleSave() {
    const distN = parseFloat(distance);
    if (!distance.trim() || isNaN(distN) || distN <= 0) {
      Alert.alert('Invalid Distance', 'Distance in yards must be a positive number.');
      return;
    }
    const eu = parseOpt(elevUsed);
    const ec = parseOpt(elevCorrect);
    const wu = parseOpt(windUsed);
    const wc = parseOpt(windCorrect);
    if ([eu, ec, wu, wc].includes('err' as any)) {
      Alert.alert('Invalid Value', 'Elevation and windage fields must be numbers or blank.');
      return;
    }

    const shotsToSave = shotsEmpty(shots) ? null : JSON.stringify(shots);

    try {
      const payload = {
        dope_card_id: cardId,
        distance_yards: distN,
        elevation: eu as number | null,
        windage: wu as number | null,
        drop_inches: null,
        notes: remarks.trim() || null,
        range_name: rangeName.trim() || null,
        light: light.trim() || null,
        mirage: mirage.trim() || null,
        temperature: temperature.trim() || null,
        hour_time: hour.trim() || null,
        hold: hold.trim() || null,
        elevation_correct: ec as number | null,
        windage_correct: wc as number | null,
        wind_velocity: windVelocity.trim() || null,
        wind_clock: windClock,
        light_clock: lightClock,
        shots_json: shotsToSave,
      };
      if (entry) updateDopeEntry(entry.id, payload);
      else insertDopeEntry(payload);
      onSaved();
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Could not save entry.');
    }
  }

  function setShot(i: number, patch: Partial<DopeShot>) {
    setShots((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={e.overlay}
      >
        <View style={e.sheet}>
          <View style={e.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={e.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={e.title}>{entry ? 'Edit Data Card' : 'New Data Card'}</Text>
            <TouchableOpacity onPress={handleSave}>
              <Text style={e.save}>{entry ? 'Update' : 'Add'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Section title="DISTANCE & RANGE">
              <Field label={`DISTANCE (YARDS)`} value={distance} onChangeText={setDistance} keyboardType="decimal-pad" />
              <Field label="RANGE" value={rangeName} onChangeText={setRangeName} placeholder="Range name / line" />
            </Section>

            <Section title="CONDITIONS">
              <TwoCol>
                <Field label="LIGHT" value={light} onChangeText={setLight} placeholder="Bright / overcast" />
                <Field label="MIRAGE" value={mirage} onChangeText={setMirage} placeholder="None / boil / 45°" />
              </TwoCol>
              <TwoCol>
                <Field label="TEMP" value={temperature} onChangeText={setTemperature} placeholder="°F" />
                <Field label="HOUR" value={hour} onChangeText={setHour} placeholder="e.g. 1430" />
              </TwoCol>
              <Field label="HOLD" value={hold} onChangeText={setHold} placeholder="Where you held on the target" />
            </Section>

            <Section title={`ELEVATION (${unitLabel})`}>
              <TwoCol>
                <Field label="USED" value={elevUsed} onChangeText={setElevUsed} keyboardType="numbers-and-punctuation" />
                <Field label="CORRECT" value={elevCorrect} onChangeText={setElevCorrect} keyboardType="numbers-and-punctuation" />
              </TwoCol>
            </Section>

            <Section title={`WINDAGE (${unitLabel})`}>
              <TwoCol>
                <Field label="USED" value={windUsed} onChangeText={setWindUsed} keyboardType="numbers-and-punctuation" />
                <Field label="CORRECT" value={windCorrect} onChangeText={setWindCorrect} keyboardType="numbers-and-punctuation" />
              </TwoCol>
              <Field label="VELOCITY" value={windVelocity} onChangeText={setWindVelocity} placeholder="e.g. 8 mph" />
              <ClockPicker label="WIND DIRECTION (O'CLOCK)" value={windClock} onChange={setWindClock} />
            </Section>

            <Section title="LIGHT DIRECTION">
              <ClockPicker label="SUN AT (O'CLOCK)" value={lightClock} onChange={setLightClock} />
            </Section>

            <Section title="SHOT GRID">
              <Text style={e.shotHelp}>
                Optional. Fill per-shot elevation / wind / called call.
              </Text>
              {Array.from({ length: SHOT_COUNT }).map((_, i) => (
                <View key={i} style={e.shotRow}>
                  <Text style={e.shotNum}>{i + 1}</Text>
                  <TextInput
                    style={e.shotInput}
                    value={shots[i].elev ?? ''}
                    onChangeText={(t) => setShot(i, { elev: t })}
                    placeholder="Elev"
                    placeholderTextColor={MUTED}
                  />
                  <TextInput
                    style={e.shotInput}
                    value={shots[i].wind ?? ''}
                    onChangeText={(t) => setShot(i, { wind: t })}
                    placeholder="Wind"
                    placeholderTextColor={MUTED}
                  />
                  <TextInput
                    style={[e.shotInput, { flex: 2 }]}
                    value={shots[i].called ?? ''}
                    onChangeText={(t) => setShot(i, { called: t })}
                    placeholder="Called"
                    placeholderTextColor={MUTED}
                  />
                </View>
              ))}
            </Section>

            <Section title="REMARKS">
              <View style={[e.fieldCard, { padding: 12 }]}>
                <TextInput
                  style={e.notesInput}
                  value={remarks}
                  onChangeText={setRemarks}
                  placeholder="Observations, POI shift, dope refinement…"
                  placeholderTextColor={MUTED}
                  multiline
                />
              </View>
            </Section>

            {entry ? (
              <TouchableOpacity
                style={e.deleteBtn}
                onPress={() => {
                  Alert.alert(
                    'Delete entry?',
                    `Remove the ${entry.distance_yards} yd data card?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete', style: 'destructive',
                        onPress: () => {
                          deleteDopeEntry(entry.id);
                          onSaved();
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={e.deleteText}>Delete this entry</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Text style={e.sectionTitle}>{title}</Text>
      {children}
    </>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

function Field({
  label, value, onChangeText, placeholder, keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={e.fieldLabel}>{label}</Text>
      <View style={e.fieldCard}>
        <TextInput
          style={e.fieldInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          keyboardType={keyboardType}
        />
      </View>
    </View>
  );
}

function ClockPicker({
  label, value, onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <>
      <Text style={e.fieldLabel}>{label}</Text>
      <View style={e.clockRow}>
        {Array.from({ length: 12 }).map((_, i) => {
          const h = i + 1;
          const active = value === h;
          return (
            <TouchableOpacity
              key={h}
              style={[e.clockChip, active && e.clockChipActive]}
              onPress={() => onChange(active ? null : h)}
              activeOpacity={0.75}
            >
              <Text style={[e.clockChipText, active && e.clockChipTextActive]}>{h}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  back: { color: GOLD, fontSize: 16, fontWeight: '600', width: 70 },
  headerTitle: { color: 'white', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  edit: { color: GOLD, fontSize: 15, fontWeight: '600', width: 70, textAlign: 'right' },

  content: { flex: 1 },
  summary: {
    backgroundColor: SURFACE, margin: 16, marginBottom: 8,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 14,
  },
  summaryAmmo: { color: 'white', fontSize: 14, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pill: {
    flex: 1, backgroundColor: BG, borderRadius: 8,
    borderWidth: 1, borderColor: BORDER, paddingVertical: 8, alignItems: 'center',
  },
  pillLabel: { color: MUTED, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  pillValue: { color: GOLD, fontSize: 14, fontWeight: '700', marginTop: 2 },

  empty: { padding: 24, alignItems: 'center', gap: 6 },
  emptyTitle: { color: 'white', fontSize: 15, fontWeight: '700' },
  emptySub: { color: MUTED, fontSize: 13, textAlign: 'center' },

  deleteCardBtn: {
    marginHorizontal: 16, marginTop: 24,
    paddingVertical: 12, alignItems: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: DANGER,
  },
  deleteCardText: { color: DANGER, fontSize: 14, fontWeight: '600' },

  fab: {
    position: 'absolute', bottom: 32, right: 24, width: 58, height: 58,
    borderRadius: 29, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: GOLD, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabText: { color: '#000', fontSize: 28, fontWeight: '300', marginTop: -2 },
});

// Paper card styles. We isolate these so the "evokes a photocopied card"
// aesthetic doesn't bleed into the rest of the app.
const p = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: PAPER,
    borderWidth: 2,
    borderColor: RULE,
    borderRadius: 2,
    padding: 0,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: RULE,
  },
  titleCell: {
    flex: 1.2,
    color: INK,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: RULE,
    textTransform: 'uppercase',
  },
  distanceCell: {
    flex: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  distanceValue: {
    color: INK,
    fontSize: 15,
    fontWeight: '900',
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    minWidth: 40,
    textAlign: 'center',
  },
  distanceUnit: {
    color: INK,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },

  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  cell: {
    borderRightWidth: 1,
    borderRightColor: RULE,
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  cellLabel: {
    color: INK,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cellValue: {
    color: INK_SOFT,
    fontSize: 12,
    marginTop: 6,
  },
  fieldLabel: {
    color: INK,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },

  splitRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  splitHalf: {
    flex: 1,
    paddingHorizontal: 4,
  },
  splitHalfBorder: {
    borderLeftWidth: 1,
    borderLeftColor: RULE,
  },
  splitLabel: {
    color: INK,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  splitValue: {
    color: INK_SOFT,
    fontSize: 11,
    marginTop: 2,
  },

  // Clocks
  clockWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  clockRing: {
    borderWidth: 1.5,
    borderColor: RULE,
    position: 'relative',
  },
  clockNum: {
    position: 'absolute',
    color: INK,
    fontSize: 9,
    fontWeight: '800',
  },
  clockMark: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RULE,
  },
  windSub: { marginTop: 4, gap: 2 },
  windSubText: { color: INK, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },

  placementMini: {
    marginTop: 6,
    alignItems: 'center',
    gap: 4,
  },
  placementTarget: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: RULE,
  },
  placementNote: {
    color: INK_SOFT,
    fontSize: 8,
    fontStyle: 'italic',
  },

  // Shot grid
  gridRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  gridCell: {
    borderRightWidth: 1,
    borderRightColor: RULE,
    paddingHorizontal: 4,
    paddingVertical: 4,
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridHead: {
    backgroundColor: '#EEE6D1',
  },
  gridHeadText: {
    color: INK,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  gridValueText: {
    color: INK_SOFT,
    fontSize: 11,
    textAlign: 'center',
  },

  placementRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  placementCell: {
    flex: 1,
    height: 46,
    borderRightWidth: 1,
    borderRightColor: RULE,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  placementNum: {
    color: INK,
    fontSize: 9,
    fontWeight: '800',
  },

  footer: {
    color: INK_SOFT,
    fontSize: 9,
    fontStyle: 'italic',
    textAlign: 'right',
    padding: 4,
    backgroundColor: '#EEE6D1',
  },
});

// Editor styles (modal)
const e = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  title: { color: 'white', fontSize: 16, fontWeight: '700' },
  cancel: { color: MUTED, fontSize: 15, width: 60 },
  save: { color: GOLD, fontSize: 15, fontWeight: '700', width: 60, textAlign: 'right' },

  sectionTitle: {
    color: GOLD, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, marginTop: 18, marginBottom: 8,
  },
  fieldLabel: {
    color: '#AAA', fontSize: 9, fontWeight: '700',
    letterSpacing: 1, marginBottom: 4,
  },
  fieldCard: {
    backgroundColor: SURFACE, borderRadius: 8,
    borderWidth: 1, borderColor: BORDER, marginBottom: 10, overflow: 'hidden',
  },
  fieldInput: {
    color: 'white', fontSize: 13,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  notesInput: {
    color: 'white', fontSize: 13, minHeight: 70, textAlignVertical: 'top',
  },

  clockRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  clockChip: {
    width: 44, paddingVertical: 8, alignItems: 'center',
    borderRadius: 6, borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE,
  },
  clockChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  clockChipText: { color: '#CCC', fontSize: 12, fontWeight: '700' },
  clockChipTextActive: { color: '#000', fontWeight: '800' },

  shotHelp: { color: MUTED, fontSize: 11, marginBottom: 8, fontStyle: 'italic' },
  shotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
  },
  shotNum: {
    width: 22, color: GOLD, fontSize: 12, fontWeight: '800', textAlign: 'center',
  },
  shotInput: {
    flex: 1, color: 'white', fontSize: 12,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6,
  },

  deleteBtn: {
    marginTop: 16, paddingVertical: 12, alignItems: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: DANGER,
  },
  deleteText: { color: DANGER, fontSize: 14, fontWeight: '600' },
});
