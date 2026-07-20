import '@std/dotenv/load';

/********************************************************************************/
/*                    In-memory proxy/cache implementation                      */
/*  This is a "backup" of my first quick in-memory proxy-implementation.        */
/*  It kind of works, especially locally on my PC. Deno Deploy keeps an         */
/*  application alive in 5sec to 10min when inactive, depending on its general  */
/*  system load. Thus, an in-memory proxy is better than nothing, but it is     */
/*  not really easy to say how effective exactly it is in practice protecting   */
/*  Last.FM's API when running on Deno Deploy.                                  */
/********************************************************************************/

// Get the fixed values from .env file or environment variables
const apikey = Deno.env.get('audioscrobbler_apikey');
const user = Deno.env.get('audioscrobbler_user') || 'rockland';
const tracks = Deno.env.get('audioscrobbler_trackslimit');
// Allow CORS for given hostname(s) and their subdomains. Multiple hostnames separated by semicolon:
const corsAllowHostnames = Deno.env.get('audioscrobbler_cors_allow_hostnames')?.toLowerCase()?.split(/\s*(?:;|$)\s*/) ?? [];

const cache = new Map([
    ['user.getinfo-OkResponse', ''],
    ['user.getrecenttracks-OkResponse', '']
]);
let fetchSuccessCount = 0;
let fetchErrorCount = 0;
// TODO: Also a returned-cached-content count?

let hibernate = false; // In case of error 26 or 29, enter Hibernate mode

export async function proxyApi(
    searchParams: URLSearchParams,
    reqHeaders: Headers,
    info: Deno.ServeHandlerInfo
): Promise<{ body: string; options: object }> {
    const origin = reqHeaders.get('Origin');
    const respHeaders = new Headers({ 'Content-Type': 'application/json' });
    if (origin && allowedForCors(origin)) {
        respHeaders.set('Access-Control-Allow-Origin', origin);
        respHeaders.set('Vary', 'Origin');
    }

    if (!apikey) {
        return apiKeyMissing(respHeaders);
    }
    // Ignore all incoming parameters but 'method'. Using fixed values for the rest...
    const method = (searchParams.get('method') ?? '').trim().toLowerCase();
    if (!['user.getrecenttracks', 'user.getinfo'].includes(method)) {
        return methodError(method, respHeaders);
    }
    if (method === 'user.getinfo') {
        // log for getinfo only, because few requests pr visitor (often only one)
        const logData = {
            method: method,
            date: new Date().toISOString(),
            userAgent: reqHeaders.get('User-Agent') ?? '',
            origin: origin ?? '',
            referer: reqHeaders.get('Referer') ?? '',
            ...remoteAddr(info)
        };
        console.log(`[${fetchSuccessCount}/${fetchErrorCount}] proxy: `, logData);
    }
    const nextTime = Number.parseInt(cache.get(`${method}-NextTime`) || '0', 10);
    if (Date.now() <= nextTime) {
        console.log(` *** ${nowStamp()} - Too early for '${method}' (Next time: ${dateInYyyyMmDdHhMmSs(new Date(nextTime))}). Will use cached data instead...`);
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
        if (tracks) {
            fUrl.searchParams.append('limit', tracks);
        }
        fUrl.searchParams.append('extended', '1');
    }

    // Temporary update to prevent multiple concurrent fetches
    cache.set(`${method}-NextTime`, String(waitUntil(method).ok));
    try {
        // console.log(`fetching ${fUrl.href} ...`);
        result = await fetch(fUrl.href, {
            headers: {
                'User-Agent': 'Proxy-api (https://github.com/StigNygaard/lastfm-widgets)'
            }
        });
    } catch (e) {
        console.error(`[${fetchSuccessCount}/${++fetchErrorCount}] await fetch() error ${result?.status} - ${result?.statusText} `, e);
        return fallback(method, respHeaders);
    }
    try {
        json = await result.json(); // Check if result.headers.get('Content-Type')?.includes('application/json') ?
    } catch (e) {
        console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] await result.json() error `, e);
        try {
            const text = await result.text();
            console.error(`Proxy received unexpected response which had Content-Type header:\n`, result.headers.get('Content-Type'));
            console.error(`Proxy received unexpected response which parsed as text is:\n`, text);
        } catch (_err) { /* ignore */ }
        return fallback(method, respHeaders);
    }
    if (!result.ok && json.error) {
        console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] [${fUrl.href}] ${result.status} - ${result.statusText} `, json);
        if ([26, 29].includes(json.error)) {
            hibernate = true;
            console.warn(`⛔ Going into *Hibernate* mode because proxy received: ${json.error} - ${json.message} !`);
        } else {
            console.warn(`Proxy received error: ${json.error} - ${json.message}`);
        }
        return fail(method, respHeaders);
    }
    if (result.ok && !json.error) {
        if (hibernate) {
            hibernate = false;
            console.log('🟢 Proxy leaving *Hibernate* mode - seems to work again');
        }
        // console.log(`Last.fm '${method}' fetch OK! Status : ${result.status} - ${result.statusText}`);
        fetchSuccessCount++;
        return success(method, result.status, result.statusText, json, respHeaders);
    } else {
        console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] Last.fm fetch FAILED: ${result?.status} - ${result?.statusText}`);
        return fail(method, respHeaders);
    }

}

function remoteAddr(info: Deno.ServeHandlerInfo): object {
    if ('hostname' in info.remoteAddr) {
        return {
            remoteIp: info.remoteAddr.hostname,
            remotePort: info.remoteAddr.port
        };
    }
    return {};
}

function allowedForCors(origin: string) {
    let originHostname = null;
    try {
        originHostname = new URL(origin).hostname.toLowerCase();
        // Unfortunately, it is(/WAS?) too early to use URL.parse() instead, to avoid try/catch ( https://caniuse.com/mdn-api_url_parse_static )
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

function success(method: string, _status: string | number, _statusText: string, jsonObj: object, headers: Headers): { body: string, options: object } {
    const json = JSON.stringify(jsonObj);
    const cachedText = cache.get(`${method}-OkResponse`) ?? '';
    // Update cache only if the new value differs from currently cached value (If/when using KV, we avoid unnecessary writes)...
    if (json.length && json !== cachedText) {
        console.log(` --- ${nowStamp()} - Current cached value for '${method}-OkResponse' has length=${cachedText.length}.`);
        if (method == 'user.getinfo') {
            console.log(` +++ ${nowStamp()} - DATA READ - UPDATE CACHE for '${method}-OkResponse': \n`, json);
        } else {
            console.log(` +++ ${nowStamp()} - DATA READ - UPDATE CACHE for '${method}-OkResponse' (length=${json.length}).`);
        }
        cache.set(`${method}-OkResponse`, json);
        // console.log(`Updating the cached json for '${method}'...`);
    } else {
        console.log(` +++ ${nowStamp()} - DATA READ - SKIP updating cached json - there's no change in data for '${method}-OkResponse'`);
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
    };
}

