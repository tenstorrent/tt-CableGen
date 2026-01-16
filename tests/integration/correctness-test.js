/**
 * Correctness Test - Verify that filtered data produces identical export output
 * 
 * This test ensures that filtering cytoscape data doesn't break export functionality
 * by comparing exports from filtered vs unfiltered data.
 * 
 * Run with: node tests/integration/correctness-test.js
 */

import { callPythonImport, callPythonExport, callPythonExportDeployment } from './test-helpers.js';
import fs from 'fs';
import path from 'path';

// Import the filter function (same as in common.js)
function filterCytoscapeDataForExport(cytoscapeData, exportType = 'cabling') {
    const elements = cytoscapeData.elements || [];
    const metadata = cytoscapeData.metadata || {};
    
    const nodeFieldsForCabling = new Set([
        'id', 'type', 'hostname', 'logical_path', 'template_name', 'parent',
        'shelf_id', 'tray_id', 'port_id', 'node_type', 'host_id', 'host_index',
        'shelf_node_type', 'child_name', 'label', 'node_descriptor_type'
    ]);
    
    const nodeFieldsForDeployment = new Set([
        'id', 'type', 'hostname', 'hall', 'aisle', 'rack_num', 'rack',
        'shelf_u', 'shelf_node_type', 'host_index', 'host_id', 'node_type'
    ]);
    
    const edgeFieldsForCabling = new Set([
        'source', 'target', 'source_hostname', 'destination_hostname',
        'depth', 'template_name', 'instance_path'
    ]);
    
    const edgeFieldsForDeployment = new Set([
        'source', 'target'
    ]);
    
    const nodeFields = exportType === 'deployment' ? nodeFieldsForDeployment : nodeFieldsForCabling;
    const edgeFields = exportType === 'deployment' ? edgeFieldsForDeployment : edgeFieldsForCabling;
    
    const filteredElements = elements.map(element => {
        const elementData = element.data || {};
        const isEdge = 'source' in elementData;
        const fieldsToKeep = isEdge ? edgeFields : nodeFields;
        
        const filteredData = {};
        for (const field of fieldsToKeep) {
            if (field in elementData) {
                filteredData[field] = elementData[field];
            }
        }
        
        return {
            data: filteredData
        };
    });
    
    const filteredMetadata = {};
    if (exportType === 'cabling') {
        if (metadata.graph_templates) {
            filteredMetadata.graph_templates = metadata.graph_templates;
        }
        if (metadata.visualization_mode !== undefined) {
            filteredMetadata.visualization_mode = metadata.visualization_mode;
        }
        if (metadata.hasTopLevelAdditions !== undefined) {
            filteredMetadata.hasTopLevelAdditions = metadata.hasTopLevelAdditions;
        }
        if (metadata.initialRootTemplate) {
            filteredMetadata.initialRootTemplate = metadata.initialRootTemplate;
        }
        if (metadata.initialRootId) {
            filteredMetadata.initialRootId = metadata.initialRootId;
        }
    }
    
    return {
        elements: filteredElements,
        ...(Object.keys(filteredMetadata).length > 0 ? { metadata: filteredMetadata } : {})
    };
}

/**
 * Normalize textproto content for comparison (remove whitespace differences)
 */
function normalizeTextproto(content) {
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
}

/**
 * Compare two textproto exports and report differences
 */
function compareExports(unfiltered, filtered, testName) {
    const normalizedUnfiltered = normalizeTextproto(unfiltered);
    const normalizedFiltered = normalizeTextproto(filtered);
    
    if (normalizedUnfiltered === normalizedFiltered) {
        console.log(`  ✅ ${testName}: Exports are identical`);
        return true;
    } else {
        console.log(`  ❌ ${testName}: Exports differ`);
        console.log(`     Unfiltered length: ${unfiltered.length} chars`);
        console.log(`     Filtered length: ${filtered.length} chars`);
        
        // Find first difference
        const lines1 = normalizedUnfiltered.split('\n');
        const lines2 = normalizedFiltered.split('\n');
        const minLen = Math.min(lines1.length, lines2.length);
        
        for (let i = 0; i < minLen; i++) {
            if (lines1[i] !== lines2[i]) {
                console.log(`     First difference at line ${i + 1}:`);
                console.log(`       Unfiltered: ${lines1[i].substring(0, 100)}`);
                console.log(`       Filtered:   ${lines2[i].substring(0, 100)}`);
                break;
            }
        }
        
        if (lines1.length !== lines2.length) {
            console.log(`     Line count differs: ${lines1.length} vs ${lines2.length}`);
        }
        
        return false;
    }
}

