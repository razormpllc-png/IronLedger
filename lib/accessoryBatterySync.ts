/**
 * Accessory → battery_log sync.
 *
 * Iron Ledger no longer asks users to create battery logs as a separate step.
 * The battery tracker is driven entirely from the accessory flow: whenever a
 * battery-powered accessory (Red Dot / Optic, Weapon Light, Laser Sight,
 * IR Device) is saved with a disposable / swappable / dual-solar power type
 * and a replacement date, we keep an active battery_log row in sync
 * automatically.
 *
 * The log is what powers the reminder notification and the "Batteries" hub,
 * which is now a rollup view over all the logs spawned by accessories.
 *
 * Design:
 *  - One active (unreplaced) log per accessory at most.
 *  - If the accessory qualifies but no log exists → create + schedule.
 *  - If the accessory qualifies and a log already exists → update in place
 *    and re-schedule the reminder.
 *  - If the accessory no longer qualifies (power type changed to
 *    rechargeable_internal, user cleared fields, etc.) → cancel the reminder
 *    and delete the active log. We don't mark-replaced here because the user
 *    didn't actually replace a battery; they just stopped tracking it.
 *  - `rechargeable_internal` never spawns a log: it's a charge reminder, not
 *    a battery replacement, and we render it differently.
 *
 * The only side effects are SQLite writes + expo-notifications scheduling,
 * both of which are no-ops in environments where the modules aren't loaded.
 */

import {
  addBatteryLog,
  updateBatteryLog,
  deleteBatteryLog,
  getActiveBatteryLogForAccessory,
  setBatteryNotificationId,
  markBatteryReplaced,
  getAccessoryById,
  updateAccessory,
  parseAccessoryDetails,
  type BatteryLog,
} from './database';
import {
  DEFAULT_LIFE_MONTHS,
  type BatteryType,
} from './batteryStats';
import {
  scheduleBatteryReminder,
  cancelBatteryReminder,
  ensurePermission,
  isAvailable as notificationsAvailable,
} from './batteryNotifications';

/** Accessory types that can have batteries. Kept local (not re-exported from
 *  database.ts) so the sync stays self-contained. */
const BATTERY_POWERED_TYPES = new Set([
  'Red Dot / Optic',
  'Weapon Light',
  'Laser Sight',
  'IR Device',
]);

/** Short human-readable label for the log, shown in the hub and on
 *  notifications. e.g. "Holosun 507C", "Red Dot", "Red Dot battery". */
function deriveDeviceLabel(
  accessoryType: string,
  make: string | null | undefined,
  model: string | null | undefined,
): string {
  const brand = [make, model].filter(Boolean).join(' ').trim();
  if (brand) return brand;
  return accessoryType;
}

/** Convert days → months using a 30-day month. Clamp to a sane range. */
function daysToMonths(days: number | undefined | null): number | null {
  if (!days || !isFinite(days) || days <= 0) return null;
  const months = Math.round(days / 30);
  if (months < 1) return 1;
  if (months > 120) return 120;
  return months;
}

/** Pull the battery fields off a parsed accessory details object, decide
 *  whether we have enough info to track a battery, and compute the values we
 *  need to write into battery_logs. Returns null if we should NOT have an
 *  active log for this accessory. */
function extractLogInputs(details: any): {
  battery_type: string;
  install_date: string;
  expected_life_months: number;
} | null {
  if (!details) return null;
  const powerType: string | undefined = details.power_type;
  if (!powerType) return null;

  // Internal rechargeables don't track battery replacement.
  if (powerType === 'rechargeable_internal') return null;

  // We need *some* kind of cell identifier + a replacement date.
  let cellId: string | undefined;
  if (powerType === 'rechargeable_swappable') {
    cellId = details.cell_type;
  } else {
    // disposable or dual_solar
    cellId = details.battery_type;
  }
  if (!cellId || typeof cellId !== 'string' || !cellId.trim()) return null;

  const installDate: string | undefined = details.date_battery_replaced;
  if (!installDate || typeof installDate !== 'string' || !installDate.trim()) return null;

  // Derive expected life: user-supplied interval wins; otherwise fall back to
  // the default for the battery type, otherwise a sensible 12-month default.
  const months =
    daysToMonths(details.replacement_interval_days) ??
    DEFAULT_LIFE_MONTHS[cellId as BatteryType] ??
    12;

  return {
    battery_type: cellId,
    install_date: installDate,
    expected_life_months: months,
  };
}

/** Main entry point — call this after saving an accessory to keep its
 *  matching battery_log row in sync. Safe to call even for non-battery
 *  accessories; it no-ops out. */
