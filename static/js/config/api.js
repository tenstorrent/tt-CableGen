/**
 * API endpoint configuration
 * Centralized API endpoint definitions and request defaults
 */

/**
 * API endpoint paths
 */
export const API_ENDPOINTS = {
    // File upload
    UPLOAD_CSV: '/upload_csv',
    /** Merge new CSV with existing graph (send existing_data + csv_file) */
    MERGE_CSV: '/merge_csv',

    // External file loading
    LOAD_EXTERNAL_FILE: '/load_external_file',
    
    // Export operations
    EXPORT_CABLING_DESCRIPTOR: '/export_cabling_descriptor',
    EXPORT_DEPLOYMENT_DESCRIPTOR: '/export_deployment_descriptor',
    EXPORT_FLAT_CABLING: '/export_flat_cabling_descriptor',
    
    // Generate operations
    GENERATE_CABLING_GUIDE: '/generate_cabling_guide',
    GENERATE_FSD: '/generate_fsd',
    
    // Configuration
    GET_NODE_CONFIGS: '/get_node_configs',
    
    // Validation
    VALIDATE_HOSTNAMES: '/validate_hostnames',
    VALIDATE_CONNECTIONS: '/validate_connections'
};

/**
 * API request defaults
 */
export const API_DEFAULTS = {
    // Timeout in milliseconds
    timeout: 30000, // 30 seconds
    
    // Number of retry attempts for failed requests
    retries: 3,
    
    // Delay between retries in milliseconds
    retryDelay: 1000,
    
    // Default headers
    headers: {
        'Content-Type': 'application/json'
    }
};

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
};

/**
 * Response types
 */
export const RESPONSE_TYPES = {
    JSON: 'application/json',
    BLOB: 'application/octet-stream',
    TEXT: 'text/plain',
    CSV: 'text/csv'
};

/**
 * Build full API URL
 * 
 * @param {string} endpoint - Endpoint path
 * @param {Object} params - Optional query parameters
 * @returns {string} Full URL with query string
 * 
 * @example
 * buildApiUrl(API_ENDPOINTS.EXPORT_CABLING_DESCRIPTOR, { format: 'json' })
 * // Returns: '/export_cabling_descriptor?format=json'
 */
export function buildApiUrl(endpoint, params = {}) {
    const url = new URL(endpoint, window.location.origin);
    
    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            url.searchParams.append(key, value);
        }
    });
    
    return url.pathname + url.search;
}

/**
 * Check if HTTP status is successful (2xx)
 * 
 * @param {number} status - HTTP status code
 * @returns {boolean} True if successful
 */
export function isSuccessStatus(status) {
    return status >= 200 && status < 300;
}

/**
 * Check if HTTP status indicates a client error (4xx)
 * 
 * @param {number} status - HTTP status code
 * @returns {boolean} True if client error
 */
export function isClientError(status) {
    return status >= 400 && status < 500;
}

/**
 * Check if HTTP status indicates a server error (5xx)
 * 
 * @param {number} status - HTTP status code
 * @returns {boolean} True if server error
 */
export function isServerError(status) {
    return status >= 500 && status < 600;
}

/**
 * Get user-friendly error message for HTTP status
 * 
 * @param {number} status - HTTP status code
 * @returns {string} Error message
 */
export function getStatusMessage(status) {
    const messages = {
        [HTTP_STATUS.BAD_REQUEST]: 'Invalid request. Please check your data.',
        [HTTP_STATUS.UNAUTHORIZED]: 'Authentication required.',
        [HTTP_STATUS.FORBIDDEN]: 'Access denied.',
        [HTTP_STATUS.NOT_FOUND]: 'Resource not found.',
        [HTTP_STATUS.CONFLICT]: 'Conflict with existing data.',
        [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'Server error. Please try again.',
        [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable.'
    };
    
    return messages[status] || `Request failed with status ${status}`;
}

