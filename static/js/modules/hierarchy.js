/**
 * Hierarchy Module - Functions specific to hierarchy/logical mode
 * Extracted from visualizer.js to separate hierarchy-specific logic
 */
import { LAYOUT } from '../config/constants.js';

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
}