export async function syncAccessoryBatteryLog(args: {
  accessoryId: number;
  firearmId: number;
  accessoryType: string;
  accessoryMake?: string | null;
  accessoryModel?: string | null;
  /** The *parsed* details object, same shape that lives in accessories.details JSON. */
  parsedDetails: any;
}): Promise<void> {
  const {
    accessoryId, firearmId, accessoryType,
    accessoryMake, accessoryModel, parsedDetails,
  } = args;

  const existing = getActiveBatteryLogForAccessory(accessoryId);

  // Not a battery-powered accessory type → no log should exist. Clean up.
  if (!BATTERY_POWERED_TYPES.has(accessoryType)) {
    if (existing) await destroyLog(existing);
    return;
  }

  const inputs = extractLogInputs(parsedDetails);
  // Accessory is battery-powered but doesn't have enough info (e.g. user
  // cleared the replacement date) → pull down the active log.
  if (!inputs) {
    if (existing) await destroyLog(existing);
    return;
  }

  const device_label = deriveDeviceLabel(accessoryType, accessoryMake, accessoryModel);

  if (!existing) {
    // Fresh log.
    const newId = addBatteryLog({
      firearm_id: firearmId,
      accessory_id: accessoryId,
      device_label,
      battery_type: inputs.battery_type,
      install_date: inputs.install_date,
      expected_life_months: inputs.expected_life_months,
    });
    await scheduleReminderFor(newId, {
      id: newId,
      firearm_id: firearmId,
      accessory_id: accessoryId,
      device_label,
      battery_type: inputs.battery_type,
      install_date: inputs.install_date,
      expected_life_months: inputs.expected_life_months,
      replacement_date: null,
      notification_id: null,
      notes: null,
      created_at: '',
    });
    return;
  }

  // Existing log → update in place. If the user-facing values (install date,
  // expected life, battery type, or label) changed, cancel the old reminder
  // and schedule a new one so the OS notification reflects the new due date.
  const anythingChanged =
    existing.install_date !== inputs.install_date ||
    existing.expected_life_months !== inputs.expected_life_months ||
    existing.battery_type !== inputs.battery_type ||
    existing.device_label !== device_label ||
    existing.firearm_id !== firearmId;

  updateBatteryLog(existing.id, {
    firearm_id: firearmId,
    accessory_id: accessoryId,
    device_label,
    battery_type: inputs.battery_type,
    install_date: inputs.install_date,
    expected_life_months: inputs.expected_life_months,
    notification_id: anythingChanged ? null : existing.notification_id,
    notes: existing.notes,
  });

  if (anythingChanged) {
    await cancelBatteryReminder(existing.notification_id);
    await scheduleReminderFor(existing.id, {
      ...existing,
      firearm_id: firearmId,
      accessory_id: accessoryId,
      device_label,
      battery_type: inputs.battery_type,
      install_date: inputs.install_date,
      expected_life_months: inputs.expected_life_months,
      notification_id: null,
    });
  }
}

/** Called when the accessory was deleted or power type was flipped to
 *  internal-rechargeable — cancel the reminder and drop the log. */
async function destroyLog(log: BatteryLog): Promise<void> {
  await cancelBatteryReminder(log.notification_id);
  deleteBatteryLog(log.id);
}

/** Best-effort reminder scheduling. Asks for permission if we don't already
 *  have it. Silently does nothing in environments where expo-notifications
 *  isn't installed. */
async function scheduleReminderFor(logId: number, log: BatteryLog): Promise<void> {
  if (!notificationsAvailable()) return;
  const ok = await ensurePermission();
  if (!ok) return;
  const notifId = await scheduleBatteryReminder(log);
  if (notifId) setBatteryNotificationId(logId, notifId);
}

/** Today's date in MM/DD/YYYY — matches the format used by the accessory
 *  form's `autoFormatDate`, so round-tripping through the edit screen shows
 *  the same date the user would type in. */
function todayMDY(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** One-tap "Replaced Today" action from the accessory card.
 *
 *  Unlike the edit-in-place flow (which just updates the existing log when
 *  the install date changes), this deliberately:
 *   1. Closes out the existing log with replacement_date = today — so the
 *      history row stays in battery_logs for future reporting,
 *   2. Cancels the old OS reminder,
 *   3. Updates the accessory's own `date_battery_replaced` to today (so the
 *      accessory form shows the new date when the user opens it),
 *   4. Creates a fresh active log via the normal sync, which also
 *      schedules a new reminder for the next replacement cycle.
 *
 *  Returns true if a new log was created, false if the accessory wasn't
 *  eligible (e.g. non-battery type, or power_type=rechargeable_internal).
 */
export async function markAccessoryBatteryReplacedToday(
  accessoryId: number,
): Promise<boolean> {
  const accessory = getAccessoryById(accessoryId);
  if (!accessory) return false;

  const today = todayMDY();

  // 1–2: close the current log, if any.
  const existing = getActiveBatteryLogForAccessory(accessoryId);
  if (existing) {
    const prevNotifId = markBatteryReplaced(existing.id, today);
    await cancelBatteryReminder(prevNotifId);
  }

  // 3: stamp today's date onto the accessory itself so the form stays in
  //    sync with the log.
  const details = parseAccessoryDetails<Record<string, any>>(accessory) ?? {};
  details.date_battery_replaced = today;
  const newDetailsJson = JSON.stringify(details);
  updateAccessory(accessoryId, {
    accessory_type: accessory.accessory_type,
    make: accessory.make,
    model: accessory.model,
    serial_number: accessory.serial_number,
    notes: accessory.notes,
    image_uri: accessory.image_uri,
    details: newDetailsJson,
  });

  // 4: let the regular sync create the new log + schedule the next ping.
  await syncAccessoryBatteryLog({
    accessoryId,
    firearmId: accessory.firearm_id,
    accessoryType: accessory.accessory_type,
    accessoryMake: accessory.make,
    accessoryModel: accessory.model,
    parsedDetails: details,
  });

  return !!getActiveBatteryLogForAccessory(accessoryId);
}
