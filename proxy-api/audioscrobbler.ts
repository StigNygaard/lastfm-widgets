import 'jsr:@std/dotenv/load';

// Get the fixed values from environment variables (or .env file):
const apikey = Deno.env.get('audioscrobbler_apikey');
const user = Deno.env.get('audioscrobbler_user') || 'rockland';
const trackslimit = Deno.env.get('audioscrobbler_trackslimit');
const corsAllowHostname = Deno.env.get('audioscrobbler_cors_allow_hostname')?.toLowerCase(); // Allow CORS for given hostname (and subdomains)

// TODO *IF* I wanted to use Deno (Deploy) KV database for response caching, I needed something like:
//      const database = Deno.env.get('audioscrobbler_database');
//      const KV = await Deno.openKv(database);
//  Another (obvious?) option could be to use the Deno Deploy Web Cache API?
//  But for now, the much simpler Map solution🙂...
const cache = new Map([
    ['user.getinfo-OkResponse', ''],
    ['user.getrecenttracks-OkResponse', '']
]);

let hibernate = false; // In case of error 26 or 29, enter Hibernate mode

export async function audioscrobbler(searchParams: URLSearchParams, reqHeaders: Headers) : Promise<{body: string, options: object}> {

    const origin = reqHeaders.get('Origin');
    const respHeaders = new Headers({'content-type': 'application/json'});
    if (origin) {
        let originHostname = null;
        try {
            originHostname = new URL(origin).hostname.toLowerCase();
            // Unfortunately it is too early to use URL.parse() instead https://caniuse.com/mdn-api_url_parse_static
        } catch (_e) {
            // ignore
        }
        if (originHostname === corsAllowHostname || originHostname?.endsWith(`.${corsAllowHostname}`)) {
            respHeaders.set('Access-Control-Allow-Origin', origin);
            respHeaders.set('Vary', 'Origin');
        } else {
            // in principle, I guess I should/could just fail here(?)...
        }
    }

    // console.log(`audioscrobbler() proxy called with parameters-string: '${searchParams}' and header values:`);
    // console.log(` Origin: ${origin}\n User-Agent: ${reqHeaders.get('User-Agent')}\n Referer: ${reqHeaders.get('Referer')}`);

    if (!apikey) {
        return apiKeyMissing(respHeaders);
    }
    // Ignore all incoming parameters but 'method'. Using fixed (env) values for the rest...
    const method = (searchParams.get('method') ?? '').trim().toLowerCase();
    if (!['user.getrecenttracks', 'user.getinfo'].includes(method)) {
        return methodError(method, respHeaders);
    }
    const nextTime = parseInt(cache.get(`${method}-NextTime`) || '0', 10);
    if (Date.now() <= nextTime) {
        console.warn(`Too early for '${method}'. Will use cached data instead...`);
        return fallback(method, respHeaders);
    }
    const fUrl = new URL('https://ws.audioscrobbler.com/2.0');
    fUrl.searchParams.append('method', method);
    fUrl.searchParams.append('user', user);
    fUrl.searchParams.append('api_key', apikey);
    fUrl.searchParams.append('format', 'json');
    let result;
    let json;

    if (method === 'user.getrecenttracks') {
        if (trackslimit) {
            fUrl.searchParams.append('limit', trackslimit);
        }
        fUrl.searchParams.append('extended', '1');
    }

    console.log(`Last.fm fetch: ${fUrl.href}`);

    cache.set(`${method}-NextTime`, String(waitUntil(method).ok)); // temporary update to prevent multiple concurrent fetches
    try {
        result = await fetch(fUrl.href, {
            headers: {
                'User-Agent': 'Proxy-api (https://github.com/StigNygaard/lastfm-widgets)'
            }
        });
    } catch (e) {
        console.error(`await fetch() error ${result?.status} - ${result?.statusText} \n `, e);
        return fallback(method, respHeaders);
    }
    try {
        json = await result.json(); // result.headers.get('content-type')?.includes('application/json')
    } catch (e) {
        console.error('await result.json() error ', e);
        return fallback(method, respHeaders);
    }
    if (!result.ok && json.error) {
        console.error(`[${fUrl.href}] ${result.status} - ${result.statusText} \n${JSON.stringify(json)}`);
        if ([26, 29].includes(json.error)) {
            hibernate = true;
            console.error(`⛔ Going into *Hibernate* mode because: ${json.error} - ${json.message} !`);
        } else {
            console.error(`Received error: ${json.error} - ${json.message}`);
        }
        return fail(method, respHeaders);
    }
    if (result.ok && !json.error) {
        if (hibernate) {
            hibernate = false;
            console.log('🟢 Leaving *Hibernate* mode - seems to work again');
        }
        console.log(`Last.fm '${method}' fetch OK! Status : ${result.status} - ${result.statusText}`);
        return success(method, result.status, result.statusText, json, respHeaders);
    } else {
        console.error(`Last.fm fetch FAILED: ${result?.status} - ${result?.statusText}`);
        return fail(method, respHeaders);
    }

}


