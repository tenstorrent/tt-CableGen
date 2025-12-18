/**
 * UI Display Module - Handles all UI display and initialization functions
 * Extracted from visualizer.js to centralize UI logic
 */
import { LAYOUT_CONSTANTS } from '../config/constants.js';
import { verifyCytoscapeExtensions as verifyCytoscapeExtensionsUtil } from '../utils/cytoscape-utils.js';

export class UIDisplayModule {
    constructor(state, commonModule, locationModule, hierarchyModule, notificationManager, statusManager) {
        this.state = state;
        this.commonModule = commonModule;
        this.locationModule = locationModule;
        this.hierarchyModule = hierarchyModule;
        this.notificationManager = notificationManager;
        this.statusManager = statusManager;
    }

    /**
     * Show export status message (redirects to notification banner)
     * @param {string} message - Message to display
     * @param {string} type - Type of message (info, success, warning, error)
     */
    showExportStatus(message, type) {
        this.notificationManager.show(message, type);
    }

    /**
     * Get template color (delegates to CommonModule)
     * @param {string} templateName - Template name
     * @returns {string} Color hex code
     */
    getTemplateColor(templateName) {
        return this.commonModule.getTemplateColor(templateName);
    }

    /**
     * Update the mode indicator in the UI
     */
    updateModeIndicator() {
        const indicator = document.getElementById('visualizationModeIndicator');
        const currentModeDiv = document.getElementById('currentMode');
        const descriptionDiv = document.getElementById('modeDescription');

        // Get UI elements for add node section
        const nodePhysicalFields = document.getElementById('nodePhysicalFields');
        const nodeLogicalMessage = document.getElementById('nodeLogicalMessage');

        // Get Graph Template section
        const addGraphSection = document.getElementById('addGraphSection');

        // Get Add Node section - preserve its visibility state if connection editing is enabled
        const addNodeSection = document.getElementById('addNodeSection');
        const wasAddNodeSectionVisible = addNodeSection && addNodeSection.style.display !== 'none';

        if (!indicator || !currentModeDiv || !descriptionDiv) return;

        // Show the indicator
        indicator.style.display = 'block';

        // Get connection filter elements
        // Connection type filters are location mode only, node filter is available in both modes
        const intraNodeCheckbox = document.getElementById('showIntraNodeConnections');
        const connectionTypesSection = intraNodeCheckbox ? intraNodeCheckbox.closest('div[style*="margin-bottom"]') : null;

        if (this.state.mode === 'hierarchy') {
            indicator.style.background = '#fff3cd';
            indicator.style.borderColor = '#ffc107';
            currentModeDiv.innerHTML = '<strong>🌳 Logical Topology View</strong>';
            descriptionDiv.textContent = 'Organized by graph templates and instances (ignores physical location)';

            // Hide physical fields, show logical message
            if (nodePhysicalFields) nodePhysicalFields.style.display = 'none';
            if (nodeLogicalMessage) nodeLogicalMessage.style.display = 'block';

            // Hide connection type filters (location mode only)
            // Node filter remains visible in both modes
            if (connectionTypesSection) connectionTypesSection.style.display = 'none';
        } else {
            indicator.style.background = '#d1ecf1';
            indicator.style.borderColor = '#0c5460';
            currentModeDiv.innerHTML = '<strong>📍 Physical Location View</strong>';
            descriptionDiv.textContent = 'Organized by physical location: hall/aisle/rack/shelf (ignores logical topology)';

            // Show physical fields, hide logical message
            if (nodePhysicalFields) nodePhysicalFields.style.display = 'block';
            if (nodeLogicalMessage) nodeLogicalMessage.style.display = 'none';

            // Show connection type filters (location mode only)
            // Node filter remains visible in both modes
            if (connectionTypesSection) connectionTypesSection.style.display = 'block';

            // Hide Graph Template section in location mode
            if (addGraphSection) addGraphSection.style.display = 'none';

            // Preserve Add Node section visibility if connection editing is enabled
            if (addNodeSection && wasAddNodeSectionVisible && this.state.editing.isEdgeCreationMode) {
                addNodeSection.style.display = 'block';
            }
        }

        // Update Add Node button state after mode indicator update
        this.updateAddNodeButtonState();
        
        // Update variation options based on current mode and selected node type
        if (window.updateNodeVariationOptions && typeof window.updateNodeVariationOptions === 'function') {
            window.updateNodeVariationOptions();
        }
    }

    /**
     * Update the connection legend based on file format
     * Shows CSV legend for regular CSV files
     * Shows descriptor legend (dynamically generated) for textproto files
     * @param {Object} data - Visualization data
     */
    updateConnectionLegend(data) {
        const csvLegend = document.getElementById('csvLegend');
        const descriptorLegend = document.getElementById('descriptorLegend');

        if (!csvLegend || !descriptorLegend) {
            console.warn('Legend elements not found');
            return;
        }

        // Use visualization mode to determine which legend to show
        // Hierarchy mode uses depth-based coloring, physical mode uses intra/inter-node coloring
        const currentMode = this.state.mode;
        const isHierarchyMode = currentMode === 'hierarchy';

        if (isHierarchyMode) {
            // Show descriptor/hierarchy legend, hide CSV/physical legend
            csvLegend.style.display = 'none';
            descriptorLegend.style.display = 'block';

            // Collect all unique template names from state.data.availableGraphTemplates
            const templateNames = new Set();

            // Add templates from state.data.availableGraphTemplates (including empty ones)
            if (this.state.data.availableGraphTemplates) {
                Object.keys(this.state.data.availableGraphTemplates).forEach(name => {
                    templateNames.add(name);
                });
            }

            // Also add templates from edges in case some aren't in state.data.availableGraphTemplates
            // Check both initial data and current Cytoscape edges for dynamic updates
            const dataEdges = data.elements ? data.elements.filter(e => e.group === 'edges' || (e.data && e.data.source && e.data.target)) : [];
            const cytoscapeEdges = this.state.cy ? this.state.cy.edges() : [];
            
            // Combine both sources for comprehensive coverage
            const allEdges = [...dataEdges];
            cytoscapeEdges.forEach(edge => {
                const edgeData = edge.data();
                allEdges.push({ data: edgeData });
            });

            allEdges.forEach(e => {
                if (e.data && e.data.template_name) {
                    templateNames.add(e.data.template_name);
                }
            });

            console.log(`Total templates for legend: ${templateNames.size}`);

            // Generate legend HTML
            let legendHTML = '';

            // Check if there are any internal connections (Node Connections)
            const hasInternalConnections = allEdges.some(e => e.data && e.data.is_internal === true);
            
            // Section 1: Templates (if any exist)
            if (templateNames.size > 0 || hasInternalConnections) {
                legendHTML += '<div style="margin-bottom: 12px;">';
                legendHTML += '<div style="font-size: 12px; font-weight: bold; color: #555; margin-bottom: 6px;">Templates:</div>';
                
                // Add "Node Connections" entry for internal connections
                if (hasInternalConnections) {
                    const nodeConnectionsColor = "#00AA00"; // Green color for internal connections
                    legendHTML += `
                        <div class="legend-row" data-template="__NODE_CONNECTIONS__" data-color="${nodeConnectionsColor}" 
                             style="display: flex; align-items: center; margin: 4px 0; padding: 4px; border-radius: 4px;">
                            <div style="width: 20px; height: 3px; background-color: ${nodeConnectionsColor}; margin-right: 10px; border-radius: 2px;"></div>
                            <span style="font-size: 13px; color: #333;">Node Connections</span>
                        </div>
                    `;
                }
                
                const sortedTemplates = Array.from(templateNames).sort();
                sortedTemplates.forEach(templateName => {
                    // Get the color for this template using the same function used for connections
                    const color = this.getTemplateColor(templateName);
                    legendHTML += `
                        <div class="legend-row" data-template="${templateName}" data-color="${color}" 
                             style="display: flex; align-items: center; margin: 4px 0; padding: 4px; border-radius: 4px;">
                            <div style="width: 20px; height: 3px; background-color: ${color}; margin-right: 10px; border-radius: 2px;"></div>
                            <span style="font-size: 13px; color: #333;">${templateName}</span>
                        </div>
                    `;
                });
                legendHTML += '</div>';

                // Add note about template filter
                const templateFilterSelect = document.getElementById('templateFilterSelect');
                if (templateFilterSelect && templateFilterSelect.options.length > 1) {
                    legendHTML += '<div style="font-size: 11px; color: #666; margin-top: 8px; margin-bottom: 12px; font-style: italic;">';
                    legendHTML += '💡 Use "Filter by Template" dropdown to show connections for a specific template';
                    legendHTML += '</div>';
                }
            } else {
                legendHTML += '<div style="font-size: 13px; color: #666; margin-bottom: 12px;">No templates defined</div>';
            }

            descriptorLegend.innerHTML = legendHTML;
        } else {
            // Show CSV/physical legend, hide descriptor/hierarchy legend
            csvLegend.style.display = 'block';
            descriptorLegend.style.display = 'none';
        }
    }

