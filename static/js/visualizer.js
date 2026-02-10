/**
 * Network Cabling Visualizer - Client-side JavaScript
 * 
 * This is the main visualization module for the CableGen application.
 * 
 * Architecture Overview:
 * ======================
 * - Configuration: Extracted to ./config/ (constants, node-types, API)
 * - State Management: Centralized in ./state/ (VisualizerState, StateObserver)
 * - Factories: Node/connection creation in ./factories/
 * - Modules: Common, Location, Hierarchy, Export, UI Display, File Management in ./modules/
 * - API Client: Backend communication in ./api/
 * - UI Managers: Notification, Modal, Status managers in ./ui/
 * - Utils: Utility functions in ./utils/ (node-management, cytoscape-utils)
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
import { copySelection as copySelectionUtil, hasClipboard as hasClipboardUtil } from './utils/copy-paste.js';
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
window.resetLayout = resetLayout;
window.saveDefaultLayout = saveDefaultLayout;

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
function copySelection() {
    const result = copySelectionUtil(state);
    if (result.success) {
        window.showExportStatus?.(result.message, 'success');
    } else if (result.message) {
        window.showExportStatus?.(result.message, 'warning');
    }
}
/**
 * Resolve the selected node(s) in hierarchy mode to the parent graph id for paste.
 * If a graph is selected, use it; if a shelf/tray/port is selected, use its containing graph; else null (paste at root).
 * @param {Object} selected - Cytoscape collection of selected nodes
 * @returns {string|null}
 */
function getParentGraphIdFromSelection(selected) {
    if (!selected || selected.length === 0) return null;
    let current = selected[0];
    while (current && current.length > 0) {
        if (current.data('type') === 'graph') return current.id();
        current = current.parent();
    }
    return null;
}

function pasteSelection() {
    if (!state.editing.isEdgeCreationMode) {
        window.showExportStatus?.('Enable connection editing to paste.', 'warning');
        return;
    }
    if (state.mode !== 'location' && state.mode !== 'hierarchy') {
        window.showExportStatus?.('Paste is supported in location or hierarchy mode only.', 'warning');
        return;
    }
    if (!hasClipboardUtil(state)) {
        window.showExportStatus?.(state.mode === 'hierarchy' ? 'Nothing to paste. Copy graph instances or shelves first (Ctrl+C).' : 'Nothing to paste. Copy shelves first (Ctrl+C).', 'warning');
        return;
    }
    if (state.mode === 'hierarchy') {
        const selected = state.cy.nodes(':selected');
        const parentId = getParentGraphIdFromSelection(selected);
        const result = hierarchyModule.pasteFromClipboardHierarchy({
            parentId,
            instanceNamePrefix: 'copy'
        });
        if (result.success) {
            window.showExportStatus?.(result.message, 'success');
            window.updateDeleteButtonState?.();
        } else if (result.message) {
            window.showExportStatus?.(result.message, 'warning');
        }
        return;
    }
    showPasteDestinationModal();
}

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
 * LOCATION MODE: Get location data from a node or its parent hierarchy.
 * Includes host_index/host_id for bi-directional association with racking info.
 * @param {Object} node - Cytoscape node
 * @returns {Object} Location data {hall, aisle, rack_num, shelf_u, hostname, host_index?, host_id?}
 */
