/**
 * Battery math + defaults.
 *
 * All functions are pure — no DB or notification calls here. The hub and
 * editor screens use these to compute due dates, urgency buckets, and to
 * seed the "expected life" default when the user picks a battery type.
 */

import type { BatteryLog, BatteryLogWithFirearm } from './database';

/** Common battery types used in optics / lights / lasers, with a
 *  best-guess default lifespan for moderate use. Users can override per log. */
export const BATTERY_TYPES = [
  'CR2032', 'CR1632', 'CR123A', 'CR2', 'AA', 'AAA', '18650', 'Other',
] as const;

export type BatteryType = typeof BATTERY_TYPES[number];

/** Default expected life in months per battery type. These are conservative
 *  so we nudge users toward early replacement rather than dead optics. */
export const DEFAULT_LIFE_MONTHS: Record<BatteryType, number> = {
  'CR2032': 12,   // typical RDS (Holosun, Trijicon RMR) at moderate setting
  'CR1632': 8,
  'CR123A': 18,   // weapon lights and some RDS
  'CR2': 12,
  'AA': 6,        // frequently-used lights
  'AAA': 6,
  '18650': 6,
  'Other': 12,
};

export type BatteryBucket = 'overdue' | 'due_soon' | 'ok';

/** Tunable threshold — anything due in the next 30 days is "due_soon". */
export const DUE_SOON_THRESHOLD_DAYS = 30;

// ────────────────────────────────────────────────────────────────────────
// Date parsing and math
// ────────────────────────────────────────────────────────────────────────

/** Parse MM/DD/YYYY, YYYY-MM-DD, or MMDDYYYY into a Date at local midnight.
 *  Returns null for unparseable strings. */
export function parseDateLoose(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\/\-\.]/g, '');
  let y: number, m: number, d: number;
  if (digits.length === 8) {
    const firstFour = parseInt(digits.slice(0, 4), 10);
    if (firstFour > 1900 && firstFour < 2100) {
      y = firstFour;
      m = parseInt(digits.slice(4, 6), 10);
      d = parseInt(digits.slice(6, 8), 10);
    } else {
      m = parseInt(digits.slice(0, 2), 10);
      d = parseInt(digits.slice(2, 4), 10);
      y = parseInt(digits.slice(4, 8), 10);
    }
  } else {
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    y = parsed.getFullYear();
    m = parsed.getMonth() + 1;
    d = parsed.getDate();
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  return new Date(y, m - 1, d);
}

/** Add an integer number of months to a date, preserving day-of-month
 *  when possible and clamping when the target month has fewer days. */
export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  // If the original day didn't exist in the target month (e.g. Jan 31 + 1
  // month), JS rolls over to the next month. Detect and clamp to last day.
  if (out.getDate() !== date.getDate()) {
    return new Date(out.getFullYear(), out.getMonth(), 0);
  }
  return out;
}

/** Due date = install_date + expected_life_months. Returns null if install
 *  date won't parse. */
export function dueDateFor(log: BatteryLog | BatteryLogWithFirearm): Date | null {
  const installed = parseDateLoose(log.install_date);
  if (!installed) return null;
  return addMonths(installed, log.expected_life_months);
}

/** Signed days from now until the due date. Negative = overdue. */
export function daysUntilDue(log: BatteryLog | BatteryLogWithFirearm, now: Date = new Date()): number | null {
  const due = dueDateFor(log);
  if (!due) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueMid = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.round((dueMid.getTime() - today.getTime()) / msPerDay);
}

export function bucketFor(log: BatteryLog | BatteryLogWithFirearm, now: Date = new Date()): BatteryBucket {
  const d = daysUntilDue(log, now);
  if (d === null) return 'ok';
  if (d < 0) return 'overdue';
  if (d <= DUE_SOON_THRESHOLD_DAYS) return 'due_soon';
  return 'ok';
}

export function groupByBucket<T extends BatteryLog | BatteryLogWithFirearm>(
  logs: T[],
  now: Date = new Date()
): Record<BatteryBucket, T[]> {
  const out: Record<BatteryBucket, T[]> = { overdue: [], due_soon: [], ok: [] };
  for (const log of logs) out[bucketFor(log, now)].push(log);
  // Within each bucket, sort by due date ascending so most urgent is first.
  const sortByDue = (a: T, b: T) => {
    const ad = dueDateFor(a)?.getTime() ?? Infinity;
    const bd = dueDateFor(b)?.getTime() ?? Infinity;
    return ad - bd;
  };
  out.overdue.sort(sortByDue);
  out.due_soon.sort(sortByDue);
  out.ok.sort(sortByDue);
  return out;
}

/** Human-friendly label like "Due in 12 days", "3 days overdue", or "Due today". */
export function dueLabel(log: BatteryLog | BatteryLogWithFirearm, now: Date = new Date()): string {
  const d = daysUntilDue(log, now);
  if (d === null) return '—';
  if (d === 0) return 'Due today';
  if (d < 0) {
    const n = Math.abs(d);
    return `${n} day${n === 1 ? '' : 's'} overdue`;
  }
  if (d === 1) return 'Due tomorrow';
  if (d < 30) return `Due in ${d} days`;
  const months = Math.round(d / 30);
  return `Due in ~${months} month${months === 1 ? '' : 's'}`;
}

/** Formats MM/DD/YYYY for display. Returns raw string on parse failure. */
export function formatDueDate(log: BatteryLog | BatteryLogWithFirearm): string {
  const d = dueDateFor(log);
  if (!d) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}
