/**
 * Factory for creating Cytoscape nodes with consistent structure
 * Eliminates duplicate node creation logic throughout the codebase
 */
import { getNodeConfig, isValidNodeType } from '../config/node-types.js';

export class NodeFactory {
    constructor(state) {
        this.state = state;
    }
    
    /**
     * Create a shelf node with trays and ports
     * @param {Object} options - Shelf creation options
     * @param {number} [options.hostIndex] - Host index (auto-incremented if not provided)
     * @param {string} options.label - Human-readable label
     * @param {string} options.nodeType - Node type (must be valid)
     * @param {Object} [options.position={x:0,y:0}] - Initial position
     * @param {string|null} [options.parent=null] - Parent node ID
     * @param {Object} [options.location={}] - Location data (hall, aisle, rack_num, shelf_u)
     * @param {string|null} [options.childName=null] - Template-local name
     * @param {Array} [options.logicalPath=[]] - Hierarchical path
     * @param {boolean} [options.createChildren=true] - Auto-create trays/ports
     * @returns {Object} Created shelf node data (not yet added to cytoscape)
     */
    createShelf(options) {
        const {
            hostIndex = this.state.data.globalHostCounter++,
            label,
            nodeType,
            position = { x: 0, y: 0 },
            parent = null,
            location = {},
            childName = null,
            logicalPath = [],
            createChildren = true
        } = options;
        
        // Validate node type
        const config = getNodeConfig(nodeType);
        if (!config) {
            throw new Error(`Invalid node type: ${nodeType}`);
        }
        
        // Create shelf ID using descriptor format
        const shelfId = String(hostIndex);
        
        // Build shelf data
        const shelfData = {
            id: shelfId,
            label: label || `Shelf ${hostIndex}`,
            type: 'shelf',
            host_index: hostIndex,
            shelf_node_type: nodeType
        };
        
        // Add optional fields
        if (parent) shelfData.parent = parent;
        if (childName) shelfData.child_name = childName;
        if (logicalPath.length > 0) shelfData.logical_path = logicalPath;
        
        // Add location data
        Object.assign(shelfData, location);
        
        // Create shelf node data structure (not yet added to cytoscape)
        const shelfNode = {
            data: shelfData,
            position,
            classes: 'shelf'
        };
        
        // Create trays and ports if requested
        if (createChildren) {
            const trayPortNodes = this.createTraysAndPorts(shelfId, hostIndex, nodeType, location);
            return {
                shelf: shelfNode,
                children: trayPortNodes
            };
        }
        
        return {
            shelf: shelfNode,
            children: []
        };
    }
    
    /**
     * Create trays and ports for a shelf
     * @param {string} shelfId - Parent shelf ID
     * @param {number} hostIndex - Host index
     * @param {string} nodeType - Node type
     * @param {Object} location - Location data to propagate to trays/ports
     * @returns {Array} Array of tray and port node data structures
     */
    createTraysAndPorts(shelfId, hostIndex, nodeType, location = {}) {
        const config = getNodeConfig(nodeType);
        if (!config) {
            throw new Error(`Invalid node type: ${nodeType}`);
        }
        
        const nodesToAdd = [];
        
        for (let trayNum = 1; trayNum <= config.tray_count; trayNum++) {
            const tray = this._createTray(shelfId, hostIndex, trayNum, nodeType, location);
            nodesToAdd.push(tray);
            
            for (let portNum = 1; portNum <= config.ports_per_tray; portNum++) {
                const port = this._createPort(
                    tray.data.id, 
                    hostIndex, 
                    trayNum, 
                    portNum, 
                    nodeType, 
                    location
                );
                nodesToAdd.push(port);
            }
        }
        
        return nodesToAdd;
    }
    
    /**
     * Create a single tray node (internal)
     * @private
     */
    _createTray(shelfId, hostIndex, trayNum, nodeType, location) {
        const trayData = {
            id: `${hostIndex}:t${trayNum}`,
            parent: shelfId,
            label: `T${trayNum}`,
            type: 'tray',
            tray: trayNum,
            host_index: hostIndex,
            shelf_node_type: nodeType
        };
        
        Object.assign(trayData, location);
        
        return {
            data: trayData,
            position: { x: 0, y: 0 },
            classes: 'tray'
        };
    }
    
    /**
     * Create a single port node (internal)
     * @private
     */
    _createPort(trayId, hostIndex, trayNum, portNum, nodeType, location) {
        const portData = {
            id: `${hostIndex}:t${trayNum}:p${portNum}`,
            parent: trayId,
            label: `P${portNum}`,
            type: 'port',
            tray: trayNum,
            port: portNum,
            host_index: hostIndex,
            shelf_node_type: nodeType
        };
        
        Object.assign(portData, location);
        
        return {
            data: portData,
            position: { x: 0, y: 0 },
            classes: 'port'
        };
    }
    
    /**
     * Create a graph container node
     * @param {Object} options - Graph creation options
     * @param {string} options.id - Graph ID
     * @param {string} options.label - Graph label
     * @param {string} options.templateName - Template name
     * @param {Object} [options.position={x:0,y:0}] - Initial position
     * @param {string|null} [options.parent=null] - Parent node ID
     * @param {string|null} [options.childName=null] - Template-local name
     * @param {number} [options.depth=0] - Hierarchy depth
     * @returns {Object} Created graph node data structure
     */
    createGraph(options) {
        const {
            id,
            label,
            templateName,
            position = { x: 0, y: 0 },
            parent = null,
            childName = null,
            depth = 0
        } = options;
        
        const graphData = {
            id,
            label,
            type: 'graph',
            template_name: templateName,
            depth,
            graphType: templateName, // Compatibility field
            child_name: childName || label
        };
        
        if (parent) graphData.parent = parent;
        
        return {
            data: graphData,
            position,
            classes: 'graph'
        };
    }
    
    /**
     * Create a rack container node
     * @param {Object} options - Rack creation options
     * @param {number} options.rackNum - Rack number
     * @param {string} [options.hall] - Hall identifier
     * @param {string} [options.aisle] - Aisle identifier
     * @param {Object} [options.position={x:0,y:0}] - Initial position
     * @returns {Object} Created rack node data structure
     */
    createRack(options) {
        const {
            rackNum,
            hall,
            aisle,
            position = { x: 0, y: 0 }
        } = options;
        
        const rackId = `rack_${hall || 'default'}_${aisle || 'default'}_${rackNum}`;
        const rackLabel = hall && aisle 
            ? `Rack ${rackNum} (${hall}-${aisle})`
            : `Rack ${rackNum}`;
        
        return {
            data: {
                id: rackId,
                label: rackLabel,
                type: 'rack',
                rack_num: rackNum,
                hall: hall || '',
                aisle: aisle || ''
            },
            position,
            classes: 'rack'
        };
    }
}

