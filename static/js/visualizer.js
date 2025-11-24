/**
 * Network Cabling Visualizer - Client-side JavaScript
 * 
 * This is the main visualization module for the CableGen application.
 * It has been refactored from a monolithic file into a modular architecture.
 * 
 * Architecture Overview:
 * ======================
 * - Configuration: Extracted to ./config/ (constants, node-types, API)
 * - State Management: Centralized in ./state/ (VisualizerState, StateObserver)
 * - Factories: Node/connection creation in ./factories/
 * - Modules: Common, Location, Hierarchy modules in ./modules/
 * - API Client: Backend communication in ./api/
 * - UI Managers: Notification, Modal, Status managers in ./ui/
 * 
 * Refactoring Status:
 * ===================
 * Phase 1-6: ✅ Complete
 *   - Configuration extracted
 *   - State management implemented
 *   - Factories created
 *   - Modules separated (common, location, hierarchy)
 *   - API client extracted
 *   - UI managers extracted
 * 
 * Phase 7: ✅ Complete (Cleanup)
 *   - Removed unused template color constants (moved to CommonModule)
 *   - Improved documentation
 * 
 * Phase 8: ⏳ Pending (Backward Compatibility Cleanup)
 *   - Remove legacy global variables (cy, state.data.currentData, etc.)
 *   - Remove syncLegacyGlobals() function
 *   - Replace inline onclick handlers with event listeners
 *   - Remove functionsToExpose workaround
 * 
 * Current State:
 * ==============
 * - Legacy globals are kept in sync with state via observers (backward compatibility)
 * - Functions are exposed to window object for HTML onclick handlers (temporary workaround)
 * - All new code should use state.* and module APIs directly
 */

// ===== Module Imports =====
import { LAYOUT, ANIMATION, Z_INDEX, LIMITS, CYTOSCAPE_CONFIG, VISUAL, CONNECTION_COLORS, LAYOUT_CONSTANTS } from './config/constants.js';
import {
    initializeNodeConfigs as initNodeTypesConfig,
    getNodeConfig,
    isValidNodeType,
    getAllNodeTypes,
    getNodeDisplayName,
    getNodeColor
} from './config/node-types.js';
import { API_ENDPOINTS, API_DEFAULTS, buildApiUrl, getStatusMessage } from './config/api.js';
import { VisualizerState } from './state/visualizer-state.js';
import { StateObserver } from './state/state-observer.js';
import { NodeFactory } from './factories/node-factory.js';
import { ConnectionFactory } from './factories/connection-factory.js';
import { CommonModule } from './modules/common.js';
import { LocationModule } from './modules/location.js';
import { HierarchyModule } from './modules/hierarchy.js';
import { deleteMultipleSelected as deleteMultipleSelectedUtil, deleteConnectionFromAllTemplateInstances as deleteConnectionFromAllTemplateInstancesUtil } from './utils/node-management.js';
import { ApiClient } from './api/api-client.js';
import { NotificationManager } from './ui/notification-manager.js';
import { ModalManager } from './ui/modal-manager.js';
import { StatusManager } from './ui/status-manager.js';

// ===== Configuration Constants =====


/**
 * Verify that all required cytoscape extensions are loaded and available
 * Logs warnings for any missing extensions
 */
function verifyCytoscapeExtensions() {
    if (typeof cy === 'undefined' || !cy || !state.cy) {
        console.warn('⚠ Cannot verify extensions: cytoscape instance not initialized');
        return;
    }

    const missingExtensions = [];
    const availableExtensions = [];

    // Check for fcose layout extension
    // fcose registers itself as a layout algorithm, so we check by trying to create a layout
    try {
        // Try to create a test layout with fcose - if it fails, the extension isn't loaded
        const testLayout = state.cy.layout({ name: 'fcose', eles: state.cy.collection() });
        if (testLayout && typeof testLayout.run === 'function') {
            availableExtensions.push('cytoscape-fcose');
            // Note: layout-base and cose-base are dependencies loaded before fcose
            // If fcose works, they are implicitly available
        } else {
            missingExtensions.push('cytoscape-fcose');
        }
    } catch (e) {
        // If fcose layout creation fails, the extension isn't loaded
        missingExtensions.push('cytoscape-fcose');
    }

    // Log results
    if (availableExtensions.length > 0) {
        console.log('✓ Available cytoscape extensions:', availableExtensions.join(', '));
    }
    if (missingExtensions.length > 0) {
        console.warn('⚠ Missing cytoscape extensions:', missingExtensions.join(', '));
        console.warn('Some features may not work correctly. Please ensure all extension scripts are loaded in index.html');
    } else {
        console.log('✓ All cytoscape extensions are loaded and available');
    }
}

// Delegate to common module
function getTemplateColor(templateName) {
    return commonModule.getTemplateColor(templateName);
}

const DEFAULT_CABLE_CONFIG = {
    type: 'QSFP_DD',
    length: 'Unknown'
};

/**
 * COMMON: Arrange trays and ports within a shelf node based on node type configuration
 * This is mode-independent - works for both location and hierarchy modes
 */
// Delegate to common module
function common_arrangeTraysAndPorts(shelfNode) {
    commonModule.arrangeTraysAndPorts(shelfNode);
}


/**
 * HIERARCHY MODE: Calculate positions for all nodes in the graph hierarchy
 * This provides consistent spacing for both imported and newly created nodes
 * Uses percentage-based spacing that adapts to actual node sizes
 */

/**
 * Recursively position children of a graph node
 * Uses dynamic sizing based on actual node dimensions
 */

/**
 * Position trays and ports within a shelf
 */

// ===== State Management =====
// Initialize state and observer
const state = new VisualizerState();
const stateObserver = new StateObserver(state);

// Make state observable (auto-notify on changes)
state.editing = stateObserver.createProxy(state.editing, 'editing');
state.data = stateObserver.createProxy(state.data, 'data');
state.ui = stateObserver.createProxy(state.ui, 'ui');

// Initialize factories
const nodeFactory = new NodeFactory(state);
const connectionFactory = new ConnectionFactory(state);

// Initialize common module
const commonModule = new CommonModule(state, nodeFactory);
// Store reference on state for easy access
state.commonModule = commonModule;

// Initialize mode-specific modules
const hierarchyModule = new HierarchyModule(state, commonModule);
const locationModule = new LocationModule(state, commonModule);

// Expose modules to window for HTML access
window.locationModule = locationModule;
window.hierarchyModule = hierarchyModule;

// Initialize API client
const apiClient = new ApiClient();

// Initialize UI managers
const notificationManager = new NotificationManager();
const modalManager = new ModalManager();
const statusManager = new StatusManager();

// ===== Legacy Global Variables (Backward Compatibility) =====
// TODO: Phase 8 - Remove these legacy globals and migrate all code to use state.* directly
// These are kept in sync with state via observers to maintain backward compatibility
// during the migration period. All new code should use state.* instead.

// Legacy globals removed - all code now uses state.* directly
// Only window globals remain for HTML onclick handlers (will be removed in Phase 8.5)

// Initialize window globals for HTML access (required for inline onclick handlers)
window.currentData = null;
window.cy = null;
window.initialVisualizationData = null;

/**
 * Sync legacy globals with state (temporary during migration)
 * TODO: Phase 8 - Remove this function and all references to legacy globals
 */
// Legacy globals and sync functions removed - all code now uses state.* directly
// Window globals are kept only for HTML onclick handlers (will be removed in Phase 8.5)

// Subscribe to state changes to keep window globals in sync for HTML access
stateObserver.subscribe('cy', (newVal) => {
    window.cy = newVal; // Expose to global scope for HTML access
});
stateObserver.subscribe('data.currentData', (newVal) => {
    window.currentData = newVal; // Expose to global scope for HTML access
});
stateObserver.subscribe('data.initialVisualizationData', (newVal) => {
    window.initialVisualizationData = newVal; // Expose to global scope for HTML access
});

// ===== Node Drag Control =====
/**
 * Apply drag restrictions: tray and port nodes should not be draggable.
 * All other nodes (graph containers, racks, shelves, halls, aisles, etc.) remain draggable.
 */
// Delegate to common module
function applyDragRestrictions() {
    commonModule.applyDragRestrictions();
}

// Visualization Mode Management
// visualizationMode is now managed by state.mode

/**
 * Set the visualization mode and update UI accordingly
 * @param {string} mode - 'location' or 'hierarchy'
 */
function setVisualizationMode(mode) {
    state.setMode(mode);

    // Update body class for mode-specific CSS visibility
    document.body.classList.remove('mode-location', 'mode-hierarchy');
    if (mode === 'location') {
        document.body.classList.add('mode-location');
    } else if (mode === 'hierarchy') {
        document.body.classList.add('mode-hierarchy');
    }

    updateModeIndicator();

    // Update filter dropdowns when mode changes (if Cytoscape is initialized)
    if (state.cy && typeof populateNodeFilterDropdown === 'function') {
        populateNodeFilterDropdown();
    }
    // Update template filter dropdown (hierarchy mode only)
    if (state.cy && mode === 'hierarchy' && typeof populateTemplateFilterDropdown === 'function') {
        populateTemplateFilterDropdown();
    }
}

/**
 * Get the current visualization mode
 * @returns {string} Current mode ('location' or 'hierarchy')
 */
function getVisualizationMode() {
    return state.mode;
}

/**
 * Update the mode indicator in the UI
 */
function updateModeIndicator() {
    const indicator = document.getElementById('visualizationModeIndicator');
    const currentModeDiv = document.getElementById('currentMode');
    const descriptionDiv = document.getElementById('modeDescription');

    // Get UI elements for add node section
    const nodePhysicalFields = document.getElementById('nodePhysicalFields');
    const nodeLogicalMessage = document.getElementById('nodeLogicalMessage');

    // Get Graph Template section
    const addGraphSection = document.getElementById('addGraphSection');

    // Get Add Node section - preserve its visibility state if connection editing is enabled
    const addNodeSection = document.getElementById('addNodeSection');
    const wasAddNodeSectionVisible = addNodeSection && addNodeSection.style.display !== 'none';

    if (!indicator || !currentModeDiv || !descriptionDiv) return;

    // Show the indicator
    indicator.style.display = 'block';

    // Get connection filter elements
    // Connection type filters are location mode only, node filter is available in both modes
    const intraNodeCheckbox = document.getElementById('showIntraNodeConnections');
    const connectionTypesSection = intraNodeCheckbox ? intraNodeCheckbox.closest('div[style*="margin-bottom"]') : null;

    if (state.mode === 'hierarchy') {
        indicator.style.background = '#fff3cd';
        indicator.style.borderColor = '#ffc107';
        currentModeDiv.innerHTML = '<strong>🌳 Logical Topology View</strong>';
        descriptionDiv.textContent = 'Organized by graph templates and instances (ignores physical location)';

        // Hide physical fields, show logical message
        if (nodePhysicalFields) nodePhysicalFields.style.display = 'none';
        if (nodeLogicalMessage) nodeLogicalMessage.style.display = 'block';

        // Hide connection type filters (location mode only)
        // Node filter remains visible in both modes
        if (connectionTypesSection) connectionTypesSection.style.display = 'none';
    } else {
        indicator.style.background = '#d1ecf1';
        indicator.style.borderColor = '#0c5460';
        currentModeDiv.innerHTML = '<strong>📍 Physical Location View</strong>';
        descriptionDiv.textContent = 'Organized by physical location: hall/aisle/rack/shelf (ignores logical topology)';

        // Show physical fields, hide logical message
        if (nodePhysicalFields) nodePhysicalFields.style.display = 'block';
        if (nodeLogicalMessage) nodeLogicalMessage.style.display = 'none';

        // Show connection type filters (location mode only)
        // Node filter remains visible in both modes
        if (connectionTypesSection) connectionTypesSection.style.display = 'block';

        // Hide Graph Template section in location mode
        if (addGraphSection) addGraphSection.style.display = 'none';

        // Preserve Add Node section visibility if connection editing is enabled
        if (addNodeSection && wasAddNodeSectionVisible && state.editing.isEdgeCreationMode) {
            addNodeSection.style.display = 'block';
        }
    }

    // Update Add Node button state after mode indicator update
    updateAddNodeButtonState();
}

/**
 * Extract graph templates from loaded data metadata
 * @param {Object} data - The visualization data
 */
function extractGraphTemplates(data) {
    state.data.availableGraphTemplates = {};

    // Check if metadata contains graph_templates
    if (data.metadata && data.metadata.graph_templates) {
        // Clean up duplicates before storing templates
        const cleanedTemplates = {};
        for (const [templateName, template] of Object.entries(data.metadata.graph_templates)) {
            const cleanedTemplate = { ...template };

            // Remove duplicate children by name
            if (cleanedTemplate.children && Array.isArray(cleanedTemplate.children)) {
                const seenNames = new Set();
                const uniqueChildren = [];

                cleanedTemplate.children.forEach(child => {
                    if (!seenNames.has(child.name)) {
                        seenNames.add(child.name);
                        uniqueChildren.push(child);
                    } else {
                        console.warn(`[extractGraphTemplates] Found duplicate child "${child.name}" in template "${templateName}" from import. Removing duplicate.`);
                    }
                });

                cleanedTemplate.children = uniqueChildren;
            }

            cleanedTemplates[templateName] = cleanedTemplate;
        }

        state.data.availableGraphTemplates = cleanedTemplates;

        console.log(`[extractGraphTemplates] Loaded ${Object.keys(cleanedTemplates).length} templates`);
    } else {
    }

    // Update the dropdown
    populateGraphTemplateDropdown();
}

/**
 * Populate the graph template dropdown with available templates
 */
function populateGraphTemplateDropdown() {
    const graphTemplateSelect = document.getElementById('graphTemplateSelect');
    if (!graphTemplateSelect) return;

    // Clear existing options
    graphTemplateSelect.innerHTML = '';

    const templateCount = Object.keys(state.data.availableGraphTemplates).length;

    if (templateCount === 0) {
        // No templates available - show message
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No graph templates available (load a textproto first)';
        option.disabled = true;
        graphTemplateSelect.appendChild(option);

        // Disable the Add Graph button
        const addGraphBtn = document.getElementById('addGraphBtn');
        if (addGraphBtn) {
            addGraphBtn.disabled = true;
            addGraphBtn.style.cursor = 'not-allowed';
            addGraphBtn.style.background = '#6c757d';
            addGraphBtn.style.opacity = '0.6';
        }
    } else {
        // Add placeholder option first
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select a template to instantiate...';
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        graphTemplateSelect.appendChild(placeholderOption);

        // Add available templates
        Object.keys(state.data.availableGraphTemplates).sort().forEach(templateName => {
            const option = document.createElement('option');
            option.value = templateName;
            option.textContent = `${templateName} (Graph Template)`;
            graphTemplateSelect.appendChild(option);
        });

    }
}

/**
 * Toggle between hierarchy and location visualization modes
 */
function toggleVisualizationMode() {
    if (!state.cy) {
        alert('No visualization loaded. Please upload a file first.');
        return;
    }

    // Toggle the mode
    const newMode = state.mode === 'hierarchy' ? 'location' : 'hierarchy';

    // Restructure the visualization based on the new mode
    if (newMode === 'location') {
        // Check if we need to show the physical layout specification modal
        // This happens on first switch to location mode when nodes don't have physical locations
        const shelfNodes = state.cy.nodes('[type="shelf"]');

        // Check if ANY node has physical location data
        const hasPhysicalLocations = shelfNodes.length > 0 && shelfNodes.some(node => {
            const data = node.data();
            return data.hall || data.aisle || (data.rack_num !== undefined && data.rack_num !== null);
        });

        // Check if this is the first time switching
        const physicalLayoutAssigned = sessionStorage.getItem('physicalLayoutAssigned') === 'true';

        // Show modal if nodes don't have physical locations (ignore session flag for now)
        console.log('Checking physical locations:', {
            shelfNodesCount: shelfNodes.length,
            hasPhysicalLocations: hasPhysicalLocations,
            physicalLayoutAssigned: physicalLayoutAssigned
        });

        if (shelfNodes.length > 0 && !hasPhysicalLocations) {
            console.log('No physical locations found, showing modal');
            // DON'T set the mode yet - wait for user to apply or cancel
            showPhysicalLayoutModal();
            return; // Don't proceed with switch - will be done after modal is applied
        } else {
            console.log('Skipping modal - physical locations exist or no nodes');
        }

        // Set the new mode only if we're not showing the modal
        setVisualizationMode(newMode);

        // Update the connection legend based on the new mode if we have initial data
        if (initialVisualizationData) {
            updateConnectionLegend(initialVisualizationData);
        }

        // Switching to location mode: remove hierarchical containers and reorganize by location
        locationModule.switchMode();

        // Ensure currentData exists for button state (preserve it if it exists, or create minimal structure)
        if (!state.data.currentData && state.cy) {
            state.data.currentData = {
                elements: state.cy.elements().jsons(),
                metadata: state.data.hierarchyModeState?.metadata || {}
            };
        }

        // Update Add Node button state after mode switch
        updateAddNodeButtonState();

        // Update node filter dropdown to reflect location mode labels
        if (typeof populateNodeFilterDropdown === 'function') {
            populateNodeFilterDropdown();
        }
        // Template filter is hierarchy mode only, so don't populate in location mode
    } else {
        // Set the new mode
        setVisualizationMode(newMode);

        // Update the connection legend based on the new mode if we have initial data
        if (initialVisualizationData) {
            updateConnectionLegend(initialVisualizationData);
        }

        // Switching to hierarchy mode: restore original hierarchical structure
        hierarchyModule.switchMode();

        // Ensure currentData exists for button state
        if (!state.data.currentData && state.cy) {
            state.data.currentData = {
                elements: state.cy.elements().jsons(),
                metadata: state.data.hierarchyModeState?.metadata || {}
            };
        }

        // Update Add Node button state after mode switch
        updateAddNodeButtonState();

        // Update node filter dropdown to reflect hierarchy mode labels
        if (typeof populateNodeFilterDropdown === 'function') {
            populateNodeFilterDropdown();
        }
        // Update template filter dropdown (hierarchy mode only)
        if (typeof populateTemplateFilterDropdown === 'function') {
            populateTemplateFilterDropdown();
        }
    }


    // Show a status message
    const modeLabel = newMode === 'hierarchy' ? 'Logical Topology View' : 'Physical Location View';
    showExportStatus(`Switched to ${modeLabel}`, 'success');

    setTimeout(() => {
        const statusDiv = document.getElementById('rangeStatus');
        if (statusDiv) {
            statusDiv.textContent = '';
        }
    }, 2000);
}

/**
 * Recolor connections for physical view using simple intra/inter-node coloring
 */


/**
 * LOCATION MODE: Switch to physical location view - rebuild visualization from physical location data only
 * Ignores all logical topology fields and rebuilds from scratch based on hall/aisle/rack/shelf_u
 */
// NOTE: Function moved to LocationModule.switchMode()
function location_switchMode() {
    locationModule.switchMode();
}

// NOTE: Function moved to HierarchyModule.switchMode()
function hierarchy_switchMode() {
    hierarchyModule.switchMode();
}

/**
 * HIERARCHY MODE: Switch to logical topology view - rebuild visualization from logical topology data only
 * Ignores all physical location fields and rebuilds from scratch based on logical_path
 */



/**
 * Organize nodes in a simple grid when no location info is available
 */
function organizeInGrid() {

    const shelfNodes = state.cy.nodes('[type="shelf"]');
    const cols = 3;
    const spacing = 500;
    const startX = 300;
    const startY = 300;

    shelfNodes.forEach((node, idx) => {
        // Remove from any parent
        node.move({ parent: null });

        // Position in grid
        const col = idx % cols;
        const row = Math.floor(idx / cols);

        node.position({
            x: startX + col * spacing,
            y: startY + row * spacing
        });
    });

    // Fit view to show all nodes
    state.cy.fit(null, 50);
}

