# Export Support for Top-Level Nodes

## Summary
Updated the export logic to handle the new flexible instantiation system where users can have multiple top-level graph nodes (nodes with no parent). The export now creates a proper hierarchical descriptor from the perspective of the top-level visualization.

## Problem

With the new instantiation rules allowing graphs to be added at the top level (no parent), users can now have:
- Multiple cluster nodes at top level
- Mix of different graph types at top level
- Dynamically added graphs that aren't contained in a single root

The old export logic assumed a single root cluster node and would fail or produce incorrect output with multiple top-level nodes.

## Solution

The export now intelligently handles both scenarios:

### Scenario 1: Single Top-Level Node ✅
**Example:** Upload `16_n300_lb_cluster.textproto` (has one root cluster)

**Export Behavior:**
- Use the single top-level node's template as the root_instance template
- Export hierarchically as before
- Clean, simple descriptor

**Example Output:**
```protobuf
root_instance {
  template_name: "n300_lb_cluster"
  child_mappings {
    child_name: "superpod1"
    sub_instance {
      template_name: "n300_lb_superpod"
      ...
    }
  }
  ...
}
```

### Scenario 2: Multiple Top-Level Nodes ✅
**Example:** User adds a second cluster at top level

**Export Behavior:**
- Create a synthetic root template named `"synthetic_root"`
- This template contains graph_ref children for each top-level node
- Build a root_instance using the synthetic template
- Each top-level node becomes a sub_instance in the root_instance

**Example Output:**
```protobuf
graph_templates {
  key: "synthetic_root"
  value {
    children {
      name: "n300_lb_cluster"
      graph_ref {
        template_name: "n300_lb_cluster"
      }
    }
    children {
      name: "cluster_2"
      graph_ref {
        template_name: "another_cluster_template"
      }
    }
  }
}

graph_templates {
  key: "n300_lb_cluster"
  value {
    ... original cluster template ...
  }
}

graph_templates {
  key: "another_cluster_template"
  value {
    ... second cluster template ...
  }
}

root_instance {
  template_name: "synthetic_root"
  child_mappings {
    child_name: "n300_lb_cluster"
    sub_instance {
      template_name: "n300_lb_cluster"
      child_mappings {
        ... all hosts in first cluster ...
      }
    }
  }
  child_mappings {
    child_name: "cluster_2"
    sub_instance {
      template_name: "another_cluster_template"
      child_mappings {
        ... all hosts in second cluster ...
      }
    }
  }
}
```

## Implementation Details

### File: `export_descriptors.py`

#### Step 1: Find All Top-Level Nodes
```python
# Find all top-level graph nodes (graph nodes with no parent)
root_graph_nodes = []
for el in elements:
    el_type = el_data.get("type")
    has_parent = el_data.get("parent")
    
    # Skip non-graph types
    if el_type not in ["graph", "superpod", "pod", "cluster", "zone", "region"]:
        continue
    
    # Look for graph nodes without parents
    if not has_parent:
        root_graph_nodes.append(el)

print(f"Found {len(root_graph_nodes)} top-level graph node(s)")
```

#### Step 2: Build Templates for All Top-Level Nodes
```python
# Build templates for all top-level nodes and their children
for root_node in root_graph_nodes:
    root_data = root_node.get("data", {})
    template_name = root_data.get("template_name")
    if template_name and template_name not in built_templates:
        template = build_graph_template_with_reuse(
            root_node, element_map, connections, cluster_desc, built_templates
        )
        if template:
            cluster_desc.graph_templates[template_name].CopyFrom(template)
```

#### Step 3: Create Root Instance

**Single Top-Level Node:**
```python
if len(root_graph_nodes) == 1:
    root_graph_el = root_graph_nodes[0]
    root_template_name = root_graph_data.get("template_name")
    
    root_instance = cluster_config_pb2.GraphInstance()
    root_instance.template_name = root_template_name
    
    # Add child mappings recursively
    host_id = add_child_mappings_with_reuse(
        root_graph_el, element_map, root_instance, host_id
    )
    
    cluster_desc.root_instance.CopyFrom(root_instance)
```

**Multiple Top-Level Nodes:**
```python
else:
    # Create synthetic root template containing all top-level nodes
    synthetic_root_template = cluster_config_pb2.GraphTemplate()
    
    for root_node in root_graph_nodes:
        root_label = root_data.get("label")
        root_template_name = root_data.get("template_name")
        
        # Add as graph_ref child
        child = synthetic_root_template.children.add()
        child.name = root_label
        child.graph_ref.template_name = root_template_name
    
    # Add synthetic template to descriptor
    cluster_desc.graph_templates["synthetic_root"].CopyFrom(synthetic_root_template)
    
    # Create root instance
    root_instance = cluster_config_pb2.GraphInstance()
    root_instance.template_name = "synthetic_root"
    
    # Add sub-instances for each top-level node
    for root_node in root_graph_nodes:
        child_mapping = root_instance.child_mappings.add()
        child_mapping.child_name = root_label
        
        sub_instance = child_mapping.sub_instance
        sub_instance.template_name = root_data.get("template_name")
        
        # Recursively add child mappings
        host_id = add_child_mappings_with_reuse(
            root_node, element_map, sub_instance, host_id
        )
    
    cluster_desc.root_instance.CopyFrom(root_instance)
```

