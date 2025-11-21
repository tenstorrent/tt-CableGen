# Hierarchical Cabling Descriptor Solution

## Overview

The cabling descriptor import/export now correctly preserves hierarchical graph template structures using Cytoscape's parent-child compound node system with an **implicit root cluster**.

## Key Concepts

### 1. Leverage Cytoscape's Parent Hierarchy

Instead of trying to reconstruct hierarchies during export, we use Cytoscape's built-in compound node structure:

```
Visualization (Implicit Root):
superpod1 (ROOT node, template=n300_lb_superpod)
superpod2 (ROOT node, template=n300_lb_superpod)
superpod3 (ROOT node, template=n300_lb_superpod)
superpod4 (ROOT node, template=n300_lb_superpod)
  └── node1 (parent=superpod, type=shelf)
  └── node2 (parent=superpod, type=shelf)
  └── ...

Export (Inferred Root):
cluster (template=n300_lb_cluster) - implicit, from metadata
├── superpod1 (template=n300_lb_superpod)
├── superpod2 (template=n300_lb_superpod)
└── ...
```

### 2. Tag Everything at Import

Each node and connection is tagged with its template during import:
- **Nodes**: `data.template_name = "n300_lb_superpod"`
- **Connections**: Stored in metadata grouped by template
- **Root Template**: Stored in `metadata.graph_templates`

### 3. No String Parsing

Uses explicit `child_name` field instead of parsing labels:
- ✅ `data.child_name = "node1"` (stored during import)
- ❌ `label.split(' (')[0]` (fragile string parsing)

### 4. Implicit Root Cluster

The root cluster node:
- **Not visualized** - keeps UI clean, avoids redundant wrapper
- **Preserved in metadata** - available for export
- **Inferred during export** - from `graph_templates` metadata

## Architecture

### Import Flow (`import_cabling.py`)

```python
parse_cabling_descriptor()
  ├── HierarchyResolver.resolve_hierarchy()
  │   └── Store template names for each path
  ├── Store graph_templates in metadata
  └── _create_graph_hierarchy()
      ├── Create compound nodes for each graph path (excluding root)
      ├── Set parent relationships
      └── Tag with template_name
```

**Key Fields Set During Import:**
- `node.data.template_name` - which template this node is an instance of
- `node.data.child_name` - template-relative name (e.g., "node1")
- `node.data.type` - "graph" for containers, "shelf" for leaf nodes
- `node.data.parent` - parent node ID (null for top-level)
- `metadata.graph_templates` - complete template structures with connections

### Export Flow (`export_descriptors.py`)

```python
export_cabling_descriptor_for_visualizer()
  └── if metadata has graph_templates:
      └── export_from_metadata_templates()
          ├── Find root template (has children of type 'graph')
          ├── Build all GraphTemplate protos from metadata
          ├── Walk Cytoscape nodes to build GraphInstance hierarchy
          └── Return protobuf text format
```

**Export Logic:**
1. Check if `metadata.graph_templates` exists (from descriptor import)
2. If yes: Use metadata templates directly (preserves original structure)
3. If no: Build templates from Cytoscape node structure (for CSV imports)

## Benefits

✅ **Clean Visualization** - No redundant root cluster node  
✅ **Correct Export** - Root template inferred from metadata  
✅ **No Detection Logic** - Templates already tagged  
✅ **No String Parsing** - Uses explicit `child_name` field  
✅ **User-Friendly** - Users can name things however they want  
✅ **Template Reuse** - Each template defined once, referenced many times  
✅ **Hierarchy Preserved** - Connection depths maintained correctly  

## Example

**Input**: `16_n300_lb_cluster.textproto`
```protobuf
graph_templates {
  key: "n300_lb_superpod"
  value {
    children { name: "node1" ... }
    children { name: "node2" ... }
    internal_connections { ... }  # 6 superpod-level connections
  }
}
graph_templates {
  key: "n300_lb_cluster"
  value {
    children { name: "superpod1" graph_ref { graph_template: "n300_lb_superpod" } }
    children { name: "superpod2" ... }
    internal_connections { ... }  # 6 cluster-level connections
  }
}
```

**Visualization**:
- 4 superpod nodes (ROOT level, no parent)
- 16 shelf nodes (children of superpods)
- No visible cluster node (implicit)

**Export**: Matches input exactly!
- 2 templates (superpod + cluster)
- 6 connections per template
- Root cluster inferred from metadata

## Files Modified

1. **`import_cabling.py`**
   - `_create_graph_hierarchy()`: Don't create visual root node
   - `_create_graph_compound_node()`: Top-level graphs have no parent
   - `_create_node_instance()`: Store `child_name` field

2. **`export_descriptors.py`**
   - `export_from_metadata_templates()`: New function for metadata-based export
   - `export_hierarchical_cabling_descriptor()`: Check for metadata first
   - Use `child_name` field instead of parsing labels

## Testing

```bash
# Import descriptor
python3 import_cabling.py 16_n300_lb_cluster.textproto

# Visualize (superpods are ROOT, no cluster node shown)

# Export back
python3 export_descriptors.py

# Verify: should match original exactly
diff original.textproto exported.textproto
```

**Expected Result**: ✅ Identical files (except formatting)