// Node configurations - now loaded from server-side to ensure consistency
// This will be populated from window.SERVER_NODE_CONFIGS injected by the server
let NODE_CONFIGS = {};

// Initialize NODE_CONFIGS from server-side data
function initializeNodeConfigs() {
    // Initialize using the config module
    if (window.SERVER_NODE_CONFIGS && Object.keys(window.SERVER_NODE_CONFIGS).length > 0) {
        NODE_CONFIGS = initNodeTypesConfig(window.SERVER_NODE_CONFIGS);
    } else {
        NODE_CONFIGS = initNodeTypesConfig();
    }
}

function getNextConnectionNumber() {
    if (!cy) return 0;

    // Get all existing edges and find the highest connection number
    const allEdges = state.cy.edges();
    let maxConnectionNumber = -1;

    allEdges.forEach(edge => {
        const connectionNum = edge.data('connection_number');
        if (typeof connectionNum === 'number' && connectionNum > maxConnectionNumber) {
            maxConnectionNumber = connectionNum;
        }
    });

    // Return the next number (0 if no connections exist, otherwise max + 1)
    return maxConnectionNumber + 1;
}

function getEthChannelMapping(nodeType, portNumber) {
    // Get the node type from 2 levels above the port (shelf level)
    if (!nodeType || !portNumber) return 'Unknown';

    const nodeTypeUpper = nodeType.toUpperCase();

    // Define eth channel mappings based on node type and port number
    switch (nodeTypeUpper) {
        case 'N300_LB':
        case 'N300_QB':
            // N300 nodes: 2 ports per tray, specific channel mapping
            if (portNumber === 1) return 'ASIC: 0 Channel: 6-7';
            if (portNumber === 2) return 'ASIC: 0 Channel: 0-1';
            break;

        case 'WH_GALAXY':
            // WH_GALAXY: 6 ports per tray,
            if (portNumber === 1) return 'ASIC: 5 Channel: 4-7';
            if (portNumber === 2) return 'ASIC: 1 Channel: 4-7';
            if (portNumber === 3) return 'ASIC: 1 Channel: 0-3';
            if (portNumber === 4) return 'ASIC: 2 Channel: 0-3';
            if (portNumber === 5) return 'ASIC: 3 Channel: 0-3';
            if (portNumber === 6) return 'ASIC: 4 Channel: 0-3';
            break;

        case 'BH_GALAXY':
            // BH_GALAXY: 14 ports per tray
            if (portNumber === 1) return 'ASIC: 5 Channel: 2-3';
            if (portNumber === 2) return 'ASIC: 1 Channel: 2-3';
            if (portNumber === 3) return 'ASIC: 1 Channel: 0-1';
            if (portNumber === 4) return 'ASIC: 2 Channel: 0-1';
            if (portNumber === 5) return 'ASIC: 3 Channel: 0-1';
            if (portNumber === 6) return 'ASIC: 4 Channel: 0-1';
            if (portNumber === 7) return 'ASIC: 1 Channel: 10, ASIC: 2 Channel: 10';
            if (portNumber === 8) return 'ASIC: 5 Channel: 10, ASIC: 6 Channel: 10';
            if (portNumber === 9) return 'ASIC: 3 Channel: 10, ASIC: 4 Channel: 10';
            if (portNumber === 10) return 'ASIC: 7 Channel: 10, ASIC: 8 Channel: 10';
            if (portNumber === 11) return 'ASIC: 1 Channel: 11, ASIC: 2 Channel: 11';
            if (portNumber === 12) return 'ASIC: 5 Channel: 11, ASIC: 6 Channel: 11';
            if (portNumber === 13) return 'ASIC: 3 Channel: 11, ASIC: 4 Channel: 11';
            if (portNumber === 14) return 'ASIC: 7 Channel: 11, ASIC: 8 Channel: 11';
            break;

        case 'P150_QB_GLOBAL':
        case 'P150_QB_AMERICA':
        case 'P150_LB':
            // P150 nodes: 4 ports per tray (4 trays for QB variants, 8 trays for LB), specific channel mapping
            if (portNumber === 1) return 'ASIC: 0 Channel: 9, ASIC: 0 Channel: 11';
            if (portNumber === 2) return 'ASIC: 0 Channel: 8, ASIC: 0 Channel: 10';
            if (portNumber === 3) return 'ASIC: 0 Channel: 5, ASIC: 0 Channel: 7';
            if (portNumber === 4) return 'ASIC: 0 Channel: 4, ASIC: 0 Channel: 6';
            break;
    }

    return `Eth${portNumber - 1}`; // Default fallback
}

function updateDeleteButtonState() {
    const deleteBtn = document.getElementById('deleteElementBtn');
    if (!deleteBtn) return; // Button might not exist yet

    // Check for both single selections and multi-selections
    const hasConnection = state.editing.selectedConnection && state.editing.selectedConnection.length > 0;
    const hasNode = state.editing.selectedNode && state.editing.selectedNode.length > 0;

    // Also check cytoscape multi-selections
    const selectedNodes = cy ? state.cy.nodes(':selected') : [];
    const selectedEdges = cy ? state.cy.edges(':selected') : [];
    const hasMultipleSelections = selectedNodes.length > 0 || selectedEdges.length > 0;

    let isDeletable = false;

    // Check single node selection
    if (hasNode) {
        const nodeType = state.editing.selectedNode.data('type');
        isDeletable = ['shelf', 'rack', 'graph'].includes(nodeType);
    }

    // Check if any multi-selected nodes are deletable
    if (selectedNodes.length > 0) {
        isDeletable = isDeletable || selectedNodes.some(node => {
            const nodeType = node.data('type');
            return ['shelf', 'rack', 'graph'].includes(nodeType);
        });
    }

    if (state.editing.isEdgeCreationMode && (hasConnection || isDeletable || hasMultipleSelections)) {
        deleteBtn.disabled = false;
        deleteBtn.style.opacity = '1';
        deleteBtn.style.cursor = 'pointer';
    } else {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.5';
        deleteBtn.style.cursor = 'not-allowed';
    }
}

// Alias that calls updateDeleteButtonState
function updateDeleteNodeButtonState() {
    updateDeleteButtonState();
}

// ===== Utility Functions =====

/**
 * Format rack and shelf_u numbers with zero-padding
 */
// Delegate to location module
function formatRackNum(rackNum) {
    return locationModule.formatRackNum(rackNum);
}

function formatShelfU(shelfU) {
    return locationModule.formatShelfU(shelfU);
}

/**
 * Build hierarchical location label from location components
 * @param {string} hall - Hall identifier
 * @param {string} aisle - Aisle identifier
 * @param {number|string} rackNum - Rack number
 * @param {number|string} shelfU - Shelf U position (optional)
 * @returns {string} Formatted location label (e.g., "H1A205" or "H1A205U12")
 */
// Delegate to location module
function location_buildLabel(hall, aisle, rackNum, shelfU = null) {
    return locationModule.buildLabel(hall, aisle, rackNum, shelfU);
}

/**
 * LOCATION MODE: Get location data from a node or its parent hierarchy
 * @param {Object} node - Cytoscape node
 * @returns {Object} Location data {hall, aisle, rack_num, shelf_u, hostname}
 */
function location_getNodeData(node) {
    const data = node.data();

    // If node has all location data, return it
    if (data.hall && data.aisle && data.rack_num !== undefined) {
        return {
            hall: data.hall,
            aisle: data.aisle,
            rack_num: data.rack_num,
            shelf_u: data.shelf_u,
            hostname: data.hostname || ''
        };
    }

    // Try to get from parent hierarchy (for tray/port nodes)
    if (data.type === 'port' || data.type === 'tray') {
        const parentNode = node.parent();
        if (parentNode && parentNode.length > 0) {
            if (data.type === 'port') {
                // Port: go up to tray, then shelf
                const shelfNode = parentNode.parent();
                if (shelfNode && shelfNode.length > 0) {
                    return location_getNodeData(shelfNode);
                }
            } else {
                // Tray: go up to shelf
                return location_getNodeData(parentNode);
            }
        }
    }

    // Return whatever we have
    return {
        hall: data.hall || '',
        aisle: data.aisle || '',
        rack_num: data.rack_num,
        shelf_u: data.shelf_u,
        hostname: data.hostname || ''
    };
}

/**
 * Get display label for a node based on priority:
 * 1. Hostname (if available)
 * 2. Location format (if all location data available)
 * 3. Type-specific label (e.g., "Shelf {U}")
 * 4. Existing label
 * 5. Node ID
 * @param {Object} nodeData - Node data object
 * @returns {string} Display label
 */
// NOTE: Function moved to CommonModule.getNodeDisplayLabel()
function getNodeDisplayLabel(nodeData) {
    return commonModule.getNodeDisplayLabel(nodeData, locationModule);
}

/**
 * Build hierarchical path for a node (for descriptor/textproto imports)
 * @param {Object} node - Cytoscape node
 * @returns {string} Hierarchical path (e.g., "superpod1 > node2 > shelf")
 */
// Delegate to hierarchy module
function hierarchy_getPath(node) {
    return hierarchyModule.getPath(node);
}

// ===== Event Handler Helpers =====

/**
 * Handle port click in editing mode
 */
function handlePortClickEditMode(node, evt) {
    const portId = node.id();
    const existingConnections = state.cy.edges(`[source="${portId}"], [target="${portId}"]`);

    // If port is already connected, select the connection
    if (existingConnections.length > 0) {
        const edge = existingConnections[0]; // Only one connection per port

        // Clear source port selection if any
        if (state.editing.selectedFirstPort) {
            state.editing.selectedFirstPort.removeClass('source-selected');
            state.editing.selectedFirstPort = null;
        }

        // Select this connection
        if (state.editing.selectedConnection) {
            state.editing.selectedConnection.removeClass('selected-connection');
        }
        state.editing.selectedConnection = edge;
        edge.addClass('selected-connection');

        // Show port info and update UI
        showNodeInfo(node, evt.renderedPosition || evt.position);
        updateDeleteButtonState();
        return;
    }

    // Port is unconnected - handle connection creation
    if (!state.editing.selectedFirstPort) {
        // First click - select source port
        state.editing.selectedFirstPort = node;
        state.editing.selectedFirstPort.addClass('source-selected');
    } else {
        // Second click - create connection
        const targetPort = node;

        // Can't connect port to itself
        if (state.editing.selectedFirstPort.id() === targetPort.id()) {
            state.editing.selectedFirstPort.removeClass('source-selected');
            state.editing.selectedFirstPort = null;
            return;
        }

        // Create the connection
        createConnection(state.editing.selectedFirstPort.id(), targetPort.id());

        // Clear source port selection
        state.editing.selectedFirstPort.removeClass('source-selected');
        state.editing.selectedFirstPort = null;
    }
}

/**
 * Handle port click in view mode (not editing)
 */
function handlePortClickViewMode(node, evt) {
    const portId = node.id();
    const connectedEdges = state.cy.edges(`[source="${portId}"], [target="${portId}"]`);

    if (connectedEdges.length > 0) {
        // Port has connection - select it
        const edge = connectedEdges[0]; // Only one connection per port

        if (state.editing.selectedConnection) {
            state.editing.selectedConnection.removeClass('selected-connection');
        }

        state.editing.selectedConnection = edge;
        edge.addClass('selected-connection');
        showNodeInfo(node, evt.renderedPosition || evt.position);
    } else {
        // Port has no connection - just show info
        if (state.editing.selectedConnection) {
            state.editing.selectedConnection.removeClass('selected-connection');
            state.editing.selectedConnection = null;
            updateDeleteButtonState();
        }
        showNodeInfo(node, evt.renderedPosition || evt.position);
    }
}

/**
 * Clear all selection state
 */
// NOTE: Function moved to CommonModule.clearAllSelections()
function clearAllSelections() {
    commonModule.clearAllSelections();
}

// ===== End Event Handler Helpers =====

// NOTE: Function moved to CommonModule.getPortLocationInfo()
function getPortLocationInfo(portNode) {
    return commonModule.getPortLocationInfo(portNode, locationModule);
}

// NOTE: deleteSelectedConnection() removed - functionality consolidated into deleteMultipleSelected()
// NOTE: deleteConnectionFromAllTemplateInstances() moved to utils/node-management.js

/**
 * Update a parent template definition to include a new child graph
 * @param {string} parentTemplateName - The parent template to update
 * @param {string} childTemplateName - The child template to add
 * @param {string} childLabel - The label/name for the child in the template
 */
// NOTE: Function moved to HierarchyModule.updateTemplateWithNewChild()
function updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel) {
    hierarchyModule.updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel);
}

/**
 * Recalculate host_indices for all template instances using DFS traversal.
 * This ensures host indices are assigned in a consistent, predictable order based on
 * the graph hierarchy structure.
 * 
 * Strategy:
 * 1. Find all root graph nodes (graphs with no parent)
 * 2. Perform DFS traversal starting from each root
 * 3. When encountering a shelf node, assign it the next host_index
 * 4. When encountering a graph node, recursively traverse its children
 * 5. Sort siblings by child_name before processing to maintain consistent ordering
 */
// NOTE: Function moved to HierarchyModule.recalculateHostIndicesForTemplates()
function recalculateHostIndicesForTemplates() {
    hierarchyModule.recalculateHostIndicesForTemplates();
}

// NOTE: Function moved to HierarchyModule.deleteChildGraphFromAllTemplateInstances()
function deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName) {
    hierarchyModule.deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName);
}

// NOTE: Function moved to HierarchyModule.deleteChildNodeFromAllTemplateInstances()
function deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, childType) {
    hierarchyModule.deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, childType);
}

