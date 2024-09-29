import {serveDir} from 'jsr:@std/http/file-server';
import 'jsr:@std/dotenv/load';
import {audioscrobbler} from './proxy-api/audioscrobbler.ts';

/**
 * @run --allow-net --allow-env --allow-read=./demo,./widgets,./.env main.ts
 */

Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {

    const url = new URL(req.url);
    const pathname = url.pathname;

    // The "Router"...
    if (/^\/proxy-api\/?$/.test(pathname)) {
        // The "proxy API" - https://lastfm-widgets.deno.dev/proxy-api
        const result = await audioscrobbler(url.searchParams, req.headers, info);
        return new Response(result.body, result.options);
    } else if (pathname.startsWith('/widgets/')) {
        // The statically served widgets code - https://lastfm-widgets.deno.dev/widgets/*
        return serveDir(req, {
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
        return serveDir(req, {
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

});


console.log(`${new Date().toISOString()} - main.ts running on Deno ${Deno.version.deno}`);
