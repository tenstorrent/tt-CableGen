/**
 * Expand/Collapse Module - Handles node expand/collapse functionality
 * Manages visibility of compound nodes and edge rerouting when nodes are collapsed
 */
export class ExpandCollapseModule {
    constructor(state) {
        this.state = state;
    }

    /**
     * Handle expand/collapse functionality for compound nodes
     * Toggles visibility of children when clicking on a compound node
     * @param {Object} evt - Cytoscape event object
     * @param {Object} node - Cytoscape node object
     * @returns {boolean} True if expand/collapse was handled, false otherwise
     */
    handleExpandCollapse(evt, node) {
        if (!node || !this.state.cy) {
            return false;
        }

        // Only handle compound nodes (nodes with children)
        if (!node.isParent() || node.children().length === 0) {
            return false;
        }

        // Don't handle expand/collapse for ports and trays
        const nodeType = node.data('type');
        if (nodeType === 'port' || nodeType === 'tray') {
            return false;
        }

        const nodeId = node.id();
        const isCollapsed = this.state.ui.collapsedGraphs.has(nodeId);

        if (isCollapsed) {
            // Expand: restore children and edges
            this.expandNode(node, nodeId);
        } else {
            // Collapse: hide children and reroute edges
            this.collapseNode(node, nodeId);
        }

        // Update compound node size by triggering a layout refresh
        // Use a small delay to ensure style changes are applied
        setTimeout(() => {
            this.state.cy.layout({ name: 'preset' }).run();
            // Update button states
            if (typeof window.updateExpandCollapseButtons === 'function') {
                window.updateExpandCollapseButtons();
            }
        }, 10);

        return true;
    }

    /**
     * Collapse a node: hide children and reroute edges to first visible ancestor
     * @param {Object} node - The node to collapse
     * @param {string} nodeId - The node ID
     */
    collapseNode(node, nodeId) {
        // Get all descendant nodes (children, grandchildren, etc.) including ports
        const descendants = node.descendants();

        // Find all edges connected to descendants (ports inside this node)
        const connectedEdges = [];
        descendants.forEach(descendant => {
            const edges = this.state.cy.edges(`[source="${descendant.id()}"], [target="${descendant.id()}"]`);
            edges.forEach(edge => {
                if (!connectedEdges.includes(edge)) {
                    connectedEdges.push(edge);
                }
            });
        });

        // Add this node to collapsed set for ancestor checking
        const collapsedNodeIds = new Set(this.state.ui.collapsedGraphs);
        collapsedNodeIds.add(nodeId);

        // Store original edge data and rerouted edges
        const edgeReroutingData = {
            originalEdges: connectedEdges,
            reroutedEdges: [], // New edges created for rerouting
            edgeMappings: [] // Maps original edge -> rerouted edge
        };

        // Hide children (use display: none for shrinking visualization)
        node.children().forEach(child => {
            child.style('display', 'none');
        });

        // Store rerouting data (for reference, but recalculateAllEdgeRouting will handle everything)
        this.state.ui.edgeRerouting.set(nodeId, edgeReroutingData);
        node.addClass('collapsed-node');
        this.state.ui.collapsedGraphs.add(nodeId);
        this.state.ui.expandedGraphs.delete(nodeId);

        // Recalculate all edge routing after collapse
        // This will handle all edge rerouting based on current collapse state
        this.recalculateAllEdgeRouting();
    }

    /**
     * Expand a node: restore children and recalculate edge routing
     * @param {Object} node - The node to expand
     * @param {string} nodeId - The node ID
     */
    expandNode(node, nodeId) {
        // Restore children (display: element for shrinking visualization)
        node.children().forEach(child => {
            child.style('display', 'element');
        });

        // Remove this node from collapsed set
        this.state.ui.collapsedGraphs.delete(nodeId);
        this.state.ui.expandedGraphs.add(nodeId);

        // Remove rerouting data for this node
        this.state.ui.edgeRerouting.delete(nodeId);

        // Recalculate all edge routing after expand
        this.recalculateAllEdgeRouting();

        node.removeClass('collapsed-node');
    }

