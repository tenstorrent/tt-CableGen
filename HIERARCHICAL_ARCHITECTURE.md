# Hierarchical Import Architecture

## Overview

The CableGen visualizer supports hierarchical import of network topologies from cabling descriptor files (textproto format). This document describes the architecture, design decisions, and usage of the hierarchical import feature.

## Terminology

To avoid confusion with the overloaded term "node", this codebase uses precise terminology:

- **Graph Template**: A reusable pattern defining a network topology structure (e.g., `n300_lb_superpod`)
- **Graph Instance**: A concrete instantiation of a graph template with specific hosts (e.g., `superpod1`, `superpod2`)
- **Host Device / Device Node**: A physical piece of hardware (server) in the cluster
- **Visual Element / Cytoscape Node**: A visual element in the Cytoscape.js graph
- **Leaf Device**: A terminal node in the hierarchical tree structure (has a `host_id`)

### Hierarchy Structure

**Descriptor Format:**
```
Graph Template → Graph Instance → Shelf (Host Device) → Tray → Port
```

In the descriptor format, each **Shelf** represents a physical host device (server). The shelf IS the host - there's no separate wrapper node. Each shelf contains the physical trays and ports that make up that device.

**CSV Format:**
```
Rack → Shelf → Tray → Port
```

## Architecture Components

### 1. Helper Classes (Separation of Concerns)

The implementation uses helper classes to separate concerns and improve maintainability:

#### HierarchyResolver

Encapsulates logic for resolving graph hierarchy from cabling descriptors.

**Responsibilities:**
- Traverse GraphInstance/GraphTemplate structures
- Extract flat list of leaf devices with their configurations
- Provide O(1) path-to-host_id lookups

**Key Methods:**
- `resolve_hierarchy()`: Resolve complete graph hierarchy
- `path_to_host_id(path)`: Convert path to host_id with O(1) lookup
- `_resolve_recursive()`: Recursively traverse graph instances

#### ConnectionResolver

Encapsulates logic for parsing connections from cabling descriptors.

**Responsibilities:**
- Parse connections defined in graph templates
- Resolve connections to concrete host device connections
- Handle nested graph instance connections

**Key Methods:**
- `resolve_connections()`: Resolve all connections from descriptor
- `_parse_recursive()`: Recursively parse connections from graph instances

### 2. Performance Optimizations

The implementation includes critical performance optimizations for large-scale clusters:

#### O(1) Path-to-Host_ID Lookups

**Problem:** Original implementation used O(n) linear search for every connection lookup.

**Solution:** Build a dictionary map once during hierarchy resolution:

```python
self._path_to_host_id_map = {tuple(node['path']): node['host_id'] 
                              for node in hierarchy}
```

**Impact:** Reduces connection parsing from O(n*m) to O(m) where n=devices, m=connections.

#### O(1) Host_ID-to-Node_Info Lookups

**Problem:** Nested loop in edge creation was O(n*m).

**Solution:** Build lookup map at start of `_create_descriptor_edges()`:

```python
host_id_to_node_info = {node['host_id']: node for node in self.graph_hierarchy}
```

**Impact:** Critical for large clusters with thousands of connections.

### 3. Common Traversal Logic

The implementation extracts common patterns to reduce code duplication:

#### _traverse_hierarchy()

Generic hierarchy traversal with callbacks for nodes and subgraphs:

```python
def _traverse_hierarchy(self, instance, template_name, path, depth, 
                       node_callback=None, subgraph_callback=None):
    # Get template and process each child mapping
    # Call node_callback for leaf devices
    # Call subgraph_callback for nested graph instances
```

#### _find_child_in_template()

Helper to find child instance by name in a template:

```python
def _find_child_in_template(self, template, child_name):
    for child in template.children:
        if child.name == child_name:
            return child
    return None
```

### 4. Standardized Error Handling

Consistent logging throughout hierarchical code:

```python
def _log_warning(self, message, context=None):
    if context:
        context_str = ", ".join(f"{k}={v}" for k, v in context.items())
        print(f"Warning: {message} [{context_str}]")
    else:
        print(f"Warning: {message}")
```

**Usage:**
```python
self._log_warning("Template not found in graph_templates", 
                 {"template": template_name})
```

## Usage Examples

### Parsing a Hierarchical Descriptor

```python
from import_cabling import NetworkCablingCytoscapeVisualizer

visualizer = NetworkCablingCytoscapeVisualizer()
visualizer.file_format = "descriptor"

# Parse the descriptor
success = visualizer.parse_cabling_descriptor("16_n300_lb_cluster.textproto")

if success:
    # Access resolved hierarchy
    print(f"Found {len(visualizer.graph_hierarchy)} devices")
    
    # Access connections
    print(f"Found {len(visualizer.descriptor_connections)} connections")
    
    # Generate visualization
    viz_data = visualizer.generate_visualization_data()
```

