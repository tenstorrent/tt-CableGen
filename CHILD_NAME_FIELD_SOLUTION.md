# Solution: Using `child_name` Field Instead of String Parsing

## Problem

The initial fix used string parsing to extract template-relative names from labels:
```python
child_name = child_label.split(' (')[0] if ' (' in child_label else child_label
```

This was fragile - users could include " (" in their naming and break the logic.

## Solution

Use the dedicated `child_name` field that's already stored in the cytoscape data during import.

### Data Structure

During import (`import_cabling.py`), shelf nodes are created with explicit fields:

```python
shelf_node = self.create_node_from_template(
    "shelf",
    shelf_id,
    parent_id,
    shelf_label,  # Display label: "node1 (host_0)"
    x, y,
    child_name=child_name,  # ✅ Template-relative name: "node1"
    hostname=child_name,     # Also stored for backwards compatibility
    ...
)
```

**Key Fields**:
- `label`: Display text, may include decorations like "(host_0)"
- `child_name`: Clean template-relative name from the descriptor
- `hostname`: Also set to child_name for backwards compatibility

### Export Changes

All export functions now use `child_name` instead of parsing `label` or using `hostname`:

#### 1. Template Children
```python
# Before: Used hostname or parsed label
child_name = child_label.split(' (')[0]  # ❌ Fragile parsing

# After: Use dedicated field
child_name = child_data.get("child_name", child_label)  # ✅ Clean, explicit
```

#### 2. Connection Filtering
```python
# Build set of template child names for this instance
child_names = set()
for child_el in children:
    if child_type == "shelf":
        child_name = child_data.get("child_name")  # ✅ Explicit field
        if child_name:
            child_names.add(child_name)
```

#### 3. Child Mappings
```python
# Use child_name for GraphInstance child_mappings
child_name = child_data.get("child_name", child_label)  # ✅ Explicit field
graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
```

#### 4. Path Resolution
```python
def get_path_to_host(child_name, scope_node_id, element_map):
    """Get path using child_name"""
    # Find shelf by child_name
    if data.get("type") == "shelf" and data.get("child_name") == child_name:
        shelf_node = el
        break
```

## Benefits

✅ **No String Parsing**: No delimiters to worry about  
✅ **User-Friendly**: Users can name things however they want  
✅ **Explicit**: Clear semantic meaning of each field  
✅ **Robust**: Won't break on special characters in labels  

## Field Semantics

| Field | Purpose | Example |
|-------|---------|---------|
| `child_name` | Template-relative identifier | "node1" |
| `label` | Display text (may be decorated) | "node1 (host_0)" |
| `hostname` | Alternate field (set to child_name) | "node1" |

## Files Modified

1. `/proj_sw/user_dev/agupta/tt-CableGen/export_descriptors.py`
   - `build_graph_template_with_reuse()`: Use `child_name` for template children (line 744)
   - Connection filtering: Use `child_name` to identify instance children (lines 786, 810)
   - `add_child_mappings_with_reuse()`: Use `child_name` for mappings (line 881)
   - `add_child_mappings_recursive()`: Use `child_name` for mappings (line 1113)
   - `get_path_to_host()`: Search by `child_name` field (line 1051, 1071)

## Result

Templates now cleanly use template-relative names without any string parsing:

```protobuf
graph_templates {
  key: "n300_lb_superpod"
  value {
    children {
      name: "node1"  # ✅ From child_name field
      node_ref { node_descriptor: "N300_LB_DEFAULT" }
    }
    children {
      name: "node2"  # ✅ No parsing required
      node_ref { node_descriptor: "N300_LB_DEFAULT" }
    }
    internal_connections {
      connections {
        port_a { path: "node1" ... }  # ✅ Clean template names
        port_b { path: "node4" ... }
      }
    }
  }
}
```

Users can now freely use any characters in their display labels without breaking the export logic!

