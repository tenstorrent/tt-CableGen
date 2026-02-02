/**
 * Tests for ConnectionFactory
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { ConnectionFactory } from '../../static/js/factories/connection-factory.js';

describe('ConnectionFactory', () => {
    let state;
    let factory;

    beforeEach(() => {
        state = {
            getNextConnectionNumber: jest.fn(() => 1)
        };
        factory = new ConnectionFactory(state);
    });

    test('constructor stores state', () => {
        expect(factory.state).toBe(state);
    });

    test('createConnection throws when sourcePort missing', () => {
        expect(() =>
            factory.createConnection({ targetPort: { id: () => 'p2' } })
        ).toThrow('Both sourcePort and targetPort are required');
    });

    test('createConnection throws when targetPort missing', () => {
        expect(() =>
            factory.createConnection({ sourcePort: { id: () => 'p1' } })
        ).toThrow('Both sourcePort and targetPort are required');
    });

    test('createConnection uses getNextConnectionNumber from state', () => {
        state.getNextConnectionNumber.mockReturnValue(42);
        const result = factory.createConnection({
            sourcePort: { id: () => 'port_1' },
            targetPort: { id: () => 'port_2' }
        });
        expect(state.getNextConnectionNumber).toHaveBeenCalled();
        expect(result.data.connection_number).toBe(42);
        expect(result.data.id).toBe('connection_42');
    });

    test('createConnection accepts port ids as strings', () => {
        const result = factory.createConnection({
            sourcePort: 'port_1',
            targetPort: 'port_2'
        });
        expect(result.data.source).toBe('port_1');
        expect(result.data.target).toBe('port_2');
    });

    test('createConnection uses default cableType and cableLength', () => {
        const result = factory.createConnection({
            sourcePort: 'p1',
            targetPort: 'p2'
        });
        expect(result.data.cableType).toBe('QSFP_DD');
        expect(result.data.cableLength).toBe('Unknown');
    });

    test('createConnection uses provided cableType and cableLength', () => {
        const result = factory.createConnection({
            sourcePort: 'p1',
            targetPort: 'p2',
            cableType: 'DAC',
            cableLength: '2m'
        });
        expect(result.data.cableType).toBe('DAC');
        expect(result.data.cableLength).toBe('2m');
    });

    test('createConnection uses default color when not provided', () => {
        const result = factory.createConnection({
            sourcePort: 'p1',
            targetPort: 'p2'
        });
        expect(result.data.color).toBe('#999');
    });

    test('createConnection uses provided color', () => {
        const result = factory.createConnection({
            sourcePort: 'p1',
            targetPort: 'p2',
            color: '#ff0000'
        });
        expect(result.data.color).toBe('#ff0000');
    });

    test('createConnection includes template_name when provided', () => {
        const result = factory.createConnection({
            sourcePort: 'p1',
            targetPort: 'p2',
            templateName: 'my_template'
        });
        expect(result.data.template_name).toBe('my_template');
    });

    test('createConnection returns structure with data and classes', () => {
        const result = factory.createConnection({
            sourcePort: 'p1',
            targetPort: 'p2'
        });
        expect(result.data).toBeDefined();
        expect(result.data.id).toBe('connection_1');
        expect(result.data.source).toBe('p1');
        expect(result.data.target).toBe('p2');
        expect(result.classes).toBe('connection');
    });
});
