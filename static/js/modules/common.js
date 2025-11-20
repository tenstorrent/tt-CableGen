/**
 * Common module - functions used by both location and hierarchy modes
 * Extracted from visualizer.js to eliminate duplication and improve maintainability
 */
import { getNodeConfig } from '../config/node-types.js';
import { LAYOUT } from '../config/constants.js';

export class CommonModule {
    constructor(state, nodeFactory) {
        this.state = state;
        this.nodeFactory = nodeFactory;
        
        // Template color management (moved from globals)
        this.templateColors = {};
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
        this.nextColorIndex++;

        return color;
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
}

