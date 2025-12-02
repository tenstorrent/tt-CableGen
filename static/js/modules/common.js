/**
 * Common module - functions used by both location and hierarchy modes
 * Extracted from visualizer.js to eliminate duplication and improve maintainability
 */
import { getNodeConfig } from '../config/node-types.js';
import { LAYOUT_CONSTANTS } from '../config/constants.js';
import { ExpandCollapseModule } from './expand-collapse.js';

export class CommonModule {
    constructor(state, nodeFactory) {
        this.state = state;
        this.nodeFactory = nodeFactory;
        this.expandCollapse = new ExpandCollapseModule(state);

        // Template color management (moved from globals)
        this.templateColors = {};  // templateName -> color
        this.colorToTemplate = {};  // color -> templateName (reverse mapping for edge color lookup)
        this.nextColorIndex = 0;
        this.templateColorPalette = [
            "#E74C3C",  // Red
            "#E67E22",  // Orange
            "#F1C40F",  // Yellow
            "#27AE60",  // Green
            "#3498DB",  // Blue
            "#9B59B6",  // Purple
            "#E91E63",  // Pink
            "#00BCD4",  // Cyan
            "#FF5722",  // Deep Orange
            "#795548"   // Brown
        ];
    }

    /**
     * Arrange trays and ports within a shelf node based on node type configuration
     * This is mode-independent - works for both location and hierarchy modes
     * @param {Object} shelfNode - Cytoscape shelf node
     */
    arrangeTraysAndPorts(shelfNode) {
        if (!shelfNode || !this.state.cy) return;

        const shelfPos = shelfNode.position();
        let nodeType = shelfNode.data('shelf_node_type') || 'WH_GALAXY';

        // Normalize node type: strip _DEFAULT suffix only
        nodeType = nodeType.replace(/_DEFAULT$/, '');

        const config = getNodeConfig(nodeType);

        if (!config) {
            console.warn(`No config found for node type: ${nodeType} (after normalization)`);
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
                    // Vertical trays → horizontal ports (wider than tall)
                    portX = trayX - 120 + (portNum - 1) * (portWidth + portSpacing);
                    portY = trayY;
                    // Style ports as horizontal rectangles
                    port.style({
                        'width': '35px',
                        'height': '25px'
                    });
                } else {
                    // Horizontal trays → vertical ports (taller than wide)
                    portX = trayX;
                    portY = trayY - 100 + (portNum - 1) * (portWidth + portSpacing);
                    // Style ports as vertical rectangles
                    port.style({
                        'width': '25px',
                        'height': '35px'
                    });
                }

                port.position({ x: portX, y: portY });
            });
        });
    }

    /**
     * Get template color (consistent hashing)
     * Assigns a unique color to each template name
     * @param {string} templateName - Template name
     * @returns {string} Color hex code
     */
    getTemplateColor(templateName) {
        // Check if we already have a color for this template
        if (this.templateColors[templateName]) {
            return this.templateColors[templateName];
        }

        // Assign next color from palette
        const color = this.templateColorPalette[this.nextColorIndex % this.templateColorPalette.length];
        this.templateColors[templateName] = color;
        // Build reverse mapping: color -> templateName (for edge color lookup)
        this.colorToTemplate[color] = templateName;
        this.nextColorIndex++;

        return color;
    }

    /**
     * Get template name from edge color (reverse lookup)
     * @param {string} color - Color hex code
     * @returns {string|null} Template name if found, null otherwise
     */
    getTemplateFromColor(color) {
        return this.colorToTemplate[color] || null;
    }

    /**
     * Update port connection status visual indicators
     * Adds 'connected-port' class to ports that have connections
     */
    updatePortConnectionStatus() {
        if (!this.state.cy) return;

        this.state.cy.nodes('.port').removeClass('connected-port');

        this.state.cy.edges().forEach(edge => {
            const sourceId = edge.data('source');
            const targetId = edge.data('target');

            const sourceNode = this.state.cy.getElementById(sourceId);
            const targetNode = this.state.cy.getElementById(targetId);

            if (sourceNode.length && !sourceNode.removed()) {
                sourceNode.addClass('connected-port');
            }
            if (targetNode.length && !targetNode.removed()) {
                targetNode.addClass('connected-port');
            }
        });
    }

    /**
     * Apply drag restrictions (trays and ports not draggable)
     * All other nodes (graph containers, racks, shelves, halls, aisles, etc.) remain draggable
     */
    applyDragRestrictions() {
        if (!this.state.cy) return;

        this.state.cy.nodes().forEach(node => {
            const nodeType = node.data('type');
            if (nodeType === 'tray' || nodeType === 'port') {
                node.ungrabify();
            } else {
                node.grabify();
            }
        });
    }

    /**
     * Position graph children (shelves and nested graphs) in a grid layout
     * Shared between location and hierarchy modes
     * @param {Object} graphNode - Cytoscape graph node
     */
    positionGraphChildren(graphNode) {
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
                this.arrangeTraysAndPorts(shelf);
            });

            // Calculate grid dimensions - aim for roughly square aspect ratio
            const numShelves = shelves.length;
            let gridCols;

            if (numShelves <= 3) {
                // For 1-3 shelves, arrange horizontally
                gridCols = numShelves;
            } else {
                // For 4+ shelves, calculate optimal grid
                // Try to make it roughly square, slightly preferring more columns
                gridCols = Math.ceil(Math.sqrt(numShelves * 1.2)); // 1.2 factor prefers wider grids
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
            // For very small graphs (likely root graph not yet expanded), use a reasonable offset
            const minGraphWidth = 1000;  // Wider minimum for proper shelf spacing
            const minGraphHeight = 600;  // Taller minimum for proper shelf spacing
            const effectiveWidth = Math.max(graphBBox.w, minGraphWidth);
            const effectiveHeight = Math.max(graphBBox.h, minGraphHeight);

            const startX = graphPos.x - (effectiveWidth * 0.45); // Start further to the left
            const startY = graphPos.y - (effectiveHeight * 0.40); // Start higher up

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
                this.positionGraphChildren(graph);

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
     * Get Cytoscape styles configuration
     * @returns {Array} Array of style objects for Cytoscape
     */
    getCytoscapeStyles() {
        return [
            // Basic edge styles - high z-index to ensure above all nodes
            // Default to bezier - forceApplyCurveStyles will set specific styles per edge
            {
                selector: 'edge',
                style: {
                    'width': 3,
                    'line-color': 'data(color)',
                    'line-opacity': 1,
                    'curve-style': 'bezier',
                    'control-point-step-size': 40,
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

            // Rerouted edges (crossing collapsed nodes) - use bezier like regular edges
            // forceApplyCurveStyles will handle the actual styling
            {
                selector: 'edge.rerouted-edge',
                style: {
                    'curve-style': 'bezier',
                    'control-point-step-size': 40
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

            // Aisle styles - mid-level location containers within halls
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
            // Note: width and height are set dynamically by common_arrangeTraysAndPorts based on tray_layout
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
                    // Default dimensions (will be overridden by common_arrangeTraysAndPorts based on layout)
                    'width': '35px',
                    'height': '25px',
                    'z-index': 1
                }
            },

            // Collapsed compound node style - smaller size for compact view
            {
                selector: '.collapsed-node',
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

    /**
     * Handle right-click edit mode (properties editing pop-up)
     * @param {Object} evt - Cytoscape event object
     * @param {Object} node - Cytoscape node object
     */
    handleRightClickEdit(evt, node) {
        if (!node || !node.data) {
            console.log('[right-click] Invalid node');
            return;
        }

        const data = node.data();
        const nodeType = data.type;

        console.log('[right-click] Node:', node.id(), 'Type:', nodeType, 'Template:', node.data('template_name'));

        // Don't allow editing for trays and ports
        if (nodeType === 'tray' || nodeType === 'port') {
            console.log('[right-click] Tray/port node - editing not allowed');
            return;
        }

        // Select the node first
        if (this.state.editing.selectedNode) {
            this.state.editing.selectedNode.removeClass('selected-node');
        }
        this.state.editing.selectedNode = node;
        node.addClass('selected-node');

        // Check if editing mode is enabled - all editing popups require it
        if (!this.state.editing.isEdgeCreationMode) {
            console.log('[right-click] Editing mode not enabled - showing notification');
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('⚠️ Editing mode must be enabled to edit nodes. Please click "Enable Editing" button first.', 'warning');
            }
            return;
        }

        // For shelf nodes: enable editing
        if (nodeType === 'shelf') {
            const isEditing = node.data('isEditing') === true;
            if (!isEditing) {
                console.log('[right-click] Opening shelf editing popup');
                if (window.enableShelfEditing && typeof window.enableShelfEditing === 'function') {
                    window.enableShelfEditing(node, evt.renderedPosition || evt.position);
                } else {
                    console.warn('[right-click] enableShelfEditing function not available');
                }
            }
            return;
        }

        // For hall nodes: enable editing (location mode only)
        if (nodeType === 'hall') {
            const isEditing = node.data('isEditing') === true;
            if (!isEditing) {
                console.log('[right-click] Opening hall editing popup');
                if (window.enableHallEditing && typeof window.enableHallEditing === 'function') {
                    window.enableHallEditing(node, evt.renderedPosition || evt.position);
                } else {
                    console.warn('[right-click] enableHallEditing function not available');
                }
            }
            return;
        }

        // For aisle nodes: enable editing (location mode only)
        if (nodeType === 'aisle') {
            const isEditing = node.data('isEditing') === true;
            if (!isEditing) {
                console.log('[right-click] Opening aisle editing popup');
                if (window.enableAisleEditing && typeof window.enableAisleEditing === 'function') {
                    window.enableAisleEditing(node, evt.renderedPosition || evt.position);
                } else {
                    console.warn('[right-click] enableAisleEditing function not available');
                }
            }
            return;
        }

        // For rack nodes: enable editing (location mode only)
        if (nodeType === 'rack') {
            const isEditing = node.data('isEditing') === true;
            if (!isEditing) {
                console.log('[right-click] Opening rack editing popup');
                if (window.enableRackEditing && typeof window.enableRackEditing === 'function') {
                    window.enableRackEditing(node, evt.renderedPosition || evt.position);
                } else {
                    console.warn('[right-click] enableRackEditing function not available');
                }
            }
            return;
        }

        // For graph template nodes: enable editing in hierarchy mode
        if (nodeType === 'graph' && node.data('template_name')) {
            console.log('[right-click] Graph template node detected');

            if (!window.getVisualizationMode) {
                console.warn('[right-click] getVisualizationMode function not available');
                return;
            }

            const currentMode = window.getVisualizationMode();
            console.log('[right-click] Current visualization mode:', currentMode);

            if (currentMode === 'hierarchy') {
                const isEditing = node.data('isEditing') === true;
                console.log('[right-click] Node isEditing flag:', isEditing);

                if (!isEditing) {
                    console.log('[right-click] Opening graph template editing popup');
                    if (window.enableGraphTemplateEditing && typeof window.enableGraphTemplateEditing === 'function') {
                        window.enableGraphTemplateEditing(node, evt.renderedPosition || evt.position);
                    } else {
                        console.error('[right-click] enableGraphTemplateEditing function not available!');
                    }
                } else {
                    console.log('[right-click] Node is already being edited');
                }
            } else {
                console.log('[right-click] Not in hierarchy mode, skipping graph template editing');
            }
            return;
        }

        console.log('[right-click] No handler for node type:', nodeType);
    }

    /**
     * Handle expand/collapse functionality for compound nodes
     * Delegates to ExpandCollapseModule
     * @param {Object} evt - Cytoscape event object
     * @param {Object} node - Cytoscape node object
     * @returns {boolean} True if expand/collapse was handled, false otherwise
     */
    handleExpandCollapse(evt, node) {
        return this.expandCollapse.handleExpandCollapse(evt, node);
    }

    /**
     * Find the first visible ancestor of a node, including collapsed nodes
     * A node is visible if it's not hidden (display !== 'none')
     * Collapsed nodes are still visible (they just have collapsed styling)
     * @param {Object} node - The node to find ancestor for
     * @param {Set} collapsedNodeIds - Set of collapsed node IDs (for reference)
     * @returns {Object|null} First visible ancestor (can be collapsed) or null
     */
    findFirstVisibleAncestor(node, _collapsedNodeIds) {
        // Start from the node's parent
        let current = node.parent();
        while (current && current.length > 0) {
            const isHidden = current.style('display') === 'none';

            // A node is visible if it's not hidden (collapsed nodes are still visible)
            if (!isHidden) {
                return current;
            }
            current = current.parent();
        }
        return null; // No visible ancestor found
    }

    /**
     * Collapse a node: hide children and reroute edges
     * Delegates to ExpandCollapseModule
     * @param {Object} node - The node to collapse
     * @param {string} nodeId - The node ID
     */
    collapseNode(node, nodeId) {
        return this.expandCollapse.collapseNode(node, nodeId);
    }

    /**
     * Expand a node: restore children and recalculate edge routing
     * Delegates to ExpandCollapseModule
     * @param {Object} node - The node to expand
     * @param {string} nodeId - The node ID
     */
    expandNode(node, nodeId) {
        return this.expandCollapse.expandNode(node, nodeId);
    }

    /**
     * Recalculate all edge routing in the graph based on current collapse state
     * Delegates to ExpandCollapseModule
     */
    recalculateAllEdgeRouting() {
        return this.expandCollapse.recalculateAllEdgeRouting();
    }

    /**
     * Add Cytoscape event handlers for node/edge interactions
     */
    addCytoscapeEventHandlers() {
        // Ensure Cytoscape instance exists
        if (!this.state.cy) {
            console.error('[addCytoscapeEventHandlers] Cytoscape instance not available!');
            return;
        }

        console.log('[addCytoscapeEventHandlers] Registering event handlers...');

        // Remove existing handlers to prevent duplicates
        this.state.cy.off('tap', 'node');
        this.state.cy.off('dbltap', 'node');
        this.state.cy.off('cxttap', 'node');  // Right-click handler
        this.state.cy.off('tap', 'edge');
        this.state.cy.off('tap');
        this.state.cy.off('select', 'node, edge');
        this.state.cy.off('unselect', 'node, edge');

        // Node click handler for info display and port connection creation
        this.state.cy.on('tap', 'node', (evt) => {
            const node = evt.target;

            // Ensure we have a valid node (when using selector 'node', target should always be a node)
            if (!node || !node.data) {
                console.warn('[tap node] Invalid node target:', node);
                return;
            }

            const originalEvent = evt.originalEvent;
            const isMultiSelect = originalEvent && (originalEvent.ctrlKey || originalEvent.metaKey || originalEvent.shiftKey);

            // Handle Ctrl+Click or Shift+Click for multi-select
            // Let Cytoscape handle the selection naturally
            if (isMultiSelect) {
                // Update delete button state if in editing mode
                if (this.state.editing.isEdgeCreationMode) {
                    if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                        window.updateDeleteButtonState();
                    }
                }

                // Show node info even for multi-select
                if (window.showNodeInfo && typeof window.showNodeInfo === 'function') {
                    window.showNodeInfo(node, evt.renderedPosition || evt.position);
                }
                return;
            }

            // Handle port clicks
            if (node.hasClass('port')) {
                if (this.state.editing.isEdgeCreationMode) {
                    if (window.handlePortClickEditMode && typeof window.handlePortClickEditMode === 'function') {
                        window.handlePortClickEditMode(node, evt);
                    }
                } else {
                    if (window.handlePortClickViewMode && typeof window.handlePortClickViewMode === 'function') {
                        window.handlePortClickViewMode(node, evt);
                    }
                }
            } else {
                // Non-port node clicked - single left-click: select node and show info
                const nodeType = node.data('type');
                const isDeletable = ['shelf', 'rack', 'graph'].includes(nodeType);

                // Clear connection selection when clicking on any non-port node
                if (this.state.editing.selectedConnection) {
                    this.state.editing.selectedConnection.removeClass('selected-connection');
                    this.state.editing.selectedConnection = null;
                    if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                        window.updateDeleteButtonState();
                    }
                }

                // Clear Cytoscape multi-selections on single click (unless modifier keys are held)
                if (!originalEvent || (!originalEvent.ctrlKey && !originalEvent.metaKey && !originalEvent.shiftKey)) {
                    this.state.cy.elements().unselect();
                }

                // Always select the node (for both editing and view modes)
                // Deselect previously selected node
                if (this.state.editing.selectedNode) {
                    this.state.editing.selectedNode.removeClass('selected-node');
                }

                // Select this node
                this.state.editing.selectedNode = node;
                node.addClass('selected-node');

                // Also select in Cytoscape for consistency
                node.select();

                // Update delete button state if in editing mode
                if (this.state.editing.isEdgeCreationMode && isDeletable) {
                    if (window.updateDeleteNodeButtonState && typeof window.updateDeleteNodeButtonState === 'function') {
                        window.updateDeleteNodeButtonState();
                    }
                }

                // Show node info
                if (window.showNodeInfo && typeof window.showNodeInfo === 'function') {
                    window.showNodeInfo(node, evt.renderedPosition || evt.position);
                }
            }
        });

        // Double-click handler for expand/collapse functionality
        this.state.cy.on('dbltap', 'node', (evt) => {
            const node = evt.target;

            // Ensure we have a valid node
            if (!node || !node.data) {
                return;
            }

            // Handle expand/collapse for compound nodes
            this.handleExpandCollapse(evt, node);
        });

        // Right-click handler for edit mode (properties editing pop-up)
        // This handles actual right-clicks (cxttap event)
        this.state.cy.on('cxttap', 'node', (evt) => {
            const node = evt.target;
            if (!node || !node.data) {
                return;
            }
            // Prevent default browser context menu
            if (evt.originalEvent) {
                evt.originalEvent.preventDefault();
            }
            this.handleRightClickEdit(evt, node);
        });

        // Edge click handler for connection selection and info display
        this.state.cy.on('tap', 'edge', (evt) => {
            const edge = evt.target;

            // Ensure we have a valid edge (when using selector 'edge', target should always be an edge)
            if (!edge || !edge.data) {
                return;
            }

            const originalEvent = evt.originalEvent;
            const position = evt.renderedPosition || evt.position;
            const isMultiSelect = originalEvent && (originalEvent.ctrlKey || originalEvent.metaKey || originalEvent.shiftKey);

            // Handle Ctrl+Click or Shift+Click for multi-select
            // Let Cytoscape handle the selection naturally
            if (isMultiSelect) {
                // Update delete button state if in editing mode
                if (this.state.editing.isEdgeCreationMode) {
                    if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                        window.updateDeleteButtonState();
                    }
                }

                // Show connection info even for multi-select
                if (window.showConnectionInfo && typeof window.showConnectionInfo === 'function') {
                    window.showConnectionInfo(edge, position);
                }
                return;
            }

            // Clear source port selection if clicking on an edge (editing mode only)
            if (this.state.editing.isEdgeCreationMode && this.state.editing.selectedFirstPort) {
                this.state.editing.selectedFirstPort.removeClass('source-selected');
                this.state.editing.selectedFirstPort = null;
            }

            // Clear node selection when clicking on an edge (unless modifier keys are held)
            if (!originalEvent || (!originalEvent.ctrlKey && !originalEvent.metaKey && !originalEvent.shiftKey)) {
                if (this.state.editing.selectedNode) {
                    this.state.editing.selectedNode.removeClass('selected-node');
                    this.state.editing.selectedNode = null;
                    if (window.updateDeleteNodeButtonState && typeof window.updateDeleteNodeButtonState === 'function') {
                        window.updateDeleteNodeButtonState();
                    }
                }

                // Clear Cytoscape multi-selections on single click (unless modifier keys are held)
                this.state.cy.elements().unselect();
            }

            // Deselect previously selected connection (works in both editing and normal mode)
            if (this.state.editing.selectedConnection) {
                this.state.editing.selectedConnection.removeClass('selected-connection');
            }

            // Select this connection (works in both editing and normal mode)
            this.state.editing.selectedConnection = edge;
            edge.addClass('selected-connection');

            // Also select in Cytoscape for consistency
            edge.select();

            // Update delete button state (only relevant in editing mode)
            if (this.state.editing.isEdgeCreationMode) {
                if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                    window.updateDeleteButtonState();
                }
            }

            // Show connection info annotation for any edge click (editing mode or not)
            if (window.showConnectionInfo && typeof window.showConnectionInfo === 'function') {
                window.showConnectionInfo(edge, position);
            }
        });

        // Click on background to hide info, deselect connection, and clear source port
        this.state.cy.on('tap', (evt) => {
            if (evt.target === this.state.cy) {
                if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
                    window.clearAllSelections();
                }
            }
        });

        // Handle multi-selection events (Shift+Click selection)
        this.state.cy.on('select', 'node, edge', () => {
            // Update delete button state when elements are selected
            if (this.state.editing.isEdgeCreationMode) {
                if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                    window.updateDeleteButtonState();
                }
            }
        });

        this.state.cy.on('unselect', 'node, edge', () => {
            // Update delete button state when elements are unselected
            if (this.state.editing.isEdgeCreationMode) {
                if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                    window.updateDeleteButtonState();
                }
            }
        });

        console.log('[addCytoscapeEventHandlers] Event handlers registered successfully');
    }

    /**
     * Add event handler for node filter dropdown
     * This filter is available in both location and hierarchy modes
     */
    addNodeFilterHandler() {
        // Add event listener to node filter dropdown
        const nodeFilterSelect = document.getElementById('nodeFilterSelect');
        if (nodeFilterSelect) {
            // Remove existing listeners to avoid duplicates
            const newNodeFilterSelect = nodeFilterSelect.cloneNode(true);
            nodeFilterSelect.parentNode.replaceChild(newNodeFilterSelect, nodeFilterSelect);

            newNodeFilterSelect.addEventListener('change', () => {
                // Apply node filter when node selection changes
                if (window.applyNodeFilter && typeof window.applyNodeFilter === 'function') {
                    window.applyNodeFilter();
                }
            });
        }

    }

    /**
     * Get parent shelf node (goes up 2 levels: port -> tray -> shelf)
     * @param {Object} node - Cytoscape node
     * @returns {Object|null} Parent shelf node or null
     */
    getParentShelfNode(node) {
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

    /**
     * Extract shelf ID from any node ID
     * Handles formats:
     * - "0" -> "0" (shelf)
     * - "0:t1" -> "0" (tray)
     * - "0:t1:p1" -> "0" (port)
     * @param {string} nodeId - Node ID (can be shelf, tray, or port)
     * @returns {string|null} Shelf ID (host_index) or null
     */
    extractShelfIdFromNodeId(nodeId) {
        if (!nodeId) return null;

        // For descriptor format: "0:t1:p1" or "0:t1" -> extract "0"
        // Match pattern: start of string, digits (shelf ID), optionally followed by ":t" and more
        const match = nodeId.match(/^(\d+)(?::t\d+(?::p\d+)?)?$/);
        if (match) {
            return match[1];
        }

        // For other formats, try to get the node and check its type
        if (this.state.cy) {
            const node = this.state.cy.getElementById(nodeId);
            if (node && node.length) {
                const nodeType = node.data('type');
                if (nodeType === 'shelf' || nodeType === 'node') {
                    return nodeId; // Already a shelf node
                }
                // Try to get parent shelf
                const parentShelf = this.getParentShelfNode(node);
                if (parentShelf && parentShelf.length) {
                    return parentShelf.id();
                }
            }
        }

        // Fallback: return as-is (might be a label-based ID or shelf ID already)
        return nodeId;
    }

    /**
     * Get the original endpoint nodes for an edge (handles rerouted edges)
     * @param {Object} edge - Cytoscape edge
     * @returns {Object} { sourceNode, targetNode } - Original endpoint nodes
     */
    getOriginalEdgeEndpoints(edge) {
        // Check if this is a rerouted edge
        if (edge.data('isRerouted') && edge.data('originalSource') && edge.data('originalTarget')) {
            const originalSource = this.state.cy.getElementById(edge.data('originalSource'));
            const originalTarget = this.state.cy.getElementById(edge.data('originalTarget'));
            // Return original nodes if they exist, otherwise fall back to current endpoints
            return {
                sourceNode: originalSource.length ? originalSource : edge.source(),
                targetNode: originalTarget.length ? originalTarget : edge.target()
            };
        }
        // Not rerouted, use current endpoints
        return {
            sourceNode: edge.source(),
            targetNode: edge.target()
        };
    }

    /**
     * Get display label for a node based on priority:
     * 1. Hostname
     * 2. Location format (Hall-Aisle-Rack-ShelfU)
     * 3. Type-specific label (e.g., "Shelf {U}")
     * 4. Existing label
     * 5. Node ID
     * @param {Object} nodeData - Node data object
     * @param {Object} locationModule - LocationModule instance (for buildLabel)
     * @returns {string} Display label
     */
    getNodeDisplayLabel(nodeData, locationModule = null) {
        // Priority 1: Hostname
        if (nodeData.hostname) {
            return nodeData.hostname;
        }

        // Priority 2: Location format (Hall-Aisle-Rack-ShelfU)
        if (nodeData.hall && nodeData.aisle && nodeData.rack_num !== undefined) {
            const shelfU = nodeData.shelf_u;
            if (locationModule && typeof locationModule.buildLabel === 'function') {
                if (shelfU !== undefined && shelfU !== null && shelfU !== '') {
                    return locationModule.buildLabel(nodeData.hall, nodeData.aisle, nodeData.rack_num, shelfU);
                } else {
                    return locationModule.buildLabel(nodeData.hall, nodeData.aisle, nodeData.rack_num);
                }
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
     * Determine if a connection should be shown based on type filters
     * Handles hierarchy mode special case where connections without location data
     * are shown by default (they're logical/hierarchical connections)
     * @param {boolean} isIntraNode - Whether connection is intra-node
     * @param {boolean} isIntraRack - Whether connection is intra-rack
     * @param {boolean} isInterRack - Whether connection is inter-rack
     * @param {boolean} showIntraNode - Whether intra-node filter is enabled
     * @param {boolean} showIntraRack - Whether intra-rack filter is enabled
     * @param {boolean} showInterRack - Whether inter-rack filter is enabled
     * @param {number} sourceRack - Source rack number (0 if no location data)
     * @param {number} targetRack - Target rack number (0 if no location data)
     * @returns {boolean} True if connection should be shown
     */
    shouldShowConnectionByType(isIntraNode, isIntraRack, isInterRack, showIntraNode, showIntraRack, showInterRack, sourceRack, targetRack) {
        // In hierarchy mode, connections without rack_num are logical/hierarchical connections
        // They should be shown by default if no location-based filtering is applicable
        const isHierarchyMode = this.state.mode === 'hierarchy';
        const hasLocationData = (sourceRack > 0 || targetRack > 0);

        // Check if connection should be visible based on type
        let shouldShowByType = false;
        if (isIntraNode && showIntraNode) shouldShowByType = true;
        if (isIntraRack && showIntraRack) shouldShowByType = true;
        if (isInterRack && showInterRack) shouldShowByType = true;

        // In hierarchy mode, if connection doesn't have location data, show it by default
        // (it's a logical/hierarchical connection, not location-based)
        if (isHierarchyMode && !hasLocationData && !isIntraNode) {
            shouldShowByType = true;
        }

        return shouldShowByType;
    }

    /**
     * Check if a label already contains host_index to avoid double printing
     * @param {string} label - The label to check
     * @returns {boolean} True if label already contains host_index pattern
     */
    labelHasHostIndex(label) {
        if (!label) return false;
        const hostIndexPattern = /\(host_\d+\)/;
        return hostIndexPattern.test(label);
    }

    /**
     * Format host_index string, avoiding duplication if already in label
     * @param {string} label - The base label
     * @param {number|undefined|null} hostIndex - The host_index value
     * @returns {string} Formatted label with host_index if not already present
     */
    formatLabelWithHostIndex(label, hostIndex) {
        if (!label) return '';
        const alreadyHasHostIndex = this.labelHasHostIndex(label);
        const hostIndexStr = (!alreadyHasHostIndex && hostIndex !== undefined && hostIndex !== null) ? ` (host_${hostIndex})` : '';
        return label + hostIndexStr;
    }

    /**
     * Apply connection type filter (location mode only)
     * Filters connections based on intra-node, intra-rack, and inter-rack types
     */
    applyConnectionTypeFilter() {
        if (!this.state || !this.state.cy) {
            return;
        }

        // Get connection type filter settings
        const showIntraNode = document.getElementById('showIntraNodeConnections')?.checked || false;
        const showIntraRack = document.getElementById('showIntraRackConnections')?.checked || false;
        const showInterRack = document.getElementById('showInterRackConnections')?.checked || false;

        // Get node filter setting
        const nodeFilterSelect = document.getElementById('nodeFilterSelect');
        const selectedNodeId = nodeFilterSelect ? nodeFilterSelect.value : '';

        // Get all edges
        const allEdges = this.state.cy.edges();
        let visibleCount = 0;
        let hiddenCount = 0;

        // Filter edges based on connection type, node, and template filters
        allEdges.forEach((edge) => {
            // Check template filter (hierarchy mode only) - use hierarchy module helper
            if (this.state.mode === 'hierarchy' && window.hierarchyModule) {
                if (!window.hierarchyModule.shouldShowConnectionByTemplate(edge)) {
                    edge.style('display', 'none');
                    hiddenCount++;
                    return;
                }
            }

            // Check node filter
            if (selectedNodeId !== '') {
                const selectedShelfId = this.extractShelfIdFromNodeId(selectedNodeId);
                const { sourceNode, targetNode } = this.getOriginalEdgeEndpoints(edge);
                const sourceShelfId = this.extractShelfIdFromNodeId(sourceNode.id());
                const targetShelfId = this.extractShelfIdFromNodeId(targetNode.id());
                if (sourceShelfId !== selectedShelfId && targetShelfId !== selectedShelfId) {
                    edge.style('display', 'none');
                    hiddenCount++;
                    return;
                }
            }

            // Get original endpoints for rerouted edges, current endpoints otherwise
            const { sourceNode, targetNode } = this.getOriginalEdgeEndpoints(edge);

            // Extract shelf IDs from source and target nodes
            const sourceShelfId = this.extractShelfIdFromNodeId(sourceNode.id());
            const targetShelfId = this.extractShelfIdFromNodeId(targetNode.id());

            // Get the shelf nodes directly using their IDs
            const sourceShelfNode = sourceShelfId ? this.state.cy.getElementById(sourceShelfId) : null;
            const targetShelfNode = targetShelfId ? this.state.cy.getElementById(targetShelfId) : null;

            // Determine connection types
            const isIntraNode = sourceShelfId && targetShelfId && sourceShelfId === targetShelfId;

            // For rack-level filtering, get rack numbers from shelf nodes
            let sourceRack = 0;
            let targetRack = 0;

            if (sourceShelfNode && sourceShelfNode.length) {
                sourceRack = this._normalizeRackNum(sourceShelfNode.data('rack_num') || sourceShelfNode.data('rack')) || 0;
            }

            if (targetShelfNode && targetShelfNode.length) {
                targetRack = this._normalizeRackNum(targetShelfNode.data('rack_num') || targetShelfNode.data('rack')) || 0;
            }

            const isIntraRack = sourceRack === targetRack && sourceRack > 0 && !isIntraNode; // Intra-rack but not intra-node
            const isInterRack = sourceRack !== targetRack && sourceRack > 0 && targetRack > 0;

            // Check if connection should be visible based on type
            const shouldShowByType = this.shouldShowConnectionByType(
                isIntraNode, isIntraRack, isInterRack,
                showIntraNode, showIntraRack, showInterRack,
                sourceRack, targetRack
            );

            if (shouldShowByType) {
                edge.style('display', 'element');
                visibleCount++;
            } else {
                edge.style('display', 'none');
                hiddenCount++;
            }
        });

        // Update status - combine with other active filters
        const statusDiv = document.getElementById('rangeStatus');
        if (statusDiv) {
            const filterParts = [];
            // Get template filter for status (hierarchy mode only)
            if (this.state.mode === 'hierarchy' && window.hierarchyModule) {
                const selectedTemplate = window.hierarchyModule.getSelectedTemplateFilter();
                if (selectedTemplate) {
                    filterParts.push(`template: ${selectedTemplate}`);
                }
            }
            if (selectedNodeId) {
                const selectedNode = this.state.cy.getElementById(selectedNodeId);
                const nodeLabel = selectedNode && selectedNode.length ? selectedNode.data('label') || selectedNodeId : selectedNodeId;
                filterParts.push(`node: ${nodeLabel}`);
            }
            if (filterParts.length === 0) {
                statusDiv.textContent = `Showing ${visibleCount} connections (${hiddenCount} hidden by type filter)`;
            } else {
                statusDiv.textContent = `Showing ${visibleCount} connections filtered by ${filterParts.join(', ')} and type (${hiddenCount} hidden)`;
            }
            statusDiv.style.color = '#28a745';
        }
    }

    /**
     * Apply node filter (available in both modes)
     * Filters connections to show only those connected to the selected node
     */
    applyNodeFilter() {
        if (!this.state || !this.state.cy) {
            return;
        }

        // Get selected node
        const nodeFilterSelect = document.getElementById('nodeFilterSelect');
        const selectedNodeId = nodeFilterSelect ? nodeFilterSelect.value : '';

        // Get connection type filter settings
        const showIntraNode = document.getElementById('showIntraNodeConnections')?.checked || false;
        const showIntraRack = document.getElementById('showIntraRackConnections')?.checked || false;
        const showInterRack = document.getElementById('showInterRackConnections')?.checked || false;

        // Get all edges
        const allEdges = this.state.cy.edges();
        let visibleCount = 0;
        let hiddenCount = 0;

        // Apply all filters together
        allEdges.forEach((edge) => {
            // Check template filter (hierarchy mode only) - use hierarchy module helper
            if (this.state.mode === 'hierarchy' && window.hierarchyModule) {
                if (!window.hierarchyModule.shouldShowConnectionByTemplate(edge)) {
                    edge.style('display', 'none');
                    hiddenCount++;
                    return;
                }
            }

            // Check node filter
            if (selectedNodeId !== '') {
                const selectedShelfId = this.extractShelfIdFromNodeId(selectedNodeId);
                const { sourceNode, targetNode } = this.getOriginalEdgeEndpoints(edge);
                const sourceShelfId = this.extractShelfIdFromNodeId(sourceNode.id());
                const targetShelfId = this.extractShelfIdFromNodeId(targetNode.id());
                if (sourceShelfId !== selectedShelfId && targetShelfId !== selectedShelfId) {
                    edge.style('display', 'none');
                    hiddenCount++;
                    return;
                }
            }

            // Check connection type filter
            const { sourceNode, targetNode } = this.getOriginalEdgeEndpoints(edge);
            const sourceShelfId = this.extractShelfIdFromNodeId(sourceNode.id());
            const targetShelfId = this.extractShelfIdFromNodeId(targetNode.id());
            const sourceShelfNode = sourceShelfId ? this.state.cy.getElementById(sourceShelfId) : null;
            const targetShelfNode = targetShelfId ? this.state.cy.getElementById(targetShelfId) : null;

            const isIntraNode = sourceShelfId && targetShelfId && sourceShelfId === targetShelfId;
            let sourceRack = 0;
            let targetRack = 0;
            if (sourceShelfNode && sourceShelfNode.length) {
                sourceRack = this._normalizeRackNum(sourceShelfNode.data('rack_num') || sourceShelfNode.data('rack')) || 0;
            }
            if (targetShelfNode && targetShelfNode.length) {
                targetRack = this._normalizeRackNum(targetShelfNode.data('rack_num') || targetShelfNode.data('rack')) || 0;
            }
            const isIntraRack = sourceRack === targetRack && sourceRack > 0 && !isIntraNode;
            const isInterRack = sourceRack !== targetRack && sourceRack > 0 && targetRack > 0;

            let shouldShowByType = true;
            if (selectedNodeId === '') {
                // Only apply type filter if no other filters are active
                shouldShowByType = this.shouldShowConnectionByType(
                    isIntraNode, isIntraRack, isInterRack,
                    showIntraNode, showIntraRack, showInterRack,
                    sourceRack, targetRack
                );
            }

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
        if (statusDiv) {
            const filterParts = [];
            // Get template filter for status (hierarchy mode only)
            if (this.state.mode === 'hierarchy' && window.hierarchyModule) {
                const selectedTemplate = window.hierarchyModule.getSelectedTemplateFilter();
                if (selectedTemplate) {
                    filterParts.push(`template: ${selectedTemplate}`);
                }
            }
            if (selectedNodeId) {
                const selectedNode = this.state.cy.getElementById(selectedNodeId);
                const nodeLabel = selectedNode && selectedNode.length ? selectedNode.data('label') || selectedNodeId : selectedNodeId;
                filterParts.push(`node: ${nodeLabel}`);
            }
            if (filterParts.length === 0) {
                statusDiv.textContent = `Showing ${visibleCount} connections (${hiddenCount} hidden)`;
            } else {
                statusDiv.textContent = `Showing ${visibleCount} connections filtered by ${filterParts.join(', ')} (${hiddenCount} hidden)`;
            }
            statusDiv.style.color = '#28a745';
        }
    }

    /**
     * Populate node filter dropdown (available in both modes)
     * Shows different label formats based on current mode
     */
    populateNodeFilterDropdown(locationModule = null) {
        if (!this.state || !this.state.cy) {
            return;
        }

        const nodeFilterSelect = document.getElementById('nodeFilterSelect');
        if (!nodeFilterSelect) {
            return;
        }

        // Clear existing options
        nodeFilterSelect.innerHTML = '<option value="">Show all nodes</option>';

        // Check current mode
        const isLocationMode = this.state.mode === 'location';
        const isHierarchyMode = this.state.mode === 'hierarchy';

        // Get all shelf nodes (main nodes, not trays or ports)
        const shelfNodes = this.state.cy.nodes().filter((node) => {
            const nodeType = node.data('type');
            return nodeType === 'shelf' || nodeType === 'node';
        });

        // Build array of options with labels for sorting
        const options = [];
        shelfNodes.forEach((node) => {
            const nodeId = node.id();
            const nodeData = node.data();
            let nodeLabel;

            if (isLocationMode) {
                // In location mode, show "hostname (host_index)" format
                const hostname = nodeData.hostname;
                const hostIndex = nodeData.host_index;

                if (hostname && hostIndex !== undefined && hostIndex !== null) {
                    nodeLabel = `${hostname} (host_${hostIndex})`;
                } else if (hostname) {
                    nodeLabel = hostname;
                } else if (hostIndex !== undefined && hostIndex !== null) {
                    // Fallback to display label with host_index if no hostname
                    const displayLabel = this.getNodeDisplayLabel(nodeData, locationModule) || nodeId;
                    nodeLabel = `${displayLabel} (host_${hostIndex})`;
                } else {
                    // Fallback to display label if no hostname or host_index
                    nodeLabel = this.getNodeDisplayLabel(nodeData, locationModule) || nodeId;
                }
            } else if (isHierarchyMode) {
                // In hierarchy mode, show path representation
                if (window.hierarchyModule) {
                    const pathArray = window.hierarchyModule.getPath(node);
                    const pathLabels = [];

                    // Convert each path segment ID to its label
                    pathArray.forEach((pathId) => {
                        const pathNode = this.state.cy.getElementById(pathId);
                        if (pathNode && pathNode.length) {
                            const pathLabel = pathNode.data('label') || pathId;
                            pathLabels.push(pathLabel);
                        } else {
                            pathLabels.push(pathId);
                        }
                    });

                    // Format as "superpod1 > node2 > n300_lb (host_0)"
                    if (pathLabels.length > 0) {
                        const hostIndex = nodeData.host_index;
                        nodeLabel = this.formatLabelWithHostIndex(pathLabels.join(' > '), hostIndex);
                    } else {
                        // Fallback if path is empty
                        const nodeLabelStr = nodeData.label || nodeId;
                        const hostIndex = nodeData.host_index;
                        nodeLabel = this.formatLabelWithHostIndex(nodeLabelStr, hostIndex);
                    }
                } else {
                    // Fallback if hierarchyModule not available
                    nodeLabel = this.getNodeDisplayLabel(nodeData, locationModule);
                }
            } else {
                // For other cases, use the standard display label
                nodeLabel = this.getNodeDisplayLabel(nodeData, locationModule);
            }

            // Ensure label is always a string
            const labelString = String(nodeLabel || nodeId || '');
            options.push({ value: nodeId, label: labelString });
        });

        // Sort options alphabetically by label (ensure labels are strings)
        options.sort((a, b) => {
            const labelA = String(a.label || '');
            const labelB = String(b.label || '');
            return labelA.localeCompare(labelB);
        });

        // Add sorted options to dropdown
        options.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            nodeFilterSelect.appendChild(option);
        });
    }

    /**
     * Reset all connection filters to default state
     * Resets connection type checkboxes and node filter dropdown
     * Available in both hierarchy and location modes
     */
    resetConnectionFilters() {
        if (!this.state || !this.state.cy) {
            return;
        }

        // Reset connection type checkboxes to checked (default state)
        const showIntraNode = document.getElementById('showIntraNodeConnections');
        const showIntraRack = document.getElementById('showIntraRackConnections');
        const showInterRack = document.getElementById('showInterRackConnections');

        if (showIntraNode) showIntraNode.checked = true;
        if (showIntraRack) showIntraRack.checked = true;
        if (showInterRack) showInterRack.checked = true;

        // Reset node filter to "Show all nodes"
        const nodeFilterSelect = document.getElementById('nodeFilterSelect');
        if (nodeFilterSelect) {
            nodeFilterSelect.value = '';
        }

        // Reset template filter to "Show all templates" (hierarchy mode only)
        const templateFilterSelect = document.getElementById('templateFilterSelect');
        if (templateFilterSelect) {
            templateFilterSelect.value = '';
        }

        // Reapply filters to show all connections
        if (window.applyNodeFilter && typeof window.applyNodeFilter === 'function') {
            window.applyNodeFilter();
        }
        if (window.applyConnectionTypeFilter && typeof window.applyConnectionTypeFilter === 'function') {
            window.applyConnectionTypeFilter();
        }

        // Update status
        const statusDiv = document.getElementById('rangeStatus');
        if (statusDiv) {
            statusDiv.textContent = 'Showing all connections';
            statusDiv.style.color = '#666';
        }
    }

    /**
     * Show node information in the info panel
     * @param {Object} node - Cytoscape node
     * @param {Object} position - Position for the info panel (optional)
     */
    showNodeInfo(node, _position) {
        // Clear isEditing flag from all nodes when showing regular info
        if (this.state.cy) {
            this.state.cy.nodes().forEach((n) => {
                if (n.data('isEditing')) {
                    n.data('isEditing', false);
                }
            });
        }

        const data = node.data();
        const nodeInfo = document.getElementById('nodeInfo');
        const content = document.getElementById('nodeInfoContent');

        if (!nodeInfo || !content) {
            return;
        }

        let html = `<strong>${data.label || data.id}</strong><br>`;
        html += `Type: ${data.type || 'Unknown'}<br>`;

        // Determine current visualization mode
        const currentMode = this.state.mode;

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
            const isLogicalMode = currentMode === 'hierarchy';

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
            let locationData = {};
            if (window.location_getNodeData && typeof window.location_getNodeData === 'function') {
                locationData = window.location_getNodeData(node);
            }
            const isLogicalMode = currentMode === 'hierarchy';

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

                if (window.getEthChannelMapping && typeof window.getEthChannelMapping === 'function') {
                    const ethChannel = window.getEthChannelMapping(nodeType, data.port);
                    html += `Eth_Channel Mapping: ${ethChannel}<br>`;
                }
            }
        }

        content.innerHTML = html;

        // Position popup in top-right corner of the window
        nodeInfo.style.right = '10px';
        nodeInfo.style.top = '10px';
        nodeInfo.style.left = 'auto';
        nodeInfo.style.display = 'block';
    }

    /**
     * Hide the node info panel
     */
    hideNodeInfo() {
        const nodeInfo = document.getElementById('nodeInfo');
        if (nodeInfo) {
            nodeInfo.style.display = 'none';
        }
    }

    /**
     * Show detailed information about a connection
     * Always shows full path regardless of collapsed state
     * @param {Object} edge - Cytoscape edge element
     * @param {Object} position - Position to display the info panel
     */
    showConnectionInfo(edge, _position) {
        const nodeInfo = document.getElementById('nodeInfo');
        const content = document.getElementById('nodeInfoContent');

        if (!nodeInfo || !content) {
            return;
        }

        const edgeData = edge.data();
        // Always use the original port IDs from edge data, not the visual source/target
        // which might point to collapsed parents
        const sourceNode = this.state.cy.getElementById(edgeData.source);
        const targetNode = this.state.cy.getElementById(edgeData.target);

        // Get detailed location info for both endpoints - always full path
        let sourceInfo = '';
        let targetInfo = '';
        if (window.getPortLocationInfo && typeof window.getPortLocationInfo === 'function') {
            sourceInfo = window.getPortLocationInfo(sourceNode);
            targetInfo = window.getPortLocationInfo(targetNode);
        } else {
            // Fallback if function not available
            sourceInfo = sourceNode && sourceNode.length ? sourceNode.id() : 'Unknown';
            targetInfo = targetNode && targetNode.length ? targetNode.id() : 'Unknown';
        }

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

    /**
     * Get template name for a node by traversing up to find a graph node with template_name
     * @param {Object} node - Cytoscape node (port, tray, shelf, or graph)
     * @returns {string|null} Template name or null if not found
     */
    getTemplateNameForNode(node) {
        if (!node || !node.length) return null;

        // Check if this node itself has template_name (graph nodes)
        const templateName = node.data('template_name');
        if (templateName) {
            return templateName;
        }

        // Traverse up the parent hierarchy to find a graph node with template_name
        let currentNode = node;
        for (let i = 0; i < 10; i++) { // Limit traversal depth
            const parent = currentNode.parent();
            if (!parent || !parent.length) {
                break;
            }
            
            const parentTemplateName = parent.data('template_name');
            if (parentTemplateName) {
                return parentTemplateName;
            }
            
            currentNode = parent;
        }

        return null;
    }

    /**
     * Force apply curve styles to all edges based on whether they're on the same shelf
     * or have the same template type (for collapsed graph nodes in hierarchy mode)
     * Uses bezier curve style which automatically separates multiple edges between the same nodes
     */
    forceApplyCurveStyles() {
        if (!this.state.cy) return;

        const edges = this.state.cy.edges();
        const viewport = this.state.cy.extent();
        const viewportWidth = viewport.w;
        const viewportHeight = viewport.h;
        // Calculate control-point-step-size based on viewport for better separation
        const controlPointStepSize = Math.min(viewportWidth, viewportHeight) * 0.03; // 3% of smaller viewport dimension

        console.log(`[forceApplyCurveStyles] Applying curve styles to ${edges.length} edges, control-point-step-size: ${controlPointStepSize.toFixed(2)}px`);

        this.state.cy.startBatch();

        edges.forEach((edge) => {
            let sourceNode, targetNode;
            let isSameTemplate = false;
            let isSameShelf = false;
            const isRerouted = edge.data('isRerouted');

            // For rerouted edges (collapsed nodes), check if the collapsed graph nodes have the same template type
            if (isRerouted) {
                // Rerouted edges connect collapsed graph nodes - check their template_name directly
                sourceNode = edge.source();
                targetNode = edge.target();
                
                // Check if both endpoints are graph nodes with the same template_name
                const sourceTemplateName = sourceNode.data('template_name');
                const targetTemplateName = targetNode.data('template_name');
                const sourceIsGraph = sourceNode.data('type') === 'graph';
                const targetIsGraph = targetNode.data('type') === 'graph';
                
                if (sourceIsGraph && targetIsGraph && sourceTemplateName && targetTemplateName) {
                    isSameTemplate = sourceTemplateName === targetTemplateName;
                }
                // For rerouted edges, don't check same shelf (graph nodes don't have shelves - shelves are children of graphs)
            } else {
                // Regular edges - get original endpoints (ports)
                const endpoints = this.getOriginalEdgeEndpoints(edge);
                sourceNode = endpoints.sourceNode;
                targetNode = endpoints.targetNode;
                
                // For regular port-to-port edges, check if they're on the same shelf
                const sourceId = sourceNode.id();
                const targetId = targetNode.id();
                isSameShelf = this.checkSameShelf(sourceId, targetId);
                
                // Debug: Log why same shelf check failed
                if (!isSameShelf) {
                    const sourceShelfId = this.extractShelfIdFromNodeId(sourceId);
                    const targetShelfId = this.extractShelfIdFromNodeId(targetId);
                    console.log(`[forceApplyCurveStyles] Same shelf check failed for ${sourceId} -> ${targetId}: sourceShelf=${sourceShelfId}, targetShelf=${targetShelfId}`);
                }
                // Don't check template for regular port-to-port edges
            }

            // Apply bezier for all edges - automatically separates multiple edges between the same nodes
            // bezier provides better visual separation than haystack for parallel edges
            let curveStyle = 'bezier';
            let styleProps = {
                'curve-style': 'bezier',
                'control-point-step-size': controlPointStepSize
            };

            // Apply style directly to edge - this overrides stylesheet rules
            edge.style(styleProps);

            // Debug log for each edge
            const edgeId = edge.id();
            const sourceLabel = sourceNode.data('label') || sourceNode.id();
            const targetLabel = targetNode.data('label') || targetNode.id();
            const reroutedFlag = isRerouted ? ' [REROUTED]' : '';
            const templateInfo = isSameTemplate ? ` [SAME_TEMPLATE: ${sourceNode.data('template_name')}]` : '';
            const shelfInfo = isSameShelf ? ' [SAME_SHELF]' : '';
            
            console.log(`[forceApplyCurveStyles] Edge ${edgeId}: ${sourceLabel} -> ${targetLabel} | Style: ${curveStyle}${reroutedFlag}${templateInfo}${shelfInfo}`);
        });

        this.state.cy.endBatch();

        // Force style recalculation and render to ensure changes take effect
        // This ensures programmatic style changes override stylesheet rules
        this.state.cy.style().update();
        this.state.cy.forceRender();
        
        console.log(`[forceApplyCurveStyles] Completed applying curve styles to ${edges.length} edges`);
    }

    /**
     * Check if two nodes are on the same shelf
     * @param {string} sourceId - Source node ID
     * @param {string} targetId - Target node ID
     * @returns {boolean} True if both nodes are on the same shelf
     */
    checkSameShelf(sourceId, targetId) {
        if (!this.state.cy) return false;

        const sourceNode = this.state.cy.getElementById(sourceId);
        const targetNode = this.state.cy.getElementById(targetId);

        if (!sourceNode.length || !targetNode.length) {
            console.log(`[checkSameShelf] Node not found: source=${sourceId} (${sourceNode.length}), target=${targetId} (${targetNode.length})`);
            return false;
        }

        // Get parent 2 levels up (port -> tray -> shelf)
        let sourceShelf = null;
        let targetShelf = null;

        if (window.hierarchyModule && typeof window.hierarchyModule.getParentAtLevel === 'function') {
            sourceShelf = window.hierarchyModule.getParentAtLevel(sourceNode, 2);
            targetShelf = window.hierarchyModule.getParentAtLevel(targetNode, 2);
        } else {
            // Fallback: use getParentShelfNode
            sourceShelf = this.getParentShelfNode(sourceNode);
            targetShelf = this.getParentShelfNode(targetNode);
        }

        const result = sourceShelf && targetShelf && sourceShelf.length && targetShelf.length && sourceShelf.id() === targetShelf.id();
        
        if (!result) {
            const sourceShelfId = sourceShelf && sourceShelf.length ? sourceShelf.id() : 'null';
            const targetShelfId = targetShelf && targetShelf.length ? targetShelf.id() : 'null';
            console.log(`[checkSameShelf] Different shelves: source=${sourceId} -> shelf=${sourceShelfId}, target=${targetId} -> shelf=${targetShelfId}`);
        }
        
        return result;
    }

    /**
     * Build detailed location string for a port
     * Always shows the full path regardless of collapsed state
     * @param {Object} portNode - Cytoscape port node
     * @param {Object} locationModule - LocationModule instance (for buildLabel)
     * @returns {String} Formatted location string
     */
    getPortLocationInfo(portNode, locationModule = null) {
        const portId = portNode.id();
        const portLabel = portNode.data('label');
        
        // Get tray and port numbers from port node data (always available regardless of collapse state)
        const trayNum = portNode.data('tray');
        const portNum = portNode.data('port');
        
        // Try to get tray node (may fail if collapsed, but we have tray number from data)
        let trayNode = portNode.parent();
        if (!trayNode || !trayNode.length) {
            // If parent() fails (collapsed), try to get tray by ID
            // Port ID format: {shelfId}:t{trayNum}:p{portNum} or {trayId}:p{portNum}
            const portIdParts = portId.split(':');
            if (portIdParts.length >= 2) {
                const trayId = portIdParts.slice(0, -1).join(':'); // Everything except last part
                trayNode = this.state.cy.getElementById(trayId);
            }
        }
        
        // Get shelf node - use robust method that works even when collapsed
        let shelfNode = null;
        if (trayNode && trayNode.length) {
            shelfNode = trayNode.parent();
        }
        
        // If parent() fails, extract shelf ID from port ID and get shelf directly
        if (!shelfNode || !shelfNode.length) {
            const shelfId = this.extractShelfIdFromNodeId(portId);
            if (shelfId) {
                shelfNode = this.state.cy.getElementById(shelfId);
            }
        }
        
        // Fallback: use getParentShelfNode helper
        if (!shelfNode || !shelfNode.length) {
            shelfNode = this.getParentShelfNode(portNode);
        }

        // Get location data from shelf node (if available)
        let hostname = '';
        let hall = '';
        let aisle = '';
        let rackNum = undefined;
        let shelfU = undefined;
        let hostIndex = undefined;
        
        if (shelfNode && shelfNode.length) {
            hostname = shelfNode.data('hostname') || '';
            hall = shelfNode.data('hall') || '';
            aisle = shelfNode.data('aisle') || '';
            rackNum = shelfNode.data('rack_num');
            shelfU = shelfNode.data('shelf_u');
            hostIndex = shelfNode.data('host_index');
        } else {
            // If we can't get shelf node, try to extract host_index from port ID
            // Port ID might be in format: {shelfId}:t{trayNum}:p{portNum} where shelfId is host_index
            const shelfId = this.extractShelfIdFromNodeId(portId);
            if (shelfId && /^\d+$/.test(shelfId)) {
                hostIndex = parseInt(shelfId, 10);
            }
        }
        
        const trayLabel = trayNode && trayNode.length ? trayNode.data('label') : (trayNum !== undefined ? `T${trayNum}` : 'Tray');

        // Build location string
        const locationParts = [];

        // Prefer location format (Hall-Aisle-Rack-Shelf) as default
        if (hall && aisle && rackNum !== undefined && shelfU !== undefined) {
            // Use location format: HallAisle##U##
            if (locationModule && typeof locationModule.buildLabel === 'function') {
                locationParts.push(locationModule.buildLabel(hall, aisle, rackNum, shelfU));
            } else if (window.location_buildLabel && typeof window.location_buildLabel === 'function') {
                locationParts.push(window.location_buildLabel(hall, aisle, rackNum, shelfU));
            } else {
                // Fallback
                locationParts.push(`${hall}${aisle}${rackNum}U${shelfU}`);
            }
        } else if (hostname) {
            // Fallback to hostname if location info is unavailable
            locationParts.push(hostname);
        } else if (shelfNode && shelfNode.length && shelfNode.data('label')) {
            // Final fallback to shelf label
            locationParts.push(shelfNode.data('label'));
        }

        // Always add host_index, tray, and port at the end - regardless of collapse/expand state
        // Format: ... › host_{hostIndex} › T{trayNum} › P{portNum}
        // This ensures consistent endpoint description that doesn't change with collapse/expand
        if (hostIndex !== undefined && hostIndex !== null) {
            locationParts.push(`host_${hostIndex}`);
        }
        
        // Add tray info (use tray number if available, otherwise tray label)
        if (trayNum !== undefined && trayNum !== null) {
            locationParts.push(`T${trayNum}`);
        } else if (trayLabel) {
            locationParts.push(trayLabel);
        }
        
        // Add port info (use port number if available, otherwise port label)
        if (portNum !== undefined && portNum !== null) {
            locationParts.push(`P${portNum}`);
        } else if (portLabel) {
            locationParts.push(portLabel);
        }

        return locationParts.join(' › ');
    }

    /**
     * Common interface for creating editing dialogs
     * Handles all the boilerplate: clearing flags, positioning, etc.
     * @param {Object} options - Configuration options
     * @param {Object} options.node - The node being edited
     * @param {string} options.title - Dialog title
     * @param {string} options.contentHtml - HTML content for the dialog body
     * @param {string} [options.focusElementId] - Optional ID of element to focus after opening
     * @param {Function} [options.onSetup] - Optional callback after dialog is set up
     */
    showEditingDialog(options) {
        const { node, title, contentHtml, focusElementId, onSetup } = options;

        // Clear isEditing flag from all other nodes first
        if (this.state.cy) {
            this.state.cy.nodes().forEach((n) => {
                if (n.id() !== node.id() && n.data('isEditing') === true) {
                    n.data('isEditing', false);
                }
            });
        }

        const nodeInfo = document.getElementById('nodeInfo');
        const content = document.getElementById('nodeInfoContent');

        if (!nodeInfo || !content) {
            console.error('[showEditingDialog] nodeInfo or content element not found');
            return;
        }

        // Build HTML with title
        let html = `<strong>${title}</strong><br><br>`;
        html += contentHtml;

        content.innerHTML = html;

        // Position popup in top-right corner of the window
        nodeInfo.style.right = '10px';
        nodeInfo.style.top = '10px';
        nodeInfo.style.left = 'auto';
        nodeInfo.style.display = 'block';

        // Mark as editing
        node.data('isEditing', true);

        // Focus on specified element if provided
        if (focusElementId) {
            setTimeout(() => {
                const input = document.getElementById(focusElementId);
                if (input) {
                    input.focus();
                    if (input.select) {
                        input.select();
                    }
                }
            }, 100);
        }

        // Call optional setup callback
        if (onSetup && typeof onSetup === 'function') {
            setTimeout(() => {
                onSetup();
            }, 100);
        }
    }

    /**
     * Enable shelf editing UI
     * Shows different UI based on visualization mode:
     * - Hierarchy mode: Template move options
     * - Location mode: Location editing fields (hostname, hall, aisle, rack, shelf_u)
     * @param {Object} node - The shelf node to edit
     * @param {Object} position - Position for the popup
     */
    enableShelfEditing(node, _position) {
        const data = node.data();
        const isHierarchyMode = this.state.mode === 'hierarchy';
        const isEditingModeEnabled = this.state.editing.isEdgeCreationMode;

        // Build content HTML based on mode
        let contentHtml = `Node: ${data.label || data.id}<br><br>`;

        if (isHierarchyMode) {
            // In hierarchy mode, show move to template section (only in editing mode)
            if (this.state.editing.isEdgeCreationMode) {
                contentHtml += `<div style="margin-bottom: 15px; padding: 10px; background: #e7f3ff; border-radius: 4px;">`;
                contentHtml += `<strong>Move to Different Template:</strong><br>`;
                contentHtml += `<select id="moveTargetTemplateSelect" style="width: 200px; padding: 5px; margin-top: 5px;">`;
                contentHtml += `<option value="">-- Select Target Template --</option>`;
                contentHtml += `</select>`;
                contentHtml += `<br>`;
                contentHtml += `<button onclick="executeMoveToTemplate('${node.id()}')" style="padding: 6px 12px; background: #007bff; color: white; border: none; cursor: pointer; margin-top: 8px;">Move Node</button>`;
                contentHtml += `</div>`;
            }

            contentHtml += `<div style="margin-top: 15px;">`;
            contentHtml += `<button onclick="clearAllSelections()" style="padding: 8px 15px; background: #6c757d; color: white; border: none; cursor: pointer;">Close</button>`;
            contentHtml += `</div>`;
        } else {
            // In location mode, show all editable fields (only in editing mode)
            if (isEditingModeEnabled) {
                contentHtml += `<div style="margin-bottom: 10px;">`;
                contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hostname:</label>`;
                contentHtml += `<input type="text" id="hostnameEditInput" value="${data.hostname || ''}" placeholder="Enter hostname" style="width: 200px; padding: 5px;">`;
                contentHtml += `</div>`;

                contentHtml += `<div style="margin-bottom: 10px;">`;
                contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hall:</label>`;
                contentHtml += `<input type="text" id="hallEditInput" value="${data.hall || ''}" placeholder="Enter hall" style="width: 200px; padding: 5px;">`;
                contentHtml += `</div>`;

                contentHtml += `<div style="margin-bottom: 10px;">`;
                contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Aisle:</label>`;
                contentHtml += `<input type="text" id="aisleEditInput" value="${data.aisle || ''}" placeholder="Enter aisle" style="width: 200px; padding: 5px;">`;
                contentHtml += `</div>`;

                contentHtml += `<div style="margin-bottom: 10px;">`;
                contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Rack:</label>`;
                contentHtml += `<input type="number" id="rackEditInput" value="${data.rack_num || ''}" placeholder="Enter rack number" style="width: 200px; padding: 5px;">`;
                contentHtml += `</div>`;

                contentHtml += `<div style="margin-bottom: 10px;">`;
                contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Shelf U:</label>`;
                contentHtml += `<input type="number" id="shelfUEditInput" value="${data.shelf_u || ''}" placeholder="Enter shelf U" style="width: 200px; padding: 5px;">`;
                contentHtml += `</div>`;

                contentHtml += `<br>`;
                contentHtml += `<button onclick="saveShelfEdit('${node.id()}')" style="background: #007bff; color: white; border: none; padding: 8px 15px; margin-right: 5px; cursor: pointer;">Save</button>`;
                contentHtml += `<button onclick="clearAllSelections()" style="background: #6c757d; color: white; border: none; padding: 8px 15px; cursor: pointer;">Cancel</button>`;
            } else {
                contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px;">Editing mode must be enabled to edit shelf information.</p>`;
            }
        }

        // Use common dialog interface
        this.showEditingDialog({
            node: node,
            title: 'Edit Shelf Node',
            contentHtml: contentHtml,
            focusElementId: isHierarchyMode ? null : 'hostnameEditInput',
            onSetup: () => {
                if (isHierarchyMode && this.state.editing.isEdgeCreationMode) {
                    // Populate the move target template dropdown (only in editing mode)
                    if (window.hierarchyModule && typeof window.hierarchyModule.populateMoveTargetTemplates === 'function') {
                        window.hierarchyModule.populateMoveTargetTemplates(node);
                    }
                }
            }
        });
    }

    /**
     * Normalize rack_num to integer (handles string, number, null, undefined)
     * @param {*} rackNum - Rack number value (can be string, number, null, undefined)
     * @returns {number|null} Integer rack number or null if invalid/empty
     */
    _normalizeRackNum(rackNum) {
        if (rackNum === null || rackNum === undefined || rackNum === '') {
            return null;
        }
        const parsed = parseInt(rackNum, 10);
        return isNaN(parsed) ? null : parsed;
    }

    /**
     * Helper function to update a node and all its descendants with a new property value
     * Used for node property updates (location fields, etc.)
     * @param {Object} node - Cytoscape node
     * @param {string} property - Property name to update
     * @param {*} value - New value for the property
     */
    updateNodeAndDescendants(node, property, value) {
        node.data(property, value);
        node.descendants().forEach((child) => {
            child.data(property, value);
        });
    }

    /**
     * Clear all selections (nodes, connections, ports, info panels)
     */
    clearAllSelections() {
        this.hideNodeInfo();

        // Clear isEditing flag from all nodes
        if (this.state.cy) {
            this.state.cy.nodes().forEach((n) => {
                if (n.data('isEditing') === true) {
                    n.data('isEditing', false);
                }
            });

            // Clear cytoscape multi-selections
            this.state.cy.elements().unselect();
        }

        if (this.state.editing.selectedFirstPort) {
            this.state.editing.selectedFirstPort.removeClass('source-selected');
            this.state.editing.selectedFirstPort = null;
        }

        if (this.state.editing.selectedConnection) {
            this.state.editing.selectedConnection.removeClass('selected-connection');
            this.state.editing.selectedConnection = null;
            if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                window.updateDeleteButtonState();
            }
        }

        if (this.state.editing.selectedNode) {
            this.state.editing.selectedNode.removeClass('selected-node');
            this.state.editing.selectedNode = null;
            if (window.updateDeleteNodeButtonState && typeof window.updateDeleteNodeButtonState === 'function') {
                window.updateDeleteNodeButtonState();
            }
        }
    }

    /**
     * Filter cytoscape data to include only fields needed for export operations
     * This significantly reduces payload size by removing visual properties and unused data
     * 
     * Fields clarification:
     * - logical_path: Self-defined field set by application during cabling descriptor import or node creation
     * - template_name: Self-defined field set by application when creating graph nodes
     * - parent: Self-defined field set by application to establish hierarchy
     * All are custom data fields stored in Cytoscape node/edge data, not native Cytoscape properties.
     * 
     * @param {Object} cytoscapeData - Full cytoscape data from state.cy.elements().jsons()
     * @param {string} exportType - Type of export: 'cabling' or 'deployment'
     * @returns {Object} Filtered cytoscape data with only necessary fields
     */
    filterCytoscapeDataForExport(cytoscapeData, exportType = 'cabling') {
        const elements = cytoscapeData.elements || [];
        const metadata = cytoscapeData.metadata || {};

        // Define fields needed for each export type
        // These are all self-defined fields stored in Cytoscape data, not native Cytoscape properties
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
            'source', 'target'  // Only need source/target for connection extraction
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
            // For cabling export, we need graph_templates and some tracking fields
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
        // For deployment export, metadata is not needed

        return {
            elements: filteredElements,
            ...(Object.keys(filteredMetadata).length > 0 ? { metadata: filteredMetadata } : {})
        };
    }

}

