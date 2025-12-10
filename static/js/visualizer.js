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
 * Phase 8-9: ✅ Complete
 *   - All major functions extracted to modules
 *   - Clean orchestration layer established
 *   - Target of <1,000 lines achieved (932 lines)
 * 
 * Phase 10: ✅ Complete (Final Polish)
 *   - Code quality improvements (removed NOTE comments, consolidated wrappers, optimized listeners)
 *   - HTML inline scripts moved to visualizer.js
 *   - Functions now use state.* instead of window.* globals where possible
 * 
 * Current State:
 * ==============
 * - Legacy globals kept in sync with state via observers (for Cytoscape event handlers)
 * - Functions exposed to window object for Cytoscape event handlers and external dependencies
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
import { ExportModule } from './modules/export.js';
import { UIDisplayModule } from './modules/ui-display.js';
import { FileManagementModule } from './modules/file-management.js';
import { deleteMultipleSelected as deleteMultipleSelectedUtil, deleteConnectionFromAllTemplateInstances as deleteConnectionFromAllTemplateInstancesUtil } from './utils/node-management.js';
import { verifyCytoscapeExtensions as verifyCytoscapeExtensionsUtil } from './utils/cytoscape-utils.js';
import { ApiClient } from './api/api-client.js';
import { NotificationManager } from './ui/notification-manager.js';
import { ModalManager } from './ui/modal-manager.js';
import { StatusManager } from './ui/status-manager.js';

// ===== Wrapper Functions (Backward Compatibility) =====
// These thin wrappers delegate to modules and are exposed to window for HTML access

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

// Initialize API client
const apiClient = new ApiClient();

// Initialize UI managers
const notificationManager = new NotificationManager();
const modalManager = new ModalManager();
const statusManager = new StatusManager();

// ===== Initialize Modules Eagerly =====
// Initialize location and hierarchy modules immediately (no lazy loading)
const locationModule = new LocationModule(state, commonModule);
const hierarchyModule = new HierarchyModule(state, commonModule);
const exportModule = new ExportModule(state, commonModule, apiClient, notificationManager, statusManager);

// Expose modules to window for debugging and external access
window.locationModule = locationModule;
window.hierarchyModule = hierarchyModule;

// Initialize UI display module with both modules
const uiDisplayModule = new UIDisplayModule(state, commonModule, locationModule, hierarchyModule, notificationManager, statusManager);

// Initialize file management module (depends on uiDisplayModule)
const fileManagementModule = new FileManagementModule(state, apiClient, uiDisplayModule, notificationManager);

// Expose commonModule for debugging
window.commonModule = commonModule;

// Expose modalManager to window for module access
window.modalManager = modalManager;

// ===== Window Globals (Backward Compatibility) =====
// These are synced via observers for external dependencies (tests, debugging, etc.)
// Modules should use state.* directly instead of window.*
window.currentData = null;
window.cy = null;
window.initialVisualizationData = null;
stateObserver.subscribe('cy', (newVal) => { window.cy = newVal; });
stateObserver.subscribe('data.currentData', (newVal) => { window.currentData = newVal; });
stateObserver.subscribe('data.initialVisualizationData', (newVal) => { window.initialVisualizationData = newVal; });

// ===== Visualization Mode Management =====
function setVisualizationMode(mode) {
    state.setMode(mode);
    document.body.classList.remove('mode-location', 'mode-hierarchy');
    if (mode === 'location') {
        document.body.classList.add('mode-location');
    } else if (mode === 'hierarchy') {
        document.body.classList.add('mode-hierarchy');
    }
    updateModeIndicator();
    if (state.cy && typeof populateNodeFilterDropdown === 'function') populateNodeFilterDropdown();
    if (state.cy && mode === 'hierarchy' && typeof populateTemplateFilterDropdown === 'function') populateTemplateFilterDropdown();
}
function getVisualizationMode() { return state.mode; }
function updateModeIndicator() { return uiDisplayModule.updateModeIndicator(); }
function extractGraphTemplates(data) { return uiDisplayModule.extractGraphTemplates(data); }
function populateGraphTemplateDropdown() { return uiDisplayModule.populateGraphTemplateDropdown(); }
function toggleVisualizationMode() {
    return uiDisplayModule.toggleVisualizationMode();
}
function location_switchMode() {
    return locationModule.switchMode();
}
function hierarchy_switchMode() {
    return hierarchyModule.switchMode();
}
function organizeInGrid() {
    return locationModule.organizeInGrid();
}

