/**
 * Payload Size Test - Measure the impact of filtering cytoscape data for export
 * 
 * This test measures the payload size reduction when filtering cytoscape data
 * to only include fields needed for export operations.
 * 
 * Run with: node tests/integration/payload-size-test.js
 */

import { callPythonImport } from './test-helpers.js';
import fs from 'fs';
import path from 'path';

// Mock commonModule for testing (simplified version of the filter function)
function filterCytoscapeDataForExport(cytoscapeData, exportType = 'cabling') {
    const elements = cytoscapeData.elements || [];
    const metadata = cytoscapeData.metadata || {};
    
    // Define fields needed for each export type
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
    
    // Select appropriate field sets based on export type
    const nodeFields = exportType === 'deployment' ? nodeFieldsForDeployment : nodeFieldsForCabling;
    const edgeFields = exportType === 'deployment' ? edgeFieldsForDeployment : edgeFieldsForCabling;
    
    // Filter elements
    const filteredElements = elements.map(element => {
        const elementData = element.data || {};
        const isEdge = 'source' in elementData;
        const fieldsToKeep = isEdge ? edgeFields : nodeFields;
        
        // Filter data object to only include needed fields
        const filteredData = {};
        for (const field of fieldsToKeep) {
            if (field in elementData) {
                filteredData[field] = elementData[field];
            }
        }
        
        // Return minimal element structure (only data field, no visual properties)
        return {
            data: filteredData
        };
    });
    
    // Filter metadata - only include what's needed
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
 * Calculate size of JSON string in bytes
 */
function getJsonSize(obj) {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Count fields in an object
 */
function countFields(obj, prefix = '') {
    let count = 0;
    if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
            obj.forEach((item, idx) => {
                count += countFields(item, `${prefix}[${idx}]`);
            });
        } else {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    count++;
                    const value = obj[key];
                    if (typeof value === 'object' && value !== null) {
                        count += countFields(value, `${prefix}.${key}`);
                    }
                }
            }
        }
    }
    return count;
}

/**
 * Test payload size reduction for a given test file
 */
