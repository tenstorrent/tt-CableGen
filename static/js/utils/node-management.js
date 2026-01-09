/**
 * Node Management Utilities
 * Functions for managing nodes (deletion, editing, etc.)
 * These are utility functions that work with state and modules
 */

/**
 * Delete multiple selected nodes and/or connections at once.
 * This function handles bulk deletion of cytoscape selections.
 * Also handles single node deletion via state.editing.selectedNode.
 * 
 * @param {Object} state - VisualizerState instance
 * @param {Object} hierarchyModule - HierarchyModule instance (optional)
 * @param {Object} commonModule - CommonModule instance (optional)
 */
export function deleteMultipleSelected(state, hierarchyModule = null, commonModule = null) {
    let selectedNodes = state.cy.nodes(':selected');
    let selectedEdges = state.cy.edges(':selected');

    // If no Cytoscape selection, check tracked single selections
    if (selectedNodes.length === 0 && selectedEdges.length === 0) {
        // Check for single node selection
        if (state.editing.selectedNode && state.editing.selectedNode.length > 0) {
            selectedNodes = state.editing.selectedNode;
        }
        // Check for single connection selection
        else if (state.editing.selectedConnection && state.editing.selectedConnection.length > 0) {
            selectedEdges = state.editing.selectedConnection;
        }
        else {
            console.warn('Please select one or more nodes or connections first.\nUse Shift+Click or Ctrl+Click to select multiple items.');
            return;
        }
    }

    const nodeCount = selectedNodes.length;
    const edgeCount = selectedEdges.length;
    const isSingleNode = nodeCount === 1 && edgeCount === 0;
    const isSingleEdge = nodeCount === 0 && edgeCount === 1;
    const singleNode = isSingleNode ? selectedNodes[0] : null;
    const singleEdge = isSingleEdge ? selectedEdges[0] : null;

    // Build confirmation message
    let message = '';

    // For single connection, use detailed message with source/target info
    if (isSingleEdge) {
        const edge = singleEdge;
        
        // Check if edge still exists and is valid
        if (!edge || !edge.cy() || edge.removed()) {
            console.warn('Selected connection is no longer valid.');
            if (state.editing.selectedConnection) {
                state.editing.selectedConnection = null;
            }
            if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
                window.updateDeleteButtonState();
            }
            return;
        }

        const sourceNode = state.cy.getElementById(edge.data('source'));
        const targetNode = state.cy.getElementById(edge.data('target'));

        // Get port location info for detailed message
        let sourceInfo = 'Unknown';
        let targetInfo = 'Unknown';
        if (window.getPortLocationInfo && typeof window.getPortLocationInfo === 'function') {
            if (sourceNode && sourceNode.length > 0) {
                sourceInfo = window.getPortLocationInfo(sourceNode);
            }
            if (targetNode && targetNode.length > 0) {
                targetInfo = window.getPortLocationInfo(targetNode);
            }
        } else if (commonModule && typeof commonModule.getPortLocationInfo === 'function') {
            if (sourceNode && sourceNode.length > 0) {
                sourceInfo = commonModule.getPortLocationInfo(sourceNode);
            }
            if (targetNode && targetNode.length > 0) {
                targetInfo = commonModule.getPortLocationInfo(targetNode);
            }
        }

        message = `Delete connection between:\n\nSource: ${sourceInfo}\n\nTarget: ${targetInfo}`;

        // Determine if this is a template-level connection
        const edgeTemplateName = edge.data('template_name');
        if (edgeTemplateName) {
            // Count how many instances will be affected (including empty ones)
            const templateGraphs = state.cy.nodes().filter(node =>
                node.data('type') === 'graph' && node.data('template_name') === edgeTemplateName
            );

            message += `\n\n⚠️ Template-Level Connection`;
            message += `\nThis connection is defined in template "${edgeTemplateName}".`;
            message += `\nDeleting will remove it from ALL ${templateGraphs.length} instance(s) of this template.`;
        }
    }
    // For single node, use detailed message (like deleteSelectedNode)
    else if (isSingleNode) {
        const node = singleNode;
        const nodeType = node.data('type');
        const nodeLabel = node.data('label') || node.id();

        // Check if node type is deletable
        if (!['shelf', 'rack', 'graph', 'hall', 'aisle'].includes(nodeType)) {
            console.warn('Only shelf, rack, graph, hall, and aisle nodes can be deleted directly.\nPorts and trays are deleted automatically with their parent shelf.');
            return;
        }

        // Check if this is a child of a template instance (hierarchy mode)
        const visualizationMode = state.mode;
        const hasParent = node.parent().length > 0;
        const parentNode = hasParent ? node.parent() : null;

        // For shelf nodes, find the graph template they belong to
        let parentTemplateName = null;
        let isTemplateChild = false;

        if (visualizationMode === 'hierarchy' && hasParent) {
            if (nodeType === 'graph' && parentNode.data('type') === 'graph') {
                // Child graph of a graph template
                parentTemplateName = parentNode.data('template_name');
                isTemplateChild = !!parentTemplateName;
            } else if (nodeType === 'shelf') {
                // Shelf node - find its parent graph template
                let graphParent = parentNode;
                while (graphParent && graphParent.length > 0) {
                    if (graphParent.data('type') === 'graph' && graphParent.data('template_name')) {
                        parentTemplateName = graphParent.data('template_name');
                        isTemplateChild = true;
                        break;
                    }
                    graphParent = graphParent.parent();
                }
            }
        }

        // Build detailed description for single node
        message = `Delete ${nodeType}: "${nodeLabel}"`;

        // Count children for compound nodes
        if (node.isParent()) {
            const descendants = node.descendants();
            const childCount = descendants.length;
            const connectedEdges = descendants.connectedEdges();
            const edgeCount = connectedEdges.length;

            message += `\n\nThis will also delete:`;
            message += `\n  • ${childCount} child node(s)`;
            if (edgeCount > 0) {
                message += `\n  • ${edgeCount} connection(s)`;
            }
        } else {
            // Check for connected edges
            const connectedEdges = node.connectedEdges();
            if (connectedEdges.length > 0) {
                message += `\n\nThis will also delete ${connectedEdges.length} connection(s)`;
            }
        }

        // Add warning for template-level deletion
        if (isTemplateChild) {
            message += `\n\n⚠️ This ${nodeType} belongs to template "${parentTemplateName}".`;
            message += `\nDeleting it will remove this ${nodeType} from ALL instances of this template.`;
        }

        message += '\n\nThis action cannot be undone.';
    }
    // For multiple items or single node, use summary/detailed message
    else {
        // For multiple items, use summary message
        message = 'Delete the following:\n\n';

        if (edgeCount > 0) {
            message += `• ${edgeCount} connection${edgeCount > 1 ? 's' : ''}\n`;
        }

        if (nodeCount > 0) {
            // Count by type
            const nodesByType = {};
            selectedNodes.forEach(node => {
                const type = node.data('type');
                nodesByType[type] = (nodesByType[type] || 0) + 1;
            });

            for (const [type, count] of Object.entries(nodesByType)) {
                message += `• ${count} ${type}${count > 1 ? 's' : ''}\n`;
            }
        }

        message += '\nThis action cannot be undone.';
    }

    // Log deletion action instead of showing confirmation dialog
    console.log('Deleting:', message);

    const visualizationMode = state.mode;

    // Delete connections first
    if (edgeCount > 0) {
        selectedEdges.forEach(edge => {
            const edgeTemplateName = edge.data('template_name');
            if (edgeTemplateName) {
                // Template-level connection - delete from all instances
                if (hierarchyModule) {
                    deleteConnectionFromAllTemplateInstances(state, edge, edgeTemplateName, hierarchyModule);
                } else if (window.hierarchyModule) {
                    deleteConnectionFromAllTemplateInstances(state, edge, edgeTemplateName, window.hierarchyModule);
                } else {
                    console.warn('Cannot delete template-level connection: hierarchyModule not available');
                    edge.remove(); // Fallback to single deletion
                }
            } else {
                // Single connection - just remove it
                edge.remove();
            }
        });
        console.log(`Deleted ${edgeCount} connection(s)`);
    }

    // Delete nodes
    if (nodeCount > 0) {
        // Group nodes by whether they are template children
        const templateChildNodes = [];
        const standaloneNodes = [];

        selectedNodes.forEach(node => {
            const nodeType = node.data('type');

            // Check if node type is deletable
            if (!['shelf', 'rack', 'graph', 'hall', 'aisle'].includes(nodeType)) {
                console.log(`Skipping non-deletable node type: ${nodeType}`);
                return;
            }

            // Check if this is a child of a template instance (hierarchy mode)
            const hasParent = node.parent().length > 0;
            const parentNode = hasParent ? node.parent() : null;
            let parentTemplateName = null;
            let isTemplateChild = false;

            if (visualizationMode === 'hierarchy' && hasParent) {
                if (nodeType === 'graph' && parentNode.data('type') === 'graph') {
                    // Child graph of a graph template
                    parentTemplateName = parentNode.data('template_name');
                    isTemplateChild = !!parentTemplateName;
                } else if (nodeType === 'shelf') {
                    // Shelf node - find its parent graph template
                    let graphParent = parentNode;
                    while (graphParent && graphParent.length > 0) {
                        if (graphParent.data('type') === 'graph' && graphParent.data('template_name')) {
                            parentTemplateName = graphParent.data('template_name');
                            isTemplateChild = true;
                            break;
                        }
                        graphParent = graphParent.parent();
                    }
                }
            }

            if (isTemplateChild) {
                templateChildNodes.push({
                    node: node,
                    nodeType: nodeType,
                    parentTemplateName: parentTemplateName,
                    childName: node.data('child_name') || node.data('label') || node.id(),
                    childTemplateName: node.data('template_name')
                });
            } else {
                standaloneNodes.push(node);
            }
        });

        // Delete template children first (from all instances)
        const hModule = hierarchyModule || window.hierarchyModule;
        templateChildNodes.forEach(({ node: _node, nodeType, parentTemplateName, childName, childTemplateName }) => {
            if (hModule) {
                if (nodeType === 'graph') {
                    if (hModule.deleteChildGraphFromAllTemplateInstances && typeof hModule.deleteChildGraphFromAllTemplateInstances === 'function') {
                        hModule.deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName);
                    }
                } else if (nodeType === 'shelf') {
                    if (hModule.deleteChildNodeFromAllTemplateInstances && typeof hModule.deleteChildNodeFromAllTemplateInstances === 'function') {
                        hModule.deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, 'shelf');
                    }
                }
            }
        });

        // Delete standalone nodes
        standaloneNodes.forEach(node => {
            const nodeId = node.id();
            const isOriginalRoot = state.data.currentData && state.data.currentData.metadata &&
                state.data.currentData.metadata.initialRootId === nodeId;

            node.remove();

            // Track original root deletion for export optimization
            if (isOriginalRoot && state.data.currentData && state.data.currentData.metadata) {
                state.data.currentData.metadata.hasTopLevelAdditions = true;
                console.log(`Original root deleted - flagging export to use synthetic root`);
            }
        });

        if (isSingleNode) {
            const nodeType = singleNode.data('type');
            const nodeLabel = singleNode.data('label') || singleNode.id();
            console.log(`Deleted ${nodeType} node: ${nodeLabel}`);
        } else {
            console.log(`Deleted ${nodeCount} node(s)`);
        }

        // Recalculate host_indices after deletion in both hierarchy and location modes
        // Use common module for unified DFS traversal from canvas root
        if (commonModule && commonModule.recalculateHostIndices && typeof commonModule.recalculateHostIndices === 'function') {
            commonModule.recalculateHostIndices();
        } else if (window.commonModule && window.commonModule.recalculateHostIndices && typeof window.commonModule.recalculateHostIndices === 'function') {
            window.commonModule.recalculateHostIndices();
        }
        
        // Rename graph instances in hierarchy mode (location mode doesn't have graph instances)
        if (state.mode === 'hierarchy') {
            const hModule = hierarchyModule || window.hierarchyModule;
            if (hModule && hModule.renameGraphInstances && typeof hModule.renameGraphInstances === 'function') {
                hModule.renameGraphInstances();
            }
        }
    }

    // Clear all selections (including Cytoscape selections and UI elements)
    if (commonModule && typeof commonModule.clearAllSelections === 'function') {
        commonModule.clearAllSelections();
    } else {
        // Fallback: clear selections manually
        state.cy.elements().unselect();
        state.editing.selectedNode = null;
        state.editing.selectedConnection = null;
    }
    
    // Update UI state
    if (window.updateDeleteNodeButtonState && typeof window.updateDeleteNodeButtonState === 'function') {
        window.updateDeleteNodeButtonState();
    }
    if (window.updateDeleteButtonState && typeof window.updateDeleteButtonState === 'function') {
        window.updateDeleteButtonState();
    }
    if (window.updatePortConnectionStatus && typeof window.updatePortConnectionStatus === 'function') {
        window.updatePortConnectionStatus();
    }
    if (window.updatePortEditingHighlight && typeof window.updatePortEditingHighlight === 'function') {
        window.updatePortEditingHighlight();
    }

    // Update node filter dropdown
    if (commonModule && typeof commonModule.populateNodeFilterDropdown === 'function') {
        commonModule.populateNodeFilterDropdown();
    } else if (window.populateNodeFilterDropdown && typeof window.populateNodeFilterDropdown === 'function') {
        window.populateNodeFilterDropdown();
    }
}

