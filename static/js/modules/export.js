/**
 * Export Module - Handles all export and generation operations
 * Extracted from visualizer.js to centralize export logic
 */
export class ExportModule {
    constructor(state, commonModule, apiClient, notificationManager, statusManager) {
        this.state = state;
        this.commonModule = commonModule;
        this.apiClient = apiClient;
        this.notificationManager = notificationManager;
        this.statusManager = statusManager;
    }

    /**
     * Validate that all shelf nodes have hostnames
     * @returns {Array} Array of node labels that are missing hostnames (empty if all valid)
     */
    validateHostnames() {
        const nodesWithoutHostname = [];
        this.state.cy.nodes().forEach((node) => {
            const data = node.data();
            if (data.type === 'shelf' && (!data.hostname || data.hostname.trim() === '')) {
                nodesWithoutHostname.push(data.label || data.id);
            }
        });
        return nodesWithoutHostname;
    }

    /**
     * Sanitize data by removing circular references
     * This is needed when serializing Cytoscape.js data that may contain circular references
     * @param {*} obj - Object to sanitize
     * @param {WeakSet} seen - WeakSet of already seen objects (for circular reference detection)
     * @returns {*} Sanitized object
     */
    sanitizeForJSON(obj, seen = new WeakSet(), path = 'root', circularRefs = []) {
        // Handle null and undefined
        if (obj === null || obj === undefined) {
            return obj;
        }

        // Handle primitives
        const type = typeof obj;
        if (type !== 'object' && type !== 'function') {
            return obj;
        }

        // Handle Date objects
        if (obj instanceof Date) {
            return obj.toISOString();
        }

        // Handle functions (skip them)
        if (type === 'function') {
            return undefined;
        }

        // Check for circular reference
        if (seen.has(obj)) {
            // Track circular reference for logging
            circularRefs.push({
                path: path,
                type: Array.isArray(obj) ? 'array' : 'object',
                constructor: obj.constructor?.name || 'Unknown'
            });
            return undefined; // Remove circular references
        }

        // Add to seen set
        seen.add(obj);

        try {
            // Handle arrays
            if (Array.isArray(obj)) {
                const sanitized = [];
                for (let i = 0; i < obj.length; i++) {
                    const itemPath = `${path}[${i}]`;
                    const sanitizedItem = this.sanitizeForJSON(obj[i], seen, itemPath, circularRefs);
                    // Only push non-undefined items (but allow null)
                    if (sanitizedItem !== undefined) {
                        sanitized.push(sanitizedItem);
                    }
                }
                return sanitized;
            }

            // Handle plain objects
            const sanitized = {};
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    try {
                        const valuePath = path === 'root' ? key : `${path}.${key}`;
                        const value = this.sanitizeForJSON(obj[key], seen, valuePath, circularRefs);
                        // Only include non-undefined values (but allow null)
                        if (value !== undefined) {
                            sanitized[key] = value;
                        }
                    } catch (e) {
                        // Skip properties that can't be serialized
                        console.warn(`Skipping property ${key} due to serialization error:`, e);
                    }
                }
            }
            return sanitized;
        } finally {
            // Empty finally block - no cleanup needed
        }
    }

    /**
     * Format error message from API response
     * @param {Object} errorData - Error data from API response
     * @returns {string} Formatted error message
     */
    formatErrorMessage(errorData) {
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

    /**
     * Download a file from blob content
     * @param {Blob} blob - Blob content to download
     * @param {string} filename - Filename for the download
     */
    downloadFile(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    /**
     * Get custom filename from input field or use default
     * @param {string} defaultName - Default filename if input is empty
     * @returns {string} Filename to use
     */
    getCustomFileName(defaultName = '') {
        const input = document.getElementById('exportFileNameInput');
        const customFileName = input ? input.value.trim() : '';
        return customFileName || defaultName;
    }

    /**
     * Export CablingDescriptor
     */
    async exportCablingDescriptor() {
        if (!this.state.cy) {
            this.notificationManager.show('No visualization data available', 'error');
            return;
        }

        // Check if we have saved hierarchy state (from switching hierarchy -> location)
        // If available, use hierarchical export even if initialMode was 'location'
        const hasSavedHierarchyState = this.state.data.hierarchyModeState && 
            this.state.data.hierarchyModeState.elements &&
            this.state.mode === 'location';

        // If session started in location mode AND no saved hierarchy state, use flat export
        if (this.state.data.initialMode === 'location' && !hasSavedHierarchyState) {
            // Use flat export - no validation needed, creates extracted_topology template automatically
            const exportBtn = document.getElementById('exportCablingBtn');
            const originalText = exportBtn ? exportBtn.textContent : 'Export';

            try {
                if (exportBtn) {
                    exportBtn.textContent = '⏳ Exporting...';
                    exportBtn.disabled = true;
                }
                this.statusManager.show('Generating CablingDescriptor (flat export)...', 'info');

                // Get current cytoscape data
                const rawElements = this.state.cy.elements().jsons();
                const sanitizedElements = this.sanitizeForJSON(rawElements);

                const rawMetadata = this.state.data.currentData && this.state.data.currentData.metadata
                    ? this.state.data.currentData.metadata
                    : {};
                const sanitizedMetadata = this.sanitizeForJSON(rawMetadata);

                const cytoscapeData = {
                    elements: sanitizedElements,
                    metadata: sanitizedMetadata
                };

                // Filter to only include fields needed for export
                const filteredData = this.commonModule.filterCytoscapeDataForExport(cytoscapeData, 'cabling');

                // Use flat export API
                const textprotoContent = await this.apiClient.exportFlatCablingDescriptor(filteredData);

                // Create and download file
                const customFileName = this.getCustomFileName();
                const filename = customFileName
                    ? `${customFileName}_cabling_descriptor.textproto`
                    : 'cabling_descriptor.textproto';
                const blob = new Blob([textprotoContent], { type: 'text/plain' });
                this.downloadFile(blob, filename);

                this.statusManager.show('CablingDescriptor exported successfully!', 'success');

            } catch (error) {
                console.error('Export error:', error);
                this.notificationManager.show(`Export failed: ${error.message}`, 'error');
            } finally {
                if (exportBtn) {
                    exportBtn.textContent = originalText;
                    exportBtn.disabled = false;
                }
            }
            return;
        }

        // For hierarchy mode, validate graph templates
        // If we have saved hierarchy state, skip validation (graph nodes aren't in current view)
        if (!hasSavedHierarchyState) {
            // Validate: Must have exactly one top-level root template
            const topLevelGraphs = this.state.cy.nodes('[type="graph"]').filter(node => {
                const parent = node.parent();
                return parent.length === 0;
            });

            if (topLevelGraphs.length === 0) {
                this.notificationManager.show('❌ Cannot export CablingDescriptor: No root template found. Please create a graph template that contains all nodes and connections.', 'error');
                return;
            }

            if (topLevelGraphs.length > 1) {
                const templateNames = topLevelGraphs.map(n => n.data('template_name') || n.data('label')).join(', ');
                this.notificationManager.show(`❌ Cannot export CablingDescriptor: Multiple root templates found (${templateNames}). A singular root template containing all nodes and connections is required for CablingDescriptor export.`, 'error');
                return;
            }

            // Validate: Root template must not be empty (must have children)
            const rootGraph = topLevelGraphs[0];
            const rootChildren = rootGraph.children();
            if (rootChildren.length === 0) {
                const templateName = rootGraph.data('template_name') || rootGraph.data('label');
                this.notificationManager.show(`❌ Cannot export CablingDescriptor: Root template "${templateName}" is empty. Root templates must contain at least one child node or graph reference.`, 'error');
                return;
            }
        }

        const exportBtn = document.getElementById('exportCablingBtn');
        const originalText = exportBtn ? exportBtn.textContent : 'Export';

        try {
            if (exportBtn) {
                exportBtn.textContent = '⏳ Exporting...';
                exportBtn.disabled = true;
            }
            this.statusManager.show('Generating CablingDescriptor...', 'info');

            // Use saved hierarchy state if available (contains graph structure), otherwise use current data
            let rawElements;
            let rawMetadata;
            
            if (hasSavedHierarchyState) {
                // Use saved hierarchy state for export (contains full graph structure)
                console.log('[exportCablingDescriptor] Using saved hierarchyModeState for export');
                rawElements = this.state.data.hierarchyModeState.elements;
                rawMetadata = this.state.data.hierarchyModeState.metadata || 
                    (this.state.data.currentData && this.state.data.currentData.metadata) || {};
            } else {
                // Use current cytoscape data
                rawElements = this.state.cy.elements().jsons();
                rawMetadata = this.state.data.currentData && this.state.data.currentData.metadata
                    ? this.state.data.currentData.metadata
                    : {};
            }

            // Sanitize elements to remove circular references
            const sanitizedElements = this.sanitizeForJSON(rawElements);

            // Sanitize metadata to remove circular references (but preserve structure)
            // This prevents "[Circular Reference]" strings from ending up in path arrays
            const metadataCircularRefs = [];
            const sanitizedMetadata = this.sanitizeForJSON(rawMetadata, new WeakSet(), 'metadata', metadataCircularRefs);

            // Log if any circular references were detected in metadata
            if (metadataCircularRefs.length > 0) {
                console.warn(`[exportCablingDescriptor] Detected ${metadataCircularRefs.length} circular/shared reference(s) in metadata that were removed:`, metadataCircularRefs);
                // Log details about the first few for debugging
                metadataCircularRefs.slice(0, 5).forEach((ref, idx) => {
                    console.warn(`  [${idx + 1}] Path: "${ref.path}", Type: ${ref.type}, Constructor: ${ref.constructor}`);
                });
                if (metadataCircularRefs.length > 5) {
                    console.warn(`  ... and ${metadataCircularRefs.length - 5} more`);
                }
            }

            const fullCytoscapeData = {
                elements: sanitizedElements,
                metadata: {
                    ...sanitizedMetadata,  // Include sanitized metadata (graph_templates, etc.)
                    visualization_mode: this.state.mode  // Current mode
                }
            };

            // Filter to only include fields needed for export (reduces payload size)
            const cytoscapeData = this.commonModule.filterCytoscapeDataForExport(fullCytoscapeData, 'cabling');

            // Use API client for the actual request
            const textprotoContent = await this.apiClient.exportCablingDescriptor(cytoscapeData);

            // Create and download file
            const customFileName = this.getCustomFileName();
            const filename = customFileName
                ? `${customFileName}_cabling_descriptor.textproto`
                : 'cabling_descriptor.textproto';
            const blob = new Blob([textprotoContent], { type: 'text/plain' });
            this.downloadFile(blob, filename);

            this.statusManager.show('CablingDescriptor exported successfully!', 'success');

        } catch (error) {
            console.error('Export error:', error);
            this.notificationManager.show(`Export failed: ${error.message}`, 'error');
        } finally {
            if (exportBtn) {
                exportBtn.textContent = originalText;
                exportBtn.disabled = false;
            }
        }
    }

    /**
     * Export DeploymentDescriptor
     */
    async exportDeploymentDescriptor() {
        if (!this.state.cy) {
            this.notificationManager.show('No visualization data available', 'error');
            return;
        }

        const exportBtn = document.getElementById('exportDeploymentBtn');
        const originalText = exportBtn ? exportBtn.textContent : 'Export';

        try {
            if (exportBtn) {
                exportBtn.textContent = '⏳ Exporting...';
                exportBtn.disabled = true;
            }
            this.statusManager.show('Generating DeploymentDescriptor...', 'info');

            // Debug: Check all shelf nodes for host_index
            const allShelves = this.state.cy.nodes('[type="shelf"]');
            const shelvesWithoutHostIndex = [];
            const shelfDataSamples = [];  // Collect samples for debugging

            allShelves.forEach(shelf => {
                const hostIndex = shelf.data('host_index');
                const allData = shelf.data();  // Get all data fields

                // Collect first 3 samples regardless of host_index presence
                if (shelfDataSamples.length < 3) {
                    shelfDataSamples.push({
                        id: shelf.id(),
                        label: shelf.data('label'),
                        all_fields: Object.keys(allData),
                        host_index: allData.host_index,
                        host_id: allData.host_id,
                        hostname: allData.hostname,
                        child_name: allData.child_name,
                        full_data: allData
                    });
                }

                if (hostIndex === undefined || hostIndex === null) {
                    shelvesWithoutHostIndex.push({
                        id: shelf.id(),
                        label: shelf.data('label'),
                        parent: shelf.data('parent'),
                        available_fields: Object.keys(allData),
                        host_id: allData.host_id  // Check if host_id exists instead
                    });
                }
            });

            console.log('=== SHELF NODE DATA DEBUGGING ===');
            console.log(`Total shelf nodes: ${allShelves.length}`);
            console.log('Sample shelf data (first 3 nodes):', shelfDataSamples);

            if (shelvesWithoutHostIndex.length > 0) {
                console.error(`Found ${shelvesWithoutHostIndex.length} shelves without host_index:`, shelvesWithoutHostIndex);

                // Export to window for user inspection
                window.DEBUG_SHELVES_WITHOUT_HOST_INDEX = shelvesWithoutHostIndex;
                console.log('EXPORTED TO: window.DEBUG_SHELVES_WITHOUT_HOST_INDEX');
            } else {
                console.log(`✓ All ${allShelves.length} shelves have host_index`);
            }

            // Get current cytoscape data and sanitize to remove circular references
            const rawElements = this.state.cy.elements().jsons();
            const sanitizedElements = this.sanitizeForJSON(rawElements);
            const fullCytoscapeData = {
                elements: sanitizedElements
            };

            // Filter to only include fields needed for export (reduces payload size)
            const cytoscapeData = this.commonModule.filterCytoscapeDataForExport(fullCytoscapeData, 'deployment');

            // Debug: Check if host_index is in the serialized data
            const serializedShelves = cytoscapeData.elements.filter(el => el.data && el.data.type === 'shelf');
            const serializedWithoutHostIndex = serializedShelves.filter(shelf => {
                const hostIndex = shelf.data.host_index;
                return hostIndex === undefined || hostIndex === null;
            });

            if (serializedWithoutHostIndex.length > 0) {
                console.error(`SERIALIZATION ISSUE: ${serializedWithoutHostIndex.length} shelves lost host_index during serialization:`,
                    serializedWithoutHostIndex.map(s => ({ id: s.data.id, label: s.data.label })));
            } else {
                console.log(`Serialized data: All ${serializedShelves.length} shelves have host_index in JSON`);
            }

            // Use API client for the actual request
            const textprotoContent = await this.apiClient.exportDeploymentDescriptor(cytoscapeData);

            // Create and download file
            const customFileName = this.getCustomFileName();
            const filename = customFileName
                ? `${customFileName}_deployment_descriptor.textproto`
                : 'deployment_descriptor.textproto';
            const blob = new Blob([textprotoContent], { type: 'text/plain' });
            this.downloadFile(blob, filename);

            this.statusManager.show('DeploymentDescriptor exported successfully!', 'success');

        } catch (error) {
            console.error('Export error:', error);
            this.notificationManager.show(`Export failed: ${error.message}`, 'error');
        } finally {
            if (exportBtn) {
                exportBtn.textContent = originalText;
                exportBtn.disabled = false;
            }
        }
    }

    /**
     * Enrich cytoscape data with implicit hierarchy fields for shelf nodes
     * This creates an extracted_topology structure if needed without switching modes
     * @param {Array} elements - Array of cytoscape element data
     * @param {Object} metadata - Optional metadata object to enrich
     * @returns {Object} Object with enriched elements and metadata
     */
    enrichWithImplicitHierarchy(elements, metadata = {}) {
        // Check if we already have graph nodes
        const hasGraphNodes = elements.some(el => el.data && el.data.type === 'graph');

        // Check if shelf nodes already have logical_path/child_name (from existing hierarchy)
        const shelfNodes = elements.filter(el => el.data && el.data.type === 'shelf');
        const hasLogicalTopology = shelfNodes.some(shelf =>
            shelf.data.logical_path && shelf.data.logical_path.length > 0
        ) || hasGraphNodes;

        // If we already have hierarchy structure, return as-is
        if (hasLogicalTopology) {
            return { elements, metadata };
        }

        // No hierarchy structure - this is a CSV import
        // The backend will use flat export which doesn't need complex metadata or graph nodes
        // host_index is now REQUIRED - all nodes must have it set (via DFS or at creation)
        console.log('[export.enrichWithImplicitHierarchy] No hierarchy detected - CSV import, backend will use flat export');

        // Verify that all shelf nodes have host_index (required, no fallback assignment)
        const shelvesWithoutHostIndex = shelfNodes.filter(shelf => {
            const hostIndex = shelf.data.host_index;
            return hostIndex === undefined || hostIndex === null;
        });

        if (shelvesWithoutHostIndex.length > 0) {
            console.error(`[export.enrichWithImplicitHierarchy] ERROR: ${shelvesWithoutHostIndex.length} shelf nodes missing required host_index. This should not happen - all shelf nodes must have host_index set at creation or via DFS recalculation.`);
            // Let the Python export code handle the error with a more detailed message
        }

        // Return elements as-is (no modification needed - host_index should already be set)
        return { elements, metadata };
    }

    /**
     * Generate Cabling Guide
     */
    async generateCablingGuide() {
        if (!this.state.cy) {
            this.notificationManager.show('No visualization data available', 'error');
            return;
        }

        const generateBtn = document.getElementById('generateCablingGuideBtn');
        const originalText = generateBtn ? generateBtn.textContent : 'Generate';

        try {
            if (generateBtn) {
                generateBtn.textContent = '⏳ Generating...';
                generateBtn.disabled = true;
            }
            this.statusManager.show('Generating cabling guide...', 'info');

            // Get current cytoscape data and sanitize to remove circular references
            const rawElements = this.state.cy.elements().jsons();
            const sanitizedElements = this.sanitizeForJSON(rawElements);

            // Get metadata if available
            const rawMetadata = this.state.data.currentData && this.state.data.currentData.metadata
                ? this.state.data.currentData.metadata
                : {};
            const sanitizedMetadata = this.sanitizeForJSON(rawMetadata);

            // Enrich with implicit hierarchy fields if needed (without switching modes)
            const enriched = this.enrichWithImplicitHierarchy(sanitizedElements, sanitizedMetadata);

            const cytoscapeData = {
                elements: enriched.elements,
                metadata: enriched.metadata
            };

            // Get input prefix for the generator
            const customFileName = this.getCustomFileName('network_topology');
            const inputPrefix = customFileName || 'network_topology';

            // Use API client for the actual request
            const result = await this.apiClient.generateCablingGuide(cytoscapeData, inputPrefix, 'cabling_guide');

            if (result.success) {
                // Download the generated CSV file
                if (result.cabling_guide_content) {
                    const blob = new Blob([result.cabling_guide_content], { type: 'text/csv' });
                    this.downloadFile(blob, result.cabling_guide_filename);
                }

                this.statusManager.show('Cabling guide generated successfully!', 'success');
            } else {
                throw new Error(this.formatErrorMessage(result));
            }

        } catch (error) {
            console.error('Generation error:', error);
            this.notificationManager.show(`Generation failed: ${error.message}`, 'error');
        } finally {
            if (generateBtn) {
                generateBtn.textContent = originalText;
                generateBtn.disabled = false;
            }
        }
    }

    /**
     * Generate Factory System Descriptor (FSD)
     */
    async generateFSD() {
        if (!this.state.cy) {
            this.notificationManager.show('No visualization data available', 'error');
            return;
        }

        // Check for nodes without hostnames and show warning
        const nodesWithoutHostname = this.validateHostnames();
        if (nodesWithoutHostname.length > 0) {
            this.statusManager.show(`Warning: The following nodes are missing hostnames: ${nodesWithoutHostname.join(', ')}. FSD generation will proceed but may have incomplete data.`, 'warning');
        }

        const generateBtn = document.getElementById('generateFSDBtn');
        const originalText = generateBtn ? generateBtn.textContent : 'Generate';

        try {
            if (generateBtn) {
                generateBtn.textContent = '⏳ Generating...';
                generateBtn.disabled = true;
            }
            this.statusManager.show('Generating FSD...', 'info');

            // Get current cytoscape data and sanitize to remove circular references
            const rawElements = this.state.cy.elements().jsons();
            const sanitizedElements = this.sanitizeForJSON(rawElements);
            const cytoscapeData = {
                elements: sanitizedElements
            };

            // Get input prefix for the generator
            const customFileName = this.getCustomFileName('network_topology');
            const inputPrefix = customFileName || 'network_topology';

            // Use API client for the actual request
            const result = await this.apiClient.generateFSD(cytoscapeData, inputPrefix);

            if (result.success) {
                // Download the generated textproto file
                if (result.fsd_content) {
                    const blob = new Blob([result.fsd_content], { type: 'text/plain' });
                    this.downloadFile(blob, result.fsd_filename);
                }

                this.statusManager.show('FSD generated successfully!', 'success');
            } else {
                throw new Error(this.formatErrorMessage(result));
            }

        } catch (error) {
            console.error('Generation error:', error);
            this.notificationManager.show(`Generation failed: ${error.message}`, 'error');
        } finally {
            if (generateBtn) {
                generateBtn.textContent = originalText;
                generateBtn.disabled = false;
            }
        }
    }
}

