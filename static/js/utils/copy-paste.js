/**
 * Copy/paste utilities for graph nodes and connections.
 * Tracks selected nodes, collects connections where both endpoints are in the selection,
 * and supports pasting a copy (placement logic is mode-specific: location vs hierarchy).
 */

/**
 * Get the shelf node that contains the given node (self if it's a shelf, else ancestor).
 * @param {Object} node - Cytoscape node (shelf, tray, or port)
 * @returns {Object|null} Shelf node or null
 */
function getContainingShelf(node) {
    if (!node || !node.length) return null;
    if (node.data('type') === 'shelf') return node;
    let current = node.parent();
    while (current && current.length > 0) {
        if (current.data('type') === 'shelf') return current;
        current = current.parent();
    }
    return null;
}

/**
 * Get all shelf nodes represented by this selection node. If node is hall/aisle/rack,
 * returns all descendant shelves; if shelf/port/tray, returns the containing shelf(s).
 * @param {Object} node - Cytoscape node (hall, aisle, rack, shelf, tray, or port)
 * @returns {Array} Array of shelf nodes (may be empty)
 */
function getShelvesFromNode(node) {
    if (!node || !node.length) return [];
    const type = node.data('type');
    if (type === 'shelf') {
        return [node];
    }
    if (type === 'tray' || type === 'port') {
        const shelf = getContainingShelf(node);
        return shelf ? [shelf] : [];
    }
    if (type === 'hall' || type === 'aisle' || type === 'rack') {
        const descendants = node.descendants();
        const shelfNodes = [];
        descendants.forEach((n) => {
            if (n.data('type') === 'shelf') shelfNodes.push(n);
        });
        return shelfNodes;
    }
    return [];
}

/**
 * Get selected shelf nodes from the graph. If user selected hall/aisle/rack, includes all
 * shelves under that container; if shelf/port/tray, includes that shelf. Deduplicated by shelf id.
 * @param {Object} cy - Cytoscape instance
 * @returns {Array} Array of shelf nodes (Cytoscape collection)
 */
export function getSelectedShelfNodes(cy) {
    if (!cy) return [];
    const selected = cy.nodes(':selected');
    if (selected.length === 0) return [];

    const shelfIds = new Set();
    const shelves = [];
    selected.forEach((node) => {
        const shelfList = getShelvesFromNode(node);
        shelfList.forEach((shelf) => {
            if (shelf && !shelfIds.has(shelf.id())) {
                shelfIds.add(shelf.id());
                shelves.push(shelf);
            }
        });
    });
    return shelves;
}

/**
 * Get all node IDs that are in or under the given shelf nodes (shelf + trays + ports).
 * @param {Array} shelfNodes - Array of shelf Cytoscape nodes
 * @returns {Set<string>} Set of node IDs
 */
function getDescendantNodeIds(shelfNodes) {
    const ids = new Set();
    shelfNodes.forEach((shelf) => {
        ids.add(shelf.id());
        const descendants = shelf.descendants();
        descendants.forEach((n) => ids.add(n.id()));
    });
    return ids;
}

/**
 * Get edges where both source and target are within the given set of node IDs.
 * @param {Object} cy - Cytoscape instance
 * @param {Set<string>} nodeIds - Set of node IDs (selection + descendants)
 * @returns {Array} Array of edge elements
 */
export function getConnectionsWithinSelection(cy, nodeIds) {
    if (!cy) return [];
    const edges = [];
    cy.edges().forEach((edge) => {
        const src = edge.data('source');
        const tgt = edge.data('target');
        if (nodeIds.has(src) && nodeIds.has(tgt)) {
            edges.push(edge);
        }
    });
    return edges;
}

/**
 * Build port key (shelfIndex, tray, port) from a port node and shelfIdToIndex map.
 * @param {Object} portNode - Cytoscape port node
 * @param {Map<string, number>} shelfIdToIndex - Map shelf id -> index in clipboard shelves array
 * @returns {{ shelfIndex: number, tray: number, port: number }|null}
 */
function getPortKey(portNode, shelfIdToIndex) {
    const shelf = getContainingShelf(portNode);
    if (!shelf) return null;
    const shelfIndex = shelfIdToIndex.get(shelf.id());
    if (shelfIndex === undefined) return null;
    const trayVal = portNode.data('tray');
    const tray = trayVal != null ? trayVal : (parseInt(String(portNode.data('label') || '').replace('T', ''), 10) || 1);
    const portVal = portNode.data('port');
    const port = portVal != null ? portVal : (parseInt(String(portNode.data('label') || '').replace('P', ''), 10) || 1);
    return { shelfIndex, tray, port };
}

/**
 * Get selected hierarchy nodes: graph instances and/or shelves. If a graph is selected,
 * include its full subtree. If a shelf is selected, include that shelf and its trays/ports.
 * Returns roots (top-level selected) and a flat list of all nodes to copy, ordered so parents
 * come before children.
 * @param {Object} cy - Cytoscape instance
 * @returns {{ roots: Array, allNodes: Array }}
 */