    /**
     * Update delete button enabled/disabled state
     */
    updateDeleteButtonState() {
        const deleteBtn = document.getElementById('deleteElementBtn');
        if (!deleteBtn) return; // Button might not exist yet

        // Check for both single selections and multi-selections
        const hasConnection = this.state.editing.selectedConnection && this.state.editing.selectedConnection.length > 0;
        const hasNode = this.state.editing.selectedNode && this.state.editing.selectedNode.length > 0;

        // Also check cytoscape multi-selections
        const selectedNodes = this.state.cy ? this.state.cy.nodes(':selected') : [];
        const selectedEdges = this.state.cy ? this.state.cy.edges(':selected') : [];
        const hasMultipleSelections = selectedNodes.length > 0 || selectedEdges.length > 0;

        let isDeletable = false;

        // Check single node selection
        if (hasNode) {
            const nodeType = this.state.editing.selectedNode.data('type');
            isDeletable = ['shelf', 'rack', 'graph'].includes(nodeType);
        }

        // Check if any multi-selected nodes are deletable
        if (selectedNodes.length > 0) {
            isDeletable = isDeletable || selectedNodes.some(node => {
                const nodeType = node.data('type');
                return ['shelf', 'rack', 'graph'].includes(nodeType);
            });
        }

        if (this.state.editing.isEdgeCreationMode && (hasConnection || isDeletable || hasMultipleSelections)) {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '1';
            deleteBtn.style.cursor = 'pointer';
        } else {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.5';
            deleteBtn.style.cursor = 'not-allowed';
        }
    }

    /**
     * Update add node button enabled/disabled state
     */
    updateAddNodeButtonState() {
        const addNodeBtn = document.getElementById('addNodeBtn');
        if (!addNodeBtn) return;

        const addNodeText = addNodeBtn.nextElementSibling;

        // Check if we have a valid visualization (state.cy exists and has elements or we have currentData)
        const cyInstance = this.state.cy;
        const hasElements = cyInstance && cyInstance.elements().length > 0;
        const hasCurrentData = this.state.data.currentData !== null && this.state.data.currentData !== undefined;
        const hasVisualization = hasElements || hasCurrentData;

        // If we have cy but no currentData, create a minimal structure to enable the button
        if (cyInstance && hasElements && !hasCurrentData) {
            this.state.data.currentData = {
                elements: cyInstance.elements().jsons(),
                metadata: this.state.data.hierarchyModeState?.metadata || this.state.data.initialVisualizationData?.metadata || {}
            };
        }

        if (hasVisualization) {
            // Enable the button
            addNodeBtn.disabled = false;
            addNodeBtn.style.background = '#007bff';
            addNodeBtn.style.cursor = 'pointer';
            addNodeBtn.style.opacity = '1';
            if (addNodeText) {
                addNodeText.textContent = 'Creates a new node with trays and ports';
            }
        } else {
            // Disable the button
            addNodeBtn.disabled = true;
            addNodeBtn.style.background = '#6c757d';
            addNodeBtn.style.cursor = 'not-allowed';
            addNodeBtn.style.opacity = '0.6';
            if (addNodeText) {
                addNodeText.textContent = 'Upload a visualization first to enable node creation';
            }
        }
    }

    /**
     * Update expand/collapse button states
     */
    updateExpandCollapseButtons() {
        // Enable/disable buttons based on current state
        const expandBtn = document.getElementById('expandOneLevelBtn');
        const collapseBtn = document.getElementById('collapseOneLevelBtn');

        if (!this.state || !this.state.ui) {
            // Disable if state not available
            if (expandBtn) {
                expandBtn.disabled = true;
                expandBtn.style.opacity = '0.5';
            }
            if (collapseBtn) {
                collapseBtn.disabled = true;
                collapseBtn.style.opacity = '0.5';
            }
            return;
        }

        const hasCollapsedNodes = this.state.ui.collapsedGraphs.size > 0;
        const hasExpandableNodes = this.state.cy && this.state.cy.nodes().length > 0;

        // Enable expand button if there are collapsed nodes
        if (expandBtn) {
            expandBtn.disabled = !hasCollapsedNodes;
            expandBtn.style.opacity = hasCollapsedNodes ? '1.0' : '0.5';
        }

        // Enable collapse button if there are expandable nodes
        if (collapseBtn) {
            collapseBtn.disabled = !hasExpandableNodes;
            collapseBtn.style.opacity = hasExpandableNodes ? '1.0' : '0.5';
        }
    }

    /**
     * Extract graph templates from loaded data metadata
     * @param {Object} data - The visualization data
     */
    extractGraphTemplates(data) {
        this.state.data.availableGraphTemplates = {};

        // Check if metadata contains graph_templates
        if (data.metadata && data.metadata.graph_templates) {
            // Clean up duplicates before storing templates
            const cleanedTemplates = {};
            for (const [templateName, template] of Object.entries(data.metadata.graph_templates)) {
                const cleanedTemplate = { ...template };

                // Remove duplicate children by name
                if (cleanedTemplate.children && Array.isArray(cleanedTemplate.children)) {
                    const seenNames = new Set();
                    const uniqueChildren = [];

                    cleanedTemplate.children.forEach(child => {
                        if (!seenNames.has(child.name)) {
                            seenNames.add(child.name);
                            uniqueChildren.push(child);
                        } else {
                            console.warn(`[extractGraphTemplates] Found duplicate child "${child.name}" in template "${templateName}" from import. Removing duplicate.`);
                        }
                    });

                    cleanedTemplate.children = uniqueChildren;
                }

                cleanedTemplates[templateName] = cleanedTemplate;
            }

            this.state.data.availableGraphTemplates = cleanedTemplates;

            console.log(`[extractGraphTemplates] Loaded ${Object.keys(cleanedTemplates).length} templates`);
        }

        // Update the dropdown
        this.populateGraphTemplateDropdown();
    }

    /**
     * Populate the graph template dropdown with available templates
     */
    populateGraphTemplateDropdown() {
        const graphTemplateSelect = document.getElementById('graphTemplateSelect');
        if (!graphTemplateSelect) return;

        // Clear existing options
        graphTemplateSelect.innerHTML = '';

        const templateCount = Object.keys(this.state.data.availableGraphTemplates || {}).length;

        if (templateCount === 0) {
            // No templates available - show message
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No graph templates available (load a textproto first)';
            option.disabled = true;
            graphTemplateSelect.appendChild(option);

            // Disable the Add Graph button
            const addGraphBtn = document.getElementById('addGraphBtn');
            if (addGraphBtn) {
                addGraphBtn.disabled = true;
                addGraphBtn.style.cursor = 'not-allowed';
                addGraphBtn.style.background = '#6c757d';
                addGraphBtn.style.opacity = '0.6';
            }
        } else {
            // Add placeholder option first
            const placeholderOption = document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.textContent = 'Select a template to instantiate...';
            placeholderOption.disabled = true;
            placeholderOption.selected = true;
            graphTemplateSelect.appendChild(placeholderOption);

            // Add available templates
            Object.keys(this.state.data.availableGraphTemplates).sort().forEach(templateName => {
                const option = document.createElement('option');
                option.value = templateName;
                option.textContent = `${templateName} (Graph Template)`;
                graphTemplateSelect.appendChild(option);
            });
        }
    }

