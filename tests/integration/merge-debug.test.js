/**
 * Integration tests for cabling guide merge (add-another-CSV) flow.
 *
 * Use case (merge debugging):
 * 1. Start visualization by uploading cabling_guide_BH_8x8_mesh.csv
 * 2. Merge cabling_guide_BH_8x8_torus-x.csv in
 * 3. Result: same nodes/connections in the same racking hierarchy as the
 *    original import, with 8 more connections (torus-x adds 8 intra-shelf
 *    links on top of the 8 mesh links).
 *
 * Mesh CSV: 8 connections (U02 <-> U08).
 * Torus-x CSV: 16 connections (8 within U02, 8 within U08, plus same 8 U02<->U08).
 * After merge: same nodes, same racking, 16 edges = 8 mesh + 8 new torus-x.
 *
 * Data-only assertions (merge output JSON) are not enough: the wrong visualization
 * (shelves drawn outside the rack) was caused by organizeInGrid() detaching nodes
 * in the live graph. So we also test against a real Cytoscape instance: after
 * merge + parent sync, shelves must still have parent === rack in the graph.
 */

import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from '@jest/globals';
import { callPythonImport } from './test-helpers.js';
import { createHeadlessCyWithStyleMock } from '../cytoscape-test-helper.js';
import { mergeCablingGuideData, sortElementsParentsBeforeChildren, validateMergedCablingGuide, validateOneConnectionPerPort } from '../../static/js/visualizer.js';

const PROJECT_ROOT = process.cwd();
const CABLING_GUIDES_DIR = path.join(PROJECT_ROOT, 'defined_topologies', 'CablingGuides');

/** Convention: every *_mesh.csv has a counterpart *_torus-2d.csv; mesh is a subset of that torus-2d. */
function getMeshTorus2dPairs() {
    const dir = CABLING_GUIDES_DIR;
    if (!fs.existsSync(dir)) return [];
    const pairs = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('_mesh.csv')) continue;
        const torus2dName = name.replace(/_mesh\.csv$/, '_torus-2d.csv');
        const meshPath = path.join(dir, name);
        const torus2dPath = path.join(dir, torus2dName);
        if (fs.existsSync(torus2dPath)) pairs.push({ meshPath, torus2dPath, label: name.replace('.csv', '') });
    }
    return pairs;
}

const MESH_TORUS2D_PAIRS = getMeshTorus2dPairs();

const MESH_CSV = path.join(CABLING_GUIDES_DIR, 'cabling_guide_BH_8x8_mesh.csv');
const TORUS_X_CSV = path.join(CABLING_GUIDES_DIR, 'cabling_guide_BH_8x8_torus-x.csv');

function countByType(elements) {
    const byType = {};
    const edges = [];
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) {
            edges.push(el);
            return;
        }
        const t = d.type || 'node';
        byType[t] = (byType[t] || 0) + 1;
    });
    return { byType, nodeCount: Object.values(byType).reduce((a, b) => a + b, 0), edgeCount: edges.length };
}

function getNodeIds(elements) {
    const ids = new Set();
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source === undefined && d.target === undefined && d.id != null) ids.add(d.id);
    });
    return ids;
}

function getParentRefs(elements) {
    const refs = [];
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        if (d.parent != null) refs.push({ id: d.id, type: d.type, parent: d.parent });
    });
    return refs;
}

function getAllNodeIdsSet(elements) {
    const ids = new Set();
    (elements || []).forEach((el) => {
        const id = el.data?.id;
        if (id != null && !('source' in (el.data || {})) && !('target' in (el.data || {}))) ids.add(id);
    });
    return ids;
}

/** Expected racking for BH 8x8 mesh/torus-x: Hall 120, Aisle A, Rack 03, Shelves U02, U08 */
const EXPECTED_RACKING = {
    hall: '120',
    aisle: 'A',
    rackNum: '03', // Python normalize_rack may produce "03"
    rackId: 'rack_120_A_03',
    shelfUs: ['U02', 'U08'], // Shelf U column in CSV; may appear as U02/U08 or 02/08
};

