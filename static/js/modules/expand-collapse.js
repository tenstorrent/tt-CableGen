/**
 * Expand/Collapse Module - Handles node expand/collapse functionality
 * Manages visibility of compound nodes and edge rerouting when nodes are collapsed
 */
export class ExpandCollapseModule {
    constructor(state) {
        this.state = state;
        // Cache for visibility checks to avoid repeated ancestor traversals
        this._visibilityCache = new Map();
        // Debounce timer for layout refreshes
        this._layoutRefreshTimer = null;
        this._curveStylesTimer = null;
        // Counter for unique rerouted edge IDs
        this._reroutedEdgeCounter = 0;
    }

    /**
     * Generate a unique ID for a rerouted edge
     * @param {string} originalEdgeId - The ID of the original edge
     * @returns {string} Unique rerouted edge ID
     */
    _generateReroutedEdgeId(originalEdgeId) {
        this._reroutedEdgeCounter++;
        return `rerouted_${originalEdgeId}_${Date.now()}_${this._reroutedEdgeCounter}_${Math.random().toString(36).substr(2, 9)}`;
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

        // Clear visibility cache since we're changing the graph structure
        this._visibilityCache.clear();

        if (isCollapsed) {
            // Expand: restore children and edges
            this.expandNode(node, nodeId);
        } else {
            // Collapse: hide children and reroute edges
            this.collapseNode(node, nodeId);
        }

        // Debounce layout refresh to avoid multiple recalculations
        this._scheduleLayoutRefresh();

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
        const descendantIds = new Set(descendants.map(d => d.id()));

        // Batch query all edges connected to descendants (more efficient than per-descendant queries)
        // Only include original edges (not rerouted edges) - rerouted edges will be handled separately
        const connectedEdges = this.state.cy.edges().filter(edge => {
            // Skip rerouted edges - they'll be handled via their original edges
            if (edge.data('isRerouted')) {
                return false;
            }
            // For original edges, check current endpoints
            const sourceId = edge.data('source');
            const targetId = edge.data('target');
            return descendantIds.has(sourceId) || descendantIds.has(targetId);
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

        // Batch DOM operations
        this.state.cy.startBatch();
        
        // Hide children (use display: none for shrinking visualization)
        node.children().forEach(child => {
            child.style('display', 'none');
        });

        // Store rerouting data (for reference, but recalculateAllEdgeRouting will handle everything)
        this.state.ui.edgeRerouting.set(nodeId, edgeReroutingData);
        node.addClass('collapsed-node');
        this.state.ui.collapsedGraphs.add(nodeId);
        this.state.ui.expandedGraphs.delete(nodeId);

        this.state.cy.endBatch();

        // Only recalculate edges affected by this collapse (not all edges)
        this.recalculateAffectedEdgeRouting(connectedEdges, collapsedNodeIds);
    }

    /**
     * Expand a node: restore children and recalculate edge routing
     * @param {Object} node - The node to expand
     * @param {string} nodeId - The node ID
     */
    expandNode(node, nodeId) {
        // Get edges that were affected by this collapse (if any)
        const edgeReroutingData = this.state.ui.edgeRerouting.get(nodeId);
        const affectedOriginalEdges = edgeReroutingData ? edgeReroutingData.originalEdges : [];

        // Also find any rerouted edges that were created for these original edges
        const affectedReroutedEdges = [];
        if (affectedOriginalEdges.length > 0) {
            affectedOriginalEdges.forEach(originalEdge => {
                const reroutedEdges = this.state.cy.edges(`[originalEdgeId="${originalEdge.id()}"]`);
                reroutedEdges.forEach(re => affectedReroutedEdges.push(re));
            });
        }

        // Combine original and rerouted edges for recalculation
        const allAffectedEdges = [...affectedOriginalEdges, ...affectedReroutedEdges];

        // Batch DOM operations
        this.state.cy.startBatch();

        // First, explicitly remove any rerouted edges that were created for this node's collapse
        // This ensures we start clean before recalculating
        if (affectedOriginalEdges.length > 0) {
            affectedOriginalEdges.forEach(originalEdge => {
                const reroutedEdges = this.state.cy.edges(`[originalEdgeId="${originalEdge.id()}"]`);
                reroutedEdges.forEach(re => re.remove());
            });
        }

        // Restore children (display: element for shrinking visualization)
        node.children().forEach(child => {
            child.style('display', 'element');
        });

        // Remove this node from collapsed set
        this.state.ui.collapsedGraphs.delete(nodeId);
        this.state.ui.expandedGraphs.add(nodeId);

        // Remove rerouting data for this node
        this.state.ui.edgeRerouting.delete(nodeId);

        node.removeClass('collapsed-node');

        this.state.cy.endBatch();

        // Recalculate edges that were affected by this expand
        // Include both original edges and any rerouted edges that were created
        const collapsedNodeIds = new Set(this.state.ui.collapsedGraphs);
        if (allAffectedEdges.length > 0) {
            this.recalculateAffectedEdgeRouting(allAffectedEdges, collapsedNodeIds);
        } else {
            // Fallback: recalculate all if we don't have the affected edges cached
            this.recalculateAllEdgeRouting();
        }
    }

    /**
     * Check if a node is actually visible (not hidden by any ancestor)
     * Uses caching to avoid repeated ancestor traversals
     * @param {Object} node - The node to check
     * @returns {boolean} True if node is visible, false if hidden
     */
    isNodeActuallyVisible(node) {
        const nodeId = node.id();
        
        // Check cache first (cache is cleared when graph structure changes)
        if (this._visibilityCache.has(nodeId)) {
            return this._visibilityCache.get(nodeId);
        }

        // Check the node itself
        if (node.style('display') === 'none') {
            this._visibilityCache.set(nodeId, false);
            return false;
        }

        // Check all ancestors - if any ancestor is hidden, this node is hidden
        let ancestor = node.parent();
        while (ancestor && ancestor.length > 0) {
            const ancestorId = ancestor.id();
            
            // Check cache for ancestor
            if (this._visibilityCache.has(ancestorId)) {
                const ancestorVisible = this._visibilityCache.get(ancestorId);
                this._visibilityCache.set(nodeId, ancestorVisible);
                return ancestorVisible;
            }
            
            if (ancestor.style('display') === 'none') {
                this._visibilityCache.set(nodeId, false);
                this._visibilityCache.set(ancestorId, false);
                return false;
            }
            ancestor = ancestor.parent();
        }

        // Node is visible - cache result
        this._visibilityCache.set(nodeId, true);
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
     * Recalculate edge routing for a specific set of affected edges
     * More efficient than recalculating all edges
     * @param {Array} affectedEdges - Array of edges that need recalculation
     * @param {Set} collapsedNodeIds - Set of currently collapsed node IDs
     */
    recalculateAffectedEdgeRouting(affectedEdges, collapsedNodeIds) {
        if (!affectedEdges || affectedEdges.length === 0) {
            return;
        }

        // Batch DOM operations
        this.state.cy.startBatch();

        const processedOriginalEdges = new Set();
        const processedReroutedEdges = new Set();

        affectedEdges.forEach((edge) => {
            // Handle rerouted edges separately - they need to be recalculated based on their original endpoints
            if (edge.data('isRerouted')) {
                // Skip if already processed
                if (processedReroutedEdges.has(edge.id())) {
                    return;
                }
                processedReroutedEdges.add(edge.id());

                // Get the original edge ID
                const originalEdgeId = edge.data('originalEdgeId');
                if (!originalEdgeId) {
                    return;
                }

                // Mark original edge as processed to avoid double processing
                processedOriginalEdges.add(originalEdgeId);

                // Find the original edge
                const originalEdge = this.state.cy.getElementById(originalEdgeId);
                if (!originalEdge.length) {
                    // Original edge doesn't exist, remove rerouted edge
                    edge.remove();
                    return;
                }

                // Recalculate routing based on original edge
                const routing = this.recalculateEdgeRouting(originalEdge, collapsedNodeIds);

                if (routing.hide) {
                    // Hide original edge and remove rerouted version
                    originalEdge.style('display', 'none');
                    edge.remove();
                } else {
                    const needsRerouting = routing.source !== routing.originalSource ||
                        routing.target !== routing.originalTarget;

                    if (needsRerouting) {
                        // Update rerouted edge endpoints or recreate if needed
                        const currentSource = edge.data('source');
                        const currentTarget = edge.data('target');

                        if (currentSource !== routing.source || currentTarget !== routing.target) {
                            // Endpoints changed, need to recreate rerouted edge
                            originalEdge.style('display', 'none');
                            edge.remove();

                            // Create new rerouted edge
                            let reroutedEdgeId = this._generateReroutedEdgeId(originalEdgeId);
                            // Ensure ID is unique - check if it already exists
                            let attempts = 0;
                            while (this.state.cy.getElementById(reroutedEdgeId).length > 0 && attempts < 10) {
                                reroutedEdgeId = this._generateReroutedEdgeId(originalEdgeId);
                                attempts++;
                            }
                            
                            const reroutedEdgeData = {
                                data: {
                                    id: reroutedEdgeId,
                                    source: routing.source,
                                    target: routing.target,
                                    cable_type: originalEdge.data('cable_type'),
                                    cable_length: originalEdge.data('cable_length'),
                                    connection_number: originalEdge.data('connection_number'),
                                    color: originalEdge.data('color'),
                                    template_name: originalEdge.data('template_name'),
                                    depth: originalEdge.data('depth'),
                                    source_hostname: originalEdge.data('source_hostname'),
                                    destination_hostname: originalEdge.data('destination_hostname'),
                                    originalEdgeId: originalEdgeId,
                                    originalSource: routing.originalSource,
                                    originalTarget: routing.originalTarget,
                                    isRerouted: true
                                },
                                classes: 'connection rerouted-edge'
                            };

                            const sourceNode = this.state.cy.getElementById(routing.source);
                            const targetNode = this.state.cy.getElementById(routing.target);

                            if (sourceNode.length && targetNode.length) {
                                const reroutedEdge = this.state.cy.add(reroutedEdgeData);
                                reroutedEdge.style('display', 'element');
                            }
                        }
                    } else {
                        // No rerouting needed, show original edge and remove rerouted version
                        originalEdge.style('display', 'element');
                        edge.remove();
                    }
                }
                return;
            }

            // Handle original edges
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

                    // Check if there's already a rerouted edge with the same endpoints
                    const existingReroutedWithSameEndpoints = existingRerouted.filter(e => {
                        return e.data('source') === routing.source && 
                               e.data('target') === routing.target;
                    });

                    if (existingReroutedWithSameEndpoints.length > 0) {
                        // Reuse existing rerouted edge - just ensure it's visible
                        existingReroutedWithSameEndpoints[0].style('display', 'element');
                        // Remove any other rerouted edges for this original edge
                        existingRerouted.forEach(e => {
                            if (e.id() !== existingReroutedWithSameEndpoints[0].id()) {
                                e.remove();
                            }
                        });
                    } else {
                        // Remove old rerouted edges (they have different endpoints)
                        existingRerouted.forEach(e => e.remove());

                        // Create new rerouted edge
                        const reroutedEdgeId = this._generateReroutedEdgeId(edge.id());
                        // Ensure ID is unique - check if it already exists
                        let uniqueId = reroutedEdgeId;
                        let attempts = 0;
                        while (this.state.cy.getElementById(uniqueId).length > 0 && attempts < 10) {
                            uniqueId = this._generateReroutedEdgeId(edge.id());
                            attempts++;
                        }
                        
                        const reroutedEdgeData = {
                            data: {
                                id: uniqueId,
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
                    }
                } else {
                    // No rerouting needed, show original edge and remove any rerouted version
                    edge.style('display', 'element');
                    existingRerouted.forEach(e => e.remove());
                }
            }
        });

        this.state.cy.endBatch();

        // Schedule curve styles update (debounced)
        this._scheduleCurveStylesUpdate();
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

        // Batch DOM operations
        this.state.cy.startBatch();

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

                    // Check if there's already a rerouted edge with the same endpoints
                    const existingReroutedWithSameEndpoints = existingRerouted.filter(e => {
                        return e.data('source') === routing.source && 
                               e.data('target') === routing.target;
                    });

                    if (existingReroutedWithSameEndpoints.length > 0) {
                        // Reuse existing rerouted edge - just ensure it's visible
                        existingReroutedWithSameEndpoints[0].style('display', 'element');
                        // Remove any other rerouted edges for this original edge
                        existingRerouted.forEach(e => {
                            if (e.id() !== existingReroutedWithSameEndpoints[0].id()) {
                                e.remove();
                            }
                        });
                    } else {
                        // Remove old rerouted edges (they have different endpoints)
                        existingRerouted.forEach(e => e.remove());

                        // Create new rerouted edge
                        const reroutedEdgeId = this._generateReroutedEdgeId(edge.id());
                        // Ensure ID is unique - check if it already exists
                        let uniqueId = reroutedEdgeId;
                        let attempts = 0;
                        while (this.state.cy.getElementById(uniqueId).length > 0 && attempts < 10) {
                            uniqueId = this._generateReroutedEdgeId(edge.id());
                            attempts++;
                        }
                        
                        const reroutedEdgeData = {
                            data: {
                                id: uniqueId,
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
                    }
                } else {
                    // No rerouting needed, show original edge and remove any rerouted version
                    edge.style('display', 'element');
                    existingRerouted.forEach(e => e.remove());
                }
            }
        });

        this.state.cy.endBatch();

        // Schedule curve styles update (debounced)
        this._scheduleCurveStylesUpdate();
    }

    /**
     * Schedule a debounced layout refresh
     * Prevents multiple layout recalculations when multiple operations happen quickly
     */
    _scheduleLayoutRefresh() {
        if (this._layoutRefreshTimer) {
            cancelAnimationFrame(this._layoutRefreshTimer);
        }

        this._layoutRefreshTimer = requestAnimationFrame(() => {
            this.state.cy.layout({ name: 'preset' }).run();
            // Update button states
            if (typeof window.updateExpandCollapseButtons === 'function') {
                window.updateExpandCollapseButtons();
            }
            this._layoutRefreshTimer = null;
        });
    }

    /**
     * Schedule a debounced curve styles update
     * Prevents multiple style recalculations when multiple operations happen quickly
     */
    _scheduleCurveStylesUpdate() {
        if (this._curveStylesTimer) {
            clearTimeout(this._curveStylesTimer);
        }

        this._curveStylesTimer = setTimeout(() => {
            if (window.forceApplyCurveStyles && typeof window.forceApplyCurveStyles === 'function') {
                window.forceApplyCurveStyles();
            }
            this._curveStylesTimer = null;
        }, 50); // Reduced from 100ms to 50ms for faster response
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

        // Clear visibility cache before batch operations
        this._visibilityCache.clear();

        // Batch expand: collect all affected edges first, then expand all nodes, then recalculate once
        this._batchExpandNodes(shallowestNodes);

        // Schedule layout refresh (debounced)
        this._scheduleLayoutRefresh();
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

        // Clear visibility cache before batch operations
        this._visibilityCache.clear();

        // Batch collapse: collect all affected edges first, then collapse all nodes, then recalculate once
        this._batchCollapseNodes(deepestNodes);

        // Schedule layout refresh (debounced)
        this._scheduleLayoutRefresh();
    }

    /**
     * Batch collapse multiple nodes efficiently
     * Collects all affected edges first, then collapses all nodes, then recalculates edges once
     * @param {Array} nodes - Array of nodes to collapse
     */
    _batchCollapseNodes(nodes) {
        if (!nodes || nodes.length === 0) {
            return;
        }

        const collapsedGraphs = this.state.ui.collapsedGraphs;
        const allAffectedEdges = new Set();
        const nodesToCollapse = [];

        // First pass: collect all affected edges and prepare nodes for collapse
        nodes.forEach(node => {
            const nodeId = node.id();
            if (collapsedGraphs.has(nodeId)) {
                return; // Already collapsed
            }

            // Get all descendant nodes (children, grandchildren, etc.) including ports
            const descendants = node.descendants();
            const descendantIds = new Set(descendants.map(d => d.id()));

            // Find all edges connected to descendants (original edges)
            const connectedEdges = this.state.cy.edges().filter(edge => {
                const sourceId = edge.data('source');
                const targetId = edge.data('target');
                return descendantIds.has(sourceId) || descendantIds.has(targetId);
            });

            // Also find rerouted edges that point to this node (edges that were rerouted to this collapsed node)
            const reroutedEdgesToNode = this.state.cy.edges().filter(edge => {
                if (!edge.data('isRerouted')) {
                    return false;
                }
                const sourceId = edge.data('source');
                const targetId = edge.data('target');
                return sourceId === nodeId || targetId === nodeId;
            });

            // Add all affected edges to the set
            connectedEdges.forEach(edge => allAffectedEdges.add(edge));
            reroutedEdgesToNode.forEach(edge => allAffectedEdges.add(edge));

            nodesToCollapse.push({ node, nodeId, connectedEdges });
        });

        if (nodesToCollapse.length === 0) {
            return;
        }

        // Build the complete set of collapsed node IDs (including new ones)
        const collapsedNodeIds = new Set(this.state.ui.collapsedGraphs);
        nodesToCollapse.forEach(({ nodeId }) => {
            collapsedNodeIds.add(nodeId);
        });

        // Batch DOM operations: collapse all nodes
        this.state.cy.startBatch();

        nodesToCollapse.forEach(({ node, nodeId, connectedEdges }) => {
            // Store original edge data and rerouted edges
            const edgeReroutingData = {
                originalEdges: connectedEdges,
                reroutedEdges: [],
                edgeMappings: []
            };

            // Hide children (use display: none for shrinking visualization)
            node.children().forEach(child => {
                child.style('display', 'none');
            });

            // Store rerouting data
            this.state.ui.edgeRerouting.set(nodeId, edgeReroutingData);
            node.addClass('collapsed-node');
            this.state.ui.collapsedGraphs.add(nodeId);
            this.state.ui.expandedGraphs.delete(nodeId);
        });

        this.state.cy.endBatch();

        // Recalculate all affected edges with the complete collapsed set
        // Convert Set to Array for the recalculation function
        this.recalculateAffectedEdgeRouting(Array.from(allAffectedEdges), collapsedNodeIds);
    }

    /**
     * Batch expand multiple nodes efficiently
     * Collects all affected edges first, then expands all nodes, then recalculates edges once
     * @param {Array} nodes - Array of nodes to expand
     */
    _batchExpandNodes(nodes) {
        if (!nodes || nodes.length === 0) {
            return;
        }

        const collapsedGraphs = this.state.ui.collapsedGraphs;
        const allAffectedEdges = new Set();
        const nodesToExpand = [];

        // First pass: collect all affected edges from nodes being expanded
        nodes.forEach(node => {
            const nodeId = node.id();
            if (!collapsedGraphs.has(nodeId)) {
                return; // Not collapsed
            }

            // Get edges that were affected by this collapse (if cached)
            const edgeReroutingData = this.state.ui.edgeRerouting.get(nodeId);
            const connectedEdges = edgeReroutingData ? edgeReroutingData.originalEdges : [];

            // If we don't have cached edges, find them by descendants
            if (connectedEdges.length === 0) {
                const descendants = node.descendants();
                const descendantIds = new Set(descendants.map(d => d.id()));
                const foundEdges = this.state.cy.edges().filter(edge => {
                    const sourceId = edge.data('source');
                    const targetId = edge.data('target');
                    return descendantIds.has(sourceId) || descendantIds.has(targetId);
                });
                foundEdges.forEach(edge => allAffectedEdges.add(edge));
            } else {
                connectedEdges.forEach(edge => allAffectedEdges.add(edge));
            }

            nodesToExpand.push({ node, nodeId });
        });

        if (nodesToExpand.length === 0) {
            return;
        }

        // Build the collapsed set after expansion (removing nodes being expanded)
        const collapsedNodeIds = new Set(this.state.ui.collapsedGraphs);
        nodesToExpand.forEach(({ nodeId }) => {
            collapsedNodeIds.delete(nodeId);
        });

        // Batch DOM operations: expand all nodes
        this.state.cy.startBatch();

        nodesToExpand.forEach(({ node, nodeId }) => {
            // Restore children (display: element for shrinking visualization)
            node.children().forEach(child => {
                child.style('display', 'element');
            });

            // Remove this node from collapsed set
            this.state.ui.collapsedGraphs.delete(nodeId);
            this.state.ui.expandedGraphs.add(nodeId);

            // Remove rerouting data for this node
            this.state.ui.edgeRerouting.delete(nodeId);

            node.removeClass('collapsed-node');
        });

        this.state.cy.endBatch();

        // Recalculate all affected edges with the updated collapsed set
        // If we have affected edges, recalculate them; otherwise do full recalculation
        if (allAffectedEdges.size > 0) {
            this.recalculateAffectedEdgeRouting(Array.from(allAffectedEdges), collapsedNodeIds);
        } else {
            // Fallback: full recalculation if we couldn't determine affected edges
            this.recalculateAllEdgeRouting();
        }
    }
}

