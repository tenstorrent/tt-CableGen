/**
 * Modal Manager - Centralized modal dialog handling
 * Extracted from visualizer.js to separate UI concerns
 */
export class ModalManager {
    constructor() {
        this.activeModals = new Set();
    }
    
    /**
     * Show a modal by ID
     * @param {string} modalId - ID of modal element
     * @param {Function} [onShow] - Callback when modal is shown
     */
    show(modalId, onShow = null) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.error(`Modal not found: ${modalId}`);
            return false;
        }
        
        modal.classList.add('active');
        this.activeModals.add(modalId);
        
        if (onShow) {
            onShow(modal);
        }
        
        return true;
    }
    
    /**
     * Hide a modal by ID
     * @param {string} modalId - ID of modal element
     * @param {Function} [onHide] - Callback when modal is hidden
     */
    hide(modalId, onHide = null) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            return false;
        }
        
        modal.classList.remove('active');
        this.activeModals.delete(modalId);
        
        if (onHide) {
            onHide(modal);
        }
        
        return true;
    }
    
    /**
     * Toggle modal visibility
     * @param {string} modalId - ID of modal element
     */
    toggle(modalId) {
        if (this.isVisible(modalId)) {
            this.hide(modalId);
        } else {
            this.show(modalId);
        }
    }
    
    /**
     * Check if modal is visible
     * @param {string} modalId - ID of modal element
     * @returns {boolean} True if modal is visible
     */
    isVisible(modalId) {
        const modal = document.getElementById(modalId);
        return modal && modal.classList.contains('active');
    }
    
    /**
     * Hide all active modals
     */
    hideAll() {
        this.activeModals.forEach(modalId => {
            this.hide(modalId);
        });
    }
    
    /**
     * Setup click-outside-to-close handler for a modal
     * @param {string} modalId - ID of modal element
     * @param {Function} onClose - Callback when clicking outside
     */
    setupClickOutsideClose(modalId, onClose) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        const handler = (event) => {
            if (event.target.id === modalId) {
                if (onClose) {
                    onClose();
                } else {
                    this.hide(modalId);
                }
            }
        };
        
        modal.removeEventListener('click', handler);
        modal.addEventListener('click', handler);
    }
}

