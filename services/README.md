# Proxy API Services

Running the Last.fm widget purely client-side means exposing your Last.fm API key to the public. A backend proxy sits between the frontend widget and Last.fm's Audioscrobbler API to avoid that, along with a few other practical problems.

( *Note, I'm in the process of restructuring and hopefully also simplifying this page a bit. But I think all needed information is here.* ) 

## Why a proxy is strongly recommended

1. **API key isolation** — the key lives only in server/edge environment variables and is never sent to the client.
2. **CORS handling** — Last.fm's API does not return permissive CORS headers by default. The proxy injects `Access-Control-Allow-Origin` based on a configurable hostname whitelist.
3. **Caching and throttling** — Last.fm's API has intermittent downtime and aggressive rate limiting. The proxy caches the last successful response and serves it (stale-while-revalidate) when upstream requests fail. A hibernate mode also pauses outgoing requests entirely after a rate-limit response, to avoid getting the API key banned.

There are two proxy-API implementations in this repository, functionally identical: A Deno version and a Cloudflare Workers (Node.js) version. The latter is kindly contributed to this project by [burnblazter](https://github.com/burnblazter).

Bellow follows suggestions and instructions to host this project (including the proxy-API to serve your widget):

1. Deno proxy-API
   
    a) On _[Deno Deploy](https://deno.com/deploy)_ ("deprecated")

    b) On _[Velixir](https://velixir.net/r/g6xs4f89)_

    c) On other hosting options

    d) Running locally (the "developer setup")

2. Node.js proxy-API as Cloudflare Workers

---

## 1. Deno proxy-API

