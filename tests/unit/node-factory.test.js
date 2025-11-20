/**
 * Tests for NodeFactory
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { NodeFactory } from '../../static/js/factories/node-factory.js';
import { VisualizerState } from '../../static/js/state/visualizer-state.js';

describe('NodeFactory', () => {
    let state, factory;

    beforeEach(() => {
        state = new VisualizerState();
        factory = new NodeFactory(state);
    });

    test('createShelf uses descriptor format for ID', () => {
        const result = factory.createShelf({
            hostIndex: 5,
            label: 'Test Shelf',
            nodeType: 'N300_LB'
        });

        expect(result.shelf.data.id).toBe('5');
        expect(result.shelf.data.type).toBe('shelf');
        expect(result.shelf.data.host_index).toBe(5);
    });

    test('createShelf auto-increments hostIndex', () => {
        state.data.globalHostCounter = 10;

        factory.createShelf({
            label: 'Test Shelf',
            nodeType: 'N300_LB'
        });

        expect(state.data.globalHostCounter).toBe(11);
    });

    test('createShelf creates trays and ports by default', () => {
        const result = factory.createShelf({
            hostIndex: 0,
            label: 'Test Shelf',
            nodeType: 'N300_LB'
        });

        // N300_LB has 4 trays, 2 ports per tray = 8 ports total
        expect(result.children.length).toBe(12); // 4 trays + 8 ports
        expect(result.children.filter(n => n.data.type === 'tray').length).toBe(4);
        expect(result.children.filter(n => n.data.type === 'port').length).toBe(8);
    });

    test('createShelf can skip children creation', () => {
        const result = factory.createShelf({
            hostIndex: 0,
            label: 'Test Shelf',
            nodeType: 'N300_LB',
            createChildren: false
        });

        expect(result.children.length).toBe(0);
    });

    test('createShelf throws error for invalid node type', () => {
        expect(() => {
            factory.createShelf({
                nodeType: 'INVALID_TYPE',
                label: 'Test'
            });
        }).toThrow('Invalid node type');
    });

    test('createTraysAndPorts creates correct number of nodes', () => {
        const nodes = factory.createTraysAndPorts('0', 0, 'N300_LB');

        // 4 trays + (4 * 2 ports) = 12 nodes
        expect(nodes.length).toBe(12);
    });

    test('createTraysAndPorts uses descriptor format for IDs', () => {
        const nodes = factory.createTraysAndPorts('0', 0, 'N300_LB');

        const tray = nodes.find(n => n.data.type === 'tray' && n.data.tray === 1);
        expect(tray.data.id).toBe('0:t1');

        const port = nodes.find(n => n.data.type === 'port' && n.data.tray === 1 && n.data.port === 1);
        expect(port.data.id).toBe('0:t1:p1');
    });

    test('createTraysAndPorts propagates location data', () => {
        const location = {
            hall: '120',
            aisle: 'A',
            rack_num: 1,
            shelf_u: 2
        };

        const nodes = factory.createTraysAndPorts('0', 0, 'N300_LB', location);

        const tray = nodes.find(n => n.data.type === 'tray');
        expect(tray.data.hall).toBe('120');
        expect(tray.data.aisle).toBe('A');
        expect(tray.data.rack_num).toBe(1);
        expect(tray.data.shelf_u).toBe(2);

        const port = nodes.find(n => n.data.type === 'port');
        expect(port.data.hall).toBe('120');
    });

    test('createGraph creates graph node', () => {
        const graph = factory.createGraph({
            id: 'graph1',
            label: 'My Graph',
            templateName: 'my_template'
        });

        expect(graph.data.id).toBe('graph1');
        expect(graph.data.type).toBe('graph');
        expect(graph.data.template_name).toBe('my_template');
        expect(graph.data.label).toBe('My Graph');
    });

    test('createRack creates rack node', () => {
        const rack = factory.createRack({
            rackNum: 1,
            hall: '120',
            aisle: 'A'
        });

        expect(rack.data.type).toBe('rack');
        expect(rack.data.rack_num).toBe(1);
        expect(rack.data.hall).toBe('120');
        expect(rack.data.aisle).toBe('A');
        expect(rack.data.id).toContain('rack_');
    });
});

