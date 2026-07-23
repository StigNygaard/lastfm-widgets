import { serveDir } from '@std/http/file-server';
import '@std/dotenv/load';
import { log } from './services/log.ts';

/**
 * @run --unstable-kv --allow-net --allow-env --allow-read=./website,./widgets,./services,./.env main.ts
 */

const myHeaders = {
    // 'Content-Security-Policy': `default-src 'none' ; script-src 'self' ; connect-src https: ; img-src https: blob: data: ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`,
    'Content-Security-Policy': `default-src 'self' ; connect-src https: ; img-src https: blob: data: ; base-uri 'none'`,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff'
};
const myHeadersArr = Object.entries(myHeaders).map(([k, v]) => `${k}: ${v}`);
const webpage = Deno.env.get('webpage_show')?.toLocaleLowerCase() === 'demo' ? 'demo' : 'promo';
const cachetype = Deno.env.get('proxy_use')?.toLocaleLowerCase() === 'mem' ? 'mem' : 'kv';

const ProxyApi = await import(`./services/proxy-api-${cachetype}.ts`);

Deno.serve(handler);

console.log(`${new Date().toISOString()} - Running on Deno ${Deno.version.deno} (${navigator.userAgent.toLowerCase()}) with proxy-api-${cachetype}.`);

async function handler(req: Request, info: Deno.ServeHandlerInfo) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // The "Router"...
    let response: Response;
    if (/^\/proxy-api\/?$/.test(pathname) && req.method === 'GET') {
        // The "proxy API" - https://lastfm-widgets.stignygaard.deno.net/proxy-api
        const result = await ProxyApi.serve(url.searchParams, req.headers, info);
        response = new Response(result.body, { headers: myHeaders, ...result.options });
    } else if (/^\/log\/?$/.test(pathname) && req.method === 'POST') {
        // Simple "post object" log-endpoint - https://lastfm-widgets.stignygaard.deno.net/log
        log(url.searchParams, req, info);
        response = new Response(null, { status: 200, statusText: 'OK', headers: myHeaders });
    } else if (pathname.startsWith('/widgets/') && req.method === 'GET') {
        // The statically served widgets code - https://lastfm-widgets.stignygaard.deno.net/widgets/*
        response = await serveDir(req, {
            urlRoot: 'widgets',
            fsRoot: 'widgets',
            showDirListing: false,
            showDotfiles: false,
            showIndex: false, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: myHeadersArr
        });
    } else if (req.method === 'GET') {
        // The statically served demo or promo-page
        response = await serveDir(req, {
            urlRoot: '',
            fsRoot: `website/${webpage}`, // 'website/demo' or 'website/promo'
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: myHeadersArr
        });
    } else {
        response = new Response('Not found', {
            status: 404,
            statusText: `Method ${req.method} not supported here`,
            headers: myHeaders
        });
        // for other routing examples, see f.ex: https://youtu.be/p541Je4J_ws?si=-tWmB355467gtFIP
    }

    if (url.origin.startsWith('http://localhost:')) { // if http://localhost development, modify slightly
        response.headers.set('Content-Security-Policy',
            `default-src 'none' ; script-src 'self' ; connect-src https: ${url.origin} ; img-src https: blob: data: ${url.origin} ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`);
    }

    return response;
}