function location_getNodeData(node) {
    const data = node.data();

    // If node has all location data, return it (include host_index/host_id when present)
    if (data.hall && data.aisle && data.rack_num !== undefined) {
        const out = {
            hall: data.hall,
            aisle: data.aisle,
            rack_num: data.rack_num,
            shelf_u: data.shelf_u,
            hostname: data.hostname || ''
        };
        if (data.host_index !== undefined && data.host_index !== null) out.host_index = data.host_index;
        if (data.host_id !== undefined && data.host_id !== null) out.host_id = data.host_id;
        return out;
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

    // Return whatever we have (include host_index/host_id when present)
    const out = {
        hall: data.hall || '',
        aisle: data.aisle || '',
        rack_num: data.rack_num,
        shelf_u: data.shelf_u,
        hostname: data.hostname || ''
    };
    if (data.host_index !== undefined && data.host_index !== null) out.host_index = data.host_index;
    if (data.host_id !== undefined && data.host_id !== null) out.host_id = data.host_id;
    return out;
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
/** Bi-directional: host_index → racking info (hall, aisle, rack_num, shelf_u, hostname). */
function getLocationByHostIndex(hostIndexOrId) {
    return locationModule.getLocationByHostIndex(hostIndexOrId);
}
/** Bi-directional: location → host_index. */
function getHostIndexByLocation(location) {
    return locationModule.getHostIndexByLocation(location);
}
/** Bi-directional: hostname → host_index. */
function getHostIndexByHostname(hostname) {
    return locationModule.getHostIndexByHostname(hostname);
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
function showPasteDestinationModal() { return uiDisplayModule.showPasteDestinationModal(); }
function cancelPasteDestinationModal() { return uiDisplayModule.cancelPasteDestinationModal(); }
function applyPasteDestination() { return uiDisplayModule.applyPasteDestination(); }



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
function saveDefaultLayout() { return uiDisplayModule.saveDefaultLayout(); }


function addNewNode() {
    const nodeTypeSelect = document.getElementById('nodeTypeSelect');
    const hostnameInput = document.getElementById('nodeHostnameInput');
    const hallInput = document.getElementById('nodeHallInput');
    const aisleInput = document.getElementById('nodeAisleInput');
    const rackInput = document.getElementById('nodeRackInput');
    const shelfUInput = document.getElementById('nodeShelfUInput');

    // Get base node type
    let nodeType = nodeTypeSelect.value;

    // Get selected variation from radio buttons
    const variationRadio = document.querySelector('input[name="nodeVariation"]:checked');
    const variation = variationRadio ? variationRadio.value : '';
    // Combine base type with variation
    if (variation) {
        nodeType = nodeType + variation;
    }
    // Keep the full node type including variations (DEFAULT, X_TORUS, Y_TORUS, XY_TORUS)
    // The node creation functions will handle normalization for config lookup but preserve
    // the original variation name for storage and internal connection creation

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
 * Update the variation radio buttons visibility based on selected node type and current mode
 */
function updateNodeVariationOptions() {
    const nodeTypeSelect = document.getElementById('nodeTypeSelect');
    const variationSection = document.getElementById('nodeVariationSection');
    const variationDefault = document.getElementById('variationDefault');
    const variationXTorus = document.getElementById('variationXTorus');
    const variationYTorus = document.getElementById('variationYTorus');
    const variationXYTorus = document.getElementById('variationXYTorus');

    if (!nodeTypeSelect || !variationSection) {
        return;
    }
    // Only show variations in hierarchy mode
    const isHierarchyMode = state && state.mode === 'hierarchy';
    if (!isHierarchyMode) {
        variationSection.style.display = 'none';
        return;
    }

    const selectedType = nodeTypeSelect.value;
    // Node types that support DEFAULT variation
    const supportsDefault = ['N300_LB', 'N300_QB', 'P150_QB_AE'];
    // Node types that support torus variations
    const supportsTorus = ['WH_GALAXY', 'BH_GALAXY'];

    // Check if selected type supports any variations
    const hasVariations = supportsDefault.includes(selectedType) || supportsTorus.includes(selectedType);

    // Show/hide variation section based on whether type supports variations
    variationSection.style.display = hasVariations ? 'block' : 'none';
    // Reset to "None" when section is hidden or type doesn't support variations
    if (!hasVariations) {
        const noneRadio = document.querySelector('input[name="nodeVariation"][value=""]');
        if (noneRadio) {
            noneRadio.checked = true;
        }
        return;
    }
    // Show/hide specific variation options based on selected node type
    if (variationDefault) {
        variationDefault.style.display = supportsDefault.includes(selectedType) ? 'flex' : 'none';
    }
    if (variationXTorus) {
        variationXTorus.style.display = supportsTorus.includes(selectedType) ? 'flex' : 'none';
    }
    if (variationYTorus) {
        variationYTorus.style.display = supportsTorus.includes(selectedType) ? 'flex' : 'none';
    }
    if (variationXYTorus) {
        variationXYTorus.style.display = supportsTorus.includes(selectedType) ? 'flex' : 'none';
    }
    // Reset to "None" when type changes (to avoid invalid combinations)
    const noneRadio = document.querySelector('input[name="nodeVariation"][value=""]');
    if (noneRadio) {
        noneRadio.checked = true;
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
    commonModule.addCurveMagnitudeSliderHandler();
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
function showConnectionInfo(edge, position) {
    return commonModule.showConnectionInfo(edge, position);
}
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

    // Ctrl+C (or Cmd+C on Mac) to copy (location: shelves + connections; hierarchy: graph instances/shelves + connections)
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && state.cy && (state.mode === 'location' || state.mode === 'hierarchy')) {
            event.preventDefault();
            copySelection();
        }
    }

    // Ctrl+V (or Cmd+V on Mac) to paste (location or hierarchy mode, only when editing mode is enabled)
    if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && state.cy && (state.mode === 'location' || state.mode === 'hierarchy')) {
            event.preventDefault();
            pasteSelection();
        }
    }

    // Ctrl+S (or Cmd+S on Mac) to save/export based on mode
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        // Prevent default browser save dialog
        event.preventDefault();

        // Don't trigger save action if typing in an input field
        const activeElement = document.activeElement;
        if (['INPUT', 'TEXTAREA'].includes(activeElement.tagName)) {
            return;
        }

        // Only proceed if visualization is loaded
        if (!state.cy) {
            return;
        }

        // Focus and expand the Export Section
        const exportSection = document.getElementById('exportOptions');
        const exportHeader = document.querySelector('[data-section="exportOptions"]');

        if (exportSection && exportHeader) {
            // Expand the section if it's collapsed
            if (exportSection.classList.contains('collapsed')) {
                toggleCollapsible('exportOptions');
            }

            // Scroll to the export section
            exportHeader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Trigger appropriate export based on mode
            if (state.mode === 'location') {
                // Location mode: export cabling guide
                generateCablingGuide().catch(err => console.error('Error generating cabling guide:', err));
            } else if (state.mode === 'hierarchy') {
                // Hierarchy mode: export cabling descriptor
                exportCablingDescriptor().catch(err => console.error('Error exporting cabling descriptor:', err));
            }
        }
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

// Setup global drag-and-drop handlers for initial site start
// This allows dragging files anywhere on the window before initialization
function initializeGlobalDragAndDrop() {
    if (!fileManagementModule) {
        console.warn('[Visualizer] fileManagementModule is not available');
        return;
    }

    if (typeof fileManagementModule.setupGlobalDragAndDrop !== 'function') {
        console.warn('[Visualizer] fileManagementModule.setupGlobalDragAndDrop is not a function');
        return;
    }

    try {
        // Use a longer delay to ensure DOM is fully ready
        setTimeout(() => {
            try {
                fileManagementModule.setupGlobalDragAndDrop();
            } catch (error) {
                console.error('[Visualizer] Error setting up global drag-and-drop:', error);
            }
        }, 200);
    } catch (error) {
        console.error('[Visualizer] Error initializing global drag-and-drop:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGlobalDragAndDrop);
} else {
    initializeGlobalDragAndDrop();
}

// Check for URL parameters and auto-load external files
// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Small delay to ensure all modules are initialized
        setTimeout(() => {
            fileManagementModule.checkAndLoadUrlParameter().catch(err => {
                console.error('Error checking URL parameters:', err);
            });
        }, 100);
    });
} else {
    // DOM already loaded
    setTimeout(() => {
        fileManagementModule.checkAndLoadUrlParameter().catch(err => {
            console.error('Error checking URL parameters:', err);
        });
    }, 100);
}

// Helper function to safely attach event listeners
function attachEventListener(selector, event, handler) {
    const element = document.getElementById(selector);
    if (element && typeof handler === 'function') {
        element.addEventListener(event, handler);
        return true;
    }
    if (!element) {
        console.warn(`[EventListeners] Element not found: ${selector}`);
    } else if (typeof handler !== 'function') {
        console.warn(`[EventListeners] Handler is not a function for: ${selector}`);
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

    // Tab navigation - ensure switchTab is available
    const locationTab = document.getElementById('locationTab');
    const topologyTab = document.getElementById('topologyTab');
    if (locationTab) {
        locationTab.addEventListener('click', function (e) {
            e.preventDefault();
            console.log('[Tab] Location tab clicked');
            if (typeof switchTab === 'function') {
                switchTab('location');
            } else {
                console.error('[Tab] switchTab function not available');
            }
        });
    } else {
        console.warn('[EventListeners] locationTab not found');
    }
    if (topologyTab) {
        topologyTab.addEventListener('click', function (e) {
            e.preventDefault();
            console.log('[Tab] Topology tab clicked');
            if (typeof switchTab === 'function') {
                switchTab('topology');
            } else {
                console.error('[Tab] switchTab function not available');
            }
        });
    } else {
        console.warn('[EventListeners] topologyTab not found');
    }

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
    
    // Update variation options when node type changes
    const nodeTypeSelect = document.getElementById('nodeTypeSelect');
    if (nodeTypeSelect) {
        nodeTypeSelect.addEventListener('change', updateNodeVariationOptions);
        // Initialize on load
        updateNodeVariationOptions();
    }

    // Update variation options when node type changes
    const nodeTypeSelect = document.getElementById('nodeTypeSelect');
    if (nodeTypeSelect) {
        nodeTypeSelect.addEventListener('change', updateNodeVariationOptions);
        // Initialize on load
        updateNodeVariationOptions();
    }

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

    // Add another cabling guide (location mode)
    const addAnotherCablingGuideBtn = document.getElementById('addAnotherCablingGuideBtn');
    const addAnotherCablingGuideFile = document.getElementById('addAnotherCablingGuideFile');
    if (addAnotherCablingGuideBtn && addAnotherCablingGuideFile) {
        addAnotherCablingGuideBtn.addEventListener('click', () => {
            const file = addAnotherCablingGuideFile?.files?.[0];
            if (file) addAnotherCablingGuideLocation(file).catch(err => console.error('Error adding cabling guide:', err));
            else window.showExportStatus?.('Please select a CSV file first.', 'error');
        });
    }

    // Modal buttons
    attachEventListener('cancelConnectionPlacementBtn', 'click', () => cancelConnectionPlacement().catch(err => console.error('Error canceling connection placement:', err)));
    attachEventListener('manualLayoutTab', 'click', () => switchLayoutTab('manual'));
    attachEventListener('uploadLayoutTab', 'click', () => switchLayoutTab('upload'));
    attachEventListener('cancelPhysicalLayoutModalBtn', 'click', () => cancelPhysicalLayoutModal());
    attachEventListener('applyLayoutBtn', 'click', () => uiDisplayModule.applyPhysicalLayoutModalAction());
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

// On initial screen, neither CSV nor textproto tab content is shown; user chooses a tab to reveal content.

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
    // Remove global drag-and-drop handlers after initialization
    if (fileManagementModule && typeof fileManagementModule.removeGlobalDragAndDrop === 'function') {
        fileManagementModule.removeGlobalDragAndDrop();
    }
}

/**
 * Build endpoint key for a node (for connection validation).
 * Uses host_index or host_id when present (shelf identity), otherwise node id.
 * @param {Object} nodeData - element.data for a node
 * @param {string} nodeId - node id (fallback)
 * @returns {string} Stable key for this endpoint
 */
function getEndpointKey(nodeData, nodeId) {
    if (!nodeData) return String(nodeId ?? '');
    const h = nodeData.host_index ?? nodeData.host_id;
    if (h !== undefined && h !== null) return String(h);
    return String(nodeData.id ?? nodeId ?? '');
}

/**
 * Format rack number for label (match location buildLabel: 2-digit).
 * @param {*} rackNum
 * @returns {string}
 */
function formatRackNumForLabel(rackNum) {
    return rackNum !== undefined && rackNum !== null ? String(rackNum).padStart(2, '0') : '';
}

/**
 * Format shelf U for label (match location: strip leading U then 2-digit).
 * @param {*} shelfU
 * @returns {string}
 */
function formatShelfUForLabel(shelfU) {
    if (shelfU === undefined || shelfU === null) return '';
    const s = String(shelfU).replace(/^U?/i, '');
    return s === '' ? '' : s.padStart(2, '0');
}

/**
 * Build shelf label key (same structure as location buildLabel): hall+aisle+rack+U+shelf.
 * @param {string} hall
 * @param {string} aisle
 * @param {*} rackNum
 * @param {*} shelfU
 * @returns {string} e.g. "120A03U02" or "" if missing parts
 */
function buildShelfLabelKey(hall, aisle, rackNum, shelfU) {
    if (!hall || !aisle || rackNum === undefined || rackNum === null) return '';
    const rackPadded = formatRackNumForLabel(rackNum);
    const label = `${hall}${aisle}${rackPadded}`;
    if (shelfU !== null && shelfU !== undefined && shelfU !== '') {
        const shelfUPadded = formatShelfUForLabel(shelfU);
        return `${label}U${shelfUPadded}`;
    }
    return label;
}

/**
 * Port-level key for matching connection endpoints (host_index/host_id + tray + port).
 * Returns empty string if node is not a port (missing tray or port).
 */
function getPortKey(nodeData) {
    if (!nodeData) return '';
    const h = nodeData.host_index ?? nodeData.host_id;
    const tray = nodeData.tray;
    const port = nodeData.port;
    if (h === undefined || h === null || tray === undefined || tray === null || port === undefined || port === null) return '';
    return `${h}_t${tray}_p${port}`;
}

/**
 * Build port key in label style (same as CSV Label / location): shelfLabel-tray-port, e.g. "120A03U02-3-3".
 * Used to identify ports for validation/merge. Prefers port_key (CSV label stored for keying), then builds from components.
 * @param {Object} nodeData - port node data (may have port_key, hall, aisle, rack_num, shelf_u, tray, port or label)
 * @returns {string} label-style port key or '' if not enough data
 */
function buildPortLabelKey(nodeData) {
    if (!nodeData) return '';
    if (nodeData.port_key != null && nodeData.port_key !== '' && /^.+-.+-.+$/.test(String(nodeData.port_key))) {
        return String(nodeData.port_key);
    }
    if (nodeData.label != null && nodeData.label !== '' && /^.+-.+-.+$/.test(String(nodeData.label))) {
        return String(nodeData.label);
    }
    const hall = nodeData.hall;
    const aisle = nodeData.aisle;
    const rackNum = nodeData.rack_num;
    const shelfU = nodeData.shelf_u;
    const tray = nodeData.tray;
    const port = nodeData.port;
    if (hall === undefined || hall === null || aisle === undefined || aisle === null ||
        rackNum === undefined || rackNum === null || shelfU === undefined || shelfU === null ||
        tray === undefined || tray === null || port === undefined || port === null) return '';
    const shelfLabel = buildShelfLabelKey(hall, aisle, rackNum, shelfU);
    if (shelfLabel === '') return '';
    return `${shelfLabel}-${tray}-${port}`;
}

/**
 * Parse host_index, tray, port from node id like "0:t1:p3" (used when node data lacks tray/port).
 * @param {string} nodeId - node id
 * @returns {{ h: string, tray: string, port: string }|null}
 */
function parsePortFromNodeId(nodeId) {
    if (nodeId == null || typeof nodeId !== 'string') return null;
    const m = nodeId.match(/^(\d+):t(\d+):p(\d+)$/);
    if (m) return { h: m[1], tray: m[2], port: m[3] };
    return null;
}

/**
 * Key for one connection endpoint in peer map / validation. Use label-style (shelfLabel-tray-port) when
 * available so port keys match how we do labels; else host_index_tray_port; else parsed node id; else endpoint key.
 * @param {Object} nodeData - element.data for a node
 * @param {string} nodeId - node id (fallback / parse)
 * @returns {string} Key unique per port
 */
function getConnectionEndpointKey(nodeData, nodeId) {
    const labelKey = buildPortLabelKey(nodeData);
    if (labelKey !== '') return labelKey;
    const portKey = getPortKey(nodeData);
    if (portKey !== '') return portKey;
    const parsed = parsePortFromNodeId(nodeId);
    if (parsed) return `${parsed.h}_t${parsed.tray}_p${parsed.port}`;
    return getEndpointKey(nodeData, nodeId);
}

/**
 * Build connection sets and peer map from cytoscape elements.
 * Uses port-level keys when available so each physical port is one key (required for real CSVs).
 * @param {Array} elements - cytoscape elements array
 * @returns {{ connectionKeys: Set<string>, peerMap: Map<string, Set<string>>, nodeById: Map<string, Object> }}
 */
function buildConnectionMaps(elements) {
    const nodeById = new Map();
    const connectionKeys = new Set();
    const peerMap = new Map();

    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source === undefined && d.target === undefined && d.id !== undefined) {
            nodeById.set(d.id, d);
        }
    });

    (elements || []).forEach((el) => {
        const d = el.data || {};
        const src = d.source;
        const tgt = d.target;
        if (src == null || tgt == null) return;
        const srcData = nodeById.get(src);
        const tgtData = nodeById.get(tgt);
        const k1 = getConnectionEndpointKey(srcData, src);
        const k2 = getConnectionEndpointKey(tgtData, tgt);
        if (k1 === '' || k2 === '') return;
        const key = k1 <= k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        connectionKeys.add(key);
        if (!peerMap.has(k1)) peerMap.set(k1, new Set());
        peerMap.get(k1).add(k2);
        if (!peerMap.has(k2)) peerMap.set(k2, new Set());
        peerMap.get(k2).add(k1);
    });

    return { connectionKeys, peerMap, nodeById };
}

