/**
 * UI Display Module - Handles all UI display and initialization functions
 * Extracted from visualizer.js to centralize UI logic
 */
import { LAYOUT_CONSTANTS, CONNECTION_COLORS } from '../config/constants.js';
import { verifyCytoscapeExtensions as verifyCytoscapeExtensionsUtil } from '../utils/cytoscape-utils.js';
import { getShelfLayoutDimensions, getShelfUHeight } from '../config/node-types.js';

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
     * @param {string} [fullMessage] - Full message when user clicks (e.g. long or multi-line)
     */
    showExportStatus(message, type, fullMessage = null) {
        this.notificationManager.show(message, type, fullMessage);
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

        // Hide the indicator completely if session started in location mode
        if (this.state.data.initialMode === 'location') {
            indicator.style.display = 'none';
            return;
        }

        // Show the indicator
        indicator.style.display = 'block';

        // Get connection filter elements
        // Connection type filters are location mode only, node filter is available in both modes
        const sameHostIdCheckbox = document.getElementById('showSameHostIdConnections');
        const connectionTypesSection = sameHostIdCheckbox ? sameHostIdCheckbox.closest('div[style*="margin-bottom"]') : null;

        if (this.state.mode === 'hierarchy') {
            indicator.style.background = '#fff3cd';
            indicator.style.borderColor = '#ffc107';
            currentModeDiv.innerHTML = '<strong>🌳 Logical Hierarchy View</strong>';
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
            // Show CSV/physical legend with hierarchy-based coloring, hide descriptor/hierarchy legend
            csvLegend.style.display = 'block';
            descriptorLegend.style.display = 'none';

            // Generate legend HTML for location mode with hierarchy levels
            let legendHTML = '<div style="font-size: 12px; font-weight: bold; color: #555; margin-bottom: 6px;">Racking Hierarchy:</div>';

            // Add legend entries for each hierarchy level
            const hierarchyLevels = [
                { level: 'same_host_id', label: 'Same host', color: CONNECTION_COLORS.SAME_HOST_ID },
                { level: 'same_rack', label: 'Same rack (different host)', color: CONNECTION_COLORS.SAME_RACK },
                { level: 'same_aisle', label: 'Same aisle (different rack)', color: CONNECTION_COLORS.SAME_AISLE },
                { level: 'same_hall', label: 'Same hall (different aisle)', color: CONNECTION_COLORS.SAME_HALL },
                { level: 'different_hall', label: 'Different halls', color: CONNECTION_COLORS.DIFFERENT_HALL }
            ];

            hierarchyLevels.forEach(({ level: _level, label, color }) => {
                legendHTML += `
                    <div style="display: flex; align-items: center; margin: 6px 0;">
                        <div style="width: 20px; height: 3px; background-color: ${color}; margin-right: 10px; border-radius: 2px;"></div>
                        <span style="font-size: 13px; color: #333;">${label}</span>
                    </div>
                `;
            });

            csvLegend.innerHTML = legendHTML;
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
            isDeletable = ['shelf', 'rack', 'graph', 'hall', 'aisle'].includes(nodeType);
        }

        // Check if any multi-selected nodes are deletable
        if (selectedNodes.length > 0) {
            isDeletable = isDeletable || selectedNodes.some(node => {
                const nodeType = node.data('type');
                return ['shelf', 'rack', 'graph', 'hall', 'aisle'].includes(nodeType);
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
     * Parse shelf U input for paste destination only: range or list, no capacity.
     * A single number is returned as [n] (one position), not expanded to 1..n.
     * @param {string} input - Input text
     * @returns {Array<number>} Array of shelf U numbers
     */
    parseFlexibleInputShelfUPasteOnly(input) {
        if (!input) return [];
        input = input.trim();
        if (!input) return [];
        const rangeResult = this.parseRange(input);
        if (rangeResult && rangeResult.length > 0) return rangeResult.map(x => (typeof x === 'number' ? x : parseInt(x, 10) || 1));
        const items = this.parseList(input);
        const allNumeric = items.every(item => !isNaN(parseInt(item)));
        if (allNumeric && items.length > 0) return items.map(item => parseInt(item) || 1);
        return items.length > 0 ? items.map(item => (typeof item === 'number' ? item : parseInt(item, 10) || 1)) : [];
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

        this._physicalLayoutModalMode = null;
        this._resetPhysicalLayoutModalToDefault();
        modal.removeEventListener('click', this._handlePasteDestinationModalClick);

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
        hallNamesInput.value = 'DataHall';
        aisleNamesInput.value = 'A';
        rackNumbersInput.value = '1-10';
        shelfUnitNumbersInput.value = '24,18,12,6';

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
     * Show paste destination modal (location mode only). Hierarchy mode pastes directly into
     * the selected graph instance (or at root) with no modal.
     */
    showPasteDestinationModal() {
        const modal = document.getElementById('physicalLayoutModal');
        if (!modal) return;

        const dest = this.locationModule.getPasteDestinationFromSelection();
        this._pasteDestinationContext = dest || { type: 'canvas', label: 'Canvas (no destination selected)' };
        this._physicalLayoutModalMode = 'pasteDestination';

        const header = document.getElementById('physicalLayoutModalHeader');
        const subheader = document.getElementById('physicalLayoutModalSubheader');
        const tabs = document.getElementById('physicalLayoutModalTabs');
        const capacityRow = document.getElementById('physicalLayoutCapacityRow');
        const applyBtn = document.getElementById('applyLayoutBtn');
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? 'block' : 'none';
        };

        if (header) header.textContent = 'Paste destination';
        if (subheader) subheader.textContent = 'Paste destination: ' + this._pasteDestinationContext.label + '. Enter location attributes below. Shelf U: use a range or list (e.g. 1-4 or 24,18,12,6); one position per pasted shelf.';
        if (tabs) tabs.style.display = 'none';
        if (capacityRow) capacityRow.style.display = 'none';
        if (applyBtn) applyBtn.textContent = 'Paste';
        show('physicalLayoutHierarchyPasteGroup', false);

        const clipboard = this.state.clipboard;
        const copyLevel = (clipboard && clipboard.copyLevel) ? clipboard.copyLevel : 'shelf';
        const type = this._pasteDestinationContext.type;
        const showHall = type === 'canvas' && (copyLevel === 'hall' || copyLevel === 'aisle' || copyLevel === 'rack' || copyLevel === 'shelf');
        const showAisle = (type === 'canvas' || type === 'hall') && (copyLevel === 'hall' || copyLevel === 'aisle' || copyLevel === 'rack');
        const showRack = (type === 'canvas' || type === 'hall' || type === 'aisle') && (copyLevel === 'hall' || copyLevel === 'aisle' || copyLevel === 'rack');
        const showShelfUs = (type === 'canvas' || type === 'hall' || type === 'aisle' || type === 'rack' || type === 'shelf') && copyLevel === 'shelf';
        show('physicalLayoutHallGroup', showHall);
        show('physicalLayoutAisleGroup', showAisle);
        show('physicalLayoutRackGroup', showRack);
        show('physicalLayoutShelfUsGroup', showShelfUs);

        const hallInput = document.getElementById('hallNames');
        const aisleInput = document.getElementById('aisleNames');
        const rackInput = document.getElementById('rackNumbers');
        const shelfInput = document.getElementById('shelfUnitNumbers');
        const ctx = this._pasteDestinationContext;
        if (hallInput) {
            if (showHall) hallInput.value = ctx.hall != null ? ctx.hall : '';
            else hallInput.value = ctx.hall != null ? ctx.hall : (clipboard && clipboard.copyHall != null ? clipboard.copyHall : '');
        }
        if (aisleInput) {
            if (showAisle) aisleInput.value = ctx.aisle != null ? ctx.aisle : '';
            else aisleInput.value = ctx.aisle != null ? ctx.aisle : (clipboard && clipboard.copyAisle != null ? clipboard.copyAisle : '');
        }
        if (rackInput) {
            if (showRack) rackInput.value = ctx.rack_num != null ? String(ctx.rack_num) : '1';
            else rackInput.value = ctx.rack_num != null ? String(ctx.rack_num) : (clipboard && clipboard.copyRackNum != null ? String(clipboard.copyRackNum) : '1');
        }
        const shelfCount = clipboard && clipboard.shelves ? clipboard.shelves.length : 1;
        if (shelfInput) {
            if (showShelfUs) shelfInput.value = shelfCount > 1 ? '1-' + shelfCount : '1';
            else shelfInput.value = clipboard && clipboard.shelves && clipboard.shelves.length > 0
                ? clipboard.shelves.map(s => s.shelf_u != null ? s.shelf_u : 1).join(',')
                : '1';
        }

        const manualContent = document.getElementById('manualLayoutContent');
        if (manualContent) manualContent.style.display = 'block';
        const uploadContent = document.getElementById('uploadLayoutContent');
        if (uploadContent) uploadContent.style.display = 'none';

        modal.classList.add('active');
        modal.removeEventListener('click', this._handlePasteDestinationModalClick);
        this._handlePasteDestinationModalClick = (e) => {
            if (e.target.id === 'physicalLayoutModal') this.cancelPasteDestinationModal();
        };
        modal.addEventListener('click', this._handlePasteDestinationModalClick);
    }

    /**
     * Parse paste destination inputs (from paste modal) into { hall, aisle, rack_num, rack_numbers, shelf_u_list }.
     * Anything at or above the ceiling (paste target) is taken from _pasteDestinationContext; only levels below
     * the ceiling are read from inputs. rack_numbers is the full list when user enters multiple racks (e.g. "1,2").
     */
    _parsePasteDestinationInputs() {
        const ctx = this._pasteDestinationContext || { type: 'canvas' };
        const parseOneText = (id) => {
            const el = document.getElementById(id);
            if (!el) return '';
            const raw = this.parseFlexibleInput((el.value || '').trim());
            return raw.length > 0 ? String(raw[0]) : '';
        };
        const parseOneNumber = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const raw = this.parseFlexibleInput((el.value || '').trim());
            if (raw.length === 0) return null;
            const first = raw[0];
            return typeof first === 'number' ? first : parseInt(first, 10) || null;
        };
        const parseRackNumbersList = () => {
            const el = document.getElementById('rackNumbers');
            if (!el) return [];
            const raw = this.parseFlexibleInput((el.value || '').trim());
            return raw.map(x => (typeof x === 'number' ? x : parseInt(x, 10) || 1));
        };
        const parseShelfUList = () => {
            const el = document.getElementById('shelfUnitNumbers');
            if (!el) return [];
            const input = (el.value || '').trim();
            if (!input) return [];
            const raw = this.parseFlexibleInputShelfUPasteOnly(input);
            return raw.map(x => (typeof x === 'number' ? x : parseInt(x, 10) || 1));
        };

        let hall, aisle, rackNum;
        let rackNumbersList;
        if (ctx.type === 'canvas' || ctx.type === 'hall') {
            hall = ctx.type === 'canvas' ? parseOneText('hallNames') : (ctx.hall != null ? ctx.hall : '');
            aisle = parseOneText('aisleNames');
            rackNum = parseOneNumber('rackNumbers');
            rackNumbersList = parseRackNumbersList();
        } else if (ctx.type === 'aisle') {
            hall = ctx.hall != null ? ctx.hall : '';
            aisle = ctx.aisle != null ? ctx.aisle : '';
            rackNum = parseOneNumber('rackNumbers');
            rackNumbersList = parseRackNumbersList();
        } else {
            hall = ctx.hall != null ? ctx.hall : '';
            aisle = ctx.aisle != null ? ctx.aisle : '';
            rackNum = ctx.rack_num != null ? ctx.rack_num : parseOneNumber('rackNumbers');
            rackNumbersList = (ctx.rack_num != null ? [ctx.rack_num] : parseRackNumbersList());
        }
        const shelfUList = parseShelfUList();
        return {
            hall,
            aisle,
            rack_num: rackNum != null ? rackNum : 1,
            rack_numbers: rackNumbersList.length > 0 ? rackNumbersList : [1],
            shelf_u_list: shelfUList
        };
    }

    /**
     * Build per-shelf (rack_num, shelf_u) assignments using the same for-loop order as Apply physical layout:
     * outer loop rack numbers, inner loop shelf U (rack × shelf_u). Ensures at least count slots by expanding
     * shelf_u_list if needed (incrementing by each shelf's shelf_u_height when extending). Takes first count slots.
     * @param {Array<number>} rackNumbers
     * @param {Array<number>} shelfUList
     * @param {number} count
     * @param {Array<{ shelf_node_type?: string }>} [shelves] - Optional list of pasted shelf nodes; used to get shelf_u_height per slot when extending list.
     */
    _buildPasteShelfAssignments(rackNumbers, shelfUList, count, shelves = null) {
        if (count <= 0 || !rackNumbers.length) return [];
        const racks = rackNumbers;
        const minShelfULength = Math.ceil(count / racks.length);
        const shelfU = this._normalizePasteShelfUList(shelfUList, minShelfULength, shelves);
        const slots = [];
        for (let r = 0; r < racks.length; r++) {
            for (let u = 0; u < shelfU.length; u++) {
                slots.push({ rack_num: racks[r], shelf_u: shelfU[u] });
            }
        }
        return slots.slice(0, count);
    }

    /**
     * Expand or trim shelf_u_list to exactly count values so paste has one position per shelf.
     * When extending, increments by each shelf's shelf_u_height (node occupies shelf_u .. shelf_u + height - 1; next starts at shelf_u + height).
     * - Empty: use [1, 1+h0, 1+h0+h1, ...] if shelves/heights provided, else [1, 2, ..., count].
     * - Single number: treat as starting U, use [start, start+h0, start+h0+h1, ...] or [start, start+1, ...] if no heights.
     * - Short list: extend using heights when available, else max+1, max+2, ...
     * @param {Array<number>} shelfUList
     * @param {number} count
     * @param {Array<{ shelf_node_type?: string }>} [shelves] - Optional; used to get getShelfUHeight(shelf_node_type) for each index when extending.
     */
    _normalizePasteShelfUList(shelfUList, count, shelves = null) {
        if (count <= 0) return [];
        if (shelfUList.length >= count) {
            return shelfUList.slice(0, count);
        }
        const heights = shelves && shelves.length >= count
            ? shelves.slice(0, count).map((sh) => getShelfUHeight(sh.shelf_node_type || 'WH_GALAXY'))
            : null;
        if (shelfUList.length === 0) {
            const out = [];
            let u = 1;
            for (let i = 0; i < count; i++) {
                out.push(u);
                u += (heights && heights[i] != null) ? heights[i] : 1;
            }
            return out;
        }
        if (shelfUList.length === 1) {
            const start = shelfUList[0];
            const out = [];
            let next = start;
            for (let i = 0; i < count; i++) {
                out.push(next);
                next += (heights && heights[i] != null) ? heights[i] : 1;
            }
            return out;
        }
        const out = shelfUList.slice();
        let next = Math.max.apply(null, out);
        let idx = out.length;
        while (out.length < count) {
            const h = (heights && heights[idx - 1] != null) ? heights[idx - 1] : 1;
            next += h;
            out.push(next);
            idx++;
        }
        return out;
    }

    /**
     * Apply paste destination (Paste button in paste modal). Location mode only; hierarchy
     * mode pastes directly into the selected graph instance with no modal.
     */
    applyPasteDestination() {
        const clipboard = this.state.clipboard;
        if (!clipboard) {
            this.showExportStatus('Nothing to paste.', 'warning');
            return;
        }

        const destination = this._parsePasteDestinationInputs();
        const count = clipboard && clipboard.shelves ? clipboard.shelves.length : 0;
        if (count === 0) {
            this.showExportStatus('Nothing to paste.', 'warning');
            return;
        }
        const copyLevel = (clipboard && clipboard.copyLevel) ? clipboard.copyLevel : 'shelf';
        if (copyLevel === 'hall' || copyLevel === 'aisle') {
            destination.shelf_assignments = clipboard.shelves.map(s => ({
                rack_num: s.rack_num != null ? s.rack_num : 1,
                shelf_u: s.shelf_u != null ? s.shelf_u : 1
            }));
        } else if (copyLevel === 'rack') {
            const shelfUFromClipboard = clipboard.shelves.map(s => (s.shelf_u != null ? s.shelf_u : 1));
            destination.shelf_assignments = this._buildPasteShelfAssignments(destination.rack_numbers, shelfUFromClipboard, count, clipboard.shelves);
        } else {
            destination.shelf_assignments = this._buildPasteShelfAssignments(destination.rack_numbers, destination.shelf_u_list, count, clipboard.shelves);
        }
        const result = this.locationModule.pasteFromClipboard(destination);
        this.cancelPasteDestinationModal();
        if (result.success) {
            this.showExportStatus(result.message, 'success');
            window.updateDeleteButtonState?.();
        } else if (result.message) {
            this.showExportStatus(result.message, 'warning');
        }
    }

    /**
     * Reset physical layout modal to default (hide hierarchy paste group, show location groups).
     */
    _resetPhysicalLayoutModalToDefault() {
        const hierarchyGroup = document.getElementById('physicalLayoutHierarchyPasteGroup');
        if (hierarchyGroup) hierarchyGroup.style.display = 'none';
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? 'block' : 'none';
        };
        show('physicalLayoutHallGroup', true);
        show('physicalLayoutAisleGroup', true);
        show('physicalLayoutRackGroup', true);
        show('physicalLayoutShelfUsGroup', true);
        const header = document.getElementById('physicalLayoutModalHeader');
        const subheader = document.getElementById('physicalLayoutModalSubheader');
        if (header) header.textContent = '📍 Specify Physical Layout';
        if (subheader) subheader.textContent = 'Choose how to assign physical locations to all nodes: upload a deployment descriptor or define ranges manually.';
    }

    /**
     * Cancel paste destination modal (close without pasting).
     */
    cancelPasteDestinationModal() {
        const modal = document.getElementById('physicalLayoutModal');
        if (modal) {
            modal.classList.remove('active');
            modal.removeEventListener('click', this._handlePasteDestinationModalClick);
        }
        this._pasteDestinationContext = null;
        this._resetPhysicalLayoutModalToDefault();
    }

    /**
     * Cancel physical layout modal (close without applying)
     * Stay in hierarchy mode - don't switch to physical layout
     */
    cancelPhysicalLayoutModal() {
        if (this._physicalLayoutModalMode === 'pasteDestination') {
            this.cancelPasteDestinationModal();
            return;
        }
        console.log('cancelPhysicalLayoutModal called - staying in hierarchy mode');
        const modal = document.getElementById('physicalLayoutModal');
        if (modal) {
            modal.classList.remove('active');
            modal.removeEventListener('click', (e) => this.handlePhysicalLayoutModalClick(e));
        }
        this._resetPhysicalLayoutModalToDefault();

        const currentMode = this.state.mode;
        if (currentMode !== 'hierarchy') {
            window.setVisualizationMode?.('hierarchy');
            this.updateModeIndicator();
        }
        this.showExportStatus('Physical layout configuration cancelled', 'info');
    }

    /**
     * Apply button action for the shared physical layout modal. Dispatches to paste or physical layout based on mode.
     */
    applyPhysicalLayoutModalAction() {
        if (this._physicalLayoutModalMode === 'pasteDestination') {
            this.applyPasteDestination();
        } else {
            this.applyPhysicalLayout();
        }
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

        // Assign physical locations using nested loops.
        // Occupancy rule: a node with shelf_u and node_height (shelf_u_height) occupies U positions
        // shelf_u through shelf_u + node_height - 1 (inclusive). The next node starts at shelf_u + node_height.
        let nodeIndex = 0;
        let assignedCount = 0;

        outerLoop:
        for (let h = 0; h < hallNames.length; h++) {
            const hall = hallNames[h];

            for (let a = 0; a < aisleNames.length; a++) {
                const aisle = aisleNames[a];

                for (let r = 0; r < rackNumbers.length; r++) {
                    const rackNum = rackNumbers[r];
                    // Starting U for this rack: use first value or cycle by rack index
                    const startU = shelfUnitNumbers[r % shelfUnitNumbers.length];
                    let currentShelfU = startU;

                    for (let s = 0; s < shelfUnitNumbers.length; s++) {
                        if (nodeIndex >= shelfNodes.length) {
                            break outerLoop;
                        }

                        const node = shelfNodes[nodeIndex];
                        const nodeType = node.data('shelf_node_type') || 'WH_GALAXY';
                        const nodeHeight = getShelfUHeight(nodeType);
                        const shelfU = currentShelfU; // node occupies U shelf_u .. shelf_u + nodeHeight - 1

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

                        // Update label to use location mode format: "Shelf {shelf_u} ({host_index}: hostname)"
                        const currentHostIndex = node.data('host_index') ?? node.data('host_id');
                        const currentHostname = node.data('hostname');
                        const nodeShelfU = node.data('shelf_u');

                        if (nodeShelfU !== undefined && nodeShelfU !== null && nodeShelfU !== '') {
                            if (currentHostIndex !== undefined && currentHostIndex !== null) {
                                if (currentHostname) {
                                    node.data('label', `Shelf ${nodeShelfU} (${currentHostIndex}: ${currentHostname})`);
                                } else {
                                    node.data('label', `Shelf ${nodeShelfU} (${currentHostIndex})`);
                                }
                            } else if (currentHostname) {
                                node.data('label', `Shelf ${nodeShelfU} (${currentHostname})`);
                            } else {
                                node.data('label', `Shelf ${nodeShelfU}`);
                            }
                        }

                        currentShelfU += nodeHeight; // next node starts at first free U
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

        // Track initial mode - empty canvas preserves current mode
        const currentMode = this.state.mode;
        this.state.data.initialMode = currentMode;
        this.state.data.hierarchyStructureChanged = false;
        this.state.data.deploymentDescriptorApplied = false;

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

        // Base rule: one connection per port (reject load if data violates it)
        if (data?.elements?.length && typeof window.validateOneConnectionPerPort === 'function') {
            const validation = window.validateOneConnectionPerPort(data.elements);
            if (!validation.valid) {
                const msg = validation.errors.length === 1
                    ? validation.errors[0]
                    : `${validation.errors.length} port(s) have more than one connection. Only one connection per port is allowed.`;
                window.showExportStatus?.(msg, 'error');
                return;
            }
        }

        // Hide container until initialization is complete
        cyContainer.style.visibility = 'hidden';
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
                // Track initial mode BEFORE calling setVisualizationMode (which calls updateModeIndicator)
                this.state.data.initialMode = 'hierarchy';
                this.state.data.hierarchyStructureChanged = false;
                this.state.data.deploymentDescriptorApplied = false;
                window.setVisualizationMode?.('hierarchy');
                console.log('Detected hierarchy mode (descriptor/textproto import) - node creation blocked in location mode');
            } else {
                // Track initial mode BEFORE calling setVisualizationMode (which calls updateModeIndicator)
                this.state.data.initialMode = 'location';
                this.state.data.hierarchyStructureChanged = false;
                this.state.data.deploymentDescriptorApplied = false;
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
            // Track initial mode for empty canvas
            this.state.data.initialMode = currentMode;
            this.state.data.hierarchyStructureChanged = false;
            this.state.data.deploymentDescriptorApplied = false;
            console.log(`Empty canvas - preserving current mode: ${currentMode} (initialMode set to ${currentMode})`);
        }

        // Ensure container has proper dimensions
        if (cyContainer.offsetWidth === 0 || cyContainer.offsetHeight === 0) {
            console.warn('Container has zero dimensions, setting explicit size');
            cyContainer.style.width = '100%';
            cyContainer.style.height = '600px';
        }

        try {
            if (this.state.cy) {
                // Hide container during reinitialization
                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    cyContainer.style.visibility = 'hidden';
                }

                // Clear existing elements and add new ones (batched for performance)
                console.log('Clearing existing elements and adding new ones');
                this.state.cy.startBatch();
                this.state.cy.elements().remove();
                this.state.cy.add(data.elements);
                this.commonModule.normalizePortLabels();
                this.state.cy.endBatch();

                // In location mode, ensure shelves with racking data are in hall/aisle/rack compound nodes
                if (this.state.mode === 'location') {
                    const existingRacks = this.state.cy.nodes('[type="rack"]');
                    const shelfNodes = this.state.cy.nodes('[type="shelf"]');
                    const shelvesWithLocation = shelfNodes.filter(shelf => {
                        const d = shelf.data();
                        return d.hall || d.aisle || (d.rack_num !== undefined && d.rack_num !== null);
                    });
                    const shelfUnderRack = (shelf) => {
                        let node = shelf;
                        while (node.length) {
                            const parent = node.parent();
                            if (parent.length === 0) break;
                            if (parent.data('type') === 'rack') return true;
                            node = parent;
                        }
                        return false;
                    };
                    const needRebuild = shelvesWithLocation.length > 0 && (existingRacks.length === 0 || shelvesWithLocation.some(s => !shelfUnderRack(s)));
                    if (needRebuild) {
                        this.locationModule.rebuildLocationViewFromCurrentGraph();
                    } else if (existingRacks.length > 0) {
                        this.locationModule.calculateLayout();
                    }
                }

                // Apply drag restrictions
                this.commonModule.applyDragRestrictions();

                this.state.cy.layout({ name: 'preset' }).run();

                // Ensure event handlers are registered even when reusing existing instance
                // Use a small delay to ensure layout is complete and elements are rendered
                setTimeout(() => {
                    this.commonModule.addCytoscapeEventHandlers();
                    // Apply curve styles after layout is complete
                    this.commonModule.forceApplyCurveStyles();

                    // Show container after initialization completes
                    if (cyContainer) {
                        cyContainer.style.visibility = 'visible';
                        cyContainer.style.opacity = '1';
                        cyContainer.style.display = 'block';
                    }
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

                    // DFS recalculation ensures unique, consecutive host_index values in both modes
                    // For textproto imports: host_index is already set from host_id, but we still run DFS to ensure uniqueness
                    // For non-textproto imports (empty canvas, CSV): DFS ensures proper numbering
                    const isTextprotoImport = isDescriptor || (data.metadata && data.metadata.file_format === 'descriptor');

                    if (!isTextprotoImport) {
                        // For non-textproto imports, run DFS to ensure unique, consecutive host_index values
                        this.hierarchyModule.recalculateHostIndicesForTemplates();
                    } else {
                        // For textproto imports, host_index comes from host_id, but we still run DFS to ensure uniqueness
                        // This handles cases where host_id might have duplicates or gaps
                        this.hierarchyModule.recalculateHostIndicesForTemplates();
                    }
                } else {
                    // Location mode: ensure shelves with racking info (hall/aisle/rack_num) are inside hall/aisle/rack compound nodes.
                    // Rebuild from shelf data when there are no racks, or when any shelf with location is not under a rack.
                    const existingRacks = this.state.cy.nodes('[type="rack"]');
                    const shelfNodes = this.state.cy.nodes('[type="shelf"]');
                    const shelvesWithLocation = shelfNodes.filter(shelf => {
                        const data = shelf.data();
                        return data.hall || data.aisle || (data.rack_num !== undefined && data.rack_num !== null);
                    });
                    const shelfUnderRack = (shelf) => {
                        let node = shelf;
                        while (node.length) {
                            const parent = node.parent();
                            if (parent.length === 0) break;
                            if (parent.data('type') === 'rack') return true;
                            node = parent;
                        }
                        return false;
                    };
                    const shelvesWithLocationNotUnderRack = shelvesWithLocation.filter(s => !shelfUnderRack(s));

                    if (shelvesWithLocation.length > 0 && (existingRacks.length === 0 || shelvesWithLocationNotUnderRack.length > 0)) {
                        console.log('[initVisualization] Shelves have racking data but are not in hall/aisle/rack - rebuilding location view');
                        this.locationModule.rebuildLocationViewFromCurrentGraph();
                        return; // rebuild handles layout and styling
                    }

                    // Racks exist and all shelves with location are under them - use normal flow
                    // calculateLayout() creates the hall/aisle nodes, resetLayout() does final positioning and cleanup
                    this.locationModule.calculateLayout();

                    // Run DFS recalculation ONCE on initial import to ensure unique, consecutive host_index values
                    // This is NOT tied to calculateLayout() - DFS only runs here (on import) and after structural changes
                    this.commonModule.recalculateHostIndices();

                    // After calculateLayout creates the nodes, call resetLayout for final positioning and cleanup
                    // Use a timeout to ensure calculateLayout's async operations complete first
                    setTimeout(() => {
                        window.resetLayout?.();
                    }, 200);
                }

                // Fit viewport to show all content (for hierarchy mode)
                if (currentMode === 'hierarchy') {
                    this.state.cy.fit(null, 50);
                    this.state.cy.center();
                    this.state.cy.forceRender();
                    this.saveDefaultLayout();

                    // Show container after fit completes (hierarchy mode)
                    const cyContainer = document.getElementById('cy');
                    if (cyContainer) {
                        cyContainer.style.visibility = 'visible';
                        cyContainer.style.opacity = '1';
                        cyContainer.style.display = 'block';
                    }
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

            // Final fallback: ensure container is visible after reasonable timeout (only if still hidden)
            // This should rarely be needed since location mode shows in calculateLayout and hierarchy mode shows after fit
            setTimeout(() => {
                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    const computedStyle = window.getComputedStyle(cyContainer);
                    const isHidden = cyContainer.style.visibility === 'hidden' ||
                        computedStyle.visibility === 'hidden' ||
                        computedStyle.opacity === '0' ||
                        computedStyle.display === 'none';

                    if (isHidden) {
                        console.log('[initVisualization] Fallback: showing container after timeout - was hidden');
                        // Ensure fit is applied even in fallback
                        if (this.state.cy) {
                            this.state.cy.fit(null, 50);
                            this.state.cy.center();
                            this.state.cy.forceRender();
                        }
                        // Make sure container is fully visible
                        cyContainer.style.visibility = 'visible';
                        cyContainer.style.opacity = '1';
                        cyContainer.style.display = 'block';
                    }
                }
            }, 1500);

            // Additional safety check: ensure container is visible after a longer timeout
            setTimeout(() => {
                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    const computedStyle = window.getComputedStyle(cyContainer);
                    if (computedStyle.visibility === 'hidden' || computedStyle.opacity === '0' || computedStyle.display === 'none') {
                        console.warn('[initVisualization] Container still hidden after 3s - forcing visibility');
                        cyContainer.style.visibility = 'visible';
                        cyContainer.style.opacity = '1';
                        cyContainer.style.display = 'block';
                    }
                }
            }, 3000);

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

                // Show container after all initialization is complete
                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    cyContainer.style.visibility = 'visible';
                    cyContainer.style.opacity = '1';
                    cyContainer.style.display = 'block';
                }
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
            setTimeout(() => {
                window.addConnectionTypeEventHandlers?.();
            }, 200);

            console.log('Cytoscape initialization complete');
        } catch (error) {
            console.error('Error initializing Cytoscape:', error);
        }
    }

    /**
     * Save current node positions as the default layout for current mode.
     * Layout is fully calculable (shelves, racks, aisles, halls); no separation pass.
     */
    saveDefaultLayout() {
        if (!this.state.cy) return;
        const mode = this.state.mode;
        if (!this.state.layout[mode]) {
            this.state.layout[mode] = new Map();
        }
        const map = this.state.layout[mode];
        map.clear();
        this.state.cy.nodes().forEach((node) => {
            const pos = node.position();
            map.set(node.id(), { x: pos.x, y: pos.y });
        });
    }

    /**
     * Restore default positions for current mode. Returns true if all current nodes had saved positions.
     */
    restoreDefaultLayout() {
        if (!this.state.cy) return false;
        const mode = this.state.mode;
        const map = this.state.layout[mode];
        if (!map || map.size === 0) return false;
        const nodes = this.state.cy.nodes();
        let allFound = true;
        nodes.forEach((node) => {
            const pos = map.get(node.id());
            if (pos != null) {
                node.position(pos);
            } else {
                allFound = false;
            }
        });
        return allFound;
    }

    /**
     * Reset layout: restore default positions (from init / full expansion) when available.
     * Recalculation runs only when no saved default exists or structure changed (add/move/delete).
     */
    resetLayout() {
        if (!this.state.cy) {
            alert('No visualization loaded. Please upload a file first.');
            return;
        }

        const mode = this.state.mode;

        if (mode === 'hierarchy') {
            const map = this.state.layout.hierarchy;
            const canRestore = map && map.size > 0 && this.state.cy.nodes().length === map.size &&
                this.state.cy.nodes().toArray().every((node) => map.has(node.id()));

            if (canRestore) {
                this.showExportStatus('Restoring default layout...', 'info');
                this.restoreDefaultLayout();
                if (this.commonModule.recalculateAllEdgeRouting) {
                    this.commonModule.recalculateAllEdgeRouting();
                }
                this.commonModule.forceApplyCurveStyles();
                this.state.cy.fit(null, 50);
                this.commonModule.applyDragRestrictions();
                this.state.cy.resize();
                this.state.cy.forceRender();
                this.showExportStatus('Default layout restored', 'success');
            } else {
                this.showExportStatus('Recalculating hierarchical layout...', 'info');
                this.hierarchyModule.calculateLayout();
                this.state.cy.fit(null, 50);
                this.commonModule.applyDragRestrictions();
                this.saveDefaultLayout();
                this.showExportStatus('Layout reset with consistent spacing', 'success');
            }

            setTimeout(() => {
                const statusDiv = document.getElementById('rangeStatus');
                if (statusDiv) {
                    statusDiv.textContent = '';
                }
            }, 2000);

            return;
        }

        // Location mode: restore default positions when available, else recalculate and save
        const racks = this.state.cy.nodes('[type="rack"]');
        if (racks.length === 0) {
            const allNodes = this.state.cy.nodes();
            if (allNodes.length === 0) {
                return;
            }
            const fileFormat = this.state.data.currentData?.metadata?.file_format;
            if (fileFormat === 'hostname_based') {
                return;
            }
            alert('No rack hierarchy found.');
            return;
        }

        const locMap = this.state.layout.location;
        const locNodes = this.state.cy.nodes();
        const canRestoreLocation = locMap && locMap.size > 0 && locNodes.length === locMap.size &&
            locNodes.toArray().every((node) => locMap.has(node.id()));

        if (canRestoreLocation) {
            this.showExportStatus('Restoring default layout...', 'info');
            this.restoreDefaultLayout();
            if (this.commonModule.recalculateAllEdgeRouting) {
                this.commonModule.recalculateAllEdgeRouting();
            }
            this.commonModule.forceApplyCurveStyles();
            this.commonModule.applyDragRestrictions();
            window.updatePortConnectionStatus?.();
            if (window.locationModule && typeof window.locationModule.updateAllShelfLabels === 'function') {
                window.locationModule.updateAllShelfLabels();
            }
            this.state.cy.fit(null, 50);
            this.state.cy.resize();
            this.state.cy.forceRender();
            this.showExportStatus('Default layout restored', 'success');
            setTimeout(() => {
                const statusDiv = document.getElementById('rangeStatus');
                if (statusDiv) statusDiv.textContent = '';
            }, 2000);
            return;
        }

        this.showExportStatus('Recalculating location-based layout with hall/aisle grouping...', 'info');

        const rackHierarchy = {};
        racks.forEach((rack) => {
            const hall = rack.data('hall') || 'unknown_hall';
            const aisle = rack.data('aisle') || 'unknown_aisle';
            const rackNum = parseInt(rack.data('rack_num')) || 0;
            if (!rackHierarchy[hall]) rackHierarchy[hall] = {};
            if (!rackHierarchy[hall][aisle]) rackHierarchy[hall][aisle] = [];
            rackHierarchy[hall][aisle].push({ node: rack, rack_num: rackNum });
        });

        Object.keys(rackHierarchy).forEach(hall => {
            Object.keys(rackHierarchy[hall]).forEach(aisle => {
                rackHierarchy[hall][aisle].sort((a, b) => b.rack_num - a.rack_num);
            });
        });

        let maxRackWidth = 0;
        racks.forEach((rack) => {
            if (!rack || !rack.cy() || rack.removed()) return;
            const width = rack.boundingBox().w;
            if (width > maxRackWidth) maxRackWidth = width;
        });
        const rackWidth = maxRackWidth || LAYOUT_CONSTANTS.DEFAULT_RACK_WIDTH;

        const collapsedGraphs = this.state.ui?.collapsedGraphs;
        const shelfIsCollapsed = (s) => collapsedGraphs && collapsedGraphs instanceof Set && collapsedGraphs.has(s.id());
        let maxShelfHeight = 0;
        let totalShelfHeight = 0;
        let shelfCount = 0;
        let hasCollapsedShelf = false;

        racks.forEach((rack) => {
            if (!rack || !rack.cy() || rack.removed()) return;
            rack.children('[type="shelf"]').forEach((shelf) => {
                if (!shelf || !shelf.cy() || shelf.removed()) return;
                let height;
                if (shelfIsCollapsed(shelf)) {
                    hasCollapsedShelf = true;
                    height = LAYOUT_CONSTANTS.COLLAPSED_SHELF_LAYOUT_MIN_HEIGHT;
                } else {
                    const nodeType = shelf.data('shelf_node_type') || 'WH_GALAXY';
                    height = getShelfLayoutDimensions(nodeType).height;
                }
                totalShelfHeight += height;
                shelfCount++;
                if (height > maxShelfHeight) maxShelfHeight = height;
            });
        });

        const avgShelfHeight = shelfCount > 0 ? totalShelfHeight / shelfCount : 300;
        const shelfSpacingBuffer = hasCollapsedShelf
            ? LAYOUT_CONSTANTS.COLLAPSED_SHELF_LOCATION_SPACING_FACTOR
            : LAYOUT_CONSTANTS.SHELF_VERTICAL_SPACING_FACTOR;
        const shelfSpacing = Math.max(maxShelfHeight, avgShelfHeight) * shelfSpacingBuffer;
        const rackSpacing = rackWidth * LAYOUT_CONSTANTS.RACK_SPACING_BUFFER - rackWidth;
        const baseX = Math.max(200, rackWidth / 2 + LAYOUT_CONSTANTS.RACK_X_OFFSET);
        const baseY = Math.max(300, maxShelfHeight + LAYOUT_CONSTANTS.RACK_Y_OFFSET);
        const hallSpacing = 1200;
        const aisleSpacing = 1000;

        const positionUpdates = [];
        let hallIndex = 0;
        Object.keys(rackHierarchy).sort().forEach(hall => {
            const hallStartY = baseY + (hallIndex * hallSpacing);
            let aisleIndex = 0;
            Object.keys(rackHierarchy[hall]).sort().forEach(aisle => {
                const aisleStartX = baseX;
                const aisleStartY = hallStartY + (aisleIndex * aisleSpacing);
                let rackX = aisleStartX;
                rackHierarchy[hall][aisle].forEach((rackData) => {
                    const rack = rackData.node;
                    positionUpdates.push({ node: rack, newPos: { x: rackX, y: aisleStartY } });
                    rack.data('label', `Rack ${rackData.rack_num} (${hall}-${aisle})`);

                    const shelves = rack.children('[type="shelf"]');
                    const sortedShelves = [];
                    shelves.forEach((shelf) => {
                        sortedShelves.push({
                            node: shelf,
                            shelf_u: parseInt(shelf.data('shelf_u')) || 0
                        });
                    });
                    sortedShelves.sort((a, b) => b.shelf_u - a.shelf_u);

                    const numShelves = sortedShelves.length;
                    if (numShelves > 0) {
                        const totalShelfHeightRack = (numShelves - 1) * shelfSpacing;
                        const shelfStartY = aisleStartY - (totalShelfHeightRack / 2);
                        sortedShelves.forEach((shelfData, shelfIndex) => {
                            const shelf = shelfData.node;
                            positionUpdates.push({
                                node: shelf,
                                newPos: { x: rackX, y: shelfStartY + (shelfIndex * shelfSpacing) },
                                needsChildArrangement: true
                            });
                        });
                    }
                    rackX += rackWidth + rackSpacing;
                });
                aisleIndex++;
            });
            hallIndex++;
        });

        this.state.cy.startBatch();
        positionUpdates.forEach((update) => {
            update.node.position(update.newPos);
            if (update.needsChildArrangement) {
                this.commonModule.arrangeTraysAndPorts(update.node);
            }
        });
        this.state.cy.endBatch();

        this.state.cy.resize();
        this.state.cy.forceRender();

        setTimeout(() => {
            const locationNodes = this.state.cy.nodes('[type="hall"], [type="aisle"], [type="rack"]');
            if (locationNodes.length > 0) {
                try {
                    const layout = this.state.cy.layout({
                        name: 'fcose',
                        eles: locationNodes,
                        quality: 'default',
                        randomize: false,
                        animate: true,
                        animationDuration: 500,
                        fit: false,
                        nodeDimensionsIncludeLabels: true,
                        nodeRepulsion: 4000,
                        idealEdgeLength: 150,
                        nestingFactor: 0.15,
                        gravity: 0.1,
                        numIter: 300,
                        stop: () => {
                            this.state.cy.nodes('[type="shelf"]').forEach(shelf => {
                                this.commonModule.arrangeTraysAndPorts(shelf);
                            });
                            this.commonModule.applyDragRestrictions();
                            this.commonModule.forceApplyCurveStyles();
                            window.updatePortConnectionStatus?.();
                            if (this.state.mode === 'location' && window.locationModule) {
                                window.locationModule.updateAllShelfLabels();
                            }
                            this.saveDefaultLayout();
                            this.state.cy.fit(50);
                            this.state.cy.center();
                            this.state.cy.forceRender();
                            const cyContainer = document.getElementById('cy');
                            if (cyContainer) cyContainer.style.visibility = 'visible';
                            this.showExportStatus('Layout reset successfully! All nodes repositioned based on hierarchy.', 'success');
                        }
                    });
                    if (layout) {
                        layout.run();
                        return;
                    }
                } catch (e) {
                    console.warn('Error applying fcose layout in location mode:', e.message);
                }
            }

            this.commonModule.forceApplyCurveStyles();
            if (this.state.mode === 'location' && window.locationModule) {
                window.locationModule.updateAllShelfLabels();
            }
            this.saveDefaultLayout();
            window.updatePortConnectionStatus?.();
            this.state.cy.fit(50);
            this.state.cy.center();
            this.state.cy.forceRender();
            const cyContainer = document.getElementById('cy');
            if (cyContainer) cyContainer.style.visibility = 'visible';
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

        // Block mode switching if session started in location mode
        if (this.state.data.initialMode === 'location') {
            const errorMsg = 'Cannot switch modes. This session started in location mode (from CSV import). ' +
                'Mode switching is only allowed for sessions that started in hierarchy mode (from descriptor import or empty topology canvas).';
            alert(errorMsg);
            console.error('[toggleVisualizationMode] Blocked: Session started in location mode');
            if (this.notificationManager) {
                this.notificationManager.show(errorMsg, 'error');
            }
            return;
        }

        // Toggle the mode
        const newMode = this.state.mode === 'hierarchy' ? 'location' : 'hierarchy';

        // Restructure the visualization based on the new mode
        if (newMode === 'location') {
            // Expand the hierarchy fully before switching (avoids rerouted edges / missing nodes when building location graph)
            if (this.commonModule && typeof this.commonModule.expandAllLevels === 'function') {
                this.commonModule.expandAllLevels();
            }

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
        const modeLabel = newMode === 'hierarchy' ? 'Logical Hierarchy View' : 'Physical Location View';
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

            // Show create template section only in hierarchy mode
            const createTemplateSection = document.getElementById('createTemplateSection');
            if (createTemplateSection && this.state.mode === 'hierarchy') {
                createTemplateSection.style.display = 'block';
            } else if (createTemplateSection) {
                createTemplateSection.style.display = 'none';
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
            // Hide create template section
            const createTemplateSection = document.getElementById('createTemplateSection');
            if (createTemplateSection) {
                createTemplateSection.style.display = 'none';
            }

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

