/**
 * Location Module - Functions specific to location/physical mode
 * Extracted from visualizer.js to separate location-specific logic
 */
import { CONNECTION_COLORS, LAYOUT_CONSTANTS } from '../config/constants.js';
import { getNodeConfig, getShelfLayoutDimensions, getShelfUHeight } from '../config/node-types.js';

export class LocationModule {
    constructor(state, commonModule) {
        this.state = state;
        this.common = commonModule;
    }

    /**
     * Update shelf nodes in place with location data from deployment descriptor
     * This avoids reinitializing the entire graph, preserving connections and positions
     * 
     * @param {Object} updatedData - Cytoscape data from backend with location fields added to shelf nodes
     */
    updateShelfLocations(updatedData) {
        if (!this.state.cy || !updatedData || !updatedData.elements) {
            console.warn('[updateShelfLocations] Invalid data or cytoscape instance');
            return;
        }

        // Build a map of host_index/host_id -> location data from backend response
        const locationMap = new Map();
        updatedData.elements.forEach(element => {
            if (element.data && element.data.type === 'shelf') {
                const hostIndex = element.data.host_index;
                const hostId = element.data.host_id;
                const key = hostIndex !== undefined ? hostIndex : hostId;

                if (key !== undefined) {
                    locationMap.set(key, {
                        hall: element.data.hall || '',
                        aisle: element.data.aisle || '',
                        rack_num: this._normalizeRackNum(element.data.rack_num) || 0,
                        shelf_u: element.data.shelf_u || 0,
                        hostname: element.data.hostname || ''
                    });
                }
            }
        });

        // Update existing shelf nodes in place
        let updatedCount = 0;
        this.state.cy.nodes('[type="shelf"]').forEach(shelfNode => {
            const hostIndex = shelfNode.data('host_index');
            const hostId = shelfNode.data('host_id');
            const key = hostIndex !== undefined ? hostIndex : hostId;

            if (key !== undefined && locationMap.has(key)) {
                const locationData = locationMap.get(key);

                // Update only location fields, preserve everything else
                shelfNode.data('hall', locationData.hall);
                shelfNode.data('aisle', locationData.aisle);
                shelfNode.data('rack_num', locationData.rack_num);
                shelfNode.data('shelf_u', locationData.shelf_u);

                // Update hostname if provided
                if (locationData.hostname) {
                    shelfNode.data('hostname', locationData.hostname);
                }

                updatedCount++;
            }
        });

        // Update all shelf labels to use location mode format after location data is updated
        if (updatedCount > 0) {
            this.updateAllShelfLabels();

            // Recolor connections after location updates (in location mode)
            const mode = this.state.mode;
            if (mode === 'location') {
                this.recolorConnections();
            }
        }

        console.log(`[updateShelfLocations] Updated ${updatedCount} shelf nodes with location data`);
        return updatedCount;
    }

    /**
     * Get parent node at specified level
     * @param {Object} node - Cytoscape node
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
     * Determine the racking hierarchy level of a connection based on shelf location data
     * 
     * NOTE: This function is ONLY used in location mode. Racking hierarchy (same host, same rack,
     * same aisle, same hall, different hall) is NOT applicable in hierarchy mode, which deals
     * with logical topology rather than physical racking.
     * 
     * @param {Object} sourceShelf - Source shelf node
     * @param {Object} targetShelf - Target shelf node
     * @returns {string} Racking hierarchy level: 'same_host_id', 'same_rack', 'same_aisle', 'same_hall', or 'different_hall'
     */
    getConnectionHierarchyLevel(sourceShelf, targetShelf) {
        if (!sourceShelf || !targetShelf || !sourceShelf.length || !targetShelf.length) {
            return 'different_hall';
        }

        const sourceHostId = sourceShelf.data('host_id') ?? sourceShelf.data('host_index');
        const targetHostId = targetShelf.data('host_id') ?? targetShelf.data('host_index');

        // Normalize rack numbers for proper comparison (handle both numeric and string values)
        const normalizeRackNum = (rackNum) => {
            if (rackNum === undefined || rackNum === null) return null;
            const num = typeof rackNum === 'string' ? parseInt(rackNum, 10) : rackNum;
            return isNaN(num) ? null : num;
        };

        const sourceRack = normalizeRackNum(sourceShelf.data('rack_num') ?? sourceShelf.data('rack'));
        const targetRack = normalizeRackNum(targetShelf.data('rack_num') ?? targetShelf.data('rack'));

        const sourceAisle = (sourceShelf.data('aisle') ?? '').toString().trim();
        const targetAisle = (targetShelf.data('aisle') ?? '').toString().trim();

        const sourceHall = (sourceShelf.data('hall') ?? '').toString().trim();
        const targetHall = (targetShelf.data('hall') ?? '').toString().trim();

        // Same host (most specific)
        if (sourceHostId !== undefined && targetHostId !== undefined &&
            sourceHostId === targetHostId) {
            return 'same_host_id';
        }

        // For "same rack", we need rack, aisle, AND hall to all match
        // Same rack, different host (but same aisle and hall)
        const racksMatch = sourceRack !== null && targetRack !== null && sourceRack === targetRack;
        const aislesMatch = sourceAisle !== '' && targetAisle !== '' && sourceAisle === targetAisle;
        const hallsMatch = sourceHall !== '' && targetHall !== '' && sourceHall === targetHall;

        if (racksMatch && aislesMatch && hallsMatch) {
            return 'same_rack';
        }

        // Same aisle, different rack (but same hall)
        if (aislesMatch && hallsMatch) {
            return 'same_aisle';
        }

        // Same hall, different aisle
        if (hallsMatch) {
            return 'same_hall';
        }

        // Different halls (most general)
        return 'different_hall';
    }

    /**
     * Get the color for a connection hierarchy level
     * @param {string} connectionLevel - Hierarchy level: 'same_host', 'same_rack', 'same_aisle', 'same_hall', or 'different_hall'
     * @returns {string} Color hex code
     */
    getConnectionColorForLevel(connectionLevel) {
        switch (connectionLevel) {
            case 'same_host_id':
                return CONNECTION_COLORS.SAME_HOST_ID;
            case 'same_rack':
                return CONNECTION_COLORS.SAME_RACK;
            case 'same_aisle':
                return CONNECTION_COLORS.SAME_AISLE;
            case 'same_hall':
                return CONNECTION_COLORS.SAME_HALL;
            default:
                return CONNECTION_COLORS.DIFFERENT_HALL;
        }
    }

    /**
     * Determine if a connection should be shown based on racking hierarchy level and filter settings
     * 
     * NOTE: This function is ONLY used in location mode. Racking hierarchy filters are NOT applicable
     * in hierarchy mode, which deals with logical topology rather than physical racking.
     * 
     * @param {string} connectionLevel - Racking hierarchy level from getConnectionHierarchyLevel
     * @param {boolean} showSameHostId - Whether same host filter is enabled
     * @param {boolean} showSameRack - Whether same rack filter is enabled
     * @param {boolean} showSameAisle - Whether same aisle filter is enabled
     * @param {boolean} showSameHall - Whether same hall filter is enabled
     * @param {boolean} showDifferentHall - Whether different hall filter is enabled
     * @returns {boolean} True if connection should be shown
     */
    shouldShowConnectionByHierarchyLevel(connectionLevel, showSameHostId, showSameRack, showSameAisle, showSameHall, showDifferentHall) {
        // Check if connection should be visible based on type
        if (connectionLevel === 'same_host_id' && showSameHostId) return true;
        if (connectionLevel === 'same_rack' && showSameRack) return true;
        if (connectionLevel === 'same_aisle' && showSameAisle) return true;
        if (connectionLevel === 'same_hall' && showSameHall) return true;
        if (connectionLevel === 'different_hall' && showDifferentHall) return true;
        return false;
    }

    /**
     * Update all shelf labels to use location mode format: "Shelf {shelf_u} ({host_index}: hostname)"
     */
    updateAllShelfLabels() {
        if (!this.state.cy) return;

        const shelfNodes = this.state.cy.nodes('[type="shelf"]');
        shelfNodes.forEach(shelf => {
            const shelfU = shelf.data('shelf_u');
            const hostIndex = shelf.data('host_index') ?? shelf.data('host_id');
            const hostname = shelf.data('hostname') || shelf.data('child_name');

            let newLabel;
            if (shelfU !== undefined && shelfU !== null && shelfU !== '') {
                if (hostIndex !== undefined && hostIndex !== null) {
                    if (hostname) {
                        newLabel = `Shelf ${shelfU} (${hostIndex}: ${hostname})`;
                    } else {
                        newLabel = `Shelf ${shelfU} (${hostIndex})`;
                    }
                } else if (hostname) {
                    newLabel = `Shelf ${shelfU} (${hostname})`;
                } else {
                    newLabel = `Shelf ${shelfU}`;
                }
            } else if (hostname && hostIndex !== undefined && hostIndex !== null) {
                // Fallback: no shelf U, use hostname with host_index
                newLabel = `${hostname} (${hostIndex})`;
            } else if (hostname) {
                newLabel = hostname;
            } else if (hostIndex !== undefined && hostIndex !== null) {
                newLabel = `${hostIndex}`;
            } else {
                // Keep existing label if no data available
                newLabel = shelf.data('label') || shelf.id();
            }

            shelf.data('label', newLabel);
        });
    }

    /**
     * Recolor connections for physical view based on racking hierarchy
     * Colors connections based on: same host, same rack, same aisle, same hall, or different hall
     */
    recolorConnections() {
        if (!this.state.cy) return;

        this.state.cy.edges().forEach(edge => {
            const sourceId = edge.data('source');
            const targetId = edge.data('target');

            // Check if ports are on the same shelf (2 levels up: port -> tray -> shelf)
            const sourceNode = this.state.cy.getElementById(sourceId);
            const targetNode = this.state.cy.getElementById(targetId);

            if (!sourceNode.length || !targetNode.length) {
                edge.data('color', CONNECTION_COLORS.DIFFERENT_HALL);
                return;
            }

            const sourceShelf = this.getParentAtLevel(sourceNode, 2);
            const targetShelf = this.getParentAtLevel(targetNode, 2);

            // Verify that both nodes are actually shelf nodes
            const sourceIsShelf = sourceShelf && sourceShelf.length &&
                (sourceShelf.data('type') === 'shelf' || sourceShelf.data('type') === 'node');
            const targetIsShelf = targetShelf && targetShelf.length &&
                (targetShelf.data('type') === 'shelf' || targetShelf.data('type') === 'node');

            if (!sourceIsShelf || !targetIsShelf) {
                // Fallback color if we can't determine shelf hierarchy
                edge.data('color', CONNECTION_COLORS.DIFFERENT_HALL);
                return;
            }

            // Determine connection hierarchy level and assign color
            const connectionLevel = this.getConnectionHierarchyLevel(sourceShelf, targetShelf);
            const color = this.getConnectionColorForLevel(connectionLevel);

            // Update the edge color
            edge.data('color', color);
        });

        // Force style update to apply color changes
        this.state.cy.style().update();
    }

    /**
     * Position shelf children (trays and ports) using common arrangement function
     * @param {Object} shelfNode - Cytoscape shelf node
     */
    positionShelfChildren(shelfNode) {
        // Use the common tray/port arrangement function
        // This respects the node type configuration (vertical vs horizontal layout)
        this.common.arrangeTraysAndPorts(shelfNode);
    }