/**
 * Base rule: one connection per port. Validates that no port (by endpoint key) appears in more than one connection.
 * Used on load and for merge validation.
 * @param {Array} elements - cytoscape elements array (nodes + edges)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOneConnectionPerPort(elements) {
    const errors = [];
    const { peerMap } = buildConnectionMaps(elements || []);
    peerMap.forEach((peers, portKey) => {
        if (peers.size > 1) {
            const peerList = [...peers].join(', ');
            errors.push(`Port ${portKey} has more than one connection (${peerList}). Only one connection per port is allowed.`);
        }
    });
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/**
 * Validate a secondary cabling guide against the current visualization.
 * Rules:
 * - New guide must be valid: one connection per port (invalid new guide → error).
 * - existing A–B, new A–B → allowed (warn re-defined).
 * - existing A–B, new A–C → not allowed; error "Guides disagree".
 * - existing A–B, new has both A–B and A–C → invalid new guide (one port, two connections) → error.
 * @param {Object} existingData - Current cytoscape data
 * @param {Object} newData - New guide cytoscape data (before merge)
 * @returns {{ warnings: string[], errors: string[] }}
 */
function validateMergedCablingGuide(existingData, newData) {
    const warnings = [];
    const errors = [];
    const existingEls = existingData?.elements || [];
    const newEls = newData?.elements || [];
    // New guide must be valid: one connection per port
    const newPortValidation = validateOneConnectionPerPort(newEls);
    if (!newPortValidation.valid) errors.push(...newPortValidation.errors);

    const { connectionKeys: existingConnections, peerMap: existingPeerMap } = buildConnectionMaps(existingEls);
    const { peerMap: newPeerMap, nodeById: newNodeById } = buildConnectionMaps(newEls);

    newEls.forEach((el) => {
        const d = el.data || {};
        const src = d.source;
        const tgt = d.target;
        if (src == null || tgt == null) return;
        const srcData = newNodeById.get(src);
        const tgtData = newNodeById.get(tgt);
        const k1 = getConnectionEndpointKey(srcData, src);
        const k2 = getConnectionEndpointKey(tgtData, tgt);
        if (k1 === '' || k2 === '') return;
        const key = k1 <= k2 ? `${k1}|${k2}` : `${k2}|${k1}`;

        if (existingConnections.has(key)) {
            warnings.push(`Connection re-defined (same endpoints): ${k1} — ${k2}`);
        }
    });

    // existing A–B, new A–C: not allowed (guides disagree on that port)
    existingPeerMap.forEach((existingPeers, portKey) => {
        if (!newPeerMap.has(portKey)) return;
        const newPeers = newPeerMap.get(portKey);
        const missing = [...existingPeers].filter((p) => !newPeers.has(p));
        if (missing.length > 0) {
            const existingList = [...existingPeers].join(', ');
            const newList = [...newPeers].join(', ');
            errors.push(`Guides disagree on connections for port ${portKey}: current has ${existingList}, new guide has ${newList} (missing: ${missing.join(', ')}).`);
        }
    });

    return { warnings: [...new Set(warnings)], errors: [...new Set(errors)] };
}