    /**
     * Update all edge colors to use template-based colors from JavaScript
     * This ensures edges match the legend colors and filter correctly
     * Should be called after import as the final step
     */
    updateAllEdgeColorsToTemplateColors() {
        if (!this.state || !this.state.cy) {
            return;
        }

        const allEdges = this.state.cy.edges();
        let updatedCount = 0;
        let skippedCount = 0;

        // Batch all edge color updates for better performance
        this.state.cy.startBatch();

        allEdges.forEach(edge => {
            const templateName = edge.data('template_name') || edge.data('containerTemplate');

            if (templateName) {
                // Get template color from JS (this matches legend colors)
                const templateColor = this.getTemplateColor(templateName);
                const oldColor = edge.data('color');

                // Update edge color to match template
                edge.data('color', templateColor);

                // Build reverse mapping: color -> template (for color-based template inference)
                if (this.commonModule) {
                    this.commonModule.colorToTemplate[templateColor] = templateName;
                }

                if (oldColor !== templateColor) {
                    updatedCount++;
                }
            } else {
                skippedCount++;
                // Edge doesn't have template_name - this is expected for some edge types
                // (e.g., manually created edges in location mode)
            }
        });

        this.state.cy.endBatch();

        console.log(`[updateAllEdgeColorsToTemplateColors] Updated ${updatedCount} edge colors to match template colors, ${skippedCount} edges skipped (no template_name)`);
    }

    /**
     * Parse a comma-separated and/or newline-separated list
     * @param {string} text - Input text
     * @returns {Array<string>} Array of parsed items
     */
    parseList(text) {
        if (!text) return [];

        // Split by both newlines and commas, then clean up
        return text
            .split(/[\n,]/)
            .map(item => item.trim())
            .filter(item => item.length > 0);
    }

    /**
     * Parse a range string like "1-10" into an array of numbers [1,2,3,...,10]
     * @param {string} rangeStr - Range string (e.g., "1-10")
     * @returns {Array<number>|null} Array of numbers or null if not a valid range
     */
    parseRange(rangeStr) {
        const match = rangeStr.match(/^(\d+)\s*-\s*(\d+)$/);
        if (!match) return null;

        const start = parseInt(match[1]);
        const end = parseInt(match[2]);

        if (start > end) return null;

        const result = [];
        for (let i = start; i <= end; i++) {
            result.push(i);
        }
        return result;
    }

    /**
     * Parse input that could be:
     * - A number (e.g., "5" -> generate range 1-5)
     * - A range (e.g., "1-10" -> [1,2,3,...,10])
     * - A comma-separated list (e.g., "1,2,5,10" -> [1,2,5,10])
     * - A text list (e.g., "A,B,C" -> ["A","B","C"])
     * @param {string} input - Input text
     * @returns {Array<string|number>} Array of values
     */
    parseFlexibleInput(input) {
        if (!input) return [];

        input = input.trim();

        // Check if it's a single number (generate range 1 to N)
        const singleNum = parseInt(input);
        if (!isNaN(singleNum) && input.match(/^\d+$/)) {
            const result = [];
            for (let i = 1; i <= singleNum; i++) {
                result.push(i);
            }
            return result;
        }

        // Check if it's a range (e.g., "1-10")
        const rangeResult = this.parseRange(input);
        if (rangeResult) return rangeResult;

        // Otherwise parse as comma/newline-separated list
        const items = this.parseList(input);

        // Try to convert to numbers if all items are numeric
        const allNumeric = items.every(item => !isNaN(parseInt(item)));
        if (allNumeric) {
            return items.map(item => parseInt(item));
        }

        return items;
    }

    /**
     * Parse hall names from textarea (one per line or comma-separated)
     * @returns {Array<string>} Array of hall names (empty string if not specified)
     */
    parseHallNames() {
        const element = document.getElementById('hallNames');
        if (!element) return ['']; // Empty hall allowed
        const hallNamesText = element.value || '';
        const parsed = this.parseList(hallNamesText);
        // If empty, return array with empty string to allow omitting hall
        return parsed.length === 0 ? [''] : parsed;
    }

    /**
     * Parse aisle names/numbers
     * @returns {Array<string>} Array of aisle identifiers (empty string if not specified)
     */
    parseAisleNames() {
        const element = document.getElementById('aisleNames');
        if (!element) return ['']; // Empty aisle allowed
        const input = element.value || '';
        const result = this.parseFlexibleInput(input);

        // If empty, return array with empty string to allow omitting aisle
        if (result.length === 0) return [''];

        // Convert numbers to letters if needed (1->A, 2->B, etc.)
        return result.map(item => {
            if (typeof item === 'number' && item >= 1 && item <= 26) {
                return String.fromCharCode(64 + item); // 1->A, 2->B, etc.
            }
            return item.toString();
        });
    }

    /**
     * Parse rack numbers
     * @returns {Array<number>} Array of rack numbers
     */
    parseRackNumbers() {
        const element = document.getElementById('rackNumbers');
        if (!element) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Default fallback
        const input = element.value || '';
        const result = this.parseFlexibleInput(input);

        // If empty, default to rack 1
        if (result.length === 0) return [1];

        // Ensure all are numbers
        return result.map(item => typeof item === 'number' ? item : parseInt(item) || 1);
    }

    /**
     * Parse shelf unit numbers
     * @returns {Array<number>} Array of shelf U numbers
     */
    parseShelfUnitNumbers() {
        const element = document.getElementById('shelfUnitNumbers');
        if (!element) {
            // Default fallback: 1-42
            const result = [];
            for (let i = 1; i <= 42; i++) {
                result.push(i);
            }
            return result;
        }
        const input = element.value || '';
        const result = this.parseFlexibleInput(input);

        // If empty, default to U 1
        if (result.length === 0) return [1];

        // Ensure all are numbers
        return result.map(item => typeof item === 'number' ? item : parseInt(item) || 1);
    }

    /**
     * Update the total capacity display in the modal
     */
    updateTotalCapacity() {
        const hallNames = this.parseHallNames();
        const aisleNames = this.parseAisleNames();
        const rackNumbers = this.parseRackNumbers();
        const shelfUnitNumbers = this.parseShelfUnitNumbers();

        const totalCapacity = hallNames.length * aisleNames.length * rackNumbers.length * shelfUnitNumbers.length;

        const capacitySpan = document.getElementById('totalCapacity');
        if (capacitySpan) {
            capacitySpan.textContent = `${totalCapacity} nodes`;
        }
    }

