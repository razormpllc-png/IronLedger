// Founders counter client.
//
// Polls a Cloudflare Worker to learn how many Founders lifetime slots remain.
// The paywall uses this to show a live "216 / 1,000 remaining" line and to
// block the purchase button when the pool is fully claimed.
//
// Graceful degradation is the design goal: if the endpoint is unreachable,
// times out, or the config URL is empty, the client returns `null` and the
// paywall falls back to the static "First 1,000 customers" copy with the
// purchase flow unchanged.

import { FOUNDERS_CAP, FOUNDERS_COUNTER_URL } from './purchaseConfig';

export interface FoundersStatus {
  claimed: number;       // Slots sold so far
  cap: number;           // Total slots available
  remaining: number;     // cap - claimed, clamped to >= 0
  soldOut: boolean;      // remaining === 0
  fetchedAt: number;     // ms since epoch when this snapshot was taken
}

interface CacheEntry {
  status: FoundersStatus;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;       // 30 seconds — paywall polls on mount
const FETCH_TIMEOUT_MS = 4_000;    // Bail fast; paywall stays usable either way

let cache: CacheEntry | null = null;
let inflight: Promise<FoundersStatus | null> | null = null;

/**
 * Fetch the latest founders count. Cached for 30s. Returns null when the
 * endpoint is not configured, unreachable, or returns an unexpected shape.
 */
export async function getFoundersStatus(): Promise<FoundersStatus | null> {
  if (!FOUNDERS_COUNTER_URL) return null;

  // Serve from cache when fresh enough.
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.status;
  }

  // De-dupe concurrent callers during a single fetch.
  if (inflight) return inflight;

  inflight = fetchOnce().finally(() => { inflight = null; });
  return inflight;
}

async function fetchOnce(): Promise<FoundersStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FOUNDERS_COUNTER_URL, {
      method: 'GET',
      signal: controller.signal,
      // Always grab the freshest number — the worker's own KV TTL handles
      // rate limiting. Don't let any caches between client and worker stale
      // the paywall's "sold out" signal.
      headers: { 'Cache-Control': 'no-cache' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const status = normalize(json);
    if (!status) return null;
    cache = { status, fetchedAt: status.fetchedAt };
    return status;
  } catch (e) {
    clearTimeout(timer);
    if (__DEV__) console.log('[founders] fetch failed', e);
    return null;
  }
}

function normalize(raw: unknown): FoundersStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const claimed = typeof obj.claimed === 'number' ? obj.claimed : null;
  if (claimed === null || claimed < 0) return null;

  const cap = typeof obj.cap === 'number' && obj.cap > 0 ? obj.cap : FOUNDERS_CAP;
  const remainingRaw =
    typeof obj.remaining === 'number' ? obj.remaining : cap - claimed;
  const remaining = Math.max(0, remainingRaw);
  const soldOut = typeof obj.sold_out === 'boolean' ? obj.sold_out : remaining <= 0;

  return {
    claimed,
    cap,
    remaining,
    soldOut,
    fetchedAt: Date.now(),
  };
}

/**
 * Exported for tests and diagnostics — forces the next call to re-fetch.
 */
export function invalidateFoundersCache(): void {
  cache = null;
}
