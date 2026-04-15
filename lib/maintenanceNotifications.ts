/**
 * Maintenance reminder scheduling — mirror of lib/batteryNotifications.ts.
 *
 * Scope is intentionally narrow: users set a month-based interval on a
 * firearm (e.g. "remind me every 6 months"). When a maintenance log is
 * saved we cancel any existing reminder and schedule a new one anchored
 * off that log's date. Round-count thresholds are evaluated in-app (not
 * via push) because push triggers are fundamentally time-based.
 *
 * expo-notifications is loaded dynamically so the JS bundle still builds
 * in Expo Go on iOS where scheduled push isn't supported. All functions
 * no-op safely when the module is missing.
 */

import { Platform } from 'react-native';
import type { Firearm } from './database';

let Notifications: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-notifications');
  Notifications = mod.default ?? mod;
} catch {
  Notifications = null;
}

export function isAvailable(): boolean {
  return Notifications !== null;
}

/** Ask the user for notification permission. Returns true if granted.
 *  Safe to call repeatedly. Mirrors the battery version so both features
 *  can share permission state on the platform. */
export async function ensurePermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return true;
    if (existing.canAskAgain === false) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

/** Parse the MM/DD/YYYY date string that maintenance logs are stored in.
 *  Returns null if the string is missing or malformed — we tolerate partial
 *  input because this helper is also called on legacy rows. */
function parseMaintenanceDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (!month || !day || !year) return null;
  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Compute the next-due date for a firearm given its interval and the
 *  most recent maintenance log date. Returns null if either input is
 *  missing. Exposed so UI can render "next due on …" without duplicating
 *  the arithmetic. */
export function nextDueDate(
  intervalMonths: number | null | undefined,
  lastLogDate: string | null | undefined,
): Date | null {
  if (!intervalMonths || intervalMonths <= 0) return null;
  const last = parseMaintenanceDate(lastLogDate);
  if (!last) return null;
  const due = new Date(last);
  due.setMonth(due.getMonth() + intervalMonths);
  return due;
}

/** Human-readable "due in X days" / "overdue by X days" label. */
export function nextDueLabel(due: Date | null, now: Date = new Date()): string {
  if (!due) return '';
  const ms = due.getTime() - now.getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return 'due today';
  if (days > 0) return `due in ${days} day${days === 1 ? '' : 's'}`;
  const overdue = Math.abs(days);
  return `overdue by ${overdue} day${overdue === 1 ? '' : 's'}`;
}

/** Schedule a maintenance reminder push. Fires 9am local on the due date
 *  (or tomorrow 9am if the due date has already passed, so the OS never
 *  rejects a past trigger). Returns the notification id for later cancel,
 *  or null on failure / missing module / missing inputs. */
export async function scheduleMaintenanceReminder(
  firearm: Pick<Firearm, 'id' | 'make' | 'model' | 'nickname' | 'maintenance_interval_months'>,
  lastLogDate: string | null,
): Promise<string | null> {
  if (!Notifications) return null;
  const due = nextDueDate(firearm.maintenance_interval_months, lastLogDate);
  if (!due) return null;

  let when = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 9, 0, 0);
  const now = new Date();
  if (when.getTime() <= now.getTime() + 60_000) {
    when = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    when.setHours(9, 0, 0, 0);
  }

  const label = firearm.nickname?.trim()
    ? firearm.nickname.trim()
    : `${firearm.make ?? ''} ${firearm.model ?? ''}`.trim();

  const title = '🔧 Maintenance due';
  const body = `${label} — scheduled maintenance is ${nextDueLabel(due, now)}`;

  try {
    const id: string = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { firearmId: firearm.id, kind: 'maintenance_reminder' },
        sound: Platform.OS === 'ios' ? 'default' : undefined,
      },
      trigger: when,
    });
    return id;
  } catch {
    return null;
  }
}

/** Cancel a previously-scheduled reminder. Tolerates unknown ids. */
export async function cancelMaintenanceReminder(
  notification_id: string | null | undefined,
): Promise<void> {
  if (!Notifications || !notification_id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notification_id);
  } catch {
    // Already fired or never existed — safe to swallow.
  }
}