    /**
     * Show physical layout specification modal
     */
    showPhysicalLayoutModal() {
        console.log('showPhysicalLayoutModal called');

        const modal = document.getElementById('physicalLayoutModal');
        console.log('Modal element:', modal);

        if (!modal) {
            console.error('Physical layout modal not found in DOM');
            alert('Error: Physical layout modal not found. Please refresh the page.');
            return;
        }

        // Ensure manual tab is active and visible before accessing form elements
        const manualContent = document.getElementById('manualLayoutContent');
        if (manualContent) {
            manualContent.style.display = 'block';
        }
        // Switch to manual tab to ensure form is visible
        if (typeof window.switchLayoutTab === 'function') {
            window.switchLayoutTab('manual');
        }

        // Get all input elements with null checks
        const hallNamesInput = document.getElementById('hallNames');
        const aisleNamesInput = document.getElementById('aisleNames');
        const rackNumbersInput = document.getElementById('rackNumbers');
        const shelfUnitNumbersInput = document.getElementById('shelfUnitNumbers');

        console.log('Input elements:', {
            hallNames: !!hallNamesInput,
            aisleNames: !!aisleNamesInput,
            rackNumbers: !!rackNumbersInput,
            shelfUnitNumbers: !!shelfUnitNumbersInput
        });

        // Verify all elements exist
        if (!hallNamesInput || !aisleNamesInput || !rackNumbersInput || !shelfUnitNumbersInput) {
            console.error('Physical layout modal inputs not found');
            alert('Error: Physical layout modal inputs not found. Please refresh the page.');
            return;
        }

        // Reset to default values (set before showing modal to avoid empty flash)
        hallNamesInput.value = '';
        aisleNamesInput.value = '';
        rackNumbersInput.value = '1-10';
        shelfUnitNumbersInput.value = '1-42';

        // Update capacity display
        this.updateTotalCapacity();

        // Add event listeners for real-time capacity updates
        const inputs = [hallNamesInput, aisleNamesInput, rackNumbersInput, shelfUnitNumbersInput];
        inputs.forEach(input => {
            input.removeEventListener('input', () => this.updateTotalCapacity());
            input.addEventListener('input', () => this.updateTotalCapacity());
        });

        // Add click handler to close modal when clicking outside
        modal.removeEventListener('click', (e) => this.handlePhysicalLayoutModalClick(e));
        modal.addEventListener('click', (e) => this.handlePhysicalLayoutModalClick(e));

        // Show modal after values are set
        console.log('Adding active class to modal');
        modal.classList.add('active');
        console.log('Modal should now be visible, classes:', modal.classList.toString());
    }

    /**
     * Handle clicks on the physical layout modal overlay
     * @param {Event} event - Click event
     */
    handlePhysicalLayoutModalClick(event) {
        // Only close if clicking directly on the overlay (not on content inside)
        if (event.target.id === 'physicalLayoutModal') {
            console.log('Clicked outside modal content, closing');
            this.cancelPhysicalLayoutModal();
        }
    }

    /**
     * Cancel physical layout modal (close without applying)
     * Stay in hierarchy mode - don't switch to physical layout
     */
    cancelPhysicalLayoutModal() {
        console.log('cancelPhysicalLayoutModal called - staying in hierarchy mode');
        const modal = document.getElementById('physicalLayoutModal');
        if (modal) {
            modal.classList.remove('active');
            modal.removeEventListener('click', (e) => this.handlePhysicalLayoutModalClick(e));
        }

        // Make sure we stay in hierarchy mode
        const currentMode = this.state.mode;
        if (currentMode !== 'hierarchy') {
            // setVisualizationMode is a global function, will be called from wrapper
            window.setVisualizationMode?.('hierarchy');
            this.updateModeIndicator();
        }

        this.showExportStatus('Physical layout configuration cancelled', 'info');
    }

    /**
     * Apply physical layout to all shelf nodes
     * Assigns unique physical locations using nested loops
     */
    applyPhysicalLayout() {
        if (!this.state.cy) return;

        // Parse all layout parameters
        const hallNames = this.parseHallNames();
        const aisleNames = this.parseAisleNames();
        const rackNumbers = this.parseRackNumbers();
        const shelfUnitNumbers = this.parseShelfUnitNumbers();

        // Validate parameters (hall and aisle can be empty)
        if (rackNumbers.length === 0) {
            alert('Please enter at least one rack number');
            return;
        }
        if (shelfUnitNumbers.length === 0) {
            alert('Please enter at least one shelf unit number');
            return;
        }

        // Get all shelf nodes
        const shelfNodes = this.state.cy.nodes('[type="shelf"]');
        if (shelfNodes.length === 0) {
            alert('No shelf nodes found to assign physical locations');
            this.cancelPhysicalLayoutModal();
            return;
        }

        // Calculate total capacity
        const totalCapacity = hallNames.length * aisleNames.length * rackNumbers.length * shelfUnitNumbers.length;

        // Warn if not enough capacity
        if (shelfNodes.length > totalCapacity) {
            const proceed = confirm(
                `Warning: You have ${shelfNodes.length} nodes but only ${totalCapacity} available locations.\n\n` +
                `The first ${totalCapacity} nodes will be assigned locations. Continue?`
            );
            if (!proceed) return;
        }

        // Assign physical locations using nested loops
        let nodeIndex = 0;
        let assignedCount = 0;

        outerLoop:
        for (let h = 0; h < hallNames.length; h++) {
            const hall = hallNames[h];

            for (let a = 0; a < aisleNames.length; a++) {
                const aisle = aisleNames[a];

                for (let r = 0; r < rackNumbers.length; r++) {
                    const rackNum = rackNumbers[r];

                    for (let s = 0; s < shelfUnitNumbers.length; s++) {
                        const shelfU = shelfUnitNumbers[s];

                        if (nodeIndex >= shelfNodes.length) {
                            break outerLoop;
                        }

                        const node = shelfNodes[nodeIndex];

                        // Update node data with physical location
                        node.data('hall', hall);
                        node.data('aisle', aisle);
                        node.data('rack_num', rackNum);
                        node.data('shelf_u', shelfU);

                        // Ensure hostname is set for deployment descriptor export
                        // If no hostname, use host_# format based on host_index
                        if (!node.data('hostname')) {
                            const hostIndex = node.data('host_index');
                            if (hostIndex !== undefined && hostIndex !== null) {
                                // Use host_# format for descriptor imports
                                node.data('hostname', `host_${hostIndex}`);
                            } else {
                                // Fallback to label-based hostname for CSV imports
                                const newLabel = this.locationModule.buildLabel(hall, aisle, rackNum, shelfU);
                                node.data('label', newLabel);
                                node.data('id', newLabel);
                                node.data('hostname', newLabel);
                            }
                        }

                        nodeIndex++;
                        assignedCount++;
                    }
                }
            }
        }

        // Close modal
        const modal = document.getElementById('physicalLayoutModal');
        if (modal) {
            modal.classList.remove('active');
            modal.removeEventListener('click', (e) => this.handlePhysicalLayoutModalClick(e));
        }

        // Show success message
        this.showExportStatus(`Assigned physical locations to ${assignedCount} nodes`, 'success');

        // Mark that physical layout has been assigned (used to skip modal on future switches)
        sessionStorage.setItem('physicalLayoutAssigned', 'true');

        // Now switch to location mode and update the visualization
        window.setVisualizationMode?.('location');

        // Update the connection legend based on the new mode if we have initial data
        if (this.state.data.initialVisualizationData) {
            this.updateConnectionLegend(this.state.data.initialVisualizationData);
        }

        // Proceed with the location mode switch
        this.locationModule.switchMode();

        // Update mode indicator
        this.updateModeIndicator();
    }

    /**
     * Create an empty canvas for manual node creation and connection drawing.
     */
    createEmptyVisualization() {
        // Hide loading overlay
        const cyLoading = document.getElementById('cyLoading');
        if (cyLoading) {
            cyLoading.style.display = 'none';
        }

        // Create empty data structure that matches what initVisualization expects
        this.state.data.currentData = {
            nodes: [],
            edges: [],
            elements: [],  // Empty elements array for Cytoscape
            metadata: {
                total_connections: 0,
                total_nodes: 0
            }
        };

        // Initialize Cytoscape with empty data
        this.initVisualization(this.state.data.currentData);

        // Enable the Add Node button
        this.updateAddNodeButtonState();

        // Open the Cabling Editor section
        const cablingEditorContent = document.getElementById('cablingEditor');
        if (cablingEditorContent && cablingEditorContent.classList.contains('collapsed')) {
            window.toggleCollapsible?.('cablingEditor');
        }

        // Enable Connection Editing (suppress alert since we're showing custom success message)
        const toggleBtn = document.getElementById('toggleEdgeHandlesBtn');
        if (toggleBtn && toggleBtn.textContent.includes('Enable')) {
            window.toggleEdgeHandles?.(true);
        }

        // Show success message
        this.notificationManager.show('Empty visualization created! Connection editing is enabled. You can now add nodes using the "Add New Node" section.', 'success');
    }

