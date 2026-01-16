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

// Get test data directory path - use defined_topologies folder
const TEST_DATA_DIR = path.join(process.cwd(), 'defined_topologies');
const PROJECT_ROOT = process.cwd();

/**
 * Load a test data file from the defined_topologies directory
 * @param {string} filename - Name of the test file (relative to defined_topologies)
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
 * @param {string} subdirectory - Optional subdirectory to search (e.g., 'CablingGuides', 'CablingDescriptors', 'DeploymentDescriptors')
 * @returns {string[]} Array of filenames (with full paths relative to TEST_DATA_DIR)
 */
export function getTestDataFiles(extension, subdirectory = null) {
    if (!fs.existsSync(TEST_DATA_DIR)) {
        return [];
    }

    const searchDir = subdirectory ? path.join(TEST_DATA_DIR, subdirectory) : TEST_DATA_DIR;
    if (!fs.existsSync(searchDir)) {
        return [];
    }

    return fs.readdirSync(searchDir)
        .filter(file => file.endsWith(extension))
        .map(file => subdirectory ? path.join(subdirectory, file) : file)
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
import warnings
import io
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

# Suppress warnings to prevent them from interfering with JSON output
warnings.filterwarnings('ignore')

# Redirect both stdout and stderr to capture all output, then only output JSON
stdout_backup = sys.stdout
stderr_backup = sys.stderr
stdout_capture = io.StringIO()
stderr_capture = io.StringIO()

try:
    sys.stdout = stdout_capture
    sys.stderr = stderr_capture
    
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

finally:
    # Restore stdout and stderr
    sys.stdout = stdout_backup
    sys.stderr = stderr_backup

# Only output JSON to stdout (all warnings/prints were captured)
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

        // Extract JSON from output (in case there's any leading text)
        const trimmed = result.trim();
        
        // Find the first { or [ which indicates start of JSON
        const braceIndex = trimmed.indexOf('{');
        const bracketIndex = trimmed.indexOf('[');
        const jsonStart = Math.min(
            braceIndex !== -1 ? braceIndex : Infinity,
            bracketIndex !== -1 ? bracketIndex : Infinity
        );
        
        if (jsonStart === Infinity) {
            // Show more context in error message
            const preview = trimmed.length > 500 ? trimmed.substring(0, 500) + '...' : trimmed;
            throw new Error(`No JSON found in Python output. First 500 chars: ${preview}`);
        }
        
        // Log what we're skipping for debugging
        if (jsonStart > 0) {
            const skipped = trimmed.substring(0, jsonStart);
            console.warn(`Skipping ${jsonStart} characters before JSON: "${skipped}"`);
        }
        
        const jsonStr = trimmed.substring(jsonStart);
        
        // Try to find the end of JSON (last } or ])
        let jsonEnd = jsonStr.length;
        let braceCount = 0;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < jsonStr.length; i++) {
            const char = jsonStr[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            
            if (char === '"') {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
                if (char === '[') bracketCount++;
                if (char === ']') bracketCount--;
                
                if (braceCount === 0 && bracketCount === 0 && (char === '}' || char === ']')) {
                    jsonEnd = i + 1;
                    break;
                }
            }
        }
        
        const finalJsonStr = jsonStr.substring(0, jsonEnd);
        
        try {
            return JSON.parse(finalJsonStr);
        } catch (parseError) {
            // Show what we tried to parse
            const preview = finalJsonStr.length > 200 ? finalJsonStr.substring(0, 200) + '...' : finalJsonStr;
            throw new Error(`JSON parse failed: ${parseError.message}\nAttempted to parse (first 200 chars): ${preview}\nFull output length: ${trimmed.length}, JSON start: ${jsonStart}, JSON end: ${jsonEnd}`);
        }
    } catch (error) {
        // Include the actual output in the error
        const outputPreview = result.length > 500 ? result.substring(0, 500) + '...' : result;
        throw new Error(`Python import failed: ${error.message}\nOutput preview (first 500 chars): ${outputPreview}\n${error.stdout || ''}\n${error.stderr || ''}`);
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
# Redirect print statements to stderr to avoid polluting stdout with debug messages
import builtins
original_print = builtins.print
def print_to_stderr(*args, **kwargs):
    kwargs.setdefault('file', sys.stderr)
    original_print(*args, **kwargs)
builtins.print = print_to_stderr

sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from export_descriptors import export_cabling_descriptor_for_visualizer

with open(r'${tempDataFile.replace(/\\/g, '/')}', 'r') as f:
    cytoscape_data = json.load(f)

result = export_cabling_descriptor_for_visualizer(cytoscape_data)
# Use original print for the actual result (to stdout)
original_print(result)`;

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
 * Parse exported textproto and count nodes and connections
 * @param {string} textprotoContent - Textproto content from export
 * @returns {Object} Object with nodeCount and connectionCount
 */
export function parseExportedTextproto(textprotoContent) {
    const tempTextprotoFile = path.join(PROJECT_ROOT, '.test_parse_textproto.textproto');
    const tempScript = path.join(PROJECT_ROOT, '.test_parse_textproto_script.py');

    try {
        // Write textproto to temp file
        fs.writeFileSync(tempTextprotoFile, textprotoContent);

        const pythonScript = `import sys
import json
import os
sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

# Add protobuf directory to path (same as export_descriptors.py does)
tt_metal_home = os.environ.get("TT_METAL_HOME")
if tt_metal_home:
    protobuf_dir = os.path.join(tt_metal_home, "build", "tools", "scaleout", "protobuf")
    if os.path.exists(protobuf_dir):
        sys.path.append(protobuf_dir)

try:
    import cluster_config_pb2
    from google.protobuf import text_format
    
    # Read and parse textproto
    with open(r'${tempTextprotoFile.replace(/\\/g, '/')}', 'r') as f:
        textproto_content = f.read()
    
    cluster_desc = cluster_config_pb2.ClusterDescriptor()
    text_format.Parse(textproto_content, cluster_desc)
    
    # Count nodes (children in templates that are node_ref, not graph_ref)
    node_count = 0
    connection_count = 0
    
    # Traverse all templates to count nodes
    for template_name, template in cluster_desc.graph_templates.items():
        for child in template.children:
            if child.HasField('node_ref'):
                node_count += 1
    
    # Count connections in all templates
    for template_name, template in cluster_desc.graph_templates.items():
        if 'QSFP_DD' in template.internal_connections:
            port_conns = template.internal_connections['QSFP_DD']
            connection_count += len(port_conns.connections)
    
    result = {
        'node_count': node_count,
        'connection_count': connection_count,
        'template_count': len(cluster_desc.graph_templates),
        'root_template': cluster_desc.root_instance.template_name
    }
    
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)`;

        // Write script to temp file
        fs.writeFileSync(tempScript, pythonScript);

        // Execute Python script
        const result = execSync(`python3 "${tempScript}"`, {
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024
        });

        const parsed = JSON.parse(result.trim());
        if (parsed.error) {
            throw new Error(`Failed to parse textproto: ${parsed.error}`);
        }
        return parsed;
    } catch (error) {
        throw new Error(`Python textproto parsing failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
    } finally {
        // Clean up temp files
        if (fs.existsSync(tempTextprotoFile)) {
            fs.unlinkSync(tempTextprotoFile);
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
# Redirect print statements to stderr to avoid polluting stdout with debug messages
import builtins
original_print = builtins.print
def print_to_stderr(*args, **kwargs):
    kwargs.setdefault('file', sys.stderr)
    original_print(*args, **kwargs)
builtins.print = print_to_stderr

sys.path.insert(0, r'${PROJECT_ROOT.replace(/\\/g, '/')}')

from export_descriptors import export_deployment_descriptor_for_visualizer

with open(r'${tempDataFile.replace(/\\/g, '/')}', 'r') as f:
    cytoscape_data = json.load(f)

result = export_deployment_descriptor_for_visualizer(cytoscape_data)
# Use original print for the actual result (to stdout)
original_print(result)`;

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
    if 'data' in element:
        data = element['data']
        if data.get('type') == 'shelf':
            shelf_id = data.get('id')
            shelf_nodes[shelf_id] = {
                'hostname': data.get('hostname', ''),
                'hall': data.get('hall', ''),
                'aisle': data.get('aisle', ''),
                'rack': data.get('rack_num') or data.get('rack', 0),
                'shelf_u': data.get('shelf_u', 0),
                'node_type': data.get('shelf_node_type') or data.get('node_type', '')
            }

# Generate CSV lines
csv_lines = []
for conn in connections:
    source = conn['source']
    target = conn['target']
    
    source_hostname = source.get('hostname', '')
    target_hostname = target.get('hostname', '')
    
    # Get location data from shelf nodes
    source_loc = shelf_nodes.get(source.get('shelf_id', ''), {})
    target_loc = shelf_nodes.get(target.get('shelf_id', ''), {})
    
    source_tray = source.get('tray_id', '')
    source_port = source.get('port_id', '')
    target_tray = target.get('tray_id', '')
    target_port = target.get('port_id', '')
    
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

# Add CSV header lines (matching the format expected by CSV import)
# Line 1: Source,Destination marker with commas aligning to columns (9 commas after Source, 9 commas after Destination)
# Line 2: Column headers
header_line_1 = "Source,,,,,,,,,Destination,,,,,,,,,Cable Length,Cable Type"
header_line_2 = "Hostname,Hall,Aisle,Rack,Shelf U,Tray,Port,Label,Node Type,Hostname,Hall,Aisle,Rack,Shelf U,Tray,Port,Label,Node Type,,"

result = header_line_1 + "\\n" + header_line_2 + "\\n" + "\\n".join(csv_lines)
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

/**
 * Parse deployment descriptor textproto file and convert to format expected by updateShelfLocations
 * @param {string} filePath - Path to deployment descriptor textproto file (relative to test-data/deployment-descriptors/)
 * @returns {Object} Deployment data in format expected by updateShelfLocations
 */
export function parseDeploymentDescriptor(filePath) {
    const deploymentDir = path.join(TEST_DATA_DIR, 'DeploymentDescriptors');
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(deploymentDir, filePath);
    const content = fs.readFileSync(absPath, 'utf-8');

    // Parse deployment descriptor textproto format
    // Format: hosts: { hall: "...", aisle: "...", rack: N, shelf_u: N, host: "..." }
    const hosts = [];
    const hostRegex = /hosts:\s*\{([^}]+)\}/g;
    let match;

    while ((match = hostRegex.exec(content)) !== null) {
        const hostBlock = match[1];
        const host = {
            hall: '',
            aisle: '',
            rack: 0,
            shelf_u: 0,
            host: ''
        };

        // Extract fields from host block
        const hallMatch = hostBlock.match(/hall:\s*"([^"]+)"/);
        if (hallMatch) host.hall = hallMatch[1];

        const aisleMatch = hostBlock.match(/aisle:\s*"([^"]+)"/);
        if (aisleMatch) host.aisle = aisleMatch[1];

        const rackMatch = hostBlock.match(/rack:\s*(\d+)/);
        if (rackMatch) host.rack = parseInt(rackMatch[1]);

        const shelfUMatch = hostBlock.match(/shelf_u:\s*(\d+)/);
        if (shelfUMatch) host.shelf_u = parseInt(shelfUMatch[1]);

        const hostMatch = hostBlock.match(/host:\s*"([^"]+)"/);
        if (hostMatch) host.host = hostMatch[1];

        hosts.push(host);
    }

    // Convert to format expected by updateShelfLocations
    // Elements array with shelf nodes indexed by host_id
    const elements = hosts.map((host, hostIndex) => ({
        data: {
            type: 'shelf',
            host_index: hostIndex,
            host_id: hostIndex,
            hall: host.hall,
            aisle: host.aisle,
            rack_num: host.rack,
            shelf_u: host.shelf_u,
            hostname: host.host
        }
    }));

    return { elements };
}

/**
 * Parse deployment descriptor from textproto content (string) and convert to format expected by updateShelfLocations
 * @param {string} textprotoContent - Deployment descriptor textproto content as string
 * @returns {Object} Deployment data in format expected by updateShelfLocations
 */
export function parseDeploymentDescriptorFromContent(textprotoContent) {
    // Parse deployment descriptor textproto format
    // Format: hosts { hall: "..." aisle: "..." rack: N shelf_u: N host: "..." }
    // Multiple hosts blocks, one per host
    const hosts = [];
    // Match each hosts { ... } block (handles nested braces correctly)
    const hostRegex = /hosts\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let match;

    while ((match = hostRegex.exec(textprotoContent)) !== null) {
        const hostBlock = match[1];
        const host = {
            hall: '',
            aisle: '',
            rack: 0,
            shelf_u: 0,
            host: ''
        };

        // Extract fields from host block (fields can be on separate lines or same line)
        const hallMatch = hostBlock.match(/hall:\s*"([^"]+)"/);
        if (hallMatch) host.hall = hallMatch[1];

        const aisleMatch = hostBlock.match(/aisle:\s*"([^"]+)"/);
        if (aisleMatch) host.aisle = aisleMatch[1];

        const rackMatch = hostBlock.match(/rack:\s*(\d+)/);
        if (rackMatch) host.rack = parseInt(rackMatch[1]);

        const shelfUMatch = hostBlock.match(/shelf_u:\s*(\d+)/);
        if (shelfUMatch) host.shelf_u = parseInt(shelfUMatch[1]);

        const hostMatch = hostBlock.match(/host:\s*"([^"]+)"/);
        if (hostMatch) host.host = hostMatch[1];

        hosts.push(host);
    }

    // Convert to format expected by updateShelfLocations
    // Elements array with shelf nodes indexed by host_id
    const elements = hosts.map((host, hostIndex) => ({
        data: {
            type: 'shelf',
            host_index: hostIndex,
            host_id: hostIndex,
            hall: host.hall,
            aisle: host.aisle,
            rack_num: host.rack,
            shelf_u: host.shelf_u,
            hostname: host.host
        }
    }));

    return { elements };
}

/**
 * Load expected output file (CSV or textproto)
 * @param {string} filePath - Path to expected output file (relative to test-data/expected-outputs/)
 * @returns {string} File contents
 */
export function loadExpectedOutput(filePath) {
    // Note: expected-outputs may not exist in defined_topologies
    const expectedDir = path.join(TEST_DATA_DIR, 'expected-outputs');
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(expectedDir, filePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`Expected output file not found: ${absPath}`);
    }
    return fs.readFileSync(absPath, 'utf-8');
}
