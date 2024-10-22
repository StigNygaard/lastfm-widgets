import {serveDir} from 'jsr:@std/http/file-server';
import 'jsr:@std/dotenv/load';
import {proxyApi} from './services/proxy-api.ts';
import {log} from './services/log.ts';

/**
 * @run --allow-net --allow-env --allow-read=./demo,./widgets,./.env main.ts
 */

const myHeaders = {
    'Content-Security-Policy': `default-src 'none' ; script-src 'self' ; connect-src https: ; img-src https: blob: data: ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff'
}
const myHeadersArr = Object.entries(myHeaders).map(([k, v]) => `${k}: ${v}`);

// we could set a port-number with Deno.serve({port: portno}, handler);
Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {

    const url = new URL(req.url);
    const pathname = url.pathname;

    // The "Router"...
    let response: Response;
    if (/^\/proxy-api\/?$/.test(pathname) && req.method === 'GET') {
        // The "proxy API" - https://lastfm-widgets.deno.dev/proxy-api
        const result = await proxyApi(url.searchParams, req.headers, info);
        response = new Response(result.body, {headers: myHeaders, ...result.options});
    } else if (/^\/log\/?$/.test(pathname) && req.method === 'POST') {
        // Simple "post object" log-endpoint - https://lastfm-widgets.deno.dev/log
        log(url.searchParams, req, info);
        response = new Response(null, {status: 200, statusText: 'OK', headers: myHeaders});
    } else if (pathname.startsWith('/widgets/') && req.method === 'GET') {
        // The statically served widgets code - https://lastfm-widgets.deno.dev/widgets/*
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
        // The statically served demo-page - https://lastfm-widgets.deno.dev/*
        response = await serveDir(req, {
            urlRoot: '',
            fsRoot: 'demo',
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: myHeadersArr
        });
    } else {
        response = new Response('Not found', { status: 404, statusText: `Method ${req.method} not supported here`, headers: myHeaders});
        // for other routing examples, see f.ex: https://youtu.be/p541Je4J_ws?si=-tWmB355467gtFIP
    }

    if (url.origin.startsWith('http://localhost:')) { // if http://localhost development, modify slightly
        response.headers.set('Content-Security-Policy',
            `default-src 'none' ; script-src 'self' ; connect-src https: ${url.origin} ; img-src https: blob: data: ${url.origin} ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`);
    }

    return response;

});


// https://github.com/denoland/deploy_feedback/issues/705
console.log(`${new Date().toISOString()} - main.ts running on Deno ${Deno.version.deno} (${navigator.userAgent.toLowerCase()})`);
