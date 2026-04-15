// Iron Ledger Founders Counter — Cloudflare Worker
// ---------------------------------------------------------------------------
// Tracks how many Founders Lifetime slots have been claimed. The paywall app
// polls this worker to show live remaining counts and to lock the purchase
// button when the pool is exhausted.
//
// Routes
//   GET  /                       → JSON counter for the mobile app
//   POST /claim                  → increment counter, called by RevenueCat
//                                  webhook on lifetime purchase events
//   GET  /admin                  → admin JSON (requires Bearer token)
//   POST /admin/adjust           → manual adjustment (admin only)
//
// Storage
//   KV namespace FOUNDERS: key "claimed" → number as string
//
// Secrets / vars (bind in wrangler.toml)
//   CAP                 — total Founders slots (e.g. "1000")
//   REVENUECAT_SECRET   — shared secret RevenueCat includes in the webhook
//   ADMIN_TOKEN         — your personal admin bearer for /admin routes
//
// Deploy
//   wrangler deploy

export interface Env {
  FOUNDERS: KVNamespace;
  CAP: string;
  REVENUECAT_SECRET: string;
  ADMIN_TOKEN: string;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  // Mobile app fetches from a client; CORS wide-open is fine for a public
  // read-only counter. The write endpoints guard themselves with secrets.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  // KV caches at the edge anyway; ask intermediate caches to stay out of it.
  'Cache-Control': 'no-store',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    try {
      if (url.pathname === '/' && request.method === 'GET') {
        return json(await readStatus(env));
      }

      if (url.pathname === '/claim' && request.method === 'POST') {
        return handleClaim(request, env);
      }

      if (url.pathname === '/admin' && request.method === 'GET') {
        if (!authorizeAdmin(request, env)) return unauthorized();
        return json(await readStatus(env));
      }

      if (url.pathname === '/admin/adjust' && request.method === 'POST') {
        if (!authorizeAdmin(request, env)) return unauthorized();
        return handleAdjust(request, env);
      }

      return json({ error: 'not_found' }, 404);
    } catch (e) {
      console.error('[founders-counter] fatal', e);
      return json({ error: 'server_error' }, 500);
    }
  },
};

// ───────────────────────────────────────────────────────────────────────────

async function readStatus(env: Env) {
  const claimed = await readClaimed(env);
  const cap = parseInt(env.CAP || '1000', 10);
  const remaining = Math.max(0, cap - claimed);
  return {
    claimed,
    cap,
    remaining,
    sold_out: remaining <= 0,
  };
}

async function readClaimed(env: Env): Promise<number> {
  const raw = await env.FOUNDERS.get('claimed');
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function writeClaimed(env: Env, next: number): Promise<void> {
  await env.FOUNDERS.put('claimed', String(Math.max(0, Math.floor(next))));
}

// ───────────────────────────────────────────────────────────────────────────
// POST /claim — called by the RevenueCat webhook on INITIAL_PURCHASE of the
// lifetime product. Body is RevenueCat's event envelope; we only care that
// the shared secret matches and the event is for a lifetime entitlement.
//
// Idempotency: we stash the original_transaction_id so a RC retry on the
// same event doesn't double-increment.
// ───────────────────────────────────────────────────────────────────────────

interface RevenueCatWebhookBody {
  event?: {
    type?: string;
    product_id?: string;
    entitlement_ids?: string[];
    original_transaction_id?: string;
  };
}

async function handleClaim(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${env.REVENUECAT_SECRET}`) {
    return unauthorized();
  }

  let body: RevenueCatWebhookBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const evt = body?.event;
  if (!evt) return json({ error: 'no_event' }, 400);

  // Only count inbound INITIAL_PURCHASE or NON_RENEWING_PURCHASE events that
  // grant the `founders` entitlement. Renewals and transfers don't increment.
  const qualifiesType = evt.type === 'INITIAL_PURCHASE' || evt.type === 'NON_RENEWING_PURCHASE';
  const grantsFounders = (evt.entitlement_ids ?? []).includes('founders');
  if (!qualifiesType || !grantsFounders) {
    return json({ ok: true, counted: false, reason: 'not_founders_initial' });
  }

  const txId = evt.original_transaction_id;
  if (!txId) return json({ error: 'missing_tx' }, 400);

  const dedupeKey = `claim:${txId}`;
  const seen = await env.FOUNDERS.get(dedupeKey);
  if (seen) {
    return json({ ok: true, counted: false, reason: 'duplicate' });
  }

  const claimed = await readClaimed(env);
  const next = claimed + 1;
  await writeClaimed(env, next);
  await env.FOUNDERS.put(dedupeKey, '1', { expirationTtl: 60 * 60 * 24 * 365 });

  return json({ ok: true, counted: true, claimed: next });
}

// ───────────────────────────────────────────────────────────────────────────
// POST /admin/adjust — manual counter corrections. Body: { set?: number,
// delta?: number }. `set` replaces; `delta` adds.
// ───────────────────────────────────────────────────────────────────────────

async function handleAdjust(request: Request, env: Env): Promise<Response> {
  let body: { set?: number; delta?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const current = await readClaimed(env);
  let next = current;
  if (typeof body.set === 'number') next = body.set;
  else if (typeof body.delta === 'number') next = current + body.delta;
  else return json({ error: 'need_set_or_delta' }, 400);

  await writeClaimed(env, next);
  return json({ ok: true, before: current, after: Math.max(0, Math.floor(next)) });
}

// ───────────────────────────────────────────────────────────────────────────

function authorizeAdmin(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization') ?? '';
  return authHeader === `Bearer ${env.ADMIN_TOKEN}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function unauthorized(): Response {
  return json({ error: 'unauthorized' }, 401);
}