export function getSelectedHierarchyNodes(cy) {
    if (!cy) return { roots: [], allNodes: [] };
    const selected = cy.nodes(':selected');
    if (selected.length === 0) return { roots: [], allNodes: [] };

    const selectedIds = new Set(selected.map(n => n.id()));
    const roots = [];
    const seenIds = new Set();

    selected.forEach((node) => {
        const type = node.data('type');
        if (type !== 'graph' && type !== 'shelf') {
            const shelf = getContainingShelf(node);
            const graph = type === 'graph' ? node : (shelf ? shelf.parent() : null);
            if (shelf && !seenIds.has(shelf.id())) {
                seenIds.add(shelf.id());
                roots.push(shelf);
            } else if (graph && graph.length > 0 && graph.data('type') === 'graph' && !seenIds.has(graph.id())) {
                seenIds.add(graph.id());
                roots.push(graph);
            }
            return;
        }
        if (type === 'graph') {
            const isDescendantOfAnother = selected.some(other => other.id() !== node.id() && other.data('type') === 'graph' && node.isDescendant(other));
            if (!isDescendantOfAnother && !seenIds.has(node.id())) {
                seenIds.add(node.id());
                roots.push(node);
            }
            return;
        }
        if (type === 'shelf') {
            const parentGraph = node.parent();
            const parentIsSelected = parentGraph.length > 0 && selectedIds.has(parentGraph.id());
            if (!parentIsSelected && !seenIds.has(node.id())) {
                seenIds.add(node.id());
                roots.push(node);
            }
        }
    });

    const allIds = new Set();
    const allNodes = [];
    function addDescendants(n) {
        if (allIds.has(n.id())) return;
        allIds.add(n.id());
        allNodes.push(n);
        const children = n.children();
        children.forEach(child => addDescendants(child));
    }
    roots.forEach(r => addDescendants(r));

    return { roots, allNodes };
}

/**
 * Serialize a node's data for hierarchy clipboard (exclude id/parent; include type-specific fields).
 */
function serializeHierarchyNodeData(node) {
    const type = node.data('type');
    const d = node.data();
    const out = {};
    const keys = Object.keys(d);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === 'id' || k === 'parent') continue;
        out[k] = d[k];
    }
    return out;
}

/**
 * Copy current selection to clipboard. In location mode: shelves + internal connections.
 * In hierarchy mode: selected graph instances/shelves + subtrees + internal connections.
 * @param {Object} state - VisualizerState
 * @returns {{ success: boolean, message?: string }} Result
 */