function fail(method: string, headers: Headers): { body: string, options: object } {
    const okResponse = cache.get(`${method}-OkResponse`) ?? '';

    console.log(` *** ${nowStamp()} - Failback value from cache: \n`, okResponse);

    cache.set(`${method}-FailTime`, Date.now().toString());
    if (okResponse) {
        cache.set(`${method}-NextTime`, String(waitUntil(method).failedWithFallback));
    } else {
        cache.set(`${method}-NextTime`, String(waitUntil(method).failedWithoutFallback));
    }
    return fallback(method, headers);
}

function fallback(method: string, headers: Headers, okResponse?: string): { body: string, options: object } {
    if (!okResponse) {
        okResponse = cache.get(`${method}-OkResponse`) ?? '';
    }
    if (okResponse) {
        console.log(` *** ${nowStamp()} - Returning fallback '${method}-OkResponse' value of length ${okResponse.length} from cache.`);
        return {
            body: okResponse,
            options: {
                status: 200,
                statusText: 'OK - Using previously cached response',
                headers: headers
            }
        };
    } else {
        console.warn(` *** ${nowStamp()} - Fallback cache NOT ready for method '${method}-OkResponse'`);
        return {
            body: `{error: 16, message: 'Not ready. Try again later'}`,
            options: {
                status: 425,
                statusText: 'Not ready. Successful response not available in proxy cache',
                headers: headers
            }
        };
    }
}

/**
 * Map containing waiting times for each last.fm method.
 */
const waitNext = new Map([
    // Seconds until next call to last.fm method is allowed.
    // Avoid too fast retries when errors. Errors might be caused by overloaded last.fm servers.
    // But well, I might actually be over-thinking this a bit :-) ...
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
function waitUntil(method: string) {
    const now = Date.now();
    const data = waitNext.get(method);
    if (hibernate || !data) {
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

function apiKeyMissing(headers: Headers) {
    console.error('API key not defined');
    return {
        body: `{error: 8, message: 'API key not defined'}`,
        options: {
            status: 404,
            statusText: 'API key not defined in proxy',
            headers: headers
        }
    };
}

function methodError(method: string, headers: Headers) {
    console.error(`Method '${method}' missing or not supported`);
    if (method.trim() === '') {
        return {
            body: `{error: 6, message: 'Method not specified'}`,
            options: {
                status: 400,
                statusText: 'Method not specified',
                headers: headers
            }
        };
    } else {
        const msg = `Specified method '${method}' not available in proxy`;
        return {
            body: `{error: 3, message: '${msg}'}`,
            options: {
                status: 404,
                statusText: 'Specified method not available in proxy',
                headers: headers
            }
        };
    }
}



function padTwoDigits(num: number) {
    return num.toString().padStart(2, "0");
}

function dateInYyyyMmDdHhMmSs(date: Date, dateDivider: string = "-") {
    return (
        [
            date.getFullYear(),
            padTwoDigits(date.getMonth() + 1),
            padTwoDigits(date.getDate()),
        ].join(dateDivider) +
        " " +
        [
            padTwoDigits(date.getHours()),
            padTwoDigits(date.getMinutes()),
            padTwoDigits(date.getSeconds()),
        ].join(":")
    );
}

function nowStamp() {
    return dateInYyyyMmDdHhMmSs(new Date());
}

// function byteSize(str: string) {
//     return new Blob([str]).size; // byte-size of a string
// }
