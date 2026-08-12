# Proxy API Services

Running the Last.fm widget purely client-side means exposing your Last.fm API key to the public. A backend proxy sits between the frontend widget and Last.fm's Audioscrobbler API to avoid that, along with a few other practical problems.

You should pretty easily be able to get your own proxy API up and running on [Deno Deploy](https://deno.com/deploy) by following the instructions here.

## Why a proxy is strongly recommended

1. **API key isolation** — the key lives only in server/edge environment variables and is never sent to the client.
2. **CORS handling** — Last.fm's API does not return permissive CORS headers by default. The proxy injects `Access-Control-Allow-Origin` based on a configurable hostname whitelist.
3. **Caching and throttling** — Last.fm's API has intermittent downtime and aggressive rate limiting. The proxy caches the last successful response and serves it (stale-while-revalidate) when upstream requests fail. A hibernate mode also pauses outgoing requests entirely after a rate-limit response, to avoid getting the API key banned.

There are two implementations in this repository, functionally identical: The default Deno proxy and a Cloudflare Workers (Node.js) version.

---

## Option 1: Deno KV or in-memory

The default Deno proxy-cache implementation used when deploying this project is using Deno KV. Implementation is in `proxy-api.ts` and the cache state is by default held in a key-value database (Deno KV).
Alternatively, you can configure it to use in-memory cache instead. KV is generally to be preferred when possible, but there are monthly read and write limits for KV-values if you are hosting on, for example, Deno Deploy. And if the limits become a problem, the in-memory variant is good to have as a fallback option.

Also, KV is still considered an 'in development' technology. But it has existed for a while and seems reliable – at least for non-critical use.

### Setup using Deno Deploy

1. Fork/clone this repository and push it to your own GitHub account.
2. Create a new project on [Deno Deploy](https://deno.com/deploy) linked to your repository.
3. Set the entrypoint to `main.ts`.
4. *Only needed for KV:* Go to "Databases" configuration for the created Deno Deploy project and attach a Deno KV database to the project.
5. Set the following environment variables in the Deno Deploy project settings:

| Variable | Required | Description                                                                                                                                                                                                               |
| --- | --- |---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `audioscrobbler_apikey` | Yes | Your Last.fm API key. Get one [here](https://www.last.fm/api/account/create).                                                                                                                                             |
| `audioscrobbler_user` | No | Username to fetch scrobbles for. Defaults to `rockland` if unset.                                                                                                                                                         |
| `audioscrobbler_trackslimit` | No | Number of recent tracks to fetch per request.                                                                                                                                                                             |
| `audioscrobbler_cors_allow_hostnames` | No | Semicolon-separated list of allowed origins (e.g. `example.com;localhost`). If unset, no CORS headers are injected.                                                                                                       |
| `proxy_use` | No | If set to `mem`, the *in-memory* proxy-cache is used. Otherwise *Deno KV* proxy-cache is used (default and generally recommended).                                                                                        |
| `webpage_show` | No | If set to `demo`, the demo-page is shown on the deployed site. Otherwise a "promotion page" pointing to [the *official* demo site/page](https://lastfm-widgets.stignygaard.deno.net/) is shown (default and recommended). |

Actually, the proxy in "KV-mode" uses a "two-level cache" implementation. KV is the "primary cache", but in-memory cache is also used for a "first-level cache".

The proxy is served from `/proxy-api` on the deployed site. Set the `backend` attribute on your widget to point to this address.

To avoid confusion about where the official demo-page for the widget is located, I appreciate if you for public deployments, only enable demo-page _temporarily_ for test and verification.

Notice, it is recommended to use widget [v1.13 or newer](https://github.com/StigNygaard/lastfm-widgets/releases "Get latest version of the Tracks widget"). If you are using version 1.11 or older, it is [a good idea](https://github.com/StigNygaard/lastfm-widgets/issues/4) to set the `ignorebots` attribute on the widget.

### Local development

Run locally with 

```bash
deno task start
```

or in "developer-mode" with "auto-restart" when changes to code is detected

```bash
deno task dev
```

(Above *tasks* "start" and "dev" are defined in `deno.json`)

---

## Option 2: Cloudflare Workers (Node.js)

Port located in `cf-worker/index.ts`. This version uses the native **Cloudflare Cache API**. This makes the fallback cache behavior consistent across Cloudflare's edge network.

### Requirements

- [Node.js](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
cd cf-worker
npm install -g wrangler
```

### Setup

1. **Authenticate Wrangler with your Cloudflare account**:
```bash
   wrangler login
```
   This opens a browser window to log in (or sign up, if you don't have a Cloudflare account yet) and authorize the Wrangler CLI. If your account has multiple Cloudflare accounts attached, you may need to set `account_id` in `wrangler.toml` to avoid being prompted each time.

2. **Configure variables** — edit the `[vars]` section in `cf-worker/wrangler.toml`: set `audioscrobbler_user`, `audioscrobbler_trackslimit`, and `audioscrobbler_cors_allow_hostnames`. Do not put the API key here, as this file is committed to git.

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

## Choosing which proxy to use

All options expose the same request/response contract, so the frontend widget works identically regardless of which backend is used. If you ain't already using either platform, Deno KV solution on Deno Deploy is probably an easy and free way to get a backend-proxy for your widget. Deno Deploy has monthly read and write limits for Deno KV. If that could be an issue depends on factors like activity (usage) of widget, how often your scrobble new tracks, your widget's update-interval and length of widget's shown playlist. For most, I think a free-tier Deno Deploy account is enough for a Deno KV proxy, if Deno KV is used only for the Tracks widget. But I'm also still collecting practical experience on this myself, as the KV-based proxy-implementation is still very new. 

The in-memory cache can be short-living (Deno Deploy is said to keep in-active applications alive between 5 seconds to 10 minutes depending on general system load). Also, In-memory cache is per-node in an "edge network" like Deno Deploy. The in-memory option is better than nothing, but Deno KV or Cloudflare Workers are better choices when possible to use.    
