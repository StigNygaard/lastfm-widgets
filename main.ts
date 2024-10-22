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

function responseWithHeaders(response: Response): Response {
    for (const [key, value] of Object.entries(myHeaders)) {
        response.headers.set(key, value);
    }
    return response;
}

// we could set a port-number with Deno.serve({port: portno}, handler);
Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {

    const url = new URL(req.url);
    const pathname = url.pathname;

    // The "Router"...
    let response: Response;
    if (/^\/proxy-api\/?$/.test(pathname)) {
        // The "proxy API" - https://lastfm-widgets.deno.dev/proxy-api
        const result = await proxyApi(url.searchParams, req.headers, info);
        response =  new Response(result.body, {headers: myHeaders, ...result.options});
    } else if (/^\/log\/?$/.test(pathname)) {
        // Simple "post object" log-endpoint - https://lastfm-widgets.deno.dev/log
        log(url.searchParams, req, info);
        response = new Response(null, {status: 200, statusText: 'OK', headers: myHeaders});
    } else if (pathname.startsWith('/widgets/')) {
        // The statically served widgets code - https://lastfm-widgets.deno.dev/widgets/*
        response = responseWithHeaders(await serveDir(req, {
            urlRoot: 'widgets',
            fsRoot: 'widgets',
            showDirListing: false,
            showDotfiles: false,
            showIndex: false, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: []
            // TODO Why doesn't this work?:  headers: Object.entries(myHeaders).map(([k, v]) => `${k}: ${v}`)
        }));
    } else {
        // The statically served demo-page - https://lastfm-widgets.deno.dev/*
        response = responseWithHeaders(await serveDir(req, {
            urlRoot: '',
            fsRoot: 'demo',
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: []
            // TODO Why doesn't this work?:  headers: Object.entries(myHeaders).map(([k, v]) => `${k}: ${v}`)
        }));
    }

    if (url.origin.startsWith('http://localhost:')) { // if http://localhost development, modify slightly
        response.headers.set('Content-Security-Policy',
            `default-src 'none' ; script-src 'self' ; connect-src https: ${url.origin} ; img-src https: blob: data: ${url.origin} ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`);
    }

    return response;

});


// https://github.com/denoland/deploy_feedback/issues/705
console.log(`${new Date().toISOString()} - main.ts running on Deno ${Deno.version.deno} (${navigator.userAgent.toLowerCase()})`);
