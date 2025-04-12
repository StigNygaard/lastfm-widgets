# 🔴 lastfm-widgets

_Tracks_ is a javascript web-widget to show "scrobbles" (play history) from a [Last-fm](https://www.last.fm/) account.
See _Tracks_ in action on https://www.rockland.dk/ and https://lastfm-widgets.deno.dev/. At the latter site, you can not
only find some more information and instructions for use, you can also play with some of the customization options,
including setting the user to show scrobbles from.

[![Tracks](demo/Tracks-lastfm-widget-header-1280x640-2.png "Tracks widget")](https://www.last.fm/user/rockland)

Long time Last.fm users might get a déjà vu feeling by the red album header-lines. As primarily an album listener
myself, I have missed them. So I brought them (optionally) back in this widget.

As name of this repository hints, I might have more than one Last.fm widget planned for this space 🙂

## The technical...

The _Tracks_ widget itself is made as a _webcomponent_ using pure standard web client-side technologies (no frameworks
or build tools needed). It can work "alone" communicating directly with Last.fm's Audioscrobbler v2 API, or it can be
supported by a custom backend "proxy-api". The latter is encouraged when possible, because it makes it possible to
implement throttling of requests to Last.fm's API.

This repository not only holds the widget itself, but also the demo page (https://lastfm-widgets.deno.dev/) and an
example backend proxy-api. The proxy-api is made in [Deno](https://deno.com/) (server-side javascript/typescript). Also,
this repository is set up as a [Deno Deploy](https://deno.com/deploy) project. Any updates in main-branch are
immediately deployed to the demo-site at https://lastfm-widgets.deno.dev/.

The widget (frontend code) should be compatible back to at least Firefox 115 and Chromium 109 based web-browsers (which
are versions running on old Windows 7/8 installations). It also runs in Safari, but unsure how old versions are
supported (I'm not able to test that myself). The backend code is my first simple experiments/experience with Deno, so
you might see me making many changes and "stupid" comments and TODOs in that😊 The backend is generally tested/used
with the latest or a very recent Deno 2.x.

#### /widgets/ folder

The widget frontend code. _All_ that is needed for widget to work in _Demo_ or _Basic_ mode. See
[Releases](https://github.com/StigNygaard/lastfm-widgets/releases) to get latest "release-version" of this folder's
content. And see https://lastfm-widgets.deno.dev/ for more about widget _modes_ and how to use and customize the widget.

#### /demo/ folder

Frontend-code for the demo page seen on https://lastfm-widgets.deno.dev/

#### /services/ folder

- _proxy-api.ts_ - An example backend proxy-api made with Deno. The proxy-api is used on demo page when widget is in
  _Backend-supported_ mode, but also used by widget on [rockland.dk](https://www.rockland.dk/).
- _log.ts_ - A simple log endpoint used by the demo page.

#### /main.ts file

Basically the "web-server" or "router" for https://lastfm-widgets.deno.dev/, serving above-mentioned content.

## Future updates?

What could future updates bring? _Maybe_:

- A layout that adapt nicer to wider display dimensions of widget
- Dark mode
- Refactoring code _if_ I'm in the mood for that kind of thing 🙂
- More documentation (especially on the Deno proxy-api implementation)
- Another widget