function deleteChildNodeFromAllTemplateInstances_OLD(childName, parentTemplateName, childType) {

    // First, verify that the child actually exists in the parent template definition
    // This ensures we only delete from the correct template, not other templates with same child name
    // For shelves, they can be either:
    // 1. Direct children of the parent template
    // 2. Children of a child graph (in which case they're defined in the child graph's template)
    let childExistsInTemplate = false;
    let childGraphName = null; // Track which child graph contains the shelf (if applicable)

    if (state.data.availableGraphTemplates[parentTemplateName]) {
        const parentTemplate = state.data.availableGraphTemplates[parentTemplateName];
        if (parentTemplate.children) {
            // Check for direct child match
            childExistsInTemplate = parentTemplate.children.some(child =>
                child.name === childName &&
                ((childType === 'shelf' && child.type === 'node') ||
                    (childType === 'graph' && child.type === 'graph'))
            );

            // If not found and it's a shelf, check if it's in a child graph's template
            if (!childExistsInTemplate && childType === 'shelf') {
                for (const child of parentTemplate.children) {
                    if (child.type === 'graph' && child.graph_template) {
                        // Check if the child graph's template contains this shelf
                        const childGraphTemplate = state.data.availableGraphTemplates[child.graph_template];
                        if (childGraphTemplate && childGraphTemplate.children) {
                            const shelfInChildGraph = childGraphTemplate.children.some(c =>
                                c.name === childName && c.type === 'node'
                            );
                            if (shelfInChildGraph) {
                                childExistsInTemplate = true;
                                childGraphName = child.name;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Also check metadata
    if (!childExistsInTemplate && state.data.currentData && state.data.currentData.metadata &&
        state.data.currentData.metadata.graph_templates) {
        const parentTemplate = state.data.currentData.metadata.graph_templates[parentTemplateName];
        if (parentTemplate && parentTemplate.children) {
            // Check for direct child match
            childExistsInTemplate = parentTemplate.children.some(child =>
                child.name === childName &&
                ((childType === 'shelf' && child.type === 'node') ||
                    (childType === 'graph' && child.type === 'graph'))
            );

            // If not found and it's a shelf, check if it's in a child graph's template
            if (!childExistsInTemplate && childType === 'shelf') {
                for (const child of parentTemplate.children) {
                    if (child.type === 'graph' && child.graph_template) {
                        const childGraphTemplate = state.data.currentData.metadata.graph_templates[child.graph_template];
                        if (childGraphTemplate && childGraphTemplate.children) {
                            const shelfInChildGraph = childGraphTemplate.children.some(c =>
                                c.name === childName && c.type === 'node'
                            );
                            if (shelfInChildGraph) {
                                childExistsInTemplate = true;
                                childGraphName = child.name;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if (!childExistsInTemplate) {
        console.warn(`Child "${childName}" not found in template "${parentTemplateName}" definition. Skipping deletion to prevent cross-template deletion.`);
        return;
    }

    // Find all instances of the parent template (including empty ones)
    const parentTemplateInstances = state.cy.nodes().filter(node =>
        node.data('type') === 'graph' &&
        node.data('template_name') === parentTemplateName
    );


    let deletedCount = 0;

    // For each parent instance, find and delete the matching child node
    parentTemplateInstances.forEach(parentInstance => {
        const parentLabel = parentInstance.data('label');
        const parentId = parentInstance.id();

        // Find direct children first, then check if they match
        // This ensures we only delete nodes that are direct children of this specific template instance
        const directChildren = parentInstance.children();

        // Filter to find nodes that match the child_name and are direct children
        // For shelf nodes, we need to check if they're direct children or in a direct child graph
        const matchingChildNodes = [];

        directChildren.forEach(directChild => {
            if (directChild.data('type') === childType) {
                // Direct child of the correct type - verify it matches the child name
                if (directChild.data('child_name') === childName || directChild.data('label') === childName) {
                    matchingChildNodes.push(directChild);
                }
            } else if (directChild.data('type') === 'graph' && childType === 'shelf') {
                // For shelf nodes within child graphs, verify:
                // 1. If childGraphName is set, only search in that specific child graph
                // 2. If childGraphName is null, the shelf is a direct child, so skip child graphs

                if (childGraphName !== null) {
                    // Shelf is in a child graph - only match if this is the correct child graph
                    const childGraphInstanceName = directChild.data('child_name') || directChild.data('label');

                    if (childGraphInstanceName === childGraphName) {
                        // Find shelves that are direct children of this child graph
                        const shelvesInGraph = directChild.children().filter(desc =>
                            desc.data('type') === childType &&
                            (desc.data('child_name') === childName || desc.data('label') === childName)
                        );

                        // Verify each shelf's parent is actually this direct child graph
                        shelvesInGraph.forEach(shelf => {
                            const shelfParent = shelf.parent();
                            if (shelfParent.length > 0 && shelfParent.id() === directChild.id()) {
                                matchingChildNodes.push(shelf);
                            }
                        });
                    }
                }
                // If childGraphName is null, shelf is a direct child, so we skip child graphs
            }
        });

        if (matchingChildNodes.length > 0) {
            matchingChildNodes.forEach(childNode => {
                // Verify this node is actually a descendant of the parent instance
                // Double-check to ensure we're not deleting from wrong template
                const ancestors = childNode.ancestors();
                const isDescendantOfParent = ancestors.some(anc => anc.id() === parentId) || childNode.parent().id() === parentId;

                if (isDescendantOfParent) {
                    childNode.remove(); // This will also remove all descendants (trays, ports, etc.)
                    deletedCount++;
                } else {
                    console.warn(`Skipping deletion of ${childName} - not a descendant of parent template instance ${parentId}`);
                }
            });
        }
    });

    console.log(`Deleted ${childType} from ${deletedCount} template instance(s)`);

    // Update template definition in state.data.availableGraphTemplates
    if (state.data.availableGraphTemplates[parentTemplateName]) {
        const parentTemplate = state.data.availableGraphTemplates[parentTemplateName];
        if (parentTemplate.children) {
            // Remove the child from the template definition
            parentTemplate.children = parentTemplate.children.filter(child =>
                child.name !== childName
            );
        }

        // Remove connections that reference the deleted child
        if (parentTemplate.connections && parentTemplate.connections.length > 0) {
            const originalConnectionCount = parentTemplate.connections.length;
            parentTemplate.connections = parentTemplate.connections.filter(conn => {
                // Check if port_a path includes the deleted child
                const portAReferencesChild = conn.port_a && conn.port_a.path &&
                    conn.port_a.path.includes(childName);
                // Check if port_b path includes the deleted child
                const portBReferencesChild = conn.port_b && conn.port_b.path &&
                    conn.port_b.path.includes(childName);

                // Keep connection only if it doesn't reference the deleted child
                return !portAReferencesChild && !portBReferencesChild;
            });

            const removedConnections = originalConnectionCount - parentTemplate.connections.length;
            if (removedConnections > 0) {
                console.log(`Removed ${removedConnections} connection(s) referencing deleted ${childType} "${childName}" from state.data.availableGraphTemplates["${parentTemplateName}"]`);
            }
        }
    }

    // Update template definition in metadata
    if (state.data.currentData && state.data.currentData.metadata && state.data.currentData.metadata.graph_templates) {
        const parentTemplate = state.data.currentData.metadata.graph_templates[parentTemplateName];
        if (parentTemplate && parentTemplate.children) {
            // Remove the child from the template definition
            parentTemplate.children = parentTemplate.children.filter(child =>
                child.name !== childName
            );

            // Remove connections that reference the deleted child
            if (parentTemplate.connections && parentTemplate.connections.length > 0) {
                const originalConnectionCount = parentTemplate.connections.length;
                parentTemplate.connections = parentTemplate.connections.filter(conn => {
                    // Check if port_a path includes the deleted child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        conn.port_a.path.includes(childName);
                    // Check if port_b path includes the deleted child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the deleted child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - parentTemplate.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing deleted ${childType} "${childName}" from metadata graph_templates["${parentTemplateName}"]`);
                }
            }
        }
    }
}

/**
 * Extract port pattern from a port node for template matching
 * Returns { path: [...], trayId, portId } or null
 * 
 * @param {object} portNode - The port node to extract pattern from
 * @param {object} placementLevel - The graph node representing the placement level (optional)
 * 
 * If placementLevel is provided, returns the full hierarchical path from that level to the port.
 * Otherwise, returns just the shelf name.
 */

/**
 * Find the common ancestor graph node for two nodes
 * Returns the lowest common ancestor that is a graph node, or null
 */
// Delegate to hierarchy module
function findCommonAncestorGraph(node1, node2) {
    return hierarchyModule.findCommonAncestor(node1, node2);
}

function findCommonAncestorGraph_old(node1, node2) {
    // Get all graph ancestors for node1
    const ancestors1 = [];
    let current = node1.parent();
    while (current && current.length > 0) {
        if (current.isParent() && current.data('type') === 'graph') {
            ancestors1.push(current);
        }
        current = current.parent();
    }

    // Find the first common graph ancestor by traversing node2's parents
    current = node2.parent();
    while (current && current.length > 0) {
        if (current.isParent() && current.data('type') === 'graph') {
            // Check if this ancestor is in node1's ancestor list
            const commonAncestor = ancestors1.find(a => a.id() === current.id());
            if (commonAncestor) {
                return commonAncestor;  // Return the lowest (first found) common ancestor
            }
        }
        current = current.parent();
    }

    return null;  // No common graph ancestor
}

// NOTE: Function moved to HierarchyModule.enumerateValidParentTemplates()
function enumerateValidParentTemplates(node) {
    return hierarchyModule.enumerateValidParentTemplates(node);
}

/**
 * Enumerate all possible placement levels for a connection between two ports
 * Returns array of placement options from closest common parent to root
 * Each option includes the graph node, template name, depth, and duplication count
 * Filters out levels where connections already exist
 */
function enumeratePlacementLevels(sourcePort, targetPort) {
    const placementLevels = [];

    // Find closest common ancestor that is NOT a shelf node
    const sourceShelf = getParentAtLevel(state.editing.selectedFirstPort, 2);  // Port -> Tray -> Shelf
    const targetShelf = getParentAtLevel(targetPort, 2);

    if (!sourceShelf || !targetShelf) {
        console.error('Could not find shelf nodes for ports');
        return placementLevels;
    }

    // Get all graph ancestors for source shelf
    const sourceAncestors = [];
    let current = sourceShelf.parent();
    while (current && current.length > 0) {
        if (current.isParent() && current.data('type') === 'graph') {
            sourceAncestors.push(current);
        }
        current = current.parent();
    }

    // Get all graph ancestors for target shelf
    const targetAncestors = [];
    current = targetShelf.parent();
    while (current && current.length > 0) {
        if (current.isParent() && current.data('type') === 'graph') {
            targetAncestors.push(current);
        }
        current = current.parent();
    }

    // Find all common ancestors (from closest to root)
    for (let i = 0; i < sourceAncestors.length; i++) {
        const sourceAncestor = sourceAncestors[i];
        const matchIndex = targetAncestors.findIndex(a => a.id() === sourceAncestor.id());

        if (matchIndex >= 0) {
            // This is a common ancestor
            const graphNode = sourceAncestor;
            const template_name = graphNode.data('template_name') || graphNode.data('label') || 'unknown';
            const depth = graphNode.data('depth') || 0;
            const label = graphNode.data('label') || graphNode.id();

            // Calculate duplication count at this level
            const duplicationCount = calculateDuplicationCount(graphNode, sourceShelf, targetShelf);

            // Check if this level is available (no existing connections blocking it)
            const isAvailable = isPlacementLevelAvailable(state.editing.selectedFirstPort, targetPort, graphNode, template_name, sourceShelf, targetShelf);

            console.log(`[enumeratePlacementLevels] Level: ${label} (${template_name}), depth: ${depth}, available: ${isAvailable}, duplicationCount: ${duplicationCount}`);

            if (isAvailable) {
                placementLevels.push({
                    graphNode: graphNode,
                    template_name: template_name,
                    depth: depth,
                    label: label,
                    duplicationCount: duplicationCount
                });
            }
        }
    }

    return placementLevels;
}

/**
 * Find a port node by following a hierarchical path from a starting graph node
 * 
 * @param {Object} graphNode - The starting graph node
 * @param {Array} path - Array of node names to traverse (e.g., ["dim0_group0", "dim1_node0"])
 * @param {number} trayId - The tray ID
 * @param {number} portId - The port ID
 * @returns {Object|null} The port node if found, null otherwise
 */

/**
 * Check if a placement level is available (no existing connections would conflict)
 * 
 * For template-level: Available ONLY if ALL instances of the PLACEMENT template have both ports free
 * For instance-specific: Available if THESE SPECIFIC ports are free
 * 
 * @param {Object} state.editing.selectedFirstPort - Source port node
 * @param {Object} targetPort - Target port node
 * @param {Object} placementGraphNode - The graph node representing the placement level
 * @param {string} placementTemplateName - Template name of the placement level
 * @param {Object} sourceShelf - Source shelf node
 * @param {Object} targetShelf - Target shelf node
 * @returns {boolean} True if the level is available
 */
function isPlacementLevelAvailable(sourcePort, targetPort, placementGraphNode, placementTemplateName, sourceShelf, targetShelf) {
    // If placementTemplateName is defined, it's a template-level connection
    const isTemplateLevel = placementTemplateName !== null && placementTemplateName !== 'unknown';

    console.log(`[isPlacementLevelAvailable] Checking ${placementTemplateName}, isTemplateLevel: ${isTemplateLevel}`);
    console.log(`[isPlacementLevelAvailable] state.editing.selectedFirstPort: ${state.editing.selectedFirstPort.id()}, targetPort: ${targetPort.id()}`);
    console.log(`[isPlacementLevelAvailable] sourceShelf: ${sourceShelf.id()}, targetShelf: ${targetShelf.id()}`);

    if (isTemplateLevel) {
        // Template-level: Available ONLY if ALL instances of the placement template have both ports free

        // First, extract the pattern relative to the PLACEMENT LEVEL
        // This gives us the template-relative pattern that should exist in all instances
        const sourcePattern = hierarchyModule.extractPortPattern(state.editing.selectedFirstPort, placementGraphNode);
        const targetPattern = hierarchyModule.extractPortPattern(targetPort, placementGraphNode);

        console.log(`[isPlacementLevelAvailable] Template pattern from ${placementGraphNode.id()}:`);
        console.log(`[isPlacementLevelAvailable]   sourcePattern:`, sourcePattern);
        console.log(`[isPlacementLevelAvailable]   targetPattern:`, targetPattern);

        if (!sourcePattern || !targetPattern) {
            // Ports are not descendants of the placement level
            console.warn(`[isPlacementLevelAvailable] Ports not descendants of placement level ${placementGraphNode.id()}`);
            return false;
        }

        // Find all instances of the PLACEMENT template (including empty ones)
        const templateGraphs = state.cy.nodes().filter(node =>
            node.data('type') === 'graph' && node.data('template_name') === placementTemplateName
        );

        if (templateGraphs.length === 0) {
            return false; // No instances exist
        }

        console.log(`[isPlacementLevelAvailable] Found ${templateGraphs.length} instances of ${placementTemplateName}`);

        // Check ALL instances - if ANY has a conflict, block this level
        for (let i = 0; i < templateGraphs.length; i++) {
            const graph = templateGraphs[i];

            // Find the specific ports in this instance by following the SAME pattern
            const srcPort = hierarchyModule.findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
            const tgtPort = hierarchyModule.findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

            if (!srcPort || !tgtPort) {
                // Ports don't exist in this instance - this means the template structure is inconsistent
                // Block this level as we can't apply the pattern to all instances
                console.log(`[isPlacementLevelAvailable] Template-level: Ports not found in instance ${graph.id()} - blocking level`);
                return false;
            }

            // Check if either port has ANY connection in this instance
            const srcPortConnections = state.cy.edges().filter(e =>
                e.data('source') === srcPort.id() || e.data('target') === srcPort.id()
            );
            const tgtPortConnections = state.cy.edges().filter(e =>
                e.data('source') === tgtPort.id() || e.data('target') === tgtPort.id()
            );

            if (srcPortConnections.length > 0 || tgtPortConnections.length > 0) {
                // Found a conflict in this instance - block this entire level
                console.log(`[isPlacementLevelAvailable] Template-level: Conflict found in instance ${graph.id()}`);
                console.log(`[isPlacementLevelAvailable]   srcPort ${srcPort.id()} has ${srcPortConnections.length} connections`);
                console.log(`[isPlacementLevelAvailable]   tgtPort ${tgtPort.id()} has ${tgtPortConnections.length} connections`);
                return false;
            }

            console.log(`[isPlacementLevelAvailable] Instance ${graph.id()}: ports free`);
        }

        // All instances have free ports - level is available
        console.log(`[isPlacementLevelAvailable] Template-level: All ${templateGraphs.length} instances have free ports`);
        return true;

    } else {
        // Instance-specific: Available if THESE SPECIFIC ports are free
        const sourceId = state.editing.selectedFirstPort.id();
        const targetId = targetPort.id();

        const sourceConnections = state.cy.edges().filter(e =>
            e.data('source') === sourceId || e.data('target') === sourceId
        );
        const targetConnections = state.cy.edges().filter(e =>
            e.data('source') === targetId || e.data('target') === targetId
        );

        console.log(`[isPlacementLevelAvailable] Instance-specific check: source ${sourceId} has ${sourceConnections.length} connections, target ${targetId} has ${targetConnections.length} connections`);

        // Available only if BOTH ports are free
        return sourceConnections.length === 0 && targetConnections.length === 0;
    }
}

/**
 * Calculate how many times a connection would be instantiated if placed at a given level
 * 
 * Template-level connections (where level matches closest common ancestor):
 *   - Will be instantiated in ALL instances of that template
 *   - Count = number of template instances
 * 
 * Instance-specific connections (where level is higher than closest ancestor):
 *   - Single connection with full paths
 *   - Count = number of instances of that template (for display purposes)
 * 
 * Always returns the actual number of instances of the template at this placement level.
 */
function calculateDuplicationCount(graphNode, sourceShelf, targetShelf) {
    // Get the template name of this placement level
    const placementTemplateName = graphNode.data('template_name');

    // Always count how many instances of this template exist (including empty ones)
    const templateInstances = state.cy.nodes().filter(node =>
        node.data('type') === 'graph' && node.data('template_name') === placementTemplateName
    );
    return templateInstances.length;
}

// NOTE: Function consolidated into deleteMultipleSelected()
// Single node deletion is now handled by deleteMultipleSelected() which checks state.editing.selectedNode

// NOTE: Function moved to utils/node-management.js
function deleteMultipleSelected() {
    deleteMultipleSelectedUtil(state, hierarchyModule, commonModule);
}

function deleteSelectedElement() {
    /**
     * Combined delete function that handles single or multiple selections.
     * All deletion logic is now consolidated in deleteMultipleSelected().
     */
    deleteMultipleSelected();
}

// Delegate to common module
function updatePortConnectionStatus() {
    commonModule.updatePortConnectionStatus();
}

function createConnection(sourceId, targetId) {
    const sourceNode = state.cy.getElementById(sourceId);
    const targetNode = state.cy.getElementById(targetId);

    if (!sourceNode.length || !targetNode.length) {
        console.error('Source or target node not found');
        return;
    }

    // Check if either port already has a connection
    const sourceConnections = state.cy.edges(`[source="${sourceId}"], [target="${sourceId}"]`);
    const targetConnections = state.cy.edges(`[source="${targetId}"], [target="${targetId}"]`);

    if (sourceConnections.length > 0) {
        alert(`Cannot create connection: Source port "${sourceNode.data('label')}" is already connected.\n\nEach port can only have one connection. Please disconnect the existing connection first.`);
        return;
    }

    if (targetConnections.length > 0) {
        alert(`Cannot create connection: Target port "${targetNode.data('label')}" is already connected.\n\nEach port can only have one connection. Please disconnect the existing connection first.`);
        return;
    }

    // Check visualization mode - template connections are only for hierarchy mode
    const visualizationMode = getVisualizationMode();

    // In physical/location mode, always create direct connections (no template logic)
    if (visualizationMode === 'location') {
        createConnectionAtLevel(sourceNode, targetNode, null);
        return;
    }

    // In hierarchy mode, check if we have graph hierarchy
    // If so, show placement level selection modal
    const hasGraphHierarchy = state.cy.nodes('[type="graph"]').length > 0;

    if (hasGraphHierarchy) {
        // Enumerate all possible placement levels
        const placementLevels = enumeratePlacementLevels(sourceNode, targetNode);

        if (placementLevels.length === 0) {
            // No valid placement levels available
            alert('Cannot create connection: No valid placement levels available.\n\nAll potential placement levels have conflicts with existing connections.');
            return;
        }

        if (placementLevels.length > 1) {
            // Multiple placement options available - show modal
            showConnectionPlacementModal(sourceNode, targetNode, placementLevels);
            return;
        }

        // Only one option available - use it directly (no modal needed)
        console.log(`[createConnection] Only one placement level available: ${placementLevels[0].label} (${placementLevels[0].template_name})`);
        createConnectionAtLevel(sourceNode, targetNode, placementLevels[0]);
        return;
    }

    // Direct connection creation (no modal needed - no graph hierarchy)
    createConnectionAtLevel(sourceNode, targetNode, null);
}

/**
 * Show the modal for selecting connection placement level
 */
function showConnectionPlacementModal(sourceNode, targetNode, placementLevels) {
    const container = document.getElementById('placementOptionsContainer');
    if (!container) return;

    // Clear previous options
    container.innerHTML = '';

    // Generate placement options
    placementLevels.forEach((level, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'placement-option';

        const instanceText = level.duplicationCount === 1 ? '1 instance' : `${level.duplicationCount} instances`;

        optionDiv.innerHTML = `
            <div class="placement-option-header">
                <div class="placement-level-name">${level.template_name}</div>
            </div>
            <div class="placement-instance-highlight">
                <strong>Instances:</strong> <span class="instance-count-badge">${instanceText}</span>
            </div>
            <div class="placement-option-details">
                <strong>Hierarchy depth:</strong> ${level.depth}
            </div>
        `;

        // Add click handler
        optionDiv.onclick = () => {
            selectConnectionPlacementLevel(sourceNode, targetNode, level);
        };

        container.appendChild(optionDiv);
    });

    // Setup click-outside-to-close and show modal
    modalManager.setupClickOutsideClose('connectionPlacementModal', cancelConnectionPlacement);
    modalManager.show('connectionPlacementModal');
}

/**
 * Handle clicks on the connection placement modal overlay
 * @param {Event} event - Click event
 */
function handleConnectionPlacementModalClick(event) {
    // Only close if clicking directly on the overlay (not on content inside)
    if (event.target.id === 'connectionPlacementModal') {
        cancelConnectionPlacement();
    }
}

/**
 * Handle user selection of a placement level
 */
function selectConnectionPlacementLevel(sourceNode, targetNode, selectedLevel) {
    // Hide modal
    const modal = document.getElementById('connectionPlacementModal');
    modal.classList.remove('active');

    // Create connection at the selected level
    createConnectionAtLevel(sourceNode, targetNode, selectedLevel);
}

/**
 * Cancel connection placement (close modal)
 */
function cancelConnectionPlacement() {
    modalManager.hide('connectionPlacementModal');
}



// ============================================================
// PHYSICAL LAYOUT MODAL FUNCTIONS
// ============================================================

/**
 * Show the physical layout specification modal
 */
function showPhysicalLayoutModal() {
    console.log('showPhysicalLayoutModal called');

    const modal = document.getElementById('physicalLayoutModal');
    console.log('Modal element:', modal);

    if (!modal) {
        console.error('Physical layout modal not found in DOM');
        alert('Error: Physical layout modal not found. Please refresh the page.');
        return;
    }

    // Get all input elements with null checks
    const hallNamesInput = document.getElementById('hallNames');
    const aisleNamesInput = document.getElementById('aisleNames');
    const rackNumbersInput = document.getElementById('rackNumbers');
    const shelfUnitNumbersInput = document.getElementById('shelfUnitNumbers');

    console.log('Input elements:', {
        hallNames: !!hallNamesInput,
        aisleNames: !!aisleNamesInput,
        rackNumbers: !!rackNumbersInput,
        shelfUnitNumbers: !!shelfUnitNumbersInput
    });

    // Verify all elements exist
    if (!hallNamesInput || !aisleNamesInput || !rackNumbersInput || !shelfUnitNumbersInput) {
        console.error('Physical layout modal inputs not found');
        alert('Error: Physical layout modal inputs not found. Please refresh the page.');
        return;
    }

    // Reset to default values
    hallNamesInput.value = 'Building-A';
    aisleNamesInput.value = 'A';
    rackNumbersInput.value = '1-10';
    shelfUnitNumbersInput.value = '1-42';

    // Update capacity display
    updateTotalCapacity();

    // Add event listeners for real-time capacity updates
    const inputs = [hallNamesInput, aisleNamesInput, rackNumbersInput, shelfUnitNumbersInput];
    inputs.forEach(input => {
        input.removeEventListener('input', updateTotalCapacity);
        input.addEventListener('input', updateTotalCapacity);
    });

    // Add click handler to close modal when clicking outside
    modal.removeEventListener('click', handlePhysicalLayoutModalClick);
    modal.addEventListener('click', handlePhysicalLayoutModalClick);

    // Show modal
    console.log('Adding active class to modal');
    modal.classList.add('active');
    console.log('Modal should now be visible, classes:', modal.classList.toString());
}

/**
 * Handle clicks on the physical layout modal overlay
 * @param {Event} event - Click event
 */
function handlePhysicalLayoutModalClick(event) {
    // Only close if clicking directly on the overlay (not on content inside)
    if (event.target.id === 'physicalLayoutModal') {
        console.log('Clicked outside modal content, closing');
        cancelPhysicalLayoutModal();
    }
}

/**
 * Cancel physical layout modal (close without applying)
 * Stay in hierarchy mode - don't switch to physical layout
 */
function cancelPhysicalLayoutModal() {
    console.log('cancelPhysicalLayoutModal called - staying in hierarchy mode');
    const modal = document.getElementById('physicalLayoutModal');
    if (modal) {
        modal.classList.remove('active');
        modal.removeEventListener('click', handlePhysicalLayoutModalClick);
    }

    // Make sure we stay in hierarchy mode
    const currentMode = getVisualizationMode();
    if (currentMode !== 'hierarchy') {
        setVisualizationMode('hierarchy');
        updateModeIndicator();
    }

    showExportStatus('Physical layout configuration cancelled', 'info');
}

/**
 * Parse a comma-separated and/or newline-separated list
 * @param {string} text - Input text
 * @returns {Array<string>} Array of parsed items
 */
function parseList(text) {
    if (!text) return [];

    // Split by both newlines and commas, then clean up
    return text
        .split(/[\n,]/)
        .map(item => item.trim())
        .filter(item => item.length > 0);
}

/**
 * Parse a range string like "1-10" into an array of numbers [1,2,3,...,10]
 * @param {string} rangeStr - Range string (e.g., "1-10")
 * @returns {Array<number>|null} Array of numbers or null if not a valid range
 */
function parseRange(rangeStr) {
    const match = rangeStr.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) return null;

    const start = parseInt(match[1]);
    const end = parseInt(match[2]);

    if (start > end) return null;

    const result = [];
    for (let i = start; i <= end; i++) {
        result.push(i);
    }
    return result;
}

/**
 * Parse input that could be:
 * - A number (e.g., "5" -> generate range 1-5)
 * - A range (e.g., "1-10" -> [1,2,3,...,10])
 * - A comma-separated list (e.g., "1,2,5,10" -> [1,2,5,10])
 * - A text list (e.g., "A,B,C" -> ["A","B","C"])
 * @param {string} input - Input text
 * @returns {Array<string|number>} Array of values
 */
function parseFlexibleInput(input) {
    if (!input) return [];

    input = input.trim();

    // Check if it's a single number (generate range 1 to N)
    const singleNum = parseInt(input);
    if (!isNaN(singleNum) && input.match(/^\d+$/)) {
        const result = [];
        for (let i = 1; i <= singleNum; i++) {
            result.push(i);
        }
        return result;
    }

    // Check if it's a range (e.g., "1-10")
    const rangeResult = parseRange(input);
    if (rangeResult) return rangeResult;

    // Otherwise parse as comma/newline-separated list
    const items = parseList(input);

    // Try to convert to numbers if all items are numeric
    const allNumeric = items.every(item => !isNaN(parseInt(item)));
    if (allNumeric) {
        return items.map(item => parseInt(item));
    }

    return items;
}

/**
 * Parse hall names from textarea (one per line or comma-separated)
 * @returns {Array<string>} Array of hall names (empty string if not specified)
 */
function parseHallNames() {
    const element = document.getElementById('hallNames');
    if (!element) return ['']; // Empty hall allowed
    const hallNamesText = element.value || '';
    const parsed = parseList(hallNamesText);
    // If empty, return array with empty string to allow omitting hall
    return parsed.length === 0 ? [''] : parsed;
}

/**
 * Parse aisle names/numbers
 * @returns {Array<string>} Array of aisle identifiers (empty string if not specified)
 */
function parseAisleNames() {
    const element = document.getElementById('aisleNames');
    if (!element) return ['']; // Empty aisle allowed
    const input = element.value || '';
    const result = parseFlexibleInput(input);

    // If empty, return array with empty string to allow omitting aisle
    if (result.length === 0) return [''];

    // Convert numbers to letters if needed (1->A, 2->B, etc.)
    return result.map(item => {
        if (typeof item === 'number' && item >= 1 && item <= 26) {
            return String.fromCharCode(64 + item); // 1->A, 2->B, etc.
        }
        return item.toString();
    });
}

/**
 * Parse rack numbers
 * @returns {Array<number>} Array of rack numbers
 */
function parseRackNumbers() {
    const element = document.getElementById('rackNumbers');
    if (!element) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Default fallback
    const input = element.value || '';
    const result = parseFlexibleInput(input);

    // If empty, default to rack 1
    if (result.length === 0) return [1];

    // Ensure all are numbers
    return result.map(item => typeof item === 'number' ? item : parseInt(item) || 1);
}

/**
 * Parse shelf unit numbers
 * @returns {Array<number>} Array of shelf U numbers
 */
function parseShelfUnitNumbers() {
    const element = document.getElementById('shelfUnitNumbers');
    if (!element) {
        // Default fallback: 1-42
        const result = [];
        for (let i = 1; i <= 42; i++) {
            result.push(i);
        }
        return result;
    }
    const input = element.value || '';
    const result = parseFlexibleInput(input);

    // If empty, default to U 1
    if (result.length === 0) return [1];

    // Ensure all are numbers
    return result.map(item => typeof item === 'number' ? item : parseInt(item) || 1);
}

/**
 * Update the total capacity display in the modal
 */
function updateTotalCapacity() {
    const hallNames = parseHallNames();
    const aisleNames = parseAisleNames();
    const rackNumbers = parseRackNumbers();
    const shelfUnitNumbers = parseShelfUnitNumbers();

    const totalCapacity = hallNames.length * aisleNames.length * rackNumbers.length * shelfUnitNumbers.length;

    const capacitySpan = document.getElementById('totalCapacity');
    if (capacitySpan) {
        capacitySpan.textContent = `${totalCapacity} nodes`;
    }
}

/**
 * Apply physical layout to all shelf nodes
 * Assigns unique physical locations using nested loops
 */
function applyPhysicalLayout() {
    if (!cy) return;

    // Parse all layout parameters
    const hallNames = parseHallNames();
    const aisleNames = parseAisleNames();
    const rackNumbers = parseRackNumbers();
    const shelfUnitNumbers = parseShelfUnitNumbers();

    // Validate parameters (hall and aisle can be empty)
    if (rackNumbers.length === 0) {
        alert('Please enter at least one rack number');
        return;
    }
    if (shelfUnitNumbers.length === 0) {
        alert('Please enter at least one shelf unit number');
        return;
    }

    // Get all shelf nodes
    const shelfNodes = state.cy.nodes('[type="shelf"]');
    if (shelfNodes.length === 0) {
        alert('No shelf nodes found to assign physical locations');
        cancelPhysicalLayoutModal();
        return;
    }

    // Calculate total capacity
    const totalCapacity = hallNames.length * aisleNames.length * rackNumbers.length * shelfUnitNumbers.length;

    // Warn if not enough capacity
    if (shelfNodes.length > totalCapacity) {
        const proceed = confirm(
            `Warning: You have ${shelfNodes.length} nodes but only ${totalCapacity} available locations.\n\n` +
            `The first ${totalCapacity} nodes will be assigned locations. Continue?`
        );
        if (!proceed) return;
    }

    // Assign physical locations using nested loops
    let nodeIndex = 0;
    let assignedCount = 0;

    outerLoop:
    for (let h = 0; h < hallNames.length; h++) {
        const hall = hallNames[h];

        for (let a = 0; a < aisleNames.length; a++) {
            const aisle = aisleNames[a];

            for (let r = 0; r < rackNumbers.length; r++) {
                const rackNum = rackNumbers[r];

                for (let s = 0; s < shelfUnitNumbers.length; s++) {
                    const shelfU = shelfUnitNumbers[s];

                    if (nodeIndex >= shelfNodes.length) {
                        break outerLoop;
                    }

                    const node = shelfNodes[nodeIndex];

                    // Update node data with physical location
                    node.data('hall', hall);
                    node.data('aisle', aisle);
                    node.data('rack_num', rackNum);
                    node.data('shelf_u', shelfU);

                    // Ensure hostname is set for deployment descriptor export
                    // If no hostname, use host_# format based on host_index
                    if (!node.data('hostname')) {
                        const hostIndex = node.data('host_index');
                        if (hostIndex !== undefined && hostIndex !== null) {
                            // Use host_# format for descriptor imports
                            node.data('hostname', `host_${hostIndex}`);
                        } else {
                            // Fallback to label-based hostname for CSV imports
                            const newLabel = location_buildLabel(hall, aisle, rackNum, shelfU);
                            node.data('label', newLabel);
                            node.data('id', newLabel);
                            node.data('hostname', newLabel);
                        }
                    }

                    nodeIndex++;
                    assignedCount++;
                }
            }
        }
    }

    // Close modal
    const modal = document.getElementById('physicalLayoutModal');
    if (modal) {
        modal.classList.remove('active');
        modal.removeEventListener('click', handlePhysicalLayoutModalClick);
    }

    // Show success message
    showExportStatus(`Assigned physical locations to ${assignedCount} nodes`, 'success');

    // Mark that physical layout has been assigned (used to skip modal on future switches)
    sessionStorage.setItem('physicalLayoutAssigned', 'true');

    // Now switch to location mode and update the visualization
    setVisualizationMode('location');

    // Update the connection legend based on the new mode if we have initial data
    if (initialVisualizationData) {
        updateConnectionLegend(initialVisualizationData);
    }

    // Proceed with the location mode switch
    locationModule.switchMode();

    // Update mode indicator
    updateModeIndicator();
}


/**
 * Create a connection at a specific placement level
 * @param {Object} sourceNode - Source port node
 * @param {Object} targetNode - Target port node  
 * @param {Object|null} selectedLevel - Selected placement level (null for auto-detect)
 */
function createConnectionAtLevel(sourceNode, targetNode, selectedLevel) {
    // Check visualization mode - template connections are only for hierarchy mode
    const visualizationMode = getVisualizationMode();

    // In physical/location mode, always create direct connections (no template logic)
    if (visualizationMode === 'location') {
        // Physical mode: create single direct connection, no template references
        createSingleConnection(sourceNode, targetNode, null, 0);
        return;
    }

    // Hierarchy mode: use selected level or find common ancestor
    let template_name, depth;
    if (selectedLevel) {
        template_name = selectedLevel.template_name;
        depth = selectedLevel.depth;
    } else {
        const commonAncestor = findCommonAncestorGraph(sourceNode, targetNode);
        template_name = commonAncestor ? commonAncestor.data('template_name') : null;
        depth = commonAncestor ? (commonAncestor.data('depth') || 0) : 0;
    }

    // Determine if this is a template-level connection
    // It's template-level if template_name is defined (meaning it's stored in a template)
    const isTemplateConnection = template_name !== null;

    console.log(`[createConnectionAtLevel] Placing at ${template_name}, isTemplateConnection: ${isTemplateConnection}`);

    if (isTemplateConnection) {
        // Template-level: Create in all instances of the placement template
        createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth);
    } else {
        // Instance-specific: Create single connection (no template hierarchy)
        createSingleConnection(sourceNode, targetNode, template_name, depth);
    }
}

/**
 * Create a single connection between two specific ports
 */
function createSingleConnection(sourceNode, targetNode, template_name, depth) {
    const sourceId = sourceNode.id();
    const targetId = targetNode.id();

    // Determine connection color based on visualization mode
    const visualizationMode = state.mode;
    let connectionColor;

    if (visualizationMode === 'hierarchy' && template_name) {
        // Hierarchy mode: use template-based coloring (matches legend)
        connectionColor = getTemplateColor(template_name);
    } else {
        // Physical mode: use intra-node vs inter-node coloring
        const sourceGrandparent = getParentAtLevel(sourceNode, 2);
        const targetGrandparent = getParentAtLevel(targetNode, 2);

        if (sourceGrandparent && targetGrandparent && sourceGrandparent.id() === targetGrandparent.id()) {
            connectionColor = CONNECTION_COLORS.INTRA_NODE;
        } else {
            connectionColor = CONNECTION_COLORS.INTER_NODE;
        }
    }

    const edgeId = `edge_${sourceId}_${targetId}_${Date.now()}`;
    const sourceParent = getParentAtLevel(sourceNode, 2);
    const sourceHostname = sourceNode.data('hostname') || (sourceParent ? sourceParent.data('hostname') : '') || '';
    const targetParent = getParentAtLevel(targetNode, 2);
    const targetHostname = targetNode.data('hostname') || (targetParent ? targetParent.data('hostname') : '') || '';

    // Determine the template where this connection is defined
    // For hierarchy mode, find the common ancestor graph that defines this connection
    let connectionTemplate = template_name;
    if (!connectionTemplate && visualizationMode === 'hierarchy') {
        const commonAncestor = findCommonAncestorGraph(sourceNode, targetNode);
        if (commonAncestor) {
            connectionTemplate = commonAncestor.data('template_name');
            console.log(`[createSingleConnection] Found common ancestor template: ${connectionTemplate} for connection ${sourceId} -> ${targetId}`);
        } else {
            console.warn(`[createSingleConnection] No common ancestor found for connection ${sourceId} -> ${targetId}`);
        }
    }

    // Log template assignment for debugging
    if (connectionTemplate) {
        console.log(`[createSingleConnection] Setting template for connection: ${connectionTemplate}`);
    }

    const connectionNumber = getNextConnectionNumber();
    const newEdge = {
        data: {
            id: edgeId,
            source: sourceId,
            target: targetId,
            cable_type: DEFAULT_CABLE_CONFIG.type,
            cable_length: DEFAULT_CABLE_CONFIG.length,
            connection_number: connectionNumber,
            color: connectionColor,
            source_hostname: sourceHostname,
            destination_hostname: targetHostname,
            template_name: connectionTemplate,  // Template where connection is defined
            containerTemplate: connectionTemplate,  // Also set containerTemplate for consistency
            depth: depth
        }
    };

    state.cy.add(newEdge);

    // Update visuals
    updatePortConnectionStatus();
    updatePortEditingHighlight();
    setTimeout(() => forceApplyCurveStyles(), 50);

    // Update the connection legend after creating a connection
    if (state.data.currentData) {
        updateConnectionLegend(state.data.currentData);
    }
}

/**
 * Create a connection pattern in all instances of a template
 * Skips instances where either port is already connected
 */
function createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth) {
    // Find all instances of this template (including empty ones)
    const templateGraphs = state.cy.nodes().filter(node =>
        node.data('type') === 'graph' && node.data('template_name') === template_name
    );

    if (templateGraphs.length === 0) {
        console.warn('No template instances found');
        createSingleConnection(sourceNode, targetNode, template_name, depth);
        return;
    }

    // Find which instance contains the ports we're connecting
    let sourceInstance = null;
    for (const graph of templateGraphs) {
        if (sourceNode.ancestors().filter(n => n.id() === graph.id()).length > 0) {
            sourceInstance = graph;
            break;
        }
    }

    if (!sourceInstance) {
        console.warn('Could not find instance containing the ports');
        createSingleConnection(sourceNode, targetNode, template_name, depth);
        return;
    }

    // Extract pattern ONCE relative to the instance that contains the ports
    const sourcePattern = hierarchyModule.extractPortPattern(sourceNode, sourceInstance);
    const targetPattern = hierarchyModule.extractPortPattern(targetNode, sourceInstance);

    console.log(`[createConnectionInAllTemplateInstances] Pattern from ${sourceInstance.id()}:`);
    console.log(`[createConnectionInAllTemplateInstances]   sourcePattern:`, sourcePattern);
    console.log(`[createConnectionInAllTemplateInstances]   targetPattern:`, targetPattern);

    if (!sourcePattern || !targetPattern) {
        console.warn('Could not extract port patterns');
        createSingleConnection(sourceNode, targetNode, template_name, depth);
        return;
    }

    let createdCount = 0;
    let skippedCount = 0;

    // Apply the SAME pattern to ALL instances
    templateGraphs.forEach(graph => {
        // Find the specific ports in this instance by following the SAME path
        const sourcePortNode = hierarchyModule.findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
        const targetPortNode = hierarchyModule.findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

        if (!sourcePortNode || !targetPortNode) {
            // Ports don't exist in this instance - skip
            console.log(`[createConnectionInAllTemplateInstances] Ports not found in instance ${graph.id()}, skipping`);
            return;
        }

        // Check if EITHER port already has ANY connection
        const sourcePortConnections = state.cy.edges().filter(e =>
            e.data('source') === sourcePortNode.id() || e.data('target') === sourcePortNode.id()
        );
        const targetPortConnections = state.cy.edges().filter(e =>
            e.data('source') === targetPortNode.id() || e.data('target') === targetPortNode.id()
        );

        if (sourcePortConnections.length > 0 || targetPortConnections.length > 0) {
            skippedCount++;
            console.log(`[createConnectionInAllTemplateInstances] Skipped instance ${graph.id()} - ports already connected (src: ${sourcePortConnections.length}, tgt: ${targetPortConnections.length})`);
            return; // Skip this instance - ports already in use
        }

        // Create the connection in this instance
        console.log(`[createConnectionInAllTemplateInstances] Creating connection in instance ${graph.id()}: ${sourcePortNode.id()} -> ${targetPortNode.id()}`);
        createSingleConnection(sourcePortNode, targetPortNode, template_name, depth);
        createdCount++;
    });

    console.log(`Created ${createdCount} connection(s) in template "${template_name}" (skipped ${skippedCount} instances with existing connections)`);

    // Update the template definition to include the new connection
    if (createdCount > 0 && sourcePattern && targetPattern) {
        // Update state.data.availableGraphTemplates
        if (state.data.availableGraphTemplates && state.data.availableGraphTemplates[template_name]) {
            const template = state.data.availableGraphTemplates[template_name];
            if (!template.connections) {
                template.connections = [];
            }

            // Add the connection pattern to the template
            template.connections.push({
                port_a: {
                    path: sourcePattern.path,
                    tray_id: sourcePattern.trayId,
                    port_id: sourcePattern.portId
                },
                port_b: {
                    path: targetPattern.path,
                    tray_id: targetPattern.trayId,
                    port_id: targetPattern.portId
                },
                cable_type: 'QSFP_DD'  // Default cable type
            });

            console.log(`Updated template "${template_name}" with new connection pattern`);
        }

        // Update state.data.currentData.metadata.graph_templates if it exists (for export)
        if (state.data.currentData && state.data.currentData.metadata && state.data.currentData.metadata.graph_templates) {
            const template = state.data.currentData.metadata.graph_templates[template_name];
            if (template) {
                if (!template.connections) {
                    template.connections = [];
                }

                // Add the connection pattern to the template
                template.connections.push({
                    port_a: {
                        path: sourcePattern.path,
                        tray_id: sourcePattern.trayId,
                        port_id: sourcePattern.portId
                    },
                    port_b: {
                        path: targetPattern.path,
                        tray_id: targetPattern.trayId,
                        port_id: targetPattern.portId
                    },
                    cable_type: 'QSFP_DD'
                });
            }
        }
    }

    // Update the connection legend after creating connections
    if (createdCount > 0 && state.data.currentData) {
        updateConnectionLegend(state.data.currentData);
    }

    if (createdCount > 0) {
        let message = `Template-level connection created!\n\nAdded connection to ${createdCount} instance(s) of template "${template_name}".`;
        if (skippedCount > 0) {
            message += `\n\nSkipped ${skippedCount} instance(s) where ports were already connected.`;
        }
        alert(message);
    } else {
        alert(`No connections created.\n\nAll ${skippedCount} instance(s) of template "${template_name}" already have these ports connected.`);
    }
}

function updateAddNodeButtonState() {
    const addNodeBtn = document.getElementById('addNodeBtn');
    if (!addNodeBtn) return;

    const addNodeText = addNodeBtn.nextElementSibling;

    // Check if we have a valid visualization (state.cy exists and has elements or we have currentData)
    const cyInstance = state.cy || (typeof window.cy !== 'undefined' ? window.cy : null);
    const hasElements = cyInstance && cyInstance.elements().length > 0;
    const hasCurrentData = state.data.currentData !== null && state.data.currentData !== undefined;
    const hasVisualization = hasElements || hasCurrentData;

    // If we have cy but no currentData, create a minimal structure to enable the button
    if (cyInstance && hasElements && !hasCurrentData) {
        state.data.currentData = {
            elements: cyInstance.elements().jsons(),
            metadata: state.data.hierarchyModeState?.metadata || state.data.initialVisualizationData?.metadata || {}
        };
    }

    if (hasVisualization) {
        // Enable the button
        addNodeBtn.disabled = false;
        addNodeBtn.style.background = '#007bff';
        addNodeBtn.style.cursor = 'pointer';
        addNodeBtn.style.opacity = '1';
        if (addNodeText) {
            addNodeText.textContent = 'Creates a new node with trays and ports';
        }
    } else {
        // Disable the button
        addNodeBtn.disabled = true;
        addNodeBtn.style.background = '#6c757d';
        addNodeBtn.style.cursor = 'not-allowed';
        addNodeBtn.style.opacity = '0.6';
        if (addNodeText) {
            addNodeText.textContent = 'Upload a visualization first to enable node creation';
        }
    }
}

function createEmptyVisualization() {
    /**
     * Create an empty canvas for manual node creation and connection drawing.
     * 
     * WORKFLOW:
     * 1. User clicks "Create Empty Canvas" button
     * 2. This function initializes an empty Cytoscape visualization
     * 3. User adds nodes via "Add Node" button (calls addNewNode)
     * 4. User draws connections between ports using edge handles
     * 5. User exports CablingDescriptor and DeploymentDescriptor
     * 
     * EXPORT COMPATIBILITY:
     * Nodes created with addNewNode() include all required fields (hostname, shelf_node_type)
     * for proper descriptor export with consistent host list/enumeration between
     * CablingDescriptor and DeploymentDescriptor.
     * See: export_descriptors.py::extract_host_list_from_connections()
     * 
     * NOTE: Upload sections are now hidden by the calling function (in HTML)
     * which also shows the control sections.
     */
    // Hide loading overlay
    const cyLoading = document.getElementById('cyLoading');
    if (cyLoading) {
        cyLoading.style.display = 'none';
    }

    // Create empty data structure that matches what initVisualization expects
    state.data.currentData = {
        nodes: [],
        edges: [],
        elements: [],  // Empty elements array for Cytoscape
        metadata: {
            total_connections: 0,
            total_nodes: 0
        }
    };
    state.data.currentData = state.data.currentData;
    window.currentData = state.data.currentData; // Expose to global scope

    // Initialize Cytoscape with empty data
    initVisualization(state.data.currentData);

    // Enable the Add Node button
    updateAddNodeButtonState();

    // Open the Cabling Editor section
    if (typeof toggleCollapsible === 'function') {
        const cablingEditorContent = document.getElementById('cablingEditor');
        if (cablingEditorContent && cablingEditorContent.classList.contains('collapsed')) {
            toggleCollapsible('cablingEditor');
        }
    }

    // Enable Connection Editing (suppress alert since we're showing custom success message)
    const toggleBtn = document.getElementById('toggleEdgeHandlesBtn');
    if (toggleBtn && toggleBtn.textContent.includes('Enable')) {
        toggleEdgeHandles(true);
    }

    // Show success message
    showSuccess('Empty visualization created! Connection editing is enabled. You can now add nodes using the "Add New Node" section.');
}

function resetLayout() {
    /**
     * Recalculate layout based on current visualization mode and current node data
     * - Location mode: Recalculate based on rack/shelf hierarchy and location data
     * - Hierarchy mode: Recalculate hierarchical positions based on parent-child relationships
     */
    if (!cy) {
        alert('No visualization loaded. Please upload a file first.');
        return;
    }

    const mode = getVisualizationMode();

    if (mode === 'hierarchy') {
        // Hierarchy mode - recalculate layout using JavaScript layout engine
        showExportStatus('Recalculating hierarchical layout...', 'info');

        // Use JavaScript layout engine for consistent spacing
        hierarchyModule.calculateLayout();

        // Fit viewport to show all nodes
        state.cy.fit(null, 50);

        // Apply drag restrictions
        applyDragRestrictions();

        showExportStatus('Layout reset with consistent spacing', 'success');

        setTimeout(() => {
            const statusDiv = document.getElementById('rangeStatus');
            if (statusDiv) {
                statusDiv.textContent = '';
            }
        }, 2000);

        return;
    }

    // Location mode - recalculate based on rack/shelf positions with hall/aisle grouping
    // Get all racks and group by hall/aisle
    const racks = state.cy.nodes('[type="rack"]');
    if (racks.length === 0) {
        // No racks - this might be 8-column format with standalone shelves
        alert('No rack hierarchy found.');
        return;
    }

    // Show status message
    showExportStatus('Recalculating location-based layout with hall/aisle grouping...', 'info');

    // Group racks by hall -> aisle -> rack hierarchy
    const rackHierarchy = {};
    racks.forEach(function (rack) {
        const hall = rack.data('hall') || 'unknown_hall';
        const aisle = rack.data('aisle') || 'unknown_aisle';
        const rackNum = parseInt(rack.data('rack_num')) || 0;

        if (!rackHierarchy[hall]) rackHierarchy[hall] = {};
        if (!rackHierarchy[hall][aisle]) rackHierarchy[hall][aisle] = [];

        rackHierarchy[hall][aisle].push({
            node: rack,
            rack_num: rackNum
        });
    });

    // Sort racks within each aisle by rack number (descending - higher rack numbers to the left)
    Object.keys(rackHierarchy).forEach(hall => {
        Object.keys(rackHierarchy[hall]).forEach(aisle => {
            rackHierarchy[hall][aisle].sort(function (a, b) {
                return b.rack_num - a.rack_num; // Descending order - rack 2 to the left of rack 1
            });
        });
    });

    // Dynamically calculate layout constants based on actual node sizes
    // This ensures proper spacing regardless of node type (wh_galaxy, n300_lb, etc.)

    // Calculate average/max rack width
    let maxRackWidth = 0;
    racks.forEach(function (rack) {
        // Skip if rack has been removed or is invalid
        if (!rack || !rack.cy() || rack.removed()) return;

        const bb = rack.boundingBox();
        const width = bb.w;
        if (width > maxRackWidth) maxRackWidth = width;
    });
    const rackWidth = maxRackWidth || LAYOUT_CONSTANTS.DEFAULT_RACK_WIDTH;

    // Calculate average/max shelf height (including all descendants)
    let maxShelfHeight = 0;
    let totalShelfHeight = 0;
    let shelfCount = 0;

    racks.forEach(function (rack) {
        // Skip if rack has been removed or is invalid
        if (!rack || !rack.cy() || rack.removed()) return;

        rack.children('[type="shelf"]').forEach(function (shelf) {
            // Skip if shelf has been removed or is invalid
            if (!shelf || !shelf.cy() || shelf.removed()) return;

            // Get bounding box of shelf including all its children
            const bb = shelf.boundingBox({ includeLabels: false, includeOverlays: false });
            const height = bb.h;
            totalShelfHeight += height;
            shelfCount++;
            if (height > maxShelfHeight) maxShelfHeight = height;
        });
    });

    const avgShelfHeight = shelfCount > 0 ? totalShelfHeight / shelfCount : 300;

    // Use max shelf height + 25% buffer for spacing to prevent any overlaps
    const shelfSpacingBuffer = 1.25; // 25% extra space
    const shelfSpacing = Math.max(maxShelfHeight, avgShelfHeight) * shelfSpacingBuffer;

    // Rack spacing should be enough for the widest rack + buffer
    const rackSpacing = rackWidth * LAYOUT_CONSTANTS.RACK_SPACING_BUFFER - rackWidth;

    // Calculate appropriate starting positions with padding
    const baseX = Math.max(200, rackWidth / 2 + LAYOUT_CONSTANTS.RACK_X_OFFSET);
    const baseY = Math.max(300, maxShelfHeight + LAYOUT_CONSTANTS.RACK_Y_OFFSET);

    // Stacked hall/aisle layout constants
    const hallSpacing = 1200; // Vertical spacing between halls
    const aisleOffsetX = 400; // Horizontal offset for each aisle (diagonal stack)
    const aisleOffsetY = 400; // Vertical offset for each aisle (diagonal stack)

    // First pass: calculate all new positions and deltas BEFORE making any changes
    const positionUpdates = [];

    let hallIndex = 0;
    Object.keys(rackHierarchy).sort().forEach(hall => {
        const hallStartY = baseY + (hallIndex * hallSpacing);

        let aisleIndex = 0;
        Object.keys(rackHierarchy[hall]).sort().forEach(aisle => {
            // Square offset: each aisle is offset diagonally from the previous one
            const aisleStartX = baseX + (aisleIndex * aisleOffsetX);
            const aisleStartY = hallStartY + (aisleIndex * aisleOffsetY);

            let rackX = aisleStartX;
            rackHierarchy[hall][aisle].forEach(function (rackData) {
                const rack = rackData.node;

                // Calculate rack position (horizontal sequence within aisle)
                positionUpdates.push({
                    node: rack,
                    newPos: { x: rackX, y: aisleStartY }
                });

                // Update rack label to show hall/aisle
                rack.data('label', `Rack ${rackData.rack_num} (${hall}-${aisle})`);

                // Get all shelves in this rack and sort by shelf_u (descending - higher U at top)
                const shelves = rack.children('[type="shelf"]');
                const sortedShelves = [];
                shelves.forEach(function (shelf) {
                    sortedShelves.push({
                        node: shelf,
                        shelf_u: parseInt(shelf.data('shelf_u')) || 0,
                        oldPos: { x: shelf.position().x, y: shelf.position().y }
                    });
                });
                sortedShelves.sort(function (a, b) {
                    return b.shelf_u - a.shelf_u; // Descending: higher shelf_u at top
                });

                // Calculate vertical positions for shelves (centered in rack)
                const numShelves = sortedShelves.length;
                if (numShelves > 0) {
                    const totalShelfHeight = (numShelves - 1) * shelfSpacing;
                    const shelfStartY = aisleStartY - (totalShelfHeight / 2);

                    // Calculate position for each shelf
                    sortedShelves.forEach(function (shelfData, shelfIndex) {
                        const shelf = shelfData.node;
                        const newShelfX = rackX;
                        const newShelfY = shelfStartY + (shelfIndex * shelfSpacing);

                        // Store shelf position update
                        positionUpdates.push({
                            node: shelf,
                            newPos: { x: newShelfX, y: newShelfY },
                            needsChildArrangement: true // Flag to trigger tray/port arrangement
                        });
                    });
                }

                // Move to next rack position
                rackX += rackWidth + rackSpacing;
            });

            aisleIndex++;
        });

        hallIndex++;
    });

    // Second pass: apply all position updates in a batch
    state.cy.startBatch();
    positionUpdates.forEach(function (update) {
        update.node.position(update.newPos);

        // If this is a shelf that needs child arrangement, apply tray/port layout
        if (update.needsChildArrangement) {
            common_arrangeTraysAndPorts(update.node);
        }
    });
    state.cy.endBatch();

    // Force a complete refresh of the cytoscape instance
    state.cy.resize();
    state.cy.forceRender();

    // Small delay to ensure rendering is complete before fitting viewport and reapplying styles
    setTimeout(function () {
        // Apply fcose layout to prevent overlaps in location mode
        const locationNodes = state.cy.nodes('[type="hall"], [type="aisle"], [type="rack"]');
        if (locationNodes.length > 0) {
            try {
                const layout = state.cy.layout({
                    name: 'fcose',
                    eles: locationNodes,
                    quality: 'default',
                    randomize: false,  // Use calculated positions as starting point
                    animate: true,  // Animate for smooth transition when resetting layout
                    animationDuration: 500,
                    fit: false,
                    nodeDimensionsIncludeLabels: true,
                    nodeRepulsion: 4000,  // Slightly lower than hierarchy mode for tighter location-based layout
                    idealEdgeLength: 150,
                    nestingFactor: 0.15,  // Respect parent-child relationships (hall > aisle > rack)
                    gravity: 0.1,  // Lower gravity to maintain manual layout structure
                    numIter: 300,  // Fewer iterations since we're fine-tuning, not starting from scratch
                    stop: function () {
                        // Re-arrange trays/ports after fcose moves shelves
                        // This ensures tray/port positions are correct relative to new shelf positions
                        state.cy.nodes('[type="shelf"]').forEach(shelf => {
                            common_arrangeTraysAndPorts(shelf);
                        });
                        applyDragRestrictions();
                        forceApplyCurveStyles();
                        updatePortConnectionStatus();

                        // Fit the view to show all nodes with padding
                        state.cy.fit(50);
                        state.cy.center();
                        state.cy.forceRender();

                        // Show success message
                        showExportStatus('Layout reset successfully! All nodes repositioned based on hierarchy.', 'success');
                    }
                });
                if (layout) {
                    layout.run();
                    return;  // Exit early, stop callback will handle the rest
                }
            } catch (e) {
                console.warn('Error applying fcose layout in location mode:', e.message);
            }
        }

        // Fallback if fcose not available or no location nodes
        // Reapply edge curve styles after repositioning
        forceApplyCurveStyles();

        // Update port connection status visual indicators
        updatePortConnectionStatus();

        // Fit the view to show all nodes with padding
        state.cy.fit(50);
        state.cy.center();

        // Force another render to ensure everything is updated
        state.cy.forceRender();

        // Show success message
        showExportStatus('Layout reset successfully! All nodes repositioned based on hierarchy.', 'success');
    }, 100);
}

/**
 * Add a new node to the empty canvas.
 * 
 * IMPORTANT FOR EXPORT CONSISTENCY:
 * This function creates shelf nodes with the required fields for proper descriptor export:
 * - hostname: Used for host identification in both CablingDescriptor and DeploymentDescriptor
 * - shelf_node_type: Node type (WH_GALAXY, N300_LB, BH_GALAXY, P150_LB, etc.) required for host mapping
 * - hall, aisle, rack_num, shelf_u: Optional location data for DeploymentDescriptor
 * 
 * The export logic (export_descriptors.py) uses extract_host_list_from_connections()
 * to ensure both CablingDescriptor and DeploymentDescriptor have the exact same host list
 * in the exact same order, which is critical for the cabling generator to correctly map
 * host_index values between the two descriptors.
 */
function addNewNode() {
    const nodeTypeSelect = document.getElementById('nodeTypeSelect');
    const hostnameInput = document.getElementById('nodeHostnameInput');
    const hallInput = document.getElementById('nodeHallInput');
    const aisleInput = document.getElementById('nodeAisleInput');
    const rackInput = document.getElementById('nodeRackInput');
    const shelfUInput = document.getElementById('nodeShelfUInput');

    let nodeType = nodeTypeSelect.value;

    // Normalize node type: strip _DEFAULT suffix only (keep _GLOBAL and _AMERICA as distinct types)
    nodeType = nodeType.replace(/_DEFAULT$/, '');

    // Check if cytoscape is initialized
    if (!state.cy) {
        if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
            window.showNotificationBanner('Please upload a file and generate a visualization first before adding new nodes.', 'error');
        }
        return;
    }

    // Delegate to appropriate module based on mode
    if (state.mode === 'hierarchy') {
        hierarchyModule.addNode(nodeType, nodeTypeSelect);
        return;
    } else {
        // Location mode
        locationModule.addNode(nodeType, {
            hostnameInput,
            hallInput,
            aisleInput,
            rackInput,
            shelfUInput
        });
        return;
    }
}

/**
 * Check if a template contains another template (directly or nested)
 * This is used to detect circular dependencies
 * @param {string} parentTemplateName - The parent template to check
 * @param {string} childTemplateName - The child template to look for
 * @returns {boolean} - True if parentTemplate contains childTemplate
 */
// NOTE: Function moved to HierarchyModule.templateContainsTemplate()
function templateContainsTemplate(parentTemplateName, childTemplateName) {
    return hierarchyModule.templateContainsTemplate(parentTemplateName, childTemplateName);
}

// NOTE: Function moved to HierarchyModule.addGraph()
function addNewGraph() {
    const graphTemplateSelect = document.getElementById('graphTemplateSelect');
    hierarchyModule.addGraph(graphTemplateSelect);
}

// NOTE: Function moved to HierarchyModule.createNewTemplate()
function createNewTemplate() {
    hierarchyModule.createNewTemplate();
}

/**
 * Note: resolvePathInMapping() has been moved to hierarchyModule.resolvePathInMapping()
 * Note: processDeferredConnections() has been moved to hierarchyModule.processDeferredConnections()
 */

/**
 * Recursively instantiate a graph template with all its children and connections
 * @param {Object} template - The template structure
 * @param {string} templateName - The template name (for graph_ref lookups)
 * @param {string} graphId - The ID for this graph instance
 * @param {string} graphLabel - The label for this graph instance
 * @param {string} graphType - The type (superpod, pod, cluster, etc.)
 * @param {string|null} parentId - The parent node ID (null for top-level)
 * @param {number} baseX - Base X position
 * @param {number} baseY - Base Y position
 * @param {Array} nodesToAdd - Array to accumulate nodes
 * @param {Array} edgesToAdd - Array to accumulate edges
 * @param {Object} pathMapping - Maps child names to their full node IDs for connection resolution
 * @param {Array} deferredConnections - Array to defer connection creation until all nodes exist
 * @param {string|null} childName - The child name for template-level operations
 * @param {number} parentDepth - The depth of the parent node (for calculating this node's depth)
 */

/**
 * NOTE: createTraysAndPorts() has been removed - both LocationModule and HierarchyModule
 * now call nodeFactory.createTraysAndPorts() directly. The duplicate-checking logic
 * is handled within each module as needed.
 */

function toggleEdgeHandles() {
    const btn = document.getElementById('toggleEdgeHandlesBtn');

    if (!cy) {
        console.error('Cytoscape instance not available');
        return;
    }

    if (btn.textContent.includes('Enable')) {
        // Enable connection creation mode
        // Clear all selections (including Cytoscape selections) when entering edit mode
        if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
            window.clearAllSelections();
        }
        state.enableEditMode();
        state.editing.isEdgeCreationMode = true;
        btn.textContent = '🔗 Disable Connection Editing';
        btn.style.backgroundColor = '#dc3545';

        // Show delete element section (combined connection and node deletion)
        document.getElementById('deleteElementSection').style.display = 'block';

        // Show add node section
        document.getElementById('addNodeSection').style.display = 'block';

        // Show add graph section only in hierarchy mode
        const addGraphSection = document.getElementById('addGraphSection');
        if (addGraphSection && state.mode === 'hierarchy') {
            addGraphSection.style.display = 'block';
        } else if (addGraphSection) {
            addGraphSection.style.display = 'none';
        }

        // Add visual feedback only for available (unconnected) ports
        updatePortEditingHighlight();

        // Show instruction
        alert('Connection editing enabled!\n\n• Click unconnected port → Click another port = Create connection\n• Click connection to select it, then use Delete button or Backspace/Delete key\n• Click deletable nodes (shelf/rack/graph) to select for deletion\n• Click empty space = Cancel selection\n\nNote: Only unconnected ports are highlighted in orange');

    } else {
        // Disable connection creation mode
        // Clear all selections (including Cytoscape selections) when exiting edit mode
        if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
            window.clearAllSelections();
        }
        state.disableEditMode();
        state.editing.isEdgeCreationMode = false;

        // Clear source port selection and remove styling
        if (state.editing.selectedFirstPort) {
            state.editing.selectedFirstPort.removeClass('source-selected');
        }
        state.editing.selectedFirstPort = null;

        btn.textContent = '🔗 Enable Connection Editing';
        btn.style.backgroundColor = '#28a745';

        // Hide delete element section
        document.getElementById('deleteElementSection').style.display = 'none';

        // Hide add node section
        document.getElementById('addNodeSection').style.display = 'none';

        // Hide add graph section
        document.getElementById('addGraphSection').style.display = 'none';

        // Clear any selected connection and remove its styling
        if (state.editing.selectedConnection) {
            state.editing.selectedConnection.removeClass('selected-connection');
        }
        state.editing.selectedConnection = null;
        state.editing.selectedConnection = null;

        // Clear any selected node and remove its styling
        if (state.editing.selectedNode) {
            state.editing.selectedNode.removeClass('selected-node');
        }
        state.editing.selectedNode = null;
        state.editing.selectedNode = null;

        // Update delete button state
        updateDeleteButtonState();

        // Remove visual feedback from all ports
        state.cy.nodes('.port').style({
            'border-width': '2px',
            'border-color': '#666666',
            'border-opacity': 1.0
        });

        // Remove any source port highlighting (redundant but safe)
        state.cy.nodes('.port').removeClass('source-selected');

        // Remove selected-connection class from all edges
        state.cy.edges().removeClass('selected-connection');

        // Remove selected-node class from all nodes
        state.cy.nodes().removeClass('selected-node');
    }
}

function updatePortEditingHighlight() {
    if (!state.editing.isEdgeCreationMode) return;

    state.cy.nodes('.port').forEach(port => {
        const portId = port.id();
        const connections = state.cy.edges(`[source="${portId}"], [target="${portId}"]`);

        if (connections.length === 0) {
            // Port is available - add orange highlighting
            port.style({
                'border-width': '3px',
                'border-color': '#ff6600',
                'border-opacity': 0.7
            });
        } else {
            // Port is connected - use default styling
            port.style({
                'border-width': '2px',
                'border-color': '#666666',
                'border-opacity': 1.0
            });
        }
    });
}

// File upload handlers - tab-specific elements
const uploadSectionLocation = document.getElementById('uploadSectionLocation');
const csvFileLocation = document.getElementById('csvFileLocation');
const uploadSectionTopology = document.getElementById('uploadSectionTopology');
const csvFileTopology = document.getElementById('csvFileTopology');

// Setup drag-and-drop for Location tab (CSV or Deployment Descriptor)
if (uploadSectionLocation && csvFileLocation) {
    uploadSectionLocation.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSectionLocation.classList.add('dragover');
    });

    uploadSectionLocation.addEventListener('dragleave', () => {
        uploadSectionLocation.classList.remove('dragover');
    });

    uploadSectionLocation.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSectionLocation.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const fileName = files[0].name.toLowerCase();
            // Accept both CSV and textproto files
            if (fileName.endsWith('.csv') || fileName.endsWith('.textproto')) {
                csvFileLocation.files = files;
            }
        }
    });

    csvFileLocation.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            // File selected, ready to upload
        }
    });
}

// Setup drag-and-drop for Topology tab (Textproto)
if (uploadSectionTopology && csvFileTopology) {
    uploadSectionTopology.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSectionTopology.classList.add('dragover');
    });

    uploadSectionTopology.addEventListener('dragleave', () => {
        uploadSectionTopology.classList.remove('dragover');
    });

    uploadSectionTopology.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSectionTopology.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.toLowerCase().endsWith('.textproto')) {
            csvFileTopology.files = files;
        }
    });

    csvFileTopology.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            // File selected, ready to upload
        }
    });
}