    /**
     * Calculate layout for location mode with hall/aisle/rack hierarchy
     */
    calculateLayout() {
        if (!this.state.cy) return;

        console.log('Applying location-based stacked hall/aisle layout');

        // Get all racks and group by hall/aisle
        const racks = this.state.cy.nodes('[type="rack"]');
        if (racks.length === 0) {
            console.log('No racks found, using simple grid layout');
            return;
        }

        // Group racks by hall -> aisle -> rack hierarchy
        const rackHierarchy = {};
        racks.forEach((rack) => {
            // Preserve empty strings - don't convert to 'unknown_hall'/'unknown_aisle'
            const hall = rack.data('hall') !== undefined ? rack.data('hall') : '';
            const aisle = rack.data('aisle') !== undefined ? rack.data('aisle') : '';
            const rackNum = this._normalizeRackNum(rack.data('rack_num')) || 0;

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

        // Determine if we should create hall/aisle compound nodes
        // Skip if only one unique value or if empty
        const uniqueHalls = Object.keys(rackHierarchy);
        const shouldShowHalls = uniqueHalls.length > 1 || (uniqueHalls.length === 1 && uniqueHalls[0] !== '');

        const allAisles = new Set();
        Object.values(rackHierarchy).forEach(aisles => {
            Object.keys(aisles).forEach(aisle => allAisles.add(aisle));
        });
        const shouldShowAisles = allAisles.size > 1 || (allAisles.size === 1 && [...allAisles][0] !== '');

        console.log(`Location layout: ${uniqueHalls.length} halls, ${allAisles.size} aisles (showing halls: ${shouldShowHalls}, aisles: ${shouldShowAisles})`);

        // Stacked hall/aisle layout constants (rack horizontal spacing is from node inside width + RACK_MIN_GAP)
        const hallSpacing = 1200;
        const aisleSpacing = 800; // Vertical spacing between aisles (no horizontal offset)
        const baseX = 200;
        const baseY = 300;

        this.state.cy.startBatch();

        // Remove existing hall/aisle nodes if we're not showing them
        if (!shouldShowHalls) {
            this.state.cy.nodes('[type="hall"]').remove();
        }
        if (!shouldShowAisles) {
            this.state.cy.nodes('[type="aisle"]').remove();
        }

        // Keep track of existing hall and aisle nodes (don't recreate if already exist)
        const existingHalls = {};
        const existingAisles = {};
        if (shouldShowHalls) {
            this.state.cy.nodes('[type="hall"]').forEach(hallNode => {
                existingHalls[hallNode.data('hall')] = hallNode;
            });
        }
        if (shouldShowAisles) {
            this.state.cy.nodes('[type="aisle"]').forEach(aisleNode => {
                const key = `${aisleNode.data('hall')}_${aisleNode.data('aisle')}`;
                existingAisles[key] = aisleNode;
            });
        }

        let hallIndex = 0;
        Object.keys(rackHierarchy).sort().forEach(hall => {
            const hallStartY = baseY + (hallIndex * hallSpacing);

            // Create or update hall node only if showing halls
            let hallNode = null;
            let hallId = null;

            if (shouldShowHalls) {
                hallNode = existingHalls[hall];
                hallId = `hall_${hall}`;

                if (!hallNode || hallNode.length === 0) {
                    // Create new hall node
                    this.state.cy.add({
                        data: {
                            id: hallId,
                            label: `Hall ${hall}`,
                            type: 'hall',
                            hall: hall
                        },
                        position: { x: baseX, y: hallStartY }
                    });
                    hallNode = this.state.cy.getElementById(hallId);
                } else {
                    // Update existing hall node position
                    hallNode.position({ x: baseX, y: hallStartY });
                }
            }

            let aisleIndex = 0;
            Object.keys(rackHierarchy[hall]).sort().forEach(aisle => {
                // Aisles are arranged vertically (no horizontal offset)
                const aisleStartX = baseX;
                const aisleStartY = hallStartY + (aisleIndex * aisleSpacing);

                // Create or update aisle node only if showing aisles
                let aisleNode = null;
                let aisleId = null;

                if (shouldShowAisles) {
                    const aisleKey = `${hall}_${aisle}`;
                    aisleNode = existingAisles[aisleKey];
                    aisleId = `aisle_${hall}_${aisle}`;

                    if (!aisleNode || aisleNode.length === 0) {
                        // Create new aisle node as child of hall (if hall exists) or top-level
                        const aisleData = {
                            id: aisleId,
                            label: `Aisle ${aisle}`,
                            type: 'aisle',
                            hall: hall,
                            aisle: aisle
                        };
                        if (hallId) {
                            aisleData.parent = hallId;
                        }
                        this.state.cy.add({
                            data: aisleData,
                            position: { x: aisleStartX, y: aisleStartY }
                        });
                        aisleNode = this.state.cy.getElementById(aisleId);
                    } else {
                        // Update existing aisle node position and parent
                        aisleNode.position({ x: aisleStartX, y: aisleStartY });
                        if (hallId) {
                            aisleNode.move({ parent: hallId });
                        }
                    }
                }

                // Precompute each rack's inside width (max shelf width) so adjacent racks don't overlap
                const collapsedGraphs = this.state.ui?.collapsedGraphs;
                const shelfIsCollapsed = (s) => collapsedGraphs && collapsedGraphs instanceof Set && collapsedGraphs.has(s.id());
                const rackList = rackHierarchy[hall][aisle];
                const rackInsideWidths = rackList.map((rackData) => {
                    const rack = rackData.node;
                    const shelves = rack.children('[type="shelf"]');
                    let maxW = 0;
                    shelves.forEach((shelf) => {
                        const nodeType = shelf.data('shelf_node_type') || 'WH_GALAXY';
                        const w = getShelfLayoutDimensions(nodeType).width; // always full width for rack spacing
                        maxW = Math.max(maxW, w);
                    });
                    return Math.max(maxW, 1); // avoid 0
                });

                // Rack X: first rack at aisleStartX; each next = prev + (prevWidth/2 + RACK_MIN_GAP + thisWidth/2) * RACK_ADVANCE_FACTOR
                const RACK_MIN_GAP = LAYOUT_CONSTANTS.RACK_MIN_GAP ?? 40;
                const RACK_ADVANCE_FACTOR = LAYOUT_CONSTANTS.RACK_ADVANCE_FACTOR ?? 1;
                let rackX = aisleStartX;
                rackList.forEach((rackData, rackIndex) => {
                    const rack = rackData.node;
                    const thisRackInsideWidth = rackInsideWidths[rackIndex];

                    // Determine rack parent: aisle if exists, otherwise hall if exists, otherwise null (top-level)
                    const rackParent = aisleId || hallId;
                    if (rackParent) {
                        rack.move({ parent: rackParent });
                    } else {
                        // Move to top level (no parent)
                        rack.move({ parent: null });
                    }

                    // Position rack (advance by less when RACK_ADVANCE_FACTOR < 1)
                    if (rackIndex > 0) {
                        const prevWidth = rackInsideWidths[rackIndex - 1];
                        const step = (prevWidth / 2 + RACK_MIN_GAP + thisRackInsideWidth / 2) * RACK_ADVANCE_FACTOR;
                        rackX += step;
                    }
                    rack.position({ x: rackX, y: aisleStartY });

                    // Update rack label to show context (only include hall/aisle if they're shown)
                    const rackHall = shouldShowHalls ? (rackData.hall || hall) : '';
                    const rackAisle = shouldShowAisles ? (rackData.aisle || aisle) : '';
                    const rackLabel = (rackHall && rackAisle) ? `Rack ${rackData.rack_num} (${rackHall}-${rackAisle})` :
                        rackHall ? `Rack ${rackData.rack_num} (${rackHall})` :
                            rackAisle ? `Rack ${rackData.rack_num} (${rackAisle})` :
                                `Rack ${rackData.rack_num}`;
                    rack.data('label', rackLabel);

                    // Position shelves within rack with dynamic spacing
                    const shelves = rack.children('[type="shelf"]');
                    const sortedShelves = [];
                    shelves.forEach((shelf) => {
                        sortedShelves.push({
                            node: shelf,
                            shelf_u: parseInt(shelf.data('shelf_u')) || 0
                        });
                    });
                    sortedShelves.sort((a, b) => {
                        return b.shelf_u - a.shelf_u; // Higher shelf_u at top
                    });

                    const numShelves = sortedShelves.length;
                    if (numShelves > 0) {
                        // First pass: position shelves temporarily and arrange their children
                        sortedShelves.forEach((shelfData) => {
                            const shelf = shelfData.node;
                            shelf.position({ x: rackX, y: aisleStartY }); // Temporary position
                            this.common.arrangeTraysAndPorts(shelf); // Arrange trays/ports to get actual size
                        });

                        // Second pass: calculate dynamic spacing based on actual shelf heights (use larger minimum when shelf is collapsed)
                        let maxShelfHeight = 0;
                        let hasCollapsedShelf = false;

                        sortedShelves.forEach((shelfData) => {
                            const shelf = shelfData.node;
                            let shelfHeight;
                            if (shelfIsCollapsed(shelf)) {
                                hasCollapsedShelf = true;
                                shelfHeight = LAYOUT_CONSTANTS.COLLAPSED_SHELF_LAYOUT_MIN_HEIGHT;
                            } else {
                                const nodeType = shelf.data('shelf_node_type') || 'WH_GALAXY';
                                shelfHeight = getShelfLayoutDimensions(nodeType).height;
                            }
                            maxShelfHeight = Math.max(maxShelfHeight, shelfHeight);
                        });

                        const shelfSpacingFactor = hasCollapsedShelf
                            ? LAYOUT_CONSTANTS.COLLAPSED_SHELF_LOCATION_SPACING_FACTOR
                            : LAYOUT_CONSTANTS.SHELF_VERTICAL_SPACING_FACTOR;
                        const totalHeight = (numShelves - 1) * maxShelfHeight * shelfSpacingFactor;
                        const shelfStartY = aisleStartY - (totalHeight / 2);

                        // Third pass: apply final positions with proper spacing
                        sortedShelves.forEach((shelfData, shelfIndex) => {
                            const shelf = shelfData.node;
                            const yPos = shelfStartY + (shelfIndex * maxShelfHeight * shelfSpacingFactor);
                            shelf.position({ x: rackX, y: yPos });
                        });
                    }

                    // Advance for next rack (by less when RACK_ADVANCE_FACTOR < 1)
                    const nextHalf = rackIndex + 1 < rackList.length ? rackInsideWidths[rackIndex + 1] / 2 : 0;
                    rackX += (thisRackInsideWidth / 2 + RACK_MIN_GAP + nextHalf) * RACK_ADVANCE_FACTOR;
                });

                aisleIndex++;
            });

            hallIndex++;
        });

        // Remove empty hall/aisle/rack compounds left after reparenting (e.g. after aisle/hall edits)
        this._removeEmptyLocationNodes();

        this.state.cy.endBatch();

        console.log('Location-based layout applied with hall > aisle > rack > shelf hierarchy');

        // Apply fcose only to hall/aisle so rack positions from our manual layout are preserved.
        // Rack X is computed as: for each rack, x = prevX + prevRackInsideWidth/2 + RACK_MIN_GAP + thisRackInsideWidth/2
        // (so gap between rack content edges = RACK_MIN_GAP). If we included racks in fcose, it would overwrite those positions.
        setTimeout(() => {
            const locationNodes = this.state.cy.nodes('[type="hall"], [type="aisle"]');
            if (locationNodes.length > 0) {
                try {
                    const layout = this.state.cy.layout({
                        name: 'fcose',
                        eles: locationNodes,
                        quality: 'default',
                        randomize: false,  // Use calculated positions as starting point
                        animate: false,
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
                                this.common.arrangeTraysAndPorts(shelf);
                            });
                            this.common.applyDragRestrictions();

                            // Recolor connections after layout completes
                            // This ensures colors are correct after any layout changes
                            this.recolorConnections();

                            // Update all shelf labels to ensure they use the correct format
                            this.updateAllShelfLabels();

                            this.common.forceApplyCurveStyles();

                            window.saveDefaultLayout?.();

                            // Fit the view to show all nodes with padding before showing container
                            this.state.cy.fit(null, 50);
                            this.state.cy.center();
                            this.state.cy.forceRender();

                            // Show container after layout, coloring, and zoom complete
                            const cyContainer = document.getElementById('cy');
                            if (cyContainer) {
                                cyContainer.style.visibility = 'visible';
                            }
                        }
                    });
                    if (layout) {
                        layout.run();
                    } else {
                        // If layout didn't run (no location nodes), fit and show container after coloring
                        this.recolorConnections();
                        this.updateAllShelfLabels();

                        // Fit the view to show all nodes with padding before showing container
                        this.state.cy.fit(null, 50);
                        this.state.cy.center();
                        this.state.cy.forceRender();

                        const cyContainer = document.getElementById('cy');
                        if (cyContainer) {
                            cyContainer.style.visibility = 'visible';
                        }
                    }
                } catch (e) {
                    console.warn('Error applying fcose layout in location mode:', e.message);
                    // Show container even if layout fails, after coloring and fit
                    this.recolorConnections();
                    this.updateAllShelfLabels();

                    // Fit the view to show all nodes with padding before showing container
                    this.state.cy.fit(null, 50);
                    this.state.cy.center();
                    this.state.cy.forceRender();

                    const cyContainer = document.getElementById('cy');
                    if (cyContainer) {
                        cyContainer.style.visibility = 'visible';
                    }
                }
            } else {
                // No location nodes - show container after coloring and fit
                this.recolorConnections();
                this.updateAllShelfLabels();

                // Fit the view to show all nodes with padding before showing container
                this.state.cy.fit(null, 50);
                this.state.cy.center();
                this.state.cy.forceRender();

                const cyContainer = document.getElementById('cy');
                if (cyContainer) {
                    cyContainer.style.visibility = 'visible';
                }
            }
        }, 100);
    }


    /**
     * Switch to location/physical mode - save hierarchy state then rebuild visualization from current graph.
     * Use this when the user toggles from hierarchy to location mode.
     */
    switchMode() {
        // Stop any running hierarchy layout so the visualizer doesn't stay frozen
        if (typeof window.hierarchyModule?.stopLayout === 'function') {
            window.hierarchyModule.stopLayout();
        }
        // Clear all selections (including Cytoscape selections) when switching modes
        if (this.common && typeof this.common.clearAllSelections === 'function') {
            this.common.clearAllSelections();
        }

        // Save current state before modifying (for switching back)
        // Save hierarchy state for switching back; exclude rerouted edges so we never restore edges that reference collapsed graph nodes
        const allElements = this.state.cy.elements().jsons();
        const elementsWithoutRerouted = allElements.filter((el) => {
            if (el.group === 'edges' && el.data) {
                if (el.data.isRerouted === true) return false;
                if (typeof el.data.id === 'string' && el.data.id.startsWith('rerouted_')) return false;
            }
            return true;
        });
        this.state.data.hierarchyModeState = {
            elements: elementsWithoutRerouted,
            metadata: (this.state.data.currentData && this.state.data.currentData.metadata) ? JSON.parse(JSON.stringify(this.state.data.currentData.metadata)) : {}
        };

        this.rebuildLocationViewFromCurrentGraph();
    }

    /**
     * Rebuild the location view from the current graph: extract shelves/trays/ports/connections,
     * clear the graph, then rebuild hall/aisle/rack hierarchy and re-add elements.
     * Use this after CSV merge or when the graph has shelves with location data but no rack nodes
     * (do not use for mode switching - use switchMode() which also saves hierarchy state).
     */
    rebuildLocationViewFromCurrentGraph() {
        if (!this.state.cy) return;

        // Extract shelf nodes with their physical location and connection data
        const shelfNodes = this.state.cy.nodes('[type="shelf"]');
        if (shelfNodes.length === 0) {
            console.warn('No shelf nodes found');
            return;
        }

        // Extract all relevant data from shelf nodes (preserve ALL fields for round-trip)
        // CRITICAL: Always set id from node.id() so parent lookups and nodeIdsInGraph work on first switch
        const shelfDataList = [];
        shelfNodes.forEach(node => {
            const data = node.data();
            // Get all data fields - keep everything for round-trip compatibility
            const shelfData = {};
            for (const key in data) {
                shelfData[key] = data[key];
            }
            if (shelfData.id == null || shelfData.id === '') {
                shelfData.id = node.id();
            }
            shelfDataList.push({
                data: shelfData,
                classes: node.classes(),
                position: node.position()
            });
        });

        // Log host_index preservation for debugging
        const shelvesWithHostIndex = shelfDataList.filter(s => s.data.host_index !== undefined).length;
        console.log(`[rebuildLocationViewFromCurrentGraph] Extracted ${shelfDataList.length} shelves, ${shelvesWithHostIndex} have host_index`);

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
                    // Preserve all port data; ensure id is set for connection endpoints on first switch
                    const portData = {};
                    const portDataObj = port.data();
                    for (const key in portDataObj) {
                        portData[key] = portDataObj[key];
                    }
                    if (portData.id == null || portData.id === '') {
                        portData.id = port.id();
                    }
                    portsList.push({
                        data: portData,
                        classes: port.classes(),
                        position: port.position()
                    });
                });

                // Preserve all tray data; ensure id is set so nodeIdsInGraph and hierarchy are consistent
                const trayDataCopy = {};
                for (const key in trayData) {
                    trayDataCopy[key] = trayData[key];
                }
                if (trayDataCopy.id == null || trayDataCopy.id === '') {
                    trayDataCopy.id = tray.id();
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

        // Extract only original (port-to-port) connections; skip rerouted edges (they reference collapsed graph nodes that don't exist in location view)
        const connections = [];
        const currentEdges = this.state.cy.edges();
        currentEdges.forEach(edge => {
            if (edge.data('isRerouted') === true) return;
            const edgeId = edge.data('id') || edge.id();
            if (typeof edgeId === 'string' && edgeId.startsWith('rerouted_')) return;
            const edgeData = {};
            const data = edge.data();
            for (const key in data) {
                if (key !== 'color') {
                    edgeData[key] = data[key];
                }
            }
            connections.push({
                data: edgeData,
                classes: edge.classes()
            });
        });
        console.log(`[rebuildLocationViewFromCurrentGraph] Preserved ${connections.length} connections (rerouted excluded)`);

        // Clear the entire graph (batch with add below for performance)
        this.state.cy.startBatch();
        this.state.cy.elements().remove();

        // Rebuild visualization based ONLY on physical location data
        const newElements = [];

        // Check if we have location information
        const hasLocationInfo = shelfDataList.some(shelfInfo =>
            shelfInfo.data.hall || shelfInfo.data.aisle || (shelfInfo.data.rack_num !== undefined && shelfInfo.data.rack_num !== null)
        );

        if (hasLocationInfo) {
            // Group shelves by location hierarchy: hall -> aisle -> rack
            // Use normalized string keys so number vs string (e.g. rack_num 1 vs "1") never splits shelves across buckets
            const locationHierarchy = {};

            shelfDataList.forEach(shelfInfo => {
                const hall = String(shelfInfo.data.hall ?? '').trim();
                const aisle = String(shelfInfo.data.aisle ?? '').trim();
                const rackNum = this._normalizeRackNum(shelfInfo.data.rack_num);
                const rack = rackNum !== null && rackNum !== undefined ? String(rackNum) : 'unknown_rack';

                if (!locationHierarchy[hall]) locationHierarchy[hall] = {};
                if (!locationHierarchy[hall][aisle]) locationHierarchy[hall][aisle] = {};
                if (!locationHierarchy[hall][aisle][rack]) locationHierarchy[hall][aisle][rack] = [];

                locationHierarchy[hall][aisle][rack].push(shelfInfo);
            });

            // Determine if we should create hall/aisle compound nodes
            // Skip if only one unique value or if empty
            const uniqueHalls = Object.keys(locationHierarchy);
            const shouldShowHalls = uniqueHalls.length > 1 || (uniqueHalls.length === 1 && uniqueHalls[0] !== '');

            const allAisles = new Set();
            Object.values(locationHierarchy).forEach(aisles => {
                Object.keys(aisles).forEach(aisle => allAisles.add(aisle));
            });
            const shouldShowAisles = allAisles.size > 1 || (allAisles.size === 1 && [...allAisles][0] !== '');

            console.log(`Location hierarchy: ${uniqueHalls.length} halls, ${allAisles.size} aisles (showing halls: ${shouldShowHalls}, aisles: ${shouldShowAisles})`);

            // Create location-based hierarchy nodes
            // Adaptive hierarchy: Hall > Aisle > Rack > Shelf (skip hall/aisle if singular or empty)
            const hallSpacing = 1200; // Vertical spacing between halls
            const aisleSpacing = 1000; // Vertical spacing between aisles (no horizontal offset) - increased for better separation
            const baseX = 200;
            const baseY = 300;

            let hallIndex = 0;
            Object.keys(locationHierarchy).sort().forEach(hall => {
                const hallStartY = baseY + (hallIndex * hallSpacing);

                // Create hall node only if we have multiple halls or a non-empty hall
                let hallId = null;
                if (shouldShowHalls) {
                    hallId = `hall_${hall}`;
                    newElements.push({
                        data: {
                            id: hallId,
                            label: `Hall ${hall}`,
                            type: 'hall',
                            hall: hall
                        },
                        position: { x: baseX, y: hallStartY }
                    });
                }

                let aisleIndex = 0;
                Object.keys(locationHierarchy[hall]).sort().forEach(aisle => {
                    // Aisles are arranged vertically (no horizontal offset)
                    const aisleStartX = baseX;
                    const aisleStartY = hallStartY + (aisleIndex * aisleSpacing);

                    // Create aisle node only if we have multiple aisles or a non-empty aisle
                    let aisleId = null;
                    if (shouldShowAisles) {
                        aisleId = `aisle_${hall}_${aisle}`;
                        newElements.push({
                            data: {
                                id: aisleId,
                                label: `Aisle ${aisle}`,
                                type: 'aisle',
                                parent: hallId, // Parent is hall if it exists, otherwise null (top-level)
                                hall: hall,
                                aisle: aisle
                            },
                            position: { x: aisleStartX, y: aisleStartY }
                        });
                    }

                    // Sort racks in descending order (higher rack numbers to the left)
                    const sortedRackKeys = Object.keys(locationHierarchy[hall][aisle]).sort((a, b) => {
                        const rackA = parseInt(a) || 0;
                        const rackB = parseInt(b) || 0;
                        return rackB - rackA; // Descending order - rack 2 to the left of rack 1
                    });
                    // Precompute inside width per rack (from shelf node types) so adjacent racks don't overlap
                    const createRackInsideWidths = sortedRackKeys.map(rackKey => {
                        const shelvesInRack = locationHierarchy[hall][aisle][rackKey];
                        let maxW = 0;
                        shelvesInRack.forEach(shelfInfo => {
                            const nodeType = shelfInfo.data?.shelf_node_type || 'WH_GALAXY';
                            const w = getShelfLayoutDimensions(nodeType).width;
                            maxW = Math.max(maxW, w);
                        });
                        return Math.max(maxW, 1);
                    });
                    const createRackMinGap = LAYOUT_CONSTANTS.RACK_MIN_GAP ?? 40;
                    const createRackAdvanceFactor = LAYOUT_CONSTANTS.RACK_ADVANCE_FACTOR ?? 1;

                    let rackX = aisleStartX;
                    sortedRackKeys.forEach((rackKey, rackIndex) => {
                        const shelvesInRack = locationHierarchy[hall][aisle][rackKey];
                        const thisRackInsideWidth = createRackInsideWidths[rackIndex];

                        // Position rack (advance by less when RACK_ADVANCE_FACTOR < 1)
                        if (rackIndex > 0) {
                            const prevWidth = createRackInsideWidths[rackIndex - 1];
                            const step = (prevWidth / 2 + createRackMinGap + thisRackInsideWidth / 2) * createRackAdvanceFactor;
                            rackX += step;
                        }

                        // Determine rack parent: aisle if exists, otherwise hall if exists, otherwise null (top-level)
                        const rackParent = aisleId || hallId || null;
                        const rackLabel = (hall && aisle) ? `Rack ${rackKey} (${hall}-${aisle})` :
                            hall ? `Rack ${rackKey} (${hall})` :
                                aisle ? `Rack ${rackKey} (${aisle})` :
                                    `Rack ${rackKey}`;

                        // Create rack node with appropriate parent (rack_num as number when numeric, else key string)
                        const rackId = `rack_${hall}_${aisle}_${rackKey}`;
                        const rackNumValue = rackKey === 'unknown_rack' ? rackKey : (parseInt(rackKey, 10) || rackKey);
                        const rackData = {
                            id: rackId,
                            label: rackLabel,
                            type: 'rack',
                            hall: hall,
                            aisle: aisle,
                            rack_num: rackNumValue
                        };

                        if (rackParent) {
                            rackData.parent = rackParent;
                        }

                        newElements.push({
                            data: rackData,
                            classes: 'rack',
                            position: { x: rackX, y: aisleStartY }
                        });

                        // Add shelves to this rack
                        shelvesInRack.forEach((shelfInfo, index) => {
                            // CRITICAL: Explicitly preserve ALL logical topology fields
                            // The spread operator copies fields, but we explicitly ensure critical fields
                            const shelfData = {
                                ...shelfInfo.data,
                                parent: rackId,
                                type: 'shelf',
                                // Ensure hall/aisle/rack info is preserved on shelf nodes (consistent types)
                                hall: hall,
                                aisle: aisle,
                                rack_num: rackNumValue
                            };

                            // CRITICAL: Explicitly preserve host_index (DO NOT let spread overwrite)
                            // This is the key field that links logical topology to physical deployment
                            if (shelfInfo.data.host_index !== undefined) {
                                shelfData.host_index = shelfInfo.data.host_index;
                            }

                            // Also preserve host_id as a fallback (some code uses this name)
                            if (shelfInfo.data.host_id !== undefined) {
                                shelfData.host_id = shelfInfo.data.host_id;
                            }

                            // Preserve other logical topology fields needed for round-trip
                            if (shelfInfo.data.child_name !== undefined) {
                                shelfData.child_name = shelfInfo.data.child_name;
                            }
                            if (shelfInfo.data.logical_path !== undefined) {
                                shelfData.logical_path = shelfInfo.data.logical_path;
                            }

                            // Set label in location mode: "Shelf {shelf_u} ({host_index}: hostname)"
                            const shelfU = shelfData.shelf_u;
                            const hostIndex = shelfInfo.data.host_index;
                            const hostname = shelfInfo.data.hostname || shelfInfo.data.child_name;

                            let displayLabel;
                            if (shelfU !== undefined && shelfU !== null && shelfU !== '') {
                                // Format: Shelf {shelf_u} ({host_index}: hostname) or Shelf {shelf_u} ({host_index})
                                if (hostIndex !== undefined && hostIndex !== null) {
                                    if (hostname) {
                                        displayLabel = `Shelf ${shelfU} (${hostIndex}: ${hostname})`;
                                    } else {
                                        displayLabel = `Shelf ${shelfU} (${hostIndex})`;
                                    }
                                } else if (hostname) {
                                    displayLabel = `Shelf ${shelfU} (${hostname})`;
                                } else {
                                    displayLabel = `Shelf ${shelfU}`;
                                }
                            } else {
                                // Fallback: no shelf U, use hostname/host_index format
                                if (hostname && hostIndex !== undefined && hostIndex !== null) {
                                    displayLabel = `${hostname} (${hostIndex})`;
                                } else if (hostname) {
                                    displayLabel = hostname;
                                } else if (hostIndex !== undefined && hostIndex !== null) {
                                    displayLabel = `${hostIndex}`;
                                } else {
                                    displayLabel = shelfInfo.data.label || shelfInfo.data.id || 'shelf';
                                }
                            }
                            shelfData.label = displayLabel;

                            newElements.push({
                                data: shelfData,
                                classes: shelfInfo.classes,
                                position: { x: rackX, y: aisleStartY + 50 + index * 100 }
                            });
                        });

                        const nextHalf = rackIndex + 1 < sortedRackKeys.length ? createRackInsideWidths[rackIndex + 1] / 2 : 0;
                        rackX += (thisRackInsideWidth / 2 + createRackMinGap + nextHalf) * createRackAdvanceFactor;
                    });

                    aisleIndex++;
                });

                hallIndex++;
            });
        } else {
            // No location info - arrange shelves in a grid
            const gridCols = Math.ceil(Math.sqrt(shelfDataList.length));
            shelfDataList.forEach((shelfInfo, index) => {
                const col = index % gridCols;
                const row = Math.floor(index / gridCols);

                // CRITICAL: Explicitly preserve host_index
                const shelfData = {
                    ...shelfInfo.data,
                    type: 'shelf'
                };

                // Verify host_index is preserved
                if (shelfInfo.data.host_index !== undefined) {
                    shelfData.host_index = shelfInfo.data.host_index;
                }

                // Set label in location mode: "Shelf {shelf_u} ({host_index}: hostname)"
                const shelfU = shelfData.shelf_u;
                const hostIndex = shelfInfo.data.host_index;
                const hostname = shelfInfo.data.hostname || shelfInfo.data.child_name;

                let displayLabel;
                if (shelfU !== undefined && shelfU !== null && shelfU !== '') {
                    // Format: Shelf {shelf_u} ({host_index}: hostname) or Shelf {shelf_u} ({host_index})
                    if (hostIndex !== undefined && hostIndex !== null) {
                        if (hostname) {
                            displayLabel = `Shelf ${shelfU} (${hostIndex}: ${hostname})`;
                        } else {
                            displayLabel = `Shelf ${shelfU} (${hostIndex})`;
                        }
                    } else if (hostname) {
                        displayLabel = `Shelf ${shelfU} (${hostname})`;
                    } else {
                        displayLabel = `Shelf ${shelfU}`;
                    }
                } else {
                    // Fallback: no shelf U, use hostname/host_index format
                    if (hostname && hostIndex !== undefined && hostIndex !== null) {
                        displayLabel = `${hostname} (${hostIndex})`;
                    } else if (hostname) {
                        displayLabel = hostname;
                    } else if (hostIndex !== undefined && hostIndex !== null) {
                        displayLabel = `${hostIndex}`;
                    } else {
                        displayLabel = shelfInfo.data.label || shelfInfo.data.id || 'shelf';
                    }
                }
                shelfData.label = displayLabel;

                newElements.push({
                    data: shelfData,
                    classes: shelfInfo.classes,
                    position: { x: 200 + col * 400, y: 200 + row * 300 }
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

        // Build set of node IDs we created (connections must reference these only)
        const nodeIdsInGraph = new Set();
        newElements.forEach(el => {
            if (el.data && el.data.id) nodeIdsInGraph.add(el.data.id);
        });

        // Re-create connections only when both endpoints exist in the location graph (avoids "nonexistant source" on first switch)
        connections.forEach(conn => {
            const src = conn.data.source;
            const tgt = conn.data.target;
            if (!src || !tgt) return;
            if (!nodeIdsInGraph.has(src) || !nodeIdsInGraph.has(tgt)) return;
            newElements.push({
                data: conn.data,
                classes: conn.classes
            });
        });

        // Add all elements back to cytoscape
        this.state.cy.add(newElements);
        this.state.cy.endBatch();

        // Recolor connections immediately after adding edges (before layout)
        // This ensures colors are set before any async layout operations
        this.recolorConnections();

        // Update all shelf labels to use location mode format
        this.updateAllShelfLabels();

        // Do not call recalculateAllEdgeRouting in location mode: there are no graph compound nodes here,
        // so rerouted edges would reference nodes that don't exist in the location graph.

        // Apply the proper location-based layout with stacked halls/aisles and dynamic spacing
        this.calculateLayout();

        // Apply drag restrictions (trays and ports should not be draggable)
        this.common.applyDragRestrictions();

        // Recolor connections again after layout completes (fcose is async)
        // Use setTimeout to ensure layout has finished
        setTimeout(() => {
            this.recolorConnections();
            // Force a render to ensure color changes are visible
            this.state.cy.forceRender();
        }, 350);  // Increased delay to ensure fcose layout completes (300ms + buffer)

        // Update edge curve styles for physical mode
        setTimeout(() => {
            // Call forceApplyCurveStyles via window if available
            this.common.forceApplyCurveStyles();
        }, 100);
    }

    /**
     * Build label from location components
     * @param {string} hall - Hall identifier
     * @param {string} aisle - Aisle identifier
     * @param {number} rackNum - Rack number
     * @param {number|null} shelfU - Shelf U number (optional)
     * @returns {string} Formatted label
     */
    buildLabel(hall, aisle, rackNum, shelfU = null) {
        if (!hall || !aisle || rackNum === undefined || rackNum === null) {
            return '';
        }

        const rackPadded = this._formatRackNum(rackNum);
        const label = `${hall}${aisle}${rackPadded}`;

        if (shelfU !== null && shelfU !== undefined && shelfU !== '') {
            const shelfUPadded = this._formatShelfU(shelfU);
            return `${label}U${shelfUPadded}`;
        }

        return label;
    }

    /**
     * Normalize rack_num to integer (handles string, number, null, undefined)
     * @param {*} rackNum - Rack number value (can be string, number, null, undefined)
     * @returns {number|null} Integer rack number or null if invalid/empty
     */
    _normalizeRackNum(rackNum) {
        if (rackNum === null || rackNum === undefined || rackNum === '') {
            return null;
        }
        const parsed = parseInt(rackNum, 10);
        return isNaN(parsed) ? null : parsed;
    }

    /**
     * Determine if halls/aisles should be shown based on current data
     * @returns {Object} {shouldShowHalls: boolean, shouldShowAisles: boolean}
     */
    _shouldShowHallsAndAisles() {
        const allRacks = this.state.cy.nodes('[type="rack"]');
        const uniqueHalls = new Set();
        const allAisles = new Set();

        allRacks.forEach((rack) => {
            const rackHall = rack.data('hall') !== undefined ? rack.data('hall') : '';
            const rackAisle = rack.data('aisle') !== undefined ? rack.data('aisle') : '';
            if (rackHall !== '') uniqueHalls.add(rackHall);
            if (rackAisle !== '') allAisles.add(rackAisle);
        });

        const shouldShowHalls = uniqueHalls.size > 1 || (uniqueHalls.size === 1 && [...uniqueHalls][0] !== '');
        const shouldShowAisles = allAisles.size > 1 || (allAisles.size === 1 && [...allAisles][0] !== '');

        return { shouldShowHalls, shouldShowAisles };
    }

    /**
     * Remove hall, aisle, and rack compound nodes that have no children.
     * Call after location hierarchy changes (e.g. after reparenting racks) so the visualizer
     * does not leave empty compounds. Removes bottom-up: empty racks, then empty aisles, then empty halls.
     */
    _removeEmptyLocationNodes() {
        if (!this.state.cy) return;
        let removed = true;
        while (removed) {
            removed = false;
            // Empty rack: no shelf (or other) children
            const emptyRacks = this.state.cy.nodes('[type="rack"]').filter((rack) => rack.children().length === 0);
            if (emptyRacks.length > 0) {
                emptyRacks.remove();
                removed = true;
            }
            // Empty aisle: no rack (or other) children
            const emptyAisles = this.state.cy.nodes('[type="aisle"]').filter((aisle) => aisle.children().length === 0);
            if (emptyAisles.length > 0) {
                emptyAisles.remove();
                removed = true;
            }
            // Empty hall: no aisle or rack children
            const emptyHalls = this.state.cy.nodes('[type="hall"]').filter((hall) => hall.children().length === 0);
            if (emptyHalls.length > 0) {
                emptyHalls.remove();
                removed = true;
            }
        }
    }

    /**
     * Create node data structures for hall/aisle/rack (for use in switchMode where we build newElements array)
     * Returns node data structures that can be added to newElements array, not added directly to cytoscape
     * @param {Object} params - Parameters object
     * @param {string} [params.hall] - Hall identifier
     * @param {string} [params.aisle] - Aisle identifier
     * @param {number} [params.rackNum] - Rack number
     * @param {Object} [params.position] - Position {x, y}
     * @param {string} [params.hallParentId] - Parent ID for hall (usually null)
     * @param {string} [params.aisleParentId] - Parent ID for aisle (hall ID if exists)
     * @param {string} [params.rackParentId] - Parent ID for rack (aisle > hall > null)
     * @returns {Object} Object with hallData, aisleData, rackData (null if not requested/created)
     */
    _createLocationNodeData(params = {}) {
        const { hall, aisle, rackNum, position, aisleParentId, rackParentId } = params;

        let hallData = null;
        let aisleData = null;
        let rackData = null;

        // Normalize rack number
        const normalizedRackNum = rackNum !== undefined ? this._normalizeRackNum(rackNum) : null;

        // Create hall node data structure
        if (hall) {
            const hallId = `hall_${hall}`;
            hallData = {
                data: {
                    id: hallId,
                    label: `Hall ${hall}`,
                    type: 'hall',
                    hall: hall
                },
                position: position || { x: 200, y: 300 }
            };
        }

        // Create aisle node data structure (requires hall)
        if (hall && aisle) {
            const aisleId = `aisle_${hall}_${aisle}`;
            aisleData = {
                data: {
                    id: aisleId,
                    label: `Aisle ${aisle}`,
                    type: 'aisle',
                    hall: hall,
                    aisle: aisle,
                    parent: aisleParentId || null
                },
                position: position || { x: 200, y: 300 }
            };
        }

        // Create rack node data structure
        if (normalizedRackNum !== null) {
            const normalizedHall = hall || '';
            const normalizedAisle = aisle || '';

            const rackLabel = (normalizedHall && normalizedAisle) ? `Rack ${normalizedRackNum} (${normalizedHall}-${normalizedAisle})` :
                normalizedHall ? `Rack ${normalizedRackNum} (${normalizedHall})` :
                    normalizedAisle ? `Rack ${normalizedRackNum} (${normalizedAisle})` :
                        `Rack ${normalizedRackNum}`;

            const rackId = `rack_${normalizedHall}_${normalizedAisle}_${normalizedRackNum}`;
            rackData = {
                data: {
                    id: rackId,
                    label: rackLabel,
                    type: 'rack',
                    rack_num: normalizedRackNum,
                    hall: normalizedHall,
                    aisle: normalizedAisle,
                    parent: rackParentId || null
                },
                classes: 'rack',
                position: position || { x: 200, y: 300 }
            };
        }

        return { hallData, aisleData, rackData };
    }

    /**
     * Consolidated function to find existing hall/aisle/rack nodes by their data attributes
     * @param {Object} params - Parameters object
     * @param {string} [params.hall] - Hall identifier
     * @param {string} [params.aisle] - Aisle identifier
     * @param {number} [params.rackNum] - Rack number
     * @returns {Object} Object with hallNode, aisleNode, rackNode (null if not found)
     */
    _findExistingLocationNodes(params = {}) {
        const { hall, aisle, rackNum } = params;

        let hallNode = null;
        let aisleNode = null;
        let rackNode = null;

        // Find existing hall node
        if (hall) {
            const halls = this.state.cy.nodes('[type="hall"]').filter((h) => {
                return h.data('hall') === hall;
            });
            hallNode = halls.length > 0 ? halls[0] : null;
        }

        // Find existing aisle node (requires hall)
        if (hall && aisle) {
            const aisles = this.state.cy.nodes('[type="aisle"]').filter((a) => {
                return a.data('hall') === hall && a.data('aisle') === aisle;
            });
            aisleNode = aisles.length > 0 ? aisles[0] : null;
        }

        // Find existing rack node (requires hall, aisle, and rackNum)
        if (rackNum !== null && rackNum !== undefined) {
            const normalizedHall = hall || '';
            const normalizedAisle = aisle || '';
            const normalizedRackNum = this._normalizeRackNum(rackNum);

            if (normalizedRackNum !== null) {
                const racks = this.state.cy.nodes('[type="rack"]').filter((r) => {
                    const rackHall = r.data('hall') || '';
                    const rackAisle = r.data('aisle') || '';
                    const rackNum = this._normalizeRackNum(r.data('rack_num'));
                    return rackHall === normalizedHall &&
                        rackAisle === normalizedAisle &&
                        rackNum === normalizedRackNum;
                });
                rackNode = racks.length > 0 ? racks[0] : null;
            }
        }

        return { hallNode, aisleNode, rackNode };
    }

    /**
     * Consolidated function to find or create hall/aisle/rack nodes with proper hierarchy
     * Hierarchy: Hall > Aisle > Rack > Shelf
     * 
     * Hierarchy enforcement rules (relative to other levels):
     * - If a level is specified, its parent (higher level) CAN be specified (optional)
     *   Example: If Aisle (lower than Hall) is specified, Hall (higher level) can be specified
     * - If a level is specified, its children (lower levels) MUST be expected (required)
     *   Example: If Aisle (higher than Rack) is specified, Rack (lower level) must be specified
     * - If a lower level (Rack) is specified, higher levels (Hall/Aisle) are NOT required (can exist independently)
     * 
     * @param {Object} params - Parameters object
     * @param {string} [params.hall] - Hall identifier (optional if aisle is specified)
     * @param {string} [params.aisle] - Aisle identifier (if specified, rackNum must be specified)
     * @param {number} [params.rackNum] - Rack number (required if aisle is specified, otherwise can exist independently)
     * @param {Object} [options] - Options object
     * @param {boolean} [options.shouldShowHalls] - Whether halls should be shown (if not provided, will be calculated)
     * @param {boolean} [options.shouldShowAisles] - Whether aisles should be shown (if not provided, will be calculated)
     * @param {Object} [options.hallNode] - Existing hall node (if not provided, will be found/created)
     * @param {Object} [options.aisleNode] - Existing aisle node (if not provided, will be found/created)
     * @param {Object} [options.position] - Position for new node {x, y}
     * @returns {Object} Object with hallNode, aisleNode, rackNode (null if not requested/created)
     */
    _findOrCreateLocationNodes(params = {}, options = {}) {
        const { hall, aisle, rackNum } = params;
        const { shouldShowHalls, shouldShowAisles, hallNode: providedHallNode, aisleNode: providedAisleNode, position } = options;

        // Calculate shouldShow flags if not provided
        const { shouldShowHalls: calculatedShouldShowHalls, shouldShowAisles: calculatedShouldShowAisles } = this._shouldShowHallsAndAisles();
        const showHalls = shouldShowHalls !== undefined ? shouldShowHalls : calculatedShouldShowHalls;
        const showAisles = shouldShowAisles !== undefined ? shouldShowAisles : calculatedShouldShowAisles;

        let hallNode = null;
        let aisleNode = null;
        let rackNode = null;

        // Normalize rack number first
        const normalizedRackNum = rackNum !== undefined ? this._normalizeRackNum(rackNum) : null;

        // Enforce hierarchy: If Aisle (higher level compared to Rack) is specified, Rack (lower level) MUST be expected
        if (aisle && normalizedRackNum === null) {
            console.warn('[findOrCreateLocationNodes] Aisle (higher level) specified but rackNum (lower level) is missing - if aisle is specified, rackNum must be specified');
            return { hallNode: null, aisleNode: null, rackNode: null };
        }

        // Find existing nodes first (if not provided)
        const existingNodes = this._findExistingLocationNodes({ hall, aisle, rackNum: normalizedRackNum });

        // Find or create hall node
        if (hall && showHalls) {
            hallNode = providedHallNode || existingNodes.hallNode;
            if (!hallNode) {
                // Create new hall node
                const hallId = `hall_${hall}`;
                const hallData = {
                    id: hallId,
                    label: `Hall ${hall}`,
                    type: 'hall',
                    hall: hall
                };
                this.state.cy.add({
                    data: hallData,
                    position: position || { x: 200, y: 300 }
                });
                hallNode = this.state.cy.getElementById(hallId);
            }
        }

        // Find or create aisle node (hall can be optional - if aisle is specified, hall can be specified but is optional)
        if (aisle && showAisles) {
            // If hall is not specified but aisle is, we still need a hall for structural parent
            // If hall was specified but hallNode wasn't created (e.g., showHalls is false), 
            // we still need to create/find hall for the aisle's parent
            if (hall && !hallNode && showHalls) {
                // This shouldn't happen as we create hall above, but handle it
                hallNode = providedHallNode || existingNodes.hallNode;
                if (!hallNode) {
                    const hallId = `hall_${hall}`;
                    const hallData = {
                        id: hallId,
                        label: `Hall ${hall}`,
                        type: 'hall',
                        hall: hall
                    };
                    this.state.cy.add({
                        data: hallData,
                        position: position || { x: 200, y: 300 }
                    });
                    hallNode = this.state.cy.getElementById(hallId);
                }
            }

            // If no hall specified and no hallNode, aisle will be created at top level
            // (hall is optional per the rules)
            if (!hallNode && !hall) {
                // Aisle specified without hall - allowed per rules, create at top level
                console.warn('[findOrCreateLocationNodes] Aisle specified without hall - aisle will be created at top level');
            }

            aisleNode = providedAisleNode || existingNodes.aisleNode;
            if (!aisleNode) {
                // Create new aisle node
                const aisleId = `aisle_${hall}_${aisle}`;
                const aisleData = {
                    id: aisleId,
                    label: `Aisle ${aisle}`,
                    type: 'aisle',
                    hall: hall,
                    aisle: aisle,
                    parent: hallNode.id()
                };
                this.state.cy.add({
                    data: aisleData,
                    position: position || { x: 200, y: 300 }
                });
                aisleNode = this.state.cy.getElementById(aisleId);
            } else {
                // Ensure aisle is under correct hall parent
                aisleNode.move({ parent: hallNode.id() });
            }
        }

        // Find or create rack node (can exist independently, doesn't require hall/aisle)
        if (normalizedRackNum !== null) {
            const normalizedHall = hall || '';
            const normalizedAisle = aisle || '';

            rackNode = existingNodes.rackNode;
            if (rackNode) {
                // Update rack data to match current values
                rackNode.data('hall', normalizedHall);
                rackNode.data('aisle', normalizedAisle);
                rackNode.data('rack_num', normalizedRackNum);

                // Update rack label
                const rackLabel = (normalizedHall && normalizedAisle) ? `Rack ${normalizedRackNum} (${normalizedHall}-${normalizedAisle})` :
                    normalizedHall ? `Rack ${normalizedRackNum} (${normalizedHall})` :
                        normalizedAisle ? `Rack ${normalizedRackNum} (${normalizedAisle})` :
                            `Rack ${normalizedRackNum}`;
                rackNode.data('label', rackLabel);

                // Ensure rack is under correct parent (if hall/aisle are provided)
                if (hall || aisle) {
                    const rackParent = this._determineRackParent(normalizedHall, normalizedAisle, { aisleNode, hallNode });
                    if (rackParent) {
                        rackNode.move({ parent: rackParent });
                    } else {
                        rackNode.move({ parent: null });
                    }
                }
            } else {
                // Create new rack node
                const rackParent = (hall || aisle) ? this._determineRackParent(normalizedHall, normalizedAisle, { aisleNode, hallNode }) : null;
                const rackPosition = position || this._calculateNewRackPosition();

                const rackLabel = (normalizedHall && normalizedAisle) ? `Rack ${normalizedRackNum} (${normalizedHall}-${normalizedAisle})` :
                    normalizedHall ? `Rack ${normalizedRackNum} (${normalizedHall})` :
                        normalizedAisle ? `Rack ${normalizedRackNum} (${normalizedAisle})` :
                            `Rack ${normalizedRackNum}`;

                const rackId = `rack_${normalizedHall}_${normalizedAisle}_${normalizedRackNum}`;
                const rackData = {
                    id: rackId,
                    label: rackLabel,
                    type: 'rack',
                    rack_num: normalizedRackNum,
                    hall: normalizedHall,
                    aisle: normalizedAisle
                };

                if (rackParent) {
                    rackData.parent = rackParent;
                }

                this.state.cy.add({
                    group: 'nodes',
                    data: rackData,
                    classes: 'rack',
                    position: rackPosition
                });

                rackNode = this.state.cy.getElementById(rackId);
            }
        }

        return { hallNode, aisleNode, rackNode };
    }

    /**
     * Determine the appropriate parent ID for a rack based on hall/aisle hierarchy
     * @param {string} hall - Hall identifier
     * @param {string} aisle - Aisle identifier
     * @param {Object} options - Options object
     * @param {Object} [options.aisleNode] - Existing aisle node
     * @param {Object} [options.hallNode] - Existing hall node
     * @returns {string|null} Parent ID (aisle > hall > null)
     */
    _determineRackParent(hall, aisle, options = {}) {
        const { aisleNode, hallNode } = options;

        // If aisle node is provided, use it
        if (aisleNode) {
            return aisleNode.id();
        }

        // If hall node is provided and no aisle, use hall
        if (hallNode && !aisle) {
            return hallNode.id();
        }

        // Try to find existing nodes if not provided
        const existingNodes = this._findExistingLocationNodes({ hall, aisle });
        if (existingNodes.aisleNode) {
            return existingNodes.aisleNode.id();
        }
        if (existingNodes.hallNode) {
            return existingNodes.hallNode.id();
        }

        return null;
    }

    /**
     * Calculate position for a new rack node
     * Positions it to the right of the rightmost existing rack
     * @returns {Object} Position {x, y}
     */
    _calculateNewRackPosition() {
        const existingRacks = this.state.cy.nodes('[type="rack"]');

        if (existingRacks.length > 0) {
            // Position new rack to the right of the rightmost rack
            let maxX = -Infinity;
            let newRackY = 0;
            existingRacks.forEach((rack) => {
                const rackPos = rack.position();
                if (rackPos.x > maxX) {
                    maxX = rackPos.x;
                    newRackY = rackPos.y;
                }
            });
            return { x: maxX + 600, y: newRackY }; // 600px spacing between racks
        } else {
            // First rack - use default position
            return {
                x: LAYOUT_CONSTANTS.NEW_RACK_DEFAULT_X,
                y: LAYOUT_CONSTANTS.NEW_RACK_DEFAULT_Y
            };
        }
    }

    /**
     * Get location data from a node or its parent hierarchy.
     * Includes host_index/host_id for bi-directional association with racking info.
     * @param {Object} node - Cytoscape node
     * @returns {Object} Location data {hall, aisle, rack_num, shelf_u, hostname, host_index?, host_id?}
     */
    getNodeData(node) {
        const data = node.data();

        const withHostIds = (o, src) => {
            const d = src || data;
            const out = { ...o };
            if (d.host_index !== undefined && d.host_index !== null) out.host_index = d.host_index;
            if (d.host_id !== undefined && d.host_id !== null) out.host_id = d.host_id;
            return out;
        };

        // If node has all location data, return it
        if (data.hall && data.aisle && data.rack_num !== undefined) {
            return withHostIds({
                hall: data.hall,
                aisle: data.aisle,
                rack_num: this._normalizeRackNum(data.rack_num),
                shelf_u: data.shelf_u || null,
                hostname: data.hostname || null
            }, data);
        }

        // Otherwise, traverse up the parent hierarchy
        let current = node;
        while (current && current.length > 0) {
            const parent = current.parent();
            if (parent.length === 0) break;

            const parentData = parent.data();
            if (parentData.hall && parentData.aisle && parentData.rack_num !== undefined) {
                return withHostIds({
                    hall: parentData.hall,
                    aisle: parentData.aisle,
                    rack_num: this._normalizeRackNum(parentData.rack_num),
                    shelf_u: data.shelf_u || null,
                    hostname: data.hostname || null
                }, parentData);
            }

            current = parent;
        }

        // Fallback: return what we have
        return withHostIds({
            hall: data.hall || null,
            aisle: data.aisle || null,
            rack_num: this._normalizeRackNum(data.rack_num),
            shelf_u: data.shelf_u || null,
            hostname: data.hostname || null
        }, data);
    }

    /**
     * Build a stable key for location (hall, aisle, rack_num, hostname) for reverse lookup.
     * @private
     */
    _locationKey(location) {
        if (!location) return '';
        const hall = (location.hall ?? '').toString().trim();
        const aisle = (location.aisle ?? '').toString().trim();
        const rack = location.rack_num !== undefined && location.rack_num !== null ? Number(location.rack_num) : '';
        const hostname = (location.hostname ?? '').toString().trim();
        return `${hall}|${aisle}|${rack}|${hostname}`;
    }

    /**
     * Get racking info (location/hostname) for a given host_index or host_id.
     * Bi-directional association: host_index → location.
     * @param {number} hostIndexOrId - host_index or host_id
     * @returns {{ hall, aisle, rack_num, shelf_u, hostname } | null} Location data or null if no shelf has that host_index
     */
    getLocationByHostIndex(hostIndexOrId) {
        if (!this.state.cy || hostIndexOrId === undefined || hostIndexOrId === null) return null;
        const shelf = this.state.cy.nodes('[type="shelf"]').filter(
            (n) => (n.data('host_index') === hostIndexOrId || n.data('host_id') === hostIndexOrId)
        );
        if (shelf.length === 0) return null;
        return this.getNodeData(shelf[0]);
    }

    /**
     * Get host_index (or host_id) for a shelf at the given location.
     * Bi-directional association: location → host_index.
     * @param {Object} location - { hall?, aisle?, rack_num?, hostname? } (hostname alone is enough)
     * @returns {number | null} host_index or null if no shelf matches
     */
    getHostIndexByLocation(location) {
        if (!this.state.cy || !location) return null;
        const key = this._locationKey(location);
        if (!key) return null;
        const shelves = this.state.cy.nodes('[type="shelf"]');
        for (let i = 0; i < shelves.length; i++) {
            const shelf = shelves[i];
            const loc = this.getNodeData(shelf);
            if (this._locationKey(loc) === key) {
                return shelf.data('host_index') ?? shelf.data('host_id') ?? null;
            }
        }
        return null;
    }

    /**
     * Get host_index (or host_id) for a shelf with the given hostname.
     * Bi-directional association: hostname → host_index.
     * @param {string} hostname - hostname
     * @returns {number | null} host_index or null if no shelf has that hostname
     */
    getHostIndexByHostname(hostname) {
        if (!this.state.cy || hostname == null || String(hostname).trim() === '') return null;
        const h = String(hostname).trim();
        const shelf = this.state.cy.nodes('[type="shelf"]').filter((n) => (n.data('hostname') || '').toString().trim() === h);
        if (shelf.length === 0) return null;
        return shelf[0].data('host_index') ?? shelf[0].data('host_id') ?? null;
    }

    /**
     * Check if placing a shelf at (hall, aisle, rackNum, shelfU) with given nodeHeight would overlap
     * any other shelf in the same rack. Node occupies U [shelfU, shelfU + nodeHeight - 1].
     * @param {string} excludeNodeId - Node ID to exclude (the one being moved/edited)
     * @param {string} hall - Hall
     * @param {string} aisle - Aisle
     * @param {number} rackNum - Rack number
     * @param {number} shelfU - Starting U position
     * @param {number} nodeHeight - shelf_u_height (U slots occupied)
     * @returns {{ collision: boolean, otherLabel?: string }} collision true if overlap with another shelf; otherLabel for message
     */
    checkLocationCollision(excludeNodeId, hall, aisle, rackNum, shelfU, nodeHeight) {
        if (!this.state.cy || shelfU == null || nodeHeight == null || nodeHeight < 1) {
            return { collision: false };
        }
        const normRack = this._normalizeRackNum(rackNum);
        const hallStr = (hall ?? '').toString().trim();
        const aisleStr = (aisle ?? '').toString().trim();
        const myStart = Number(shelfU);
        const myEnd = myStart + Number(nodeHeight) - 1;

        const shelves = this.state.cy.nodes('[type="shelf"]');
        for (let i = 0; i < shelves.length; i++) {
            const s = shelves[i];
            if (s.id() === excludeNodeId) continue;
            const sHall = (s.data('hall') ?? '').toString().trim();
            const sAisle = (s.data('aisle') ?? '').toString().trim();
            const sRack = this._normalizeRackNum(s.data('rack_num'));
            if (sHall !== hallStr || sAisle !== aisleStr || sRack !== normRack) continue;

            const sU = s.data('shelf_u');
            if (sU === undefined || sU === null) continue;
            const sStart = Number(sU);
            const sHeight = getShelfUHeight(s.data('shelf_node_type') || 'WH_GALAXY');
            const sEnd = sStart + sHeight - 1;
            // Overlap: [myStart, myEnd] and [sStart, sEnd] overlap iff myStart <= sEnd && sStart <= myEnd
            if (myStart <= sEnd && sStart <= myEnd) {
                const otherLabel = s.data('label') || s.data('hostname') || s.id();
                return { collision: true, otherLabel };
            }
        }
        return { collision: false };
    }

    /**
     * Format rack number with padding
     * @private
     */
    _formatRackNum(rackNum) {
        return rackNum !== undefined && rackNum !== null ? rackNum.toString().padStart(2, '0') : '';
    }

    /**
     * Format shelf U number with padding
     * @private
     */
    _formatShelfU(shelfU) {
        return shelfU !== undefined && shelfU !== null ? shelfU.toString().padStart(2, '0') : '';
    }

    /**
     * Add a new node in location mode
     * @param {string} nodeType - Normalized node type
     * @param {Object} inputs - Input elements (hostname, hall, aisle, rack, shelfU)
     */
    /**
     * Add a new shelf node in location mode
     * 
     * **CRITICAL: host_index is REQUIRED** - All shelf nodes must have a unique host_index.
     * This function assigns host_index from globalHostCounter at creation time.
     * The host_index is the primary numeric identifier for programmatic access and descriptor mapping.
     * 
     * @param {string} nodeType - Node type (e.g., 'WH_GALAXY', 'N300_LB', etc.)
     * @param {Object} inputs - Input elements object containing:
     *   - {HTMLInputElement} hostnameInput - Hostname input field
     *   - {HTMLInputElement} hallInput - Hall input field
     *   - {HTMLInputElement} aisleInput - Aisle input field
     *   - {HTMLInputElement} rackInput - Rack input field
     *   - {HTMLInputElement} shelfUInput - Shelf U input field
     */
    addNode(nodeType, inputs) {
        // Block node creation in location mode if session started in hierarchy mode
        if (this.state.data.initialMode === 'hierarchy') {
            const errorMsg = 'Cannot add nodes in location mode. This session started in hierarchy mode (from descriptor import or empty topology canvas). ' +
                'Node additions are only allowed in hierarchy mode. Please switch to hierarchy mode to add nodes.';
            alert(errorMsg);
            console.error('[Location.addNode] Blocked: Session started in hierarchy mode');
            if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                window.showExportStatus(errorMsg, 'error');
            }
            return;
        }

        const { hostnameInput, hallInput, aisleInput, rackInput, shelfUInput } = inputs;

        // Physical location mode: validate location/hostname inputs
        const hostname = hostnameInput.value.trim();
        const hall = hallInput.value.trim();
        const aisle = aisleInput.value.trim();
        const rack = parseInt(rackInput.value) || 0;
        const shelfU = parseInt(shelfUInput.value) || 0;

        // Validation: Either hostname OR all location fields must be filled
        const hasHostname = hostname.length > 0;
        const hasLocation = hall.length > 0 && aisle.length > 0 && rack > 0 && shelfU > 0;

        if (!hasHostname && !hasLocation) {
            console.warn('Please enter either a hostname OR all location fields (Hall, Aisle, Rack, Shelf U).');
            if (!hostname) hostnameInput.focus();
            return;
        }

        // Allow both hostname and location to be filled - hostname takes precedence for label

        // Validate hostname uniqueness at creation time
        if (hasHostname) {
            if (!this.common.validateShelfIdentifierUniqueness(hostname)) {
                const errorMsg = `Hostname "${hostname}" is already in use. Each shelf must have a unique hostname.`;
                alert(errorMsg);
                console.error(`[Location.addNode] ${errorMsg}`);
                hostnameInput.focus();
                if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                    window.showExportStatus(errorMsg, 'error');
                }
                return;
            }
        } else {
            // Check for U-range collision in this rack (node occupies shelf_u .. shelf_u + height - 1)
            const nodeHeight = getShelfUHeight(nodeType);
            const result = this.checkLocationCollision(null, hall, aisle, rack, shelfU, nodeHeight);
            if (result.collision) {
                const msg = result.otherLabel
                    ? `Shelf U ${shelfU}–${shelfU + nodeHeight - 1} would overlap with "${result.otherLabel}" in this rack. Choose a different position.`
                    : `Shelf U ${shelfU}–${shelfU + nodeHeight - 1} would overlap another shelf in this rack. Choose a different position.`;
                if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                    window.showExportStatus(msg, 'error');
                }
                alert(msg);
                return;
            }
        }

        // getNodeConfig normalizes internally for config lookup, but we preserve the full nodeType
        // (including variations like _DEFAULT, _X_TORUS, etc.) for storage in shelf_node_type
        const config = getNodeConfig(nodeType);
        if (!config) {
            console.error(`Unknown node type: ${nodeType}`);
            return;
        }

        // If location data is provided, ensure hall/aisle/rack hierarchy exists
        let rackParentId = null;
        if (hasLocation) {
            // When adding nodes manually with location data, always create hall/aisle containers
            // if they're provided, regardless of existing data (user explicitly wants them)
            // Only use _shouldShowHallsAndAisles() for layout calculations, not for manual node addition
            const forceShowHalls = hall && hall.length > 0;
            const forceShowAisles = aisle && aisle.length > 0;

            const { rackNode } = this._findOrCreateLocationNodes(
                { hall, aisle, rackNum: rack },
                { shouldShowHalls: forceShowHalls, shouldShowAisles: forceShowAisles }
            );

            if (rackNode) {
                rackParentId = rackNode.id();
            }
        }

        // Find a good position for the new node
        let newX, newY;

        if (rackParentId) {
            // Position shelf within the rack
            const rackNode = this.state.cy.getElementById(rackParentId);
            const rackPos = rackNode.position();

            // Get existing shelves in this rack to determine vertical position
            const shelvesInRack = rackNode.children('[type="shelf"]');
            const shelfCount = shelvesInRack.length;
            const shelfSpacing = 140;

            newX = rackPos.x;
            newY = rackPos.y - (shelfCount * shelfSpacing / 2); // Position based on shelf count
        } else {
            // 8-column format or no rack - position to the right of existing shelves
            const existingShelves = this.state.cy.nodes('.shelf');
            let maxX = 0;
            existingShelves.forEach(shelf => {
                const pos = shelf.position();
                if (pos.x > maxX) maxX = pos.x;
            });
            newX = maxX + 500;
            newY = 200;
        }

        // Create shelf node using descriptor format
        // Shelf ID is the host_index (numeric), but label shows hostname or location
        const hostIndex = this.state.data.globalHostCounter++;
        const shelfId = String(hostIndex);  // Descriptor format: numeric ID as string
        let nodeLabel, nodeData;

        if (hasHostname) {
            // Validate hostname uniqueness at creation time
            if (!this.common.validateShelfIdentifierUniqueness(hostname)) {
                const errorMsg = `Hostname "${hostname}" is already in use. Each shelf must have a unique hostname.`;
                alert(errorMsg);
                console.error(`[Location.addNode] ${errorMsg}`);
                if (window.showExportStatus && typeof window.showExportStatus === 'function') {
                    window.showExportStatus(errorMsg, 'error');
                }
                return;
            }

            // Use location mode format: "Shelf {shelf_u} ({host_index}: hostname)"
            if (shelfU > 0) {
                nodeLabel = `Shelf ${shelfU} (${hostIndex}: ${hostname})`;
            } else {
                // Fallback if no shelf U: use hostname with host_index
                nodeLabel = `${hostname} (${hostIndex})`;
            }
            nodeData = {
                id: shelfId,
                label: nodeLabel,
                type: 'shelf',
                hostname: hostname,
                host_index: hostIndex,
                shelf_node_type: nodeType
            };

            // Add location data if provided
            if (hasLocation) {
                nodeData.hall = hall;
                nodeData.aisle = aisle;
                nodeData.rack_num = rack;
                nodeData.shelf_u = shelfU;
            }
        } else {
            // Use location mode format: "Shelf {shelf_u} ({host_index})"
            if (shelfU > 0) {
                nodeLabel = `Shelf ${shelfU} (${hostIndex})`;
            } else {
                // Fallback if no shelf U: use host_index only
                nodeLabel = `${hostIndex}`;
            }
            nodeData = {
                id: shelfId,
                label: nodeLabel,
                type: 'shelf',
                hall: hall,
                aisle: aisle,
                rack_num: rack,
                shelf_u: shelfU,
                host_index: hostIndex,
                shelf_node_type: nodeType
            };
        }

        // Add parent rack if it exists
        if (rackParentId) {
            nodeData.parent = rackParentId;
        }

        const shelfNode = {
            data: nodeData,
            position: { x: newX, y: newY },
            classes: 'shelf'
        };

        const nodesToAdd = [shelfNode];

        // Create trays and ports using factory
        const location = {};
        if (hasLocation) {
            location.hall = hall;
            location.aisle = aisle;
            location.rack_num = rack;
            location.shelf_u = shelfU;
        }
        if (hasHostname) {
            location.hostname = hostname;
        }

        const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(shelfId, hostIndex, nodeType, location);
        nodesToAdd.push(...trayPortNodes);

        // Batch node additions for better performance
        this.state.cy.startBatch();

        // Add all nodes to cytoscape
        this.state.cy.add(nodesToAdd);

        this.state.cy.endBatch();

        // Arrange trays and ports for the newly added shelf
        const addedShelf = this.state.cy.getElementById(shelfId);
        if (addedShelf && addedShelf.length > 0) {
            this.common.arrangeTraysAndPorts(addedShelf);

            // Create internal connections for node type variations (DEFAULT, X_TORUS, Y_TORUS, XY_TORUS)
            // This handles connections like QSFP connections in DEFAULT variants and torus connections
            this.common.createInternalConnectionsForNode(shelfId, nodeType, hostIndex);
        }

        // Apply drag restrictions
        this.common.applyDragRestrictions();

        // Apply styling and layout
        setTimeout(() => {
            this.common.forceApplyCurveStyles();
            window.updatePortConnectionStatus?.();
            window.updatePortEditingHighlight?.(); // Highlight available ports if in editing mode
        }, 100);

        // Clear all inputs
        hostnameInput.value = '';
        hallInput.value = '';
        aisleInput.value = '';
        rackInput.value = '';
        shelfUInput.value = '';

        // Log success message
        const nodeDescription = hasHostname ? `"${hostname}"` : `"${this.buildLabel(hall, aisle, rack, shelfU)}"`;
        const locationInfo = hasHostname && hasLocation ? ` (with location: ${this.buildLabel(hall, aisle, rack, shelfU)})` : '';
        console.log(`Successfully added ${nodeType} node ${nodeDescription}${locationInfo} with ${config.tray_count} trays (host_index=${hostIndex}).`);

        // Update node filter dropdown to include the new node
        window.populateNodeFilterDropdown?.();
    }

    /**
     * Get the first selected shelf node (from Cytoscape selection or from a selected port/tray).
     * @returns {Object|null} First selected shelf or null
     */
    _getFirstSelectedShelf() {
        if (!this.state.cy) return null;
        const selected = this.state.cy.nodes(':selected');
        for (let i = 0; i < selected.length; i++) {
            const node = selected[i];
            if (node.data('type') === 'shelf') return node;
            let parent = node.parent();
            while (parent && parent.length > 0) {
                if (parent.data('type') === 'shelf') return parent;
                parent = parent.parent();
            }
        }
        return null;
    }

    /**
     * Get paste destination from current selection: first selected node that is a location
     * container (hall, aisle, rack, shelf). Used to show only sub-property inputs in paste modal.
     * @returns {{ type: string, hall?: string, aisle?: string, rack_num?: number, label?: string }|null}
     */
    getPasteDestinationFromSelection() {
        if (!this.state.cy) return null;
        const selected = this.state.cy.nodes(':selected');
        for (let i = 0; i < selected.length; i++) {
            const node = selected[i];
            const type = node.data('type');
            if (type === 'hall') {
                return {
                    type: 'hall',
                    hall: node.data('hall') || node.data('label') || '',
                    label: node.data('label') || `Hall ${node.data('hall') || ''}`
                };
            }
            if (type === 'aisle') {
                return {
                    type: 'aisle',
                    hall: node.data('hall') || '',
                    aisle: node.data('aisle') || node.data('label') || '',
                    label: node.data('label') || `Aisle ${node.data('aisle') || ''}`
                };
            }
            if (type === 'rack') {
                return {
                    type: 'rack',
                    hall: node.data('hall') || '',
                    aisle: node.data('aisle') || '',
                    rack_num: this._normalizeRackNum(node.data('rack_num')),
                    label: node.data('label') || `Rack ${node.data('rack_num') ?? ''}`
                };
            }
            if (type === 'shelf') {
                return {
                    type: 'shelf',
                    hall: node.data('hall') || '',
                    aisle: node.data('aisle') || '',
                    rack_num: this._normalizeRackNum(node.data('rack_num')),
                    label: node.data('label') || node.id()
                };
            }
        }
        return { type: 'canvas', label: 'Canvas (no destination selected)' };
    }

    /**
     * Paste clipboard content in location mode. If destination is provided (from paste modal),
     * uses that hall/aisle/rack and shelf_u_list, or shelf_assignments (per-shelf rack_num + shelf_u).
     * @param {Object} [destination] - Optional { hall, aisle, rack_num, shelf_u_list } or { shelf_assignments: [{ rack_num, shelf_u }, ...] }
     * @returns {{ success: boolean, message?: string }}
     */
    pasteFromClipboard(destination = null) {
        const clipboard = this.state.clipboard;
        if (!clipboard || clipboard.mode !== 'location' || !clipboard.shelves || clipboard.shelves.length === 0) {
            return { success: false, message: 'Nothing to paste. Copy shelves first (location mode).' };
        }

        if (this.state.data.initialMode === 'hierarchy') {
            return { success: false, message: 'Cannot paste in location mode when session started in hierarchy mode.' };
        }

        const firstClipboardShelf = clipboard.shelves[0];
        let hall, aisle, rackNum;
        let shelfUList = null;
        const shelfAssignments = destination && destination.shelf_assignments && destination.shelf_assignments.length >= clipboard.shelves.length
            ? destination.shelf_assignments
            : null;

        if (destination && (destination.hall !== undefined || destination.aisle !== undefined || destination.rack_num != null)) {
            // Use clipboard hall/aisle when destination has empty string so we target the same location hierarchy
            // (e.g. paste into "Rack 3" with empty modal fields still uses SC_Floor_5 / A and finds rack_SC_Floor_5_A_3)
            hall = (destination.hall != null && destination.hall !== '') ? destination.hall : (firstClipboardShelf.hall || '');
            aisle = (destination.aisle != null && destination.aisle !== '') ? destination.aisle : (firstClipboardShelf.aisle || '');
            rackNum = destination.rack_num != null ? this._normalizeRackNum(destination.rack_num) : (firstClipboardShelf.rack_num != null ? this._normalizeRackNum(firstClipboardShelf.rack_num) : 1);
            if (!shelfAssignments) {
                shelfUList = destination.shelf_u_list && destination.shelf_u_list.length > 0 ? destination.shelf_u_list : null;
            }
        } else {
            const firstSelectedShelf = this._getFirstSelectedShelf();
            hall = (firstSelectedShelf && firstSelectedShelf.data('hall')) || firstClipboardShelf.hall || '';
            aisle = (firstSelectedShelf && firstSelectedShelf.data('aisle')) || firstClipboardShelf.aisle || '';
            rackNum = (firstSelectedShelf && firstSelectedShelf.data('rack_num')) != null
                ? this._normalizeRackNum(firstSelectedShelf.data('rack_num'))
                : (firstClipboardShelf.rack_num != null ? this._normalizeRackNum(firstClipboardShelf.rack_num) : 1);
        }

        const forceShowHalls = hall.length > 0;
        const forceShowAisles = aisle.length > 0;
        const shelfSpacing = 140;

        // Ensure we never reuse an existing shelf id: paste must create new nodes, not replace originals.
        // Sync globalHostCounter so the next id is above any existing shelf (by id or host_index).
        const existingShelves = this.state.cy.nodes('[type="shelf"]');
        let maxExistingShelfIndex = -1;
        existingShelves.forEach((shelf) => {
            const hi = shelf.data('host_index');
            const idNum = parseInt(shelf.id(), 10);
            const n = (typeof hi === 'number' && !isNaN(hi)) ? hi : (Number.isInteger(idNum) ? idNum : -1);
            if (n > maxExistingShelfIndex) maxExistingShelfIndex = n;
        });
        const nextFree = maxExistingShelfIndex + 1;
        if (this.state.data.globalHostCounter < nextFree) {
            this.state.data.globalHostCounter = nextFree;
        }

        let singleRackParentId = null;
        let singleRackBaseX = 300;
        let singleRackBaseY = 200;
        let singleRackNextShelfU = 1;
        if (!shelfAssignments) {
            const { rackNode } = this._findOrCreateLocationNodes(
                { hall, aisle, rackNum },
                { shouldShowHalls: forceShowHalls, shouldShowAisles: forceShowAisles }
            );
            if (rackNode && rackNode.length > 0) {
                singleRackParentId = rackNode.id();
                const shelvesInRack = rackNode.children('[type="shelf"]');
                shelvesInRack.forEach((s) => {
                    const u = s.data('shelf_u');
                    if (u != null && u >= singleRackNextShelfU) singleRackNextShelfU = u + 1;
                });
                const rackPos = rackNode.position();
                singleRackBaseX = rackPos.x;
                singleRackBaseY = rackPos.y - (shelvesInRack.length * shelfSpacing / 2);
            }
        }

        const newShelfIdsByIndex = [];
        /** When using shelfAssignments, precompute base position and next slot per rack so all pasted shelves in one rack use a consistent baseY. Key uses string rack num so lookups never fail due to number vs string. */
        const rackPasteStateByKey = new Map();
        const rackKeyString = (rNum) => {
            const n = this._normalizeRackNum(rNum);
            return `${hall}\0${aisle}\0${n != null ? String(n) : ''}`;
        };
        if (shelfAssignments && shelfAssignments.length > 0) {
            const pastedCountByRack = new Map();
            for (let idx = 0; idx < shelfAssignments.length; idx++) {
                const rNum = shelfAssignments[idx].rack_num;
                const key = rackKeyString(rNum);
                if (key) pastedCountByRack.set(key, (pastedCountByRack.get(key) || 0) + 1);
            }
            pastedCountByRack.forEach((pastedCount, key) => {
                const parts = key.split('\0');
                const rNumPart = parts[2];
                const rNum = rNumPart !== '' ? (parseInt(rNumPart, 10) || null) : null;
                if (rNum == null) return;
                const { rackNode } = this._findOrCreateLocationNodes(
                    { hall, aisle, rackNum: rNum },
                    { shouldShowHalls: forceShowHalls, shouldShowAisles: forceShowAisles }
                );
                if (rackNode && rackNode.length > 0) {
                    const shelvesInRack = rackNode.children('[type="shelf"]');
                    const existingCount = shelvesInRack.length;
                    const totalCount = existingCount + pastedCount;
                    const rackPos = rackNode.position();
                    const baseY = rackPos.y - (totalCount - 1) * (shelfSpacing / 2);
                    rackPasteStateByKey.set(key, {
                        rackParentId: rackNode.id(),
                        baseX: rackPos.x,
                        baseY,
                        nextSlotIndex: existingCount
                    });
                }
            });
        }

        this.state.cy.startBatch();

        for (let i = 0; i < clipboard.shelves.length; i++) {
            const sh = clipboard.shelves[i];
            let thisRackNum = rackNum;
            let thisShelfU;
            let rackParentId = null;
            let baseX = 300;
            let baseY = 200;
            let slotIndexInRack = i;

            if (shelfAssignments) {
                thisRackNum = this._normalizeRackNum(shelfAssignments[i].rack_num);
                thisShelfU = shelfAssignments[i].shelf_u;
                const key = rackKeyString(thisRackNum);
                let rackState = key ? rackPasteStateByKey.get(key) : undefined;
                if (!rackState && thisRackNum != null) {
                    const { rackNode } = this._findOrCreateLocationNodes(
                        { hall, aisle, rackNum: thisRackNum },
                        { shouldShowHalls: forceShowHalls, shouldShowAisles: forceShowAisles }
                    );
                    if (rackNode && rackNode.length > 0) {
                        const shelvesInRack = rackNode.children('[type="shelf"]');
                        const existingCount = shelvesInRack.length;
                        const rackPos = rackNode.position();
                        const baseYVal = rackPos.y - (existingCount - 1) * (shelfSpacing / 2);
                        rackState = {
                            rackParentId: rackNode.id(),
                            baseX: rackPos.x,
                            baseY: baseYVal,
                            nextSlotIndex: existingCount
                        };
                        if (key) rackPasteStateByKey.set(key, rackState);
                    }
                }
                if (rackState) {
                    rackParentId = rackState.rackParentId;
                    baseX = rackState.baseX;
                    baseY = rackState.baseY;
                    slotIndexInRack = rackState.nextSlotIndex;
                    rackState.nextSlotIndex += 1;
                }
            } else {
                thisRackNum = rackNum;
                thisShelfU = shelfUList && shelfUList[i] != null ? shelfUList[i] : (singleRackNextShelfU + i);
                rackParentId = singleRackParentId;
                baseX = singleRackBaseX;
                baseY = singleRackBaseY;
                slotIndexInRack = i;
            }

            const hostIndex = this.state.data.globalHostCounter++;
            const shelfId = String(hostIndex);
            const hostname = sh.hostname || `host_${hostIndex}`;
            const nodeLabel = `Shelf ${thisShelfU} (${hostIndex}: ${hostname})`;

            const nodeData = {
                id: shelfId,
                label: nodeLabel,
                type: 'shelf',
                host_index: hostIndex,
                shelf_node_type: sh.shelf_node_type || 'WH_GALAXY',
                hall,
                aisle,
                rack_num: thisRackNum,
                shelf_u: thisShelfU,
                hostname: hostname
            };
            if (rackParentId) nodeData.parent = rackParentId;

            const newX = baseX;
            const newY = baseY - slotIndexInRack * shelfSpacing;

            const shelfNode = {
                data: nodeData,
                position: { x: newX, y: newY },
                classes: 'shelf'
            };

            const location = { hall, aisle, rack_num: thisRackNum, shelf_u: thisShelfU, hostname: hostname };
            const trayPortNodes = this.common.nodeFactory.createTraysAndPorts(shelfId, hostIndex, sh.shelf_node_type || 'WH_GALAXY', location);
            const nodesToAdd = [shelfNode, ...trayPortNodes];
            this.state.cy.add(nodesToAdd);

            const addedShelf = this.state.cy.getElementById(shelfId);
            if (addedShelf && addedShelf.length > 0) {
                this.common.arrangeTraysAndPorts(addedShelf);
                this.common.createInternalConnectionsForNode(shelfId, sh.shelf_node_type || 'WH_GALAXY', hostIndex);
            }

            newShelfIdsByIndex.push(shelfId);
        }

        this.state.cy.endBatch();

        clipboard.connections.forEach((conn) => {
            const srcShelfId = newShelfIdsByIndex[conn.source.shelfIndex];
            const tgtShelfId = newShelfIdsByIndex[conn.target.shelfIndex];
            if (!srcShelfId || !tgtShelfId) return;
            const sourcePortId = `${srcShelfId}:t${conn.source.tray}:p${conn.source.port}`;
            const targetPortId = `${tgtShelfId}:t${conn.target.tray}:p${conn.target.port}`;
            const sourcePort = this.state.cy.getElementById(sourcePortId);
            const targetPort = this.state.cy.getElementById(targetPortId);
            if (sourcePort.length > 0 && targetPort.length > 0) {
                this.common.createSingleConnection(sourcePort, targetPort, null, 0);
            }
        });

        this.common.applyDragRestrictions();
        if (this.common.recalculateHostIndices && typeof this.common.recalculateHostIndices === 'function') {
            this.common.recalculateHostIndices();
        }
        setTimeout(() => {
            this.common.forceApplyCurveStyles?.();
            window.updatePortConnectionStatus?.();
            window.updatePortEditingHighlight?.();
        }, 100);
        window.populateNodeFilterDropdown?.();

        return {
            success: true,
            message: `Pasted ${clipboard.shelves.length} shelf(s) and ${clipboard.connections.length} connection(s).`
        };
    }

    /**
     * Organize nodes in a simple grid when no location info is available
     */
    organizeInGrid() {
        if (!this.state.cy) return;

        const shelfNodes = this.state.cy.nodes('[type="shelf"]');
        const cols = 3;
        const spacing = 500;
        const startX = 300;
        const startY = 300;

        shelfNodes.forEach((node, idx) => {
            // Remove from any parent
            node.move({ parent: null });

            // Position in grid
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            node.position({
                x: startX + col * spacing,
                y: startY + row * spacing
            });
        });

        // Fit view to show all nodes
        this.state.cy.fit(null, 50);
    }

    /**
     * Get racking hierarchy filter checkbox values
     * @returns {Object} Object with boolean values for each filter checkbox
     */
    getRackingHierarchyFilterValues() {
        return {
            showSameHostId: document.getElementById('showSameHostIdConnections')?.checked ?? true,
            showSameRack: document.getElementById('showSameRackConnections')?.checked ?? true,
            showSameAisle: document.getElementById('showSameAisleConnections')?.checked ?? true,
            showSameHall: document.getElementById('showSameHallConnections')?.checked ?? true,
            showDifferentHall: document.getElementById('showDifferentHallConnections')?.checked ?? true
        };
    }

    /**
     * Reset racking hierarchy filter checkboxes to default (all checked)
     */
    resetRackingHierarchyFilters() {
        const showSameHostId = document.getElementById('showSameHostIdConnections');
        const showSameRack = document.getElementById('showSameRackConnections');
        const showSameAisle = document.getElementById('showSameAisleConnections');
        const showSameHall = document.getElementById('showSameHallConnections');
        const showDifferentHall = document.getElementById('showDifferentHallConnections');

        if (showSameHostId) showSameHostId.checked = true;
        if (showSameRack) showSameRack.checked = true;
        if (showSameAisle) showSameAisle.checked = true;
        if (showSameHall) showSameHall.checked = true;
        if (showDifferentHall) showDifferentHall.checked = true;
    }

    /**
     * Add event handlers for connection type checkboxes
     * These filters are only used in location/physical mode
     */
    addConnectionTypeEventHandlers() {
        // Only attach handlers if we're in location mode
        if (this.state.mode !== 'location') {
            return;
        }

        // Add event listeners to connection type checkboxes
        const checkboxes = [
            'showSameHostIdConnections',
            'showSameRackConnections',
            'showSameAisleConnections',
            'showSameHallConnections',
            'showDifferentHallConnections'
        ];

        checkboxes.forEach((checkboxId) => {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                // Remove existing listeners to avoid duplicates
                const newCheckbox = checkbox.cloneNode(true);
                checkbox.parentNode.replaceChild(newCheckbox, checkbox);

                newCheckbox.addEventListener('change', () => {
                    // Apply connection type filter when checkbox changes
                    window.applyConnectionTypeFilter?.();
                });
            }
        });
    }

    /**
     * Save shelf edit - updates location fields (hostname, hall, aisle, rack, shelf_u)
     * @param {string} nodeId - The ID of the shelf node
     */
    saveShelfEdit(nodeId) {
        const hostnameInput = document.getElementById('hostnameEditInput');
        const hallInput = document.getElementById('hallEditInput');
        const aisleInput = document.getElementById('aisleEditInput');
        const rackInput = document.getElementById('rackEditInput');
        const shelfUInput = document.getElementById('shelfUEditInput');

        const newHostname = hostnameInput ? hostnameInput.value.trim() : '';
        // Location inputs may not exist in hierarchy mode
        const newHall = hallInput ? hallInput.value.trim() : '';
        const newAisle = aisleInput ? aisleInput.value.trim() : '';
        const newRack = rackInput && rackInput.value ? parseInt(rackInput.value) : undefined;
        const newShelfU = shelfUInput && shelfUInput.value ? parseInt(shelfUInput.value) : undefined;

        // Get the node to check for changes
        const node = this.state.cy.getElementById(nodeId);
        if (!node || node.length === 0) {
            console.error(`Node ${nodeId} not found`);
            return;
        }

        const oldHostname = node.data('hostname') || '';
        const oldHall = node.data('hall') || '';
        const oldAisle = node.data('aisle') || '';
        const oldRack = this._normalizeRackNum(node.data('rack_num'));
        const oldShelfU = node.data('shelf_u');

        // Check if at least one field has changed
        const hostnameChanged = newHostname !== oldHostname;
        const hallChanged = newHall !== oldHall;
        const aisleChanged = newAisle !== oldAisle;
        const rackChanged = newRack !== oldRack && newRack !== undefined;
        const shelfUChanged = newShelfU !== oldShelfU && newShelfU !== undefined;

        if (!hostnameChanged && !hallChanged && !aisleChanged && !rackChanged && !shelfUChanged) {
            alert('No changes detected. Please modify at least one field.');
            return;
        }

        // Validate hostname uniqueness at edit time (if hostname changed)
        if (hostnameChanged && newHostname) {
            if (!this.common.validateShelfIdentifierUniqueness(newHostname, nodeId)) {
                alert(`Hostname "${newHostname}" already exists on another shelf. Each shelf must have a unique hostname.`);
                return;
            }
        }

        // If location is being changed, check for U-range collision in the target rack
        const effectiveHall = hallChanged ? newHall : oldHall;
        const effectiveAisle = aisleChanged ? newAisle : oldAisle;
        const effectiveRack = rackChanged ? newRack : oldRack;
        const effectiveShelfU = shelfUChanged ? newShelfU : oldShelfU;
        if ((hallChanged || aisleChanged || rackChanged || shelfUChanged) &&
            effectiveHall !== undefined && effectiveRack !== undefined && effectiveShelfU !== undefined) {
            const nodeType = node.data('shelf_node_type') || 'WH_GALAXY';
            const nodeHeight = getShelfUHeight(nodeType);
            const result = this.checkLocationCollision(
                nodeId, effectiveHall, effectiveAisle, effectiveRack, effectiveShelfU, nodeHeight
            );
            if (result.collision) {
                const msg = result.otherLabel
                    ? `Shelf U ${effectiveShelfU}–${effectiveShelfU + nodeHeight - 1} would overlap with "${result.otherLabel}" in this rack. Choose a different position.`
                    : `Shelf U ${effectiveShelfU}–${effectiveShelfU + nodeHeight - 1} would overlap another shelf in this rack. Choose a different position.`;
                alert(msg);
                return;
            }
        }

        // Update the node data only with changed values
        if (hostnameChanged) {
            this.common.updateNodeAndDescendants(node, 'hostname', newHostname);

            // CRITICAL FIX: Update edge data for all connections from this shelf's ports
            // This ensures exports use the updated hostname instead of stale edge data
            node.descendants('[type="port"]').forEach((portNode) => {
                // Update all edges connected to this port
                portNode.connectedEdges().forEach((edge) => {
                    const sourceId = edge.data('source');
                    const targetId = edge.data('target');

                    // Update source_hostname if this port is the source
                    if (sourceId === portNode.id()) {
                        edge.data('source_hostname', newHostname);
                    }

                    // Update destination_hostname if this port is the target
                    if (targetId === portNode.id()) {
                        edge.data('destination_hostname', newHostname);
                    }
                });
            });
        }
        if (hallChanged) {
            this.common.updateNodeAndDescendants(node, 'hall', newHall);
        }
        if (aisleChanged) {
            this.common.updateNodeAndDescendants(node, 'aisle', newAisle);
        }
        if (rackChanged) {
            this.common.updateNodeAndDescendants(node, 'rack_num', newRack);
        }
        if (shelfUChanged) {
            this.common.updateNodeAndDescendants(node, 'shelf_u', newShelfU);
        }

        // Update the node label - use the current state of the node after updates
        let newLabel;
        const currentHostname = node.data('hostname') || '';
        const currentHall = node.data('hall') || '';
        const currentAisle = node.data('aisle') || '';
        const currentRack = this._normalizeRackNum(node.data('rack_num'));
        const currentShelfU = node.data('shelf_u');

        // In location mode, format label as: "Shelf {shelf_u} ({host_index}: hostname)"
        const currentHostIndex = node.data('host_index') ?? node.data('host_id');

        if (currentShelfU !== undefined && currentShelfU !== null && currentShelfU !== '') {
            if (currentHostIndex !== undefined && currentHostIndex !== null) {
                if (currentHostname) {
                    newLabel = `Shelf ${currentShelfU} (${currentHostIndex}: ${currentHostname})`;
                } else {
                    newLabel = `Shelf ${currentShelfU} (${currentHostIndex})`;
                }
            } else if (currentHostname) {
                newLabel = `Shelf ${currentShelfU} (${currentHostname})`;
            } else {
                newLabel = `Shelf ${currentShelfU}`;
            }
        } else if (currentHostname && currentHostIndex !== undefined && currentHostIndex !== null) {
            // Fallback: no shelf U, use hostname with host_index
            newLabel = `${currentHostname} (${currentHostIndex})`;
        } else if (currentHostname) {
            newLabel = currentHostname;
        } else if (currentHostIndex !== undefined && currentHostIndex !== null) {
            newLabel = `${currentHostIndex}`;
        } else {
            newLabel = node.data('label'); // Keep existing label
        }
        node.data('label', newLabel);

        // Update node filter dropdown since label/hostname may have changed
        window.populateNodeFilterDropdown?.();

        // Handle rack change - move shelf to new rack if rack number changed
        const parent = node.parent();
        if (rackChanged && currentRack !== undefined) {
            // Use consolidated helper to find or create location nodes with proper hierarchy
            const { shouldShowHalls, shouldShowAisles } = this._shouldShowHallsAndAisles();
            const { rackNode: newRackNode } = this._findOrCreateLocationNodes(
                { hall: currentHall, aisle: currentAisle, rackNum: currentRack },
                { shouldShowHalls, shouldShowAisles }
            );

            if (newRackNode) {
                // Move the shelf node to the new rack
                node.move({ parent: newRackNode.id() });

                // Recalculate host_indices after node move (treating canvas as root)
                // This ensures unique, consecutive host_index values across all shelf nodes
                if (this.common && this.common.recalculateHostIndices && typeof this.common.recalculateHostIndices === 'function') {
                    this.common.recalculateHostIndices();
                }
            }

            // Update all child nodes (trays and ports) with the new rack_num
            node.descendants().forEach((child) => {
                if (rackChanged) child.data('rack_num', currentRack);
                if (hallChanged && currentHall) child.data('hall', currentHall);
                if (aisleChanged && currentAisle) child.data('aisle', currentAisle);
            });
        } else if (parent && parent.length > 0 && parent.data('type') === 'rack') {
            // Just update parent rack label if hall/aisle changed (but not rack number)
            if (hallChanged || aisleChanged) {
                const rackNum = this._normalizeRackNum(node.data('rack_num'));
                const hall = node.data('hall');
                const aisle = node.data('aisle');

                if (hall && aisle && rackNum !== null && rackNum !== undefined) {
                    parent.data('label', `Rack ${rackNum} (${hall}-${aisle})`);
                    parent.data('hall', hall);
                    parent.data('aisle', aisle);
                }

                // Update all child nodes (trays and ports) with the new hall/aisle
                node.descendants().forEach((child) => {
                    if (hallChanged && currentHall) child.data('hall', currentHall);
                    if (aisleChanged && currentAisle) child.data('aisle', currentAisle);
                });
            }
        }

        // Close dialog and clear selections
        if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
            window.clearAllSelections();
        }

        // Recolor connections after location changes (in location mode)
        const mode = this.state.mode;
        if (mode === 'location' && (hallChanged || aisleChanged || rackChanged)) {
            this.recolorConnections();
        }

        // If rack, shelf_u, or hall/aisle changed in location mode, reset layout so the location hierarchy
        // is rebuilt: new aisle/hall compounds are created, racks reparented, and empty compounds removed.
        // In hierarchy mode, location changes don't affect the visualization layout.
        if ((rackChanged || shelfUChanged || hallChanged || aisleChanged) && mode === 'location') {
            setTimeout(() => {
                window.resetLayout?.();
            }, 100);
        } else {
            window.showExportStatus?.('Shelf node updated successfully', 'success');
        }
    }

    /**
     * Helper function to cleanup editing dialog (remove click handler and close dialog)
     */
    cleanupEditingDialog() {
        // Clear isEditing flag on all nodes
        if (this.state.cy) {
            this.state.cy.nodes().forEach((n) => {
                if (n.data('isEditing') === true) {
                    n.data('isEditing', false);
                }
            });
        }

        // Hide the dialog
        window.hideNodeInfo?.();
    }

    /**
     * Cancel shelf editing - clears editing flags
     */
    cancelShelfEdit() {
        this.cleanupEditingDialog();
    }

    /**
     * Enable hall editing UI - allows editing hall property for all contained nodes
     * @param {Object} node - The hall node to edit
     * @param {Object} position - Position for the popup
     */
    enableHallEditing(node, _position) {
        const data = node.data();
        const isEditingModeEnabled = this.state.editing.isEdgeCreationMode;

        let contentHtml = `Label: ${data.label || data.id}<br><br>`;

        if (isEditingModeEnabled) {
            contentHtml += `<div style="margin-bottom: 10px;">`;
            contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hall:</label>`;
            contentHtml += `<input type="text" id="hallEditInput" value="${data.hall || ''}" placeholder="Enter hall" style="width: 200px; padding: 5px;">`;
            contentHtml += `</div>`;
            contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 12px;">Changing the hall will update all aisles, racks, shelves, and their descendants within this hall.</p>`;
            contentHtml += `<br>`;
            contentHtml += `<button onclick="saveHallEdit('${node.id()}')" style="background: #007bff; color: white; border: none; padding: 8px 15px; margin-right: 5px; cursor: pointer;">Save</button>`;
            contentHtml += `<button onclick="clearAllSelections()" style="background: #6c757d; color: white; border: none; padding: 8px 15px; cursor: pointer;">Cancel</button>`;
        } else {
            contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px;">Editing mode must be enabled to edit hall information.</p>`;
        }

        // Use common dialog interface
        this.common.showEditingDialog({
            node: node,
            title: 'Edit Hall Node',
            contentHtml: contentHtml,
            focusElementId: isEditingModeEnabled ? 'hallEditInput' : null
        });
    }

    /**
     * Enable aisle editing UI - allows editing hall and aisle properties for all contained nodes
     * @param {Object} node - The aisle node to edit
     * @param {Object} position - Position for the popup
     */
    enableAisleEditing(node, _position) {
        const data = node.data();
        const isEditingModeEnabled = this.state.editing.isEdgeCreationMode;

        let contentHtml = `Label: ${data.label || data.id}<br><br>`;

        if (isEditingModeEnabled) {
            contentHtml += `<div style="margin-bottom: 10px;">`;
            contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hall:</label>`;
            contentHtml += `<input type="text" id="hallEditInput" value="${data.hall || ''}" placeholder="Enter hall" style="width: 200px; padding: 5px;">`;
            contentHtml += `</div>`;

            contentHtml += `<div style="margin-bottom: 10px;">`;
            contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Aisle:</label>`;
            contentHtml += `<input type="text" id="aisleEditInput" value="${data.aisle || ''}" placeholder="Enter aisle" style="width: 200px; padding: 5px;">`;
            contentHtml += `</div>`;

            contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 12px;">Changing the hall/aisle will update all racks, shelves, and their descendants within this aisle.</p>`;
            contentHtml += `<br>`;
            contentHtml += `<button onclick="saveAisleEdit('${node.id()}')" style="background: #007bff; color: white; border: none; padding: 8px 15px; margin-right: 5px; cursor: pointer;">Save</button>`;
            contentHtml += `<button onclick="clearAllSelections()" style="background: #6c757d; color: white; border: none; padding: 8px 15px; cursor: pointer;">Cancel</button>`;
        } else {
            contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px;">Editing mode must be enabled to edit aisle information.</p>`;
        }

        // Use common dialog interface
        this.common.showEditingDialog({
            node: node,
            title: 'Edit Aisle Node',
            contentHtml: contentHtml,
            focusElementId: isEditingModeEnabled ? 'hallEditInput' : null
        });
    }

    /**
     * Enable rack editing UI - allows editing hall, aisle, and rack_num properties for all contained nodes
     * @param {Object} node - The rack node to edit
     * @param {Object} position - Position for the popup
     */
    enableRackEditing(node, _position) {
        const data = node.data();
        const isEditingModeEnabled = this.state.editing.isEdgeCreationMode;

        let contentHtml = `Label: ${data.label || data.id}<br><br>`;

        if (isEditingModeEnabled) {
            contentHtml += `<div style="margin-bottom: 10px;">`;
            contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Hall:</label>`;
            contentHtml += `<input type="text" id="hallEditInput" value="${data.hall || ''}" placeholder="Enter hall" style="width: 200px; padding: 5px;">`;
            contentHtml += `</div>`;

            contentHtml += `<div style="margin-bottom: 10px;">`;
            contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Aisle:</label>`;
            contentHtml += `<input type="text" id="aisleEditInput" value="${data.aisle || ''}" placeholder="Enter aisle" style="width: 200px; padding: 5px;">`;
            contentHtml += `</div>`;

            contentHtml += `<div style="margin-bottom: 10px;">`;
            contentHtml += `<label style="display: block; margin-bottom: 3px; font-weight: bold;">Rack Number:</label>`;
            contentHtml += `<input type="number" id="rackEditInput" value="${data.rack_num || ''}" placeholder="Enter rack number" style="width: 200px; padding: 5px;">`;
            contentHtml += `</div>`;

            contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 12px;">Changing the hall/aisle/rack will update all shelves and their descendants within this rack.</p>`;
            contentHtml += `<br>`;
            contentHtml += `<button onclick="saveRackEdit('${node.id()}')" style="background: #007bff; color: white; border: none; padding: 8px 15px; margin-right: 5px; cursor: pointer;">Save</button>`;
            contentHtml += `<button onclick="clearAllSelections()" style="background: #6c757d; color: white; border: none; padding: 8px 15px; cursor: pointer;">Cancel</button>`;
        } else {
            contentHtml += `<p style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px;">Editing mode must be enabled to edit rack information.</p>`;
        }

        // Use common dialog interface
        this.common.showEditingDialog({
            node: node,
            title: 'Edit Rack Node',
            contentHtml: contentHtml,
            focusElementId: isEditingModeEnabled ? 'hallEditInput' : null
        });
    }

    /**
     * Save hall edit - updates hall property for all contained nodes
     * @param {string} nodeId - The ID of the hall node
     */
    saveHallEdit(nodeId) {
        const hallInput = document.getElementById('hallEditInput');
        const newHall = hallInput ? hallInput.value.trim() : '';

        const node = this.state.cy.getElementById(nodeId);
        if (!node || node.length === 0) {
            console.error(`Hall node ${nodeId} not found`);
            return;
        }

        const oldHall = node.data('hall') || '';
        if (newHall === oldHall) {
            alert('No changes detected. Please modify the hall field.');
            return;
        }

        // Update the hall node itself
        node.data('hall', newHall);
        node.data('label', `Hall ${newHall}`);

        // Update all descendants (aisles, racks, shelves, trays, ports)
        node.descendants().forEach((descendant) => {
            descendant.data('hall', newHall);
        });

        // Update all child aisle nodes
        node.children('[type="aisle"]').forEach((aisleNode) => {
            aisleNode.data('hall', newHall);
            const aisle = aisleNode.data('aisle') || '';
            if (aisle) {
                aisleNode.data('label', `Aisle ${aisle}`);
            }
        });

        // Update all descendant rack nodes' labels
        node.descendants('[type="rack"]').forEach((rackNode) => {
            const rackNum = this._normalizeRackNum(rackNode.data('rack_num'));
            const aisle = rackNode.data('aisle') || '';
            if (aisle && rackNum !== null && rackNum !== undefined) {
                rackNode.data('label', `Rack ${rackNum} (${newHall}-${aisle})`);
            } else if (rackNum !== null && rackNum !== undefined) {
                rackNode.data('label', `Rack ${rackNum}`);
            }
        });

        // Update node filter dropdown
        window.populateNodeFilterDropdown?.();

        // Close dialog and clear selections
        if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
            window.clearAllSelections();
        }

        // Show success message
        if (window.showExportStatus && typeof window.showExportStatus === 'function') {
            window.showExportStatus('Hall node updated successfully. All contained nodes updated.', 'success');
        }

        // Reset layout to reflect changes
        setTimeout(() => {
            if (window.resetLayout && typeof window.resetLayout === 'function') {
                window.resetLayout();
            }
        }, 100);
    }

    /**
     * Save aisle edit - updates hall and aisle properties for all contained nodes
     * @param {string} nodeId - The ID of the aisle node
     */
    saveAisleEdit(nodeId) {
        const hallInput = document.getElementById('hallEditInput');
        const aisleInput = document.getElementById('aisleEditInput');
        const newHall = hallInput ? hallInput.value.trim() : '';
        const newAisle = aisleInput ? aisleInput.value.trim() : '';

        const node = this.state.cy.getElementById(nodeId);
        if (!node || node.length === 0) {
            console.error(`Aisle node ${nodeId} not found`);
            return;
        }

        const oldHall = node.data('hall') || '';
        const oldAisle = node.data('aisle') || '';
        const hallChanged = newHall !== oldHall;
        const aisleChanged = newAisle !== oldAisle;

        if (!hallChanged && !aisleChanged) {
            alert('No changes detected. Please modify at least one field.');
            return;
        }

        // Update the aisle node itself
        if (hallChanged) node.data('hall', newHall);
        if (aisleChanged) node.data('aisle', newAisle);
        node.data('label', `Aisle ${newAisle}`);

        // If hall changed, find or create the new hall node and move aisle under it
        if (hallChanged && newHall) {
            const { shouldShowHalls } = this._shouldShowHallsAndAisles();
            const { hallNode } = this._findOrCreateLocationNodes(
                { hall: newHall, aisle: newAisle },
                { shouldShowHalls }
            );

            if (hallNode) {
                node.move({ parent: hallNode.id() });
            } else {
                // Not showing halls - move aisle to top level
                node.move({ parent: null });
            }

            // Recalculate host_indices after node move (treating canvas as root)
            // This ensures unique, consecutive host_index values across all shelf nodes
            if (this.common && this.common.recalculateHostIndices && typeof this.common.recalculateHostIndices === 'function') {
                this.common.recalculateHostIndices();
            }
        }

        // Update all descendants (racks, shelves, trays, ports)
        node.descendants().forEach((descendant) => {
            if (hallChanged) descendant.data('hall', newHall);
            if (aisleChanged) descendant.data('aisle', newAisle);
        });

        // Update all descendant rack nodes' labels and IDs if needed
        if (hallChanged || aisleChanged) {
            node.descendants('[type="rack"]').forEach((rackNode) => {
                const rackNum = this._normalizeRackNum(rackNode.data('rack_num'));
                if (hallChanged) rackNode.data('hall', newHall);
                if (aisleChanged) rackNode.data('aisle', newAisle);

                // Update rack label
                if (newHall && newAisle && rackNum !== null && rackNum !== undefined) {
                    rackNode.data('label', `Rack ${rackNum} (${newHall}-${newAisle})`);
                } else if (newHall && rackNum !== null && rackNum !== undefined) {
                    rackNode.data('label', `Rack ${rackNum} (${newHall})`);
                } else if (newAisle && rackNum !== null && rackNum !== undefined) {
                    rackNode.data('label', `Rack ${rackNum} (${newAisle})`);
                } else if (rackNum !== null && rackNum !== undefined) {
                    rackNode.data('label', `Rack ${rackNum}`);
                }

                // Update rack ID to match new hall/aisle
                const newRackId = `rack_${newHall || ''}_${newAisle || ''}_${rackNum}`;
                if (rackNode.id() !== newRackId) {
                    // Need to update the ID - this requires recreating the node
                    // For now, we'll just update the data and let resetLayout handle ID changes
                    // The ID will be corrected when resetLayout is called
                }
            });
        }

        // Update node filter dropdown
        window.populateNodeFilterDropdown?.();

        // Close dialog and clear selections
        if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
            window.clearAllSelections();
        }

        // Show success message
        if (window.showExportStatus && typeof window.showExportStatus === 'function') {
            window.showExportStatus('Aisle node updated successfully. All contained nodes updated.', 'success');
        }

        // Reset layout to reflect changes
        setTimeout(() => {
            if (window.resetLayout && typeof window.resetLayout === 'function') {
                window.resetLayout();
            }
        }, 100);
    }

    /**
     * Save rack edit - updates hall, aisle, and rack_num properties for all contained nodes
     * @param {string} nodeId - The ID of the rack node
     */
    saveRackEdit(nodeId) {
        const hallInput = document.getElementById('hallEditInput');
        const aisleInput = document.getElementById('aisleEditInput');
        const rackInput = document.getElementById('rackEditInput');
        const newHall = hallInput ? hallInput.value.trim() : '';
        const newAisle = aisleInput ? aisleInput.value.trim() : '';
        const newRack = rackInput && rackInput.value ? parseInt(rackInput.value) : undefined;

        const node = this.state.cy.getElementById(nodeId);
        if (!node || node.length === 0) {
            console.error(`Rack node ${nodeId} not found`);
            return;
        }

        const oldHall = node.data('hall') || '';
        const oldAisle = node.data('aisle') || '';
        const oldRack = this._normalizeRackNum(node.data('rack_num'));
        const hallChanged = newHall !== oldHall;
        const aisleChanged = newAisle !== oldAisle;
        const rackChanged = newRack !== oldRack && newRack !== undefined;

        if (!hallChanged && !aisleChanged && !rackChanged) {
            alert('No changes detected. Please modify at least one field.');
            return;
        }

        // Update the rack node itself
        if (hallChanged) node.data('hall', newHall);
        if (aisleChanged) node.data('aisle', newAisle);
        if (rackChanged) node.data('rack_num', newRack);

        // Update rack label
        const rackLabel = (newHall && newAisle) ? `Rack ${newRack || oldRack} (${newHall}-${newAisle})` :
            newHall ? `Rack ${newRack || oldRack} (${newHall})` :
                newAisle ? `Rack ${newRack || oldRack} (${newAisle})` :
                    `Rack ${newRack || oldRack}`;
        node.data('label', rackLabel);

        // If hall/aisle changed, find or create the appropriate parent nodes and move rack under them
        if (hallChanged || aisleChanged) {
            const { shouldShowHalls, shouldShowAisles } = this._shouldShowHallsAndAisles();
            const { hallNode, aisleNode } = this._findOrCreateLocationNodes(
                { hall: newHall, aisle: newAisle },
                { shouldShowHalls, shouldShowAisles }
            );

            // Determine rack parent: aisle if exists, otherwise hall if exists, otherwise null (top-level)
            const rackParent = this._determineRackParent(newHall, newAisle, {
                aisleNode: aisleNode,
                hallNode: hallNode
            });

            if (rackParent) {
                node.move({ parent: rackParent });
            } else {
                node.move({ parent: null });
            }

            // Recalculate host_indices after node move (treating canvas as root)
            // This ensures unique, consecutive host_index values across all shelf nodes
            if (this.common && this.common.recalculateHostIndices && typeof this.common.recalculateHostIndices === 'function') {
                this.common.recalculateHostIndices();
            }
        }

        // Update all descendants (shelves, trays, ports)
        node.descendants().forEach((descendant) => {
            if (hallChanged) descendant.data('hall', newHall);
            if (aisleChanged) descendant.data('aisle', newAisle);
            if (rackChanged) descendant.data('rack_num', newRack);
        });

        // Update node filter dropdown
        window.populateNodeFilterDropdown?.();

        // Recolor connections after location changes (in location mode)
        const mode = this.state.mode;
        if (mode === 'location' && (hallChanged || aisleChanged || rackChanged)) {
            this.recolorConnections();
        }

        // Close dialog and clear selections
        if (window.clearAllSelections && typeof window.clearAllSelections === 'function') {
            window.clearAllSelections();
        }

        // Show success message
        if (window.showExportStatus && typeof window.showExportStatus === 'function') {
            window.showExportStatus('Rack node updated successfully. All contained nodes updated.', 'success');
        }

        // Reset layout to reflect changes (especially if rack number changed)
        setTimeout(() => {
            if (window.resetLayout && typeof window.resetLayout === 'function') {
                window.resetLayout();
            }
        }, 100);
    }
}

