# Proxy API Services

Running the Last.fm widget purely client-side means exposing your Last.fm API key to the public. This backend proxy sits between the frontend widget and Last.fm's Audioscrobbler API to avoid that, along with a few other practical problems.

## Why a proxy is needed

1. **API key isolation** — the key lives only in server/edge environment variables and is never sent to the client.
2. **CORS handling** — Last.fm's API does not return permissive CORS headers by default. The proxy injects `Access-Control-Allow-Origin` based on a configurable hostname whitelist.
3. **Caching and throttling** — Last.fm's API has intermittent downtime and aggressive rate limiting. The proxy caches the last successful response and serves it (stale-while-revalidate) when upstream requests fail. A hibernate mode also pauses outgoing requests entirely after a rate-limit response, to avoid getting the API key banned.

Two implementations exist, both functionally identical: the original Deno version and a Cloudflare Workers port.

---

## Option 1: Deno Deploy

Original implementation in `proxy-api.ts`. Cache state is held in memory.

### Setup

1. Fork/clone this repository and push it to your own GitHub account.
2. Create a new project on [Deno Deploy](https://deno.com/deploy) linked to your repo.
3. Set the entrypoint to `main.ts`, or write a minimal entry script that serves `proxyApi` directly if you only need the proxy and not the demo site.
4. Set the following environment variables in the Deno Deploy project settings:

| Variable | Required | Description |
| --- | --- | --- |
| `audioscrobbler_apikey` | Yes | Your Last.fm API key. Get one [here](https://www.last.fm/api/account/create). |
| `audioscrobbler_user` | No | Default username to fetch scrobbles for. Defaults to `rockland` if unset. |
| `audioscrobbler_trackslimit` | No | Number of recent tracks to fetch per request. |
| `audioscrobbler_cors_allow_hostnames` | No | Semicolon-separated list of allowed origins (e.g. `example.com;localhost`). If unset, no CORS headers are injected. |

### Local development

```bash
deno run --allow-net --allow-env --allow-read=./demo,./widgets main.ts
```

Note: Deno Deploy runs on multiple edge nodes globally, so the in-memory cache is per-node, not shared globally. This is a known limitation, not a bug — each node will independently warm its own cache.

---

## Option 2: Cloudflare Workers

Port located in `services/cloudflare-worker/index.ts`. Instead of in-memory caching, this version uses the native **Cloudflare Cache API**, since Worker isolates are short-lived and in-memory state does not persist reliably between invocations. This makes the fallback cache behavior consistent across Cloudflare's edge network.

### Requirements

- [Node.js](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
cd services/cloudflare-worker
npm install -g wrangler
```

### Setup

1. **Authenticate Wrangler with your Cloudflare account**:
```bash
   wrangler login
```
   This opens a browser window to log in (or sign up, if you don't have a Cloudflare account yet) and authorize the Wrangler CLI. If your account has multiple Cloudflare accounts attached, you may need to set `account_id` in `wrangler.toml` to avoid being prompted each time.

2. **Configure variables** — edit the `[vars]` section in `services/cloudflare-worker/wrangler.toml`: set `audioscrobbler_user`, `audioscrobbler_trackslimit`, and `audioscrobbler_cors_allow_hostnames`. Do not put the API key here, as this file is committed to git.

3. **Set the API key as a secret**:
```bash
   wrangler secret put audioscrobbler_apikey
```
   You'll be prompted to paste the key in the terminal.

4. **Local development**:
```bash
   wrangler dev
```

5. **Deploy**:
```bash
   wrangler deploy
```
   On first deploy, Wrangler creates the Worker on your account using the `name` field from `wrangler.toml`, and returns a `*.workers.dev` URL. Point the frontend widget's backend URL at this endpoint.

### Custom domain (optional)

To serve the proxy from your own domain instead of `*.workers.dev`, add a route in `wrangler.toml` or bind a custom domain via the Cloudflare dashboard under Workers & Pages → your worker → Triggers → Custom Domains.

---

## Internals

- **Method whitelisting** — only `user.getinfo` and `user.getrecenttracks` are accepted. Any other method parameter is rejected before reaching Last.fm.
- **Error codes** — internal failures return proxy-specific JSON error codes rather than raw exceptions:
  - `{error: 3}` — method not allowed (requested method is outside the whitelist).
  - `{error: 6}` — no method specified in the request.
  - `{error: 8}` — API key missing from environment/secrets.
  - `{error: 16}` — not ready; upstream fetch failed and no cached response exists yet to fall back on.
- **Hibernate mode** — triggered by Last.fm error `26` (suspended API key) or `29` (rate limit exceeded). While active, the proxy stops issuing upstream requests and serves cached data only, until the cooldown period elapses.

## Choosing between the two

| | Deno Deploy | Cloudflare Workers |
| --- | --- | --- |
| Cache persistence | In-memory, per-node | Cloudflare Cache API, edge-persistent |
| Free tier | Generous | 100k requests/day |
| Setup complexity | Lower (git-linked auto-deploy) | Requires Wrangler CLI |
| Best for | Quick setup, low-to-moderate traffic | Higher traffic, more consistent caching |

Both expose the same request/response contract, so the frontend widget works identically regardless of which backend is used.