async function uploadFile() {
    // Determine which file input to use based on which tab is active
    let fileInput = null;
    let loadingElement = null;
    let buttonElement = null;

    // Check Location tab first
    if (csvFileLocation && csvFileLocation.files && csvFileLocation.files.length > 0) {
        fileInput = csvFileLocation;
        loadingElement = document.getElementById('loadingLocation');
        buttonElement = document.getElementById('uploadBtnLocation');
    }
    // Then check Topology tab
    else if (csvFileTopology && csvFileTopology.files && csvFileTopology.files.length > 0) {
        fileInput = csvFileTopology;
        loadingElement = document.getElementById('loadingTopology');
        buttonElement = document.getElementById('uploadBtnTopology');
    }

    if (!fileInput || !fileInput.files) {
        showError('Please select a file first.');
        return;
    }

    const file = fileInput.files[0];

    if (!file) {
        showError('Please select a file first.');
        return;
    }

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.textproto')) {
        showError('Please select a CSV or textproto file (must end with .csv or .textproto).');
        return;
    }

    // Reset any global state
    state.data.currentData = null;
    state.data.currentData = null;
    window.currentData = null; // Expose to global scope
    state.editing.selectedConnection = null;
    state.editing.isEdgeCreationMode = false;

    // Show loading state
    if (loadingElement) loadingElement.style.display = 'block';
    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Processing...';
    }
    hideMessages();

    try {
        // Use API client for the actual request
        const result = await apiClient.uploadFile(file);

        if (result.success) {
            state.data.currentData = result.data;
            state.data.currentData = result.data;
            window.currentData = result.data; // Expose to global scope (backward compatibility)

            // Hide initialization section and show visualization controls
            const initSection = document.getElementById('initializationSection');
            if (initSection) {
                initSection.style.display = 'none';
            }

            const controlSections = document.getElementById('controlSections');
            if (controlSections) {
                controlSections.style.display = 'block';
            }

            // Check for unknown node types and show warning
            if (result.unknown_types && result.unknown_types.length > 0) {
                const unknownTypesStr = result.unknown_types.map(t => t.toUpperCase()).join(', ');
                showWarning(`Successfully processed ${file.name}!<br><strong>⚠️ Warning:</strong> Unknown node types detected and auto-configured: ${unknownTypesStr}`);
            } else {
                showSuccess(`Successfully processed ${file.name}!`);
            }

            initVisualization(result.data);

            // Update legend based on file type
            updateConnectionLegend(result.data);

            // Enable the Add Node button after successful upload
            updateAddNodeButtonState();
        } else {
            showError(`Error: ${result.error || 'Unknown error occurred'}`);
        }
    } catch (err) {
        showError(`Upload failed: ${err.message}`);
        console.error('Upload error:', err);
    } finally {
        // Reset UI state
        if (loadingElement) loadingElement.style.display = 'none';
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.textContent = buttonElement.id.includes('Location') ? '📊 Load CSV' : 'Generate Visualization';
        }
    }
}

