# Client-Side Layout Refactor Plan

**Branch:** `agupta/client-side-layout`  
**Base Branch:** `agupta/hierarchical-cabling-import`  
**Status:** Planning Phase  
**Estimated Effort:** 2-3 days

## Overview

Refactor visualization layout calculations from server-side (Python) to client-side (JavaScript). This enables:
- Interactive layout recalculation (Reset Layout without re-upload)
- Cleaner separation of concerns (Backend = data parser, Frontend = visualization)
- Single source of truth for layout logic
- Deletion of ~800-1000 lines of Python layout code
- Foundation for future interactive features (spacing sliders, arrangement toggles)

## Architecture Change

### Current Architecture
```
File Upload → Python (parse + calculate layout) → Full Cytoscape JSON with positions → Render
```

### New Architecture
```
File Upload → Python (parse only) → Raw data (no positions) → JS calculates layout → Render
```

## Code Impact Summary

### Python Code to DELETE (~800-1000 lines)
- `calculate_position_in_sequence()` - position calculations
- `get_child_positions_for_parent()` - child positioning
- All position logic in `_create_rack_hierarchy()`
- All position logic in `_create_shelf_hierarchy()`
- All position logic in `_create_graph_compound_node()`
- Position calculations in `_create_node_instance()`
- Element template dimension/spacing logic
- `get_position_type_for_depth()` - dimension-based algorithm
- Rack/shelf positioning helpers

### Python Code to KEEP (~1500-2000 lines)
- `parse_csv()` - CSV file parsing
- `parse_cabling_descriptor()` - textproto parsing
- `HierarchyResolver` - graph hierarchy traversal
- `ConnectionResolver` - connection resolution
- All data extraction and validation logic
- Node configuration management

### JavaScript Code to ADD (~1000-1500 lines)
- Element templates with dimensions
- `calculatePositionInSequence()` - position calculator
- `getChildPositionsForParent()` - child positioning
- Dimension-based hierarchy layout algorithm
- Percentage-based spacing calculations
- CSV rack/shelf positioning logic
- Alternating arrangement logic

## Implementation Phases

### Phase 1: Update Python API (No Positions)

**Objective:** Modify Python to return raw data without position calculations

**Files to Modify:**
- `import_cabling.py`:
  - `generate_visualization_data()` / `generate_cytoscape_data()`
  - Remove position fields from node creation
  - Keep all parsing logic intact

**New API Response Structure:**
```json
{
  "format": "csv" | "descriptor",
  "nodes": [
    {
      "id": "shelf_0_n300_lb",
      "type": "shelf",
      "parent": "graph_superpod1_node1",
      "label": "n300_lb (host_0)",
      "classes": "shelf",
      "config": {
        "tray_count": 4,
        "port_count": 2,
        "tray_layout": "horizontal",
        "port_layout": "vertical"
      },
      "metadata": {
        "host_id": 0,
        "hostname": "node1",
        "rack_num": 1,
        "shelf_u": 5,
        "depth": 2
      }
    }
  ],
  "edges": [...],
  "hierarchy": {
    "type": "csv" | "descriptor",
    "graph_paths": [...],
    "parent_map": {...}
  },
  "metadata": {
    "file_format": "csv" | "descriptor",
    "shelf_unit_type": "n300_lb",
    "config": {...}
  }
}
```

**Testing:** Verify API returns data without positions

---

### Phase 2: JavaScript Hierarchy Layout

**Objective:** Port hierarchical layout calculations to JavaScript

#### Phase 2a: Port Element Templates

**Files to Modify:**
- `static/js/visualizer.js`

