/**
 *    Tracks, a Last-fm scrobbles widget.
 *    Except when in "demo"-mode, widget is able to show a continuously updated tracklist.
 *
 *    Stig Nygaard, 2024.
 *    https://www.rockland.dk/
 *    https://www.last.fm/user/rockland
 *    https://github.com/StigNygaard/lastfm-widgets
 *    https://lastfm-widgets.deno.dev/
 */

const scriptURI = import.meta.url;
const LOG = false;

// I see en-GB 24h formats as pretty intuitive and "universally understandable".
// Well, at least in the "western world". So I'll stick to that here...
const rtf = new Intl.RelativeTimeFormat('en-GB', {
    localeMatcher: 'best fit', // "best fit" or "lookup"
    numeric: 'auto', // "always" or "auto"
    style: 'short' // "long", "short" or "narrow"
});
const dtfDateTimeThisYear = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});
const dtfDateDayShort = new Intl.DateTimeFormat('en-GB', { // DayShort
    day: 'numeric',
    month: 'short',
    year: 'numeric'
});
const dtfDateMonthLong = new Intl.DateTimeFormat('en-GB', { // MonthLong
    // day: 'numeric',
    month: 'long',
    year: 'numeric'
});
const dtfDateTimeLong = new Intl.DateTimeFormat('en-GB', { // DateTimeLong
    dateStyle: 'full', // "full", "long", "medium", and "short"
    timeStyle: 'short', // "full", "long", "medium", and "short"
    hour12: false
});

/**
 * Creates an HTML element with the specified tag name, attributes, and content.
 *
 * @param {string} tagName - The tag name of the element to create.
 * @param {object} attributes - An object containing the attributes to set on the element.
 * @param {...(string | Node)} content - Content to be added to the element. Can be strings and Node objects.
 * @returns {HTMLElement} - The created HTML element.
 */
function create(tagName, attributes = {}, ...content) {
    const element = document.createElement(tagName);
    for (const [attr, value] of Object.entries(attributes)) {
        if (value === false) {
            // Ignore - Don't create attribute (the attribute is "disabled")
        } else if (value === true) {
            element.setAttribute(attr, attr); // xhtml-style "enabled" attribute
        } else {
            element.setAttribute(attr, String(value));
        }
    }
    if (content?.length) {
        element.append(...content);
    }
    return element;
}


// https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator/Collator#sensitivity
const RelaxedComparator = new Intl.Collator(undefined, { sensitivity: 'base' });

function caseInsensitiveIdenticalStrings(str1, str2) {
    return RelaxedComparator.compare(str1, str2) === 0;
}

/**
 * A "fetcher" that works similar for "real" (json) endpoints and for
 * "endpoints" implemented as a "jsonp script" to avoid CORS issues.
 *
 * (I thought I needed this, but last.fm actually allows CORS, so I only use json() method in this widget)
 */
const fetcher = (function () {

    /**
     * Makes a "JSONP request" to the given URI
     *
     * @param {string} uri - The URI to make the JSONP request to.
     * @param {string} [cbparam='callback'] - The callback parameter-name (The param-name, *not* the param-value).
     * @returns {Promise<unknown>} - A promise that resolves to the data received from JSONP request.
     */
    function jsonp(uri, cbparam = 'callback') {
        running.add(uri);
        const ts = Date.now();

        return new Promise(function (resolve, reject) {
            const id = '_' + Math.round(10000 * Math.random());
            const callbackName = 'jsonp_callback_' + id;
            globalThis[callbackName] = function (data) {
                delete globalThis[callbackName];
                const ele = document.getElementById(id);
                ele.parentNode.removeChild(ele);
                resolve(data);
            };
            const src = `${uri}&${cbparam}=${callbackName}`;
            const script = create('script', { src: src, async: true, id: id });
            script.addEventListener('error', reject);
            (document.getElementsByTagName('head')[0] ?? document.body ?? document.documentElement).appendChild(script);
        }).finally(
            () => {
                LOG && console.log(`${uri} time by jsonp: ${Date.now() - ts}ms.`);
                running.delete(uri);
            }
        );
    }

    /**
     * Makes a request to the given URI, expecting a json response
     *
     * @param {string} uri - The URI for the request
     * @returns {Promise<unknown>}
     */
    function json(uri) {
        running.add(uri);
        const ts = Date.now();

        return fetch(uri)
            .then(function (response) {
                if (response.headers.get('content-type')?.includes('application/json')) {
                    if (!response.ok) {
                        LOG && console.warn(`[${uri}] ${response.status} - ${response.statusText}`);
                    }
                    return response.json();
                }
                throw new Error(`Network response from ${uri.href} was NOT ok. Status: ${response.status}. statusText:${response.statusText}.`);
            }).finally(
                () => {
                    LOG && console.log(`${uri} time: ${Date.now() - ts}ms.`);
                    running.delete(uri);
                }
            );
    }

    const running = new Set();
    function isRunning(uri) {
        return running.has(uri);
    }

    return {
        json: json,
        jsonp: jsonp,
        isRunning: isRunning
    };
})();



