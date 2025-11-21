# Path-Based Connection Logic - Complete Implementation

## Overview

All connection operations (validation, creation, deletion) now use **path-based logic** to correctly handle hierarchical connections at any depth. This ensures that connections are correctly identified by their full hierarchical path, not just by shelf name.

## Problem Statement

Previously, the system used only shelf names to identify ports (e.g., `{shelfName: "node_0", tray: 1, port: 1}`). This caused issues when:
- Multiple instances of the same template existed at different levels
- Connections needed to be placed at higher levels with full paths
- The same shelf name appeared in multiple branches of the hierarchy

**Example Issue:**
- `dim0_group0/node_0/T1/P1` and `dim0_group1/node_0/T1/P1` both have shelf name `"node_0"`
- Old logic couldn't distinguish between them
- Validation and creation would find the wrong ports

## Solution: Path-Based Pattern Extraction

All operations now extract and use **full hierarchical paths** from a specified placement level.

### Core Function: `extractPortPattern(portNode, placementLevel)`

```javascript
function extractPortPattern(portNode, placementLevel = null) {
    // Find the shelf containing this port
    let shelf = /* walk up from port to shelf */;
    
    // Extract tray and port IDs
    const trayId = /* from port ID */;
    const portId = /* from port ID */;
    
    if (!placementLevel) {
        // Simple mode: return just shelf name
        return { shelfName, trayId, portId };
    }
    
    // Build hierarchical path from placement level to shelf
    const path = [];
    let current = shelf;
    while (current.id() !== placementLevel.id()) {
        path.unshift(current.data('child_name') || current.data('logical_child_name'));
        current = current.parent();
    }
    
    return { path, trayId, portId };
}
```

**Examples:**
- From `big_mesh_dim1` instance: `{path: ["node_0"], tray: 1, port: 1}`
- From `big_mesh_16x8` instance: `{path: ["dim0_group0", "node_0"], tray: 1, port: 1}`

### Helper Function: `findPortByPath(graphNode, path, trayId, portId)`

```javascript
function findPortByPath(graphNode, path, trayId, portId) {
    let current = graphNode;
    
    // Follow the path through the hierarchy
    for (const nodeName of path) {
        current = current.children().filter(child =>
            child.data('child_name') === nodeName ||
            child.data('logical_child_name') === nodeName
        )[0];
    }
    
    // Current is now the shelf - find the port
    const portId = `${current.id()}-tray${trayId}-port${portId}`;
    return cy.getElementById(portId);
}
```

## Updated Operations

### 1. Validation: `isPlacementLevelAvailable()`

**Purpose:** Check if a connection can be placed at a specific template level

**Logic:**
1. Extract pattern **once** relative to the placement level
2. Apply that **same pattern** to ALL instances of the template
3. Block if ANY instance has a conflict

```javascript
function isPlacementLevelAvailable(sourcePort, targetPort, placementGraphNode, 
                                  placementTemplateName, sourceShelf, targetShelf) {
    if (isTemplateLevel) {
        // Extract pattern relative to PLACEMENT LEVEL
        const sourcePattern = extractPortPattern(sourcePort, placementGraphNode);
        const targetPattern = extractPortPattern(targetPort, placementGraphNode);
        
        // Find all instances of this template
        const templateGraphs = cy.nodes().filter(node =>
            node.data('template_name') === placementTemplateName
        );
        
        // Check ALL instances
        for (const graph of templateGraphs) {
            const srcPort = findPortByPath(graph, sourcePattern.path, ...);
            const tgtPort = findPortByPath(graph, targetPattern.path, ...);
            
            if (!srcPort || !tgtPort) {
                return false; // Can't apply pattern - BLOCK
            }
            
            if (srcPort has connections OR tgtPort has connections) {
                return false; // Conflict - BLOCK
            }
        }
        
        return true; // All instances OK
    }
}
```

**Key Points:**
- Pattern extracted **once** from placement level
- Same pattern applied to **all** instances
- Blocks if **any** instance has issues
- No "skipping" of instances

### 2. Creation: `createConnectionInAllTemplateInstances()`

**Purpose:** Create a connection pattern in all instances of a template

**Logic:**
1. Find which instance contains the original ports
2. Extract pattern ONCE from that instance
3. Apply the SAME pattern to ALL instances

