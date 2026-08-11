import '@std/dotenv/load';
import * as kvBlobTool from "@kitsonk/kv-toolbox/blob";

/******************************************************************************/
/*                   Proxy/cache implemented with Deno KV                     */
/*   Since Deno KV has a max record size of 64K per value, also using         */
/*   @kitsonk/kv-toolbox/blob to spread the large audioscrobbler response     */
/*   data over multiple records. Could the monthly write-limit for KV on a    */
/*   free tier of Deno Deploy become a problem? As an alternative to KV,      */
/*   I should probably also consider/try...                                   */
/*   a) Deno Deploy Web Cache API:                                            */
/*      https://deno.com/blog/deploy-cache-api                                */
/*      https://docs.deno.com/deploy/classic/edge_cache/                      */
/*      https://developer.mozilla.org/en-US/docs/Web/API/Cache                */
/*   b) Deno Deploy HTTP Edge Cache:                                          */
/*      https://docs.deno.com/deploy/reference/caching/                       */
/*   (I'm still learning and experimenting here)                              */
/******************************************************************************/

// Get the fixed values from .env file or environment variables
const apikey = Deno.env.get('audioscrobbler_apikey');
const user = Deno.env.get('audioscrobbler_user') || 'rockland';
const tracks = Deno.env.get('audioscrobbler_trackslimit');
// Allow CORS for given hostname(s) and their subdomains. Multiple hostnames separated by semicolon:
const corsAllowHostnames = Deno.env.get('audioscrobbler_cors_allow_hostnames')?.toLowerCase()?.split(/\s*(?:;|$)\s*/) ?? [];
const msOneDay = 86400000;
const expireKeyValue = 50 * msOneDay; // Don't use KV space forever if this proxy is abandoned

/**
 * Map containing waiting times for each last.fm method.
 */
