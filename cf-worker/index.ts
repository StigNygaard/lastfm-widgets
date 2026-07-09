export interface Env {
    audioscrobbler_apikey: string;
    audioscrobbler_user?: string;
    audioscrobbler_trackslimit?: string;
    audioscrobbler_cors_allow_hostnames?: string;
}

let fetchSuccessCount = 0;
let fetchErrorCount = 0;
let hibernate = false; // In case of error 26 or 29, enter Hibernate mode

const waitNext = new Map([
    // Seconds until next call to last.fm method is allowed.
    ['user.getinfo', {
        ok: 3600,
        failedWithFallback: 1800,
        failedWithoutFallback: 60
    }],
    ['user.getrecenttracks', {
        ok: 30,
        failedWithFallback: 120,
        failedWithoutFallback: 60
    }]
]);

function waitUntilTime(method: string, isHibernate: boolean) {
    const now = Date.now();
    const data = waitNext.get(method);
    if (isHibernate || !data) {
        if (!data) console.error(`ERROR! Unknown method "${method}"`);
        return {
            ok: 3600000 + now,
            failedWithFallback: 3600000 + now,
            failedWithoutFallback: 3600000 + now
        };
    }
    return {
        ok: data.ok * 1000 + now,
        failedWithFallback: data.failedWithFallback * 1000 + now,
        failedWithoutFallback: data.failedWithoutFallback * 1000 + now
    };
}

async function getCacheData(request: Request, method: string) {
    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = '/_internal_cache/' + method;
    const cacheKey = new Request(cacheUrl.toString());
    const cache = caches.default;

    const response = await cache.match(cacheKey);
    if (response) {
        const nextTime = parseInt(response.headers.get('X-Next-Time') || '0', 10);
        const okResponse = await response.text();
        return { okResponse, nextTime, cacheKey, cache };
    }
    return { okResponse: null, nextTime: 0, cacheKey, cache };
}