let NODE_CONFIGS = {};
function initializeNodeConfigs() {
    NODE_CONFIGS = (window.SERVER_NODE_CONFIGS && Object.keys(window.SERVER_NODE_CONFIGS).length > 0)
        ? initNodeTypesConfig(window.SERVER_NODE_CONFIGS) : initNodeTypesConfig();
}
function getNextConnectionNumber() { return commonModule.getNextConnectionNumber(); }
function getEthChannelMapping(nodeType, portNumber) { return commonModule.getEthChannelMapping(nodeType, portNumber); }
function updateDeleteButtonState() { return uiDisplayModule.updateDeleteButtonState(); }
function updateDeleteNodeButtonState() { return uiDisplayModule.updateDeleteButtonState(); }

function formatRackNum(rackNum) {
    return locationModule.formatRackNum(rackNum);
}
function formatShelfU(shelfU) {
    return locationModule.formatShelfU(shelfU);
}
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

function getNodeDisplayLabel(nodeData) {
    return commonModule.getNodeDisplayLabel(nodeData, locationModule);
}
function hierarchy_getPath(node) {
    return hierarchyModule.getPath(node);
}
function handlePortClickEditMode(node, evt) {
    return commonModule.handlePortClickEditMode(node, evt, hierarchyModule);
}
function handlePortClickViewMode(node, evt) { return commonModule.handlePortClickViewMode(node, evt); }
function clearAllSelections() { return commonModule.clearAllSelections(); }
function getPortLocationInfo(portNode) {
    return commonModule.getPortLocationInfo(portNode, locationModule);
}
function updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel) {
    return hierarchyModule.updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel);
}
function recalculateHostIndicesForTemplates() {
    return hierarchyModule.recalculateHostIndicesForTemplates();
}
function deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName) {
    return hierarchyModule.deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName);
}
function deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, childType) {
    return hierarchyModule.deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, childType);
}
function findCommonAncestorGraph(node1, node2) {
    return hierarchyModule.findCommonAncestor(node1, node2);
}
function enumerateValidParentTemplates(node) {
    return hierarchyModule.enumerateValidParentTemplates(node);
}
function enumeratePlacementLevels(sourcePort, targetPort) {
    return hierarchyModule.enumeratePlacementLevels(sourcePort, targetPort);
}
function isPlacementLevelAvailable(sourcePort, targetPort, placementGraphNode, placementTemplateName, sourceShelf, targetShelf) {
    return hierarchyModule.isPlacementLevelAvailable(sourcePort, targetPort, placementGraphNode, placementTemplateName, sourceShelf, targetShelf);
}
function calculateDuplicationCount(graphNode, sourceShelf, targetShelf) {
    return hierarchyModule.calculateDuplicationCount(graphNode, sourceShelf, targetShelf);
}
function deleteMultipleSelected() {
    return deleteMultipleSelectedUtil(state, hierarchyModule, commonModule);
}
function deleteSelectedElement() { return deleteMultipleSelected(); }
function updatePortConnectionStatus() { return commonModule.updatePortConnectionStatus(); }
function createConnection(sourceId, targetId) {
    return commonModule.createConnection(sourceId, targetId, hierarchyModule);
}
function showConnectionPlacementModal(sourceNode, targetNode, placementLevels) {
    return hierarchyModule.showConnectionPlacementModal(sourceNode, targetNode, placementLevels);
}
function handleConnectionPlacementModalClick(event) {
    return hierarchyModule.handleConnectionPlacementModalClick(event);
}
function selectConnectionPlacementLevel(sourceNode, targetNode, selectedLevel) {
    return hierarchyModule.selectConnectionPlacementLevel(sourceNode, targetNode, selectedLevel);
}
function cancelConnectionPlacement() {
    return hierarchyModule.cancelConnectionPlacement();
}