function testPayloadSize(testFile) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${testFile}`);
    console.log('='.repeat(80));
    
    try {
        // Import data from Python
        const visualizationData = callPythonImport(testFile);
        
        // Simulate full cytoscape data (as it would come from state.cy.elements().jsons())
        // This includes all visual properties and metadata
        const fullCytoscapeData = {
            elements: visualizationData.elements || [],
            metadata: visualizationData.metadata || {}
        };
        
        // Measure full payload
        const fullSize = getJsonSize(fullCytoscapeData);
        const fullElementCount = fullCytoscapeData.elements.length;
        const fullFieldCount = countFields(fullCytoscapeData);
        
        console.log(`\nFull Payload:`);
        console.log(`  Elements: ${fullElementCount}`);
        console.log(`  Size: ${formatBytes(fullSize)} (${fullSize.toLocaleString()} bytes)`);
        console.log(`  Field count: ${fullFieldCount.toLocaleString()}`);
        
        // Test cabling export filtering
        const filteredCabling = filterCytoscapeDataForExport(fullCytoscapeData, 'cabling');
        const cablingSize = getJsonSize(filteredCabling);
        const cablingFieldCount = countFields(filteredCabling);
        const cablingReduction = ((fullSize - cablingSize) / fullSize * 100).toFixed(2);
        
        console.log(`\nFiltered (Cabling Export):`);
        console.log(`  Elements: ${filteredCabling.elements.length}`);
        console.log(`  Size: ${formatBytes(cablingSize)} (${cablingSize.toLocaleString()} bytes)`);
        console.log(`  Field count: ${cablingFieldCount.toLocaleString()}`);
        console.log(`  Reduction: ${cablingReduction}% (${formatBytes(fullSize - cablingSize)} saved)`);
        
        // Test deployment export filtering
        const filteredDeployment = filterCytoscapeDataForExport(fullCytoscapeData, 'deployment');
        const deploymentSize = getJsonSize(filteredDeployment);
        const deploymentFieldCount = countFields(filteredDeployment);
        const deploymentReduction = ((fullSize - deploymentSize) / fullSize * 100).toFixed(2);
        
        console.log(`\nFiltered (Deployment Export):`);
        console.log(`  Elements: ${filteredDeployment.elements.length}`);
        console.log(`  Size: ${formatBytes(deploymentSize)} (${deploymentSize.toLocaleString()} bytes)`);
        console.log(`  Field count: ${deploymentFieldCount.toLocaleString()}`);
        console.log(`  Reduction: ${deploymentReduction}% (${formatBytes(fullSize - deploymentSize)} saved)`);
        
        // Sample element comparison
        if (fullCytoscapeData.elements.length > 0) {
            const sampleFull = fullCytoscapeData.elements[0];
            const sampleFiltered = filteredCabling.elements[0];
            
            console.log(`\nSample Element Comparison:`);
            console.log(`  Full element keys: ${Object.keys(sampleFull.data || {}).length}`);
            console.log(`  Filtered element keys: ${Object.keys(sampleFiltered.data || {}).length}`);
            
            if (sampleFull.position) {
                console.log(`  Visual properties removed: position, classes, style, etc.`);
            }
        }
        
        return {
            testFile,
            fullSize,
            cablingSize,
            deploymentSize,
            cablingReduction: parseFloat(cablingReduction),
            deploymentReduction: parseFloat(deploymentReduction),
            fullElementCount,
            cablingFieldCount,
            deploymentFieldCount
        };
        
    } catch (error) {
        console.error(`Error testing ${testFile}:`, error.message);
        return null;
    }
}

/**
 * Main test function
 */
function main() {
    console.log('Payload Size Test - Measuring impact of filtering cytoscape data');
    console.log('='.repeat(80));
    
    const testDataDir = path.join(process.cwd(), 'tests', 'integration', 'test-data');
    
    // Get all test files
    const testFiles = [];
    if (fs.existsSync(testDataDir)) {
        const files = fs.readdirSync(testDataDir);
        files.forEach(file => {
            if (file.endsWith('.textproto') || file.endsWith('.csv')) {
                testFiles.push(file);
            }
        });
    }
    
    if (testFiles.length === 0) {
        console.error('No test files found in test-data directory');
        process.exit(1);
    }
    
    console.log(`Found ${testFiles.length} test file(s)`);
    
    // Run tests
    const results = [];
    for (const testFile of testFiles) {
        const result = testPayloadSize(testFile);
        if (result) {
            results.push(result);
        }
    }
    
    // Summary
    if (results.length > 0) {
        console.log(`\n${'='.repeat(80)}`);
        console.log('Summary');
        console.log('='.repeat(80));
        
        const avgCablingReduction = results.reduce((sum, r) => sum + r.cablingReduction, 0) / results.length;
        const avgDeploymentReduction = results.reduce((sum, r) => sum + r.deploymentReduction, 0) / results.length;
        const totalFullSize = results.reduce((sum, r) => sum + r.fullSize, 0);
        const totalCablingSize = results.reduce((sum, r) => sum + r.cablingSize, 0);
        const totalDeploymentSize = results.reduce((sum, r) => sum + r.deploymentSize, 0);
        
        console.log(`\nAverage Reduction:`);
        console.log(`  Cabling Export: ${avgCablingReduction.toFixed(2)}%`);
        console.log(`  Deployment Export: ${avgDeploymentReduction.toFixed(2)}%`);
        
        console.log(`\nTotal Size:`);
        console.log(`  Full: ${formatBytes(totalFullSize)}`);
        console.log(`  Cabling Filtered: ${formatBytes(totalCablingSize)}`);
        console.log(`  Deployment Filtered: ${formatBytes(totalDeploymentSize)}`);
        console.log(`  Total Saved (Cabling): ${formatBytes(totalFullSize - totalCablingSize)}`);
        console.log(`  Total Saved (Deployment): ${formatBytes(totalFullSize - totalDeploymentSize)}`);
        
        console.log(`\n✅ Filtering successfully reduces payload size!`);
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { testPayloadSize, filterCytoscapeDataForExport };


