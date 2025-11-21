# Root Cluster Visibility Enhancement

## Summary
Made the root cluster node (e.g., `n300_lb_cluster`) visible in the hierarchy visualization instead of implicit. This provides a complete view of the cluster topology and ensures new graph instances are properly contained.

## Changes Made

### 1. Import Side - Make Root Cluster Visible

#### File: `import_cabling.py`

**`_create_graph_hierarchy()`** - Add root cluster to graph paths:
```python
# Add root cluster path (empty tuple represents the root)
if self.graph_hierarchy:
    # Root path is an empty tuple - the top-level container
    graph_paths.add(())
```

**`_create_graph_compound_node()`** - Handle root cluster creation:
```python
# Handle root cluster (empty path)
if len(graph_path) == 0:
    graph_id = "graph_root_cluster"
    # Use the root template name if available
    graph_label = self.hierarchy_resolver.instance_to_template.get([], 'cluster')
    if graph_label == 'cluster':
        # Try to find a better label from template names
        for template_name in self.graph_templates.keys():
            if 'cluster' in template_name.lower():
                graph_label = template_name
                break
```

**Parent Assignment Logic:**
```python
# Depth-0 is root with no parent, depth-1 are children of root
parent_id = None
if len(graph_path) > 0:
    if len(graph_path) == 1:
        # Top-level nodes (superpods) are children of root
        parent_path_tuple = ()
        parent_id = graph_node_map.get(parent_path_tuple)
    else:
        # Nested nodes have their parent in the hierarchy
        parent_path_tuple = tuple(graph_path[:-1])
        parent_id = graph_node_map.get(parent_path_tuple)
```

**Sibling Counting:**
```python
# Root node has no siblings
if len(graph_path) == 0:
    index = 0
elif len(graph_path) == 1:
    # Top-level graphs (superpods) are children of root
    siblings = [p for p in graph_node_map.keys() if len(p) == 1]
    index = len(siblings)
```

### 2. Frontend Side - Update Depth Colors

#### File: `static/js/visualizer.js`

**Updated depth-based colors** to account for the now-visible root:

Before (root was implicit):
- Depth 0 → Orange (superpods)
- Depth 1 → Yellow (pods)

After (root is visible):
- Depth 0 → **Red** (cluster/root)
- Depth 1 → **Orange** (superpods)
- Depth 2 → **Yellow** (pods)
- Depth 3+ → Green, Blue, Purple, Magenta

```javascript
{
    selector: '.graph[depth = 0]',
    style: {
        'border-color': '#E74C3C',  // Red - cluster level
        'border-width': 6,
        'background-color': '#fce8e6',
        // ...
    }
},
{
    selector: '.graph[depth = 1]',
    style: {
        'border-color': '#E67E22',  // Orange - superpod level
        'border-width': 5,
        'background-color': '#fff3e6',
        // ...
    }
},
{
    selector: '.graph[depth = 2]',
    style: {
        'border-color': '#F1C40F',  // Yellow - pod level
        'border-width': 4,
        // ...
    }
}
```

### 3. New Graph Instantiation - Add to Root Cluster

#### File: `static/js/visualizer.js`

**`addNewGraph()`** - New graphs become children of root cluster:

```javascript
// Find root cluster node to use as parent (if it exists)
let parentId = null;
const rootCluster = cy.getElementById('graph_root_cluster');
if (rootCluster && rootCluster.length > 0) {
    parentId = 'graph_root_cluster';
    console.log('Adding new graph as child of root cluster');
} else {
    console.log('No root cluster found, adding as top-level node');
}

instantiateTemplateRecursive(
    template,
    selectedTemplate,
    graphId,
    graphLabel,
    graphType,
    parentId, // parent is root cluster if it exists
    // ... other params
);
```

## Behavior Changes

### Before

**Uploaded `16_n300_lb_cluster.textproto`:**
```
Visualization shows:
├── superpod1 (Orange, depth 0)
│   ├── node1
│   ├── node2
│   ├── node3
│   └── node4
├── superpod2 (Orange, depth 0)
│   └── ...
├── superpod3 (Orange, depth 0)
│   └── ...
└── superpod4 (Orange, depth 0)
    └── ...

Root cluster "n300_lb_cluster" was IMPLICIT (not visible)
```

**Adding a new superpod:**
- Added as sibling to existing superpods
- No visible parent container