    /**
     * Check if a node is actually visible (not hidden by any ancestor)
     * @param {Object} node - The node to check
     * @returns {boolean} True if node is visible, false if hidden
     */
    isNodeActuallyVisible(node) {
        // Check the node itself
        if (node.style('display') === 'none') {
            return false;
        }

        // Check all ancestors - if any ancestor is hidden, this node is hidden
        let ancestor = node.parent();
        while (ancestor && ancestor.length > 0) {
            if (ancestor.style('display') === 'none') {
                return false;
            }
            ancestor = ancestor.parent();
        }

        return true;
    }

    /**
     * Find the collapsed ancestor for a node (if any)
     * Returns the first collapsed ancestor, or null if node is visible
     * @param {Object} node - The node to check
     * @param {Set} collapsedNodeIds - Set of currently collapsed node IDs
     * @returns {Object|null} Collapsed ancestor node or null
     */
    findCollapsedAncestor(node, collapsedNodeIds) {
        let ancestor = node.parent();
        while (ancestor && ancestor.length > 0) {
            const ancestorId = ancestor.id();
            const isHidden = ancestor.style('display') === 'none';

            // If this ancestor is collapsed (visible but collapsed), return it
            if (collapsedNodeIds.has(ancestorId) && !isHidden) {
                return ancestor;
            }

            // If we hit a hidden node, check if its parent is collapsed before stopping
            // (hidden nodes are often children of collapsed nodes)
            if (isHidden) {
                const parent = ancestor.parent();
                if (parent && parent.length > 0) {
                    const parentId = parent.id();
                    const parentIsHidden = parent.style('display') === 'none';
                    // If parent is collapsed and visible, return it
                    if (collapsedNodeIds.has(parentId) && !parentIsHidden) {
                        return parent;
                    }
                    // If parent is also hidden but collapsed, continue searching up
                    // (nested collapsed nodes - we want the outermost visible collapsed node)
                    if (collapsedNodeIds.has(parentId) && parentIsHidden) {
                        // Continue searching up from the parent
                        ancestor = parent;
                        continue;
                    }
                }
                // If hidden node is not collapsed and its parent isn't collapsed, stop
                break;
            }

            ancestor = ancestor.parent();
        }
        return null; // No collapsed ancestor found
    }

    /**
     * Recalculate edge routing for an edge based on current collapse state
     * Each endpoint is calculated independently
     * @param {Object} edge - The edge to recalculate (can be original or rerouted)
     * @param {Set} collapsedNodeIds - Set of currently collapsed node IDs
     * @returns {Object} Routing information: { source, target, hide, originalSource, originalTarget }
     */
    recalculateEdgeRouting(edge, collapsedNodeIds) {
        // Get original endpoints (from edge data if rerouted, or from edge endpoints)
        const originalSourceId = edge.data('originalSource') || edge.data('source');
        const originalTargetId = edge.data('originalTarget') || edge.data('target');

        const sourceNode = this.state.cy.getElementById(originalSourceId);
        const targetNode = this.state.cy.getElementById(originalTargetId);

        if (!sourceNode.length || !targetNode.length) {
            return { hide: true, source: originalSourceId, target: originalTargetId, originalSource: originalSourceId, originalTarget: originalTargetId };
        }

        // Check each endpoint independently
        let newSourceId = originalSourceId;
        let newTargetId = originalTargetId;

        // Check if source endpoint is actually visible (checking ancestors too)
        const sourceIsVisible = this.isNodeActuallyVisible(sourceNode);

        if (!sourceIsVisible) {
            // Source port is hidden, find collapsed ancestor
            const sourceCollapsedAncestor = this.findCollapsedAncestor(sourceNode, collapsedNodeIds);
            if (sourceCollapsedAncestor) {
                newSourceId = sourceCollapsedAncestor.id();
            } else {
                // Port is hidden but no collapsed ancestor found - edge should be hidden
                return {
                    hide: true,
                    source: originalSourceId,
                    target: originalTargetId,
                    originalSource: originalSourceId,
                    originalTarget: originalTargetId
                };
            }
        }
        // If source is visible, keep original port ID

        // Check if target endpoint is actually visible (checking ancestors too)
        const targetIsVisible = this.isNodeActuallyVisible(targetNode);

        if (!targetIsVisible) {
            // Target port is hidden, find collapsed ancestor
            const targetCollapsedAncestor = this.findCollapsedAncestor(targetNode, collapsedNodeIds);
            if (targetCollapsedAncestor) {
                newTargetId = targetCollapsedAncestor.id();
            } else {
                // Port is hidden but no collapsed ancestor found - edge should be hidden
                return {
                    hide: true,
                    source: originalSourceId,
                    target: originalTargetId,
                    originalSource: originalSourceId,
                    originalTarget: originalTargetId
                };
            }
        }
        // If target is visible, keep original port ID

        // If both endpoints are in the same collapsed node, hide the edge (internal connection)
        if (newSourceId === newTargetId && collapsedNodeIds.has(newSourceId)) {
            return {
                hide: true,
                source: newSourceId,
                target: newTargetId,
                originalSource: originalSourceId,
                originalTarget: originalTargetId
            };
        }

        return {
            source: newSourceId,
            target: newTargetId,
            hide: false,
            originalSource: originalSourceId,
            originalTarget: originalTargetId
        };
    }