    /**
     * Initialize Cytoscape visualization with data
     * @param {Object} data - Visualization data
     */
    initVisualization(data) {
        // Safety check for DOM elements
        const cyLoading = document.getElementById('cyLoading');
        const cyContainer = document.getElementById('cy');

        if (!cyLoading || !cyContainer) {
            console.error('Required DOM elements not found');
            return;
        }

        cyLoading.style.display = 'none';

        console.log('Initializing Cytoscape with data:', data);
        console.log('Container element:', cyContainer);
        console.log('Container dimensions:', cyContainer.offsetWidth, 'x', cyContainer.offsetHeight);
        console.log('Elements count:', data.elements ? data.elements.length : 'undefined');

        // Debug: Check if positions exist in data
        const graphNodesInData = (data.elements && Array.isArray(data.elements)) ? data.elements.filter(e => e.data && e.data.type === 'graph') : [];
        console.log('Graph nodes in data:', graphNodesInData.length);

        // Store initial visualization data for reset functionality
        const initialDataCopy = JSON.parse(JSON.stringify(data));
        this.state.data.initialVisualizationData = initialDataCopy;
        console.log('Stored initial visualization data for reset');

        // Initialize hierarchy mode state (allows mode switching even without going to location first)
        const hierarchyStateCopy = JSON.parse(JSON.stringify(data));
        this.state.data.hierarchyModeState = hierarchyStateCopy;
        console.log('Initialized hierarchy mode state');

        // Ensure state.data.currentData has metadata for exports (without breaking position references)
        if (!this.state.data.currentData) {
            // First time loading - set state.data.currentData
            this.state.data.currentData = data;
            console.log('Initialized state.data.currentData');
        } else if (data.metadata && data.metadata.graph_templates &&
            (!this.state.data.currentData.metadata || !this.state.data.currentData.metadata.graph_templates)) {
            // Data has graph_templates but state.data.currentData doesn't - merge metadata only
            if (!this.state.data.currentData.metadata) {
                this.state.data.currentData.metadata = {};
            }
            this.state.data.currentData.metadata.graph_templates = data.metadata.graph_templates;
        }

        // Track initial root template for efficient export decisions
        if (this.state.data.currentData && !this.state.data.currentData.metadata) {
            this.state.data.currentData.metadata = {};
        }
        if (this.state.data.currentData && this.state.data.currentData.metadata) {
            // Find the single top-level graph node from initial import
            const topLevelGraphs = data.elements.filter(el => {
                const elData = el.data || {};
                const elType = elData.type;
                const hasParent = elData.parent;
                return elType === 'graph' && !hasParent;
            });

            // Always initialize these fields to prevent undefined errors
            if (topLevelGraphs.length === 1) {
                const rootNode = topLevelGraphs[0].data;
                this.state.data.currentData.metadata.initialRootTemplate = rootNode.template_name || 'unknown_template';
                this.state.data.currentData.metadata.initialRootId = rootNode.id;
                this.state.data.currentData.metadata.hasTopLevelAdditions = false;
            } else {
                // Zero or multiple roots on import - set to null (explicitly, not undefined)
                // This prevents "Cannot read property" errors when these fields are accessed
                this.state.data.currentData.metadata.initialRootTemplate = null;
                this.state.data.currentData.metadata.initialRootId = null;
                this.state.data.currentData.metadata.hasTopLevelAdditions = (topLevelGraphs.length > 1);
                if (topLevelGraphs.length === 0) {
                    console.log(`No top-level graph nodes on import (CSV/location mode) - initialRoot fields set to null`);
                } else {
                    console.log(`Multiple top-level nodes on import (${topLevelGraphs.length}) - flagging as modified`);
                }
            }
        }

        // Detect and set visualization mode based on data
        // Skip auto-detection for empty canvases (preserve explicitly-set mode)
        const isEmpty = !data.elements || data.elements.length === 0;
        const isDescriptor = data.metadata && data.metadata.file_format === 'descriptor';
        const hasGraphNodes = !isEmpty && data.elements && data.elements.some(el => el.data && el.data.type === 'graph');

        if (!isEmpty) {
            if (hasGraphNodes || isDescriptor) {
                window.setVisualizationMode?.('hierarchy');
                console.log('Detected hierarchy mode (descriptor/textproto import)');
            } else {
                window.setVisualizationMode?.('location');
                console.log('Detected location mode (CSV import)');
            }
        }

        // Initialize global host counter based on existing shelf nodes
        const existingShelves = data.elements.filter(el => el.data && el.data.type === 'shelf');
        this.state.data.globalHostCounter = existingShelves.length;
        console.log(`Initialized global host counter: ${this.state.data.globalHostCounter} existing hosts`);

        // Extract available graph templates from metadata (for textproto imports)
        this.extractGraphTemplates(data);

        if (isEmpty) {
            const currentMode = this.state.mode;
            console.log(`Empty canvas - preserving current mode: ${currentMode}`);
        }

        // Ensure container has proper dimensions
        if (cyContainer.offsetWidth === 0 || cyContainer.offsetHeight === 0) {
            console.warn('Container has zero dimensions, setting explicit size');
            cyContainer.style.width = '100%';
            cyContainer.style.height = '600px';
        }

        try {
            if (this.state.cy) {
                // Clear existing elements and add new ones
                console.log('Clearing existing elements and adding new ones');
                this.state.cy.elements().remove();
                this.state.cy.add(data.elements);

                // Apply drag restrictions
                this.commonModule.applyDragRestrictions();

                this.state.cy.layout({ name: 'preset' }).run();

                // Ensure event handlers are registered even when reusing existing instance
                // Use a small delay to ensure layout is complete and elements are rendered
                setTimeout(() => {
                    this.commonModule.addCytoscapeEventHandlers();
                    // Apply curve styles after layout is complete
                    this.commonModule.forceApplyCurveStyles();
                }, 50);
            } else {
                // Create new Cytoscape instance
                console.log('Creating new Cytoscape instance');
                console.log('Data elements:', data.elements.length);

                // CRITICAL: Cytoscape auto-centers compound nodes based on children
                // Strategy: Add ALL elements first, THEN calculate positions in JavaScript

                this.state.cy = cytoscape({
                    container: cyContainer,
                    elements: data.elements,  // Add everything at once
                    style: this.commonModule.getCytoscapeStyles(),
                    layout: {
                        name: 'grid',  // Simple initial layout (will be recalculated immediately)
                        animate: false,
                        fit: false,  // Don't fit yet - wait for proper layout
                        padding: 50
                    },
                    minZoom: 0.1,
                    maxZoom: 5,
                    wheelSensitivity: 0.2,
                    autoungrabify: false,
                    autounselectify: false,
                    autolock: false,
                    hideEdgesOnViewport: true,
                    textureOnViewport: true  // Use texture caching for smoother pan/zoom on large graphs
                });

                // Manually sync window.cy since state.cy is not wrapped in a proxy
                if (window.cy !== this.state.cy) {
                    window.cy = this.state.cy;
                }

                // Sync legacy global variable immediately
                // Set template-based colors for all imported graph nodes (batched for performance)
                this.state.cy.startBatch();
                this.state.cy.nodes('[type="graph"]').forEach(node => {
                    const templateName = node.data('template_name');
                    if (templateName) {
                        const templateColor = this.getTemplateColor(templateName);
                        node.data('templateColor', templateColor);
                    }
                });
                this.state.cy.endBatch();

                // Update edge colors to use template-based colors (LAST STEP - ensures colors match legend)
                this.updateAllEdgeColorsToTemplateColors();

                // Apply JavaScript-based layout based on visualization mode
                const currentMode = this.state.mode;
                if (currentMode === 'hierarchy') {
                    // Hierarchy mode - use hierarchical layout
                    this.hierarchyModule.calculateLayout();

                    // For textproto imports, host_index is already set from host_id during import
                    // Only recalculate if host_index is missing (e.g., empty canvas or manual additions)
                    const isTextprotoImport = isDescriptor || (data.metadata && data.metadata.file_format === 'descriptor');

                    if (!isTextprotoImport) {
                        // For non-textproto imports (e.g., empty canvas), only recalculate if host_index is missing
                        const allShelves = this.state.cy.nodes('[type="shelf"]');
                        const needsRecalculation = allShelves.length > 0 && allShelves.some(node => {
                            const hostIndex = node.data('host_index');
                            return hostIndex === undefined || hostIndex === null;
                        });

                        if (needsRecalculation) {
                            console.log('Some shelf nodes missing host_index, recalculating...');
                            this.hierarchyModule.recalculateHostIndicesForTemplates();
                        } else {
                            console.log('All shelf nodes have host_index, preserving existing assignments');
                        }
                    } else {
                        console.log('Textproto import detected - using host_index from host_id (no DFS re-indexing)');
                    }
                } else {
                    // Location mode - check if racks exist, if not create them from shelf location data (like switchMode does)
                    const existingRacks = this.state.cy.nodes('[type="rack"]');
                    const shelfNodes = this.state.cy.nodes('[type="shelf"]');
                    const shelvesWithLocation = shelfNodes.filter(shelf => {
                        const data = shelf.data();
                        return data.hall || data.aisle || (data.rack_num !== undefined && data.rack_num !== null);
                    });

                    // If we have shelves with location data but no racks, create racks (like switchMode does)
                    if (existingRacks.length === 0 && shelvesWithLocation.length > 0) {
                        console.log('[initVisualization] No racks found but shelves have location data - creating racks like switchMode does');
                        // Call switchMode to rebuild with proper hall/aisle/rack structure
                        this.locationModule.switchMode();
                        return; // switchMode handles everything including calculateLayout and resetLayout
                    }

                    // Racks already exist or no location data - use normal flow
                    // calculateLayout() creates the hall/aisle nodes, resetLayout() does final positioning and cleanup
                    this.locationModule.calculateLayout();

                    // After calculateLayout creates the nodes, call resetLayout for final positioning and cleanup
                    // Use a timeout to ensure calculateLayout's async operations complete first
                    setTimeout(() => {
                        window.resetLayout?.();
                    }, 200);
                }

                // Fit viewport to show all content (for hierarchy mode, or immediate fit for location mode)
                if (currentMode === 'hierarchy') {
                    this.state.cy.fit(null, 50);
                }

                // Apply drag restrictions after layout (for hierarchy mode)
                if (currentMode === 'hierarchy') {
                    setTimeout(() => {
                        this.commonModule.applyDragRestrictions();
                    }, 100);
                }

                // Add event handlers for new instance after a short delay to ensure Cytoscape is fully ready
                // This ensures elements are rendered and handlers can properly attach to them
                setTimeout(() => {
                    this.commonModule.addCytoscapeEventHandlers();
                }, 50);
            }

            // Log Cytoscape instance status (state.cy should be set by this point)
            if (this.state.cy) {
                console.log('Cytoscape instance ready - Nodes:', this.state.cy.nodes().length, 'Edges:', this.state.cy.edges().length);
            } else {
                // This shouldn't happen, but log a warning instead of error since visualization may still work
                console.warn('Cytoscape instance check: state.cy is null (this may be expected if switchMode was called)');
            }

            // Verify all cytoscape extensions are loaded and available
            verifyCytoscapeExtensionsUtil(this.state);

            // Apply drag restrictions
            this.commonModule.applyDragRestrictions();

            // Apply final curve styling and ensure edge colors are updated (last step)
            setTimeout(() => {
                this.commonModule.forceApplyCurveStyles();
                window.updatePortConnectionStatus?.();
                // Final step: ensure all edge colors match template colors from JS
                this.updateAllEdgeColorsToTemplateColors();
            }, 100);

            // Initialize delete button state
            this.updateDeleteButtonState();

            // Update Add Node button state after visualization is initialized
            this.updateAddNodeButtonState();

            // Add remaining event handlers (only for new instances)
            if (this.state.cy && !window.cytoscapeEventHandlersAdded) {
                // Call the wrapper function from visualizer.js which delegates to appropriate modules
                window.addConnectionTypeEventHandlers?.();
                window.cytoscapeEventHandlersAdded = true;
            }

            // Populate filter dropdowns
            window.populateNodeFilterDropdown?.();
            // Populate template filter dropdown (hierarchy mode only, but safe to call)
            window.populateTemplateFilterDropdown?.();

            // Re-attach handlers after dropdowns are populated to ensure they work
            // This is important because cloning/replacing dropdowns removes event listeners
            setTimeout(() => {
                window.addConnectionTypeEventHandlers?.();
            }, 200);

            console.log('Cytoscape initialization complete');
        } catch (error) {
            console.error('Error initializing Cytoscape:', error);
        }
    }