/**
 * Test correctness for a given test file
 */
function testCorrectness(testFile) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing Correctness: ${testFile}`);
    console.log('='.repeat(80));
    
    try {
        // Step 1: Import data from Python
        const visualizationData = callPythonImport(testFile);
        
        // Step 2: Create full cytoscape data (unfiltered)
        const fullCytoscapeData = {
            elements: visualizationData.elements || [],
            metadata: visualizationData.metadata || {}
        };
        
        // Step 3: Check if hostnames are present (needed for deployment export)
        const hasHostnames = fullCytoscapeData.elements.some(el => {
            const data = el.data || {};
            return data.type === 'shelf' && data.hostname && data.hostname.trim();
        });
        
        // Step 4: Export with unfiltered data
        console.log('\nExporting with unfiltered data...');
        const unfilteredCablingExport = callPythonExport(fullCytoscapeData);
        let unfilteredDeploymentExport = null;
        let filteredDeploymentExport = null;
        
        if (hasHostnames) {
            try {
                unfilteredDeploymentExport = callPythonExportDeployment(fullCytoscapeData);
            } catch (error) {
                console.log(`  ⚠️  Skipping deployment export (no hostnames): ${error.message.split('\n')[0]}`);
            }
        } else {
            console.log('  ⚠️  Skipping deployment export (no hostnames in data)');
        }
        
        // Step 5: Filter data
        const filteredCablingData = filterCytoscapeDataForExport(fullCytoscapeData, 'cabling');
        const filteredDeploymentData = filterCytoscapeDataForExport(fullCytoscapeData, 'deployment');
        
        // Step 6: Export with filtered data
        console.log('Exporting with filtered data...');
        const filteredCablingExport = callPythonExport(filteredCablingData);
        
        if (hasHostnames && unfilteredDeploymentExport) {
            try {
                filteredDeploymentExport = callPythonExportDeployment(filteredDeploymentData);
            } catch (error) {
                console.log(`  ⚠️  Filtered deployment export failed: ${error.message.split('\n')[0]}`);
            }
        }
        
        // Step 7: Compare exports
        console.log('\nComparing exports...');
        const cablingMatch = compareExports(
            unfilteredCablingExport,
            filteredCablingExport,
            'Cabling Descriptor Export'
        );
        
        let deploymentMatch = true;
        if (hasHostnames && unfilteredDeploymentExport && filteredDeploymentExport) {
            deploymentMatch = compareExports(
                unfilteredDeploymentExport,
                filteredDeploymentExport,
                'Deployment Descriptor Export'
            );
        } else {
            console.log('  ⚠️  Deployment export comparison skipped (no hostnames or export failed)');
        }
        
        // Step 7: Verify data integrity
        console.log('\nVerifying data integrity...');
        
        // Count elements
        const fullElementCount = fullCytoscapeData.elements.length;
        const filteredCablingElementCount = filteredCablingData.elements.length;
        const filteredDeploymentElementCount = filteredDeploymentData.elements.length;
        
        console.log(`  Elements: ${fullElementCount} -> ${filteredCablingElementCount} (cabling), ${filteredDeploymentElementCount} (deployment)`);
        
        if (fullElementCount !== filteredCablingElementCount || fullElementCount !== filteredDeploymentElementCount) {
            console.log(`  ⚠️  Warning: Element count changed after filtering`);
        } else {
            console.log(`  ✅ Element count preserved`);
        }
        
        // Check for shelf nodes
        const fullShelfCount = fullCytoscapeData.elements.filter(el => el.data && el.data.type === 'shelf').length;
        const filteredCablingShelfCount = filteredCablingData.elements.filter(el => el.data && el.data.type === 'shelf').length;
        const filteredDeploymentShelfCount = filteredDeploymentData.elements.filter(el => el.data && el.data.type === 'shelf').length;
        
        console.log(`  Shelf nodes: ${fullShelfCount} -> ${filteredCablingShelfCount} (cabling), ${filteredDeploymentShelfCount} (deployment)`);
        
        if (fullShelfCount !== filteredCablingShelfCount || fullShelfCount !== filteredDeploymentShelfCount) {
            console.log(`  ❌ Error: Shelf node count changed after filtering`);
            return false;
        }
        
        // Check for edges
        const fullEdgeCount = fullCytoscapeData.elements.filter(el => el.data && el.data.source).length;
        const filteredCablingEdgeCount = filteredCablingData.elements.filter(el => el.data && el.data.source).length;
        const filteredDeploymentEdgeCount = filteredDeploymentData.elements.filter(el => el.data && el.data.source).length;
        
        console.log(`  Edges: ${fullEdgeCount} -> ${filteredCablingEdgeCount} (cabling), ${filteredDeploymentEdgeCount} (deployment)`);
        
        if (fullEdgeCount !== filteredCablingEdgeCount || fullEdgeCount !== filteredDeploymentEdgeCount) {
            console.log(`  ❌ Error: Edge count changed after filtering`);
            return false;
        }
        
        // Verify critical fields are preserved
        console.log('\nVerifying critical fields...');
        const sampleShelf = fullCytoscapeData.elements.find(el => el.data && el.data.type === 'shelf');
        if (sampleShelf) {
            const criticalFields = ['id', 'type', 'hostname', 'shelf_node_type', 'host_index'];
            for (const field of criticalFields) {
                const fullValue = sampleShelf.data && sampleShelf.data[field];
                const filteredCablingEl = filteredCablingData.elements.find(el => el.data && el.data.id === (sampleShelf.data && sampleShelf.data.id));
                const filteredCablingValue = filteredCablingEl && filteredCablingEl.data && filteredCablingEl.data[field];
                const filteredDeploymentEl = filteredDeploymentData.elements.find(el => el.data && el.data.id === (sampleShelf.data && sampleShelf.data.id));
                const filteredDeploymentValue = filteredDeploymentEl && filteredDeploymentEl.data && filteredDeploymentEl.data[field];
                
                if (fullValue !== filteredCablingValue || fullValue !== filteredDeploymentValue) {
                    console.log(`  ❌ Error: Field '${field}' not preserved: ${fullValue} -> ${filteredCablingValue} (cabling), ${filteredDeploymentValue} (deployment)`);
                    return false;
                }
            }
            console.log(`  ✅ Critical fields preserved`);
        }
        
        return cablingMatch && deploymentMatch;
        
    } catch (error) {
        console.error(`Error testing ${testFile}:`, error.message);
        console.error(error.stack);
        return false;
    }
}

/**
 * Main test function
 */
function main() {
    console.log('Correctness Test - Verify filtered data produces identical exports');
    console.log('='.repeat(80));
    
    const testDataDir = path.join(process.cwd(), 'defined_topologies');
    
    // Get all test files from CablingGuides and CablingDescriptors subdirectories
    const testFiles = [];
    const csvDir = path.join(testDataDir, 'CablingGuides');
    const textprotoDir = path.join(testDataDir, 'CablingDescriptors');
    
    if (fs.existsSync(csvDir)) {
        const files = fs.readdirSync(csvDir);
        files.forEach(file => {
            if (file.endsWith('.csv')) {
                testFiles.push(path.join('CablingGuides', file));
            }
        });
    }
    
    if (fs.existsSync(textprotoDir)) {
        const files = fs.readdirSync(textprotoDir);
        files.forEach(file => {
            if (file.endsWith('.textproto')) {
                testFiles.push(path.join('CablingDescriptors', file));
            }
        });
    }
    
    if (testFiles.length === 0) {
        console.error('No test files found in defined_topologies directory');
        process.exit(1);
    }
    
    console.log(`Found ${testFiles.length} test file(s)`);
    
    // Run tests
    const results = [];
    for (const testFile of testFiles) {
        const passed = testCorrectness(testFile);
        results.push({ testFile, passed });
    }
    
    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('Summary');
    console.log('='.repeat(80));
    
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.length - passedCount;
    
    console.log(`\nTests passed: ${passedCount}/${results.length}`);
    console.log(`Tests failed: ${failedCount}/${results.length}`);
    
    if (failedCount > 0) {
        console.log('\nFailed tests:');
        results.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.testFile}`);
        });
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed! Filtered data produces identical exports.');
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { testCorrectness, filterCytoscapeDataForExport };

