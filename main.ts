import {serveDir} from 'jsr:@std/http/file-server';
import 'jsr:@std/dotenv/load';
import {audioscrobbler} from './proxy-api/audioscrobbler.ts';

/**
 * SET DENO_FUTURE=1
 * @run --allow-net --allow-env --allow-read <url>
 */

// Deno.env.set('APP-START', (new Date()).toString());

Deno.serve(async (req: Request) => {

    const url = new URL(req.url);
    const pathname = url.pathname;

    // The "Router"...
    if (pathname === '/proxy-api' || pathname === '/proxy-api/') {
        // The "proxy API":
        const result = await audioscrobbler(url.searchParams, req.headers);
        return new Response(result.body, result.options);
    } else if (pathname.startsWith('/widgets/')) {
        // The static served widgets code:
        return serveDir(req, {
            urlRoot: 'widgets',
            fsRoot: 'widgets',
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: false, // logging of errors
            headers: []
        });
    } else {
        // The static served demo-page:
        return serveDir(req, {
            urlRoot: '',
            fsRoot: 'demo',
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: false, // logging of errors
            headers: []
        });
    }

});
