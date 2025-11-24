/**
 * Configuration constants for CableGen Visualizer
 * Centralized constants to replace magic numbers throughout the codebase
 */

/**
 * Layout and spacing constants
 */
export const LAYOUT = {
    // Spacing between elements
    SHELF_SPACING: 140,
    RACK_SPACING: 500,
    GRAPH_SPACING: 800,
    PORT_SPACING: 20,
    TRAY_SPACING: 15,
    
    // Element dimensions
    RACK_WIDTH: 450,
    RACK_HEIGHT: 600,
    SHELF_WIDTH: 300,
    SHELF_HEIGHT: 100,
    TRAY_WIDTH: 30,
    TRAY_HEIGHT: 30,
    PORT_WIDTH: 15,
    PORT_HEIGHT: 25,
    
    // Default positions
    NEW_RACK_DEFAULT_X: 200,
    NEW_RACK_DEFAULT_Y: 200,
    NEW_GRAPH_DEFAULT_X: 0,
    NEW_GRAPH_DEFAULT_Y: 0,
    NEW_SHELF_OFFSET: 500,
    
    // Grid layout
    GRID_COLUMNS: 8,
    GRID_SPACING_X: 400,
    GRID_SPACING_Y: 300,
    GRID_START_X: 100,
    GRID_START_Y: 100,
    
    // Collapse/expand
    COLLAPSED_NODE_SIZE: 50,
    EXPANDED_NODE_MIN_SIZE: 100
};

/**
 * Location mode layout constants
 */
export const LAYOUT_CONSTANTS = {
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

/**
 * Animation and timing constants
 */
export const ANIMATION = {
    DURATION: 500,
    LAYOUT_DURATION: 1000,
    NOTIFICATION_DURATION: 3000,
    FADE_DURATION: 200,
    DEBOUNCE_DELAY: 300
};

/**
 * UI z-index layers
 */
export const Z_INDEX = {
    MODAL: 1000,
    MODAL_BACKDROP: 999,
    NOTIFICATION: 2000,
    TOOLTIP: 3000,
    NODE_INFO: 3100,
    CONNECTION_INFO: 3100
};

/**
 * Validation limits
 */
export const LIMITS = {
    MAX_TRAYS_PER_SHELF: 8,
    MAX_PORTS_PER_TRAY: 14,
    MAX_CONNECTIONS: 10000,
    MIN_HOST_INDEX: 0,
    MAX_HOST_INDEX: 999999,
    MAX_UNDO_HISTORY: 50,
    MAX_LABEL_LENGTH: 100
};

/**
 * Cytoscape configuration
 * Default settings for the Cytoscape graph visualization
 */
export const CYTOSCAPE_CONFIG = {
    minZoom: 0.1,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    boxSelectionEnabled: true,
    autounselectify: false,
    autoungrabify: false,
    selectionType: 'single'
};

/**
 * Cytoscape layout configuration
 */
export const LAYOUT_CONFIG = {
    // fcose layout settings
    FCOSE: {
        name: 'fcose',
        quality: 'proof',
        randomize: false,
        animate: false,
        fit: true,
        padding: 50,
        nodeDimensionsIncludeLabels: true,
        uniformNodeDimensions: false,
        packComponents: true,
        nodeRepulsion: 4500,
        idealEdgeLength: 100,
        edgeElasticity: 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        tile: true,
        tilingPaddingVertical: 10,
        tilingPaddingHorizontal: 10,
        gravityRangeCompound: 1.5,
        gravityCompound: 1.0,
        gravityRange: 3.8
    },
    
    // Grid layout settings
    GRID: {
        name: 'grid',
        fit: true,
        padding: 30,
        rows: undefined,
        cols: undefined,
        position: function(node) { return node; },
        sort: undefined,
        animate: false,
        animationDuration: 500,
        animationEasing: undefined,
        avoidOverlap: true,
        avoidOverlapPadding: 10,
        nodeDimensionsIncludeLabels: false,
        spacingFactor: undefined,
        condense: false
    }
};

/**
 * Visual styling constants
 */
export const VISUAL = {
    // Colors
    DEFAULT_NODE_COLOR: '#666',
    DEFAULT_EDGE_COLOR: '#999',
    SELECTED_COLOR: '#0074D9',
    HIGHLIGHTED_COLOR: '#FF4136',
    CONNECTED_PORT_COLOR: '#2ECC40',
    
    // Edge styles
    EDGE_WIDTH: 2,
    SELECTED_EDGE_WIDTH: 4,
    EDGE_CURVE_STYLE: 'bezier',
    
    // Node styles
    NODE_BORDER_WIDTH: 2,
    SELECTED_NODE_BORDER_WIDTH: 4
};

/**
 * Connection color constants for physical view
 */
export const CONNECTION_COLORS = {
    INTRA_NODE: '#4CAF50',  // Green for same node/shelf
    INTER_NODE: '#2196F3'   // Blue for different nodes/shelves
};

/**
 * Export formats and file extensions
 */
export const EXPORT_FORMATS = {
    CABLING_DESCRIPTOR: {
        extension: '.textproto',
        mimeType: 'text/plain'
    },
    DEPLOYMENT_DESCRIPTOR: {
        extension: '.textproto',
        mimeType: 'text/plain'
    },
    CABLING_GUIDE: {
        extension: '.csv',
        mimeType: 'text/csv'
    },
    FSD: {
        extension: '.textproto',
        mimeType: 'text/plain'
    }
};

/**
 * Debug and logging
 */
export const DEBUG = {
    ENABLED: false,
    LOG_STATE_CHANGES: false,
    LOG_EVENT_HANDLERS: false,
    LOG_LAYOUT_CALCULATIONS: false
};

