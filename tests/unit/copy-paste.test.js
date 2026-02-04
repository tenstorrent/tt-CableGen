/**
 * Unit tests for copy-paste utilities (location and hierarchy mode).
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import {
    getSelectedShelfNodes,
    getConnectionsWithinSelection,
    getSelectedHierarchyNodes,
    copySelection,
    hasClipboard
} from '../../static/js/utils/copy-paste.js';
import { createHeadlessCy } from '../cytoscape-test-helper.js';

describe('copy-paste', () => {
    describe('getSelectedShelfNodes', () => {
        test('returns empty array when cy is null', () => {
            expect(getSelectedShelfNodes(null)).toEqual([]);
        });

        test('returns empty array when nothing selected', () => {
            const elements = [
                { data: { id: 'rack_1', type: 'rack' } },
                { data: { id: '0', type: 'shelf', parent: 'rack_1', hall: 'H', aisle: 'A', rack_num: 1, shelf_u: 1 } }
            ];
            const cy = createHeadlessCy(elements);
            expect(getSelectedShelfNodes(cy)).toEqual([]);
        });

        test('returns single shelf when shelf node is selected', () => {
            const elements = [
                { data: { id: 'rack_1', type: 'rack' } },
                { data: { id: '0', type: 'shelf', parent: 'rack_1', hall: 'H', aisle: 'A', rack_num: 1, shelf_u: 1 } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('0').select();
            const shelves = getSelectedShelfNodes(cy);
            expect(shelves).toHaveLength(1);
            expect(shelves[0].id()).toBe('0');
        });

        test('returns shelf when tray under shelf is selected', () => {
            const elements = [
                { data: { id: 'rack_1', type: 'rack' } },
                { data: { id: '0', type: 'shelf', parent: 'rack_1' } },
                { data: { id: '0:t1', type: 'tray', parent: '0' } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('0:t1').select();
            const shelves = getSelectedShelfNodes(cy);
            expect(shelves).toHaveLength(1);
            expect(shelves[0].id()).toBe('0');
        });

        test('returns shelf when port under shelf is selected', () => {
            const elements = [
                { data: { id: 'rack_1', type: 'rack' } },
                { data: { id: '0', type: 'shelf', parent: 'rack_1' } },
                { data: { id: '0:t1', type: 'tray', parent: '0' } },
                { data: { id: '0:t1:p1', type: 'port', parent: '0:t1', tray: 1, port: 1 } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('0:t1:p1').select();
            const shelves = getSelectedShelfNodes(cy);
            expect(shelves).toHaveLength(1);
            expect(shelves[0].id()).toBe('0');
        });

        test('returns all descendant shelves when rack is selected', () => {
            const elements = [
                { data: { id: 'rack_1', type: 'rack' } },
                { data: { id: '0', type: 'shelf', parent: 'rack_1' } },
                { data: { id: '1', type: 'shelf', parent: 'rack_1' } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('rack_1').select();
            const shelves = getSelectedShelfNodes(cy);
            expect(shelves).toHaveLength(2);
            expect(shelves.map(s => s.id()).sort()).toEqual(['0', '1']);
        });

        test('deduplicates shelves when multiple nodes of same shelf selected', () => {
            const elements = [
                { data: { id: 'rack_1', type: 'rack' } },
                { data: { id: '0', type: 'shelf', parent: 'rack_1' } },
                { data: { id: '0:t1', type: 'tray', parent: '0' } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('0').select();
            cy.getElementById('0:t1').select();
            const shelves = getSelectedShelfNodes(cy);
            expect(shelves).toHaveLength(1);
        });
    });

    describe('getConnectionsWithinSelection', () => {
        test('returns empty array when cy is null', () => {
            expect(getConnectionsWithinSelection(null, new Set())).toEqual([]);
        });

        test('returns edges where both endpoints in nodeIds', () => {
            const elements = [
                { data: { id: 'a', type: 'shelf' } },
                { data: { id: 'b', type: 'shelf' } },
                { data: { id: 'c', type: 'shelf' } },
                { data: { id: 'e1', source: 'a', target: 'b' } },
                { data: { id: 'e2', source: 'b', target: 'c' } },
                { data: { id: 'e3', source: 'a', target: 'c' } }
            ];
            const cy = createHeadlessCy(elements);
            const nodeIds = new Set(['a', 'b']);
            const edges = getConnectionsWithinSelection(cy, nodeIds);
            expect(edges).toHaveLength(1);
            expect(edges[0].data('source')).toBe('a');
            expect(edges[0].data('target')).toBe('b');
        });

        test('returns empty when no edges within set', () => {
            const elements = [
                { data: { id: 'a', type: 'shelf' } },
                { data: { id: 'b', type: 'shelf' } },
                { data: { id: 'e1', source: 'a', target: 'b' } }
            ];
            const cy = createHeadlessCy(elements);
            const nodeIds = new Set(['a']);
            expect(getConnectionsWithinSelection(cy, nodeIds)).toHaveLength(0);
        });
    });

    describe('getSelectedHierarchyNodes', () => {
        test('returns empty roots and allNodes when cy is null', () => {
            expect(getSelectedHierarchyNodes(null)).toEqual({ roots: [], allNodes: [] });
        });

        test('returns empty when nothing selected', () => {
            const elements = [
                { data: { id: 'graph_0', type: 'graph' } },
                { data: { id: '0', type: 'shelf', parent: 'graph_0' } }
            ];
            const cy = createHeadlessCy(elements);
            expect(getSelectedHierarchyNodes(cy)).toEqual({ roots: [], allNodes: [] });
        });

        test('returns single graph as root with itself in allNodes when graph selected', () => {
            const elements = [
                { data: { id: 'graph_0', type: 'graph', template_name: 'root' } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('graph_0').select();
            const { roots, allNodes } = getSelectedHierarchyNodes(cy);
            expect(roots).toHaveLength(1);
            expect(roots[0].id()).toBe('graph_0');
            expect(allNodes).toHaveLength(1);
        });

        test('returns graph and subtree when graph selected', () => {
            const elements = [
                { data: { id: 'graph_0', type: 'graph' } },
                { data: { id: 's1', type: 'shelf', parent: 'graph_0', child_name: 's1' } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('graph_0').select();
            const { roots, allNodes } = getSelectedHierarchyNodes(cy);
            expect(roots).toHaveLength(1);
            expect(allNodes).toHaveLength(2);
            const ids = allNodes.map(n => n.id()).sort();
            expect(ids).toEqual(['graph_0', 's1']);
        });

        test('returns shelf as root when shelf selected (no parent selected)', () => {
            const elements = [
                { data: { id: 'graph_0', type: 'graph' } },
                { data: { id: 's1', type: 'shelf', parent: 'graph_0' } }
            ];
            const cy = createHeadlessCy(elements);
            cy.getElementById('s1').select();
            const { roots, allNodes } = getSelectedHierarchyNodes(cy);
            expect(roots).toHaveLength(1);
            expect(roots[0].id()).toBe('s1');
            expect(allNodes).toHaveLength(1);
        });
    });

    describe('copySelection', () => {
        test('returns failure when state.cy is null', () => {
            const result = copySelection({ cy: null, mode: 'location' });
            expect(result.success).toBe(false);
            expect(result.message).toContain('No graph loaded');
        });

        test('returns failure when mode is not location or hierarchy', () => {
            const cy = createHeadlessCy([]);
            const result = copySelection({ cy, mode: 'other' });
            expect(result.success).toBe(false);
            expect(result.message).toContain('location or hierarchy');
        });

        describe('location mode', () => {
            test('returns failure when nothing selected', () => {
                const elements = [
                    { data: { id: 'rack_1', type: 'rack' } },
                    { data: { id: '0', type: 'shelf', parent: 'rack_1', hall: 'H', aisle: 'A', rack_num: 1, shelf_u: 1 } }
                ];
                const cy = createHeadlessCy(elements);
                const result = copySelection({ cy, mode: 'location', clipboard: null });
                expect(result.success).toBe(false);
                expect(result.message).toMatch(/select one or more shelves/i);
            });

            test('copies selected shelf and sets clipboard', () => {
                const elements = [
                    { data: { id: 'rack_1', type: 'rack' } },
                    {
                        data: {
                            id: '0',
                            type: 'shelf',
                            parent: 'rack_1',
                            hall: 'H',
                            aisle: 'A',
                            rack_num: 1,
                            shelf_u: 1,
                            label: 'Shelf 1',
                            shelf_node_type: 'WH_GALAXY',
                            hostname: 'host0'
                        }
                    }
                ];
                const cy = createHeadlessCy(elements);
                cy.getElementById('0').select();
                const state = { cy, mode: 'location', clipboard: null };
                const result = copySelection(state);
                expect(result.success).toBe(true);
                expect(state.clipboard).toBeDefined();
                expect(state.clipboard.mode).toBe('location');
                expect(state.clipboard.shelves).toHaveLength(1);
                expect(state.clipboard.shelves[0].hall).toBe('H');
                expect(state.clipboard.shelves[0].rack_num).toBe(1);
                expect(state.clipboard.copyLevel).toBe('shelf');
            });

            test('sets copyLevel to rack when only rack selected', () => {
                const elements = [
                    { data: { id: 'rack_1', type: 'rack' } },
                    { data: { id: '0', type: 'shelf', parent: 'rack_1', hall: 'H', aisle: 'A', rack_num: 1, shelf_u: 1 } }
                ];
                const cy = createHeadlessCy(elements);
                cy.getElementById('rack_1').select();
                const state = { cy, mode: 'location', clipboard: null };
                const result = copySelection(state);
                expect(result.success).toBe(true);
                expect(state.clipboard.copyLevel).toBe('rack');
                expect(state.clipboard.shelves).toHaveLength(1);
            });
        });

        describe('hierarchy mode', () => {
            test('returns failure when nothing selected', () => {
                const elements = [
                    { data: { id: 'graph_0', type: 'graph' } },
                    { data: { id: 's1', type: 'shelf', parent: 'graph_0' } }
                ];
                const cy = createHeadlessCy(elements);
                const result = copySelection({ cy, mode: 'hierarchy', clipboard: null });
                expect(result.success).toBe(false);
                expect(result.message).toMatch(/select one or more graph/i);
            });

            test('copies selected graph and sets hierarchy clipboard', () => {
                const elements = [
                    { data: { id: 'graph_0', type: 'graph', template_name: 'root', label: 'Root' } },
                    { data: { id: 's1', type: 'shelf', parent: 'graph_0', child_name: 's1', label: 's1' } }
                ];
                const cy = createHeadlessCy(elements);
                cy.getElementById('graph_0').select();
                const state = { cy, mode: 'hierarchy', clipboard: null };
                const result = copySelection(state);
                expect(result.success).toBe(true);
                expect(state.clipboard.mode).toBe('hierarchy');
                expect(state.clipboard.nodes).toBeDefined();
                expect(state.clipboard.nodes.length).toBe(2);
                expect(state.clipboard.connections).toBeDefined();
                const nodeIds = state.clipboard.nodes.map(n => n.id).sort();
                expect(nodeIds).toEqual(['graph_0', 's1']);
            });
        });
    });

    describe('hasClipboard', () => {
        test('returns false when state.clipboard is null', () => {
            expect(hasClipboard({ clipboard: null })).toBe(false);
        });

        test('returns false when clipboard has no shelves (location)', () => {
            expect(hasClipboard({ clipboard: { mode: 'location', shelves: [] } })).toBe(false);
        });

        test('returns true when clipboard has shelves (location)', () => {
            expect(hasClipboard({ clipboard: { mode: 'location', shelves: [{ id: 1 }] } })).toBe(true);
        });

        test('returns false when clipboard has no nodes (hierarchy)', () => {
            expect(hasClipboard({ clipboard: { mode: 'hierarchy', nodes: [] } })).toBe(false);
        });

        test('returns true when clipboard has nodes (hierarchy)', () => {
            expect(hasClipboard({ clipboard: { mode: 'hierarchy', nodes: [{ id: 'g1' }] } })).toBe(true);
        });
    });
});
