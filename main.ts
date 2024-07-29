import {serveDir, serveFile} from "jsr:@std/http/file-server";
import "jsr:@std/dotenv/load";

/**
 * @run --allow-net --allow-env --allow-read <url>
 */

const password = Deno.env.get('PASSWORD');

console.log(`Password is ${password}`);
Deno.env.set("APP-START", (new Date()).toString());

Deno.serve((req: Request) => {

    const pathname = new URL(req.url).pathname;
    console.log(`Pathname is ${pathname}.`);

    console.log(`App was started at ${Deno.env.get("APP-START")}`);

    return new Response("Hello, world! I'm a Deno TEST page...");

});
