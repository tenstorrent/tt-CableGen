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

