# Template Instance Enhancements

## Summary
Implemented three key enhancements for template instantiation and management:
1. **Color consistency** for new template instances
2. **Template-level connection deletion** (affects all instances)
3. **Export uses current state** (includes deletions)

## 1. Color Consistency for New Template Instances

### Problem
When manually instantiating graph templates (using "Add Graph" button), new instances didn't have proper depth values, resulting in inconsistent coloring compared to imported templates.

### Solution
Added depth calculation when creating new graph instances to match the coloring scheme used during import:

```javascript
// Calculate depth for consistent coloring (matches import logic)
let depth = 0;
if (parentId) {
    const parent = cy ? cy.getElementById(parentId) : null;
    if (parent && parent.length > 0) {
        const parentDepth = parent.data('depth');
        depth = (parentDepth !== undefined) ? parentDepth + 1 : 1;
    }
}

const graphNode = {
    data: {
        // ... other fields ...
        depth: depth,  // Add depth for consistent coloring
        graphType: graphType
    }
};
```

**Changes in:**
- `instantiateTemplateRecursive()` function in `visualizer.js`

**Result:**
- ✅ New template instances match the color scheme of imported templates
- ✅ Depth-based border colors (red for cluster-level, orange for superpod-level, etc.) are applied correctly
- ✅ Visual consistency across all template instances

---

## 2. Template-Level Connection Deletion

### Problem
When deleting a connection from one instance of a template (e.g., superpod1), the connection remained in other instances (superpod2, superpod3, etc.), creating inconsistency.

### Solution
Implemented template-aware connection deletion that:
1. Detects if a connection belongs to a template
2. Warns the user that deletion affects all instances
3. Removes the connection from all instances of that template
4. Updates the template definition in metadata

### Key Functions

#### `deleteSelectedConnection()`
Enhanced to detect template connections and route to template-level deletion:

```javascript
const edgeTemplateName = edge.data('template_name');
if (visualizationMode === 'hierarchy' && edgeTemplateName) {
    message += `\n\n⚠️ This connection belongs to template "${edgeTemplateName}".`;
    message += `\nDeleting it will remove this connection from ALL instances of this template.`;
    // ... call deleteConnectionFromAllTemplateInstances()
}
```

#### `deleteConnectionFromAllTemplateInstances(edge, templateName)`
New function that:
1. Extracts the connection pattern (shelf names, tray IDs, port IDs)
2. Finds all graph nodes with matching `template_name`
3. Locates and deletes matching connections in each instance
4. Updates the template definition in `currentData.metadata.graph_templates`

```javascript
// Find all instances
const templateGraphs = cy.nodes().filter(node => 
    node.isParent() && node.data('template_name') === templateName
);

// Delete from each instance
templateGraphs.forEach(graph => {
    // ... find matching connection and delete
});

// Update template definition
template.connections = template.connections.filter(conn => !matches);
```

#### `extractPortPattern(portNode)`
Helper function to extract connection pattern for matching:

```javascript
// Returns: { shelfName: 'node1', trayId: 1, portId: 2 }
```

### Connection Metadata
Ensured all connections store template information:

#### During Import
Already implemented in `import_cabling.py`:
```python
edge_data = {
    "data": {
        # ... other fields ...
        "template_name": template_name,
        "depth": depth
    }
}
```

#### During Manual Creation
Enhanced `createConnection()` to find and store template metadata:

```javascript
// Find the common ancestor graph node
let commonAncestor = findCommonAncestorGraph(sourceNode, targetNode);
let template_name = commonAncestor ? commonAncestor.data('template_name') : null;
let depth = commonAncestor ? (commonAncestor.data('depth') || 0) : 0;

const newEdge = {
    data: {
        // ... other fields ...
        template_name: template_name,  // For template-level deletion
        depth: depth  // For consistent coloring
    }
};
```

#### `findCommonAncestorGraph(node1, node2)`
New helper to find the lowest common ancestor graph node for two nodes:

```javascript
// Returns the graph node that contains both ports
// Used to determine which template a connection belongs to
```