Originally the _Deno proxy-API_ (and demo-site) was made with hosting on _Deno Deploy_ in mind. With the [latest news about Deno and Deno Deploy](https://deno.com/blog/cloudflare) Deno Deploy is however no longer a long-time solution. But the Deno runtime is _open source_, so even if the original team abandons the runtime in October 2027, I expect the runtime will [continue to live on in some form](https://github.com/denoland/deno/issues/37030 "The Deno runtime will continue to live on in some form"). Maybe only with a small team of volunteers maintaining it, but if we are lucky a larger investor or interessent sees a reason to invest in further development of the runtime. I love Deno for its simple tooling/setup, security by default design and the commitment to align with webstandards whenever possible, so I have no plan to panic and stop using Deno. But _Deno Deploy_ is expected to shut down some time in Spring 2027 (April 2027?), so better look at alternatives...

The Deno proxy-API implementation is located in `proxy-api.ts`. It is either using _Deno KV_ (A Key-Value storage) for caching, or simply holding data in-memory. A persistent KV is preferred for apps running in short living processes, like on Deno Deploy (Deno KV is still considered an 'in development' technology, but it has existed for a while and seems reliable – at least for non-critical use). But for long-living processes on for example Velixir and Koyeb, "in-memory" caching is the practical choice.

When it has been set up, the proxy-service is served from `/proxy-api` on the deployed site. Set the `backend` attribute on your widget to point to this address. There's no need to set attributes `user`, `apikey` or `tracks` on the widget, those values are controlled from the backend/proxy only.

### a) On Deno Deploy ("deprecated")

**Notice, _Deno Deploy_ will be shut down, probably in Spring or Summer 2027.** 

Processes lives relatively short on Deno Deploy, so Deno KV is generally the preferred cache type to choose. There are however monthly read and write limits for KV-values on Deno Deploy. And if the limits become a problem, the in-memory variant is good to have as a fallback option.

Setup steps:

1. Fork/clone this repository and push it to your own GitHub account.
2. Create a new project on [Deno Deploy](https://deno.com/deploy) linked to your repository.
3. Set the entrypoint to `main.ts`.
4. Go to "Databases" configuration for the created Deno Deploy project and attach a Deno KV database to the project.
5. Set the needed environment variables in the Deno Deploy project settings:

| Variable | Required | Description                                                                                                                                                                                                                                      |
| --- | --- |--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `audioscrobbler_apikey` | Yes | Your Last.fm API key. Get one [here](https://www.last.fm/api/account/create).                                                                                                                                                                    |
| `audioscrobbler_user` | No | Username to fetch scrobbles for. Defaults to `rockland` if unset.                                                                                                                                                                                |
| `audioscrobbler_trackslimit` | No | Number of recent tracks to fetch per request. Using the Last.fm default (50) if unset.                                                                                                                                                 |
| `audioscrobbler_cors_allow_hostnames` | No | Semicolon-separated list of allowed origins (e.g. `example.com;localhost`). If unset, no CORS headers are injected.                                                                                                                              |
| `proxy_use` | No | If set to `mem`, the *in-memory* proxy-cache is used. If unset, *Deno KV* proxy-cache is used.                                                                                                               |
| `webpage_show` | No | If set to `demo`, the demo-page is shown on the deployed site. If unset, a "promotion page" pointing to [the *official* demo site/page](https://lastfm-widgets.com/) is shown. To avoid confusion about where the official demo-page for the widget is located, I appreciate if you for public deployments, only enable demo-page _temporarily_ for test and verification. |

Actually, the proxy in "KV-mode" uses a "two-level cache" implementation. KV is the "primary cache", but in-memory cache is also used for a non-persistent - possibly _very_ short-living - "first-level cache".

With this setup, any changes to the main-branch of your Git-repository, is auto-deployed to your Deno Deploy project.

### b) On Velixir

On [Velixir](https://velixir.net/r/g6xs4f89) apps generally runs in "long processes". On a free plan "semi-long processes", but still long enough to make in-memory caching a perfect choice for your proxy-API. Setting it up is also pretty easy...

You do ___NOT__ need_ to create your own fork/clone of this project on GitHub. If you want to, you can deploy code directly from the [official lastfm-widgets repository](https://github.com/StigNygaard/lastfm-widgets) to your _own_ site/project on Velixir. To deploy the latest version from the official lastfm-widgets repository, create an account on [Velixir](https://velixir.net/r/g6xs4f89) and:

1. Go to https://velixir.net/new
2. Choose "Deploy a public GitHub repo" and enter "https://github.com/StigNygaard/lastfm-widgets"...
3. Choose a plan for the app ("Free" is fine) and enter needed environment variables:
   ```
   audioscrobbler_apikey=<your-api-key>
   audioscrobbler_user=<lastfm-username>
   proxy_use=mem
   serve_port=8080
   ```
   and you probably also want to - at least temporary - add `webpage_show=demo` to easily be able to verify a successful deployment.
4. Create the app

With this setup, deploying is triggered _as-needed_ from the "Deploys"-tab on your Velixir project's Dashboard ("Deploy latest commit" button). But if you have created your own fork/clone on GitHub, setting up "auto-deploy" on new commits is also an option: https://velixir.net/blog/push-to-deploy-from-github-with-pr-previews.

The trade-off for the free plan, is that app "sleeps" after a period (15 min?) of inactivity, and it takes a few seconds to wake up the proxy-API when it has been "sleeping" (The app does a "cold start" with empty cache). So initializing a widget that uses the proxy-API is sometimes a little slower. But I _don't_ find it annoyingly slow. Currently [lastfm-widgets.com](https://lastfm-widgets.com/), including the proxy-API used by widgets on [rockland.dk](https://www.rockland.dk/), runs on a "Free" plan at Velixir, and I think it performs very well.

Would you like to use KV? The Deno runtime has built-in KV support, but on Velixir the runtime lives in a container that is re-created on restarts. So there's no advantage in using Deno's built-in KV support instead of the simple in-memory caching. You can however use a SQLite database on an attached [Volume](https://velixir.net/docs/volumes) or an external managed Deno KV database instead, if you want a persistent KV storage. You can tell the app which database to use for KV, by setting path in the environment-variable `proxy_kv_path`. You might however also need to update the read/write permissions of the "start" task in [deno.json](https://github.com/StigNygaard/lastfm-widgets/blob/main/deno.json) before it works - or you can add a `velixir.json` to the project with a "web" command that overrides the "start" task in `deno.json`. You can even use environment variables in `velixir.json` ([See example from another Deno project](https://github.com/StigNygaard/feedbender/blob/main/velixir.json "A velixir.json file with a web command that gets location for read and write permissions from environment variables")).

You can read more about [running Deno on Velixir](https://velixir.net/languages/deno).

### c) On other hosting options

Have you tried other hosting options? I would love to hear about it!

I'm considering at least to also give [Koyeb](https://www.koyeb.com/) a try. Maybe also [Railway](https://railway.com/) or other options if they can be done without altering the codebase (too much?) - and without too high hosting expenses.

### d) Running locally (the developer setup)
To run a local clone of this project, you need to have [Deno installed](https://docs.deno.com/runtime/getting_started/installation/ "Install Deno"). Next, make sure you have the relevants of above-mentioned environment variables defined (including `webpage_show=demo` if you want the demo-page to play with). The easiest way to define these variables in a local setup, is to add them in a `.env` file in the root of the project-folder (see `.env.example`). Then...

Run locally with:

```bash
deno task start
```

or run in "developer-mode" with "auto-restart" when changes to code are detected:

```bash
deno task dev
```

(Above *tasks* "start" and "dev" are defined in `deno.json`)

---

## 2. Cloudflare Workers (Node.js)

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
