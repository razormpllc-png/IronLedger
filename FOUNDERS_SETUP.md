# Founders Counter — Cloudflare Worker Setup

The paywall shows a live "N / 1,000 LEFT" badge on the Founders Lifetime card when this worker is deployed. Ships disabled by default; activate whenever you're ready.

## What it does

- `GET /` — public JSON the mobile app polls every 30s: `{ claimed, cap, remaining, sold_out }`.
- `POST /claim` — increments the counter. Called by a RevenueCat webhook when a lifetime purchase settles.
- `GET /admin` and `POST /admin/adjust` — bearer-protected admin endpoints for inspection and manual corrections.

## Deploy

Install wrangler if you don't have it, then from `workers/founders-counter/`:

```bash
cd workers/founders-counter
npm install

# 1. Create the KV namespace, then paste its ID into wrangler.toml.
wrangler kv namespace create FOUNDERS

# 2. Set the shared secrets. RevenueCat needs the first value, you keep the second.
wrangler secret put REVENUECAT_SECRET
wrangler secret put ADMIN_TOKEN

# 3. Deploy.
wrangler deploy
```

After deploy, wrangler prints your worker URL, e.g. `https://ironledger-founders.<account>.workers.dev`.

## Wire the app

Open `lib/purchaseConfig.ts` and set:

```ts
export const FOUNDERS_COUNTER_URL = 'https://ironledger-founders.<account>.workers.dev/';
export const FOUNDERS_CAP = 1000;
```

That's it. Reload the app, open the paywall; the Founders card now shows the live remaining count. If the worker is down or returns garbage, the card silently falls back to the static "LIMITED" pill and purchases still work.

## Wire the RevenueCat webhook

In the RevenueCat dashboard:

1. Open **Project Settings → Integrations → Webhooks**.
2. Add a new endpoint: `https://ironledger-founders.<account>.workers.dev/claim`.
3. Set the **Authorization header** to `Bearer <REVENUECAT_SECRET>` — the exact secret you set with `wrangler secret put REVENUECAT_SECRET`.
4. Enable event types: `INITIAL_PURCHASE` and `NON_RENEWING_PURCHASE`.
5. Save.

The worker only increments when the event type qualifies AND the entitlement list contains `founders`. It also dedupes by `original_transaction_id`, so RevenueCat retries and replays will not double-count.

## Manual admin

```bash
# Read counter (bearer required)
curl https://ironledger-founders.<account>.workers.dev/admin \
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# Set counter to a specific value
curl -X POST https://ironledger-founders.<account>.workers.dev/admin/adjust \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"set": 37}'

# Nudge the counter by a delta
curl -X POST https://ironledger-founders.<account>.workers.dev/admin/adjust \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"delta": 1}'
```

## Cost and scaling

KV reads/writes are on Cloudflare's generous free tier — the paywall polls every 30s and that's orders of magnitude below the included quota. The worker stores a single integer plus one dedupe key per claim (auto-expiring after 365 days).

## Expanding the pool

If you decide to raise the Founders ceiling, edit `CAP` in `wrangler.toml`, redeploy, and update `FOUNDERS_CAP` in `lib/purchaseConfig.ts`. The client reads `cap` from the worker response, so changing it in wrangler is sufficient — the app copy updates on the next poll.
