/**
 * API Client - Centralized API request handling
 * Extracted from visualizer.js to separate API logic from UI logic
 */
import { API_ENDPOINTS, API_DEFAULTS, HTTP_STATUS, getStatusMessage, isSuccessStatus } from '../config/api.js';

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
            headers: requestHeaders
        };
        
        if (formData) {
            requestOptions.body = formData;
        } else if (body) {
            requestOptions.body = JSON.stringify(body);
        }
        
        try {
            const response = await fetch(url, requestOptions);
            
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