// Notification timer moved to NotificationManager

// Delegate to notification manager
function showNotificationBanner(message, type = 'success') {
    notificationManager.show(message, type);
}

function hideNotificationBanner() {
    notificationManager.hide();
}

function showError(message) {
    notificationManager.error(message);
}

function showSuccess(message) {
    notificationManager.success(message);
}

function showWarning(message) {
    notificationManager.warning(message);
}

function hideMessages() {
    notificationManager.hide();
}

function updateConnectionLegend(data) {
    /**
     * Update the connection legend based on file format
     * Shows CSV legend for regular CSV files
     * Shows descriptor legend (dynamically generated) for textproto files
     */
    const csvLegend = document.getElementById('csvLegend');
    const descriptorLegend = document.getElementById('descriptorLegend');

    if (!csvLegend || !descriptorLegend) {
        console.warn('Legend elements not found');
        return;
    }

    // Use visualization mode to determine which legend to show
    // Hierarchy mode uses depth-based coloring, physical mode uses intra/inter-node coloring
    const currentMode = getVisualizationMode();
    const isHierarchyMode = currentMode === 'hierarchy';

    if (isHierarchyMode) {
        // Show descriptor/hierarchy legend, hide CSV/physical legend
        csvLegend.style.display = 'none';
        descriptorLegend.style.display = 'block';

        // Collect all unique template names from state.data.availableGraphTemplates
        const templateNames = new Set();

        // Add templates from state.data.availableGraphTemplates (including empty ones)
        if (state.data.availableGraphTemplates) {
            Object.keys(state.data.availableGraphTemplates).forEach(name => {
                templateNames.add(name);
            });
        }

        // Also add templates from edges in case some aren't in state.data.availableGraphTemplates
        const edges = data.elements.filter(e => e.group === 'edges' || (e.data && e.data.source && e.data.target));
        edges.forEach(e => {
            if (e.data && e.data.template_name) {
                templateNames.add(e.data.template_name);
            }
        });

        console.log(`Total templates for legend: ${templateNames.size}`);

        // Generate legend items for each template
        const sortedTemplates = Array.from(templateNames).sort();
        let legendHTML = '';

        if (sortedTemplates.length === 0) {
            legendHTML = '<div style="font-size: 13px; color: #666;">No templates defined</div>';
        } else {
            sortedTemplates.forEach(templateName => {
                // Get the color for this template using the same function used for connections
                const color = getTemplateColor(templateName);
                legendHTML += `
                    <div class="legend-row" data-template="${templateName}" data-color="${color}" 
                         style="display: flex; align-items: center; margin: 6px 0; padding: 4px; border-radius: 4px;">
                        <div style="width: 20px; height: 3px; background-color: ${color}; margin-right: 10px; border-radius: 2px;"></div>
                        <span style="font-size: 13px; color: #333;">${templateName}</span>
                    </div>
                `;
            });
        }

        descriptorLegend.innerHTML = legendHTML;
    } else {
        // Show CSV/physical legend, hide descriptor/hierarchy legend
        csvLegend.style.display = 'block';
        descriptorLegend.style.display = 'none';
    }
}



