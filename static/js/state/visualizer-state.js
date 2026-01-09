/**
 * Central state management for CableGen Visualizer
 * Replaces scattered global variables with structured state
 */
export class VisualizerState {
    constructor() {
        // Cytoscape instance
        this.cy = null;

        // Current mode: 'location' or 'hierarchy'
        this.mode = 'location';

        // Editing state
        this.editing = {
            isEdgeCreationMode: false,
            selectedFirstPort: null,
            selectedSecondPort: null,
            selectedConnection: null,
            selectedNode: null,
            currentConnectionNumber: 0
        };

        // Data state
        this.data = {
            currentData: null,
            initialVisualizationData: null, // Store initial data for reset functionality
            hierarchyModeState: null, // Store current hierarchy state when switching to location mode
            globalHostCounter: 0, // Global counter for unique host IDs across all instances
            availableGraphTemplates: {}, // Store graph templates from loaded textproto
            nodeConfigs: {}, // Will be populated from config module
            initialMode: null, // Track the mode when session started (from import or empty canvas)
            hierarchyStructureChanged: false, // Track if hierarchy structure changed (forces re-import of deployment descriptor)
            deploymentDescriptorApplied: false // Track if deployment descriptor has been applied
        };

        // UI state
        this.ui = {
            modalsOpen: new Set(),
            notificationsVisible: false,
            notificationTimer: null,
            expandedGraphs: new Set(),
            collapsedGraphs: new Set(),
            edgeRerouting: new Map() // Maps collapsed node ID -> { edges: [...], originalSources: [...], originalTargets: [...] }
        };

        // History for undo/redo
        this.history = {
            stack: [],
            currentIndex: -1,
            maxSize: 50
        };

        // Debug mode
        this.debug = false;
    }

    /**
     * Reset state to initial values
     */
    reset() {
        this.mode = 'location';
        this.editing = {
            isEdgeCreationMode: false,
            selectedFirstPort: null,
            selectedSecondPort: null,
            selectedConnection: null,
            selectedNode: null,
            currentConnectionNumber: 0
        };
        this.data.globalHostCounter = 0;
        this.data.currentData = null;
        this.data.initialVisualizationData = null;
        this.data.hierarchyModeState = null;
        this.ui.modalsOpen.clear();
        this.ui.expandedGraphs.clear();
        this.ui.collapsedGraphs.clear();
        this.clearHistory();

        if (this.ui.notificationTimer) {
            clearTimeout(this.ui.notificationTimer);
            this.ui.notificationTimer = null;
        }
    }

    /**
     * Create a snapshot of current state for undo/redo
     * @returns {Object} State snapshot
     */
    createSnapshot() {
        return {
            timestamp: Date.now(),
            mode: this.mode,
            globalHostCounter: this.data.globalHostCounter,
            cytoscapeData: this.cy ? this.cy.json() : null
        };
    }

    /**
     * Save current state to history
     */
    saveToHistory() {
        // Remove any states after current index (for redo after undo)
        this.history.stack = this.history.stack.slice(0, this.history.currentIndex + 1);

        // Add new snapshot
        const snapshot = this.createSnapshot();
        this.history.stack.push(snapshot);

        // Limit history size
        if (this.history.stack.length > this.history.maxSize) {
            this.history.stack.shift();
        } else {
            this.history.currentIndex++;
        }

        this.log('State saved to history', { index: this.history.currentIndex, total: this.history.stack.length });
    }

    /**
     * Restore state from snapshot
     * @param {Object} snapshot - State snapshot to restore
     */
    restoreSnapshot(snapshot) {
        this.mode = snapshot.mode;
        this.data.globalHostCounter = snapshot.globalHostCounter;

        if (this.cy && snapshot.cytoscapeData) {
            this.cy.json(snapshot.cytoscapeData);
        }

        this.log('State restored from history', { timestamp: snapshot.timestamp });
    }

    /**
     * Undo last action
     * @returns {boolean} True if undo was successful, false if nothing to undo
     */
    undo() {
        if (this.history.currentIndex > 0) {
            this.history.currentIndex--;
            const snapshot = this.history.stack[this.history.currentIndex];
            this.restoreSnapshot(snapshot);
            return true;
        }
        return false;
    }

    /**
     * Redo last undone action
     * @returns {boolean} True if redo was successful, false if nothing to redo
     */
    redo() {
        if (this.history.currentIndex < this.history.stack.length - 1) {
            this.history.currentIndex++;
            const snapshot = this.history.stack[this.history.currentIndex];
            this.restoreSnapshot(snapshot);
            return true;
        }
        return false;
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.history.stack = [];
        this.history.currentIndex = -1;
    }

    /**
     * Get next connection number
     * @returns {number} Next connection number
     */
    getNextConnectionNumber() {
        return this.editing.currentConnectionNumber++;
    }

    /**
     * Check if in edit mode
     * @returns {boolean} True if edge creation mode is enabled
     */
    isEditMode() {
        return this.editing.isEdgeCreationMode;
    }

    /**
     * Enable edit mode
     */
    enableEditMode() {
        this.editing.isEdgeCreationMode = true;
        this.clearSelections();
        // Clear Cytoscape selections
        if (this.cy) {
            this.cy.elements().unselect();
        }
        this.log('Edit mode enabled');
    }

    /**
     * Disable edit mode
     */
    disableEditMode() {
        this.editing.isEdgeCreationMode = false;
        this.clearSelections();
        // Clear Cytoscape selections
        if (this.cy) {
            this.cy.elements().unselect();
        }
        this.log('Edit mode disabled');
    }

    /**
     * Clear all selections
     */
    clearSelections() {
        this.editing.selectedFirstPort = null;
        this.editing.selectedSecondPort = null;
        this.editing.selectedConnection = null;
        this.editing.selectedNode = null;
    }

    /**
     * Set mode
     * @param {string} mode - 'location' or 'hierarchy'
     */
    setMode(mode) {
        if (mode !== 'location' && mode !== 'hierarchy') {
            console.warn(`Invalid mode: ${mode}. Must be 'location' or 'hierarchy'`);
            return;
        }
        const oldMode = this.mode;
        // Clear selections when switching modes
        if (oldMode !== mode) {
            this.clearSelections();
            // Clear Cytoscape selections
            if (this.cy) {
                this.cy.elements().unselect();
            }
        }
        this.mode = mode;
        this.log(`Mode changed: ${oldMode} -> ${mode}`);
    }

    /**
     * Check if in location mode
     * @returns {boolean} True if in location mode
     */
    isLocationMode() {
        return this.mode === 'location';
    }

    /**
     * Check if in hierarchy mode
     * @returns {boolean} True if in hierarchy mode
     */
    isHierarchyMode() {
        return this.mode === 'hierarchy';
    }

    /**
     * Log state change (if debug enabled)
     * @param {string} message - Log message
     * @param {Object} data - Optional data to log
     */
    log(message, data = null) {
        if (this.debug) {
            console.log(`[State] ${message}`, data || '');
        }
    }

    /**
     * Enable debug mode
     */
    enableDebug() {
        this.debug = true;
        console.log('[State] Debug mode enabled');
    }

    /**
     * Disable debug mode
     */
    disableDebug() {
        this.debug = false;
    }
}