    /**
     * Recalculate all edge routing in the graph based on current collapse state
     * This is called after every collapse/expand operation
     * Reroutes edges when child nodes are collapsed, but applies same styling as regular edges
     */
    recalculateAllEdgeRouting() {
        const collapsedNodeIds = new Set(this.state.ui.collapsedGraphs);

        // Get all edges (both original and rerouted)
        const allEdges = this.state.cy.edges();

        // Track which original edges we've processed
        const processedOriginalEdges = new Set();

        allEdges.forEach((edge) => {
            // Skip if this is a rerouted edge (we'll process it via its original)
            if (edge.data('isRerouted')) {
                return;
            }

            // Skip if already processed
            if (processedOriginalEdges.has(edge.id())) {
                return;
            }

            processedOriginalEdges.add(edge.id());

            // Find any existing rerouted edge for this original edge
            const existingRerouted = this.state.cy.edges(`[originalEdgeId="${edge.id()}"]`);

            // Calculate new routing
            const routing = this.recalculateEdgeRouting(edge, collapsedNodeIds);

            if (routing.hide) {
                // Hide original edge and remove any rerouted version
                edge.style('display', 'none');
                existingRerouted.forEach(e => e.remove());
            } else {
                const needsRerouting = routing.source !== routing.originalSource ||
                    routing.target !== routing.originalTarget;

                if (needsRerouting) {
                    // Hide original edge
                    edge.style('display', 'none');

                    // Remove old rerouted edge if it exists
                    existingRerouted.forEach(e => e.remove());

                    // Create new rerouted edge
                    const reroutedEdgeId = `rerouted_${edge.id()}_${Date.now()}`;
                    const reroutedEdgeData = {
                        data: {
                            id: reroutedEdgeId,
                            source: routing.source,
                            target: routing.target,
                            // Copy all edge properties
                            cable_type: edge.data('cable_type'),
                            cable_length: edge.data('cable_length'),
                            connection_number: edge.data('connection_number'),
                            color: edge.data('color'),
                            template_name: edge.data('template_name'),
                            depth: edge.data('depth'),
                            source_hostname: edge.data('source_hostname'),
                            destination_hostname: edge.data('destination_hostname'),
                            // Store original edge info
                            originalEdgeId: edge.id(),
                            originalSource: routing.originalSource,
                            originalTarget: routing.originalTarget,
                            isRerouted: true
                        },
                        classes: 'connection rerouted-edge'
                    };

                    // Verify source and target nodes exist before creating edge
                    const sourceNode = this.state.cy.getElementById(routing.source);
                    const targetNode = this.state.cy.getElementById(routing.target);

                    if (!sourceNode.length || !targetNode.length) {
                        // Don't create edge if nodes don't exist - keep original hidden
                        return;
                    }

                    const reroutedEdge = this.state.cy.add(reroutedEdgeData);
                    // Explicitly set display to element to ensure visibility
                    reroutedEdge.style('display', 'element');
                    
                    // Apply same curve styles as regular edges (no special styling for collapsed state)
                    // The forceApplyCurveStyles function will be called separately to style all edges uniformly
                } else {
                    // No rerouting needed, show original edge and remove any rerouted version
                    edge.style('display', 'element');
                    existingRerouted.forEach(e => e.remove());
                }
            }
        });
        
        // Apply curve styles to all edges (including rerouted ones) - ensures consistent styling
        // regardless of collapsed state
        if (window.forceApplyCurveStyles && typeof window.forceApplyCurveStyles === 'function') {
            setTimeout(() => {
                window.forceApplyCurveStyles();
            }, 10);
        }
    }