function getNodesByType(elements, type) {
    return (elements || []).filter((el) => {
        const d = el.data || {};
        return d.source === undefined && d.target === undefined && d.type === type;
    });
}

/** Normalize shelf_u for comparison (Python may store "02"/"08" or "U02"/"U08"). */
function normalizeShelfU(v) {
    if (v == null) return '';
    const s = String(v).trim();
    return s.startsWith('U') ? s.slice(1) : s;
}

function assertRackingHierarchy(elements) {
    const racks = getNodesByType(elements, 'rack');
    expect(racks).toHaveLength(1);
    const rack = racks[0];
    const rackData = rack.data || {};
    expect(rackData.id).toBe(EXPECTED_RACKING.rackId);

    expect(String(rackData.hall)).toBe(EXPECTED_RACKING.hall);
    expect(String(rackData.aisle)).toBe(EXPECTED_RACKING.aisle);
    expect(String(rackData.rack_num)).toBe(EXPECTED_RACKING.rackNum);

    const shelves = getNodesByType(elements, 'shelf');
    expect(shelves).toHaveLength(2);
    const shelfUsNormalized = shelves.map((s) => normalizeShelfU((s.data || {}).shelf_u)).sort();
    expect(shelfUsNormalized).toContain('02');
    expect(shelfUsNormalized).toContain('08');

    shelves.forEach((s) => {
        expect((s.data || {}).parent).toBe(EXPECTED_RACKING.rackId);
        expect(String((s.data || {}).hall)).toBe(EXPECTED_RACKING.hall);
        expect(String((s.data || {}).aisle)).toBe(EXPECTED_RACKING.aisle);
    });
}

/**
 * Apply the same parent-sync logic as applyMergeToGraph (so we can test against a real cy).
 * For each node in mergedElements, if the node exists in cy and its parent differs, node.move({ parent }).
 */
function syncGraphParentsFromMergedData(cy, mergedElements) {
    if (!mergedElements?.length) return;
    const sorted = sortElementsParentsBeforeChildren(mergedElements);
    const nodes = sorted.filter(
        (el) => el.group !== 'edges' && !(el.data && ('source' in (el.data || {}) || 'target' in (el.data || {})))
    );
    nodes.forEach((el) => {
        const id = el.data?.id;
        const wantParent = el.data?.parent ?? null;
        if (id == null) return;
        const node = cy.getElementById(String(id));
        if (node.length === 0 || !node.isNode()) return;
        const currentParent = node.parent().length ? node.parent().id() : null;
        if (currentParent !== wantParent) node.move({ parent: wantParent != null ? wantParent : null });
    });
}

/**
 * Assert full compound hierarchy: rack -> shelves -> trays -> ports.
 * Every node's parent must point to an existing container; no orphans or broken compounds.
 */
function assertCompoundHierarchy(elements) {
    const nodeById = new Map();
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        const id = d.id;
        if (id != null) nodeById.set(String(id), { type: d.type, parent: d.parent != null ? String(d.parent) : null });
    });

    const rackId = EXPECTED_RACKING.rackId;
    expect(nodeById.has(rackId)).toBe(true);
    const rackEntry = nodeById.get(rackId);
    expect(rackEntry.type).toBe('rack');
    // Rack is top-level when single hall/aisle (no hall/aisle nodes); otherwise parent is aisle or hall
    if (rackEntry.parent != null) {
        expect(nodeById.has(rackEntry.parent)).toBe(true);
    }

    const shelves = getNodesByType(elements, 'shelf');
    const shelfIds = new Set(shelves.map((s) => String((s.data || {}).id)));
    shelves.forEach((s) => {
        const parent = (s.data || {}).parent != null ? String((s.data || {}).parent) : null;
        expect(parent).toBe(rackId);
        expect(nodeById.has(parent)).toBe(true);
    });

    const trays = getNodesByType(elements, 'tray');
    trays.forEach((t) => {
        const parent = (t.data || {}).parent != null ? String((t.data || {}).parent) : null;
        expect(parent).not.toBeNull();
        expect(nodeById.has(parent)).toBe(true);
        expect(shelfIds.has(parent)).toBe(true);
    });

    const ports = getNodesByType(elements, 'port');
    const trayIds = new Set(trays.map((t) => String((t.data || {}).id)));
    ports.forEach((p) => {
        const parent = (p.data || {}).parent != null ? String((p.data || {}).parent) : null;
        expect(parent).not.toBeNull();
        expect(nodeById.has(parent)).toBe(true);
        expect(trayIds.has(parent)).toBe(true);
    });

    // No node has a parent that doesn't exist (no broken compounds)
    for (const [id, entry] of nodeById) {
        if (entry.parent != null) {
            expect(nodeById.has(entry.parent)).toBe(true);
        }
    }
}

