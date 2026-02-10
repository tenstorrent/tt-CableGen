/**
 * Cytoscape Utility Functions
 * Extracted from visualizer.js to separate utility concerns
 */

/**
 * Verify that all required cytoscape extensions are loaded and available
 * Logs warnings for any missing extensions
 * @param {Object} state - VisualizerState instance
 */
export function verifyCytoscapeExtensions(state) {
    if (!state.cy) {
        console.warn('⚠ Cannot verify extensions: cytoscape instance not initialized');
        return;
    }

    const missingExtensions = [];
    const availableExtensions = [];

    // Check for fcose layout extension
    // fcose registers itself as a layout algorithm, so we check by trying to create a layout
    try {
        // Try to create a test layout with fcose - if it fails, the extension isn't loaded
        const testLayout = state.cy.layout({ name: 'fcose', eles: state.cy.collection() });
        if (testLayout && typeof testLayout.run === 'function') {
            availableExtensions.push('cytoscape-fcose');
        } else {
            missingExtensions.push('cytoscape-fcose');
        }
    } catch (e) {
        // If fcose layout creation fails, the extension isn't loaded
        missingExtensions.push('cytoscape-fcose');
    }

    // Log results
    if (availableExtensions.length > 0) {
        console.log('✓ Available cytoscape extensions:', availableExtensions.join(', '));
    }
    if (missingExtensions.length > 0) {
        console.warn('⚠ Missing cytoscape extensions:', missingExtensions.join(', '));
        console.warn('Some features may not work correctly. Please ensure all extension scripts are loaded in index.html');
    } else {
        console.log('✓ All cytoscape extensions are loaded and available');
    }
}

