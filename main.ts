import { serveDir } from '@std/http/file-server';
import '@std/dotenv/load';
import { log } from './services/log.ts';
import * as ProxyApi from './services/proxy-api.ts';

/**
 * @run --unstable-kv --allow-net --allow-env --allow-read=./website,./widgets,./services,./.env main.ts
 */

const myHeaders = {
    // 'Content-Security-Policy': `default-src 'none' ; script-src 'self' ; connect-src https: 'self' ; img-src https: blob: data: 'self' ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`,
    'Content-Security-Policy': `default-src 'self' ; connect-src https: 'self' ; img-src https: blob: data: 'self' ; base-uri 'none'`,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff'
};
const myHeadersArr = Object.entries(myHeaders).map(([k, v]) => `${k}: ${v}`);
const webpage = Deno.env.get('webpage_show')?.toLocaleLowerCase() === 'demo' ? 'demo' : 'promo';
const cachetype = Deno.env.get('proxy_use')?.toLocaleLowerCase() === 'mem' ? 'in-memory' : 'KV';
const serveOptions = {};
const proxyKVPath = Deno.env.get('proxy_kv_path')?.trim();
const servePort = Deno.env.get('serve_port')?.trim();
if (servePort?.length) {
    serveOptions.port = Number.parseInt(servePort, 10);
}
const serveHostname = Deno.env.get('serve_hostname')?.trim();
if (serveHostname?.length) {
    serveOptions.hostname = serveHostname;
}

Deno.serve(serveOptions, handler);

console.log(`${new Date().toISOString()} - 🏃‍♂️‍➡️ Running on Deno ${Deno.version.deno} (${navigator.userAgent.toLowerCase()}) with ${cachetype}${ (cachetype === 'KV' && proxyKVPath?.length) ? ` (${proxyKVPath})` : ''} proxy-cache.`);

async function handler(req: Request, info: Deno.ServeHandlerInfo) {
    const url = new URL(req.url);
    const hostname = url.hostname;
    const pathname = url.pathname;
    const robots = `User-agent: *\nDisallow:\nSitemap: ${url.origin}/sitemap.txt`;
    const sitemap = `${url.origin}/`;

    // The "Router"...
    let response: Response;
    if (/^\/proxy-api\/?$/.test(pathname) && req.method === 'GET') {
        // The "proxy API" - https://lastfm-widgets.com/proxy-api
        const result = await ProxyApi.serve(url.searchParams, req.headers, info);
        response = new Response(result.body, { headers: myHeaders, ...result.options });
    } else if (/^\/log\/?$/.test(pathname) && req.method === 'POST') {
        // Simple "post object" log-endpoint - https://lastfm-widgets.com/log
        log(url.searchParams, req, info);
        response = new Response(null, { status: 200, statusText: 'OK', headers: myHeaders });
    } else if (pathname.startsWith('/widgets/') && req.method === 'GET') {
        // The statically served widgets code - https://lastfm-widgets.com/widgets/*
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
    } else if (pathname === '/robots.txt' && req.method === 'GET') {
        response = new Response(robots, { status: 200, statusText: 'OK', headers: myHeaders, 'Content-Type': 'text/plain' });
    } else if (pathname === '/sitemap.txt' && req.method === 'GET') {
        response = new Response(sitemap, { status: 200, statusText: 'OK', headers: myHeaders, 'Content-Type': 'text/plain' });
    } else if (req.method === 'GET') {

        if (webpage==='demo' && hostname === 'lastfm-widgets.stignygaard.deno.net' && pathname.length < 2) { // '' '/' '?' '#' ... THIS IS AN UGLY HACK, I KNOW...
            // Temporary while migrating demo-page from lastfm-widgets.stignygaard.deno.net to lastfm-widgets.com...
            const destination = "https://lastfm-widgets.com";
            response = Response.redirect(destination, 301); // 301 marks it as a permanent redirect
        } else {
            // The statically served demo or promo-page
            response = await serveDir(req, {
                urlRoot: '',
                fsRoot: `website/${webpage}`, // 'website/demo' (or 'website/demo-legacy') or 'website/promo'
                showDirListing: false,
                showDotfiles: false,
                showIndex: true, // index.html
                enableCors: false, // CORS not allowed/enabled (no CORS headers)
                quiet: true, // logging of errors
                headers: myHeadersArr
            });
        }
    } else {
        response = new Response('Not found', {
            status: 404,
            statusText: `Method ${req.method} not supported here`,
            headers: myHeaders
        });
        // for other routing examples, see f.ex: https://youtu.be/p541Je4J_ws?si=-tWmB355467gtFIP
    }

    return response;
}