const waitNext = new Map([
    // Seconds until the next call to a last.fm method is allowed.
    // Avoid too fast retries when errors. Errors might be caused by overloaded last.fm servers.
    // But well, I might actually be overthinking this a bit :-) ...
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

export async function serve(
    searchParams: URLSearchParams,
    reqHeaders: Headers,
    info: Deno.ServeHandlerInfo
): Promise<{ body: string; options: object }> {

    const textDecoder = new TextDecoder();
    using cache = await Deno.openKv();

    let fetchSuccessCount = 0;
    let fetchErrorCount = 0;
    // TODO: Also a returned-cached-content count?
    let hibernate = false; // In case of error 26 or 29, enter Hibernate mode

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
    const nextTimeStr = await cache.get<string>([`${method}-NextTime`]);
    const nextTime = Number.parseInt(nextTimeStr.value || '0', 10);
    if (Date.now() <= nextTime) {
        console.log(` *** ${nowStamp()} - Too early for '${method}' (Next time: ${dateInYyyyMmDdHhMmSs(new Date(nextTime))}). Will use cached data instead...`);
        return await fallback(method, respHeaders);
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
    await cache.set([`${method}-NextTime`], String(waitUntil(method).ok), {expireIn: expireKeyValue});

    try {
        // console.log(`fetching ${fUrl.href} ...`);
        result = await fetch(fUrl.href, {
            headers: {
                'User-Agent': 'Proxy-api (https://github.com/StigNygaard/lastfm-widgets)'
            }
        });
    } catch (e) {
        console.error(`[${fetchSuccessCount}/${++fetchErrorCount}] await fetch() error ${result?.status} - ${result?.statusText} `, e);
        return await fallback(method, respHeaders);
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
        return await fallback(method, respHeaders);
    }
    if (!result.ok && json.error) {
        console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] [${fUrl.href}] ${result.status} - ${result.statusText} `, json);
        if ([26, 29].includes(json.error)) {
            hibernate = true;
            console.warn(`⛔ Going into *Hibernate* mode because proxy received: ${json.error} - ${json.message} !`);
        } else {
            console.warn(`Proxy received error: ${json.error} - ${json.message}`);
        }
        return await fail(method, respHeaders);
    }
    if (result.ok && !json.error) {
        if (hibernate) {
            hibernate = false;
            console.log('🟢 Proxy leaving *Hibernate* mode - seems to work again');
        }
        fetchSuccessCount++;
        return await success(method, result.status, result.statusText, json, respHeaders);
    } else {
        console.error(`Proxy [${fetchSuccessCount}/${++fetchErrorCount}] Last.fm fetch FAILED: ${result?.status} - ${result?.statusText}`);
        return await fail(method, respHeaders);
    }


    async function success(method: string, _status: string | number, _statusText: string, jsonObj: Record<string, unknown>, headers: Headers): Promise<{
        body: string,
        options: object
    }> {
        if (method==='user.getrecenttracks')
            reduceRecenttracksData(jsonObj) // Slimming user.getrecenttracks data to reduce cache size used
        else if (method==='user.getinfo')
            reduceInfoData(jsonObj); // Slimming user.getinfo data to reduce cache size used
        const json = JSON.stringify(jsonObj);
        let cachedText = '';
        if (method==='user.getrecenttracks') { // BIG recent tracks data was stored over multiple "KV-records" using kv-toolbox/blob
            const cached = await kvBlobTool.get(cache, [`${method}-OkResponse`]);
            cachedText = cached.value ? textDecoder.decode(cached.value) : '';
        } else { // user profile data
            const cached = await cache.get<string>([`${method}-OkResponse`]);
            cachedText = cached.value ?? '';
        }
        // Update cache only if the new value differs from currently cached value (avoid unnecessary writes to KV)
        if (json.length && json !== cachedText) {
            console.log(` --- ${nowStamp()} - Cached value for ${method}-OkResponse has length=${cachedText.length}.`);
            if (method == 'user.getinfo') {
                console.log(` +++ ${nowStamp()} - UPDATE CACHE for ${method}-OkResponse: \n`, json);
            } else {
                console.log(` +++ ${nowStamp()} - UPDATE CACHE for ${method}-OkResponse (length=${json.length}).`);
                // console.log(` +++ ${nowStamp()} - UPDATE CACHE for ${method}-OkResponse: \n`, json);
            }
            if (method==='user.getrecenttracks') { // BIG recent tracks data. Use kv-toolbox/blob to spread over multiple "KV-records"
                await kvBlobTool.set(cache, [`${method}-OkResponse`], kvBlobTool.toBlob(json), {expireIn: expireKeyValue});
            } else { // user profile data
                await cache.set([`${method}-OkResponse`], json, {expireIn: expireKeyValue});
            }
        } else {
            // console.log(` *** SKIP updating cached json - there's no change in data for '${method}'`);
        }
        await cache.set([`${method}-OkTime`], Date.now().toString(), {expireIn: expireKeyValue});
        await cache.set([`${method}-NextTime`], String(waitUntil(method).ok), {expireIn: expireKeyValue});
        return {
            body: json,
            options: {
                status: 200,
                statusText: 'OK',
                headers: headers
            }
        };
    }

    async function fail(method: string, headers: Headers): Promise<{ body: string, options: object }> {
        let okResponse = '';
        if (method==='user.getrecenttracks') {
            const resp = await kvBlobTool.get(cache, [`${method}-OkResponse`]);
            okResponse = resp.value ? textDecoder.decode(resp.value) : '';
        } else {
            const resp = await cache.get([`${method}-OkResponse`]);
            okResponse = resp.value ?? '';
        }

        console.log(` *** ${nowStamp()} - Failing - Fallback value from cache has length ${okResponse.length}...`);

        await cache.set([`${method}-FailTime`], Date.now().toString(), {expireIn: expireKeyValue});
        if (okResponse) {
            await cache.set([`${method}-NextTime`], String(waitUntil(method).failedWithFallback), {expireIn: expireKeyValue});
        } else {
            await cache.set([`${method}-NextTime`], String(waitUntil(method).failedWithoutFallback), {expireIn: expireKeyValue});
        }
        return await fallback(method, headers, okResponse);
    }

    async function fallback(method: string, headers: Headers, okResponse?: string): Promise<{ body: string, options: object }> {
        if(!okResponse) {
            if (method==='user.getrecenttracks') {
                const resp = await kvBlobTool.get(cache, [`${method}-OkResponse`]);
                okResponse = resp.value ? textDecoder.decode(resp.value) : '';
            } else {
                const resp = await cache.get([`${method}-OkResponse`]);
                okResponse = resp.value ?? '';
            }
        }
        if (okResponse) {
            console.log(` *** ${nowStamp()} - Returning fallback ${method}-OkResponse value of length ${okResponse.length} from cache.`);
            return {
                body: okResponse,
                options: {
                    status: 200,
                    statusText: 'OK - Using previously cached response',
                    headers: headers
                }
            };
        } else {
            console.warn(` *** ${nowStamp()} - Fallback cache NOT ready for method ${method}-OkResponse`);
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

}

function keep(obj?: Record<string, unknown>, ...keepProps: string[]){
    if (obj) Object.keys(obj).forEach(key => {
        if (!keepProps.includes(key)) delete obj[key]
    });
}

function reduceInfoData(obj: Record<string, unknown>) {
    const user = obj.user;
    if (user) {
        // @ts-expect-error: I hate Typescript
        keep(user, 'playcount', 'url', 'name', 'track_count', 'realname', 'image', 'registered', 'type');
        // TODO: Slimming profile/avatar image array requires widget version >= 1.13. Enable later?:
        // // @ts-expect-error: I hate Typescript
        // const image = user.image;
        // if (image) { // Keep only "large" and "extralarge" data in user.image[] array
        //     for (let i = image.length - 1; i >= 0; i--) {
        //         if (!['large', 'extralarge'].includes(image[i].size)) {
        //             image.splice(i, 1);
        //         }
        //     }
        // }
    }
}

function reduceRecenttracksData(obj: Record<string, unknown>) {
    // @ts-expect-error: I hate Typescript
    const tracks = obj.recenttracks?.track;
    if (tracks) {
        for (const track of tracks) {
            keep(track.artist, 'url', 'name');
            if (track.image) { // Keep only "medium" and "large" data in track.image[] array
                for (let i = track.image.length - 1; i >= 0; i--) {
                    if (!['medium', 'large'].includes(track.image[i].size)) {
                        track.image.splice(i, 1);
                    }
                }
            }
            keep(track.album, '#text');
            keep(track, 'artist', 'date', 'name', 'image', 'album', 'url', '@attr', 'loved');
        }
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
    // The function takes a Date object as a parameter and formats the date as YYYY-MM-DD hh:mm:ss.
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