class Tracks extends HTMLElement {

    get #demoKey() {
        return 'de77ae918371692f6765c4bfa85c5f11'; // api-key to use for "demo-mode" only
    }
    get #apiRoot() {
        return '//ws.audioscrobbler.com/2.0';
    }

    #apikey = null;
    #user = null;
    #backend = null;
    #tracks = 50;
    #interval = 60;
    #updates = 1; // 1 in demo-mode (initial only). 0 default in basic and backend-mode (unlimited/"forever")
    #widgetMode = 'demo'; // backend, basic or demo
    get state() {
        return {
            apikey: this.#apikey,
            user: this.#user,
            backend: this.#backend,
            tracks: this.#tracks,
            interval: this.#interval,
            updates: this.#updates,
            widgetMode: this.#widgetMode
        };
    }

    #initiated = false;
    #userAgent = navigator.userAgent.toLowerCase();
    #okUserAgent = this.#notBot(this.#userAgent);

    #fetcher = fetcher.json;

    // Fires when an instance of the element is created or updated
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    // Fires when an instance was inserted into the document
    connectedCallback() {
        const cachevalue = new Date().toISOString().substring(0,10);
        const basestyles = new URL('tracks.css', scriptURI);
        if (!basestyles.searchParams.get('cache')) {
            basestyles.searchParams.set('cache', cachevalue.toString());
        }
        this.shadowRoot.appendChild(create('link', { rel: 'stylesheet', id: 'basestyles', href: basestyles.href }));
        this.#init();
        this.#dispatchStateChange();
    }

    // Fires when an instance was removed from the document
    disconnectedCallback() {
        this.stopUpdating();
        if (this.shadowRoot) {
            this.shadowRoot.replaceChildren();
        }
    }

    static get observedAttributes() {
        return ['user', 'apikey', 'backend', 'tracks', 'updates', 'interval']; // Plus attrib. 'ignorebots' currently checked directly before API-calls
    }

    // Fires when an observed attribute was added, removed, or updated
    attributeChangedCallback(attrName, oldVal, newVal) {
        LOG && console.log(
            `Attributes: backend=${this.getAttribute('backend')}, apikey=${this.getAttribute('apikey')},
            user=${this.getAttribute('user')}, tracks=${this.getAttribute('tracks')}, 
            updates=${this.getAttribute('updates')}, interval=${this.getAttribute('interval')}.`
        );

        const newWidgetMode = this.#getWidgetMode(); // demo | basic | backend
        const widgetModeChanged = this.#widgetMode !== newWidgetMode;
        this.#widgetMode = newWidgetMode; // demo | basic | backend

        LOG && console.log(`Widget mode "${this.#widgetMode}" - Attribute ${attrName} changing from ${oldVal} to ${newVal}...`);

        this.#backend = this.getAttribute('backend')?.trim() || null;

        const potential_apikey = this.getAttribute('apikey')?.trim() ?? '';
        if (potential_apikey.length && potential_apikey !== this.#demoKey) {
            this.#apikey = potential_apikey;
        } else {
            this.#apikey = null;
        }

        let newUser = this.getAttribute('user')?.trim();
        if (!newUser?.length) newUser = null;
        const userChanged = this.#user !== newUser;
        this.#user = newUser;

        const potential_tracks = Math.abs(parseInt(this.getAttribute('tracks'), 10));
        if (!potential_tracks) { // null, NaN or 0
            this.#tracks = 50;
        } else {
            this.#tracks = Math.min(potential_tracks, 200);
        }

        const potential_updates = Math.abs(parseInt(this.getAttribute('updates'), 10));
        if (this.#widgetMode === 'demo') {
            this.#updates = 1;
        } else { // 'basic' or 'backend' mode
            if (!potential_updates) { // null, NaN or 0
                this.#updates = 0;
            } else {
                this.#updates = Math.max(0, potential_updates);
            }
        }

        const potential_interval = Math.abs(parseInt(this.getAttribute('interval'), 10)); // number | NaN
        if (this.#widgetMode === 'demo') {
            // Actually not relevant, because currently we don't allow refresh in demo mode
            if (!potential_interval) { // null, NaN or 0
                this.#interval = 120;
            } else {
                this.#interval = Math.max(potential_interval, 90);
            }
        } else if (this.#widgetMode === 'basic') {
            if (!potential_interval) { // null, NaN or 0
                this.#interval = 60;
            } else {
                this.#interval = Math.max(potential_interval, 30);
            }
        } else { // 'backend' mode
            if (!potential_interval) { // null, NaN or 0
                this.#interval = 60;
            } else {
                this.#interval = Math.max(potential_interval, 10);
            }
        }

        const dataValid = () => {
            if (this.#widgetMode === 'demo') {
                return !!this.#user?.length;
            } else if (this.#widgetMode === 'basic') {
                return !!(this.#user?.length && this.#apikey?.length);
            } else if (this.#widgetMode === 'backend') {
                return !!this.#backend?.length;
            }
            LOG && console.warn(`Data is not valid! ${this.#user}/${this.#apikey}/${this.#widgetMode}`);
            return false;
        };


        if (this.#initiated && dataValid()) {
            this.#dispatchStateChange();
            if (userChanged || widgetModeChanged) {
                this.#scrobbles.clearUpdatesState();
                this.shadowRoot.getElementById('playlist')?.replaceChildren(); // clear currently shown tracks
                console.log(`Tracks User/WidgetMode has changed to ${this.#user}/${this.#widgetMode} - Update profile-header and tracklist now...`);
                this.#profile.setup();
                this.#scrobbles.update();
            }
        }

    }

    #dispatchStateChange() {
        LOG && console.log('DISPATCH stateChange', this.state);
        this.dispatchEvent(
            new CustomEvent(
                'stateChange',
                {
                    bubbles: true,
                    cancelable: false,
                    detail: this.state
                }
            )
        );
    }

    #getWidgetMode() {
        const backend = this.getAttribute('backend')?.trim() ?? '';
        const apikey = this.getAttribute('apikey')?.trim() ?? '';
        if (apikey === this.#demoKey) {
            console.error('You cannot use that apikey for Basic or Backend-supported mode.');
        } else {
            if (backend.length) {
                if (backend.includes(this.#apiRoot)) {
                    console.error(`You cannot use last.fm's own audioscrobbler-api as the backend in 'Backend-supported' mode.`);
                } else {
                    return 'backend';
                }
            }
            if (apikey.length) return 'basic';
        }
        return 'demo';
    }

    #notBot(ua) {
        const isBot = ua.includes('bot') ||
            ua.includes('spider') ||
            ua.includes('crawl') ||
            ua.includes('archive') ||
            ua.includes('harvest') ||
            ua.includes('radar') ||
            ua.includes('headless');
        if (isBot) {
            console.warn(`NOT loading data for tracks widget. UserAgent looks like a bot: "${ua}"`);
        }
        return !isBot;
    }


    // Fires when an element is moved to a new document
    adoptedCallback() {
        console.warn('adoptedCallback: element is moved to a new document!');
    }

    stopUpdating() {
        this.#scrobbles.stop();
    }

    #init() {
        const skeleton = create('div', { 'class': 'wrap', 'lang': 'en-GB' },
            create('div', { 'class': 'header' }, create('div', { 'class': 'content' },
                    create('a', { 'href': '#', 'class': 'userlink' },
                        create('img', {
                            'class': 'avatar',
                            'alt': '',
                            'src': '' // src to be set from script
                        })),
                    create('a', { 'href': 'https://www.last.fm/', 'class': 'lastfm', 'title': 'Last.fm' },
                        create('div', {}, '')
                    ),
                    create('div', { 'class': 'usernamecontainer' },
                        create('a', { 'href': '#', 'class': 'userlink username' }, '')
                    ),
                    create('div', { 'class': 'scrobblehistory' }, '')
                )
            ),
            create('div', { 'id': 'playlist', 'inert': false }),
            create('div', { 'class': 'footer' },
                create('a', {
                    href: 'https://github.com/StigNygaard/lastfm-widgets',
                    title: 'Widget by Stig Nygaard. Use it on your homepage or blog, showing "scrobbles" from your own last.fm account...'
                }, 'Tracks widget')
            ),
        );
        this.shadowRoot.appendChild(skeleton);

        // TODO: Maybe use the Intersection Observer API and not start until into view?:
        //  https://usefulangle.com/post/113/javascript-detecting-element-visible-during-scroll
        //  https://caniuse.com/intersectionobserver
        Promise.all([this.#profile.setup(), this.#scrobbles.update()]).then(
            () => this.#initiated = true
        );
        // TODO Also might pause updates when page is not visible?
        //  https://developer.mozilla.org/en-US/blog/using-the-page-visibility-api/
        //  https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
        //  https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility

        console.log(
            `Tracks widget initializing in '${this.#widgetMode}'-mode. ${
                this.#updates || 'Forever'
            } times getting ${this.#tracks} tracks for user ${
                this.#user ?? '(unknown)'
            } every ${this.#interval} seconds.`,
        );
    }


    #profile = (function (it) {
        function setup(_secondTry = false) {
            const fixedParams = {
                method: 'user.getinfo',
                format: 'json'
            };
            const url = it.#widgetMode === 'backend'
                ? new URL(it.#backend, it.baseURI)
                : new URL(`https:${it.#apiRoot}`);
            for (const param in fixedParams) {
                url.searchParams.append(param, fixedParams[param]);
            }
            if (it.#widgetMode === 'demo') {
                url.searchParams.append('api_key', it.#demoKey);
            } else if (it.#apikey) {
                url.searchParams.append('api_key', it.#apikey);
            }
            if (it.#user?.length) {
                url.searchParams.append('user', it.#user);
            }

            if ((it.#widgetMode === 'backend' && !it.hasAttribute('ignorebots')) || it.#okUserAgent) {
                LOG && console.log(`Getting Profile with: ${url.href} ...`);
                if (!fetcher.isRunning(url.href)) {
                    return it.#fetcher(url.href)
                        .then((o) => {
                            if (o.error) {
                                if ([26, 29].includes(o.error)) {
                                    console.error(`Tracks widget: ⛔ ${o.error} - ${o.message} !`);
                                }
                                throw new Error(`${url.href} Returned: \n${JSON.stringify(o)}`);
                            }
                            LOG && console.log(`Profile data: \n${JSON.stringify(o)}`);
                            update(o);
                        })
                        .catch((e) => {
                            console.error(`Error calling audioscrobbler user.getinfo. \n`, e);
                        })
                        .finally(() => {
                        });
                } else {
                    console.warn(`Skipping Profile with ${url.href} because already running...`);
                }
            }
        }

        function update(o) {
            if (o?.user?.name) {
                const avatar = o.user.image[2]['#text']; // TODO: filter on size=large !?
                const sinceDt = new Date(Number(o.user.registered.unixtime) * 1000);
                const scrobbleHistory = `Scrobbling since ${dtfDateMonthLong.format(sinceDt)}`;
                const title = `${o.user.realname} (${o?.user?.name}) on Last.fm`;

                it.style.setProperty('--header-background', `url("${avatar}")`);
                it.shadowRoot.querySelectorAll('a.userlink').forEach((a) => {
                    a.href = o.user.url;
                    a.title = title;
                });
                it.shadowRoot.querySelectorAll('.username').forEach((e) => {
                    e.textContent = o.user.name;
                });
                it.shadowRoot.querySelectorAll('.scrobblehistory').forEach( (e) => {
                    e.textContent = scrobbleHistory;
                });
                it.shadowRoot.querySelectorAll('img.avatar').forEach((img) => {
                    img.src = avatar;
                });
            } else {
                console.error(`Skipping update profile because unexpected data: ${JSON.stringify(o)}`);
            }
        }

        return {
            setup: setup
        };
    })(this);

    /**
     * Engine for receiving scrobbles data
     */
    #scrobbles = (function (it) {
        let timer;
        let updatesCanceled = false;
        let updateCount = 0;
        let successiveErrors = 0;
        const fixedParams = {
            method: 'user.getrecenttracks',
            extended: '1',
            format: 'json'
        };

        function clearUpdatesState() {
            updateCount = 0;
            updatesCanceled = false;
            successiveErrors = 0;
        }

        function update() {
            const url = it.#widgetMode === 'backend'
                ? new URL(it.#backend, it.baseURI)
                : new URL(`https:${it.#apiRoot}`);
            clearTimeout(timer);
            for (const param in fixedParams) {
                url.searchParams.append(param, fixedParams[param]);
            }
            if (it.#widgetMode === 'demo') {
                url.searchParams.append('api_key', it.#demoKey);
            } else if (it.#apikey) {
                url.searchParams.append('api_key', it.#apikey);
            }
            if (it.#user?.length) url.searchParams.append('user', it.#user);
            url.searchParams.append('limit', it.#tracks);

            if ((it.#widgetMode === 'backend' && !it.hasAttribute('ignorebots')) || it.#okUserAgent) {
                LOG && console.log(`[${updateCount + 1}] Getting Scrobbles with: ${url.href} ...`);

                if (!fetcher.isRunning(url.href)) {
                    return it.#fetcher(url.href) /* or '/widgets/test.json' */
                        .then((o) => {
                            if (o.error) {
                                if ([10, 17, 26, 29].includes(o.error)) { // 17: "Login: User required to be logged in"
                                    updatesCanceled = true;
                                    console.error(`Tracks widget: ⛔ Updates has stopped because error: ${o.error} - ${o.message} !`);
                                }
                                throw new Error(`${url.href} Returned: \n${JSON.stringify(o)}`);
                            }
                            it.#renderScrobbles(o);
                            successiveErrors = 0;
                        })
                        .catch((e) => {
                            console.error(`Error calling audioscrobbler user.getrecenttracks. \n`, e);
                            successiveErrors++;
                        })
                        .finally(() => {
                            updateCount++;
                            if (updateCount === 1) { // initial
                                it.scrollTop = 0;
                            }
                            if ((it.#widgetMode !== 'backend' && successiveErrors >= 3) || (successiveErrors >= 10)) {
                                updatesCanceled = true;
                                console.warn(`Updates stopped in ${it.#widgetMode}-mode, because of ${successiveErrors} successive errors occurring.`);
                            }
                            if (!updatesCanceled && (it.#updates === 0 || updateCount < it.#updates)) {
                                LOG && console.log(`Waiting ${it.#interval} seconds until next update...`);
                                timer = setTimeout(update, it.#interval * 1000);
                            }
                        });
                } else {
                    console.warn(`Skipping fetching scrobbles with ${url.href} because already running...`);
                }
            }
        }

        function stop() {
            updatesCanceled = true;
            if (timer) {
                clearTimeout(timer);
                console.log('Tracks widget: Updating canceled');
            }
        }

        return {
            update: update,
            clearUpdatesState: clearUpdatesState,
            stop: stop
        };
    })(this);

    /**
     * Engine for "pre-processing" received scrobbles data. Making album-lines etc.
     */
    #scrobblesProcessor = (function () {
        const items = [];
        let now = new Date();
        let albumHeaderData = {};

        function process(tracks) {
            clearItems();
            now = new Date();
            if (tracks.length) {
                for (let idx = tracks.length - 1; idx >= 0; idx--) {
                    updateItems(tracks[idx]); // add track and eventually also an album header to items
                }
                if (items.length > 1) {
                    potentiallyAlbumHeaderItem(); // potentially add an album header at top of items
                    albumHeaderData = {};
                }
            }
            return this; // make chaining possible
        }

        function playedInfo(t) {
            const retVal = {};
            if (t['@attr']?.nowplaying === 'true') {
                retVal.text = 'playing';
            } else {
                const dt = new Date(Number(t.date.uts) * 1000);
                const diffMs = dt - now;
                const diffMinutes = Math.round(diffMs / 60000);
                const diffHours = Math.trunc(diffMinutes / 60);
                const diffDays = Math.trunc(diffHours / 24);
                if (diffDays <= -1) {
                    if (dt.getFullYear() === now.getFullYear()) {
                        retVal.text = dtfDateTimeThisYear.format(dt);
                    } else {
                        retVal.text = dtfDateDayShort.format(dt);
                    }
                } else if (diffHours <= -1) {
                    retVal.text = rtf.format(diffHours, 'hour');
                } else {
                    retVal.text = rtf.format(diffMinutes, 'minute');
                }
                retVal.title = dtfDateTimeLong.format(dt);
            }
            return retVal;
        }

        function potentiallyAlbumHeaderItem() {
            if (items[0].type === 'track' && items[1].type === 'track' && caseInsensitiveIdenticalStrings(items[0].albumTitle, items[1].albumTitle)) {
                if (albumHeaderData.albumTitle?.length) {
                    const item = {
                        type: 'album',
                        splitTitle: splitAlbumTitle(albumHeaderData.albumTitle)
                    };
                    items.unshift(Object.assign(item, albumHeaderData));
                }
            }
        }

        function containing(s, sub) {
            s = s.trim().replace(/^the\s/gui, '').replace(/,\sthe$/gui, '').replace(' & ', ' and ').trim();
            sub = sub.trim().replace(/^the\s/gui, '').replace(/,\sthe$/gui, '').replace(' & ', ' and ').trim();
            return (s.toLocaleUpperCase().includes(sub.toLocaleUpperCase()));
        }

        function splitAlbumTitle(title) {
            title = title.trim();
            const rtval = { full: title, basic: title };
            const regs = [
                /^(.+[^-\s])(\s+-\s+)(\w[\w\s]+\sEdition[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(\w[\w\s]+\sVersion[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(\w[\w\s]+\sDeluxe[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(\w[\w\s]+\sRemaster[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(\w[\w\s]+\sDisc[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(\w[\w\s]+\sCD[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Deluxe[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Super[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Remaster[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Music from[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(EP[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Live[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(single[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Explicit[\w\s]*)$/iu,
                /^(.+[^-\s])(\s+-\s+)(Disc\s[\w\s]+)$/iu,
                /^(.+[^-\s])(\s+-\s+)(CD\s[\w\s]+)$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sEdition[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sVersion[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sDeluxe[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sSuper[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sRemaster[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sDisc[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([][\w\s]+\sCD[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([]Deluxe[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([]Super[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([]Remaster[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([]Music from[\w\s]*[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([']EP[)\]'])$/iu,
                /^(.+[^-\s])(\s+)([([]Live[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([']single[)\]'])$/iu,
                /^(.+[^-\s])(\s+)([([]Explicit[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([]Disc\s[\w\s]+[)\]])$/iu,
                /^(.+[^-\s])(\s+)([([]CD\s[\w\s]+[)\]])$/iu,
                /^(.+[^-\s])(\s+)(EP[\d\s]*)$/iu
            ]; // ( ... bonus CD), (single),... ?
            for (const reg of regs) {
                const m = title.match(reg);
                // 0: full (= basic+spacer+extension)
                // 1: basic
                // 2: spacer
                // 3: extension
                if (m !== null && m.length === 4) {
                    rtval.basic = m[1];
                    rtval.spacer = m[2];
                    rtval.extension = m[3];
                    break;
                }
            }
            return rtval;
        }

        function updateItems(t) {
            const item = { type: 'track' };
            item.pinfo = playedInfo(t);
            item.loved = t.loved === '1';
            item.trackName = (t.name ?? '').trim();
            item.trackUrl = (t.url ?? '').trim();
            item.artistName = (t.artist?.name ?? '').trim();
            item.artistUrl = (t.artist?.url ?? '').trim();
            item.albumCover = t.image?.find( (i) => i.size === 'medium')['#text']; // 64px
            // item.albumCover = t.image?.find(i => i.size === 'large')['#text']; // 174px
            item.albumTitle = (t.album['#text'] ?? '').trim();
            item.albumUrl = t.artist?.url + '/' + encodeURIComponent(item.albumTitle).replaceAll('%20', '+');
            if (items.length > 1) {
                if (!caseInsensitiveIdenticalStrings(item.albumTitle, items[0].albumTitle)) {
                    potentiallyAlbumHeaderItem();
                    albumHeaderData = {};
                }
            }
            // update potential albumHeaderData with data from track t !
            if (item.albumTitle?.length && !(albumHeaderData.albumTitle?.length)) { // if no current potential "header album"...
                albumHeaderData.albumTitle = item.albumTitle;
                albumHeaderData.albumUrl = item.albumUrl;
                albumHeaderData.albumCover = item.albumCover;
                albumHeaderData.artistName = item.artistName;
                albumHeaderData.artistUrl = item.artistUrl;
            } else if (item.albumTitle?.length && caseInsensitiveIdenticalStrings(item.albumTitle, albumHeaderData.albumTitle)) { // if same album-title header as potential album-header...
                if (item.artistName !== albumHeaderData.artistName && albumHeaderData.artistName !== 'Various Artists') { // if different artist-names (and potential album-header is not VA)...
                    const shortArtistName = item.artistName?.split(',')[0];
                    if (containing(albumHeaderData.artistName, item.artistName)) {
                        albumHeaderData.albumTitle = item.albumTitle;
                        albumHeaderData.albumUrl = item.albumUrl;
                        if (item.albumCover !== 'https://lastfm.freetls.fastly.net/i/u/64s/2a96cbd8b46e442fc41c2b86b821562f.png') {
                            albumHeaderData.albumCover = item.albumCover;
                        }
                        albumHeaderData.artistName = item.artistName;
                        albumHeaderData.artistUrl = item.artistUrl;
                    } else if (shortArtistName?.length && containing(albumHeaderData.artistName, shortArtistName)) {
                        albumHeaderData.albumTitle = item.albumTitle;
                        if (item.albumCover !== 'https://lastfm.freetls.fastly.net/i/u/64s/2a96cbd8b46e442fc41c2b86b821562f.png') {
                            albumHeaderData.albumCover = item.albumCover;
                        }
                        albumHeaderData.artistName = shortArtistName;
                        albumHeaderData.artistUrl = item.artistUrl.split(',')[0];
                        albumHeaderData.albumUrl = albumHeaderData.artistUrl + '/' + encodeURIComponent(albumHeaderData.albumTitle).replaceAll('%20', '+');
                    } else if (!containing(item.artistName, albumHeaderData.artistName)) {
                        albumHeaderData.artistName = 'Various Artists';
                        albumHeaderData.artistUrl = 'https://www.last.fm/music/Various+Artists';
                    }
                    if (albumHeaderData.albumCover === 'https://lastfm.freetls.fastly.net/i/u/64s/2a96cbd8b46e442fc41c2b86b821562f.png') {
                        albumHeaderData.albumCover = item.albumCover;
                    }
                }
            } else {
                albumHeaderData = {};
            }
            items.unshift(item);
        }

        function getItems() {
            return items;
        }

        function clearItems() {
            items.length = 0;
        }

        return {
            process: process,
            getItems: getItems,
            clearItems: clearItems
        };
    })();


    /**
     * Render scrobbles (the playlist)
     * @param o
     */
    #renderScrobbles(o) {

        LOG && console.log(`o data stringify: \n${JSON.stringify(o)}`);

        const scrobbles = o?.recenttracks?.track;

        const lines = [];
        if (scrobbles?.length === 0) {
            // TODO Make a nice "There are no recent tracks scrobbled for this user" message!?
            console.warn('Tracks: The user has no recent tracks!');
        } else if (scrobbles?.length) {

            this.#scrobblesProcessor.process(scrobbles).getItems().forEach( (item) => {
                    if (item.type === 'track') {
                        lines.push(create('div', {class: item.pinfo.text === 'playing' ? 'trackinfo nowplaying' : 'trackinfo'},
                            create('a', {class: 'cover', href: item.albumUrl, tabindex: '-1'},
                                item.albumCover
                                    ? create('img', {
                                        src: item.albumCover,
                                        alt: '',
                                        title: item.albumTitle
                                    })
                                    : ''),
                            create('a', {
                                class: item.loved ? 'track loved' : 'track',
                                href: item.trackUrl,
                                title: item.trackName,
                                tabindex: '-1'
                            }, item.trackName),
                            create('div', {class: 'artist'},
                                create('a', {
                                    href: item.artistUrl,
                                    title: item.artistName,
                                    tabindex: '-1'
                                }, item.artistName)),
                            create('div', {
                                    class: 'play',
                                    title: item.pinfo.text === 'playing' ? 'Scrobbling now...' : item.pinfo.title
                                },
                                item.pinfo.text)
                        ));
                    } else if (item.type === 'album') {
                        const coverLink = create('a', {class: 'cover', href: item.albumUrl, tabindex: '-1'},
                            item.albumCover
                                ? create('img', {
                                    src: item.albumCover,
                                    alt: '',
                                    title: item.albumTitle
                                })
                                : '');
                        const artistLink = create('a', {
                            href: item.artistUrl,
                            title: item.artistName,
                            class: 'albumArtist',
                            tabindex: '-1'
                        }, item.artistName);
                        if (item.splitTitle.extension) {
                            const albumBasicLink = create('a', {
                                href: `${item.artistUrl}/${encodeURIComponent(item.splitTitle.basic).replace(/%20/g, '+')}`,
                                title: item.splitTitle.basic,
                                class: 'album-title',
                                tabindex: '-1'
                            }, item.splitTitle.basic);
                            const albumExtensionLink = create('a', {
                                href: item.albumUrl,
                                title: item.albumTitle,
                                class: 'album-title extension',
                                tabindex: '-1'
                            }, item.splitTitle.extension);
                            lines.push(create('div', {class: 'albuminfo'},
                                coverLink,
                                create('div', {class: 'albumline'},
                                    artistLink,
                                    ' — ',
                                    albumBasicLink,
                                    item.splitTitle.spacer,
                                    albumExtensionLink
                                )
                            ));
                        } else {
                            const albumLink = create('a', {
                                href: item.albumUrl,
                                title: item.albumTitle,
                                class: 'album-title',
                                tabindex: '-1'
                            }, item.albumTitle);
                            lines.push(create('div', {class: 'albuminfo'},
                                coverLink,
                                create('div', {class: 'albumline'},
                                    artistLink,
                                    ' — ',
                                    albumLink
                                )
                            ));
                        }
                    }
                }
            );
            this.shadowRoot.getElementById('playlist').replaceChildren(...lines);

        } else {
            console.error('Error or aborted getting scrobbles!');
        }
        this.#scrobblesProcessor.clearItems();
    }

}

// Register custom element...
if (!customElements.get('lastfm-tracks')) {
    customElements.define('lastfm-tracks', Tracks);
} else {
    LOG && console.warn('<lastfm-tracks/> was already defined.');
}