**Changes in:**
- `deleteSelectedConnection()` - Enhanced with template detection
- `deleteConnectionFromAllTemplateInstances()` - New function
- `extractPortPattern()` - New helper function
- `createConnection()` - Enhanced to store template metadata
- `findCommonAncestorGraph()` - New helper function

**Result:**
- ✅ Deleting a connection from one template instance deletes it from ALL instances
- ✅ User is warned before template-level deletion
- ✅ Template definition in metadata is updated (affects export)
- ✅ Maintains consistency across all template instances
- ✅ Console logging shows how many instances were affected

---

## 3. Export Current State

### Already Implemented
The export function already uses `cy.elements().jsons()` which captures the current state:

```javascript
const cytoscapeData = {
    elements: cy.elements().jsons(),  // Current state
    metadata: {
        ...currentData?.metadata,  // Includes updated graph_templates
        visualization_mode: getVisualizationMode()
    }
};
```

### How It Works
1. **User deletes a connection** → Template definition updated in `currentData.metadata.graph_templates`
2. **User clicks export** → `cy.elements().jsons()` gets current edges (deleted ones are gone)
3. **Backend receives** → Updated template definitions via metadata
4. **Export outputs** → Descriptor reflects current state without deleted connections

**Result:**
- ✅ Export reflects the current visualization state
- ✅ Deleted connections are not included in export
- ✅ Template definitions in export are updated
- ✅ Round-trip import/export preserves the current state

---

## User Experience

### Color Consistency
- When adding a new superpod instance, it will have the same orange border as other superpods
- When adding nested pods, they inherit correct depth-based coloring from their parent

### Connection Deletion
1. User clicks a connection in hierarchy mode
2. Clicks "Delete" button or presses Backspace/Delete
3. **If template connection:** Dialog shows warning:
   ```
   Delete connection between:
   Source: ...
   Target: ...
   
   ⚠️ This connection belongs to template "n300_lb_superpod".
   Deleting it will remove this connection from ALL instances of this template.
   ```
4. User confirms → Connection deleted from all instances
5. Console shows: `Deleted connection from 4 template instance(s)`

### Export
- User makes changes (delete connections, add/remove nodes)
- Clicks "Export CablingDescriptor"
- Exported file reflects the current state exactly as visualized

---

## Testing

### Test Color Consistency
1. Upload `16_n300_lb_cluster.textproto`
2. Note the colors of existing superpods (orange borders)
3. Click "Add Graph" → Select a superpod template
4. Add a new instance
5. Verify: New instance has the same orange border as originals

### Test Template-Level Connection Deletion
1. Upload `16_n300_lb_cluster.textproto`
2. Enable connection editing mode
3. Click a connection within a superpod
4. Click "Delete" button
5. Verify: Warning dialog mentions template and ALL instances
6. Confirm deletion
7. Check: Connection is removed from all 4 superpod instances
8. Console: Shows "Deleted connection from 4 template instance(s)"

### Test Export Current State
1. Upload `16_n300_lb_cluster.textproto`
2. Delete a connection within a superpod template
3. Click "Export CablingDescriptor"
4. Open exported file
5. Verify: Superpod template has one fewer connection
6. Re-import the exported file
7. Verify: All superpod instances still missing that connection

---

## Technical Notes

### Performance
- Connection deletion uses efficient filtering: O(n) where n = number of template instances
- Template definition update uses JavaScript array filter (fast)
- No need to rebuild entire graph structure

### Edge Cases Handled
1. **Non-template connections** (in location mode): Deleted individually without affecting others
2. **Orphaned ports after deletion**: Visual status updated automatically
3. **Missing template metadata**: Falls back to single-connection deletion
4. **Invalid/removed edges**: Gracefully handled with validation checks

### Backward Compatibility
- ✅ Works with old descriptor files (no template_name on edges → single deletion)
- ✅ Works with CSV-based visualizations (no templates → normal deletion)
- ✅ Existing exports continue to work unchanged

---

## Future Enhancements (Not Yet Implemented)

### 2. Encompass Original Visualization
When adding a top-level cluster template to an existing visualization, could optionally:
- Detect that a cluster-level template is being added
- Create a new encompassing parent that contains both old and new
- Maintain unified hierarchy

**Status:** Requires clarification from user on desired behavior

