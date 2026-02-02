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
        // More robust check: if initializationSection doesn't exist, assume initialized
        // Otherwise check if it's visible (display !== 'none')
        if (!initSection) {
            return true; // Section doesn't exist, so we're initialized
        }
        const isVisible = initSection.style.display !== 'none' &&
            window.getComputedStyle(initSection).display !== 'none';
        const hasCytoscape = this.state && this.state.cy !== null;
        return !isVisible || hasCytoscape;
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
        // Prevent duplicate attachment
        if (this.globalDragHandlersAttached) {
            console.log('[FileManagement] Global drag-and-drop handlers already attached');
            return;
        }

        // Check if already initialized - if so, don't set up handlers
        if (this.isInitialized()) {
            console.log('[FileManagement] Already initialized, skipping global drag-and-drop setup');
            return;
        }

        console.log('[FileManagement] Setting up global drag-and-drop handlers');

        // Track drag state to prevent flickering
        this.globalDragCounter = 0;
        this.globalDragActive = false;

        // Helper to check if target is in upload section
        const isInUploadSection = (target) => {
            const uploadSectionLocation = document.getElementById('uploadSectionLocation');
            const uploadSectionTopology = document.getElementById('uploadSectionTopology');
            return (uploadSectionLocation && uploadSectionLocation.contains(target)) ||
                (uploadSectionTopology && uploadSectionTopology.contains(target));
        };

        // Helper to update visual feedback
        const updateVisualFeedback = (show) => {
            const cyContainer = document.getElementById('cy');
            if (cyContainer) {
                if (show) {
                    cyContainer.style.border = '3px dashed #007bff';
                    cyContainer.style.backgroundColor = '#e3f2fd';
                    cyContainer.style.transition = 'all 0.2s ease';
                } else {
                    cyContainer.style.border = '';
                    cyContainer.style.backgroundColor = '';
                }
            }
        };

        // Helper to check if dragging files (browser-compatible)
        const isDraggingFiles = (e) => {
            if (!e.dataTransfer) return false;
            const types = e.dataTransfer.types;
            if (!types) return false;
            // Some browsers use array, some use DOMStringList
            if (Array.isArray(types)) {
                return types.includes('Files') || types.some(t => t === 'application/x-moz-file');
            }
            // DOMStringList
            for (let i = 0; i < types.length; i++) {
                if (types[i] === 'Files' || types[i] === 'application/x-moz-file') {
                    return true;
                }
            }
            return false;
        };

        // Store handlers so we can remove them later
        this.globalDragEnterHandler = (e) => {
            if (this.isInitialized() || isInUploadSection(e.target)) return;
            if (isDraggingFiles(e)) {
                this.globalDragCounter++;
                if (!this.globalDragActive) {
                    this.globalDragActive = true;
                    e.preventDefault();
                    e.stopPropagation();
                    updateVisualFeedback(true);
                }
            }
        };

        this.globalDragOverHandler = (e) => {
            if (this.isInitialized() || isInUploadSection(e.target)) return;
            if (isDraggingFiles(e)) {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
                if (!this.globalDragActive) {
                    this.globalDragActive = true;
                    updateVisualFeedback(true);
                }
            }
        };

        this.globalDragLeaveHandler = (e) => {
            if (this.isInitialized() || isInUploadSection(e.target)) return;
            this.globalDragCounter--;
            const relatedTarget = e.relatedTarget;
            if (this.globalDragCounter <= 0 &&
                (!relatedTarget || !document.contains(relatedTarget) || relatedTarget === document)) {
                this.globalDragCounter = 0;
                this.globalDragActive = false;
                updateVisualFeedback(false);
            }
        };

        this.globalDropHandler = async (e) => {
            console.log('[FileManagement] Global drop handler triggered');

            // Reset drag state
            this.globalDragCounter = 0;
            this.globalDragActive = false;
            updateVisualFeedback(false);

            if (this.isInitialized()) {
                console.log('[FileManagement] Drop ignored - already initialized');
                return;
            }

            if (isInUploadSection(e.target)) {
                console.log('[FileManagement] Drop ignored - inside upload section');
                return;
            }

            // Always prevent default to stop browser from opening file
            e.preventDefault();
            e.stopPropagation();

            // Validate we have files
            if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
                console.warn('[FileManagement] Drop event has no files');
                this.notificationManager.error('No files detected in drop. Please try again.');
                return;
            }

            const files = e.dataTransfer.files;
            const file = files[0];

            // Validate file type
            const fileName = file.name.toLowerCase();
            if (!fileName.endsWith('.csv') && !fileName.endsWith('.textproto')) {
                this.notificationManager.error('Please drop a CSV or textproto file.');
                return;
            }

            // Handle multiple files - warn but use first one
            if (files.length > 1) {
                console.warn(`[FileManagement] Multiple files dropped (${files.length}), using first file: ${file.name}`);
                this.notificationManager.warning(`Multiple files detected. Using: ${file.name}`);
            }

            console.log('[FileManagement] Processing global file drop:', file.name);

            try {
                await this.handleGlobalFileDrop(file);
            } catch (error) {
                console.error('[FileManagement] Error handling global file drop:', error);
                this.notificationManager.error(`Failed to process file: ${error.message || 'Unknown error'}`);
            }
        };

        // Prevent default drag behaviors on document to allow our handlers to work
        this.globalDragStartHandler = (e) => {
            if (!isDraggingFiles(e)) return;
            // Allow our handlers to take over
        };

        // Add event listeners with capture phase to catch events before they reach upload sections
        try {
            document.addEventListener('dragenter', this.globalDragEnterHandler, true);
            document.addEventListener('dragover', this.globalDragOverHandler, true);
            document.addEventListener('dragleave', this.globalDragLeaveHandler, true);
            document.addEventListener('drop', this.globalDropHandler, true);
            document.addEventListener('dragstart', this.globalDragStartHandler, true);

            // Also prevent default drag behaviors on document body as fallback
            this.bodyDragOverHandler = (e) => {
                if (isDraggingFiles(e) && !this.isInitialized() && !isInUploadSection(e.target)) {
                    e.preventDefault();
                }
            };
            this.bodyDropHandler = (e) => {
                if (isDraggingFiles(e) && !this.isInitialized() && !isInUploadSection(e.target)) {
                    e.preventDefault();
                }
            };

            document.body.addEventListener('dragover', this.bodyDragOverHandler, false);
            document.body.addEventListener('drop', this.bodyDropHandler, false);

            this.globalDragHandlersAttached = true;
            console.log('[FileManagement] Global drag-and-drop handlers attached successfully');
        } catch (error) {
            console.error('[FileManagement] Failed to attach global drag-and-drop handlers:', error);
        }
    }

    /**
     * Remove global drag-and-drop handlers
     */
    removeGlobalDragAndDrop() {
        try {
            if (this.globalDragEnterHandler) {
                document.removeEventListener('dragenter', this.globalDragEnterHandler, true);
            }
            if (this.globalDragOverHandler) {
                document.removeEventListener('dragover', this.globalDragOverHandler, true);
            }
            if (this.globalDragLeaveHandler) {
                document.removeEventListener('dragleave', this.globalDragLeaveHandler, true);
            }
            if (this.globalDropHandler) {
                document.removeEventListener('drop', this.globalDropHandler, true);
            }
            if (this.globalDragStartHandler) {
                document.removeEventListener('dragstart', this.globalDragStartHandler, true);
            }
            if (this.bodyDragOverHandler) {
                document.body.removeEventListener('dragover', this.bodyDragOverHandler, false);
            }
            if (this.bodyDropHandler) {
                document.body.removeEventListener('drop', this.bodyDropHandler, false);
            }

            // Reset state
            this.globalDragHandlersAttached = false;
            this.globalDragCounter = 0;
            this.globalDragActive = false;

            // Remove visual feedback
            const cyContainer = document.getElementById('cy');
            if (cyContainer) {
                cyContainer.style.border = '';
                cyContainer.style.backgroundColor = '';
            }

            console.log('[FileManagement] Global drag-and-drop handlers removed');
        } catch (error) {
            console.error('[FileManagement] Error removing global drag-and-drop handlers:', error);
        }
    }

    /**
     * Setup drag-and-drop handlers for file upload sections
     * These are the dedicated upload areas in each tab
     */
    setupDragAndDrop() {
        // File upload handlers - tab-specific elements
        const uploadSectionLocation = document.getElementById('uploadSectionLocation');
        const csvFileLocation = document.getElementById('csvFileLocation');
        const uploadSectionTopology = document.getElementById('uploadSectionTopology');
        const csvFileTopology = document.getElementById('csvFileTopology');

        // Helper to check if dragging files (reusable)
        const isDraggingFiles = (e) => {
            if (!e.dataTransfer) return false;
            const types = e.dataTransfer.types;
            if (!types) return false;
            if (Array.isArray(types)) {
                return types.includes('Files') || types.some(t => t === 'application/x-moz-file');
            }
            for (let i = 0; i < types.length; i++) {
                if (types[i] === 'Files' || types[i] === 'application/x-moz-file') {
                    return true;
                }
            }
            return false;
        };

        // Helper to set files on input (handles DataTransfer API)
        const setFilesOnInput = (input, files) => {
            try {
                // Modern browsers support direct assignment
                if (input.files !== undefined) {
                    const dataTransfer = new DataTransfer();
                    for (let i = 0; i < files.length; i++) {
                        dataTransfer.items.add(files[i]);
                    }
                    input.files = dataTransfer.files;
                    return true;
                } else {
                    console.warn('[FileManagement] File input does not support files property');
                    return false;
                }
            } catch (error) {
                console.error('[FileManagement] Error setting files on input:', error);
                return false;
            }
        };

        // Setup drag-and-drop for Location tab (CSV or Deployment Descriptor)
        if (uploadSectionLocation && csvFileLocation) {
            let dragCounter = 0;

            uploadSectionLocation.addEventListener('dragenter', (e) => {
                if (isDraggingFiles(e)) {
                    dragCounter++;
                    e.preventDefault();
                    e.stopPropagation();
                    uploadSectionLocation.classList.add('dragover');
                }
            }, false);

            uploadSectionLocation.addEventListener('dragover', (e) => {
                if (isDraggingFiles(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'copy';
                    }
                    uploadSectionLocation.classList.add('dragover');
                }
            }, false);

            uploadSectionLocation.addEventListener('dragleave', (e) => {
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    uploadSectionLocation.classList.remove('dragover');
                }
            }, false);

            uploadSectionLocation.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter = 0;
                uploadSectionLocation.classList.remove('dragover');

                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    const fileName = files[0].name.toLowerCase();
                    // Accept both CSV and textproto files
                    if (fileName.endsWith('.csv') || fileName.endsWith('.textproto')) {
                        if (setFilesOnInput(csvFileLocation, files)) {
                            // Trigger change event for compatibility
                            const event = new Event('change', { bubbles: true });
                            csvFileLocation.dispatchEvent(event);
                        } else {
                            this.notificationManager.error('Could not set file on input. Please try selecting the file manually.');
                        }
                    } else {
                        this.notificationManager.error('Please drop a CSV or textproto file.');
                    }
                }
            }, false);
        }

        // Setup drag-and-drop for Topology tab (Textproto)
        if (uploadSectionTopology && csvFileTopology) {
            let dragCounter = 0;

            uploadSectionTopology.addEventListener('dragenter', (e) => {
                if (isDraggingFiles(e)) {
                    dragCounter++;
                    e.preventDefault();
                    e.stopPropagation();
                    uploadSectionTopology.classList.add('dragover');
                }
            }, false);

            uploadSectionTopology.addEventListener('dragover', (e) => {
                if (isDraggingFiles(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'copy';
                    }
                    uploadSectionTopology.classList.add('dragover');
                }
            }, false);

            uploadSectionTopology.addEventListener('dragleave', (e) => {
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    uploadSectionTopology.classList.remove('dragover');
                }
            }, false);

            uploadSectionTopology.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter = 0;
                uploadSectionTopology.classList.remove('dragover');

                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    const fileName = files[0].name.toLowerCase();
                    if (fileName.endsWith('.textproto')) {
                        if (setFilesOnInput(csvFileTopology, files)) {
                            // Trigger change event for compatibility
                            const event = new Event('change', { bubbles: true });
                            csvFileTopology.dispatchEvent(event);
                        } else {
                            this.notificationManager.error('Could not set file on input. Please try selecting the file manually.');
                        }
                    } else {
                        this.notificationManager.error('Please drop a textproto file.');
                    }
                }
            }, false);
        }

        // Add another cabling guide: drop zone in location-mode sidebar and on cy container
        this.setupLocationModeAddAnotherDrop();
    }

    /**
     * Setup drag-and-drop for "Add another cabling guide" in location mode:
     * - Drop zone on addAnotherCablingGuideSection (sidebar)
     * - Drop on cy container when in location mode (drag CSV onto graph)
     */
    setupLocationModeAddAnotherDrop() {
        const isDraggingFiles = (e) => {
            if (!e.dataTransfer) return false;
            const types = e.dataTransfer.types;
            if (!types) return false;
            return Array.isArray(types)
                ? (types.includes('Files') || types.some(t => t === 'application/x-moz-file'))
                : (types.contains?.('Files') || types.contains?.('application/x-moz-file'));
        };

        const addAnotherSection = document.getElementById('addAnotherCablingGuideSection');
        if (addAnotherSection) {
            let dragCounter = 0;
            addAnotherSection.addEventListener('dragenter', (e) => {
                if (isDraggingFiles(e)) {
                    dragCounter++;
                    e.preventDefault();
                    e.stopPropagation();
                    addAnotherSection.style.backgroundColor = '#e3f2fd';
                }
            }, false);
            addAnotherSection.addEventListener('dragover', (e) => {
                if (isDraggingFiles(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    addAnotherSection.style.backgroundColor = '#e3f2fd';
                }
            }, false);
            addAnotherSection.addEventListener('dragleave', (e) => {
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    addAnotherSection.style.backgroundColor = '';
                }
            }, false);
            addAnotherSection.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter = 0;
                addAnotherSection.style.backgroundColor = '';
                const files = e.dataTransfer?.files;
                if (files?.length > 0 && files[0].name.toLowerCase().endsWith('.csv')) {
                    if (typeof window.addAnotherCablingGuideLocation === 'function') {
                        window.addAnotherCablingGuideLocation(files[0]).catch(err => console.error(err));
                    }
                } else {
                    this.notificationManager.error('Please drop a CSV file.');
                }
            }, false);
        }

        const cyContainer = document.getElementById('cy');
        if (cyContainer) {
            let cyDragCounter = 0;
            cyContainer.addEventListener('dragenter', (e) => {
                if (isDraggingFiles(e) && this.state.mode === 'location' && this.state.data.currentData?.elements?.length) {
                    cyDragCounter++;
                    e.preventDefault();
                    e.stopPropagation();
                    cyContainer.style.border = '3px dashed #007bff';
                    cyContainer.style.backgroundColor = '#e3f2fd';
                }
            }, false);
            cyContainer.addEventListener('dragover', (e) => {
                if (isDraggingFiles(e) && this.state.mode === 'location' && this.state.data.currentData?.elements?.length) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    cyContainer.style.border = '3px dashed #007bff';
                    cyContainer.style.backgroundColor = '#e3f2fd';
                }
            }, false);
            cyContainer.addEventListener('dragleave', (e) => {
                cyDragCounter--;
                if (cyDragCounter <= 0) {
                    cyDragCounter = 0;
                    cyContainer.style.border = '';
                    cyContainer.style.backgroundColor = '';
                }
            }, false);
            cyContainer.addEventListener('drop', (e) => {
                cyDragCounter = 0;
                cyContainer.style.border = '';
                cyContainer.style.backgroundColor = '';
                if (this.state.mode !== 'location' || !this.state.data.currentData?.elements?.length) return;
                const files = e.dataTransfer?.files;
                if (files?.length > 0 && files[0].name.toLowerCase().endsWith('.csv')) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof window.addAnotherCablingGuideLocation === 'function') {
                        window.addAnotherCablingGuideLocation(files[0]).catch(err => console.error(err));
                    }
                }
            }, false);
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
            // Clear preserved URL params from sessionStorage since we're loading the file
            try {
                sessionStorage.removeItem('preserved_url_params');
            } catch (e) {
                // Ignore errors
            }

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