```javascript
function createConnectionInAllTemplateInstances(sourceNode, targetNode, template_name, depth) {
    const templateGraphs = cy.nodes().filter(node =>
        node.data('template_name') === template_name
    );
    
    // Find which instance contains the original ports
    let sourceInstance = null;
    for (const graph of templateGraphs) {
        if (sourceNode.ancestors().includes(graph)) {
            sourceInstance = graph;
            break;
        }
    }
    
    // Extract pattern ONCE from that instance
    const sourcePattern = extractPortPattern(sourceNode, sourceInstance);
    const targetPattern = extractPortPattern(targetNode, sourceInstance);
    
    // Apply SAME pattern to ALL instances
    templateGraphs.forEach(graph => {
        const srcPort = findPortByPath(graph, sourcePattern.path, ...);
        const tgtPort = findPortByPath(graph, targetPattern.path, ...);
        
        if (!srcPort || !tgtPort) {
            return; // Skip this instance
        }
        
        if (srcPort has connections OR tgtPort has connections) {
            return; // Skip this instance
        }
        
        // Create connection
        createSingleConnection(srcPort, tgtPort, template_name, depth);
    });
}
```

**Key Points:**
- Pattern extracted **once** from the instance containing the original ports
- Same pattern applied to **all** instances
- Uses `findPortByPath` to locate exact ports in each instance
- Skips instances where ports are already connected

### 3. Deletion: Template-Level Detection

**Purpose:** Determine if a connection should be deleted from all template instances

**Logic:**
- **Simple rule:** If `template_name` is defined → it's a template-level connection
- Delete from ALL instances of that template

```javascript
function deleteSelectedConnection() {
    const edgeTemplateName = edge.data('template_name');
    
    if (edgeTemplateName) {
        // Template-level: delete from all instances
        deleteConnectionFromAllTemplateInstances(edge, edgeTemplateName);
    } else {
        // No template: single deletion
        edge.remove();
    }
}
```

**Key Point:** ANY connection with a `template_name` is part of that template and should be deleted from all instances. This applies to:
- Connections at the closest common ancestor level (e.g., `big_mesh_dim1`)
- Connections at higher levels with full paths (e.g., `big_mesh_16x8`)

### 3b. Deletion Implementation: `deleteConnectionFromAllTemplateInstances()`

**Purpose:** Delete a connection pattern from all instances of a template

**Logic:**
1. Find which instance contains the original ports
2. Extract pattern ONCE from that instance
3. Apply the SAME pattern to ALL instances to find and delete matching connections

```javascript
function deleteConnectionFromAllTemplateInstances(edge, templateName) {
    const sourcePort = cy.getElementById(edge.data('source'));
    const targetPort = cy.getElementById(edge.data('target'));
    
    const templateGraphs = cy.nodes().filter(node =>
        node.data('template_name') === templateName
    );
    
    // Find which instance contains the original ports
    let sourceInstance = null;
    for (const graph of templateGraphs) {
        if (sourcePort.ancestors().includes(graph)) {
            sourceInstance = graph;
            break;
        }
    }
    
    // Extract pattern ONCE from that instance
    const sourcePattern = extractPortPattern(sourcePort, sourceInstance);
    const targetPattern = extractPortPattern(targetPort, sourceInstance);
    
    // Apply SAME pattern to ALL instances
    templateGraphs.forEach(graph => {
        const srcPort = findPortByPath(graph, sourcePattern.path, ...);
        const tgtPort = findPortByPath(graph, targetPattern.path, ...);
        
        if (!srcPort || !tgtPort) {
            return; // Skip this instance
        }
        
        // Find and delete matching edges
        const matchingEdges = cy.edges().filter(e =>
            (e.data('source') === srcPort.id() && e.data('target') === tgtPort.id()) ||
            (e.data('source') === tgtPort.id() && e.data('target') === srcPort.id())
        );
        
        matchingEdges.remove();
    });
}
```

**Key Points:**
- Pattern extracted **once** from the instance containing the original ports
- Same pattern applied to **all** instances
- Uses `findPortByPath` to locate exact ports in each instance
- Deletes matching connections from all instances

### 4. Connection Flow: `createConnection()`