function showPhysicalLayoutModal() { return uiDisplayModule.showPhysicalLayoutModal(); }
function handlePhysicalLayoutModalClick(event) { return uiDisplayModule.handlePhysicalLayoutModalClick(event); }
function cancelPhysicalLayoutModal() { return uiDisplayModule.cancelPhysicalLayoutModal(); }
function parseList(text) { return uiDisplayModule.parseList(text); }
function parseRange(rangeStr) { return uiDisplayModule.parseRange(rangeStr); }
function parseFlexibleInput(input) { return uiDisplayModule.parseFlexibleInput(input); }
function parseHallNames() { return uiDisplayModule.parseHallNames(); }
function parseAisleNames() { return uiDisplayModule.parseAisleNames(); }
function parseRackNumbers() { return uiDisplayModule.parseRackNumbers(); }
function parseShelfUnitNumbers() { return uiDisplayModule.parseShelfUnitNumbers(); }
function updateTotalCapacity() { return uiDisplayModule.updateTotalCapacity(); }
function applyPhysicalLayout() { return uiDisplayModule.applyPhysicalLayout(); }



function createConnectionAtLevel(sourceNode, targetNode, selectedLevel) {
    return commonModule.createConnectionAtLevel(sourceNode, targetNode, selectedLevel, hierarchyModule);
}
function createSingleConnection(sourceNode, targetNode, template_name, depth) { return commonModule.createSingleConnection(sourceNode, targetNode, template_name, depth); }
function createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth) {
    return hierarchyModule.createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth);
}
function updateAddNodeButtonState() { return uiDisplayModule.updateAddNodeButtonState(); }
function createEmptyVisualization() { return uiDisplayModule.createEmptyVisualization(); }
function resetLayout() { return uiDisplayModule.resetLayout(); }


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
function templateContainsTemplate(parentTemplateName, childTemplateName) {
    return hierarchyModule.templateContainsTemplate(parentTemplateName, childTemplateName);
}
function addNewGraph() {
    const graphTemplateSelect = document.getElementById('graphTemplateSelect');
    hierarchyModule.addGraph(graphTemplateSelect);
}
function createNewTemplate() {
    return hierarchyModule.createNewTemplate();
}
function toggleEdgeHandles() { return uiDisplayModule.toggleEdgeHandles(); }
function updatePortEditingHighlight() { return commonModule.updatePortEditingHighlight(); }
function setupFileUploadDragAndDrop() {
    return fileManagementModule.setupDragAndDrop();
}
function uploadFile() {
    return fileManagementModule.uploadFile();
}

function showNotificationBanner(message, type = 'success') { return notificationManager.show(message, type); }
function hideNotificationBanner() { return notificationManager.hide(); }
function showError(message) { return notificationManager.error(message); }
function showSuccess(message) { return notificationManager.success(message); }
function showWarning(message) { return notificationManager.warning(message); }
function hideMessages() { return notificationManager.hide(); }
function updateConnectionLegend(data) { return uiDisplayModule.updateConnectionLegend(data); }
function updateAllEdgeColorsToTemplateColors() { return uiDisplayModule.updateAllEdgeColorsToTemplateColors(); }
function initVisualization(data) { return uiDisplayModule.initVisualization(data); }
function forceApplyCurveStyles() { return commonModule.forceApplyCurveStyles(); }
function checkSameShelf(sourceId, targetId) { return commonModule.checkSameShelf(sourceId, targetId); }
function getParentAtLevel(node, level) { return commonModule.getParentAtLevel(node, level); }
function getCytoscapeStyles() { return commonModule.getCytoscapeStyles(); }
function addCytoscapeEventHandlers() { return commonModule.addCytoscapeEventHandlers(); }
function addConnectionTypeEventHandlers() {
    locationModule.addConnectionTypeEventHandlers();
    commonModule.addNodeFilterHandler();
    hierarchyModule.addTemplateFilterHandler();
}
function applyConnectionTypeFilter() { return commonModule.applyConnectionTypeFilter(); }
function getParentShelfNode(node) { return commonModule.getParentShelfNode(node); }
function extractShelfIdFromNodeId(nodeId) { return commonModule.extractShelfIdFromNodeId(nodeId); }
function getOriginalEdgeEndpoints(edge) { return commonModule.getOriginalEdgeEndpoints(edge); }
function applyNodeFilter() { return commonModule.applyNodeFilter(); }
function populateNodeFilterDropdown() {
    return commonModule.populateNodeFilterDropdown(locationModule);
}
function populateTemplateFilterDropdown() {
    if (hierarchyModule && typeof hierarchyModule.populateTemplateFilterDropdown === 'function') {
        hierarchyModule.populateTemplateFilterDropdown();
    }
}
function showNodeInfo(node, position) { return commonModule.showNodeInfo(node, position); }
function hideNodeInfo() { return commonModule.hideNodeInfo(); }
function showConnectionInfo(edge, position) { return commonModule.showConnectionInfo(edge, position); }
function enableShelfEditing(node, position) {
    return commonModule.enableShelfEditing(node, position);
}
function updateNodeAndDescendants(node, property, value) { return commonModule.updateNodeAndDescendants(node, property, value); }

