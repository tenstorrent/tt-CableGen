/**
 * Hierarchy Module - Functions specific to hierarchy/logical mode
 * Extracted from visualizer.js to separate hierarchy-specific logic
 */
import { LAYOUT_CONSTANTS } from '../config/constants.js';
import { getNodeConfig } from '../config/node-types.js';

export class HierarchyModule {
    constructor(state, commonModule) {
        this.state = state;
        this.common = commonModule;
        /** @type {import('cytoscape').LayoutInstance | null} Running fcose/preset layout; stop before starting a new one. */
        this._hierarchyLayoutRef = null;
    }

    /**
     * Stop any running hierarchy layout (fcose/preset). Call when switching to location mode
     * or before starting a new layout to avoid a frozen visualizer and overlapping layout runs.
     */
    stopLayout() {
        if (this._hierarchyLayoutRef && typeof this._hierarchyLayoutRef.stop === 'function') {
            try {
                this._hierarchyLayoutRef.stop();
                console.log('[hierarchy] Layout stopped (stopLayout)');
            } catch (e) {
                console.warn('[hierarchy] Error stopping layout:', e?.message ?? e);
            }
            this._hierarchyLayoutRef = null;
        }
    }

    /**
     * Build template name path (template hierarchy, not instance hierarchy)
     * Returns template names from the containing template down to the node
     * For the lowest level template, shows node_ref# instead of template name
     * @param {Object} node - Cytoscape shelf or graph node
     * @param {string} containingTemplateName - Template name that contains/defines the connection
     * @returns {string} Template path or empty string
     */
    buildTemplateNamePath(node, containingTemplateName) {
        if (!containingTemplateName) {
            return '';
        }

        // Find the graph node that has the containing template name
        let containingTemplateNode = null;
        let current = node;

        // First, traverse up to find the graph node with the containing template
        while (current && current.length > 0) {
            const currentData = current.data();

            if (currentData.type === 'graph' && currentData.template_name === containingTemplateName) {
                containingTemplateNode = current;
                break;
            }

            const parent = current.parent();
            if (parent && parent.length > 0) {
                current = parent;
            } else {
                break;
            }
        }

        // If we didn't find the containing template, return empty
        if (!containingTemplateNode || !containingTemplateNode.length) {
            return '';
        }

        // Now collect template names from the containing template down to the node
        // Include all templates between the containing template and the node
        // For the lowest level template (shelf's direct parent), show node_ref# instead of template name
        const templateNames = [];
        current = node;

        // Identify the shelf's direct parent (lowest level template) to show node_ref# for it
        let lowestLevelTemplateId = null;
        let nodeRef = null;
        if (current.data('type') === 'shelf') {
            const shelfParent = current.parent();
            if (shelfParent && shelfParent.length > 0 && shelfParent.data('type') === 'graph') {
                lowestLevelTemplateId = shelfParent.id();
                // Get node_ref# (host_index) from the shelf node
                nodeRef = current.data('host_index') ?? current.data('host_id');
                current = shelfParent;
            }
        }

        // Traverse up from node until we reach the containing template node
        // Include all graph nodes with template names
        while (current && current.length > 0 && current.id() !== containingTemplateNode.id()) {
            const currentData = current.data();

            // For graph nodes, use template_name
            if (currentData.type === 'graph') {
                const templateName = currentData.template_name;
                if (templateName && templateName !== containingTemplateName) {
                    // For the lowest level template, show node_ref# instead of template name
                    if (current.id() === lowestLevelTemplateId && nodeRef !== undefined && nodeRef !== null) {
                        templateNames.unshift(String(nodeRef));
                    } else {
                        templateNames.unshift(templateName);
                    }
                }
            }

            // Move to parent
            const parent = current.parent();
            if (parent && parent.length > 0) {
                current = parent;
            } else {
                break;
            }
        }

        return templateNames.length > 0 ? templateNames.join(' › ') : '';
    }

    /**
     * Build instance path with indexing from a node up to root
     * @param {Object} node - Cytoscape node (graph or shelf)
     * @returns {Array<string>} Array of indexed labels like ["[0] root", "[1] parent", "[2] child"]
     */
    buildInstancePathWithIndexing(node) {
        const pathParts = [];
        let current = node;

        // Traverse up the hierarchy, collecting graph instance labels
        while (current && current.length > 0) {
            const currentData = current.data();

            // For graph nodes, use child_name or label
            if (currentData.type === 'graph') {
                const label = currentData.child_name || currentData.label;
                if (label) {
                    pathParts.unshift(label);
                }
            }
            // For shelf nodes, use child_name if available
            else if (currentData.type === 'shelf' && currentData.child_name) {
                pathParts.unshift(currentData.child_name);
            }

            // Move to parent
            const parent = current.parent();
            if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                current = parent;
            } else {
                // Reached root level - include root graph if it's a graph
                if (current.data('type') === 'graph') {
                    const rootLabel = current.data('child_name') || current.data('label');
                    if (rootLabel && !pathParts.includes(rootLabel)) {
                        pathParts.unshift(rootLabel);
                    }
                }
                break;
            }
        }

