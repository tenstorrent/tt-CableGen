// Network Cabling Visualizer - Client-side JavaScript

// ===== Configuration Constants =====
const LAYOUT_CONSTANTS = {
    // Location mode constants (for rack-based layout)
    DEFAULT_RACK_WIDTH: 450,
    MIN_START_X: 350,
    MIN_START_Y: 450,
    RACK_X_OFFSET: 100,
    RACK_Y_OFFSET: 150,
    NEW_RACK_DEFAULT_X: 250,
    NEW_RACK_DEFAULT_Y: 300,
    RACK_SPACING_BUFFER: 1.35,  // 35% extra space

    // Hierarchy mode constants (percentage-based spacing)
    // These are multipliers applied to node dimensions
    GRAPH_VERTICAL_SPACING_FACTOR: 1.05,   // 5% extra space below each graph (tight)
    GRAPH_PADDING_TOP_FACTOR: 0.05,        // 5% of parent height as top padding

    // Shelf node spacing (percentage-based)
    SHELF_HORIZONTAL_SPACING_FACTOR: 1.03, // 3% extra space between shelves (tight)
    SHELF_PADDING_LEFT_FACTOR: 0.03,       // 3% of parent width as left padding
    SHELF_PADDING_TOP_FACTOR: 0.08,        // 8% of parent height as top padding

    // Starting positions for top-level nodes
    TOP_LEVEL_START_X: 200,
    TOP_LEVEL_START_Y: 200,

    // Fallback dimensions when node size cannot be determined
    FALLBACK_GRAPH_HEIGHT: 450,
    FALLBACK_SHELF_WIDTH: 200
};

const CONNECTION_COLORS = {
    INTRA_NODE: '#4CAF50',  // Green for same node (legacy, not used in hierarchy mode)
    INTER_NODE: '#2196F3'   // Blue for different nodes (legacy, not used in hierarchy mode)
};

// Color palette for template assignment
// Each template gets a unique color from this palette
const TEMPLATE_COLOR_PALETTE = [
    "#E74C3C",  // Red
    "#E67E22",  // Orange
    "#F1C40F",  // Yellow
    "#27AE60",  // Green
    "#3498DB",  // Blue
    "#9B59B6",  // Purple
    "#E91E63",  // Pink
    "#00BCD4",  // Cyan
    "#FF5722",  // Deep Orange
    "#8BC34A",  // Light Green
    "#00BCD4",  // Teal
    "#FF9800"   // Amber
];

// Template-to-color mapping (dynamically assigned)
// Populated as templates are discovered
const TEMPLATE_COLORS = {};

// Track next color index to assign
let nextColorIndex = 0;

/**
 * Get or assign a color for a template
 * Pure template-based coloring - no depth consideration
 */
/**
 * Verify that all required cytoscape extensions are loaded and available
 * Logs warnings for any missing extensions
 */
