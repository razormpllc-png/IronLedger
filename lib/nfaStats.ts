// NFA status grouping + wait-time statistics.
// Pure functions operating on any NFA-trackable row (firearm or suppressor)
// — no side effects, easy to unit test later.

import type { Firearm } from './database';

/**
 * Minimal shape needed to bucket + compute wait times.
 * Both Firearm and Suppressor satisfy this (structural typing).
 */
export interface NfaTrackable {
  atf_form_status: string | null;
  date_filed: string | null;
  date_approved: string | null;
}

export type NfaBucket = 'pending' | 'approved' | 'denied' | 'unfiled';

/** Order buckets render in on the hub. */
export const BUCKET_ORDER: NfaBucket[] = ['pending', 'approved', 'denied', 'unfiled'];

export const BUCKET_LABEL: Record<NfaBucket, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  unfiled: 'Not Filed',
};

/**
 * Classify an NFA item by its current status/dates.
 *
 * Rules:
 *  - approved → atf_form_status is "Approved" OR date_approved is present
 *  - denied   → atf_form_status is "Denied"
 *  - pending  → filed (date_filed or explicit Pending status) but not approved/denied
 *  - unfiled  → everything else (e.g. "Not Yet Filed" or blank)
 */
export function bucketFor(f: NfaTrackable): NfaBucket {
  const status = (f.atf_form_status ?? '').toLowerCase();
  if (status.includes('approved') || f.date_approved) return 'approved';
  if (status.includes('denied')) return 'denied';
  if (status.includes('pending') || f.date_filed) return 'pending';
  return 'unfiled';
}

export interface NfaGroup<T extends NfaTrackable = Firearm> {
  bucket: NfaBucket;
  label: string;
  items: T[];
}

export function groupByStatus<T extends NfaTrackable>(items: T[]): NfaGroup<T>[] {
  const empty: Record<NfaBucket, T[]> = {
    pending: [], approved: [], denied: [], unfiled: [],
  };
  for (const f of items) {
    empty[bucketFor(f)].push(f);
  }
  // Within a bucket, newest-filed first.
  for (const b of BUCKET_ORDER) {
    empty[b].sort((a, z) => (z.date_filed ?? '').localeCompare(a.date_filed ?? ''));
  }
  return BUCKET_ORDER
    .filter(b => empty[b].length > 0)
    .map(b => ({ bucket: b, label: BUCKET_LABEL[b], items: empty[b] }));
}

/** Parse MM/DD/YYYY or YYYY-MM-DD into a Date, or null if invalid. */
function parseDateLoose(raw: string | null): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // ISO style
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  // US style MM/DD/YYYY or MM-DD-YYYY
  const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, mm, dd, yyRaw] = m;
    const yy = yyRaw.length === 2 ? 2000 + parseInt(yyRaw, 10) : parseInt(yyRaw, 10);
    const d = new Date(yy, parseInt(mm, 10) - 1, parseInt(dd, 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/** Days between two date strings (inclusive of calendar-date math). */
export function daysBetween(a: string | null, b: string | null): number | null {
  const da = parseDateLoose(a);
  const db = parseDateLoose(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

/** Days since the filing date up to today. */
export function daysWaiting(f: NfaTrackable): number | null {
  if (!f.date_filed) return null;
  const today = new Date().toISOString().slice(0, 10);
  return daysBetween(f.date_filed, today);
}

/** Wait time in days between filed and approved for an approved stamp. */
export function waitTimeDays(f: NfaTrackable): number | null {
  if (!f.date_filed || !f.date_approved) return null;
  return daysBetween(f.date_filed, f.date_approved);
}

export interface WaitTimeStats<T extends NfaTrackable = NfaTrackable> {
  count: number;          // approved items with both dates
  avg: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  fastest: T | null;
  slowest: T | null;
}

export function computeWaitTimeStats<T extends NfaTrackable>(items: T[]): WaitTimeStats<T> {
  const enriched: { f: T; days: number }[] = [];
  for (const f of items) {
    const d = waitTimeDays(f);
    if (d !== null && d >= 0) enriched.push({ f, days: d });
  }
  if (enriched.length === 0) {
    return { count: 0, avg: null, median: null, min: null, max: null, fastest: null, slowest: null };
  }
  const sorted = [...enriched].sort((a, z) => a.days - z.days);
  const count = sorted.length;
  const sum = sorted.reduce((s, x) => s + x.days, 0);
  const avg = sum / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[mid - 1].days + sorted[mid].days) / 2 : sorted[mid].days;
  return {
    count,
    avg: Math.round(avg),
    median: Math.round(median),
    min: sorted[0].days,
    max: sorted[count - 1].days,
    fastest: sorted[0].f,
    slowest: sorted[count - 1].f,
  };
}

/**
 * For a pending item, project an approximate approval date using the
 * personal average wait time. Returns null if we don't have stats yet.
 */
export function projectApprovalDate(filed: string | null, stats: WaitTimeStats<any>): Date | null {
  if (stats.avg === null) return null;
  const d = parseDateLoose(filed);
  if (!d) return null;
  const projected = new Date(d.getTime() + stats.avg * 24 * 60 * 60 * 1000);
  return projected;
}

export function formatProjectedDate(d: Date | null): string | null {
  if (!d) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