    /**
     * Recalculate layout based on current visualization mode and current node data
     */
    resetLayout() {
        if (!this.state.cy) {
            alert('No visualization loaded. Please upload a file first.');
            return;
        }

        const mode = this.state.mode;

        if (mode === 'hierarchy') {
            // Hierarchy mode - recalculate layout using JavaScript layout engine
            this.showExportStatus('Recalculating hierarchical layout...', 'info');

            // Use JavaScript layout engine for consistent spacing
            this.hierarchyModule.calculateLayout();

            // Fit viewport to show all nodes
            this.state.cy.fit(null, 50);

            // Apply drag restrictions
            this.commonModule.applyDragRestrictions();

            this.showExportStatus('Layout reset with consistent spacing', 'success');

            setTimeout(() => {
                const statusDiv = document.getElementById('rangeStatus');
                if (statusDiv) {
                    statusDiv.textContent = '';
                }
            }, 2000);

            return;
        }

        // Location mode - recalculate based on rack/shelf positions with hall/aisle grouping
        // Get all racks and group by hall/aisle
        const racks = this.state.cy.nodes('[type="rack"]');
        if (racks.length === 0) {
            // Check if canvas is empty - if so, silently return (no error needed)
            const allNodes = this.state.cy.nodes();
            if (allNodes.length === 0) {
                // Empty canvas - this is expected, no error needed
                return;
            }
            // No racks but nodes exist - check if this is expected (8-column/hostname-based format)
            const fileFormat = this.state.data.currentData?.metadata?.file_format;
            if (fileFormat === 'hostname_based') {
                // This is expected for 8-column format - no racks, just standalone shelves
                // Silently return without showing alert
                return;
            }
            // For other formats, racks are expected - show warning
            alert('No rack hierarchy found.');
            return;
        }

        // Show status message
        this.showExportStatus('Recalculating location-based layout with hall/aisle grouping...', 'info');

        // Group racks by hall -> aisle -> rack hierarchy
        const rackHierarchy = {};
        racks.forEach((rack) => {
            const hall = rack.data('hall') || 'unknown_hall';
            const aisle = rack.data('aisle') || 'unknown_aisle';
            const rackNum = parseInt(rack.data('rack_num')) || 0;

            if (!rackHierarchy[hall]) rackHierarchy[hall] = {};
            if (!rackHierarchy[hall][aisle]) rackHierarchy[hall][aisle] = [];

            rackHierarchy[hall][aisle].push({
                node: rack,
                rack_num: rackNum
            });
        });

        // Sort racks within each aisle by rack number (descending - higher rack numbers to the left)
        Object.keys(rackHierarchy).forEach(hall => {
            Object.keys(rackHierarchy[hall]).forEach(aisle => {
                rackHierarchy[hall][aisle].sort((a, b) => {
                    return b.rack_num - a.rack_num; // Descending order - rack 2 to the left of rack 1
                });
            });
        });

        // Dynamically calculate layout constants based on actual node sizes
        // Calculate average/max rack width
        let maxRackWidth = 0;
        racks.forEach((rack) => {
            // Skip if rack has been removed or is invalid
            if (!rack || !rack.cy() || rack.removed()) return;

            const bb = rack.boundingBox();
            const width = bb.w;
            if (width > maxRackWidth) maxRackWidth = width;
        });
        const rackWidth = maxRackWidth || LAYOUT_CONSTANTS.DEFAULT_RACK_WIDTH;

        // Calculate average/max shelf height (including all descendants)
        let maxShelfHeight = 0;
        let totalShelfHeight = 0;
        let shelfCount = 0;

        racks.forEach((rack) => {
            // Skip if rack has been removed or is invalid
            if (!rack || !rack.cy() || rack.removed()) return;

            rack.children('[type="shelf"]').forEach((shelf) => {
                // Skip if shelf has been removed or is invalid
                if (!shelf || !shelf.cy() || shelf.removed()) return;

                // Get bounding box of shelf including all its children
                const bb = shelf.boundingBox({ includeLabels: false, includeOverlays: false });
                const height = bb.h;
                totalShelfHeight += height;
                shelfCount++;
                if (height > maxShelfHeight) maxShelfHeight = height;
            });
        });

        const avgShelfHeight = shelfCount > 0 ? totalShelfHeight / shelfCount : 300;

        // Use max shelf height + 25% buffer for spacing to prevent any overlaps
        const shelfSpacingBuffer = 1.25; // 25% extra space
        const shelfSpacing = Math.max(maxShelfHeight, avgShelfHeight) * shelfSpacingBuffer;

        // Rack spacing should be enough for the widest rack + buffer
        const rackSpacing = rackWidth * LAYOUT_CONSTANTS.RACK_SPACING_BUFFER - rackWidth;

        // Calculate appropriate starting positions with padding
        const baseX = Math.max(200, rackWidth / 2 + LAYOUT_CONSTANTS.RACK_X_OFFSET);
        const baseY = Math.max(300, maxShelfHeight + LAYOUT_CONSTANTS.RACK_Y_OFFSET);

        // Stacked hall/aisle layout constants
        const hallSpacing = 1200; // Vertical spacing between halls
        const aisleOffsetX = 400; // Horizontal offset for each aisle (diagonal stack)
        const aisleOffsetY = 400; // Vertical offset for each aisle (diagonal stack)

        // First pass: calculate all new positions and deltas BEFORE making any changes
        const positionUpdates = [];

        let hallIndex = 0;
        Object.keys(rackHierarchy).sort().forEach(hall => {
            const hallStartY = baseY + (hallIndex * hallSpacing);

            let aisleIndex = 0;
            Object.keys(rackHierarchy[hall]).sort().forEach(aisle => {
                // Square offset: each aisle is offset diagonally from the previous one
                const aisleStartX = baseX + (aisleIndex * aisleOffsetX);
                const aisleStartY = hallStartY + (aisleIndex * aisleOffsetY);

                let rackX = aisleStartX;
                rackHierarchy[hall][aisle].forEach((rackData) => {
                    const rack = rackData.node;

                    // Calculate rack position (horizontal sequence within aisle)
                    positionUpdates.push({
                        node: rack,
                        newPos: { x: rackX, y: aisleStartY }
                    });

                    // Update rack label to show hall/aisle
                    rack.data('label', `Rack ${rackData.rack_num} (${hall}-${aisle})`);

                    // Get all shelves in this rack and sort by shelf_u (descending - higher U at top)
                    const shelves = rack.children('[type="shelf"]');
                    const sortedShelves = [];
                    shelves.forEach((shelf) => {
                        sortedShelves.push({
                            node: shelf,
                            shelf_u: parseInt(shelf.data('shelf_u')) || 0,
                            oldPos: { x: shelf.position().x, y: shelf.position().y }
                        });
                    });
                    sortedShelves.sort((a, b) => {
                        return b.shelf_u - a.shelf_u; // Descending: higher shelf_u at top
                    });

                    // Calculate vertical positions for shelves (centered in rack)
                    const numShelves = sortedShelves.length;
                    if (numShelves > 0) {
                        const totalShelfHeight = (numShelves - 1) * shelfSpacing;
                        const shelfStartY = aisleStartY - (totalShelfHeight / 2);

                        // Calculate position for each shelf
                        sortedShelves.forEach((shelfData, shelfIndex) => {
                            const shelf = shelfData.node;
                            const newShelfX = rackX;
                            const newShelfY = shelfStartY + (shelfIndex * shelfSpacing);

                            // Store shelf position update
                            positionUpdates.push({
                                node: shelf,
                                newPos: { x: newShelfX, y: newShelfY },
                                needsChildArrangement: true // Flag to trigger tray/port arrangement
                            });
                        });
                    }

                    // Move to next rack position
                    rackX += rackWidth + rackSpacing;
                });

                aisleIndex++;
            });

            hallIndex++;
        });

        // Second pass: apply all position updates in a batch
        this.state.cy.startBatch();
        positionUpdates.forEach((update) => {
            update.node.position(update.newPos);

            // If this is a shelf that needs child arrangement, apply tray/port layout
            if (update.needsChildArrangement) {
                this.commonModule.arrangeTraysAndPorts(update.node);
            }
        });
        this.state.cy.endBatch();

        // Force a complete refresh of the cytoscape instance
        this.state.cy.resize();
        this.state.cy.forceRender();

        // Small delay to ensure rendering is complete before fitting viewport and reapplying styles
        setTimeout(() => {
            // Apply fcose layout to prevent overlaps in location mode
            const locationNodes = this.state.cy.nodes('[type="hall"], [type="aisle"], [type="rack"]');
            if (locationNodes.length > 0) {
                try {
                    const layout = this.state.cy.layout({
                        name: 'fcose',
                        eles: locationNodes,
                        quality: 'default',
                        randomize: false,  // Use calculated positions as starting point
                        animate: true,  // Animate for smooth transition when resetting layout
                        animationDuration: 500,
                        fit: false,
                        nodeDimensionsIncludeLabels: true,
                        nodeRepulsion: 4000,  // Slightly lower than hierarchy mode for tighter location-based layout
                        idealEdgeLength: 150,
                        nestingFactor: 0.15,  // Respect parent-child relationships (hall > aisle > rack)
                        gravity: 0.1,  // Lower gravity to maintain manual layout structure
                        numIter: 300,  // Fewer iterations since we're fine-tuning, not starting from scratch
                        stop: () => {
                            // Re-arrange trays/ports after fcose moves shelves
                            // This ensures tray/port positions are correct relative to new shelf positions
                            this.state.cy.nodes('[type="shelf"]').forEach(shelf => {
                                this.commonModule.arrangeTraysAndPorts(shelf);
                            });
                            this.commonModule.applyDragRestrictions();
                            this.commonModule.forceApplyCurveStyles();
                            window.updatePortConnectionStatus?.();

                            // Fit the view to show all nodes with padding
                            this.state.cy.fit(50);
                            this.state.cy.center();
                            this.state.cy.forceRender();

                            // Show success message
                            this.showExportStatus('Layout reset successfully! All nodes repositioned based on hierarchy.', 'success');
                        }
                    });
                    if (layout) {
                        layout.run();
                        return;  // Exit early, stop callback will handle the rest
                    }
                } catch (e) {
                    console.warn('Error applying fcose layout in location mode:', e.message);
                }
            }

            // Fallback if fcose not available or no location nodes
            // Reapply edge curve styles after repositioning
            this.commonModule.forceApplyCurveStyles();

            // Update port connection status visual indicators
            window.updatePortConnectionStatus?.();

            // Fit the view to show all nodes with padding
            this.state.cy.fit(50);
            this.state.cy.center();

            // Force another render to ensure everything is updated
            this.state.cy.forceRender();

            // Show success message
            this.showExportStatus('Layout reset successfully! All nodes repositioned based on hierarchy.', 'success');
        }, 100);
    }

