/**
 * Notification Manager - Centralized notification/alert handling
 * Extracted from visualizer.js to separate UI concerns
 */
export class NotificationManager {
    constructor() {
        this.notificationTimer = null;
        this.banner = document.getElementById('notificationBanner');
        this.content = document.getElementById('notificationContent');
    }
    
    /**
     * Show notification banner
     * @param {string} message - Message to display
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     */
    show(message, type = 'success') {
        if (!this.banner || !this.content) {
            console.log(`${type}:`, message);
            return;
        }

        // Clear any existing timer
        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
        }

        // Set content
        this.content.innerHTML = message;

        // Set colors based on type
        const styles = this._getStylesForType(type);
        Object.assign(this.banner.style, styles);

        // Show banner with animation
        this.banner.style.display = 'block';
        this.banner.style.animation = 'slideDown 0.3s ease-out';

        // Auto-dismiss after appropriate time based on type
        const dismissTime = (type === 'error' || type === 'warning') ? 8000 : 5000;
        this.notificationTimer = setTimeout(() => {
            this.hide();
        }, dismissTime);
    }
    
    /**
     * Hide notification banner
     */
    hide() {
        if (!this.banner) return;

        // Clear timer
        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
            this.notificationTimer = null;
        }

        // Animate out
        this.banner.style.animation = 'slideUp 0.3s ease-out';
        setTimeout(() => {
            this.banner.style.display = 'none';
        }, 300);
    }
    
    /**
     * Show error notification
     * @param {string} message - Error message
     */
    error(message) {
        this.show(message, 'error');
    }
    
    /**
     * Show success notification
     * @param {string} message - Success message
     */
    success(message) {
        this.show(message, 'success');
    }
    
    /**
     * Show warning notification
     * @param {string} message - Warning message
     */
    warning(message) {
        this.show(message, 'warning');
    }
    
    /**
     * Show info notification
     * @param {string} message - Info message
     */
    info(message) {
        this.show(message, 'info');
    }
    
    /**
     * Get styles for notification type
     * @private
     */
    _getStylesForType(type) {
        const styles = {
            success: {
                backgroundColor: '#d4edda',
                borderLeft: '4px solid #28a745',
                color: '#155724'
            },
            error: {
                backgroundColor: '#f8d7da',
                borderLeft: '4px solid #dc3545',
                color: '#721c24'
            },
            warning: {
                backgroundColor: '#fff3cd',
                borderLeft: '4px solid #ffc107',
                color: '#856404'
            },
            info: {
                backgroundColor: '#d1ecf1',
                borderLeft: '4px solid #17a2b8',
                color: '#0c5460'
            }
        };
        
        return styles[type] || styles.success;
    }
}