/**
 * Build map from port key (host_index_tray_port) to existing port node id.
 * Used to resolve new CSV edge source/target to actual port ids (not shelf ids).
 */
function buildPortKeyToNodeId(elements) {
    const map = new Map();
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        const key = getPortKey(d);
        if (key !== '' && d.id != null) map.set(key, d.id);
    });
    return map;
}

/**
 * Shelf identity for "same node" matching: hostname if non-empty, else hall|aisle|rack_num|shelf_u.
 * Used so we do not create duplicate shelves when the new CSV describes the same deployment.
 */
function getShelfIdentity(nodeData) {
    if (!nodeData) return '';
    const hostname = (nodeData.hostname ?? '').toString().trim();
    if (hostname !== '') return hostname;
    const hall = (nodeData.hall ?? '').toString().trim();
    const aisle = (nodeData.aisle ?? '').toString().trim();
    const rack = nodeData.rack_num !== undefined && nodeData.rack_num !== null ? String(nodeData.rack_num) : '';
    const shelfU = nodeData.shelf_u !== undefined && nodeData.shelf_u !== null ? String(nodeData.shelf_u) : '';
    return `${hall}|${aisle}|${rack}|${shelfU}`;
}

/**
 * Build maps from existing elements: shelf identity -> shelf id; (identity, tray, port) -> port id.
 * Used to resolve "already present" nodes when merging a CSV that describes the same deployment.
 */