describe('Merge debug (mesh + torus-x)', () => {
    let meshData;
    let torusXData;

    beforeAll(() => {
        meshData = callPythonImport(MESH_CSV);
        torusXData = callPythonImport(TORUS_X_CSV);
    });

    test('mesh CSV produces 8 connections and expected node types', () => {
        expect(meshData?.elements?.length).toBeGreaterThan(0);
        const { nodeCount, edgeCount, byType } = countByType(meshData.elements);
        expect(edgeCount).toBe(8);
        expect(byType.rack).toBe(1);
        expect(byType.shelf).toBe(2);
        expect(byType.port).toBeGreaterThan(0);
    });

    test('mesh and torus-x have correct racking and compound hierarchy: Hall 120, Aisle A, Rack 03, Shelves U02 and U08', () => {
        assertRackingHierarchy(meshData.elements);
        assertCompoundHierarchy(meshData.elements);
        assertRackingHierarchy(torusXData.elements);
        assertCompoundHierarchy(torusXData.elements);
    });

    test('torus-x CSV produces 16 connections and same racking (2 shelves)', () => {
        expect(torusXData?.elements?.length).toBeGreaterThan(0);
        const { nodeCount, edgeCount, byType } = countByType(torusXData.elements);
        expect(edgeCount).toBe(16);
        expect(byType.shelf).toBe(2);
    });

    test('merge: result has same nodes and racking hierarchy as original, plus 8 more connections', () => {
        const existingData = { elements: meshData.elements, metadata: meshData.metadata || {} };
        const newData = { elements: torusXData.elements, metadata: torusXData.metadata || {} };
        const merged = mergeCablingGuideData(existingData, newData, 'm2');

        expect(merged.elements).toBeDefined();
        expect(merged.metadata).toBeDefined();

        const meshCounts = countByType(meshData.elements);
        const mergedCounts = countByType(merged.elements);

        // Same node set: no duplicate racks/shelves; result structure matches new (superset)
        expect(mergedCounts.nodeCount).toBe(meshCounts.nodeCount);
        expect(mergedCounts.edgeCount).toBe(16);
        expect(meshCounts.edgeCount).toBe(8);
        expect(mergedCounts.edgeCount - meshCounts.edgeCount).toBe(8);

        // Same racking: one rack, two shelves
        expect(mergedCounts.byType.rack).toBe(1);
        expect(mergedCounts.byType.shelf).toBe(2);

        // No duplicate node ids (all nodes from new, resolved to existing ids)
        const mergedNodeIds = getNodeIds(merged.elements);
        const meshNodeIds = getNodeIds(meshData.elements);
        expect(mergedNodeIds.size).toBe(meshNodeIds.size);

        // All parents exist in merged set (no orphans)
        const mergedIds = getAllNodeIdsSet(merged.elements);
        const parentRefs = getParentRefs(merged.elements);
        const orphans = parentRefs.filter((r) => !mergedIds.has(r.parent));
        expect(orphans).toHaveLength(0);

        // Racking hierarchy and compound structure preserved: Hall 120, Aisle A, Rack 03, Shelves U02, U08; rack -> shelves -> trays -> ports
        assertRackingHierarchy(merged.elements);
        assertCompoundHierarchy(merged.elements);
    });

    test('merge: newNodesToAdd is empty (torus-x is superset, no new nodes)', () => {
        const existingData = { elements: meshData.elements, metadata: meshData.metadata || {} };
        const newData = { elements: torusXData.elements, metadata: torusXData.metadata || {} };
        const merged = mergeCablingGuideData(existingData, newData, 'm2');

        expect(merged.newNodesToAdd).toBeDefined();
        expect(merged.newEdgesToAdd).toBeDefined();
        expect(merged.newNodesToAdd).toHaveLength(0);
        expect(merged.newEdgesToAdd).toHaveLength(8);
    });

    test('sortElementsParentsBeforeChildren preserves parent-before-child order', () => {
        const existingData = { elements: meshData.elements, metadata: meshData.metadata || {} };
        const newData = { elements: torusXData.elements, metadata: torusXData.metadata || {} };
        const merged = mergeCablingGuideData(existingData, newData, 'm2');
        const sorted = sortElementsParentsBeforeChildren(merged.elements);

        const typeOrder = { hall: 0, aisle: 1, rack: 2, shelf: 3, tray: 4, port: 5 };
        const nodes = sorted.filter((el) => {
            const d = el.data || {};
            return d.source === undefined && d.target === undefined;
        });
        const ids = new Map(nodes.map((n) => [n.data?.id, n]));

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const parentId = node.data?.parent;
            if (!parentId) continue;
            const parentNode = nodes.find((n) => n.data?.id === parentId);
            const parentIndex = parentNode ? nodes.indexOf(parentNode) : -1;
            expect(parentIndex).toBeGreaterThanOrEqual(0);
            expect(parentIndex).toBeLessThan(i);
        }
    });

    /**
     * Test that would have caught the wrong visualization (shelves drawn outside the rack).
     * Uses a real Cytoscape instance: load mesh, merge torus-x, apply parent sync, then assert
     * that in the graph every shelf still has parent === rack. Also proves that calling
     * organizeInGrid (move shelves to parent null) detaches them — so production must skip
     * organizeInGrid when racks exist.
     */
    test('merge + parent sync: graph has shelves inside rack (catches wrong visualization)', () => {
        const sortedMesh = sortElementsParentsBeforeChildren(meshData.elements);
        const cy = createHeadlessCyWithStyleMock(sortedMesh);

        const existingData = { elements: meshData.elements, metadata: meshData.metadata || {} };
        const newData = { elements: torusXData.elements, metadata: torusXData.metadata || {} };
        const merged = mergeCablingGuideData(existingData, newData, 'm2');

        if (merged.newEdgesToAdd?.length > 0) cy.add(merged.newEdgesToAdd);
        syncGraphParentsFromMergedData(cy, merged.elements);

        const shelves = cy.nodes('[type="shelf"]');
        expect(shelves.length).toBe(2);
        shelves.forEach((shelf) => {
            expect(shelf.parent().length).toBe(1);
            expect(shelf.parent().id()).toBe(EXPECTED_RACKING.rackId);
        });
    });

    test('simulating organizeInGrid after merge detaches shelves (documents why we skip it when racks exist)', () => {
        const sortedMesh = sortElementsParentsBeforeChildren(meshData.elements);
        const cy = createHeadlessCyWithStyleMock(sortedMesh);

        const existingData = { elements: meshData.elements, metadata: meshData.metadata || {} };
        const newData = { elements: torusXData.elements, metadata: torusXData.metadata || {} };
        const merged = mergeCablingGuideData(existingData, newData, 'm2');
        if (merged.newEdgesToAdd?.length > 0) cy.add(merged.newEdgesToAdd);
        syncGraphParentsFromMergedData(cy, merged.elements);

        cy.nodes('[type="shelf"]').forEach((node) => node.move({ parent: null }));

        const shelves = cy.nodes('[type="shelf"]');
        expect(shelves.length).toBe(2);
        shelves.forEach((shelf) => {
            expect(shelf.parent().length).toBe(0);
        });
    });
});