/**
 * Delete a connection from all instances of its template
 * Used when deleting template-level connections (where template_name matches closest common ancestor)
 * 
 * @param {Object} state - VisualizerState instance
 * @param {Object} edge - The edge to delete
 * @param {string} templateName - The template name
 * @param {Object} hierarchyModule - HierarchyModule instance (required for template operations)
 */
export function deleteConnectionFromAllTemplateInstances(state, edge, templateName, hierarchyModule) {
    // Get connection pattern (relative to the template)
    const sourcePort = state.cy.getElementById(edge.data('source'));
    const targetPort = state.cy.getElementById(edge.data('target'));

    // Use selectedFirstPort if available (for single connection deletion), otherwise use sourcePort from edge
    const actualSourcePort = state.editing.selectedFirstPort && state.editing.selectedFirstPort.length > 0
        ? state.editing.selectedFirstPort
        : sourcePort;

    // Check if ports exist (getElementById can return null, and selectedFirstPort can be null)
    if (!actualSourcePort || !actualSourcePort.length ||
        !targetPort || !targetPort.length) {
        console.warn('Source or target port not found');
        edge.remove();
        return;
    }

    // Find all graph nodes with the same template (including empty ones)
    const templateGraphs = state.cy.nodes().filter(node =>
        node.data('type') === 'graph' && node.data('template_name') === templateName
    );

    if (templateGraphs.length === 0) {
        console.warn('No template instances found');
        edge.remove();
        return;
    }

    // Find which instance contains the ports we're deleting
    let sourceInstance = null;
    for (const graph of templateGraphs) {
        if (actualSourcePort.ancestors().filter(n => n.id() === graph.id()).length > 0) {
            sourceInstance = graph;
            break;
        }
    }

    if (!sourceInstance) {
        console.warn('Could not find instance containing the ports');
        edge.remove();
        return;
    }

    // Extract pattern ONCE relative to the instance that contains the ports
    const sourcePattern = hierarchyModule.extractPortPattern(actualSourcePort, sourceInstance);
    const targetPattern = hierarchyModule.extractPortPattern(targetPort, sourceInstance);

    console.log(`[deleteConnectionFromAllTemplateInstances] Pattern from ${sourceInstance.id()}:`);
    console.log(`[deleteConnectionFromAllTemplateInstances]   sourcePattern:`, sourcePattern);
    console.log(`[deleteConnectionFromAllTemplateInstances]   targetPattern:`, targetPattern);

    if (!sourcePattern || !targetPattern) {
        console.warn('Could not extract port patterns');
        edge.remove();
        return;
    }

    let deletedCount = 0;

    // Apply the SAME pattern to ALL instances
    templateGraphs.forEach(graph => {
        // Find the specific ports in this instance by following the SAME path
        const sourcePortNode = hierarchyModule.findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
        const targetPortNode = hierarchyModule.findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

        if (!sourcePortNode || !targetPortNode) {
            // Ports don't exist in this instance - skip
            console.log(`[deleteConnectionFromAllTemplateInstances] Ports not found in instance ${graph.id()}, skipping`);
            return;
        }

        // Find matching edge
        const matchingEdges = state.cy.edges().filter(e =>
            (e.data('source') === sourcePortNode.id() && e.data('target') === targetPortNode.id()) ||
            (e.data('source') === targetPortNode.id() && e.data('target') === sourcePortNode.id())
        );

        if (matchingEdges.length > 0) {
            console.log(`[deleteConnectionFromAllTemplateInstances] Deleting ${matchingEdges.length} connection(s) from instance ${graph.id()}`);
            matchingEdges.remove();
            deletedCount++;
        } else {
            console.log(`[deleteConnectionFromAllTemplateInstances] No matching connection in instance ${graph.id()}`);
        }
    });

    console.log(`Deleted ${deletedCount} connection(s) from template "${templateName}"`);

    // IMPORTANT: Also remove the connection from the template definition in metadata
    // This prevents the connection from being restored when switching modes
    if (state.data.currentData && state.data.currentData.metadata &&
        state.data.currentData.metadata.graph_templates &&
        state.data.currentData.metadata.graph_templates[templateName]) {
        const template = state.data.currentData.metadata.graph_templates[templateName];
        if (template.connections && Array.isArray(template.connections)) {
            // Remove connections matching the deleted pattern
            const initialLength = template.connections.length;
            template.connections = template.connections.filter(conn => {
                // Check if this connection matches the deleted pattern
                const portAMatches = conn.port_a &&
                    JSON.stringify(conn.port_a.path) === JSON.stringify(sourcePattern.path) &&
                    conn.port_a.tray_id === sourcePattern.trayId &&
                    conn.port_a.port_id === sourcePattern.portId;
                const portBMatches = conn.port_b &&
                    JSON.stringify(conn.port_b.path) === JSON.stringify(targetPattern.path) &&
                    conn.port_b.tray_id === targetPattern.trayId &&
                    conn.port_b.port_id === targetPattern.portId;

                // Keep connection if it doesn't match the deleted pattern
                return !(portAMatches && portBMatches);
            });

            const removedFromTemplate = initialLength - template.connections.length;
            if (removedFromTemplate > 0) {
                console.log(`Removed ${removedFromTemplate} connection(s) from template definition "${templateName}" in metadata`);
            }
        }
    }

    // Also update availableGraphTemplates if it exists
    if (state.data.availableGraphTemplates && state.data.availableGraphTemplates[templateName]) {
        const template = state.data.availableGraphTemplates[templateName];
        if (template.connections && Array.isArray(template.connections)) {
            const initialLength = template.connections.length;
            template.connections = template.connections.filter(conn => {
                const portAMatches = conn.port_a &&
                    JSON.stringify(conn.port_a.path) === JSON.stringify(sourcePattern.path) &&
                    conn.port_a.tray_id === sourcePattern.trayId &&
                    conn.port_a.port_id === sourcePattern.portId;
                const portBMatches = conn.port_b &&
                    JSON.stringify(conn.port_b.path) === JSON.stringify(targetPattern.path) &&
                    conn.port_b.tray_id === targetPattern.trayId &&
                    conn.port_b.port_id === targetPattern.portId;

                return !(portAMatches && portBMatches);
            });

            const removedFromAvailable = initialLength - template.connections.length;
            if (removedFromAvailable > 0) {
                console.log(`Removed ${removedFromAvailable} connection(s) from availableGraphTemplates["${templateName}"]`);
            }
        }
    }
}

