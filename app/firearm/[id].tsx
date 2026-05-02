import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Image, ImageBackground,
  Modal, TextInput, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  getFirearmById, deleteFirearm, getMaintenanceLogs, getAccessoriesByFirearm,
  getFirearmPhotos, addFirearmPhoto, deleteFirearmPhoto,
  getActiveBatteryLogForAccessory, getBatteryHistoryForFirearm,
  getAllNfaItems, findSuppressorsLinkedToFirearm,
  getAmmoForFirearm,
  getForm4Checkins, addForm4Checkin, deleteForm4Checkin,
  Form4Checkin,
  getRangeSessionsForFirearm, FirearmRangeAppearance,
  resolveImageUri, formatDate,
  getDispositionForItem,
  getLatestMaintenanceDate,
  setFirearmMaintenanceInterval, setFirearmMaintenanceNotificationId,
  Firearm, MaintenanceLog, Accessory, FirearmPhoto, BatteryLog, BatteryLogWithFirearm,
  AccessoryWithHost, Ammo, Suppressor, Disposition,
} from '../../lib/database';
import {
  nextDueDate, nextDueLabel,
  scheduleMaintenanceReminder, cancelMaintenanceReminder,
  ensurePermission as ensureMaintenancePermission,
  isAvailable as maintenanceNotificationsAvailable,
} from '../../lib/maintenanceNotifications';
import { runProGated } from '../../lib/paywall';
import { generateAndShareBillOfSale, type BillOfSaleData } from '../../lib/billOfSale';
import { bucketFor, dueLabel, parseDateLoose } from '../../lib/batteryStats';
import type { BatteryBucket } from '../../lib/batteryStats';
import { markAccessoryBatteryReplacedToday } from '../../lib/accessoryBatterySync';
import { syncWidgets } from '../../lib/widgetSync';
import { useEntitlements } from '../../lib/useEntitlements';
import { showPaywall } from '../../lib/paywall';
import AtfFormSection from '../../components/AtfFormSection';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

/** Same color scheme as the batteries hub so the signal is consistent
 *  wherever a battery status appears in the app. */
const BATTERY_COLORS: Record<BatteryBucket, string> = {
  overdue: '#FF5722',
  due_soon: '#FFC107',
  ok: '#4CAF50',
};

/** Human interval for a battery log — time between install and
 *  replacement (or "ongoing" if the log is still active). Uses the same
 *  loose date parser the batteries hub uses so both MM/DD/YYYY and ISO
 *  strings render cleanly. */
function batteryInterval(log: BatteryLog | BatteryLogWithFirearm): string {
  const start = parseDateLoose(log.install_date);
  if (!start) return '—';
  const end = log.replacement_date ? parseDateLoose(log.replacement_date) : new Date();
  if (!end) return '—';
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  if (days < 30) return days === 1 ? '1 day' : `${days} days`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? '1 month' : `${months} months`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return years === 1 ? '1 year' : `${years} years`;
  return `${years}y ${remMonths}mo`;
}

// Suppressor mount type labels (matches add/edit-accessory.tsx constants).
const SUPPRESSOR_MOUNT_LABELS: Record<string, string> = {
  direct_thread: 'Direct Thread', qd: 'QD', hybrid: 'Hybrid',
};
const STOCK_SUBTYPE_LABELS: Record<string, string> = {
  fixed: 'Fixed', folding: 'Folding', collapsible: 'Collapsible', adjustable: 'Adjustable',
};
const TRIGGER_SHAPE_LABELS: Record<string, string> = { flat: 'Flat', curved: 'Curved' };
const TRIGGER_STAGES_LABELS: Record<string, string> = { single: 'Single-Stage', two_stage: 'Two-Stage' };
const SLING_POINTS_LABELS: Record<string, string> = {
  '1_point': '1-Pt', '2_point': '2-Pt', '3_point': '3-Pt', convertible: 'Convertible',
};

/**
 * Build a concise type-specific one-liner for the accessory card. Falls back
 * to a single value if richer fields aren't populated. Returns '' when the
 * details JSON has nothing useful to surface.
 */
function formatAccessoryDetail(acc: Accessory): string {
  if (!acc.details) return '';
  let d: any;
  try { d = JSON.parse(acc.details); } catch { return ''; }
  if (!d || typeof d !== 'object') return '';
  const parts: string[] = [];
  switch (acc.accessory_type) {
    case 'Red Dot / Optic':
      if (d.zero_distance) parts.push(`Zero: ${d.zero_distance}`);
      else if (d.mount) parts.push(d.mount);
      if (d.brightness_settings && parts.length < 2) parts.push(d.brightness_settings);
      break;
    case 'Weapon Light':
      if (d.lumens) parts.push(`${d.lumens} lm`);
      if (d.mount_position) parts.push(d.mount_position);
      break;
    case 'Laser Sight':
      if (d.color) parts.push(d.color);
      if (d.mount) parts.push(d.mount);
      break;
    case 'IR Device':
      if (d.ir_type) parts.push(d.ir_type);
      break;
    case 'Suppressor':
      if (d.caliber) parts.push(d.caliber);
      if (d.mount_type && SUPPRESSOR_MOUNT_LABELS[d.mount_type]) parts.push(SUPPRESSOR_MOUNT_LABELS[d.mount_type]);
      if (d.atf_status) parts.push(d.atf_status);
      break;
    case 'Stock / Brace': {
      const sub = d.subtype ? STOCK_SUBTYPE_LABELS[d.subtype] : '';
      if (sub) parts.push(sub);
      if (d.material) parts.push(d.material);
      if (d.length_of_pull) parts.push(`LoP ${d.length_of_pull}`);
      break;
    }
    case 'Grip / Grip Module':
      if (d.texture) parts.push(d.texture);
      if (d.angle_deg) parts.push(`${d.angle_deg}°`);
      break;
    case 'Trigger': {
      if (d.trigger_type) parts.push(d.trigger_type);
      const shape = d.shape ? TRIGGER_SHAPE_LABELS[d.shape] : '';
      if (shape) parts.push(shape);
      const stages = d.stages ? TRIGGER_STAGES_LABELS[d.stages] : '';
      if (stages) parts.push(stages);
      if (d.pull_weight && parts.length < 3) parts.push(d.pull_weight);
      break;
    }
    case 'Magazine':
      if (d.capacity) parts.push(`${d.capacity} rd`);
      if (d.manufacturer_variant) parts.push(d.manufacturer_variant);
      if (d.count_owned) parts.push(`×${d.count_owned}`);
      break;
    case 'Sling': {
      const pts = d.points ? SLING_POINTS_LABELS[d.points] : '';
      if (pts) parts.push(pts);
      if (d.material) parts.push(d.material);
      if (d.qd_hardware) parts.push('QD');
      break;
    }
  }
  return parts.slice(0, 3).join(' · ');
}

/**
 * Find a NFA firearm entry that corresponds to a Suppressor accessory. Matches
 * by ATF control number first (most reliable), then falls back to a serial
 * number match. Returns null if nothing matches — the card just renders
 * without a link in that case.
 */
function findMatchingNfaFirearm(
  acc: Accessory, nfaItems: Firearm[]
): Firearm | null {
  if (acc.accessory_type !== 'Suppressor') return null;
  let details: any = null;
  try { details = acc.details ? JSON.parse(acc.details) : null; } catch {}
  const accControl = details?.atf_control_number?.trim().toLowerCase();
  const accSerial = acc.serial_number?.trim().toLowerCase();
  for (const nfa of nfaItems) {
    const nfaControl = nfa.atf_control_number?.trim().toLowerCase();
    const nfaSerial = nfa.serial_number?.trim().toLowerCase();
    if (accControl && nfaControl && accControl === nfaControl) return nfa;
    if (accSerial && nfaSerial && accSerial === nfaSerial) return nfa;
  }
  return null;
}