    /**
     * Toggle between hierarchy and location visualization modes
     * Orchestrates mode switching, calls module switchMode() functions
     */
    toggleVisualizationMode() {
        if (!this.state.cy) {
            alert('No visualization loaded. Please upload a file first.');
            return;
        }

        // Toggle the mode
        const newMode = this.state.mode === 'hierarchy' ? 'location' : 'hierarchy';

        // Restructure the visualization based on the new mode
        if (newMode === 'location') {
            // Check if we need to show the physical layout specification modal
            // This happens on first switch to location mode when nodes don't have physical locations
            const shelfNodes = this.state.cy.nodes('[type="shelf"]');

            // Check if ANY node has physical location data
            const hasPhysicalLocations = shelfNodes.length > 0 && shelfNodes.some(node => {
                const data = node.data();
                return data.hall || data.aisle || (data.rack_num !== undefined && data.rack_num !== null);
            });

            // Check if this is the first time switching
            const physicalLayoutAssigned = sessionStorage.getItem('physicalLayoutAssigned') === 'true';

            // Show modal if nodes don't have physical locations (ignore session flag for now)
            console.log('Checking physical locations:', {
                shelfNodesCount: shelfNodes.length,
                hasPhysicalLocations: hasPhysicalLocations,
                physicalLayoutAssigned: physicalLayoutAssigned
            });

            if (shelfNodes.length > 0 && !hasPhysicalLocations) {
                console.log('No physical locations found, showing modal');
                // DON'T set the mode yet - wait for user to apply or cancel
                this.showPhysicalLayoutModal();
                return; // Don't proceed with switch - will be done after modal is applied
            } else {
                console.log('Skipping modal - physical locations exist or no nodes');
            }

            // Set the new mode only if we're not showing the modal
            window.setVisualizationMode?.(newMode);

            // Update the connection legend based on the new mode if we have initial data
            if (this.state.data.initialVisualizationData) {
                this.updateConnectionLegend(this.state.data.initialVisualizationData);
            }

            // Switching to location mode: remove hierarchical containers and reorganize by location
            this.locationModule.switchMode();

            // Ensure currentData exists for button state (preserve it if it exists, or create minimal structure)
            if (!this.state.data.currentData && this.state.cy) {
                this.state.data.currentData = {
                    elements: this.state.cy.elements().jsons(),
                    metadata: this.state.data.hierarchyModeState?.metadata || {}
                };
            }

            // Update Add Node button state after mode switch
            this.updateAddNodeButtonState();

            // Update node filter dropdown to reflect location mode labels
            window.populateNodeFilterDropdown?.();
            // Template filter is hierarchy mode only, so don't populate in location mode
        } else {
            // Set the new mode
            window.setVisualizationMode?.(newMode);

            // Update the connection legend based on the new mode if we have initial data
            if (this.state.data.initialVisualizationData) {
                this.updateConnectionLegend(this.state.data.initialVisualizationData);
            }

            // Switching to hierarchy mode: restore original hierarchical structure
            this.hierarchyModule.switchMode();

            // Ensure currentData exists for button state
            if (!this.state.data.currentData && this.state.cy) {
                this.state.data.currentData = {
                    elements: this.state.cy.elements().jsons(),
                    metadata: this.state.data.hierarchyModeState?.metadata || {}
                };
            }

            // Update Add Node button state after mode switch
            this.updateAddNodeButtonState();

            // Update node filter dropdown to reflect hierarchy mode labels
            window.populateNodeFilterDropdown?.();
            // Update template filter dropdown (hierarchy mode only)
            window.populateTemplateFilterDropdown?.();
        }

        // Show a status message
        const modeLabel = newMode === 'hierarchy' ? 'Logical Topology View' : 'Physical Location View';
        this.showExportStatus(`Switched to ${modeLabel}`, 'success');

        setTimeout(() => {
            const statusDiv = document.getElementById('rangeStatus');
            if (statusDiv) {
                statusDiv.textContent = '';
            }
        }, 2000);
    }

