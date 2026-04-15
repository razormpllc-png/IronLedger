/**
 * Maintenance rollup — aggregates per-firearm maintenance reminder state
 * into a dashboard-ready summary, mirroring the shape batteryStats uses
 * for batteries (bucket + counts + upcoming entries).
 *
 * Only firearms with `maintenance_interval_months > 0` are included. The
 * "last log date" used to anchor the next-due calculation comes from the
 * newest entry in maintenance_logs for that firearm. Firearms with an
 * interval configured but no logs yet are placed in the `pending` bucket
 * so the dashboard can nudge the user to log their first entry.
 */

import type { Firearm } from './database';
import {
  getAllFirearms, getLatestMaintenanceDate, getRoundsSinceLastCleaning,
} from './database';
import { nextDueDate, nextDueLabel } from './maintenanceNotifications';

export type MaintenanceBucket = 'overdue' | 'due_soon' | 'ok' | 'pending';

/** How many days ahead of next-due we flip from `ok` → `due_soon`. Matches
 *  the battery hub threshold so the visual signal is consistent. */
const DUE_SOON_DAYS = 30;

/** Fraction of the round-count threshold that triggers a "due soon" signal.
 *  At 80% of the threshold we start nudging, so e.g. a 1,000-round interval
 *  flips to due_soon at 800 rounds fired since last cleaning. */
const ROUNDS_DUE_SOON_RATIO = 0.8;

export interface MaintenanceEntry {
  firearm: Firearm;
  lastLogDate: string | null;    // Raw MM/DD/YYYY string from maintenance_logs
  dueDate: Date | null;          // Null when no log yet (pending bucket)
  daysUntilDue: number | null;   // Negative when overdue
  bucket: MaintenanceBucket;
  label: string;                 // "overdue by 12 days" / "650/1000 rds" / etc
  /** Rounds fired since the last cleaning, if a round-count threshold
   *  was set. Null when the firearm has no round-count threshold. */
  roundsSinceCleaning: number | null;
  roundsThreshold: number | null;
  /** Human-readable reason this entry is in its bucket. "time" or "rounds"
   *  so the UI can render the right icon. */
  reason: 'time' | 'rounds' | 'both' | 'none';
}

export interface MaintenanceRollup {
  entries: MaintenanceEntry[];
  overdue: number;
  dueSoon: number;
  pending: number;
  total: number;                 // Number of firearms with an interval set
}

/** Build the rollup. Safe to call from any render path — reads happen
 *  via synchronous SQLite. */
export function getMaintenanceRollup(now: Date = new Date()): MaintenanceRollup {
  const firearms = getAllFirearms();
  const entries: MaintenanceEntry[] = [];

  const bucketRank: Record<MaintenanceBucket, number> = {
    overdue: 0, due_soon: 1, pending: 2, ok: 3,
  };

  for (const f of firearms) {
    const months = f.maintenance_interval_months ?? 0;
    const roundsThreshold = f.maintenance_interval_rounds ?? 0;
    const hasTime = months > 0;
    const hasRounds = roundsThreshold > 0;
    if (!hasTime && !hasRounds) continue;

    const last = getLatestMaintenanceDate(f.id);

    // ── Time-based dimension ────────────────────────────────────────
    let timeBucket: MaintenanceBucket | null = null;
    let due: Date | null = null;
    let days: number | null = null;
    let timeLabel = '';

    if (hasTime) {
      due = nextDueDate(months, last);
      if (!due) {
        timeBucket = 'pending';
        timeLabel = 'log first entry to start countdown';
      } else {
        days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
        if (days < 0) timeBucket = 'overdue';
        else if (days <= DUE_SOON_DAYS) timeBucket = 'due_soon';
        else timeBucket = 'ok';
        timeLabel = nextDueLabel(due, now);
      }
    }

    // ── Rounds-based dimension ──────────────────────────────────────
    let roundsBucket: MaintenanceBucket | null = null;
    let roundsSince: number | null = null;
    let roundsLabel = '';

    if (hasRounds) {
      roundsSince = getRoundsSinceLastCleaning(f.id);
      if (roundsSince >= roundsThreshold) roundsBucket = 'overdue';
      else if (roundsSince >= Math.floor(roundsThreshold * ROUNDS_DUE_SOON_RATIO)) {
        roundsBucket = 'due_soon';
      } else {
        roundsBucket = 'ok';
      }
      roundsLabel = `${roundsSince}/${roundsThreshold} rds`;
    }

    // ── Combine: pick worse of the two dimensions ───────────────────
    let bucket: MaintenanceBucket;
    let reason: MaintenanceEntry['reason'] = 'none';
    let label = '';

    if (timeBucket && roundsBucket) {
      const worse = bucketRank[timeBucket] <= bucketRank[roundsBucket]
        ? timeBucket : roundsBucket;
      bucket = worse;
      // Reason annotation: both, or whichever dimension owns the bucket.
      if (timeBucket === roundsBucket) reason = 'both';
      else reason = bucketRank[timeBucket] < bucketRank[roundsBucket] ? 'time' : 'rounds';
      // Label: if both point at same urgency, join; else show worse side.
      if (reason === 'both') label = `${timeLabel} · ${roundsLabel}`;
      else if (reason === 'time') label = timeLabel;
      else label = roundsLabel;
    } else if (timeBucket) {
      bucket = timeBucket;
      reason = 'time';
      label = timeLabel;
    } else {
      // hasRounds only
      bucket = roundsBucket!;
      reason = 'rounds';
      label = roundsLabel;
    }

    entries.push({
      firearm: f,
      lastLogDate: last,
      dueDate: due,
      daysUntilDue: days,
      bucket,
      label,
      roundsSinceCleaning: roundsSince,
      roundsThreshold: hasRounds ? roundsThreshold : null,
      reason,
    });
  }

  // Sort: overdue (most-overdue first) → due_soon → pending → ok (soonest
  // first). This matches the battery widget's "most urgent on top" feel.
  entries.sort((a, b) => {
    const diff = bucketRank[a.bucket] - bucketRank[b.bucket];
    if (diff !== 0) return diff;
    if (a.daysUntilDue === null && b.daysUntilDue === null) return 0;
    if (a.daysUntilDue === null) return 1;
    if (b.daysUntilDue === null) return -1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  let overdue = 0, dueSoon = 0, pending = 0;
  for (const e of entries) {
    if (e.bucket === 'overdue') overdue++;
    else if (e.bucket === 'due_soon') dueSoon++;
    else if (e.bucket === 'pending') pending++;
  }

  return { entries, overdue, dueSoon, pending, total: entries.length };
}
