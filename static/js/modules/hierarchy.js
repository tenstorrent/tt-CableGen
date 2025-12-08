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
            console.warn(`[extractPortPattern] Port ID does not match descriptor format: ${portId}`);
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
            if (nodeName) {
                path.unshift(nodeName); // Add to beginning to maintain top-down order
            }
            current = current.parent();
        }

        // If we didn't reach the placement level, the port is not a descendant
        if (!current || current.length === 0 || current.id() !== placementLevel.id()) {
            console.warn(`[extractPortPattern] Port ${portId} is not a descendant of placement level ${placementLevel.id()}`);
            return null;
        }

        const result = {
            path: path,
            trayId: trayId,
            portId: portIdNum
        };

        console.log(`[extractPortPattern] Extracted pattern from ${placementLevel.id()}: path=${JSON.stringify(path)}, tray=${trayId}, port=${portIdNum}`);

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
            const { graphLabel, connections, pathMapping, templateName } = deferred;

            console.log(`[processDeferredConnections] Processing ${connections.length} connections for template "${templateName}" (instance: "${graphLabel}")`);
            console.log(`[processDeferredConnections] PathMapping keys:`, Object.keys(pathMapping).sort());

            // Find ALL instances of this template (not just the one being instantiated)
            const allTemplateInstances = this.state.cy.nodes().filter(node =>
                node.data('type') === 'graph' && node.data('template_name') === templateName
            );

            console.log(`[processDeferredConnections] Found ${allTemplateInstances.length} instance(s) of template "${templateName}"`);

            if (allTemplateInstances.length === 0) {
                console.warn(`[processDeferredConnections] No instances found for template "${templateName}"`);
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
                        console.warn(`[processDeferredConnections] Could not resolve paths for connection ${connIndex}:`);
                        if (!sourceNodeId) {
                            console.warn(`  Source path: ${JSON.stringify(sourcePath)} not found in pathMapping`);
                        }
                        if (!targetNodeId) {
                            console.warn(`  Target path: ${JSON.stringify(targetPath)} not found in pathMapping`);
                        }
                        console.warn(`  Available pathMapping keys:`, Object.keys(pathMapping).sort());
                        return;
                    }

                    // Get the shelf nodes from the original instance to extract the pattern
                    const sourceShelfNode = this.state.cy.getElementById(sourceNodeId);
                    const targetShelfNode = this.state.cy.getElementById(targetNodeId);

                    if (!sourceShelfNode || sourceShelfNode.length === 0 || !targetShelfNode || targetShelfNode.length === 0) {
                        console.warn(`[processDeferredConnections] Shelf nodes not found for connection ${connIndex}`);
                        return;
                    }

                    // Extract the pattern: child names and port positions relative to template
                    // The paths in conn.port_a.path and conn.port_b.path are already template-relative
                    // We need to find the corresponding ports in each instance using these paths

                    // Determine connection color based on container template
                    const connectionColor = this.common.getTemplateColor(templateName);

                    // Apply this connection pattern to ALL instances of the template
                    let createdCount = 0;
                    let skippedCount = 0;

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
                            console.warn(`[processDeferredConnections] Ports not found in instance ${instanceGraph.id()} for connection ${connIndex}`);
                            skippedCount++;
                            return;
                        }

                        // Check if ports already have connections (skip if they do)
                        const sourcePortConnections = this.state.cy.edges().filter(e =>
                            (e.data('source') === sourcePortNode.id() || e.data('target') === sourcePortNode.id())
                        );
                        const targetPortConnections = this.state.cy.edges().filter(e =>
                            (e.data('source') === targetPortNode.id() || e.data('target') === targetPortNode.id())
                        );

                        if (sourcePortConnections.length > 0 || targetPortConnections.length > 0) {
                            console.log(`[processDeferredConnections] Skipping instance ${instanceGraph.id()} - ports already connected`);
                            skippedCount++;
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
                        createdCount++;
                    });

                    console.log(`[processDeferredConnections] Connection ${connIndex}: Created in ${createdCount} instance(s), skipped ${skippedCount} instance(s)`);

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

            console.log(`[instantiateTemplate] Template "${templateName}" (graphId: ${graphId}) has ${template.children.length} children:`,
                template.children.map(c => `${c.name} (${c.type}${c.type === 'graph' ? `, template: ${c.graph_template}` : ''})`));

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
                console.log(`[instantiateTemplate] Added to pathMapping: "${child.name}" -> "${childId}"${child.original_name && child.original_name !== child.name ? ` (also "${child.original_name}")` : ''}`);

                if (child.type === 'node') {
                    // Create a shelf node (leaf node)
                    let nodeType = child.node_descriptor || 'WH_GALAXY';

                    // Normalize node type: strip _DEFAULT suffix only (keep _GLOBAL and _AMERICA as distinct types)
                    nodeType = nodeType.replace(/_DEFAULT$/, '');

                    let config = getNodeConfig(nodeType);

                    if (!config) {
                        console.warn(`Unknown node type: ${child.node_descriptor}, normalized to ${nodeType}, using WH_GALAXY as fallback`);
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

        // Get all top-level graph nodes (no parent)
        const topLevelNodes = this.state.cy.nodes('[type="graph"]').filter(node => {
            const parent = node.parent();
            return parent.length === 0;
        });

        // Sort by label for consistent ordering
        const sortedTopLevel = topLevelNodes.sort((a, b) => {
            return a.data('label').localeCompare(b.data('label'));
        });

        // Position top-level nodes with dynamic spacing
        let currentY = LAYOUT_CONSTANTS.TOP_LEVEL_START_Y;

        sortedTopLevel.forEach((node, _index) => {
            const x = LAYOUT_CONSTANTS.TOP_LEVEL_START_X;
            node.position({ x, y: currentY });

            // Recursively position children using common module
            this.common.positionGraphChildren(node);

            // Calculate spacing for next node based on current node's actual size
            const bbox = node.boundingBox();
            const nodeHeight = bbox.h || LAYOUT_CONSTANTS.FALLBACK_GRAPH_HEIGHT;
            const spacing = nodeHeight * LAYOUT_CONSTANTS.GRAPH_VERTICAL_SPACING_FACTOR;
            currentY += spacing;
        });
    }

    /**
     * Switch to hierarchy/logical mode - rebuild visualization from logical topology data only
     */
    switchMode() {
        // Clear all selections (including Cytoscape selections) when switching modes
        if (this.common && typeof this.common.clearAllSelections === 'function') {
            this.common.clearAllSelections();
        }

        // Extract shelf nodes with their logical topology data
        const shelfNodes = this.state.cy.nodes('[type="shelf"]');
        if (shelfNodes.length === 0) {
            console.warn('No shelf nodes found');
            return;
        }

        // Check if we have saved hierarchy state (from previous hierarchy mode session)
        // If not, we'll create extracted_topology from current location mode state
        const hasSavedHierarchyState = this.state.data.hierarchyModeState && this.state.data.hierarchyModeState.elements;

        if (!hasSavedHierarchyState) {
            // No saved hierarchy state - this happens when:
            // 1. CSV import starts in location mode (no previous hierarchy state)
            // 2. User switches to hierarchy mode for the first time
            // In this case, we'll create extracted_topology from current shelf nodes
            console.log('No saved hierarchy state - will create extracted_topology from current location mode state');
        }

        // Extract all relevant data from shelf nodes (preserve ALL fields for round-trip)
        const shelfDataList = [];
        shelfNodes.forEach(node => {
            const data = node.data();
            // Get all data fields - keep everything for round-trip compatibility
            const shelfData = {};
            for (const key in data) {
                shelfData[key] = data[key];
            }
            shelfDataList.push({
                data: shelfData,
                classes: node.classes(),
                position: node.position()
            });
        });

        // Extract all tray and port data (preserve the full hierarchy structure)
        const trayPortData = [];
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

        // Extract all connections (edges)
        const connections = [];
        this.state.cy.edges().forEach(edge => {
            // Get all data fields from the edge
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

        // Clear the entire graph
        this.state.cy.elements().remove();

        // Rebuild visualization based ONLY on logical topology data
        const newElements = [];
        const graphNodeMap = {}; // Maps logical path strings to graph node IDs

        // Check if we have logical topology information
        const hasLogicalTopology = shelfDataList.some(shelfInfo =>
            shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0
        );

        // Track if we're creating extracted_topology template (for connection tagging)
        // Template name: "extracted_topology", Instance name: "extracted_topology_0"
        let rootTemplateName = null;

        if (hasLogicalTopology) {
            // Find and recreate the root node from saved hierarchy state
            // The root is not in logical_path arrays since those only store parent paths
            let rootNode = null;
            if (this.state.data.hierarchyModeState && this.state.data.hierarchyModeState.elements) {
                // Find the root graph node (depth 0, no parent)
                const savedRootNodes = this.state.data.hierarchyModeState.elements.filter(el =>
                    el.data && el.data.type === 'graph' && el.data.depth === 0 && !el.data.parent
                );

                if (savedRootNodes.length > 0) {
                    rootNode = savedRootNodes[0].data;
                    console.log('Found root node from saved state:', rootNode);

                    // Get template color for the root
                    const rootTemplateColor = this.common.getTemplateColor(rootNode.template_name);

                    // Create root node
                    const rootGraphId = rootNode.id;
                    newElements.push({
                        data: {
                            id: rootGraphId,
                            label: rootNode.label,
                            type: 'graph',
                            template_name: rootNode.template_name,
                            parent: null,
                            depth: 0,
                            templateColor: rootTemplateColor
                        },
                        classes: 'graph'
                    });

                    // Map the root for child parent references
                    // The logical_path entries start AFTER the root, so we need to map by the first element
                    graphNodeMap[rootNode.label] = rootGraphId;
                }
            }

            // Build graph hierarchy from logical paths
            const allPaths = new Set();

            // Collect all unique paths from shelf logical_path arrays
            shelfDataList.forEach(shelfInfo => {
                if (shelfInfo.data.logical_path && Array.isArray(shelfInfo.data.logical_path)) {
                    console.log('Shelf logical_path:', shelfInfo.data.logical_path);
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

            console.log('Logical topology paths collected:', sortedPaths);
            console.log('Total graph nodes to create (excluding root):', sortedPaths.length);

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

                console.log(`Creating graph node: ${instanceName} (depth ${depth}, parent: ${parentId}, template: ${templateName})`);

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

            console.log('graphNodeMap:', graphNodeMap);

            // Add shelves to their logical parents
            shelfDataList.forEach((shelfInfo, index) => {
                let parentId = null;

                if (shelfInfo.data.logical_path && shelfInfo.data.logical_path.length > 0) {
                    // Find the parent graph node from logical_path
                    const parentPathStr = shelfInfo.data.logical_path.join('/');
                    parentId = graphNodeMap[parentPathStr];
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
            const rootGraphId = "graph_extracted_topology_0";

            // Get template color for the root (use template name, not instance name)
            const rootTemplateColor = this.common.getTemplateColor(templateName);

            // Create root graph node
            newElements.push({
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
            });

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

                newElements.push({
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
                });
            });
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

            // Tag connections with extracted_topology template if we're in flat structure mode
            if (shouldTagWithExtractedTopology) {
                connectionData.template_name = rootTemplateName; // Use template name: "extracted_topology"
                connectionData.containerTemplate = rootTemplateName;
                // Set depth to 0 since they're at the root template level
                if (connectionData.depth === undefined || connectionData.depth === null) {
                    connectionData.depth = 0;
                }
            }

            newElements.push({
                data: connectionData,
                classes: conn.classes
            });
        });

        // Add all elements back to cytoscape
        this.state.cy.add(newElements);

        // Apply drag restrictions
        this.common.applyDragRestrictions();

        // Recolor connections for logical view (depth-based coloring)
        this.recolorConnections();

        // Run preset layout first
        this.state.cy.layout({ name: 'preset' }).run();

        // Then apply fcose ONLY to graph-level nodes to prevent overlap
        setTimeout(() => {
            const graphNodes = this.state.cy.nodes('[type="graph"]');
            if (graphNodes.length > 0) {
                // Verify fcose extension is available before using it
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
                        numIter: 500,
                        stop: () => {
                            this.common.applyDragRestrictions();
                            // Update edge curve styles for hierarchy mode after layout completes
                            this.common.forceApplyCurveStyles();
                        }
                    });
                    if (layout) {
                        layout.run();
                    } else {
                        console.warn('fcose layout extension not available, falling back to preset layout');
                        this.state.cy.layout({ name: 'preset' }).run();
                        this.common.forceApplyCurveStyles();
                    }
                } catch (e) {
                    console.warn('Error using fcose layout:', e.message, '- falling back to preset layout');
                    this.state.cy.layout({ name: 'preset' }).run();
                    this.common.forceApplyCurveStyles();
                }
            } else {
                // No graph nodes, but still update curve styles
                this.common.forceApplyCurveStyles();
            }
        }, 100);
    }

    /**
     * Add a new node in hierarchy mode
     * @param {string} nodeType - Normalized node type
     * @param {HTMLElement} nodeTypeSelect - Select element for clearing selection
     */
    addNode(nodeType, nodeTypeSelect) {
        // Logical mode: add to selected parent graph node, or as top-level node
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
            // Note: isParent() returns false for empty graph nodes, so we check type instead
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

            totalNodesAdded = 1;
        } else {
            // Add to all instances of the parent template
            targetInstances.forEach((targetParent, index) => {
                const targetParentId = targetParent.id();

                // Count existing shelf nodes in this instance to auto-generate name
                const existingNodes = targetParent.children('[type="shelf"]');
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

                totalNodesAdded++;
            });
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
            window.recalculateHostIndicesForTemplates?.();
        }

        // Apply drag restrictions and layout
        this.common.applyDragRestrictions();
        this.calculateLayout();

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

        // Clear selection
        if (nodeTypeSelect) {
            nodeTypeSelect.selectedIndex = 0;
        }
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

        // Generate graph ID now that we have graphLabel
        const graphId = `graph_${Date.now()}_${graphLabel.replace(/\s+/g, '_')}`;

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
                console.log(`[addGraph] Checking if child exists: parentTemplateName="${parentTemplateName}", selectedTemplate="${selectedTemplate}", baseChildName="${baseChildName}"`);
                console.log(`[addGraph] Parent template children:`, parentTemplate && parentTemplate.children && parentTemplate.children.map(c => `${c.name} (${c.type}${c.type === 'graph' ? `, template: ${c.graph_template}` : ''})`));

                const childExists = parentTemplate && parentTemplate.children && parentTemplate.children.some(
                    child => child.type === 'graph' && child.graph_template === selectedTemplate && child.name === baseChildName
                );

                console.log(`[addGraph] Child exists check result: ${childExists}`);

                // Update the parent template definition first (use base name, not indexed label)
                // Only add if it doesn't already exist
                if (!childExists) {
                    console.log(`[addGraph] Calling updateTemplateWithNewChild`);
                    this.updateTemplateWithNewChild(parentTemplateName, selectedTemplate, baseChildName);
                } else {
                    console.log(`[addGraph] Skipping updateTemplateWithNewChild - child already exists`);
                }

                // Find all instances of the parent template (including empty ones)
                const parentTemplateInstances = this.state.cy.nodes().filter(node =>
                    node.data('type') === 'graph' &&
                    node.data('template_name') === parentTemplateName
                );

                // Add the child graph to ALL instances of the parent template
                let instancesUpdated = 0;
                parentTemplateInstances.forEach(parentInstance => {
                    const instanceId = parentInstance.id();
                    const instanceLabel = parentInstance.data('label');

                    // Generate unique ID and label for this instance
                    const childGraphId = `graph_${Date.now()}_${instanceLabel}_${graphLabel.replace(/\s+/g, '_')}`;
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

                // Recalculate host_indices for all template instances to ensure siblings have consecutive numbering
                this.recalculateHostIndicesForTemplates();

                // Rename graph instances to ensure proper numbering at each level
                this.renameGraphInstances();

                // Apply drag restrictions and styling
                this.common.applyDragRestrictions();

                // Force complete style recalculation and redraw
                this.state.cy.style().update();
                this.state.cy.forceRender();

                // Defer layout calculation to ensure nodes are fully rendered and bounding boxes are accurate
                setTimeout(() => {
                    this.calculateLayout();
                    this.state.cy.fit(null, 50);

                    // Apply curves and update status after layout is done
                    setTimeout(() => {
                        this.common.forceApplyCurveStyles();
                        window.updatePortConnectionStatus?.();
                        this.state.cy.forceRender();
                    }, 50);
                }, 50);

                // Show success message
                alert(`Successfully added graph template "${selectedTemplate}" as "${graphLabel}" to ${instancesUpdated} instance(s) of template "${parentTemplateName}"!`);

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
                    window.recalculateHostIndicesForTemplates?.();
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

                // Show success message
                const childCount = template.children ? template.children.length : 0;
                const connectionCount = template.connections ? template.connections.length : 0;
                alert(`Successfully instantiated graph template "${selectedTemplate}" as "${graphLabel}"!\n\n` +
                    `Created ${childCount} child node(s) and ${connectionCount} connection(s).`);
            }

        } catch (error) {
            console.error('Error instantiating graph template:', error);
            alert(`Failed to instantiate graph template: ${error.message}`);
        }
    }

    /**
     * Create a new empty graph template
     */
    createNewTemplate() {
        const templateNameInput = document.getElementById('newTemplateNameInput');
        const newTemplateName = templateNameInput.value.trim();

        // Check if cytoscape is initialized
        if (!this.state.cy) {
            if (window.showNotificationBanner && typeof window.showNotificationBanner === 'function') {
                window.showNotificationBanner('Please upload a file and generate a visualization first before creating templates.', 'error');
            }
            return;
        }

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

            // Create an empty template structure
            const emptyTemplate = {
                children: [],
                connections: []
            };

            // Initialize state.data.availableGraphTemplates if it doesn't exist
            if (!this.state.data.availableGraphTemplates) {
                this.state.data.availableGraphTemplates = {};
            }

            // Add the new template to state.data.availableGraphTemplates
            this.state.data.availableGraphTemplates[newTemplateName] = emptyTemplate;

            // Also add to state.data.currentData.metadata.graph_templates for export
            this.state.data.currentData.metadata.graph_templates[newTemplateName] = emptyTemplate;

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
            const graphId = `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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
                        const parentInstanceLabel = parentInstance.data('label');

                        // Generate unique ID for this instance
                        const childGraphId = `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${parentInstanceLabel}_${graphLabel}`;

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
            if (parentId && parentNode) {
                const parentTemplateName = parentNode.data('template_name');
                if (parentTemplateName) {
                    const parentTemplateInstances = this.state.cy.nodes().filter(node =>
                        node.data('type') === 'graph' &&
                        node.data('template_name') === parentTemplateName
                    );
                    if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                        window.showExportStatus(`Successfully created empty template "${newTemplateName}" and added to ${parentTemplateInstances.length} instance(s) of "${parentTemplateName}"`, 'success');
                    }
                } else {
                    if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                        window.showExportStatus(`Successfully created empty template "${newTemplateName}" and added instance "${graphLabel}"`, 'success');
                    }
                }
            } else {
                if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                    window.showExportStatus(`Successfully created empty template "${newTemplateName}" and added instance "${graphLabel}"`, 'success');
                }
            }

        } catch (error) {
            console.error('Error creating new template:', error);
            alert(`Failed to create new template: ${error.message}`);
        }
    }

    /**
     * Update a parent template definition to include a new child graph
     * @param {string} parentTemplateName - The parent template to update
     * @param {string} childTemplateName - The child template to add
     * @param {string} childLabel - The label/name for the child in the template
     */
    updateTemplateWithNewChild(parentTemplateName, childTemplateName, childLabel) {
        console.log(`[updateTemplateWithNewChild] Called with: parentTemplateName="${parentTemplateName}", childTemplateName="${childTemplateName}", childLabel="${childLabel}"`);

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

            console.log(`[updateTemplateWithNewChild] Added child "${childLabel}" (type: graph, template: ${childTemplateName}) to template "${parentTemplateName}"`);
            console.log(`[updateTemplateWithNewChild] Template "${parentTemplateName}" now has ${parentTemplate.children.length} children:`,
                parentTemplate.children.map(c => `${c.name} (${c.type}${c.type === 'graph' ? `, template: ${c.graph_template}` : ''})`));
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
        console.log('Recalculating host_indices using DFS traversal...');

        // Track the global host_index counter
        let nextHostIndex = 0;

        /**
         * DFS traversal function to process a graph node and its children
         * @param {Object} graphNode - The graph node to process
         * @param {number} depth - Current depth in the traversal (for logging)
         */
        const dfsTraverse = (graphNode, depth = 0) => {
            const indent = '  '.repeat(depth);
            const graphLabel = graphNode.data('label') || graphNode.id();
            console.log(`${indent}Processing graph: ${graphLabel}`);

            // Get template for this graph node to preserve original child order
            const templateName = graphNode.data('template_name');
            const template = templateName && this.state.data.availableGraphTemplates
                ? this.state.data.availableGraphTemplates[templateName]
                : null;

            // Get all direct children of this graph node
            const directChildren = graphNode.children();

            // Build a map of child_name -> Cytoscape node for quick lookup
            const childrenByName = new Map();
            directChildren.forEach(child => {
                const childName = child.data('child_name');
                if (childName) {
                    childrenByName.set(childName, child);
                }
            });

            // Order children according to template (if available), otherwise fall back to alphabetical
            // IMPORTANT: Process children in template order (mixed nodes and graphs), not separated by type
            // This matches the cabling descriptor DFS traversal order
            const orderedChildren = [];

            if (template && template.children && Array.isArray(template.children)) {
                // Follow template's children order (matches cabling descriptor DFS order)
                template.children.forEach(templateChild => {
                    const cytoscapeChild = childrenByName.get(templateChild.name);
                    if (cytoscapeChild) {
                        orderedChildren.push({
                            node: cytoscapeChild,
                            type: templateChild.type || (cytoscapeChild.data('type')),
                            childName: templateChild.name
                        });
                    }
                });

                // Add any children not found in template (shouldn't happen, but handle gracefully)
                directChildren.forEach(child => {
                    const childName = child.data('child_name');
                    if (childName && !orderedChildren.some(oc => oc.childName === childName)) {
                        orderedChildren.push({
                            node: child,
                            type: child.data('type'),
                            childName: childName
                        });
                    }
                });
            } else {
                // Fallback: sort alphabetically if no template available
                directChildren.forEach(child => {
                    orderedChildren.push({
                        node: child,
                        type: child.data('type'),
                        childName: child.data('child_name') || child.data('label') || ''
                    });
                });
                orderedChildren.sort((a, b) => a.childName.localeCompare(b.childName));
            }

            // Process children in template order (mixed nodes and graphs, just like Python import)
            orderedChildren.forEach(({ node, type, childName }) => {
                if (type === 'shelf' || type === 'node') {
                    // Process shelf node (assign host index)
                    const oldHostIndex = node.data('host_index');
                    const newHostIndex = nextHostIndex;
                    nextHostIndex++;

                    // Update shelf node
                    node.data('host_index', newHostIndex);

                    // Update label to reflect new host_index
                    const displayChildName = childName || node.data('child_name') || 'node';
                    const newLabel = `${displayChildName} (host_${newHostIndex})`;
                    node.data('label', newLabel);

                    // Update all child tray and port nodes with new host_index
                    const trayChildren = node.children('[type="tray"]');
                    trayChildren.forEach(trayNode => {
                        trayNode.data('host_index', newHostIndex);

                        const portChildren = trayNode.children('[type="port"]');
                        portChildren.forEach(portNode => {
                            portNode.data('host_index', newHostIndex);
                        });
                    });
                    if (oldHostIndex !== newHostIndex) {
                        console.log(`${indent}  Updated shelf ${displayChildName}: host_${oldHostIndex} -> host_${newHostIndex}`);
                    } else {
                        console.log(`${indent}  Shelf ${displayChildName}: host_${newHostIndex} (unchanged)`);
                    }
                } else if (type === 'graph') {
                    // Recursively process nested graph nodes (DFS)
                    dfsTraverse(node, depth + 1);
                }
            });
        };

        // Find all root graph nodes (graphs with no parent)
        const rootGraphNodes = this.state.cy.nodes('[type="graph"]').filter(node => {
            const parent = node.parent();
            return parent.length === 0; // No parent = root level
        });

        // Get root template to preserve order (if available)
        const rootTemplateName = this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.initialRootTemplate;
        const rootTemplate = rootTemplateName && this.state.data.availableGraphTemplates
            ? this.state.data.availableGraphTemplates[rootTemplateName]
            : null;

        let sortedRoots;
        if (rootTemplate && rootTemplate.children && rootTemplate.children.length > 0) {
            // If we have a root template, process root graphs in template order
            // This matches the cabling descriptor's root_instance child_mappings order
            const rootGraphsByName = new Map();
            rootGraphNodes.forEach(node => {
                const childName = node.data('child_name') || node.data('label') || node.id();
                rootGraphsByName.set(childName, node);
            });

            sortedRoots = [];
            rootTemplate.children.forEach(templateChild => {
                if (templateChild.type === 'graph') {
                    const rootGraph = rootGraphsByName.get(templateChild.name);
                    if (rootGraph) {
                        sortedRoots.push(rootGraph);
                    }
                }
            });

            // Add any root graphs not found in template (shouldn't happen, but handle gracefully)
            rootGraphNodes.forEach(node => {
                if (!sortedRoots.includes(node)) {
                    sortedRoots.push(node);
                }
            });
        } else {
            // Fallback: sort alphabetically if no template available
            sortedRoots = rootGraphNodes.toArray().sort((a, b) => {
                const labelA = a.data('label') || a.id();
                const labelB = b.data('label') || b.id();
                return labelA.localeCompare(labelB);
            });
        }

        console.log(`Found ${sortedRoots.length} root graph node(s), starting DFS traversal...`);

        // Perform DFS traversal starting from each root
        sortedRoots.forEach(rootGraph => {
            dfsTraverse(rootGraph, 0);
        });

        // Update state.data.globalHostCounter to the next available index
        this.state.data.globalHostCounter = nextHostIndex;
        console.log(`DFS traversal complete. Assigned ${nextHostIndex} host indices. Next available: ${this.state.data.globalHostCounter}`);
    }

    /**
     * Rename graph instances using DFS traversal to ensure proper numbering at each level.
     * Graph instances at each level are numbered based on instance count at that level.
     * The first/only pod at a level should be _0.
     */
    renameGraphInstances() {
        console.log('Renaming graph instances using DFS traversal...');

        /**
         * DFS traversal function to process a graph node and its children
         * @param {Object} graphNode - The graph node to process (or null for root level)
         * @param {number} depth - Current depth in the traversal (for logging)
         */
        const dfsTraverse = (parentNode, depth = 0) => {
            const indent = '  '.repeat(depth);
            const parentLabel = parentNode ? (parentNode.data('label') || parentNode.id()) : 'ROOT';
            console.log(`${indent}Processing level (parent: ${parentLabel})`);

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
                        console.log(`${indent}  Renaming "${oldLabel}" (child_name: "${oldChildName}") -> "${newLabel}"`);
                        graphNode.data('label', newLabel);
                        graphNode.data('child_name', newLabel);

                        // Update template metadata if this instance is a child of a template
                        // Match by index position, not by name, to avoid conflicts
                        if (parentTemplateMetaChildren && index < parentTemplateMetaChildren.length) {
                            const childEntry = parentTemplateMetaChildren[index];
                            if (childEntry && childEntry.graph_template === templateName) {
                                const oldMetaName = childEntry.name;
                                childEntry.name = newLabel;
                                console.log(`${indent}    Updated metadata: ${parentTemplateName}.children[${index}] "${oldMetaName}" -> "${newLabel}"`);

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
                                                    console.log(`${indent}    Updated connection port_a path: ${oldMetaName} -> ${newLabel}`);
                                                }
                                            }
                                            // Update port_b path if it references the old child name
                                            if (conn.port_b && conn.port_b.path && Array.isArray(conn.port_b.path)) {
                                                const pathIndex = conn.port_b.path.indexOf(oldMetaName);
                                                if (pathIndex !== -1) {
                                                    conn.port_b.path[pathIndex] = newLabel;
                                                    console.log(`${indent}    Updated connection port_b path: ${oldMetaName} -> ${newLabel}`);
                                                }
                                            }
                                        });
                                    } else {
                                        console.log(`${indent}    Skipping connection path updates - child "${oldMetaName}" was moved (no longer in template)`);
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
                                        const oldTemplateName = templateChildEntry.name;
                                        templateChildEntry.name = newLabel;
                                        console.log(`${indent}    Updated availableGraphTemplates: ${parentTemplateName}.children[${index}] "${oldTemplateName}" -> "${newLabel}"`);
                                    }
                                }
                            }
                        }
                    } else {
                        console.log(`${indent}  "${oldLabel}" already correctly named`);
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

        console.log('Graph instance renaming complete.');
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

        // Step 2: Add to target template definition
        if (this.state.data.availableGraphTemplates[targetTemplateName]) {
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

        // Also add to state.data.currentData.metadata.graph_templates
        if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
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
        }

        // Step 4: Add to all instances of target template
        const targetInstances = this.state.cy.nodes().filter(n =>
            n.data('template_name') === targetTemplateName && n.data('type') === 'graph'
        );

        targetInstances.forEach(targetInstance => {
            // Create the node in this instance
            // Normalize node type: strip _DEFAULT suffix only (keep _GLOBAL and _AMERICA as distinct types)
            const normalizedNodeType = nodeType.replace(/_DEFAULT$/, '');
            const config = getNodeConfig(normalizedNodeType);
            if (!config) {
                console.warn(`Unknown node type: ${nodeType} (normalized: ${normalizedNodeType})`);
                return;
            }

            const hostIndex = this.state.data.globalHostCounter++;
            // Use same ID pattern as template instantiation: ${graphId}_${child.name}
            const shelfId = `${targetInstance.id()}_${childName}`;
            const shelfLabel = `${childName} (host_${hostIndex})`;

            // Add shelf node
            this.state.cy.add({
                group: 'nodes',
                data: {
                    id: shelfId,
                    parent: targetInstance.id(),
                    label: shelfLabel,
                    type: 'shelf',
                    host_index: hostIndex,
                    shelf_node_type: nodeType,
                    child_name: childName
                },
                classes: 'shelf',
                position: { x: 0, y: 0 }
            });

            // Create trays and ports using nodeFactory
            const location = childName ? { hostname: childName } : {};
            const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(shelfId, hostIndex, normalizedNodeType, location);
            this.state.cy.add(trayPortNodes);

            // Arrange trays and ports
            const addedShelf = this.state.cy.getElementById(shelfId);
            this.common.arrangeTraysAndPorts(addedShelf);
        });

        // Recalculate host indices
        this.recalculateHostIndicesForTemplates();

        // Rename graph instances to ensure proper numbering at each level
        this.renameGraphInstances();
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

        // Step 2: Add to target template definition
        if (this.state.data.availableGraphTemplates[targetTemplateName]) {
            const targetTemplate = this.state.data.availableGraphTemplates[targetTemplateName];
            if (!targetTemplate.children) {
                targetTemplate.children = [];
            }
            targetTemplate.children.push({
                name: childName,
                type: 'graph',
                graph_template: graphTemplateName
            });
        }

        // Also add to state.data.currentData.metadata.graph_templates
        if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
            const metaTargetTemplate = this.state.data.currentData.metadata.graph_templates[targetTemplateName];
            if (metaTargetTemplate) {
                if (!metaTargetTemplate.children) {
                    metaTargetTemplate.children = [];
                }
                metaTargetTemplate.children.push({
                    name: childName,
                    type: 'graph',
                    graph_template: graphTemplateName
                });
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

        // Step 4: Add to all instances of target template  
        const targetInstances = this.state.cy.nodes().filter(n =>
            n.data('template_name') === targetTemplateName && n.data('type') === 'graph'
        );

        console.log(`[moveGraphInstanceToTemplate] Found ${targetInstances.length} target instance(s) of template "${targetTemplateName}"`);

        const graphTemplate = this.state.data.availableGraphTemplates[graphTemplateName];
        if (!graphTemplate) {
            throw new Error(`Template "${graphTemplateName}" not found`);
        }

        targetInstances.forEach(targetInstance => {
            const nodesToAdd = [];
            const edgesToAdd = [];
            const deferredConnections = [];

            const childGraphId = `${targetInstance.id()}_${childName}`;
            const childGraphLabel = childName;
            const parentDepth = targetInstance.data('depth') || 0;

            // Instantiate the template recursively
            this.instantiateTemplate(
                graphTemplate,
                graphTemplateName,
                childGraphId,
                childGraphLabel,
                'graph',
                targetInstance.id(),
                0,
                0,
                nodesToAdd,
                edgesToAdd,
                {},
                deferredConnections,
                childName,
                parentDepth
            );

            // Add nodes
            this.state.cy.add(nodesToAdd);

            // Update logical_path for shelf nodes now that parent graphs are in Cytoscape
            nodesToAdd.forEach(nodeData => {
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

            // Process deferred connections
            this.processDeferredConnections(deferredConnections, edgesToAdd);
            this.state.cy.add(edgesToAdd);

            console.log(`[moveGraphInstanceToTemplate] Added ${nodesToAdd.length} nodes and ${edgesToAdd.length} edges to target instance "${targetInstance.data('label')}"`);
        });

        // Recalculate host indices
        this.recalculateHostIndicesForTemplates();

        // Rename graph instances to ensure proper numbering at each level
        this.renameGraphInstances();
    }

    /**
     * Populate template filter dropdown with available templates
     * Collects templates from availableGraphTemplates and edges
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

        if (validTemplates.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '(No valid targets available)';
            option.disabled = true;
            select.appendChild(option);
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

        const nodeType = node.data('type');
        const nodeLabel = node.data('label');

        // Confirm the operation
        if (!confirm(`Move "${nodeLabel}" to template "${targetTemplateName}"?\n\nThis will:\n• Remove it from current parent template\n• Add it to ${targetTemplateName}\n• Update all instances`)) {
            return;
        }

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

            // Close dialog and clear selections
            if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
                window.clearAllSelections();
            }

            // Recalculate layout
            this.calculateLayout();

            if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                window.showExportStatus(`Successfully moved "${nodeLabel}" to template "${targetTemplateName}"`, 'success');
            }

        } catch (error) {
            console.error('Error moving instance:', error);
            alert(`Failed to move instance: ${error.message}`);
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

        console.log(`[createConnectionInAllTemplateInstances] Pattern from ${sourceInstance.id()}:`);
        console.log(`[createConnectionInAllTemplateInstances]   sourcePattern:`, sourcePattern);
        console.log(`[createConnectionInAllTemplateInstances]   targetPattern:`, targetPattern);

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
                console.log(`[createConnectionInAllTemplateInstances] Ports not found in instance ${graph.id()}, skipping`);
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
                console.log(`[createConnectionInAllTemplateInstances] Skipped instance ${graph.id()} - ports already connected (src: ${sourcePortConnections.length}, tgt: ${targetPortConnections.length})`);
                return; // Skip this instance - ports already in use
            }

            // Create the connection in this instance
            console.log(`[createConnectionInAllTemplateInstances] Creating connection in instance ${graph.id()}: ${sourcePortNode.id()} -> ${targetPortNode.id()}`);
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

                // Add the connection pattern to the template
                template.connections.push({
                    port_a: {
                        path: sourcePattern.path,
                        tray_id: sourcePattern.trayId,
                        port_id: sourcePattern.portId
                    },
                    port_b: {
                        path: targetPattern.path,
                        tray_id: targetPattern.trayId,
                        port_id: targetPattern.portId
                    },
                    cable_type: 'QSFP_DD'  // Default cable type
                });

                console.log(`Updated template "${template_name}" with new connection pattern`);
            }

            // Update state.data.currentData.metadata.graph_templates if it exists (for export)
            if (this.state.data.currentData && this.state.data.currentData.metadata && this.state.data.currentData.metadata.graph_templates) {
                const template = this.state.data.currentData.metadata.graph_templates[template_name];
                if (template) {
                    if (!template.connections) {
                        template.connections = [];
                    }

                    // Add the connection pattern to the template
                    template.connections.push({
                        port_a: {
                            path: sourcePattern.path,
                            tray_id: sourcePattern.trayId,
                            port_id: sourcePattern.portId
                        },
                        port_b: {
                            path: targetPattern.path,
                            tray_id: targetPattern.trayId,
                            port_id: targetPattern.portId
                        },
                        cable_type: 'QSFP_DD'
                    });
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
            alert(message);
        } else {
            alert(`No connections created.\n\nAll ${skippedCount} instance(s) of template "${template_name}" already have these ports connected.`);
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
    isPlacementLevelAvailable(sourcePort, targetPort, placementGraphNode, placementTemplateName, sourceShelf, targetShelf) {
        // If placementTemplateName is defined, it's a template-level connection
        const isTemplateLevel = placementTemplateName !== null && placementTemplateName !== 'unknown';

        console.log(`[isPlacementLevelAvailable] Checking ${placementTemplateName}, isTemplateLevel: ${isTemplateLevel}`);
        console.log(`[isPlacementLevelAvailable] state.editing.selectedFirstPort: ${this.state.editing.selectedFirstPort.id()}, targetPort: ${targetPort.id()}`);
        console.log(`[isPlacementLevelAvailable] sourceShelf: ${sourceShelf.id()}, targetShelf: ${targetShelf.id()}`);

        if (isTemplateLevel) {
            // Template-level: Available ONLY if ALL instances of the placement template have both ports free

            // First, extract the pattern relative to the PLACEMENT LEVEL
            // This gives us the template-relative pattern that should exist in all instances
            const sourcePattern = this.extractPortPattern(this.state.editing.selectedFirstPort, placementGraphNode);
            const targetPattern = this.extractPortPattern(targetPort, placementGraphNode);

            console.log(`[isPlacementLevelAvailable] Template pattern from ${placementGraphNode.id()}:`);
            console.log(`[isPlacementLevelAvailable]   sourcePattern:`, sourcePattern);
            console.log(`[isPlacementLevelAvailable]   targetPattern:`, targetPattern);

            if (!sourcePattern || !targetPattern) {
                // Ports are not descendants of the placement level
                console.warn(`[isPlacementLevelAvailable] Ports not descendants of placement level ${placementGraphNode.id()}`);
                return false;
            }

            // Find all instances of the PLACEMENT template (including empty ones)
            const templateGraphs = this.state.cy.nodes().filter(node =>
                node.data('type') === 'graph' && node.data('template_name') === placementTemplateName
            );

            if (templateGraphs.length === 0) {
                return false; // No instances exist
            }

            console.log(`[isPlacementLevelAvailable] Found ${templateGraphs.length} instances of ${placementTemplateName}`);

            // Check ALL instances - if ANY has a conflict, block this level
            for (let i = 0; i < templateGraphs.length; i++) {
                const graph = templateGraphs[i];

                // Find the specific ports in this instance by following the SAME pattern
                const srcPort = this.findPortByPath(graph, sourcePattern.path, sourcePattern.trayId, sourcePattern.portId);
                const tgtPort = this.findPortByPath(graph, targetPattern.path, targetPattern.trayId, targetPattern.portId);

                if (!srcPort || !tgtPort) {
                    // Ports don't exist in this instance - this means the template structure is inconsistent
                    // Block this level as we can't apply the pattern to all instances
                    console.log(`[isPlacementLevelAvailable] Template-level: Ports not found in instance ${graph.id()} - blocking level`);
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
                    console.log(`[isPlacementLevelAvailable] Template-level: Conflict found in instance ${graph.id()}`);
                    console.log(`[isPlacementLevelAvailable]   srcPort ${srcPort.id()} has ${srcPortConnections.length} connections`);
                    console.log(`[isPlacementLevelAvailable]   tgtPort ${tgtPort.id()} has ${tgtPortConnections.length} connections`);
                    return false;
                }

                console.log(`[isPlacementLevelAvailable] Instance ${graph.id()}: ports free`);
            }

            // All instances have free ports - level is available
            console.log(`[isPlacementLevelAvailable] Template-level: All ${templateGraphs.length} instances have free ports`);
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

            console.log(`[isPlacementLevelAvailable] Instance-specific check: source ${sourceId} has ${sourceConnections.length} connections, target ${targetId} has ${targetConnections.length} connections`);

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
    calculateDuplicationCount(graphNode, sourceShelf, targetShelf) {
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
        placementLevels.forEach((level, index) => {
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