**Add:**
```javascript
const ELEMENT_TEMPLATES = {
  graph: {
    dimensions: {
      width: "auto",
      height: "auto", 
      spacing: 0.15,  // 15% of element size
      padding: 0.10   // 10% of element size
    },
    position_type: null,  // Determined dynamically
    child_type: "shelf",
    style_class: "graph"
  },
  shelf: {
    dimensions: {
      width: "auto",
      height: "auto",
      padding: 15
    },
    child_type: "tray",
    style_class: "shelf"
  },
  tray: {
    dimensions: {
      width: "auto",
      height: "auto",
      spacing: 25,
      padding: 8
    },
    child_type: "port",
    style_class: "tray"
  },
  port: {
    dimensions: {
      width: 35,
      height: 25
    },
    style_class: "port"
  },
  rack: {
    dimensions: {
      width: "auto",
      height: "auto"
    },
    position_type: "horizontal_sequence",
    child_type: "shelf",
    style_class: "rack"
  }
};
```

**Testing:** Verify templates are accessible

#### Phase 2b: Port Layout Calculations

**Files to Modify:**
- `static/js/visualizer.js`

**Add Functions:**

1. **`calculatePositionInSequence(elementType, index, parentX, parentY, depth)`**
   - Translates position_type to x,y coordinates
   - Handles percentage-based spacing
   - Supports: horizontal_sequence, vertical_sequence, vertical_sequence_reversed, grid

2. **`getPositionTypeForDepth(depth, baseAlternation)`**
   - Implements dimension-based arrangement
   - Alternates based on content dominance

3. **`getChildPositionsForParent(parentType, childIds, parentX, parentY)`**
   - Calculates positions for all children
   - Returns array of [childId, x, y] tuples

4. **`calculateNodeDimensions(nodeData, config)`**
   - Auto-calculates dimensions based on children
   - Handles percentage-based sizes

5. **`applyHierarchyLayout(data)`**
   - Main entry point for hierarchy layout
   - Traverses hierarchy depth-first
   - Assigns positions to all nodes

**Key Algorithm (Dimension-Based):**
```javascript
function getPositionTypeForDepth(depth, baseAlternation) {
  // Base alternation determined from physical device structure
  // For N300_LB: trays horizontal → shelf vertical → graph horizontal
  const base = baseAlternation || "horizontal_sequence";
  
  // Alternate at each depth level
  if (depth % 2 === 0) {
    return base;
  } else {
    return base === "horizontal_sequence" ? 
      "vertical_sequence" : "horizontal_sequence";
  }
}
```

**Testing:** Test with `16_n300_lb_cluster_expl.textproto`

#### Phase 2c: Integration and Testing

**Files to Modify:**
- `static/js/visualizer.js` - `initVisualization()`

**Changes:**
```javascript
function initVisualization(data) {
  // ... existing setup ...
  
  // NEW: Apply layout if positions are missing
  if (!data.elements[0].position) {
    if (data.metadata.file_format === 'descriptor') {
      data = applyHierarchyLayout(data);
    } else {
      data = applyCSVLayout(data);
    }
  }
  
  // ... continue with existing code ...
}
```

**Test Files:**
- `16_n300_lb_cluster.textproto`
- `16_n300_lb_cluster_expl.textproto`

**Expected Results:**
- Superpods arranged horizontally
- Pods within superpods arranged vertically
- Shelves positioned correctly
- Spacing matches current implementation

---

### Phase 3: JavaScript CSV Layout

**Objective:** Port CSV rack/shelf positioning to JavaScript

#### Phase 3a: Port CSV Positioning

**Files to Modify:**
- `static/js/visualizer.js`

**Add Functions:**

1. **`calculateRackPositions(racks)`**
   - Sorts racks by rack_num (descending)
   - Calculates x positions (right to left)
   - Returns rack position map

2. **`calculateShelfPositions(shelves, rackPositions)`**
   - Groups shelves by rack
   - Sorts by shelf_u (descending - higher U at top)
   - Calculates y positions within rack

3. **`applyCSVLayout(data)`**
   - Main entry point for CSV layout
   - Handles rack-based and standalone shelf formats
   - Assigns positions to all nodes

**Key Logic:**
```javascript
function calculateRackPositions(racks) {
  const sortedRacks = racks.sort((a, b) => 
    b.metadata.rack_num - a.metadata.rack_num
  );
  
  const positions = {};
  let x = LAYOUT_CONSTANTS.MIN_START_X;
  
  sortedRacks.forEach(rack => {
    positions[rack.id] = { x, y: LAYOUT_CONSTANTS.MIN_START_Y };
    x += LAYOUT_CONSTANTS.DEFAULT_RACK_WIDTH + LAYOUT_CONSTANTS.RACK_X_OFFSET;
  });
  
  return positions;
}
```