function buildExistingIdentityMaps(elements) {
    const nodeById = new Map();
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source === undefined && d.target === undefined && d.id != null) nodeById.set(d.id, d);
    });
    const shelfIdentityToShelfId = new Map();
    const portKeyToId = new Map(); // key = identity_t{tray}_p{port}
    const trayKeyToId = new Map(); // key = identity_t{tray}
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined || d.id == null) return;
        if (d.type === 'shelf') {
            const identity = getShelfIdentity(d);
            if (identity !== '') shelfIdentityToShelfId.set(identity, d.id);
            return;
        }
        if (d.type === 'tray') {
            const shelfData = d.parent != null ? nodeById.get(d.parent) : null;
            const identity = shelfData ? getShelfIdentity(shelfData) : '';
            const tray = d.tray !== undefined && d.tray !== null ? String(d.tray) : '';
            if (identity !== '' && tray !== '') trayKeyToId.set(`${identity}_t${tray}`, d.id);
            return;
        }
        if (d.type === 'port') {
            const trayData = d.parent != null ? nodeById.get(d.parent) : null;
            const shelfData = trayData && trayData.parent != null ? nodeById.get(trayData.parent) : null;
            const identity = shelfData ? getShelfIdentity(shelfData) : '';
            const tray = trayData && trayData.tray !== undefined && trayData.tray !== null ? String(trayData.tray) : '';
            const port = d.port !== undefined && d.port !== null ? String(d.port) : '';
            if (identity !== '' && tray !== '' && port !== '') portKeyToId.set(`${identity}_t${tray}_p${port}`, d.id);
        }
    });
    return { shelfIdentityToShelfId, trayKeyToId, portKeyToId, nodeById };
}

/**
 * Build map from endpoint key (host_index/host_id or id) to existing node id.
 * Used to match new-guide nodes to already-present nodes so we add only edges when possible.
 */
function buildEndpointToNodeId(elements) {
    const map = new Map();
    const nodeById = new Map();
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source === undefined && d.target === undefined && d.id !== undefined) {
            nodeById.set(d.id, d);
        }
    });
    (elements || []).forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        const id = d.id;
        if (id == null) return;
        const key = getEndpointKey(d, id);
        if (key !== '') map.set(key, id);
    });
    return map;
}


/**
 * Merge a second cabling guide's cytoscape data into existing data.
 * When all nodes from the new guide are already present (matched by endpoint key), only new
 * connections (edges) are added. When the new guide has nodes not in the graph, those nodes
 * are added with a prefix and their connections are remapped.
 * @param {Object} existingData - Current cytoscape data (elements + metadata)
 * @param {Object} newData - Cytoscape data from the new CSV
 * @param {string} prefix - Unique prefix for the new guide (e.g. 'm2', 'm3')
 * @returns {Object} Merged { elements, metadata }
 */
