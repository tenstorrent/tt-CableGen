/**
 * Test helpers for JS integration tests
 * 
 * These helpers call actual Python functions for import/export and provide utilities
 * for testing the full flow: Python import → JS modifications → Python export
 * 
 * Focus: Test JS data manipulation functions, not browser/DOM/API client code
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Get test data directory path
const TEST_DATA_DIR = path.join(process.cwd(), 'tests', 'integration', 'test-data');
const PROJECT_ROOT = process.cwd();

/**
 * Load a test data file from the test-data directory
 * @param {string} filename - Name of the test file
 * @returns {string} File contents
 */
export function loadTestDataFile(filename) {
    const filePath = path.join(TEST_DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Test data file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Get all test data files matching an extension
 * @param {string} extension - File extension (e.g., '.csv', '.textproto')
 * @returns {string[]} Array of filenames
 */
export function getTestDataFiles(extension) {
    if (!fs.existsSync(TEST_DATA_DIR)) {
        return [];
    }
    return fs.readdirSync(TEST_DATA_DIR)
        .filter(file => file.endsWith(extension))
        .sort();
}

/**
 * Call actual Python import function to get visualization data
 * 
 * @param {string} filePath - Path to CSV or textproto file
 * @returns {Object} Visualization data from Python (elements + metadata)
 */
export function callPythonImport(filePath) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(TEST_DATA_DIR, filePath);
    const tempScript = path.join(PROJECT_ROOT, '.test_import_script.py');
    
    const pythonScript = `import sys
import json
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from import_cabling import NetworkCablingCytoscapeVisualizer

visualizer = NetworkCablingCytoscapeVisualizer()
file_path = r'${absPath.replace(/\\/g, '/')}'

if file_path.endswith('.textproto'):
    visualizer.file_format = 'descriptor'
    if not visualizer.parse_cabling_descriptor(file_path):
        sys.exit(1)
    
    if visualizer.graph_hierarchy:
        node_types = set(node.get('node_type') for node in visualizer.graph_hierarchy if node.get('node_type'))
        if node_types:
            first_node_type = list(node_types)[0]
            visualizer.shelf_unit_type = visualizer._node_descriptor_to_shelf_type(first_node_type)
            visualizer.current_config = visualizer._node_descriptor_to_config(first_node_type)
        else:
            visualizer.shelf_unit_type = 'wh_galaxy'
            visualizer.current_config = visualizer.shelf_unit_configs['wh_galaxy']
        
        visualizer.set_shelf_unit_type(visualizer.shelf_unit_type)
        connection_count = len(visualizer.descriptor_connections) if visualizer.descriptor_connections else 0
    else:
        connection_count = 0
else:
    connections = visualizer.parse_csv(file_path)
    if not connections:
        sys.exit(1)
    connection_count = len(connections)

visualization_data = visualizer.generate_visualization_data()
visualization_data['metadata']['connection_count'] = connection_count

print(json.dumps(visualization_data))`;
    
    try {
        // Write script to temp file
        fs.writeFileSync(tempScript, pythonScript);
        
        // Execute Python script
        const result = execSync(`python3 "${tempScript}"`, { 
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        return JSON.parse(result.trim());
    } catch (error) {
        throw new Error(`Python import failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
    } finally {
        // Clean up temp script
        if (fs.existsSync(tempScript)) {
            fs.unlinkSync(tempScript);
        }
    }
}

/**
 * Call actual Python export function to export cytoscape data
 * 
 * @param {Object} cytoscapeData - Cytoscape visualization data from JS
 * @returns {string} Textproto content from Python export
 */
export function callPythonExport(cytoscapeData) {
    const tempDataFile = path.join(PROJECT_ROOT, '.test_export_data.json');
    const tempScript = path.join(PROJECT_ROOT, '.test_export_script.py');
    
    try {
        // Write cytoscape data to temp file
        fs.writeFileSync(tempDataFile, JSON.stringify(cytoscapeData));
        
        const pythonScript = `import sys
import json
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from export_descriptors import export_cabling_descriptor_for_visualizer

with open(r'${tempDataFile.replace(/\\/g, '/')}', 'r') as f:
    cytoscape_data = json.load(f)

result = export_cabling_descriptor_for_visualizer(cytoscape_data)
print(result)`;
        
        // Write script to temp file
        fs.writeFileSync(tempScript, pythonScript);
        
        // Execute Python script
        const result = execSync(`python3 "${tempScript}"`, {
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        return result.trim();
    } catch (error) {
        throw new Error(`Python export failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
    } finally {
        // Clean up temp files
        if (fs.existsSync(tempDataFile)) {
            fs.unlinkSync(tempDataFile);
        }
        if (fs.existsSync(tempScript)) {
            fs.unlinkSync(tempScript);
        }
    }
}

/**
 * Count shelf nodes in Cytoscape data
 * @param {Object} cytoscapeData - Cytoscape visualization data
 * @returns {number} Count of shelf nodes
 */
export function countShelfNodes(cytoscapeData) {
    if (!cytoscapeData || !cytoscapeData.elements) {
        return 0;
    }
    return cytoscapeData.elements.filter(el => 
        el.data && el.data.type === 'shelf'
    ).length;
}

/**
 * Count connections in Cytoscape data
 * @param {Object} cytoscapeData - Cytoscape visualization data
 * @returns {number} Count of connections
 */
export function countConnections(cytoscapeData) {
    if (!cytoscapeData || !cytoscapeData.elements) {
        return 0;
    }
    return cytoscapeData.elements.filter(el => 
        el.data && el.data.source && el.data.target
    ).length;
}

/**
 * Call actual Python export deployment descriptor function
 * 
 * @param {Object} cytoscapeData - Cytoscape visualization data from JS
 * @returns {string} Textproto content from Python export
 */
export function callPythonExportDeployment(cytoscapeData) {
    const tempDataFile = path.join(PROJECT_ROOT, '.test_export_deployment_data.json');
    const tempScript = path.join(PROJECT_ROOT, '.test_export_deployment_script.py');
    
    try {
        // Write cytoscape data to temp file
        fs.writeFileSync(tempDataFile, JSON.stringify(cytoscapeData));
        
        const pythonScript = `import sys
import json
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from export_descriptors import export_deployment_descriptor_for_visualizer

with open(r'${tempDataFile.replace(/\\/g, '/')}', 'r') as f:
    cytoscape_data = json.load(f)

result = export_deployment_descriptor_for_visualizer(cytoscape_data)
print(result)`;
        
        // Write script to temp file
        fs.writeFileSync(tempScript, pythonScript);
        
        // Execute Python script
        const result = execSync(`python3 "${tempScript}"`, {
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        return result.trim();
    } catch (error) {
        throw new Error(`Python deployment export failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
    } finally {
        // Clean up temp files
        if (fs.existsSync(tempDataFile)) {
            fs.unlinkSync(tempDataFile);
        }
        if (fs.existsSync(tempScript)) {
            fs.unlinkSync(tempScript);
        }
    }
}

/**
 * Extract hostnames from Cytoscape data
 * @param {Object} cytoscapeData - Cytoscape visualization data
 * @returns {Set<string>} Set of hostnames
 */
export function extractHostnames(cytoscapeData) {
    if (!cytoscapeData || !cytoscapeData.elements) {
        return new Set();
    }
    const hostnames = new Set();
    cytoscapeData.elements.forEach(el => {
        if (el.data && el.data.type === 'shelf' && el.data.hostname) {
            hostnames.add(el.data.hostname);
        }
    });
    return hostnames;
}

/**
 * Call actual Python export CSV function
 * 
 * @param {Object} cytoscapeData - Cytoscape visualization data from JS
 * @returns {string} CSV content from Python export
 */
export function callPythonExportCSV(cytoscapeData) {
    const tempDataFile = path.join(PROJECT_ROOT, '.test_export_csv_data.json');
    const tempScript = path.join(PROJECT_ROOT, '.test_export_csv_script.py');
    
    try {
        // Write cytoscape data to temp file
        fs.writeFileSync(tempDataFile, JSON.stringify(cytoscapeData));
        
        const pythonScript = `import sys
import json
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from export_descriptors import VisualizerCytoscapeDataParser

with open(r'${tempDataFile.replace(/\\/g, '/')}', 'r') as f:
    cytoscape_data = json.load(f)

# Parse connections from cytoscape data
parser = VisualizerCytoscapeDataParser(cytoscape_data)
connections = parser.extract_connections()

# Build a map of shelf node IDs to their location data
shelf_nodes = {}
for element in cytoscape_data.get('elements', []):
    node_data = element.get('data', {})
    if node_data.get('type') == 'shelf':
        shelf_id = node_data.get('id')
        shelf_nodes[shelf_id] = {
            'hostname': node_data.get('hostname', ''),
            'hall': node_data.get('hall', ''),
            'aisle': node_data.get('aisle', ''),
            'rack': node_data.get('rack', '') or node_data.get('rack_num', ''),
            'shelf_u': node_data.get('shelf_u', ''),
            'node_type': node_data.get('node_type', '')
        }

# Helper to get location from shelf node
def get_location_from_shelf(shelf_id, shelf_nodes):
    shelf = shelf_nodes.get(shelf_id, {})
    return {
        'hostname': shelf.get('hostname', ''),
        'hall': shelf.get('hall', ''),
        'aisle': shelf.get('aisle', ''),
        'rack': str(shelf.get('rack', '')),
        'shelf_u': str(shelf.get('shelf_u', '')),
        'node_type': shelf.get('node_type', '')
    }

# Format as CSV
csv_lines = []
csv_lines.append("Source,,,,,,,,,Destination,,,,,,,,,Cable Length,Cable Type")
csv_lines.append("Hostname,Hall,Aisle,Rack,Shelf U,Tray,Port,Label,Node Type,Hostname,Hall,Aisle,Rack,Shelf U,Tray,Port,Label,Node Type,,")

for conn in connections:
    source = conn.get('source', {})
    target = conn.get('target', {})
    
    # Get shelf IDs from connection
    source_shelf_id = source.get('shelf_id', '')
    target_shelf_id = target.get('shelf_id', '')
    
    # Get location data from shelf nodes
    source_loc = get_location_from_shelf(source_shelf_id, shelf_nodes)
    target_loc = get_location_from_shelf(target_shelf_id, shelf_nodes)
    
    # Use connection data for hostname if available, otherwise use shelf location
    source_hostname = source.get('hostname') or source_loc.get('hostname', '')
    target_hostname = target.get('hostname') or target_loc.get('hostname', '')
    
    # Get tray and port from connection
    source_tray = str(source.get('tray_id', ''))
    source_port = str(source.get('port_id', ''))
    target_tray = str(target.get('tray_id', ''))
    target_port = str(target.get('port_id', ''))
    
    # Get node type from connection or shelf
    source_node_type = source.get('node_type') or source_loc.get('node_type', '')
    target_node_type = target.get('node_type') or target_loc.get('node_type', '')
    
    # Generate label (format: HallAisleRackShelfU-Tray-Port)
    source_label = ""
    if all([source_loc.get('hall'), source_loc.get('aisle'), source_loc.get('rack'), source_loc.get('shelf_u')]):
        source_label = f"{source_loc['hall']}{source_loc['aisle']}{source_loc['rack']}{source_loc['shelf_u']}-{source_tray}-{source_port}"
    
    target_label = ""
    if all([target_loc.get('hall'), target_loc.get('aisle'), target_loc.get('rack'), target_loc.get('shelf_u')]):
        target_label = f"{target_loc['hall']}{target_loc['aisle']}{target_loc['rack']}{target_loc['shelf_u']}-{target_tray}-{target_port}"
    
    # Default cable length and type (can be empty)
    cable_length = ""
    cable_type = ""
    
    csv_line = f"{source_hostname},{source_loc.get('hall', '')},{source_loc.get('aisle', '')},{source_loc.get('rack', '')},{source_loc.get('shelf_u', '')},{source_tray},{source_port},{source_label},{source_node_type},{target_hostname},{target_loc.get('hall', '')},{target_loc.get('aisle', '')},{target_loc.get('rack', '')},{target_loc.get('shelf_u', '')},{target_tray},{target_port},{target_label},{target_node_type},{cable_length},{cable_type}"
    csv_lines.append(csv_line)

result = "\\n".join(csv_lines)
print(result)`;
        
        // Write script to temp file
        fs.writeFileSync(tempScript, pythonScript);
        
        // Execute Python script
        const result = execSync(`python3 "${tempScript}"`, {
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        return result.trim();
    } catch (error) {
        throw new Error(`Python CSV export failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
    } finally {
        // Clean up temp files
        if (fs.existsSync(tempDataFile)) {
            fs.unlinkSync(tempDataFile);
        }
        if (fs.existsSync(tempScript)) {
            fs.unlinkSync(tempScript);
        }
    }
}

/**
 * Save test artifacts to debug directory
 * @param {string} testName - Name of the test (used for filename)
 * @param {string} content - Content to save
 * @param {string} extension - File extension (default: 'textproto')
 * @returns {string} Path to saved file
 */
export function saveTestArtifact(testName, content, extension = 'textproto') {
    const debugDir = path.join(process.cwd(), 'tests', 'integration', 'debug_output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const testDir = path.join(debugDir, `testflow_${timestamp}`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Sanitize test name for filename
    const sanitizedName = testName
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase()
        .slice(0, 50); // Limit length
    
    const filename = `${sanitizedName}.${extension}`;
    const filePath = path.join(testDir, filename);
    
    fs.writeFileSync(filePath, content, 'utf-8');
    
    console.log(`\n🐛 DEBUG: Saved artifact to: ${filePath}`);
    
    return filePath;
}

/**
 * Parse deployment descriptor textproto and extract hostnames
 * @param {string} textprotoContent - Deployment descriptor textproto content
 * @returns {Set<string>} Set of hostnames found in the deployment descriptor
 */
export function parseDeploymentDescriptorHostnames(textprotoContent) {
    // Parse deployment descriptor using Python (more reliable than regex)
    const tempTextproto = path.join(PROJECT_ROOT, '.test_deployment_descriptor.textproto');
    const tempScript = path.join(PROJECT_ROOT, '.test_parse_deployment.py');
    
    // Write textproto content to temp file
    fs.writeFileSync(tempTextproto, textprotoContent, 'utf-8');
    
    const pythonScript = `import sys
import json
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from export_descriptors import deployment_pb2
from google.protobuf import text_format

textproto_file = r'${tempTextproto.replace(/\\/g, '/')}'

try:
    with open(textproto_file, 'r') as f:
        textproto_content = f.read()
    
    deployment_desc = deployment_pb2.DeploymentDescriptor()
    text_format.Parse(textproto_content, deployment_desc)
    
    hostnames = []
    for host in deployment_desc.hosts:
        hostname = host.host.strip() if host.host else None
        if hostname:
            hostnames.append(hostname)
    
    print(json.dumps(hostnames))
except Exception as e:
    print(json.dumps([]))
    sys.stderr.write(f"Error parsing deployment descriptor: {e}\\n")
    sys.exit(1)`;
    
    try {
        fs.writeFileSync(tempScript, pythonScript);
        const result = execSync(`python3 "${tempScript}"`, { 
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        const hostnameArray = JSON.parse(result.trim());
        return new Set(hostnameArray);
    } catch (error) {
        console.error('Error parsing deployment descriptor:', error);
        return new Set();
    } finally {
        // Clean up temp files
        if (fs.existsSync(tempScript)) {
            fs.unlinkSync(tempScript);
        }
        if (fs.existsSync(tempTextproto)) {
            fs.unlinkSync(tempTextproto);
        }
    }
}

