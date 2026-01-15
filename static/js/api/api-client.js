/**
 * API Client - Centralized API request handling
 * Extracted from visualizer.js to separate API logic from UI logic
 */
import { API_ENDPOINTS, API_DEFAULTS, getStatusMessage, isSuccessStatus } from '../config/api.js';

/**
 * Safely stringify JSON, handling circular references
 * @param {*} obj - Object to stringify
 * @returns {string} JSON string
 */
function safeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular Reference]';
            }
            seen.add(value);
        }
        // Handle functions (skip them)
        if (typeof value === 'function') {
            return undefined;
        }
        return value;
    });
}

export class ApiClient {
    constructor() {
        this.baseUrl = window.location.origin;
    }
    
    /**
     * Make a generic API request
     * @param {string} endpoint - API endpoint path
     * @param {Object} options - Request options
     * @param {string} [options.method='GET'] - HTTP method
     * @param {Object} [options.body] - Request body
     * @param {Object} [options.headers] - Additional headers
     * @param {FormData} [options.formData] - FormData for file uploads
     * @returns {Promise<Object>} Response data
     * @throws {Error} If request fails
     */
    async request(endpoint, options = {}) {
        const {
            method = 'GET',
            body = null,
            headers = {},
            formData = null
        } = options;
        
        const url = `${this.baseUrl}${endpoint}`;
        const requestHeaders = {
            ...API_DEFAULTS.headers,
            ...headers
        };
        
        // Don't set Content-Type for FormData (browser will set it with boundary)
        if (formData) {
            delete requestHeaders['Content-Type'];
        }
        
        const requestOptions = {
            method,
            headers: requestHeaders,
            // Use 'manual' redirect mode to handle OAuth2 redirects properly
            // This prevents CORS errors when redirecting to external OAuth2 providers
            redirect: 'manual'
        };
        
        if (formData) {
            requestOptions.body = formData;
        } else if (body) {
            // Use safe stringify to handle circular references
            try {
                requestOptions.body = safeStringify(body);
            } catch (error) {
                // Fallback: if safeStringify fails, try regular stringify with error handling
                console.warn('Error in safeStringify, attempting fallback:', error);
                try {
            requestOptions.body = JSON.stringify(body);
                } catch (stringifyError) {
                    throw new Error(`Failed to serialize request body: ${stringifyError.message}`);
                }
            }
        }
        
        try {
            const response = await fetch(url, requestOptions);
            
            // Handle redirects (OAuth2 authentication flow)
            // Redirect status codes: 301, 302, 303, 307, 308
            if (response.status >= 300 && response.status < 400) {
                const redirectUrl = response.headers.get('Location');
                if (redirectUrl) {
                    // Resolve relative URLs to absolute URLs
                    const absoluteRedirectUrl = redirectUrl.startsWith('http') 
                        ? redirectUrl 
                        : new URL(redirectUrl, this.baseUrl).href;
                    
                    // If redirecting to OAuth2 provider, redirect the entire browser window
                    if (absoluteRedirectUrl.includes('login.microsoftonline.com') || 
                        absoluteRedirectUrl.includes('/oauth2/') ||
                        absoluteRedirectUrl.includes('/authorize')) {
                        window.location.href = absoluteRedirectUrl;
                        // Return a promise that never resolves to prevent further execution
                        return new Promise(() => {});
                    }
                    // For same-origin redirects, follow them manually
                    // For cross-origin redirects, redirect the browser window
                    if (new URL(absoluteRedirectUrl).origin === this.baseUrl) {
                        return this.request(absoluteRedirectUrl, options);
                    } else {
                        window.location.href = absoluteRedirectUrl;
                        return new Promise(() => {});
                    }
                }
            }
            
            // Handle authentication errors (401, 403) - might be redirected to OAuth2
            if (response.status === 401 || response.status === 403) {
                // Check if response includes a redirect URL (OAuth2 Proxy might include this)
                const redirectUrl = response.headers.get('Location');
                if (redirectUrl) {
                    const absoluteRedirectUrl = redirectUrl.startsWith('http') 
                        ? redirectUrl 
                        : new URL(redirectUrl, this.baseUrl).href;
                    
                    if (absoluteRedirectUrl.includes('login.microsoftonline.com') || 
                        absoluteRedirectUrl.includes('/oauth2/')) {
                        window.location.href = absoluteRedirectUrl;
                        return new Promise(() => {});
                    }
                }
                // If no redirect URL but we got auth error, redirect to the original endpoint
                // OAuth2 Proxy will handle the OAuth2 flow
                window.location.href = url;
                return new Promise(() => {});
            }
            
            // Handle non-JSON responses (e.g., textproto exports)
            const contentType = response.headers.get('content-type');
            let responseData;
            
            if (contentType && contentType.includes('application/json')) {
                responseData = await response.json();
            } else {
                // For text/plain or other types, return as text
                responseData = await response.text();
            }
            
            if (!isSuccessStatus(response.status)) {
                const errorMessage = typeof responseData === 'object' && responseData.error
                    ? responseData.error
                    : getStatusMessage(response.status);
                throw new Error(errorMessage);
            }
            
            return {
                success: true,
                data: responseData,
                status: response.status
            };
        } catch (error) {
            // Handle network errors that might be CORS-related
            if (error.message && (error.message.includes('CORS') || 
                                  error.message.includes('Failed to fetch') ||
                                  error.message.includes('NetworkError'))) {
                // This might be an OAuth2 redirect that failed due to CORS
                // Try to redirect to the original endpoint - OAuth2 Proxy will handle it
                console.warn('CORS error detected, redirecting to endpoint for OAuth2 flow');
                window.location.href = url;
                return new Promise(() => {});
            }
            
            // Re-throw with more context
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`Request failed: ${error.message || 'Unknown error'}`);
        }
    }
    
    /**
     * Upload CSV or textproto file
     * @param {File} file - File to upload
     * @returns {Promise<Object>} Upload response with visualization data
     */
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('csv_file', file);
        
        const response = await this.request(API_ENDPOINTS.UPLOAD_CSV, {
            method: 'POST',
            formData: formData
        });
        
        return response.data;
    }
    
    /**
     * Load file from external URL (GitHub, etc.)
     * @param {string} url - External URL to fetch
     * @param {string} [filename] - Optional filename override
     * @returns {Promise<Object>} Upload response with visualization data
     */
    async loadExternalFile(url, filename = null) {
        const params = new URLSearchParams({ url });
        if (filename) {
            params.append('filename', filename);
        }
        
        const response = await this.request(`${API_ENDPOINTS.LOAD_EXTERNAL_FILE}?${params.toString()}`, {
            method: 'GET'
        });
        
        return response.data;
    }
    
    /**
     * Export cabling descriptor
     * @param {Object} cytoscapeData - Cytoscape visualization data
     * @returns {Promise<string>} Textproto content
     */
    async exportCablingDescriptor(cytoscapeData) {
        const response = await this.request(API_ENDPOINTS.EXPORT_CABLING_DESCRIPTOR, {
            method: 'POST',
            body: cytoscapeData
        });
        
        // Response is text, not JSON
        return response.data;
    }
    
    /**
     * Export flat cabling descriptor (extracted_topology template)
     * Used for CSV imports in location mode where there's no hierarchical structure
     * @param {Object} cytoscapeData - Cytoscape visualization data
     * @returns {Promise<string>} Textproto content
     */
    async exportFlatCablingDescriptor(cytoscapeData) {
        const response = await this.request(API_ENDPOINTS.EXPORT_FLAT_CABLING, {
            method: 'POST',
            body: cytoscapeData
        });
        
        // Response is text, not JSON
        return response.data;
    }
    
    /**
     * Export deployment descriptor
     * @param {Object} cytoscapeData - Cytoscape visualization data
     * @returns {Promise<string>} Textproto content
     */
    async exportDeploymentDescriptor(cytoscapeData) {
        const response = await this.request(API_ENDPOINTS.EXPORT_DEPLOYMENT_DESCRIPTOR, {
            method: 'POST',
            body: cytoscapeData
        });
        
        // Response is text, not JSON
        return response.data;
    }
    
    /**
     * Generate cabling guide
     * @param {Object} cytoscapeData - Cytoscape visualization data
     * @param {string} inputPrefix - Input prefix for filename
     * @param {string} generateType - Type of generation ('cabling_guide' or 'fsd')
     * @returns {Promise<Object>} Generation result with content and filename
     */
    async generateCablingGuide(cytoscapeData, inputPrefix, generateType = 'cabling_guide') {
        const response = await this.request(API_ENDPOINTS.GENERATE_CABLING_GUIDE, {
            method: 'POST',
            body: {
                cytoscape_data: cytoscapeData,
                input_prefix: inputPrefix,
                generate_type: generateType
            }
        });
        
        return response.data;
    }
    
    /**
     * Generate FSD (uses same endpoint as cabling guide with different type)
     * @param {Object} cytoscapeData - Cytoscape visualization data
     * @param {string} inputPrefix - Input prefix for filename
     * @returns {Promise<Object>} Generation result with content and filename
     */
    async generateFSD(cytoscapeData, inputPrefix) {
        return this.generateCablingGuide(cytoscapeData, inputPrefix, 'fsd');
    }
    
    /**
     * Get node configurations from server
     * @returns {Promise<Object>} Node configuration object
     */
    async getNodeConfigs() {
        const response = await this.request(API_ENDPOINTS.GET_NODE_CONFIGS, {
            method: 'GET'
        });
        
        return response.data;
    }
}