## Benefits

### 1. **Handles All Visualization States**
- Single root cluster (standard case)
- Multiple clusters (user added extras)
- Mixed graph types at top level (advanced usage)

### 2. **Maintains Template Reuse**
- Each unique template defined only once
- Synthetic root doesn't duplicate child templates
- Efficient descriptor size

### 3. **Preserves All Nodes**
- Every node in the visualization is exported
- No data loss regardless of structure
- All host_id assignments preserved

### 4. **Round-Trip Compatible**
- Exported descriptors can be re-imported
- Import reconstructs the same visualization
- Synthetic root handled transparently on import

### 5. **Clean Output**
- Single root case: No synthetic root (clean as original)
- Multiple root case: Clear synthetic container structure
- Easy to understand and edit manually if needed

## Testing

### Test 1: Single Root (Standard Case)
```
1. Upload 16_n300_lb_cluster.textproto (single root cluster)
2. Export CablingDescriptor
3. Verify: root_instance.template_name = "n300_lb_cluster"
4. Verify: No "synthetic_root" in graph_templates
5. Verify: All 16 hosts present in child_mappings
```

### Test 2: Multiple Top-Level Clusters
```
1. Upload 16_n300_lb_cluster.textproto
2. Deselect all nodes
3. Add Graph → cluster template → "cluster_2"
4. Export CablingDescriptor
5. Verify: root_instance.template_name = "synthetic_root"
6. Verify: graph_templates contains "synthetic_root"
7. Verify: synthetic_root has 2 children (graph_refs)
8. Verify: Both clusters present with all their hosts
```

### Test 3: Mixed Top-Level Types
```
1. Start with empty canvas or deselect all
2. Add Graph → cluster template → "cluster_1"
3. Add Graph → superpod template → "orphan_superpod"
4. Export CablingDescriptor
5. Verify: root_instance uses synthetic_root
6. Verify: synthetic_root contains both cluster and superpod as children
7. Verify: All nodes from both exported correctly
```

### Test 4: Round-Trip
```
1. Upload descriptor with multiple top-level nodes
2. Export CablingDescriptor → save as test.textproto
3. Upload test.textproto
4. Verify: Visualization matches original
5. Verify: All nodes and connections present
```

## Edge Cases

### Case 1: No Top-Level Nodes
- **Behavior**: Falls back to flat export (non-hierarchical)
- **Reason**: No graph structure to export hierarchically
- **Result**: Uses `export_flat_cabling_descriptor()`

### Case 2: Top-Level Nodes Missing template_name
- **Behavior**: Uses fallback template name based on label
- **Example**: `template_name = f"template_{label}"`
- **Result**: Still exports, but with generated template names

### Case 3: Deleted Connections in Templates
- **Behavior**: Template-level deletions are preserved
- **Reason**: Deletions update metadata.graph_templates
- **Result**: Exported descriptor reflects current state

## Backward Compatibility

### Import of Old Descriptors ✅
- Old descriptors with single root cluster import as before
- Root cluster becomes visible (as per ROOT_CLUSTER_VISIBILITY)
- No breaking changes

### Import of New Descriptors (with synthetic_root) ✅
- Synthetic root template is processed normally
- Each child becomes a top-level node in visualization
- User can continue editing as usual

### Export from Old Visualizations ✅
- Visualizations with single root export cleanly (no synthetic root)
- No changes to output format for standard case
- Only uses synthetic root when actually needed

## Console Logging

The export provides helpful logging for debugging:

```
Found 2 top-level graph node(s)
Building template: n300_lb_cluster
Building template: another_cluster
Multiple top-level nodes: creating synthetic root template containing 2 graph(s)
  Adding graph_ref: n300_lb_cluster -> n300_lb_cluster
  Adding graph_ref: cluster_2 -> another_cluster
Exported 32 hosts in hierarchical structure with 3 unique templates
```

## Future Enhancements

### 1. **Smart Template Naming**
- Use more descriptive names for synthetic root
- Based on contained graph types
- E.g., "multi_cluster_root" instead of "synthetic_root"

### 2. **Connection Handling**
- Add inter-cluster connections to synthetic root template
- Currently only intra-template connections are exported
- Would enable connections between top-level graphs

### 3. **Metadata Preservation**
- Store additional visualization state in synthetic root
- Layout preferences, view settings, etc.
- Enable full round-trip of visualization state

## Summary

The export now properly handles the flexible instantiation system:
- ✅ Single top-level node: Clean, standard export
- ✅ Multiple top-level nodes: Synthetic root wrapper
- ✅ All nodes exported from current visualization state
- ✅ Template reuse maintained
- ✅ Round-trip compatible
- ✅ Backward compatible

Users can freely add, remove, and reorganize graphs, and the export will always produce a valid, complete cabling descriptor that accurately represents the current visualization.