// Window function assignments (backward compatibility for HTML inline scripts)
window.saveShelfEdit = (nodeId) => {
    locationModule.saveShelfEdit(nodeId);
};
window.cancelShelfEdit = () => {
    locationModule.cancelShelfEdit();
};
window.enableHallEditing = (node, position) => {
    locationModule.enableHallEditing(node, position);
};
window.enableAisleEditing = (node, position) => {
    locationModule.enableAisleEditing(node, position);
};
window.enableRackEditing = (node, position) => {
    locationModule.enableRackEditing(node, position);
};
window.saveHallEdit = (nodeId) => {
    locationModule.saveHallEdit(nodeId);
};
window.saveAisleEdit = (nodeId) => {
    locationModule.saveAisleEdit(nodeId);
};
window.saveRackEdit = (nodeId) => {
    locationModule.saveRackEdit(nodeId);
};
window.saveGraphTemplateEdit = (nodeId) => {
    hierarchyModule.saveGraphTemplateEdit(nodeId);
};
window.cancelGraphTemplateEdit = (nodeId) => {
    hierarchyModule.cancelGraphTemplateEdit(nodeId);
};
window.executeMoveToTemplate = (nodeId) => {
    hierarchyModule.executeMoveToTemplate(nodeId);
};

function enableGraphTemplateEditing(node, position) {
    return hierarchyModule.enableGraphTemplateEditing(node, position);
}
function populateMoveTargetTemplates(node) {
    return hierarchyModule.populateMoveTargetTemplates(node);
}
function validateHostnames() {
    return exportModule.validateHostnames();
}
function exportCablingDescriptor() {
    return exportModule.exportCablingDescriptor();
}
function exportDeploymentDescriptor() {
    return exportModule.exportDeploymentDescriptor();
}
function generateCablingGuide() {
    return exportModule.generateCablingGuide();
}
function generateFSD() {
    return exportModule.generateFSD();
}
function showExportStatus(message, type) { return uiDisplayModule.showExportStatus(message, type); }

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
            window.cancelShelfEdit?.();
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

function expandOneLevel() { if (state && state.commonModule && state.commonModule.expandCollapse) state.commonModule.expandCollapse.expandOneLevel(); }
function collapseOneLevel() { if (state && state.commonModule && state.commonModule.expandCollapse) state.commonModule.expandCollapse.collapseOneLevel(); }
function updateExpandCollapseButtons() { return uiDisplayModule.updateExpandCollapseButtons(); }
function toggleNodeCollapse(node) { console.log('toggleNodeCollapse: TODO - implement from scratch', node ? node.id() : 'no node'); }

// Initialize node configurations when the page loads
initializeNodeConfigs();

// Setup file upload drag-and-drop handlers
setupFileUploadDragAndDrop();

// Helper function to safely attach event listeners
function attachEventListener(selector, event, handler) {
    const element = document.getElementById(selector);
    if (element && typeof handler === 'function') {
        element.addEventListener(event, handler);
        return true;
    }
    return false;
}