    /**
     * Toggle edge handles (connection editing mode)
     * Enables/disables connection creation and editing functionality
     */
    toggleEdgeHandles() {
        const btn = document.getElementById('toggleEdgeHandlesBtn');

        if (!this.state.cy) {
            const message = 'Please load a visualization first before enabling editing mode.';
            console.error('[toggleEdgeHandles]', message);
            this.notificationManager?.warning(message);
            return;
        }

        if (btn.textContent.includes('Enable')) {
            // Enable connection creation mode
            // Clear all selections (including Cytoscape selections) when entering edit mode
            window.clearAllSelections?.();
            this.state.enableEditMode();
            this.state.editing.isEdgeCreationMode = true;
            btn.textContent = '🔗 Disable Connection Editing';
            btn.style.backgroundColor = '#dc3545';

            // Show delete element section (combined connection and node deletion)
            document.getElementById('deleteElementSection').style.display = 'block';

            // Show add node section
            document.getElementById('addNodeSection').style.display = 'block';

            // Show add graph section only in hierarchy mode
            const addGraphSection = document.getElementById('addGraphSection');
            if (addGraphSection && this.state.mode === 'hierarchy') {
                addGraphSection.style.display = 'block';
            } else if (addGraphSection) {
                addGraphSection.style.display = 'none';
            }

            // Add visual feedback only for available (unconnected) ports
            window.updatePortEditingHighlight?.();

            // Show instruction
            alert('Connection editing enabled!\n\n• Click unconnected port → Click another port = Create connection\n• Click connection to select it, then use Delete button or Backspace/Delete key\n• Click deletable nodes (shelf/rack/graph) to select for deletion\n• Click empty space = Cancel selection\n\nNote: Only unconnected ports are highlighted in orange');

        } else {
            // Disable connection creation mode
            // Clear all selections (including Cytoscape selections) when exiting edit mode
            window.clearAllSelections?.();
            this.state.disableEditMode();
            this.state.editing.isEdgeCreationMode = false;

            // Clear source port selection and remove styling
            if (this.state.editing.selectedFirstPort) {
                this.state.editing.selectedFirstPort.removeClass('source-selected');
            }
            this.state.editing.selectedFirstPort = null;

            btn.textContent = '🔗 Enable Connection Editing';
            btn.style.backgroundColor = '#28a745';

            // Hide delete element section
            document.getElementById('deleteElementSection').style.display = 'none';

            // Hide add node section
            document.getElementById('addNodeSection').style.display = 'none';

            // Hide add graph section
            document.getElementById('addGraphSection').style.display = 'none';

            // Clear any selected connection and remove its styling
            if (this.state.editing.selectedConnection) {
                this.state.editing.selectedConnection.removeClass('selected-connection');
            }
            this.state.editing.selectedConnection = null;

            // Clear any selected node and remove its styling
            if (this.state.editing.selectedNode) {
                this.state.editing.selectedNode.removeClass('selected-node');
            }
            this.state.editing.selectedNode = null;

            // Update delete button state
            window.updateDeleteButtonState?.();

            // Remove visual feedback from all ports
            this.state.cy.nodes('.port').style({
                'border-width': '2px',
                'border-color': '#666666',
                'border-opacity': 1.0
            });

            // Remove any source port highlighting (redundant but safe)
            this.state.cy.nodes('.port').removeClass('source-selected');

            // Remove selected-connection class from all edges
            this.state.cy.edges().removeClass('selected-connection');

            // Remove selected-node class from all nodes
            this.state.cy.nodes().removeClass('selected-node');
        }
    }
}

