# Export Tracking Optimization

## Overview

Implements an efficient tracking approach for export decisions that avoids scanning the entire graph at export time. The system tracks whether top-level graph nodes have been added or deleted, allowing the export to intelligently choose between using the original root template or creating a synthetic root.

## Key Insight

**Leaf nodes (shelves, trays, ports) are invariant across visualization modes.** Only the hierarchical grouping (graph containers) changes between hierarchy mode and location mode. This means we only need to track changes at the graph hierarchy level, not at the hardware level.

## Implementation

### 1. Metadata Tracking (JavaScript)

Three tracking fields are stored in `currentData.metadata`:

```javascript
{
    initialRootTemplate: "n300_lb_cluster",  // Template name of the original root
    initialRootId: "graph_root_cluster",     // Node ID of the original root
    hasTopLevelAdditions: false              // Flag indicating top-level changes
}
```

#### Initialization (`initVisualization`)

On file import:
- Finds all top-level graph nodes (nodes with no parent)
- If **exactly 1** top-level node exists:
  - Stores `initialRootTemplate` = node's template_name
  - Stores `initialRootId` = node's ID
  - Sets `hasTopLevelAdditions = false`
- If **multiple** top-level nodes exist:
  - Sets `initialRootTemplate = null`
  - Sets `initialRootId = null`
  - Sets `hasTopLevelAdditions = true` (already modified)

```javascript
// Example tracking initialization
const topLevelGraphs = data.elements.filter(el => {
    const elData = el.data || {};
    const elType = elData.type;
    const hasParent = elData.parent;
    return ['graph', 'superpod', 'pod', 'cluster'].includes(elType) && !hasParent;
});

if (topLevelGraphs.length === 1) {
    currentData.metadata.initialRootTemplate = topLevelGraphs[0].data.template_name;
    currentData.metadata.initialRootId = topLevelGraphs[0].data.id;
    currentData.metadata.hasTopLevelAdditions = false;
} else {
    // Multiple roots on import
    currentData.metadata.hasTopLevelAdditions = true;
}
```

#### Top-Level Addition (`addNewGraph`)

When instantiating a new graph template:
- If `parentId === null` (adding at top level)
- AND `initialRootTemplate` exists (we had an original root)
- THEN set `hasTopLevelAdditions = true`

```javascript
if (parentId === null && currentData?.metadata?.initialRootTemplate) {
    currentData.metadata.hasTopLevelAdditions = true;
    console.log(`Top-level graph added - flagging export to use synthetic root`);
}
```

#### Original Root Deletion (`deleteSelectedNode`)

When deleting a node:
- Check if `nodeId === initialRootId` (deleting the original root)
- If yes, set `hasTopLevelAdditions = true`

```javascript
const isOriginalRoot = currentData?.metadata?.initialRootId === nodeId;
if (isOriginalRoot) {
    currentData.metadata.hasTopLevelAdditions = true;
    console.log(`Original root deleted - flagging export to use synthetic root`);
}
```

### 2. Export Logic (Python)

The export function checks the tracking flag to make an efficient decision:

```python
has_top_level_additions = metadata.get("hasTopLevelAdditions", False)
initial_root_template = metadata.get("initialRootTemplate")
initial_root_id = metadata.get("initialRootId")

use_initial_root = (not has_top_level_additions and 
                    initial_root_template and 
                    initial_root_id and
                    initial_root_id in element_map)

if use_initial_root:
    # ✅ No changes - use original root template directly
    root_instance.template_name = initial_root_template
    # ... populate from initial root node
else:
    # ⚠️ Changes detected - create synthetic root encompassing all top-level nodes
    # ... scan for all top-level nodes and create synthetic template
```

## Scenarios

### Scenario 1: Import → Edit Children → Export
- **Action**: Import cluster, delete a connection inside a superpod, export
- **Tracking**: `hasTopLevelAdditions = false` (no top-level changes)
- **Export**: Uses `initialRootTemplate` directly ✅ (efficient!)
- **Result**: Exported descriptor uses the original root template

### Scenario 2: Import → Add Top-Level Graph → Export
- **Action**: Import cluster, instantiate a new superpod at top level, export
- **Tracking**: `hasTopLevelAdditions = true` (set when new top-level graph added)
- **Export**: Creates synthetic root containing all top-level nodes
- **Result**: Exported descriptor has a `synthetic_root` template

### Scenario 3: Import → Delete Original Root → Export
- **Action**: Import cluster, delete the root cluster node, export
- **Tracking**: `hasTopLevelAdditions = true` (set when original root deleted)
- **Export**: Creates synthetic root containing remaining top-level nodes
- **Result**: Exported descriptor adapts to the new structure

### Scenario 4: Import with Multiple Roots
- **Action**: Import a descriptor that somehow has multiple top-level roots (shouldn't happen normally)
- **Tracking**: `hasTopLevelAdditions = true` (set at init)
- **Export**: Creates synthetic root (fall-through behavior)

## Benefits

1. **Performance**: No need to scan entire graph at export time
2. **Clarity**: Explicit intent - flag clearly indicates whether top-level structure changed
3. **Debugging**: Console logs show when flag is set, making behavior transparent
4. **Correctness**: Handles all edge cases (deletion, addition, multiple roots)

## Mode Switching Compatibility

The tracking data persists through mode switches:
- **Location Mode**: Hierarchical structure (parent relationships) are preserved in node data, even if not visualized
- **Hierarchy Mode**: Restored from `hierarchyModeState`, which includes all metadata
- **Flags**: `hasTopLevelAdditions` and `initialRootTemplate` remain valid across modes

## Edge Cases Handled

| Edge Case | Behavior |
|-----------|----------|
| Delete original root | Flag set → synthetic root created |
| Add sibling to original root | Flag set → synthetic root created |
| Edit connections within root | Flag NOT set → original template used |
| Import with multiple roots | Flag set at init → synthetic root created |
| Mode switch preserves flags | Hierarchy data in node attributes persists |

## Files Modified

### JavaScript (`static/js/visualizer.js`)
- **`initVisualization()`**: Initialize tracking fields on import
- **`addNewGraph()`**: Set flag when adding at top level
- **`deleteSelectedNode()`**: Set flag when deleting original root

### Python (`export_descriptors.py`)
- **`export_hierarchical_cabling_descriptor()`**: Check flag to decide between initial root or synthetic root

## Testing

Test the tracking with these scenarios:
1. Import → Export (should use initial root)
2. Import → Delete connection → Export (should use initial root)
3. Import → Add top-level graph → Export (should use synthetic root)
4. Import → Delete root → Export (should use synthetic root)
5. Import → Mode switch → Export (tracking should persist)