**Testing:** Test with CSV files

#### Phase 3b: Testing

**Test Files:**
- Various CSV formats (20-column, 8-column)
- Different node types (n300_lb, wh_galaxy)

**Expected Results:**
- Racks positioned left to right (descending rack numbers)
- Shelves stacked top to bottom within racks
- Spacing matches current implementation

---

### Phase 4: Cleanup Python Code

**Objective:** Remove Python layout code

#### Phase 4a: Remove Python Layout Code

**Files to Modify:**
- `import_cabling.py`

**Methods to DELETE:**
- `calculate_position_in_sequence()`
- `get_child_positions_for_parent()`
- Position calculations in `_create_rack_hierarchy()`
- Position calculations in `_create_shelf_hierarchy()`
- Position calculations in `_create_graph_compound_node()`
- Position calculations in `_create_node_instance()`
- `get_position_type_for_depth()`

**Methods to SIMPLIFY:**
- `create_node_from_template()` - remove position parameters
- `_create_trays_and_ports()` - remove position calculations
- `generate_visualization_data()` - simplified response

**Estimated Lines Deleted:** ~800-1000

#### Phase 4b: Testing

**Test Coverage:**
- All CSV formats
- All textproto files
- Different node types
- Large files (performance)
- Reset Layout functionality
- Manual node dragging
- Collapse/expand behavior

**Acceptance Criteria:**
- Visual output matches current implementation
- Reset Layout works in both modes
- No performance degradation for files < 100 nodes
- All existing tests pass

---

### Phase 5: Modularize JavaScript (Optional Cleanup)

**Objective:** Organize JavaScript code into clean, maintainable modules

**Strategy:** Extract monolithic `visualizer.js` into organized module structure

#### Proposed File Structure

```
static/js/
├── visualizer.js                 # Main entry point & orchestration (~500-800 lines)
├── layout/
│   ├── layoutEngine.js          # Layout calculation coordinator (~200 lines)
│   ├── hierarchyLayout.js       # Hierarchy/descriptor layout logic (~600-800 lines)
│   ├── csvLayout.js             # CSV rack/shelf layout logic (~400-600 lines)
│   ├── elementTemplates.js      # Element dimension templates (~200 lines)
│   └── positionCalculator.js    # Position calculation utilities (~300-400 lines)
├── ui/
│   ├── controls.js              # Button handlers, mode toggles (~400 lines)
│   ├── nodeFilter.js            # Connection filter dropdown (~200 lines)
│   ├── shelfEditor.js           # Shelf editing panel (~300 lines)
│   └── connectionInfo.js        # Connection annotation display (~200 lines)
├── cytoscape/
│   ├── styleManager.js          # Cytoscape style definitions (~400 lines)
│   ├── eventHandlers.js         # Node click, edge select, etc. (~300 lines)
│   └── extensions.js            # Expand/collapse, edgehandles setup (~200 lines)
└── utils/
    ├── dataParser.js            # Parse API responses (~200 lines)
    ├── geometryUtils.js         # Dimension calculations (~200 lines)
    └── hierarchyUtils.js        # Path traversal, depth calculations (~200 lines)
```

#### Benefits

1. **Separation of Concerns**: Layout, UI, visualization clearly separated
2. **Easier Testing**: Each module can be tested independently
3. **Better Maintainability**: Smaller files, easier to find code
4. **Reusability**: Modules can be used in other tools
5. **Parallel Development**: Different features in different files
6. **Clean Dependencies**: Modern ES6 modules with explicit imports

#### Implementation Steps

1. **Setup module system** - Add ES6 module support to HTML
2. **Extract layout code** - Move to `layout/` directory
3. **Extract UI code** - Move to `ui/` directory
4. **Extract Cytoscape code** - Move to `cytoscape/` directory
5. **Extract utilities** - Move to `utils/` directory
6. **Update main file** - Orchestrate modules in `visualizer.js`
7. **Test thoroughly** - Ensure no regressions