function setupEventListeners() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupEventListeners);
        return;
    }

    // Notification banner
    attachEventListener('notificationCloseBtn', 'click', () => hideNotificationBanner());

    // Tab navigation
    attachEventListener('locationTab', 'click', () => switchTab('location'));
    attachEventListener('topologyTab', 'click', () => switchTab('topology'));

    // Upload buttons
    attachEventListener('uploadBtnLocation', 'click', () => uploadFileLocation());
    attachEventListener('uploadBtnTopology', 'click', () => uploadFileTopology());

    // Empty visualization buttons
    attachEventListener('emptyVisualizationBtnLocation', 'click', () => createEmptyVisualizationLocation());
    attachEventListener('emptyVisualizationBtnTopology', 'click', () => createEmptyVisualizationTopology());

    // Control buttons
    attachEventListener('toggleModeButton', 'click', () => toggleVisualizationMode());
    attachEventListener('resetLayoutBtn', 'click', () => resetLayout());
    attachEventListener('expandOneLevelBtn', 'click', () => expandOneLevel());
    attachEventListener('collapseOneLevelBtn', 'click', () => collapseOneLevel());

    // Cabling editor buttons
    attachEventListener('toggleEdgeHandlesBtn', 'click', () => toggleEdgeHandles());
    attachEventListener('deleteElementBtn', 'click', () => deleteSelectedElement());

    // Node/graph editing buttons
    attachEventListener('addNodeBtn', 'click', () => addNewNode());
    attachEventListener('addGraphBtn', 'click', () => addNewGraph());
    attachEventListener('createTemplateBtn', 'click', () => createNewTemplate());

    // Connection filter reset button
    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', () => {
            if (commonModule?.resetConnectionFilters) commonModule.resetConnectionFilters();
        });
    }

    // Export buttons
    attachEventListener('exportCablingBtn', 'click', () => exportCablingDescriptor().catch(err => console.error('Error exporting cabling:', err)));
    attachEventListener('exportDeploymentBtn', 'click', () => exportDeploymentDescriptor().catch(err => console.error('Error exporting deployment:', err)));
    attachEventListener('generateCablingGuideBtn', 'click', () => generateCablingGuide().catch(err => console.error('Error generating guide:', err)));
    attachEventListener('generateFSDBtn', 'click', () => generateFSD().catch(err => console.error('Error generating FSD:', err)));

    // Modal buttons
    attachEventListener('cancelConnectionPlacementBtn', 'click', () => {
        try {
            cancelConnectionPlacement();
        } catch (err) {
            console.error('Error canceling connection placement:', err);
        }
    });
    attachEventListener('manualLayoutTab', 'click', () => switchLayoutTab('manual'));
    attachEventListener('uploadLayoutTab', 'click', () => switchLayoutTab('upload'));
    attachEventListener('cancelPhysicalLayoutModalBtn', 'click', () => cancelPhysicalLayoutModal());
    attachEventListener('applyLayoutBtn', 'click', () => applyPhysicalLayout());
    attachEventListener('applyUploadBtn', 'click', () => applyDeploymentDescriptorFromModal().catch(err => console.error('Error applying deployment descriptor:', err)));

    // Collapsible headers
    document.querySelectorAll('.collapsible-header[data-section]').forEach(header => {
        const sectionId = header.getAttribute('data-section');
        if (sectionId) {
            header.addEventListener('click', () => toggleCollapsible(sectionId));
        }
    });

    console.log('[EventListeners] All event listeners set up');
}

// Setup event listeners when DOM is ready
setupEventListeners();

// Tab-specific empty visualization functions
function createEmptyVisualizationLocation() {
    setVisualizationMode('location');
    createEmptyVisualization();
    hideInitializationShowControls();
}

function createEmptyVisualizationTopology() {
    setVisualizationMode('hierarchy');
    createEmptyVisualization();
    hideInitializationShowControls();
}

function uploadFileTopology() {
    uploadFile();
}

// ===== HTML Inline Script Functions (Moved from templates/index.html) =====

function toggleCollapsible(sectionId) {
    const content = document.getElementById(sectionId);
    const arrow = document.getElementById(sectionId + '-arrow');
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        arrow.classList.add('expanded');
    } else {
        content.classList.remove('expanded');
        content.classList.add('collapsed');
        arrow.classList.remove('expanded');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
    const flowDescLocation = document.getElementById('flowDescriptionLocation');
    const flowDescTopology = document.getElementById('flowDescriptionTopology');
    if (tabName === 'location') {
        document.getElementById('locationTabContent').classList.add('active');
        document.getElementById('locationTab').classList.add('active');
        if (flowDescLocation) flowDescLocation.style.display = 'block';
        if (flowDescTopology) flowDescTopology.style.display = 'none';
    } else if (tabName === 'topology') {
        document.getElementById('topologyTabContent').classList.add('active');
        document.getElementById('topologyTab').classList.add('active');
        if (flowDescLocation) flowDescLocation.style.display = 'none';
        if (flowDescTopology) flowDescTopology.style.display = 'block';
    }
}