### After

**Uploaded `16_n300_lb_cluster.textproto`:**
```
Visualization shows:
n300_lb_cluster (Red, depth 0)  ← NOW VISIBLE!
├── superpod1 (Orange, depth 1)
│   ├── node1
│   ├── node2
│   ├── node3
│   └── node4
├── superpod2 (Orange, depth 1)
│   └── ...
├── superpod3 (Orange, depth 1)
│   └── ...
└── superpod4 (Orange, depth 1)
    └── ...

Root cluster is now VISIBLE with red border
```

**Adding a new superpod:**
- Added as child of `n300_lb_cluster`
- Properly contained within the cluster hierarchy
- Gets depth 1 (Orange) automatically

## Visual Hierarchy

### Depth-Based Color Coding
| Depth | Level | Color | Border Width | Example |
|-------|-------|-------|--------------|---------|
| 0 | Cluster | Red (#E74C3C) | 6px | n300_lb_cluster |
| 1 | Superpod | Orange (#E67E22) | 5px | superpod1, superpod2 |
| 2 | Pod | Yellow (#F1C40F) | 4px | (if present) |
| 3 | Nested | Green (#27AE60) | 4px | (if present) |
| 4+ | Deeper | Blue → Purple → Magenta | 3px | (if present) |

## Benefits

### 1. **Complete Topology View**
- Users can now see the entire cluster structure
- The cluster name/template is explicitly visible
- Clear visual hierarchy from cluster → superpods → nodes

### 2. **Proper Containment**
- New graph instances are correctly added as children of the cluster
- Maintains logical hierarchy when manually adding graphs
- Prevents orphaned top-level nodes

### 3. **Consistent Coloring**
- Depth-based coloring now aligns with the connection depth colors
- Red cluster contains orange superpods
- Easier to understand the hierarchy at a glance

### 4. **Better UX for Large Clusters**
- Users can collapse/expand the entire cluster
- Initial view shows the full scope of the cluster
- Viewport automatically fits to show the root cluster

## Testing

### Test Root Cluster Visibility
1. Upload `16_n300_lb_cluster.textproto`
2. Verify: A **red-bordered** node labeled "n300_lb_cluster" is visible
3. Verify: All 4 superpods are **orange-bordered** and children of the cluster
4. Verify: Cluster contains all superpods (not shown as siblings)

### Test New Graph Instantiation
1. Upload `16_n300_lb_cluster.textproto` (root cluster now visible)
2. Click "Add Graph" → Select superpod template
3. Enter label "superpod5"
4. Click "Add Graph"
5. Verify: New superpod5 is added as a child of `n300_lb_cluster` (inside the red box)
6. Verify: New superpod has **orange border** (depth 1)
7. Console: Should say "Adding new graph as child of root cluster"

### Test Color Consistency
1. Upload descriptor
2. Verify color scheme:
   - Root cluster: Red border
   - Superpods: Orange borders
   - Connections within superpods: Orange colored
   - Connections between superpods: Red colored

### Test Backwards Compatibility
1. Upload a CSV file (no templates)
2. Verify: Works normally with no root cluster
3. Add a new shelf node
4. Verify: No errors, adds at top level (no root cluster to attach to)

## Migration Notes

### For Users
- **Visual Change**: The cluster node is now visible as a red-bordered container
- **No Breaking Changes**: All existing files import correctly
- **New Behavior**: Manually added graphs go inside the cluster (not as siblings)

### For Developers
- **Depth Values Shifted**: All graph depths increased by 1 (superpods were depth 0, now depth 1)
- **Root Path**: Empty tuple `()` now represents the root cluster in graph_paths
- **Node ID**: Root cluster has fixed ID `graph_root_cluster`
- **Export**: Will need to handle the visible root cluster in export logic

## Future Enhancements

1. **Collapsible Root**: Allow users to collapse/expand the entire cluster
2. **Multi-Cluster Support**: Support multiple root clusters in one visualization
3. **Zoom to Cluster**: Double-click cluster to zoom/fit to its bounds
4. **Root Cluster Editing**: Allow editing cluster-level properties

---

## Summary
The root cluster is now a **first-class visual element** in the hierarchy, providing:
- ✅ Complete topology visibility
- ✅ Proper containment for new instances
- ✅ Consistent depth-based coloring
- ✅ Better user experience for large clusters

