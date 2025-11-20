/**
 * Factory for creating connections (edges)
 * Centralizes edge creation logic
 */
export class ConnectionFactory {
    constructor(state) {
        this.state = state;
    }
    
    /**
     * Create a connection between two ports
     * @param {Object} options - Connection options
     * @param {Object} options.sourcePort - Source port node
     * @param {Object} options.targetPort - Target port node
     * @param {string} [options.cableType='QSFP_DD'] - Type of cable
     * @param {string} [options.cableLength='Unknown'] - Cable length
     * @param {string|null} [options.templateName=null] - Template name for template-level connections
     * @param {string} [options.color] - Connection color (auto-calculated if not provided)
     * @returns {Object} Created edge data structure (not yet added to cytoscape)
     */
    createConnection(options) {
        const {
            sourcePort,
            targetPort,
            cableType = 'QSFP_DD',
            cableLength = 'Unknown',
            templateName = null,
            color = null
        } = options;
        
        if (!sourcePort || !targetPort) {
            throw new Error('Both sourcePort and targetPort are required');
        }
        
        const sourcePortId = typeof sourcePort === 'string' ? sourcePort : sourcePort.id();
        const targetPortId = typeof targetPort === 'string' ? targetPort : targetPort.id();
        
        const connectionNumber = this.state.getNextConnectionNumber();
        const edgeId = `connection_${connectionNumber}`;
        
        // Determine color if not provided
        let connectionColor = color;
        if (!connectionColor && templateName) {
            // Get template color if available
            const templateColor = this._getTemplateColor(templateName);
            if (templateColor) {
                connectionColor = templateColor;
            }
        }
        if (!connectionColor) {
            connectionColor = '#999'; // Default color
        }
        
        return {
            data: {
                id: edgeId,
                source: sourcePortId,
                target: targetPortId,
                cableType,
                cableLength,
                connection_number: connectionNumber,
                color: connectionColor,
                template_name: templateName
            },
            classes: 'connection'
        };
    }
    
    /**
     * Get template color (helper method)
     * @private
     */
    _getTemplateColor(templateName) {
        // This will be replaced with actual template color logic
        // For now, return null to use default
        return null;
    }
}

