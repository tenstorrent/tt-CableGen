# Empty Canvas Export - Host List/Enumeration Consistency

## Overview

This document describes how the empty canvas feature maintains correct host list/enumeration consistency when exporting CablingDescriptor and DeploymentDescriptor files.

## Background

The cabling generator (`cabling_generator.cpp`) requires that CablingDescriptor and DeploymentDescriptor have the **exact same host list in the exact same order** because it uses `host_id` indices to map between them:

- **CablingDescriptor**: Maps child names to `host_id` indices via `child_mappings[hostname].host_id = i`
- **DeploymentDescriptor**: Lists hosts by index in `deployment_descriptor.hosts[i]`

If these indices don't match, the cabling generator will produce incorrect results.

## Empty Canvas Workflow

1. User clicks "Create Empty Canvas" button
2. User adds nodes manually using the "Add Node" button
3. User draws connections between ports using the edge handles
4. User exports CablingDescriptor and/or DeploymentDescriptor

## Implementation Details

### Frontend (visualizer.js)

#### `createEmptyVisualization()`
- Initializes an empty Cytoscape visualization
- Creates empty data structure with `elements: []` array
- Enables connection editing mode
- Documented to work with export functionality

#### `addNewNode()`
- Creates shelf nodes with all required fields for export:
  - `hostname`: Required for host identification
  - `shelf_node_type`: Required for node type (WH_GALAXY, N300_LB, BH_GALAXY, P150_LB, etc.)
  - `hall`, `aisle`, `rack_num`, `shelf_u`: Optional location data for DeploymentDescriptor
- These fields are exactly what the export logic expects

### Backend (export_descriptors.py)

#### `extract_host_list_from_connections()`
This is the **critical function** that ensures consistency. It:

1. Extracts hosts from **connections** (connected shelf nodes)
2. Extracts **standalone shelf nodes** (nodes without connections)
3. Returns a **sorted list** (alphabetically by hostname)
4. Used by **BOTH** export functions to ensure identical host lists

#### `export_flat_cabling_descriptor()`
- Calls `extract_host_list_from_connections()` to get the sorted host list
- Assigns `host_id = i` based on position in sorted list
- Creates `child_mappings[hostname].host_id = i`

#### `export_deployment_descriptor_for_visualizer()`
- Calls `extract_host_list_from_connections()` to get the **same** sorted host list
- Iterates in the **same order** to create `deployment_descriptor.hosts[i]`
- Ensures `hosts[i]` matches the `host_id = i` from CablingDescriptor

## Verification

### Test Script: `test_empty_canvas_export.py`

A comprehensive test script verifies the entire workflow:

```bash
cd /proj_sw/user_dev/agupta/tt-CableGen
python3 test_empty_canvas_export.py
```

The test:
1. Creates simulated empty canvas data with 3 nodes (2 connected, 1 standalone)
2. Extracts the host list
3. Exports CablingDescriptor and verifies `host_id` assignments
4. Exports DeploymentDescriptor and verifies host order
5. Confirms both descriptors have the same host list in the same order

### Expected Output

```
✓ ALL TESTS PASSED

Summary:
  - Host list extraction works correctly for empty canvas
  - Both connected and standalone nodes are included
  - Host list is sorted alphabetically
  - CablingDescriptor host_id assignments match host list indices
  - DeploymentDescriptor hosts are in same order as CablingDescriptor
```

## Key Guarantees

1. **Consistency**: Both descriptors use the same `extract_host_list_from_connections()` function
2. **Completeness**: All nodes are included (both connected and standalone)
3. **Ordering**: Hosts are sorted alphabetically by hostname
4. **Index Mapping**: `CablingDescriptor.child_mappings[hostname].host_id = i` matches `DeploymentDescriptor.hosts[i]`

## Troubleshooting

If exports produce mismatched host lists:

1. **Verify node data**: Check that shelf nodes have `hostname` and `shelf_node_type` fields
   ```javascript
   // In browser console:
   cy.nodes('[type="shelf"]').forEach(n => {
       console.log(n.id(), n.data('hostname'), n.data('shelf_node_type'));
   });
   ```

2. **Run the test**: Execute `test_empty_canvas_export.py` to verify the logic

3. **Check backend logs**: Look for errors in `extract_host_list_from_connections()`

## Related Files

- `static/js/visualizer.js`: Frontend implementation (createEmptyVisualization, addNewNode)
- `export_descriptors.py`: Backend export logic (extract_host_list_from_connections)
- `test_empty_canvas_export.py`: Verification test
- `server.py`: Export endpoints (/export_cabling_descriptor, /export_deployment_descriptor)

## References

- Issue: "visualizer.js:2460 Error initializing Cytoscape: Cannot read properties of undefined (reading 'length')"
  - Fixed by adding `elements: []` to empty data structure
  
- Feature Request: "ensure that on export of cabling and deployment descriptors that the host lists/enumeration were correctly associated"
  - Verified through test script and documentation


