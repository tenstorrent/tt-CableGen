/**
 * Location Module - Functions specific to location/physical mode
 * Extracted from visualizer.js to separate location-specific logic
 */
import { LAYOUT } from '../config/constants.js';

export class LocationModule {
    constructor(state, commonModule) {
        this.state = state;
        this.common = commonModule;
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
                rack_num: data.rack_num,
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
                    rack_num: parentData.rack_num,
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
            rack_num: data.rack_num || null,
            shelf_u: data.shelf_u || null,
            hostname: data.hostname || null
        };
    }
    
    /**
     * Format rack number with padding
     * @private
     */
    _formatRackNum(rackNum) {
        return String(rackNum).padStart(2, '0');
    }
    
    /**
     * Format shelf U number with padding
     * @private
     */
    _formatShelfU(shelfU) {
        return String(shelfU).padStart(2, '0');
    }
}

