import {serveDir} from 'jsr:@std/http/file-server';
import 'jsr:@std/dotenv/load';
import {proxyApi} from './services/proxy-api.ts';
import {log} from './services/log.ts';

/**
 * @run --allow-net --allow-env --allow-read=./demo,./widgets,./.env main.ts
 */

Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {

    const url = new URL(req.url);
    const pathname = url.pathname;

    // The "Router"...
    let response: Response;
    if (/^\/proxy-api\/?$/.test(pathname)) {
        // The "proxy API" - https://lastfm-widgets.deno.dev/proxy-api
        const result = await proxyApi(url.searchParams, req.headers, info);
        response =  new Response(result.body, result.options);
    } else if (/^\/log\/?$/.test(pathname)) {
        // Simple "post object" log-endpoint - https://lastfm-widgets.deno.dev/log
        log(url.searchParams, req, info);
        response = new Response('', {status: 200, statusText: 'OK'});
    } else if (pathname.startsWith('/widgets/')) {
        // The statically served widgets code - https://lastfm-widgets.deno.dev/widgets/*
        response = await serveDir(req, {
            urlRoot: 'widgets',
            fsRoot: 'widgets',
            showDirListing: false,
            showDotfiles: false,
            showIndex: false, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: []
        });
    } else {
        // The statically served demo-page - https://lastfm-widgets.deno.dev/*
        response = await serveDir(req, {
            urlRoot: '',
            fsRoot: 'demo',
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: []
        });
    }

    response.headers.set('Content-Security-Policy',
        `default-src 'none' ; script-src 'self' ; connect-src https: http://localhost:8000 ; img-src https: blob: data: http://localhost:8000 ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self'`);

    return response;

});


// https://github.com/denoland/deploy_feedback/issues/705
console.log(`${new Date().toISOString()} - main.ts running on Deno ${Deno.version.deno} (${navigator.userAgent.toLowerCase()})`);