function switchLayoutTab(tabName) {
    const manualTab = document.getElementById('manualLayoutTab');
    const uploadTab = document.getElementById('uploadLayoutTab');
    const manualContent = document.getElementById('manualLayoutContent');
    const uploadContent = document.getElementById('uploadLayoutContent');
    const applyLayoutBtn = document.getElementById('applyLayoutBtn');
    const applyUploadBtn = document.getElementById('applyUploadBtn');
    if (tabName === 'manual') {
        manualTab.classList.add('active');
        uploadTab.classList.remove('active');
        manualTab.style.borderBottom = '3px solid #007bff';
        uploadTab.style.borderBottom = '3px solid transparent';
        manualTab.style.fontWeight = 'bold';
        uploadTab.style.fontWeight = 'normal';
        manualContent.style.display = 'block';
        uploadContent.style.display = 'none';
        applyLayoutBtn.style.display = 'inline-block';
        applyUploadBtn.style.display = 'none';
    } else {
        uploadTab.classList.add('active');
        manualTab.classList.remove('active');
        uploadTab.style.borderBottom = '3px solid #007bff';
        manualTab.style.borderBottom = '3px solid transparent';
        uploadTab.style.fontWeight = 'bold';
        manualTab.style.fontWeight = 'normal';
        uploadContent.style.display = 'block';
        manualContent.style.display = 'none';
        applyUploadBtn.style.display = 'inline-block';
        applyLayoutBtn.style.display = 'none';
    }
}

function hideMessagesForMode(mode) {
    const errorId = mode === 'location' ? 'errorLocation' : 'errorTopology';
    const successId = mode === 'location' ? 'successLocation' : 'successTopology';
    const errorDiv = document.getElementById(errorId);
    const successDiv = document.getElementById(successId);
    if (errorDiv) errorDiv.style.display = 'none';
    if (successDiv) successDiv.style.display = 'none';
}

function showErrorForMode(mode, message) {
    const errorId = mode === 'location' ? 'errorLocation' : 'errorTopology';
    const errorDiv = document.getElementById(errorId);
    if (errorDiv) {
        errorDiv.innerHTML = message;
        errorDiv.style.display = 'block';
    }
}

function showSuccessForMode(mode, message) {
    const successId = mode === 'location' ? 'successLocation' : 'successTopology';
    const successDiv = document.getElementById(successId);
    if (successDiv) {
        successDiv.innerHTML = message;
        successDiv.style.display = 'block';
        setTimeout(() => { successDiv.style.display = 'none'; }, 5000);
    }
}

function showErrorLocation(message) {
    showErrorForMode('location', message);
    setTimeout(() => hideMessagesForMode('location'), 5000);
}

function showSuccessLocation(message) {
    showSuccessForMode('location', message);
}

function hideInitializationShowControls() {
    const initSection = document.getElementById('initializationSection');
    if (initSection) initSection.style.display = 'none';
    const controlSections = document.getElementById('controlSections');
    if (controlSections) controlSections.style.display = 'block';
}

async function uploadFileGeneric(file, mode) {
    const loadingId = mode === 'location' ? 'loadingLocation' : 'loadingTopology';
    const uploadBtnId = mode === 'location' ? 'uploadBtnLocation' : 'uploadBtnTopology';
    const loading = document.getElementById(loadingId);
    const uploadBtn = document.getElementById(uploadBtnId);
    if (!loading || !uploadBtn) return;

    state.data.currentData = null;
    state.editing.selectedConnection = null;
    state.editing.isEdgeCreationMode = false;

    loading.style.display = 'block';
    uploadBtn.disabled = true;
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = 'Processing...';
    hideMessagesForMode(mode);

    const formData = new FormData();
    formData.append('csv_file', file);

    try {
        const response = await fetch('/upload_csv', { method: 'POST', body: formData });
        const result = await response.json();
        if (response.ok && result.success) {
            state.data.currentData = result.data;
            if (result.unknown_types && result.unknown_types.length > 0) {
                const unknownTypesStr = result.unknown_types.map(t => t.toUpperCase()).join(', ');
                showSuccessForMode(mode, `Successfully processed ${file.name}!<br><strong>⚠️ Warning:</strong> Unknown node types detected and auto-configured: ${unknownTypesStr}`);
            } else {
                showSuccessForMode(mode, `Successfully processed ${file.name}!`);
            }
            initVisualization(result.data);
            updateConnectionLegend(result.data);
            hideInitializationShowControls();
        } else {
            showErrorForMode(mode, result.error || 'Failed to process file');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showErrorForMode(mode, 'Network error: ' + error.message);
    } finally {
        loading.style.display = 'none';
        uploadBtn.disabled = false;
        uploadBtn.textContent = originalText;
    }
}

async function uploadFileLocation() {
    const fileInput = document.getElementById('csvFileLocation');
    const file = fileInput?.files[0];
    if (!file) {
        showErrorLocation('Please select a file first.');
        return;
    }
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.csv')) {
        await uploadFileGeneric(file, 'location');
    } else if (fileName.endsWith('.textproto')) {
        await applyDeploymentDescriptor(file);
    } else {
        showErrorLocation('Please select a CSV or textproto file.');
    }
}