function mergeCablingGuideData(existingData, newData, prefix) {
    const existingEls = existingData?.elements || [];
    const newEls = newData?.elements || [];

    const makeId = (id) => (id ? `${prefix}_${id}` : id);

    const newConnectionMaps = buildConnectionMaps(newEls);
    const newElsNodeById = newConnectionMaps.nodeById;

    const existingEdgeKeysByNodeId = new Set();
    (existingEls || []).forEach((el) => {
        const d = el.data || {};
        const src = d.source;
        const tgt = d.target;
        if (src == null || tgt == null) return;
        const key = src <= tgt ? `${src}|${tgt}` : `${tgt}|${src}`;
        existingEdgeKeysByNodeId.add(key);
    });

    // Set of existing node ids so we can keep parent refs to existing compound nodes (hall/aisle/rack)
    const existingIds = new Set();
    (existingEls || []).forEach((el) => {
        const id = el.data?.id;
        if (id != null) existingIds.add(id);
    });
    // Identity-based "already present": match by hostname or (hall, aisle, rack_num, shelf_u) so we don't create duplicate shelves when the new CSV describes the same deployment.
    // Also map hall/aisle/rack by id when they already exist so we don't add duplicate compound nodes.
    const { shelfIdentityToShelfId, trayKeyToId, portKeyToId } = buildExistingIdentityMaps(existingEls);
    const existingNodeIdMap = new Map(); // new CSV node id -> existing graph node id when the node is the same (same identity)
    newEls.forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        const id = d.id;
        if (id == null) return;
        if (d.type === 'hall' || d.type === 'aisle' || d.type === 'rack') {
            if (existingIds.has(id)) existingNodeIdMap.set(id, id);
            return;
        }
        if (d.type === 'shelf') {
            const identity = getShelfIdentity(d);
            if (identity !== '' && shelfIdentityToShelfId.has(identity)) {
                existingNodeIdMap.set(id, shelfIdentityToShelfId.get(identity));
            }
            return;
        }
        if (d.type === 'tray') {
            const shelfData = d.parent != null ? newElsNodeById.get(d.parent) : null;
            const identity = shelfData ? getShelfIdentity(shelfData) : '';
            const tray = d.tray !== undefined && d.tray !== null ? String(d.tray) : '';
            const key = identity !== '' && tray !== '' ? `${identity}_t${tray}` : '';
            if (key !== '' && trayKeyToId.has(key)) existingNodeIdMap.set(id, trayKeyToId.get(key));
            return;
        }
        if (d.type === 'port') {
            const trayData = d.parent != null ? newElsNodeById.get(d.parent) : null;
            const shelfData = trayData && trayData.parent != null ? newElsNodeById.get(trayData.parent) : null;
            const identity = shelfData ? getShelfIdentity(shelfData) : '';
            const tray = trayData && trayData.tray !== undefined && trayData.tray !== null ? String(trayData.tray) : '';
            const port = d.port !== undefined && d.port !== null ? String(d.port) : '';
            const key = identity !== '' && tray !== '' && port !== '' ? `${identity}_t${tray}_p${port}` : '';
            if (key !== '' && portKeyToId.has(key)) existingNodeIdMap.set(id, portKeyToId.get(key));
        }
    });

    // idMap: only for new nodes we're adding (not already present by identity)
    const idMap = new Map();
    newEls.forEach((el) => {
        const id = el.data?.id;
        if (id == null) return;
        if (el.data && ('source' in el.data || 'target' in el.data)) return;
        if (existingNodeIdMap.has(id)) return;
        idMap.set(id, makeId(id));
    });

    // Resolve parent id: use existing id only when that parent was matched (existingNodeIdMap), else prefixed new id.
    // Do not use existingIds.has(parentId): for a disjoint merge, new graph's "0" is not the same node as existing "0".
    const resolveParentId = (parentId) => {
        if (parentId == null) return parentId;
        const matched = existingNodeIdMap.get(parentId);
        if (matched != null) return matched;
        return idMap.get(parentId) ?? makeId(parentId);
    };

    // New node elements to add (prefixed) — only nodes not already present (same identity in existing graph)
    const newNodesToAdd = [];
    newEls.forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        const id = d.id;
        if (id == null) return;
        if (existingNodeIdMap.has(id)) return;
        const data = { ...d };
        const newId = idMap.get(id) ?? makeId(id);
        data.id = newId;
        if (data.parent != null) {
            data.parent = resolveParentId(data.parent);
        }
        newNodesToAdd.push({ ...el, data });
    });

    // New edges: resolve source/target to existing node id (when same identity) or prefixed new id; only add if both endpoints exist in merged graph
    const newEdgesToAdd = [];
    let edgeIndex = 0;
    const addedEdgeKeys = new Set(existingEdgeKeysByNodeId);
    const mergedNodeIds = new Set(existingIds);
    newNodesToAdd.forEach((el) => {
        const id = el.data?.id;
        if (id != null) mergedNodeIds.add(id);
    });
    newEls.forEach((el) => {
        const d = el.data || {};
        const src = d.source;
        const tgt = d.target;
        if (src == null || tgt == null) return;
        const sourceId = existingNodeIdMap.get(src) ?? idMap.get(src);
        const targetId = existingNodeIdMap.get(tgt) ?? idMap.get(tgt);
        if (sourceId == null || targetId == null) return;
        if (!mergedNodeIds.has(sourceId) || !mergedNodeIds.has(targetId)) return;

        const edgeKey = sourceId <= targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;
        if (addedEdgeKeys.has(edgeKey)) return;
        addedEdgeKeys.add(edgeKey);

        const edgeId = `add_${prefix}_${edgeIndex++}`;
        newEdgesToAdd.push({
            group: 'edges',
            data: {
                ...d,
                id: edgeId,
                source: sourceId,
                target: targetId
            }
        });
    });

    // When new is a superset of existing, result should match new (same nodes + edges, with ids resolved to existing where applicable)
    const seenNodeIds = new Set();
    const mergedNodesFromNew = [];
    newEls.forEach((el) => {
        const d = el.data || {};
        if (d.source !== undefined || d.target !== undefined) return;
        const id = d.id;
        if (id == null) return;
        const resolvedId = existingNodeIdMap.get(id) ?? idMap.get(id) ?? makeId(id);
        if (seenNodeIds.has(resolvedId)) return;
        seenNodeIds.add(resolvedId);
        const data = { ...d, id: resolvedId };
        if (d.parent != null) data.parent = resolveParentId(d.parent);
        mergedNodesFromNew.push({ ...el, data });
    });
    const mergedEdgesFromNew = [];
    newEls.forEach((el) => {
        const d = el.data || {};
        const src = d.source;
        const tgt = d.target;
        if (src == null || tgt == null) return;
        const sourceId = existingNodeIdMap.get(src) ?? idMap.get(src) ?? makeId(src);
        const targetId = existingNodeIdMap.get(tgt) ?? idMap.get(tgt) ?? makeId(tgt);
        mergedEdgesFromNew.push({
            group: 'edges',
            data: { ...d, id: d.id || `e_${src}_${tgt}`, source: sourceId, target: targetId }
        });
    });
    // When new is a superset (no new nodes), result matches new. When disjoint or partial, keep existing + add new so we don't drop the original graph.
    const mergedElements =
        newNodesToAdd.length === 0
            ? [...mergedNodesFromNew, ...mergedEdgesFromNew]
            : [...existingEls, ...newNodesToAdd, ...newEdgesToAdd];
    const existingMeta = existingData?.metadata || {};
    const newMeta = newData?.metadata || {};
    const existingUnknown = new Set(existingMeta.unknown_node_types || []);
    const newUnknown = newMeta.unknown_node_types || [];
    newUnknown.forEach((t) => existingUnknown.add(t));
    const mergedMetadata = {
        ...existingMeta,
        connection_count: (existingMeta.connection_count || 0) + (newMeta.connection_count || 0),
        merged_guide_count: (existingMeta.merged_guide_count || 1) + 1,
        ...(existingUnknown.size > 0 && { unknown_node_types: [...existingUnknown] })
    };
    return {
        elements: mergedElements,
        metadata: mergedMetadata,
        newNodesToAdd,
        newEdgesToAdd
    };
}

/**
 * Apply merged data incrementally to the existing graph: add only new nodes and new edges
 * (no remove/re-add). Keeps existing elements and their parent/child relationships intact.
 * @param {Object} mergeResult - Result from mergeCablingGuideData: { elements, metadata, newNodesToAdd, newEdgesToAdd }
 */