async function setCacheData(cache: Cache, cacheKey: Request, okResponse: string, nextTime: number) {
    const response = new Response(okResponse, {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 's-maxage=31536000, max-age=31536000', // Keep in cache for a long time
            'X-Next-Time': nextTime.toString()
        }
    });
    await cache.put(cacheKey, response);
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const reqHeaders = request.headers;
        const origin = reqHeaders.get('Origin');
        const respHeaders = new Headers({ 'Content-Type': 'application/json' });

        const corsAllowHostnames = (env.audioscrobbler_cors_allow_hostnames || '')
            .toLowerCase()
            .split(/\s*(?:;|$)\s*/);

        function allowedForCors(origin: string) {
            if (corsAllowHostnames.includes('*')) return true;

            let originHostname = null;
            try {
                originHostname = new URL(origin).hostname.toLowerCase();
            } catch (_e) {
                return false;
            }
            for (const corsAllowedHostname of corsAllowHostnames) {
                if (
                    corsAllowedHostname.length &&
                    (originHostname === corsAllowedHostname || originHostname?.endsWith(`.${corsAllowedHostname}`))
                ) {
                    return true;
                }
            }
            return false;
        }

        if (origin && allowedForCors(origin)) {
            if (corsAllowHostnames.includes('*')) {
                respHeaders.set('Access-Control-Allow-Origin', '*');
            } else {
                respHeaders.set('Access-Control-Allow-Origin', origin);
                respHeaders.set('Vary', 'Origin');
            }
        }

        if (request.method === 'OPTIONS') {
            respHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            return new Response(null, { status: 204, headers: respHeaders });
        }

        const apikey = env.audioscrobbler_apikey;
        if (!apikey) {
            console.error('API key not defined');
            return new Response(`{error: 8, message: 'API key not defined'}`, {
                status: 404,
                statusText: 'API key not defined in proxy',
                headers: respHeaders
            });
        }

        const user = env.audioscrobbler_user || 'rockland';
        const tracks = env.audioscrobbler_trackslimit;

        const method = (searchParams.get('method') ?? '').trim().toLowerCase();
        if (!['user.getrecenttracks', 'user.getinfo'].includes(method)) {
            console.error(`Method '${method}' missing or not supported`);
            if (method === '') {
                return new Response(`{error: 6, message: 'Method not specified'}`, {
                    status: 400,
                    statusText: 'Method not specified',
                    headers: respHeaders
                });
            } else {
                const msg = `Specified method '${method}' not available in proxy`;
                return new Response(`{error: 3, message: '${msg}'}`, {
                    status: 404,
                    statusText: 'Specified method not available in proxy',
                    headers: respHeaders
                });
            }
        }

        if (method === 'user.getinfo') {
            const logData = {
                method: method,
                date: new Date().toISOString(),
                userAgent: reqHeaders.get('User-Agent') ?? '',
                origin: origin ?? '',
                referer: reqHeaders.get('Referer') ?? '',
                remoteIp: reqHeaders.get('CF-Connecting-IP') ?? ''
            };
            console.log(`[${fetchSuccessCount}/${fetchErrorCount}] proxy: `, JSON.stringify(logData));
        }

        const { okResponse, nextTime, cacheKey, cache } = await getCacheData(request, method);

        if (Date.now() <= nextTime) {
            return makeFallbackResponse(okResponse, method, respHeaders);
        }

        const fUrl = new URL('https://ws.audioscrobbler.com/2.0');
        fUrl.searchParams.append('method', method);
        fUrl.searchParams.append('user', user);
        fUrl.searchParams.append('api_key', apikey);
        fUrl.searchParams.append('format', 'json');

        if (method === 'user.getrecenttracks') {
            if (tracks) {
                fUrl.searchParams.append('limit', tracks);
            }
            fUrl.searchParams.append('extended', '1');
        }

        // temporary update to prevent multiple concurrent fetches
        ctx.waitUntil(setCacheData(cache, cacheKey, okResponse || '', waitUntilTime(method, hibernate).ok));

        let result;
        let json;

        try {
            result = await fetch(fUrl.href, {
                headers: {
                    'User-Agent': 'Proxy-api (https://github.com/StigNygaard/lastfm-widgets/cloudflare-worker)'
                }
            });
        } catch (e) {
            console.error(`[${fetchSuccessCount}/${++fetchErrorCount}] await fetch() error `, e);
            return await fail(method, okResponse, respHeaders, cache, cacheKey, ctx);
        }

        try {
            json = await result.json();
        } catch (e) {
            console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] await result.json() error `, e);
            try {
                const text = await result.clone().text();
                console.error(`Proxy received unexpected response which had Content-Type header:\n`, result.headers.get('Content-Type'));
                console.error(`Proxy received unexpected response which parsed as text is:\n`, text);
            } catch (_err) { /* ignore */ }
            return await fail(method, okResponse, respHeaders, cache, cacheKey, ctx);
        }

        if (!result.ok && json.error) {
            console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] [${fUrl.href}] ${result.status} - ${result.statusText} `, json);
            if ([26, 29].includes(json.error)) {
                hibernate = true;
                console.warn(`⛔ Going into *Hibernate* mode because proxy received: ${json.error} - ${json.message} !`);
            } else {
                console.warn(`Proxy received error: ${json.error} - ${json.message}`);
            }
            return await fail(method, okResponse, respHeaders, cache, cacheKey, ctx);
        }

        if (result.ok && !json.error) {
            if (hibernate) {
                hibernate = false;
                console.log('🟢 Proxy leaving *Hibernate* mode - seems to work again');
            }
            fetchSuccessCount++;
            return success(method, json, respHeaders, cache, cacheKey, ctx);
        } else {
            console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] Last.fm fetch FAILED: ${result?.status} - ${result?.statusText}`);
            return fail(method, okResponse, respHeaders, cache, cacheKey, ctx);
        }

        function success(method: string, jsonObj: unknown, headers: Headers, cache: Cache, cacheKey: Request, ctx: ExecutionContext) {
            const jsonStr = JSON.stringify(jsonObj);
            const nextTime = waitUntilTime(method, hibernate).ok;
            ctx.waitUntil(setCacheData(cache, cacheKey, jsonStr, nextTime));

            return new Response(jsonStr, {
                status: 200,
                statusText: 'OK',
                headers: headers
            });
        }

        function fail(method: string, okResponse: string | null, headers: Headers, cache: Cache, cacheKey: Request, ctx: ExecutionContext) {
            let nextTime;
            if (okResponse) {
                nextTime = waitUntilTime(method, hibernate).failedWithFallback;
            } else {
                nextTime = waitUntilTime(method, hibernate).failedWithoutFallback;
            }
            ctx.waitUntil(setCacheData(cache, cacheKey, okResponse || '', nextTime));
            return makeFallbackResponse(okResponse, method, headers);
        }

        function makeFallbackResponse(okResponse: string | null, _method: string, headers: Headers) {
            if (okResponse) {
                return new Response(okResponse, {
                    status: 200,
                    statusText: 'OK - Using previously cached response',
                    headers: headers
                });
            } else {
                return new Response(`{error: 16, message: 'Not ready. Try again later'}`, {
                    status: 425,
                    statusText: 'Not ready. Successful response not available in proxy cache',
                    headers: headers
                });
            }
        }
    }
};