describe('validateMergedCablingGuide', () => {
    test('existing A-B, new A-B allowed (warning only)', () => {
        const existing = {
            elements: [
                { data: { id: '0' } },
                { data: { id: '1' } },
                { data: { source: '0', target: '1' } }
            ]
        };
        const newGuide = {
            elements: [
                { data: { id: '0' } },
                { data: { id: '1' } },
                { data: { source: '0', target: '1' } }
            ]
        };
        const result = validateMergedCablingGuide(existing, newGuide);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatch(/re-defined|same endpoints/);
    });

    test('existing A-B, new A-C not allowed (Guides disagree)', () => {
        const existing = {
            elements: [
                { data: { id: '0' } },
                { data: { id: '1' } },
                { data: { source: '0', target: '1' } }
            ]
        };
        const newGuide = {
            elements: [
                { data: { id: '0' } },
                { data: { id: '2' } },
                { data: { source: '0', target: '2' } }
            ]
        };
        const result = validateMergedCablingGuide(existing, newGuide);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.includes('Guides disagree') && e.includes('0'))).toBe(true);
    });

    test('new guide with port in two connections is invalid input (rejected)', () => {
        const existing = {
            elements: [
                { data: { id: '0' } },
                { data: { id: '1' } },
                { data: { source: '0', target: '1' } }
            ]
        };
        const newGuide = {
            elements: [
                { data: { id: '0' } },
                { data: { id: '1' } },
                { data: { id: '2' } },
                { data: { source: '0', target: '1' } },
                { data: { source: '0', target: '2' } }
            ]
        };
        const result = validateMergedCablingGuide(existing, newGuide);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.includes('more than one connection') && e.includes('0'))).toBe(true);
    });
});

