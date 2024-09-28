
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

/**
 * Throttles the execution of a given function by a specified interval.
 *
 * @param {function} func - The function to throttle.
 * @param {number} interval - The interval in milliseconds.
 * @returns {function} - The throttled function.
 */
function throttle(func, interval) {
    let timeout = null;
    return function (...args) {
        if (timeout) return;
        const later = () => {
            func.apply(this, args);
            timeout = null;
        }
        timeout = setTimeout(later, interval);
    }
}

/**
 * Debounces a function, ensuring that it is only called after a certain delay has passed since the last invocation.
 *
 * @param {function} func - The function to be debounced.
 * @param {number} delay - The delay time in milliseconds.
 * @returns {function} - The debounced function.
 */
function debounce(func, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

/**
 * Make style definition for custom "lastfm-tracks" element.
 *
 * @param {number} width - The width of the element in pixels.
 * @param {number} height - The height of the element in pixels.
 * @return {string} - Style definition with the specified width and height.
 */
function styleDefString(width, height) {
    return `lastfm-tracks {\n  box-sizing: border-box;\n  border: 1px solid #000;\n  width: ${width}px;\n  height: ${height}px;\n}`;
}

/**
 * ResizeObserverCallback function
 *
 * @param {ResizeObserverEntry[]} [_roea] - ResizeObserverEntry Array
 */
function updateStyleDef(_roea) {
    const styleDef = document.querySelector(('.options pre.style'));
    const widget = document.querySelector('lastfm-tracks');
    if (styleDef && widget) {
        const { offsetWidth, offsetHeight } = widget;
        styleDef.textContent = styleDefString(offsetWidth, offsetHeight);
    }
}

/**
 * A "throttled" ResizeObserverCallback function
 */
const handleResizedWidget = throttle(updateStyleDef, 100);

function updateTagDef() {
    const widget = document.querySelector('lastfm-tracks');
    const tagDef = document.querySelector(('.options pre.tag'));
    const attribs = [];
    widget.getAttributeNames().forEach(name => {
        const val = widget.getAttribute(name);
        if (name!=='style' && !(name === 'class' && val === '')) {
            attribs.push(`\n  ${name}="${val}"`);
        }
    })
    tagDef.textContent = `<lastfm-tracks ${attribs.join(' ')}>\n</lastfm-tracks>`;
}

const stateChangeHandler = debounce(
    function(ev) {
        const showMode = document.getElementById('show-mode');
        if (ev.detail) {
            let widgetMode = ev.detail.widgetMode.trim();
            if (showMode) {
                widgetMode = widgetMode.charAt(0).toUpperCase() + widgetMode.slice(1);
                showMode.textContent = widgetMode.replace('Backend', 'Backend-supported');
            }
            updateTagDef();
        }
    },
    500
);

function isMobile() {
    return /mobile|tablet|Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

window.addEventListener(
    'DOMContentLoaded',
    function () {
        if (!isMobile()) {
            document.body.classList.add('desktop-mode');
        }
        const widgetContainer = document.querySelector('div.widget');
        const widgetResizeable = widgetContainer.querySelector('div.resizeable');
        widgetContainer.addEventListener('stateChange', stateChangeHandler);
        /**
         * Tracks widget
         * @type {Tracks}
         */
        const widget = create('lastfm-tracks', { backend: '/proxy-api', interval: 35 });
        widgetResizeable.appendChild(widget);
        const stopButton = document.querySelector('button#stopBtn');
        const incIntervalButton = document.querySelector('button#incIntervalBtn');
        const toggleDynaHeader = document.querySelector('input.dynaheader');
        const toggleHideAlbums = document.querySelector('input.hidealbums');
        const toggleNoScroll = document.querySelector('input.noscroll');
        const usernameInput = document.querySelector('input.username');
        const apiKeyInput = document.querySelector('input.apikey');
        const dynaHeaderChanged = () => {
            widget.classList.toggle('dynaheader', toggleDynaHeader.checked);
            updateTagDef();
        };
        const hideAlbumsChanged = () => {
            widget.classList.toggle('no-albums', toggleHideAlbums.checked);
            updateTagDef();
        };
        const noScrollChanged = () => {
            widget.classList.toggle('no-scroll', toggleNoScroll.checked);
            updateTagDef();
        }
        const userChanged = () => {
            const username = usernameInput.value?.trim();
            if (username.length) {
                widget.removeAttribute('backend');
                widget.setAttribute('user', username);
            } else {
                widget.removeAttribute('user');
                widget.setAttribute('backend', '/proxy-api');
            }
            // updateTagDef() will be called from stateChangeHandler()
        };
        const apiKeyChanged = () => {
            const apiKey = apiKeyInput.value?.trim();
            if (apiKey?.length) {
                widget.setAttribute('apikey', apiKey);
            } else {
                widget.removeAttribute('apikey');
            }
            // updateTagDef() will be called from stateChangeHandler()
        };
        if (widget) {
            stopButton?.addEventListener('click', () => {
                widget.stopUpdating()
            });
            incIntervalButton?.addEventListener('click', () => {
                widget.setAttribute('interval', Number(widget.state.interval) + 5);
            });
            toggleDynaHeader?.addEventListener('change', dynaHeaderChanged);
            toggleHideAlbums?.addEventListener('change', hideAlbumsChanged);
            toggleNoScroll?.addEventListener('change', noScrollChanged);
            usernameInput?.addEventListener('change', userChanged);
            apiKeyInput?.addEventListener('change', apiKeyChanged);
            new ResizeObserver(handleResizedWidget).observe(widget);

            // init
            userChanged();
            apiKeyChanged();
            dynaHeaderChanged();
            hideAlbumsChanged();
            noScrollChanged();
        }
    },
    false
);