function applyMergeToGraph(mergeResult) {
    if (!state.cy) return;
    const { newNodesToAdd, newEdgesToAdd, elements: mergedElements } = mergeResult;
    state.cy.startBatch();
    if (newNodesToAdd?.length > 0 || newEdgesToAdd?.length > 0) {
        const sortedNewElements = sortElementsParentsBeforeChildren([...newNodesToAdd, ...newEdgesToAdd]);
        const sortedNewNodes = sortedNewElements.filter((el) => el.group !== 'edges' && !(el.data && ('source' in (el.data || {}) || 'target' in (el.data || {}))));
        const sortedNewEdges = sortedNewElements.filter((el) => el.group === 'edges' || (el.data && (('source' in (el.data || {})) || ('target' in (el.data || {})))));
        if (sortedNewNodes.length > 0) state.cy.add(sortedNewNodes);
        if (sortedNewEdges.length > 0) state.cy.add(sortedNewEdges);
    }
    // Sync every node's parent in the graph to match merged data (so shelves end up in correct rack/hall/aisle)
    if (mergedElements?.length) {
        const sortedNodes = sortElementsParentsBeforeChildren(mergedElements).filter(
            (el) => el.group !== 'edges' && !(el.data && ('source' in (el.data || {}) || 'target' in (el.data || {})))
        );
        sortedNodes.forEach((el) => {
            const id = el.data?.id;
            const wantParent = el.data?.parent ?? null;
            if (id == null) return;
            const node = state.cy.getElementById(String(id));
            if (node.length === 0 || !node.isNode()) return;
            const currentParent = node.parent().length ? node.parent().id() : null;
            if (currentParent !== wantParent) node.move({ parent: wantParent != null ? wantParent : null });
        });
    }
    state.cy.endBatch();
}

/**
 * Sort elements so parent nodes are added before their children (Cytoscape requires this for compound nodes).
 * Preserves racking hierarchy when re-adding serialized elements (e.g. after merge).
 * Order: hall -> aisle -> rack -> shelf -> tray -> port, then other nodes, then edges.
 */
function sortElementsParentsBeforeChildren(elements) {
    if (!elements || !elements.length) return elements;
    const typeOrder = { hall: 0, aisle: 1, rack: 2, shelf: 3, tray: 4, port: 5 };
    const nodes = [];
    const edges = [];
    elements.forEach((el) => {
        if (el.group === 'edges' || (el.data && ('source' in el.data || 'target' in el.data))) {
            edges.push(el);
        } else {
            nodes.push(el);
        }
    });
    nodes.sort((a, b) => {
        const typeA = (a.data && a.data.type) || '';
        const typeB = (b.data && b.data.type) || '';
        const orderA = typeOrder[typeA] !== undefined ? typeOrder[typeA] : 6;
        const orderB = typeOrder[typeB] !== undefined ? typeOrder[typeB] : 6;
        if (orderA !== orderB) return orderA - orderB;
        const parentA = a.data && a.data.parent;
        const parentB = b.data && b.data.parent;
        if (!parentA && parentB) return -1;
        if (parentA && !parentB) return 1;
        if (parentA && parentB && parentA !== parentB) {
            const idA = a.data && a.data.id;
            const idB = b.data && b.data.id;
            if (idA === parentB) return 1;
            if (idB === parentA) return -1;
        }
        return 0;
    });
    return [...nodes, ...edges];
}

/**
 * Add another cabling guide (CSV) to the current location-mode visualization.
 * Uploads the CSV, merges with current data, and adds only new nodes/edges to the existing graph
 * (no full re-init), so existing parent/child relationships stay intact.
 * @param {File} file - CSV file
 */
