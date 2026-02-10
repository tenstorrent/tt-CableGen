/**
 * Integration tests: how limited or incomplete location information affects exports.
 *
 * 1. No location: vis with only distinct hostnames (e.g. from CSV) → export works and can be re-imported.
 * 2. Incomplete location: vis with some nodes missing hall (or other fields) → cabling guide export path does not error.
 *
 * Simplified cabling guide format: when there is no location info, the scaleout cabling generator
 * (cabling_generator.cpp emit_cabling_guide_csv with loc_info=false / --simple) produces CSV with:
 * - Line 1: "Source,,,,Destination,,,"
 * - Line 2: "Hostname,Tray,Port,Node Type,Hostname,Tray,Port,Node Type"
 * - Data rows: 8 columns (hostname, tray, port, node_type × 2). Tests use this format for minimal-no-location.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { createHeadlessCyWithStyleMock, cytoscape } from '../cytoscape-test-helper.js';
import { VisualizerState } from '../../static/js/state/visualizer-state.js';
import {
    callPythonImport,
    callPythonExport,
    callPythonExportDeployment,
    callPythonExportFlatCabling,
    callPythonExportCSV,
    countShelfNodes,
    countConnections,
    extractHostnames
} from './test-helpers.js';

global.cytoscape = cytoscape;

const TEST_DATA_DIR = path.join(process.cwd(), 'tests', 'integration', 'test-data');

/** Simplified cabling guide format from scaleout cabling_generator.cpp (emit_cabling_guide_csv when loc_info=false) */
const SIMPLIFIED_CABLING_GUIDE_HEADER_LINE1 = 'Source,,,,Destination,,,';
const SIMPLIFIED_CABLING_GUIDE_HEADER_LINE2 = 'Hostname,Tray,Port,Node Type,Hostname,Tray,Port,Node Type';
const SIMPLIFIED_CABLING_GUIDE_DATA_COLUMNS = 8;

/**
 * Assert a CSV string has the simplified cabling guide format (no location columns).
 * @param {string} csvContent - Full CSV content
 */
function expectSimplifiedCablingGuideFormat(csvContent) {
    const lines = csvContent.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0].trim()).toBe(SIMPLIFIED_CABLING_GUIDE_HEADER_LINE1);
    expect(lines[1].trim()).toBe(SIMPLIFIED_CABLING_GUIDE_HEADER_LINE2);
    for (let i = 2; i < lines.length; i++) {
        if (lines[i].trim()) {
            const columns = lines[i].split(',');
            expect(columns.length).toBe(SIMPLIFIED_CABLING_GUIDE_DATA_COLUMNS);
        }
    }
}

function createMockDOM() {
    const mockElements = {};
    const createElement = (id) => {
        if (!mockElements[id]) {
            mockElements[id] = {
                id,
                value: '',
                textContent: '',
                disabled: false,
                style: { display: 'none' },
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
                click: jest.fn(),
                focus: jest.fn(),
                files: null,
                appendChild: jest.fn(),
                removeChild: jest.fn(),
                children: []
            };
        }
        return mockElements[id];
    };
    const commonIds = [
        'cy', 'nodeTypeSelect', 'nodeHostnameInput', 'nodeHallInput', 'nodeAisleInput',
        'nodeRackInput', 'nodeShelfUInput', 'graphTemplateSelect', 'exportCablingBtn', 'generateCablingGuideBtn'
    ];
    return {
        getElementById: (id) => (commonIds.includes(id) || mockElements[id]) ? createElement(id) : null,
        createElement: jest.fn(() => createElement(`mock-${Date.now()}`)),
        querySelector: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
        body: { appendChild: jest.fn(), removeChild: jest.fn() },
        mockElements
    };
}

/**
 * Build cytoscape-shaped data from Python visualization data (headless round-trip).
 */
function cytoscapeDataFromHeadless(visualizationData) {
    const elements = visualizationData.elements || [];
    const metadata = visualizationData.metadata || {};
    const cy = createHeadlessCyWithStyleMock(elements);
    return {
        elements: cy.elements().jsons(),
        metadata: { ...metadata }
    };
}

