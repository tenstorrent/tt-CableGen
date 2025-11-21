# Host Index Recalculation Feature

## Overview

This document describes the host index recalculation feature implemented to ensure siblings within template instances have consecutive host numbering in hierarchy mode.

## Problem Statement

Previously, when adding nodes to templates in hierarchy mode, the system would:
1. Add the node to all instances of that template
2. Assign a global `host_index` using `globalHostCounter++`
3. This resulted in siblings across different template instances getting non-consecutive `host_index` values

For example, if you had two instances of a template "pod" and added a node to both:
- pod_instance_1 might have: host_5, host_6, host_12
- pod_instance_2 might have: host_7, host_8, host_13

This made it difficult to export cabling_descriptor with cleanly associated host_indices for each template instance.

## Solution

The solution implements a `recalculateHostIndicesForTemplates()` function that:

1. Groups all shelf nodes by their parent graph instance
2. Within each instance, sorts siblings by `child_name`
3. Assigns consecutive `host_indices` starting from 0 for each instance
4. Updates the global `globalHostCounter` to reflect the new maximum

After recalculation, the same example would look like:
- pod_instance_1: host_0, host_1, host_2
- pod_instance_2: host_3, host_4, host_5

## Implementation Details

### New Function: `recalculateHostIndicesForTemplates()`

Location: `static/js/visualizer.js` (lines 2200-2269)

```javascript
function recalculateHostIndicesForTemplates() {
    // Get all graph nodes (template instances)
    const graphNodes = cy.nodes('[type="graph"]');
    
    let nextHostIndex = 0;
    
    // For each graph node, renumber its shelf children
    graphNodes.forEach(graphNode => {
        const shelfChildren = graphNode.children('[type="shelf"]');
        
        if (shelfChildren.length === 0) {
            return; // No shelf children, skip
        }
        
        // Sort siblings by child_name to maintain consistent ordering
        const sortedShelves = shelfChildren.toArray().sort((a, b) => {
            const childNameA = a.data('child_name') || a.data('label');
            const childNameB = b.data('child_name') || b.data('label');
            return childNameA.localeCompare(childNameB);
        });
        
        // Assign consecutive host_indices to siblings
        sortedShelves.forEach(shelfNode => {
            const newHostIndex = nextHostIndex;
            nextHostIndex++;
            
            // Update shelf node, label, and all child tray/port nodes
            shelfNode.data('host_index', newHostIndex);
            // ... (updates label, trays, and ports)
        });
    });
    
    globalHostCounter = nextHostIndex;
}
```

### Integration Points

The recalculation function is called at the following points:

1. **When adding a node to a template** (`addNewNode()` function, line 3650)
   - Called after adding nodes to all template instances
   - Only called if not adding to synthetic root

2. **When adding a graph template to multiple instances** (`addNewGraph()` function, line 4405)
   - Called after adding child graphs to all instances of a parent template

3. **When adding a new graph instance** (`addNewGraph()` function, line 4492)
   - Called after instantiating a template if in hierarchy mode

4. **When initially loading data** (lines 5456 and 5504)
   - Called after loading elements into Cytoscape
   - Ensures backward compatibility with files created before this feature

5. **When deleting a node from a template** (`deleteSelectedNode()` function, lines 2858 and 2880)
   - Called after template-level deletion (all instances)
   - Called after instance-specific shelf deletion in hierarchy mode
   - Ensures host_indices remain consecutive after deletion

## Benefits

1. **Cleaner Exports**: Template instances now have consecutive host numbering, making cabling_descriptor exports more readable and organized

2. **Easier Debugging**: When inspecting a template instance, it's immediately clear which hosts belong to it

3. **Better Organization**: Host indices now reflect the logical structure of the hierarchy

4. **Backward Compatibility**: Existing files are automatically recalculated when loaded

## Testing

To test this feature:

1. Create a graph template with multiple node children
2. Instantiate the template multiple times
3. Add additional nodes to one of the instances
4. Verify that:
   - All siblings within each instance have consecutive host_indices
   - The host_indices are sorted by child_name
   - Labels are updated to reflect new host_indices (e.g., "node_0 (host_5)")

## Export Behavior

When exporting cabling_descriptor:
- Host mappings will use the recalculated consecutive indices
- Each template instance's hosts will be grouped together in the export
- This makes it easier to identify which hosts belong to which template instance

## Future Enhancements

Possible future improvements:
1. Add UI indicator showing host_index ranges per template instance
2. Add option to manually trigger recalculation
3. Add validation to warn if host_indices become inconsistent
4. Consider template-local host_indices (0-N per instance) in addition to global indices