**Estimated Time:** 6-8 hours

**Note:** This phase is optional and can be done later if needed. The refactored code will work fine in a single file initially.

---

## Benefits

### Immediate Benefits
1. **Reset Layout works without re-upload** - Better UX
2. **Cleaner architecture** - Backend = data, Frontend = visualization
3. **Delete ~800-1000 lines of Python** - Simpler backend
4. **Single source of truth** - Layout logic only in JavaScript
5. **No code duplication** - One implementation to maintain

### Future Benefits
1. **Interactive layout controls** - Could add spacing sliders
2. **Real-time adjustments** - Change layout without re-upload
3. **Client-side experiments** - Try different algorithms easily
4. **Better debugging** - Layout logic in browser dev tools
5. **Foundation for more features** - Manual layout, constraints, etc.

## Trade-offs

### Pros
- Cleaner separation of concerns
- Better long-term maintainability
- Enables interactive features
- Industry-standard pattern (data API + viz client)

### Cons
- Large upfront implementation cost (~2-3 days)
- Initial load slightly slower (client does more work)
- Must maintain algorithm parity during transition
- Breaking API change (needs migration)

## Testing Strategy

### Unit Tests (JavaScript)
- `calculatePositionInSequence()` with various inputs
- `getPositionTypeForDepth()` alternation logic
- Percentage spacing calculations
- Dimension calculations

### Integration Tests
- Full layout with sample data
- CSV layout matches current
- Hierarchy layout matches current
- Reset Layout functionality

### Visual Regression Tests
- Compare screenshots before/after
- Verify spacing/positioning
- Check edge routing

### Performance Tests
- Time to layout 50, 100, 200 nodes
- Memory usage
- Browser compatibility

## Migration Path

1. **Implement on branch** - `agupta/client-side-layout`
2. **Test thoroughly** - Verify parity with current implementation
3. **Performance testing** - Ensure acceptable speed
4. **Merge to dev branch** - Internal testing
5. **Merge to main** - Production deployment

## Rollback Plan

If issues arise:
1. **Keep original branch** - `agupta/hierarchical-cabling-import`
2. **Can revert merge** - Git history preserved
3. **Feature flag possible** - Could add server-side layout toggle

## Success Criteria

- [ ] API returns raw data without positions
- [ ] JavaScript hierarchy layout matches current visual output
- [ ] JavaScript CSV layout matches current visual output  
- [ ] Reset Layout works in hierarchy mode
- [ ] Reset Layout works in CSV mode
- [ ] All existing tests pass
- [ ] Performance acceptable (< 500ms for 100 nodes)
- [ ] Python layout code deleted (~800-1000 lines)
- [ ] Documentation updated

## Timeline Estimate

- **Phase 1 (API update):** 4-6 hours
- **Phase 2 (Hierarchy layout):** 8-12 hours
- **Phase 3 (CSV layout):** 6-8 hours
- **Phase 4 (Cleanup Python):** 2-4 hours
- **Phase 5 (Modularize JS - optional):** 6-8 hours

**Total (required):** 20-30 hours (~2.5-4 days)  
**Total (with modularization):** 26-38 hours (~3-5 days)

## Questions/Decisions

1. **Backward compatibility:** Should we support old API format?
   - Recommendation: No, clean break on new branch
   
2. **Performance threshold:** What's acceptable?
   - Recommendation: < 500ms for 100 nodes, < 2s for 500 nodes
   
3. **Feature parity:** Must match exactly?
   - Recommendation: Visual output must match, implementation can differ

4. **Testing coverage:** How much is enough?
   - Recommendation: Test all sample files, visual regression on key layouts

## References

- Current implementation: `import_cabling.py` lines 1500-2300
- Layout algorithm: `calculate_position_in_sequence()`
- Dimension-based logic: `get_position_type_for_depth()`
- Element templates: `set_shelf_unit_type()` around line 280

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-04  
**Author:** AI Assistant  
**Status:** Planning Complete - Ready for Implementation