**Purpose:** Entry point for connection creation with placement level selection

**Logic:**
1. Enumerate all valid placement levels (filters out blocked ones)
2. If 0 levels available → show error
3. If 1 level available → use it automatically (no modal)
4. If 2+ levels available → show modal for selection

```javascript
function createConnection(sourceId, targetId) {
    // ... validation ...
    
    if (hasGraphHierarchy) {
        const placementLevels = enumeratePlacementLevels(sourceNode, targetNode);
        
        if (placementLevels.length === 0) {
            alert('No valid placement levels available.');
            return;
        }
        
        if (placementLevels.length > 1) {
            showConnectionPlacementModal(sourceNode, targetNode, placementLevels);
            return;
        }
        
        // Only one option - use it directly
        createConnectionAtLevel(sourceNode, targetNode, placementLevels[0]);
        return;
    }
    
    // No hierarchy - direct creation
    createConnectionAtLevel(sourceNode, targetNode, null);
}
```

**Key Points:**
- Always uses validated placement levels
- Never falls back to `findCommonAncestorGraph` when hierarchy exists
- Automatic selection when only one valid option

## Complete Flow Example

### Scenario: Connect `dim0_group0/node_0/T1/P1` to `dim0_group0/node_1/T1/P2`

**Step 1: Validation**

Check `big_mesh_dim1` level:
1. Extract pattern from `big_mesh_dim1_0`: `{path: ["node_0"], tray: 1, port: 1}`
2. Check `dim0_group0`: Find `node_0/T1/P1` → free ✓
3. Check `dim0_group1`: Find `node_0/T1/P1` → **occupied** ✗
4. **Result: BLOCKED**

Check `big_mesh_16x8` level:
1. Extract pattern from `graph_root_cluster`: `{path: ["dim0_group0", "node_0"], tray: 1, port: 1}`
2. Check `graph_root_cluster`: Find `dim0_group0/node_0/T1/P1` → free ✓
3. **Result: AVAILABLE**

**Step 2: Selection**

Only 1 level available → automatically use `big_mesh_16x8`

**Step 3: Creation**

Template-level connection at `big_mesh_16x8`:
1. Find all `big_mesh_16x8` instances (only 1: `graph_root_cluster`)
2. Extract pattern from `graph_root_cluster`: `{path: ["dim0_group0", "node_0"], ...}`
3. Find ports: `dim0_group0/node_0/T1/P1` and `dim0_group0/node_1/T1/P2`
4. Create connection ✓

**Step 4: Deletion (if needed)**

If deleting this connection:
1. Detect it's template-level (`template_name === big_mesh_16x8`)
2. For each `big_mesh_16x8` instance:
   - Extract pattern relative to that instance
   - Find matching connection
   - Delete it
3. All instances updated ✓

## Benefits

1. **Correct Validation:** Only shows placement levels that can be applied to ALL instances
2. **Correct Creation:** Creates connections at the exact ports specified by the full path
3. **Correct Deletion:** Deletes connections from all instances using the same path-based matching
4. **Arbitrary Depth:** Works with any hierarchy depth (1 level, 2 levels, 10 levels, etc.)
5. **No Ambiguity:** Full paths eliminate confusion between ports with the same shelf name
6. **Consistent Logic:** All operations use the same path-based approach

## Verification

All three operations now use path-based logic:

✅ **Validation** (`isPlacementLevelAvailable`):
- Extracts pattern from placement level
- Applies to all instances
- Blocks if any conflict

✅ **Creation** (`createConnectionInAllTemplateInstances`):
- Extracts pattern per instance
- Uses `findPortByPath` to locate ports
- Creates in all valid instances

✅ **Deletion** (`deleteConnectionFromAllTemplateInstances`):
- Extracts pattern per instance
- Uses `findPortByPath` to locate ports
- Deletes from all instances

## Debug Logging

All functions include comprehensive logging:
- `[extractPortPattern]` - Shows extracted paths
- `[findPortByPath]` - Shows path traversal
- `[isPlacementLevelAvailable]` - Shows validation per instance
- `[createConnectionInAllTemplateInstances]` - Shows creation per instance
- `[deleteConnectionFromAllTemplateInstances]` - Shows deletion per instance

This makes it easy to trace exactly what's happening at each step.