/**
 * Update all edge colors to use template-based colors from JavaScript
 * This ensures edges match the legend colors and filter correctly
 * Should be called after import as the final step
 */
function updateAllEdgeColorsToTemplateColors() {
    if (!state || !state.cy) {
        return;
    }

    const allEdges = state.cy.edges();
    let updatedCount = 0;
    let skippedCount = 0;

    allEdges.forEach(edge => {
        const templateName = edge.data('template_name') || edge.data('containerTemplate');

        if (templateName) {
            // Get template color from JS (this matches legend colors)
            const templateColor = getTemplateColor(templateName);
            const oldColor = edge.data('color');

            // Update edge color to match template
            edge.data('color', templateColor);

            // Build reverse mapping: color -> template (for color-based template inference)
            if (commonModule) {
                commonModule.colorToTemplate[templateColor] = templateName;
            }

            if (oldColor !== templateColor) {
                updatedCount++;
            }
        } else {
            skippedCount++;
            // Edge doesn't have template_name - this is expected for some edge types
            // (e.g., manually created edges in location mode)
        }
    });

    console.log(`[updateAllEdgeColorsToTemplateColors] Updated ${updatedCount} edge colors to match template colors, ${skippedCount} edges skipped (no template_name)`);
}

function initVisualization(data) {
    // Safety check for DOM elements
    const cyLoading = document.getElementById('cyLoading');
    const cyContainer = document.getElementById('cy');

    if (!cyLoading || !cyContainer) {
        console.error('Required DOM elements not found');
        return;
    }

    cyLoading.style.display = 'none';

    console.log('Initializing Cytoscape with data:', data);
    console.log('Container element:', cyContainer);
    console.log('Container dimensions:', cyContainer.offsetWidth, 'x', cyContainer.offsetHeight);
    console.log('Elements count:', data.elements ? data.elements.length : 'undefined');

    // Debug: Check if positions exist in data
    const graphNodesInData = (data.elements && Array.isArray(data.elements)) ? data.elements.filter(e => e.data && e.data.type === 'graph') : [];
    console.log('Graph nodes in data:', graphNodesInData.length);
    graphNodesInData.forEach(g => {
    });

    // Store initial visualization data for reset functionality
    const initialDataCopy = JSON.parse(JSON.stringify(data));
    state.data.initialVisualizationData = initialDataCopy;
    initialVisualizationData = initialDataCopy;
    window.initialVisualizationData = initialDataCopy; // Expose to global scope
    console.log('Stored initial visualization data for reset');

    // Initialize hierarchy mode state (allows mode switching even without going to location first)
    const hierarchyStateCopy = JSON.parse(JSON.stringify(data));
    state.data.hierarchyModeState = hierarchyStateCopy;
    state.data.hierarchyModeState = hierarchyStateCopy;
    console.log('Initialized hierarchy mode state');

    // Ensure state.data.currentData has metadata for exports (without breaking position references)
    if (!state.data.currentData) {
        // First time loading - set state.data.currentData
        state.data.currentData = data;
        state.data.currentData = data;
        window.currentData = data; // Expose to global scope
        console.log('Initialized state.data.currentData');
    } else if (data.metadata && data.metadata.graph_templates &&
        (!state.data.currentData.metadata || !state.data.currentData.metadata.graph_templates)) {
        // Data has graph_templates but state.data.currentData doesn't - merge metadata only
        if (!state.data.currentData.metadata) {
            state.data.currentData.metadata = {};
        }
        state.data.currentData.metadata.graph_templates = data.metadata.graph_templates;
        state.data.currentData = state.data.currentData;
    }

    // Track initial root template for efficient export decisions
    if (state.data.currentData && !state.data.currentData.metadata) {
        state.data.currentData.metadata = {};
    }
    if (state.data.currentData && state.data.currentData.metadata) {
        // Find the single top-level graph node from initial import
        const topLevelGraphs = data.elements.filter(el => {
            const elData = el.data || {};
            const elType = elData.type;
            const hasParent = elData.parent;
            return elType === 'graph' && !hasParent;
        });

        if (topLevelGraphs.length === 1) {
            const rootNode = topLevelGraphs[0].data;
            state.data.currentData.metadata.initialRootTemplate = rootNode.template_name || 'unknown_template';
            state.data.currentData.metadata.initialRootId = rootNode.id;
            state.data.currentData.metadata.hasTopLevelAdditions = false;
        } else {
            // Multiple roots on import - already modified, set flag
            state.data.currentData.metadata.initialRootTemplate = null;
            state.data.currentData.metadata.initialRootId = null;
            state.data.currentData.metadata.hasTopLevelAdditions = true;
            console.log(`Multiple top-level nodes on import (${topLevelGraphs.length}) - flagging as modified`);
        }
    }

    // Detect and set visualization mode based on data
    // Skip auto-detection for empty canvases (preserve explicitly-set mode)
    const isEmpty = !data.elements || data.elements.length === 0;
    const isDescriptor = data.metadata && data.metadata.file_format === 'descriptor';
    const hasGraphNodes = !isEmpty && data.elements && data.elements.some(el => el.data && el.data.type === 'graph');

    if (!isEmpty) {
        if (hasGraphNodes || isDescriptor) {
            setVisualizationMode('hierarchy');
            console.log('Detected hierarchy mode (descriptor/textproto import)');
        } else {
            setVisualizationMode('location');
            console.log('Detected location mode (CSV import)');
        }
    }

    // Initialize global host counter based on existing shelf nodes
    const existingShelves = data.elements.filter(el => el.data && el.data.type === 'shelf');
    state.data.globalHostCounter = existingShelves.length;
    state.data.globalHostCounter = state.data.globalHostCounter;
    console.log(`Initialized global host counter: ${state.data.globalHostCounter} existing hosts`);

    // Extract available graph templates from metadata (for textproto imports)
    extractGraphTemplates(data);

    if (isEmpty) {
        const currentMode = getVisualizationMode();
        console.log(`Empty canvas - preserving current mode: ${currentMode}`);
    }

    // Ensure container has proper dimensions
    if (cyContainer.offsetWidth === 0 || cyContainer.offsetHeight === 0) {
        console.warn('Container has zero dimensions, setting explicit size');
        cyContainer.style.width = '100%';
        cyContainer.style.height = '600px';
    }

    try {
        if (state.cy) {
            cy = state.cy;
            // Clear existing elements and add new ones
            console.log('Clearing existing elements and adding new ones');
            state.cy.elements().remove();
            state.cy.add(data.elements);

            // Apply drag restrictions
            applyDragRestrictions();

            state.cy.layout({ name: 'preset' }).run();

            // Ensure event handlers are registered even when reusing existing instance
            // Use a small delay to ensure layout is complete and elements are rendered
            setTimeout(() => {
                addCytoscapeEventHandlers();
            }, 50);
        } else {
            // Create new Cytoscape instance
            console.log('Creating new Cytoscape instance');
            console.log('Data elements:', data.elements.length);

            // Debug: Log graph node positions
            const graphNodes = data.elements.filter(e => e.data && e.data.type === 'graph');
            console.log('Graph nodes found:', graphNodes.length);
            graphNodes.forEach(g => {
                const posStr = g.position ? `(${g.position.x}, ${g.position.y})` : 'auto-layout';
            });

            // CRITICAL: Cytoscape auto-centers compound nodes based on children
            // Strategy: Add ALL elements first, THEN calculate positions in JavaScript

            state.cy = cytoscape({
                container: cyContainer,
                elements: data.elements,  // Add everything at once
                style: getCytoscapeStyles(),
                layout: {
                    name: 'grid',  // Simple initial layout (will be recalculated immediately)
                    animate: false,
                    fit: false,  // Don't fit yet - wait for proper layout
                    padding: 50
                },
                minZoom: 0.1,
                maxZoom: 5,
                wheelSensitivity: 0.2,
                autoungrabify: false,
                autounselectify: false,
                autolock: false
            });

            // Sync legacy global variable immediately
            cy = state.cy;

            // Set template-based colors for all imported graph nodes
            state.cy.nodes('[type="graph"]').forEach(node => {
                const templateName = node.data('template_name');
                if (templateName) {
                    const templateColor = getTemplateColor(templateName);
                    node.data('templateColor', templateColor);
                }
            });

            // Update edge colors to use template-based colors (LAST STEP - ensures colors match legend)
            updateAllEdgeColorsToTemplateColors();

            // Apply JavaScript-based layout based on visualization mode
            const currentMode = getVisualizationMode();
            if (currentMode === 'hierarchy') {
                // Hierarchy mode - use hierarchical layout
                hierarchyModule.calculateLayout();

                // For textproto imports, host_index is already set from host_id during import
                // Only recalculate if host_index is missing (e.g., empty canvas or manual additions)
                const isTextprotoImport = isDescriptor || (data.metadata && data.metadata.file_format === 'descriptor');

                if (!isTextprotoImport) {
                    // For non-textproto imports (e.g., empty canvas), only recalculate if host_index is missing
                    const allShelves = state.cy.nodes('[type="shelf"]');
                    const needsRecalculation = allShelves.length > 0 && allShelves.some(node => {
                        const hostIndex = node.data('host_index');
                        return hostIndex === undefined || hostIndex === null;
                    });

                    if (needsRecalculation) {
                        console.log('Some shelf nodes missing host_index, recalculating...');
                        recalculateHostIndicesForTemplates();
                    } else {
                        console.log('All shelf nodes have host_index, preserving existing assignments');
                    }
                } else {
                    console.log('Textproto import detected - using host_index from host_id (no DFS re-indexing)');
                }
            } else {
                // Location mode - check if racks exist, if not create them from shelf location data (like switchMode does)
                const existingRacks = state.cy.nodes('[type="rack"]');
                const shelfNodes = state.cy.nodes('[type="shelf"]');
                const shelvesWithLocation = shelfNodes.filter(shelf => {
                    const data = shelf.data();
                    return data.hall || data.aisle || (data.rack_num !== undefined && data.rack_num !== null);
                });

                // If we have shelves with location data but no racks, create racks (like switchMode does)
                if (existingRacks.length === 0 && shelvesWithLocation.length > 0) {
                    console.log('[initVisualization] No racks found but shelves have location data - creating racks like switchMode does');
                    // Call switchMode to rebuild with proper hall/aisle/rack structure
                    locationModule.switchMode();
                    return; // switchMode handles everything including calculateLayout and resetLayout
                }

                // Racks already exist or no location data - use normal flow
                // calculateLayout() creates the hall/aisle nodes, resetLayout() does final positioning and cleanup
                locationModule.calculateLayout();

                // After calculateLayout creates the nodes, call resetLayout for final positioning and cleanup
                // Use a timeout to ensure calculateLayout's async operations complete first
                setTimeout(() => {
                    if (window.resetLayout && typeof window.resetLayout === 'function') {
                        window.resetLayout();
                    }
                }, 200);
            }

            // Fit viewport to show all content (for hierarchy mode, or immediate fit for location mode)
            if (currentMode === 'hierarchy') {
                state.cy.fit(null, 50);
            }

            // Apply drag restrictions after layout (for hierarchy mode)
            if (currentMode === 'hierarchy') {
                setTimeout(() => {
                    applyDragRestrictions();
                }, 100);
            }

            // Debug: Check rendered positions
            setTimeout(() => {
                const graphsInCy = state.cy.nodes('[type="graph"]');
                graphsInCy.forEach(g => {
                    const pos = g.position();
                    const bb = g.boundingBox();
                });
            }, 500);

            // Add event handlers for new instance after a short delay to ensure Cytoscape is fully ready
            // This ensures elements are rendered and handlers can properly attach to them
            setTimeout(() => {
                addCytoscapeEventHandlers();
            }, 50);
        }

        // Ensure cy is synced before using it
        if (!cy && state.cy) {
            cy = state.cy;
        }

        console.log('Cytoscape instance ready:', cy);
        if (cy) {
            console.log('Nodes count:', state.cy.nodes().length);
            console.log('Edges count:', state.cy.edges().length);
        } else {
            console.error('Cytoscape instance is null!');
        }

        // Verify all cytoscape extensions are loaded and available
        verifyCytoscapeExtensions();

        // Apply drag restrictions
        applyDragRestrictions();

        // Apply final curve styling and ensure edge colors are updated (last step)
        setTimeout(() => {
            forceApplyCurveStyles();
            updatePortConnectionStatus();
            // Final step: ensure all edge colors match template colors from JS
            updateAllEdgeColorsToTemplateColors();
        }, 100);

        // Initialize delete button state
        updateDeleteButtonState();

        // Update Add Node button state after visualization is initialized
        updateAddNodeButtonState();

        // Add remaining event handlers (only for new instances)
        if (typeof cy !== 'undefined' && cy && !window.cytoscapeEventHandlersAdded) {
            addConnectionTypeEventHandlers();
            window.cytoscapeEventHandlersAdded = true;
        }

        // Populate filter dropdowns
        populateNodeFilterDropdown();
        // Populate template filter dropdown (hierarchy mode only, but safe to call)
        if (typeof populateTemplateFilterDropdown === 'function') {
            populateTemplateFilterDropdown();
        }

        console.log('Cytoscape initialization complete');
    } catch (error) {
        console.error('Error initializing Cytoscape:', error);
    }
}