        // Add indexing: [0], [1], [2], etc.
        return pathParts.map((label, index) => `[${index}]${label}`);
    }

    /**
     * Get hierarchical path for a node
     * @param {Object} node - Cytoscape node
     * @returns {Array<string>} Array of node IDs representing the path from root to node
     */
    getPath(node) {
        const path = [];
        let current = node;

        while (current && current.length > 0) {
            path.unshift(current.id());
            const parent = current.parent();
            if (parent.length === 0) break;
            current = parent;
        }

        return path;
    }

    /**
     * Find common ancestor graph node between two nodes
     * @param {Object} node1 - First node
     * @param {Object} node2 - Second node
     * @returns {Object|null} Common ancestor graph node or null
     */
    findCommonAncestor(node1, node2) {
        if (!this.state.cy) return null;

        // Get all graph ancestors for node1
        const ancestors1 = [];
        let current = node1.parent();
        while (current && current.length > 0) {
            if (current.isParent() && current.data('type') === 'graph') {
                ancestors1.push(current);
            }
            current = current.parent();
        }

        // Find the first common graph ancestor by traversing node2's parents
        current = node2.parent();
        while (current && current.length > 0) {
            if (current.isParent() && current.data('type') === 'graph') {
                // Check if this ancestor is in node1's ancestor list
                const commonAncestor = ancestors1.find(a => a.id() === current.id());
                if (commonAncestor) {
                    return commonAncestor;  // Return the lowest (first found) common ancestor
                }
            }
            current = current.parent();
        }

        return null;  // No common graph ancestor
    }

    /**
     * Find the parent shelf or graph node for a given node (e.g., port, tray)
     * @param {Object} node - Starting node (could be port, tray, etc.)
     * @returns {Object|null} Parent shelf or graph node, or null if not found
     */
    findParentShelfOrGraph(node) {
        if (!node || node.length === 0) return null;

        let current = node;
        while (current && current.length > 0) {
            const nodeType = current.data('type');
            if (nodeType === 'shelf' || nodeType === 'graph') {
                return current;
            }
            current = current.parent();
        }

        return null;
    }

    /**
     * Get parent node at a specific level
     * @param {Object} node - Starting node
     * @param {number} level - Level (1 = immediate parent, 2 = grandparent, etc.)
     * @returns {Object|null} Parent node at specified level or null
     */
    getParentAtLevel(node, level) {
        let current = node;
        for (let i = 0; i < level; i++) {
            const parent = current.parent();
            if (parent.length === 0) return null;
            current = parent;
        }
        return current.length > 0 ? current : null;
    }

    /**
     * Recolor connections for logical view using depth-based coloring
     */
    recolorConnections() {
        if (!this.state.cy) return;

        // Depth-based color palette matching the legend
        const depthColors = {
            0: '#E74C3C',  // Red (cluster level)
            1: '#E67E22',  // Orange (superpod level)
            2: '#F1C40F',  // Yellow (pod level)
            3: '#27AE60',  // Green
            4: '#3498DB',  // Blue
            5: '#9B59B6',  // Purple
            6: '#E91E63'   // Magenta/Pink
        };

        this.state.cy.edges().forEach(edge => {
            const depth = edge.data('depth');

            // Use depth-based color if available, otherwise use default
            const color = (depth !== undefined && depthColors[depth]) ? depthColors[depth] : '#888888';

            // Update the edge color
            edge.data('color', color);
        });

        // Force style update to apply color changes
        this.state.cy.style().update();
    }

    /**
     * Extract port pattern from a port node for template-based connections
     * @param {Object} portNode - Cytoscape port node
     * @param {Object|null} placementLevel - Optional graph node representing the placement level
     * @returns {Object|null} Pattern object with path, trayId, and portId, or null
     */
    extractPortPattern(portNode, placementLevel = null) {
        if (!portNode || portNode.data('type') !== 'port') {
            return null;
        }

        const portId = portNode.id();

        // Find parent shelf
        let current = portNode.parent();
        let shelf = null;
        while (current && current.length > 0) {
            if (current.data('type') === 'shelf') {
                shelf = current;
                break;
            }
            current = current.parent();
        }

        if (!shelf) {
            return null;
        }

        // Extract tray and port numbers from port ID
        // Descriptor format: {host_id}:t{trayNum}:p{portNum} (e.g., "0:t1:p3")
        const match = portId.match(/:t(\d+):p(\d+)$/);
        if (!match) {
            return null;
        }

        const trayId = parseInt(match[1]);
        const portIdNum = parseInt(match[2]);

        // If no placement level specified, return just shelf name
        if (!placementLevel) {
            const shelfName = shelf.data('child_name') || shelf.data('label');
            return {
                shelfName: shelfName,
                trayId: trayId,
                portId: portIdNum
            };
        }

        // Build hierarchical path from placement level to shelf
        const path = [];
        current = shelf;

        // Walk up the hierarchy until we reach the placement level
        while (current && current.length > 0 && current.id() !== placementLevel.id()) {
            const nodeName = current.data('child_name') || current.data('label');
            // Ensure nodeName is a string, not an object reference
            // This prevents circular references from ending up in path arrays
            if (nodeName) {
                const nodeNameStr = typeof nodeName === 'string' ? nodeName : String(nodeName);
                if (nodeNameStr && nodeNameStr !== '[Circular Reference]') {
                    path.unshift(nodeNameStr); // Add to beginning to maintain top-down order
                }
            }
            current = current.parent();
        }

        // If we didn't reach the placement level, the port is not a descendant
        if (!current || current.length === 0 || current.id() !== placementLevel.id()) {
            return null;
        }

        const result = {
            path: path,
            trayId: trayId,
            portId: portIdNum
        };

        return result;
    }

    /**
     * Find a port node by traversing a hierarchical path from a graph node
     * @param {Object} graphNode - Starting graph node
     * @param {Array<string>} path - Array of node names representing the path
     * @param {number} trayId - Tray ID number
     * @param {number} portId - Port ID number
     * @returns {Object|null} Port node or null if not found
     */
    findPortByPath(graphNode, path, trayId, portId) {
        let current = graphNode;

        // Follow the path through the hierarchy
        for (let i = 0; i < path.length; i++) {
            const nodeName = path[i];

            // Find child with matching name
            const children = current.children();
            const matchingChild = children.filter(child => {
                const childName = child.data('child_name') || child.data('label');
                return childName === nodeName;
            });

            if (matchingChild.length === 0) {
                console.warn(`[findPortByPath] Could not find child "${nodeName}" in ${current.id()}`);
                return null;
            }

            current = matchingChild[0];
        }

        // Current should now be the shelf node
        if (current.data('type') !== 'shelf') {
            console.warn(`[findPortByPath] Expected shelf node, got ${current.data('type')}`);
            return null;
        }

        // Find the port within this shelf using descriptor format
        // Descriptor format: {shelf_id}:t{trayId}:p{portId}
        let portNode = this.state.cy.getElementById(`${current.id()}:t${trayId}:p${portId}`);

        if (!portNode || portNode.length === 0) {
            // Fallback: find by navigating parent-child relationships
            // (works regardless of ID format)
            const trays = current.children('[type="tray"]');
            const tray = trays.filter(t => t.data('tray') === trayId);
            if (tray.length > 0) {
                const ports = tray.children('[type="port"]');
                portNode = ports.filter(p => p.data('port') === portId);
            }
        }

        if (!portNode || portNode.length === 0) {
            console.warn(`[findPortByPath] Could not find port with tray=${trayId}, port=${portId} in ${current.id()}`);
            return null;
        }

        return portNode;
    }

    /**
     * Resolve a path array to a node ID using the path mapping
     * @param {Array} path - Array of path segments (e.g., ["node_0", "child_1"])
     * @param {Object} pathMapping - Maps child names to their full node IDs
     * @returns {string|null} Node ID or null if not found
     */
    resolvePathInMapping(path, pathMapping) {
        if (!path || path.length === 0) {
            return null;
        }

        // For single-element paths, try direct lookup first
        if (path.length === 1) {
            const directMatch = pathMapping[path[0]];
            if (directMatch) {
                return directMatch;
            }

            // If not found, try stripping index suffix (e.g., "dim1.5_0" -> "dim1.5")
            // This handles cases where connections use instance names but pathMapping uses template child names
            const pathSegment = path[0];
            const indexMatch = pathSegment.match(/^(.+)_(\d+)$/);
            if (indexMatch) {
                const baseName = indexMatch[1];
                return pathMapping[baseName] || null;
            }
            return null;
        }

        // For nested paths, join with dots (e.g., "node1.n300_lb")
        // This matches how we store nested paths in the pathMapping during instantiation
        const fullPath = path.join('.');
        const directMatch = pathMapping[fullPath];
        if (directMatch) {
            return directMatch;
        }

        // Try resolving step by step: first resolve the parent, then look for child within that parent
        // This handles cases where the pathMapping might have the graph node ID but not the full nested path
        if (path.length >= 2) {
            const parentPath = path.slice(0, -1);
            const childName = path[path.length - 1];

            // Try to resolve parent as a graph node
            const parentId = this.resolvePathInMapping(parentPath, pathMapping);
            if (parentId) {
                // Parent is a graph node, look for child within it
                const parentNode = this.state.cy.getElementById(parentId);
                if (parentNode && parentNode.length > 0) {
                    // Look for child node within parent
                    const children = parentNode.children();
                    for (let i = 0; i < children.length; i++) {
                        const child = children[i];
                        const childData = child.data();
                        // Check if this child matches by child_name, original_name, or label
                        const childChildName = childData.child_name;
                        const childOriginalName = childData.original_name;
                        const childLabel = childData.label;

                        if (childChildName === childName ||
                            childOriginalName === childName ||
                            childLabel === childName ||
                            (childLabel && childLabel.startsWith(childName + ' '))) {
                            return childData.id;
                        }
                    }
                }
            }
        }

        // Try stripping index suffixes from each path segment
        // e.g., "dim_1.5_0.node_0" -> "dim_1.5.node_0"
        const normalizedPath = path.map(segment => {
            const indexMatch = segment.match(/^(.+)_(\d+)$/);
            return indexMatch ? indexMatch[1] : segment;
        });
        const normalizedFullPath = normalizedPath.join('.');
        const normalizedMatch = pathMapping[normalizedFullPath];
        if (normalizedMatch) {
            return normalizedMatch;
        }

        // Try alternative normalization: replace underscores with nothing in first segment
        // This handles cases like "dim_1.5" vs "dim1.5" (template name format differences)
        if (normalizedPath.length > 0) {
            const firstSegment = normalizedPath[0];
            // Try removing underscores: "dim_1.5" -> "dim1.5"
            const altFirstSegment = firstSegment.replace(/_/g, '');
            if (altFirstSegment !== firstSegment) {
                const altPath = [altFirstSegment, ...normalizedPath.slice(1)];
                const altFullPath = altPath.join('.');
                const altMatch = pathMapping[altFullPath];
                if (altMatch) {
                    return altMatch;
                }
            }

            // Also try the reverse: add underscores if missing (less common but possible)
            // Check if any pathMapping key matches when we add underscores
            const keys = Object.keys(pathMapping);
            for (const key of keys) {
                const keySegments = key.split('.');
                if (keySegments.length === normalizedPath.length) {
                    // Check if first segment matches when we normalize underscores
                    const keyFirst = keySegments[0];
                    const pathFirst = normalizedPath[0];
                    // Try both directions: key might have underscores, path might not, or vice versa
                    if (keyFirst.replace(/_/g, '') === pathFirst.replace(/_/g, '')) {
                        // First segments match when normalized, check rest
                        let matches = true;
                        for (let i = 1; i < keySegments.length; i++) {
                            if (keySegments[i] !== normalizedPath[i]) {
                                matches = false;
                                break;
                            }
                        }
                        if (matches) {
                            return pathMapping[key];
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Process deferred connections that were created during template instantiation
     * 
     * IMPORTANT: Applies template connections to ALL instances of the template, not just
     * the one being instantiated. This ensures all instances of the same template have
     * identical connections, matching the template definition.
     * 
     * @param {Array} deferredConnections - Array of deferred connection objects
     * @param {Array} edgesToAdd - Array to accumulate edges
     */
    processDeferredConnections(deferredConnections, edgesToAdd) {
        deferredConnections.forEach(deferred => {
            const { graphLabel: _graphLabel, connections, pathMapping, templateName } = deferred;

            // Find ALL instances of this template (not just the one being instantiated)
            const allTemplateInstances = this.state.cy.nodes().filter(node =>
                node.data('type') === 'graph' && node.data('template_name') === templateName
            );

            if (allTemplateInstances.length === 0) {
                return;
            }

            // Process each connection from the template
            connections.forEach((conn, connIndex) => {
                try {
                    // Extract the connection pattern from the instance that was just created
                    // This uses the pathMapping from that specific instance
                    const sourcePath = conn.port_a.path;
                    const targetPath = conn.port_b.path;

                    // Resolve paths in the original instance's pathMapping to get the pattern
                    const sourceNodeId = this.resolvePathInMapping(sourcePath, pathMapping);
                    const targetNodeId = this.resolvePathInMapping(targetPath, pathMapping);

                    if (!sourceNodeId || !targetNodeId) {
                        return;
                    }

                    // Get the shelf nodes from the original instance to extract the pattern
                    const sourceShelfNode = this.state.cy.getElementById(sourceNodeId);
                    const targetShelfNode = this.state.cy.getElementById(targetNodeId);

                    if (!sourceShelfNode || sourceShelfNode.length === 0 || !targetShelfNode || targetShelfNode.length === 0) {
                        return;
                    }

                    // Extract the pattern: child names and port positions relative to template
                    // The paths in conn.port_a.path and conn.port_b.path are already template-relative
                    // We need to find the corresponding ports in each instance using these paths

                    // Determine connection color based on container template
                    const connectionColor = this.common.getTemplateColor(templateName);

                    // Apply this connection pattern to ALL instances of the template
                    let _createdCount = 0;
                    let _skippedCount = 0;

                    allTemplateInstances.forEach(instanceGraph => {
                        // Find ports in this instance using the template-relative paths
                        const sourcePortNode = this.findPortByPath(
                            instanceGraph,
                            sourcePath,
                            conn.port_a.tray_id,
                            conn.port_a.port_id
                        );
                        const targetPortNode = this.findPortByPath(
                            instanceGraph,
                            targetPath,
                            conn.port_b.tray_id,
                            conn.port_b.port_id
                        );

                        if (!sourcePortNode || !targetPortNode) {
                            _skippedCount++;
                            return;
                        }

                        // Check if ports already have connections in Cytoscape (skip if they do)
                        const sourcePortConnections = this.state.cy.edges().filter(e =>
                            (e.data('source') === sourcePortNode.id() || e.data('target') === sourcePortNode.id())
                        );
                        const targetPortConnections = this.state.cy.edges().filter(e =>
                            (e.data('source') === targetPortNode.id() || e.data('target') === targetPortNode.id())
                        );

                        if (sourcePortConnections.length > 0 || targetPortConnections.length > 0) {
                            _skippedCount++;
                            return;
                        }

                        // Also check if this connection is already in edgesToAdd to prevent duplicates
                        const sourcePortId = sourcePortNode.id();
                        const targetPortId = targetPortNode.id();
                        const alreadyInBatch = edgesToAdd.some(e => {
                            const eSource = e.data.source;
                            const eTarget = e.data.target;
                            return (eSource === sourcePortId && eTarget === targetPortId) ||
                                (eSource === targetPortId && eTarget === sourcePortId);
                        });

                        if (alreadyInBatch) {
                            _skippedCount++;
                            return;
                        }

                        // Create edge for this instance
                        const edgeId = `${instanceGraph.id()}_conn_${connIndex}`;
                        const edge = {
                            data: {
                                id: edgeId,
                                source: sourcePortNode.id(),
                                target: targetPortNode.id(),
                                cableType: conn.cable_type || 'QSFP_DD',
                                cableLength: 'Unknown',
                                color: connectionColor,
                                containerTemplate: templateName,
                                template_name: templateName,  // Template where this connection is defined
                                depth: instanceGraph.data('depth') || 0
                            }
                        };
                        edgesToAdd.push(edge);
                        _createdCount++;
                    });

                } catch (error) {
                    console.error(`[processDeferredConnections] Error creating connection ${connIndex} for template "${templateName}":`, error, conn);
                }
            });
        });
    }

    /**
     * Recursively instantiate a graph template with all its children and connections
     * @param {Object} template - The template structure
     * @param {string} templateName - The template name (for graph_ref lookups)
     * @param {string} graphId - The ID for this graph instance
     * @param {string} graphLabel - The label for this graph instance
     * @param {string} graphType - The type (superpod, pod, cluster, etc.)
     * @param {string|null} parentId - The parent node ID (null for top-level)
     * @param {number} baseX - Base X position
     * @param {number} baseY - Base Y position
     * @param {Array} nodesToAdd - Array to accumulate nodes
     * @param {Array} edgesToAdd - Array to accumulate edges
     * @param {Object} pathMapping - Maps child names to their full node IDs for connection resolution
     * @param {Array} deferredConnections - Array to defer connection creation until all nodes exist
     * @param {string|null} childName - Optional child name for template-level operations
     * @param {number} parentDepth - Depth of parent node (-1 for root)
     */
    instantiateTemplate(template, templateName, graphId, graphLabel, graphType, parentId, baseX, baseY, nodesToAdd, edgesToAdd, pathMapping, deferredConnections, childName = null, parentDepth = -1) {
        // Create the graph container node
        // Calculate depth for hierarchy tracking
        const depth = parentDepth + 1;

        // Get template-based color
        const templateColor = this.common.getTemplateColor(templateName);

        const graphNode = {
            data: {
                id: graphId,
                label: graphLabel,
                type: graphType,
                template_name: templateName,
                parent: parentId,
                depth: depth,  // Keep depth for hierarchy tracking
                child_name: childName || graphLabel,  // Store child_name for template-level operations
                templateColor: templateColor  // Store template color for explicit styling
            },
            position: { x: baseX, y: baseY },
            classes: 'graph'
        };
        nodesToAdd.push(graphNode);


        // Process children
        if (template.children && template.children.length > 0) {
            // Use temporary positions - hierarchy_calculateLayout() will position everything properly
            // with dynamic, percentage-based spacing

            // Track processed child names to prevent duplicates
            const processedChildren = new Set();

            template.children.forEach((child, index) => {
                // Skip if this child name was already processed (prevent duplicates)
                if (processedChildren.has(child.name)) {
                    console.warn(`Skipping duplicate child "${child.name}" in template "${templateName}"`);
                    return;
                }
                processedChildren.add(child.name);

                const childX = baseX;  // Temporary X
                const childY = baseY + (index * 100);  // Temporary Y with minimal offset
                const childId = `${graphId}_${child.name}`;

                // Update path mapping for connection resolution
                // Add the child to pathMapping BEFORE processing it (so nested graphs are available for path resolution)
                pathMapping[child.name] = childId;
                // Also add mapping using original_name if available (for path resolution compatibility)
                if (child.original_name && child.original_name !== child.name) {
                    pathMapping[child.original_name] = childId;
                }

                if (child.type === 'node') {
                    // Create a shelf node (leaf node)
                    // Preserve the full node type from template (including variations)
                    // getNodeConfig normalizes internally for config lookup
                    let nodeType = child.node_descriptor || 'WH_GALAXY';
                    let config = getNodeConfig(nodeType);

                    if (!config) {
                        console.warn(`Unknown node type: ${nodeType}, using WH_GALAXY as fallback`);
                        nodeType = 'WH_GALAXY';
                        config = getNodeConfig('WH_GALAXY');
                    }

                    // Generate a new globally unique host index
                    const hostIndex = this.state.data.globalHostCounter;
                    this.state.data.globalHostCounter++;

                    // child.name from template is already enumerated (node_0, node_1, etc.)
                    // Format label as "node_X (host_Y)"
                    const displayLabel = `${child.name} (host_${hostIndex})`;

                    // Build logical_path from parent graph hierarchy
                    let logicalPath = [];
                    const parentGraphNode = this.state.cy.getElementById(graphId);
                    if (parentGraphNode && parentGraphNode.length > 0) {
                        // Build logical_path by traversing up the graph hierarchy
                        const pathParts = [];
                        let current = parentGraphNode;
                        while (current && current.length > 0) {
                            const childName = current.data('child_name') || current.data('label');
                            if (childName) {
                                pathParts.unshift(childName);
                            }
                            const parent = current.parent();
                            if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                                current = parent;
                            } else {
                                break;
                            }
                        }
                        logicalPath = pathParts;
                    }

                    const shelfNode = {
                        data: {
                            id: childId,
                            parent: graphId,
                            label: displayLabel,  // Display as "node_0 (host_17)"
                            type: 'shelf',
                            host_index: hostIndex,  // Globally unique host index
                            hostname: child.name,  // Set to child.name (not displayed in logical view)
                            shelf_node_type: nodeType,
                            child_name: child.name,  // Template-local name (node_0, node_1, etc.) for export
                            original_name: child.original_name || child.name,  // Store original name for path resolution
                            logical_path: logicalPath  // Set logical_path for export detection
                        },
                        position: { x: childX, y: childY },
                        classes: 'shelf'
                    };
                    nodesToAdd.push(shelfNode);

                    // Create trays and ports using NodeFactory
                    // Check if trays/ports for this shelf already exist in nodesToAdd to prevent duplicates
                    const existingIds = new Set(nodesToAdd.map(n => n.data && n.data.id).filter(Boolean));
                    const shelfTrayIds = [];
                    for (let trayNum = 1; trayNum <= config.tray_count; trayNum++) {
                        shelfTrayIds.push(`${hostIndex}:t${trayNum}`);
                    }

                    const hasExistingTrays = shelfTrayIds.some(id => existingIds.has(id));
                    if (!hasExistingTrays) {
                        const location = child.name ? { hostname: child.name } : {};
                        const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(childId, hostIndex, nodeType, location);

                        // Add hostname to each node if provided
                        if (child.name) {
                            trayPortNodes.forEach(node => {
                                if (node.data.type === 'tray' || node.data.type === 'port') {
                                    node.data.hostname = child.name;
                                }
                            });
                        }

                        nodesToAdd.push(...trayPortNodes);
                    } else {
                        console.warn(`Trays already exist for shelf ${childId} (host_index: ${hostIndex}), skipping duplicate creation`);
                    }

                } else if (child.type === 'graph') {
                    // Recursively instantiate nested graph
                    const nestedTemplate = this.state.data.availableGraphTemplates[child.graph_template];
                    if (!nestedTemplate) {
                        console.error(`Template not found: ${child.graph_template}`);
                        return;
                    }

                    // All graph template instances have type="graph"
                    const nestedType = 'graph';

                    // Create a new path mapping for the nested scope
                    const nestedPathMapping = {};

                    this.instantiateTemplate(
                        nestedTemplate,
                        child.graph_template,
                        childId,
                        child.name,
                        nestedType,
                        graphId, // parent is current graph
                        childX,
                        childY,
                        nodesToAdd,
                        edgesToAdd,
                        nestedPathMapping,
                        deferredConnections,
                        child.name,  // Pass child_name for template-level operations
                        depth  // Pass current depth as parent depth for nested children
                    );

                    // Merge nested path mapping into current scope with prefix
                    // Use both normalized and original names for compatibility
                    for (const [name, id] of Object.entries(nestedPathMapping)) {
                        // Add with normalized child name
                        const qualifiedName = `${child.name}.${name}`;
                        pathMapping[qualifiedName] = id;

                        // Also add with original child name if different
                        if (child.original_name && child.original_name !== child.name) {
                            const qualifiedNameOriginal = `${child.original_name}.${name}`;
                            pathMapping[qualifiedNameOriginal] = id;
                        }
                    }
                }
            });
        }

        // Defer connection creation until all nodes are instantiated
        // Store the connection data and path mapping for later processing
        if (template.connections && template.connections.length > 0) {
            // Clone the pathMapping for this scope to use later
            const pathMappingCopy = Object.assign({}, pathMapping);

            deferredConnections.push({
                graphId: graphId,
                graphLabel: graphLabel,
                connections: template.connections,
                pathMapping: pathMappingCopy,
                templateName: templateName  // Pass template name for color calculation
            });
        }
    }

    /**
     * Calculate layout for hierarchy mode using dynamic spacing
     */
    calculateLayout() {
        if (!this.state.cy) return;
        console.log('[hierarchy] calculateLayout start');

        // Get all top-level graph nodes (no parent)
        const topLevelNodes = this.state.cy.nodes('[type="graph"]').filter(node => {
            const parent = node.parent();
            return parent.length === 0;
        });

        // Sort by label for consistent ordering
        const sortedTopLevel = topLevelNodes.sort((a, b) => {
            return a.data('label').localeCompare(b.data('label'));
        });

        if (sortedTopLevel.length === 0) return;

        const numNodes = sortedTopLevel.length;
        const collapsedGraphs = this.state.ui?.collapsedGraphs;
        const hasCollapsedInSubtree = (n) => {
            if (!collapsedGraphs || !(collapsedGraphs instanceof Set)) return false;
            if (collapsedGraphs.has(n.id())) return true;
            const descendants = n.descendants();
            for (let i = 0; i < descendants.length; i++) {
                if (collapsedGraphs.has(descendants[i].id())) return true;
            }
            return false;
        };

        // Measurement pass: position each node in a temporary vertical stack so we get accurate per-node dimensions
        const widths = [];
        const heights = [];
        let tempY = LAYOUT_CONSTANTS.TOP_LEVEL_START_Y;
        const spacing = (LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT || 450) * 0.15;
        sortedTopLevel.forEach((node) => {
            node.position({
                x: LAYOUT_CONSTANTS.TOP_LEVEL_START_X,
                y: tempY
            });
            this.common.positionGraphChildren(node);
            const bbox = node.boundingBox();
            let w = (bbox.w || LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT) * 1.15;
            let h = (bbox.h || LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT) * LAYOUT_CONSTANTS.GRAPH_VERTICAL_SPACING_FACTOR;
            if (hasCollapsedInSubtree(node)) {
                w = Math.max(w, LAYOUT_CONSTANTS.COLLAPSED_GRAPH_LAYOUT_MIN_WIDTH);
                h = Math.max(h, LAYOUT_CONSTANTS.COLLAPSED_GRAPH_LAYOUT_MIN_HEIGHT);
            }
            widths.push(w);
            heights.push(h);
            tempY += h + spacing;
        });

        // Choose grid dimensions that make the overall layout as square as possible (minimize max(totalW, totalH))
        // Prefer more rows (stack below) when a node is especially wide to avoid horizontal scrolling
        const findBestGridFromDimensions = (n, ws, hs) => {
            let bestRows = 1;
            let bestCols = n;
            let bestScore = Infinity;
            for (let rows = 1; rows <= n; rows++) {
                const cols = Math.ceil(n / rows);
                const rowHeights = new Array(rows).fill(0);
                const colWidths = new Array(cols).fill(0);
                for (let i = 0; i < n; i++) {
                    const row = i % rows;
                    const col = Math.floor(i / rows);
                    rowHeights[row] = Math.max(rowHeights[row], hs[i]);
                    colWidths[col] = Math.max(colWidths[col], ws[i]);
                }
                const totalW = colWidths.reduce((a, b) => a + b, 0);
                const totalH = rowHeights.reduce((a, b) => a + b, 0);
                const score = Math.max(totalW, totalH);
                if (score < bestScore) {
                    bestScore = score;
                    bestRows = rows;
                    bestCols = cols;
                }
            }
            return { rows: bestRows, cols: bestCols };
        };

        const grid = findBestGridFromDimensions(numNodes, widths, heights);
        const gridRows = grid.rows;
        const gridCols = grid.cols;

        // Build rowHeights and colWidths from chosen grid and stored dimensions
        const rowHeights = new Array(gridRows).fill(0);
        const colWidths = new Array(gridCols).fill(0);
        sortedTopLevel.forEach((node, index) => {
            const row = index % gridRows;
            const col = Math.floor(index / gridRows);
            colWidths[col] = Math.max(colWidths[col], widths[index]);
            rowHeights[row] = Math.max(rowHeights[row], heights[index]);
        });

        // Position nodes in the chosen grid
        sortedTopLevel.forEach((node, index) => {
            const row = index % gridRows;
            const col = Math.floor(index / gridRows);

            let x = LAYOUT_CONSTANTS.TOP_LEVEL_START_X;
            for (let c = 0; c < col; c++) {
                x += colWidths[c];
            }

            let y = LAYOUT_CONSTANTS.TOP_LEVEL_START_Y;
            for (let r = 0; r < row; r++) {
                y += rowHeights[r];
            }

            node.position({ x, y });
            this.common.positionGraphChildren(node);
        });
        console.log('[hierarchy] calculateLayout done');
    }

    /**
     * Switch to hierarchy/logical mode - rebuild visualization from logical topology data only
     */
    switchMode() {
        // Clear all selections (including Cytoscape selections) when switching modes
        if (this.common && typeof this.common.clearAllSelections === 'function') {
            this.common.clearAllSelections();
        }

        // Check if we have saved hierarchy state (from previous hierarchy mode session)
        // If available, extract shelf data from saved state to preserve parent associations
        const hasSavedHierarchyState = this.state.data.hierarchyModeState && this.state.data.hierarchyModeState.elements;

        // Extract shelf nodes - use saved hierarchy state if available, otherwise use current state
        let shelfDataList = [];
        let shelfNodes = null;

        if (hasSavedHierarchyState) {
            // Extract shelf data from saved hierarchy state to preserve parent graph associations
            const savedShelfElements = this.state.data.hierarchyModeState.elements.filter(el =>
                el.data && el.data.type === 'shelf'
            );

            shelfDataList = savedShelfElements.map(shelfEl => {
                const shelfData = shelfEl.data;
                // Find parent graph ID from saved hierarchy state
                let parentGraphId = null;
                if (shelfData.parent) {
                    // Parent ID is stored in the shelf's parent field in the saved state
                    parentGraphId = shelfData.parent;
                }

                return {
                    data: shelfData,
                    classes: shelfEl.classes || [],
                    position: shelfEl.position || { x: 0, y: 0 },
                    parentGraphId: parentGraphId  // Preserve parent graph ID from saved state
                };
            });

            console.log(`[switchMode] Extracted ${shelfDataList.length} shelf nodes from saved hierarchyModeState`);
        } else {
            // No saved hierarchy state - extract from current Cytoscape state
            shelfNodes = this.state.cy.nodes('[type="shelf"]');
            if (shelfNodes.length === 0) {
                console.warn('No shelf nodes found');
                return;
            }

            // Extract all relevant data from shelf nodes (preserve ALL fields for round-trip)
            shelfNodes.forEach(node => {
                const data = node.data();
                // Get all data fields - keep everything for round-trip compatibility
                const shelfData = {};
                for (const key in data) {
                    shelfData[key] = data[key];
                }

                // CRITICAL: Preserve parent graph ID for proper restoration
                // Find the parent graph node to preserve its ID
                let parentGraphId = null;
                const parent = node.parent();
                if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                    parentGraphId = parent.id();
                }

                shelfDataList.push({
                    data: shelfData,
                    classes: node.classes(),
                    position: node.position(),
                    parentGraphId: parentGraphId  // Preserve parent graph ID for restoration
                });
            });
        }

        if (shelfDataList.length === 0) {
            console.warn('No shelf nodes found');
            return;
        }

        // Check if there are already root-level graph nodes (from textproto import or existing hierarchy)
        // If root graphs exist, we should NOT create extracted_topology
        const existingRootGraphs = this.state.cy.nodes('[type="graph"]').filter(node => {
            const parent = node.parent();
            return parent.length === 0; // Root level (no parent)
        });

        // Extract all tray and port data (preserve the full hierarchy structure)
        const trayPortData = [];

        if (hasSavedHierarchyState) {
            // Extract tray and port data from saved hierarchy state
            const savedTrayElements = this.state.data.hierarchyModeState.elements.filter(el =>
                el.data && el.data.type === 'tray'
            );
            const savedPortElements = this.state.data.hierarchyModeState.elements.filter(el =>
                el.data && el.data.type === 'port'
            );

            // Group trays by shelf_id
            const traysByShelf = {};
            savedTrayElements.forEach(trayEl => {
                const shelfId = trayEl.data.parent;
                if (!traysByShelf[shelfId]) {
                    traysByShelf[shelfId] = [];
                }
                traysByShelf[shelfId].push(trayEl);
            });

            // Group ports by tray parent
            const portsByTray = {};
            savedPortElements.forEach(portEl => {
                const trayId = portEl.data.parent;
                if (!portsByTray[trayId]) {
                    portsByTray[trayId] = [];
                }
                portsByTray[trayId].push(portEl);
            });

            // Build trayPortData structure
            Object.keys(traysByShelf).forEach(shelfId => {
                traysByShelf[shelfId].forEach(trayEl => {
                    const trayId = trayEl.data.id;
                    const portsList = (portsByTray[trayId] || []).map(portEl => ({
                        data: portEl.data,
                        classes: portEl.classes || [],
                        position: portEl.position || { x: 0, y: 0 }
                    }));

                    trayPortData.push({
                        shelf_id: shelfId,
                        tray_data: trayEl.data,
                        tray_classes: trayEl.classes || [],
                        tray_position: trayEl.position || { x: 0, y: 0 },
                        ports: portsList
                    });
                });
            });
        } else {
            // Extract from current Cytoscape state
            shelfNodes.forEach(shelfNode => {
                const trays = shelfNode.children('[type="tray"]');
                trays.forEach(tray => {
                    const trayData = tray.data();
                    const trayClasses = tray.classes();
                    const trayPosition = tray.position();
                    const ports = tray.children('[type="port"]');
                    const portsList = [];
                    ports.forEach(port => {
                        // Preserve all port data
                        const portData = {};
                        const portDataObj = port.data();
                        for (const key in portDataObj) {
                            portData[key] = portDataObj[key];
                        }
                        portsList.push({
                            data: portData,
                            classes: port.classes(),
                            position: port.position()
                        });
                    });

                    // Preserve all tray data
                    const trayDataCopy = {};
                    for (const key in trayData) {
                        trayDataCopy[key] = trayData[key];
                    }

                    trayPortData.push({
                        shelf_id: shelfNode.id(),
                        tray_data: trayDataCopy,
                        tray_classes: trayClasses,
                        tray_position: trayPosition,
                        ports: portsList
                    });
                });
            });
        }

        // Extract only original (port-to-port) connections; never include rerouted edges (they reference collapsed graph nodes)
        const connections = [];
        if (hasSavedHierarchyState) {
            const savedEdgeElements = this.state.data.hierarchyModeState.elements.filter(el => {
                if (!el.data || !el.data.source || !el.data.target) return false;
                if (el.data.isRerouted === true) return false;
                if (typeof el.data.id === 'string' && el.data.id.startsWith('rerouted_')) return false;
                return true;
            });
            connections.push(...savedEdgeElements.map(edgeEl => ({
                data: edgeEl.data,
                classes: edgeEl.classes || []
            })));
        } else {
            this.state.cy.edges().forEach(edge => {
                if (edge.data('isRerouted') === true) return;
                const edgeId = edge.data('id') || edge.id();
                if (typeof edgeId === 'string' && edgeId.startsWith('rerouted_')) return;
                const edgeData = {};
                const data = edge.data();
                for (const key in data) {
                    edgeData[key] = data[key];
                }
                connections.push({
                    data: edgeData,
                    classes: edge.classes()
                });
            });
        }

        // Extract existing graph nodes if they exist (before clearing)
        // This handles the case where we're switching modes but already have a hierarchy structure
        const existingGraphNodes = [];
        if (existingRootGraphs.length > 0) {
            // Extract all graph nodes (not just roots) to preserve the hierarchy
            this.state.cy.nodes('[type="graph"]').forEach(graphNode => {
                const graphData = {};
                const data = graphNode.data();
                for (const key in data) {
                    graphData[key] = data[key];
                }
                existingGraphNodes.push({
                    data: graphData,
                    classes: graphNode.classes(),
                    position: graphNode.position(),
                    parentId: graphNode.parent().length > 0 ? graphNode.parent().id() : null
                });
            });
        }

        // Clear the entire graph (batch with add below for performance)
        this.state.cy.startBatch();
        this.state.cy.elements().remove();

        // Rebuild visualization based ONLY on logical topology data
        const newElements = [];
        const graphNodeMap = {}; // Maps logical path strings to graph node IDs
        const graphNodeIdMap = {}; // Map old IDs to new IDs (for parent-child lookups)

        // Check if we have logical topology information OR existing root graphs
        // If root graphs exist, we should rebuild using existing structure, not create extracted_topology
        const hasLogicalTopology = shelfDataList.some(shelfInfo =>
            shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0
        ) || existingRootGraphs.length > 0;

        // Track if we're creating extracted_topology template (for connection tagging)
        // Template name: "extracted_topology", Instance name: "extracted_topology_0"
        let rootTemplateName = null;
        let rootGraphId = null; // Track root graph ID for metadata updates

        if (hasLogicalTopology) {
            // Find and recreate the root node from saved hierarchy state OR existing graph nodes
            // The root is not in logical_path arrays since those only store parent paths
            let rootNode = null;

            // First, try to use existing graph nodes if they exist (from textproto import)
            if (existingGraphNodes.length > 0) {
                // Recreate all graph nodes from existing structure

                // First, recreate root graphs
                existingGraphNodes.filter(g => g.parentId === null).forEach(graphInfo => {
                    const graphData = graphInfo.data;
                    const rootGraphId = graphData.id;
                    const rootTemplateColor = this.common.getTemplateColor(graphData.template_name);

                    newElements.push({
                        data: {
                            id: rootGraphId,
                            label: graphData.label,
                            type: 'graph',
                            template_name: graphData.template_name,
                            child_name: graphData.child_name || graphData.label,
                            parent: null,
                            depth: graphData.depth || 0,
                            templateColor: rootTemplateColor
                        },
                        classes: graphInfo.classes || 'graph'
                    });

                    graphNodeIdMap[rootGraphId] = rootGraphId;
                    if (graphData.label) {
                        graphNodeMap[graphData.label] = rootGraphId;
                    }
                    if (!rootNode) {
                        rootNode = graphData; // Use first root as the primary root
                    }
                });

                // Then, recreate non-root graph nodes
                existingGraphNodes.filter(g => g.parentId !== null).forEach(graphInfo => {
                    const graphData = graphInfo.data;
                    const graphId = graphData.id;
                    const parentId = graphNodeIdMap[graphInfo.parentId] || graphInfo.parentId;
                    const templateColor = this.common.getTemplateColor(graphData.template_name);

                    newElements.push({
                        data: {
                            id: graphId,
                            label: graphData.label,
                            type: 'graph',
                            template_name: graphData.template_name,
                            child_name: graphData.child_name || graphData.label,
                            parent: parentId,
                            depth: graphData.depth || 0,
                            templateColor: templateColor
                        },
                        classes: graphInfo.classes || 'graph'
                    });

                    graphNodeIdMap[graphId] = graphId;
                    if (graphData.label) {
                        graphNodeMap[graphData.label] = graphId;
                    }
                });
            } else if (this.state.data.hierarchyModeState && this.state.data.hierarchyModeState.elements) {
                // Restore ALL graph instances from saved hierarchy state
                // This preserves all instances including multiple instances of the same template
                const savedGraphNodes = this.state.data.hierarchyModeState.elements.filter(el =>
                    el.data && el.data.type === 'graph'
                );

                // Sort by depth to ensure parents are created before children
                savedGraphNodes.sort((a, b) => {
                    const depthA = a.data.depth || 0;
                    const depthB = b.data.depth || 0;
                    if (depthA !== depthB) {
                        return depthA - depthB;
                    }
                    // If same depth, ensure root nodes (no parent) come first
                    const hasParentA = a.data.parent ? 1 : 0;
                    const hasParentB = b.data.parent ? 1 : 0;
                    return hasParentA - hasParentB;
                });

                // Create a map of all graph IDs for parent validation
                const savedGraphIdMap = new Map();
                savedGraphNodes.forEach(graphEl => {
                    savedGraphIdMap.set(graphEl.data.id, graphEl);
                });

                // First pass: Restore all graph nodes preserving their IDs and relationships
                const restoredGraphElements = [];
                savedGraphNodes.forEach(graphEl => {
                    const graphData = graphEl.data;
                    const graphId = graphData.id;
                    const templateColor = this.common.getTemplateColor(graphData.template_name);

                    // Validate parent ID exists in saved graph nodes
                    let parentId = graphData.parent || null;
                    if (parentId && !savedGraphIdMap.has(parentId)) {
                        console.warn(`[switchMode] Graph instance ${graphId} has invalid parent ID ${parentId}, setting to null`);
                        parentId = null;
                    }

                    const graphElement = {
                        data: {
                            id: graphId,
                            label: graphData.label,
                            type: 'graph',
                            template_name: graphData.template_name,
                            child_name: graphData.child_name || graphData.label,
                            parent: parentId,
                            depth: graphData.depth || 0,
                            templateColor: templateColor
                        },
                        classes: graphEl.classes || 'graph'
                    };

                    restoredGraphElements.push(graphElement);
                    newElements.push(graphElement);

                    // Map graph ID for parent-child lookups
                    graphNodeIdMap[graphId] = graphId;
                    if (graphData.label) {
                        graphNodeMap[graphData.label] = graphId;
                    }

                    // Track root node
                    if (!parentId && !rootNode) {
                        rootNode = graphData;
                    }
                });

                // Second pass: Build logical paths for all restored graph nodes and populate graphNodeMap
                // This is needed for node association logic that uses logical_path
                restoredGraphElements.forEach(graphEl => {
                    const graphData = graphEl.data;
                    const graphId = graphData.id;

                    // Build logical path by traversing up the parent chain
                    const pathParts = [];
                    let currentGraph = graphEl;

                    while (currentGraph && currentGraph.data) {
                        const label = currentGraph.data.child_name || currentGraph.data.label;
                        if (label) {
                            pathParts.unshift(label);
                        }

                        // Find parent in restoredGraphElements
                        if (currentGraph.data.parent) {
                            const parentEl = restoredGraphElements.find(e =>
                                e.data && e.data.id === currentGraph.data.parent && e.data.type === 'graph'
                            );
                            if (parentEl) {
                                currentGraph = parentEl;
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }

                    // Map logical path to graph ID (used by node association logic)
                    if (pathParts.length > 0) {
                        const pathStr = pathParts.join('/');
                        graphNodeMap[pathStr] = graphId;
                    }
                });

                console.log(`[switchMode] Restored ${savedGraphNodes.length} graph instance(s) from hierarchyModeState`);
            } else {
                // No saved hierarchy state - build graph hierarchy from logical paths (fallback)
                const allPaths = new Set();

                // Collect all unique paths from shelf logical_path arrays
                shelfDataList.forEach(shelfInfo => {
                    if (shelfInfo.data.logical_path && Array.isArray(shelfInfo.data.logical_path)) {
                        // Add all parent paths
                        for (let i = 1; i <= shelfInfo.data.logical_path.length; i++) {
                            allPaths.add(shelfInfo.data.logical_path.slice(0, i).join('/'));
                        }
                    }
                });

                // Sort paths by depth (shorter first) to ensure proper parent-child order
                const sortedPaths = Array.from(allPaths).sort((a, b) => {
                    const aDepth = a.split('/').length;
                    const bDepth = b.split('/').length;
                    return aDepth - bDepth || a.localeCompare(b);
                });

                // Create graph nodes for each path
                sortedPaths.forEach((pathStr, _index) => {
                    const pathArray = pathStr.split('/');
                    const depth = pathArray.length; // Depth relative to root
                    const instanceName = pathArray[pathArray.length - 1];

                    // Extract template name from instance name (format: template_name_index)
                    const lastUnderscoreIndex = instanceName.lastIndexOf('_');
                    const templateName = lastUnderscoreIndex > 0 ? instanceName.substring(0, lastUnderscoreIndex) : instanceName;

                    // Get template color
                    const templateColor = this.common.getTemplateColor(templateName);

                    // Determine parent
                    let parentId = null;
                    if (pathArray.length === 1) {
                        // Direct child of root
                        parentId = rootNode ? rootNode.id : null;
                    } else {
                        // Child of another graph node
                        const parentPathStr = pathArray.slice(0, -1).join('/');
                        parentId = graphNodeMap[parentPathStr];
                    }

                    const graphId = `graph_${pathStr.replace(/\//g, '_')}`;
                    graphNodeMap[pathStr] = graphId;

                    newElements.push({
                        data: {
                            id: graphId,
                            label: instanceName,
                            type: 'graph',
                            template_name: templateName,
                            parent: parentId,
                            depth: depth,
                            templateColor: templateColor
                        },
                        classes: 'graph'
                    });
                });
            }

            // Add shelves to their logical parents
            shelfDataList.forEach((shelfInfo, index) => {
                let parentId = null;

                // Priority 1: Use preserved instance path with indexing (most reliable for mode switching)
                if (shelfInfo.instancePath) {
                    // Build instance path from graph nodes in newElements
                    // Match by comparing the path components (without indexing for matching)
                    const shelfPathParts = shelfInfo.instancePath.split('/').map(p => p.replace(/\[\d+\]/g, ''));

                    // Find matching graph node by comparing instance paths
                    for (const el of newElements) {
                        if (el.data && el.data.type === 'graph') {
                            // Build instance path for this graph node
                            const graphPathParts = [];
                            let currentGraph = el;

                            // Traverse up to build path
                            while (currentGraph && currentGraph.data) {
                                const label = currentGraph.data.child_name || currentGraph.data.label;
                                if (label) {
                                    graphPathParts.unshift(label);
                                }

                                // Find parent in newElements
                                if (currentGraph.data.parent) {
                                    const parentEl = newElements.find(e =>
                                        e.data && e.data.id === currentGraph.data.parent && e.data.type === 'graph'
                                    );
                                    if (parentEl) {
                                        currentGraph = parentEl;
                                    } else {
                                        break;
                                    }
                                } else {
                                    break;
                                }
                            }

                            // Compare paths (without indexing)
                            const graphPathPartsClean = graphPathParts.map(p => p.replace(/\[\d+\]/g, ''));
                            if (graphPathPartsClean.length === shelfPathParts.length &&
                                graphPathPartsClean.every((part, idx) => part === shelfPathParts[idx])) {
                                parentId = el.data.id;
                                break;
                            }
                        }
                    }
                }

                // Priority 2: Use preserved parent graph ID (most reliable when restoring from hierarchyModeState)
                if (!parentId && shelfInfo.parentGraphId) {
                    // Check if the parent graph exists in the newly created graph nodes
                    const parentExists = newElements.some(el =>
                        el.data && el.data.id === shelfInfo.parentGraphId && el.data.type === 'graph'
                    );
                    if (parentExists) {
                        parentId = shelfInfo.parentGraphId;
                        console.log(`[switchMode] Associated shelf "${shelfInfo.data.label || shelfInfo.data.id}" with parent graph "${shelfInfo.parentGraphId}" using preserved parentGraphId`);
                    } else {
                        // Parent graph ID doesn't match - try to find by building instance path
                        // Build instance path from the shelf's logical_path to find the correct parent
                        if (shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0) {
                            const parentPathStr = shelfInfo.data.logical_path.join('/');
                            parentId = graphNodeMap[parentPathStr];
                            if (parentId) {
                                console.log(`[switchMode] Associated shelf "${shelfInfo.data.label || shelfInfo.data.id}" with parent graph "${parentId}" using logical_path: ${parentPathStr}`);
                            }
                        }
                    }
                }

                // Priority 3: Use logical_path to find parent (for imported data)
                if (!parentId && shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0) {
                    // Find the parent graph node from logical_path
                    const parentPathStr = shelfInfo.data.logical_path.join('/');
                    parentId = graphNodeMap[parentPathStr];
                }

                // Priority 4: If we have existing graph nodes, try to match by child_name
                if (!parentId && existingGraphNodes.length > 0 && shelfInfo.data.child_name) {
                    // Try to find parent by matching child_name in existing graphs
                    // This is a fallback for cases where logical_path isn't available
                    const matchingGraph = existingGraphNodes.find(g => {
                        const graphData = g.data;
                        return graphData.children && graphData.children.some(child =>
                            child.name === shelfInfo.data.child_name
                        );
                    });
                    if (matchingGraph) {
                        parentId = matchingGraph.data.id;
                    }
                }

                // Format label for hierarchy mode: "child_name (host_index)"
                // This is the standard hierarchy mode format for shelf nodes
                let hierarchyLabel = shelfInfo.data.label; // Default to existing label
                const childName = shelfInfo.data.child_name;
                const hostIndex = shelfInfo.data.host_index;

                if (childName && hostIndex !== undefined && hostIndex !== null) {
                    hierarchyLabel = `${childName} (host_${hostIndex})`;
                } else if (childName) {
                    hierarchyLabel = childName;
                } else if (hostIndex !== undefined && hostIndex !== null) {
                    hierarchyLabel = `host_${hostIndex}`;
                }

                newElements.push({
                    data: {
                        ...shelfInfo.data,
                        parent: parentId,
                        type: 'shelf',
                        label: hierarchyLabel  // Set hierarchy mode label format
                    },
                    classes: shelfInfo.classes,
                    position: { x: 200 + index * 50, y: 200 + index * 50 }
                });
            });
        } else {
            // No logical topology - create "extracted_topology" template with instance "extracted_topology_0"
            // This wraps the flat structure so it can be exported hierarchically
            // Template name: "extracted_topology", Instance name: "extracted_topology_0"
            const templateName = "extracted_topology";
            const instanceName = "extracted_topology_0";
            rootTemplateName = templateName; // Use template name for connection tagging
            rootGraphId = "graph_extracted_topology_0"; // Set root graph ID (declared at function scope)

            // Get template color for the root (use template name, not instance name)
            const rootTemplateColor = this.common.getTemplateColor(templateName);

            // Create root graph node
            const rootGraphNode = {
                data: {
                    id: rootGraphId,
                    label: instanceName, // Instance name: extracted_topology_0
                    type: 'graph',
                    template_name: templateName, // Template name: extracted_topology
                    child_name: instanceName, // Instance name: extracted_topology_0
                    parent: null,
                    depth: 0,
                    templateColor: rootTemplateColor
                },
                classes: 'graph'
            };
            newElements.push(rootGraphNode);

            // Sort shelves by host_index before adding them as children
            // This ensures consistent ordering in the exported topology
            const sortedShelfDataList = [...shelfDataList].sort((a, b) => {
                const hostIndexA = a.data.host_index;
                const hostIndexB = b.data.host_index;

                // Handle undefined/null host_index values (put them at the end)
                if (hostIndexA === undefined || hostIndexA === null) {
                    if (hostIndexB === undefined || hostIndexB === null) {
                        return 0; // Both undefined, maintain order
                    }
                    return 1; // A is undefined, B is not, so A comes after B
                }
                if (hostIndexB === undefined || hostIndexB === null) {
                    return -1; // B is undefined, A is not, so B comes after A
                }

                // Both have host_index, sort numerically
                return hostIndexA - hostIndexB;
            });

            // Add all shelves as children of the extracted_topology_0 root (sorted by host_index)
            sortedShelfDataList.forEach((shelfInfo, index) => {
                // Determine child_name - use hostname if available, otherwise use host_index
                let childName = shelfInfo.data.child_name;
                if (!childName) {
                    // Use hostname as child_name for flat structures
                    childName = shelfInfo.data.hostname || `host_${shelfInfo.data.host_index ?? index}`;
                }

                // Format label for hierarchy mode: "child_name (host_index)"
                let hierarchyLabel = shelfInfo.data.label; // Default to existing label
                const hostIndex = shelfInfo.data.host_index;

                if (childName && hostIndex !== undefined && hostIndex !== null) {
                    hierarchyLabel = `${childName} (host_${hostIndex})`;
                } else if (childName) {
                    hierarchyLabel = childName;
                } else if (hostIndex !== undefined && hostIndex !== null) {
                    hierarchyLabel = `host_${hostIndex}`;
                }

                const shelfNode = {
                    data: {
                        ...shelfInfo.data,
                        parent: rootGraphId,  // Parent is the extracted_topology_0 root
                        type: 'shelf',
                        label: hierarchyLabel,
                        child_name: childName,  // Ensure child_name is set
                        logical_path: []  // Empty logical_path - flat structure under root
                    },
                    classes: shelfInfo.classes,
                    position: { x: 200 + index * 50, y: 200 + index * 50 }
                };
                newElements.push(shelfNode);
            });

            // CRITICAL: Add extracted_topology template to metadata.graph_templates
            // This ensures the template is recognized during export
            if (!this.state.data.currentData) {
                this.state.data.currentData = { metadata: {} };
            }
            if (!this.state.data.currentData.metadata) {
                this.state.data.currentData.metadata = {};
            }

            // Set initial_root fields to track the extracted_topology root we just created
            this.state.data.currentData.metadata.initialRootTemplate = templateName;
            this.state.data.currentData.metadata.initialRootId = rootGraphId;
            this.state.data.currentData.metadata.hasTopLevelAdditions = false;

            // Create graph_templates metadata structure (same as textproto import)
            // This allows export to use export_from_metadata_templates for consistency
            if (!this.state.data.currentData.metadata.graph_templates) {
                this.state.data.currentData.metadata.graph_templates = {};
            }

            // Build the extracted_topology template structure from sorted shelves
            if (!this.state.data.currentData.metadata.graph_templates[templateName]) {
                const templateStructure = {
                    name: templateName,
                    children: sortedShelfDataList.map((shelf, index) => {
                        // Determine child_name - use existing or derive from hostname/host_index
                        let childName = shelf.data.child_name;
                        if (!childName) {
                            childName = shelf.data.hostname || `host_${shelf.data.host_index ?? index}`;
                        }

                        // Get node descriptor and normalize (uppercase, strip variation suffixes)
                        let nodeDescriptor = shelf.data.shelf_node_type || shelf.data.node_type || 'N300_LB';
                        nodeDescriptor = nodeDescriptor.toUpperCase();
                        // Strip variation suffixes (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
                        // Order matters: check longer suffixes first (_XY_TORUS before _X_TORUS/_Y_TORUS)
                        if (nodeDescriptor.endsWith('_XY_TORUS')) {
                            nodeDescriptor = nodeDescriptor.slice(0, -9); // Remove '_XY_TORUS' (9 chars)
                        } else if (nodeDescriptor.endsWith('_X_TORUS')) {
                            nodeDescriptor = nodeDescriptor.slice(0, -8); // Remove '_X_TORUS' (8 chars)
                        } else if (nodeDescriptor.endsWith('_Y_TORUS')) {
                            nodeDescriptor = nodeDescriptor.slice(0, -8); // Remove '_Y_TORUS' (8 chars)
                        } else if (nodeDescriptor.endsWith('_DEFAULT')) {
                            nodeDescriptor = nodeDescriptor.slice(0, -8); // Remove '_DEFAULT' (8 chars)
                        }

                        return {
                            name: childName,
                            type: 'node',  // Indicates this is a node type child
                            node_descriptor: nodeDescriptor  // The actual node descriptor name (normalized)
                        };
                    })
                };

                // Add to metadata.graph_templates (for export)
                this.state.data.currentData.metadata.graph_templates[templateName] = templateStructure;

                // Also add to availableGraphTemplates (for UI recognition - dropdowns, filters, etc.)
                if (!this.state.data.availableGraphTemplates) {
                    this.state.data.availableGraphTemplates = {};
                }
                this.state.data.availableGraphTemplates[templateName] = templateStructure;
            }
        }

        // Re-create trays and ports for each shelf with updated location info
        trayPortData.forEach(trayInfo => {
            // Find the shelf this tray belongs to and get its location data
            const parentShelf = newElements.find(el => el.data && el.data.id === trayInfo.shelf_id && el.data.type === 'shelf');

            // Add tray node with all preserved data plus location info from parent shelf
            const trayData = { ...trayInfo.tray_data };
            trayData.parent = trayInfo.shelf_id;  // Update parent to match new structure

            // Inherit location data and host_index from parent shelf
            if (parentShelf && parentShelf.data) {
                if (parentShelf.data.hall) trayData.hall = parentShelf.data.hall;
                if (parentShelf.data.aisle) trayData.aisle = parentShelf.data.aisle;
                if (parentShelf.data.rack_num !== undefined) trayData.rack_num = parentShelf.data.rack_num;
                if (parentShelf.data.shelf_u !== undefined) trayData.shelf_u = parentShelf.data.shelf_u;
                // CRITICAL: Preserve host_index for export - required for template-based exports
                if (parentShelf.data.host_index !== undefined) trayData.host_index = parentShelf.data.host_index;
            }

            newElements.push({
                data: trayData,
                classes: trayInfo.tray_classes,
                position: trayInfo.tray_position
            });

            // Add port nodes with all preserved data plus location info
            trayInfo.ports.forEach(portInfo => {
                const portData = { ...portInfo.data };

                // Inherit location data and host_index from parent shelf
                if (parentShelf && parentShelf.data) {
                    if (parentShelf.data.hall) portData.hall = parentShelf.data.hall;
                    if (parentShelf.data.aisle) portData.aisle = parentShelf.data.aisle;
                    if (parentShelf.data.rack_num !== undefined) portData.rack_num = parentShelf.data.rack_num;
                    if (parentShelf.data.shelf_u !== undefined) portData.shelf_u = parentShelf.data.shelf_u;
                    // CRITICAL: Preserve host_index for export - required for template-based exports
                    if (parentShelf.data.host_index !== undefined) portData.host_index = parentShelf.data.host_index;
                }

                newElements.push({
                    data: portData,
                    classes: portInfo.classes,
                    position: portInfo.position
                });
            });
        });

        // Re-create connections with all preserved data
        // If we created extracted_topology root, tag all connections with that template
        const shouldTagWithExtractedTopology = !hasLogicalTopology && rootTemplateName && rootTemplateName === "extracted_topology";

        connections.forEach(conn => {
            const connectionData = { ...conn.data };

            // Preserve template associations when we have a logical topology
            // Only overwrite with extracted_topology if we're in flat structure mode AND connection doesn't have a valid template_name
            if (shouldTagWithExtractedTopology) {
                // Only overwrite if connection doesn't already have a valid template_name
                // This prevents losing template associations when switching modes
                if (!connectionData.template_name || connectionData.template_name === "extracted_topology") {
                    connectionData.template_name = rootTemplateName; // Use template name: "extracted_topology"
                    connectionData.containerTemplate = rootTemplateName;
                    // Set depth to 0 since they're at the root template level
                    if (connectionData.depth === undefined || connectionData.depth === null) {
                        connectionData.depth = 0;
                    }
                }
            }
            // If we have a logical topology, preserve the original template_name if it exists
            // We'll recalculate template associations after adding elements to Cytoscape

            newElements.push({
                data: connectionData,
                classes: conn.classes
            });
        });

        // Add all elements back to cytoscape
        this.state.cy.add(newElements);
        this.state.cy.endBatch();

        // After adding elements, recalculate template associations for connections if we have a logical topology
        // This ensures connections are associated with the correct template based on the graph hierarchy
        // Only recalculate if template_name is missing, incorrect, or if we're restoring from location mode
        if (hasLogicalTopology) {
            const allConnections = this.state.cy.edges();
            allConnections.forEach(edge => {
                const sourceId = edge.data('source');
                const targetId = edge.data('target');
                const sourceNode = this.state.cy.getElementById(sourceId);
                const targetNode = this.state.cy.getElementById(targetId);

                if (sourceNode && sourceNode.length > 0 && targetNode && targetNode.length > 0) {
                    // Find the common ancestor graph to determine the correct template
                    const commonAncestor = this.findCommonAncestor(sourceNode, targetNode);
                    if (commonAncestor && commonAncestor.length > 0) {
                        const templateName = commonAncestor.data('template_name');
                        if (templateName) {
                            const currentTemplateName = edge.data('template_name');

                            // Only update if:
                            // 1. Template name is missing, OR
                            // 2. Template name doesn't match the calculated one (connection might be in wrong template)
                            // 3. Template name is "extracted_topology" but we have a logical topology (shouldn't happen, but fix it)
                            const needsUpdate = !currentTemplateName ||
                                currentTemplateName !== templateName ||
                                (currentTemplateName === "extracted_topology" && hasLogicalTopology);

                            if (needsUpdate) {
                                edge.data('template_name', templateName);
                                edge.data('containerTemplate', templateName);

                                // Update depth based on common ancestor depth
                                const ancestorDepth = commonAncestor.data('depth') || 0;
                                edge.data('depth', ancestorDepth);

                                console.log(`[switchMode] Updated connection ${sourceId} -> ${targetId} template association: ${currentTemplateName || 'none'} -> ${templateName}`);
                            }
                        }
                    } else {
                        // No common ancestor found - this shouldn't happen, but preserve existing template_name
                        const currentTemplateName = edge.data('template_name');
                        if (!currentTemplateName) {
                            // If no template_name and no common ancestor, this is an error case
                            console.warn(`[switchMode] No common ancestor found for connection ${sourceId} -> ${targetId} and no existing template_name`);
                        }
                    }
                }
            });
        }

        // Update UI dropdowns if we created extracted_topology (already handled inside the else block above)
        if (!hasLogicalTopology && rootTemplateName === "extracted_topology") {
            // Update UI dropdowns to show the new template (if UI display module is available)
            // This ensures the template appears in template selection dropdowns and filters
            if (this.state.uiDisplayModule && typeof this.state.uiDisplayModule.populateGraphTemplateDropdown === 'function') {
                this.state.uiDisplayModule.populateGraphTemplateDropdown();
            }
            // Also update template filter dropdown
            this.populateTemplateFilterDropdown();

            // Update connection legend to show extracted_topology template
            // This ensures the template appears in the legend after mode switch
            if (this.state.data.currentData && window.updateConnectionLegend) {
                window.updateConnectionLegend(this.state.data.currentData);
            }
        }

        // Apply drag restrictions
        this.common.applyDragRestrictions();

        // Recolor connections for logical view (depth-based coloring)
        this.recolorConnections();

        // Reapply rerouted edges for any collapsed nodes (state.ui.collapsedGraphs) so collapse state is visible after mode switch
        if (this.common && typeof this.common.recalculateAllEdgeRouting === 'function') {
            this.common.recalculateAllEdgeRouting();
        }

        // Refresh Connection Options filter dropdowns to match current hierarchy
        this.refreshConnectionFilterDropdowns();

        // Run preset layout first
        this.stopLayout();
        const presetLayout = this.state.cy.layout({ name: 'preset' });
        this._hierarchyLayoutRef = presetLayout;
        presetLayout.run();
        this._hierarchyLayoutRef = null;

        // Then apply fcose ONLY to graph-level nodes to prevent overlap
        setTimeout(() => {
            if (this.state.mode !== 'hierarchy' || !this.state.cy) {
                console.log('[hierarchy] Skipping fcose (mode changed or cy gone)');
                return;
            }
            const graphNodes = this.state.cy.nodes('[type="graph"]');
            const graphCount = graphNodes.length;
            console.log('[hierarchy] Fcose layout starting, graph nodes:', graphCount);
            if (graphCount > 0) {
                // Stop any previous layout so we don't stack runs and freeze the UI
                this.stopLayout();
                // Cap iterations for large graphs to reduce freeze duration; fcose is main-thread heavy
                const numIter = graphCount > 30 ? 200 : graphCount > 15 ? 350 : 500;
                try {
                    const layout = this.state.cy.layout({
                        name: 'fcose',
                        eles: graphNodes,
                        quality: 'default',
                        randomize: false,
                        animate: true,
                        animationDuration: 500,
                        fit: false,
                        nodeDimensionsIncludeLabels: true,
                        nodeRepulsion: 4500,
                        idealEdgeLength: 200,
                        nestingFactor: 0.1,
                        gravity: 0,
                        numIter,
                        stop: () => {
                            if (this.state.mode !== 'hierarchy' || !this.state.cy) return;
                            this._hierarchyLayoutRef = null;
                            try {
                                console.log('[hierarchy] Fcose stop callback start');
                                this.common.applyDragRestrictions();
                                console.log('[hierarchy] Fcose stop: applyDragRestrictions done');
                                this.common.forceApplyCurveStyles();
                                console.log('[hierarchy] Fcose stop: forceApplyCurveStyles done');
                                this.state.cy.fit(null, 50);
                                this.state.cy.center();
                                this.state.cy.forceRender();
                                const cyContainer = document.getElementById('cy');
                                if (cyContainer) {
                                    cyContainer.style.visibility = 'visible';
                                }
                                console.log('[hierarchy] Fcose layout finished');
                            } catch (e) {
                                console.error('[hierarchy] Fcose stop callback error:', e?.message ?? e, e);
                            }
                        }
                    });
                    if (layout) {
                        this._hierarchyLayoutRef = layout;
                        layout.run();
                    } else {
                        console.warn('[hierarchy] Fcose layout extension not available, falling back to preset layout');
                        this._hierarchyLayoutRef = null;
                        this.state.cy.layout({ name: 'preset' }).run();
                        this.common.forceApplyCurveStyles();
                        this.state.cy.fit(null, 50);
                        this.state.cy.center();
                        this.state.cy.forceRender();
                        const cyContainer = document.getElementById('cy');
                        if (cyContainer) cyContainer.style.visibility = 'visible';
                        console.log('[hierarchy] Preset fallback layout finished');
                    }
                } catch (e) {
                    console.warn('[hierarchy] Error using fcose layout:', e.message, '- falling back to preset layout');
                    this._hierarchyLayoutRef = null;
                    this.state.cy.layout({ name: 'preset' }).run();
                    this.common.forceApplyCurveStyles();
                    this.state.cy.fit(null, 50);
                    this.state.cy.center();
                    this.state.cy.forceRender();
                    const cyContainer = document.getElementById('cy');
                    if (cyContainer) cyContainer.style.visibility = 'visible';
                    console.log('[hierarchy] Preset fallback (after error) finished');
                }
            } else {
                this.common.forceApplyCurveStyles();
                this.state.cy.fit(null, 50);
                this.state.cy.center();
                this.state.cy.forceRender();
                const cyContainer = document.getElementById('cy');
                if (cyContainer) cyContainer.style.visibility = 'visible';
                console.log('[hierarchy] No graph nodes; layout finished');
            }
        }, 100);
    }

    /**
     * Add a new node in hierarchy mode
     * @param {string} nodeType - Normalized node type
     * @param {HTMLElement} nodeTypeSelect - Select element for clearing selection
     */
    /**
     * Add a new shelf node in hierarchy mode
     * 
     * **CRITICAL: host_index is REQUIRED** - All shelf nodes must have a unique host_index.
     * This function assigns host_index from globalHostCounter at creation time.
     * The host_index is the primary numeric identifier for programmatic access and descriptor mapping.
     * 
     * @param {string} nodeType - Node type (e.g., 'WH_GALAXY', 'N300_LB', etc., may include variations like '_DEFAULT', '_X_TORUS')
     * @param {HTMLSelectElement} nodeTypeSelect - Node type select element (for UI updates)
     */
    addNode(nodeType, _nodeTypeSelect) {
        // Logical mode: add to selected parent graph node, or as top-level node
        // getNodeConfig normalizes internally for config lookup, but we preserve the full nodeType
        // (including variations like _DEFAULT, _X_TORUS, etc.) for storage in shelf_node_type
        const config = getNodeConfig(nodeType);
        if (!config) {
            window.showNotificationBanner?.(`Unknown node type: ${nodeType}`, 'error');
            return;
        }

        // Determine parent container - same logic as addNewGraph()
        let parentId = null;
        let parentNode = null;

        // Check if there's a selected graph instance
        const selectedNodes = this.state.cy.nodes(':selected');
        if (selectedNodes.length > 0) {
            const selectedGraphNode = selectedNodes[0];
            const selectedType = selectedGraphNode.data('type');

            // Graph nodes can be parents for new shelf nodes (even if empty)
            if (selectedType === 'graph') {
                parentId = selectedGraphNode.id();
                parentNode = selectedGraphNode;
                console.log(`Adding node to selected graph instance: ${parentNode.data('label')}`);
            }
        }

        // If no valid parent selected, add at top level (no parent)
        if (!parentNode) {
            console.log('No graph instance selected, adding at top level (no parent)');
            // parentId and parentNode remain null - node will be added at top level
        }

        // Find ALL instances of this template GLOBALLY to add the node to all of them
        let targetInstances = [];
        let addedToMultipleInstances = false;
        let isTopLevelNode = false;

        if (!parentNode) {
            // Top-level node (no parent) - create as standalone
            isTopLevelNode = true;
            console.log('Creating top-level standalone node (not part of any template)');
        } else {
            // Has a parent - add to parent and all instances of parent's template
            targetInstances = [parentNode];

            // Get the template name of the selected parent
            const parentTemplateName = parentNode.data('template_name');

            // Find ALL instances globally with the same template_name
            const allInstances = this.state.cy.nodes('[type="graph"]').filter(node => {
                return node.data('template_name') === parentTemplateName && node.id() !== parentId;
            });

            if (allInstances.length > 0) {
                targetInstances = [parentNode].concat(allInstances.toArray());
                addedToMultipleInstances = true;
                console.log(`Found ${allInstances.length + 1} instances of template "${parentTemplateName}" globally`);
            }
        }

        // Add node to all target instances (or at top level if no parent)
        let totalNodesAdded = 0;
        let autoNodeName = null;

        if (isTopLevelNode) {
            // Create a single top-level node (no parent)
            const existingTopLevelNodes = this.state.cy.nodes('[type="shelf"]').filter(n => !n.parent().length);
            const nodeIndex = existingTopLevelNodes.length;
            autoNodeName = `node_${nodeIndex}`;

            // Generate global host_index
            const hostIndex = this.state.data.globalHostCounter;
            this.state.data.globalHostCounter++;

            // Create shelf node ID using descriptor format (numeric host_index)
            const shelfId = String(hostIndex);
            const shelfLabel = `${autoNodeName} (host_${hostIndex})`;

            // Add shelf node at top level (no parent)
            this.state.cy.add({
                group: 'nodes',
                data: {
                    id: shelfId,
                    // No parent field
                    label: shelfLabel,
                    type: 'shelf',
                    host_index: hostIndex,
                    shelf_node_type: nodeType,
                    child_name: autoNodeName,
                    logical_path: []
                },
                classes: 'shelf',
                position: { x: 0, y: 0 }
            });

            // Create trays and ports using nodeFactory
            const location = {};
            const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(shelfId, hostIndex, nodeType, location);
            this.state.cy.add(trayPortNodes);

            // Arrange trays and ports using common layout function
            const addedShelf = this.state.cy.getElementById(shelfId);
            this.common.arrangeTraysAndPorts(addedShelf);

            // Create internal connections for node type variations (DEFAULT, X_TORUS, Y_TORUS, XY_TORUS)
            // This handles connections like QSFP connections in DEFAULT variants and torus connections
            this.common.createInternalConnectionsForNode(shelfId, nodeType, hostIndex);

            // Mark hierarchy structure as changed (forces re-import of deployment descriptor)
            this.state.data.hierarchyStructureChanged = true;
            console.log('[Hierarchy.addNode] Hierarchy structure changed - deployment descriptor needs re-import');

            totalNodesAdded = 1;
        } else {
            // Add to all instances of the parent template
            targetInstances.forEach((targetParent, index) => {
                const targetParentId = targetParent.id();

                // Count existing children in this instance to auto-generate name
                // For superpods, count all children (graphs and shelves)
                // For pods, count shelf children
                const existingChildren = targetParent.children();
                // Filter to get the right type based on parent template structure
                // If parent has graph children, count all children; otherwise count shelf children
                const parentTemplateName = targetParent.data('template_name');
                const parentTemplate = parentTemplateName && this.state.data.availableGraphTemplates
                    ? this.state.data.availableGraphTemplates[parentTemplateName]
                    : null;
                const hasGraphChildren = parentTemplate && parentTemplate.children
                    ? parentTemplate.children.some(c => c.type === 'graph')
                    : false;
                const existingNodes = hasGraphChildren
                    ? existingChildren  // Count all children (graphs + shelves)
                    : existingChildren.filter('[type="shelf"]');  // Count only shelf children
                const nodeIndex = existingNodes.length;

                // Use the same name for all instances (generated once)
                if (index === 0) {
                    autoNodeName = `node_${nodeIndex}`;
                }

                // Generate global host_index (will be recalculated later)
                const hostIndex = this.state.data.globalHostCounter;
                this.state.data.globalHostCounter++;

                // Create shelf node ID using descriptor format (numeric host_index)
                const shelfId = String(hostIndex);
                const shelfLabel = `${autoNodeName} (host_${hostIndex})`;

                // Determine logical_path based on parent
                // For graph nodes, build logical_path from the graph hierarchy (child_name chain)
                // For shelf nodes, use their existing logical_path
                let logicalPath = [];
                if (targetParent.data('logical_path')) {
                    // Parent is a shelf node with logical_path
                    logicalPath = [...targetParent.data('logical_path'), targetParent.data('label')];
                } else if (targetParent.data('type') === 'graph') {
                    // Parent is a graph node - build logical_path from graph hierarchy
                    const pathParts = [];
                    let current = targetParent;
                    while (current && current.length > 0) {
                        const childName = current.data('child_name') || current.data('label');
                        if (childName) {
                            pathParts.unshift(childName);
                        }
                        const parent = current.parent();
                        if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                            current = parent;
                        } else {
                            break;
                        }
                    }
                    logicalPath = pathParts;
                }

                console.log(`[instantiateTemplate] Setting logical_path for shelf "${shelfLabel}": [${logicalPath.join(', ')}]`);

                // Add shelf node
                this.state.cy.add({
                    group: 'nodes',
                    data: {
                        id: shelfId,
                        parent: targetParentId,
                        label: shelfLabel,
                        type: 'shelf',
                        host_index: hostIndex,
                        shelf_node_type: nodeType,
                        child_name: autoNodeName,
                        logical_path: logicalPath
                    },
                    classes: 'shelf',
                    position: { x: 0, y: 0 }
                });

                // Create trays and ports using nodeFactory
                const location = {};
                const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(shelfId, hostIndex, nodeType, location);
                this.state.cy.add(trayPortNodes);

                // Arrange trays and ports using common layout function
                const addedShelf = this.state.cy.getElementById(shelfId);
                this.common.arrangeTraysAndPorts(addedShelf);

                // Create internal connections for node type variations (DEFAULT, X_TORUS, Y_TORUS, XY_TORUS)
                // This handles connections like QSFP connections in DEFAULT variants and torus connections
                this.common.createInternalConnectionsForNode(shelfId, nodeType, hostIndex);

                totalNodesAdded++;
            });

            // Mark hierarchy structure as changed (forces re-import of deployment descriptor)
            this.state.data.hierarchyStructureChanged = true;
            console.log('[Hierarchy.addNode] Hierarchy structure changed (template instance) - deployment descriptor needs re-import');
        }

        // Update the template definition to include the new node (only for template-based nodes)
        if (!isTopLevelNode && autoNodeName) {
            const parentTemplateName = parentNode.data('template_name');

            // Update state.data.availableGraphTemplates
            if (this.state.data.availableGraphTemplates && this.state.data.availableGraphTemplates[parentTemplateName]) {
                const template = this.state.data.availableGraphTemplates[parentTemplateName];
                if (!template.children) {
                    template.children = [];
                }

                // Check for duplicate before adding
                const existingChild = template.children.find(
                    child => child.name === autoNodeName
                );

                if (existingChild) {
                    console.warn(`[addNewNode] Child "${autoNodeName}" already exists in template "${parentTemplateName}". Stack trace:`, new Error().stack);
                } else {
                    // Add the new child node to the template
                    template.children.push({
                        name: autoNodeName,
                        type: 'node',
                        node_descriptor: nodeType
                    });

                    console.log(`Updated template "${parentTemplateName}" with new child node "${autoNodeName}"`);
                }
            }

            // Update state.data.currentData.metadata.graph_templates if it exists (for export)
            if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
                const template = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
                if (template) {
                    if (!template.children) {
                        template.children = [];
                    }

                    // Check for duplicate before adding
                    const existingMetaChild = template.children.find(
                        child => child.name === autoNodeName
                    );

                    if (!existingMetaChild) {
                        // Add the new child node to the template
                        template.children.push({
                            name: autoNodeName,
                            type: 'node',
                            node_descriptor: nodeType
                        });
                    }
                }
            }
        }

        // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
        if (!isTopLevelNode) {
            this.recalculateHostIndicesForTemplates();
        }

        // Apply drag restrictions and layout
        this.common.applyDragRestrictions();
        this.calculateLayout();
        window.saveDefaultLayout?.();

        // Update the connection legend (in case template structure affects it)
        if (this.state.data.currentData) {
            window.updateConnectionLegend?.(this.state.data.currentData);
        }

        // Success message
        if (isTopLevelNode) {
            window.showExportStatus?.(`Added node (${nodeType}) at top level`, 'success');
        } else {
            const parentLabel = parentNode.data('label');
            if (addedToMultipleInstances) {
                window.showExportStatus?.(`Added node (${nodeType}) to ${totalNodesAdded} instances of template`, 'success');
            } else {
                window.showExportStatus?.(`Added node (${nodeType}) to ${parentLabel}`, 'success');
            }
        }
    }

    /**
     * Check if pasting the given clipboard root graph templates under the given parent would create
     * a circular dependency (self-reference or child template containing parent template).
     * @param {Array} clipboardNodes - clipboard.nodes
     * @param {string|null} parentId - Paste destination parent graph id, or null for root
     * @returns {{ allowed: boolean, message?: string }}
     */
    /**
     * Get the index of the pasted root that contains the given node index (by following parentIndex).
     * @param {Array} nodes - clipboard.nodes
     * @param {number} nodeIdx - Index of a node
     * @returns {number|undefined} Root index or undefined
     */
    _getPastedRootIndexForNode(nodes, nodeIdx) {
        if (nodeIdx < 0 || nodeIdx >= nodes.length) return undefined;
        let current = nodeIdx;
        const seen = new Set();
        while (current >= 0 && !seen.has(current)) {
            seen.add(current);
            const parentIndex = nodes[current].parentIndex;
            if (parentIndex === -1) return current;
            current = parentIndex;
        }
        return undefined;
    }

    /**
     * Get the index of the lowest common ancestor graph of two node indices in the clipboard.
     * Used to decide if a connection is fully inside a template so we can skip ID-mapped edge.
     * @param {Array} nodes - clipboard.nodes
     * @param {number} nodeIdxA - Index of first node
     * @param {number} nodeIdxB - Index of second node
     * @returns {number|undefined} Index of LCA graph node or undefined
     */
    _getLowestCommonAncestorGraphIndex(nodes, nodeIdxA, nodeIdxB) {
        const ancestorsOf = (idx) => {
            const set = new Set();
            let current = idx;
            while (current >= 0) {
                set.add(current);
                current = nodes[current].parentIndex;
            }
            return set;
        };
        const ancestorsA = ancestorsOf(nodeIdxA);
        const ancestorsB = ancestorsOf(nodeIdxB);
        let lcaGraphIdx = undefined;
        let maxDepth = -1;
        ancestorsA.forEach((i) => {
            if (!ancestorsB.has(i)) return;
            if (nodes[i].type !== 'graph') return;
            const depth = (nodes[i].data && nodes[i].data.depth != null) ? nodes[i].data.depth : -1;
            if (depth > maxDepth) {
                maxDepth = depth;
                lcaGraphIdx = i;
            }
        });
        return lcaGraphIdx;
    }

    /**
     * Build pathMapping for a pasted graph subtree so template connections can be applied.
     * pathMapping key: path from graph to node (child_name chain joined by '.'). value: new node id.
     * Works for any graph index (root or nested).
     * @param {Array} nodes - clipboard.nodes
     * @param {number} rootIdx - Index of the graph in clipboard (root or nested)
     * @param {Map} oldIdToNewId - Map old id -> new id
     * @returns {Object} pathMapping
     */
    _buildPathMappingForPastedRoot(nodes, rootIdx, oldIdToNewId) {
        const pathMapping = {};
        const rootId = nodes[rootIdx].id;
        const newRootId = oldIdToNewId.get(rootId);
        if (newRootId == null) return pathMapping;

        const pathFromRoot = new Map();
        pathFromRoot.set(rootIdx, []);

        for (let i = 0; i < nodes.length; i++) {
            if (i === rootIdx) continue;
            const parentIndex = nodes[i].parentIndex;
            if (parentIndex < 0) continue;
            const parentPath = pathFromRoot.get(parentIndex);
            if (parentPath === undefined) continue;
            const childName = (nodes[i].data && (nodes[i].data.child_name != null ? nodes[i].data.child_name : nodes[i].data.label)) || `node_${i}`;
            const path = parentPath.concat([childName]);
            pathFromRoot.set(i, path);
            const newId = oldIdToNewId.get(nodes[i].id);
            if (newId == null) continue;
            const key = path.join('.');
            pathMapping[key] = newId;
            if (path.length === 1) {
                pathMapping[path[0]] = newId;
            }
        }
        return pathMapping;
    }

    /**
     * Get the number of existing graph instances with the given template under the given parent (or at root).
     * Used to assign correct instance index when pasting (e.g. superpod_0, superpod_1).
     * @param {Object} cy - Cytoscape instance
     * @param {string|null} parentId - Parent graph id, or null for root
     * @param {string} templateName - template_name to count
     * @returns {number}
     */
    _getExistingInstanceCount(cy, parentId, templateName) {
        if (!cy || !templateName) return 0;
        if (parentId == null || parentId === '') {
            const roots = cy.nodes().roots();
            return roots.filter(n => n.data('type') === 'graph' && n.data('template_name') === templateName).length;
        }
        const parentNode = cy.getElementById(parentId);
        if (!parentNode || parentNode.length === 0) return 0;
        const children = parentNode.children();
        return children.filter(n => n.data('type') === 'graph' && n.data('template_name') === templateName).length;
    }

    _checkPasteCircularDependency(clipboardNodes, parentId) {
        if (!parentId || !this.state.cy) {
            return { allowed: true };
        }
        const parentNode = this.state.cy.getElementById(parentId);
        if (!parentNode || parentNode.length === 0 || parentNode.data('type') !== 'graph') {
            return { allowed: true };
        }
        const parentTemplateName = parentNode.data('template_name');
        if (!parentTemplateName) {
            return { allowed: true };
        }

        const rootGraphTemplates = new Set();
        for (let i = 0; i < clipboardNodes.length; i++) {
            const n = clipboardNodes[i];
            if (n.parentIndex === -1 && n.type === 'graph' && n.data && n.data.template_name) {
                rootGraphTemplates.add(n.data.template_name);
            }
        }

        for (const pastedTemplateName of rootGraphTemplates) {
            if (pastedTemplateName === parentTemplateName) {
                return {
                    allowed: false,
                    message: `Cannot paste: self-referential dependency. Template "${pastedTemplateName}" cannot be pasted inside an instance of itself. Select a different parent or paste at root.`
                };
            }
            if (this.templateContainsTemplate(pastedTemplateName, parentTemplateName)) {
                return {
                    allowed: false,
                    message: `Cannot paste: circular dependency. Template "${pastedTemplateName}" contains "${parentTemplateName}". Pasting it under "${parentTemplateName}" would create a cycle. Select a different parent or paste at root.`
                };
            }
        }
        return { allowed: true };
    }

    /**
     * Paste hierarchy selection from clipboard under the given parent (or at root).
     * Validates circular dependencies (self-reference and template containment) before pasting.
     * @param {Object} destination - { parentId: string|null, instanceNamePrefix?: string }
     * @returns {{ success: boolean, message?: string }}
     */
    pasteFromClipboardHierarchy(destination = null) {
        if (!this.state.cy || !this.state.clipboard || this.state.clipboard.mode !== 'hierarchy' || !this.state.clipboard.nodes || this.state.clipboard.nodes.length === 0) {
            return { success: false, message: 'Nothing to paste. Copy graph instances or shelves first (Ctrl+C).' };
        }

        const clipboard = this.state.clipboard;
        const nodes = clipboard.nodes;
        const connections = clipboard.connections || [];
        const parentId = (destination && destination.parentId != null) ? destination.parentId : null;
        const prefix = (destination && destination.instanceNamePrefix != null && String(destination.instanceNamePrefix).trim() !== '') ? String(destination.instanceNamePrefix).trim() : 'copy';

        const circularCheck = this._checkPasteCircularDependency(nodes, parentId);
        if (!circularCheck.allowed) {
            return { success: false, message: circularCheck.message };
        }

        const oldIdToNewId = new Map();
        let rootGraphIndex = 0;
        const nodesToAdd = [];
        const edgesToAdd = [];
        /** @type {Map<string, number>} key: (effectiveParentId ?? '') + '\0' + templateName */
        const pasteInstanceCountByParentAndTemplate = new Map();

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const oldId = node.id;
            const type = node.type;
            const data = node.data || {};
            const parentIndex = node.parentIndex;
            const parentOldId = parentIndex >= 0 ? nodes[parentIndex].id : null;
            const parentNewId = parentOldId != null ? oldIdToNewId.get(parentOldId) : null;
            const effectiveParentId = parentIndex === -1 ? parentId : parentNewId;

            if (type === 'graph') {
                const templateName = (data.template_name != null && data.template_name !== '') ? data.template_name : '';
                let label;
                let childName;
                if (templateName) {
                    const key = (effectiveParentId == null ? '' : effectiveParentId) + '\0' + templateName;
                    const existingCount = this._getExistingInstanceCount(this.state.cy, effectiveParentId, templateName);
                    const pastedCount = pasteInstanceCountByParentAndTemplate.get(key) || 0;
                    const instanceIndex = existingCount + pastedCount;
                    childName = `${templateName}_${instanceIndex}`;
                    label = childName;
                    pasteInstanceCountByParentAndTemplate.set(key, pastedCount + 1);
                } else {
                    label = data.child_name || data.label || `graph_${i}`;
                    childName = data.child_name != null ? data.child_name : label;
                }
                const newId = effectiveParentId == null
                    ? `graph_${prefix}_${rootGraphIndex++}`
                    : `${effectiveParentId}_${childName}`;
                oldIdToNewId.set(oldId, newId);
                const pos = { x: 0, y: 0 };
                const templateColor = data.templateColor || this.common.getTemplateColor(data.template_name || '');
                nodesToAdd.push({
                    group: 'nodes',
                    data: {
                        id: newId,
                        parent: effectiveParentId || undefined,
                        label,
                        type: 'graph',
                        template_name: data.template_name != null ? data.template_name : '',
                        depth: data.depth != null ? data.depth : 0,
                        child_name: childName,
                        templateColor,
                        instance_only: true
                    },
                    position: pos,
                    classes: 'graph'
                });
            } else if (type === 'shelf') {
                const hostIndex = this.state.data.globalHostCounter;
                this.state.data.globalHostCounter++;
                const childName = data.child_name || data.label || `node_${i}`;
                const newShelfId = effectiveParentId == null ? String(hostIndex) : `${effectiveParentId}_${childName}`;
                const nodeType = data.shelf_node_type || 'WH_GALAXY';
                const config = getNodeConfig(nodeType);
                if (!config) {
                    return { success: false, message: `Unknown shelf type: ${nodeType}. Paste aborted.` };
                }
                oldIdToNewId.set(oldId, newShelfId);
                const displayLabel = `${childName} (host_${hostIndex})`;
                const logicalPath = data.logical_path && Array.isArray(data.logical_path) ? data.logical_path : [];
                nodesToAdd.push({
                    group: 'nodes',
                    data: {
                        id: newShelfId,
                        parent: effectiveParentId || undefined,
                        label: displayLabel,
                        type: 'shelf',
                        host_index: hostIndex,
                        hostname: data.hostname != null ? data.hostname : childName,
                        shelf_node_type: nodeType,
                        child_name: childName,
                        original_name: data.original_name != null ? data.original_name : childName,
                        logical_path: logicalPath,
                        instance_only: true
                    },
                    position: { x: 0, y: 0 },
                    classes: 'shelf'
                });
                const location = {};
                const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(newShelfId, hostIndex, nodeType, location);
                nodesToAdd.push(...trayPortNodes);
            } else if (type === 'tray') {
                const trayNum = data.tray != null ? data.tray : 1;
                if (parentNewId == null) continue;
                const newTrayId = `${parentNewId}:t${trayNum}`;
                oldIdToNewId.set(oldId, newTrayId);
            } else if (type === 'port') {
                const portNum = data.port != null ? data.port : 1;
                if (parentNewId == null) continue;
                const newPortId = `${parentNewId}:p${portNum}`;
                oldIdToNewId.set(oldId, newPortId);
            }
        }

        this.state.cy.startBatch();
        this.state.cy.add(nodesToAdd);

        const templates = this.state.data.availableGraphTemplates || {};
        const graphsWithTemplateConnections = new Set();
        const templateNameToFirstGraphIdx = new Map();

        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].type !== 'graph') continue;
            const templateName = nodes[i].data && nodes[i].data.template_name;
            if (!templateName || !templates[templateName] || !templates[templateName].connections || templates[templateName].connections.length === 0) {
                continue;
            }
            graphsWithTemplateConnections.add(i);
            if (!templateNameToFirstGraphIdx.has(templateName)) {
                templateNameToFirstGraphIdx.set(templateName, i);
            }
        }

        templateNameToFirstGraphIdx.forEach((graphIdx, templateName) => {
            const pathMapping = this._buildPathMappingForPastedRoot(nodes, graphIdx, oldIdToNewId);
            const deferred = [
                {
                    graphLabel: '',
                    connections: templates[templateName].connections,
                    pathMapping,
                    templateName
                }
            ];
            this.processDeferredConnections(deferred, edgesToAdd);
        });

        connections.forEach((conn, idx) => {
            const lcaGraphIdx = this._getLowestCommonAncestorGraphIndex(nodes, conn.sourceIndex, conn.targetIndex);
            if (lcaGraphIdx !== undefined && graphsWithTemplateConnections.has(lcaGraphIdx)) {
                return;
            }
            const srcOldId = nodes[conn.sourceIndex] && nodes[conn.sourceIndex].id;
            const tgtOldId = nodes[conn.targetIndex] && nodes[conn.targetIndex].id;
            if (srcOldId == null || tgtOldId == null) return;
            const srcNewId = oldIdToNewId.get(srcOldId);
            const tgtNewId = oldIdToNewId.get(tgtOldId);
            if (srcNewId == null || tgtNewId == null) return;
            const edgeId = `paste_conn_${Date.now()}_${idx}`;
            const templateName = (nodes[conn.sourceIndex] && nodes[conn.sourceIndex].data && nodes[conn.sourceIndex].data.template_name) || '';
            const depth = (nodes[conn.sourceIndex] && nodes[conn.sourceIndex].data && nodes[conn.sourceIndex].data.depth) != null ? nodes[conn.sourceIndex].data.depth : 0;
            const connectionColor = this.common.getTemplateColor(templateName);
            edgesToAdd.push({
                group: 'edges',
                data: {
                    id: edgeId,
                    source: srcNewId,
                    target: tgtNewId,
                    cableType: conn.cableType || 'QSFP_DD',
                    cableLength: conn.cableLength || 'Unknown',
                    color: connectionColor,
                    containerTemplate: templateName,
                    template_name: templateName,
                    depth
                }
            });
        });
        if (edgesToAdd.length > 0) {
            this.state.cy.add(edgesToAdd);
        }
        this.state.cy.endBatch();

        if (this.calculateLayout) {
            this.calculateLayout();
            window.saveDefaultLayout?.();
        }
        if (this.recolorConnections) {
            this.recolorConnections();
        }
        const graphCount = nodes.filter(n => n.type === 'graph').length;
        const shelfCount = nodes.filter(n => n.type === 'shelf').length;
        return {
            success: true,
            message: `Pasted ${graphCount} graph(s), ${shelfCount} shelf(s), and ${connections.length} connection(s).`
        };
    }

    /**
     * Add a new graph template instance
     * @param {HTMLElement} graphTemplateSelect - Select element for template selection
     */
    addGraph(graphTemplateSelect) {
        const selectedTemplate = graphTemplateSelect.value;

        // Check if cytoscape is initialized
        if (!this.state.cy) {
            window.showNotificationBanner?.('Please upload a file and generate a visualization first before adding graph instances.', 'error');
            return;
        }

        // Check if there are any templates available
        if (Object.keys(this.state.data.availableGraphTemplates).length === 0) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('No graph templates available. Please load a textproto file that contains graph_templates first.', 'error');
            }
            return;
        }

        // Validate template selection
        if (!selectedTemplate) {
            window.showNotificationBanner?.('Please select a graph template.', 'error');
            graphTemplateSelect.focus();
            return;
        }

        // Get the template structure
        const template = this.state.data.availableGraphTemplates[selectedTemplate];
        if (!template) {
            window.showNotificationBanner?.(`Template "${selectedTemplate}" not found.`, 'error');
            return;
        }

        // All graph template instances have type="graph"
        // The hierarchy is user-defined in the textproto, not inferred from names
        const graphType = 'graph';

        // Determine parent: Use selected graph node if valid, otherwise add at top level
        let parentId = null;
        let parentNode = null;

        // Check if there's a selected node that could be a parent
        const selectedNodes = this.state.cy.nodes(':selected');
        if (selectedNodes.length > 0) {
            const selectedNode = selectedNodes[0];
            const selectedType = selectedNode.data('type');

            // Sync state.editing.selectedNode with Cytoscape's selection for consistency
            // This ensures other functions (like delete) can access the selected node
            if (this.state.editing.selectedNode) {
                this.state.editing.selectedNode.removeClass('selected-node');
            }
            this.state.editing.selectedNode = selectedNode;
            selectedNode.addClass('selected-node');

            // Only graph nodes (type="graph") can be parents for new graph instances (even if empty)
            if (selectedType === 'graph') {
                // Check for circular dependency
                const parentTemplateName = selectedNode.data('template_name');

                // Case 1: Self-reference - template cannot contain itself
                if (parentTemplateName === selectedTemplate) {
                    window.showNotificationBanner?.(`❌ Cannot instantiate graph template: Self-referential dependency detected. A template cannot contain an instance of itself. You cannot instantiate "${selectedTemplate}" inside an instance of "${parentTemplateName}". Select a different parent or deselect all nodes to add at the top level.`, 'error');
                    return;
                }

                // Case 2: Template hierarchy check - does the template we're trying to add contain the parent's template?
                // If child template contains parent template, that creates a circular dependency
                if (parentTemplateName) {
                    if (this.templateContainsTemplate(selectedTemplate, parentTemplateName)) {
                        window.showNotificationBanner?.(`❌ Cannot instantiate graph template: Circular dependency detected. Template "${selectedTemplate}" contains "${parentTemplateName}". You cannot instantiate "${selectedTemplate}" inside "${parentTemplateName}" because that would create a circular dependency. Select a different parent or deselect all nodes to add at the top level.`, 'error');
                        return;
                    }
                }

                parentNode = selectedNode;
                parentId = selectedNode.id();
            } else {
                console.log(`Selected node is not a graph (type: ${selectedType}). Adding at top level.`);
            }
        }

        // Auto-generate enumerated label: {template_name}_{index}
        // NOW that parent is determined, count existing instances within that parent
        let existingInstances;
        if (parentNode) {
            // Count children of this parent with the same template (including empty ones)
            existingInstances = parentNode.children().filter(node => {
                return node.data('type') === 'graph' && node.data('template_name') === selectedTemplate;
            });
        } else {
            // Count top-level instances (no parent, including empty ones)
            existingInstances = this.state.cy.nodes().roots().filter(node => {
                return node.data('type') === 'graph' && node.data('template_name') === selectedTemplate;
            });
        }

        const nextIndex = existingInstances.length;
        const graphLabel = `${selectedTemplate}_${nextIndex}`;

        // Build unique path from parent hierarchy (matching import behavior)
        // Traverse up the parent chain to build a unique path, including root-level graphs
        const pathParts = [];
        if (parentNode) {
            let current = parentNode;
            while (current && current.length > 0) {
                const childName = current.data('child_name') || current.data('label');
                if (childName) {
                    pathParts.unshift(childName);
                }
                const parent = current.parent();
                if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                    current = parent;
                } else {
                    // Reached root level - include the root graph in the path
                    // This ensures multiple root-level instances are uniquely identified
                    if (current.data('type') === 'graph') {
                        const rootLabel = current.data('child_name') || current.data('label');
                        if (rootLabel) {
                            pathParts.unshift(rootLabel);
                        }
                    }
                    break;
                }
            }
        }
        // Add the new instance's label to the path
        pathParts.push(graphLabel);

        // Generate graph ID from path (consistent with import behavior)
        const pathStr = pathParts.join('/');
        const graphId = `graph_${pathStr.replace(/\//g, '_')}`;

        // If no valid parent from selection, add at top level (no parent)
        if (!parentNode) {
            console.log(`Adding at top level (no parent).`);
            // parentNode and parentId remain null - graph will be added at top level
        }

        // Find a good position for the new graph
        let newX = 0;
        let newY = 0;

        if (parentNode) {
            // Position relative to parent - find siblings and place next to them
            const siblings = parentNode.children().filter(node => node.isParent() && node.data('type') !== 'rack');
            const parentPos = parentNode.position();

            if (siblings.length > 0) {
                // Position to the right of existing siblings
                let maxX = -Infinity;
                siblings.forEach(sibling => {
                    const boundingBox = sibling.boundingBox();
                    const rightEdge = boundingBox.x2 || (sibling.position().x + 300);
                    if (rightEdge > maxX) {
                        maxX = rightEdge;
                    }
                });
                newX = maxX + 600; // 600px spacing
                newY = parentPos.y + 200; // Below parent
            } else {
                // First child - position inside parent
                newX = parentPos.x;
                newY = parentPos.y + 200;
            }
        } else {
            // No parent - position at top level
            const existingGraphs = this.state.cy.nodes().filter(node => node.isParent() && !node.parent().length && !['rack', 'tray', 'port'].includes(node.data('type')));

            if (existingGraphs.length > 0) {
                // Position new graph to the right of existing top-level graphs
                let maxX = -Infinity;
                existingGraphs.forEach(graph => {
                    const pos = graph.position();
                    const boundingBox = graph.boundingBox();
                    const rightEdge = boundingBox.x2 || (pos.x + 300);
                    if (rightEdge > maxX) {
                        maxX = rightEdge;
                        newY = pos.y;
                    }
                });
                newX = maxX + 600; // 600px spacing between graphs
            } else {
                // First graph - place at a reasonable starting position
                newX = 300;
                newY = 300;
            }
        }

        try {
            // Check if adding inside a template instance (hierarchy mode)
            const visualizationMode = this.state.mode;
            const isInsideTemplate = visualizationMode === 'hierarchy' && parentNode && parentNode.data('template_name');
            const parentTemplateName = isInsideTemplate ? parentNode.data('template_name') : null;

            if (isInsideTemplate) {
                // For template definition, use the template name as the child name
                // This allows the template to be instantiated in new instances
                // Each instance will get its own indexed label (e.g., "dim1.5_0", "dim1.5_1")
                const baseChildName = selectedTemplate; // Use template name as base child name

                // Check if this child template is already in the parent template definition
                const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
                const childExists = parentTemplate && parentTemplate.children && parentTemplate.children.some(
                    child => child.type === 'graph' && child.graph_template === selectedTemplate && child.name === baseChildName
                );

                // Update the parent template definition first (use base name, not indexed label)
                // Only add if it doesn't already exist
                if (!childExists) {
                    this.updateTemplateWithNewChild(parentTemplateName, selectedTemplate, baseChildName);
                }

                // Find all instances of the parent template (including empty ones)
                const parentTemplateInstances = this.state.cy.nodes().filter(node =>
                    node.data('type') === 'graph' &&
                    node.data('template_name') === parentTemplateName
                );

                // Add the child graph to ALL instances of the parent template (batched for performance)
                let instancesUpdated = 0;
                this.state.cy.startBatch();
                parentTemplateInstances.forEach(parentInstance => {
                    const instanceId = parentInstance.id();
                    const _instanceLabel = parentInstance.data('label');

                    // Build unique path from parent hierarchy (matching import behavior)
                    // Traverse up including root-level graphs to ensure uniqueness
                    const pathParts = [];
                    let current = parentInstance;
                    while (current && current.length > 0) {
                        const childName = current.data('child_name') || current.data('label');
                        if (childName) {
                            pathParts.unshift(childName);
                        }
                        const parent = current.parent();
                        if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                            current = parent;
                        } else {
                            // Reached root level - include the root graph in the path
                            // This ensures multiple root-level instances are uniquely identified
                            if (current.data('type') === 'graph') {
                                const rootLabel = current.data('child_name') || current.data('label');
                                if (rootLabel) {
                                    pathParts.unshift(rootLabel);
                                }
                            }
                            break;
                        }
                    }
                    // Add the new instance's label to the path
                    pathParts.push(graphLabel);

                    // Generate graph ID from path (consistent with import behavior)
                    const pathStr = pathParts.join('/');
                    const childGraphId = `graph_${pathStr.replace(/\//g, '_')}`;
                    const childGraphLabel = graphLabel; // Use same child name across instances

                    // Find position for the child within this parent instance
                    const siblings = parentInstance.children().filter(node =>
                        node.isParent() && node.data('type') === 'graph'
                    );
                    const parentPos = parentInstance.position();

                    let childX, childY;
                    if (siblings.length > 0) {
                        // Position to the right of existing siblings
                        let maxX = -Infinity;
                        siblings.forEach(sibling => {
                            const boundingBox = sibling.boundingBox();
                            const rightEdge = boundingBox.x2 || (sibling.position().x + 300);
                            if (rightEdge > maxX) {
                                maxX = rightEdge;
                            }
                        });
                        childX = maxX + 600;
                        childY = parentPos.y + 200;
                    } else {
                        // First child
                        childX = parentPos.x;
                        childY = parentPos.y + 200;
                    }

                    const nodesToAdd = [];
                    const edgesToAdd = [];
                    const deferredConnections = [];

                    // Get parent depth for proper color cascading
                    const parentInstanceDepth = parentInstance.data('depth') || 0;

                    this.instantiateTemplate(
                        template,
                        selectedTemplate,
                        childGraphId,
                        childGraphLabel,
                        graphType,
                        instanceId,
                        childX,
                        childY,
                        nodesToAdd,
                        edgesToAdd,
                        {},
                        deferredConnections,
                        baseChildName,  // Pass base child name (without index) for template-level operations
                        parentInstanceDepth  // Pass parent depth
                    );

                    // Add nodes for this instance
                    this.state.cy.add(nodesToAdd);

                    // Arrange trays and ports for all newly added shelves
                    nodesToAdd.forEach(node => {
                        if (node.data && node.data.type === 'shelf') {
                            const shelfNode = this.state.cy.getElementById(node.data.id);
                            if (shelfNode && shelfNode.length > 0) {
                                this.common.arrangeTraysAndPorts(shelfNode);

                                // Create internal connections for node type variations
                                const nodeType = shelfNode.data('shelf_node_type');
                                const hostIndex = shelfNode.data('host_index');
                                if (nodeType && hostIndex !== undefined) {
                                    this.common.createInternalConnectionsForNode(shelfNode.id(), nodeType, hostIndex);
                                }
                            }
                        }
                    });

                    // Process connections
                    this.processDeferredConnections(deferredConnections, edgesToAdd);
                    this.state.cy.add(edgesToAdd);

                    // Explicitly apply graph class to ensure styling works
                    this.state.cy.getElementById(childGraphId).addClass('graph');

                    instancesUpdated++;
                });

                // CRITICAL: End the batch so Cytoscape flushes updates; without this the visualizer
                // never updates (no pan/zoom/select) and export still shows correct state.
                this.state.cy.endBatch();

                // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
                this.recalculateHostIndicesForTemplates();

                // Rename graph instances to ensure proper numbering at each level
                this.renameGraphInstances();

                // Apply drag restrictions and styling
                this.common.applyDragRestrictions();

                // Force complete style recalculation and redraw
                this.state.cy.style().update();
                this.state.cy.forceRender();

                // Defer layout calculation to next tick so the UI can update first (avoids freeze)
                const self = this;
                setTimeout(() => {
                    if (!self.state.cy || self.state.mode !== 'hierarchy') return;
                    try {
                        self.calculateLayout();
                        window.saveDefaultLayout?.();
                        self.state.cy.fit(null, 50);
                        setTimeout(() => {
                            if (self.common && typeof self.common.forceApplyCurveStyles === 'function') {
                                self.common.forceApplyCurveStyles();
                            }
                            window.updatePortConnectionStatus?.();
                            self.state.cy.forceRender();
                        }, 50);
                    } catch (e) {
                        console.error('[hierarchy] addGraph (inside template) layout error:', e?.message ?? e);
                    }
                }, 0);

                // Log success message
                console.log(`Successfully added graph template "${selectedTemplate}" as "${graphLabel}" to ${instancesUpdated} instance(s) of template "${parentTemplateName}"!`);

            } else {
                // Not inside a template - single instance creation (original behavior)
                const nodesToAdd = [];
                const edgesToAdd = [];
                const deferredConnections = [];

                // Get parent depth for proper color cascading
                let parentDepthValue = -1; // Default for top-level (depth will be 0)
                if (parentId) {
                    const parentNodeForDepth = this.state.cy.getElementById(parentId);
                    if (parentNodeForDepth && parentNodeForDepth.length > 0) {
                        parentDepthValue = parentNodeForDepth.data('depth') || 0;
                    }
                }

                this.instantiateTemplate(
                    template,
                    selectedTemplate,
                    graphId,
                    graphLabel,
                    graphType,
                    parentId, // parent is root cluster if it exists
                    newX,
                    newY,
                    nodesToAdd,
                    edgesToAdd,
                    {}, // node path mapping for connections
                    deferredConnections,
                    null, // childName
                    parentDepthValue  // Pass parent depth
                );

                // Add all nodes to cytoscape FIRST
                console.log(`Adding ${nodesToAdd.length} nodes to Cytoscape`);
                this.state.cy.add(nodesToAdd);

                // Arrange trays and ports for all newly added shelves
                nodesToAdd.forEach(node => {
                    if (node.data && node.data.type === 'shelf') {
                        const shelfNode = this.state.cy.getElementById(node.data.id);
                        if (shelfNode && shelfNode.length > 0) {
                            this.common.arrangeTraysAndPorts(shelfNode);
                        }
                    }
                });

                // Track top-level additions for export optimization
                if (parentId === null && this.state.data.currentData && this.state.data.currentData.metadata) {
                    // Adding at top level - check if we had an initial root
                    if (this.state.data.currentData.metadata.initialRootTemplate) {
                        this.state.data.currentData.metadata.hasTopLevelAdditions = true;
                        console.log(`Top-level graph added - flagging export to use synthetic root`);
                    }
                }

                // NOW process deferred connections (all nodes exist)
                console.log(`Processing ${deferredConnections.length} deferred connection groups`);
                this.processDeferredConnections(deferredConnections, edgesToAdd);

                // Batch all graph modifications for better performance
                this.state.cy.startBatch();

                // Add all edges
                console.log(`Adding ${edgesToAdd.length} edges to Cytoscape`);
                this.state.cy.add(edgesToAdd);

                // Explicitly apply graph class to ensure styling works
                this.state.cy.getElementById(graphId).addClass('graph');

                this.state.cy.endBatch();

                // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
                if (this.state.mode === 'hierarchy') {
                    this.recalculateHostIndicesForTemplates();
                }

                // Apply drag restrictions
                this.common.applyDragRestrictions();

                // Force complete style recalculation and redraw
                this.state.cy.style().update();
                this.state.cy.forceRender();

                // Defer layout calculation to ensure nodes are fully rendered and bounding boxes are accurate
                // This prevents the "weird look" on initial creation
                setTimeout(() => {
                    this.calculateLayout();
                    this.state.cy.fit(null, 50);  // Fit viewport to show all content

                    // Apply curves and update status after layout is done
                    setTimeout(() => {
                        this.common.forceApplyCurveStyles();
                        window.updatePortConnectionStatus?.();
                        this.state.cy.forceRender();
                    }, 50);
                }, 50);

                // Log success message
                const childCount = template.children ? template.children.length : 0;
                const connectionCount = template.connections ? template.connections.length : 0;
                console.log(`Successfully instantiated graph template "${selectedTemplate}" as "${graphLabel}"!\n\n` +
                    `Created ${childCount} child node(s) and ${connectionCount} connection(s).`);
            }

        } catch (error) {
            console.error('Error instantiating graph template:', error);
            console.error(`Failed to instantiate graph template: ${error.message}`);
        }
    }

    /**
     * Create a new empty graph template
     */
    createNewTemplate() {
        // CRITICAL: Capture selection FIRST, before any DOM operations that might clear it
        // But first check if cytoscape exists
        if (!this.state.cy) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('Please upload a file and generate a visualization first before creating templates.', 'error');
            }
            return;
        }

        const allSelectedNodes = this.state.cy.nodes(':selected');
        console.log(`[createNewTemplate] START - Captured ${allSelectedNodes.length} selected nodes before any operations`);

        const templateNameInput = document.getElementById('newTemplateNameInput');
        const newTemplateName = templateNameInput.value.trim();

        // Validate template name
        if (!newTemplateName) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('Please enter a template name.', 'error');
            }
            templateNameInput.focus();
            return;
        }

        // Check if template name already exists
        if (this.state.data.availableGraphTemplates && this.state.data.availableGraphTemplates[newTemplateName]) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner(`Template "${newTemplateName}" already exists. Please choose a different name.`, 'error');
            }
            templateNameInput.focus();
            return;
        }

        try {
            // Initialize state.data.currentData if it doesn't exist (for empty canvas scenario)
            if (!this.state.data.currentData) {
                this.state.data.currentData = {
                    nodes: [],
                    edges: [],
                    elements: [],
                    metadata: {
                        total_connections: 0,
                        total_nodes: 0,
                        graph_templates: {}
                    }
                };
            }

            // Initialize metadata.graph_templates if it doesn't exist
            if (!this.state.data.currentData.metadata) {
                this.state.data.currentData.metadata = { graph_templates: {} };
            }
            if (!this.state.data.currentData.metadata.graph_templates) {
                this.state.data.currentData.metadata.graph_templates = {};
            }

            // Use the selection captured at the start of the function
            const templateChildren = [];
            const templateConnections = [];

            console.log(`[createNewTemplate] Processing captured selection. Total selected: ${allSelectedNodes.length}`);

            // If nodes are selected, extract them and their connections
            if (allSelectedNodes.length > 0) {
                console.log(`[createNewTemplate] Selected nodes:`, allSelectedNodes.map(n => ({
                    id: n.id(),
                    type: n.data('type'),
                    label: n.data('label'),
                    child_name: n.data('child_name')
                })));

                // First, get all shelf and graph nodes that are directly selected
                const selectedShelfAndGraphNodes = allSelectedNodes.filter(node => {
                    const nodeType = node.data('type');
                    return nodeType === 'shelf' || nodeType === 'graph';
                });

                // Also check if ports/trays are selected - find their parent shelf/graph nodes
                const selectedPortsAndTrays = allSelectedNodes.filter(node => {
                    const nodeType = node.data('type');
                    return nodeType === 'port' || nodeType === 'tray';
                });

                if (selectedPortsAndTrays.length > 0) {
                    console.log(`[createNewTemplate] Found ${selectedPortsAndTrays.length} selected ports/trays, finding parent shelf/graph nodes`);
                    selectedPortsAndTrays.forEach(node => {
                        const parentShelfOrGraph = this.findParentShelfOrGraph(node);
                        if (parentShelfOrGraph && !selectedShelfAndGraphNodes.some(n => n.id() === parentShelfOrGraph.id())) {
                            selectedShelfAndGraphNodes.push(parentShelfOrGraph);
                            console.log(`[createNewTemplate] Added parent ${parentShelfOrGraph.data('type')} node: ${parentShelfOrGraph.data('child_name') || parentShelfOrGraph.data('label')}`);
                        }
                    });
                }

                console.log(`[createNewTemplate] Filtered shelf/graph nodes: ${selectedShelfAndGraphNodes.length}`);

                if (selectedShelfAndGraphNodes.length > 0) {
                    // Find the common parent of all selected nodes (for connection path extraction)
                    let commonParent = null;
                    if (selectedShelfAndGraphNodes.length > 0) {
                        // Get all parents of selected nodes
                        const parents = selectedShelfAndGraphNodes.map(node => {
                            let current = node.parent();
                            while (current && current.length > 0) {
                                if (current.data('type') === 'graph') {
                                    return current;
                                }
                                current = current.parent();
                            }
                            return null;
                        }).filter(p => p !== null);

                        if (parents.length > 0) {
                            // Find the deepest common parent
                            commonParent = parents[0];
                            for (let i = 1; i < parents.length; i++) {
                                commonParent = this.findCommonAncestor(commonParent, parents[i]);
                                if (!commonParent) break;
                            }
                        }
                    }

                    // Convert selected nodes to template children format
                    selectedShelfAndGraphNodes.forEach(node => {
                        const nodeType = node.data('type');
                        const childName = node.data('child_name') || node.data('label');

                        if (nodeType === 'shelf') {
                            // Shelf node - convert to template child
                            const shelfNodeType = node.data('shelf_node_type') || 'WH_GALAXY';
                            templateChildren.push({
                                name: childName,
                                type: 'node',
                                node_descriptor: shelfNodeType
                            });
                        } else if (nodeType === 'graph') {
                            // Graph node - convert to template child
                            const graphTemplateName = node.data('template_name');
                            if (graphTemplateName) {
                                templateChildren.push({
                                    name: childName,
                                    type: 'graph',
                                    graph_template: graphTemplateName
                                });
                            }
                        }
                    });

                    // Extract connections between selected nodes
                    // Get all edges/connections
                    const allEdges = this.state.cy.edges();
                    const selectedNodeIds = new Set(selectedShelfAndGraphNodes.map(n => n.id()));

                    // Find connections where both endpoints are within selected nodes
                    allEdges.forEach(edge => {
                        const sourceNode = edge.source();
                        const targetNode = edge.target();

                        // Check if both source and target are ports within selected shelf/graph nodes
                        // We need to check if the ports belong to selected shelves/graphs
                        const sourceParent = this.findParentShelfOrGraph(sourceNode);
                        const targetParent = this.findParentShelfOrGraph(targetNode);

                        if (sourceParent && targetParent &&
                            selectedNodeIds.has(sourceParent.id()) &&
                            selectedNodeIds.has(targetParent.id())) {

                            // Extract port pattern relative to common parent (or template root)
                            const placementLevel = commonParent || null;
                            let sourcePortPattern = this.extractPortPattern(sourceNode, placementLevel);
                            let targetPortPattern = this.extractPortPattern(targetNode, placementLevel);

                            // If no common parent, extractPortPattern returns shelfName instead of path
                            // Convert to path format for template connections
                            if (sourcePortPattern && !sourcePortPattern.path && sourcePortPattern.shelfName) {
                                sourcePortPattern = {
                                    path: [sourcePortPattern.shelfName],
                                    trayId: sourcePortPattern.trayId,
                                    portId: sourcePortPattern.portId
                                };
                            }
                            if (targetPortPattern && !targetPortPattern.path && targetPortPattern.shelfName) {
                                targetPortPattern = {
                                    path: [targetPortPattern.shelfName],
                                    trayId: targetPortPattern.trayId,
                                    portId: targetPortPattern.portId
                                };
                            }

                            if (sourcePortPattern && targetPortPattern && sourcePortPattern.path && targetPortPattern.path) {
                                // Create template connection format
                                templateConnections.push({
                                    port_a: {
                                        path: sourcePortPattern.path,
                                        tray_id: sourcePortPattern.trayId,
                                        port_id: sourcePortPattern.portId
                                    },
                                    port_b: {
                                        path: targetPortPattern.path,
                                        tray_id: targetPortPattern.trayId,
                                        port_id: targetPortPattern.portId
                                    }
                                });
                            }
                        }
                    });
                }
            }

            // Create template structure with extracted children and connections
            const newTemplate = {
                children: templateChildren,
                connections: templateConnections
            };

            console.log(`[createNewTemplate] Created template "${newTemplateName}" with ${templateChildren.length} children and ${templateConnections.length} connections`);

            // Initialize state.data.availableGraphTemplates if it doesn't exist
            if (!this.state.data.availableGraphTemplates) {
                this.state.data.availableGraphTemplates = {};
            }

            // Add the new template to state.data.availableGraphTemplates
            this.state.data.availableGraphTemplates[newTemplateName] = newTemplate;

            // Also add to state.data.currentData.metadata.graph_templates for export
            this.state.data.currentData.metadata.graph_templates[newTemplateName] = newTemplate;

            // Update the template dropdown
            const graphTemplateSelect = document.getElementById('graphTemplateSelect');
            if (graphTemplateSelect) {
                // Rebuild the dropdown
                graphTemplateSelect.innerHTML = '<option value="">-- Select a Template --</option>';

                Object.keys(this.state.data.availableGraphTemplates).sort().forEach(templateName => {
                    const option = document.createElement('option');
                    option.value = templateName;
                    option.textContent = templateName;
                    graphTemplateSelect.appendChild(option);
                });
            }

            // Determine parent: Use selected graph node if valid, otherwise add at top level
            let parentId = null;
            let parentNode = null;
            let parentDepth = -1;

            // Check if there's a selected node that could be a parent
            const selectedNodes = this.state.cy.nodes(':selected');
            if (selectedNodes.length > 0) {
                const selectedNode = selectedNodes[0];
                const selectedType = selectedNode.data('type');

                // Sync state.editing.selectedNode with Cytoscape's selection for consistency
                // This ensures other functions (like delete) can access the selected node
                if (this.state.editing.selectedNode) {
                    this.state.editing.selectedNode.removeClass('selected-node');
                }
                this.state.editing.selectedNode = selectedNode;
                selectedNode.addClass('selected-node');

                // Only graph nodes can be parents for new graph instances (even if empty)
                if (selectedType === 'graph') {
                    parentNode = selectedNode;
                    parentId = selectedNode.id();
                    parentDepth = selectedNode.data('depth') || 0;
                }
            }

            // If no valid parent, add at top level (no parent)
            if (!parentId) {
                console.log('No parent selected, adding new template instance at top level');
                // parentId and parentNode remain null - graph will be added at top level
                parentDepth = -1; // Top level depth
            }

            // Calculate the enumeration for the new instance
            let instanceIndex = 0;
            if (parentId) {
                const siblings = parentNode.children().filter(node => {
                    return node.data('type') === 'graph' && node.data('template_name') === newTemplateName;
                });
                instanceIndex = siblings.length;
            } else {
                // Count all instances of this template at the top level
                const topLevelInstances = this.state.cy.nodes('[type="graph"]').filter(node => {
                    return !node.parent().length && node.data('template_name') === newTemplateName;
                });
                instanceIndex = topLevelInstances.length;
            }

            // Create instance name following the pattern: template_name_index
            const graphLabel = `${newTemplateName}_${instanceIndex}`;

            // Build unique path from parent hierarchy (matching import behavior)
            // Traverse up including root-level graphs to ensure uniqueness
            const pathParts = [];
            if (parentNode) {
                let current = parentNode;
                while (current && current.length > 0) {
                    const childName = current.data('child_name') || current.data('label');
                    if (childName) {
                        pathParts.unshift(childName);
                    }
                    const parent = current.parent();
                    if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                        current = parent;
                    } else {
                        // Reached root level - include the root graph in the path
                        // This ensures multiple root-level instances are uniquely identified
                        if (current.data('type') === 'graph') {
                            const rootLabel = current.data('child_name') || current.data('label');
                            if (rootLabel) {
                                pathParts.unshift(rootLabel);
                            }
                        }
                        break;
                    }
                }
            }
            // Add the new instance's label to the path
            pathParts.push(graphLabel);

            // Generate graph ID from path (consistent with import behavior)
            const pathStr = pathParts.join('/');
            const graphId = `graph_${pathStr.replace(/\//g, '_')}`;

            // Calculate position
            let baseX = 0;
            let baseY = 0;

            if (parentNode) {
                const parentPos = parentNode.position();
                baseX = parentPos.x;
                baseY = parentPos.y;
            }

            // Get template-based color
            const templateColor = this.common.getTemplateColor(newTemplateName);

            // If adding inside a parent template, update that parent's template definition
            // and add to ALL instances of that parent template
            if (parentId && parentNode) {
                const parentTemplateName = parentNode.data('template_name');
                if (parentTemplateName) {
                    // Update the parent template to include this new child
                    this.updateTemplateWithNewChild(parentTemplateName, newTemplateName, graphLabel);

                    // Find all instances of the parent template
                    const parentTemplateInstances = this.state.cy.nodes().filter(node =>
                        node.data('type') === 'graph' &&
                        node.data('template_name') === parentTemplateName
                    );

                    // Add the new empty graph instance to each parent instance
                    parentTemplateInstances.forEach(parentInstance => {
                        const parentInstanceId = parentInstance.id();
                        const _parentInstanceLabel = parentInstance.data('label');

                        // Build unique path from parent hierarchy (matching import behavior)
                        // Traverse up including root-level graphs to ensure uniqueness
                        const pathParts = [];
                        let current = parentInstance;
                        while (current && current.length > 0) {
                            const childName = current.data('child_name') || current.data('label');
                            if (childName) {
                                pathParts.unshift(childName);
                            }
                            const parent = current.parent();
                            if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                                current = parent;
                            } else {
                                // Reached root level - include the root graph in the path
                                // This ensures multiple root-level instances are uniquely identified
                                if (current.data('type') === 'graph') {
                                    const rootLabel = current.data('child_name') || current.data('label');
                                    if (rootLabel) {
                                        pathParts.unshift(rootLabel);
                                    }
                                }
                                break;
                            }
                        }
                        // Add the new instance's label to the path
                        pathParts.push(graphLabel);

                        // Generate graph ID from path (consistent with import behavior)
                        const pathStr = pathParts.join('/');
                        const childGraphId = `graph_${pathStr.replace(/\//g, '_')}`;

                        // Calculate position relative to parent
                        const siblings = parentInstance.children().filter(node =>
                            node.data('type') === 'graph'
                        );
                        const parentInstancePos = parentInstance.position();

                        let childX, childY;
                        if (siblings.length > 0) {
                            // Position to the right of existing siblings
                            let maxX = -Infinity;
                            siblings.forEach(sibling => {
                                const boundingBox = sibling.boundingBox();
                                const rightEdge = boundingBox.x2 || (sibling.position().x + 300);
                                if (rightEdge > maxX) {
                                    maxX = rightEdge;
                                }
                            });
                            childX = maxX + 600;
                            childY = parentInstancePos.y + 200;
                        } else {
                            // First child
                            childX = parentInstancePos.x;
                            childY = parentInstancePos.y + 200;
                        }

                        // Create the empty graph instance node for this parent instance
                        const childGraphNode = {
                            data: {
                                id: childGraphId,
                                label: graphLabel,
                                type: 'graph',
                                template_name: newTemplateName,
                                parent: parentInstanceId,
                                depth: (parentInstance.data('depth') || 0) + 1,
                                child_name: graphLabel,
                                templateColor: templateColor
                            },
                            position: { x: childX, y: childY },
                            classes: 'graph'
                        };

                        this.state.cy.add(childGraphNode);
                    });

                    console.log(`Added new template "${newTemplateName}" to ${parentTemplateInstances.length} instance(s) of parent template "${parentTemplateName}"`);
                }
            } else {
                // No parent - create single top-level instance
                // Create the empty graph instance node
                const graphNode = {
                    data: {
                        id: graphId,
                        label: graphLabel,
                        type: 'graph',
                        template_name: newTemplateName,
                        parent: parentId,
                        depth: parentDepth + 1,
                        child_name: graphLabel,
                        templateColor: templateColor
                    },
                    position: { x: baseX, y: baseY },
                    classes: 'graph'
                };

                // Add the node to the graph
                this.state.cy.add(graphNode);
            }

            // Force render
            this.state.cy.forceRender();

            // Rename graph instances to ensure proper numbering at each level
            this.renameGraphInstances();

            // Recalculate layout
            setTimeout(() => {
                this.calculateLayout();
                window.saveDefaultLayout?.();
                this.state.cy.fit(null, 50);

                setTimeout(() => {
                    this.common.forceApplyCurveStyles();
                    if (window.updatePortConnectionStatus && typeof window.updatePortConnectionStatus === 'function') {
                        window.updatePortConnectionStatus();
                    }
                    this.state.cy.forceRender();
                }, 50);
            }, 50);

            // Clear the input field
            templateNameInput.value = '';

            // Enable the Add Node button now that we have a valid canvas
            if (window.updateAddNodeButtonState && typeof window.updateAddNodeButtonState === 'function') {
                window.updateAddNodeButtonState();
            }

            // Update the connection legend to show the new template
            if (this.state.data.currentData) {
                if (window.updateConnectionLegend && typeof window.updateConnectionLegend === 'function') {
                    window.updateConnectionLegend(this.state.data.currentData);
                }
            }

            // Show success message
            const childCount = templateChildren.length;
            const connectionCount = templateConnections.length;
            const contentInfo = childCount > 0 || connectionCount > 0
                ? ` with ${childCount} node(s) and ${connectionCount} connection(s)`
                : '';

            if (parentId && parentNode) {
                const parentTemplateName = parentNode.data('template_name');
                if (parentTemplateName) {
                    const parentTemplateInstances = this.state.cy.nodes().filter(node =>
                        node.data('type') === 'graph' &&
                        node.data('template_name') === parentTemplateName
                    );
                    if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                        window.showExportStatus(`Successfully created template "${newTemplateName}"${contentInfo} and added to ${parentTemplateInstances.length} instance(s) of "${parentTemplateName}"`, 'success');
                    }
                } else {
                    if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                        window.showExportStatus(`Successfully created template "${newTemplateName}"${contentInfo} and added instance "${graphLabel}"`, 'success');
                    }
                }
            } else {
                if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                    window.showExportStatus(`Successfully created template "${newTemplateName}"${contentInfo} and added instance "${graphLabel}"`, 'success');
                }
            }

            this.refreshConnectionFilterDropdowns();

        } catch (error) {
            console.error('Error creating new template:', error);
            console.error(`Failed to create new template: ${error.message}`);
        }
    }

    /**
     * Update a parent template definition to include a new child graph
     * @param {string} parentTemplateName - The parent template to update
     * @param {string} childTemplateName - The child template to add
     * @param {string} childLabel - The label/name for the child in the template
     */
    updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel) {
        // Check if parent template exists
        if (!this.state.data.availableGraphTemplates[parentTemplateName]) {
            console.error(`[updateTemplateWithNewChild] Parent template "${parentTemplateName}" not found in availableGraphTemplates`);
            return;
        }

        // Check for existing child with same name to prevent duplicates
        const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
        const existingChild = parentTemplate && parentTemplate.children && parentTemplate.children.find(
            child => child.name === childLabel
        );

        if (existingChild) {
            console.warn(`[updateTemplateWithNewChild] Child "${childLabel}" already exists in template "${parentTemplateName}". Stack trace:`, new Error().stack);
            return; // Skip adding duplicate
        }

        // Update state.data.availableGraphTemplates
        if (this.state.data.availableGraphTemplates[parentTemplateName]) {
            const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];

            // Initialize children array if it doesn't exist
            if (!parentTemplate.children) {
                parentTemplate.children = [];
            }

            // Add the new child
            parentTemplate.children.push({
                name: childLabel,
                type: 'graph',
                graph_template: childTemplateName
            });
        }

        // Update state.data.currentData.metadata.graph_templates if it exists (for export)
        if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const parentTemplate = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
            if (parentTemplate) {
                // Check for duplicate in metadata too
                const existingMetaChild = parentTemplate.children && parentTemplate.children.find(
                    child => child.name === childLabel
                );

                if (!existingMetaChild) {
                    // Initialize children array if it doesn't exist
                    if (!parentTemplate.children) {
                        parentTemplate.children = [];
                    }

                    // Add the new child
                    parentTemplate.children.push({
                        name: childLabel,
                        type: 'graph',
                        graph_template: childTemplateName
                    });
                }
            }
        }
    }

    /**
     * Check if a template contains another template (directly or nested)
     * This is used to detect circular dependencies
     * @param {string} parentTemplateName - The parent template to check
     * @param {string} childTemplateName - The child template to look for
     * @returns {boolean} - True if parentTemplate contains childTemplate
     */
    templateContainsTemplate(parentTemplateName, childTemplateName) {
        const visited = new Set();

        const checkRecursive = (templateName) => {
            // Prevent infinite recursion
            if (visited.has(templateName)) {
                return false;
            }
            visited.add(templateName);

            const template = this.state.data.availableGraphTemplates[templateName];
            if (!template || !template.children) {
                return false;
            }

            // Check each child
            for (const child of template.children) {
                if (child.type === 'graph' && child.graph_template) {
                    // Direct match
                    if (child.graph_template === childTemplateName) {
                        return true;
                    }
                    // Recursive check - does this nested template contain the target?
                    if (checkRecursive(child.graph_template)) {
                        return true;
                    }
                }
            }

            return false;
        };

        return checkRecursive(parentTemplateName);
    }

    /**
     * Recalculate host_indices for all template instances using DFS traversal.
     * This ensures host indices are assigned in a consistent, predictable order based on
     * the graph hierarchy structure.
     */
    recalculateHostIndicesForTemplates() {
        // Delegate to common module for unified DFS traversal
        // This ensures consistent behavior across hierarchy and location modes
        this.common.recalculateHostIndices();

        // Clear the flag
        this._recalculatingHostIndices = false;
    }

    /**
     * Rename graph instances using DFS traversal to ensure proper numbering at each level.
     * Graph instances at each level are numbered based on instance count at that level.
     * The first/only pod at a level should be _0.
     */
    renameGraphInstances() {

        /**
         * DFS traversal function to process a graph node and its children
         * @param {Object} graphNode - The graph node to process (or null for root level)
         * @param {number} depth - Current depth in the traversal (for logging)
         */
        const dfsTraverse = (parentNode, depth = 0) => {
            const indent = '  '.repeat(depth);

            // Get all direct graph children of this parent
            const directGraphChildren = parentNode
                ? parentNode.children('[type="graph"]')
                : this.state.cy.nodes('[type="graph"]').filter(node => {
                    const parent = node.parent();
                    return parent.length === 0; // No parent = root level
                });

            // Group graph instances by template_name at this level
            const instancesByTemplate = new Map();
            directGraphChildren.forEach(graphNode => {
                const templateName = graphNode.data('template_name');
                if (!templateName) {
                    console.warn(`${indent}  Warning: Graph node ${graphNode.id()} has no template_name`);
                    return;
                }

                if (!instancesByTemplate.has(templateName)) {
                    instancesByTemplate.set(templateName, []);
                }
                instancesByTemplate.get(templateName).push(graphNode);
            });

            // Rename instances for each template at this level
            instancesByTemplate.forEach((instances, templateName) => {
                // Get template to preserve order if available
                const template = templateName && this.state.data.availableGraphTemplates
                    ? this.state.data.availableGraphTemplates[templateName]
                    : null;

                // Build a map of child_name -> Cytoscape node for quick lookup
                const instancesByChildName = new Map();
                instances.forEach(graphNode => {
                    const childName = graphNode.data('child_name') || graphNode.data('label') || graphNode.id();
                    instancesByChildName.set(childName, graphNode);
                });

                // Order instances according to template (if available), otherwise fall back to alphabetical
                let orderedInstances = [];
                if (template && template.children && Array.isArray(template.children)) {
                    // Follow template's children order (only graph children)
                    template.children.forEach(templateChild => {
                        if (templateChild.type === 'graph') {
                            const graphNode = instancesByChildName.get(templateChild.name);
                            if (graphNode) {
                                orderedInstances.push(graphNode);
                            }
                        }
                    });

                    // Add any instances not found in template (shouldn't happen, but handle gracefully)
                    instances.forEach(graphNode => {
                        if (!orderedInstances.includes(graphNode)) {
                            orderedInstances.push(graphNode);
                        }
                    });
                } else {
                    // Fallback: sort alphabetically if no template available
                    orderedInstances = instances.slice().sort((a, b) => {
                        const labelA = a.data('label') || a.id();
                        const labelB = b.data('label') || b.id();
                        return labelA.localeCompare(labelB);
                    });
                }

                // Get parent template metadata children for this template type (to match by index)
                let parentTemplateMetaChildren = null;
                let parentTemplateMeta = null;
                let parentTemplateName = null;
                if (orderedInstances.length > 0) {
                    const firstInstance = orderedInstances[0];
                    const parentNode = firstInstance.parent();
                    if (parentNode && parentNode.length > 0) {
                        parentTemplateName = parentNode.data('template_name');
                        if (parentTemplateName && this.state.data.currentData &&
                            this.state.data.currentData.metadata &&
                            this.state.data.currentData.metadata.graph_templates) {
                            parentTemplateMeta = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
                            if (parentTemplateMeta && parentTemplateMeta.children) {
                                // Filter to only graph children with matching template_name
                                parentTemplateMetaChildren = parentTemplateMeta.children.filter(
                                    child => child.type === 'graph' && child.graph_template === templateName
                                );
                            }
                        }
                    }
                }

                // Rename each instance to template_name_index (starting at 0)
                orderedInstances.forEach((graphNode, index) => {
                    const oldLabel = graphNode.data('label') || graphNode.id();
                    const oldChildName = graphNode.data('child_name') || oldLabel;
                    const newLabel = `${templateName}_${index}`;

                    if (oldLabel !== newLabel || oldChildName !== newLabel) {
                        graphNode.data('label', newLabel);
                        graphNode.data('child_name', newLabel);

                        // Update template metadata if this instance is a child of a template
                        // Match by index position, not by name, to avoid conflicts
                        if (parentTemplateMetaChildren && index < parentTemplateMetaChildren.length) {
                            const childEntry = parentTemplateMetaChildren[index];
                            if (childEntry && childEntry.graph_template === templateName) {
                                const oldMetaName = childEntry.name;
                                childEntry.name = newLabel;

                                // Also update connections that reference the old child name
                                // Only update if the child still exists in the template (i.e., it's being renamed, not moved)
                                if (parentTemplateMeta.connections && parentTemplateMeta.connections.length > 0) {
                                    // Check if this child still exists in the template (by verifying the childEntry was found and updated)
                                    const childStillExists = parentTemplateMeta.children.some(
                                        child => child.name === newLabel &&
                                            child.type === 'graph' &&
                                            child.graph_template === templateName
                                    );

                                    if (childStillExists) {
                                        parentTemplateMeta.connections.forEach(conn => {
                                            // Update port_a path if it references the old child name
                                            if (conn.port_a && conn.port_a.path && Array.isArray(conn.port_a.path)) {
                                                const pathIndex = conn.port_a.path.indexOf(oldMetaName);
                                                if (pathIndex !== -1) {
                                                    conn.port_a.path[pathIndex] = newLabel;
                                                }
                                            }
                                            // Update port_b path if it references the old child name
                                            if (conn.port_b && conn.port_b.path && Array.isArray(conn.port_b.path)) {
                                                const pathIndex = conn.port_b.path.indexOf(oldMetaName);
                                                if (pathIndex !== -1) {
                                                    conn.port_b.path[pathIndex] = newLabel;
                                                }
                                            }
                                        });
                                    }
                                }
                            }
                        }

                        // Also update availableGraphTemplates structure
                        if (parentTemplateName && this.state.data.availableGraphTemplates &&
                            this.state.data.availableGraphTemplates[parentTemplateName]) {
                            const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
                            if (parentTemplate && parentTemplate.children) {
                                // Filter to only graph children with matching template_name
                                const templateChildren = parentTemplate.children.filter(
                                    child => child.type === 'graph' && child.graph_template === templateName
                                );
                                if (index < templateChildren.length) {
                                    const templateChildEntry = templateChildren[index];
                                    if (templateChildEntry && templateChildEntry.graph_template === templateName) {
                                        templateChildEntry.name = newLabel;
                                    }
                                }
                            }
                        }
                    }
                });
            });

            // Recursively process nested graph nodes (DFS)
            directGraphChildren.forEach(graphNode => {
                dfsTraverse(graphNode, depth + 1);
            });
        };

        // Start DFS traversal from root level (parent = null)
        dfsTraverse(null, 0);
    }

    /**
     * Delete a child graph from all instances of its parent template
     * @param {string} childName - The name of the child to remove
     * @param {string} parentTemplateName - The parent template name
     * @param {string} childTemplateName - The child's template name (for verification)
     */
    deleteChildGraphFromAllTemplateInstances(childName, parentTemplateName, childTemplateName) {
        // First, verify that the child graph actually exists in the parent template definition
        // This ensures we only delete from the correct template, not other templates with same child name
        let childExistsInTemplate = false;
        if (this.state.data.availableGraphTemplates[parentTemplateName]) {
            const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
            if (parentTemplate.children) {
                childExistsInTemplate = parentTemplate.children.some(child =>
                    child.name === childName &&
                    child.type === 'graph' &&
                    child.graph_template === childTemplateName
                );
            }
        }

        // Also check metadata
        if (!childExistsInTemplate && this.state.data.currentData && this.state.data.currentData.metadata &&
            this.state.data.currentData.metadata.graph_templates) {
            const parentTemplate = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
            if (parentTemplate && parentTemplate.children) {
                childExistsInTemplate = parentTemplate.children.some(child =>
                    child.name === childName &&
                    child.type === 'graph' &&
                    child.graph_template === childTemplateName
                );
            }
        }

        if (!childExistsInTemplate) {
            console.warn(`Child graph "${childName}" (template: ${childTemplateName}) not found in parent template "${parentTemplateName}" definition. Skipping deletion to prevent cross-template deletion.`);
            return;
        }

        // Find all instances of the parent template (including empty ones)
        const parentTemplateInstances = this.state.cy.nodes().filter(node =>
            node.data('type') === 'graph' &&
            node.data('template_name') === parentTemplateName
        );

        let deletedCount = 0;

        // For each parent instance, find and delete the matching child graph
        parentTemplateInstances.forEach(parentInstance => {
            // Find child graphs with matching child_name or label (including empty ones)
            const childGraphs = parentInstance.children().filter(child =>
                child.data('type') === 'graph' &&
                (child.data('child_name') === childName || child.data('label') === childName)
            );

            if (childGraphs.length > 0) {
                childGraphs.forEach(childGraph => {
                    childGraph.remove(); // This will also remove all descendants
                    deletedCount++;
                });
            }
        });

        console.log(`Deleted child graph from ${deletedCount} template instance(s)`);

        // Update template definition in state.data.availableGraphTemplates
        if (this.state.data.availableGraphTemplates[parentTemplateName]) {
            const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
            if (parentTemplate.children) {
                // Remove the child from the template definition
                parentTemplate.children = parentTemplate.children.filter(child =>
                    child.name !== childName
                );
            }

            // Remove connections that reference the deleted child graph
            if (parentTemplate.connections && parentTemplate.connections.length > 0) {
                const originalConnectionCount = parentTemplate.connections.length;
                parentTemplate.connections = parentTemplate.connections.filter(conn => {
                    // Check if port_a path includes the deleted child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        conn.port_a.path.includes(childName);
                    // Check if port_b path includes the deleted child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the deleted child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - parentTemplate.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing deleted child graph "${childName}" from state.data.availableGraphTemplates["${parentTemplateName}"]`);
                }
            }
        }

        // Update template definition in metadata
        if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const parentTemplate = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
            if (parentTemplate && parentTemplate.children) {
                // Remove the child from the template definition
                parentTemplate.children = parentTemplate.children.filter(child =>
                    child.name !== childName
                );

                // Remove connections that reference the deleted child graph
                if (parentTemplate.connections && parentTemplate.connections.length > 0) {
                    const originalConnectionCount = parentTemplate.connections.length;
                    parentTemplate.connections = parentTemplate.connections.filter(conn => {
                        // Check if port_a path includes the deleted child
                        const portAReferencesChild = conn.port_a && conn.port_a.path &&
                            conn.port_a.path.includes(childName);
                        // Check if port_b path includes the deleted child
                        const portBReferencesChild = conn.port_b && conn.port_b.path &&
                            conn.port_b.path.includes(childName);

                        // Keep connection only if it doesn't reference the deleted child
                        return !portAReferencesChild && !portBReferencesChild;
                    });

                    const removedConnections = originalConnectionCount - parentTemplate.connections.length;
                    if (removedConnections > 0) {
                        console.log(`Removed ${removedConnections} connection(s) referencing deleted child graph "${childName}" from metadata graph_templates["${parentTemplateName}"]`);
                    }
                }
            }
        }

        // Recalculate host_indices for all template instances after deletion
        this.recalculateHostIndicesForTemplates();
    }

    /**
     * Delete a child node (shelf/rack) from all instances of its parent template
     * @param {string} childName - The name of the child to remove
     * @param {string} parentTemplateName - The parent template name
     * @param {string} childType - The type of child node ('shelf' or 'rack')
     */
    deleteChildNodeFromAllTemplateInstances(childName, parentTemplateName, childType) {
        // First, verify that the child actually exists in the parent template definition
        // This ensures we only delete from the correct template, not other templates with same child name
        // For shelves, they can be either:
        // 1. Direct children of the parent template
        // 2. Children of a child graph (in which case they're defined in the child graph's template)
        let childExistsInTemplate = false;
        let childGraphName = null; // Track which child graph contains the shelf (if applicable)

        if (this.state.data.availableGraphTemplates[parentTemplateName]) {
            const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
            if (parentTemplate.children) {
                // Check for direct child match
                childExistsInTemplate = parentTemplate.children.some(child =>
                    child.name === childName &&
                    ((childType === 'shelf' && child.type === 'node') ||
                        (childType === 'graph' && child.type === 'graph'))
                );

                // If not found and it's a shelf, check if it's in a child graph's template
                if (!childExistsInTemplate && childType === 'shelf') {
                    for (const child of parentTemplate.children) {
                        if (child.type === 'graph' && child.graph_template) {
                            // Check if the child graph's template contains this shelf
                            const childGraphTemplate = this.state.data.availableGraphTemplates[child.graph_template];
                            if (childGraphTemplate && childGraphTemplate.children) {
                                const shelfInChildGraph = childGraphTemplate.children.some(c =>
                                    c.name === childName && c.type === 'node'
                                );
                                if (shelfInChildGraph) {
                                    childExistsInTemplate = true;
                                    childGraphName = child.name;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Also check metadata
        if (!childExistsInTemplate && this.state.data.currentData && this.state.data.currentData.metadata &&
            this.state.data.currentData.metadata.graph_templates) {
            const parentTemplate = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
            if (parentTemplate && parentTemplate.children) {
                // Check for direct child match
                childExistsInTemplate = parentTemplate.children.some(child =>
                    child.name === childName &&
                    ((childType === 'shelf' && child.type === 'node') ||
                        (childType === 'graph' && child.type === 'graph'))
                );

                // If not found and it's a shelf, check if it's in a child graph's template
                if (!childExistsInTemplate && childType === 'shelf') {
                    for (const child of parentTemplate.children) {
                        if (child.type === 'graph' && child.graph_template) {
                            const childGraphTemplate = this.state.data.currentData.metadata.graph_templates[child.graph_template];
                            if (childGraphTemplate && childGraphTemplate.children) {
                                const shelfInChildGraph = childGraphTemplate.children.some(c =>
                                    c.name === childName && c.type === 'node'
                                );
                                if (shelfInChildGraph) {
                                    childExistsInTemplate = true;
                                    childGraphName = child.name;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!childExistsInTemplate) {
            console.warn(`Child "${childName}" not found in template "${parentTemplateName}" definition. Skipping deletion to prevent cross-template deletion.`);
            return;
        }

        // Find all instances of the parent template (including empty ones)
        const parentTemplateInstances = this.state.cy.nodes().filter(node =>
            node.data('type') === 'graph' &&
            node.data('template_name') === parentTemplateName
        );

        let deletedCount = 0;

        // For each parent instance, find and delete the matching child node
        parentTemplateInstances.forEach(parentInstance => {
            const parentId = parentInstance.id();

            // Find direct children first, then check if they match
            // This ensures we only delete nodes that are direct children of this specific template instance
            const directChildren = parentInstance.children();

            // Filter to find nodes that match the child_name and are direct children
            // For shelf nodes, we need to check if they're direct children or in a direct child graph
            const matchingChildNodes = [];

            directChildren.forEach(directChild => {
                if (directChild.data('type') === childType) {
                    // Direct child of the correct type - verify it matches the child name
                    if (directChild.data('child_name') === childName || directChild.data('label') === childName) {
                        matchingChildNodes.push(directChild);
                    }
                } else if (directChild.data('type') === 'graph' && childType === 'shelf') {
                    // For shelf nodes within child graphs, verify:
                    // 1. If childGraphName is set, only search in that specific child graph
                    // 2. If childGraphName is null, the shelf is a direct child, so skip child graphs

                    if (childGraphName !== null) {
                        // Shelf is in a child graph - only match if this is the correct child graph
                        const childGraphInstanceName = directChild.data('child_name') || directChild.data('label');

                        if (childGraphInstanceName === childGraphName) {
                            // Find shelves that are direct children of this child graph
                            const shelvesInGraph = directChild.children().filter(desc =>
                                desc.data('type') === childType &&
                                (desc.data('child_name') === childName || desc.data('label') === childName)
                            );

                            // Verify each shelf's parent is actually this direct child graph
                            shelvesInGraph.forEach(shelf => {
                                const shelfParent = shelf.parent();
                                if (shelfParent.length > 0 && shelfParent.id() === directChild.id()) {
                                    matchingChildNodes.push(shelf);
                                }
                            });
                        }
                    }
                    // If childGraphName is null, shelf is a direct child, so we skip child graphs
                }
            });

            if (matchingChildNodes.length > 0) {
                matchingChildNodes.forEach(childNode => {
                    // Verify this node is actually a descendant of the parent instance
                    // Double-check to ensure we're not deleting from wrong template
                    const ancestors = childNode.ancestors();
                    const isDescendantOfParent = ancestors.some(anc => anc.id() === parentId) || childNode.parent().id() === parentId;

                    if (isDescendantOfParent) {
                        childNode.remove(); // This will also remove all descendants (trays, ports, etc.)
                        deletedCount++;
                    } else {
                        console.warn(`Skipping deletion of ${childName} - not a descendant of parent template instance ${parentId}`);
                    }
                });
            }
        });

        console.log(`Deleted ${childType} from ${deletedCount} template instance(s)`);

        // Update template definition in state.data.availableGraphTemplates
        if (this.state.data.availableGraphTemplates[parentTemplateName]) {
            const parentTemplate = this.state.data.availableGraphTemplates[parentTemplateName];
            if (parentTemplate.children) {
                // Remove the child from the template definition
                parentTemplate.children = parentTemplate.children.filter(child =>
                    child.name !== childName
                );
            }

            // Remove connections that reference the deleted child
            if (parentTemplate.connections && parentTemplate.connections.length > 0) {
                const originalConnectionCount = parentTemplate.connections.length;
                parentTemplate.connections = parentTemplate.connections.filter(conn => {
                    // Check if port_a path includes the deleted child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        conn.port_a.path.includes(childName);
                    // Check if port_b path includes the deleted child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the deleted child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - parentTemplate.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing deleted ${childType} "${childName}" from state.data.availableGraphTemplates["${parentTemplateName}"]`);
                }
            }
        }

        // Update template definition in metadata
        if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const parentTemplate = this.state.data.currentData.metadata.graph_templates[parentTemplateName];
            if (parentTemplate && parentTemplate.children) {
                // Remove the child from the template definition
                parentTemplate.children = parentTemplate.children.filter(child =>
                    child.name !== childName
                );

                // Remove connections that reference the deleted child
                if (parentTemplate.connections && parentTemplate.connections.length > 0) {
                    const originalConnectionCount = parentTemplate.connections.length;
                    parentTemplate.connections = parentTemplate.connections.filter(conn => {
                        // Check if port_a path includes the deleted child
                        const portAReferencesChild = conn.port_a && conn.port_a.path &&
                            conn.port_a.path.includes(childName);
                        // Check if port_b path includes the deleted child
                        const portBReferencesChild = conn.port_b && conn.port_b.path &&
                            conn.port_b.path.includes(childName);

                        // Keep connection only if it doesn't reference the deleted child
                        return !portAReferencesChild && !portBReferencesChild;
                    });

                    const removedConnections = originalConnectionCount - parentTemplate.connections.length;
                    if (removedConnections > 0) {
                        console.log(`Removed ${removedConnections} connection(s) referencing deleted ${childType} "${childName}" from metadata graph_templates["${parentTemplateName}"]`);
                    }
                }
            }
        }

        // Recalculate host_indices for all template instances after deletion
        this.recalculateHostIndicesForTemplates();
    }

    /**
     * Enumerate valid parent templates for moving a node/graph instance
     * @param {Object} node - The node to find valid parents for
     * @returns {Array} Array of {templateName, instanceCount} objects
     */
    enumerateValidParentTemplates(node) {
        const validTemplates = [];
        const nodeType = node.data('type');
        const nodeTemplateName = node.data('template_name');

        if (!this.state.data.availableGraphTemplates) return validTemplates;

        // Get current parent template
        const currentParent = node.parent();
        const currentParentTemplate = currentParent.length > 0 ? currentParent.data('template_name') : null;

        // Get all descendants' template names to avoid circular dependencies
        const descendantTemplates = new Set();
        if (nodeType === 'graph') {
            node.descendants('[type="graph"]').forEach(desc => {
                const descTemplate = desc.data('template_name');
                if (descTemplate) {
                    descendantTemplates.add(descTemplate);
                }
            });
        }

        // Check each available template
        Object.keys(this.state.data.availableGraphTemplates).forEach(templateName => {
            // Skip if this is the current parent
            if (templateName === currentParentTemplate) {
                return;
            }

            // Skip if this would create a circular dependency
            if (nodeType === 'graph' && descendantTemplates.has(templateName)) {
                return;
            }

            // Skip if this is the node's own template (can't move into itself)
            if (templateName === nodeTemplateName) {
                return;
            }

            // Count instances of this template
            const instanceCount = this.state.cy.nodes().filter(n =>
                n.data('template_name') === templateName && n.data('type') === 'graph'
            ).length;

            validTemplates.push({
                templateName: templateName,
                instanceCount: instanceCount
            });
        });

        // Sort by template name
        validTemplates.sort((a, b) => a.templateName.localeCompare(b.templateName));

        return validTemplates;
    }

    /**
     * Move a node (shelf) to a different template
     * @param {Object} node - The shelf node to move
     * @param {string} targetTemplateName - The target template name
     * @param {string} currentParentTemplate - The current parent template name
     */
    moveNodeToTemplate(node, targetTemplateName, currentParentTemplate) {
        const childName = node.data('child_name');
        const nodeType = node.data('shelf_node_type');

        // Step 1: Remove from current parent template definition
        if (currentParentTemplate && this.state.data.availableGraphTemplates[currentParentTemplate]) {
            const template = this.state.data.availableGraphTemplates[currentParentTemplate];
            if (template.children) {
                template.children = template.children.filter(child => child.name !== childName);
            }

            // Remove connections that reference the moved node
            if (template.connections && template.connections.length > 0) {
                const originalConnectionCount = template.connections.length;
                template.connections = template.connections.filter(conn => {
                    // Check if port_a path includes the moved child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        Array.isArray(conn.port_a.path) && conn.port_a.path.includes(childName);
                    // Check if port_b path includes the moved child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        Array.isArray(conn.port_b.path) && conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the moved child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - template.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing moved node "${childName}" from availableGraphTemplates["${currentParentTemplate}"]`);
                }
            }
        }

        // Also remove from state.data.currentData.metadata.graph_templates
        if (currentParentTemplate && this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const metaTemplate = this.state.data.currentData.metadata.graph_templates[currentParentTemplate];
            if (metaTemplate && metaTemplate.children) {
                metaTemplate.children = metaTemplate.children.filter(child => child.name !== childName);
            }

            // Remove connections that reference the moved node from metadata
            if (metaTemplate && metaTemplate.connections && metaTemplate.connections.length > 0) {
                const originalConnectionCount = metaTemplate.connections.length;
                metaTemplate.connections = metaTemplate.connections.filter(conn => {
                    // Check if port_a path includes the moved child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        Array.isArray(conn.port_a.path) && conn.port_a.path.includes(childName);
                    // Check if port_b path includes the moved child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        Array.isArray(conn.port_b.path) && conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the moved child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - metaTemplate.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing moved node "${childName}" from metadata graph_templates["${currentParentTemplate}"]`);
                }
            }
        }

        // Step 2: Add to target template definition (or root-instance)
        if (targetTemplateName === null) {
            // Moving to root-instance: update metadata to indicate root-level addition
            if (this.state.data.currentData && this.state.data.currentData.metadata) {
                this.state.data.currentData.metadata.hasTopLevelAdditions = true;
                console.log(`[moveNodeToTemplate] Node "${childName}" moved to root-instance`);
            }
        } else if (this.state.data.availableGraphTemplates[targetTemplateName]) {
            const targetTemplate = this.state.data.availableGraphTemplates[targetTemplateName];
            if (!targetTemplate.children) {
                targetTemplate.children = [];
            }
            targetTemplate.children.push({
                name: childName,
                type: 'node',
                node_descriptor: nodeType
            });
        }

        // Also add to state.data.currentData.metadata.graph_templates (if not root-instance)
        if (targetTemplateName !== null && this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const metaTargetTemplate = this.state.data.currentData.metadata.graph_templates[targetTemplateName];
            if (metaTargetTemplate) {
                if (!metaTargetTemplate.children) {
                    metaTargetTemplate.children = [];
                }
                metaTargetTemplate.children.push({
                    name: childName,
                    type: 'node',
                    node_descriptor: nodeType
                });
            }
        }

        // Step 3: Remove the original node and from all instances of old parent template
        if (currentParentTemplate) {
            const oldParentInstances = this.state.cy.nodes().filter(n =>
                n.data('template_name') === currentParentTemplate && n.data('type') === 'graph'
            );

            oldParentInstances.forEach(parentInstance => {
                // Find child nodes by child_name instead of trying to construct ID
                const childNodesToRemove = parentInstance.children().filter(child =>
                    child.data('type') === 'shelf' && child.data('child_name') === childName
                );

                childNodesToRemove.forEach(childNode => {
                    console.log(`Removing shelf node "${childNode.data('label')}" (ID: ${childNode.id()}) from parent instance "${parentInstance.data('label')}"`);
                    childNode.remove(); // This will also remove all descendants (trays, ports)
                });
            });
        } else {
            // Handle root-level shelf node: remove the specific node being moved (or all matching root-level instances)
            // First try to remove the specific node if it's still in Cytoscape
            const nodeToRemove = this.state.cy.getElementById(node.id());
            if (nodeToRemove && nodeToRemove.length > 0) {
                const parent = nodeToRemove.parent();
                if (parent.length === 0) { // Ensure it's still root-level
                    console.log(`Removing root-level shelf node "${nodeToRemove.data('label')}" (ID: ${nodeToRemove.id()})`);
                    nodeToRemove.remove(); // This will also remove all descendants (trays, ports)
                }
            } else {
                // Fallback: remove all root-level shelf nodes with matching child_name
                const rootLevelNodesToRemove = this.state.cy.nodes().filter(n => {
                    const parent = n.parent();
                    return parent.length === 0 && // No parent (root level)
                        n.data('type') === 'shelf' &&
                        n.data('child_name') === childName;
                });

                rootLevelNodesToRemove.forEach(rootNode => {
                    console.log(`Removing root-level shelf node "${rootNode.data('label')}" (ID: ${rootNode.id()})`);
                    rootNode.remove(); // This will also remove all descendants (trays, ports)
                });
            }
        }

        // Mark hierarchy structure as changed (forces re-import of deployment descriptor)
        this.state.data.hierarchyStructureChanged = true;
        console.log('[Hierarchy.moveNodeToTemplate] Hierarchy structure changed - deployment descriptor needs re-import');

        // Step 4: Add to all instances of target template (or root-instance)
        let targetInstances = [];
        if (targetTemplateName === null) {
            // Moving to root-instance: create root-level node
            // No parent instances to iterate over, we'll create directly at root
            targetInstances = [null]; // Use null to indicate root-level
        } else {
            targetInstances = this.state.cy.nodes().filter(n =>
                n.data('template_name') === targetTemplateName && n.data('type') === 'graph'
            );
        }

        targetInstances.forEach(targetInstance => {
            // Create the node in this instance
            // Preserve full node type (including variations) - getNodeConfig normalizes internally
            const config = getNodeConfig(nodeType);
            if (!config) {
                console.warn(`Unknown node type: ${nodeType}`);
                return;
            }

            const hostIndex = this.state.data.globalHostCounter++;
            // Use same ID pattern as template instantiation: ${graphId}_${child.name} or just ${childName} for root
            const shelfId = targetInstance ? `${targetInstance.id()}_${childName}` : childName;
            const shelfLabel = `${childName} (host_${hostIndex})`;

            // Add shelf node - preserve full node type (including variations) in shelf_node_type
            const shelfNodeData = {
                group: 'nodes',
                data: {
                    id: shelfId,
                    label: shelfLabel,
                    type: 'shelf',
                    host_index: hostIndex,
                    shelf_node_type: nodeType, // Store full type including variations
                    child_name: childName
                },
                classes: 'shelf',
                position: { x: 0, y: 0 }
            };

            // Only set parent if not moving to root-instance
            if (targetInstance) {
                shelfNodeData.data.parent = targetInstance.id();
            }

            this.state.cy.add(shelfNodeData);

            // Create trays and ports using nodeFactory - use full node type (normalizes internally)
            const location = childName ? { hostname: childName } : {};
            const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(shelfId, hostIndex, nodeType, location);
            this.state.cy.add(trayPortNodes);

            // Arrange trays and ports
            const addedShelf = this.state.cy.getElementById(shelfId);
            this.common.arrangeTraysAndPorts(addedShelf);

            // Create internal connections for node type variations (DEFAULT, X_TORUS, Y_TORUS, XY_TORUS)
            // Use the full node type to determine which internal connections to create
            this.common.createInternalConnectionsForNode(shelfId, nodeType, hostIndex);
        });

        // Recalculate host indices
        this.recalculateHostIndicesForTemplates();

        // Rename graph instances to ensure proper numbering at each level
        this.renameGraphInstances();

        this.refreshConnectionFilterDropdowns();
    }

    /**
     * Move a graph instance to a different template
     * @param {Object} node - The graph node to move
     * @param {string} targetTemplateName - The target template name
     * @param {string} currentParentTemplate - The current parent template name
     */
    moveGraphInstanceToTemplate(node, targetTemplateName, currentParentTemplate) {
        const childName = node.data('child_name');
        const graphTemplateName = node.data('template_name');

        // Step 1: Remove from current parent template definition
        if (currentParentTemplate && this.state.data.availableGraphTemplates[currentParentTemplate]) {
            const template = this.state.data.availableGraphTemplates[currentParentTemplate];
            if (template.children) {
                template.children = template.children.filter(child => child.name !== childName);
            }

            // Remove connections that reference the moved child
            if (template.connections && template.connections.length > 0) {
                const originalConnectionCount = template.connections.length;
                template.connections = template.connections.filter(conn => {
                    // Check if port_a path includes the moved child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        Array.isArray(conn.port_a.path) && conn.port_a.path.includes(childName);
                    // Check if port_b path includes the moved child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        Array.isArray(conn.port_b.path) && conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the moved child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - template.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing moved graph instance "${childName}" from availableGraphTemplates["${currentParentTemplate}"]`);
                }
            }
        }

        // Also remove from state.data.currentData.metadata.graph_templates
        if (currentParentTemplate && this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const metaTemplate = this.state.data.currentData.metadata.graph_templates[currentParentTemplate];
            if (metaTemplate && metaTemplate.children) {
                metaTemplate.children = metaTemplate.children.filter(child => child.name !== childName);
            }

            // Remove connections that reference the moved child from metadata
            if (metaTemplate && metaTemplate.connections && metaTemplate.connections.length > 0) {
                const originalConnectionCount = metaTemplate.connections.length;
                metaTemplate.connections = metaTemplate.connections.filter(conn => {
                    // Check if port_a path includes the moved child
                    const portAReferencesChild = conn.port_a && conn.port_a.path &&
                        Array.isArray(conn.port_a.path) && conn.port_a.path.includes(childName);
                    // Check if port_b path includes the moved child
                    const portBReferencesChild = conn.port_b && conn.port_b.path &&
                        Array.isArray(conn.port_b.path) && conn.port_b.path.includes(childName);

                    // Keep connection only if it doesn't reference the moved child
                    return !portAReferencesChild && !portBReferencesChild;
                });

                const removedConnections = originalConnectionCount - metaTemplate.connections.length;
                if (removedConnections > 0) {
                    console.log(`Removed ${removedConnections} connection(s) referencing moved graph instance "${childName}" from metadata graph_templates["${currentParentTemplate}"]`);
                }
            }
        }

        // Step 2: Add to target template definition (or root-instance)
        if (targetTemplateName === null) {
            // Moving to root-instance: update metadata to indicate root-level addition
            if (this.state.data.currentData && this.state.data.currentData.metadata) {
                this.state.data.currentData.metadata.hasTopLevelAdditions = true;
                // Update initialRootTemplate if needed
                if (!this.state.data.currentData.metadata.initialRootTemplate) {
                    this.state.data.currentData.metadata.initialRootTemplate = graphTemplateName;
                }
                console.log(`[moveGraphInstanceToTemplate] Graph instance "${childName}" (template: ${graphTemplateName}) moved to root-instance`);
            }
        } else if (this.state.data.availableGraphTemplates[targetTemplateName]) {
            const targetTemplate = this.state.data.availableGraphTemplates[targetTemplateName];
            if (!targetTemplate.children) {
                targetTemplate.children = [];
            }

            // Check if this child already exists to prevent duplicates
            const childExists = targetTemplate.children.some(
                child => child.type === 'graph' && child.graph_template === graphTemplateName && child.name === childName
            );

            if (!childExists) {
                targetTemplate.children.push({
                    name: childName,
                    type: 'graph',
                    graph_template: graphTemplateName
                });
                console.log(`[moveGraphInstanceToTemplate] Added child "${childName}" (template: ${graphTemplateName}) to target template "${targetTemplateName}"`);
            } else {
                console.warn(`[moveGraphInstanceToTemplate] Child "${childName}" (template: ${graphTemplateName}) already exists in target template "${targetTemplateName}", skipping duplicate`);
            }
        }

        // Also add to state.data.currentData.metadata.graph_templates (if not root-instance)
        if (targetTemplateName !== null && this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const metaTargetTemplate = this.state.data.currentData.metadata.graph_templates[targetTemplateName];
            if (metaTargetTemplate) {
                if (!metaTargetTemplate.children) {
                    metaTargetTemplate.children = [];
                }

                // Check if this child already exists in metadata to prevent duplicates
                const metaChildExists = metaTargetTemplate.children.some(
                    child => child.type === 'graph' && child.graph_template === graphTemplateName && child.name === childName
                );

                if (!metaChildExists) {
                    metaTargetTemplate.children.push({
                        name: childName,
                        type: 'graph',
                        graph_template: graphTemplateName
                    });
                } else {
                    console.warn(`[moveGraphInstanceToTemplate] Child "${childName}" (template: ${graphTemplateName}) already exists in metadata graph_templates["${targetTemplateName}"], skipping duplicate`);
                }
            }
        }

        // Step 3: Remove the original graph instance and from all instances of old parent template
        if (currentParentTemplate) {
            const oldParentInstances = this.state.cy.nodes().filter(n =>
                n.data('template_name') === currentParentTemplate && n.data('type') === 'graph'
            );

            oldParentInstances.forEach(parentInstance => {
                // Find child graph instances by child_name and template_name instead of trying to construct ID
                const childGraphsToRemove = parentInstance.children().filter(child =>
                    child.data('type') === 'graph' &&
                    child.data('child_name') === childName &&
                    child.data('template_name') === graphTemplateName
                );

                childGraphsToRemove.forEach(childGraph => {
                    console.log(`Removing graph instance "${childGraph.data('label')}" (ID: ${childGraph.id()}) from parent instance "${parentInstance.data('label')}"`);
                    childGraph.remove(); // This will also remove all descendants
                });
            });
        } else {
            // Handle root-level graph: remove the specific node being moved (or all matching root-level instances)
            // First try to remove the specific node if it's still in Cytoscape
            const nodeToRemove = this.state.cy.getElementById(node.id());
            if (nodeToRemove && nodeToRemove.length > 0) {
                const parent = nodeToRemove.parent();
                if (parent.length === 0) { // Ensure it's still root-level
                    console.log(`Removing root-level graph instance "${nodeToRemove.data('label')}" (ID: ${nodeToRemove.id()})`);

                    // Update metadata: the new container template becomes the root
                    if (this.state.data.currentData && this.state.data.currentData.metadata) {
                        this.state.data.currentData.metadata.initialRootTemplate = targetTemplateName;
                        this.state.data.currentData.metadata.hasTopLevelAdditions = true;
                        console.log(`Updated initialRootTemplate to "${targetTemplateName}"`);
                    }

                    nodeToRemove.remove(); // This will also remove all descendants
                }
            } else {
                // Fallback: remove all root-level instances with matching child_name and template_name
                const rootLevelInstancesToRemove = this.state.cy.nodes().filter(n => {
                    const parent = n.parent();
                    return parent.length === 0 && // No parent (root level)
                        n.data('type') === 'graph' &&
                        n.data('child_name') === childName &&
                        n.data('template_name') === graphTemplateName;
                });

                if (rootLevelInstancesToRemove.length > 0) {
                    // Update metadata: the new container template becomes the root
                    if (this.state.data.currentData && this.state.data.currentData.metadata) {
                        this.state.data.currentData.metadata.initialRootTemplate = targetTemplateName;
                        this.state.data.currentData.metadata.hasTopLevelAdditions = true;
                        console.log(`Updated initialRootTemplate to "${targetTemplateName}"`);
                    }
                }

                rootLevelInstancesToRemove.forEach(rootInstance => {
                    console.log(`Removing root-level graph instance "${rootInstance.data('label')}" (ID: ${rootInstance.id()})`);
                    rootInstance.remove(); // This will also remove all descendants
                });
            }
        }

        // Step 4: Add to all instances of target template (or root-instance)
        let targetInstances = [];
        if (targetTemplateName === null) {
            // Moving to root-instance: create root-level graph instance
            targetInstances = [null]; // Use null to indicate root-level
            console.log(`[moveGraphInstanceToTemplate] Moving template "${graphTemplateName}" (child name: "${childName}") to root-instance`);
        } else {
            targetInstances = this.state.cy.nodes().filter(n =>
                n.data('template_name') === targetTemplateName && n.data('type') === 'graph'
            );
            console.log(`[moveGraphInstanceToTemplate] Found ${targetInstances.length} target instance(s) of template "${targetTemplateName}"`);
            console.log(`[moveGraphInstanceToTemplate] Moving template "${graphTemplateName}" (child name: "${childName}") into target template "${targetTemplateName}"`);
        }

        // Log the structure of the template being moved to verify nested children are preserved
        const graphTemplate = this.state.data.availableGraphTemplates[graphTemplateName];
        if (!graphTemplate) {
            throw new Error(`Template "${graphTemplateName}" not found`);
        }

        const childTemplatesInMovedTemplate = graphTemplate.children ?
            graphTemplate.children.filter(c => c.type === 'graph').map(c => `${c.name} (${c.graph_template})`) : [];
        console.log(`[moveGraphInstanceToTemplate] Template "${graphTemplateName}" contains ${childTemplatesInMovedTemplate.length} child template(s): [${childTemplatesInMovedTemplate.join(', ')}]`);

        // Log the current structure of the target template (if not root-instance)
        if (targetTemplateName !== null) {
            const targetTemplate = this.state.data.availableGraphTemplates[targetTemplateName];
            const childTemplatesInTarget = targetTemplate && targetTemplate.children ?
                targetTemplate.children.filter(c => c.type === 'graph').map(c => `${c.name} (${c.graph_template})`) : [];
            console.log(`[moveGraphInstanceToTemplate] Target template "${targetTemplateName}" currently contains ${childTemplatesInTarget.length} child template(s): [${childTemplatesInTarget.join(', ')}]`);
        }

        // Collect all nodes and deferred connections first, then process connections once
        // This prevents duplicate connections when multiple target instances exist
        const allNodesToAdd = [];
        const allEdgesToAdd = [];
        const allDeferredConnections = [];

        console.log('[hierarchy] moveGraphInstanceToTemplate: instantiating for', targetInstances.length, 'target(s)');
        targetInstances.forEach(targetInstance => {
            const nodesToAdd = [];
            const edgesToAdd = [];
            const deferredConnections = [];

            // For root-instance, use childName as the ID; otherwise use parent ID prefix
            const childGraphId = targetInstance ? `${targetInstance.id()}_${childName}` : childName;
            const childGraphLabel = childName;
            // For root-instance, depth should be 0; otherwise depth is parent's depth + 1
            const parentDepth = targetInstance ? (targetInstance.data('depth') || 0) : -1;
            const parentId = targetInstance ? targetInstance.id() : null;

            // Instantiate the template recursively
            this.instantiateTemplate(
                graphTemplate,
                graphTemplateName,
                childGraphId,
                childGraphLabel,
                'graph',
                parentId,
                0,
                0,
                nodesToAdd,
                edgesToAdd,
                {},
                deferredConnections,
                childName,
                parentDepth
            );

            // Collect nodes and deferred connections for batch processing
            allNodesToAdd.push(...nodesToAdd);
            allDeferredConnections.push(...deferredConnections);
        });

        // Add all nodes first (batched with edges below)
        console.log('[hierarchy] moveGraphInstanceToTemplate: adding', allNodesToAdd.length, 'nodes to cy');
        this.state.cy.startBatch();
        this.state.cy.add(allNodesToAdd);

        // Update logical_path for shelf nodes now that parent graphs are in Cytoscape
        allNodesToAdd.forEach(nodeData => {
            if (nodeData.data && nodeData.data.type === 'shelf') {
                const shelfNode = this.state.cy.getElementById(nodeData.data.id);
                if (shelfNode && shelfNode.length > 0) {
                    const parent = shelfNode.parent();
                    if (parent && parent.length > 0 && parent.data('type') === 'graph') {
                        // Build logical_path from parent graph hierarchy
                        const pathParts = [];
                        let current = parent;
                        while (current && current.length > 0) {
                            const childName = current.data('child_name') || current.data('label');
                            if (childName) {
                                pathParts.unshift(childName);
                            }
                            const grandParent = current.parent();
                            if (grandParent && grandParent.length > 0 && grandParent.data('type') === 'graph') {
                                current = grandParent;
                            } else {
                                break;
                            }
                        }
                        shelfNode.data('logical_path', pathParts);
                    }
                    this.common.arrangeTraysAndPorts(shelfNode);
                }
            }
        });

        // Process all deferred connections once after all nodes are added
        // This ensures we check against the final state and avoid duplicates
        this.processDeferredConnections(allDeferredConnections, allEdgesToAdd);
        this.state.cy.add(allEdgesToAdd);
        this.state.cy.endBatch();

        console.log(`[moveGraphInstanceToTemplate] Added ${allNodesToAdd.length} nodes and ${allEdgesToAdd.length} edges across ${targetInstances.length} target instance(s)`);

        // Recalculate host indices
        console.log('[hierarchy] moveGraphInstanceToTemplate: recalculateHostIndicesForTemplates start');
        this.recalculateHostIndicesForTemplates();
        console.log('[hierarchy] moveGraphInstanceToTemplate: recalculateHostIndicesForTemplates done');
        // Rename graph instances to ensure proper numbering at each level
        this.renameGraphInstances();

        this.refreshConnectionFilterDropdowns();
        console.log('[hierarchy] moveGraphInstanceToTemplate: done');
    }

    /**
     * Refresh both Connection Options filter dropdowns to match current graph/templates.
     * Call after any hierarchy operation that adds/removes nodes or templates.
     */
    refreshConnectionFilterDropdowns() {
        if (!this.state || !this.state.cy) {
            return;
        }
        window.populateNodeFilterDropdown?.();
        this.populateTemplateFilterDropdown();
    }

    /**
     * Populate template filter dropdown with available templates
     * Collects templates from availableGraphTemplates and edges
     * Also includes "Node Connections" for internal connections
     */
    populateTemplateFilterDropdown() {
        if (!this.state || !this.state.cy) {
            return;
        }

        const templateFilterSelect = document.getElementById('templateFilterSelect');
        if (!templateFilterSelect) {
            return;
        }

        // Clear existing options
        templateFilterSelect.innerHTML = '<option value="">Show all templates</option>';

        // Check if there are any internal connections
        const hasInternalConnections = this.state.cy.edges().some(edge => edge.data('is_internal') === true);

        // Add "Node Connections" option if internal connections exist
        if (hasInternalConnections) {
            const nodeConnectionsOption = document.createElement('option');
            nodeConnectionsOption.value = '__NODE_CONNECTIONS__';
            nodeConnectionsOption.textContent = 'Node Connections';
            templateFilterSelect.appendChild(nodeConnectionsOption);
        }

        // Collect unique template names from available templates and edges
        const templateSet = new Set();

        // Get templates from availableGraphTemplates
        if (this.state.data.availableGraphTemplates) {
            Object.keys(this.state.data.availableGraphTemplates).forEach(templateName => {
                templateSet.add(templateName);
            });
        }

        // Also collect templates from edges (in case some templates aren't in availableGraphTemplates)
        this.state.cy.edges().forEach(edge => {
            const templateName = edge.data('template_name') || edge.data('containerTemplate');
            if (templateName) {
                templateSet.add(templateName);
            }
        });

        // Convert to sorted array
        const templates = Array.from(templateSet).sort();

        // Add options to dropdown
        templates.forEach(templateName => {
            const option = document.createElement('option');
            option.value = templateName;
            option.textContent = templateName;
            templateFilterSelect.appendChild(option);
        });
    }

    /**
     * Check if an edge should be shown based on template filter
     * @param {Object} edge - Cytoscape edge
     * @returns {boolean} True if edge matches template filter (or no filter is set)
     */
    shouldShowConnectionByTemplate(edge) {
        const templateFilterSelect = document.getElementById('templateFilterSelect');
        const selectedTemplate = templateFilterSelect ? templateFilterSelect.value : '';

        // If no template filter is set, show all connections
        if (selectedTemplate === '') {
            return true;
        }

        // Special handling for "Node Connections" filter (internal connections)
        if (selectedTemplate === '__NODE_CONNECTIONS__') {
            return edge.data('is_internal') === true;
        }

        // Check if edge's template matches selected template
        const edgeTemplate = edge.data('template_name') || edge.data('containerTemplate');
        return edgeTemplate === selectedTemplate;
    }

    /**
     * Get the selected template filter value
     * @returns {string} Selected template name or empty string if "Show all templates"
     */
    getSelectedTemplateFilter() {
        const templateFilterSelect = document.getElementById('templateFilterSelect');
        return templateFilterSelect ? templateFilterSelect.value : '';
    }

    /**
     * Add event handlers for template filter dropdown
     * This filter is only used in hierarchy/logical mode
     */
    addTemplateFilterHandler() {
        // Add event listener to template filter dropdown
        const templateFilterSelect = document.getElementById('templateFilterSelect');
        if (!templateFilterSelect) {
            return;
        }

        // Remove existing listeners to avoid duplicates by cloning the element
        const newTemplateFilterSelect = templateFilterSelect.cloneNode(true);
        templateFilterSelect.parentNode.replaceChild(newTemplateFilterSelect, templateFilterSelect);

        newTemplateFilterSelect.addEventListener('change', () => {
            // Only apply template filter if we're in hierarchy mode
            if (this.state.mode !== 'hierarchy') {
                return;
            }

            // Apply filters when template selection changes
            // In hierarchy mode, always use applyNodeFilter which handles template filters
            if (window.applyNodeFilter && typeof window.applyNodeFilter === 'function') {
                window.applyNodeFilter();
            }
        });
    }

    /**
     * Populate the dropdown with valid parent templates for moving
     * @param {Object} node - The node/graph to find valid parent templates for
     */
    populateMoveTargetTemplates(node) {
        const select = document.getElementById('moveTargetTemplateSelect');
        if (!select) return;

        // Get list of valid parent templates
        const validTemplates = this.enumerateValidParentTemplates(node);

        // Clear and rebuild dropdown
        select.innerHTML = '<option value="">-- Select Target Template --</option>';

        // Add root-instance option (always available unless node is already at root)
        const currentParent = node.parent();
        const isAlreadyAtRoot = currentParent.length === 0;
        if (!isAlreadyAtRoot) {
            const rootOption = document.createElement('option');
            rootOption.value = '__ROOT_INSTANCE__';
            rootOption.textContent = 'root-instance (root level)';
            select.appendChild(rootOption);
        }

        if (validTemplates.length === 0) {
            if (isAlreadyAtRoot) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '(No valid targets available)';
                option.disabled = true;
                select.appendChild(option);
            }
        } else {
            validTemplates.forEach(templateInfo => {
                const option = document.createElement('option');
                option.value = templateInfo.templateName;
                option.textContent = `${templateInfo.templateName} (${templateInfo.instanceCount} instance${templateInfo.instanceCount !== 1 ? 's' : ''})`;
                select.appendChild(option);
            });
        }
    }

    /**
     * Enable graph template editing UI
     * @param {Object} node - The graph node to edit
     * @param {Object} position - Position for the popup
     */
    enableGraphTemplateEditing(node, _position) {
        const data = node.data();
        const isEditingModeEnabled = this.state.editing.isEdgeCreationMode;

        // Build content HTML
        let contentHtml = `Label: ${data.label || data.id}<br>`;
        contentHtml += `Type: ${data.type || 'Unknown'}<br>`;
        if (data.template_name) {
            contentHtml += `Template: ${data.template_name}<br>`;
        }
        contentHtml += `<br>`;

        // Rename Template section (only for graph nodes and only in editing mode)
        if (data.type === 'graph' && isEditingModeEnabled) {
            contentHtml += `<div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">`;
            contentHtml += `<strong>Rename Template:</strong><br>`;
            contentHtml += `<input type="text" id="templateNameEditInput" value="${data.template_name || ''}" placeholder="Enter template name" style="width: 200px; padding: 5px; margin-top: 5px;">`;
            contentHtml += `<br>`;
            contentHtml += `<button onclick="saveGraphTemplateEdit('${node.id()}')" style="padding: 6px 12px; background: #4CAF50; color: white; border: none; cursor: pointer; margin-top: 8px;">Rename Template</button>`;
            contentHtml += `</div>`;
        }

        // Move to Template section (only in editing mode)
        if (this.state.editing.isEdgeCreationMode) {
            contentHtml += `<div style="margin-bottom: 15px; padding: 10px; background: #e7f3ff; border-radius: 4px;">`;
            contentHtml += `<strong>Move to Different Template:</strong><br>`;
            contentHtml += `<select id="moveTargetTemplateSelect" style="width: 200px; padding: 5px; margin-top: 5px;">`;
            contentHtml += `<option value="">-- Select Target Template --</option>`;
            // Will be populated by populateMoveTargetTemplates
            contentHtml += `</select>`;
            contentHtml += `<br>`;
            contentHtml += `<button onclick="executeMoveToTemplate('${node.id()}')" style="padding: 6px 12px; background: #007bff; color: white; border: none; cursor: pointer; margin-top: 8px;">Move Instance</button>`;
            contentHtml += `</div>`;
        }

        contentHtml += `<div style="margin-top: 15px;">`;
        contentHtml += `<button onclick="clearAllSelections()" style="padding: 8px 15px; background: #6c757d; color: white; border: none; cursor: pointer;">Close</button>`;
        contentHtml += `</div>`;

        // Use common dialog interface
        this.common.showEditingDialog({
            node: node,
            title: `Manage ${data.type === 'shelf' ? 'Node' : 'Graph Instance'}`,
            contentHtml: contentHtml,
            focusElementId: null,
            onSetup: () => {
                // Populate the move target dropdown (only in editing mode)
                if (this.state.editing.isEdgeCreationMode) {
                    this.populateMoveTargetTemplates(node);
                }
            }
        });
    }

    /**
     * Save graph template edit (rename template)
     * @param {string} nodeId - The ID of the graph node
     */
    saveGraphTemplateEdit(nodeId) {
        const templateNameInput = document.getElementById('templateNameEditInput');
        const newTemplateName = templateNameInput.value.trim();

        // Get the node
        const node = this.state.cy.getElementById(nodeId);
        if (!node || node.length === 0) {
            console.error(`Node ${nodeId} not found`);
            return;
        }

        const oldTemplateName = node.data('template_name') || '';

        // Check if template name has changed
        if (newTemplateName === oldTemplateName) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('No changes detected. Please modify the template name.', 'warning');
            }
            return;
        }

        // Validate template name (not empty)
        if (!newTemplateName) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('Template name cannot be empty.', 'error');
            }
            return;
        }

        // Find all nodes that use this template and update their template_name and labels
        let updatedCount = 0;
        const newColor = this.common.getTemplateColor(newTemplateName);
        this.state.cy.nodes().forEach((n) => {
            if (n.data('template_name') === oldTemplateName) {
                // Update template_name
                n.data('template_name', newTemplateName);

                // Update templateColor if it exists
                if (n.data('templateColor') !== undefined) {
                    n.data('templateColor', newColor);
                }

                // Update the label (instance name)
                const currentLabel = n.data('label') || '';

                // Instance names typically follow pattern: template_name_index
                // We need to replace the template prefix while keeping the suffix
                if (currentLabel.startsWith(oldTemplateName)) {
                    // Extract the suffix (e.g., "_1", "_2", etc.)
                    const suffix = currentLabel.substring(oldTemplateName.length);
                    const newLabel = newTemplateName + suffix;
                    n.data('label', newLabel);
                    updatedCount++;
                } else {
                    // If label doesn't match expected pattern, just update template_name
                    updatedCount++;
                }
            }
        });

        // Update edges that have the old template_name and their colors
        let updatedEdgeCount = 0;
        this.state.cy.edges().forEach((edge) => {
            if (edge.data('template_name') === oldTemplateName) {
                edge.data('template_name', newTemplateName);
                // Update the color to match the new template name
                edge.data('color', newColor);
                updatedEdgeCount++;
            }
        });

        // Force style update to apply new colors
        this.state.cy.style().update();

        // Update state.data.availableGraphTemplates if this template exists
        if (this.state.data.availableGraphTemplates && this.state.data.availableGraphTemplates[oldTemplateName]) {
            // Rename the template in state.data.availableGraphTemplates
            this.state.data.availableGraphTemplates[newTemplateName] = this.state.data.availableGraphTemplates[oldTemplateName];
            delete this.state.data.availableGraphTemplates[oldTemplateName];

            // Update the template dropdown if it exists
            const graphTemplateSelect = document.getElementById('graphTemplateSelect');
            if (graphTemplateSelect) {
                // Rebuild the dropdown
                const currentValue = graphTemplateSelect.value;
                graphTemplateSelect.innerHTML = '<option value="">-- Select a Template --</option>';

                Object.keys(this.state.data.availableGraphTemplates).sort().forEach(templateName => {
                    const option = document.createElement('option');
                    option.value = templateName;
                    option.textContent = templateName;
                    graphTemplateSelect.appendChild(option);
                });

                // Try to maintain selection
                if (currentValue === oldTemplateName) {
                    graphTemplateSelect.value = newTemplateName;
                } else {
                    graphTemplateSelect.value = currentValue;
                }
            }
        }

        // Also update state.data.currentData.metadata.graph_templates for export
        if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates && this.state.data.currentData.metadata.graph_templates[oldTemplateName]) {
            this.state.data.currentData.metadata.graph_templates[newTemplateName] = this.state.data.currentData.metadata.graph_templates[oldTemplateName];
            delete this.state.data.currentData.metadata.graph_templates[oldTemplateName];
        }

        // Update metadata.initialRootTemplate so cabling descriptor export uses the new name
        if (this.state.data.currentData?.metadata?.initialRootTemplate === oldTemplateName) {
            this.state.data.currentData.metadata.initialRootTemplate = newTemplateName;
        }

        // Update all graph_template references inside other templates' children (for export)
        const gt = this.state.data.currentData?.metadata?.graph_templates;
        if (gt) {
            Object.keys(gt).forEach((tplName) => {
                const tpl = gt[tplName];
                if (tpl?.children) {
                    tpl.children.forEach((child) => {
                        if (child.graph_template === oldTemplateName) {
                            child.graph_template = newTemplateName;
                        }
                    });
                }
            });
        }

        // Refresh the connection legend to reflect the new template name
        if (this.state.data.currentData) {
            if (window.updateConnectionLegend && typeof window.updateConnectionLegend === 'function') {
                window.updateConnectionLegend(this.state.data.currentData);
            }
        }

        // Cleanup editing dialog (remove click handler, clear flags, hide dialog)
        const nodeInfo = document.getElementById('nodeInfo');
        if (nodeInfo && nodeInfo._clickOutsideHandler) {
            document.removeEventListener('click', nodeInfo._clickOutsideHandler, true);
            delete nodeInfo._clickOutsideHandler;
        }

        // Clear editing flag
        node.data('isEditing', false);

        // Hide the editing interface
        if (window.hideNodeInfo && typeof window.hideNodeInfo === 'function') {
            window.hideNodeInfo();
        }

        // Show success message with count
        if (window.showExportStatus && typeof window.showExportStatus === 'function') {
            window.showExportStatus(`Graph template name updated successfully (${updatedCount} instance${updatedCount !== 1 ? 's' : ''}, ${updatedEdgeCount} connection${updatedEdgeCount !== 1 ? 's' : ''} updated)`, 'success');
        }
    }

    /**
     * Cancel graph template editing
     * @param {string} nodeId - The ID of the graph node
     */
    cancelGraphTemplateEdit(_nodeId) {
        // Clear isEditing flag on all nodes
        if (this.state.cy) {
            this.state.cy.nodes().forEach((n) => {
                if (n.data('isEditing') === true) {
                    n.data('isEditing', false);
                }
            });
        }

        // Hide the dialog
        if (window.hideNodeInfo && typeof window.hideNodeInfo === 'function') {
            window.hideNodeInfo();
        }
    }

    /**
     * Execute the move operation to transfer an instance to a different template
     * @param {string} nodeId - The ID of the node/graph to move
     */
    executeMoveToTemplate(nodeId) {
        // Check if we're in editing mode
        if (!this.state.editing.isEdgeCreationMode) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('Move operation is only available in editing mode. Please enable editing mode first.', 'error');
            }
            return;
        }

        const node = this.state.cy.getElementById(nodeId);
        if (!node || node.length === 0) {
            console.error(`Node ${nodeId} not found`);
            return;
        }

        const select = document.getElementById('moveTargetTemplateSelect');
        if (!select) {
            console.error('moveTargetTemplateSelect element not found');
            return;
        }

        const targetTemplateName = select.value;

        if (!targetTemplateName) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('Please select a target template.', 'error');
            }
            return;
        }

        const isMovingToRoot = targetTemplateName === 'root-instance';
        const nodeType = node.data('type');
        const nodeLabel = node.data('label');

        // Log the operation instead of showing confirmation dialog
        console.log(`Moving "${nodeLabel}" to template "${targetTemplateName}"?\n\nThis will:\n• Remove it from current parent template\n• Add it to ${targetTemplateName}\n• Update all instances`);

        try {
            // Get current parent info
            const currentParent = node.parent();
            const currentParentTemplate = currentParent.length > 0 ? currentParent.data('template_name') : null;

            if (nodeType === 'shelf') {
                // Moving a node (shelf)
                this.moveNodeToTemplate(node, targetTemplateName, currentParentTemplate);
            } else if (nodeType === 'graph') {
                // Moving a graph instance
                this.moveGraphInstanceToTemplate(node, targetTemplateName, currentParentTemplate);
            } else {
                throw new Error(`Cannot move node of type "${nodeType}". Only shelf and graph nodes can be moved.`);
            }

            console.log('[hierarchy] executeMoveToTemplate: move done, deferring layout');

            // Close dialog and clear selections
            if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
                window.clearAllSelections();
            }

            // Show success immediately; defer heavy layout/save so the UI doesn't freeze
            if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                const successMessage = isMovingToRoot
                    ? `Successfully moved "${nodeLabel}" to root-instance`
                    : `Successfully moved "${nodeLabel}" to template "${targetTemplateName}"`;
                window.showExportStatus(successMessage, 'success');
            }

            // Defer layout and save to next tick so visualizer stays responsive (avoids freeze after move)
            const self = this;
            setTimeout(() => {
                if (!self.state.cy || self.state.mode !== 'hierarchy') return;
                try {
                    console.log('[hierarchy] executeMoveToTemplate: layout start');
                    self.calculateLayout();
                    console.log('[hierarchy] executeMoveToTemplate: layout done');
                    window.saveDefaultLayout?.();
                    if (self.common && typeof self.common.forceApplyCurveStyles === 'function') {
                        self.common.forceApplyCurveStyles();
                    }
                } catch (e) {
                    console.error('[hierarchy] executeMoveToTemplate: layout/save error', e?.message ?? e);
                }
            }, 0);

        } catch (error) {
            console.error('Error moving instance:', error);
            console.error(`Failed to move instance: ${error.message}`);
        }
    }

    // ===== Connection Management Functions (Phase 5) =====

    /**
     * Create a connection at a specific placement level (hierarchy mode)
     * @param {Object} sourceNode - Source port node
     * @param {Object} targetNode - Target port node  
     * @param {Object|null} selectedLevel - Selected placement level (null for auto-detect)
     */
    createConnectionAtLevel(sourceNode, targetNode, selectedLevel) {
        // Hierarchy mode: use selected level or find common ancestor
        let template_name, depth;
        if (selectedLevel) {
            template_name = selectedLevel.template_name;
            depth = selectedLevel.depth;
        } else {
            const commonAncestor = this.findCommonAncestor(sourceNode, targetNode);
            template_name = commonAncestor ? commonAncestor.data('template_name') : null;
            depth = commonAncestor ? (commonAncestor.data('depth') || 0) : 0;
        }

        // Determine if this is a template-level connection
        // It's template-level if template_name is defined (meaning it's stored in a template)
        const isTemplateConnection = template_name !== null;

        console.log(`[createConnectionAtLevel] Placing at ${template_name}, isTemplateConnection: ${isTemplateConnection}`);

        if (isTemplateConnection) {
            // Template-level: Create in all instances of the placement template
            this.createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth);
        } else {
            // Instance-specific: Create single connection (no template hierarchy)
            this.common.createSingleConnection(sourceNode, targetNode, template_name, depth);
        }
    }

    /**
     * Helper function to compare two arrays for equality
     * @param {Array} arr1 - First array
     * @param {Array} arr2 - Second array
     * @returns {boolean} True if arrays are equal
     * @private
     */
    _arraysEqual(arr1, arr2) {
        if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
            return false;
        }
        if (arr1.length !== arr2.length) {
            return false;
        }
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Create a connection pattern in all instances of a template
     * Skips instances where either port is already connected
     * @param {Object} sourceNode - Source port node
     * @param {Object} targetNode - Target port node
     * @param {string} template_name - Template name
     * @param {number} depth - Hierarchy depth
     */
    createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth) {
        // Find all instances of this template (including empty ones)
        const templateGraphs = this.state.cy.nodes().filter(node =>
            node.data('type') === 'graph' && node.data('template_name') === template_name
        );

        if (templateGraphs.length === 0) {
            console.warn('No template instances found');
            this.common.createSingleConnection(sourceNode, targetNode, template_name, depth);
            return;
        }

        // Find which instance contains the ports we're connecting
        let sourceInstance = null;
        for (const graph of templateGraphs) {
            if (sourceNode.ancestors().filter(n => n.id() === graph.id()).length > 0) {
                sourceInstance = graph;
                break;
            }
        }

        if (!sourceInstance) {
            console.warn('Could not find instance containing the ports');
            this.common.createSingleConnection(sourceNode, targetNode, template_name, depth);
            return;
        }

        // Extract pattern ONCE relative to the instance that contains the ports
        const sourcePattern = this.extractPortPattern(sourceNode, sourceInstance);
        const targetPattern = this.extractPortPattern(targetNode, sourceInstance);

        if (!sourcePattern || !targetPattern) {
            console.warn('Could not extract port patterns');
            this.common.createSingleConnection(sourceNode, targetNode, template_name, depth);
            return;
        }

        let createdCount = 0;
        let skippedCount = 0;

        // Apply the SAME pattern to ALL instances
        templateGraphs.forEach(graph => {
            // Find the specific ports in this instance by following the SAME path
            const sourcePortNode = this.findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
            const targetPortNode = this.findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

            if (!sourcePortNode || !targetPortNode) {
                // Ports don't exist in this instance - skip
                return;
            }

            // Check if EITHER port already has ANY connection
            const sourcePortConnections = this.state.cy.edges().filter(e =>
                e.data('source') === sourcePortNode.id() || e.data('target') === sourcePortNode.id()
            );
            const targetPortConnections = this.state.cy.edges().filter(e =>
                e.data('source') === targetPortNode.id() || e.data('target') === targetPortNode.id()
            );

            if (sourcePortConnections.length > 0 || targetPortConnections.length > 0) {
                skippedCount++;
                return; // Skip this instance - ports already in use
            }

            // Create the connection in this instance
            this.common.createSingleConnection(sourcePortNode, targetPortNode, template_name, depth);
            createdCount++;
        });

        console.log(`Created ${createdCount} connection(s) in template "${template_name}" (skipped ${skippedCount} instances with existing connections)`);

        // Update the template definition to include the new connection
        if (createdCount > 0 && sourcePattern && targetPattern) {
            // Update state.data.availableGraphTemplates
            if (this.state.data.availableGraphTemplates && this.state.data.availableGraphTemplates[template_name]) {
                const template = this.state.data.availableGraphTemplates[template_name];
                if (!template.connections) {
                    template.connections = [];
                }

                // Ensure path arrays contain only strings (no object references or circular references)
                const sourcePath = Array.isArray(sourcePattern.path)
                    ? sourcePattern.path.filter(p => typeof p === 'string' && p !== '[Circular Reference]')
                    : [];
                const targetPath = Array.isArray(targetPattern.path)
                    ? targetPattern.path.filter(p => typeof p === 'string' && p !== '[Circular Reference]')
                    : [];

                // Skip if paths are invalid
                if (sourcePath.length === 0 || targetPath.length === 0) {
                    return;
                }

                // Check if this connection already exists to prevent duplicates
                const connectionExists = template.connections.some(conn => {
                    const portA = conn.port_a;
                    const portB = conn.port_b;

                    // Check if paths match (order-independent: A->B or B->A are the same connection)
                    const pathsMatch = (
                        (this._arraysEqual(portA.path, sourcePath) && portA.tray_id === sourcePattern.trayId && portA.port_id === sourcePattern.portId &&
                            this._arraysEqual(portB.path, targetPath) && portB.tray_id === targetPattern.trayId && portB.port_id === targetPattern.portId) ||
                        (this._arraysEqual(portA.path, targetPath) && portA.tray_id === targetPattern.trayId && portA.port_id === targetPattern.portId &&
                            this._arraysEqual(portB.path, sourcePath) && portB.tray_id === sourcePattern.trayId && portB.port_id === sourcePattern.portId)
                    );

                    return pathsMatch;
                });

                if (!connectionExists) {
                    // Add the connection pattern to the template
                    // Clone arrays to avoid shared references that safeStringify would treat as circular
                    template.connections.push({
                        port_a: {
                            path: [...sourcePath], // Clone array to avoid shared reference
                            tray_id: sourcePattern.trayId,
                            port_id: sourcePattern.portId
                        },
                        port_b: {
                            path: [...targetPath], // Clone array to avoid shared reference
                            tray_id: targetPattern.trayId,
                            port_id: targetPattern.portId
                        },
                        cable_type: 'QSFP_DD'  // Default cable type
                    });

                    console.log(`Updated template "${template_name}" with new connection pattern`);
                } else {
                    console.log(`Skipped duplicate connection in template "${template_name}"`);
                }
            }

            // Update state.data.currentData.metadata.graph_templates if it exists (for export)
            if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
                const template = this.state.data.currentData.metadata.graph_templates[template_name];
                if (template) {
                    if (!template.connections) {
                        template.connections = [];
                    }

                    // Ensure path arrays contain only strings (no object references or circular references)
                    const sourcePathMeta = Array.isArray(sourcePattern.path)
                        ? sourcePattern.path.filter(p => typeof p === 'string' && p !== '[Circular Reference]')
                        : [];
                    const targetPathMeta = Array.isArray(targetPattern.path)
                        ? targetPattern.path.filter(p => typeof p === 'string' && p !== '[Circular Reference]')
                        : [];

                    // Skip if paths are invalid
                    if (sourcePathMeta.length === 0 || targetPathMeta.length === 0) {
                        return;
                    }

                    // Check if this connection already exists to prevent duplicates
                    const connectionExistsMeta = template.connections.some(conn => {
                        const portA = conn.port_a;
                        const portB = conn.port_b;

                        // Check if paths match (order-independent: A->B or B->A are the same connection)
                        const pathsMatch = (
                            (this._arraysEqual(portA.path, sourcePathMeta) && portA.tray_id === sourcePattern.trayId && portA.port_id === sourcePattern.portId &&
                                this._arraysEqual(portB.path, targetPathMeta) && portB.tray_id === targetPattern.trayId && portB.port_id === targetPattern.portId) ||
                            (this._arraysEqual(portA.path, targetPathMeta) && portA.tray_id === targetPattern.trayId && portA.port_id === targetPattern.portId &&
                                this._arraysEqual(portB.path, sourcePathMeta) && portB.tray_id === sourcePattern.trayId && portB.port_id === sourcePattern.portId)
                        );

                        return pathsMatch;
                    });

                    if (!connectionExistsMeta) {
                        // Add the connection pattern to the template
                        // Clone arrays to avoid shared references that safeStringify would treat as circular
                        template.connections.push({
                            port_a: {
                                path: [...sourcePathMeta], // Clone array to avoid shared reference
                                tray_id: sourcePattern.trayId,
                                port_id: sourcePattern.portId
                            },
                            port_b: {
                                path: [...targetPathMeta], // Clone array to avoid shared reference
                                tray_id: targetPattern.trayId,
                                port_id: targetPattern.portId
                            },
                            cable_type: 'QSFP_DD'
                        });
                    }
                }
            }
        }

        // Update the connection legend after creating connections
        if (createdCount > 0 && this.state.data.currentData) {
            if (window.updateConnectionLegend && typeof window.updateConnectionLegend === 'function') {
                window.updateConnectionLegend(this.state.data.currentData);
            }
        }

        if (createdCount > 0) {
            let message = `Template-level connection created!\n\nAdded connection to ${createdCount} instance(s) of template "${template_name}".`;
            if (skippedCount > 0) {
                message += `\n\nSkipped ${skippedCount} instance(s) where ports were already connected.`;
            }
            console.log(message);
        } else {
            console.log(`No connections created.\n\nAll ${skippedCount} instance(s) of template "${template_name}" already have these ports connected.`);
        }
    }

    /**
     * Enumerate all possible placement levels for a connection between two ports
     * Returns array of placement options from closest common parent to root
     * Each option includes the graph node, template name, depth, and duplication count
     * Filters out levels where connections already exist
     * @param {Object} sourcePort - Source port node
     * @param {Object} targetPort - Target port node
     * @returns {Array} Array of placement level options
     */
    enumeratePlacementLevels(sourcePort, targetPort) {
        const placementLevels = [];

        // Find closest common ancestor that is NOT a shelf node
        const sourceShelf = this.common.getParentAtLevel(this.state.editing.selectedFirstPort, 2);  // Port -> Tray -> Shelf
        const targetShelf = this.common.getParentAtLevel(targetPort, 2);

        if (!sourceShelf || !targetShelf) {
            console.error('Could not find shelf nodes for ports');
            return placementLevels;
        }

        // Get all graph ancestors for source shelf
        const sourceAncestors = [];
        let current = sourceShelf.parent();
        while (current && current.length > 0) {
            if (current.isParent() && current.data('type') === 'graph') {
                sourceAncestors.push(current);
            }
            current = current.parent();
        }

        // Get all graph ancestors for target shelf
        const targetAncestors = [];
        current = targetShelf.parent();
        while (current && current.length > 0) {
            if (current.isParent() && current.data('type') === 'graph') {
                targetAncestors.push(current);
            }
            current = current.parent();
        }

        // Find all common ancestors (from closest to root)
        for (let i = 0; i < sourceAncestors.length; i++) {
            const sourceAncestor = sourceAncestors[i];
            const matchIndex = targetAncestors.findIndex(a => a.id() === sourceAncestor.id());

            if (matchIndex >= 0) {
                // This is a common ancestor
                const graphNode = sourceAncestor;
                const template_name = graphNode.data('template_name') || graphNode.data('label') || 'unknown';
                const depth = graphNode.data('depth') || 0;
                const label = graphNode.data('label') || graphNode.id();

                // Calculate duplication count at this level
                const duplicationCount = this.calculateDuplicationCount(graphNode, sourceShelf, targetShelf);

                // Check if this level is available (no existing connections blocking it)
                const isAvailable = this.isPlacementLevelAvailable(this.state.editing.selectedFirstPort, targetPort, graphNode, template_name, sourceShelf, targetShelf);

                console.log(`[enumeratePlacementLevels] Level: ${label} (${template_name}), depth: ${depth}, available: ${isAvailable}, duplicationCount: ${duplicationCount}`);

                if (isAvailable) {
                    placementLevels.push({
                        graphNode: graphNode,
                        template_name: template_name,
                        depth: depth,
                        label: label,
                        duplicationCount: duplicationCount
                    });
                }
            }
        }

        return placementLevels;
    }

    /**
     * Check if a placement level is available (no existing connections would conflict)
     * 
     * For template-level: Available ONLY if ALL instances of the PLACEMENT template have both ports free
     * For instance-specific: Available if THESE SPECIFIC ports are free
     * 
     * @param {Object} sourcePort - Source port node
     * @param {Object} targetPort - Target port node
     * @param {Object} placementGraphNode - The graph node representing the placement level
     * @param {string} placementTemplateName - Template name of the placement level
     * @param {Object} sourceShelf - Source shelf node
     * @param {Object} targetShelf - Target shelf node
     * @returns {boolean} True if the level is available
     */
    isPlacementLevelAvailable(sourcePort, targetPort, placementGraphNode, placementTemplateName, _sourceShelf, _targetShelf) {
        // If placementTemplateName is defined, it's a template-level connection
        const isTemplateLevel = placementTemplateName !== null && placementTemplateName !== 'unknown';

        if (isTemplateLevel) {
            // Template-level: Available ONLY if ALL instances of the placement template have both ports free

            // First, extract the pattern relative to the PLACEMENT LEVEL
            // This gives us the template-relative pattern that should exist in all instances
            const sourcePattern = this.extractPortPattern(this.state.editing.selectedFirstPort, placementGraphNode);
            const targetPattern = this.extractPortPattern(targetPort, placementGraphNode);

            if (!sourcePattern || !targetPattern) {
                // Ports are not descendants of the placement level
                return false;
            }

            // Find all instances of the PLACEMENT template (including empty ones)
            const templateGraphs = this.state.cy.nodes().filter(node =>
                node.data('type') === 'graph' && node.data('template_name') === placementTemplateName
            );

            if (templateGraphs.length === 0) {
                return false; // No instances exist
            }

            // Check ALL instances - if ANY has a conflict, block this level
            for (let i = 0; i < templateGraphs.length; i++) {
                const graph = templateGraphs[i];

                // Find the specific ports in this instance by following the SAME pattern
                const srcPort = this.findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
                const tgtPort = this.findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

                if (!srcPort || !tgtPort) {
                    // Ports don't exist in this instance - this means the template structure is inconsistent
                    // Block this level as we can't apply the pattern to all instances
                    return false;
                }

                // Check if either port has ANY connection in this instance
                const srcPortConnections = this.state.cy.edges().filter(e =>
                    e.data('source') === srcPort.id() || e.data('target') === srcPort.id()
                );
                const tgtPortConnections = this.state.cy.edges().filter(e =>
                    e.data('source') === tgtPort.id() || e.data('target') === tgtPort.id()
                );

                if (srcPortConnections.length > 0 || tgtPortConnections.length > 0) {
                    // Found a conflict in this instance - block this entire level
                    return false;
                }
            }

            // All instances have free ports - level is available
            return true;

        } else {
            // Instance-specific: Available if THESE SPECIFIC ports are free
            const sourceId = this.state.editing.selectedFirstPort.id();
            const targetId = targetPort.id();

            const sourceConnections = this.state.cy.edges().filter(e =>
                e.data('source') === sourceId || e.data('target') === sourceId
            );
            const targetConnections = this.state.cy.edges().filter(e =>
                e.data('source') === targetId || e.data('target') === targetId
            );

            // Available only if BOTH ports are free
            return sourceConnections.length === 0 && targetConnections.length === 0;
        }
    }

    /**
     * Calculate how many times a connection would be instantiated if placed at a given level
     * Always returns the actual number of instances of the template at this placement level.
     * @param {Object} graphNode - Graph node representing the placement level
     * @param {Object} sourceShelf - Source shelf node
     * @param {Object} targetShelf - Target shelf node
     * @returns {number} Number of template instances
     */
    calculateDuplicationCount(graphNode, _sourceShelf, _targetShelf) {
        // Get the template name of this placement level
        const placementTemplateName = graphNode.data('template_name');

        // Always count how many instances of this template exist (including empty ones)
        const templateInstances = this.state.cy.nodes().filter(node =>
            node.data('type') === 'graph' && node.data('template_name') === placementTemplateName
        );
        return templateInstances.length;
    }

    /**
     * Show the modal for selecting connection placement level
     * @param {Object} sourceNode - Source port node
     * @param {Object} targetNode - Target port node
     * @param {Array} placementLevels - Array of placement level options
     */
    showConnectionPlacementModal(sourceNode, targetNode, placementLevels) {
        const container = document.getElementById('placementOptionsContainer');
        if (!container) return;

        // Clear previous options
        container.innerHTML = '';

        // Generate placement options
        placementLevels.forEach((level, _index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'placement-option';

            const instanceText = level.duplicationCount === 1 ? '1 instance' : `${level.duplicationCount} instances`;

            optionDiv.innerHTML = `
                <div class="placement-option-header">
                    <div class="placement-level-name">${level.template_name}</div>
                </div>
                <div class="placement-instance-highlight">
                    <strong>Instances:</strong> <span class="instance-count-badge">${instanceText}</span>
                </div>
                <div class="placement-option-details">
                    <strong>Hierarchy depth:</strong> ${level.depth}
                </div>
            `;

            // Add click handler
            optionDiv.onclick = () => {
                this.selectConnectionPlacementLevel(sourceNode, targetNode, level);
            };

            container.appendChild(optionDiv);
        });

        // Setup click-outside-to-close and show modal
        if (window.modalManager && typeof window.modalManager.setupClickOutsideClose === 'function') {
            window.modalManager.setupClickOutsideClose('connectionPlacementModal', () => {
                this.cancelConnectionPlacement();
            });
            window.modalManager.show('connectionPlacementModal');
        } else {
            console.warn('modalManager not available for connection placement modal');
        }
    }

    /**
     * Handle clicks on the connection placement modal overlay
     * @param {Event} event - Click event
     */
    handleConnectionPlacementModalClick(event) {
        // Only close if clicking directly on the overlay (not on content inside)
        if (event.target.id === 'connectionPlacementModal') {
            this.cancelConnectionPlacement();
        }
    }

    /**
     * Handle user selection of a placement level
     * @param {Object} sourceNode - Source port node
     * @param {Object} targetNode - Target port node
     * @param {Object} selectedLevel - Selected placement level
     */
    selectConnectionPlacementLevel(sourceNode, targetNode, selectedLevel) {
        // Hide modal
        const modal = document.getElementById('connectionPlacementModal');
        if (modal) {
            modal.classList.remove('active');
        }

        // Create connection at the selected level
        this.createConnectionAtLevel(sourceNode, targetNode, selectedLevel);
    }

    /**
     * Cancel connection placement (close modal)
     */
    cancelConnectionPlacement() {
        if (window.modalManager && typeof window.modalManager.hide === 'function') {
            window.modalManager.hide('connectionPlacementModal');
        } else {
            const modal = document.getElementById('connectionPlacementModal');
            if (modal) {
                modal.classList.remove('active');
            }
        }
    }
}

