# 🔴 lastfm-widgets

_Tracks_ is a javascript web-widget to show "scrobbles" (play history) from a [Last-fm](https://www.last.fm/) account.
See _Tracks_ in action on https://www.rockland.dk/ and https://lastfm-widgets.stignygaard.deno.net/.
At the latter site, you can not only find some more information and instructions for use, you can
also play with some of the customization options, including setting the user to show scrobbles from.

[![Tracks](website/demo/Tracks-lastfm-widget-header-1280x640-2.png "Tracks widget")](https://www.last.fm/user/rockland)

Long time Last.fm users might get a déjà vu feeling by the red album header-lines. As primarily an album listener
myself, I have missed them. So I brought them (optionally) back in this widget.

As name of this repository hints, I might have more than one Last.fm widget planned for this space 🙂

## How to Use

Using the widget in any HTML file is straightforward because it's a standard web component. You only need to import the script and place the custom HTML tag where you want it to appear.
You can configure the widget by adding attributes to the custom HTML tag. Get the details and play with the customization options on the [interactive demo site](https://lastfm-widgets.stignygaard.deno.net/ "The demo-page is an interactive playground for widget customization").

Optionally, you can also [add a "proxy-API" to your setup](https://github.com/StigNygaard/lastfm-widgets/blob/main/services/README.md "How to set up a proxy-API for the Tracks widget").


## Dark Mode
Dark mode is supported automatically based on the user's OS or browser preference (`prefers-color-scheme: dark`), no configuration is required.

If your site has its own theme switcher and you want the widget to follow it instead of, or in addition to, the OS preference, you can override the widget's CSS custom properties directly in your own stylesheet, scoped to whatever selector your switcher toggles. Custom properties inherit through the shadow DOM by default, so this works in all modern browsers without needing `:host-context()`, which is deprecated and was only ever implemented in Chromium. ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:host-context), [Can I Use](https://caniuse.com/mdn-css_selectors_host-context))


```css
/* example: force dark/light to follow bootstrap's data-bs-theme */
[data-bs-theme="dark"] lastfm-tracks {
  --bg: #222;
  --fg: #fff;
  --border: #444;
  --bg-hover: #333;
  --bg-nowplaying: #3a3219;
  --bg-nowplaying-hover: #4a4020;
  --bg-album: #3a1e1e;
  --bg-album-hover: #4a2626;
  --fg-muted: #aaa;
  --fg-ext: rgb(255 255 255 / 0.7);
  --footer-bg: #222;
  --footer-border: #454;
  --footer-fg: #9a9;
}

[data-bs-theme="light"] lastfm-tracks {
  --bg: #fff;
  --fg: rgb(34 34 34);
  --border: #eee;
  --bg-hover: #f9f9f9;
  --bg-nowplaying: #fff9e5;
  --bg-nowplaying-hover: #fcf2cf;
  --bg-album: #fbe9e9;
  --bg-album-hover: #fadcdc;
  --fg-muted: rgb(136 136 136 / 1);
  --fg-ext: rgb(34 34 34 / .7);
  --footer-bg: #fff;
  --footer-border: #787;
  --footer-fg: #787;
}
```
Replace [data-bs-theme="dark"]/[data-bs-theme="light"] with whatever selector your theme switcher actually uses, for example .dark or [data-theme="dark"]. The widget does not care which convention is used, it only reads the custom properties that are set on it.

Note that if only the dark override is defined, the widget will still fall back to prefers-color-scheme whenever the site's switcher is set to light while the OS preference is dark. Define both overrides, as shown above, if the site's switcher should fully take priority over the OS preference.

## The technical...

The _Tracks_ widget itself is made as a _webcomponent_ using pure standard web client-side technologies (no frameworks
or build tools needed). It can work "alone" communicating directly with Last.fm's Audioscrobbler v2 API, or it can be
supported by a custom backend "proxy-api". The latter is encouraged when possible, because it makes it possible to
implement throttling of requests to Last.fm's API.

This repository not only holds the widget itself, but also the demo-site (https://lastfm-widgets.stignygaard.deno.net/)
and [_two_ different backend proxy-api implementations](services/README.md "How to set up a proxy-API for the Tracks widget").
The default/primary proxy-API is implemented in [Deno]([Deno](https://deno.com/)) and uses either Deno KV or just
memory for caching. But there's also an alternative Cloudflare Workers (Node.js) proxy-api implementation made
by [burnblazter](https://github.com/burnblazter). 
Also, this repository is set up as a [Deno Deploy](https://deno.com/deploy) project. Any updates to the main-branch
(widget, demo-page and the Deno proxy-api) are immediately deployed to the Deno Deploy demo-site.

The widget itself should be compatible back to at least Firefox 115 and Chromium 109 based web-browsers
(so it also works for Windows 7/8 users stuck on these versions). It should also run in Safari versions going pretty
far back, but I'm unsure exactly how old versions that are supported. The backend code (Deno proxy-api) is my
first simple experiments/experience with Deno (and server-side Javascript in general).

#### /widgets/ folder

The widget frontend code. _All_ that is needed for widget to work in _Demo_ or _Basic_ mode. See
[Releases](https://github.com/StigNygaard/lastfm-widgets/releases) to get the latest "release-version" of this folder's
content. And see the demo page at https://lastfm-widgets.stignygaard.deno.net/ for more about widget _modes_
and how to use and customize the widget.

#### /website/demo/ folder

Frontend-code for the demo page seen on https://lastfm-widgets.stignygaard.deno.net/.

#### /website/promo/ folder

Frontend-code for a simple promo page pointing to the demo page at https://lastfm-widgets.stignygaard.deno.net/.
This is the default webpage shown when this project is deployed. However, you can configure it to
show the demo page instead.  

#### /services/ folder

- `proxy-api.ts` - A Deno proxy-api using either in-memory or (by default) Deno KV cache.
- `log.ts` - A simple log endpoint used by the demo page.

On the demo-page, Deno KV is the normally used proxy-api when widget is in _Backend-supported_ mode – and it is also used by widget on [rockland.dk](https://www.rockland.dk/).

For full documentation on setting up the backend proxies, see [services/README.md](services/README.md "How to set up a proxy-API for the Tracks widget").

#### /cf-worker/ folder

An alternative Cloudflare Worker backend proxy-api. Kindly contributed to this project by [burnblazter](https://github.com/burnblazter).

For full documentation on setting up the backend proxies, see [services/README.md](services/README.md "How to set up a proxy-API for the Tracks widget").

#### /main.ts file

Application "entrypoint". Basically the "web-server" or "router" for https://lastfm-widgets.stignygaard.deno.net/,
serving the above-mentioned content (except `/cf-worker/`).

## Future updates?

What could future updates bring? _Maybe_:

- A layout that adapts nicer to wider display dimensions of widget
- Another widget