function verifyCytoscapeExtensions() {
    if (typeof cy === 'undefined' || !cy) {
        console.warn('⚠ Cannot verify extensions: cytoscape instance not initialized');
        return;
    }

    const missingExtensions = [];
    const availableExtensions = [];

    // Check for expand-collapse extension
    if (typeof cy.expandCollapse === 'function') {
        availableExtensions.push('cytoscape-expand-collapse');
    } else {
        missingExtensions.push('cytoscape-expand-collapse');
    }

    // Check for fcose layout extension
    // fcose registers itself as a layout algorithm, so we check by trying to create a layout
    try {
        // Try to create a test layout with fcose - if it fails, the extension isn't loaded
        const testLayout = cy.layout({ name: 'fcose', eles: cy.collection() });
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

function getTemplateColor(templateName) {
    // Check if we already have a color for this template
    if (TEMPLATE_COLORS[templateName]) {
        return TEMPLATE_COLORS[templateName];
    }

    // Assign next color from palette
    const color = TEMPLATE_COLOR_PALETTE[nextColorIndex % TEMPLATE_COLOR_PALETTE.length];
    TEMPLATE_COLORS[templateName] = color;
    nextColorIndex++;

    return color;
}

const DEFAULT_CABLE_CONFIG = {
    type: 'QSFP_DD',
    length: 'Unknown'
};

/**
 * COMMON: Arrange trays and ports within a shelf node based on node type configuration
 * This is mode-independent - works for both location and hierarchy modes
 */
function common_arrangeTraysAndPorts(shelfNode) {
    if (!shelfNode || !cy) return;

    const shelfPos = shelfNode.position();
    const nodeType = shelfNode.data('shelf_node_type') || 'WH_GALAXY';
    const config = NODE_CONFIGS[nodeType];
    
    if (!config) {
        console.warn(`No config found for node type: ${nodeType}`);
        return;
    }

    const trays = shelfNode.children('[type="tray"]');
    if (trays.length === 0) return;

    // Layout constants based on node configuration
    const trayHeight = 60;
    const traySpacing = 10;
    const portWidth = 45;
    const portSpacing = 5;

    // Sort trays by number
    const sortedTrays = trays.sort((a, b) => {
        return (a.data('tray') || 0) - (b.data('tray') || 0);
    });

    sortedTrays.forEach((tray, index) => {
        const trayNum = index + 1;
        
        // Calculate tray position based on layout
        let trayX, trayY;
        if (config.tray_layout === 'vertical') {
            // Vertical arrangement: T1 at top, T2, T3, T4 going down
            trayX = shelfPos.x;
            trayY = shelfPos.y - 150 + (trayNum - 1) * (trayHeight + traySpacing);
        } else {
            // Horizontal arrangement: T1, T2, T3, T4 arranged left-to-right
            trayX = shelfPos.x - 150 + (trayNum - 1) * (trayHeight + traySpacing);
            trayY = shelfPos.y;
        }
        
        tray.position({ x: trayX, y: trayY });

        // Arrange ports within this tray
        const ports = tray.children('[type="port"]');
        const sortedPorts = ports.sort((a, b) => {
            const aLabel = a.data('label') || '';
            const bLabel = b.data('label') || '';
            const aNum = parseInt(aLabel.replace('P', '')) || 0;
            const bNum = parseInt(bLabel.replace('P', '')) || 0;
            return aNum - bNum;
        });

        sortedPorts.forEach((port, portIndex) => {
            const portNum = portIndex + 1;
            
            // Calculate port position (orthogonal to tray arrangement)
            let portX, portY;
            if (config.tray_layout === 'vertical') {
                // Vertical trays → horizontal ports
                portX = trayX - 120 + (portNum - 1) * (portWidth + portSpacing);
                portY = trayY;
            } else {
                // Horizontal trays → vertical ports
                portX = trayX;
                portY = trayY - 100 + (portNum - 1) * (portWidth + portSpacing);
            }
            
            port.position({ x: portX, y: portY });
        });
    });
}

/**
 * LOCATION MODE: Apply location-based layout with stacked halls/aisles
 * Used for initial CSV imports in location mode
 */
function location_calculateLayout() {
    if (!cy) return;

    console.log('Applying location-based stacked hall/aisle layout');

    // Get all racks and group by hall/aisle
    const racks = cy.nodes('[type="rack"]');
    if (racks.length === 0) {
        console.log('No racks found, using simple grid layout');
        return;
    }

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
    
    // Sort racks within each aisle by rack number
    Object.keys(rackHierarchy).forEach(hall => {
        Object.keys(rackHierarchy[hall]).forEach(aisle => {
            rackHierarchy[hall][aisle].sort(function (a, b) {
                return a.rack_num - b.rack_num;
            });
        });
    });

    // Stacked hall/aisle layout constants
    const hallSpacing = 1200;
    const aisleOffsetX = 400;
    const aisleOffsetY = 400;
    const rackSpacing = 600;
    const baseX = 200;
    const baseY = 300;

    cy.startBatch();

    // Keep track of existing hall and aisle nodes (don't recreate if already exist)
    const existingHalls = {};
    const existingAisles = {};
    cy.nodes('[type="hall"]').forEach(hallNode => {
        existingHalls[hallNode.data('hall')] = hallNode;
    });
    cy.nodes('[type="aisle"]').forEach(aisleNode => {
        const key = `${aisleNode.data('hall')}_${aisleNode.data('aisle')}`;
        existingAisles[key] = aisleNode;
    });

    let hallIndex = 0;
    Object.keys(rackHierarchy).sort().forEach(hall => {
        const hallStartY = baseY + (hallIndex * hallSpacing);
        
        // Create or update hall node
        let hallNode = existingHalls[hall];
        const hallId = `hall_${hall}`;
        
        if (!hallNode || hallNode.length === 0) {
            // Create new hall node
            cy.add({
                data: {
                    id: hallId,
                    label: `Hall ${hall}`,
                    type: 'hall',
                    hall: hall
                },
                position: { x: baseX, y: hallStartY }
            });
            hallNode = cy.getElementById(hallId);
        } else {
            // Update existing hall node position
            hallNode.position({ x: baseX, y: hallStartY });
        }
        
        let aisleIndex = 0;
        Object.keys(rackHierarchy[hall]).sort().forEach(aisle => {
            const aisleStartX = baseX + (aisleIndex * aisleOffsetX);
            const aisleStartY = hallStartY + (aisleIndex * aisleOffsetY);
            
            // Create or update aisle node
            const aisleKey = `${hall}_${aisle}`;
            let aisleNode = existingAisles[aisleKey];
            const aisleId = `aisle_${hall}_${aisle}`;
            
            if (!aisleNode || aisleNode.length === 0) {
                // Create new aisle node as child of hall
                cy.add({
                    data: {
                        id: aisleId,
                        label: `Aisle ${aisle}`,
                        type: 'aisle',
                        parent: hallId,
                        hall: hall,
                        aisle: aisle
                    },
                    position: { x: aisleStartX, y: aisleStartY }
                });
                aisleNode = cy.getElementById(aisleId);
            } else {
                // Update existing aisle node position and parent
                aisleNode.position({ x: aisleStartX, y: aisleStartY });
                aisleNode.move({ parent: hallId });
            }
            
            let rackX = aisleStartX;
            rackHierarchy[hall][aisle].forEach(function (rackData) {
                const rack = rackData.node;
                
                // Update rack parent to be the aisle
                rack.move({ parent: aisleId });
                
                // Update rack position
                rack.position({ x: rackX, y: aisleStartY });
                
                // Update rack label to show full context
                const rackHall = rackData.hall || hall;
                const rackAisle = rackData.aisle || aisle;
                rack.data('label', `Rack ${rackData.rack_num} (${rackHall}-${rackAisle})`);
                
                // Position shelves within rack with dynamic spacing
                const shelves = rack.children('[type="shelf"]');
                const sortedShelves = [];
                shelves.forEach(function (shelf) {
                    sortedShelves.push({
                        node: shelf,
                        shelf_u: parseInt(shelf.data('shelf_u')) || 0
                    });
                });
                sortedShelves.sort(function (a, b) {
                    return b.shelf_u - a.shelf_u; // Higher shelf_u at top
                });
                
                const numShelves = sortedShelves.length;
                if (numShelves > 0) {
                    // First pass: position shelves temporarily and arrange their children
                    sortedShelves.forEach(function (shelfData) {
                        const shelf = shelfData.node;
                        shelf.position({ x: rackX, y: aisleStartY }); // Temporary position
                        common_arrangeTraysAndPorts(shelf); // Arrange trays/ports to get actual size
                    });
                    
                    // Second pass: calculate dynamic spacing based on actual shelf heights
                    let currentY = aisleStartY;
                    let maxShelfHeight = 0;
                    
                    // Calculate total height needed
                    sortedShelves.forEach(function (shelfData) {
                        const shelf = shelfData.node;
                        const shelfBBox = shelf.boundingBox();
                        const shelfHeight = shelfBBox.h || 100;
                        maxShelfHeight = Math.max(maxShelfHeight, shelfHeight);
                    });
                    
                    // Use dynamic spacing: shelf height + 5% padding
                    const shelfSpacingFactor = 1.05;
                    const totalHeight = (numShelves - 1) * maxShelfHeight * shelfSpacingFactor;
                    const shelfStartY = aisleStartY - (totalHeight / 2);
                    
                    // Third pass: apply final positions with proper spacing
                    sortedShelves.forEach(function (shelfData, shelfIndex) {
                        const shelf = shelfData.node;
                        const yPos = shelfStartY + (shelfIndex * maxShelfHeight * shelfSpacingFactor);
                        shelf.position({ x: rackX, y: yPos });
                    });
                }
                
                rackX += rackSpacing;
            });
            
            aisleIndex++;
        });
        
        hallIndex++;
    });

    cy.endBatch();
    
    console.log('Location-based layout applied with hall > aisle > rack > shelf hierarchy');
    
    // Apply fcose layout to prevent overlaps in location mode
    // This fine-tunes the positions calculated by the manual layout
    setTimeout(() => {
        const locationNodes = cy.nodes('[type="hall"], [type="aisle"], [type="rack"]');
        if (locationNodes.length > 0) {
            try {
                const layout = cy.layout({
                    name: 'fcose',
                    eles: locationNodes,
                    quality: 'default',
                    randomize: false,  // Use calculated positions as starting point
                    animate: false,
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
                        cy.nodes('[type="shelf"]').forEach(shelf => {
                            common_arrangeTraysAndPorts(shelf);
                        });
                        applyDragRestrictions();
                        forceApplyCurveStyles();
                    }
                });
                if (layout) {
                    layout.run();
                }
            } catch (e) {
                console.warn('Error applying fcose layout in location mode:', e.message);
            }
        }
    }, 100);
}

/**
 * HIERARCHY MODE: Calculate positions for all nodes in the graph hierarchy
 * This provides consistent spacing for both imported and newly created nodes
 * Uses percentage-based spacing that adapts to actual node sizes
 */
function hierarchy_calculateLayout() {
    if (!cy) return;

    // Get all top-level graph nodes (no parent)
    const topLevelNodes = cy.nodes('[type="graph"]').filter(node => {
        const parent = node.parent();
        return parent.length === 0;
    });

    // Sort by label for consistent ordering
    const sortedTopLevel = topLevelNodes.sort((a, b) => {
        return a.data('label').localeCompare(b.data('label'));
    });

    // Position top-level nodes with dynamic spacing
    let currentY = LAYOUT_CONSTANTS.TOP_LEVEL_START_Y;

    sortedTopLevel.forEach((node, index) => {
        const x = LAYOUT_CONSTANTS.TOP_LEVEL_START_X;
        node.position({ x, y: currentY });

        // Recursively position children
        positionGraphChildren(node);

        // Calculate spacing for next node based on current node's actual size
        const bbox = node.boundingBox();
        const nodeHeight = bbox.h || LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT;
        const spacing = nodeHeight * LAYOUT_CONSTANTS.GRAPH_VERTICAL_SPACING_FACTOR;
        currentY += spacing;
    });
}

/**
 * Recursively position children of a graph node
 * Uses dynamic sizing based on actual node dimensions
 */
function positionGraphChildren(graphNode) {
    const graphPos = graphNode.position();
    const graphBBox = graphNode.boundingBox();
    const children = graphNode.children();

    // Separate shelves and nested graphs
    const shelves = children.filter(n => n.data('type') === 'shelf');
    const nestedGraphs = children.filter(n => n.data('type') === 'graph');

    // Position shelves in a smart rectangular grid
    shelves.sort((a, b) => a.data('label').localeCompare(b.data('label')));
    
    if (shelves.length > 0) {
        // First pass: arrange children to get accurate dimensions
        shelves.forEach(shelf => {
            positionShelfChildren(shelf);
        });
        
        // Calculate grid dimensions - aim for roughly square aspect ratio
        const numShelves = shelves.length;
        let gridCols, gridRows;
        
        if (numShelves <= 3) {
            // For 1-3 shelves, arrange horizontally
            gridCols = numShelves;
            gridRows = 1;
        } else {
            // For 4+ shelves, calculate optimal grid
            // Try to make it roughly square, slightly preferring more columns
            gridCols = Math.ceil(Math.sqrt(numShelves * 1.2)); // 1.2 factor prefers wider grids
            gridRows = Math.ceil(numShelves / gridCols);
        }
        
        // Get actual shelf dimensions for proper spacing
        let maxShelfWidth = 0;
        let maxShelfHeight = 0;
        shelves.forEach(shelf => {
            const bbox = shelf.boundingBox();
            maxShelfWidth = Math.max(maxShelfWidth, bbox.w || LAYOUT_CONSTANTS.FALLBACK_SHELF_WIDTH);
            maxShelfHeight = Math.max(maxShelfHeight, bbox.h || 200);
        });
        
        // Calculate starting position
        const startX = graphPos.x + (graphBBox.w * LAYOUT_CONSTANTS.SHELF_PADDING_LEFT_FACTOR);
        const startY = graphPos.y + (graphBBox.h * LAYOUT_CONSTANTS.SHELF_PADDING_TOP_FACTOR);
        
        // Calculate spacing (shelf dimension + small padding)
        const horizontalSpacing = maxShelfWidth * LAYOUT_CONSTANTS.SHELF_HORIZONTAL_SPACING_FACTOR;
        const verticalSpacing = maxShelfHeight * 1.1; // 10% vertical padding
        
        // Position shelves in grid
        shelves.forEach((shelf, index) => {
            const row = Math.floor(index / gridCols);
            const col = index % gridCols;
            
            const x = startX + (col * horizontalSpacing);
            const y = startY + (row * verticalSpacing);
            
            shelf.position({ x, y });
        });
    }

    // Position nested graphs in a grid/square pattern
    nestedGraphs.sort((a, b) => a.data('label').localeCompare(b.data('label')));

    if (nestedGraphs.length > 0) {
        // Calculate grid dimensions - aim for square-ish layout
        const gridCols = Math.ceil(Math.sqrt(nestedGraphs.length));
        const gridRows = Math.ceil(nestedGraphs.length / gridCols);

        // Starting position
        const startX = graphPos.x + (graphBBox.w * 0.05); // 5% padding from left
        const startY = graphPos.y + (graphBBox.h * LAYOUT_CONSTANTS.GRAPH_PADDING_TOP_FACTOR);

        // Track max dimensions for each row/column for proper spacing
        const rowHeights = new Array(gridRows).fill(0);
        const colWidths = new Array(gridCols).fill(0);

        // First pass: position nodes and calculate max dimensions
        nestedGraphs.forEach((graph, index) => {
            const row = Math.floor(index / gridCols);
            const col = index % gridCols;

            // Calculate position based on accumulated widths/heights
            let x = startX;
            for (let c = 0; c < col; c++) {
                x += colWidths[c];
            }

            let y = startY;
            for (let r = 0; r < row; r++) {
                y += rowHeights[r];
            }

            graph.position({ x, y });

            // Recursively position this graph's children
            positionGraphChildren(graph);

            // Update max dimensions for this row/column
            const nestedBBox = graph.boundingBox();
            const nestedWidth = (nestedBBox.w || LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT) * 1.1; // 10% spacing
            const nestedHeight = (nestedBBox.h || LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT) * LAYOUT_CONSTANTS.GRAPH_VERTICAL_SPACING_FACTOR;

            colWidths[col] = Math.max(colWidths[col], nestedWidth);
            rowHeights[row] = Math.max(rowHeights[row], nestedHeight);
        });

        // Second pass: reposition with correct spacing
        nestedGraphs.forEach((graph, index) => {
            const row = Math.floor(index / gridCols);
            const col = index % gridCols;

            let x = startX;
            for (let c = 0; c < col; c++) {
                x += colWidths[c];
            }

            let y = startY;
            for (let r = 0; r < row; r++) {
                y += rowHeights[r];
            }

            graph.position({ x, y });
        });
    }
}

/**
 * Position trays and ports within a shelf
 */
function positionShelfChildren(shelfNode) {
    // Use the common tray/port arrangement function
    // This respects the node type configuration (vertical vs horizontal layout)
    common_arrangeTraysAndPorts(shelfNode);
}

// ===== Global Variables =====
let cy;
let currentData = null;
let initialVisualizationData = null;  // Store initial data for reset functionality
let hierarchyModeState = null;  // Store current hierarchy state when switching to location mode
let selectedConnection = null;
let selectedNode = null;  // Track selected node for deletion
let isEdgeCreationMode = false;
let sourcePort = null;
let availableGraphTemplates = {};  // Store graph templates from loaded textproto
let globalHostCounter = 0;  // Global counter for unique host IDs across all instances

// ===== Node Drag Control =====
/**
 * Apply drag restrictions: tray and port nodes should not be draggable.
 * All other nodes (graph containers, racks, shelves, halls, aisles, etc.) remain draggable.
 */
function applyDragRestrictions() {
    if (!cy) return;

    cy.nodes().forEach(node => {
        const nodeType = node.data('type');
        if (nodeType === 'tray' || nodeType === 'port') {
            node.ungrabify();
        } else {
            node.grabify();
        }
    });
}

// Visualization Mode Management
let visualizationMode = 'location'; // 'location' or 'hierarchy'

/**
 * Set the visualization mode and update UI accordingly
 * @param {string} mode - 'location' or 'hierarchy'
 */
function setVisualizationMode(mode) {
    visualizationMode = mode;
    
    // Update body class for mode-specific CSS visibility
    document.body.classList.remove('mode-location', 'mode-hierarchy');
    if (mode === 'location') {
        document.body.classList.add('mode-location');
    } else if (mode === 'hierarchy') {
        document.body.classList.add('mode-hierarchy');
    }
    
    updateModeIndicator();
}

/**
 * Get the current visualization mode
 * @returns {string} Current mode ('location' or 'hierarchy')
 */
function getVisualizationMode() {
    return visualizationMode;
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

    if (!indicator || !currentModeDiv || !descriptionDiv) return;

    // Show the indicator
    indicator.style.display = 'block';

    if (visualizationMode === 'hierarchy') {
        indicator.style.background = '#fff3cd';
        indicator.style.borderColor = '#ffc107';
        currentModeDiv.innerHTML = '<strong>🌳 Logical Topology View</strong>';
        descriptionDiv.textContent = 'Organized by graph templates and instances (ignores physical location)';
        
        // Hide physical fields, show logical message
        if (nodePhysicalFields) nodePhysicalFields.style.display = 'none';
        if (nodeLogicalMessage) nodeLogicalMessage.style.display = 'block';
    } else {
        indicator.style.background = '#d1ecf1';
        indicator.style.borderColor = '#0c5460';
        currentModeDiv.innerHTML = '<strong>📍 Physical Location View</strong>';
        descriptionDiv.textContent = 'Organized by physical location: hall/aisle/rack/shelf (ignores logical topology)';
        
        // Show physical fields, hide logical message
        if (nodePhysicalFields) nodePhysicalFields.style.display = 'block';
        if (nodeLogicalMessage) nodeLogicalMessage.style.display = 'none';
    }
}

/**
 * Extract graph templates from loaded data metadata
 * @param {Object} data - The visualization data
 */
function extractGraphTemplates(data) {
    availableGraphTemplates = {};

    // Check if metadata contains graph_templates
    if (data.metadata && data.metadata.graph_templates) {
        availableGraphTemplates = data.metadata.graph_templates;
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

    const templateCount = Object.keys(availableGraphTemplates).length;

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
        Object.keys(availableGraphTemplates).sort().forEach(templateName => {
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
    if (!cy) {
        alert('No visualization loaded. Please upload a file first.');
        return;
    }

    // Toggle the mode
    const newMode = visualizationMode === 'hierarchy' ? 'location' : 'hierarchy';

    // Restructure the visualization based on the new mode
    if (newMode === 'location') {
        // Check if we need to show the physical layout specification modal
        // This happens on first switch to location mode when nodes don't have physical locations
        const shelfNodes = cy.nodes('[type="shelf"]');
        
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
        location_switchMode();
    } else {
        // Set the new mode
        setVisualizationMode(newMode);
        
        // Update the connection legend based on the new mode if we have initial data
        if (initialVisualizationData) {
            updateConnectionLegend(initialVisualizationData);
        }
        
        // Switching to hierarchy mode: restore original hierarchical structure
        switchToHierarchyMode();
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
function recolorConnectionsForPhysicalView() {
    if (!cy) return;
    
    cy.edges().forEach(edge => {
        const sourceId = edge.data('source');
        const targetId = edge.data('target');
        
        // Check if ports are on the same shelf (2 levels up: port -> tray -> shelf)
        const sourceNode = cy.getElementById(sourceId);
        const targetNode = cy.getElementById(targetId);
        
        if (!sourceNode.length || !targetNode.length) return;
        
        const sourceShelf = getParentAtLevel(sourceNode, 2);
        const targetShelf = getParentAtLevel(targetNode, 2);
        
        let color;
        if (sourceShelf && targetShelf && sourceShelf.id() === targetShelf.id()) {
            color = CONNECTION_COLORS.INTRA_NODE;  // Green for same shelf
        } else {
            color = CONNECTION_COLORS.INTER_NODE;  // Blue for different shelves
        }
        
        // Update the edge color
        edge.data('color', color);
    });
}

/**
 * Recolor connections for logical view using depth-based coloring
 */
function recolorConnectionsForLogicalView() {
    if (!cy) return;
    
    // Depth-based color palette matching the legend
    const depthColors = {
        0: '#E74C3C',  // Red (cluster level)
        1: '#E67E22',  // Orange (superpod level)
        2: '#F1C40F',  // Yellow (pod level)
        3: '#27AE60',  // Green
        4: '#3498DB',  // Blue
        5: '#9B59B6',  // Purple
        6: '#E91E63'   // Magenta/Pink
    };
    
    cy.edges().forEach(edge => {
        const depth = edge.data('depth');
        
        // Use depth-based color if available, otherwise use default
        const color = (depth !== undefined && depthColors[depth]) ? depthColors[depth] : '#888888';
        
        // Update the edge color
        edge.data('color', color);
    });
}

/**
 * LOCATION MODE: Switch to physical location view - rebuild visualization from physical location data only
 * Ignores all logical topology fields and rebuilds from scratch based on hall/aisle/rack/shelf_u
 */
function location_switchMode() {

    // Save current state before modifying (for switching back)
    hierarchyModeState = {
        elements: cy.elements().jsons(),
        metadata: currentData?.metadata ? JSON.parse(JSON.stringify(currentData.metadata)) : {}
    };

    // Extract shelf nodes with their physical location and connection data
    const shelfNodes = cy.nodes('[type="shelf"]');
    if (shelfNodes.length === 0) {
        console.warn('No shelf nodes found');
        return;
    }

    // Extract all relevant data from shelf nodes (preserve ALL fields for round-trip)
    const shelfDataList = [];
    shelfNodes.forEach(node => {
        const data = node.data();
        // Get all data fields - keep everything for round-trip compatibility
        const shelfData = {};
        for (const key in data) {
            shelfData[key] = data[key];
        }
        shelfDataList.push({
            data: shelfData,
            classes: node.classes(),
            position: node.position()
        });
    });

    // Extract all tray and port data (preserve the full hierarchy structure)
    const trayPortData = [];
    shelfNodes.forEach(shelfNode => {
        const trays = shelfNode.children('[type="tray"]');
        trays.forEach(tray => {
            const trayData = tray.data();
            const trayClasses = tray.classes();
            const trayPosition = tray.position();
            const ports = tray.children('[type="port"]');
            const portsList = [];
            ports.forEach(port => {
                // Preserve all port data
                const portData = {};
                const portDataObj = port.data();
                for (const key in portDataObj) {
                    portData[key] = portDataObj[key];
                }
                portsList.push({
                    data: portData,
                    classes: port.classes(),
                    position: port.position()
                });
            });
            
            // Preserve all tray data
            const trayDataCopy = {};
            for (const key in trayData) {
                trayDataCopy[key] = trayData[key];
            }
            
            trayPortData.push({
                shelf_id: shelfNode.id(),
                tray_data: trayDataCopy,
                tray_classes: trayClasses,
                tray_position: trayPosition,
                ports: portsList
            });
        });
    });

    // Extract all connections (edges)
    const connections = [];
    cy.edges().forEach(edge => {
        // Get all data fields from the edge
        const edgeData = {};
        const data = edge.data();
        for (const key in data) {
            edgeData[key] = data[key];
        }
        connections.push({
            data: edgeData,
            classes: edge.classes()
        });
    });

    // Clear the entire graph
    cy.elements().remove();

    // Rebuild visualization based ONLY on physical location data
    const newElements = [];
    
    // Check if we have location information
    const hasLocationInfo = shelfDataList.some(shelfInfo => 
        shelfInfo.data.hall || shelfInfo.data.aisle || (shelfInfo.data.rack_num !== undefined && shelfInfo.data.rack_num !== null)
    );

    if (hasLocationInfo) {
        // Group shelves by location hierarchy: hall -> aisle -> rack
        const locationHierarchy = {};
        
        shelfDataList.forEach(shelfInfo => {
            const hall = shelfInfo.data.hall || 'unknown_hall';
            const aisle = shelfInfo.data.aisle || 'unknown_aisle';
            const rack = shelfInfo.data.rack_num !== undefined ? shelfInfo.data.rack_num : 'unknown_rack';
            
            if (!locationHierarchy[hall]) locationHierarchy[hall] = {};
            if (!locationHierarchy[hall][aisle]) locationHierarchy[hall][aisle] = {};
            if (!locationHierarchy[hall][aisle][rack]) locationHierarchy[hall][aisle][rack] = [];
            
            locationHierarchy[hall][aisle][rack].push(shelfInfo);
        });

        // Create location-based hierarchy nodes with stacked halls/aisles
        // Hierarchy: Hall > Aisle > Rack > Shelf
        // Stack layout: halls stacked vertically, aisles offset diagonally (square offset from right corner)
        const hallSpacing = 1200; // Vertical spacing between halls
        const aisleOffsetX = 400; // Horizontal offset for each aisle (diagonal stack)
        const aisleOffsetY = 400; // Vertical offset for each aisle (diagonal stack)
        const rackSpacing = 600; // Horizontal spacing between racks within an aisle
        const baseX = 200;
        const baseY = 300;

        let hallIndex = 0;
        Object.keys(locationHierarchy).sort().forEach(hall => {
            const hallStartY = baseY + (hallIndex * hallSpacing);
            
            // Create hall node
            const hallId = `hall_${hall}`;
            newElements.push({
                data: {
                    id: hallId,
                    label: `Hall ${hall}`,
                    type: 'hall',
                    hall: hall
                },
                position: { x: baseX, y: hallStartY }
            });
            
            let aisleIndex = 0;
            Object.keys(locationHierarchy[hall]).sort().forEach(aisle => {
                // Square offset: each aisle is offset diagonally from the previous one
                const aisleStartX = baseX + (aisleIndex * aisleOffsetX);
                const aisleStartY = hallStartY + (aisleIndex * aisleOffsetY);
                
                // Create aisle node as child of hall
                const aisleId = `aisle_${hall}_${aisle}`;
                newElements.push({
                    data: {
                        id: aisleId,
                        label: `Aisle ${aisle}`,
                        type: 'aisle',
                        parent: hallId,
                        hall: hall,
                        aisle: aisle
                    },
                    position: { x: aisleStartX, y: aisleStartY }
                });
                
                let rackX = aisleStartX;
                Object.keys(locationHierarchy[hall][aisle]).sort().forEach(rack => {
                    const shelvesInRack = locationHierarchy[hall][aisle][rack];
                    
                    // Create rack node as child of aisle with hall/aisle/rack information preserved
                    const rackId = `rack_${hall}_${aisle}_${rack}`;
                    newElements.push({
                        data: {
                            id: rackId,
                            label: `Rack ${rack} (${hall}-${aisle})`,
                            type: 'rack',
                            parent: aisleId,
                            hall: hall,
                            aisle: aisle,
                            rack_num: rack
                        },
                        classes: 'rack',
                        position: { x: rackX, y: aisleStartY }
                    });

                    // Add shelves to this rack
                    shelvesInRack.forEach((shelfInfo, index) => {
                        newElements.push({
                            data: {
                                ...shelfInfo.data,
                                parent: rackId,
                                type: 'shelf',
                                // Ensure hall/aisle/rack info is preserved on shelf nodes
                                hall: hall,
                                aisle: aisle,
                                rack_num: rack
                            },
                            classes: shelfInfo.classes,
                            position: { x: rackX, y: aisleStartY + 50 + index * 100 }
                        });
                    });

                    rackX += rackSpacing;
                });
                
                aisleIndex++;
            });
            
            hallIndex++;
        });
    } else {
        // No location info - arrange shelves in a grid
        const gridCols = Math.ceil(Math.sqrt(shelfDataList.length));
        shelfDataList.forEach((shelfInfo, index) => {
            const col = index % gridCols;
            const row = Math.floor(index / gridCols);
            newElements.push({
                data: {
                    ...shelfInfo.data,
                    type: 'shelf'
                },
                classes: shelfInfo.classes,
                position: { x: 200 + col * 400, y: 200 + row * 300 }
            });
        });
    }

    // Re-create trays and ports for each shelf with updated location info
    trayPortData.forEach(trayInfo => {
        // Find the shelf this tray belongs to and get its location data
        const parentShelf = newElements.find(el => el.data && el.data.id === trayInfo.shelf_id && el.data.type === 'shelf');
        
        // Add tray node with all preserved data plus location info from parent shelf
        const trayData = {...trayInfo.tray_data};
        trayData.parent = trayInfo.shelf_id;  // Update parent to match new structure
        
        // Inherit location data from parent shelf
        if (parentShelf && parentShelf.data) {
            if (parentShelf.data.hall) trayData.hall = parentShelf.data.hall;
            if (parentShelf.data.aisle) trayData.aisle = parentShelf.data.aisle;
            if (parentShelf.data.rack_num !== undefined) trayData.rack_num = parentShelf.data.rack_num;
            if (parentShelf.data.shelf_u !== undefined) trayData.shelf_u = parentShelf.data.shelf_u;
        }
        
        newElements.push({
            data: trayData,
            classes: trayInfo.tray_classes,
            position: trayInfo.tray_position
        });

        // Add port nodes with all preserved data plus location info
        trayInfo.ports.forEach(portInfo => {
            const portData = {...portInfo.data};
            
            // Inherit location data from parent shelf
            if (parentShelf && parentShelf.data) {
                if (parentShelf.data.hall) portData.hall = parentShelf.data.hall;
                if (parentShelf.data.aisle) portData.aisle = parentShelf.data.aisle;
                if (parentShelf.data.rack_num !== undefined) portData.rack_num = parentShelf.data.rack_num;
                if (parentShelf.data.shelf_u !== undefined) portData.shelf_u = parentShelf.data.shelf_u;
            }
            
            newElements.push({
                data: portData,
                classes: portInfo.classes,
                position: portInfo.position
            });
        });
    });

    // Re-create connections with all preserved data
    connections.forEach(conn => {
        newElements.push({
            data: conn.data,
            classes: conn.classes
        });
    });

    // Add all elements back to cytoscape
    cy.add(newElements);

    // Apply the proper location-based layout with stacked halls/aisles and dynamic spacing
    location_calculateLayout();
    // Note: fcose is applied within location_calculateLayout() to prevent overlaps

    // Apply drag restrictions (trays and ports should not be draggable)
    applyDragRestrictions();

    // Recolor connections for physical view (simple intra/inter-node coloring)
    recolorConnectionsForPhysicalView();

    // Update edge curve styles for physical mode
    setTimeout(() => {
        forceApplyCurveStyles();
    }, 100);

}

/**
 * HIERARCHY MODE: Switch to logical topology view - rebuild visualization from logical topology data only
 * Ignores all physical location fields and rebuilds from scratch based on logical_path
 */
function hierarchy_switchMode() {

    if (!hierarchyModeState || !hierarchyModeState.elements) {
        alert('Cannot restore logical topology - no saved state available. Please switch to location mode first or re-upload your file.');
        return;
    }

    // Extract shelf nodes with their logical topology data
    const shelfNodes = cy.nodes('[type="shelf"]');
    if (shelfNodes.length === 0) {
        console.warn('No shelf nodes found');
        return;
    }

    // Extract all relevant data from shelf nodes (preserve ALL fields for round-trip)
    const shelfDataList = [];
    shelfNodes.forEach(node => {
        const data = node.data();
        // Get all data fields - keep everything for round-trip compatibility
        const shelfData = {};
        for (const key in data) {
            shelfData[key] = data[key];
        }
        shelfDataList.push({
            data: shelfData,
            classes: node.classes(),
            position: node.position()
        });
    });

    // Extract all tray and port data (preserve the full hierarchy structure)
    const trayPortData = [];
    shelfNodes.forEach(shelfNode => {
        const trays = shelfNode.children('[type="tray"]');
        trays.forEach(tray => {
            const trayData = tray.data();
            const trayClasses = tray.classes();
            const trayPosition = tray.position();
            const ports = tray.children('[type="port"]');
            const portsList = [];
            ports.forEach(port => {
                // Preserve all port data
                const portData = {};
                const portDataObj = port.data();
                for (const key in portDataObj) {
                    portData[key] = portDataObj[key];
                }
                portsList.push({
                    data: portData,
                    classes: port.classes(),
                    position: port.position()
                });
            });
            
            // Preserve all tray data
            const trayDataCopy = {};
            for (const key in trayData) {
                trayDataCopy[key] = trayData[key];
            }
            
            trayPortData.push({
                shelf_id: shelfNode.id(),
                tray_data: trayDataCopy,
                tray_classes: trayClasses,
                tray_position: trayPosition,
                ports: portsList
            });
        });
    });

    // Extract all connections (edges)
    const connections = [];
    cy.edges().forEach(edge => {
        // Get all data fields from the edge
        const edgeData = {};
        const data = edge.data();
        for (const key in data) {
            edgeData[key] = data[key];
        }
        connections.push({
            data: edgeData,
            classes: edge.classes()
        });
    });

    // Clear the entire graph
    cy.elements().remove();

    // Rebuild visualization based ONLY on logical topology data
    const newElements = [];
    const graphNodeMap = {}; // Maps logical path strings to graph node IDs

    // Check if we have logical topology information
    const hasLogicalTopology = shelfDataList.some(shelfInfo => 
        shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0
    );

    if (hasLogicalTopology) {
        // Find and recreate the root node from saved hierarchy state
        // The root is not in logical_path arrays since those only store parent paths
        let rootNode = null;
        if (hierarchyModeState && hierarchyModeState.elements) {
            // Find the root graph node (depth 0, no parent)
            const savedRootNodes = hierarchyModeState.elements.filter(el => 
                el.data && el.data.type === 'graph' && el.data.depth === 0 && !el.data.parent
            );
            
            if (savedRootNodes.length > 0) {
                rootNode = savedRootNodes[0].data;
                console.log('Found root node from saved state:', rootNode);
                
                // Get template color for the root
                const rootTemplateColor = getTemplateColor(rootNode.template_name);
                
                // Create root node
                const rootGraphId = rootNode.id;
                newElements.push({
                    data: {
                        id: rootGraphId,
                        label: rootNode.label,
                        type: 'graph',
                        template_name: rootNode.template_name,
                        parent: null,
                        depth: 0,
                        templateColor: rootTemplateColor
                    },
                    classes: 'graph'
                });
                
                // Map the root for child parent references
                // The logical_path entries start AFTER the root, so we need to map by the first element
                graphNodeMap[rootNode.label] = rootGraphId;
            }
        }
        
        // Build graph hierarchy from logical paths
        const allPaths = new Set();
        
        // Collect all unique paths from shelf logical_path arrays
        shelfDataList.forEach(shelfInfo => {
            if (shelfInfo.data.logical_path && Array.isArray(shelfInfo.data.logical_path)) {
                console.log('Shelf logical_path:', shelfInfo.data.logical_path);
                // Add all parent paths
                for (let i = 1; i <= shelfInfo.data.logical_path.length; i++) {
                    allPaths.add(shelfInfo.data.logical_path.slice(0, i).join('/'));
                }
            }
        });

        // Sort paths by depth (shorter first) to ensure proper parent-child order
        const sortedPaths = Array.from(allPaths).sort((a, b) => {
            const aDepth = a.split('/').length;
            const bDepth = b.split('/').length;
            return aDepth - bDepth || a.localeCompare(b);
        });

        console.log('Logical topology paths collected:', sortedPaths);
        console.log('Total graph nodes to create (excluding root):', sortedPaths.length);

        // Create graph nodes for each path
        sortedPaths.forEach((pathStr, index) => {
            const pathArray = pathStr.split('/');
            const depth = pathArray.length; // Depth relative to root
            const instanceName = pathArray[pathArray.length - 1];
            
            // Extract template name from instance name (format: template_name_index)
            const lastUnderscoreIndex = instanceName.lastIndexOf('_');
            const templateName = lastUnderscoreIndex > 0 ? instanceName.substring(0, lastUnderscoreIndex) : instanceName;
            
            // Get template color
            const templateColor = getTemplateColor(templateName);
            
            // Determine parent
            let parentId = null;
            if (pathArray.length === 1) {
                // Direct child of root
                parentId = rootNode ? rootNode.id : null;
            } else {
                // Child of another graph node
                const parentPathStr = pathArray.slice(0, -1).join('/');
                parentId = graphNodeMap[parentPathStr];
            }

            const graphId = `graph_${pathStr.replace(/\//g, '_')}`;
            graphNodeMap[pathStr] = graphId;

            console.log(`Creating graph node: ${instanceName} (depth ${depth}, parent: ${parentId}, template: ${templateName})`);

            newElements.push({
                data: {
                    id: graphId,
                    label: instanceName,
                    type: 'graph',
                    template_name: templateName,
                    parent: parentId,
                    depth: depth,
                    templateColor: templateColor
                },
                classes: 'graph'
            });
        });

        console.log('graphNodeMap:', graphNodeMap);

        // Add shelves to their logical parents
        shelfDataList.forEach((shelfInfo, index) => {
            let parentId = null;
            
            if (shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0) {
                // Find the parent graph node from logical_path
                const parentPathStr = shelfInfo.data.logical_path.join('/');
                parentId = graphNodeMap[parentPathStr];
            }

            newElements.push({
                data: {
                    ...shelfInfo.data,
                    parent: parentId,
                    type: 'shelf'
                },
                classes: shelfInfo.classes,
                position: { x: 200 + index * 50, y: 200 + index * 50 }
            });
        });
    } else {
        // No logical topology - create synthetic root for orphaned nodes
        const syntheticRootId = 'synthetic_root';
        newElements.push({
            data: {
                id: syntheticRootId,
                label: 'Unassigned Nodes',
                type: 'graph',
                template_name: 'synthetic_root',
                depth: 0
            },
            classes: 'graph synthetic-root'
        });

        // Add all shelves under synthetic root
        shelfDataList.forEach((shelfInfo, index) => {
            newElements.push({
                data: {
                    ...shelfInfo.data,
                    parent: syntheticRootId,
                    type: 'shelf'
                },
                classes: shelfInfo.classes,
                position: { x: 200 + index * 50, y: 200 + index * 50 }
            });
        });
    }

    // Re-create trays and ports for each shelf with updated location info
    trayPortData.forEach(trayInfo => {
        // Find the shelf this tray belongs to and get its location data
        const parentShelf = newElements.find(el => el.data && el.data.id === trayInfo.shelf_id && el.data.type === 'shelf');
        
        // Add tray node with all preserved data plus location info from parent shelf
        const trayData = {...trayInfo.tray_data};
        trayData.parent = trayInfo.shelf_id;  // Update parent to match new structure
        
        // Inherit location data from parent shelf
        if (parentShelf && parentShelf.data) {
            if (parentShelf.data.hall) trayData.hall = parentShelf.data.hall;
            if (parentShelf.data.aisle) trayData.aisle = parentShelf.data.aisle;
            if (parentShelf.data.rack_num !== undefined) trayData.rack_num = parentShelf.data.rack_num;
            if (parentShelf.data.shelf_u !== undefined) trayData.shelf_u = parentShelf.data.shelf_u;
        }
        
        newElements.push({
            data: trayData,
            classes: trayInfo.tray_classes,
            position: trayInfo.tray_position
        });

        // Add port nodes with all preserved data plus location info
        trayInfo.ports.forEach(portInfo => {
            const portData = {...portInfo.data};
            
            // Inherit location data from parent shelf
            if (parentShelf && parentShelf.data) {
                if (parentShelf.data.hall) portData.hall = parentShelf.data.hall;
                if (parentShelf.data.aisle) portData.aisle = parentShelf.data.aisle;
                if (parentShelf.data.rack_num !== undefined) portData.rack_num = parentShelf.data.rack_num;
                if (parentShelf.data.shelf_u !== undefined) portData.shelf_u = parentShelf.data.shelf_u;
            }
            
            newElements.push({
                data: portData,
                classes: portInfo.classes,
                position: portInfo.position
            });
        });
    });

    // Re-create connections with all preserved data
    connections.forEach(conn => {
        newElements.push({
            data: conn.data,
            classes: conn.classes
        });
    });

    // Add all elements back to cytoscape
    cy.add(newElements);

    // Apply drag restrictions
    applyDragRestrictions();

    // Recolor connections for logical view (depth-based coloring)
    recolorConnectionsForLogicalView();

    // Run preset layout first
    cy.layout({ name: 'preset' }).run();

    // Then apply fcose ONLY to graph-level nodes to prevent overlap
    setTimeout(() => {
        const graphNodes = cy.nodes('[type="graph"]');
        if (graphNodes.length > 0) {
            // Verify fcose extension is available before using it
            try {
                const layout = cy.layout({
                    name: 'fcose',
                    eles: graphNodes,
                    quality: 'default',
                    randomize: false,
                    animate: true,
                    animationDuration: 500,
                    fit: false,
                    nodeDimensionsIncludeLabels: true,
                    nodeRepulsion: 4500,
                    idealEdgeLength: 200,
                    nestingFactor: 0.1,
                    gravity: 0,
                    numIter: 500,
                    stop: function () {
                        applyDragRestrictions();
                        // Update edge curve styles for hierarchy mode after layout completes
                        forceApplyCurveStyles();
                    }
                });
                if (layout) {
                    layout.run();
                } else {
                    console.warn('fcose layout extension not available, falling back to preset layout');
                    cy.layout({ name: 'preset' }).run();
                    forceApplyCurveStyles();
                }
            } catch (e) {
                console.warn('Error using fcose layout:', e.message, '- falling back to preset layout');
                cy.layout({ name: 'preset' }).run();
                forceApplyCurveStyles();
            }
        } else {
            // No graph nodes, but still update curve styles
            forceApplyCurveStyles();
        }
    }, 100);

}

/**
 * Legacy function names for backward compatibility
 * @deprecated Use hierarchy_switchMode() instead
 */
function switchToHierarchyMode() {
    hierarchy_switchMode();
}
function switchToLogicalTopologyMode() {
    hierarchy_switchMode();
}

/**
 * LOCATION MODE: Organize nodes by physical location information (racks, halls, aisles)
 */
function location_organizeNodes() {

    const shelfNodes = cy.nodes('[type="shelf"]');

    // Group shelves by rack number
    const rackGroups = new Map();

    shelfNodes.forEach(node => {
        const rackNum = node.data('rack_num');
        const hall = node.data('hall') || '';
        const aisle = node.data('aisle') || '';

        // Create rack key
        const rackKey = rackNum !== undefined && rackNum !== null ? `${hall}_${aisle}_${rackNum}` : 'no_rack';

        if (!rackGroups.has(rackKey)) {
            rackGroups.set(rackKey, []);
        }
        rackGroups.get(rackKey).push(node);
    });

    // Create or reuse rack nodes for grouping
    let rackX = LAYOUT_CONSTANTS.MIN_START_X;
    const rackSpacing = 600;

    rackGroups.forEach((shelves, rackKey) => {
        if (rackKey !== 'no_rack') {
            // Create/find rack node
            const parts = rackKey.split('_');
            const rackNum = parseInt(parts[parts.length - 1]);
            const hall = parts.length > 2 ? parts[0] : '';
            const aisle = parts.length > 2 ? parts[1] : '';

            const rackId = `rack_${rackKey}`;
            let rackNode = cy.getElementById(rackId);

            if (rackNode.length === 0) {
                // Create new rack node
                cy.add({
                    group: 'nodes',
                    data: {
                        id: rackId,
                        label: `Rack ${rackNum} (${hall}-${aisle})`,
                        type: 'rack',
                        rack_num: rackNum,
                        hall: hall,
                        aisle: aisle
                    },
                    classes: 'rack',
                    position: { x: rackX, y: LAYOUT_CONSTANTS.MIN_START_Y }
                });
                rackNode = cy.getElementById(rackId);
            }

            // Move shelves into this rack
            shelves.forEach(shelf => {
                shelf.move({ parent: rackId });
            });

            rackX += rackSpacing;
        } else {
            // No rack info - arrange standalone
            shelves.forEach((shelf, idx) => {
                shelf.move({ parent: null });
                shelf.position({
                    x: LAYOUT_CONSTANTS.MIN_START_X + (idx % 3) * 500,
                    y: LAYOUT_CONSTANTS.MIN_START_Y + Math.floor(idx / 3) * 400
                });
            });
        }
    });

    // Run reset layout to properly arrange the racks
    setTimeout(() => {
        resetLayout();
    }, 100);
}

/**
 * Organize nodes in a simple grid when no location info is available
 */
function organizeInGrid() {

    const shelfNodes = cy.nodes('[type="shelf"]');
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
    cy.fit(null, 50);
}

// Node configurations - now loaded from server-side to ensure consistency
// This will be populated from window.SERVER_NODE_CONFIGS injected by the server
let NODE_CONFIGS = {};

// Initialize NODE_CONFIGS from server-side data
function initializeNodeConfigs() {
    if (window.SERVER_NODE_CONFIGS && Object.keys(window.SERVER_NODE_CONFIGS).length > 0) {
        NODE_CONFIGS = window.SERVER_NODE_CONFIGS;
        console.log('Node configurations loaded from server:', NODE_CONFIGS);
    } else {
        // Fallback to hardcoded configs if server data is not available
        NODE_CONFIGS = {
            'N300_LB': { tray_count: 4, ports_per_tray: 2, tray_layout: 'horizontal' },
            'N300_QB': { tray_count: 4, ports_per_tray: 2, tray_layout: 'horizontal' },
            'WH_GALAXY': { tray_count: 4, ports_per_tray: 6, tray_layout: 'vertical' },
            'BH_GALAXY': { tray_count: 4, ports_per_tray: 14, tray_layout: 'vertical' },
            'P150_QB_GLOBAL': { tray_count: 4, ports_per_tray: 4, tray_layout: 'horizontal' },
            'P150_QB_AMERICA': { tray_count: 4, ports_per_tray: 4, tray_layout: 'horizontal' },
            'P150_LB': { tray_count: 8, ports_per_tray: 4, tray_layout: 'horizontal' }
        };
        console.warn('Using fallback node configurations - server configs not available');
    }
}

function getNextConnectionNumber() {
    if (!cy) return 0;

    // Get all existing edges and find the highest connection number
    const allEdges = cy.edges();
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
            // TODO: seeing discrepancies in the channel mapping for BH_GALAXY. Need to verify with team.
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

    // Enable button if we're in editing mode AND have either a selected connection or deletable node
    const hasConnection = selectedConnection && selectedConnection.length > 0;
    const hasNode = selectedNode && selectedNode.length > 0;

    let isDeletable = false;
    if (hasNode) {
        const nodeType = selectedNode.data('type');
        isDeletable = ['shelf', 'rack', 'graph'].includes(nodeType);
    }

    if (isEdgeCreationMode && (hasConnection || isDeletable)) {
        deleteBtn.disabled = false;
        deleteBtn.style.opacity = '1';
        deleteBtn.style.cursor = 'pointer';
    } else {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.5';
        deleteBtn.style.cursor = 'not-allowed';
    }
}

// Kept for backward compatibility - now just calls updateDeleteButtonState
function updateDeleteNodeButtonState() {
    updateDeleteButtonState();
}

// ===== Utility Functions =====

/**
 * Format rack and shelf_u numbers with zero-padding
 */
function formatRackNum(rackNum) {
    return rackNum !== undefined && rackNum !== null ? rackNum.toString().padStart(2, '0') : '';
}

function formatShelfU(shelfU) {
    return shelfU !== undefined && shelfU !== null ? shelfU.toString().padStart(2, '0') : '';
}

/**
 * Build hierarchical location label from location components
 * @param {string} hall - Hall identifier
 * @param {string} aisle - Aisle identifier
 * @param {number|string} rackNum - Rack number
 * @param {number|string} shelfU - Shelf U position (optional)
 * @returns {string} Formatted location label (e.g., "H1A205" or "H1A205U12")
 */
function location_buildLabel(hall, aisle, rackNum, shelfU = null) {
    if (!hall || !aisle || rackNum === undefined || rackNum === null) {
        return '';
    }

    const rackPadded = formatRackNum(rackNum);
    const label = `${hall}${aisle}${rackPadded}`;

    if (shelfU !== null && shelfU !== undefined && shelfU !== '') {
        const shelfUPadded = formatShelfU(shelfU);
        return `${label}U${shelfUPadded}`;
    }

    return label;
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
function getNodeDisplayLabel(nodeData) {
    // Priority 1: Hostname
    if (nodeData.hostname) {
        return nodeData.hostname;
    }

    // Priority 2: Location format (Hall-Aisle-Rack-ShelfU)
    if (nodeData.hall && nodeData.aisle && nodeData.rack_num !== undefined) {
        const shelfU = nodeData.shelf_u;
        if (shelfU !== undefined && shelfU !== null && shelfU !== '') {
            return location_buildLabel(nodeData.hall, nodeData.aisle, nodeData.rack_num, shelfU);
        } else {
            return location_buildLabel(nodeData.hall, nodeData.aisle, nodeData.rack_num);
        }
    }

    // Priority 3: Type-specific labels
    if (nodeData.type === 'shelf' && nodeData.shelf_u !== undefined) {
        return `Shelf ${nodeData.shelf_u}`;
    }

    // Priority 4: Existing label
    if (nodeData.label) {
        return nodeData.label;
    }

    // Priority 5: Fallback to ID
    return nodeData.id;
}

/**
 * Build hierarchical path for a node (for descriptor/textproto imports)
 * @param {Object} node - Cytoscape node
 * @returns {string} Hierarchical path (e.g., "superpod1 > node2 > shelf")
 */
function hierarchy_getPath(node) {
    const path = [];
    let currentNode = node;

    // Traverse up the parent hierarchy
    while (currentNode && currentNode.length > 0) {
        const data = currentNode.data();
        const nodeType = data.type;

        // Only include graph nodes and shelf nodes in the path
        // Skip tray and port levels for cleaner display
        if (nodeType === 'graph' || nodeType === 'shelf') {
            // For shelf nodes, use a more descriptive label
            if (nodeType === 'shelf') {
                const label = data.label || data.id;
                // Extract just the meaningful part (e.g., "node1 (host_0)" or hostname)
                path.unshift(label);
            } else if (nodeType === 'graph') {
                // For graph nodes, use just the label (e.g., "superpod1", "node1")
                const label = data.label || data.id;
                // Remove "graph_" prefix if present for cleaner display
                const cleanLabel = label.replace(/^graph_/, '');
                path.unshift(cleanLabel);
            }
        }

        // Move to parent
        currentNode = currentNode.parent();
    }

    return path.join(' > ');
}

// ===== Event Handler Helpers =====

/**
 * Handle port click in editing mode
 */
function handlePortClickEditMode(node, evt) {
    const portId = node.id();
    const existingConnections = cy.edges(`[source="${portId}"], [target="${portId}"]`);

    // If port is already connected, select the connection
    if (existingConnections.length > 0) {
        const edge = existingConnections[0]; // Only one connection per port

        // Clear source port selection if any
        if (sourcePort) {
            sourcePort.removeClass('source-selected');
            sourcePort = null;
        }

        // Select this connection
        if (selectedConnection) {
            selectedConnection.removeClass('selected-connection');
        }
        selectedConnection = edge;
        edge.addClass('selected-connection');

        // Show port info and update UI
        showNodeInfo(node, evt.renderedPosition || evt.position);
        updateDeleteButtonState();
        return;
    }

    // Port is unconnected - handle connection creation
    if (!sourcePort) {
        // First click - select source port
        sourcePort = node;
        sourcePort.addClass('source-selected');
    } else {
        // Second click - create connection
        const targetPort = node;

        // Can't connect port to itself
        if (sourcePort.id() === targetPort.id()) {
            sourcePort.removeClass('source-selected');
            sourcePort = null;
            return;
        }

        // Create the connection
        createConnection(sourcePort.id(), targetPort.id());

        // Clear source port selection
        sourcePort.removeClass('source-selected');
        sourcePort = null;
    }
}

/**
 * Handle port click in view mode (not editing)
 */
function handlePortClickViewMode(node, evt) {
    const portId = node.id();
    const connectedEdges = cy.edges(`[source="${portId}"], [target="${portId}"]`);

    if (connectedEdges.length > 0) {
        // Port has connection - select it
        const edge = connectedEdges[0]; // Only one connection per port

        if (selectedConnection) {
            selectedConnection.removeClass('selected-connection');
        }

        selectedConnection = edge;
        edge.addClass('selected-connection');
        showNodeInfo(node, evt.renderedPosition || evt.position);
    } else {
        // Port has no connection - just show info
        if (selectedConnection) {
            selectedConnection.removeClass('selected-connection');
            selectedConnection = null;
            updateDeleteButtonState();
        }
        showNodeInfo(node, evt.renderedPosition || evt.position);
    }
}

/**
 * Clear all selection state
 */
function clearAllSelections() {
    hideNodeInfo();
    
    // Clear isEditing flag from all nodes
    if (cy) {
        cy.nodes().forEach(function (n) {
            if (n.data('isEditing')) {
                n.data('isEditing', false);
            }
        });
    }

    if (sourcePort) {
        sourcePort.removeClass('source-selected');
        sourcePort = null;
    }

    if (selectedConnection) {
        selectedConnection.removeClass('selected-connection');
        selectedConnection = null;
        updateDeleteButtonState();
    }

    if (selectedNode) {
        selectedNode.removeClass('selected-node');
        selectedNode = null;
        updateDeleteNodeButtonState();
    }
}

// ===== End Event Handler Helpers =====

function getPortLocationInfo(portNode) {
    /**
     * Build detailed location string for a port
     * Always shows the full path regardless of collapsed state
     * @param {Object} portNode - Cytoscape port node
     * @returns {String} Formatted location string
     */
    const portLabel = portNode.data('label');
    const trayNode = portNode.parent();
    const shelfNode = trayNode.parent();

    // Get location data from the hierarchy
    const hostname = shelfNode.data('hostname') || '';
    const hall = shelfNode.data('hall') || '';
    const aisle = shelfNode.data('aisle') || '';
    const rackNum = shelfNode.data('rack_num');
    const shelfU = shelfNode.data('shelf_u');
    const trayLabel = trayNode.data('label');

    // Build location string
    let locationParts = [];

    // Prefer location format (Hall-Aisle-Rack-Shelf) as default
    if (hall && aisle && rackNum !== undefined && shelfU !== undefined) {
        // Use location format: HallAisle##U##
        locationParts.push(location_buildLabel(hall, aisle, rackNum, shelfU));
    } else if (hostname) {
        // Fallback to hostname if location info is unavailable
        locationParts.push(hostname);
    } else if (shelfNode.data('label')) {
        // Final fallback to shelf label
        locationParts.push(shelfNode.data('label'));
    }

    // Always add tray and port info - do NOT simplify based on collapsed state
    locationParts.push(trayLabel);
    locationParts.push(portLabel);

    return locationParts.join(' › ');
}

function deleteSelectedConnection() {
    if (!selectedConnection || selectedConnection.length === 0) {
        alert('Please select a connection first by clicking on it.');
        return;
    }

    const edge = selectedConnection;

    // Check if edge still exists and is valid
    if (!edge || !edge.cy() || edge.removed()) {
        alert('Selected connection is no longer valid.');
        selectedConnection = null;
        updateDeleteButtonState();
        return;
    }

    const sourceNode = cy.getElementById(edge.data('source'));
    const targetNode = cy.getElementById(edge.data('target'));

    const sourceInfo = getPortLocationInfo(sourceNode);
    const targetInfo = getPortLocationInfo(targetNode);

    let message = `Delete connection between:\n\nSource: ${sourceInfo}\n\nTarget: ${targetInfo}`;

    // Determine if this is a template-level connection
    const edgeTemplateName = edge.data('template_name');
    let isTemplateConnection = false;
    
    if (edgeTemplateName) {
        // If template_name is defined, this connection is part of a template
        // and should be deleted from all instances of that template
        isTemplateConnection = true;
        
        // Count how many instances will be affected (including empty ones)
        const templateGraphs = cy.nodes().filter(node =>
            node.data('type') === 'graph' && node.data('template_name') === edgeTemplateName
        );
        
        message += `\n\n⚠️ Template-Level Connection`;
        message += `\nThis connection is defined in template "${edgeTemplateName}".`;
        message += `\nDeleting will remove it from ALL ${templateGraphs.length} instance(s) of this template.`;
    }

    if (confirm(message)) {
        if (isTemplateConnection) {
            // Template-level deletion: Remove from all instances
            deleteConnectionFromAllTemplateInstances(edge, edgeTemplateName);
        } else {
            // Single connection deletion
            edge.remove();
        }

        selectedConnection = null;
        updateDeleteButtonState();
        updatePortConnectionStatus();
        updatePortEditingHighlight();
    }
}

/**
 * Delete a connection from all instances of its template
 * Used when deleting template-level connections (where template_name matches closest common ancestor)
 */
function deleteConnectionFromAllTemplateInstances(edge, templateName) {
    // Get connection pattern (relative to the template)
    const sourcePort = cy.getElementById(edge.data('source'));
    const targetPort = cy.getElementById(edge.data('target'));

    if (!sourcePort.length || !targetPort.length) {
        console.warn('Source or target port not found');
        edge.remove();
        return;
    }

    // Find all graph nodes with the same template (including empty ones)
    const templateGraphs = cy.nodes().filter(node =>
        node.data('type') === 'graph' && node.data('template_name') === templateName
    );

    if (templateGraphs.length === 0) {
        console.warn('No template instances found');
        edge.remove();
        return;
    }

    // Find which instance contains the ports we're deleting
    let sourceInstance = null;
    for (const graph of templateGraphs) {
        if (sourcePort.ancestors().filter(n => n.id() === graph.id()).length > 0) {
            sourceInstance = graph;
            break;
        }
    }

    if (!sourceInstance) {
        console.warn('Could not find instance containing the ports');
        edge.remove();
        return;
    }

    // Extract pattern ONCE relative to the instance that contains the ports
    const sourcePattern = extractPortPattern(sourcePort, sourceInstance);
    const targetPattern = extractPortPattern(targetPort, sourceInstance);

    console.log(`[deleteConnectionFromAllTemplateInstances] Pattern from ${sourceInstance.id()}:`);
    console.log(`[deleteConnectionFromAllTemplateInstances]   sourcePattern:`, sourcePattern);
    console.log(`[deleteConnectionFromAllTemplateInstances]   targetPattern:`, targetPattern);

    if (!sourcePattern || !targetPattern) {
        console.warn('Could not extract port patterns');
        edge.remove();
        return;
    }

    let deletedCount = 0;

    // Apply the SAME pattern to ALL instances
    templateGraphs.forEach(graph => {
        // Find the specific ports in this instance by following the SAME path
        const sourcePortNode = findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
        const targetPortNode = findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

        if (!sourcePortNode || !targetPortNode) {
            // Ports don't exist in this instance - skip
            console.log(`[deleteConnectionFromAllTemplateInstances] Ports not found in instance ${graph.id()}, skipping`);
            return;
        }

        // Find matching edge
        const matchingEdges = cy.edges().filter(e =>
            (e.data('source') === sourcePortNode.id() && e.data('target') === targetPortNode.id()) ||
            (e.data('source') === targetPortNode.id() && e.data('target') === sourcePortNode.id())
        );

        if (matchingEdges.length > 0) {
            console.log(`[deleteConnectionFromAllTemplateInstances] Deleting ${matchingEdges.length} connection(s) from instance ${graph.id()}`);
            matchingEdges.remove();
            deletedCount++;
        } else {
            console.log(`[deleteConnectionFromAllTemplateInstances] No matching connection in instance ${graph.id()}`);
        }
    });

    console.log(`Deleted ${deletedCount} connection(s) from template "${templateName}"`);
}

/**
 * Update a parent template definition to include a new child graph
 * @param {string} parentTemplateName - The parent template to update
 * @param {string} childTemplateName - The child template to add
 * @param {string} childLabel - The label/name for the child in the template
 */
function updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel) {

    // Update availableGraphTemplates
    if (availableGraphTemplates[parentTemplateName]) {
        const parentTemplate = availableGraphTemplates[parentTemplateName];

        // Initialize children array if it doesn't exist
        if (!parentTemplate.children) {
            parentTemplate.children = [];
        }

        // Add the new child
        parentTemplate.children.push({
            name: childLabel,
            type: 'graph',
            graph_template: childTemplateName
        });

    }

    // Update currentData.metadata.graph_templates if it exists (for export)
    if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const parentTemplate = currentData.metadata.graph_templates[parentTemplateName];
        if (parentTemplate) {
            // Initialize children array if it doesn't exist
            if (!parentTemplate.children) {
                parentTemplate.children = [];
            }

            // Add the new child
            parentTemplate.children.push({
                name: childLabel,
                type: 'graph',
                graph_template: childTemplateName
            });

        }
    }
}

/**
 * Recalculate host_indices for all template instances to ensure siblings have consecutive numbering.
 * This makes it easier to export cabling_descriptor and have associated host_indices.
 * 
 * Strategy:
 * 1. Group all shelf nodes by their parent graph instance
 * 2. Within each instance, sort siblings by child_name
 * 3. Assign consecutive host_indices starting from 0 for each instance
 * 4. Update globalHostCounter to reflect the new maximum
 */
function recalculateHostIndicesForTemplates() {
    console.log('Recalculating host_indices for template instances...');
    
    // Get all graph nodes (template instances)
    const graphNodes = cy.nodes('[type="graph"]');
    
    // Track the global host_index counter
    let nextHostIndex = 0;
    
    // For each graph node, renumber its shelf children
    graphNodes.forEach(graphNode => {
        // Get all shelf children of this graph node
        const shelfChildren = graphNode.children('[type="shelf"]');
        
        if (shelfChildren.length === 0) {
            return; // No shelf children, skip
        }
        
        // Sort siblings by child_name to maintain consistent ordering
        const sortedShelves = shelfChildren.toArray().sort((a, b) => {
            const childNameA = a.data('child_name') || a.data('label');
            const childNameB = b.data('child_name') || b.data('label');
            return childNameA.localeCompare(childNameB);
        });
        
        // Assign consecutive host_indices to siblings
        sortedShelves.forEach(shelfNode => {
            const oldHostIndex = shelfNode.data('host_index');
            const newHostIndex = nextHostIndex;
            nextHostIndex++;
            
            // Update shelf node
            shelfNode.data('host_index', newHostIndex);
            
            // Update label to reflect new host_index
            const childName = shelfNode.data('child_name') || 'node';
            const newLabel = `${childName} (host_${newHostIndex})`;
            shelfNode.data('label', newLabel);
            
            // Update all child tray and port nodes with new host_index
            const trayChildren = shelfNode.children('[type="tray"]');
            trayChildren.forEach(trayNode => {
                trayNode.data('host_index', newHostIndex);
                
                const portChildren = trayNode.children('[type="port"]');
                portChildren.forEach(portNode => {
                    portNode.data('host_index', newHostIndex);
                });
            });
            
            if (oldHostIndex !== newHostIndex) {
                console.log(`  Updated ${shelfNode.id()}: host_${oldHostIndex} -> host_${newHostIndex}`);
            }
        });
    });
    
    // Update globalHostCounter to the next available index
    globalHostCounter = nextHostIndex;
    console.log(`Recalculation complete. Next available host_index: ${globalHostCounter}`);
}

/**
 * Delete a child graph from all instances of its parent template
 * @param {string} childName - The name of the child to remove
 * @param {string} parentTemplateName - The parent template name
 * @param {string} childTemplateName - The child's template name (for verification)
 */
function deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName) {

    // Find all instances of the parent template (including empty ones)
    const parentTemplateInstances = cy.nodes().filter(node =>
        node.data('type') === 'graph' &&
        node.data('template_name') === parentTemplateName
    );


    let deletedCount = 0;

    // For each parent instance, find and delete the matching child graph
    parentTemplateInstances.forEach(parentInstance => {
        const parentId = parentInstance.id();
        const parentLabel = parentInstance.data('label');

        // Find child graphs with matching child_name or label (including empty ones)
        const childGraphs = parentInstance.children().filter(child =>
            child.data('type') === 'graph' &&
            (child.data('child_name') === childName || child.data('label') === childName)
        );

        if (childGraphs.length > 0) {
            childGraphs.forEach(childGraph => {
                childGraph.remove(); // This will also remove all descendants
                deletedCount++;
            });
        } else {
        }
    });

    console.log(`Deleted child graph from ${deletedCount} template instance(s)`);

    // Update template definition in availableGraphTemplates
    if (availableGraphTemplates[parentTemplateName]) {
        const parentTemplate = availableGraphTemplates[parentTemplateName];
        if (parentTemplate.children) {
            // Remove the child from the template definition
            parentTemplate.children = parentTemplate.children.filter(child =>
                child.name !== childName
            );
        }
        
        // Remove connections that reference the deleted child graph
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
                console.log(`Removed ${removedConnections} connection(s) referencing deleted child graph "${childName}" from availableGraphTemplates["${parentTemplateName}"]`);
            }
        }
    }

    // Update template definition in metadata
    if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const parentTemplate = currentData.metadata.graph_templates[parentTemplateName];
        if (parentTemplate && parentTemplate.children) {
            // Remove the child from the template definition
            parentTemplate.children = parentTemplate.children.filter(child =>
                child.name !== childName
            );
            
            // Remove connections that reference the deleted child graph
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
                    console.log(`Removed ${removedConnections} connection(s) referencing deleted child graph "${childName}" from metadata graph_templates["${parentTemplateName}"]`);
                }
            }
        }
    }
}