    /**
     * Expand one level: expand all collapsed nodes at the shallowest (highest) level
     * This expands from the top of the hierarchy down
     */
    expandOneLevel() {
        if (!this.state.cy) {
            return;
        }

        const cy = this.state.cy;
        const collapsedGraphs = this.state.ui.collapsedGraphs;

        if (collapsedGraphs.size === 0) {
            return;
        }

        // Get all collapsed nodes that are expandable (compound nodes, not ports/trays)
        const collapsedNodes = [];
        collapsedGraphs.forEach(nodeId => {
            const node = cy.getElementById(nodeId);
            if (node.length > 0) {
                const nodeType = node.data('type');
                // Only expand nodes that are compound nodes (not ports/trays)
                if (nodeType !== 'port' && nodeType !== 'tray' && node.isParent()) {
                    collapsedNodes.push(node);
                }
            }
        });

        if (collapsedNodes.length === 0) {
            return;
        }

        // Calculate depth for each collapsed node (number of ancestors)
        const nodeDepths = collapsedNodes.map(node => {
            let depth = 0;
            let ancestor = node.parent();
            while (ancestor && ancestor.length > 0) {
                depth++;
                ancestor = ancestor.parent();
            }
            return { node, depth };
        });

        // Find the shallowest level (lowest depth number) - expand from highest level first
        const minDepth = Math.min(...nodeDepths.map(nd => nd.depth));
        const shallowestNodes = nodeDepths.filter(nd => nd.depth === minDepth).map(nd => nd.node);

        // Expand all nodes at the shallowest level
        shallowestNodes.forEach(node => {
            const nodeId = node.id();
            if (collapsedGraphs.has(nodeId)) {
                this.expandNode(node, nodeId);
            }
        });

        // Trigger layout refresh
        setTimeout(() => {
            cy.layout({ name: 'preset' }).run();
            // Update button states
            if (typeof window.updateExpandCollapseButtons === 'function') {
                window.updateExpandCollapseButtons();
            }
        }, 10);
    }

    /**
     * Collapse one level: collapse all expanded nodes at the deepest (lowest) level
     * This collapses from the bottom of the hierarchy up
     */
    collapseOneLevel() {
        if (!this.state.cy) {
            return;
        }

        const cy = this.state.cy;
        const collapsedGraphs = this.state.ui.collapsedGraphs;

        // Get all expandable nodes (compound nodes that are currently expanded, not ports/trays)
        const allNodes = cy.nodes();
        const expandableNodes = [];

        allNodes.forEach(node => {
            const nodeType = node.data('type');
            const nodeId = node.id();
            const isCollapsed = collapsedGraphs.has(nodeId);
            const isVisible = this.isNodeActuallyVisible(node);

            // Only consider nodes that:
            // 1. Are compound nodes (have children)
            // 2. Are not ports or trays
            // 3. Are currently expanded (not in collapsedGraphs)
            // 4. Are visible (not hidden by parent collapse)
            if (nodeType !== 'port' && nodeType !== 'tray' &&
                node.isParent() && !isCollapsed && isVisible) {
                expandableNodes.push(node);
            }
        });

        if (expandableNodes.length === 0) {
            return;
        }

        // Calculate depth for each expandable node (number of ancestors)
        const nodeDepths = expandableNodes.map(node => {
            let depth = 0;
            let ancestor = node.parent();
            while (ancestor && ancestor.length > 0) {
                depth++;
                ancestor = ancestor.parent();
            }
            return { node, depth };
        });

        // Find the deepest level (highest depth number) - collapse from deepest first
        const maxDepth = Math.max(...nodeDepths.map(nd => nd.depth));
        const deepestNodes = nodeDepths.filter(nd => nd.depth === maxDepth).map(nd => nd.node);

        // Collapse all nodes at the deepest level
        deepestNodes.forEach(node => {
            const nodeId = node.id();
            if (!collapsedGraphs.has(nodeId)) {
                this.collapseNode(node, nodeId);
            }
        });

        // Trigger layout refresh
        setTimeout(() => {
            cy.layout({ name: 'preset' }).run();
            // Update button states
            if (typeof window.updateExpandCollapseButtons === 'function') {
                window.updateExpandCollapseButtons();
            }
        }, 10);
    }
}

