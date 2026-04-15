/**
 * Widget data payload — computed on the JS side, written to a shared App
 * Group container so the iOS WidgetKit extension can read it on its own
 * timeline. The widget process cannot execute JS or read SQLite directly,
 * so the entire story has to be baked into this JSON.
 *
 * Keep the payload SMALL — widgets re-fetch infrequently but they also
 * decode it on every timeline tick, and shared UserDefaults has a soft
 * cap around 1MB. Capping "top N" lists at 3 keeps us well under that.
 *
 * Shape is frozen for on-device back-compat: the Swift side decodes by
 * name, so adding a new field is safe (old widgets ignore it), but
 * renaming or removing a field requires a widget extension update.
 */
import {
  getAllFirearms,
  getTotalRoundsFired,
  getAllNfaItems,
  getPendingNfaSuppressors,
  getActiveBatteryLogs,
  getAmmoRollupsByCaliber,
  Firearm,
  Suppressor,
} from './database';
import { daysWaiting } from './nfaStats';
import { bucketFor, dueLabel, parseDateLoose } from './batteryStats';
import type { BatteryLogWithFirearm } from './database';

/** Payload version — bump any time the Swift decoder needs to change. */
export const WIDGET_PAYLOAD_VERSION = 1;

export interface WidgetPayload {
  v: number;
  /** ISO-8601 UTC timestamp of when the payload was generated. */
  generatedAt: string;

  armory: {
    firearmCount: number;
    totalValue: number;
    totalRounds: number;
  };

  form4: {
    pending: number;
    oldestDays: number | null;
    /** Pending stamps sorted by days-waiting descending, cap 3. */
    top: Array<{ label: string; days: number }>;
  };

  batteries: {
    overdue: number;
    dueSoon: number;
    /** Overdue + due-soon accessory batteries, earliest-due first, cap 3. */
    top: Array<{ label: string; due: string; status: 'overdue' | 'due_soon' }>;
  };

  ammo: {
    outOfStock: number;
    low: number;
    /** Empty calibers first, then lowest rounds, cap 3. */
    top: Array<{ caliber: string; rounds: number; status: 'empty' | 'low' }>;
  };
}

/** Compose "Make Model" / nickname label for a firearm. */
function firearmLabel(f: Firearm): string {
  if (f.nickname) return f.nickname;
  const parts = [f.make, f.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Firearm';
}

/** Epoch-ms helper for sorting battery logs by computed due date. */
function dueDateEpoch(log: BatteryLogWithFirearm): number {
  const d = parseDateLoose(log.install_date);
  if (!d) return Infinity;
  d.setMonth(d.getMonth() + (log.expected_life_months ?? 0));
  return d.getTime();
}

/** Build the full widget payload from the live DB. Pure read — never writes. */
export function buildWidgetPayload(): WidgetPayload {
  const firearms = getAllFirearms();
  const nfa = getAllNfaItems();
  const pendingSuppressors = getPendingNfaSuppressors();
  const batteries = getActiveBatteryLogs();
  const ammo = getAmmoRollupsByCaliber();
  const totalRounds = getTotalRoundsFired();

  // --- Armory ---
  const totalValue = firearms.reduce((sum, f) => sum + (f.current_value || 0), 0);

  // --- Form 4 ---
  // Merge pending firearms + suppressors so the widget queue reflects the
  // full NFA picture now that suppressors are a first-class NFA item.
  const pendingFirearms = nfa.filter(
    f => (f.date_filed && !f.date_approved) ||
         (f.atf_form_status?.toLowerCase().includes('pending') ?? false)
  );
  type PendingRow = { label: string; days: number };
  const firearmRows = pendingFirearms
    .map(f => ({ f, days: daysWaiting(f) }))
    .filter((x): x is { f: Firearm; days: number } => x.days !== null)
    .map(({ f, days }): PendingRow => ({ label: firearmLabel(f), days }));
  const suppressorRows = pendingSuppressors
    .map(s => ({ s, days: daysWaiting(s) }))
    .filter((x): x is { s: Suppressor; days: number } => x.days !== null)
    .map(({ s, days }): PendingRow => ({
      label: `${s.make} ${s.model}`.trim() || 'Suppressor',
      days,
    }));
  const pendingAll = [...firearmRows, ...suppressorRows].sort((a, b) => b.days - a.days);
  const oldestDays = pendingAll.length > 0 ? pendingAll[0].days : null;
  const topForm4 = pendingAll.slice(0, 3);
  const pendingTotal = pendingFirearms.length + pendingSuppressors.length;

  // --- Batteries ---
  const overdueCount = batteries.filter(l => bucketFor(l) === 'overdue').length;
  const dueSoonCount = batteries.filter(l => bucketFor(l) === 'due_soon').length;
  const urgent = batteries
    .filter(l => {
      const b = bucketFor(l);
      return b === 'overdue' || b === 'due_soon';
    })
    .sort((a, b) => dueDateEpoch(a) - dueDateEpoch(b))
    .slice(0, 3)
    .map(l => {
      const acc =
        [l.accessory_make, l.accessory_model].filter(Boolean).join(' ') ||
        l.accessory_type ||
        l.device_label ||
        'Battery';
      const bucket = bucketFor(l);
      return {
        label: acc,
        due: dueLabel(l),
        status: bucket === 'overdue' ? ('overdue' as const) : ('due_soon' as const),
      };
    });

  // --- Ammo ---
  const flagged = ammo.filter(r => r.anyEmpty || r.anyLow);
  const outOfStockCount = flagged.filter(r => r.anyEmpty).length;
  const lowCount = flagged.filter(r => !r.anyEmpty && r.anyLow).length;
  const topAmmo = flagged
    .sort((a, b) => {
      if (a.anyEmpty !== b.anyEmpty) return a.anyEmpty ? -1 : 1;
      return a.rounds - b.rounds;
    })
    .slice(0, 3)
    .map(r => ({
      caliber: r.caliber,
      rounds: r.rounds,
      status: r.anyEmpty ? ('empty' as const) : ('low' as const),
    }));

  return {
    v: WIDGET_PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    armory: {
      firearmCount: firearms.length,
      totalValue,
      totalRounds,
    },
    form4: {
      pending: pendingTotal,
      oldestDays,
      top: topForm4,
    },
    batteries: {
      overdue: overdueCount,
      dueSoon: dueSoonCount,
      top: urgent,
    },
    ammo: {
      outOfStock: outOfStockCount,
      low: lowCount,
      top: topAmmo,
    },
  };
}