/**
 * Delete a child node (shelf/rack) from all instances of its parent template
 * @param {string} childName - The name of the child to remove
 * @param {string} parentTemplateName - The parent template name
 * @param {string} childType - The type of child node ('shelf' or 'rack')
 */
function deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, childType) {

    // Find all instances of the parent template (including empty ones)
    const parentTemplateInstances = cy.nodes().filter(node =>
        node.data('type') === 'graph' &&
        node.data('template_name') === parentTemplateName
    );


    let deletedCount = 0;

    // For each parent instance, find and delete the matching child node
    parentTemplateInstances.forEach(parentInstance => {
        const parentLabel = parentInstance.data('label');

        // Find descendant nodes with matching child_name or label and type
        const childNodes = parentInstance.descendants().filter(child =>
            child.data('type') === childType &&
            (child.data('child_name') === childName || child.data('label') === childName)
        );

        if (childNodes.length > 0) {
            childNodes.forEach(childNode => {
                childNode.remove(); // This will also remove all descendants (trays, ports, etc.)
                deletedCount++;
            });
        } else {
        }
    });

    console.log(`Deleted ${childType} from ${deletedCount} template instance(s)`);

    // Update template definition in availableGraphTemplates
    if (availableGraphTemplates[parentTemplateName]) {
        const parentTemplate = availableGraphTemplates[parentTemplateName];
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
                console.log(`Removed ${removedConnections} connection(s) referencing deleted ${childType} "${childName}" from availableGraphTemplates["${parentTemplateName}"]`);
            }
        }
    }

    // Update template definition in metadata
    if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const parentTemplate = currentData.metadata.graph_templates[parentTemplateName];
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
 * Otherwise, returns just the shelf name (legacy behavior).
 */
function extractPortPattern(portNode, placementLevel = null) {
    if (!portNode || portNode.data('type') !== 'port') {
        return null;
    }

    const portId = portNode.id();

    // Find parent shelf
    let current = portNode.parent();
    let shelf = null;
    while (current && current.length > 0) {
        if (current.data('type') === 'shelf') {
            shelf = current;
            break;
        }
        current = current.parent();
    }
    
    if (!shelf) {
        return null;
    }

    // Extract tray and port numbers from port ID
    // Expected format: {shelfId}-tray{trayNum}-port{portNum}
    const match = portId.match(/-tray(\d+)-port(\d+)$/);
    if (!match) {
        return null;
    }
    
    const trayId = parseInt(match[1]);
    const portIdNum = parseInt(match[2]);

    // If no placement level specified, return legacy format (just shelf name)
    if (!placementLevel) {
        const shelfName = shelf.data('child_name') || shelf.data('label');
        return {
            shelfName: shelfName,
            trayId: trayId,
            portId: portIdNum
        };
    }

    // Build hierarchical path from placement level to shelf
    const path = [];
    current = shelf;
    
    // Walk up the hierarchy until we reach the placement level
    while (current && current.length > 0 && current.id() !== placementLevel.id()) {
        const nodeName = current.data('child_name') || current.data('logical_child_name') || current.data('label');
        if (nodeName) {
            path.unshift(nodeName); // Add to beginning to maintain top-down order
        }
        current = current.parent();
    }
    
    // If we didn't reach the placement level, the port is not a descendant
    if (!current || current.length === 0 || current.id() !== placementLevel.id()) {
        console.warn(`[extractPortPattern] Port ${portId} is not a descendant of placement level ${placementLevel.id()}`);
        return null;
    }

    const result = {
        path: path,
        trayId: trayId,
        portId: portIdNum
    };
    
    console.log(`[extractPortPattern] Extracted pattern from ${placementLevel.id()}: path=${JSON.stringify(path)}, tray=${trayId}, port=${portIdNum}`);
    
    return result;
}

/**
 * Find the common ancestor graph node for two nodes
 * Returns the lowest common ancestor that is a graph node, or null
 */
function findCommonAncestorGraph(node1, node2) {
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

/**
 * Enumerate all possible placement levels for a connection between two ports
 * Returns array of placement options from closest common parent to root
 * Each option includes the graph node, template name, depth, and duplication count
 * Filters out levels where connections already exist
 */
function enumeratePlacementLevels(sourcePort, targetPort) {
    const placementLevels = [];
    
    // Find closest common ancestor that is NOT a shelf node
    const sourceShelf = getParentAtLevel(sourcePort, 2);  // Port -> Tray -> Shelf
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
            const isAvailable = isPlacementLevelAvailable(sourcePort, targetPort, graphNode, template_name, sourceShelf, targetShelf);
            
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
function findPortByPath(graphNode, path, trayId, portId) {
    let current = graphNode;
    
    // Follow the path through the hierarchy
    for (let i = 0; i < path.length; i++) {
        const nodeName = path[i];
        
        // Find child with matching name
        const children = current.children();
        const matchingChild = children.filter(child => {
            const childName = child.data('child_name') || child.data('logical_child_name') || child.data('label');
            return childName === nodeName;
        });
        
        if (matchingChild.length === 0) {
            console.warn(`[findPortByPath] Could not find child "${nodeName}" in ${current.id()}`);
            return null;
        }
        
        current = matchingChild[0];
    }
    
    // Current should now be the shelf node
    if (current.data('type') !== 'shelf') {
        console.warn(`[findPortByPath] Expected shelf node, got ${current.data('type')}`);
        return null;
    }
    
    // Find the port within this shelf
    const portNodeId = `${current.id()}-tray${trayId}-port${portId}`;
    const portNode = cy.getElementById(portNodeId);
    
    if (!portNode || portNode.length === 0) {
        console.warn(`[findPortByPath] Could not find port ${portNodeId}`);
        return null;
    }
    
    return portNode;
}

/**
 * Check if a placement level is available (no existing connections would conflict)
 * 
 * For template-level: Available ONLY if ALL instances of the PLACEMENT template have both ports free
 * For instance-specific: Available if THESE SPECIFIC ports are free
 * 
 * @param {Object} sourcePort - Source port node
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
    console.log(`[isPlacementLevelAvailable] sourcePort: ${sourcePort.id()}, targetPort: ${targetPort.id()}`);
    console.log(`[isPlacementLevelAvailable] sourceShelf: ${sourceShelf.id()}, targetShelf: ${targetShelf.id()}`);
    
    if (isTemplateLevel) {
        // Template-level: Available ONLY if ALL instances of the placement template have both ports free
        
        // First, extract the pattern relative to the PLACEMENT LEVEL
        // This gives us the template-relative pattern that should exist in all instances
        const sourcePattern = extractPortPattern(sourcePort, placementGraphNode);
        const targetPattern = extractPortPattern(targetPort, placementGraphNode);
        
        console.log(`[isPlacementLevelAvailable] Template pattern from ${placementGraphNode.id()}:`);
        console.log(`[isPlacementLevelAvailable]   sourcePattern:`, sourcePattern);
        console.log(`[isPlacementLevelAvailable]   targetPattern:`, targetPattern);
        
        if (!sourcePattern || !targetPattern) {
            // Ports are not descendants of the placement level
            console.warn(`[isPlacementLevelAvailable] Ports not descendants of placement level ${placementGraphNode.id()}`);
            return false;
        }
        
        // Find all instances of the PLACEMENT template (including empty ones)
        const templateGraphs = cy.nodes().filter(node =>
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
            const srcPort = findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
            const tgtPort = findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);
            
            if (!srcPort || !tgtPort) {
                // Ports don't exist in this instance - this means the template structure is inconsistent
                // Block this level as we can't apply the pattern to all instances
                console.log(`[isPlacementLevelAvailable] Template-level: Ports not found in instance ${graph.id()} - blocking level`);
                return false;
            }
            
            // Check if either port has ANY connection in this instance
            const srcPortConnections = cy.edges().filter(e =>
                e.data('source') === srcPort.id() || e.data('target') === srcPort.id()
            );
            const tgtPortConnections = cy.edges().filter(e =>
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
        const sourceId = sourcePort.id();
        const targetId = targetPort.id();
        
        const sourceConnections = cy.edges().filter(e =>
            e.data('source') === sourceId || e.data('target') === sourceId
        );
        const targetConnections = cy.edges().filter(e =>
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
 *   - Count = 1
 */
function calculateDuplicationCount(graphNode, sourceShelf, targetShelf) {
    // Get the template name of this placement level
    const placementTemplateName = graphNode.data('template_name');
    
    // Find the closest common ancestor
    const closestAncestor = findCommonAncestorGraph(sourceShelf, targetShelf);
    const closestTemplateName = closestAncestor ? closestAncestor.data('template_name') : null;
    
    // If placement level matches closest ancestor = template-level connection
    if (closestTemplateName && placementTemplateName === closestTemplateName) {
        // Count how many instances of this template exist (including empty ones)
        const templateInstances = cy.nodes().filter(node =>
            node.data('type') === 'graph' && node.data('template_name') === placementTemplateName
        );
        return templateInstances.length;
    } else {
        // Instance-specific connection (higher level with full paths)
        return 1;
    }
}

function deleteSelectedNode() {
    if (!selectedNode || selectedNode.length === 0) {
        alert('Please select a node first by clicking on it.');
        return;
    }

    const node = selectedNode;
    const nodeType = node.data('type');
    const nodeLabel = node.data('label') || node.id();

    // Check if node type is deletable
    if (!['shelf', 'rack', 'graph'].includes(nodeType)) {
        alert('Only shelf, rack, and graph nodes can be deleted directly.\nPorts and trays are deleted automatically with their parent shelf.');
        return;
    }

    // Check if this is a child of a template instance (hierarchy mode)
    const visualizationMode = getVisualizationMode();
    const hasParent = node.parent().length > 0;
    const parentNode = hasParent ? node.parent() : null;
    const childName = node.data('child_name') || nodeLabel;

    // For shelf nodes, find the graph template they belong to
    let parentTemplateName = null;
    let isTemplateChild = false;

    if (visualizationMode === 'hierarchy' && hasParent) {
        if (nodeType === 'graph' && parentNode.data('type') === 'graph') {
            // Child graph of a graph template
            parentTemplateName = parentNode.data('template_name');
            isTemplateChild = !!parentTemplateName;
        } else if (nodeType === 'shelf') {
            // Shelf node - find its parent graph template
            let graphParent = parentNode;
            while (graphParent && graphParent.length > 0) {
                if (graphParent.data('type') === 'graph' && graphParent.data('template_name')) {
                    parentTemplateName = graphParent.data('template_name');
                    isTemplateChild = true;
                    break;
                }
                graphParent = graphParent.parent();
            }
        }
    }

    // Build description for confirmation
    let message = `Delete ${nodeType}: "${nodeLabel}"`;

    // Count children for compound nodes
    if (node.isParent()) {
        const descendants = node.descendants();
        const childCount = descendants.length;
        const connectedEdges = descendants.connectedEdges();
        const edgeCount = connectedEdges.length;

        message += `\n\nThis will also delete:`;
        message += `\n  • ${childCount} child node(s)`;
        if (edgeCount > 0) {
            message += `\n  • ${edgeCount} connection(s)`;
        }
    } else {
        // Check for connected edges
        const connectedEdges = node.connectedEdges();
        if (connectedEdges.length > 0) {
            message += `\n\nThis will also delete ${connectedEdges.length} connection(s)`;
        }
    }

    // Add warning for template-level deletion
    if (isTemplateChild) {
        message += `\n\n⚠️ This ${nodeType} belongs to template "${parentTemplateName}".`;
        message += `\nDeleting it will remove this ${nodeType} from ALL instances of this template.`;
    }

    message += '\n\nThis action cannot be undone.';

    if (confirm(message)) {
        if (isTemplateChild) {
            // Template-level deletion: Remove from all instances
            if (nodeType === 'graph') {
                deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, node.data('template_name'));
            } else if (nodeType === 'shelf') {
                deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, 'shelf');
            }
            
            // Recalculate host_indices after template-level deletion
            if (visualizationMode === 'hierarchy') {
                recalculateHostIndicesForTemplates();
            }
        } else {
            // Check if deleting the original root before removal
            const nodeId = node.id();
            const isOriginalRoot = currentData && currentData.metadata &&
                currentData.metadata.initialRootId === nodeId;

            // If it's a compound node, Cytoscape will automatically remove all descendants
            node.remove();

            // Track original root deletion for export optimization
            if (isOriginalRoot && currentData && currentData.metadata) {
                currentData.metadata.hasTopLevelAdditions = true;
                console.log(`Original root deleted - flagging export to use synthetic root`);
            }

            console.log(`Deleted ${nodeType} node: ${nodeLabel}`);
            
            // Recalculate host_indices after instance-specific deletion in hierarchy mode
            if (visualizationMode === 'hierarchy' && nodeType === 'shelf') {
                recalculateHostIndicesForTemplates();
            }
        }

        selectedNode = null;
        updateDeleteNodeButtonState();
        updatePortConnectionStatus();
        updatePortEditingHighlight();

        // Update node filter dropdown if it exists
        if (typeof populateNodeFilterDropdown === 'function') {
            populateNodeFilterDropdown();
        }
    }
}

function deleteSelectedElement() {
    /**
     * Combined delete function that deletes either a selected connection or node.
     * Priority: Connection first, then node.
     */
    if (selectedConnection && selectedConnection.length > 0) {
        deleteSelectedConnection();
    } else if (selectedNode && selectedNode.length > 0) {
        deleteSelectedNode();
    } else {
        alert('Please select a connection or node first by clicking on it.');
    }
}

function updatePortConnectionStatus() {
    if (!cy) return;

    // Reset all ports to default state
    cy.nodes('.port').removeClass('connected-port');

    // Mark ports that have connections
    cy.edges().forEach(function (edge) {
        // Skip if edge has been removed or is invalid
        if (!edge || !edge.cy() || edge.removed()) return;

        const sourceId = edge.data('source');
        const targetId = edge.data('target');
        const sourceNode = cy.getElementById(sourceId);
        const targetNode = cy.getElementById(targetId);

        // Only add class if nodes exist and are valid
        if (sourceNode.length && !sourceNode.removed()) {
            sourceNode.addClass('connected-port');
        }
        if (targetNode.length && !targetNode.removed()) {
            targetNode.addClass('connected-port');
        }
    });
}

function createConnection(sourceId, targetId) {
    const sourceNode = cy.getElementById(sourceId);
    const targetNode = cy.getElementById(targetId);

    if (!sourceNode.length || !targetNode.length) {
        console.error('Source or target node not found');
        return;
    }

    // Check if either port already has a connection
    const sourceConnections = cy.edges(`[source="${sourceId}"], [target="${sourceId}"]`);
    const targetConnections = cy.edges(`[source="${targetId}"], [target="${targetId}"]`);

    if (sourceConnections.length > 0) {
        alert(`Cannot create connection: Source port "${sourceNode.data('label')}" is already connected.\n\nEach port can only have one connection. Please disconnect the existing connection first.`);
        return;
    }

    if (targetConnections.length > 0) {
        alert(`Cannot create connection: Target port "${targetNode.data('label')}" is already connected.\n\nEach port can only have one connection. Please disconnect the existing connection first.`);
        return;
    }

    // Check if we're in logical view and have graph hierarchy
    // If so, show placement level selection modal
    const hasGraphHierarchy = cy.nodes('[type="graph"]').length > 0;
    
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
    const modal = document.getElementById('connectionPlacementModal');
    const container = document.getElementById('placementOptionsContainer');
    
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
    
    // Add click handler to close modal when clicking outside
    modal.removeEventListener('click', handleConnectionPlacementModalClick);
    modal.addEventListener('click', handleConnectionPlacementModalClick);
    
    // Show modal
    modal.classList.add('active');
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
    const modal = document.getElementById('connectionPlacementModal');
    modal.classList.remove('active');
    modal.removeEventListener('click', handleConnectionPlacementModalClick);
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
    if (visualizationMode !== 'hierarchy') {
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
 * @returns {Array<string>} Array of hall names
 */
function parseHallNames() {
    const element = document.getElementById('hallNames');
    if (!element) return ['Building-A']; // Default fallback
    const hallNamesText = element.value || '';
    return parseList(hallNamesText);
}

/**
 * Parse aisle names/numbers
 * @returns {Array<string>} Array of aisle identifiers
 */
function parseAisleNames() {
    const element = document.getElementById('aisleNames');
    if (!element) return ['A']; // Default fallback
    const input = element.value || '';
    const result = parseFlexibleInput(input);
    
    // If empty, default to single aisle "A"
    if (result.length === 0) return ['A'];
    
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
    
    // Validate parameters
    if (hallNames.length === 0) {
        alert('Please enter at least one hall name');
        return;
    }
    if (aisleNames.length === 0) {
        alert('Please enter at least one aisle identifier');
        return;
    }
    if (rackNumbers.length === 0) {
        alert('Please enter at least one rack number');
        return;
    }
    if (shelfUnitNumbers.length === 0) {
        alert('Please enter at least one shelf unit number');
        return;
    }
    
    // Get all shelf nodes
    const shelfNodes = cy.nodes('[type="shelf"]');
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
    location_switchMode();
    
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
    // Use selected level or find common ancestor
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
    const visualizationMode = getVisualizationMode();
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
    const sourceHostname = sourceNode.data('hostname') || getParentAtLevel(sourceNode, 2)?.data('hostname') || '';
    const targetHostname = targetNode.data('hostname') || getParentAtLevel(targetNode, 2)?.data('hostname') || '';

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
            template_name: template_name,
            depth: depth
        }
    };

    cy.add(newEdge);

    // Update visuals
    updatePortConnectionStatus();
    updatePortEditingHighlight();
    setTimeout(() => forceApplyCurveStyles(), 50);
    
    // Update the connection legend after creating a connection
    if (currentData) {
        updateConnectionLegend(currentData);
    }
}