async function applyDeploymentDescriptor(file) {
    const loading = document.getElementById('loadingLocation');
    const uploadBtn = document.getElementById('uploadBtnLocation');
    if (!loading || !uploadBtn) return;

    if (!state.data.currentData || !state.data.currentData.elements) {
        showErrorLocation('Please load a cabling descriptor in the Topology tab first, then apply the deployment descriptor here.');
        return;
    }

    loading.style.display = 'block';
    uploadBtn.disabled = true;
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = 'Processing...';
    hideMessagesForMode('location');

    const formData = new FormData();
    formData.append('deployment_file', file);
    formData.append('cytoscape_data', JSON.stringify(state.data.currentData));

    try {
        const response = await fetch('/apply_deployment_descriptor', { method: 'POST', body: formData });
        const result = await response.json();
        if (response.ok && result.success) {
            if (locationModule?.updateShelfLocations) {
                const updatedCount = locationModule.updateShelfLocations(result.data);
                console.log(`[applyDeploymentDescriptor] Updated ${updatedCount} shelf nodes with location data`);
                if (state.data.currentData?.elements && result.data?.elements) {
                    const locationUpdateMap = new Map();
                    result.data.elements.forEach(element => {
                        if (element.data?.type === 'shelf') {
                            locationUpdateMap.set(element.data.id, {
                                hall: element.data.hall || '',
                                aisle: element.data.aisle || '',
                                rack_num: element.data.rack_num || 0,
                                shelf_u: element.data.shelf_u || 0,
                                hostname: element.data.hostname || ''
                            });
                        }
                    });
                    state.data.currentData.elements.forEach(element => {
                        if (element.data?.type === 'shelf' && locationUpdateMap.has(element.data.id)) {
                            const locationData = locationUpdateMap.get(element.data.id);
                            Object.assign(element.data, locationData);
                        }
                    });
                }
            } else {
                console.warn('[applyDeploymentDescriptor] locationModule.updateShelfLocations not available, falling back to initVisualization');
                initVisualization(result.data);
            }
            const message = result.message || `Successfully applied deployment descriptor to ${result.updated_count} hosts`;
            showSuccessLocation(message);
        } else {
            showErrorLocation(`Error: ${result.error || 'Unknown error occurred'}`);
        }
    } catch (err) {
        showErrorLocation(`Upload failed: ${err.message}`);
        console.error('Upload error:', err);
    } finally {
        loading.style.display = 'none';
        uploadBtn.disabled = false;
        uploadBtn.textContent = originalText;
    }
}

