
function styleDefString(width, height) {
    return `lastfm-tracks {\n  box-sizing: border-box;\n  border: 1px solid #000;\n  width: ${width}px;\n  height: ${height}px;\n}`;
}

/**
 * Throttles the execution of a given function by a specified interval.
 *
 * @param {Function} func - The function to throttle.
 * @param {number} interval - The interval in milliseconds.
 * @returns {Function} - The throttled function.
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
 * @param {Function} func - The function to be debounced.
 * @param {number} delay - The delay time in milliseconds.
 * @returns {Function} - The debounced function.
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
 * ResizeObserverCallback function
 * @param {ResizeObserverEntry[]} [roea] - ResizeObserverEntry Array
 */
function updateStyleDef(roea) {
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

window.addEventListener(
    'DOMContentLoaded',
    function () {  // TODO run when widget is inserted...
        const widget = document.querySelector('lastfm-tracks');
        const stopButton = document.querySelector('button');
        const toggleDynaHeader = document.querySelector('input.dynaheader');
        const toggleHideAlbums = document.querySelector('input.hidealbums');
        const dynaHeaderChanged = () => {
            widget.classList.toggle('dynaheader', toggleDynaHeader.checked);
            updateTagDef();
        }
        const hideAlbumsChanged = () => {
            widget.classList.toggle('no-albums', toggleHideAlbums.checked);
            updateTagDef();
        }
        if (widget) {
            stopButton?.addEventListener('click', () => {
                widget.stopUpdating()
            });
            toggleDynaHeader?.addEventListener('change', dynaHeaderChanged);
            toggleHideAlbums?.addEventListener('change', hideAlbumsChanged);
            new ResizeObserver(handleResizedWidget).observe(widget);

            // init
            dynaHeaderChanged();
            hideAlbumsChanged();
        }
    },
    false
);
