/**
 * Tests for cytoscape-utils
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { verifyCytoscapeExtensions } from '../../static/js/utils/cytoscape-utils.js';

describe('cytoscape-utils', () => {
    let consoleWarnSpy;
    let consoleLogSpy;

    beforeEach(() => {
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe('verifyCytoscapeExtensions', () => {
        test('warns and returns when state.cy is null', () => {
            verifyCytoscapeExtensions({ cy: null });
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '⚠ Cannot verify extensions: cytoscape instance not initialized'
            );
        });

        test('warns and returns when state is undefined (no cy)', () => {
            verifyCytoscapeExtensions({});
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '⚠ Cannot verify extensions: cytoscape instance not initialized'
            );
        });

        test('reports missing fcose when layout throws', () => {
            const state = {
                cy: {
                    layout: () => {
                        throw new Error('fcose not registered');
                    },
                    collection: () => ({})
                }
            };
            verifyCytoscapeExtensions(state);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '⚠ Missing cytoscape extensions:',
                'cytoscape-fcose'
            );
        });

        test('reports missing fcose when layout returns object without run', () => {
            const state = {
                cy: {
                    layout: () => ({}),
                    collection: () => ({})
                }
            };
            verifyCytoscapeExtensions(state);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '⚠ Missing cytoscape extensions:',
                'cytoscape-fcose'
            );
        });

        test('reports available fcose when layout has run function', () => {
            const state = {
                cy: {
                    layout: () => ({ run: () => {} }),
                    collection: () => ({})
                }
            };
            verifyCytoscapeExtensions(state);
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '✓ All cytoscape extensions are loaded and available'
            );
        });
    });
});
