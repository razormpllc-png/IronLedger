/**
 * Thin wrapper around expo-notifications for battery reminders.
 *
 * We don't take a hard dependency here — expo-notifications is a large
 * native module that may not be installed in every development workflow
 * (notably Expo Go on iOS no longer supports scheduled push). When the
 * module is missing, all functions no-op safely and `isAvailable()` returns
 * false so the UI can fall back to "we'll show due batteries when you open
 * the app" messaging.
 */

import { Platform } from 'react-native';
import { dueDateFor, dueLabel } from './batteryStats';
import type { BatteryLog, BatteryLogWithFirearm } from './database';

// Dynamic require so the bundle still compiles on environments where
// expo-notifications isn't installed. We pick up both CommonJS and ESM shapes.
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
 *  Safe to call repeatedly — iOS/Android will only prompt once. */
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

/** Schedule a reminder for when a battery is expected to hit end-of-life.
 *  Returns the notification id for later cancellation, or null on failure.
 *  Fires at 9am local on the due date so it doesn't wake the user up. */
export async function scheduleBatteryReminder(
  log: BatteryLog | BatteryLogWithFirearm
): Promise<string | null> {
  if (!Notifications) return null;
  const due = dueDateFor(log);
  if (!due) return null;

  // 9am local on the due date — if we're already past that, fire it
  // tomorrow at 9am so the notification is never scheduled in the past.
  let when = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 9, 0, 0);
  const now = new Date();
  if (when.getTime() <= now.getTime() + 60_000) {
    when = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    when.setHours(9, 0, 0, 0);
  }

  const title = '🔋 Battery replacement due';
  const body = `${log.device_label} (${log.battery_type}) — ${dueLabel(log, now)}`;

  try {
    const id: string = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { batteryLogId: log.id, kind: 'battery_reminder' },
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
export async function cancelBatteryReminder(notification_id: string | null | undefined): Promise<void> {
  if (!Notifications || !notification_id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notification_id);
  } catch {
    // Already fired or never existed — safe to swallow.
  }
}
