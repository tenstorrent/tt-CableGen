/**
 * Location Module - Functions specific to location/physical mode
 * Extracted from visualizer.js to separate location-specific logic
 */
import { CONNECTION_COLORS, LAYOUT_CONSTANTS } from '../config/constants.js';
import { getNodeConfig } from '../config/node-types.js';

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
     * Recolor connections for physical view based on same/different shelf
     */
    recolorConnections() {
        if (!this.state.cy) return;

        this.state.cy.edges().forEach(edge => {
            const sourceId = edge.data('source');
            const targetId = edge.data('target');

            // Check if ports are on the same shelf (2 levels up: port -> tray -> shelf)
            const sourceNode = this.state.cy.getElementById(sourceId);
            const targetNode = this.state.cy.getElementById(targetId);

            if (!sourceNode.length || !targetNode.length) return;

            const sourceShelf = this.getParentAtLevel(sourceNode, 2);
            const targetShelf = this.getParentAtLevel(targetNode, 2);

            // Verify that both nodes are actually shelf nodes
            const sourceIsShelf = sourceShelf && sourceShelf.length &&
                (sourceShelf.data('type') === 'shelf' || sourceShelf.data('type') === 'node');
            const targetIsShelf = targetShelf && targetShelf.length &&
                (targetShelf.data('type') === 'shelf' || targetShelf.data('type') === 'node');

            let color;
            if (sourceIsShelf && targetIsShelf && sourceShelf.id() === targetShelf.id()) {
                color = CONNECTION_COLORS.INTRA_NODE;  // Green for same shelf
            } else {
                color = CONNECTION_COLORS.INTER_NODE;  // Blue for different shelves
            }

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

        // Stacked hall/aisle layout constants
        const hallSpacing = 1200;
        const aisleOffsetX = 400;
        const aisleOffsetY = 400;
        const rackSpacing = 600;
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
                const aisleStartX = baseX + (aisleIndex * aisleOffsetX);
                const aisleStartY = hallStartY + (aisleIndex * aisleOffsetY);

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

                let rackX = aisleStartX;
                rackHierarchy[hall][aisle].forEach((rackData) => {
                    const rack = rackData.node;

                    // Determine rack parent: aisle if exists, otherwise hall if exists, otherwise null (top-level)
                    const rackParent = aisleId || hallId;
                    if (rackParent) {
                        rack.move({ parent: rackParent });
                    } else {
                        // Move to top level (no parent)
                        rack.move({ parent: null });
                    }

                    // Update rack position
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

                        // Second pass: calculate dynamic spacing based on actual shelf heights
                        let maxShelfHeight = 0;

                        // Calculate total height needed
                        sortedShelves.forEach((shelfData) => {
                            const shelf = shelfData.node;
                            const shelfBBox = shelf.boundingBox();
                            const shelfHeight = shelfBBox.h || 100;
                            maxShelfHeight = Math.max(maxShelfHeight, shelfHeight);
                        });

                        // Use dynamic spacing: shelf height + 5% padding
                        const shelfSpacingFactor = 1.05;
                        const totalHeight = (numShelves - 1) * maxShelfHeight * shelfSpacingFactor;
                        const shelfStartY = aisleStartY - (totalHeight / 2);

                        // Third pass: apply final positions with proper spacing
                        sortedShelves.forEach((shelfData, shelfIndex) => {
                            const shelf = shelfData.node;
                            const yPos = shelfStartY + (shelfIndex * maxShelfHeight * shelfSpacingFactor);
                            shelf.position({ x: rackX, y: yPos });
                        });
                    }

                    rackX += rackSpacing;
                });

                aisleIndex++;
            });

            hallIndex++;
        });

        this.state.cy.endBatch();

        console.log('Location-based layout applied with hall > aisle > rack > shelf hierarchy');

        // Apply fcose layout to prevent overlaps in location mode
        // This fine-tunes the positions calculated by the manual layout
        setTimeout(() => {
            const locationNodes = this.state.cy.nodes('[type="hall"], [type="aisle"], [type="rack"]');
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

                            // Note: forceApplyCurveStyles will be called from visualizer.js wrapper
                            this.common.forceApplyCurveStyles();
                        }
                    });
                    if (layout) {
                        layout.run();
                    }
                } catch (e) {
                    console.warn('Error applying fcose layout in location mode:', e.message);
                }
            }
        }, 100);
    }


    /**
     * Switch to location/physical mode - rebuild visualization based on physical location data
     */
    switchMode() {
        // Clear all selections (including Cytoscape selections) when switching modes
        if (this.common && typeof this.common.clearAllSelections === 'function') {
            this.common.clearAllSelections();
        }

        // Save current state before modifying (for switching back)
        this.state.data.hierarchyModeState = {
            elements: this.state.cy.elements().jsons(),
            metadata: (this.state.data.currentData && this.state.data.currentData.metadata) ? JSON.parse(JSON.stringify(this.state.data.currentData.metadata)) : {}
        };

        // Extract shelf nodes with their physical location and connection data
        const shelfNodes = this.state.cy.nodes('[type="shelf"]');
        if (shelfNodes.length === 0) {
            console.warn('No shelf nodes found');
            return;
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

        // Log host_index preservation for debugging
        const shelvesWithHostIndex = shelfDataList.filter(s => s.data.host_index !== undefined).length;
        console.log(`location_switchMode: Extracted ${shelfDataList.length} shelves, ${shelvesWithHostIndex} have host_index`);

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

        // Extract all connections (edges) from CURRENT graph state
        // This ensures deleted connections are not restored
        const connections = [];
        const currentEdges = this.state.cy.edges();
        console.log(`[location.switchMode] Extracting ${currentEdges.length} edges from current graph state`);

        currentEdges.forEach(edge => {
            // Get all data fields from the edge
            const edgeData = {};
            const data = edge.data();
            for (const key in data) {
                // Don't preserve color - it's mode-specific and will be recalculated
                if (key !== 'color') {
                    edgeData[key] = data[key];
                }
            }
            connections.push({
                data: edgeData,
                classes: edge.classes()
            });
        });

        console.log(`[location.switchMode] Preserved ${connections.length} connections for location mode`);

        // Clear the entire graph
        this.state.cy.elements().remove();

        // Rebuild visualization based ONLY on physical location data
        const newElements = [];

        // Check if we have location information
        const hasLocationInfo = shelfDataList.some(shelfInfo =>
            shelfInfo.data.hall || shelfInfo.data.aisle || (shelfInfo.data.rack_num !== undefined && shelfInfo.data.rack_num !== null)
        );

        if (hasLocationInfo) {
            // Group shelves by location hierarchy: hall -> aisle -> rack
            const locationHierarchy = {};

            shelfDataList.forEach(shelfInfo => {
                const hall = shelfInfo.data.hall || '';
                const aisle = shelfInfo.data.aisle || '';
                const rack = shelfInfo.data.rack_num !== undefined ? shelfInfo.data.rack_num : 'unknown_rack';

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
            const aisleOffsetX = 400; // Horizontal offset for each aisle (diagonal stack)
            const aisleOffsetY = 400; // Vertical offset for each aisle (diagonal stack)
            const rackSpacing = 600; // Horizontal spacing between racks within an aisle
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
                    // Square offset: each aisle is offset diagonally from the previous one
                    const aisleStartX = baseX + (aisleIndex * aisleOffsetX);
                    const aisleStartY = hallStartY + (aisleIndex * aisleOffsetY);

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

                    let rackX = aisleStartX;
                    // Sort racks in descending order (higher rack numbers to the left)
                    Object.keys(locationHierarchy[hall][aisle]).sort((a, b) => {
                        const rackA = parseInt(a) || 0;
                        const rackB = parseInt(b) || 0;
                        return rackB - rackA; // Descending order - rack 2 to the left of rack 1
                    }).forEach(rack => {
                        const shelvesInRack = locationHierarchy[hall][aisle][rack];

                        // Determine rack parent: aisle if exists, otherwise hall if exists, otherwise null (top-level)
                        const rackParent = aisleId || hallId || null;
                        const rackLabel = (hall && aisle) ? `Rack ${rack} (${hall}-${aisle})` :
                            hall ? `Rack ${rack} (${hall})` :
                                aisle ? `Rack ${rack} (${aisle})` :
                                    `Rack ${rack}`;

                        // Create rack node with appropriate parent
                        const rackId = `rack_${hall}_${aisle}_${rack}`;
                        const rackData = {
                            id: rackId,
                            label: rackLabel,
                            type: 'rack',
                            hall: hall,
                            aisle: aisle,
                            rack_num: rack
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
                                // Ensure hall/aisle/rack info is preserved on shelf nodes
                                hall: hall,
                                aisle: aisle,
                                rack_num: rack
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

                            // Set label based on hostname (explicit or implied from host_index)
                            let displayLabel = shelfInfo.data.hostname;
                            if (!displayLabel) {
                                // Use child_name if available (logical name from template)
                                if (shelfInfo.data.child_name) {
                                    const hostIndex = shelfInfo.data.host_index;
                                    if (hostIndex !== undefined && hostIndex !== null) {
                                        displayLabel = `${shelfInfo.data.child_name} (host_${hostIndex})`;
                                    } else {
                                        displayLabel = shelfInfo.data.child_name;
                                    }
                                } else if (shelfInfo.data.host_index !== undefined && shelfInfo.data.host_index !== null) {
                                    // Use host_index to generate hostname
                                    displayLabel = `host_${shelfInfo.data.host_index}`;
                                } else {
                                    // Fallback to original label
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

                        rackX += rackSpacing;
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

                // Set label based on hostname (explicit or implied from host_index)
                let displayLabel = shelfInfo.data.hostname;
                if (!displayLabel) {
                    // Use host_index to generate hostname
                    const hostIndex = shelfInfo.data.host_index;
                    if (hostIndex !== undefined && hostIndex !== null) {
                        displayLabel = `host_${hostIndex}`;
                    } else {
                        // Fallback to original label
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

        // Re-create connections with all preserved data
        connections.forEach(conn => {
            newElements.push({
                data: conn.data,
                classes: conn.classes
            });
        });

        // Add all elements back to cytoscape
        this.state.cy.add(newElements);

        // Recolor connections immediately after adding edges (before layout)
        // This ensures colors are set before any async layout operations
        this.recolorConnections();

        // Apply the proper location-based layout with stacked halls/aisles and dynamic spacing
        this.calculateLayout();
        // Note: fcose is applied within calculateLayout() to prevent overlaps

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

        // Note: If Aisle (lower level compared to Hall) is specified, Hall (higher level) can be specified (optional)

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
                    // Create hall node even if showHalls was false, because aisle needs it
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
     * Get location data from a node or its parent hierarchy
     * @param {Object} node - Cytoscape node
     * @returns {Object} Location data {hall, aisle, rack_num, shelf_u, hostname}
     */
    getNodeData(node) {
        const data = node.data();

        // If node has all location data, return it
        if (data.hall && data.aisle && data.rack_num !== undefined) {
            return {
                hall: data.hall,
                aisle: data.aisle,
                rack_num: this._normalizeRackNum(data.rack_num),
                shelf_u: data.shelf_u || null,
                hostname: data.hostname || null
            };
        }

        // Otherwise, traverse up the parent hierarchy
        let current = node;
        while (current && current.length > 0) {
            const parent = current.parent();
            if (parent.length === 0) break;

            const parentData = parent.data();
            if (parentData.hall && parentData.aisle && parentData.rack_num !== undefined) {
                return {
                    hall: parentData.hall,
                    aisle: parentData.aisle,
                    rack_num: this._normalizeRackNum(parentData.rack_num),
                    shelf_u: data.shelf_u || null,
                    hostname: data.hostname || null
                };
            }

            current = parent;
        }

        // Fallback: return what we have
        return {
            hall: data.hall || null,
            aisle: data.aisle || null,
            rack_num: this._normalizeRackNum(data.rack_num),
            shelf_u: data.shelf_u || null,
            hostname: data.hostname || null
        };
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
    addNode(nodeType, inputs) {
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

        // Check for existing node with same hostname or location
        if (hasHostname) {
            const existingNode = this.state.cy.nodes(`[hostname="${hostname}"]`);
            if (existingNode.length > 0) {
                console.warn(`A node with hostname "${hostname}" already exists. Please choose a different hostname.`);
                hostnameInput.focus();
                return;
            }
        } else {
            // Check for existing node with same location
            const existingNode = this.state.cy.nodes(`[hall="${hall}"][aisle="${aisle}"][rack_num="${rack}"][shelf_u="${shelfU}"]`);
            if (existingNode.length > 0) {
                console.warn(`A node already exists at Hall: ${hall}, Aisle: ${aisle}, Rack: ${rack}, Shelf U: ${shelfU}. Please choose a different location.`);
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
            // Use hostname as label, but ID is numeric
            nodeLabel = `${hostname} (host_${hostIndex})`;
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
            // Format: HallAisle{2-digit Rack}U{2-digit Shelf U}
            const locationLabel = this.buildLabel(hall, aisle, rack, shelfU);
            nodeLabel = `${locationLabel} (host_${hostIndex})`;
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
            'showIntraNodeConnections',
            'showIntraRackConnections',
            'showInterRackConnections'
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

        // Check if hostname already exists on another node (if hostname changed)
        if (hostnameChanged && newHostname) {
            let hostnameExists = false;
            this.state.cy.nodes().forEach((n) => {
                if (n.id() !== nodeId && n.data('hostname') === newHostname) {
                    hostnameExists = true;
                }
            });

            if (hostnameExists) {
                alert(`Hostname "${newHostname}" already exists on another node. Please choose a different hostname.`);
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

        // Prefer hostname for display label, fall back to location format
        if (currentHostname) {
            newLabel = currentHostname;
        } else if (currentHall && currentAisle && currentRack !== undefined && currentShelfU !== undefined) {
            newLabel = this.buildLabel(currentHall, currentAisle, currentRack, currentShelfU);
        } else if (currentShelfU !== undefined) {
            newLabel = `Shelf ${currentShelfU}`;
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

        // If rack or shelf_u changed in location mode, automatically reset layout to properly reposition nodes
        // In hierarchy mode, location changes don't affect the visualization layout
        const mode = this.state.mode;
        if ((rackChanged || shelfUChanged) && mode === 'location') {

            // Call resetLayout to recalculate positions
            // Use setTimeout to ensure the DOM updates are complete
            setTimeout(() => {
                window.resetLayout?.();
            }, 100);
        } else {
            // Show success message
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
        // Note: If hall is specified, aisle must be specified (enforced in _findOrCreateLocationNodes)
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
        }

        // Update all descendants (shelves, trays, ports)
        node.descendants().forEach((descendant) => {
            if (hallChanged) descendant.data('hall', newHall);
            if (aisleChanged) descendant.data('aisle', newAisle);
            if (rackChanged) descendant.data('rack_num', newRack);
        });

        // Update node filter dropdown
        window.populateNodeFilterDropdown?.();

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