async function applyDeploymentDescriptorFromModal() {
    const fileInput = document.getElementById('deploymentDescriptorFile');
    const file = fileInput?.files[0];
    if (!file) {
        alert('Please select a deployment descriptor file first.');
        return;
    }
    if (!state.data.currentData || !state.data.currentData.elements) {
        alert('No visualization loaded. This should not happen.');
        return;
    }

    const applyBtn = document.getElementById('applyUploadBtn');
    if (!applyBtn) return;
    const originalText = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Processing...';

    const formData = new FormData();
    formData.append('deployment_file', file);
    formData.append('cytoscape_data', JSON.stringify(state.data.currentData));

    try {
        const response = await fetch('/apply_deployment_descriptor', { method: 'POST', body: formData });
        const result = await response.json();
        if (response.ok && result.success) {
            state.data.currentData = result.data;
            if (locationModule?.updateShelfLocations) {
                const updatedCount = locationModule.updateShelfLocations(result.data);
                console.log(`[applyDeploymentDescriptor] Updated ${updatedCount} shelf nodes with location data`);
                if (state.data.currentData?.elements && result.data?.elements) {
                    const locationUpdateMap = new Map();
                    result.data.elements.forEach(element => {
                        if (element.data?.type === 'shelf') {
                            locationUpdateMap.set(element.data.id, {
                                hall: element.data.hall || '',
                                aisle: element.data.aisle || '',
                                rack_num: element.data.rack_num || 0,
                                shelf_u: element.data.shelf_u || 0,
                                hostname: element.data.hostname || ''
                            });
                        }
                    });
                    state.data.currentData.elements.forEach(element => {
                        if (element.data?.type === 'shelf' && locationUpdateMap.has(element.data.id)) {
                            const locationData = locationUpdateMap.get(element.data.id);
                            Object.assign(element.data, locationData);
                        }
                    });
                }
            } else {
                console.warn('[applyDeploymentDescriptor] locationModule.updateShelfLocations not available, falling back to initVisualization');
                initVisualization(result.data);
            }
            const modal = document.getElementById('physicalLayoutModal');
            if (modal) modal.classList.remove('active');
            sessionStorage.setItem('physicalLayoutAssigned', 'true');
            setVisualizationMode('location');
            if (state.data.initialVisualizationData) updateConnectionLegend(state.data.initialVisualizationData);
            location_switchMode();
            updateModeIndicator();
            const message = result.message || `Successfully applied deployment descriptor to ${result.updated_count} hosts`;
            showExportStatus(message, 'success');
        } else {
            alert(`Error: ${result.error || 'Unknown error occurred'}`);
        }
    } catch (err) {
        alert(`Upload failed: ${err.message}`);
        console.error('Upload error:', err);
    } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = originalText;
    }
}

// Graph template dropdown handler
const graphTemplateSelect = document.getElementById('graphTemplateSelect');
if (graphTemplateSelect) {
    graphTemplateSelect.addEventListener('change', function () {
        const addGraphBtn = document.getElementById('addGraphBtn');
        const hasTemplate = this.value && this.value !== '';
        if (state.cy && hasTemplate) {
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
}

// Label input event listener removed - instance names are now auto-generated as {template_name}_{index}

// ===== Expose Functions to Global Scope (Backward Compatibility) =====
// Functions are exposed to window object for:
//   1. Cytoscape event handlers (in modules/common.js, modules/location.js, etc.)
//   2. External dependencies and debugging
// 
// Note: These functions are defined in visualizer.js, so exposing them here maintains
// cohesion. Moving to cytoscape-utils.js would create unnecessary coupling since most
// functions are not Cytoscape-specific.

// Functions required by Cytoscape event handlers
const cytoscapeHandlers = {
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
    forceApplyCurveStyles,
};

// Other functions exposed for backward compatibility
const otherFunctions = {
    // Core visualization
    initVisualization,
    createEmptyVisualization,
    createEmptyVisualizationLocation,
    createEmptyVisualizationTopology,
    // File upload
    uploadFile,
    uploadFileTopology,
    uploadFileLocation,
    uploadFileGeneric,
    applyDeploymentDescriptor,
    applyDeploymentDescriptorFromModal,
    // Mode and layout
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
    // Export
    exportCablingDescriptor,
    exportDeploymentDescriptor,
    generateCablingGuide,
    generateFSD,
    // Expand/collapse
    expandOneLevel,
    collapseOneLevel,
    // Filters
    applyConnectionTypeFilter,
    applyNodeFilter,
    populateNodeFilterDropdown,
    populateTemplateFilterDropdown,
    addConnectionTypeEventHandlers,
    // Physical layout modal
    cancelPhysicalLayoutModal,
    applyPhysicalLayout,
    // UI helpers
    updateConnectionLegend,
    hideNotificationBanner,
    showNotificationBanner,
    showExportStatus,
    toggleCollapsible,
    switchTab,
    switchLayoutTab,
    hideInitializationShowControls,
};

// Combine and expose all functions
const functionsToExpose = { ...cytoscapeHandlers, ...otherFunctions };
Object.keys(functionsToExpose).forEach(key => {
    window[key] = functionsToExpose[key];
});

