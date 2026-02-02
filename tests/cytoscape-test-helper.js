/**
 * Shared helper for Cytoscape headless usage in tests
 *
 * Use real Cytoscape.js in Node/Jest with headless: true (no DOM/canvas).
 * Import in unit or integration tests and call createHeadlessCy() to get
 * a real cy instance; use ensureStyleMock(cy) when the code under test
 * calls cy.style() and headless doesn't provide it.
 *
 * Usage (unit test, tests/unit/foo.test.js):
 *   import { createHeadlessCy, createHeadlessCyWithStyleMock, createMinimalElements } from '../cytoscape-test-helper.js';
 *   state.cy = createHeadlessCy(elements);
 *   // or with style mock: state.cy = createHeadlessCyWithStyleMock([]);
 *
 * Usage (integration test, tests/integration/bar.test.js):
 *   import { createHeadlessCyWithStyleMock, cytoscape } from '../cytoscape-test-helper.js';
 *   global.cytoscape = cytoscape;  // if app code expects global
 *   state.cy = createHeadlessCyWithStyleMock([]);
 */

import cytoscape from 'cytoscape';

/**
 * Create a Cytoscape instance in headless mode for tests
 * @param {Array} elements - Nodes and edges (Cytoscape element format)
 * @param {Object} options - Extra options passed to cytoscape()
 * @returns {Object} Cytoscape instance (real API: nodes(), edges(), layout(), etc.)
 */
export function createHeadlessCy(elements = [], options = {}) {
    return cytoscape({
        headless: true,
        styleEnabled: options.styleEnabled !== undefined ? options.styleEnabled : false,
        elements,
        ...options
    });
}

/**
 * Ensure cy has a working style() method for headless mode
 * Some code paths call cy.style() or element.style(); in headless mode
 * that may be missing or behave differently. Call this after createHeadlessCy
 * when the test hits such code.
 * @param {Object} cy - Cytoscape instance from createHeadlessCy
 * @returns {Object} cy (same instance, possibly patched)
 */
export function ensureStyleMock(cy) {
    if (!cy) return cy;
    const hasJest = typeof jest !== 'undefined' && typeof jest.fn === 'function';
    const mockFn = hasJest ? jest.fn(() => ({ update: jest.fn() })) : () => ({ update: () => { } });

    if (!cy.style || typeof cy.style !== 'function') {
        cy.style = mockFn;
        return cy;
    }

    try {
        const originalStyle = cy.style.bind(cy);
        const wrapped = function style(...args) {
            const styleObj = originalStyle(...args);
            if (!styleObj || typeof styleObj.update !== 'function') {
                return { update: hasJest ? jest.fn() : () => { } };
            }
            return styleObj;
        };
        if (hasJest) {
            cy.style = jest.fn(wrapped);
        } else {
            cy.style = wrapped;
        }
    } catch (_) {
        cy.style = mockFn;
    }
    return cy;
}

/**
 * Create a headless Cytoscape instance with optional style mock
 * @param {Array} elements - Nodes and edges
 * @param {Object} options - { mockStyle: boolean, ...cytoscapeOptions }
 * @returns {Object} Cytoscape instance
 */
export function createHeadlessCyWithStyleMock(elements = [], options = {}) {
    const { mockStyle = true, ...cyOptions } = options;
    const cy = createHeadlessCy(elements, cyOptions);
    if (mockStyle) {
        ensureStyleMock(cy);
    }
    return cy;
}

/**
 * Minimal element set: one graph node and two shelf nodes (no edges)
 * Useful for tests that need state.cy to exist with some structure
 * @returns {Array} Cytoscape elements
 */
export function createMinimalElements() {
    return [
        { data: { id: 'graph_0', type: 'graph', template_name: 'root' } },
        { data: { id: '0', type: 'shelf', host_index: 0, hostname: 'host0', label: 'host0' } },
        { data: { id: '1', type: 'shelf', host_index: 1, hostname: 'host1', label: 'host1' } }
    ];
}

/**
 * Minimal elements with one edge (for tests that need connections)
 * @returns {Array} Cytoscape elements
 */
export function createMinimalElementsWithEdge() {
    return [
        ...createMinimalElements(),
        { data: { id: 'e1', source: '0', target: '1' } }
    ];
}

export { cytoscape };