describe('Limited location information and exports', () => {
    let state;
    let mockDOM;

    beforeEach(() => {
        mockDOM = createMockDOM();
        global.document = mockDOM;
        global.window = {
            location: { origin: 'http://localhost:5000' },
            URL: { createObjectURL: jest.fn(() => 'blob:mock'), revokeObjectURL: jest.fn() },
            Blob: jest.fn((c, o) => ({ content: c, options: o })),
            alert: jest.fn(),
            confirm: jest.fn(() => true)
        };
        global.alert = jest.fn();
        state = new VisualizerState();
        state.cy = createHeadlessCyWithStyleMock([]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('No location (hostnames only)', () => {
        const minimalCsvPath = path.join(TEST_DATA_DIR, 'minimal-no-location.csv');

        test('minimal-no-location.csv matches simplified cabling guide format (scaleout cabling_generator --simple)', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }
            const content = fs.readFileSync(minimalCsvPath, 'utf-8');
            expectSimplifiedCablingGuideFormat(content);
        });

        test('import CSV (no location) → export cabling descriptor → re-import textproto succeeds', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }

            const visualizationData = callPythonImport(minimalCsvPath);
            expect(visualizationData.elements).toBeDefined();
            expect(visualizationData.elements.length).toBeGreaterThan(0);

            const cytoscapeData = cytoscapeDataFromHeadless(visualizationData);
            const shelfCount = cytoscapeData.elements.filter(el => el.data && el.data.type === 'shelf').length;
            expect(shelfCount).toBeGreaterThanOrEqual(2);

            const exportedCabling = callPythonExport(cytoscapeData);
            expect(exportedCabling).toBeTruthy();
            expect(typeof exportedCabling).toBe('string');
            expect(exportedCabling.length).toBeGreaterThan(0);
            expect(exportedCabling).toMatch(/cluster|graph_templates|extracted_topology/i);

            const tempFile = path.join(process.cwd(), '.test_location_roundtrip_cabling.textproto');
            try {
                fs.writeFileSync(tempFile, exportedCabling);
                const reimported = callPythonImport(tempFile);
                expect(reimported.elements).toBeDefined();
                expect(reimported.elements.length).toBeGreaterThan(0);
                const reimportShelfCount = reimported.elements.filter(el => el.data && el.data.type === 'shelf').length;
                expect(reimportShelfCount).toBeGreaterThanOrEqual(2);
            } finally {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        });

        test('import CSV (no location) → export deployment descriptor succeeds and is valid', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }

            const visualizationData = callPythonImport(minimalCsvPath);
            const cytoscapeData = cytoscapeDataFromHeadless(visualizationData);

            const exportedDeployment = callPythonExportDeployment(cytoscapeData);
            expect(exportedDeployment).toBeTruthy();
            expect(typeof exportedDeployment).toBe('string');
            expect(exportedDeployment.length).toBeGreaterThan(0);
            expect(exportedDeployment).toMatch(/deployment|hosts|host/i);
        });

        test('import CSV (no location) → export CSV produces valid cabling-guide-style CSV with hostname,tray,port,node_type', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }
            const visualizationData = callPythonImport(minimalCsvPath);
            const cytoscapeData = cytoscapeDataFromHeadless(visualizationData);
            const exportedCSV = callPythonExportCSV(cytoscapeData);
            expect(exportedCSV).toBeTruthy();
            const lines = exportedCSV.trim().split(/\r?\n/);
            expect(lines.length).toBeGreaterThanOrEqual(3);
            expect(lines[1]).toMatch(/Hostname.*Tray.*Port.*Node Type/i);
            const dataLine = lines[2];
            expect(dataLine).toBeTruthy();
            const cols = dataLine.split(',');
            expect(cols.length).toBeGreaterThanOrEqual(SIMPLIFIED_CABLING_GUIDE_DATA_COLUMNS);
            expect(cols[0].trim()).toBeTruthy();
            const destHostnameCol = cols.length >= 10 ? 9 : 4;
            expect(cols[destHostnameCol].trim()).toBeTruthy();
        });
    });

    describe('Incomplete location (e.g. missing hall)', () => {
        const minimalCsvPath = path.join(TEST_DATA_DIR, 'minimal-no-location.csv');

        /** Build cytoscape data with partial location: aisle/rack/shelf_u set, hall missing. */
        function cytoscapeDataWithIncompleteLocation(visualizationData) {
            const cytoscapeData = cytoscapeDataFromHeadless(visualizationData);
            cytoscapeData.elements.forEach(el => {
                if (el.data && el.data.type === 'shelf') {
                    el.data.aisle = 'A1';
                    el.data.rack_num = 1;
                    el.data.shelf_u = 1;
                    delete el.data.hall;
                }
            });
            return cytoscapeData;
        }

        test('flat cabling export with incomplete location does not error', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }

            const visualizationData = callPythonImport(minimalCsvPath);
            const cytoscapeData = cytoscapeDataWithIncompleteLocation(visualizationData);

            expect(() => {
                const result = callPythonExportFlatCabling(cytoscapeData);
                expect(result).toBeTruthy();
                expect(typeof result).toBe('string');
                expect(result.length).toBeGreaterThan(0);
            }).not.toThrow();
        });

        test('deployment export with incomplete location (no hall) does not error', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }

            const visualizationData = callPythonImport(minimalCsvPath);
            const cytoscapeData = cytoscapeDataWithIncompleteLocation(visualizationData);

            expect(() => {
                const result = callPythonExportDeployment(cytoscapeData);
                expect(result).toBeTruthy();
                expect(typeof result).toBe('string');
                expect(result).toMatch(/deployment|hosts|host/i);
            }).not.toThrow();
        });

        test('cabling guide export path (flat cabling + deployment) with incomplete location does not error', () => {
            if (!fs.existsSync(minimalCsvPath)) {
                console.warn('Skipping: minimal-no-location.csv not found');
                return;
            }

            const visualizationData = callPythonImport(minimalCsvPath);
            const cytoscapeData = cytoscapeDataWithIncompleteLocation(visualizationData);

            expect(() => {
                const flatCabling = callPythonExportFlatCabling(cytoscapeData);
                const deployment = callPythonExportDeployment(cytoscapeData);
                expect(flatCabling).toBeTruthy();
                expect(flatCabling.length).toBeGreaterThan(0);
                expect(deployment).toBeTruthy();
                expect(deployment.length).toBeGreaterThan(0);
            }).not.toThrow();
        });
    });
});