async function addAnotherCablingGuideLocation(file) {
    if (!file || !file.name.toLowerCase().endsWith('.csv')) {
        window.showExportStatus?.('Please select a CSV file.', 'error');
        return;
    }
    if (getVisualizationMode() !== 'location') {
        window.showExportStatus?.('Add another guide is only available in Physical Deployment mode.', 'error');
        return;
    }
    if (!state.data.currentData?.elements?.length) {
        window.showExportStatus?.('Load a cabling guide first, then add another.', 'error');
        return;
    }

    const loadingEl = document.getElementById('loadingAddAnotherLocation');
    const btn = document.getElementById('addAnotherCablingGuideBtn');
    const fileInput = document.getElementById('addAnotherCablingGuideFile');
    if (loadingEl) loadingEl.style.display = 'block';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Processing...';
    }

    try {
        const formData = new FormData();
        formData.append('csv_file', file);

        const response = await fetch('/upload_csv', { method: 'POST', body: formData });
        const result = await response.json();

        if (!response.ok || !result.success) {
            window.showExportStatus?.(result.error || 'Failed to process CSV', 'error');
            return;
        }

        const newData = result.data;
        // Use live graph (with parent patched) so merge preserves compound hierarchy
        let existingData = state.data.currentData;
        if (state.cy && state.cy.elements().length > 0) {
            const rawElements = state.cy.elements().jsons();
            const elementsWithParent = rawElements.map((el) => {
                if (el.group === 'edges' || (el.data && ('source' in (el.data || {})))) return el;
                const id = el.data?.id;
                const node = state.cy.getElementById(id != null ? String(id) : '');
                const parentId = (node.length && node.isNode()) ? (node.parent().length ? node.parent().id() : null) : null;
                return { ...el, data: { ...el.data, parent: parentId !== undefined && parentId !== null ? parentId : undefined } };
            });
            existingData = {
                elements: elementsWithParent,
                metadata: state.data.currentData?.metadata ? { ...state.data.currentData.metadata } : {}
            };
        }

        const validation = validateMergedCablingGuide(existingData, newData);
        if (validation.errors.length > 0) {
            const errMsg = validation.errors.length === 1
                ? validation.errors[0]
                : `${validation.errors.length} conflict(s): ${validation.errors.slice(0, 2).join(' ')}${validation.errors.length > 2 ? '…' : ''}`;
            window.showExportStatus?.(errMsg, 'error');
            return;
        }

        const mergePrefix = 'm' + ((existingData?.metadata?.merged_guide_count || 1) + 1);
        const merged = mergeCablingGuideData(existingData, newData, mergePrefix);
        const sortedElements = sortElementsParentsBeforeChildren(merged.elements);
        state.data.currentData = { elements: sortedElements, metadata: merged.metadata };
        // Add only new nodes/edges to the existing graph (no full re-init) so existing parent/child relationships stay intact
        applyMergeToGraph(merged);
        if (state.cy) {
            commonModule.applyDragRestrictions();
            commonModule.forceApplyCurveStyles();
            if (getVisualizationMode() === 'location') {
                locationModule.calculateLayout();
                // Do not call organizeInGrid() when we have racks: it moves every shelf to parent null and breaks compounds
                const hasRacks = state.cy.nodes('[type="rack"]').length > 0;
                if (!hasRacks) locationModule?.organizeInGrid?.();
            } else {
                locationModule?.organizeInGrid?.();
            }
        }
        updateConnectionLegend(state.data.currentData);

        let msg = result.message ? `${result.message} Merged into visualization.` : 'Cabling guide added.';
        if (validation.warnings.length > 0) {
            const warnSummary = validation.warnings.length === 1
                ? validation.warnings[0]
                : `${validation.warnings.length} connection(s) re-defined (same endpoints).`;
            msg += ' ' + warnSummary;
            const fullWarn = validation.warnings.length > 1 ? msg + '\n\n' + validation.warnings.join('\n') : null;
            window.showExportStatus?.(msg, 'warning', fullWarn);
        } else {
            window.showExportStatus?.(msg, 'success');
        }
        if (fileInput) fileInput.value = '';
    } catch (err) {
        console.error('Add another cabling guide error:', err);
        window.showExportStatus?.('Upload failed: ' + err.message, 'error');
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📊 Add CSV to visualization';
        }
    }
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

    // Check if hierarchy structure has changed - force re-import
    if (state.data.hierarchyStructureChanged) {
        const errorMsg = 'The hierarchy structure has changed (nodes added, removed, or moved). ' +
            'The deployment descriptor must be re-imported to match the new structure. ' +
            'Please re-import the deployment descriptor.';
        showErrorLocation(errorMsg);
        console.error('[applyDeploymentDescriptor] Blocked: Hierarchy structure changed');
        return;
    }

    loading.style.display = 'block';
    uploadBtn.disabled = true;
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = 'Processing...';
    hideMessagesForMode('location');

    // Use live graph (cy) when available so all nodes are included regardless of collapse state.
    // Exclude rerouted edges (collapse view-state) so they are never sent or stored; they reference
    // collapsed parents and would cause "nonexistant source" when payload is reloaded.
    let cytoscapePayload = state.data.currentData;
    if (state.cy && state.cy.elements) {
        const raw = state.cy.elements().jsons();
        const withoutRerouted = raw.filter((el) => {
            if (el.group === 'edges' && el.data) {
                if (el.data.isRerouted === true) return false;
                if (typeof el.data.id === 'string' && el.data.id.startsWith('rerouted_')) return false;
            }
            return true;
        });
        const sanitized = exportModule?.sanitizeForJSON ? exportModule.sanitizeForJSON(withoutRerouted) : withoutRerouted;
        cytoscapePayload = {
            elements: Array.isArray(sanitized) ? sanitized : withoutRerouted,
            ...(state.data.currentData?.metadata && { metadata: state.data.currentData.metadata })
        };
    }

    const formData = new FormData();
    formData.append('deployment_file', file);
    formData.append('cytoscape_data', JSON.stringify(cytoscapePayload));

    try {
        const response = await fetch('/apply_deployment_descriptor', { method: 'POST', body: formData });
        const result = await response.json();
        if (response.ok && result.success) {
            // Keep in-memory snapshot in sync with full graph (important when payload was built from cy)
            if (result.data?.elements) {
                state.data.currentData = result.data;
            }
            if (locationModule?.updateShelfLocations) {
                const updatedCount = locationModule.updateShelfLocations(result.data);
                console.log(`[applyDeploymentDescriptor] Updated ${updatedCount} shelf nodes with location data`);
            } else {
                console.warn('[applyDeploymentDescriptor] locationModule.updateShelfLocations not available, falling back to initVisualization');
                initVisualization(result.data);
            }
            // Mark deployment descriptor as applied and clear hierarchy change flag
            state.data.deploymentDescriptorApplied = true;
            state.data.hierarchyStructureChanged = false;

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

    // Check if hierarchy structure has changed - force re-import
    if (state.data.hierarchyStructureChanged) {
        const errorMsg = 'The hierarchy structure has changed (nodes added, removed, or moved). ' +
            'The deployment descriptor must be re-imported to match the new structure. ' +
            'Please re-import the deployment descriptor.';
        alert(errorMsg);
        console.error('[applyDeploymentDescriptorFromModal] Blocked: Hierarchy structure changed');
        return;
    }

    const applyBtn = document.getElementById('applyUploadBtn');
    if (!applyBtn) return;
    const originalText = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Processing...';

    // Use live graph (cy) when available; exclude rerouted edges to avoid "nonexistant source" on reload
    let cytoscapePayload = state.data.currentData;
    if (state.cy && state.cy.elements) {
        const raw = state.cy.elements().jsons();
        const withoutRerouted = raw.filter((el) => {
            if (el.group === 'edges' && el.data) {
                if (el.data.isRerouted === true) return false;
                if (typeof el.data.id === 'string' && el.data.id.startsWith('rerouted_')) return false;
            }
            return true;
        });
        const sanitized = exportModule?.sanitizeForJSON ? exportModule.sanitizeForJSON(withoutRerouted) : withoutRerouted;
        cytoscapePayload = {
            elements: Array.isArray(sanitized) ? sanitized : withoutRerouted,
            ...(state.data.currentData?.metadata && { metadata: state.data.currentData.metadata })
        };
    }

    const formData = new FormData();
    formData.append('deployment_file', file);
    formData.append('cytoscape_data', JSON.stringify(cytoscapePayload));

    try {
        const response = await fetch('/apply_deployment_descriptor', { method: 'POST', body: formData });
        const result = await response.json();
        if (response.ok && result.success) {
            if (result.data?.elements) {
                state.data.currentData = result.data;
            }
            if (locationModule?.updateShelfLocations) {
                const updatedCount = locationModule.updateShelfLocations(result.data);
                console.log(`[applyDeploymentDescriptor] Updated ${updatedCount} shelf nodes with location data`);
            } else {
                console.warn('[applyDeploymentDescriptor] locationModule.updateShelfLocations not available, falling back to initVisualization');
                initVisualization(result.data);
            }
            // Mark deployment descriptor as applied and clear hierarchy change flag
            state.data.deploymentDescriptorApplied = true;
            state.data.hierarchyStructureChanged = false;

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
    updateNodeVariationOptions,
    getPortLocationInfo,
    getLocationByHostIndex,
    getHostIndexByLocation,
    getHostIndexByHostname,
    addAnotherCablingGuideLocation,
    mergeCablingGuideData,
    validateMergedCablingGuide,
    validateOneConnectionPerPort,
};

// Combine and expose all functions
const functionsToExpose = { ...cytoscapeHandlers, ...otherFunctions };
Object.keys(functionsToExpose).forEach(key => {
    window[key] = functionsToExpose[key];
});

// Named exports for tests (merge debugging)
export { mergeCablingGuideData, sortElementsParentsBeforeChildren, validateMergedCablingGuide, validateOneConnectionPerPort };