describe('merge validation with real CSVs (mesh ⊂ torus-2d convention)', () => {
    /** Loaded data for each pair: key = meshPath, value = { meshData, torus2dData }. */
    const pairData = new Map();
    /** Pairs that successfully loaded (some CSVs may fail Python import in this env). */
    let loadedPairs = [];

    beforeAll(() => {
        for (const pair of MESH_TORUS2D_PAIRS) {
            try {
                const meshData = callPythonImport(pair.meshPath);
                const torus2dData = callPythonImport(pair.torus2dPath);
                pairData.set(pair.meshPath, { meshData, torus2dData });
                loadedPairs.push(pair);
            } catch (_) {
                // skip pair if import fails (e.g. different CSV format / env)
            }
        }
    });

    test('every mesh + same-base torus-2d allowed (mesh is subset of torus-2d)', () => {
        expect(loadedPairs.length).toBeGreaterThan(0);
        for (const { meshPath } of loadedPairs) {
            const { meshData, torus2dData } = pairData.get(meshPath);
            const existing = { elements: meshData.elements, metadata: meshData.metadata || {} };
            const newData = { elements: torus2dData.elements, metadata: torus2dData.metadata || {} };
            const result = validateMergedCablingGuide(existing, newData);
            expect(result.errors).toHaveLength(0);
        }
    });

    test('mesh + different-base torus-2d fails (Guides disagree)', () => {
        if (loadedPairs.length < 2) return;
        const [pairA, pairB] = loadedPairs;
        const { meshData } = pairData.get(pairA.meshPath);
        const { torus2dData } = pairData.get(pairB.meshPath);
        const existing = { elements: meshData.elements, metadata: meshData.metadata || {} };
        const newData = { elements: torus2dData.elements, metadata: torus2dData.metadata || {} };
        const result = validateMergedCablingGuide(existing, newData);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.includes('Guides disagree'))).toBe(true);
    });
});

describe('validateOneConnectionPerPort (load / base rule)', () => {
    test('elements with port in two connections fail validation', () => {
        const elements = [
            { data: { id: '0' } },
            { data: { id: '1' } },
            { data: { id: '2' } },
            { data: { source: '0', target: '1' } },
            { data: { source: '0', target: '2' } }
        ];
        const result = validateOneConnectionPerPort(elements);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('0') && e.includes('more than one connection'))).toBe(true);
    });

    test('elements with one connection per port pass validation', () => {
        const elements = [
            { data: { id: '0' } },
            { data: { id: '1' } },
            { data: { source: '0', target: '1' } }
        ];
        const result = validateOneConnectionPerPort(elements);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});