// NOTE: Functions moved to CommonModule
function forceApplyCurveStyles() {
    commonModule.forceApplyCurveStyles();
}

function checkSameShelf(sourceId, targetId) {
    return commonModule.checkSameShelf(sourceId, targetId);
}

// Delegate to hierarchy module
function getParentAtLevel(node, level) {
    return hierarchyModule.getParentAtLevel(node, level);
}

// NOTE: Function moved to CommonModule.getCytoscapeStyles()
function getCytoscapeStyles() {
    return commonModule.getCytoscapeStyles();
}

// NOTE: Function moved to CommonModule.addCytoscapeEventHandlers()
function addCytoscapeEventHandlers() {
    commonModule.addCytoscapeEventHandlers();
}

// NOTE: Function moved to LocationModule.addConnectionTypeEventHandlers(), CommonModule.addNodeFilterHandler(), and HierarchyModule.addTemplateFilterHandler()
function addConnectionTypeEventHandlers() {
    // Add connection type filter handlers (location mode only)
    locationModule.addConnectionTypeEventHandlers();
    // Add node filter handler (available in both modes)
    commonModule.addNodeFilterHandler();
    // Add template filter handler (hierarchy mode only)
    hierarchyModule.addTemplateFilterHandler();
}

// NOTE: Function moved to CommonModule.applyConnectionTypeFilter()
function applyConnectionTypeFilter() {
    commonModule.applyConnectionTypeFilter();
}

// NOTE: Helper functions moved to CommonModule
function getParentShelfNode(node) {
    return commonModule.getParentShelfNode(node);
}

function extractShelfIdFromNodeId(nodeId) {
    return commonModule.extractShelfIdFromNodeId(nodeId);
}

function getOriginalEdgeEndpoints(edge) {
    return commonModule.getOriginalEdgeEndpoints(edge);
}

// NOTE: Function moved to CommonModule.applyNodeFilter()
function applyNodeFilter() {
    commonModule.applyNodeFilter();
}
function populateNodeFilterDropdown() {
    commonModule.populateNodeFilterDropdown(locationModule);
}

function populateTemplateFilterDropdown() {
    // Delegate to hierarchy module (hierarchy mode only)
    if (hierarchyModule && typeof hierarchyModule.populateTemplateFilterDropdown === 'function') {
        hierarchyModule.populateTemplateFilterDropdown();
    }
}

// NOTE: Function moved to CommonModule.showNodeInfo()
function showNodeInfo(node, position) {
    commonModule.showNodeInfo(node, position);
}

// NOTE: Functions moved to CommonModule
function hideNodeInfo() {
    commonModule.hideNodeInfo();
}

function showConnectionInfo(edge, position) {
    commonModule.showConnectionInfo(edge, position);
}


// NOTE: Function moved to CommonModule.enableShelfEditing()
function enableShelfEditing(node, position) {
    commonModule.enableShelfEditing(node, position);
}

// NOTE: Function moved to CommonModule.updateNodeAndDescendants()
function updateNodeAndDescendants(node, property, value) {
    commonModule.updateNodeAndDescendants(node, property, value);
}

// NOTE: Function moved to LocationModule.saveShelfEdit()
window.saveShelfEdit = function (nodeId) {
    locationModule.saveShelfEdit(nodeId);
};

// NOTE: Function moved to LocationModule.cancelShelfEdit()
window.cancelShelfEdit = function () {
    locationModule.cancelShelfEdit();
};

// NOTE: Function moved to LocationModule.enableHallEditing()
window.enableHallEditing = function (node, position) {
    locationModule.enableHallEditing(node, position);
};

// NOTE: Function moved to LocationModule.enableAisleEditing()
window.enableAisleEditing = function (node, position) {
    locationModule.enableAisleEditing(node, position);
};

// NOTE: Function moved to LocationModule.enableRackEditing()
window.enableRackEditing = function (node, position) {
    locationModule.enableRackEditing(node, position);
};

// NOTE: Function moved to LocationModule.saveHallEdit()
window.saveHallEdit = function (nodeId) {
    locationModule.saveHallEdit(nodeId);
};

// NOTE: Function moved to LocationModule.saveAisleEdit()
window.saveAisleEdit = function (nodeId) {
    locationModule.saveAisleEdit(nodeId);
};

// NOTE: Function moved to LocationModule.saveRackEdit()
window.saveRackEdit = function (nodeId) {
    locationModule.saveRackEdit(nodeId);
};

// NOTE: Function moved to HierarchyModule.enableGraphTemplateEditing()
function enableGraphTemplateEditing(node, position) {
    hierarchyModule.enableGraphTemplateEditing(node, position);
}

// NOTE: Function moved to HierarchyModule.saveGraphTemplateEdit()
window.saveGraphTemplateEdit = function (nodeId) {
    hierarchyModule.saveGraphTemplateEdit(nodeId);
};

// NOTE: Function moved to HierarchyModule.cancelGraphTemplateEdit()
window.cancelGraphTemplateEdit = function (nodeId) {
    hierarchyModule.cancelGraphTemplateEdit(nodeId);
};

// NOTE: Function moved to HierarchyModule.populateMoveTargetTemplates()
function populateMoveTargetTemplates(node) {
    hierarchyModule.populateMoveTargetTemplates(node);
}

/**
 * Enumerate valid parent templates for moving a node or graph instance
 * Returns templates that:
 * - Are not descendants of this node (no circular dependencies)
 * - Are not the current parent
 * - Actually exist in state.data.availableGraphTemplates
 */

// NOTE: Function moved to HierarchyModule.executeMoveToTemplate()
window.executeMoveToTemplate = function (nodeId) {
    hierarchyModule.executeMoveToTemplate(nodeId);
};

// NOTE: Functions moved to HierarchyModule
// moveNodeToTemplate() -> hierarchyModule.moveNodeToTemplate()
// moveGraphInstanceToTemplate() -> hierarchyModule.moveGraphInstanceToTemplate()


/**
 * Validate that all shelf nodes have hostnames
 * @returns {Array} Array of node labels that are missing hostnames (empty if all valid)
 */
function validateHostnames() {
    const nodesWithoutHostname = [];
    state.cy.nodes().forEach(function (node) {
        const data = node.data();
        if (data.type === 'shelf' && (!data.hostname || data.hostname.trim() === '')) {
            nodesWithoutHostname.push(data.label || data.id);
        }
    });
    return nodesWithoutHostname;
}

async function exportCablingDescriptor() {
    if (typeof cy === 'undefined' || !cy) {
        showNotificationBanner('No visualization data available', 'error');
        return;
    }

    // Validate: Must have exactly one top-level root template
    const topLevelGraphs = state.cy.nodes('[type="graph"]').filter(node => {
        const parent = node.parent();
        return parent.length === 0;
    });

    if (topLevelGraphs.length === 0) {
        showNotificationBanner('❌ Cannot export CablingDescriptor: No root template found. Please create a graph template that contains all nodes and connections.', 'error');
        return;
    }

    if (topLevelGraphs.length > 1) {
        const templateNames = topLevelGraphs.map(n => n.data('template_name') || n.data('label')).join(', ');
        showNotificationBanner(`❌ Cannot export CablingDescriptor: Multiple root templates found (${templateNames}). A singular root template containing all nodes and connections is required for CablingDescriptor export.`, 'error');
        return;
    }

    const exportBtn = document.getElementById('exportCablingBtn');
    const originalText = exportBtn.textContent;

    try {
        exportBtn.textContent = '⏳ Exporting...';
        exportBtn.disabled = true;
        showExportStatus('Generating CablingDescriptor...', 'info');

        // Get current cytoscape data with full metadata (including graph_templates)
        // Sanitize elements to remove circular references
        const rawElements = state.cy.elements().jsons();
        const sanitizedElements = sanitizeForJSON(rawElements);
        const cytoscapeData = {
            elements: sanitizedElements,
            metadata: {
                ...(state.data.currentData && state.data.currentData.metadata ? state.data.currentData.metadata : {}),  // Include original metadata (graph_templates, etc.)
                visualization_mode: getVisualizationMode()  // Override/add current mode
            }
        };

        // Debug logging
        if (cytoscapeData.metadata && cytoscapeData.metadata.graph_templates) {
        } else {
        }

        // Use API client for the actual request
        const textprotoContent = await apiClient.exportCablingDescriptor(cytoscapeData);

        // Create and download file
        const blob = new Blob([textprotoContent], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Use custom filename if provided, otherwise use default
        const customFileName = document.getElementById('exportFileNameInput').value.trim();
        if (customFileName) {
            a.download = `${customFileName}_cabling_descriptor.textproto`;
        } else {
            a.download = 'cabling_descriptor.textproto';
        }

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showExportStatus('CablingDescriptor exported successfully!', 'success');

    } catch (error) {
        console.error('Export error:', error);
        showNotificationBanner(`Export failed: ${error.message}`, 'error');
    } finally {
        exportBtn.textContent = originalText;
        exportBtn.disabled = false;
    }
}

async function exportDeploymentDescriptor() {
    if (typeof cy === 'undefined' || !cy) {
        showNotificationBanner('No visualization data available', 'error');
        return;
    }

    const exportBtn = document.getElementById('exportDeploymentBtn');
    const originalText = exportBtn.textContent;

    try {
        exportBtn.textContent = '⏳ Exporting...';
        exportBtn.disabled = true;
        showExportStatus('Generating DeploymentDescriptor...', 'info');

        // Debug: Check all shelf nodes for host_index
        const allShelves = state.cy.nodes('[type="shelf"]');
        const shelvesWithoutHostIndex = [];
        const shelfDataSamples = [];  // Collect samples for debugging

        allShelves.forEach(shelf => {
            const hostIndex = shelf.data('host_index');
            const allData = shelf.data();  // Get all data fields

            // Collect first 3 samples regardless of host_index presence
            if (shelfDataSamples.length < 3) {
                shelfDataSamples.push({
                    id: shelf.id(),
                    label: shelf.data('label'),
                    all_fields: Object.keys(allData),
                    host_index: allData.host_index,
                    host_id: allData.host_id,
                    hostname: allData.hostname,
                    child_name: allData.child_name,
                    full_data: allData
                });
            }

            if (hostIndex === undefined || hostIndex === null) {
                shelvesWithoutHostIndex.push({
                    id: shelf.id(),
                    label: shelf.data('label'),
                    parent: shelf.data('parent'),
                    available_fields: Object.keys(allData),
                    host_id: allData.host_id  // Check if host_id exists instead
                });
            }
        });

        console.log('=== SHELF NODE DATA DEBUGGING ===');
        console.log(`Total shelf nodes: ${allShelves.length}`);
        console.log('Sample shelf data (first 3 nodes):', shelfDataSamples);

        if (shelvesWithoutHostIndex.length > 0) {
            console.error(`Found ${shelvesWithoutHostIndex.length} shelves without host_index:`, shelvesWithoutHostIndex);

            // Export to window for user inspection
            window.DEBUG_SHELVES_WITHOUT_HOST_INDEX = shelvesWithoutHostIndex;
            console.log('EXPORTED TO: window.DEBUG_SHELVES_WITHOUT_HOST_INDEX');
        } else {
            console.log(`✓ All ${allShelves.length} shelves have host_index`);
        }

        // Get current cytoscape data and sanitize to remove circular references
        const rawElements = state.cy.elements().jsons();
        const sanitizedElements = sanitizeForJSON(rawElements);
        const cytoscapeData = {
            elements: sanitizedElements
        };

        // Debug: Check if host_index is in the serialized data
        const serializedShelves = cytoscapeData.elements.filter(el => el.data && el.data.type === 'shelf');
        const serializedWithoutHostIndex = serializedShelves.filter(shelf => {
            const hostIndex = shelf.data.host_index;
            return hostIndex === undefined || hostIndex === null;
        });

        if (serializedWithoutHostIndex.length > 0) {
            console.error(`SERIALIZATION ISSUE: ${serializedWithoutHostIndex.length} shelves lost host_index during serialization:`,
                serializedWithoutHostIndex.map(s => ({ id: s.data.id, label: s.data.label })));
        } else {
            console.log(`Serialized data: All ${serializedShelves.length} shelves have host_index in JSON`);
        }

        // Use API client for the actual request
        const textprotoContent = await apiClient.exportDeploymentDescriptor(cytoscapeData);

        // Create and download file
        const blob = new Blob([textprotoContent], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Use custom filename if provided, otherwise use default
        const customFileName = document.getElementById('exportFileNameInput').value.trim();
        if (customFileName) {
            a.download = `${customFileName}_deployment_descriptor.textproto`;
        } else {
            a.download = 'deployment_descriptor.textproto';
        }

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showExportStatus('DeploymentDescriptor exported successfully!', 'success');

    } catch (error) {
        console.error('Export error:', error);
        showNotificationBanner(`Export failed: ${error.message}`, 'error');
    } finally {
        exportBtn.textContent = originalText;
        exportBtn.disabled = false;
    }
}

/**
 * Sanitize data by removing circular references
 * This is needed when serializing Cytoscape.js data that may contain circular references
 * @param {*} obj - Object to sanitize
 * @param {WeakSet} seen - WeakSet of already seen objects (for circular reference detection)
 * @returns {*} Sanitized object
 */
function sanitizeForJSON(obj, seen = new WeakSet()) {
    // Handle null and undefined
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Handle primitives
    const type = typeof obj;
    if (type !== 'object' && type !== 'function') {
        return obj;
    }

    // Handle Date objects
    if (obj instanceof Date) {
        return obj.toISOString();
    }

    // Handle functions (skip them)
    if (type === 'function') {
        return undefined;
    }

    // Check for circular reference
    if (seen.has(obj)) {
        return undefined; // Remove circular references
    }

    // Add to seen set
    seen.add(obj);

    try {
        // Handle arrays
        if (Array.isArray(obj)) {
            const sanitized = [];
            for (const item of obj) {
                const sanitizedItem = sanitizeForJSON(item, seen);
                // Only push non-undefined items (but allow null)
                if (sanitizedItem !== undefined) {
                    sanitized.push(sanitizedItem);
                }
            }
            return sanitized;
        }

        // Handle plain objects
        const sanitized = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                try {
                    const value = sanitizeForJSON(obj[key], seen);
                    // Only include non-undefined values (but allow null)
                    if (value !== undefined) {
                        sanitized[key] = value;
                    }
                } catch (e) {
                    // Skip properties that can't be serialized
                    console.warn(`Skipping property ${key} due to serialization error:`, e);
                }
            }
        }
        return sanitized;
    } finally {
        // Note: We don't remove from seen set here because we want to detect
        // circular references even after returning from nested calls
    }
}

