/**
 * Tests for configuration modules
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import {
    initializeNodeConfigs,
    getNodeConfig,
    isValidNodeType,
    getAllNodeTypes,
    getNodeDisplayName,
    getNodeColor,
    isVerticalLayout,
    getTotalPortCount
} from '../../static/js/config/node-types.js';

import {
    buildApiUrl,
    isSuccessStatus,
    isClientError,
    isServerError,
    getStatusMessage,
    API_ENDPOINTS,
    HTTP_STATUS
} from '../../static/js/config/api.js';

import {
    LAYOUT,
    ANIMATION,
    Z_INDEX,
    LIMITS,
    CYTOSCAPE_CONFIG
} from '../../static/js/config/constants.js';

describe('Node Type Configuration', () => {
    beforeEach(() => {
        // Reset to default configs before each test
        initializeNodeConfigs();
    });

    test('getNodeConfig returns config for valid node type', () => {
        const config = getNodeConfig('N300_LB');
        expect(config).toBeDefined();
        expect(config.tray_count).toBe(4);
        expect(config.ports_per_tray).toBe(2);
        expect(config.tray_layout).toBe('horizontal');
    });

    test('getNodeConfig handles _DEFAULT suffix', () => {
        const config1 = getNodeConfig('N300_LB_DEFAULT');
        const config2 = getNodeConfig('N300_LB');
        expect(config1).toEqual(config2);
    });

    test('getNodeConfig returns null for invalid type', () => {
        const config = getNodeConfig('INVALID_TYPE');
        expect(config).toBeNull();
    });

    test('isValidNodeType returns true for valid types', () => {
        expect(isValidNodeType('N300_LB')).toBe(true);
        expect(isValidNodeType('WH_GALAXY')).toBe(true);
        expect(isValidNodeType('N300_LB_DEFAULT')).toBe(true);
    });

    test('isValidNodeType returns false for invalid types', () => {
        expect(isValidNodeType('INVALID_TYPE')).toBe(false);
        expect(isValidNodeType('')).toBe(false);
        expect(isValidNodeType(null)).toBe(false);
    });

    test('getAllNodeTypes returns all available types', () => {
        const types = getAllNodeTypes();
        expect(Array.isArray(types)).toBe(true);
        expect(types.length).toBeGreaterThan(0);
        expect(types).toContain('N300_LB');
        expect(types).toContain('WH_GALAXY');
    });

    test('getNodeDisplayName returns display name', () => {
        const name = getNodeDisplayName('N300_LB');
        expect(name).toBe('N300 LB');
    });

    test('getNodeDisplayName returns node type if not found', () => {
        const name = getNodeDisplayName('UNKNOWN');
        expect(name).toBe('UNKNOWN');
    });

    test('getNodeColor returns color for node type', () => {
        const color = getNodeColor('N300_LB');
        expect(color).toBe('#3498db');
    });

    test('getNodeColor returns default color for invalid type', () => {
        const color = getNodeColor('INVALID');
        expect(color).toBe('#666');
    });

    test('isVerticalLayout detects vertical layout', () => {
        expect(isVerticalLayout('WH_GALAXY')).toBe(true);
        expect(isVerticalLayout('BH_GALAXY')).toBe(true);
        expect(isVerticalLayout('N300_LB')).toBe(false);
    });

    test('getTotalPortCount calculates correctly', () => {
        expect(getTotalPortCount('N300_LB')).toBe(8); // 4 trays * 2 ports
        expect(getTotalPortCount('WH_GALAXY')).toBe(24); // 4 trays * 6 ports
        expect(getTotalPortCount('P150_LB')).toBe(32); // 8 trays * 4 ports
    });

    test('initializeNodeConfigs merges server configs', () => {
        const serverConfigs = {
            'N300_LB': { tray_count: 6, ports_per_tray: 3 },
            'CUSTOM_TYPE': { tray_count: 2, ports_per_tray: 4, tray_layout: 'horizontal' }
        };

        initializeNodeConfigs(serverConfigs);

        const n300Config = getNodeConfig('N300_LB');
        expect(n300Config.tray_count).toBe(6);
        expect(n300Config.ports_per_tray).toBe(3);

        const customConfig = getNodeConfig('CUSTOM_TYPE');
        expect(customConfig).toBeDefined();
        expect(customConfig.tray_count).toBe(2);
    });
});

describe('API Configuration', () => {
    test('API_ENDPOINTS contains all required endpoints', () => {
        expect(API_ENDPOINTS.EXPORT_CABLING_DESCRIPTOR).toBe('/export_cabling_descriptor');
        expect(API_ENDPOINTS.EXPORT_DEPLOYMENT_DESCRIPTOR).toBe('/export_deployment_descriptor');
        expect(API_ENDPOINTS.GENERATE_CABLING_GUIDE).toBe('/generate_cabling_guide');
    });

    test('buildApiUrl constructs URL correctly', () => {
        const url = buildApiUrl('/test', { param1: 'value1', param2: 'value2' });
        expect(url).toContain('/test');
        expect(url).toContain('param1=value1');
        expect(url).toContain('param2=value2');
    });

    test('buildApiUrl handles empty params', () => {
        const url = buildApiUrl('/test', {});
        expect(url).toBe('/test');
    });

    test('buildApiUrl skips null and undefined params', () => {
        const url = buildApiUrl('/test', { param1: 'value1', param2: null, param3: undefined });
        expect(url).toContain('param1=value1');
        expect(url).not.toContain('param2');
        expect(url).not.toContain('param3');
    });

    test('isSuccessStatus identifies 2xx status codes', () => {
        expect(isSuccessStatus(200)).toBe(true);
        expect(isSuccessStatus(201)).toBe(true);
        expect(isSuccessStatus(204)).toBe(true);
        expect(isSuccessStatus(400)).toBe(false);
        expect(isSuccessStatus(500)).toBe(false);
    });

    test('isClientError identifies 4xx status codes', () => {
        expect(isClientError(400)).toBe(true);
        expect(isClientError(404)).toBe(true);
        expect(isClientError(200)).toBe(false);
        expect(isClientError(500)).toBe(false);
    });

    test('isServerError identifies 5xx status codes', () => {
        expect(isServerError(500)).toBe(true);
        expect(isServerError(503)).toBe(true);
        expect(isServerError(200)).toBe(false);
        expect(isServerError(400)).toBe(false);
    });

    test('getStatusMessage returns appropriate messages', () => {
        expect(getStatusMessage(HTTP_STATUS.BAD_REQUEST)).toContain('Invalid request');
        expect(getStatusMessage(HTTP_STATUS.NOT_FOUND)).toContain('not found');
        expect(getStatusMessage(HTTP_STATUS.INTERNAL_SERVER_ERROR)).toContain('Server error');
    });
});

describe('Constants Configuration', () => {
    test('LAYOUT contains required constants', () => {
        expect(LAYOUT.SHELF_SPACING).toBeDefined();
        expect(LAYOUT.RACK_SPACING).toBeDefined();
        expect(LAYOUT.GRAPH_SPACING).toBeDefined();
        expect(typeof LAYOUT.SHELF_SPACING).toBe('number');
    });

    test('ANIMATION contains timing constants', () => {
        expect(ANIMATION.DURATION).toBeDefined();
        expect(ANIMATION.LAYOUT_DURATION).toBeDefined();
        expect(typeof ANIMATION.DURATION).toBe('number');
    });

    test('Z_INDEX contains layer constants', () => {
        expect(Z_INDEX.MODAL).toBeDefined();
        expect(Z_INDEX.NOTIFICATION).toBeDefined();
        expect(Z_INDEX.TOOLTIP).toBeDefined();
        expect(Z_INDEX.MODAL).toBeLessThan(Z_INDEX.NOTIFICATION);
    });

    test('LIMITS contains validation limits', () => {
        expect(LIMITS.MAX_TRAYS_PER_SHELF).toBeDefined();
        expect(LIMITS.MAX_PORTS_PER_TRAY).toBeDefined();
        expect(LIMITS.MAX_CONNECTIONS).toBeDefined();
    });

    test('CYTOSCAPE_CONFIG contains valid settings', () => {
        expect(CYTOSCAPE_CONFIG.minZoom).toBeDefined();
        expect(CYTOSCAPE_CONFIG.maxZoom).toBeDefined();
        expect(CYTOSCAPE_CONFIG.minZoom).toBeLessThan(CYTOSCAPE_CONFIG.maxZoom);
    });
});

