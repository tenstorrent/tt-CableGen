/**
 * Node type configurations
 * Defines physical characteristics of each node type
 */

/**
 * Default node type configurations
 * Can be overridden by server-side configurations
 */
export const NODE_TYPES = {
    'N300_LB': {
        tray_count: 4,
        ports_per_tray: 2,
        tray_layout: 'horizontal',
        displayName: 'N300 LB',
        color: '#3498db'
    },
    'N300_QB': {
        tray_count: 4,
        ports_per_tray: 2,
        tray_layout: 'horizontal',
        displayName: 'N300 QB',
        color: '#3498db'
    },
    'WH_GALAXY': {
        tray_count: 4,
        ports_per_tray: 6,
        tray_layout: 'vertical',
        displayName: 'Wormhole Galaxy',
        color: '#2ecc71'
    },
    'BH_GALAXY': {
        tray_count: 4,
        ports_per_tray: 14,
        tray_layout: 'vertical',
        displayName: 'Blackhole Galaxy',
        color: '#e74c3c'
    },
    'P150_QB_GLOBAL': {
        tray_count: 4,
        ports_per_tray: 4,
        tray_layout: 'horizontal',
        displayName: 'P150 QB Global',
        color: '#f39c12'
    },
    'P150_QB_AMERICA': {
        tray_count: 4,
        ports_per_tray: 4,
        tray_layout: 'horizontal',
        displayName: 'P150 QB America',
        color: '#f39c12'
    },
    'P150_LB': {
        tray_count: 8,
        ports_per_tray: 4,
        tray_layout: 'horizontal',
        displayName: 'P150 LB',
        color: '#9b59b6'
    }
};

/**
 * Cache for merged configurations (default + server)
 */
let configCache = { ...NODE_TYPES };

/**
 * Initialize node configurations
 * Merges default configs with server-provided configs if available
 * 
 * @param {Object} serverConfigs - Optional server-side configurations
 */
export function initializeNodeConfigs(serverConfigs = null) {
    if (serverConfigs && Object.keys(serverConfigs).length > 0) {
        // Merge server configs with defaults
        configCache = {};
        for (const [nodeType, config] of Object.entries(NODE_TYPES)) {
            configCache[nodeType] = {
                ...config,
                ...(serverConfigs[nodeType] || {})
            };
        }
        // Add any server-only configs
        for (const [nodeType, config] of Object.entries(serverConfigs)) {
            if (!configCache[nodeType]) {
                configCache[nodeType] = config;
            }
        }
        console.log('Node configurations loaded from server:', configCache);
    } else {
        // Use default configs
        configCache = { ...NODE_TYPES };
        console.log('Using default node configurations');
    }
    
    return configCache;
}

/**
 * Get node type configuration
 * Automatically handles _DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS suffix normalization
 * 
 * @param {string} nodeType - Node type identifier (e.g., 'N300_LB', 'N300_LB_DEFAULT', 'WH_GALAXY_X_TORUS')
 * @returns {Object|null} Node configuration or null if not found
 * 
 * @example
 * const config = getNodeConfig('N300_LB_DEFAULT');
 * // Returns: { tray_count: 4, ports_per_tray: 2, tray_layout: 'horizontal', ... }
 * const config2 = getNodeConfig('WH_GALAXY_X_TORUS');
 * // Returns: { tray_count: 4, ports_per_tray: 6, tray_layout: 'vertical', ... }
 */
export function getNodeConfig(nodeType) {
    if (!nodeType) return null;
    
    // Normalize: strip variation suffixes (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
    // Order matters: check longer suffixes first (_XY_TORUS before _X_TORUS/_Y_TORUS)
    let normalized = nodeType;
    if (normalized.endsWith('_XY_TORUS')) {
        normalized = normalized.slice(0, -9); // Remove '_XY_TORUS' (9 chars)
    } else if (normalized.endsWith('_X_TORUS')) {
        normalized = normalized.slice(0, -8); // Remove '_X_TORUS' (8 chars)
    } else if (normalized.endsWith('_Y_TORUS')) {
        normalized = normalized.slice(0, -8); // Remove '_Y_TORUS' (8 chars)
    } else if (normalized.endsWith('_DEFAULT')) {
        normalized = normalized.slice(0, -8); // Remove '_DEFAULT' (8 chars)
    }
    
    return configCache[normalized] || null;
}

/**
 * Validate that a node type exists
 * 
 * @param {string} nodeType - Node type to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidNodeType(nodeType) {
    return getNodeConfig(nodeType) !== null;
}

/**
 * Get all available node types
 * 
 * @returns {string[]} Array of node type identifiers
 */
export function getAllNodeTypes() {
    return Object.keys(configCache);
}

/**
 * Get node type display name
 * 
 * @param {string} nodeType - Node type identifier
 * @returns {string} Display name or the node type itself if not found
 */
export function getNodeDisplayName(nodeType) {
    const config = getNodeConfig(nodeType);
    return config?.displayName || nodeType;
}

/**
 * Get node type color
 * 
 * @param {string} nodeType - Node type identifier
 * @returns {string} Color hex code or default color
 */
export function getNodeColor(nodeType) {
    const config = getNodeConfig(nodeType);
    return config?.color || '#666';
}

/**
 * Check if tray layout is vertical
 * 
 * @param {string} nodeType - Node type identifier
 * @returns {boolean} True if vertical layout, false if horizontal
 */
export function isVerticalLayout(nodeType) {
    const config = getNodeConfig(nodeType);
    return config?.tray_layout === 'vertical';
}

/**
 * Get total port count for a node type
 * 
 * @param {string} nodeType - Node type identifier
 * @returns {number} Total number of ports (trays × ports_per_tray)
 */
export function getTotalPortCount(nodeType) {
    const config = getNodeConfig(nodeType);
    if (!config) return 0;
    return config.tray_count * config.ports_per_tray;
}