export function copySelection(state) {
    if (!state.cy) {
        return { success: false, message: 'No graph loaded.' };
    }

    if (state.mode === 'hierarchy') {
        const { roots, allNodes } = getSelectedHierarchyNodes(state.cy);
        if (roots.length === 0 || allNodes.length === 0) {
            return { success: false, message: 'Select one or more graph instances or shelves to copy. Connections between nodes in the selection are included.' };
        }
        const nodeIdToIndex = new Map();
        allNodes.forEach((n, i) => nodeIdToIndex.set(n.id(), i));
        const nodes = allNodes.map((n) => {
            const parent = n.parent();
            const parentIndex = parent.length > 0 && nodeIdToIndex.has(parent.id()) ? nodeIdToIndex.get(parent.id()) : -1;
            return {
                id: n.id(),
                type: n.data('type'),
                parentIndex,
                data: serializeHierarchyNodeData(n)
            };
        });
        const nodeIds = new Set(allNodes.map(n => n.id()));
        const internalEdges = getConnectionsWithinSelection(state.cy, nodeIds);
        const connections = [];
        internalEdges.forEach((edge) => {
            const srcId = edge.data('source');
            const tgtId = edge.data('target');
            const si = nodeIdToIndex.get(srcId);
            const ti = nodeIdToIndex.get(tgtId);
            if (si !== undefined && ti !== undefined) {
                connections.push({
                    sourceIndex: si,
                    targetIndex: ti,
                    cableType: edge.data('cable_type') || 'QSFP_DD',
                    cableLength: edge.data('cable_length') || 'Unknown'
                });
            }
        });
        state.clipboard = {
            mode: 'hierarchy',
            nodes,
            connections
        };
        const graphCount = nodes.filter(n => n.type === 'graph').length;
        const shelfCount = nodes.filter(n => n.type === 'shelf').length;
        return {
            success: true,
            message: `Copied ${graphCount} graph(s), ${shelfCount} shelf(s), and ${connections.length} connection(s).`
        };
    }

    if (state.mode !== 'location') {
        return { success: false, message: 'Copy is supported in location or hierarchy mode only.' };
    }

    let shelfNodes = getSelectedShelfNodes(state.cy);
    if (shelfNodes.length === 0) {
        return { success: false, message: 'Select one or more shelves, or a hall/aisle/rack (to copy all shelves under it). Connections are included only between nodes in the selection.' };
    }

    // Sort shelves in the same order as physical layout (hall, aisle, rack_num, shelf_u), then host_id/host_index
    // so copy/paste connection mapping stays correct and matches source organization.
    shelfNodes = shelfNodes.slice().sort((a, b) => {
        const ha = (a.data('hall') != null ? a.data('hall') : '').toString();
        const hb = (b.data('hall') != null ? b.data('hall') : '').toString();
        if (ha !== hb) return ha.localeCompare(hb);
        const aa = (a.data('aisle') != null ? a.data('aisle') : '').toString();
        const ab = (b.data('aisle') != null ? b.data('aisle') : '').toString();
        if (aa !== ab) return aa.localeCompare(ab);
        const ra = a.data('rack_num') != null ? Number(a.data('rack_num')) : 0;
        const rb = b.data('rack_num') != null ? Number(b.data('rack_num')) : 0;
        if (ra !== rb) return ra - rb;
        const ua = a.data('shelf_u') != null ? Number(a.data('shelf_u')) : 0;
        const ub = b.data('shelf_u') != null ? Number(b.data('shelf_u')) : 0;
        if (ua !== ub) return ua - ub;
        const hostA = a.data('host_index') != null ? Number(a.data('host_index')) : (a.data('host_id') != null ? Number(a.data('host_id')) : -1);
        const hostB = b.data('host_index') != null ? Number(b.data('host_index')) : (b.data('host_id') != null ? Number(b.data('host_id')) : -1);
        if (hostA !== hostB) return hostA - hostB;
        return (a.id() || '').localeCompare(b.id() || '');
    });

    const nodeIds = getDescendantNodeIds(shelfNodes);
    const internalEdges = getConnectionsWithinSelection(state.cy, nodeIds);

    const shelfIdToIndex = new Map();
    const shelves = [];

    shelfNodes.forEach((shelf, index) => {
        shelfIdToIndex.set(shelf.id(), index);
        const d = shelf.data();
        shelves.push({
            label: d.label || shelf.id(),
            shelf_node_type: d.shelf_node_type || 'WH_GALAXY',
            hall: d.hall || '',
            aisle: d.aisle || '',
            rack_num: d.rack_num != null ? d.rack_num : 0,
            shelf_u: d.shelf_u != null ? d.shelf_u : 0,
            hostname: d.hostname || ''
        });
    });

    const connections = [];
    internalEdges.forEach((edge) => {
        const sourcePort = state.cy.getElementById(edge.data('source'));
        const targetPort = state.cy.getElementById(edge.data('target'));
        if (sourcePort.length === 0 || targetPort.length === 0) return;
        const sk = getPortKey(sourcePort, shelfIdToIndex);
        const tk = getPortKey(targetPort, shelfIdToIndex);
        if (!sk || !tk) return;
        connections.push({
            source: sk,
            target: tk,
            cableType: edge.data('cable_type') || 'QSFP_DD',
            cableLength: edge.data('cable_length') || 'Unknown'
        });
    });

    const first = shelves[0];
    // Floor = highest specificity of selected items (not of derived shelves). If only racks selected → rack; if racks and shelves → shelf.
    const selected = state.cy.nodes(':selected');
    let copyLevel = 'shelf';
    let hasShelf = false;
    let hasRack = false;
    let hasAisle = false;
    let hasHall = false;
    selected.forEach((node) => {
        const t = node.data('type');
        if (t === 'shelf' || t === 'tray' || t === 'port') hasShelf = true;
        else if (t === 'rack') hasRack = true;
        else if (t === 'aisle') hasAisle = true;
        else if (t === 'hall') hasHall = true;
    });
    if (hasShelf) copyLevel = 'shelf';
    else if (hasRack) copyLevel = 'rack';
    else if (hasAisle) copyLevel = 'aisle';
    else if (hasHall) copyLevel = 'hall';

    state.clipboard = {
        mode: 'location',
        shelves,
        connections,
        copyLevel: copyLevel,
        copyHall: first ? (first.hall != null ? first.hall : '') : '',
        copyAisle: first ? (first.aisle != null ? first.aisle : '') : '',
        copyRackNum: first && first.rack_num != null ? first.rack_num : 1
    };

    return {
        success: true,
        message: `Copied ${shelves.length} shelf(s) and ${connections.length} connection(s).`
    };
}

/**
 * Check if clipboard has content for the current mode.
 * @param {Object} state - VisualizerState
 * @returns {boolean}
 */
export function hasClipboard(state) {
    if (!state.clipboard) return false;
    if (state.clipboard.mode === 'hierarchy') {
        return !!state.clipboard.nodes && state.clipboard.nodes.length > 0;
    }
    return !!state.clipboard.shelves && state.clipboard.shelves.length > 0;
}
