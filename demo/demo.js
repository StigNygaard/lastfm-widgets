
function styleDefString(width, height) {
    return `
lastfm-tracks {
  box-sizing: border-box;
  border: 1px solid #000;
  width: ${width}px;
  height: ${height}px;
}`;
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
    const styling = document.querySelector(('.options pre'));
    const widget = document.querySelector('lastfm-tracks');
    if (styling && widget) {
        const { offsetWidth, offsetHeight } = widget;
        styling.textContent = styleDefString(offsetWidth, offsetHeight);
    }
}
/**
 * A "throttled" ResizeObserverCallback function
 */
const handleResizedWidget = throttle(updateStyleDef, 100);

window.addEventListener(
    'DOMContentLoaded',
    function () {  // TODO run when widget is inserted...
        const widget = document.querySelector('lastfm-tracks');
        const stopButton = document.querySelector('button');
        const toggleDynaHeader = document.querySelector('input.dynaheader');
        const toggleHideAlbums = document.querySelector('input.hidealbums');
        if (widget) {
            stopButton?.addEventListener('click', () => {
                widget.stopUpdating()
            });
            toggleDynaHeader?.addEventListener('change', () => {
                widget.classList.toggle('dynaheader', this.checked);
            });
            toggleHideAlbums?.addEventListener('change', () => {
                widget.classList.toggle('hide-albums', this.checked);
            });
            new ResizeObserver(handleResizedWidget).observe(widget);
        }
    },
    false
);
