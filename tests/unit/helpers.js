/**
 * Shared helpers for unit tests
 * Use for DOM setup/teardown and console mocking to reduce duplication.
 */

/**
 * Create an element with id, append to document.body, and return it.
 * Caller is responsible for removing in afterEach (see removeDomElement).
 * @param {string} id - Element id
 * @param {string} [tagName='div'] - Tag name
 * @returns {HTMLElement}
 */
export function createDomElement(id, tagName = 'div') {
    const el = document.createElement(tagName);
    el.id = id;
    document.body.appendChild(el);
    return el;
}

/**
 * Remove element from DOM if it has a parent
 * @param {HTMLElement} el
 */
export function removeDomElement(el) {
    if (el && el.parentNode) {
        el.parentNode.removeChild(el);
    }
}

/**
 * Run fn with console method mocked, then restore
 * @param {string} method - 'log' | 'warn' | 'error'
 * @param {Function} fn - (mock) => void
 */
export function withConsoleMock(method, fn) {
    const original = console[method];
    const mock = typeof original === 'function' ? jest.spyOn(console, method).mockImplementation() : null;
    try {
        fn(mock);
    } finally {
        if (mock && mock.mockRestore) mock.mockRestore();
    }
}
