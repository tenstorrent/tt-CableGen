/**
 * File Management Module - Handles file upload and drag-and-drop functionality
 * Extracted from visualizer.js to separate file handling concerns
 */
export class FileManagementModule {
    constructor(state, apiClient, uiDisplayModule, notificationManager) {
        this.state = state;
        this.apiClient = apiClient;
        this.uiDisplayModule = uiDisplayModule;
        this.notificationManager = notificationManager;
    }

    /**
     * Check if visualization has been initialized
     * @returns {boolean}
     */
    isInitialized() {
        const initSection = document.getElementById('initializationSection');
        return !initSection || initSection.style.display === 'none' || this.state.cy !== null;
    }

    /**
     * Determine view mode based on file extension
     * @param {string} fileName - File name
     * @returns {string|null} - 'location' for CSV, 'hierarchy' for textproto, null for unknown
     */
    determineModeFromFile(fileName) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.csv')) {
            return 'location';
        } else if (lowerName.endsWith('.textproto')) {
            return 'hierarchy';
        }
        return null;
    }

    /**
     * Handle file drop from global drag and drop
     * @param {File} file - Dropped file
     */
    async handleGlobalFileDrop(file) {
        // Only handle if not initialized
        if (this.isInitialized()) {
            return;
        }

        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.csv') && !fileName.endsWith('.textproto')) {
            this.notificationManager.error('Please drop a CSV or textproto file.');
            return;
        }

        // Determine mode from file extension
        const mode = this.determineModeFromFile(fileName);
        if (!mode) {
            this.notificationManager.error('Unsupported file type. Please use CSV or textproto files.');
            return;
        }

        // Set the appropriate mode
        if (window.setVisualizationMode) {
            window.setVisualizationMode(mode);
        }

        // Switch to the appropriate tab
        if (mode === 'location') {
            window.switchTab?.('location');
        } else {
            window.switchTab?.('topology');
        }

        // Set the file in the appropriate input
        const fileInput = mode === 'location' 
            ? document.getElementById('csvFileLocation')
            : document.getElementById('csvFileTopology');
        
        if (fileInput) {
            // Create a new FileList-like object
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            
            // Trigger upload
            await this.uploadFile();
        } else {
            this.notificationManager.error('Could not find file input element.');
        }
    }

    /**
     * Setup global drag-and-drop handlers for the entire window
     * These handlers only work before initialization
     */
    setupGlobalDragAndDrop() {
        // Store handlers so we can remove them later
        this.globalDragOverHandler = (e) => {
            // Only handle if not initialized
            if (this.isInitialized()) {
                return;
            }

            // Don't interfere with existing upload sections
            const uploadSectionLocation = document.getElementById('uploadSectionLocation');
            const uploadSectionTopology = document.getElementById('uploadSectionTopology');
            const target = e.target;
            if ((uploadSectionLocation && uploadSectionLocation.contains(target)) ||
                (uploadSectionTopology && uploadSectionTopology.contains(target))) {
                return;
            }

            // Check if dragging files
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
                // Add visual feedback to the visualizer area
                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    cyContainer.style.border = '3px dashed #007bff';
                    cyContainer.style.backgroundColor = '#e3f2fd';
                }
            }
        };

        this.globalDragLeaveHandler = (e) => {
            // Only handle if not initialized
            if (this.isInitialized()) {
                return;
            }

            // Don't interfere with existing upload sections
            const uploadSectionLocation = document.getElementById('uploadSectionLocation');
            const uploadSectionTopology = document.getElementById('uploadSectionTopology');
            const target = e.target;
            if ((uploadSectionLocation && uploadSectionLocation.contains(target)) ||
                (uploadSectionTopology && uploadSectionTopology.contains(target))) {
                return;
            }

            // Only remove visual feedback if we're leaving the document (not just moving between elements)
            if (!e.relatedTarget || !document.contains(e.relatedTarget)) {
                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    cyContainer.style.border = '';
                    cyContainer.style.backgroundColor = '';
                }
            }
        };

        this.globalDropHandler = async (e) => {
            // Only handle if not initialized
            if (this.isInitialized()) {
                return;
            }

            // Don't interfere with existing upload sections
            const uploadSectionLocation = document.getElementById('uploadSectionLocation');
            const uploadSectionTopology = document.getElementById('uploadSectionTopology');
            const target = e.target;
            if ((uploadSectionLocation && uploadSectionLocation.contains(target)) ||
                (uploadSectionTopology && uploadSectionTopology.contains(target))) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // Remove visual feedback
            const cyContainer = document.getElementById('cy');
            if (cyContainer) {
                cyContainer.style.border = '';
                cyContainer.style.backgroundColor = '';
            }

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                await this.handleGlobalFileDrop(files[0]);
            }
        };

        // Add event listeners with capture phase to catch events before they reach upload sections
        document.addEventListener('dragover', this.globalDragOverHandler, true);
        document.addEventListener('dragleave', this.globalDragLeaveHandler, true);
        document.addEventListener('drop', this.globalDropHandler, true);
    }

    /**
     * Remove global drag-and-drop handlers
     */
    removeGlobalDragAndDrop() {
        if (this.globalDragOverHandler) {
            document.removeEventListener('dragover', this.globalDragOverHandler, true);
        }
        if (this.globalDragLeaveHandler) {
            document.removeEventListener('dragleave', this.globalDragLeaveHandler, true);
        }
        if (this.globalDropHandler) {
            document.removeEventListener('drop', this.globalDropHandler, true);
        }
    }

    /**
     * Setup drag-and-drop handlers for file upload sections
     */
    setupDragAndDrop() {
        // File upload handlers - tab-specific elements
        const uploadSectionLocation = document.getElementById('uploadSectionLocation');
        const csvFileLocation = document.getElementById('csvFileLocation');
        const uploadSectionTopology = document.getElementById('uploadSectionTopology');
        const csvFileTopology = document.getElementById('csvFileTopology');

        // Setup drag-and-drop for Location tab (CSV or Deployment Descriptor)
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
                if (files.length > 0) {
                    const fileName = files[0].name.toLowerCase();
                    // Accept both CSV and textproto files
                    if (fileName.endsWith('.csv') || fileName.endsWith('.textproto')) {
                        csvFileLocation.files = files;
                    }
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
    }

    /**
     * Load file from external URL and process it
     * @param {string} url - External URL to fetch
     * @param {string} [filename] - Optional filename override
     * @returns {Promise<void>}
     */
    async loadExternalFile(url, filename = null) {
        // Reset any global state
        this.state.data.currentData = null;
        this.state.editing.selectedConnection = null;
        this.state.editing.isEdgeCreationMode = false;

        // Show loading state
        const loadingLocation = document.getElementById('loadingLocation');
        const loadingTopology = document.getElementById('loadingTopology');
        const buttonLocation = document.getElementById('uploadBtnLocation');
        const buttonTopology = document.getElementById('uploadBtnTopology');
        
        // Show loading on both tabs since we don't know which one will be used
        if (loadingLocation) loadingLocation.style.display = 'block';
        if (loadingTopology) loadingTopology.style.display = 'block';
        if (buttonLocation) {
            buttonLocation.disabled = true;
            buttonLocation.textContent = 'Loading...';
        }
        if (buttonTopology) {
            buttonTopology.disabled = true;
            buttonTopology.textContent = 'Loading...';
        }
        
        this.notificationManager.hide();
        this.notificationManager.info(`Loading file from ${new URL(url).hostname}...`);

        try {
            // Use API client to load external file
            const result = await this.apiClient.loadExternalFile(url, filename);

            if (result.success) {
                this.state.data.currentData = result.data;

                // Hide initialization section and show visualization controls
                const initSection = document.getElementById('initializationSection');
                if (initSection) {
                    initSection.style.display = 'none';
                }

                const controlSections = document.getElementById('controlSections');
                if (controlSections) {
                    controlSections.style.display = 'block';
                }

                // Remove global drag-and-drop handlers after initialization
                this.removeGlobalDragAndDrop();

                // Check for unknown node types and show warning
                if (result.unknown_types && result.unknown_types.length > 0) {
                    const unknownTypesStr = result.unknown_types.map(t => t.toUpperCase()).join(', ');
                    this.notificationManager.warning(`${result.message || 'File loaded successfully!'}<br><strong>⚠️ Warning:</strong> Unknown node types detected and auto-configured: ${unknownTypesStr}`);
                } else {
                    this.notificationManager.success(result.message || 'File loaded successfully!');
                }

                // Initialize visualization
                window.initVisualization?.(result.data);

                // Update legend based on file type
                window.updateConnectionLegend?.(result.data);

                // Enable the Add Node button after successful upload
                window.updateAddNodeButtonState?.();
            } else {
                this.notificationManager.error(`Error: ${result.error || 'Unknown error occurred'}`);
            }
        } catch (err) {
            this.notificationManager.error(`Failed to load file: ${err.message}`);
            console.error('Load external file error:', err);
        } finally {
            // Reset UI state
            if (loadingLocation) loadingLocation.style.display = 'none';
            if (loadingTopology) loadingTopology.style.display = 'none';
            if (buttonLocation) {
                buttonLocation.disabled = false;
                buttonLocation.textContent = '📊 Load CSV';
            }
            if (buttonTopology) {
                buttonTopology.disabled = false;
                buttonTopology.textContent = 'Generate Visualization';
            }
        }
    }

    /**
     * Check URL parameters and auto-load file if present
     * Looks for ?file=<url> or ?url=<url> parameters
     * @returns {Promise<void>}
     */
    async checkAndLoadUrlParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const fileUrl = urlParams.get('file') || urlParams.get('url');
        
        if (fileUrl) {
            // Validate it's a URL
            try {
                const url = new URL(fileUrl);
                if (url.protocol === 'http:' || url.protocol === 'https:') {
                    // Extract filename from URL if possible
                    const filename = urlParams.get('filename') || null;
                    
                    console.log(`Auto-loading file from URL: ${fileUrl}`);
                    await this.loadExternalFile(fileUrl, filename);
                    
                    // Clean up URL parameter (optional - keeps it for bookmarking)
                    // Uncomment if you want to remove it after loading:
                    // const newUrl = new URL(window.location);
                    // newUrl.searchParams.delete('file');
                    // newUrl.searchParams.delete('url');
                    // window.history.replaceState({}, '', newUrl);
                } else {
                    console.warn('Invalid URL protocol:', fileUrl);
                }
            } catch (e) {
                console.error('Invalid URL in parameter:', fileUrl, e);
                this.notificationManager.error(`Invalid URL in parameter: ${fileUrl}`);
            }
        }
    }

    /**
     * Upload and process a file
     * @returns {Promise<void>}
     */
    async uploadFile() {
        // Determine which file input to use based on which tab is active
        let fileInput = null;
        let loadingElement = null;
        let buttonElement = null;

        const csvFileLocation = document.getElementById('csvFileLocation');
        const csvFileTopology = document.getElementById('csvFileTopology');

        // Check Location tab first
        if (csvFileLocation && csvFileLocation.files && csvFileLocation.files.length > 0) {
            fileInput = csvFileLocation;
            loadingElement = document.getElementById('loadingLocation');
            buttonElement = document.getElementById('uploadBtnLocation');
        }
        // Then check Topology tab
        else if (csvFileTopology && csvFileTopology.files && csvFileTopology.files.length > 0) {
            fileInput = csvFileTopology;
            loadingElement = document.getElementById('loadingTopology');
            buttonElement = document.getElementById('uploadBtnTopology');
        }

        if (!fileInput || !fileInput.files) {
            this.notificationManager.error('Please select a file first.');
            return;
        }

        const file = fileInput.files[0];

        if (!file) {
            this.notificationManager.error('Please select a file first.');
            return;
        }

        if (!file.name.endsWith('.csv') && !file.name.endsWith('.textproto')) {
            this.notificationManager.error('Please select a CSV or textproto file (must end with .csv or .textproto).');
            return;
        }

        // Reset any global state
        this.state.data.currentData = null;
        this.state.editing.selectedConnection = null;
        this.state.editing.isEdgeCreationMode = false;

        // Show loading state
        if (loadingElement) loadingElement.style.display = 'block';
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.textContent = 'Processing...';
        }
        this.notificationManager.hide();

        try {
            // Use API client for the actual request
            const result = await this.apiClient.uploadFile(file);

            if (result.success) {
                this.state.data.currentData = result.data;

                // Hide initialization section and show visualization controls
                const initSection = document.getElementById('initializationSection');
                if (initSection) {
                    initSection.style.display = 'none';
                }

                const controlSections = document.getElementById('controlSections');
                if (controlSections) {
                    controlSections.style.display = 'block';
                }

                // Remove global drag-and-drop handlers after initialization
                this.removeGlobalDragAndDrop();

                // Check for unknown node types and show warning
                if (result.unknown_types && result.unknown_types.length > 0) {
                    const unknownTypesStr = result.unknown_types.map(t => t.toUpperCase()).join(', ');
                    this.notificationManager.warning(`Successfully processed ${file.name}!<br><strong>⚠️ Warning:</strong> Unknown node types detected and auto-configured: ${unknownTypesStr}`);
                } else {
                    this.notificationManager.success(`Successfully processed ${file.name}!`);
                }

                // Initialize visualization
                window.initVisualization?.(result.data);

                // Update legend based on file type
                window.updateConnectionLegend?.(result.data);

                // Enable the Add Node button after successful upload
                window.updateAddNodeButtonState?.();
            } else {
                this.notificationManager.error(`Error: ${result.error || 'Unknown error occurred'}`);
            }
        } catch (err) {
            this.notificationManager.error(`Upload failed: ${err.message}`);
            console.error('Upload error:', err);
        } finally {
            // Reset UI state
            if (loadingElement) loadingElement.style.display = 'none';
            if (buttonElement) {
                buttonElement.disabled = false;
                buttonElement.textContent = buttonElement.id.includes('Location') ? '📊 Load CSV' : 'Generate Visualization';
            }
        }
    }
}