function calcWaitDays(filed: string, approved: string): string {
  try {
    const f = new Date(filed);
    const a = new Date(approved);
    const diff = Math.round((a.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
    return `${diff} days`;
  } catch { return '—'; }
}

/** Saves a picked image into the app's documents dir, returning a relative path. */
async function saveGalleryImage(uri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'firearms');
  if (!dir.exists) dir.create();
  const ext = uri.split('.').pop() ?? 'jpg';
  const filename = `gallery_${Date.now()}.${ext}`;
  const source = new File(uri);
  const dest = new File(dir, filename);
  source.copy(dest);
  return 'firearms/' + filename;
}

export default function FirearmDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ent = useEntitlements();
  const [firearm, setFirearm] = useState<Firearm | null>(null);
  const [lastLog, setLastLog] = useState<MaintenanceLog | null>(null);
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [photos, setPhotos] = useState<FirearmPhoto[]>([]);
  // Lookup of accessory id → active battery log (if any) so the cards can
  // show a colored status chip without a query per render.
  const [batteryByAccessory, setBatteryByAccessory] = useState<Record<number, BatteryLog>>({});
  // Full battery history for this firearm (active + replaced logs). Rendered
  // inside a collapsible section that stays hidden until the user taps in —
  // keeps the detail screen calm for firearms without battery-powered gear.
  const [batteryHistory, setBatteryHistory] = useState<BatteryLogWithFirearm[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // All NFA firearm rows, loaded once on focus and used to match Suppressor
  // accessories into a tappable "Linked NFA entry →" row on their card.
  const [nfaItems, setNfaItems] = useState<Firearm[]>([]);
  // Reverse link: when THIS firearm is the NFA entry (is_nfa=1), find any
  // Suppressor accessories that reference its ATF control number or serial so
  // we can render a "Mounted on: {host firearm}" list pointing back into the
  // host firearm's detail screen.
  // Suppressors whose free-text host_notes mentions this firearm's serial,
  // nickname, or make+model. Populated in the focus effect.
  const [linkedSuppressors, setLinkedSuppressors] = useState<Suppressor[]>([]);
  // Ammo lots available to this firearm — either explicitly paired by id, or
  // caliber-matched when no explicit pairing exists. Drives the "AMMO ON HAND"
  // tile's round count, lot count, and low-stock signal.
  const [ammoLots, setAmmoLots] = useState<Ammo[]>([]);
  // Form 4 check-in history — populated for NFA items. The modal lets the
  // user log a new status check (e.g. eForms portal, phone, dealer) with an
  // optional note, so they have a paper trail of follow-ups.
  const [checkins, setCheckins] = useState<Form4Checkin[]>([]);
  // Range sessions that included this firearm — rendered on the detail
  // screen so round-count history lives next to the firearm itself.
  const [rangeAppearances, setRangeAppearances] = useState<FirearmRangeAppearance[]>([]);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinMethod, setCheckinMethod] = useState('eForms');
  const [checkinNote, setCheckinNote] = useState('');
  // Custom interval modal — one modal handles both dimensions. `customKind`
  // flips between 'months' and 'rounds' so we know where to route the value.
  const [customOpen, setCustomOpen] = useState(false);
  const [customKind, setCustomKind] = useState<'months' | 'rounds'>('months');
  const [customValue, setCustomValue] = useState('');
  // Disposition — populated when the user has marked this firearm as
  // transferred/sold/etc. Drives both the "DISPOSED" pill in the header and
  // the dedicated disposition card surfaced below the core details.
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  // Full-screen image viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  async function handleBillOfSale() {
    if (!firearm || !disposition) return;
    try {
      const data: BillOfSaleData = {
        make: firearm.make ?? undefined,
        model: firearm.model ?? undefined,
        serialNumber: firearm.serial_number ?? undefined,
        caliber: firearm.caliber ?? undefined,
        type: firearm.type ?? undefined,
        condition: firearm.condition ?? undefined,
        buyerName: disposition.to_name ?? undefined,
        buyerAddress: disposition.to_address ?? undefined,
        buyerFfl: disposition.to_ffl_number ?? undefined,
        dispositionDate: disposition.disposition_date ?? undefined,
        dispositionType: disposition.disposition_type ?? undefined,
        salePrice: disposition.sale_price,
        form4473Serial: disposition.form_4473_serial ?? undefined,
        notes: disposition.notes ?? undefined,
      };
      await generateAndShareBillOfSale(data);
    } catch (e: any) {
      Alert.alert('PDF Error', e?.message ?? 'Could not generate Bill of Sale.');
    }
  }

  function isPendingNfa(f: Firearm): boolean {
    if (!f.is_nfa) return false;
    const s = f.atf_form_status;
    return !s || s === 'Not Yet Filed' || s === 'Pending (eFiled)' || s === 'Pending (Paper)';
  }

  function saveCheckin() {
    if (!firearm) return;
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    addForm4Checkin({
      firearm_id: firearm.id,
      checkin_date: iso,
      method: checkinMethod || null,
      note: checkinNote.trim() || null,
    });
    setCheckins(getForm4Checkins(firearm.id));
    setCheckinOpen(false);
  }

  function handleAddAccessory() {
    // Hard cap: block at 3rd accessory on Lite.
    if (accessories.length >= ent.limits.maxAccessoriesPerFirearm) {
      showPaywall({ mode: 'hard_cap', reason: 'accessory_limit' });
      return;
    }
    router.push(`/add-accessory?firearm_id=${id}`);
  }

  /** Total photo count = primary image (if set) + gallery rows. */
  function totalPhotoCount(): number {
    return (firearm?.image_uri ? 1 : 0) + photos.length;
  }

  /** Build array of all images: primary + gallery photos, for the full-screen viewer. */
  const allImages = useMemo(() => {
    const imgs: { uri: string; label?: string }[] = [];
    if (firearm?.image_uri) {
      const resolved = resolveImageUri(firearm.image_uri);
      if (resolved) imgs.push({ uri: resolved, label: 'Primary' });
    }
    for (const p of photos) {
      const resolved = resolveImageUri(p.image_uri);
      if (resolved) imgs.push({ uri: resolved });
    }
    return imgs;
  }, [firearm?.image_uri, photos]);

  async function handleAddPhoto() {
    const total = totalPhotoCount();
    const cap = ent.limits.maxPhotosPerFirearm;

    // Lite: primary photo counts as the only allowed photo.
    // Lite ceiling is 1 → any attempt to add a gallery photo paywalls.
    if (!ent.isPro && total >= cap) {
      // Hard-cap trigger with photo_limit reason — matches spec §4.6
      // ("ONLY ONE PHOTO ON LITE") and reinforces the cap being hit
      // rather than a generic contextual gallery ad.
      showPaywall({ mode: 'hard_cap', reason: 'photo_limit' });
      return;
    }

    // Pro/Founders: hard cap at 20 — inform without paywalling.
    if (ent.isPro && total >= cap) {
      Alert.alert(
        'Photo limit reached',
        `This firearm already has ${cap} photos — the max per item. Delete a photo to add another.`,
      );
      return;
    }

    // Present source picker.
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
              const saved = await saveGalleryImage(result.assets[0].uri);
              addFirearmPhoto({
                firearm_id: Number(id),
                image_uri: saved,
                sort_order: photos.length,
              });
              setPhotos(getFirearmPhotos(Number(id)));
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
            const saved = await saveGalleryImage(result.assets[0].uri);
            addFirearmPhoto({
              firearm_id: Number(id),
              image_uri: saved,
              sort_order: photos.length,
            });
            setPhotos(getFirearmPhotos(Number(id)));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleDeletePhoto(photo: FirearmPhoto) {
    Alert.alert(
      'Delete photo?',
      'This removes the photo from this firearm\'s gallery. The primary hero image is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteFirearmPhoto(photo.id);
            setPhotos(getFirearmPhotos(Number(id)));
          },
        },
      ],
    );
  }

  /** Rebuild the accessory → active-battery-log lookup. Extracted so the
   *  "Replaced Today" handler can refresh just the battery row after the
   *  async sync completes, without re-querying maintenance/photos/etc. */
  function refreshBatteryMap(accs: Accessory[]) {
    const map: Record<number, BatteryLog> = {};
    for (const a of accs) {
      const log = getActiveBatteryLogForAccessory(a.id);
      if (log) map[a.id] = log;
    }
    setBatteryByAccessory(map);
  }

  const reloadFirearm = useCallback(() => {
    setFirearm(getFirearmById(Number(id)));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      const f = getFirearmById(Number(id));
      setFirearm(f);
      if (f) {
        const logs = getMaintenanceLogs(Number(id));
        setLastLog(logs.length > 0 ? logs[0] : null);
        const accs = getAccessoriesByFirearm(Number(id));
        setAccessories(accs);
        setPhotos(getFirearmPhotos(Number(id)));
        refreshBatteryMap(accs);
        setBatteryHistory(getBatteryHistoryForFirearm(Number(id)));
        // Refresh NFA list on every focus so a newly-registered suppressor
        // starts matching immediately without requiring a screen remount.
        setNfaItems(getAllNfaItems());
        // Fuzzy reverse-lookup on suppressors: any can whose free-text
        // host_notes mentions this firearm's serial, nickname, or make+model
        // is surfaced under "Suppressors Used With This". Runs for every
        // firearm (NFA or not) since the user might document using a can on
        // any compatible host.
        setLinkedSuppressors(
          findSuppressorsLinkedToFirearm({
            serial_number: f.serial_number,
            nickname: f.nickname,
            make: f.make,
            model: f.model,
          })
        );
        if (f.is_nfa) {
          setCheckins(getForm4Checkins(f.id));
        } else {
          setCheckins([]);
        }
        // Pull any ammo lots paired to this firearm (or caliber-matched when
        // no explicit pairings exist). Refreshed on every focus so a lot
        // added or depleted on the Supply tab reflects instantly when the
        // user navigates back here.
        setAmmoLots(getAmmoForFirearm(f.id));
        setRangeAppearances(getRangeSessionsForFirearm(f.id));
        setDisposition(getDispositionForItem('firearm', f.id));
      }
    }, [id])
  );

  /** One-tap "Replaced Today" from the accessory card. Confirms, closes the
   *  old log (for history), updates the accessory's replacement date, and
   *  schedules the next reminder automatically. */
  function handleReplacedToday(acc: Accessory) {
    const label = [acc.make, acc.model].filter(Boolean).join(' ') || acc.accessory_type;
    Alert.alert(
      'Log battery replacement?',
      `Stamp today as the new replacement date for ${label}. The next reminder will be rescheduled automatically.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replaced Today',
          onPress: async () => {
            try {
              await markAccessoryBatteryReplacedToday(acc.id);
            } catch (e) {
              console.warn('[firearm detail] replaced-today failed', e);
            }
            // Pull the refreshed accessory list so any detail line changes
            // (like the updated `date_battery_replaced` reflected in detail
            // strings) stay in sync.
            const accs = getAccessoriesByFirearm(Number(id));
            setAccessories(accs);
            refreshBatteryMap(accs);
            setBatteryHistory(getBatteryHistoryForFirearm(Number(id)));
            syncWidgets();
          },
        },
      ]
    );
  }

  /** Apply a new maintenance-reminder interval. months=null disables the
   *  reminder. Pro-gated — Lite users see the contextual paywall. On
   *  success we cancel any pending notification and, if the interval is
   *  non-null and we have a prior log to anchor off of, schedule a new
   *  one. Reloads the firearm so the card re-renders with the new state. */
  function applyMaintenanceInterval(months: number | null) {
    runProGated('maintenance_reminders', async () => {
      const fid = Number(id);
      const previousMonths = firearm?.maintenance_interval_months ?? null;
      const currentRounds = firearm?.maintenance_interval_rounds ?? null;

      // First-time enable: explain why we're about to ask for notification
      // permission, then request it. If the user declines we still save
      // the interval (dashboard rollup still works), we just can't fire a
      // push when the date rolls around.
      if (months && !previousMonths && maintenanceNotificationsAvailable()) {
        const granted = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Enable Maintenance Reminders?',
            'Iron Ledger can send you a push when this firearm is due for routine maintenance. We only notify you at 9am on the due date — never spam.',
            [
              { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Enable', onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });
        if (granted) await ensureMaintenancePermission();
      }

      setFirearmMaintenanceInterval(fid, months, currentRounds);
      // Cancel any previously scheduled reminder up-front; we'll schedule
      // a fresh one below if the user picked a non-null interval.
      if (firearm?.maintenance_notification_id) {
        await cancelMaintenanceReminder(firearm.maintenance_notification_id);
        setFirearmMaintenanceNotificationId(fid, null);
      }
      if (months) {
        const lastLogDate = getLatestMaintenanceDate(fid);
        if (lastLogDate) {
          const fresh = getFirearmById(fid);
          if (fresh) {
            try {
              const newId = await scheduleMaintenanceReminder(fresh, lastLogDate);
              setFirearmMaintenanceNotificationId(fid, newId);
            } catch (e) {
              console.warn('[firearm detail] schedule reminder failed', e);
            }
          }
        }
      }
      reloadFirearm();
    });
  }

  /** Open the custom-interval modal for either dimension. Pre-fills with
   *  the current value if it's a non-preset custom number so users can
   *  tweak instead of retyping. Pro-gated before we even show the modal. */
  function openCustomInterval(kind: 'months' | 'rounds') {
    runProGated('maintenance_reminders', () => {
      const current = kind === 'months'
        ? firearm?.maintenance_interval_months ?? null
        : firearm?.maintenance_interval_rounds ?? null;
      setCustomKind(kind);
      setCustomValue(current ? String(current) : '');
      setCustomOpen(true);
    });
  }

  /** Commit the custom-interval modal. Empty / 0 clears the dimension;
   *  any positive integer is routed to the matching apply function so
   *  all the permission + scheduling logic runs through one path. */
  function saveCustomInterval() {
    const raw = customValue.trim();
    const parsed = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
    const value = parsed && parsed > 0 ? parsed : null;
    setCustomOpen(false);
    if (customKind === 'months') applyMaintenanceInterval(value);
    else applyMaintenanceRoundsInterval(value);
  }

  /** Apply a round-count maintenance threshold. rounds=null disables the
   *  rounds dimension; the time-based interval is untouched. Pro-gated
   *  like the time-based version. No notification scheduling here — the
   *  dashboard rollup surfaces round-based "due" state visually. */
  function applyMaintenanceRoundsInterval(rounds: number | null) {
    runProGated('maintenance_reminders', () => {
      const fid = Number(id);
      const currentMonths = firearm?.maintenance_interval_months ?? null;
      setFirearmMaintenanceInterval(fid, currentMonths, rounds);
      reloadFirearm();
    });
  }

  function handleDelete() {
    Alert.alert('Delete Firearm', 'This will permanently remove this firearm and all its maintenance records.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        deleteFirearm(Number(id));
        syncWidgets();
        router.back();
      }},
    ]);
  }

  if (!firearm) return null;

  const displayName = firearm.nickname || `${firearm.make} ${firearm.model}`;
  const subtitle = firearm.nickname ? `${firearm.make} ${firearm.model}` : null;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push(`/edit-firearm?id=${id}`)}>
          <Text style={s.edit}>Edit</Text>
        </TouchableOpacity>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          {firearm.image_uri ? (
            <Image source={{ uri: resolveImageUri(firearm.image_uri) ?? undefined }} style={s.heroImage} />
          ) : (
            <View style={s.heroPlaceholder}>
              <Image source={require('../../assets/Icon.png')} style={s.heroIcon} />
            </View>
          )}
        </View>
        <Text style={s.name}>{displayName}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        {firearm.type ? <Text style={s.type}>{firearm.type}{firearm.action_type ? ` · ${firearm.action_type}` : ''}</Text> : null}
        {firearm.trigger_type ? <Text style={s.triggerLine}>{firearm.trigger_type} Trigger</Text> : null}

        {disposition ? (
          <View style={s.dispPill}>
            <Text style={s.dispPillText}>
              DISPOSED · {disposition.disposition_type.toUpperCase()}
            </Text>
          </View>
        ) : null}

        <Text style={s.sectionLabel}>DETAILS</Text>
        <View style={s.card}>
          {firearm.caliber ? <Row label="Caliber" value={firearm.caliber} /> : null}
          {firearm.serial_number ? <Row label="Serial Number" value={firearm.serial_number} /> : null}
          {firearm.condition_rating ? <Row label="Condition" value={firearm.condition_rating} gold /> : null}
          {firearm.storage_location ? <Row label="Storage" value={firearm.storage_location} /> : null}
          <Row label="Round Count" value={`${(firearm.round_count || 0).toLocaleString()} rds`} gold />
        </View>

        {/* Disposition — presence of a row means this firearm has left
            inventory. The bound book export populates its disposition
            columns from exactly this record. Tap to edit or undo. */}
        {disposition ? (
          <>
            <Text style={s.sectionLabel}>DISPOSITION</Text>
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.8}
              onPress={() =>
                router.push(`/dispose?kind=firearm&id=${firearm.id}`)
              }
            >
              <Row label="Type" value={disposition.disposition_type} gold />
              <Row label="Date" value={formatDate(disposition.disposition_date) ?? disposition.disposition_date} />
              {disposition.to_name ? <Row label="To" value={disposition.to_name} /> : null}
              {disposition.to_address ? <Row label="Address" value={disposition.to_address} /> : null}
              {disposition.to_ffl_number ? <Row label="FFL #" value={disposition.to_ffl_number} /> : null}
              {disposition.form_4473_serial ? <Row label="4473 Serial" value={disposition.form_4473_serial} /> : null}
              {disposition.sale_price != null ? (
                <Row
                  label="Sale Price"
                  value={`$${disposition.sale_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                />
              ) : null}
              {disposition.notes ? <Row label="Notes" value={disposition.notes} /> : null}
              <Text style={s.dispEditHint}>Tap to edit or undo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.billOfSaleBtn}
              activeOpacity={0.8}
              onPress={() => handleBillOfSale()}
            >
              <Text style={s.billOfSaleBtnTxt}>Generate Bill of Sale</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={s.disposeBtn}
            activeOpacity={0.8}
            onPress={() => router.push(`/dispose?kind=firearm&id=${firearm.id}`)}
          >
            <Text style={s.disposeBtnText}>Transfer Out / Dispose…</Text>
          </TouchableOpacity>
        )}

        {/* Ammo on hand — only shown when this firearm has a caliber set.
            Aggregates explicit pairings + caliber-matched lots and surfaces
            any low/empty signal. Tap the tile to jump to Supply; tap the
            button to log a range trip (maintenance entry pre-seeded with
            the firearm id and a Range Session type). */}
        {firearm.caliber ? (() => {
          const totalRounds = ammoLots.reduce((sum, a) => sum + (a.quantity || 0), 0);
          const anyLow = ammoLots.some(a => {
            const t = a.low_stock_threshold ?? 100;
            return a.quantity > 0 && a.quantity <= t;
          });
          const anyEmpty = ammoLots.some(a => a.quantity === 0);
          const signalColor = anyEmpty ? '#FF5722' : anyLow ? '#FFC107' : GOLD;
          const subtitle = ammoLots.length === 0
            ? `No ${firearm.caliber} lots tracked`
            : `${ammoLots.length} lot${ammoLots.length === 1 ? '' : 's'} · ${firearm.caliber}`;
          return (
            <>
              <Text style={s.sectionLabel}>AMMO ON HAND</Text>
              <View style={s.ammoTile}>
                <TouchableOpacity
                  style={s.ammoTileBody}
                  onPress={() => router.push('/supply')}
                  activeOpacity={0.75}
                >
                  <View style={s.ammoTileLeft}>
                    <Text style={[s.ammoTileValue, { color: signalColor }]}>
                      {totalRounds.toLocaleString()}
                    </Text>
                    <Text style={s.ammoTileUnit}>rounds available</Text>
                    <Text style={s.ammoTileSub} numberOfLines={1}>{subtitle}</Text>
                    {anyEmpty ? (
                      <View style={s.ammoTileBadge}>
                        <Text style={s.ammoTileBadgeText}>OUT OF STOCK</Text>
                      </View>
                    ) : anyLow ? (
                      <View style={[s.ammoTileBadge, s.ammoTileBadgeLow]}>
                        <Text style={[s.ammoTileBadgeText, s.ammoTileBadgeTextLow]}>LOW STOCK</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={s.ammoTileChevron}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.ammoTileBtn}
                  onPress={() => router.push('/add-session')}
                  activeOpacity={0.8}
                >
                  <Text style={s.ammoTileBtnText}>🎯 Log Range Trip</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })() : null}

        <Text style={s.sectionLabel}>ACQUISITION</Text>
        <View style={s.card}>
          {firearm.ownership_type && firearm.ownership_type !== 'personal' ? (
            <Row label="Ownership" value="Business / FFL" gold />
          ) : null}
          {firearm.acquisition_method ? <Row label="Method" value={firearm.acquisition_method} /> : null}
          {firearm.purchase_date ? <Row label="Date" value={formatDate(firearm.purchase_date) ?? firearm.purchase_date} /> : null}
          {firearm.purchased_from ? <Row label="Purchased From" value={firearm.purchased_from} /> : null}
          {firearm.dealer_city_state ? <Row label="Dealer Location" value={firearm.dealer_city_state} /> : null}
          {firearm.purchase_price ? <Row label="Purchase Price" value={`$${firearm.purchase_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} /> : null}
          {firearm.current_value ? <Row label="Current Value" value={`$${firearm.current_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} gold /> : null}
          <TouchableOpacity
            style={{ paddingHorizontal: 14, paddingVertical: 8 }}
            onPress={() => {
              // TrueGunValue has no generic /search endpoint (404s).
              // Google site-search reliably lands on matching TGV pages.
              const q = encodeURIComponent(`${firearm.make} ${firearm.model}`.trim());
              Linking.openURL(`https://www.google.com/search?q=site%3Atruegunvalue.com+${q}`);
            }}
          >
            <Text style={{ color: '#4A90D9', fontSize: 13, fontWeight: '600' }}>
              Look up on TrueGunValue ›
            </Text>
          </TouchableOpacity>
        </View>

        {/* Range sessions — collapsed until there's at least one record.
            Tapping a row opens the session editor; the + button launches a
            fresh session pre-scoped to no specific firearm (user picks in
            the editor). */}
        {rangeAppearances.length > 0 ? (
          <>
            <View style={s.accHeader}>
              <Text style={s.sectionLabel}>RANGE SESSIONS</Text>
              <TouchableOpacity onPress={() => router.push('/add-session')}>
                <Text style={s.accAdd}>＋ Log Trip</Text>
              </TouchableOpacity>
            </View>
            <View style={s.card}>
              {rangeAppearances.map((r, idx) => {
                const isLast = idx === rangeAppearances.length - 1;
                return (
                  <TouchableOpacity
                    key={r.line_id}
                    style={[s.rangeRow, isLast && { borderBottomWidth: 0 }]}
                    onPress={() => router.push(`/add-session?id=${r.session_id}`)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.rangeDate}>
                        {formatDate(r.session_date) ?? r.session_date}
                      </Text>
                      {r.location ? (
                        <Text style={s.rangeLocation}>{r.location}</Text>
                      ) : null}
                    </View>
                    <Text style={s.rangeRounds}>
                      {r.rounds_fired.toLocaleString()} rds
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        {/* NFA Section */}
        {firearm.is_nfa ? (
          <>
            <Text style={s.sectionLabel}>NFA / TAX STAMP</Text>
            <View style={s.card}>
              {firearm.nfa_form_type ? <Row label="Form Type" value={firearm.nfa_form_type} /> : null}
              {firearm.nfa_item_category ? <Row label="Category" value={firearm.nfa_item_category} /> : null}
              {firearm.atf_form_status ? <Row label="ATF Status" value={firearm.atf_form_status} gold /> : null}
              {firearm.atf_control_number ? <Row label="Control #" value={firearm.atf_control_number} /> : null}
              {firearm.date_filed ? <Row label="Date Filed" value={formatDate(firearm.date_filed) ?? firearm.date_filed} /> : null}
              {firearm.date_approved ? <Row label="Date Approved" value={formatDate(firearm.date_approved) ?? firearm.date_approved} /> : null}
              {firearm.date_filed && firearm.date_approved ? <Row label="Wait Time" value={calcWaitDays(firearm.date_filed, firearm.date_approved)} /> : null}
              {firearm.tax_paid_amount ? <Row label="Tax Paid" value={`$${firearm.tax_paid_amount}`} /> : null}
              {firearm.trust_type ? <Row label="Ownership" value={firearm.trust_type} /> : null}
              {firearm.trust_name ? <Row label="Trust Name" value={firearm.trust_name} /> : null}
              {firearm.responsible_persons ? <Row label="Resp. Persons" value={firearm.responsible_persons} /> : null}
            </View>

            {/* Reverse link: when this NFA entry has been attached as a
                Suppressor accessory to another firearm (matched by ATF
                control # or serial), surface the host(s) here so the user
                can jump back to where the can is actually mounted. */}
            {/* Tax stamp image — visible once approved. */}
            {firearm.tax_stamp_image ? (
              <>
                <Text style={s.sectionLabel}>TAX STAMP</Text>
                <View style={s.card}>
                  <Image
                    source={{ uri: resolveImageUri(firearm.tax_stamp_image) ?? undefined }}
                    style={s.stampPreview}
                    resizeMode="contain"
                  />
                </View>
              </>
            ) : null}

            {/* Scanned paper ATF form on file. Pro (document_storage). */}
            <AtfFormSection
              kind="firearm"
              ownerId={firearm.id}
              frontUri={firearm.atf_form_front_uri}
              backUri={firearm.atf_form_back_uri}
              scannedAt={firearm.atf_form_scanned_at}
              onChange={reloadFirearm}
            />

            {/* Form 4 check-in log. Only relevant for pending items, but we
                always render past check-ins when any exist so the user keeps
                a record even after approval. */}
            {(isPendingNfa(firearm) || checkins.length > 0) ? (
              <>
                <View style={s.accHeader}>
                  <Text style={s.sectionLabel}>CHECK-IN LOG</Text>
                  {isPendingNfa(firearm) ? (
                    <TouchableOpacity onPress={() => {
                      setCheckinMethod('eForms');
                      setCheckinNote('');
                      setCheckinOpen(true);
                    }}>
                      <Text style={s.accAdd}>＋ Log Check-In</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {checkins.length === 0 ? (
                  <View style={s.card}>
                    <Text style={s.emptyCheckin}>No check-ins logged yet.</Text>
                  </View>
                ) : (
                  <View style={s.card}>
                    {checkins.map((c, idx) => {
                      const isLast = idx === checkins.length - 1;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[s.checkinRow, isLast && { borderBottomWidth: 0 }]}
                          onLongPress={() => {
                            Alert.alert('Delete check-in?', '', [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete', style: 'destructive',
                                onPress: () => {
                                  deleteForm4Checkin(c.id);
                                  setCheckins(getForm4Checkins(firearm.id));
                                },
                              },
                            ]);
                          }}
                          activeOpacity={0.75}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={s.checkinMethod}>{c.method || 'Check-in'}</Text>
                            {c.note ? <Text style={s.checkinNote}>{c.note}</Text> : null}
                          </View>
                          <Text style={s.checkinDate}>
                            {formatDate(c.checkin_date) ?? c.checkin_date}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            ) : null}

            {linkedSuppressors.length > 0 ? (
              <>
                <Text style={s.sectionLabel}>SUPPRESSORS USED WITH THIS</Text>
                <View style={s.card}>
                  {linkedSuppressors.map((sup, idx) => {
                    const accLabel = [sup.make, sup.model].filter(Boolean).join(' ') || 'Suppressor';
                    const isLast = idx === linkedSuppressors.length - 1;
                    return (
                      <TouchableOpacity
                        key={sup.id}
                        style={[s.mountRow, isLast && { borderBottomWidth: 0 }]}
                        onPress={() => router.push(`/suppressor/${sup.id}`)}
                        activeOpacity={0.75}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.mountHost}>{accLabel}</Text>
                          {sup.caliber ? <Text style={s.mountAcc}>{sup.caliber}</Text> : null}
                        </View>
                        <Text style={s.mountChevron}>›</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {firearm.notes ? (
          <View style={s.notesCard}>
            <Text style={s.notesLabel}>NOTES</Text>
            <Text style={s.notesText}>{firearm.notes}</Text>
          </View>
        ) : null}

        {/* Photo Gallery */}
        <View style={s.accHeader}>
          <Text style={s.sectionLabel}>PHOTOS</Text>
          <TouchableOpacity onPress={handleAddPhoto}>
            <Text style={s.accAdd}>
              {ent.isPro
                ? `＋ Add${totalPhotoCount() > 0 ? ` · ${totalPhotoCount()}/${ent.limits.maxPhotosPerFirearm}` : ''}`
                : '＋ Add'}
            </Text>
          </TouchableOpacity>
        </View>
        {photos.length === 0 && !firearm.image_uri ? (
          <TouchableOpacity style={s.accEmpty} onPress={handleAddPhoto}>
            <Text style={s.accEmptyText}>No photos yet — tap to add</Text>
          </TouchableOpacity>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.galleryStrip}
          >
            {firearm.image_uri ? (
              <TouchableOpacity
                style={s.galleryTile}
                onPress={() => { setViewerIndex(0); setViewerVisible(true); }}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: resolveImageUri(firearm.image_uri) ?? undefined }}
                  style={s.galleryImage}
                />
                <View style={s.galleryPrimaryBadge}>
                  <Text style={s.galleryPrimaryText}>PRIMARY</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {photos.map((photo, idx) => (
              <TouchableOpacity
                key={photo.id}
                style={s.galleryTile}
                onPress={() => { setViewerIndex(firearm?.image_uri ? idx + 1 : idx); setViewerVisible(true); }}
                onLongPress={() => handleDeletePhoto(photo)}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: resolveImageUri(photo.image_uri) ?? undefined }}
                  style={s.galleryImage}
                />
              </TouchableOpacity>
            ))}
            {/* Add-photo tile at the end of the strip */}
            <TouchableOpacity
              style={[s.galleryTile, s.galleryAddTile]}
              onPress={handleAddPhoto}
              activeOpacity={0.7}
            >
              <Text style={s.galleryAddPlus}>＋</Text>
              <Text style={s.galleryAddLabel}>
                {!ent.isPro && totalPhotoCount() >= ent.limits.maxPhotosPerFirearm
                  ? 'Pro'
                  : 'Add'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
        {!ent.isPro && totalPhotoCount() >= ent.limits.maxPhotosPerFirearm ? (
          <Text style={s.galleryHint}>
            Lite includes 1 photo per firearm. Upgrade to Pro for up to 20.
          </Text>
        ) : photos.length > 0 ? (
          <Text style={s.galleryHint}>Long-press a photo to delete.</Text>
        ) : null}

        {/* Accessories */}
        <View style={s.accHeader}>
          <Text style={s.sectionLabel}>ACCESSORIES</Text>
          <TouchableOpacity onPress={handleAddAccessory}>
            <Text style={s.accAdd}>＋ Add</Text>
          </TouchableOpacity>
        </View>
        {accessories.length === 0 ? (
          <TouchableOpacity style={s.accEmpty} onPress={handleAddAccessory}>
            <Text style={s.accEmptyText}>No accessories yet — tap to add</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.accList}>
            {accessories.map((acc) => {
              const name = [acc.make, acc.model].filter(Boolean).join(' ') || acc.accessory_type;
              const detail = formatAccessoryDetail(acc);
              const batteryLog = batteryByAccessory[acc.id];
              const batteryBucket: BatteryBucket | null = batteryLog ? bucketFor(batteryLog) : null;
              // For suppressors, find the paired NFA firearm row (if the
              // user has registered one). Skipped for every other type so we
              // don't scan the list on non-NFA accessories.
              const linkedNfa = findMatchingNfaFirearm(acc, nfaItems);
              return (
                <View key={acc.id} style={s.accCard}>
                  <TouchableOpacity
                    style={s.accCardInner}
                    onPress={() => router.push(`/edit-accessory?id=${acc.id}`)}
                    activeOpacity={0.75}
                  >
                    <View style={s.accCardLeft}>
                      {acc.image_uri ? (
                        <Image source={{ uri: resolveImageUri(acc.image_uri) ?? undefined }} style={s.accThumb} />
                      ) : (
                        <View style={s.accThumbPlaceholder}>
                          <Text style={s.accThumbIcon}>{
                            acc.accessory_type === 'Red Dot / Optic' ? '🔴' :
                            acc.accessory_type === 'Weapon Light' ? '🔦' :
                            acc.accessory_type === 'Laser Sight' ? '🎯' :
                            acc.accessory_type === 'IR Device' ? '👁' :
                            acc.accessory_type === 'Suppressor' ? '🔇' :
                            acc.accessory_type === 'Trigger' ? '⚡' :
                            acc.accessory_type === 'Magazine' ? '📦' :
                            acc.accessory_type === 'Sling' ? '🪢' :
                            '🔩'
                          }</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={s.accName} numberOfLines={1}>{name}</Text>
                        <Text style={s.accType}>{acc.accessory_type}{detail ? ` · ${detail}` : ''}</Text>
                        {batteryLog && batteryBucket ? (
                          <View style={s.battChipRow}>
                            <View style={[s.battDot, { backgroundColor: BATTERY_COLORS[batteryBucket] }]} />
                            <Text style={[s.battChipText, { color: BATTERY_COLORS[batteryBucket] }]}>
                              🔋 {batteryLog.battery_type} · {dueLabel(batteryLog)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Text style={s.accChevron}>›</Text>
                  </TouchableOpacity>
                  {/* Quick "Replaced Today" action — only rendered for
                      accessories that have an active battery log. Tapping
                      the button is swallowed so it doesn't also trigger
                      navigation to the edit screen. */}
                  {batteryLog ? (
                    <TouchableOpacity
                      style={[
                        s.replacedBtn,
                        batteryBucket === 'overdue' && s.replacedBtnUrgent,
                      ]}
                      onPress={() => handleReplacedToday(acc)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          s.replacedBtnText,
                          batteryBucket === 'overdue' && s.replacedBtnTextUrgent,
                        ]}
                      >
                        🔋 Replaced Today
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Suppressor → NFA link. Only appears when the suppressor
                      accessory shares an ATF control number or serial with
                      a firearm row flagged is_nfa. Tapping navigates to
                      that NFA entry's detail screen. */}
                  {linkedNfa ? (
                    <TouchableOpacity
                      style={s.nfaLinkRow}
                      onPress={() => router.push(`/firearm/${linkedNfa.id}`)}
                      activeOpacity={0.75}
                    >
                      <Text style={s.nfaLinkLabel}>
                        🔗 Linked NFA entry: {linkedNfa.make} {linkedNfa.model}
                      </Text>
                      <Text style={s.nfaLinkChevron}>›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {/* Battery History — only renders when there's at least one log for
            this firearm (active or replaced). Collapsed by default so the
            detail screen stays tidy; tapping the header reveals the full
            timeline, most-recent install first. */}
        {batteryHistory.length > 0 ? (
          <>
            <TouchableOpacity
              style={s.historyHeader}
              onPress={() => setHistoryExpanded(v => !v)}
              activeOpacity={0.75}
            >
              <Text style={s.sectionLabel}>BATTERY HISTORY</Text>
              <View style={s.historyHeaderRight}>
                <Text style={s.historyCount}>{batteryHistory.length}</Text>
                <Text style={s.historyChevron}>{historyExpanded ? '˅' : '›'}</Text>
              </View>
            </TouchableOpacity>
            {historyExpanded ? (
              <View style={s.historyList}>
                {batteryHistory.map((log, idx) => {
                  const accLabel = [log.accessory_make, log.accessory_model]
                    .filter(Boolean).join(' ') || log.accessory_type || log.device_label;
                  const installed = formatDate(log.install_date) ?? log.install_date;
                  const replaced = log.replacement_date
                    ? (formatDate(log.replacement_date) ?? log.replacement_date)
                    : null;
                  const isActive = !log.replacement_date;
                  return (
                    <View
                      key={log.id}
                      style={[s.historyRow, idx === batteryHistory.length - 1 && s.historyRowLast]}
                    >
                      <View style={s.historyRowTop}>
                        <Text style={s.historyAcc} numberOfLines={1}>{accLabel}</Text>
                        <View style={[s.historyBadge, isActive ? s.historyBadgeActive : s.historyBadgeReplaced]}>
                          <Text style={[s.historyBadgeText, isActive ? s.historyBadgeTextActive : s.historyBadgeTextReplaced]}>
                            {isActive ? 'ACTIVE' : 'REPLACED'}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.historyMeta}>
                        🔋 {log.battery_type} · Installed {installed}
                        {replaced ? ` · Replaced ${replaced}` : ''}
                      </Text>
                      <Text style={s.historyInterval}>
                        {isActive ? `Running ${batteryInterval(log)}` : `Lasted ${batteryInterval(log)}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : null}

        <Text style={s.sectionLabel}>MAINTENANCE</Text>
        <TouchableOpacity style={s.maintenanceCard} onPress={() => router.push(`/maintenance/${id}`)}>
          <View style={s.maintenanceLeft}>
            <Text style={s.maintenanceIcon}>🔧</Text>
            <View>
              <Text style={s.maintenanceTitle}>Maintenance Log</Text>
              {lastLog ? (
                <Text style={s.maintenanceSub}>Last: {lastLog.type} on {formatDate(lastLog.date) ?? lastLog.date}</Text>
              ) : (
                <Text style={s.maintenanceSub}>No entries yet — tap to add</Text>
              )}
            </View>
          </View>
          <Text style={s.maintenanceChevron}>›</Text>
        </TouchableOpacity>

        {/* Maintenance reminder — preset intervals only for MVP. Pro-only;
            Lite users see the contextual paywall on tap. Next-due label
            is computed off the latest log date, so the card stays
            accurate even after the user back-dates an entry. */}
        {(() => {
          const interval = firearm.maintenance_interval_months;
          const roundsInterval = firearm.maintenance_interval_rounds;
          const due = nextDueDate(interval, lastLog?.date ?? null);
          const PRESETS: { label: string; months: number | null }[] = [
            { label: 'Off', months: null },
            { label: '3 mo', months: 3 },
            { label: '6 mo', months: 6 },
            { label: '12 mo', months: 12 },
          ];
          const ROUND_PRESETS: { label: string; rounds: number | null }[] = [
            { label: 'Off', rounds: null },
            { label: '500', rounds: 500 },
            { label: '1K', rounds: 1000 },
            { label: '2K', rounds: 2000 },
          ];
          return (
            <View style={s.reminderCard}>
              <View style={s.reminderHeader}>
                <Text style={s.reminderTitle}>🔔 Maintenance Reminder</Text>
                {!ent.isPro ? (
                  <View style={s.proTag}><Text style={s.proTagText}>PRO</Text></View>
                ) : null}
              </View>
              <Text style={s.reminderDimLabel}>BY TIME</Text>
              <View style={s.reminderChips}>
                {PRESETS.map((p) => {
                  const active = (interval ?? null) === p.months;
                  return (
                    <TouchableOpacity
                      key={p.label}
                      style={[s.reminderChip, active && s.reminderChipActive]}
                      onPress={() => applyMaintenanceInterval(p.months)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.reminderChipText, active && s.reminderChipTextActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {(() => {
                  const custom = interval != null &&
                    !PRESETS.some(p => p.months === interval);
                  return (
                    <TouchableOpacity
                      style={[s.reminderChip, custom && s.reminderChipActive]}
                      onPress={() => openCustomInterval('months')}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.reminderChipText, custom && s.reminderChipTextActive]}>
                        {custom ? `${interval}mo` : '…'}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>
              <Text style={s.reminderDimLabel}>BY ROUND COUNT</Text>
              <View style={s.reminderChips}>
                {ROUND_PRESETS.map((p) => {
                  const active = (roundsInterval ?? null) === p.rounds;
                  return (
                    <TouchableOpacity
                      key={p.label}
                      style={[s.reminderChip, active && s.reminderChipActive]}
                      onPress={() => applyMaintenanceRoundsInterval(p.rounds)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.reminderChipText, active && s.reminderChipTextActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {(() => {
                  const custom = roundsInterval != null &&
                    !ROUND_PRESETS.some(p => p.rounds === roundsInterval);
                  return (
                    <TouchableOpacity
                      style={[s.reminderChip, custom && s.reminderChipActive]}
                      onPress={() => openCustomInterval('rounds')}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.reminderChipText, custom && s.reminderChipTextActive]}>
                        {custom ? `${roundsInterval}` : '…'}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>
              {interval && due ? (
                <Text style={s.reminderSub}>
                  Next: {formatDate(due.toISOString().slice(0, 10)) ?? due.toDateString()} · {nextDueLabel(due)}
                </Text>
              ) : interval && !lastLog ? (
                <Text style={s.reminderSub}>
                  Log your first maintenance entry to anchor the reminder.
                </Text>
              ) : (
                <Text style={s.reminderSub}>
                  Get a push notification when routine maintenance is due.
                </Text>
              )}
            </View>
          );
        })()}

        <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
          <Text style={s.deleteBtnText}>Delete Firearm</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Check-in modal */}
      <Modal
        visible={checkinOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCheckinOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalBackdrop}
        >
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Log Check-In</Text>
            <Text style={s.modalSub}>Stamps today's date on this NFA item</Text>

            <Text style={s.modalLabel}>METHOD</Text>
            <View style={s.chipRowModal}>
              {['eForms', 'Phone', 'Dealer', 'Other'].map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[s.chipModal, checkinMethod === m && s.chipModalActive]}
                  onPress={() => setCheckinMethod(m)}
                >
                  <Text style={[s.chipModalText, checkinMethod === m && s.chipModalTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.modalLabel}>NOTE (OPTIONAL)</Text>
            <TextInput
              value={checkinNote}
              onChangeText={setCheckinNote}
              placeholder="e.g. Portal still says pending"
              placeholderTextColor="#666"
              style={s.modalInput}
              multiline
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnGhost]}
                onPress={() => setCheckinOpen(false)}
              >
                <Text style={s.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.modalBtnPrimary]} onPress={saveCheckin}>
                <Text style={s.modalBtnPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Custom maintenance interval modal — one modal, two dimensions. */}
      <Modal
        visible={customOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCustomOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalBackdrop}
        >
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>
              Custom {customKind === 'months' ? 'Time Interval' : 'Round Threshold'}
            </Text>
            <Text style={s.modalSub}>
              {customKind === 'months'
                ? 'Enter a whole number of months (e.g. 18). Leave blank to disable.'
                : 'Enter a round count threshold (e.g. 1500). Leave blank to disable.'}
            </Text>

            <Text style={s.modalLabel}>
              {customKind === 'months' ? 'MONTHS' : 'ROUNDS'}
            </Text>
            <TextInput
              value={customValue}
              onChangeText={setCustomValue}
              keyboardType="number-pad"
              placeholder={customKind === 'months' ? 'e.g. 18' : 'e.g. 1500'}
              placeholderTextColor="#666"
              style={s.modalInput}
              autoFocus
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnGhost]}
                onPress={() => setCustomOpen(false)}
              >
                <Text style={s.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnPrimary]}
                onPress={saveCustomInterval}
              >
                <Text style={s.modalBtnPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Full-screen image viewer modal */}
      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <View style={s.viewerOverlay}>
          <TouchableOpacity style={s.viewerClose} onPress={() => setViewerVisible(false)}>
            <Text style={s.viewerCloseText}>✕</Text>
          </TouchableOpacity>
          {allImages.length > 0 && allImages[viewerIndex] ? (
            <Image
              source={{ uri: allImages[viewerIndex].uri }}
              style={s.viewerImage}
              resizeMode="contain"
            />
          ) : null}
          {allImages.length > 1 ? (
            <View style={s.viewerNav}>
              <TouchableOpacity
                onPress={() => setViewerIndex(i => Math.max(0, i - 1))}
                style={s.viewerNavBtn}
                disabled={viewerIndex === 0}
              >
                <Text style={[s.viewerNavText, viewerIndex === 0 && { opacity: 0.3 }]}>‹</Text>
              </TouchableOpacity>
              <Text style={s.viewerCounter}>{viewerIndex + 1} / {allImages.length}</Text>
              <TouchableOpacity
                onPress={() => setViewerIndex(i => Math.min(allImages.length - 1, i + 1))}
                style={s.viewerNavBtn}
                disabled={viewerIndex === allImages.length - 1}
              >
                <Text style={[s.viewerNavText, viewerIndex === allImages.length - 1 && { opacity: 0.3 }]}>›</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {allImages[viewerIndex]?.label ? (
            <Text style={s.viewerLabel}>{allImages[viewerIndex].label}</Text>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}function Row({ label, value, gold, last }: { label: string; value: string; gold?: boolean; last?: boolean }) {
  return (
    <View style={[s.row, !last && s.rowBorder]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, gold && s.rowValueGold]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  back: { color: GOLD, fontSize: 17 },
  edit: { color: GOLD, fontSize: 17 },
  scroll: { paddingBottom: 40 },
  hero: { width: '100%', height: 240, backgroundColor: SURFACE },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroIcon: { width: 100, height: 100, borderRadius: 22 },
  name: { color: '#FFF', fontSize: 26, fontWeight: '800', paddingHorizontal: 20, marginTop: 20, marginBottom: 4 },
  subtitle: { color: '#AAAAAA', fontSize: 16, paddingHorizontal: 20, marginBottom: 2 },
  type: { color: MUTED, fontSize: 15, paddingHorizontal: 20, marginBottom: 4 },
  triggerLine: { color: MUTED, fontSize: 13, paddingHorizontal: 20, marginBottom: 24 },
  sectionLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    paddingHorizontal: 20, marginBottom: 8, marginTop: 4 },
  dispPill: {
    alignSelf: 'center', marginBottom: 16,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14,
    backgroundColor: 'rgba(255, 87, 34, 0.14)',
    borderWidth: 1, borderColor: '#FF5722',
  },
  dispPillText: { color: '#FF8A65', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  dispEditHint: {
    color: MUTED, fontSize: 11, textAlign: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER,
  },
  disposeBtn: {
    marginHorizontal: 16, marginBottom: 20, paddingVertical: 14,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE, alignItems: 'center',
  },
  disposeBtnText: { color: GOLD, fontSize: 14, fontWeight: '600' },
  billOfSaleBtn: {
    marginHorizontal: 16, marginBottom: 20, paddingVertical: 14,
    borderRadius: 10, borderWidth: 1, borderColor: GOLD, alignItems: 'center',
  },
  billOfSaleBtnTxt: { color: GOLD, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: SURFACE, borderRadius: 14, marginHorizontal: 16, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rowLabel: { color: '#AAAAAA', fontSize: 15 },
  rowValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  rowValueGold: { color: GOLD },
  notesCard: { backgroundColor: SURFACE, borderRadius: 14, marginHorizontal: 16, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER, padding: 16 },
  notesLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  notesText: { color: '#CCCCCC', fontSize: 15, lineHeight: 22 },
  maintenanceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: SURFACE, borderRadius: 14, marginHorizontal: 16, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER, padding: 16 },
  maintenanceLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  maintenanceIcon: { fontSize: 28 },
  maintenanceTitle: { color: '#FFF', fontSize: 16, fontWeight: '700', marginBottom: 3 },
  maintenanceSub: { color: MUTED, fontSize: 13 },
  maintenanceChevron: { color: '#444', fontSize: 22 },
  // Reminder card — sits under the maintenance log row. Preset chips for
  // the interval so we avoid a full settings screen on MVP.
  reminderCard: {
    backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    padding: 14, marginTop: 10, marginBottom: 10,
  },
  reminderHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  reminderTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  proTag: {
    backgroundColor: '#2A2115', borderColor: '#3A2C18', borderWidth: 1,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
  },
  proTagText: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  reminderDimLabel: {
    color: MUTED, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.2, marginTop: 4, marginBottom: 6,
  },
  reminderChips: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  reminderChip: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#333',
    alignItems: 'center',
  },
  reminderChipActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  reminderChipText: { color: '#888', fontSize: 13, fontWeight: '600' },
  reminderChipTextActive: { color: GOLD },
  reminderSub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  accHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 20, marginTop: 4 },
  accAdd:      { color: GOLD, fontSize: 14, fontWeight: '600' },
  accEmpty:    { backgroundColor: SURFACE, borderRadius: 14, marginHorizontal: 16, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', padding: 20, alignItems: 'center' },
  accEmptyText:{ color: MUTED, fontSize: 14 },
  accList:     { marginHorizontal: 16, marginBottom: 20, gap: 8 },
  accCard:     { backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden' },
  accCardInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12 },
  accCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  replacedBtn: { borderTopWidth: 1, borderTopColor: BORDER,
    paddingVertical: 10, alignItems: 'center', backgroundColor: '#141414' },
  replacedBtnUrgent: { backgroundColor: 'rgba(255,87,34,0.12)' },
  replacedBtnText: { color: GOLD, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  replacedBtnTextUrgent: { color: '#FF5722' },
  nfaLinkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: BORDER, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: 'rgba(201,168,76,0.08)' },
  nfaLinkLabel: { color: GOLD, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, flex: 1 },
  nfaLinkChevron: { color: GOLD, fontSize: 18, fontWeight: '300', marginLeft: 8 },
  ammoTile: { backgroundColor: SURFACE, borderRadius: 14, marginHorizontal: 16, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  ammoTileBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14 },
  ammoTileLeft: { flex: 1 },
  ammoTileValue: { fontSize: 32, fontWeight: '800' },
  ammoTileUnit: { color: MUTED, fontSize: 12, marginTop: 2, fontWeight: '600' },
  ammoTileSub: { color: '#AAAAAA', fontSize: 13, marginTop: 6 },
  ammoTileBadge: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 4, backgroundColor: 'rgba(255,59,48,0.15)' },
  ammoTileBadgeLow: { backgroundColor: 'rgba(255,193,7,0.15)' },
  ammoTileBadgeText: { color: '#FF3B30', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  ammoTileBadgeTextLow: { color: '#FFC107' },
  ammoTileChevron: { color: '#444', fontSize: 22, marginLeft: 8 },
  ammoTileBtn: { borderTopWidth: 1, borderTopColor: BORDER, paddingVertical: 12,
    alignItems: 'center', backgroundColor: '#141414' },
  ammoTileBtnText: { color: GOLD, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  mountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  mountHost: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  mountAcc: { color: MUTED, fontSize: 12, marginTop: 2 },
  mountChevron: { color: '#444', fontSize: 20, marginLeft: 8 },
  accThumb:    { width: 40, height: 40, borderRadius: 8 },
  accThumbPlaceholder: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  accThumbIcon:{ fontSize: 18 },
  accName:     { color: '#FFF', fontSize: 15, fontWeight: '600' },
  accType:     { color: MUTED, fontSize: 12, marginTop: 2 },
  accChevron:  { color: '#444', fontSize: 20, marginLeft: 8 },
  battChipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  battDot:     { width: 6, height: 6, borderRadius: 3 },
  battChipText: { fontSize: 11, fontWeight: '700' },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingRight: 20 },
  historyHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyCount: { color: MUTED, fontSize: 13, fontWeight: '600' },
  historyChevron: { color: GOLD, fontSize: 18, fontWeight: '700', width: 14, textAlign: 'center' },
  historyList: { marginHorizontal: 16, marginBottom: 20,
    backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden' },
  historyRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  historyRowLast: { borderBottomWidth: 0 },
  historyRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4 },
  historyAcc: { color: '#FFF', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 8 },
  historyBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  historyBadgeActive: { backgroundColor: 'rgba(76,175,80,0.12)', borderColor: 'rgba(76,175,80,0.4)' },
  historyBadgeReplaced: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: BORDER },
  historyBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  historyBadgeTextActive: { color: '#4CAF50' },
  historyBadgeTextReplaced: { color: MUTED },
  historyMeta: { color: '#AAAAAA', fontSize: 12, marginBottom: 2 },
  historyInterval: { color: GOLD, fontSize: 11, fontWeight: '700' },
  galleryStrip: { paddingHorizontal: 16, paddingBottom: 4, gap: 10 },
  galleryTile: { width: 120, height: 120, borderRadius: 12, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, marginRight: 10,
    position: 'relative' },
  galleryImage: { width: '100%', height: '100%' },
  galleryPrimaryBadge: { position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 4 },
  galleryPrimaryText: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  galleryAddTile: { alignItems: 'center', justifyContent: 'center',
    borderStyle: 'dashed', borderColor: '#3A3A3A' },
  galleryAddPlus: { color: GOLD, fontSize: 32, fontWeight: '300', marginBottom: 2 },
  galleryAddLabel: { color: MUTED, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  galleryHint: { color: MUTED, fontSize: 12, paddingHorizontal: 20, marginTop: 6,
    marginBottom: 20 },
  deleteBtn: { marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,59,48,0.1)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)', alignItems: 'center' },
  deleteBtnText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  stampPreview: { width: '100%', height: 200, borderRadius: 8 },
  checkinRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  checkinMethod: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  checkinNote: { color: '#AAAAAA', fontSize: 12, marginTop: 2 },
  checkinDate: { color: GOLD, fontSize: 12, fontWeight: '600' },
  emptyCheckin: { color: MUTED, fontSize: 13, paddingVertical: 14, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: BG, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: BORDER,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#444', marginBottom: 12,
  },
  modalTitle: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  modalSub: { color: MUTED, fontSize: 13, marginTop: 4, marginBottom: 16 },
  modalLabel: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 8, marginBottom: 8 },
  chipRowModal: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipModal: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  chipModalActive: { backgroundColor: '#1E1A10', borderColor: GOLD },
  chipModalText: { color: '#CCCCCC', fontSize: 13, fontWeight: '600' },
  chipModalTextActive: { color: GOLD, fontWeight: '700' },
  modalInput: {
    backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    color: '#FFF', fontSize: 14, paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 70, textAlignVertical: 'top',
  },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalBtnGhost: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  modalBtnGhostText: { color: '#CCCCCC', fontSize: 15, fontWeight: '600' },
  modalBtnPrimary: { backgroundColor: GOLD },
  modalBtnPrimaryText: { color: '#000', fontSize: 15, fontWeight: '800' },
  rangeRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  rangeDate: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  rangeLocation: { color: MUTED, fontSize: 12, marginTop: 2 },
  rangeRounds: { color: GOLD, fontSize: 13, fontWeight: '700' },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 60, right: 20, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  viewerCloseText: { color: 'white', fontSize: 20, fontWeight: '600' },
  viewerImage: { width: '90%', height: '70%' },
  viewerNav: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 24 },
  viewerNavBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  viewerNavText: { color: 'white', fontSize: 32, fontWeight: '300' },
  viewerCounter: { color: '#aaa', fontSize: 14 },
  viewerLabel: { color: '#C9A84C', fontSize: 12, fontWeight: '600', marginTop: 8 },
});