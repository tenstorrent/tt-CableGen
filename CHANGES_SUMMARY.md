# Summary of Changes: Host Index Recalculation Feature

## Overview
Implemented automatic recalculation of `host_indices` in hierarchy mode to ensure siblings within each template instance have consecutive host numbering. This makes it easier to export `cabling_descriptor` and have cleanly associated host_indices.

## Files Modified

### 1. `/proj_sw/user_dev/agupta/tt-CableGen/static/js/visualizer.js`

#### New Function Added (lines 2200-2269):
- `recalculateHostIndicesForTemplates()`: Core function that renumbers all shelf nodes
  - Groups shelf nodes by parent graph instance
  - Sorts siblings by `child_name` within each instance
  - Assigns consecutive `host_indices` starting from 0
  - Updates labels, trays, and ports with new indices
  - Updates global `globalHostCounter`

#### Integration Points Modified:

1. **Line 3603**: Updated comment in `addNewNode()` to indicate host_index will be recalculated
2. **Line 3650**: Added call to `recalculateHostIndicesForTemplates()` after adding nodes to template instances
3. **Line 4405**: Added call to `recalculateHostIndicesForTemplates()` after adding child graphs to multiple template instances
4. **Line 4492**: Added call to `recalculateHostIndicesForTemplates()` when instantiating a new graph in hierarchy mode
5. **Line 5456**: Added call to `recalculateHostIndicesForTemplates()` when reloading elements in hierarchy mode
6. **Line 5504**: Added call to `recalculateHostIndicesForTemplates()` when creating new Cytoscape instance in hierarchy mode
7. **Lines 2858, 2880**: Added calls to `recalculateHostIndicesForTemplates()` after deleting nodes in hierarchy mode

## Files Created

### 1. `/proj_sw/user_dev/agupta/tt-CableGen/HOST_INDEX_RECALCULATION.md`
Comprehensive documentation describing:
- Problem statement
- Solution approach
- Implementation details
- Integration points
- Benefits
- Testing guidelines
- Future enhancements

### 2. `/proj_sw/user_dev/agupta/tt-CableGen/test_host_index_recalculation.py`
Test script that demonstrates the recalculation algorithm with:
- Before/after comparison
- Multiple template instances
- Nodes added at different times
- Clear visualization of consecutive numbering

## Key Features

1. **Automatic Recalculation**: Triggered automatically when:
   - Adding nodes to templates
   - Adding graph instances
   - Deleting nodes
   - Loading data files

2. **Consistent Ordering**: Siblings are sorted by `child_name` to ensure deterministic results

3. **Backward Compatible**: Old files are automatically recalculated when loaded

4. **Comprehensive Updates**: Updates shelf nodes, labels, tray nodes, and port nodes

5. **Global Counter Sync**: Maintains `globalHostCounter` in sync with the actual maximum

## Example Output

Before recalculation:
```
pod_instance_1: host_0, host_1, host_15
pod_instance_2: host_2, host_3, host_16
```

After recalculation:
```
pod_instance_1: host_0, host_1, host_2
pod_instance_2: host_3, host_4, host_5
```

## Benefits

1. **Cleaner Exports**: Cabling descriptors now have organized, consecutive host indices per template instance
2. **Easier Debugging**: Clear which hosts belong to which template instance
3. **Better Organization**: Host indices reflect the logical hierarchy structure
4. **Export Consistency**: Makes it easier to map hosts to template instances in exports

## Testing

Tested with:
- Multiple template instances
- Adding nodes to templates
- Deleting nodes from templates
- Loading existing files
- Creating new visualizations

All operations correctly maintain consecutive host numbering within each template instance.

## No Breaking Changes

This feature enhances existing functionality without breaking any existing behavior:
- Only affects hierarchy mode
- Old files are automatically upgraded
- Location mode is unaffected
- Export format remains compatible
