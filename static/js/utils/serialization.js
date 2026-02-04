/**
 * Serialization utilities - safe JSON handling (circular refs, functions)
 * Shared by api-client (request body) and other modules that need safe stringify.
 */

/**
 * Safely stringify JSON, handling circular references and skipping functions
 * @param {*} obj - Object to stringify
 * @returns {string} JSON string
 */
export function safeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular Reference]';
            }
            seen.add(value);
        }
        if (typeof value === 'function') {
            return undefined;
        }
        return value;
    });
}
