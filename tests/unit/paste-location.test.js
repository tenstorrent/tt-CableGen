/**
 * Unit tests for location-mode paste: destination from selection, modal destination
 * parsing, and paste placement (shelves under correct rack with correct location data).
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createHeadlessCyWithStyleMock } from '../cytoscape-test-helper.js';
import { VisualizerState } from '../../static/js/state/visualizer-state.js';
import { LocationModule } from '../../static/js/modules/location.js';
import { CommonModule } from '../../static/js/modules/common.js';
import { NodeFactory } from '../../static/js/factories/node-factory.js';
import { UIDisplayModule } from '../../static/js/modules/ui-display.js';
import { copySelection } from '../../static/js/utils/copy-paste.js';

// Real Cytoscape (headless) for graph operations
let state;
let locationModule;
let commonModule;
let nodeFactory;
let originalDocument;

function createLocationGraph(cy, options = {}) {
    const { hall = 'SC_Floor_5', aisle = 'A', numRacks = 2, shelvesPerRack = 2 } = options;
    const elements = [];
    for (let r = 1; r <= numRacks; r++) {
        const rackId = `rack_${hall}_${aisle}_${r}`;
        elements.push({
            group: 'nodes',
            data: {
                id: rackId,
                type: 'rack',
                hall,
                aisle,
                rack_num: r,
                label: `Rack ${r} (${hall}-${aisle})`
            }
        });
        for (let s = 0; s < shelvesPerRack; s++) {
            const shelfId = `${r === 1 ? s : shelvesPerRack + s}`;
            elements.push({
                group: 'nodes',
                data: {
                    id: shelfId,
                    type: 'shelf',
                    parent: rackId,
                    hall,
                    aisle,
                    rack_num: r,
                    shelf_u: (s + 1) * 4,
                    host_index: parseInt(shelfId, 10),
                    label: `Shelf ${(s + 1) * 4} (${shelfId})`,
                    shelf_node_type: 'WH_GALAXY',
                    hostname: `host-${shelfId}`
                }
            });
        }
    }
    cy.add(elements);
    return elements;
}

describe('Location mode paste', () => {
    beforeEach(() => {
        state = new VisualizerState();
        nodeFactory = new NodeFactory(state);
        commonModule = new CommonModule(state, nodeFactory);
        locationModule = new LocationModule(state, commonModule);
        state.cy = createHeadlessCyWithStyleMock([]);
        state.mode = 'location';
        state.data.initialMode = 'location';
        state.data.globalHostCounter = 0;

        originalDocument = global.document;
        if (document.body) {
            const pasteModalIds = ['hallNames', 'aisleNames', 'rackNumbers', 'shelfUnitNumbers'];
            pasteModalIds.forEach((id) => {
                let el = document.getElementById(id);
                if (!el) {
                    el = document.createElement('input');
                    el.id = id;
                    el.setAttribute('type', 'text');
                    document.body.appendChild(el);
                }
                el.value = '';
            });
        }
    });

    afterEach(() => {
        global.document = originalDocument;
    });

    describe('getPasteDestinationFromSelection (modal context)', () => {
        test('returns canvas when nothing is selected', () => {
            createLocationGraph(state.cy, { numRacks: 1, shelvesPerRack: 1 });
            const dest = locationModule.getPasteDestinationFromSelection();
            expect(dest).not.toBeNull();
            expect(dest.type).toBe('canvas');
            expect(dest.label).toContain('Canvas');
        });

        test('returns rack context when a rack is selected', () => {
            createLocationGraph(state.cy, { hall: 'H1', aisle: 'A1', numRacks: 2, shelvesPerRack: 1 });
            const rack2 = state.cy.getElementById('rack_H1_A1_2');
            rack2.select();
            const dest = locationModule.getPasteDestinationFromSelection();
            expect(dest).not.toBeNull();
            expect(dest.type).toBe('rack');
            expect(dest.hall).toBe('H1');
            expect(dest.aisle).toBe('A1');
            expect(dest.rack_num).toBe(2);
            expect(dest.label).toContain('Rack');
            expect(dest.label).toContain('2');
        });

        test('returns shelf context when a shelf is selected', () => {
            createLocationGraph(state.cy, { hall: 'H2', aisle: 'A2', numRacks: 1, shelvesPerRack: 2 });
            state.cy.getElementById('0').select();
            const dest = locationModule.getPasteDestinationFromSelection();
            expect(dest).not.toBeNull();
            expect(dest.type).toBe('shelf');
            expect(dest.hall).toBe('H2');
            expect(dest.aisle).toBe('A2');
            expect(dest.rack_num).toBe(1);
        });

        test('returns first selected location when multiple selected (rack before shelf)', () => {
            createLocationGraph(state.cy, { numRacks: 2, shelvesPerRack: 1 });
            state.cy.getElementById('rack_SC_Floor_5_A_1').select();
            state.cy.getElementById('0').select();
            const dest = locationModule.getPasteDestinationFromSelection();
            expect(dest.type).toBe('rack');
            expect(dest.rack_num).toBe(1);
        });
    });

    describe('Modal destination parsing (_parsePasteDestinationInputs)', () => {
        test('parsed destination reflects rack context when paste target is a rack', () => {
            createLocationGraph(state.cy, { numRacks: 1, shelvesPerRack: 1 });
            const notificationManager = { show: jest.fn() };
            const statusManager = { show: jest.fn() };
            const uiModule = new UIDisplayModule(
                state,
                commonModule,
                locationModule,
                {},
                notificationManager,
                statusManager
            );
            uiModule._pasteDestinationContext = {
                type: 'rack',
                hall: 'SC_Floor_5',
                aisle: 'A',
                rack_num: 3,
                label: 'Rack 3 (SC_Floor_5-A)'
            };
            const rackEl = document.getElementById('rackNumbers');
            const shelfEl = document.getElementById('shelfUnitNumbers');
            if (rackEl) rackEl.value = '3';
            if (shelfEl) shelfEl.value = '1,2';

            const destination = uiModule._parsePasteDestinationInputs();

            expect(destination.hall).toBe('SC_Floor_5');
            expect(destination.aisle).toBe('A');
            expect(destination.rack_num).toBe(3);
            expect(destination.rack_numbers).toEqual([3]);
            expect(destination.shelf_u_list).toEqual([1, 2]);
        });

        test('parsed destination uses inputs when context is canvas (hall/aisle empty, rack from input)', () => {
            state.clipboard = {
                mode: 'location',
                shelves: [{ hall: 'ClipHall', aisle: 'ClipAisle', rack_num: 1, shelf_u: 1 }],
                copyLevel: 'shelf',
                copyHall: 'ClipHall',
                copyAisle: 'ClipAisle',
                copyRackNum: 1
            };
            const notificationManager = { show: jest.fn() };
            const statusManager = { show: jest.fn() };
            const uiModule = new UIDisplayModule(
                state,
                commonModule,
                locationModule,
                {},
                notificationManager,
                statusManager
            );
            uiModule._pasteDestinationContext = { type: 'canvas', label: 'Canvas (no destination selected)' };
            const hallEl = document.getElementById('hallNames');
            const aisleEl = document.getElementById('aisleNames');
            const rackEl = document.getElementById('rackNumbers');
            if (hallEl) hallEl.value = '';
            if (aisleEl) aisleEl.value = '';
            if (rackEl) rackEl.value = '2';

            const destination = uiModule._parsePasteDestinationInputs();

            expect(destination.hall).toBe('');
            expect(destination.aisle).toBe('');
            expect(destination.rack_num).toBe(2);
            expect(destination.rack_numbers).toEqual([2]);
        });
    });

    describe('Paste placement (pasteFromClipboard)', () => {
        test('pasted shelves are under the specified rack with correct hall/aisle/rack_num', () => {
            createLocationGraph(state.cy, { hall: 'SC_Floor_5', aisle: 'A', numRacks: 2, shelvesPerRack: 2 });
            state.data.globalHostCounter = 4;

            state.clipboard = {
                mode: 'location',
                shelves: [
                    { hall: 'SC_Floor_5', aisle: 'A', rack_num: 1, shelf_u: 4, shelf_node_type: 'WH_GALAXY', hostname: 'copy1' },
                    { hall: 'SC_Floor_5', aisle: 'A', rack_num: 1, shelf_u: 8, shelf_node_type: 'WH_GALAXY', hostname: 'copy2' }
                ],
                connections: []
            };

            const destination = {
                hall: 'SC_Floor_5',
                aisle: 'A',
                rack_num: 3,
                rack_numbers: [3],
                shelf_assignments: [
                    { rack_num: 3, shelf_u: 1 },
                    { rack_num: 3, shelf_u: 2 }
                ]
            };

            const result = locationModule.pasteFromClipboard(destination);

            expect(result.success).toBe(true);
            const rack3Id = 'rack_SC_Floor_5_A_3';
            const rack3 = state.cy.getElementById(rack3Id);
            expect(rack3.length).toBe(1);
            const shelvesInRack3 = rack3.children('[type="shelf"]');
            expect(shelvesInRack3.length).toBe(2);
            shelvesInRack3.forEach((shelf) => {
                expect(shelf.data('hall')).toBe('SC_Floor_5');
                expect(shelf.data('aisle')).toBe('A');
                expect(shelf.data('rack_num')).toBe(3);
                expect(shelf.parent().id()).toBe(rack3Id);
            });
        });

        test('pasting into existing rack adds shelves as children of that rack', () => {
            createLocationGraph(state.cy, { hall: 'H', aisle: 'A', numRacks: 1, shelvesPerRack: 1 });
            state.data.globalHostCounter = 1;

            state.clipboard = {
                mode: 'location',
                shelves: [
                    { hall: 'H', aisle: 'A', rack_num: 1, shelf_u: 4, shelf_node_type: 'WH_GALAXY', hostname: 'pasted' }
                ],
                connections: []
            };

            const destination = {
                hall: 'H',
                aisle: 'A',
                rack_num: 1,
                rack_numbers: [1],
                shelf_assignments: [{ rack_num: 1, shelf_u: 8 }]
            };

            const result = locationModule.pasteFromClipboard(destination);

            expect(result.success).toBe(true);
            const rack1 = state.cy.getElementById('rack_H_A_1');
            expect(rack1.length).toBe(1);
            const shelves = rack1.children('[type="shelf"]');
            expect(shelves.length).toBe(2);
            const pastedShelf = shelves.filter(s => s.data('shelf_u') === 8);
            expect(pastedShelf.length).toBe(1);
            expect(pastedShelf.data('hall')).toBe('H');
            expect(pastedShelf.data('rack_num')).toBe(1);
        });

        test('copy then paste: destination from selection matches pasted placement', () => {
            createLocationGraph(state.cy, { hall: 'SC_Floor_5', aisle: 'A', numRacks: 2, shelvesPerRack: 2 });
            state.data.globalHostCounter = 4;

            state.cy.getElementById('rack_SC_Floor_5_A_2').select();
            const copyResult = copySelection(state);
            expect(copyResult.success).toBe(true);
            expect(state.clipboard.shelves.length).toBe(2);
            expect(state.clipboard.copyLevel).toBe('rack');

            state.cy.getElementById('rack_SC_Floor_5_A_2').unselect();
            state.cy.getElementById('rack_SC_Floor_5_A_1').select();
            const destContext = locationModule.getPasteDestinationFromSelection();
            expect(destContext.type).toBe('rack');
            expect(destContext.rack_num).toBe(1);

            const destination = {
                hall: destContext.hall,
                aisle: destContext.aisle,
                rack_num: destContext.rack_num,
                rack_numbers: [destContext.rack_num],
                shelf_assignments: state.clipboard.shelves.map((s, i) => ({
                    rack_num: destContext.rack_num,
                    shelf_u: (i + 1) * 4
                }))
            };

            const pasteResult = locationModule.pasteFromClipboard(destination);
            expect(pasteResult.success).toBe(true);

            const rack1 = state.cy.getElementById('rack_SC_Floor_5_A_1');
            const shelvesInRack1 = rack1.children('[type="shelf"]');
            expect(shelvesInRack1.length).toBe(4);
        });
    });
});