function success(method: string, status: string|number, statusText: string, jsonObj: object, headers: Headers): {body: string, options: object} {
    const json = JSON.stringify(jsonObj);
    if (json !== cache.get(`${method}-OkResponse`)) { // If we used KV or other database, we would try to avoid unnecessary writes
        cache.set(`${method}-OkResponse`,json);
        console.log(`Updating the cached json for '${method}'...`);
    } else {
        console.log(`SKIP updating cached json - there's no change in data for '${method}'`);
    }
    cache.set(`${method}-OkTime`, Date.now().toString());
    cache.set(`${method}-NextTime`, String(waitUntil(method).ok));
    return {
        body: json,
        options: {
            status: 200,
            statusText: 'OK',
            headers: headers
        }
    }
}

function fail(method: string, headers: Headers): {body: string, options: object} {
    const okResponse = cache.get(`${method}-OkResponse`) ?? '';
    cache.set(`${method}-FailTime`, Date.now().toString());
    if (okResponse) {
        cache.set(`${method}-NextTime`, String(waitUntil(method).failedWithFallback));
    } else {
        cache.set(`${method}-NextTime`, String(waitUntil(method).failedWithoutFallback));
    }
    return fallback(method, headers);
}

function fallback(method: string, headers: Headers): {body: string, options: object} {
    const okResponse = cache.get(`${method}-OkResponse`) ?? '';
    if (okResponse) {
        return {
            body: okResponse,
            options: {
                status: 200,
                statusText: 'OK - Using previously cached response',
                headers: headers
            }
        }
    } else {
        return {
            body: `{error: 16, message: 'Not ready. Try again later'}`,
            options: {
                status: 425,
                statusText: 'Not ready. Successful response not available in proxy cache',
                headers: headers
            }
        }
    }
}

/**
 * Map containing waiting times for each last.fm method.
 */
const waitNext = new Map([
    // Seconds until next call to last.fm method is allowed.
    // Avoid too fast retries when errors. Errors might be caused by overloaded last.fm servers.
    // Well, I might actually be over-thinking this a bit :-) ...
    ['user.getinfo', {
        ok: 3601,
        failedWithFallback: 1801,
        failedWithoutFallback: 61
    }],
    ['user.getrecenttracks', {
        ok: 31,
        failedWithFallback: 121,
        failedWithoutFallback: 61
    }]
]);
function waitUntil(method: string) {
    const now = Date.now();
    const data = waitNext.get(method);
    if (hibernate || !data) {
        if (!data) console.error(`ERROR! Unknown method "${method}"`);
        return {
            ok: 3600000 + now,
            failedWithFallback: 3600000 + now,
            failedWithoutFallback: 3600000 + now
        }
    }
    return {
        ok: data.ok * 1000 + now,
        failedWithFallback: data.failedWithFallback * 1000 + now,
        failedWithoutFallback: data.failedWithoutFallback * 1000 + now
    }
}

function apiKeyMissing(headers: Headers) {
    console.error('API key not defined');
    return {
        body: `{error: 8, message: 'API key not defined'}`,
        options: {
            status: 404,
            statusText: 'API key not defined in proxy',
            headers: headers
        }
    }
}

function methodError(method: string, headers: Headers) {
    console.error('Method missing or not supported');
    if (method === '') {
        return {
            body: `{error: 6, message: 'Method not specified'}`,
            options: {
                status: 400,
                statusText: 'Method not specified',
                headers: headers
            }
        }
    } else {
        return {
            body: `{error: 3, message: 'Specified method not available in proxy'}`,
            options: {
                status: 404,
                statusText: 'Specified method not available in proxy',
                headers: headers
            }
        }
    }
}