async function generateCablingGuide() {
    if (typeof cy === 'undefined' || !cy) {
        showNotificationBanner('No visualization data available', 'error');
        return;
    }

    const generateBtn = document.getElementById('generateCablingGuideBtn');
    const originalText = generateBtn.textContent;

    try {
        generateBtn.textContent = '⏳ Generating...';
        generateBtn.disabled = true;
        showExportStatus('Generating cabling guide...', 'info');

        // Get current cytoscape data and sanitize to remove circular references
        const rawElements = state.cy.elements().jsons();
        const sanitizedElements = sanitizeForJSON(rawElements);
        const cytoscapeData = {
            elements: sanitizedElements
        };

        // Get input prefix for the generator
        const customFileName = document.getElementById('exportFileNameInput').value.trim();
        const inputPrefix = customFileName || 'network_topology';

        // Use API client for the actual request
        const result = await apiClient.generateCablingGuide(cytoscapeData, inputPrefix, 'cabling_guide');

        if (result.success) {
            // Download the generated CSV file
            if (result.cabling_guide_content) {
                const blob = new Blob([result.cabling_guide_content], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.cabling_guide_filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }

            showExportStatus('Cabling guide generated successfully!', 'success');
        } else {
            throw new Error(formatErrorMessage(result));
        }

    } catch (error) {
        console.error('Generation error:', error);
        showNotificationBanner(`Generation failed: ${error.message}`, 'error');
    } finally {
        generateBtn.textContent = originalText;
        generateBtn.disabled = false;
    }
}

async function generateFSD() {
    if (typeof cy === 'undefined' || !cy) {
        showNotificationBanner('No visualization data available', 'error');
        return;
    }

    // Check for nodes without hostnames and show warning
    const nodesWithoutHostname = validateHostnames();
    if (nodesWithoutHostname.length > 0) {
        showExportStatus(`Warning: The following nodes are missing hostnames: ${nodesWithoutHostname.join(', ')}. FSD generation will proceed but may have incomplete data.`, 'warning');
    }

    const generateBtn = document.getElementById('generateFSDBtn');
    const originalText = generateBtn.textContent;

    try {
        generateBtn.textContent = '⏳ Generating...';
        generateBtn.disabled = true;
        showExportStatus('Generating FSD...', 'info');

        // Get current cytoscape data and sanitize to remove circular references
        const rawElements = state.cy.elements().jsons();
        const sanitizedElements = sanitizeForJSON(rawElements);
        const cytoscapeData = {
            elements: sanitizedElements
        };

        // Get input prefix for the generator
        const customFileName = document.getElementById('exportFileNameInput').value.trim();
        const inputPrefix = customFileName || 'network_topology';

        // Use API client for the actual request
        const result = await apiClient.generateFSD(cytoscapeData, inputPrefix);

        if (result.success) {
            // Download the generated textproto file
            if (result.fsd_content) {
                const blob = new Blob([result.fsd_content], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.fsd_filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }

            showExportStatus('FSD generated successfully!', 'success');
        } else {
            throw new Error(formatErrorMessage(result));
        }

    } catch (error) {
        console.error('Generation error:', error);
        showNotificationBanner(`Generation failed: ${error.message}`, 'error');
    } finally {
        generateBtn.textContent = originalText;
        generateBtn.disabled = false;
    }
}

function formatErrorMessage(errorData) {
    let errorMessage = errorData.error || 'Unknown error occurred';

    // Add error type context
    if (errorData.error_type) {
        switch (errorData.error_type) {
            case 'generation_failed':
                errorMessage = `🚫 Cabling Generator Failed\n\n${errorMessage}`;
                if (errorData.exit_code) {
                    errorMessage += `\n\nExit Code: ${errorData.exit_code}`;
                }
                break;
            case 'timeout':
                errorMessage = `⏰ Generator Timeout\n\n${errorMessage}`;
                if (errorData.command) {
                    errorMessage += `\n\nCommand: ${errorData.command}`;
                }
                break;
            case 'execution_error':
                errorMessage = `💥 Execution Error\n\n${errorMessage}`;
                if (errorData.command) {
                    errorMessage += `\n\nCommand: ${errorData.command}`;
                }
                break;
            case 'file_not_found':
                errorMessage = `📁 File Not Found\n\n${errorMessage}`;
                if (errorData.expected_path) {
                    errorMessage += `\n\nExpected Path: ${errorData.expected_path}`;
                }
                break;
            case 'file_read_error':
                errorMessage = `📖 File Read Error\n\n${errorMessage}`;
                break;
            default:
                errorMessage = `❌ ${errorData.error_type || 'Error'}\n\n${errorMessage}`;
        }
    }

    // Add stdout/stderr if available
    if (errorData.stdout || errorData.stderr) {
        errorMessage += '\n\n--- Generator Output ---';
        if (errorData.stdout) {
            errorMessage += `\n\nSTDOUT:\n${errorData.stdout}`;
        }
        if (errorData.stderr) {
            errorMessage += `\n\nSTDERR:\n${errorData.stderr}`;
        }
    }

    return errorMessage;
}

function showExportStatus(message, type) {
    // Redirect all status messages to the top notification banner
    showNotificationBanner(message, type);
}

// Add keyboard shortcuts
document.addEventListener('keydown', function (event) {
    // Escape to clear selections and close popups
    if (event.key === 'Escape') {
        // Check if we're in an editing dialog (nodeInfo is visible)
        const nodeInfo = document.getElementById('nodeInfo');
        const isEditingDialogOpen = nodeInfo && nodeInfo.style.display === 'block';

        // Always close editing dialogs on ESC, even if typing in an input field
        if (isEditingDialogOpen) {
            event.preventDefault();
            // Close editing dialog
            if (window.cancelShelfEdit && typeof window.cancelShelfEdit === 'function') {
                window.cancelShelfEdit();
            }
            return;
        }

        // If not typing in an input field, clear all selections and close popups
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            event.preventDefault();

            // Clear all selections using the existing function
            clearAllSelections();
        }
    }

    // Backspace or Delete to delete selected connection or node (only in editing mode)
    if (event.key === 'Backspace' || event.key === 'Delete') {
        // Only delete if we're in editing mode and not typing in an input
        if (state.editing.isEdgeCreationMode && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            // Check if there's something selected to delete
            if ((state.editing.selectedConnection && state.editing.selectedConnection.length > 0) ||
                (state.editing.selectedNode && state.editing.selectedNode.length > 0)) {
                event.preventDefault();
                deleteSelectedElement();
            }
        }
    }

    // Ctrl+N to focus on new node hostname input
    if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
        event.preventDefault();
        const hostnameInput = document.getElementById('nodeHostnameInput');
        if (hostnameInput) {
            hostnameInput.focus();
            hostnameInput.select();
        }
    }

    // Ctrl+E to create empty visualization
    if ((event.ctrlKey || event.metaKey) && event.key === 'e') {
        event.preventDefault();
        createEmptyVisualization();
    }
});

// Expand/Collapse Functions - Delegates to ExpandCollapseModule
function expandOneLevel() {
    if (!state || !state.commonModule || !state.commonModule.expandCollapse) {
        return;
    }
    state.commonModule.expandCollapse.expandOneLevel();
}

function collapseOneLevel() {
    if (!state || !state.commonModule || !state.commonModule.expandCollapse) {
        return;
    }
    state.commonModule.expandCollapse.collapseOneLevel();
}

function updateExpandCollapseButtons() {
    // Enable/disable buttons based on current state
    const expandBtn = document.getElementById('expandOneLevelBtn');
    const collapseBtn = document.getElementById('collapseOneLevelBtn');

    if (!state || !state.ui) {
        // Disable if state not available
        if (expandBtn) {
            expandBtn.disabled = true;
            expandBtn.style.opacity = '0.5';
        }
        if (collapseBtn) {
            collapseBtn.disabled = true;
            collapseBtn.style.opacity = '0.5';
        }
        return;
    }

    const hasCollapsedNodes = state.ui.collapsedGraphs.size > 0;
    const hasExpandableNodes = state.cy && state.cy.nodes().length > 0;

    // Enable expand button if there are collapsed nodes
    if (expandBtn) {
        expandBtn.disabled = !hasCollapsedNodes;
        expandBtn.style.opacity = hasCollapsedNodes ? '1.0' : '0.5';
    }

    // Enable collapse button if there are expandable nodes
    if (collapseBtn) {
        collapseBtn.disabled = !hasExpandableNodes;
        collapseBtn.style.opacity = hasExpandableNodes ? '1.0' : '0.5';
    }
}

function toggleNodeCollapse(node) {
    // Placeholder - to be implemented from scratch
    console.log('toggleNodeCollapse: TODO - implement from scratch', node ? node.id() : 'no node');
}

// Initialize node configurations when the page loads
initializeNodeConfigs();

/**
 * Setup all event listeners to replace inline onclick handlers
 * This eliminates the need for functionsToExpose workaround
 */
function setupEventListeners() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupEventListeners);
        return;
    }

    // Notification banner close button
    const notificationCloseBtn = document.getElementById('notificationCloseBtn');
    if (notificationCloseBtn) {
        notificationCloseBtn.addEventListener('click', () => {
            if (typeof window.hideNotificationBanner === 'function') {
                window.hideNotificationBanner();
            }
        });
    }

    // Tab navigation buttons
    const locationTab = document.getElementById('locationTab');
    if (locationTab) {
        locationTab.addEventListener('click', () => {
            if (typeof window.switchTab === 'function') {
                window.switchTab('location');
            }
        });
    }

    const topologyTab = document.getElementById('topologyTab');
    if (topologyTab) {
        topologyTab.addEventListener('click', () => {
            if (typeof window.switchTab === 'function') {
                window.switchTab('topology');
            }
        });
    }

    // Upload buttons
    const uploadBtnLocation = document.getElementById('uploadBtnLocation');
    if (uploadBtnLocation) {
        uploadBtnLocation.addEventListener('click', () => {
            if (typeof window.uploadFileLocation === 'function') {
                window.uploadFileLocation();
            }
        });
    }

    const uploadBtnTopology = document.getElementById('uploadBtnTopology');
    if (uploadBtnTopology) {
        uploadBtnTopology.addEventListener('click', () => {
            if (typeof window.uploadFileTopology === 'function') {
                window.uploadFileTopology();
            }
        });
    }

    // Empty visualization buttons
    const emptyVisualizationBtnLocation = document.getElementById('emptyVisualizationBtnLocation');
    if (emptyVisualizationBtnLocation) {
        emptyVisualizationBtnLocation.addEventListener('click', () => {
            if (typeof window.createEmptyVisualizationLocation === 'function') {
                window.createEmptyVisualizationLocation();
            }
        });
    }

    const emptyVisualizationBtnTopology = document.getElementById('emptyVisualizationBtnTopology');
    if (emptyVisualizationBtnTopology) {
        emptyVisualizationBtnTopology.addEventListener('click', () => {
            if (typeof window.createEmptyVisualizationTopology === 'function') {
                window.createEmptyVisualizationTopology();
            }
        });
    }

    // Control buttons
    const toggleModeButton = document.getElementById('toggleModeButton');
    if (toggleModeButton) {
        toggleModeButton.addEventListener('click', () => {
            if (typeof window.toggleVisualizationMode === 'function') {
                window.toggleVisualizationMode();
            }
        });
    }

    const resetLayoutBtn = document.getElementById('resetLayoutBtn');
    if (resetLayoutBtn) {
        resetLayoutBtn.addEventListener('click', () => {
            if (typeof window.resetLayout === 'function') {
                window.resetLayout();
            }
        });
    }

    const expandOneLevelBtn = document.getElementById('expandOneLevelBtn');
    if (expandOneLevelBtn) {
        expandOneLevelBtn.addEventListener('click', () => {
            if (typeof window.expandOneLevel === 'function') {
                window.expandOneLevel();
            }
        });
    }

    const collapseOneLevelBtn = document.getElementById('collapseOneLevelBtn');
    if (collapseOneLevelBtn) {
        collapseOneLevelBtn.addEventListener('click', () => {
            if (typeof window.collapseOneLevel === 'function') {
                window.collapseOneLevel();
            }
        });
    }


    // Cabling editor buttons
    const toggleEdgeHandlesBtn = document.getElementById('toggleEdgeHandlesBtn');
    if (toggleEdgeHandlesBtn) {
        toggleEdgeHandlesBtn.addEventListener('click', () => {
            if (typeof window.toggleEdgeHandles === 'function') {
                window.toggleEdgeHandles();
            }
        });
    }

    const deleteElementBtn = document.getElementById('deleteElementBtn');
    if (deleteElementBtn) {
        deleteElementBtn.addEventListener('click', () => {
            if (typeof window.deleteSelectedElement === 'function') {
                window.deleteSelectedElement();
            }
        });
    }

    // Node/graph editing buttons
    const addNodeBtn = document.getElementById('addNodeBtn');
    if (addNodeBtn) {
        addNodeBtn.addEventListener('click', () => {
            if (typeof window.addNewNode === 'function') {
                window.addNewNode();
            }
        });
    }

    const addGraphBtn = document.getElementById('addGraphBtn');
    if (addGraphBtn) {
        addGraphBtn.addEventListener('click', () => {
            if (typeof window.addNewGraph === 'function') {
                window.addNewGraph();
            }
        });
    }

    const createTemplateBtn = document.getElementById('createTemplateBtn');
    if (createTemplateBtn) {
        createTemplateBtn.addEventListener('click', () => {
            if (typeof window.createNewTemplate === 'function') {
                window.createNewTemplate();
            }
        });
    }

    // Connection filter reset button
    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', () => {
            if (commonModule && typeof commonModule.resetConnectionFilters === 'function') {
                commonModule.resetConnectionFilters();
            }
        });
    }

    // Export buttons
    const exportCablingBtn = document.getElementById('exportCablingBtn');
    if (exportCablingBtn) {
        exportCablingBtn.addEventListener('click', () => {
            if (typeof window.exportCablingDescriptor === 'function') {
                window.exportCablingDescriptor();
            }
        });
    }

    const exportDeploymentBtn = document.getElementById('exportDeploymentBtn');
    if (exportDeploymentBtn) {
        exportDeploymentBtn.addEventListener('click', () => {
            if (typeof window.exportDeploymentDescriptor === 'function') {
                window.exportDeploymentDescriptor();
            }
        });
    }

    const generateCablingGuideBtn = document.getElementById('generateCablingGuideBtn');
    if (generateCablingGuideBtn) {
        generateCablingGuideBtn.addEventListener('click', () => {
            if (typeof window.generateCablingGuide === 'function') {
                window.generateCablingGuide();
            }
        });
    }

    const generateFSDBtn = document.getElementById('generateFSDBtn');
    if (generateFSDBtn) {
        generateFSDBtn.addEventListener('click', () => {
            if (typeof window.generateFSD === 'function') {
                window.generateFSD();
            }
        });
    }

    // Modal buttons
    const cancelConnectionPlacementBtn = document.getElementById('cancelConnectionPlacementBtn');
    if (cancelConnectionPlacementBtn) {
        cancelConnectionPlacementBtn.addEventListener('click', () => {
            if (typeof window.cancelConnectionPlacement === 'function') {
                window.cancelConnectionPlacement();
            }
        });
    }

    const manualLayoutTab = document.getElementById('manualLayoutTab');
    if (manualLayoutTab) {
        manualLayoutTab.addEventListener('click', () => {
            if (typeof window.switchLayoutTab === 'function') {
                window.switchLayoutTab('manual');
            }
        });
    }

    const uploadLayoutTab = document.getElementById('uploadLayoutTab');
    if (uploadLayoutTab) {
        uploadLayoutTab.addEventListener('click', () => {
            if (typeof window.switchLayoutTab === 'function') {
                window.switchLayoutTab('upload');
            }
        });
    }

    const cancelPhysicalLayoutModalBtn = document.getElementById('cancelPhysicalLayoutModalBtn');
    if (cancelPhysicalLayoutModalBtn) {
        cancelPhysicalLayoutModalBtn.addEventListener('click', () => {
            if (typeof window.cancelPhysicalLayoutModal === 'function') {
                window.cancelPhysicalLayoutModal();
            }
        });
    }

    const applyLayoutBtn = document.getElementById('applyLayoutBtn');
    if (applyLayoutBtn) {
        applyLayoutBtn.addEventListener('click', () => {
            if (typeof window.applyPhysicalLayout === 'function') {
                window.applyPhysicalLayout();
            }
        });
    }

    const applyUploadBtn = document.getElementById('applyUploadBtn');
    if (applyUploadBtn) {
        applyUploadBtn.addEventListener('click', () => {
            if (typeof window.applyDeploymentDescriptorFromModal === 'function') {
                window.applyDeploymentDescriptorFromModal();
            }
        });
    }

    // Collapsible headers (these use toggleCollapsible which is in HTML inline script)
    const collapsibleHeaders = document.querySelectorAll('.collapsible-header[data-section]');
    collapsibleHeaders.forEach(header => {
        const sectionId = header.getAttribute('data-section');
        if (sectionId) {
            header.addEventListener('click', () => {
                if (typeof window.toggleCollapsible === 'function') {
                    window.toggleCollapsible(sectionId);
                }
            });
        }
    });

    console.log('[EventListeners] All event listeners set up');
}

// Setup event listeners when DOM is ready
setupEventListeners();

// Tab-specific empty visualization functions
function createEmptyVisualizationLocation() {
    // Hide initialization section and show visualization controls
    const initSection = document.getElementById('initializationSection');
    if (initSection) {
        initSection.style.display = 'none';
    }

    const controlSections = document.getElementById('controlSections');
    if (controlSections) {
        controlSections.style.display = 'block';
    }

    // Call the main empty visualization function
    createEmptyVisualization();
}

function createEmptyVisualizationTopology() {
    // Hide initialization section and show visualization controls
    const initSection = document.getElementById('initializationSection');
    if (initSection) {
        initSection.style.display = 'none';
    }

    const controlSections = document.getElementById('controlSections');
    if (controlSections) {
        controlSections.style.display = 'block';
    }

    // Call the main empty visualization function
    createEmptyVisualization();
}

function uploadFileTopology() {
    // Just call the main uploadFile function - it will auto-detect the topology file input
    uploadFile();
}

// Add event listener for graph template dropdown to enable/disable button
// Instance names are now auto-generated, so we only check for template selection
document.getElementById('graphTemplateSelect').addEventListener('change', function () {
    const addGraphBtn = document.getElementById('addGraphBtn');
    const hasTemplate = this.value && this.value !== '';

    if (cy && hasTemplate) {
        addGraphBtn.disabled = false;
        addGraphBtn.style.cursor = 'pointer';
        addGraphBtn.style.background = '#007bff';
        addGraphBtn.style.opacity = '1';
    } else {
        addGraphBtn.disabled = true;
        addGraphBtn.style.cursor = 'not-allowed';
        addGraphBtn.style.background = '#6c757d';
        addGraphBtn.style.opacity = '0.6';
    }
});

// Label input event listener removed - instance names are now auto-generated as {template_name}_{index}

// ===== Expose Functions to Global Scope =====
// Phase 8 Complete: All inline onclick handlers have been replaced with event listeners.
// Functions are still exposed for:
//   1. HTML inline scripts that call them (e.g., uploadFileLocation, applyDeploymentDescriptorFromModal)
//   2. Event listeners that check for function existence (defensive programming)
//
// Note: Most button clicks are now handled by setupEventListeners() in visualizer.js.
// Only functions called from HTML inline scripts need to remain exposed.
const functionsToExpose = {
    // Core visualization functions
    initVisualization,
    createEmptyVisualization,
    createEmptyVisualizationLocation,
    createEmptyVisualizationTopology,

    // File upload functions
    uploadFile,
    uploadFileTopology,

    // Mode and layout functions
    toggleVisualizationMode,
    resetLayout,
    setVisualizationMode,
    getVisualizationMode,
    location_switchMode,
    hierarchy_switchMode,
    updateModeIndicator,

    // Node and graph editing
    addNewNode,
    addNewGraph,
    createNewTemplate,
    deleteSelectedElement,
    toggleEdgeHandles,

    // Connection management
    cancelConnectionPlacement,

    // Export functions
    exportCablingDescriptor,
    exportDeploymentDescriptor,
    generateCablingGuide,
    generateFSD,

    // Expand/collapse
    expandOneLevel,
    collapseOneLevel,

    // Filter functions
    applyConnectionTypeFilter,
    applyNodeFilter,
    populateNodeFilterDropdown,
    populateTemplateFilterDropdown,

    // Physical layout modal
    cancelPhysicalLayoutModal,
    applyPhysicalLayout,

    // UI helpers
    updateConnectionLegend,
    hideNotificationBanner,
    showNotificationBanner,
    showExportStatus,

    // Event handler functions (required for Cytoscape event handlers)
    showNodeInfo,
    showConnectionInfo,
    enableShelfEditing,
    enableGraphTemplateEditing,
    handlePortClickEditMode,
    handlePortClickViewMode,
    clearAllSelections,
    updateDeleteButtonState,
    updateDeleteNodeButtonState,
    toggleNodeCollapse,
};

// Expose all functions to window object
// TODO: Phase 8 - Replace inline onclick handlers with event listeners to eliminate this workaround
Object.keys(functionsToExpose).forEach(key => {
    window[key] = functionsToExpose[key];
});
