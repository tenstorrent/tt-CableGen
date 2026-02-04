/**
 * Notification Manager - Centralized notification/alert handling
 * Extracted from visualizer.js to separate UI concerns
 */
import { MESSAGE_TYPE_STYLES } from '../config/constants.js';

export class NotificationManager {
    constructor() {
        this.notificationTimer = null;
        this.banner = document.getElementById('notificationBanner');
        this.content = document.getElementById('notificationContent');
        this._fullMessage = '';
        this._clickHandler = null;
    }

    /**
     * Show notification banner
     * @param {string} message - Message to display (can be truncated)
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     * @param {string} [fullMessage] - Full message to show when user clicks (defaults to message)
     */
    show(message, type = 'success', fullMessage = null) {
        if (!this.banner || !this.content) {
            console.log(`${type}:`, message);
            return;
        }

        // Clear any existing timer
        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
        }

        this._fullMessage = fullMessage != null ? String(fullMessage) : String(message);

        // Set content: show message and hint to click when full text is longer or has newlines
        const hasMore = this._fullMessage.length > (message || '').length || /\n/.test(this._fullMessage);
        this.content.innerHTML = message + (hasMore ? ' <span style="opacity:0.85; font-size:12px;">(click for full message)</span>' : '');
        this.content.style.cursor = hasMore ? 'pointer' : 'default';
        this.content.title = hasMore ? 'Click to see full message' : '';

        // Remove previous click listener
        if (this._clickHandler) {
            this.content.removeEventListener('click', this._clickHandler);
            this._clickHandler = null;
        }
        if (hasMore) {
            this._clickHandler = () => this._showFullMessage();
            this.content.addEventListener('click', this._clickHandler);
        }

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
     * Show full message in a dialog (for copy/paste)
     * @private
     */
    _showFullMessage() {
        if (!this._fullMessage) return;
        const overlay = document.getElementById('notificationFullMessageOverlay');
        const pre = document.getElementById('notificationFullMessageText');
        const closeBtn = document.getElementById('notificationFullMessageClose');
        if (overlay && pre) {
            pre.textContent = this._fullMessage;
            overlay.style.display = 'flex';
        }
        if (closeBtn && !closeBtn._bound) {
            closeBtn._bound = true;
            closeBtn.addEventListener('click', () => {
                if (overlay) overlay.style.display = 'none';
            });
        }
        if (overlay && !overlay._bound) {
            overlay._bound = true;
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.style.display = 'none';
            });
        }
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
        return MESSAGE_TYPE_STYLES[type] || MESSAGE_TYPE_STYLES.success;
    }
}