/**
 * Create a connection pattern in all instances of a template
 * Skips instances where either port is already connected
 */
function createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth) {
    // Find all instances of this template (including empty ones)
    const templateGraphs = cy.nodes().filter(node =>
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
    const sourcePattern = extractPortPattern(sourceNode, sourceInstance);
    const targetPattern = extractPortPattern(targetNode, sourceInstance);

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
        const sourcePortNode = findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
        const targetPortNode = findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

        if (!sourcePortNode || !targetPortNode) {
            // Ports don't exist in this instance - skip
            console.log(`[createConnectionInAllTemplateInstances] Ports not found in instance ${graph.id()}, skipping`);
            return;
        }

        // Check if EITHER port already has ANY connection
        const sourcePortConnections = cy.edges().filter(e =>
            e.data('source') === sourcePortNode.id() || e.data('target') === sourcePortNode.id()
        );
        const targetPortConnections = cy.edges().filter(e =>
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
        // Update availableGraphTemplates
        if (availableGraphTemplates && availableGraphTemplates[template_name]) {
            const template = availableGraphTemplates[template_name];
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
        
        // Update currentData.metadata.graph_templates if it exists (for export)
        if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
            const template = currentData.metadata.graph_templates[template_name];
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
    if (createdCount > 0 && currentData) {
        updateConnectionLegend(currentData);
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
    const addNodeText = addNodeBtn.nextElementSibling;

    if (cy && currentData) {
        // Enable the button
        addNodeBtn.disabled = false;
        addNodeBtn.style.background = '#007bff';
        addNodeBtn.style.cursor = 'pointer';
        addNodeBtn.style.opacity = '1';
        addNodeText.textContent = 'Creates a new node with trays and ports';
    } else {
        // Disable the button
        addNodeBtn.disabled = true;
        addNodeBtn.style.background = '#6c757d';
        addNodeBtn.style.cursor = 'not-allowed';
        addNodeBtn.style.opacity = '0.6';
        addNodeText.textContent = 'Upload a visualization first to enable node creation';
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
    currentData = {
        nodes: [],
        edges: [],
        elements: [],  // Empty elements array for Cytoscape
        metadata: {
            total_connections: 0,
            total_nodes: 0
        }
    };

    // Initialize Cytoscape with empty data
    initVisualization(currentData);

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
        hierarchy_calculateLayout();

        // Fit viewport to show all nodes
        cy.fit(null, 50);

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
    const racks = cy.nodes('[type="rack"]');
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
    
    // Sort racks within each aisle by rack number
    Object.keys(rackHierarchy).forEach(hall => {
        Object.keys(rackHierarchy[hall]).forEach(aisle => {
            rackHierarchy[hall][aisle].sort(function (a, b) {
                return a.rack_num - b.rack_num; // Ascending order
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
    cy.startBatch();
    positionUpdates.forEach(function (update) {
        update.node.position(update.newPos);
        
        // If this is a shelf that needs child arrangement, apply tray/port layout
        if (update.needsChildArrangement) {
            common_arrangeTraysAndPorts(update.node);
        }
    });
    cy.endBatch();

    // Force a complete refresh of the cytoscape instance
    cy.resize();
    cy.forceRender();

    // Small delay to ensure rendering is complete before fitting viewport and reapplying styles
    setTimeout(function () {
        // Apply fcose layout to prevent overlaps in location mode
        const locationNodes = cy.nodes('[type="hall"], [type="aisle"], [type="rack"]');
        if (locationNodes.length > 0) {
            try {
                const layout = cy.layout({
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
                        cy.nodes('[type="shelf"]').forEach(shelf => {
                            common_arrangeTraysAndPorts(shelf);
                        });
                        applyDragRestrictions();
                        forceApplyCurveStyles();
                        updatePortConnectionStatus();
                        
                        // Fit the view to show all nodes with padding
                        cy.fit(50);
                        cy.center();
                        cy.forceRender();
                        
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
        cy.fit(50);
        cy.center();

        // Force another render to ensure everything is updated
        cy.forceRender();

        // Show success message
        showExportStatus('Layout reset successfully! All nodes repositioned based on hierarchy.', 'success');
    }, 100);
}

function addNewNode() {
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
    const nodeTypeSelect = document.getElementById('nodeTypeSelect');
    const hostnameInput = document.getElementById('nodeHostnameInput');
    const hallInput = document.getElementById('nodeHallInput');
    const aisleInput = document.getElementById('nodeAisleInput');
    const rackInput = document.getElementById('nodeRackInput');
    const shelfUInput = document.getElementById('nodeShelfUInput');

    const nodeType = nodeTypeSelect.value;

    // Check if cytoscape is initialized
    if (!cy) {
        showNotificationBanner('Please upload a file and generate a visualization first before adding new nodes.', 'error');
        return;
    }

    // Handle logical topology mode differently
    if (visualizationMode === 'hierarchy') {
        // Logical mode: add to selected parent graph node, or create synthetic root
        const config = NODE_CONFIGS[nodeType];
        if (!config) {
            showNotificationBanner(`Unknown node type: ${nodeType}`, 'error');
            return;
        }

        // Determine parent container - same logic as addNewGraph()
        let parentId = null;
        let parentNode = null;
        let isSyntheticRootChild = false;
        
        // Check if there's a selected graph instance
        const selectedNodes = cy.nodes(':selected');
        if (selectedNodes.length > 0) {
            const selectedGraphNode = selectedNodes[0];
            const selectedType = selectedGraphNode.data('type');
            
            // Graph nodes can be parents for new shelf nodes (even if empty)
            // Note: isParent() returns false for empty graph nodes, so we check type instead
            if (selectedType === 'graph') {
                parentId = selectedGraphNode.id();
                parentNode = selectedGraphNode;
                console.log(`Adding node to selected graph instance: ${parentNode.data('label')}`);
            }
        }
        
        // If no valid parent selected, add at top level (no parent)
        if (!parentNode) {
            console.log('No graph instance selected, adding at top level (no parent)');
            // parentId and parentNode remain null - node will be added at top level
        }

        // Find ALL instances of this template GLOBALLY to add the node to all of them
        let targetInstances = [];
        let addedToMultipleInstances = false;
        let isTopLevelNode = false;
        
        if (!parentNode) {
            // Top-level node (no parent) - create as standalone
            isTopLevelNode = true;
            console.log('Creating top-level standalone node (not part of any template)');
        } else {
            // Has a parent - add to parent and all instances of parent's template
            targetInstances = [parentNode];
            
            // Get the template name of the selected parent
            const parentTemplateName = parentNode.data('template_name');
            
            // Find ALL instances globally with the same template_name
            const allInstances = cy.nodes('[type="graph"]').filter(node => {
                return node.data('template_name') === parentTemplateName && node.id() !== parentId;
            });
            
            if (allInstances.length > 0) {
                targetInstances = [parentNode].concat(allInstances.toArray());
                addedToMultipleInstances = true;
                console.log(`Found ${allInstances.length + 1} instances of template "${parentTemplateName}" globally`);
            }
        }
        
        // Add node to all target instances (or at top level if no parent)
        let totalNodesAdded = 0;
        let autoNodeName = null;
        
        if (isTopLevelNode) {
            // Create a single top-level node (no parent)
            const existingTopLevelNodes = cy.nodes('[type="shelf"]').filter(n => !n.parent().length);
            const nodeIndex = existingTopLevelNodes.length;
            autoNodeName = `node_${nodeIndex}`;
            
            // Generate global host_index
            const hostIndex = globalHostCounter;
            globalHostCounter++;
            
            // Create shelf node ID
            const shelfId = `shelf_${Date.now()}_${autoNodeName}`;
            const shelfLabel = `${autoNodeName} (host_${hostIndex})`;
            
            // Add shelf node at top level (no parent)
            cy.add({
                group: 'nodes',
                data: {
                    id: shelfId,
                    // No parent field
                    label: shelfLabel,
                    type: 'shelf',
                    host_index: hostIndex,
                    shelf_node_type: nodeType,
                    child_name: autoNodeName,
                    logical_path: [],
                    logical_child_name: autoNodeName
                },
                classes: 'shelf',
                position: { x: 0, y: 0 }
            });

            // Create trays and ports
            const nodesToAdd = [];
            createTraysAndPorts(shelfId, autoNodeName, hostIndex, nodeType, config, 0, 0, nodesToAdd);
            cy.add(nodesToAdd);
            
            // Arrange trays and ports using common layout function
            const addedShelf = cy.getElementById(shelfId);
            common_arrangeTraysAndPorts(addedShelf);
            
            totalNodesAdded = 1;
        } else {
            // Add to all instances of the parent template
            targetInstances.forEach((targetParent, index) => {
                const targetParentId = targetParent.id();
                
                // Count existing shelf nodes in this instance to auto-generate name
                const existingNodes = targetParent.children('[type="shelf"]');
                const nodeIndex = existingNodes.length;
                
                // Use the same name for all instances (generated once)
                if (index === 0) {
                    autoNodeName = `node_${nodeIndex}`;
                }
                
                // Generate global host_index (will be recalculated later)
                const hostIndex = globalHostCounter;
                globalHostCounter++;
                
                // Create shelf node ID
                const shelfId = `${targetParentId}_${autoNodeName}`;
                const shelfLabel = `${autoNodeName} (host_${hostIndex})`;
                
                // Determine logical_path based on parent
                let logicalPath = [];
                if (targetParent.data('logical_path')) {
                    logicalPath = [...targetParent.data('logical_path'), targetParent.data('label')];
                }
                
                // Add shelf node
                cy.add({
                    group: 'nodes',
                    data: {
                        id: shelfId,
                        parent: targetParentId,
                        label: shelfLabel,
                        type: 'shelf',
                        host_index: hostIndex,
                        shelf_node_type: nodeType,
                        child_name: autoNodeName,
                        logical_path: logicalPath,
                        logical_child_name: autoNodeName
                    },
                    classes: 'shelf',
                    position: { x: 0, y: 0 }
                });

                // Create trays and ports
                const nodesToAdd = [];
                createTraysAndPorts(shelfId, autoNodeName, hostIndex, nodeType, config, 0, 0, nodesToAdd);
                cy.add(nodesToAdd);
                
                // Arrange trays and ports using common layout function
                const addedShelf = cy.getElementById(shelfId);
                common_arrangeTraysAndPorts(addedShelf);
                
                totalNodesAdded++;
            });
        }

        // Update the template definition to include the new node (only for template-based nodes)
        if (!isTopLevelNode && autoNodeName) {
            const parentTemplateName = parentNode.data('template_name');
            
            // Update availableGraphTemplates
            if (availableGraphTemplates && availableGraphTemplates[parentTemplateName]) {
                const template = availableGraphTemplates[parentTemplateName];
                if (!template.children) {
                    template.children = [];
                }
                
                // Add the new child node to the template
                template.children.push({
                    name: autoNodeName,
                    type: 'node',
                    node_descriptor: nodeType
                });
                
                console.log(`Updated template "${parentTemplateName}" with new child node "${autoNodeName}"`);
            }
            
            // Update currentData.metadata.graph_templates if it exists (for export)
            if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
                const template = currentData.metadata.graph_templates[parentTemplateName];
                if (template) {
                    if (!template.children) {
                        template.children = [];
                    }
                    
                    // Add the new child node to the template
                    template.children.push({
                        name: autoNodeName,
                        type: 'node',
                        node_descriptor: nodeType
                    });
                }
            }
        }

        // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
        if (!isTopLevelNode) {
            recalculateHostIndicesForTemplates();
        }

        // Apply drag restrictions and layout
        applyDragRestrictions();
        hierarchy_calculateLayout();
        
        // Update the connection legend (in case template structure affects it)
        if (currentData) {
            updateConnectionLegend(currentData);
        }
        
        // Success message
        if (isTopLevelNode) {
            showExportStatus(`Added node (${nodeType}) at top level`, 'success');
        } else {
            const parentLabel = parentNode.data('label');
            if (addedToMultipleInstances) {
                showExportStatus(`Added node (${nodeType}) to ${totalNodesAdded} instances of template`, 'success');
            } else {
                showExportStatus(`Added node (${nodeType}) to ${parentLabel}`, 'success');
            }
        }
        
        // Clear selection
        nodeTypeSelect.selectedIndex = 0;
        return;
    }

    // Physical location mode: validate location/hostname inputs
    const hostname = hostnameInput.value.trim();
    const hall = hallInput.value.trim();
    const aisle = aisleInput.value.trim();
    const rack = parseInt(rackInput.value) || 0;
    const shelfU = parseInt(shelfUInput.value) || 0;

    // Validation: Either hostname OR all location fields must be filled
    const hasHostname = hostname.length > 0;
    const hasLocation = hall.length > 0 && aisle.length > 0 && rack > 0 && shelfU > 0;

    if (!hasHostname && !hasLocation) {
        alert('Please enter either a hostname OR all location fields (Hall, Aisle, Rack, Shelf U).');
        if (!hostname) hostnameInput.focus();
        return;
    }

    // Allow both hostname and location to be filled - hostname takes precedence for label

    // Check for existing node with same hostname or location
    if (hasHostname) {
        const existingNode = cy.nodes(`[hostname="${hostname}"]`);
        if (existingNode.length > 0) {
            alert(`A node with hostname "${hostname}" already exists. Please choose a different hostname.`);
            hostnameInput.focus();
            return;
        }
    } else {
        // Check for existing node with same location
        const existingNode = cy.nodes(`[hall="${hall}"][aisle="${aisle}"][rack_num="${rack}"][shelf_u="${shelfU}"]`);
        if (existingNode.length > 0) {
            alert(`A node already exists at Hall: ${hall}, Aisle: ${aisle}, Rack: ${rack}, Shelf U: ${shelfU}. Please choose a different location.`);
            return;
        }
    }

    const config = NODE_CONFIGS[nodeType];
    if (!config) {
        alert(`Unknown node type: ${nodeType}`);
        return;
    }

    // If location data is provided, ensure a rack exists for it
    let rackParentId = null;
    if (hasLocation) {
        const rackId = `rack_${rack.toString().padStart(2, '0')}`;
        let rackNode = cy.getElementById(rackId);

        // Create rack if it doesn't exist
        if (rackNode.length === 0) {
            // Calculate position for new rack
            let newRackX = 0;
            let newRackY = 0;
            const existingRacks = cy.nodes('[type="rack"]');

            if (existingRacks.length > 0) {
                // Position new rack to the right of the rightmost rack
                let maxX = -Infinity;
                existingRacks.forEach(function (rack) {
                    const rackPos = rack.position();
                    if (rackPos.x > maxX) {
                        maxX = rackPos.x;
                        newRackY = rackPos.y;
                    }
                });
                newRackX = maxX + 500; // 500px spacing between racks
            } else {
                // First rack - place at a reasonable starting position
                newRackX = LAYOUT_CONSTANTS.NEW_RACK_DEFAULT_X;
                newRackY = LAYOUT_CONSTANTS.NEW_RACK_DEFAULT_Y;
            }

            const rackLabel = `Rack ${rack}`;
            cy.add({
                group: 'nodes',
                data: {
                    id: rackId,
                    label: rackLabel,
                    type: 'rack',
                    rack_num: rack,
                    hall: hall,
                    aisle: aisle
                },
                classes: 'rack',
                position: {
                    x: newRackX,
                    y: newRackY
                }
            });
            rackNode = cy.getElementById(rackId);
        }

        rackParentId = rackId;
    }

    // Find a good position for the new node
    let newX, newY;

    if (rackParentId) {
        // Position shelf within the rack
        const rackNode = cy.getElementById(rackParentId);
        const rackPos = rackNode.position();

        // Get existing shelves in this rack to determine vertical position
        const shelvesInRack = rackNode.children('[type="shelf"]');
        const shelfCount = shelvesInRack.length;
        const shelfSpacing = 140;

        newX = rackPos.x;
        newY = rackPos.y - (shelfCount * shelfSpacing / 2); // Position based on shelf count
    } else {
        // 8-column format or no rack - position to the right of existing shelves
        const existingShelves = cy.nodes('.shelf');
        let maxX = 0;
        existingShelves.forEach(shelf => {
            const pos = shelf.position();
            if (pos.x > maxX) maxX = pos.x;
        });
        newX = maxX + 500;
        newY = 200;
    }

    // Create shelf node
    let shelfId, nodeLabel, nodeData;

    if (hasHostname) {
        // Use hostname as label, but include location data if provided
        shelfId = `${hostname}`;
        nodeLabel = hostname;
        nodeData = {
            id: shelfId,
            label: nodeLabel,
            type: 'shelf',
            hostname: hostname,
            shelf_node_type: nodeType
        };

        // Add location data if provided
        if (hasLocation) {
            nodeData.hall = hall;
            nodeData.aisle = aisle;
            nodeData.rack_num = rack;
            nodeData.shelf_u = shelfU;
        }
    } else {
        // Format: HallAisle{2-digit Rack}U{2-digit Shelf U}
        nodeLabel = location_buildLabel(hall, aisle, rack, shelfU);
        shelfId = nodeLabel; // Use the same format as the label
        nodeData = {
            id: shelfId,
            label: nodeLabel,
            type: 'shelf',
            hall: hall,
            aisle: aisle,
            rack_num: rack,
            shelf_u: shelfU,
            shelf_node_type: nodeType
        };
    }

    // Add parent rack if it exists
    if (rackParentId) {
        nodeData.parent = rackParentId;
    }

    const shelfNode = {
        data: nodeData,
        position: { x: newX, y: newY },
        classes: 'shelf'
    };

    const nodesToAdd = [shelfNode];

    // Create trays and ports based on node configuration
    // Positions will be calculated by common_arrangeTraysAndPorts after adding to cytoscape
    for (let trayNum = 1; trayNum <= config.tray_count; trayNum++) {
        const trayId = `${shelfId}-tray${trayNum}`;

        const trayData = {
            id: trayId,
            parent: shelfId,
            label: `T${trayNum}`,
            type: 'tray',
            tray: trayNum,
            shelf_node_type: nodeType
        };

        // Add location data if available
        if (hasLocation) {
            trayData.rack_num = rack;
            trayData.shelf_u = shelfU;
            trayData.hall = hall;
            trayData.aisle = aisle;
        }
        if (hasHostname) {
            trayData.hostname = hostname;
        }

        const trayNode = {
            data: trayData,
            position: { x: 0, y: 0 }, // Placeholder - will be set by common_arrangeTraysAndPorts
            classes: 'tray'
        };
        nodesToAdd.push(trayNode);

        // Create ports based on node configuration
        const portsPerTray = config.ports_per_tray;
        for (let portNum = 1; portNum <= portsPerTray; portNum++) {
            const portId = `${shelfId}-tray${trayNum}-port${portNum}`;

            const portData = {
                id: portId,
                parent: trayId,
                label: `P${portNum}`,
                type: 'port',
                tray: trayNum,
                port: portNum,
                shelf_node_type: nodeType
            };

            // Add location data if available
            if (hasLocation) {
                portData.rack_num = rack;
                portData.shelf_u = shelfU;
                portData.hall = hall;
                portData.aisle = aisle;
            }
            if (hasHostname) {
                portData.hostname = hostname;
            }

            const portNode = {
                data: portData,
                position: { x: 0, y: 0 }, // Placeholder - will be set by common_arrangeTraysAndPorts
                classes: 'port'
            };
            nodesToAdd.push(portNode);
        }
    }

    try {
        // Add all nodes to cytoscape
        cy.add(nodesToAdd);
        
        // Arrange trays and ports for the newly added shelf
        const addedShelf = cy.getElementById(shelfId);
        if (addedShelf && addedShelf.length > 0) {
            common_arrangeTraysAndPorts(addedShelf);
        }

        // Apply drag restrictions
        applyDragRestrictions();

        // Apply styling and layout
        setTimeout(() => {
            forceApplyCurveStyles();
            updatePortConnectionStatus();
            updatePortEditingHighlight(); // Highlight available ports if in editing mode
        }, 100);

        // Clear all inputs
        hostnameInput.value = '';
        hallInput.value = '';
        aisleInput.value = '';
        rackInput.value = '';
        shelfUInput.value = '';

        // Show success message
        const nodeDescription = hasHostname ? `"${hostname}"` : `"${nodeLabel}"`;
        const locationInfo = hasHostname && hasLocation ? ` (with location: ${location_buildLabel(hall, aisle, rack, shelfU)})` : '';
        alert(`Successfully added ${nodeType} node ${nodeDescription}${locationInfo} with ${config.tray_count} trays.`);

        // Update node filter dropdown to include the new node
        populateNodeFilterDropdown();

    } catch (error) {
        console.error('Error adding new node:', error);
        alert(`Failed to add node: ${error.message}`);
    }
}

/**
 * Check if a template contains another template (directly or nested)
 * This is used to detect circular dependencies
 * @param {string} parentTemplateName - The parent template to check
 * @param {string} childTemplateName - The child template to look for
 * @returns {boolean} - True if parentTemplate contains childTemplate
 */
function templateContainsTemplate(parentTemplateName, childTemplateName) {
    const visited = new Set();

    function checkRecursive(templateName) {
        // Prevent infinite recursion
        if (visited.has(templateName)) {
            return false;
        }
        visited.add(templateName);

        const template = availableGraphTemplates[templateName];
        if (!template || !template.children) {
            return false;
        }

        // Check each child
        for (const child of template.children) {
            if (child.type === 'graph' && child.graph_template) {
                // Direct match
                if (child.graph_template === childTemplateName) {
                    return true;
                }
                // Recursive check - does this nested template contain the target?
                if (checkRecursive(child.graph_template)) {
                    return true;
                }
            }
        }

        return false;
    }

    return checkRecursive(parentTemplateName);
}

function addNewGraph() {
    const graphTemplateSelect = document.getElementById('graphTemplateSelect');

    const selectedTemplate = graphTemplateSelect.value;

    // Check if cytoscape is initialized
    if (!cy) {
        showNotificationBanner('Please upload a file and generate a visualization first before adding graph instances.', 'error');
        return;
    }

    // Check if there are any templates available
    if (Object.keys(availableGraphTemplates).length === 0) {
        showNotificationBanner('No graph templates available. Please load a textproto file that contains graph_templates first.', 'error');
        return;
    }

    // Validate template selection
    if (!selectedTemplate) {
        showNotificationBanner('Please select a graph template.', 'error');
        graphTemplateSelect.focus();
        return;
    }

    // Get the template structure
    const template = availableGraphTemplates[selectedTemplate];
    if (!template) {
        showNotificationBanner(`Template "${selectedTemplate}" not found.`, 'error');
        return;
    }


    // All graph template instances have type="graph"
    // The hierarchy is user-defined in the textproto, not inferred from names
    const graphType = 'graph';

    // Determine parent: Use selected graph node if valid, otherwise add at top level
    let parentId = null;
    let parentNode = null;

    // Check if there's a selected node that could be a parent
    const selectedNodes = cy.nodes(':selected');
    if (selectedNodes.length > 0) {
        const selectedNode = selectedNodes[0];
        const selectedType = selectedNode.data('type');

        // Only graph nodes (type="graph") can be parents for new graph instances (even if empty)
        if (selectedType === 'graph') {
            // Check for circular dependency
            const parentTemplateName = selectedNode.data('template_name');

            // Case 1: Self-reference - template cannot contain itself
            if (parentTemplateName === selectedTemplate) {
                showNotificationBanner(`❌ Cannot instantiate graph template: Self-referential dependency detected. A template cannot contain an instance of itself. You cannot instantiate "${selectedTemplate}" inside an instance of "${parentTemplateName}". Select a different parent or deselect all nodes to add at the top level.`, 'error');
                return;
            }

            // Case 2: Template hierarchy check - does the template we're trying to add contain the parent's template?
            // If child template contains parent template, that creates a circular dependency
            if (parentTemplateName && templateContainsTemplate(selectedTemplate, parentTemplateName)) {
                showNotificationBanner(`❌ Cannot instantiate graph template: Circular dependency detected. Template "${selectedTemplate}" contains "${parentTemplateName}". You cannot instantiate "${selectedTemplate}" inside "${parentTemplateName}" because that would create a circular dependency. Select a different parent or deselect all nodes to add at the top level.`, 'error');
                return;
            }

            parentNode = selectedNode;
            parentId = selectedNode.id();
        } else {
            console.log(`Selected node is not a graph (type: ${selectedType}). Adding at top level.`);
        }
    }

    // Auto-generate enumerated label: {template_name}_{index}
    // NOW that parent is determined, count existing instances within that parent
    let existingInstances;
    if (parentNode) {
        // Count children of this parent with the same template (including empty ones)
        existingInstances = parentNode.children().filter(node => {
            return node.data('type') === 'graph' && node.data('template_name') === selectedTemplate;
        });
    } else {
        // Count top-level instances (no parent, including empty ones)
        existingInstances = cy.nodes().roots().filter(node => {
            return node.data('type') === 'graph' && node.data('template_name') === selectedTemplate;
        });
    }

    const nextIndex = existingInstances.length;
    let graphLabel = `${selectedTemplate}_${nextIndex}`;

    const parentDesc = parentNode ? `within parent "${parentNode.data('label')}"` : 'at top level';

    // Generate graph ID now that we have graphLabel (use let since it may be adjusted)
    let graphId = `graph_${Date.now()}_${graphLabel.replace(/\s+/g, '_')}`;

    // If no valid parent from selection, add at top level (no parent)
    if (!parentNode) {
        console.log(`Adding at top level (no parent).`);
        // parentNode and parentId remain null - graph will be added at top level
    }

    // Find a good position for the new graph
    let newX = 0;
    let newY = 0;

    if (parentNode) {
        // Position relative to parent - find siblings and place next to them
        const siblings = parentNode.children().filter(node => node.isParent() && node.data('type') !== 'rack');
        const parentPos = parentNode.position();

        if (siblings.length > 0) {
            // Position to the right of existing siblings
            let maxX = -Infinity;
            siblings.forEach(sibling => {
                const boundingBox = sibling.boundingBox();
                const rightEdge = boundingBox.x2 || (sibling.position().x + 300);
                if (rightEdge > maxX) {
                    maxX = rightEdge;
                }
            });
            newX = maxX + 600; // 600px spacing
            newY = parentPos.y + 200; // Below parent
        } else {
            // First child - position inside parent
            newX = parentPos.x;
            newY = parentPos.y + 200;
        }
    } else {
        // No parent - position at top level
        const existingGraphs = cy.nodes().filter(node => node.isParent() && !node.parent().length && !['rack', 'tray', 'port'].includes(node.data('type')));

        if (existingGraphs.length > 0) {
            // Position new graph to the right of existing top-level graphs
            let maxX = -Infinity;
            existingGraphs.forEach(graph => {
                const pos = graph.position();
                const boundingBox = graph.boundingBox();
                const rightEdge = boundingBox.x2 || (pos.x + 300);
                if (rightEdge > maxX) {
                    maxX = rightEdge;
                    newY = pos.y;
                }
            });
            newX = maxX + 600; // 600px spacing between graphs
        } else {
            // First graph - place at a reasonable starting position
            newX = 300;
            newY = 300;
        }
    }

    try {
        // Check if adding inside a template instance (hierarchy mode)
        const isInsideTemplate = visualizationMode === 'hierarchy' && parentNode && parentNode.data('template_name');
        const parentTemplateName = isInsideTemplate ? parentNode.data('template_name') : null;

        if (isInsideTemplate) {

            // Update the parent template definition first
            updateTemplateWithNewChild(parentTemplateName, selectedTemplate, graphLabel);

            // Find all instances of the parent template (including empty ones)
            const parentTemplateInstances = cy.nodes().filter(node =>
                node.data('type') === 'graph' &&
                node.data('template_name') === parentTemplateName
            );


            // Add the child graph to ALL instances of the parent template
            let instancesUpdated = 0;
            parentTemplateInstances.forEach(parentInstance => {
                const instanceId = parentInstance.id();
                const instanceLabel = parentInstance.data('label');

                // Generate unique ID and label for this instance
                const childGraphId = `graph_${Date.now()}_${instanceLabel}_${graphLabel.replace(/\s+/g, '_')}`;
                const childGraphLabel = graphLabel; // Use same child name across instances

                // Find position for the child within this parent instance
                const siblings = parentInstance.children().filter(node =>
                    node.isParent() && node.data('type') === 'graph'
                );
                const parentPos = parentInstance.position();

                let childX, childY;
                if (siblings.length > 0) {
                    // Position to the right of existing siblings
                    let maxX = -Infinity;
                    siblings.forEach(sibling => {
                        const boundingBox = sibling.boundingBox();
                        const rightEdge = boundingBox.x2 || (sibling.position().x + 300);
                        if (rightEdge > maxX) {
                            maxX = rightEdge;
                        }
                    });
                    childX = maxX + 600;
                    childY = parentPos.y + 200;
                } else {
                    // First child
                    childX = parentPos.x;
                    childY = parentPos.y + 200;
                }

                const nodesToAdd = [];
                const edgesToAdd = [];
                const deferredConnections = [];

                // Get parent depth for proper color cascading
                const parentInstanceDepth = parentInstance.data('depth') || 0;

                instantiateTemplateRecursive(
                    template,
                    selectedTemplate,
                    childGraphId,
                    childGraphLabel,
                    graphType,
                    instanceId,
                    childX,
                    childY,
                    nodesToAdd,
                    edgesToAdd,
                    {},
                    deferredConnections,
                    graphLabel,  // Pass child_name for template-level operations
                    parentInstanceDepth  // Pass parent depth
                );

                // Add nodes for this instance
                cy.add(nodesToAdd);
                
                // Arrange trays and ports for all newly added shelves
                nodesToAdd.forEach(node => {
                    if (node.data && node.data.type === 'shelf') {
                        const shelfNode = cy.getElementById(node.data.id);
                        if (shelfNode && shelfNode.length > 0) {
                            common_arrangeTraysAndPorts(shelfNode);
                        }
                    }
                });

                // Process connections
                processDeferredConnections(deferredConnections, edgesToAdd);
                cy.add(edgesToAdd);

                // Explicitly apply graph class to ensure styling works
                cy.getElementById(childGraphId).addClass('graph');

                instancesUpdated++;
            });

            // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
            recalculateHostIndicesForTemplates();

            // Apply drag restrictions and styling
            applyDragRestrictions();

            // Force complete style recalculation and redraw
            cy.style().update();
            cy.forceRender();

            // Defer layout calculation to ensure nodes are fully rendered and bounding boxes are accurate
            setTimeout(() => {
                hierarchy_calculateLayout();
                cy.fit(null, 50);

                // Apply curves and update status after layout is done
                setTimeout(() => {
                    forceApplyCurveStyles();
                    updatePortConnectionStatus();
                    cy.forceRender();
                }, 50);
            }, 50);

            // Show success message
            alert(`Successfully added graph template "${selectedTemplate}" as "${graphLabel}" to ${instancesUpdated} instance(s) of template "${parentTemplateName}"!`);

        } else {
            // Not inside a template - single instance creation (original behavior)
            const nodesToAdd = [];
            const edgesToAdd = [];
            const deferredConnections = [];

            // Get parent depth for proper color cascading
            let parentDepthValue = -1; // Default for top-level (depth will be 0)
            if (parentId) {
                const parentNodeForDepth = cy.getElementById(parentId);
                if (parentNodeForDepth && parentNodeForDepth.length > 0) {
                    parentDepthValue = parentNodeForDepth.data('depth') || 0;
                }
            }

            instantiateTemplateRecursive(
                template,
                selectedTemplate,
                graphId,
                graphLabel,
                graphType,
                parentId, // parent is root cluster if it exists
                newX,
                newY,
                nodesToAdd,
                edgesToAdd,
                {}, // node path mapping for connections
                deferredConnections,
                null, // childName
                parentDepthValue  // Pass parent depth
            );

            // Add all nodes to cytoscape FIRST
            console.log(`Adding ${nodesToAdd.length} nodes to Cytoscape`);
            cy.add(nodesToAdd);
            
            // Arrange trays and ports for all newly added shelves
            nodesToAdd.forEach(node => {
                if (node.data && node.data.type === 'shelf') {
                    const shelfNode = cy.getElementById(node.data.id);
                    if (shelfNode && shelfNode.length > 0) {
                        common_arrangeTraysAndPorts(shelfNode);
                    }
                }
            });

            // Track top-level additions for export optimization
            if (parentId === null && currentData && currentData.metadata) {
                // Adding at top level - check if we had an initial root
                if (currentData.metadata.initialRootTemplate) {
                    currentData.metadata.hasTopLevelAdditions = true;
                    console.log(`Top-level graph added - flagging export to use synthetic root`);
                }
            }

            // NOW process deferred connections (all nodes exist)
            console.log(`Processing ${deferredConnections.length} deferred connection groups`);
            processDeferredConnections(deferredConnections, edgesToAdd);

            // Add all edges
            console.log(`Adding ${edgesToAdd.length} edges to Cytoscape`);
            cy.add(edgesToAdd);

            // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
            if (visualizationMode === 'hierarchy') {
                recalculateHostIndicesForTemplates();
            }

            // Apply drag restrictions
            applyDragRestrictions();

            // Explicitly apply graph class to ensure styling works
            cy.getElementById(graphId).addClass('graph');

            // Force complete style recalculation and redraw
            cy.style().update();
            cy.forceRender();

            // Defer layout calculation to ensure nodes are fully rendered and bounding boxes are accurate
            // This prevents the "weird look" on initial creation
            setTimeout(() => {
                hierarchy_calculateLayout();
                cy.fit(null, 50);  // Fit viewport to show all content

                // Apply curves and update status after layout is done
                setTimeout(() => {
                    forceApplyCurveStyles();
                    updatePortConnectionStatus();
                    cy.forceRender();
                }, 50);
            }, 50);

            // Show success message
            const childCount = template.children ? template.children.length : 0;
            const connectionCount = template.connections ? template.connections.length : 0;
            alert(`Successfully instantiated graph template "${selectedTemplate}" as "${graphLabel}"!\n\n` +
                `Created ${childCount} child node(s) and ${connectionCount} connection(s).`);
        }

    } catch (error) {
        console.error('Error instantiating graph template:', error);
        alert(`Failed to instantiate graph template: ${error.message}`);
    }
}

function createNewTemplate() {
    const templateNameInput = document.getElementById('newTemplateNameInput');
    const newTemplateName = templateNameInput.value.trim();

    // Check if cytoscape is initialized
    if (!cy) {
        showNotificationBanner('Please upload a file and generate a visualization first before creating templates.', 'error');
        return;
    }

    // Validate template name
    if (!newTemplateName) {
        showNotificationBanner('Please enter a template name.', 'error');
        templateNameInput.focus();
        return;
    }

    // Check if template name already exists
    if (availableGraphTemplates && availableGraphTemplates[newTemplateName]) {
        showNotificationBanner(`Template "${newTemplateName}" already exists. Please choose a different name.`, 'error');
        templateNameInput.focus();
        return;
    }

    try {
        // Initialize currentData if it doesn't exist (for empty canvas scenario)
        if (!currentData) {
            currentData = {
                nodes: [],
                edges: [],
                elements: [],
                metadata: {
                    total_connections: 0,
                    total_nodes: 0,
                    graph_templates: {}
                }
            };
        }

        // Initialize metadata.graph_templates if it doesn't exist
        if (!currentData.metadata) {
            currentData.metadata = { graph_templates: {} };
        }
        if (!currentData.metadata.graph_templates) {
            currentData.metadata.graph_templates = {};
        }

        // Create an empty template structure
        const emptyTemplate = {
            children: [],
            connections: []
        };

        // Initialize availableGraphTemplates if it doesn't exist
        if (!availableGraphTemplates) {
            availableGraphTemplates = {};
        }

        // Add the new template to availableGraphTemplates
        availableGraphTemplates[newTemplateName] = emptyTemplate;
        
        // Also add to currentData.metadata.graph_templates for export
        currentData.metadata.graph_templates[newTemplateName] = emptyTemplate;

        // Update the template dropdown
        const graphTemplateSelect = document.getElementById('graphTemplateSelect');
        if (graphTemplateSelect) {
            // Rebuild the dropdown
            graphTemplateSelect.innerHTML = '<option value="">-- Select a Template --</option>';
            
            Object.keys(availableGraphTemplates).sort().forEach(templateName => {
                const option = document.createElement('option');
                option.value = templateName;
                option.textContent = templateName;
                graphTemplateSelect.appendChild(option);
            });
        }

        // Determine parent: Use selected graph node if valid, otherwise add at top level
        let parentId = null;
        let parentNode = null;
        let parentDepth = -1;

        // Check if there's a selected node that could be a parent
        const selectedNodes = cy.nodes(':selected');
        if (selectedNodes.length > 0) {
            const selectedNode = selectedNodes[0];
            const selectedType = selectedNode.data('type');

            // Only graph nodes can be parents for new graph instances (even if empty)
            if (selectedType === 'graph') {
                parentNode = selectedNode;
                parentId = selectedNode.id();
                parentDepth = selectedNode.data('depth') || 0;
            }
        }

        // If no valid parent, add at top level (no parent)
        if (!parentId) {
            console.log('No parent selected, adding new template instance at top level');
            // parentId and parentNode remain null - graph will be added at top level
            parentDepth = -1; // Top level depth
        }

        // Calculate the enumeration for the new instance
        let instanceIndex = 0;
        if (parentId) {
            const siblings = parentNode.children().filter(node => {
                return node.data('type') === 'graph' && node.data('template_name') === newTemplateName;
            });
            instanceIndex = siblings.length;
        } else {
            // Count all instances of this template at the top level
            const topLevelInstances = cy.nodes('[type="graph"]').filter(node => {
                return !node.parent().length && node.data('template_name') === newTemplateName;
            });
            instanceIndex = topLevelInstances.length;
        }

        // Create instance name following the pattern: template_name_index
        const graphLabel = `${newTemplateName}_${instanceIndex}`;
        const graphId = `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Calculate position
        let baseX = 0;
        let baseY = 0;

        if (parentNode) {
            const parentPos = parentNode.position();
            baseX = parentPos.x;
            baseY = parentPos.y;
        }

        // Get template-based color
        const templateColor = getTemplateColor(newTemplateName);
        
        // If adding inside a parent template, update that parent's template definition
        // and add to ALL instances of that parent template
        if (parentId && parentNode) {
            const parentTemplateName = parentNode.data('template_name');
            if (parentTemplateName) {
                // Update the parent template to include this new child
                updateTemplateWithNewChild(parentTemplateName, newTemplateName, graphLabel);
                
                // Find all instances of the parent template
                const parentTemplateInstances = cy.nodes().filter(node =>
                    node.data('type') === 'graph' &&
                    node.data('template_name') === parentTemplateName
                );
                
                // Add the new empty graph instance to each parent instance
                parentTemplateInstances.forEach(parentInstance => {
                    const parentInstanceId = parentInstance.id();
                    const parentInstanceLabel = parentInstance.data('label');
                    
                    // Generate unique ID for this instance
                    const childGraphId = `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${parentInstanceLabel}_${graphLabel}`;
                    
                    // Calculate position relative to parent
                    const siblings = parentInstance.children().filter(node =>
                        node.data('type') === 'graph'
                    );
                    const parentInstancePos = parentInstance.position();
                    
                    let childX, childY;
                    if (siblings.length > 0) {
                        // Position to the right of existing siblings
                        let maxX = -Infinity;
                        siblings.forEach(sibling => {
                            const boundingBox = sibling.boundingBox();
                            const rightEdge = boundingBox.x2 || (sibling.position().x + 300);
                            if (rightEdge > maxX) {
                                maxX = rightEdge;
                            }
                        });
                        childX = maxX + 600;
                        childY = parentInstancePos.y + 200;
                    } else {
                        // First child
                        childX = parentInstancePos.x;
                        childY = parentInstancePos.y + 200;
                    }
                    
                    // Create the empty graph instance node for this parent instance
                    const childGraphNode = {
                        data: {
                            id: childGraphId,
                            label: graphLabel,
                            type: 'graph',
                            template_name: newTemplateName,
                            parent: parentInstanceId,
                            depth: (parentInstance.data('depth') || 0) + 1,
                            graphType: 'graph',
                            child_name: graphLabel,
                            templateColor: templateColor
                        },
                        position: { x: childX, y: childY },
                        classes: 'graph'
                    };
                    
                    cy.add(childGraphNode);
                });
                
                console.log(`Added new template "${newTemplateName}" to ${parentTemplateInstances.length} instance(s) of parent template "${parentTemplateName}"`);
            }
        } else {
            // No parent - create single top-level instance
            // Create the empty graph instance node
            const graphNode = {
                data: {
                    id: graphId,
                    label: graphLabel,
                    type: 'graph',
                    template_name: newTemplateName,
                    parent: parentId,
                    depth: parentDepth + 1,
                    graphType: 'graph',
                    child_name: graphLabel,
                    templateColor: templateColor
                },
                position: { x: baseX, y: baseY },
                classes: 'graph'
            };

            // Add the node to the graph
            cy.add(graphNode);
        }

        // Force render
        cy.forceRender();

        // Recalculate layout
        setTimeout(() => {
            hierarchy_calculateLayout();
            cy.fit(null, 50);

            setTimeout(() => {
                forceApplyCurveStyles();
                updatePortConnectionStatus();
                cy.forceRender();
            }, 50);
        }, 50);

        // Clear the input field
        templateNameInput.value = '';

        // Enable the Add Node button now that we have a valid canvas
        updateAddNodeButtonState();
        
        // Update the connection legend to show the new template
        if (currentData) {
            updateConnectionLegend(currentData);
        }

        // Show success message
        if (parentId && parentNode) {
            const parentTemplateName = parentNode.data('template_name');
            if (parentTemplateName) {
                const parentTemplateInstances = cy.nodes().filter(node =>
                    node.data('type') === 'graph' &&
                    node.data('template_name') === parentTemplateName
                );
                showExportStatus(`Successfully created empty template "${newTemplateName}" and added to ${parentTemplateInstances.length} instance(s) of "${parentTemplateName}"`, 'success');
            } else {
                showExportStatus(`Successfully created empty template "${newTemplateName}" and added instance "${graphLabel}"`, 'success');
            }
        } else {
            showExportStatus(`Successfully created empty template "${newTemplateName}" and added instance "${graphLabel}"`, 'success');
        }

    } catch (error) {
        console.error('Error creating new template:', error);
        alert(`Failed to create new template: ${error.message}`);
    }
}

/**
 * Resolve a path through the path mapping
 * For simple paths like ["node1"], returns pathMapping["node1"]
 * For nested paths like ["superpod1", "node1"], resolves through nested mappings
 * @param {Array} path - Array of path elements (e.g., ["superpod1", "node1"])
 * @param {Object} pathMapping - The path mapping object
 * @returns {string|null} The resolved node ID or null if not found
 */
function resolvePathInMapping(path, pathMapping) {
    if (!path || path.length === 0) {
        return null;
    }

    // For single-element paths, direct lookup
    if (path.length === 1) {
        return pathMapping[path[0]] || null;
    }

    // For nested paths, join with dots (e.g., "superpod1.node1")
    // This matches how we store nested paths in the pathMapping during instantiation
    const fullPath = path.join('.');
    return pathMapping[fullPath] || null;
}

/**
 * Process all deferred connections after all nodes have been created
 * @param {Array} deferredConnections - Array of deferred connection groups
 * @param {Array} edgesToAdd - Array to add the created edges to
 */
function processDeferredConnections(deferredConnections, edgesToAdd) {
    deferredConnections.forEach(deferred => {
        const { graphId, graphLabel, connections, pathMapping, templateName } = deferred;

        connections.forEach((conn, connIndex) => {
            try {
                // Resolve source node ID by traversing the full path
                const sourcePath = conn.port_a.path;
                const sourceNodeId = resolvePathInMapping(sourcePath, pathMapping);

                if (!sourceNodeId) {
                    console.warn(`Source node not found for path: ${JSON.stringify(sourcePath)} in graph "${graphLabel}"`);
                    return;
                }

                const sourcePortId = `${sourceNodeId}-tray${conn.port_a.tray_id}-port${conn.port_a.port_id}`;

                // Resolve target node ID by traversing the full path
                const targetPath = conn.port_b.path;
                const targetNodeId = resolvePathInMapping(targetPath, pathMapping);

                if (!targetNodeId) {
                    console.warn(`Target node not found for path: ${JSON.stringify(targetPath)} in graph "${graphLabel}"`);
                    return;
                }

                const targetPortId = `${targetNodeId}-tray${conn.port_b.tray_id}-port${conn.port_b.port_id}`;

                // Determine connection color based on container template
                // This ensures connections match their container's color
                const connectionColor = getTemplateColor(templateName);

                // Create edge
                const edgeId = `${graphId}_conn_${connIndex}`;
                const edge = {
                    data: {
                        id: edgeId,
                        source: sourcePortId,
                        target: targetPortId,
                        cableType: conn.cable_type || 'QSFP_DD',
                        cableLength: 'Unknown',
                        color: connectionColor,
                        containerTemplate: templateName  // Store container template for reference
                    }
                };
                edgesToAdd.push(edge);


            } catch (error) {
                console.error(`Error creating connection ${connIndex} for ${graphLabel}:`, error, conn);
            }
        });
    });
}

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
function instantiateTemplateRecursive(template, templateName, graphId, graphLabel, graphType, parentId, baseX, baseY, nodesToAdd, edgesToAdd, pathMapping, deferredConnections, childName = null, parentDepth = -1) {
    // Create the graph container node
    // Calculate depth for hierarchy tracking
    const depth = parentDepth + 1;

    // Get template-based color
    const templateColor = getTemplateColor(templateName);

    const graphNode = {
        data: {
            id: graphId,
            label: graphLabel,
            type: graphType,
            template_name: templateName,
            parent: parentId,
            depth: depth,  // Keep depth for hierarchy tracking
            graphType: graphType,  // Also store as graphType for compatibility
            child_name: childName || graphLabel,  // Store child_name for template-level operations
            templateColor: templateColor  // Store template color for explicit styling
        },
        position: { x: baseX, y: baseY },
        classes: 'graph'
    };
    nodesToAdd.push(graphNode);


    // Process children
    if (template.children && template.children.length > 0) {
        // Use temporary positions - hierarchy_calculateLayout() will position everything properly
        // with dynamic, percentage-based spacing

        template.children.forEach((child, index) => {
            const childX = baseX;  // Temporary X
            const childY = baseY + (index * 100);  // Temporary Y with minimal offset
            const childId = `${graphId}_${child.name}`;

            // Update path mapping for connection resolution
            pathMapping[child.name] = childId;

            if (child.type === 'node') {
                // Create a shelf node (leaf node)
                let nodeType = child.node_descriptor || 'WH_GALAXY';

                // Normalize node type names (e.g., N300_LB_DEFAULT -> N300_LB)
                nodeType = nodeType.replace(/_DEFAULT$/, '').replace(/_GLOBAL$/, '').replace(/_AMERICA$/, '');

                let config = NODE_CONFIGS[nodeType];

                if (!config) {
                    console.warn(`Unknown node type: ${child.node_descriptor}, normalized to ${nodeType}, using WH_GALAXY as fallback`);
                    nodeType = 'WH_GALAXY';
                    config = NODE_CONFIGS['WH_GALAXY'];
                }

                // Generate globally unique host index
                const hostIndex = globalHostCounter;
                globalHostCounter++;  // Increment for next node

                // child.name from template is already enumerated (node_0, node_1, etc.)
                // Format label as "node_X (host_Y)"
                const displayLabel = `${child.name} (host_${hostIndex})`;

                const shelfNode = {
                    data: {
                        id: childId,
                        parent: graphId,
                        label: displayLabel,  // Display as "node_0 (host_17)"
                        type: 'shelf',
                        host_index: hostIndex,  // Globally unique host index
                        hostname: child.name,  // Set to child.name (not displayed in logical view)
                        shelf_node_type: nodeType,
                        child_name: child.name  // Template-local name (node_0, node_1, etc.) for export
                    },
                    position: { x: childX, y: childY },
                    classes: 'shelf'
                };
                nodesToAdd.push(shelfNode);

                // Create trays and ports
                createTraysAndPorts(childId, child.name, hostIndex, nodeType, config, childX, childY, nodesToAdd);

            } else if (child.type === 'graph') {
                // Recursively instantiate nested graph
                const nestedTemplate = availableGraphTemplates[child.graph_template];
                if (!nestedTemplate) {
                    console.error(`Template not found: ${child.graph_template}`);
                    return;
                }

                // All graph template instances have type="graph"
                const nestedType = 'graph';

                // Create a new path mapping for the nested scope
                const nestedPathMapping = {};

                instantiateTemplateRecursive(
                    nestedTemplate,
                    child.graph_template,
                    childId,
                    child.name,
                    nestedType,
                    graphId, // parent is current graph
                    childX,
                    childY,
                    nodesToAdd,
                    edgesToAdd,
                    nestedPathMapping,
                    deferredConnections,
                    child.name,  // Pass child_name for template-level operations
                    depth  // Pass current depth as parent depth for nested children
                );

                // Merge nested path mapping into current scope with prefix
                for (const [name, id] of Object.entries(nestedPathMapping)) {
                    const qualifiedName = `${child.name}.${name}`;
                    pathMapping[qualifiedName] = id;
                }
            }
        });
    }

    // Defer connection creation until all nodes are instantiated
    // Store the connection data and path mapping for later processing
    if (template.connections && template.connections.length > 0) {
        // Clone the pathMapping for this scope to use later
        const pathMappingCopy = Object.assign({}, pathMapping);

        deferredConnections.push({
            graphId: graphId,
            graphLabel: graphLabel,
            connections: template.connections,
            pathMapping: pathMappingCopy,
            templateName: templateName  // Pass template name for color calculation
        });
    }
}

/**
 * Helper function to create trays and ports for a shelf node
 */
function createTraysAndPorts(shelfId, hostname, hostIndex, nodeType, config, baseX, baseY, nodesToAdd) {
    /**
     * Create tray and port nodes without positions
     * Positions will be calculated by common_arrangeTraysAndPorts after nodes are added to cytoscape
     * This ensures consistent positioning logic across all modes
     */
    for (let trayNum = 1; trayNum <= config.tray_count; trayNum++) {
        const trayId = `${shelfId}-tray${trayNum}`;

        const trayNode = {
            data: {
                id: trayId,
                parent: shelfId,
                label: `T${trayNum}`,
                type: 'tray',
                tray: trayNum,
                hostname: hostname,
                host_index: hostIndex,
                shelf_node_type: nodeType
            },
            position: { x: 0, y: 0 }, // Placeholder - will be set by common_arrangeTraysAndPorts
            classes: 'tray'
        };
        nodesToAdd.push(trayNode);

        // Create ports
        const portsPerTray = config.ports_per_tray;
        for (let portNum = 1; portNum <= portsPerTray; portNum++) {
            const portId = `${shelfId}-tray${trayNum}-port${portNum}`;

            const portNode = {
                data: {
                    id: portId,
                    parent: trayId,
                    label: `P${portNum}`,
                    type: 'port',
                    tray: trayNum,
                    port: portNum,
                    hostname: hostname,
                    host_index: hostIndex,
                    shelf_node_type: nodeType
                },
                position: { x: 0, y: 0 }, // Placeholder - will be set by common_arrangeTraysAndPorts
                classes: 'port'
            };
            nodesToAdd.push(portNode);
        }
    }
}

function toggleEdgeHandles() {
    const btn = document.getElementById('toggleEdgeHandlesBtn');

    if (!cy) {
        console.error('Cytoscape instance not available');
        return;
    }

    if (btn.textContent.includes('Enable')) {
        // Enable connection creation mode
        isEdgeCreationMode = true;
        btn.textContent = '🔗 Disable Connection Editing';
        btn.style.backgroundColor = '#dc3545';

        // Show delete element section (combined connection and node deletion)
        document.getElementById('deleteElementSection').style.display = 'block';

        // Show add node section
        document.getElementById('addNodeSection').style.display = 'block';

        // Show add graph section
        document.getElementById('addGraphSection').style.display = 'block';

        // Add visual feedback only for available (unconnected) ports
        updatePortEditingHighlight();

        // Show instruction
        alert('Connection editing enabled!\n\n• Click unconnected port → Click another port = Create connection\n• Click connection to select it, then use Delete button or Backspace/Delete key\n• Click deletable nodes (shelf/rack/graph) to select for deletion\n• Click empty space = Cancel selection\n\nNote: Only unconnected ports are highlighted in orange');

    } else {
        // Disable connection creation mode
        isEdgeCreationMode = false;

        // Clear source port selection and remove styling
        if (sourcePort) {
            sourcePort.removeClass('source-selected');
        }
        sourcePort = null;

        btn.textContent = '🔗 Enable Connection Editing';
        btn.style.backgroundColor = '#28a745';

        // Hide delete element section
        document.getElementById('deleteElementSection').style.display = 'none';

        // Hide add node section
        document.getElementById('addNodeSection').style.display = 'none';

        // Hide add graph section
        document.getElementById('addGraphSection').style.display = 'none';

        // Clear any selected connection and remove its styling
        if (selectedConnection) {
            selectedConnection.removeClass('selected-connection');
        }
        selectedConnection = null;

        // Clear any selected node and remove its styling
        if (selectedNode) {
            selectedNode.removeClass('selected-node');
        }
        selectedNode = null;

        // Update delete button state
        updateDeleteButtonState();

        // Remove visual feedback from all ports
        cy.nodes('.port').style({
            'border-width': '2px',
            'border-color': '#666666',
            'border-opacity': 1.0
        });

        // Remove any source port highlighting (redundant but safe)
        cy.nodes('.port').removeClass('source-selected');

        // Remove selected-connection class from all edges
        cy.edges().removeClass('selected-connection');

        // Remove selected-node class from all nodes
        cy.nodes().removeClass('selected-node');
    }
}

function updatePortEditingHighlight() {
    if (!isEdgeCreationMode) return;

    cy.nodes('.port').forEach(port => {
        const portId = port.id();
        const connections = cy.edges(`[source="${portId}"], [target="${portId}"]`);

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

// File upload handlers
// Keep references to old elements for backward compatibility (if they exist)
const uploadSection = document.getElementById('uploadSection');
const csvFile = document.getElementById('csvFile');
const uploadBtn = document.getElementById('uploadBtn');
const loading = document.getElementById('loading');

// New tab-specific elements
const uploadSectionLocation = document.getElementById('uploadSectionLocation');
const csvFileLocation = document.getElementById('csvFileLocation');
const uploadSectionTopology = document.getElementById('uploadSectionTopology');
const csvFileTopology = document.getElementById('csvFileTopology');

// Setup drag-and-drop for Location tab (CSV)
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
        if (files.length > 0 && files[0].name.toLowerCase().endsWith('.csv')) {
            csvFileLocation.files = files;
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

// Fallback: Old drag-and-drop handlers (for backward compatibility)
if (uploadSection && csvFile) {
    uploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSection.classList.add('dragover');
    });

    uploadSection.addEventListener('dragleave', () => {
        uploadSection.classList.remove('dragover');
    });

    uploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSection.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0 && (files[0].name.endsWith('.csv') || files[0].name.endsWith('.textproto'))) {
            csvFile.files = files;
        }
    });

    csvFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            // File selected, button text remains "Generate Visualization"
        }
    });
}

async function uploadFile() {
    const file = csvFile.files[0];

    if (!file) {
        showError('Please select a file first.');
        return;
    }

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.textproto')) {
        showError('Please select a CSV or textproto file (must end with .csv or .textproto).');
        return;
    }

    // Reset any global state
    currentData = null;
    selectedConnection = null;
    isEdgeCreationMode = false;

    // Show loading state
    loading.style.display = 'block';
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Processing...';
    hideMessages();

    const formData = new FormData();
    formData.append('csv_file', file);

    try {
        const response = await fetch('/upload_csv', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok && result.success) {
            currentData = result.data;

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
        loading.style.display = 'none';
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Generate Visualization';
    }
}

// Auto-dismiss timer for notification banner
let notificationTimer = null;

function showNotificationBanner(message, type = 'success') {
    const banner = document.getElementById('notificationBanner');
    const content = document.getElementById('notificationContent');
    
    if (!banner || !content) {
        console.log(`${type}:`, message);
        return;
    }
    
    // Clear any existing timer
    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }
    
    // Set content
    content.innerHTML = message;
    
    // Set colors based on type
    if (type === 'success') {
        banner.style.backgroundColor = '#d4edda';
        banner.style.borderLeft = '4px solid #28a745';
        banner.style.color = '#155724';
    } else if (type === 'error') {
        banner.style.backgroundColor = '#f8d7da';
        banner.style.borderLeft = '4px solid #dc3545';
        banner.style.color = '#721c24';
    } else if (type === 'warning') {
        banner.style.backgroundColor = '#fff3cd';
        banner.style.borderLeft = '4px solid #ffc107';
        banner.style.color = '#856404';
    } else if (type === 'info') {
        banner.style.backgroundColor = '#d1ecf1';
        banner.style.borderLeft = '4px solid #17a2b8';
        banner.style.color = '#0c5460';
    }
    
    // Show banner with animation
    banner.style.display = 'block';
    banner.style.animation = 'slideDown 0.3s ease-out';
    
    // Auto-dismiss after appropriate time based on type
    // Errors and warnings stay longer so users have time to read them
    const dismissTime = (type === 'error' || type === 'warning') ? 8000 : 5000;
    notificationTimer = setTimeout(() => {
        hideNotificationBanner();
    }, dismissTime);
}

function hideNotificationBanner() {
    const banner = document.getElementById('notificationBanner');
    if (!banner) return;
    
    // Clear timer
    if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    
    // Animate out
    banner.style.animation = 'slideUp 0.3s ease-out';
    setTimeout(() => {
        banner.style.display = 'none';
    }, 300);
}

function showError(message) {
    // Show in notification banner at top
    showNotificationBanner(message, 'error');
}

function showSuccess(message) {
    // Show in notification banner at top
    showNotificationBanner(message, 'success');
}

function showWarning(message) {
    // Show in notification banner at top
    showNotificationBanner(message, 'warning');
}

function hideMessages() {
    // Hide the notification banner
    hideNotificationBanner();
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
    const isHierarchyMode = visualizationMode === 'hierarchy';

    if (isHierarchyMode) {
        // Show descriptor/hierarchy legend, hide CSV/physical legend
        csvLegend.style.display = 'none';
        descriptorLegend.style.display = 'block';

        // Collect all unique template names from availableGraphTemplates
        const templateNames = new Set();
        
        // Add templates from availableGraphTemplates (including empty ones)
        if (availableGraphTemplates) {
            Object.keys(availableGraphTemplates).forEach(name => {
                templateNames.add(name);
            });
        }
        
        // Also add templates from edges in case some aren't in availableGraphTemplates
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
                    <div style="display: flex; align-items: center; margin: 6px 0;">
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
        console.log('Switched to physical location legend');
    }
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
    const graphNodesInData = data.elements?.filter(e => e.data?.type === 'graph') || [];
    console.log('Graph nodes in data:', graphNodesInData.length);
    graphNodesInData.forEach(g => {
    });

    // Store initial visualization data for reset functionality
    initialVisualizationData = JSON.parse(JSON.stringify(data));
    console.log('Stored initial visualization data for reset');

    // Initialize hierarchy mode state (allows mode switching even without going to location first)
    hierarchyModeState = JSON.parse(JSON.stringify(data));
    console.log('Initialized hierarchy mode state');

    // Ensure currentData has metadata for exports (without breaking position references)
    if (!currentData) {
        // First time loading - set currentData
        currentData = data;
        console.log('Initialized currentData');
    } else if (data.metadata && data.metadata.graph_templates &&
        (!currentData.metadata || !currentData.metadata.graph_templates)) {
        // Data has graph_templates but currentData doesn't - merge metadata only
        if (!currentData.metadata) {
            currentData.metadata = {};
        }
        currentData.metadata.graph_templates = data.metadata.graph_templates;
    }

    // Track initial root template for efficient export decisions
    if (currentData && !currentData.metadata) {
        currentData.metadata = {};
    }
    if (currentData && currentData.metadata) {
        // Find the single top-level graph node from initial import
        const topLevelGraphs = data.elements.filter(el => {
            const elData = el.data || {};
            const elType = elData.type;
            const hasParent = elData.parent;
            return elType === 'graph' && !hasParent;
        });

        if (topLevelGraphs.length === 1) {
            const rootNode = topLevelGraphs[0].data;
            currentData.metadata.initialRootTemplate = rootNode.template_name || 'unknown_template';
            currentData.metadata.initialRootId = rootNode.id;
            currentData.metadata.hasTopLevelAdditions = false;
        } else {
            // Multiple roots on import - already modified, set flag
            currentData.metadata.initialRootTemplate = null;
            currentData.metadata.initialRootId = null;
            currentData.metadata.hasTopLevelAdditions = true;
            console.log(`Multiple top-level nodes on import (${topLevelGraphs.length}) - flagging as modified`);
        }
    }

    // Initialize global host counter based on existing shelf nodes
    const existingShelves = data.elements.filter(el => el.data && el.data.type === 'shelf');
    globalHostCounter = existingShelves.length;
    console.log(`Initialized global host counter: ${globalHostCounter} existing hosts`);

    // Extract available graph templates from metadata (for textproto imports)
    extractGraphTemplates(data);

    // Detect and set visualization mode based on data
    // Skip auto-detection for empty canvases (preserve explicitly-set mode)
    const isEmpty = !data.elements || data.elements.length === 0;
    
    if (!isEmpty) {
        // Check if this is a descriptor/hierarchical import (has graph nodes)
        const hasGraphNodes = data.elements && data.elements.some(el => el.data && el.data.type === 'graph');
        const isDescriptor = data.metadata && data.metadata.file_format === 'descriptor';

        if (hasGraphNodes || isDescriptor) {
            setVisualizationMode('hierarchy');
            console.log('Detected hierarchy mode (descriptor/textproto import)');
        } else {
            setVisualizationMode('location');
            console.log('Detected location mode (CSV import)');
        }
    } else {
        console.log(`Empty canvas - preserving current mode: ${visualizationMode}`);
    }

    // Ensure container has proper dimensions
    if (cyContainer.offsetWidth === 0 || cyContainer.offsetHeight === 0) {
        console.warn('Container has zero dimensions, setting explicit size');
        cyContainer.style.width = '100%';
        cyContainer.style.height = '600px';
    }

    try {
        if (typeof cy !== 'undefined' && cy) {
            // Clear existing elements and add new ones
            console.log('Clearing existing elements and adding new ones');
            cy.elements().remove();
            cy.add(data.elements);

            // Apply drag restrictions
            applyDragRestrictions();

            cy.layout({ name: 'preset' }).run();
            
            // Recalculate host_indices if in hierarchy mode
            if (visualizationMode === 'hierarchy') {
                recalculateHostIndicesForTemplates();
            }
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

            cy = cytoscape({
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

            // Set template-based colors for all imported graph nodes
            cy.nodes('[type="graph"]').forEach(node => {
                const templateName = node.data('template_name');
                if (templateName) {
                    const templateColor = getTemplateColor(templateName);
                    node.data('templateColor', templateColor);
                }
            });

            // Apply JavaScript-based layout based on visualization mode
            const currentMode = getVisualizationMode();
            if (currentMode === 'hierarchy') {
                // Hierarchy mode - use hierarchical layout
                hierarchy_calculateLayout();
                
                // Recalculate host_indices to ensure siblings have consecutive numbering
                // This is important when loading existing files that may have been created
                // before this feature was implemented
                recalculateHostIndicesForTemplates();
            } else {
                // Location mode - apply stacked hall/aisle layout
                location_calculateLayout();
            }

            // Fit viewport to show all content
            cy.fit(null, 50);

            // Apply drag restrictions after layout
            setTimeout(() => {
                applyDragRestrictions();
            }, 100);

            // Debug: Check rendered positions
            setTimeout(() => {
                const graphsInCy = cy.nodes('[type="graph"]');
                graphsInCy.forEach(g => {
                    const pos = g.position();
                    const bb = g.boundingBox();
                });
            }, 500);

            // Initialize expand-collapse extension
            if (cy.expandCollapse) {
                console.log('✓ Initializing cytoscape-expand-collapse extension');
                window.api = cy.expandCollapse({
                    layoutBy: null,  // Disable automatic layout - use preset positions
                    fisheye: false,
                    animate: true,
                    animationDuration: 300,
                    undoable: false,
                    cueEnabled: true,  // Enable cues - will be filtered by isCollapsible
                    expandCollapseCuePosition: 'top-left',
                    expandCollapseCueSize: 12,
                    expandCollapseCueLineSize: 8,
                    expandCueImage: undefined,
                    collapseCueImage: undefined,
                    expandCollapseCueSensitivity: 1,
                    // Check if node is collapsible - allow hall, aisle, rack, shelf (but not tray or port)
                    isCollapsible: function (node) {
                        const nodeType = node.data('type');
                        return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
                    },
                    // Prevent expansion/collapse of non-allowed types
                    allowNestedEdgeCollapse: false
                });
                // Wrap the collapse and expand methods to prevent disallowed nodes (extra safety)
                if (window.api) {
                    const originalCollapse = window.api.collapse;
                    const originalExpand = window.api.expand;

                    window.api.collapse = function (nodes) {
                        // Filter to only allowed node types (hall, aisle, rack, shelf)
                        const filtered = cy.collection(nodes).filter(function (node) {
                            const nodeType = node.data('type');
                            return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
                        });
                        if (filtered.length > 0) {
                            return originalCollapse.call(this, filtered);
                        }
                    };

                    window.api.expand = function (nodes) {
                        // Filter to only allowed node types (hall, aisle, rack, shelf)
                        const filtered = cy.collection(nodes).filter(function (node) {
                            const nodeType = node.data('type');
                            return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
                        });
                        if (filtered.length > 0) {
                            return originalExpand.call(this, filtered);
                        }
                    };
                }

                // Update button states after initialization (everything is expanded on import)
                setTimeout(() => {
                    updateExpandCollapseButtons();
                }, 500); // Longer delay to ensure all nodes fully rendered and initialized
            } else {
                console.warn('⚠ cytoscape-expand-collapse extension not available. Expand/collapse features will not work.');
            }

            // Add event handlers for new instance
            addCytoscapeEventHandlers();
        }

        console.log('Cytoscape instance ready:', cy);
        console.log('Nodes count:', cy.nodes().length);
        console.log('Edges count:', cy.edges().length);

        // Verify all cytoscape extensions are loaded and available
        verifyCytoscapeExtensions();

        // Apply drag restrictions
        applyDragRestrictions();

        // Apply final curve styling
        setTimeout(() => {
            forceApplyCurveStyles();
            updatePortConnectionStatus();
        }, 100);

        // Initialize delete button state
        updateDeleteButtonState();

        // Add remaining event handlers (only for new instances)
        if (typeof cy !== 'undefined' && cy && !window.cytoscapeEventHandlersAdded) {
            addConnectionTypeEventHandlers();
            window.cytoscapeEventHandlersAdded = true;
        }

        // Populate node filter dropdown
        populateNodeFilterDropdown();

        console.log('Cytoscape initialization complete');
    } catch (error) {
        console.error('Error initializing Cytoscape:', error);
    }
}

function forceApplyCurveStyles() {
    if (typeof cy === 'undefined' || !cy) return;

    const edges = cy.edges();
    const viewport = cy.extent();
    const viewportWidth = viewport.w;
    const viewportHeight = viewport.h;
    const baseDistance = Math.min(viewportWidth, viewportHeight) * 0.05; // 5% of smaller viewport dimension

    cy.startBatch();

    edges.forEach(function (edge) {
        const sourceNode = edge.source();
        const targetNode = edge.target();
        const sourcePos = sourceNode.position();
        const targetPos = targetNode.position();

        const sourceId = sourceNode.id();
        const targetId = targetNode.id();
        const isSameShelf = checkSameShelf(sourceId, targetId);

        if (isSameShelf) {
            // Same shelf - use bezier curves with viewport-based distance
            const dx = targetPos.x - sourcePos.x;
            const dy = targetPos.y - sourcePos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Scale curve distance based on connection length and viewport
            let curveMultiplier;
            curveMultiplier = (Math.sqrt(distance) * 0.05);

            const curveDistance = `${Math.round(baseDistance * curveMultiplier)}px`;

            edge.style({
                'curve-style': 'unbundled-bezier',
                'control-point-distances': [curveDistance],
                'control-point-weights': [0.5]
            });
        } else {
            // Different shelf - use straight edges
            edge.style({
                'curve-style': 'straight'
            });
        }
    });

    cy.endBatch();

    // Force render to ensure z-index changes take effect
    cy.forceRender();
}

function checkSameShelf(sourceId, targetId) {
    if (typeof cy === 'undefined' || !cy) return false;

    const sourceNode = cy.getElementById(sourceId);
    const targetNode = cy.getElementById(targetId);

    if (!sourceNode.length || !targetNode.length) {
        return false;
    }

    // Get parent 2 levels up (port -> tray -> shelf)
    const sourceShelf = getParentAtLevel(sourceNode, 2);
    const targetShelf = getParentAtLevel(targetNode, 2);

    return sourceShelf && targetShelf && sourceShelf.id() === targetShelf.id();
}

function getParentAtLevel(node, level) {
    let currentNode = node;
    for (let i = 0; i < level; i++) {
        const parent = currentNode.parent();
        if (!parent.length) return null;
        currentNode = parent;
    }
    return currentNode;
}

function getCytoscapeStyles() {
    return [
        // Basic edge styles - high z-index to ensure above all nodes
        {
            selector: 'edge',
            style: {
                'width': 3,
                'line-color': 'data(color)',
                'line-opacity': 1,
                'curve-style': 'unbundled-bezier',
                'control-point-distances': ['100px'],
                'control-point-weights': [0.5],
                'z-index': 1000,
                'z-compound-depth': 'top'
            }
        },

        // Selected edge styles - highest z-index
        {
            selector: 'edge:selected',
            style: {
                'width': 4,
                'line-color': 'data(color)',
                'line-opacity': 1,
                'z-index': 2000,
                'z-compound-depth': 'top'
            }
        },

        // Style for new connections being created
        {
            selector: '.new-connection',
            style: {
                'line-color': '#ff6600',
                'width': 4,
                'line-style': 'dashed',
                'opacity': 0.8,
                'z-index': 200
            }
        },

        // Style for selected connection (for deletion)
        {
            selector: '.selected-connection',
            style: {
                'line-color': '#ff0000',
                'width': 5,
                'line-opacity': 1,
                'z-index': 190,
                'overlay-color': '#ff0000',
                'overlay-opacity': 0.3,
                'overlay-padding': 3
            }
        },

        // Style for selected node (for deletion)
        {
            selector: '.selected-node',
            style: {
                'border-color': '#ff0000',
                'border-width': '4px',
                'border-style': 'solid',
                'overlay-color': '#ff0000',
                'overlay-opacity': 0.2,
                'overlay-padding': 5
            }
        },

        // Style for source port selection during connection creation
        {
            selector: '.port.source-selected',
            style: {
                'background-color': '#00ff00',
                'border-color': '#00aa00',
                'border-width': '4px'
            }
        },

        // Style for ports that already have connections
        {
            selector: '.port.connected-port',
            style: {
                'background-color': '#ffcccc',
                'border-color': '#cc0000',
                'border-width': '2px'
            }
        },

        // Graph styles - top-level containers for superpods (NO auto-positioning!)
        // Base graph style
        {
            selector: '.graph',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#fff0f0',
                'background-opacity': 0.3,
                'border-width': 5,
                'border-color': '#cc0000',
                'border-opacity': 1.0,
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'font-size': 24,
                'font-weight': 'bold',
                'color': '#cc0000',
                'text-background-color': '#ffffff',
                'text-background-opacity': 0.95,
                'text-border-width': 2,
                'text-border-color': '#cc0000',
                'padding': 20,  // Padding for children
                'z-index': 0
                // Removed min-width and min-height to allow full auto-sizing
            }
        },

        // Template-based coloring (overrides depth-based colors)
        // Use templateColor data attribute if present
        {
            selector: '.graph[templateColor]',
            style: {
                'border-color': 'data(templateColor)',
                'color': 'data(templateColor)',
                'text-border-color': 'data(templateColor)'
            }
        },

        // REMOVED: All depth-based coloring selectors
        // Now using pure template-based coloring via templateColor data attribute

        // Hall styles - top-level location containers
        {
            selector: '.hall',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#b0b0b0',
                'background-opacity': 0.4,
                'border-width': 6,
                'border-color': '#333333',
                'border-opacity': 0.8,
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'font-size': 28,
                'font-weight': 'bold',
                'color': '#000000',
                'text-background-color': '#ffffff',
                'text-background-opacity': 0.95,
                'text-border-width': 2,
                'text-border-color': '#333333',
                'padding': 60,
                'z-index': 1
            }
        },

        // Aisle styles - mid-level location containers within halls (legacy selector)
        {
            selector: '.aisle',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#4da6ff',
                'background-opacity': 0.7,
                'border-width': 5,
                'border-color': '#0066cc',
                'border-opacity': 1.0,
                'border-style': 'solid',
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 10,
                'font-size': 26,
                'font-weight': 'bold',
                'color': '#000000',
                'text-background-color': '#ffffff',
                'text-background-opacity': 1.0,
                'text-background-padding': 8,
                'text-border-width': 2,
                'text-border-color': '#0066cc',
                'padding': 10,
                'z-index': 1
            }
        },

        // Hall styles - largest containers with gray theme
        {
            selector: 'node[type="hall"]',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#b0b0b0',
                'background-opacity': 0.4,
                'border-width': 5,
                'border-color': '#333333',
                'border-opacity': 1.0,
                'border-style': 'solid',
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 10,
                'font-size': 26,
                'font-weight': 'bold',
                'color': '#000000',
                'text-background-color': '#ffffff',
                'text-background-opacity': 1.0,
                'text-background-padding': 8,
                'text-border-width': 2,
                'text-border-color': '#333333',
                'padding': 10,
                'z-index': 0
            }
        },

        // Aisle styles - second-level containers with bright blue theme
        {
            selector: 'node[type="aisle"]',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#4da6ff',
                'background-opacity': 0.7,
                'border-width': 5,
                'border-color': '#0066cc',
                'border-opacity': 1.0,
                'border-style': 'solid',
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 10,
                'font-size': 26,
                'font-weight': 'bold',
                'color': '#000000',
                'text-background-color': '#ffffff',
                'text-background-opacity': 1.0,
                'text-background-padding': 8,
                'text-border-width': 2,
                'text-border-color': '#0066cc',
                'padding': 10,
                'z-index': 0
            }
        },

        // Rack styles - small containers with gray theme
        {
            selector: '.rack',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#a0a0a0',
                'background-opacity': 0.6,
                'border-width': 5,
                'border-color': '#555555',
                'border-opacity': 1.0,
                'border-style': 'solid',
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 10,
                'font-size': 26,
                'font-weight': 'bold',
                'color': '#000000',
                'text-background-color': '#ffffff',
                'text-background-opacity': 1.0,
                'text-background-padding': 8,
                'text-border-width': 2,
                'text-border-color': '#555555',
                'padding': 10,
                'z-index': 1,
                'min-width': 100,
                'min-height': 100
            }
        },

        // Shelf unit styles - medium containers with blue theme
        {
            selector: '.shelf',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#cce7ff',
                'background-opacity': 0.6,
                'border-width': 3,
                'border-color': '#0066cc',
                'border-opacity': 1.0,
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'left',
                'text-margin-x': 10,  // Left padding for label
                'text-margin-y': 8,   // Top padding for label
                'font-size': 16,
                'font-weight': 'bold',
                'color': '#003366',
                'text-background-color': '#ffffff',
                'text-background-opacity': 0.9,
                'text-background-padding': 4,  // Padding around text background for legibility
                'text-border-width': 1,
                'text-border-color': '#0066cc',
                'padding': 3,
                'z-index': 1
                // Removed fixed min-width and min-height to allow auto-sizing
            }
        },

        // Tray styles - small containers with gray theme
        {
            selector: '.tray',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#f0f0f0',
                'background-opacity': 0.8,
                'border-width': 2,
                'border-color': '#666666',
                'border-opacity': 1.0,
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'left',
                'text-margin-x': 6,   // Left padding for label
                'text-margin-y': 6,   // Top padding for label
                'font-size': 14,
                'font-weight': 'bold',
                'color': '#333333',
                'text-background-color': '#ffffff',
                'text-background-opacity': 0.9,
                'text-background-padding': 3,  // Padding around text background for legibility
                'text-border-width': 1,
                'text-border-color': '#666666',
                'padding': 2,
                'z-index': 1
                // Removed fixed min-width and min-height to allow auto-sizing
            }
        },

        // Port styles - leaf nodes with distinct rectangular appearance
        {
            selector: '.port',
            style: {
                'shape': 'rectangle',
                'background-color': '#ffffff',
                'border-width': 2,
                'border-color': '#000000',
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'font-size': 12,
                'font-weight': 'bold',
                'color': '#000000',
                'width': '35px',
                'height': '25px',
                'z-index': 1
            }
        },

        // Collapsed compound node style - smaller size for compact view
        {
            selector: '.cy-expand-collapse-collapsed-node',
            style: {
                'background-color': '#e8e8e8',
                'border-color': '#666',
                'border-width': 3,
                'border-style': 'dashed',
                'label': 'data(label)',
                'font-size': 12,
                'font-weight': 'bold',
                'text-valign': 'center',
                'text-halign': 'center',
                'shape': 'roundrectangle',
                'width': '120px',
                'height': '60px',
                'padding': 2
                // Removed min-width and min-height to allow full auto-sizing
            }
        },

        // Selected state - visual highlighting only
        {
            selector: ':selected',
            style: {
                'overlay-color': '#ff0000',
                'overlay-opacity': 0.3,
                'overlay-padding': 5
            }
        }
    ];
}

function addCytoscapeEventHandlers() {
    // Node click handler for info display and port connection creation
    cy.on('tap', 'node', function (evt) {
        const node = evt.target;

        // Handle port clicks
        if (node.hasClass('port')) {
            if (isEdgeCreationMode) {
                handlePortClickEditMode(node, evt);
            } else {
                handlePortClickViewMode(node, evt);
            }
        } else {
            // Non-port node clicked
            const nodeType = node.data('type');
            const isDeletable = ['shelf', 'rack', 'graph'].includes(nodeType);

            // Clear connection selection when clicking on any non-port node
            if (selectedConnection) {
                selectedConnection.removeClass('selected-connection');
                selectedConnection = null;
                updateDeleteButtonState();
            }

            // In editing mode, allow selection of deletable nodes
            if (isEdgeCreationMode && isDeletable) {
                // Deselect previously selected node
                if (selectedNode) {
                    selectedNode.removeClass('selected-node');
                }

                // Select this node
                selectedNode = node;
                node.addClass('selected-node');
                updateDeleteNodeButtonState();
            } else {
                // Clear node selection if not in editing mode or not deletable
                if (selectedNode) {
                    selectedNode.removeClass('selected-node');
                    selectedNode = null;
                    updateDeleteNodeButtonState();
                }
            }

            showNodeInfo(node, evt.renderedPosition || evt.position);
        }
    });

    // Double-click handler for inline editing of shelf node details OR collapse/expand compound nodes
    cy.on('dbltap', 'node', function (evt) {
        const node = evt.target;
        const data = node.data();
        const nodeType = data.type;

        // Handle tray and port double-clicks (no collapse, no action)
        if (nodeType === 'tray' || nodeType === 'port') {
            // Do nothing for tray or port double-clicks
            return;
        }

        // For shelf nodes: allow editing on first double-click, collapse on subsequent
        if (nodeType === 'shelf') {
            // Check if shelf is in edit mode
            const isEditing = node.data('isEditing');
            if (!isEditing) {
                // First double-click: enable editing
                enableShelfEditing(node, evt.renderedPosition || evt.position);
                return;
            } else {
                // Already editing: allow collapse if desired (or just return)
                // For now, don't collapse while editing
                return;
            }
        }

        // For graph template nodes: allow editing in hierarchy mode
        const graphTypes = ['graph', 'pod', 'superpod', 'cluster', 'zone', 'region'];
        if (graphTypes.includes(nodeType) && getVisualizationMode() === 'hierarchy') {
            // Check if graph template is in edit mode
            const isEditing = node.data('isEditing');
            if (!isEditing) {
                // First double-click: enable template name editing
                enableGraphTemplateEditing(node, evt.renderedPosition || evt.position);
                return;
            } else {
                // Already editing: don't collapse while editing
                return;
            }
        }

        // Allow collapse/expand for compound nodes (graph, hall, aisle, rack, shelf)
        if (node.isParent() && window.api) {
            // Whitelist collapsible types
            if (nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf') {
                toggleNodeCollapse(node);
                return;
            }
        }
    });

    // Edge click handler for connection selection and info display
    cy.on('tap', 'edge', function (evt) {
        const edge = evt.target;
        const position = evt.renderedPosition || evt.position;

        // Clear source port selection if clicking on an edge (editing mode only)
        if (isEdgeCreationMode && sourcePort) {
            sourcePort.removeClass('source-selected');
            sourcePort = null;
        }

        // Clear node selection when clicking on an edge
        if (selectedNode) {
            selectedNode.removeClass('selected-node');
            selectedNode = null;
            updateDeleteNodeButtonState();
        }

        // Deselect previously selected connection (works in both editing and normal mode)
        if (selectedConnection) {
            selectedConnection.removeClass('selected-connection');
        }

        // Select this connection (works in both editing and normal mode)
        selectedConnection = edge;
        edge.addClass('selected-connection');

        // Update delete button state (only relevant in editing mode)
        if (isEdgeCreationMode) {
            updateDeleteButtonState();
        }

        // Show connection info annotation for any edge click (editing mode or not)
        showConnectionInfo(edge, position);
    });

    // Click on background to hide info, deselect connection, and clear source port
    cy.on('tap', function (evt) {
        if (evt.target === cy) {
            clearAllSelections();
        }
    });
}

function addConnectionTypeEventHandlers() {
    // Add event listeners to connection type checkboxes
    const checkboxes = [
        'showIntraNodeConnections',
        'showIntraRackConnections',
        'showInterRackConnections'
    ];

    checkboxes.forEach(function (checkboxId) {
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
            checkbox.addEventListener('change', function () {
                // Reapply the current filter when checkbox changes
                const rangeInput = document.getElementById('connectionRangeString');
                if (rangeInput.value.trim() !== '') {
                    applyConnectionRange();
                } else {
                    // If no range filter is active, just apply type filter to all connections
                    applyConnectionTypeFilter();
                }
            });
        }
    });

    // Add event listener to node filter dropdown
    const nodeFilterSelect = document.getElementById('nodeFilterSelect');
    if (nodeFilterSelect) {
        nodeFilterSelect.addEventListener('change', function () {
            // Reapply the current filter when node selection changes
            const rangeInput = document.getElementById('connectionRangeString');
            if (rangeInput.value.trim() !== '') {
                applyConnectionRange();
            } else {
                // If no range filter is active, just apply node filter to all connections
                applyNodeFilter();
            }
        });
    }
}

function applyConnectionTypeFilter() {
    if (typeof cy === 'undefined' || !cy) {
        return;
    }

    // Get connection type filter settings
    const showIntraNode = document.getElementById('showIntraNodeConnections').checked;
    const showIntraRack = document.getElementById('showIntraRackConnections').checked;
    const showInterRack = document.getElementById('showInterRackConnections').checked;

    // Get all edges
    const allEdges = cy.edges();
    let visibleCount = 0;
    let hiddenCount = 0;

    // Filter edges based on connection type only
    allEdges.forEach(function (edge) {
        const sourceNode = edge.source();
        const targetNode = edge.target();

        // Get the parent shelf/node for both endpoints
        const sourceParent = getParentShelfNode(sourceNode);
        const targetParent = getParentShelfNode(targetNode);

        // Determine connection types using hierarchy traversal
        const isIntraNode = sourceParent && targetParent && sourceParent.id() === targetParent.id();

        // For rack-level filtering, get rack numbers from parent shelf nodes
        const sourceRack = sourceParent ? (sourceParent.data('rack_num') || sourceParent.data('rack') || 0) : 0;
        const targetRack = targetParent ? (targetParent.data('rack_num') || targetParent.data('rack') || 0) : 0;
        const isIntraRack = sourceRack === targetRack && sourceRack > 0 && !isIntraNode; // Intra-rack but not intra-node
        const isInterRack = sourceRack !== targetRack && sourceRack > 0 && targetRack > 0;

        // Check if connection should be visible based on type
        let shouldShowByType = false;
        if (isIntraNode && showIntraNode) shouldShowByType = true;
        if (isIntraRack && showIntraRack) shouldShowByType = true;
        if (isInterRack && showInterRack) shouldShowByType = true;

        if (shouldShowByType) {
            edge.style('display', 'element');
            visibleCount++;
        } else {
            edge.style('display', 'none');
            hiddenCount++;
        }
    });

    // Update status
    const statusDiv = document.getElementById('rangeStatus');
    statusDiv.textContent = `Showing ${visibleCount} connections (${hiddenCount} hidden by type filter)`;
    statusDiv.style.color = '#28a745';
}

function getParentShelfNode(node) {
    // Go up 2 levels: port -> tray -> shelf
    let currentNode = node;
    for (let i = 0; i < 2; i++) {
        const parent = currentNode.parent();
        if (!parent || !parent.length) {
            return null;
        }
        currentNode = parent;
    }
    return currentNode;
}

function applyNodeFilter() {
    if (typeof cy === 'undefined' || !cy) {
        return;
    }

    // Get selected node
    const nodeFilterSelect = document.getElementById('nodeFilterSelect');
    const selectedNodeId = nodeFilterSelect.value;

    // Get all edges
    const allEdges = cy.edges();
    let visibleCount = 0;
    let hiddenCount = 0;

    if (selectedNodeId === '') {
        // Show all connections
        allEdges.forEach(function (edge) {
            edge.style('display', 'element');
            visibleCount++;
        });
    } else {
        // Filter connections involving the selected node
        allEdges.forEach(function (edge) {
            const sourceNode = edge.source();
            const targetNode = edge.target();

            // Get the parent shelf/node for both endpoints (go up 2 levels: port -> tray -> shelf)
            const sourceParent = getParentShelfNode(sourceNode);
            const targetParent = getParentShelfNode(targetNode);

            // Check if either parent matches the selected node
            if (sourceParent && sourceParent.id() === selectedNodeId ||
                targetParent && targetParent.id() === selectedNodeId) {
                edge.style('display', 'element');
                visibleCount++;
            } else {
                edge.style('display', 'none');
                hiddenCount++;
            }
        });
    }

    // Update status
    const statusDiv = document.getElementById('rangeStatus');
    if (selectedNodeId === '') {
        statusDiv.textContent = `Showing all connections (${visibleCount} total)`;
        statusDiv.style.color = '#666';
    } else {
        const selectedNode = cy.getElementById(selectedNodeId);
        const nodeLabel = selectedNode.data('label') || selectedNodeId;
        statusDiv.textContent = `Showing connections for "${nodeLabel}" (${visibleCount} visible, ${hiddenCount} hidden)`;
        statusDiv.style.color = '#28a745';
    }
}

function populateNodeFilterDropdown() {
    if (typeof cy === 'undefined' || !cy) {
        return;
    }

    const nodeFilterSelect = document.getElementById('nodeFilterSelect');
    if (!nodeFilterSelect) {
        return;
    }

    // Clear existing options
    nodeFilterSelect.innerHTML = '<option value="">Show all nodes</option>';

    // Check if this is a descriptor/hierarchical import
    const isDescriptor = cy.nodes().some(node => node.data('type') === 'graph');

    // Get all shelf nodes (main nodes, not trays or ports)
    const shelfNodes = cy.nodes().filter(function (node) {
        const nodeType = node.data('type');
        return nodeType === 'shelf' || nodeType === 'node';
    });

    // Build array of options with labels for sorting
    const options = [];
    shelfNodes.forEach(function (node) {
        const nodeId = node.id();
        const nodeData = node.data();
        let nodeLabel;

        if (isDescriptor) {
            // For hierarchical imports, show full path (e.g., "superpod1 > node2 > n300_lb (host_0)")
            nodeLabel = hierarchy_getPath(node);
        } else {
            // For CSV imports, use the standard display label
            nodeLabel = getNodeDisplayLabel(nodeData);
        }

        options.push({ value: nodeId, label: nodeLabel });
    });

    // Sort options alphabetically by label
    options.sort((a, b) => a.label.localeCompare(b.label));

    // Add sorted options to dropdown
    options.forEach(function (opt) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        nodeFilterSelect.appendChild(option);
    });
}

function showNodeInfo(node, position) {
    // Clear isEditing flag from all nodes when showing regular info
    if (cy) {
        cy.nodes().forEach(function (n) {
            if (n.data('isEditing')) {
                n.data('isEditing', false);
            }
        });
    }
    
    const data = node.data();
    const nodeInfo = document.getElementById('nodeInfo');
    const content = document.getElementById('nodeInfoContent');

    let html = `<strong>${data.label || data.id}</strong><br>`;
    html += `Type: ${data.type || 'Unknown'}<br>`;

    // Determine current visualization mode
    const currentMode = getVisualizationMode();
    
    // Physical location constructs (hall, aisle, rack) should only show location info, not hierarchy info
    const isPhysicalConstruct = (data.type === 'hall' || data.type === 'aisle' || data.type === 'rack');
    
    // Graph hierarchy nodes (in hierarchy mode)
    const isGraphHierarchyNode = (data.type === 'graph' || data.type === 'superpod' || 
                                  data.type === 'pod' || data.type === 'cluster') && 
                                  currentMode === 'hierarchy';

    if (isGraphHierarchyNode && node.isParent()) {
        html += `<br><strong>Graph Hierarchy Info:</strong><br>`;

        // Show template name if available
        if (data.template_name) {
            html += `Template: ${data.template_name}<br>`;
        }

        // Show node type (the actual type field)
        if (data.type) {
            html += `Node Type: ${data.type}<br>`;
        }

        // Show label
        if (data.label) {
            html += `Label: ${data.label}<br>`;
        }

        // Show child count
        const childCount = node.children().length;
        html += `Children: ${childCount}<br>`;

        // Show depth in hierarchy
        let depth = 0;
        let current = node;
        while (current.parent().length > 0) {
            depth++;
            current = current.parent();
        }
        html += `Hierarchy Depth: ${depth}<br>`;

        // Show child_name if available
        if (data.child_name) {
            html += `Child Name: ${data.child_name}<br>`;
        }
    }
    // Show location information for physical location constructs (hall, aisle, rack)
    else if (isPhysicalConstruct) {
        // Show child count with appropriate label
        const childCount = node.children().length;
        if (childCount > 0) {
            if (data.type === 'hall') {
                html += `Aisles: ${childCount}<br>`;
            } else if (data.type === 'aisle') {
                html += `Racks: ${childCount}<br>`;
            } else if (data.type === 'rack') {
                html += `Shelves: ${childCount}<br>`;
            }
        }
        
        // Show physical location info
        html += `<br><strong>Physical Location:</strong><br>`;
        if (data.type === 'hall') {
            if (data.hall !== undefined && data.hall !== '') html += `Hall: ${data.hall}<br>`;
        } else if (data.type === 'aisle') {
            if (data.hall !== undefined && data.hall !== '') html += `Hall: ${data.hall}<br>`;
            if (data.aisle !== undefined && data.aisle !== '') html += `Aisle: ${data.aisle}<br>`;
        } else if (data.type === 'rack') {
            if (data.hall !== undefined && data.hall !== '') html += `Hall: ${data.hall}<br>`;
            if (data.aisle !== undefined && data.aisle !== '') html += `Aisle: ${data.aisle}<br>`;
            if (data.rack_num !== undefined) html += `Rack Number: ${data.rack_num}<br>`;
        }
    }
    // Show location information based on available data
    else if (data.type === 'shelf' || data.type === 'node') {
        // Determine if we're in logical topology mode (hierarchy) or physical location mode
        const isLogicalMode = visualizationMode === 'hierarchy';
        
        // In physical mode, show physical location info
        if (!isLogicalMode) {
            if (data.rack_num !== undefined && data.shelf_u !== undefined) {
                // 20-column format: show Hostname, Hall, Aisle, Rack, Shelf_U info
                html += `<br><strong>Location:</strong><br>`;
                if (data.hostname !== undefined && data.hostname !== '') html += `Hostname: ${data.hostname}<br>`;
                if (data.hall !== undefined && data.hall !== '') html += `Hall: ${data.hall}<br>`;
                if (data.aisle !== undefined && data.aisle !== '') html += `Aisle: ${data.aisle}<br>`;
                html += `Rack: ${data.rack_num}<br>`;
                html += `Shelf U: ${data.shelf_u}<br>`;
            } else if (data.hostname !== undefined && data.hostname !== '') {
                // 8-column format: show hostname info
                html += `<br><strong>Location:</strong><br>`;
                html += `Hostname: ${data.hostname}<br>`;
            }
        } else {
            // In logical mode, show template position instead of hostname
            if (data.child_name) {
                html += `<br><strong>Template Position:</strong> ${data.child_name}<br>`;
            }
            // Show logical path if available
            if (data.logical_path && Array.isArray(data.logical_path) && data.logical_path.length > 0) {
                html += `<strong>Logical Path:</strong> ${data.logical_path.join(' → ')}<br>`;
            }
        }

        // Show node type if available
        if (data.shelf_node_type) {
            html += `Node Type: ${data.shelf_node_type.toUpperCase()}<br>`;
        }
        
        // Show host_index if available
        if (data.host_index !== undefined) {
            html += `Host Index: host_${data.host_index}<br>`;
        }
    } else {
        // For other node types (tray, port), show hierarchical location with individual fields
        const locationData = location_getNodeData(node);
        const isLogicalMode = visualizationMode === 'hierarchy';

        html += `<br><strong>Location:</strong><br>`;
        // Only show hostname in physical mode
        if (!isLogicalMode && locationData.hostname) html += `Hostname: ${locationData.hostname}<br>`;
        if (locationData.hall) html += `Hall: ${locationData.hall}<br>`;
        if (locationData.aisle) html += `Aisle: ${locationData.aisle}<br>`;
        if (locationData.rack_num !== undefined) html += `Rack: ${locationData.rack_num}<br>`;
        if (locationData.shelf_u !== undefined) html += `Shelf U: ${locationData.shelf_u}<br>`;
        if (data.tray !== undefined) html += `Tray: ${data.tray}<br>`;
        if (data.port !== undefined) html += `Port: ${data.port}<br>`;

        // Add Eth_Channel Mapping for ports
        if (data.type === 'port') {
            let nodeType = data.shelf_node_type;
            if (!nodeType) {
                const shelfNode = node.parent().parent();
                if (shelfNode && shelfNode.length > 0) {
                    nodeType = shelfNode.data('shelf_node_type');
                }
            }

            const ethChannel = getEthChannelMapping(nodeType, data.port);
            html += `Eth_Channel Mapping: ${ethChannel}<br>`;
        }
    }

    content.innerHTML = html;
    
    // Position popup in top-right corner of the window
    nodeInfo.style.right = '10px';
    nodeInfo.style.top = '10px';
    nodeInfo.style.left = 'auto';
    nodeInfo.style.display = 'block';
}

function hideNodeInfo() {
    document.getElementById('nodeInfo').style.display = 'none';
}

function showConnectionInfo(edge, position) {
    /**
     * Show detailed information about a connection
     * Always shows full path regardless of collapsed state
     * @param {Object} edge - Cytoscape edge element
     * @param {Object} position - Position to display the info panel
     */
    const nodeInfo = document.getElementById('nodeInfo');
    const content = document.getElementById('nodeInfoContent');

    const edgeData = edge.data();
    // Always use the original port IDs from edge data, not the visual source/target
    // which might point to collapsed parents
    const sourceNode = cy.getElementById(edgeData.source);
    const targetNode = cy.getElementById(edgeData.target);

    // Get detailed location info for both endpoints - always full path
    const sourceInfo = getPortLocationInfo(sourceNode);
    const targetInfo = getPortLocationInfo(targetNode);

    // Build HTML content
    let html = `<strong>Connection Details</strong><br><br>`;

    html += `<strong>Source:</strong><br>`;
    html += `${sourceInfo}<br><br>`;

    html += `<strong>Target:</strong><br>`;
    html += `${targetInfo}<br><br>`;

    // Show cable information
    html += `<strong>Cable Info:</strong><br>`;
    html += `Type: ${edgeData.cable_type || 'Unknown'}<br>`;
    html += `Length: ${edgeData.cable_length || 'Unknown'}<br>`;

    // Show connection number if available
    if (edgeData.connection_number !== undefined) {
        html += `Connection #: ${edgeData.connection_number}<br>`;
    }

    content.innerHTML = html;

    // Position popup in top-right corner of the window
    nodeInfo.style.right = '10px';
    nodeInfo.style.top = '10px';
    nodeInfo.style.left = 'auto';
    nodeInfo.style.display = 'block';
}


function enableShelfEditing(node, position) {
    // Clear isEditing flag from all other nodes first
    if (cy) {
        cy.nodes().forEach(function (n) {
            if (n.id() !== node.id() && n.data('isEditing')) {
                n.data('isEditing', false);
            }
        });
    }
    
    const data = node.data();
    const nodeInfo = document.getElementById('nodeInfo');
    const content = document.getElementById('nodeInfoContent');

    // Check visualization mode
    const isHierarchyMode = getVisualizationMode() === 'hierarchy';

    // Create editing interface for all shelf fields
    let html = `<strong>Edit Shelf Node</strong><br>`;
    html += `Node: ${data.label || data.id}<br>`;

    html += `<br>`;

    if (isHierarchyMode) {
        // In hierarchy mode, show move to template section
        html += `<div style="margin-bottom: 15px; padding: 10px; background: #e7f3ff; border-radius: 4px;">`;
        html += `<strong>Move to Different Template:</strong><br>`;
        html += `<select id="moveTargetTemplateSelect" style="width: 200px; padding: 5px; margin-top: 5px;">`;
        html += `<option value="">-- Select Target Template --</option>`;
        html += `</select>`;
        html += `<br>`;
        html += `<button onclick="executeMoveToTemplate('${node.id()}')" style="padding: 6px 12px; background: #007bff; color: white; border: none; cursor: pointer; margin-top: 8px;">Move Node</button>`;
        html += `</div>`;
        
        html += `<div style="margin-top: 15px;">`;
        html += `<button onclick="cancelShelfEdit()" style="padding: 8px 15px; background: #6c757d; color: white; border: none; cursor: pointer;">Close</button>`;
        html += `</div>`;
    } else {
        // In location mode, show all editable fields
        html += `<div style="margin-bottom: 10px;">`;
        html += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hostname:</label>`;
        html += `<input type="text" id="hostnameEditInput" value="${data.hostname || ''}" placeholder="Enter hostname" style="width: 200px; padding: 5px;">`;
        html += `</div>`;

        html += `<div style="margin-bottom: 10px;">`;
        html += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hall:</label>`;
        html += `<input type="text" id="hallEditInput" value="${data.hall || ''}" placeholder="Enter hall" style="width: 200px; padding: 5px;">`;
        html += `</div>`;

        html += `<div style="margin-bottom: 10px;">`;
        html += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Aisle:</label>`;
        html += `<input type="text" id="aisleEditInput" value="${data.aisle || ''}" placeholder="Enter aisle" style="width: 200px; padding: 5px;">`;
        html += `</div>`;

        html += `<div style="margin-bottom: 10px;">`;
        html += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Rack:</label>`;
        html += `<input type="number" id="rackEditInput" value="${data.rack_num || ''}" placeholder="Enter rack number" style="width: 200px; padding: 5px;">`;
        html += `</div>`;

        html += `<div style="margin-bottom: 10px;">`;
        html += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Shelf U:</label>`;
        html += `<input type="number" id="shelfUEditInput" value="${data.shelf_u || ''}" placeholder="Enter shelf U" style="width: 200px; padding: 5px;">`;
        html += `</div>`;

        html += `<br>`;
        html += `<button onclick="saveShelfEdit('${node.id()}')" style="background: #007bff; color: white; border: none; padding: 8px 15px; margin-right: 5px; cursor: pointer;">Save</button>`;
        html += `<button onclick="cancelShelfEdit()" style="background: #6c757d; color: white; border: none; padding: 8px 15px; cursor: pointer;">Cancel</button>`;
    }

    content.innerHTML = html;

    // Position popup in top-right corner of the window
    nodeInfo.style.right = '10px';
    nodeInfo.style.top = '10px';
    nodeInfo.style.left = 'auto';
    nodeInfo.style.display = 'block';
    
    // Mark as editing
    node.data('isEditing', true);

    if (isHierarchyMode) {
        // Populate the move target template dropdown
        populateMoveTargetTemplates(node);
    } else {
        // Focus on the hostname input field (only in location mode)
        setTimeout(() => {
            const input = document.getElementById('hostnameEditInput');
            if (input) {
                input.focus();
                input.select();
            }
        }, 100);
    }
}

/**
 * Helper function to update a node and all its descendants with a new property value
 * @param {Object} node - Cytoscape node
 * @param {string} property - Property name to update
 * @param {*} value - New value for the property
 */
function updateNodeAndDescendants(node, property, value) {
    node.data(property, value);
    node.descendants().forEach(function (child) {
        child.data(property, value);
    });
}

// Make functions globally accessible for onclick handlers
window.saveShelfEdit = function (nodeId) {
    const hostnameInput = document.getElementById('hostnameEditInput');
    const hallInput = document.getElementById('hallEditInput');
    const aisleInput = document.getElementById('aisleEditInput');
    const rackInput = document.getElementById('rackEditInput');
    const shelfUInput = document.getElementById('shelfUEditInput');

    const newHostname = hostnameInput.value.trim();
    // Location inputs may not exist in hierarchy mode
    const newHall = hallInput ? hallInput.value.trim() : '';
    const newAisle = aisleInput ? aisleInput.value.trim() : '';
    const newRack = rackInput && rackInput.value ? parseInt(rackInput.value) : undefined;
    const newShelfU = shelfUInput && shelfUInput.value ? parseInt(shelfUInput.value) : undefined;

    // Get the node to check for changes
    const node = cy.getElementById(nodeId);
    const oldHostname = node.data('hostname') || '';
    const oldHall = node.data('hall') || '';
    const oldAisle = node.data('aisle') || '';
    const oldRack = node.data('rack_num');
    const oldShelfU = node.data('shelf_u');

    // Check if at least one field has changed
    const hostnameChanged = newHostname !== oldHostname;
    const hallChanged = newHall !== oldHall;
    const aisleChanged = newAisle !== oldAisle;
    const rackChanged = newRack !== oldRack && newRack !== undefined;
    const shelfUChanged = newShelfU !== oldShelfU && newShelfU !== undefined;

    if (!hostnameChanged && !hallChanged && !aisleChanged && !rackChanged && !shelfUChanged) {
        alert('No changes detected. Please modify at least one field.');
        return;
    }

    // Check if hostname already exists on another node (if hostname changed)
    if (hostnameChanged && newHostname) {
        let hostnameExists = false;
        cy.nodes().forEach(function (n) {
            if (n.id() !== nodeId && n.data('hostname') === newHostname) {
                hostnameExists = true;
            }
        });

        if (hostnameExists) {
            alert(`Hostname "${newHostname}" already exists on another node. Please choose a different hostname.`);
            return;
        }
    }

    // Update the node data only with changed values
    if (hostnameChanged) {
        updateNodeAndDescendants(node, 'hostname', newHostname);

        // CRITICAL FIX: Update edge data for all connections from this shelf's ports
        // This ensures exports use the updated hostname instead of stale edge data
        node.descendants('[type="port"]').forEach(function (portNode) {
            // Update all edges connected to this port
            portNode.connectedEdges().forEach(function (edge) {
                const sourceId = edge.data('source');
                const targetId = edge.data('target');

                // Update source_hostname if this port is the source
                if (sourceId === portNode.id()) {
                    edge.data('source_hostname', newHostname);
                }

                // Update destination_hostname if this port is the target
                if (targetId === portNode.id()) {
                    edge.data('destination_hostname', newHostname);
                }
            });
        });
    }
    if (hallChanged) {
        updateNodeAndDescendants(node, 'hall', newHall);
    }
    if (aisleChanged) {
        updateNodeAndDescendants(node, 'aisle', newAisle);
    }
    if (rackChanged) {
        updateNodeAndDescendants(node, 'rack_num', newRack);
    }
    if (shelfUChanged) {
        updateNodeAndDescendants(node, 'shelf_u', newShelfU);
    }

    // Update the node label - use the current state of the node after updates
    let newLabel;
    const currentHostname = node.data('hostname') || '';
    const currentHall = node.data('hall') || '';
    const currentAisle = node.data('aisle') || '';
    const currentRack = node.data('rack_num');
    const currentShelfU = node.data('shelf_u');

    // Prefer hostname for display label, fall back to location format
    if (currentHostname) {
        newLabel = currentHostname;
    } else if (currentHall && currentAisle && currentRack !== undefined && currentShelfU !== undefined) {
        newLabel = location_buildLabel(currentHall, currentAisle, currentRack, currentShelfU);
    } else if (currentShelfU !== undefined) {
        newLabel = `Shelf ${currentShelfU}`;
    } else {
        newLabel = node.data('label'); // Keep existing label
    }
    node.data('label', newLabel);

    // Update node filter dropdown since label/hostname may have changed
    populateNodeFilterDropdown();

    // Handle rack change - move shelf to new rack if rack number changed
    const parent = node.parent();
    if (rackChanged && currentRack !== undefined) {
        // Need to move this shelf to a different rack
        const newRackId = `rack_${currentRack.toString().padStart(2, '0')}`;
        let newRackNode = cy.getElementById(newRackId);

        // If the new rack doesn't exist, create it
        if (newRackNode.length === 0) {
            const rackLabel = `Rack ${currentRack}`;

            // Calculate position for new rack - place it relative to existing racks
            let newRackX = 0;
            let newRackY = 0;
            const existingRacks = cy.nodes('[type="rack"]');

            if (existingRacks.length > 0) {
                // Position new rack to the right of the rightmost rack
                let maxX = -Infinity;
                existingRacks.forEach(function (rack) {
                    const rackPos = rack.position();
                    if (rackPos.x > maxX) {
                        maxX = rackPos.x;
                        newRackY = rackPos.y; // Use same Y as existing racks
                    }
                });
                newRackX = maxX + 500; // 500px spacing between racks (450 width + 50 spacing)
            } else {
                // First rack - place at a reasonable starting position
                newRackX = LAYOUT_CONSTANTS.NEW_RACK_DEFAULT_X;
                newRackY = LAYOUT_CONSTANTS.NEW_RACK_DEFAULT_Y;
            }

            cy.add({
                group: 'nodes',
                data: {
                    id: newRackId,
                    label: rackLabel,
                    type: 'rack',
                    rack_num: currentRack,
                    hall: currentHall,
                    aisle: currentAisle
                },
                classes: 'rack',
                position: {
                    x: newRackX,
                    y: newRackY
                }
            });
            newRackNode = cy.getElementById(newRackId);
        } else {
            // Update existing rack's label and data
            if (currentHall && currentAisle) {
                newRackNode.data('label', `Rack ${currentRack} (${currentHall}-${currentAisle})`);
                newRackNode.data('hall', currentHall);
                newRackNode.data('aisle', currentAisle);
            }
        }

        // Move the shelf node to the new rack
        node.move({ parent: newRackId });

        // Update all child nodes (trays and ports) with the new rack_num
        node.descendants().forEach(function (child) {
            if (rackChanged) child.data('rack_num', currentRack);
            if (hallChanged && currentHall) child.data('hall', currentHall);
            if (aisleChanged && currentAisle) child.data('aisle', currentAisle);
        });
    } else if (parent && parent.length > 0 && parent.data('type') === 'rack') {
        // Just update parent rack label if hall/aisle changed (but not rack number)
        if (hallChanged || aisleChanged) {
            const rackNum = node.data('rack_num');
            const hall = node.data('hall');
            const aisle = node.data('aisle');

            if (hall && aisle && rackNum !== undefined) {
                parent.data('label', `Rack ${rackNum} (${hall}-${aisle})`);
                parent.data('hall', hall);
                parent.data('aisle', aisle);
            }

            // Update all child nodes (trays and ports) with the new hall/aisle
            node.descendants().forEach(function (child) {
                if (hallChanged && currentHall) child.data('hall', currentHall);
                if (aisleChanged && currentAisle) child.data('aisle', currentAisle);
            });
        }
    }

    // If rack or shelf_u changed in location mode, automatically reset layout to properly reposition nodes
    // In hierarchy mode, location changes don't affect the visualization layout
    const mode = getVisualizationMode();
    if ((rackChanged || shelfUChanged) && mode === 'location') {
        // Hide the editing interface first
        hideNodeInfo();

        // Call resetLayout to recalculate positions
        // Use setTimeout to ensure the DOM updates are complete
        setTimeout(function () {
            resetLayout();
        }, 100);
    } else {
        // Hide the editing interface
        hideNodeInfo();

        // Show success message
        showExportStatus('Shelf node updated successfully', 'success');
    }
};

window.cancelShelfEdit = function () {
    // Clear isEditing flag on all nodes
    if (cy) {
        cy.nodes().forEach(function (n) {
            if (n.data('isEditing')) {
                n.data('isEditing', false);
            }
        });
    }
    hideNodeInfo();
};

function enableGraphTemplateEditing(node, position) {
    // Clear isEditing flag from all other nodes first
    if (cy) {
        cy.nodes().forEach(function (n) {
            if (n.id() !== node.id() && n.data('isEditing')) {
                n.data('isEditing', false);
            }
        });
    }
    
    const data = node.data();
    const nodeInfo = document.getElementById('nodeInfo');
    const content = document.getElementById('nodeInfoContent');

    // Create editing interface with options
    let html = `<strong>Manage ${data.type === 'shelf' ? 'Node' : 'Graph Instance'}</strong><br>`;
    html += `Label: ${data.label || data.id}<br>`;
    html += `Type: ${data.type || 'Unknown'}<br>`;
    if (data.template_name) {
        html += `Template: ${data.template_name}<br>`;
    }
    html += `<br>`;

    // Rename Template section (only for graph nodes)
    if (data.type === 'graph') {
        html += `<div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">`;
        html += `<strong>Rename Template:</strong><br>`;
        html += `<input type="text" id="templateNameEditInput" value="${data.template_name || ''}" placeholder="Enter template name" style="width: 200px; padding: 5px; margin-top: 5px;">`;
        html += `<br>`;
        html += `<button onclick="saveGraphTemplateEdit('${node.id()}')" style="padding: 6px 12px; background: #4CAF50; color: white; border: none; cursor: pointer; margin-top: 8px;">Rename Template</button>`;
        html += `</div>`;
    }

    // Move to Template section
    html += `<div style="margin-bottom: 15px; padding: 10px; background: #e7f3ff; border-radius: 4px;">`;
    html += `<strong>Move to Different Template:</strong><br>`;
    html += `<select id="moveTargetTemplateSelect" style="width: 200px; padding: 5px; margin-top: 5px;">`;
    html += `<option value="">-- Select Target Template --</option>`;
    // Will be populated by enumerateValidParentTemplates
    html += `</select>`;
    html += `<br>`;
    html += `<button onclick="executeMoveToTemplate('${node.id()}')" style="padding: 6px 12px; background: #007bff; color: white; border: none; cursor: pointer; margin-top: 8px;">Move Instance</button>`;
    html += `</div>`;

    html += `<div style="margin-top: 15px;">`;
    html += `<button onclick="cancelGraphTemplateEdit('${node.id()}')" style="padding: 8px 15px; background: #6c757d; color: white; border: none; cursor: pointer;">Close</button>`;
    html += `</div>`;

    content.innerHTML = html;

    // Position popup in top-right corner of the window
    nodeInfo.style.right = '10px';
    nodeInfo.style.top = '10px';
    nodeInfo.style.left = 'auto';
    nodeInfo.style.display = 'block';

    // Mark node as being edited
    node.data('isEditing', true);

    // Populate the move target dropdown
    populateMoveTargetTemplates(node);
}

window.saveGraphTemplateEdit = function (nodeId) {
    const templateNameInput = document.getElementById('templateNameEditInput');
    const newTemplateName = templateNameInput.value.trim();

    // Get the node
    const node = cy.getElementById(nodeId);
    const oldTemplateName = node.data('template_name') || '';

    // Check if template name has changed
    if (newTemplateName === oldTemplateName) {
        showNotificationBanner('No changes detected. Please modify the template name.', 'warning');
        return;
    }

    // Validate template name (not empty)
    if (!newTemplateName) {
        showNotificationBanner('Template name cannot be empty.', 'error');
        return;
    }

    // Find all nodes that use this template and update their template_name and labels
    let updatedCount = 0;
    const newColor = getTemplateColor(newTemplateName);
    cy.nodes().forEach(function (n) {
        if (n.data('template_name') === oldTemplateName) {
            // Update template_name
            n.data('template_name', newTemplateName);
            
            // Update templateColor if it exists
            if (n.data('templateColor') !== undefined) {
                n.data('templateColor', newColor);
            }
            
            // Update the label (instance name)
            const currentLabel = n.data('label') || '';
            
            // Instance names typically follow pattern: template_name_index
            // We need to replace the template prefix while keeping the suffix
            if (currentLabel.startsWith(oldTemplateName)) {
                // Extract the suffix (e.g., "_1", "_2", etc.)
                const suffix = currentLabel.substring(oldTemplateName.length);
                const newLabel = newTemplateName + suffix;
                n.data('label', newLabel);
                updatedCount++;
            } else {
                // If label doesn't match expected pattern, just update template_name
                updatedCount++;
            }
        }
    });

    // Update edges that have the old template_name and their colors
    let updatedEdgeCount = 0;
    cy.edges().forEach(function (edge) {
        if (edge.data('template_name') === oldTemplateName) {
            edge.data('template_name', newTemplateName);
            // Update the color to match the new template name
            edge.data('color', newColor);
            updatedEdgeCount++;
        }
    });
    
    // Force style update to apply new colors
    cy.style().update();

    // Update availableGraphTemplates if this template exists
    if (availableGraphTemplates && availableGraphTemplates[oldTemplateName]) {
        // Rename the template in availableGraphTemplates
        availableGraphTemplates[newTemplateName] = availableGraphTemplates[oldTemplateName];
        delete availableGraphTemplates[oldTemplateName];
        
        // Update the template dropdown if it exists
        const graphTemplateSelect = document.getElementById('graphTemplateSelect');
        if (graphTemplateSelect) {
            // Rebuild the dropdown
            const currentValue = graphTemplateSelect.value;
            graphTemplateSelect.innerHTML = '<option value="">-- Select a Template --</option>';
            
            Object.keys(availableGraphTemplates).sort().forEach(templateName => {
                const option = document.createElement('option');
                option.value = templateName;
                option.textContent = templateName;
                graphTemplateSelect.appendChild(option);
            });
            
            // Try to maintain selection
            if (currentValue === oldTemplateName) {
                graphTemplateSelect.value = newTemplateName;
            } else {
                graphTemplateSelect.value = currentValue;
            }
        }
    }
    
    // Also update currentData.metadata.graph_templates for export
    if (currentData && currentData.metadata && currentData.metadata.graph_templates && currentData.metadata.graph_templates[oldTemplateName]) {
        currentData.metadata.graph_templates[newTemplateName] = currentData.metadata.graph_templates[oldTemplateName];
        delete currentData.metadata.graph_templates[oldTemplateName];
    }

    // Refresh the connection legend to reflect the new template name
    if (currentData) {
        updateConnectionLegend(currentData);
    }

    // Clear editing flag
    node.data('isEditing', false);

    // Hide the editing interface
    hideNodeInfo();

    // Show success message with count
    showExportStatus(`Graph template name updated successfully (${updatedCount} instance${updatedCount !== 1 ? 's' : ''}, ${updatedEdgeCount} connection${updatedEdgeCount !== 1 ? 's' : ''} updated)`, 'success');
};

window.cancelGraphTemplateEdit = function (nodeId) {
    // Get the node and clear editing flag
    const node = cy.getElementById(nodeId);
    if (node) {
        node.data('isEditing', false);
    }
    hideNodeInfo();
};

/**
 * Populate the dropdown with valid parent templates for moving
 */
function populateMoveTargetTemplates(node) {
    const select = document.getElementById('moveTargetTemplateSelect');
    if (!select) return;
    
    const nodeType = node.data('type');
    const nodeTemplateName = node.data('template_name');
    const childName = node.data('child_name');
    
    // Get list of valid parent templates
    const validTemplates = enumerateValidParentTemplates(node);
    
    // Clear and rebuild dropdown
    select.innerHTML = '<option value="">-- Select Target Template --</option>';
    
    if (validTemplates.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '(No valid targets available)';
        option.disabled = true;
        select.appendChild(option);
    } else {
        validTemplates.forEach(templateInfo => {
            const option = document.createElement('option');
            option.value = templateInfo.templateName;
            option.textContent = `${templateInfo.templateName} (${templateInfo.instanceCount} instance${templateInfo.instanceCount !== 1 ? 's' : ''})`;
            select.appendChild(option);
        });
    }
}

/**
 * Enumerate valid parent templates for moving a node or graph instance
 * Returns templates that:
 * - Are not descendants of this node (no circular dependencies)
 * - Are not the current parent
 * - Actually exist in availableGraphTemplates
 */
function enumerateValidParentTemplates(node) {
    const validTemplates = [];
    const nodeType = node.data('type');
    const nodeTemplateName = node.data('template_name');
    
    if (!availableGraphTemplates) return validTemplates;
    
    // Get current parent template
    const currentParent = node.parent();
    const currentParentTemplate = currentParent.length > 0 ? currentParent.data('template_name') : null;
    
    // Get all descendants' template names to avoid circular dependencies
    const descendantTemplates = new Set();
    if (nodeType === 'graph') {
        node.descendants('[type="graph"]').forEach(desc => {
            const descTemplate = desc.data('template_name');
            if (descTemplate) {
                descendantTemplates.add(descTemplate);
            }
        });
    }
    
    // Check each available template
    Object.keys(availableGraphTemplates).forEach(templateName => {
        // Skip if this is the current parent
        if (templateName === currentParentTemplate) {
            return;
        }
        
        // Skip if this would create a circular dependency
        if (nodeType === 'graph' && descendantTemplates.has(templateName)) {
            return;
        }
        
        // Skip if this is the node's own template (can't move into itself)
        if (templateName === nodeTemplateName) {
            return;
        }
        
        // Count instances of this template
        const instanceCount = cy.nodes().filter(n => 
            n.data('template_name') === templateName && n.data('type') === 'graph'
        ).length;
        
        validTemplates.push({
            templateName: templateName,
            instanceCount: instanceCount
        });
    });
    
    // Sort by template name
    validTemplates.sort((a, b) => a.templateName.localeCompare(b.templateName));
    
    return validTemplates;
}

/**
 * Execute the move operation to transfer an instance to a different template
 */
window.executeMoveToTemplate = function(nodeId) {
    const node = cy.getElementById(nodeId);
    const select = document.getElementById('moveTargetTemplateSelect');
    const targetTemplateName = select.value;
    
    if (!targetTemplateName) {
        showNotificationBanner('Please select a target template.', 'error');
        return;
    }
    
    const nodeType = node.data('type');
    const nodeTemplateName = node.data('template_name');
    const childName = node.data('child_name');
    const nodeLabel = node.data('label');
    
    // Confirm the operation
    if (!confirm(`Move "${nodeLabel}" to template "${targetTemplateName}"?\n\nThis will:\n• Remove it from current parent template\n• Add it to ${targetTemplateName}\n• Update all instances`)) {
        return;
    }
    
    try {
        // Get current parent info
        const currentParent = node.parent();
        const currentParentTemplate = currentParent.length > 0 ? currentParent.data('template_name') : null;
        
        if (nodeType === 'shelf') {
            // Moving a node (shelf)
            moveNodeToTemplate(node, targetTemplateName, currentParentTemplate);
        } else if (nodeType === 'graph') {
            // Moving a graph instance
            moveGraphInstanceToTemplate(node, targetTemplateName, currentParentTemplate);
        }
        
        // Close the popup
        hideNodeInfo();
        node.data('isEditing', false);
        
        // Recalculate layout
        hierarchy_calculateLayout();
        
        showExportStatus(`Successfully moved "${nodeLabel}" to template "${targetTemplateName}"`, 'success');
        
    } catch (error) {
        console.error('Error moving instance:', error);
        alert(`Failed to move instance: ${error.message}`);
    }
};

/**
 * Move a node (shelf) to a different template
 */
function moveNodeToTemplate(node, targetTemplateName, currentParentTemplate) {
    const childName = node.data('child_name');
    const nodeType = node.data('shelf_node_type');
    
    // Step 1: Remove from current parent template definition
    if (currentParentTemplate && availableGraphTemplates[currentParentTemplate]) {
        const template = availableGraphTemplates[currentParentTemplate];
        if (template.children) {
            template.children = template.children.filter(child => child.name !== childName);
        }
    }
    
    // Also remove from currentData.metadata.graph_templates
    if (currentParentTemplate && currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const metaTemplate = currentData.metadata.graph_templates[currentParentTemplate];
        if (metaTemplate && metaTemplate.children) {
            metaTemplate.children = metaTemplate.children.filter(child => child.name !== childName);
        }
    }
    
    // Step 2: Add to target template definition
    if (availableGraphTemplates[targetTemplateName]) {
        const targetTemplate = availableGraphTemplates[targetTemplateName];
        if (!targetTemplate.children) {
            targetTemplate.children = [];
        }
        targetTemplate.children.push({
            name: childName,
            type: 'node',
            node_descriptor: nodeType
        });
    }
    
    // Also add to currentData.metadata.graph_templates
    if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const metaTargetTemplate = currentData.metadata.graph_templates[targetTemplateName];
        if (metaTargetTemplate) {
            if (!metaTargetTemplate.children) {
                metaTargetTemplate.children = [];
            }
            metaTargetTemplate.children.push({
                name: childName,
                type: 'node',
                node_descriptor: nodeType
            });
        }
    }
    
    // Step 3: Remove the original node and from all instances of old parent template
    // First, remove the specific node that was selected
    node.remove();
    
    // Then remove from all other instances of the old parent template
    if (currentParentTemplate) {
        const oldParentInstances = cy.nodes().filter(n => 
            n.data('template_name') === currentParentTemplate && n.data('type') === 'graph'
        );
        
        oldParentInstances.forEach(parentInstance => {
            const childNodeId = `${parentInstance.id()}_${childName}`;
            const childNode = cy.getElementById(childNodeId);
            if (childNode.length > 0) {
                // Remove the node and all its descendants (trays, ports)
                childNode.remove();
            }
        });
    }
    
    // Step 4: Add to all instances of target template
    const targetInstances = cy.nodes().filter(n => 
        n.data('template_name') === targetTemplateName && n.data('type') === 'graph'
    );
    
    targetInstances.forEach(targetInstance => {
        // Create the node in this instance
        const config = NODE_CONFIGS[nodeType];
        if (!config) {
            console.warn(`Unknown node type: ${nodeType}`);
            return;
        }
        
        const hostIndex = globalHostCounter++;
        const shelfId = `${targetInstance.id()}_${childName}`;
        const shelfLabel = `${childName} (host_${hostIndex})`;
        
        // Add shelf node
        cy.add({
            group: 'nodes',
            data: {
                id: shelfId,
                parent: targetInstance.id(),
                label: shelfLabel,
                type: 'shelf',
                host_index: hostIndex,
                shelf_node_type: nodeType,
                child_name: childName
            },
            classes: 'shelf',
            position: { x: 0, y: 0 }
        });
        
        // Create trays and ports
        const nodesToAdd = [];
        createTraysAndPorts(shelfId, childName, hostIndex, nodeType, config, 0, 0, nodesToAdd);
        cy.add(nodesToAdd);
        
        // Arrange trays and ports
        const addedShelf = cy.getElementById(shelfId);
        common_arrangeTraysAndPorts(addedShelf);
    });
    
    // Recalculate host indices
    recalculateHostIndicesForTemplates();
}

/**
 * Move a graph instance to a different template
 */
function moveGraphInstanceToTemplate(node, targetTemplateName, currentParentTemplate) {
    const childName = node.data('child_name');
    const graphTemplateName = node.data('template_name');
    
    // Step 1: Remove from current parent template definition
    if (currentParentTemplate && availableGraphTemplates[currentParentTemplate]) {
        const template = availableGraphTemplates[currentParentTemplate];
        if (template.children) {
            template.children = template.children.filter(child => child.name !== childName);
        }
    }
    
    // Also remove from currentData.metadata.graph_templates
    if (currentParentTemplate && currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const metaTemplate = currentData.metadata.graph_templates[currentParentTemplate];
        if (metaTemplate && metaTemplate.children) {
            metaTemplate.children = metaTemplate.children.filter(child => child.name !== childName);
        }
    }
    
    // Step 2: Add to target template definition
    if (availableGraphTemplates[targetTemplateName]) {
        const targetTemplate = availableGraphTemplates[targetTemplateName];
        if (!targetTemplate.children) {
            targetTemplate.children = [];
        }
        targetTemplate.children.push({
            name: childName,
            type: 'graph',
            graph_template: graphTemplateName
        });
    }
    
    // Also add to currentData.metadata.graph_templates
    if (currentData && currentData.metadata && currentData.metadata.graph_templates) {
        const metaTargetTemplate = currentData.metadata.graph_templates[targetTemplateName];
        if (metaTargetTemplate) {
            if (!metaTargetTemplate.children) {
                metaTargetTemplate.children = [];
            }
            metaTargetTemplate.children.push({
                name: childName,
                type: 'graph',
                graph_template: graphTemplateName
            });
        }
    }
    
    // Step 3: Remove the original graph instance and from all instances of old parent template
    // First, remove the specific graph instance that was selected
    node.remove();
    
    // Then remove from all other instances of the old parent template
    if (currentParentTemplate) {
        const oldParentInstances = cy.nodes().filter(n => 
            n.data('template_name') === currentParentTemplate && n.data('type') === 'graph'
        );
        
        oldParentInstances.forEach(parentInstance => {
            const childGraphId = `${parentInstance.id()}_${childName}`;
            const childGraph = cy.getElementById(childGraphId);
            if (childGraph.length > 0) {
                // Remove the graph and all its descendants
                childGraph.remove();
            }
        });
    }
    
    // Step 4: Add to all instances of target template  
    const targetInstances = cy.nodes().filter(n => 
        n.data('template_name') === targetTemplateName && n.data('type') === 'graph'
    );
    
    const graphTemplate = availableGraphTemplates[graphTemplateName];
    if (!graphTemplate) {
        throw new Error(`Template "${graphTemplateName}" not found`);
    }
    
    targetInstances.forEach(targetInstance => {
        const nodesToAdd = [];
        const edgesToAdd = [];
        const deferredConnections = [];
        
        const childGraphId = `${targetInstance.id()}_${childName}`;
        const childGraphLabel = childName;
        const parentDepth = targetInstance.data('depth') || 0;
        
        // Instantiate the template recursively
        instantiateTemplateRecursive(
            graphTemplate,
            graphTemplateName,
            childGraphId,
            childGraphLabel,
            'graph',
            targetInstance.id(),
            0,
            0,
            nodesToAdd,
            edgesToAdd,
            {},
            deferredConnections,
            childName,
            parentDepth
        );
        
        // Add nodes
        cy.add(nodesToAdd);
        
        // Arrange trays and ports for newly added shelves
        nodesToAdd.forEach(nodeData => {
            if (nodeData.data && nodeData.data.type === 'shelf') {
                const shelfNode = cy.getElementById(nodeData.data.id);
                if (shelfNode && shelfNode.length > 0) {
                    common_arrangeTraysAndPorts(shelfNode);
                }
            }
        });
        
        // Process deferred connections
        processDeferredConnections(deferredConnections, edgesToAdd);
        cy.add(edgesToAdd);
    });
    
    // Recalculate host indices
    recalculateHostIndicesForTemplates();
}

function parseConnectionRangeString(rangeString) {
    // Parse a range string like "1-3,5,7-10" into an array of connection numbers
    if (!rangeString || rangeString.trim() === '') {
        return [];
    }

    const connectionNumbers = new Set();
    const parts = rangeString.split(',');

    for (let part of parts) {
        part = part.trim();

        if (part === '') continue;

        if (part.includes('-')) {
            // Handle range (e.g., "1-3" or "7-10")
            const rangeParts = part.split('-');
            if (rangeParts.length !== 2) {
                throw new Error(`Invalid range format: "${part}". Use format like "1-3".`);
            }

            const start = parseInt(rangeParts[0].trim());
            const end = parseInt(rangeParts[1].trim());

            if (isNaN(start) || isNaN(end)) {
                throw new Error(`Invalid numbers in range: "${part}". Both start and end must be numbers.`);
            }

            if (start < 1 || end < 1) {
                throw new Error(`Connection numbers must be at least 1: "${part}".`);
            }

            if (start > end) {
                throw new Error(`Invalid range: "${part}". Start must be less than or equal to end.`);
            }

            // Add all numbers in the range
            for (let i = start; i <= end; i++) {
                connectionNumbers.add(i);
            }
        } else {
            // Handle individual number (e.g., "5")
            const num = parseInt(part);
            if (isNaN(num)) {
                throw new Error(`Invalid number: "${part}". Must be a valid integer.`);
            }

            if (num < 1) {
                throw new Error(`Connection number must be at least 1: "${part}".`);
            }

            connectionNumbers.add(num);
        }
    }

    return Array.from(connectionNumbers).sort((a, b) => a - b);
}

function applyConnectionRange() {
    if (typeof cy === 'undefined' || !cy) {
        showError('Please upload and generate a visualization first.');
        return;
    }

    const rangeInput = document.getElementById('connectionRangeString');
    const statusDiv = document.getElementById('rangeStatus');
    const rangeString = rangeInput.value.trim();

    // If empty, show all connections
    if (rangeString === '') {
        clearConnectionRange();
        return;
    }

    let connectionNumbers;
    try {
        connectionNumbers = parseConnectionRangeString(rangeString);
    } catch (error) {
        showError(`Range format error: ${error.message}`);
        return;
    }

    if (connectionNumbers.length === 0) {
        showError('No valid connection numbers found in range string.');
        return;
    }

    // Get all edges
    const allEdges = cy.edges();
    const totalConnections = allEdges.length;

    // Check if any requested connections exceed total
    const maxRequested = Math.max(...connectionNumbers);
    if (maxRequested > totalConnections) {
        showError(`Connection number ${maxRequested} exceeds total connections (${totalConnections}).`);
        return;
    }

    // Convert array to Set for faster lookup
    const connectionSet = new Set(connectionNumbers);
    let visibleCount = 0;
    let hiddenCount = 0;

    // Get connection type filter settings
    const showIntraNode = document.getElementById('showIntraNodeConnections').checked;
    const showIntraRack = document.getElementById('showIntraRackConnections').checked;
    const showInterRack = document.getElementById('showInterRackConnections').checked;

    // Get node filter setting
    const nodeFilterSelect = document.getElementById('nodeFilterSelect');
    const selectedNodeId = nodeFilterSelect ? nodeFilterSelect.value : '';

    // Filter edges based on connection number, connection type, and node filter
    allEdges.forEach(function (edge) {
        const connectionNumber = parseInt(edge.data('connection_number')) || 0;
        const isIntraNode = edge.data('is_intra_host') === true;
        const sourceRack = edge.source().data('rack_num') || 0;
        const targetRack = edge.target().data('rack_num') || 0;
        const isIntraRack = sourceRack === targetRack && sourceRack > 0;
        const isInterRack = sourceRack !== targetRack && sourceRack > 0 && targetRack > 0;

        // Check if connection should be visible based on type
        let shouldShowByType = false;
        if (isIntraNode && showIntraNode) shouldShowByType = true;
        if (isIntraRack && showIntraRack) shouldShowByType = true;
        if (isInterRack && showInterRack) shouldShowByType = true;

        // Check if connection should be visible based on node filter
        let shouldShowByNode = true;
        if (selectedNodeId !== '') {
            const sourceId = edge.source().id();
            const targetId = edge.target().id();
            shouldShowByNode = (sourceId === selectedNodeId || targetId === selectedNodeId);
        }

        // Show if it matches range, type, and node filters
        if (connectionSet.has(connectionNumber) && shouldShowByType && shouldShowByNode) {
            edge.style('display', 'element');
            visibleCount++;
        } else {
            edge.style('display', 'none');
            hiddenCount++;
        }
    });

    // Create a readable summary of the range
    const rangeSummary = createRangeSummary(connectionNumbers);

    statusDiv.textContent = `Showing connections: ${rangeSummary} (${visibleCount} visible, ${hiddenCount} hidden)`;
    statusDiv.style.color = '#28a745';
}

function createRangeSummary(numbers) {
    // Create a human-readable summary of connection numbers
    if (numbers.length === 0) return 'none';
    if (numbers.length === 1) return numbers[0].toString();

    // Group consecutive numbers into ranges
    const ranges = [];
    let start = numbers[0];
    let end = numbers[0];

    for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] === end + 1) {
            // Consecutive number, extend the range
            end = numbers[i];
        } else {
            // Gap found, close current range and start new one
            if (start === end) {
                ranges.push(start.toString());
            } else {
                ranges.push(`${start}-${end}`);
            }
            start = end = numbers[i];
        }
    }

    // Add the final range
    if (start === end) {
        ranges.push(start.toString());
    } else {
        ranges.push(`${start}-${end}`);
    }

    return ranges.join(', ');
}

function clearConnectionRange() {
    if (typeof cy === 'undefined' || !cy) {
        return;
    }

    // Show all edges
    const allEdges = cy.edges();
    allEdges.forEach(function (edge) {
        edge.style('display', 'element');
    });

    // Clear input value
    document.getElementById('connectionRangeString').value = '';

    // Update status
    const statusDiv = document.getElementById('rangeStatus');
    statusDiv.textContent = `Showing all connections (${allEdges.length} total)`;
    statusDiv.style.color = '#666';
}

/**
 * Validate that all shelf nodes have hostnames
 * @returns {Array} Array of node labels that are missing hostnames (empty if all valid)
 */
function validateHostnames() {
    const nodesWithoutHostname = [];
    cy.nodes().forEach(function (node) {
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
    const topLevelGraphs = cy.nodes('[type="graph"]').filter(node => {
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
        const cytoscapeData = {
            elements: cy.elements().jsons(),
            metadata: {
                ...currentData?.metadata,  // Include original metadata (graph_templates, etc.)
                visualization_mode: getVisualizationMode()  // Override/add current mode
            }
        };

        // Debug logging
        if (cytoscapeData.metadata?.graph_templates) {
        } else {
        }

        // Send to server for processing
        const response = await fetch('/export_cabling_descriptor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(cytoscapeData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Export failed');
        }

        // Get the textproto content
        const textprotoContent = await response.text();

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

        // Get current cytoscape data
        const cytoscapeData = {
            elements: cy.elements().jsons()
        };

        // Send to server for processing
        const response = await fetch('/export_deployment_descriptor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(cytoscapeData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Export failed');
        }

        // Get the textproto content
        const textprotoContent = await response.text();

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

        // Get current cytoscape data
        const cytoscapeData = {
            elements: cy.elements().jsons()
        };

        // Get input prefix for the generator
        const customFileName = document.getElementById('exportFileNameInput').value.trim();
        const inputPrefix = customFileName || 'network_topology';

        // Send to server for processing
        const response = await fetch('/generate_cabling_guide', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cytoscape_data: cytoscapeData,
                input_prefix: inputPrefix,
                generate_type: 'cabling_guide'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(formatErrorMessage(errorData));
        }

        const result = await response.json();

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

        // Get current cytoscape data
        const cytoscapeData = {
            elements: cy.elements().jsons()
        };

        // Get input prefix for the generator
        const customFileName = document.getElementById('exportFileNameInput').value.trim();
        const inputPrefix = customFileName || 'network_topology';

        // Send to server for processing
        const response = await fetch('/generate_cabling_guide', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cytoscape_data: cytoscapeData,
                input_prefix: inputPrefix,
                generate_type: 'fsd'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(formatErrorMessage(errorData));
        }

        const result = await response.json();

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

// Add keyboard shortcuts for range filtering
document.addEventListener('keydown', function (event) {
    // Ctrl+Enter or Cmd+Enter to apply range
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        const rangeInput = document.getElementById('connectionRangeString');

        // Check if range input is focused
        if (document.activeElement === rangeInput) {
            event.preventDefault();
            applyConnectionRange();
        }
    }

    // Escape to clear range, selections, and close popups
    if (event.key === 'Escape') {
        const rangeInput = document.getElementById('connectionRangeString');

        // If range input is focused, clear it
        if (document.activeElement === rangeInput) {
            event.preventDefault();
            clearConnectionRange();
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
        if (isEdgeCreationMode && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            // Check if there's something selected to delete
            if ((selectedConnection && selectedConnection.length > 0) ||
                (selectedNode && selectedNode.length > 0)) {
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

// Expand/Collapse Functions - Level-by-Level
function expandOneLevel() {
    /**
     * Expand one level of the hierarchy
     * Finds the shallowest visible collapsed level and expands all nodes at that level
     * This allows progressively revealing the hierarchy from root outward
     */
    if (!cy || !window.api) {
        console.error('Cytoscape or expand-collapse API not available');
        return;
    }

    // Get all collapsed compound nodes (using API) - include hall, aisle, rack, shelf
    const allCollapsedNodes = window.api.expandableNodes().filter(node => {
        const nodeType = node.data('type');
        return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
    });

    // Filter to only visible collapsed nodes (not inside a collapsed parent)
    const visibleCollapsedNodes = allCollapsedNodes.filter(node => {
        // Check if this node is visible (not inside a collapsed parent)
        let parent = node.parent();
        while (parent && parent.length > 0) {
            // Check if parent is in the collapsed list
            const parentCollapsed = allCollapsedNodes.some(n => n.id() === parent.id());
            if (parentCollapsed) {
                return false; // This node is hidden inside a collapsed parent
            }
            parent = parent.parent();
        }
        return true; // This node is visible
    });

    if (visibleCollapsedNodes.length === 0) {
        showExportStatus('All levels are already fully expanded', 'info');
        updateExpandCollapseButtons();
        return;
    }

    // Calculate depth for each visible collapsed node
    const nodesByDepth = [];
    visibleCollapsedNodes.forEach(node => {
        let depth = 0;
        let current = node.parent();
        while (current && current.length > 0) {
            depth++;
            current = current.parent();
        }
        nodesByDepth.push({ node: node, depth: depth });
    });

    // Find the shallowest visible collapsed level (closest to root)
    const minDepth = Math.min(...nodesByDepth.map(item => item.depth));

    // Expand all nodes at the shallowest visible level
    const nodesToExpand = nodesByDepth.filter(item => item.depth === minDepth);

    nodesToExpand.forEach(item => {
        if (window.api && window.api.expand) {
            window.api.expand(item.node);
        }
    });

    showExportStatus(`Expanded ${nodesToExpand.length} node(s) at depth ${minDepth}`, 'success');

    // Wait for expand animation to complete before updating buttons
    setTimeout(() => {
        updateExpandCollapseButtons();
    }, 350); // Slightly longer than animation duration (300ms)
}

function collapseOneLevel() {
    /**
     * Collapse one level of the hierarchy
     * Finds the deepest expanded non-node level and collapses all nodes at that level
     */
    if (!cy || !window.api) {
        console.error('Cytoscape or expand-collapse API not available');
        return;
    }

    // Get all expanded compound nodes (graph, hall, aisle, rack, shelf - not tray/port) using API
    const expandedNodes = window.api.collapsibleNodes().filter(node => {
        const nodeType = node.data('type');
        return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
    });

    if (expandedNodes.length === 0) {
        showExportStatus('All levels are already collapsed', 'info');
        updateExpandCollapseButtons();
        return;
    }

    // Calculate depth for each expanded node
    const nodesByDepth = [];
    expandedNodes.forEach(node => {
        let depth = 0;
        let current = node.parent();
        while (current && current.length > 0) {
            depth++;
            current = current.parent();
        }
        nodesByDepth.push({ node: node, depth: depth });
    });

    // Find the deepest depth (furthest from root)
    const maxDepth = Math.max(...nodesByDepth.map(item => item.depth));

    // Collapse all nodes at the deepest depth
    const nodesToCollapse = nodesByDepth.filter(item => item.depth === maxDepth);
    nodesToCollapse.forEach(item => {
        if (window.api && window.api.collapse) {
            window.api.collapse(item.node);
        }
    });

    showExportStatus(`Collapsed ${nodesToCollapse.length} node(s) at depth ${maxDepth}`, 'success');

    // Wait for collapse animation to complete before updating buttons
    setTimeout(() => {
        updateExpandCollapseButtons();
    }, 350); // Slightly longer than animation duration (300ms)
}

function updateExpandCollapseButtons() {
    /**
     * Update expand/collapse button states based on current hierarchy state
     * Only considers VISIBLE nodes (not hidden inside collapsed parents)
     */
    if (!cy || !window.api) {
        console.log('[DEBUG] updateExpandCollapseButtons: cy or window.api not available');
        return;
    }

    const expandBtn = document.getElementById('expandOneLevelBtn');
    const collapseBtn = document.getElementById('collapseOneLevelBtn');

    if (!expandBtn || !collapseBtn) {
        return;
    }

    // Use API methods to get collapsed/expanded nodes
    // expandableNodes() = collapsed nodes that can be expanded
    // collapsibleNodes() = expanded nodes that can be collapsed
    const allExpandableNodes = window.api.expandableNodes();
    const allCollapsibleNodes = window.api.collapsibleNodes();

    // Filter to only graph/hall/aisle/rack/shelf types (all collapsible compound nodes)
    const allCollapsedNodes = allExpandableNodes.filter(node => {
        const nodeType = node.data('type');
        return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
    });

    const allExpandedNodes = allCollapsibleNodes.filter(node => {
        const nodeType = node.data('type');
        return nodeType === 'graph' || nodeType === 'hall' || nodeType === 'aisle' || nodeType === 'rack' || nodeType === 'shelf';
    });

    // Check if there are any VISIBLE collapsed nodes (not hidden inside a collapsed parent)
    const visibleCollapsedNodes = allCollapsedNodes.filter(node => {
        // Check if this node is visible (not inside a collapsed parent)
        let parent = node.parent();
        while (parent && parent.length > 0) {
            // Check if parent is in the collapsed list
            const parentCollapsed = allCollapsedNodes.some(n => n.id() === parent.id());
            if (parentCollapsed) {
                return false; // Hidden inside a collapsed parent
            }
            parent = parent.parent();
        }
        return true; // This node is visible and collapsed
    });

    // Enable/disable expand button (based on VISIBLE collapsed nodes)
    if (visibleCollapsedNodes.length === 0) {
        expandBtn.disabled = true;
        expandBtn.style.opacity = '0.5';
        expandBtn.style.cursor = 'not-allowed';
    } else {
        expandBtn.disabled = false;
        expandBtn.style.opacity = '1';
        expandBtn.style.cursor = 'pointer';
    }

    // Enable/disable collapse button
    if (allExpandedNodes.length === 0) {
        collapseBtn.disabled = true;
        collapseBtn.style.opacity = '0.5';
        collapseBtn.style.cursor = 'not-allowed';
    } else {
        collapseBtn.disabled = false;
        collapseBtn.style.opacity = '1';
        collapseBtn.style.cursor = 'pointer';
    }

}

function toggleNodeCollapse(node) {
    /**
     * Toggle collapse/expand state of a single high-level compound node
     * Only works for graph and rack types
     */
    if (!cy || !window.api) {
        console.error('Cytoscape or expand-collapse API not available');
        return;
    }

    if (!node.isParent()) {
        return; // Only compound nodes can be collapsed
    }

    // Only allow collapse for high-level nodes
    const nodeType = node.data('type');

    // Explicitly block shelf, tray, and port from collapsing
    if (nodeType === 'shelf' || nodeType === 'tray' || nodeType === 'port') {
        console.log('Node type', nodeType, 'is explicitly blocked from collapsing');
        return;
    }

    if (nodeType !== 'graph' && nodeType !== 'rack') {
        console.log('Node type', nodeType, 'is not collapsible');
        return;
    }

    // Check if node is currently collapsed
    if (node.hasClass('cy-expand-collapse-collapsed-node')) {
        // Expand this node
        window.api.expand(node);
        console.log('Expanded node:', node.data('id'));

        // After expanding, ensure all child graph nodes are collapsed
        // This prevents nested graphs from being automatically expanded
        setTimeout(() => {
            const childGraphs = node.descendants().filter(child => {
                const childType = child.data('type');
                return (childType === 'graph' || childType === 'rack') &&
                    child.isParent() &&
                    !child.hasClass('cy-expand-collapse-collapsed-node');
            });

            childGraphs.forEach(childGraph => {
                if (window.api && window.api.collapse) {
                    window.api.collapse(childGraph);
                }
            });

            if (childGraphs.length > 0) {
                console.log(`Collapsed ${childGraphs.length} child graph(s) within ${node.data('id')}`);
            }

            // Update button states after expansion
            updateExpandCollapseButtons();
        }, 450); // Wait for expansion + nested collapse animations
    } else {
        window.api.collapse(node);
        console.log('Collapsed node:', node.data('id'));

        // Update button states after collapse animation
        setTimeout(() => {
            updateExpandCollapseButtons();
        }, 350);
    }
    // Layout will automatically run per the extension config
}

// Add double-click handler for compound nodes (in addCytoscapeEventHandlers)
function addExpandCollapseHandlers() {
    if (!cy) return;

    // Double-click to toggle collapse/expand
    cy.on('dblclick', 'node:parent', function (evt) {
        const node = evt.target;
        toggleNodeCollapse(node);
    });

    console.log('Expand-collapse double-click handler added');
}

// Initialize node configurations when the page loads
initializeNodeConfigs();

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
