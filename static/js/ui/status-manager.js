/**
 * Status Manager - Export/operation status display
 * Extracted from visualizer.js to separate UI concerns
 */
export class StatusManager {
    constructor() {
        this.statusElement = document.getElementById('exportStatus');
    }
    
    /**
     * Show status message
     * @param {string} message - Status message
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     */
    show(message, type = 'info') {
        if (!this.statusElement) {
            console.log(`[${type}]`, message);
            return;
        }
        
        this.statusElement.textContent = message;
        this.statusElement.className = `status-${type}`;
        this.statusElement.style.display = 'block';
    }
    
    /**
     * Hide status message
     */
    hide() {
        if (this.statusElement) {
            this.statusElement.style.display = 'none';
        }
    }
    
    /**
     * Show success status
     * @param {string} message - Success message
     */
    success(message) {
        this.show(message, 'success');
    }
    
    /**
     * Show error status
     * @param {string} message - Error message
     */
    error(message) {
        this.show(message, 'error');
    }
    
    /**
     * Show warning status
     * @param {string} message - Warning message
     */
    warning(message) {
        this.show(message, 'warning');
    }
    
    /**
     * Show info status
     * @param {string} message - Info message
     */
    info(message) {
        this.show(message, 'info');
    }
}