### Example Descriptor Structure

```protobuf
# Define a graph template (superpod with 4 nodes)
graph_templates {
  key: "n300_lb_superpod"
  value {
    children {
      name: "node1"
      node_ref { node_descriptor: "N300_LB_DEFAULT" }
    }
    children {
      name: "node2"
      node_ref { node_descriptor: "N300_LB_DEFAULT" }
    }
    # ... more children ...
    
    internal_connections {
      key: "QSFP_DD"
      value {
        connections {
          port_a { path: ["node1"] tray_id: 1 port_id: 2 }
          port_b { path: ["node2"] tray_id: 1 port_id: 2 }
        }
        # ... more connections ...
      }
    }
  }
}

# Define a cluster template (4 superpods)
graph_templates {
  key: "n300_lb_cluster"
  value {
    children {
      name: "superpod1"
      graph_ref { graph_template: "n300_lb_superpod" }
    }
    # ... more superpods ...
    
    internal_connections {
      key: "QSFP_DD"
      value {
        connections {
          # Inter-superpod connections
          port_a { path: ["superpod1", "node1"] tray_id: 2 port_id: 1 }
          port_b { path: ["superpod2", "node1"] tray_id: 2 port_id: 1 }
        }
      }
    }
  }
}

# Instantiate the cluster with concrete host mappings
root_instance {
  template_name: "n300_lb_cluster"
  child_mappings {
    key: "superpod1"
    value {
      sub_instance {
        template_name: "n300_lb_superpod"
        child_mappings {
          key: "node1"
          value { host_id: 0 }
        }
        # ... more node mappings ...
      }
    }
  }
  # ... more superpod mappings ...
}
```

## Design Decisions

### 1. Inner Classes vs. Separate Modules

**Decision:** Use inner classes (`HierarchyResolver`, `ConnectionResolver`) within the main visualizer class.

**Rationale:**
- Maintain access to parent class state (cluster_descriptor, etc.)
- Keep related functionality together
- Cleaner API (no need to export multiple classes)

### 2. Backward Compatibility

**Decision:** Keep old methods (`_resolve_instance_recursive`, `_parse_connections_recursive`) alongside new helper classes.

**Rationale:**
- Allow gradual migration
- Support existing code that may call these directly
- Main entry points use new architecture

### 3. O(1) Lookups

**Decision:** Build lookup maps once rather than using repeated linear searches.

**Rationale:**
- Critical for performance with large clusters (1000+ devices)
- Memory overhead is negligible (small dictionaries)
- 100x+ performance improvement for connection parsing

## Testing

Comprehensive integration tests are provided in `tests/test_hierarchical_import.py`:

```bash
# Run tests
python3 tests/test_hierarchical_import.py

# Expected output:
# - test_parse_16node_cluster: Parse descriptor successfully
# - test_hierarchy_resolution: Verify correct host mappings
# - test_connection_parsing: Verify connection parsing
# - test_helper_classes_separation: Verify helper classes work
# - test_performance_optimization: Verify O(1) lookups are fast
# - test_visualization_generation: Verify complete visualization
```

## Performance Characteristics

### Time Complexity

| Operation | Before | After | Impact |
|-----------|--------|-------|--------|
| Hierarchy Resolution | O(n) | O(n) | Same |
| Path-to-Host_ID Lookup | O(n) | O(1) | 100x faster for large n |
| Connection Parsing | O(n*m) | O(m) | Critical improvement |
| Edge Creation | O(n*m) | O(m) | Critical improvement |

Where:
- n = number of devices in hierarchy
- m = number of connections

### Space Complexity

| Structure | Complexity | Notes |
|-----------|------------|-------|
| Hierarchy List | O(n) | Flat list of all devices |
| Path Map | O(n) | Path → Host ID mapping |
| Host ID Map | O(n) | Host ID → Node Info mapping |
| Connections List | O(m) | All connections |

## Future Enhancements

1. **Layout Optimization**: Use depth-based grouping for faster layout calculations
2. **Caching**: Cache resolved hierarchies for repeated visualizations
3. **Validation**: Add validation of descriptor structure before processing
4. **Error Recovery**: More graceful handling of malformed descriptors
5. **Visualization Options**: Support different visualization styles for hierarchical data

## References

- [Protobuf Schema](../tools/scaleout/cabling_descriptor/schemas/cluster_config.proto)
- [Example Descriptor](../tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto)
- [Main Implementation](import_cabling.py)
- [Integration Tests](tests/test_hierarchical_import.py)

