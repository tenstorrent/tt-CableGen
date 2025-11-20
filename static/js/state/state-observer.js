/**
 * Observable pattern for state changes
 * Allows UI components to react to state changes
 */
export class StateObserver {
    constructor(state) {
        this.state = state;
        this.observers = new Map();
    }
    
    /**
     * Subscribe to state changes
     * @param {string} path - Dot-notation path (e.g., 'editing.selectedNode')
     * @param {Function} callback - Called when state changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
        if (!this.observers.has(path)) {
            this.observers.set(path, []);
        }
        this.observers.get(path).push(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.observers.get(path);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }
    
    /**
     * Notify observers of state change
     * @param {string} path - Dot-notation path that changed
     * @param {*} newValue - New value
     * @param {*} oldValue - Old value
     */
    notify(path, newValue, oldValue) {
        const callbacks = this.observers.get(path) || [];
        callbacks.forEach(callback => {
            try {
                callback(newValue, oldValue, path);
            } catch (error) {
                console.error(`Error in observer callback for ${path}:`, error);
            }
        });
    }
    
    /**
     * Create a proxy to auto-notify on changes
     * @param {Object} obj - Object to wrap in proxy
     * @param {string} path - Base path for notifications
     * @returns {Proxy} Proxy object that notifies on changes
     */
    createProxy(obj, path = '') {
        const self = this;
        
        return new Proxy(obj, {
            set(target, property, value) {
                const oldValue = target[property];
                const fullPath = path ? `${path}.${property}` : property;
                
                target[property] = value;
                self.notify(fullPath, value, oldValue);
                
                return true;
            },
            
            get(target, property) {
                const value = target[property];
                
                // If value is an object, return a proxy for it too
                if (value && typeof value === 'object' && !Array.isArray(value) && value.constructor === Object) {
                    const fullPath = path ? `${path}.${property}` : property;
                    return self.createProxy(value, fullPath);
                }
                
                return value;
            }
        });
    }
    
    /**
     * Unsubscribe all observers
     */
    clear() {
        this.observers.clear();
    }
}

