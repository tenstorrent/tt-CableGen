# Graph Template Instantiation Rules

## Overview
Validation rules have been added to prevent invalid graph template instantiation based on the hierarchical structure of network topologies. The system now intelligently determines where to place new graph instances based on user selection and hierarchy constraints.

## Hierarchy Levels

Graph types are organized in a strict hierarchy from lowest to highest:

```
graph < pod < superpod < cluster < zone < region
  0       1       2         3       4      5
```

## Rule 1: Hierarchy Constraint

**A graph template can only be instantiated inside a parent of HIGHER hierarchy level.**

### Valid Examples ✅

| Parent Type | Can Add |
|-------------|---------|
| cluster | superpod, pod, graph |
| superpod | pod, graph |
| pod | graph |
| zone | cluster, superpod, pod, graph |
| region | zone, cluster, superpod, pod, graph |

**Examples:**
- ✅ Adding a **superpod** inside a **cluster** (2 < 3)
- ✅ Adding a **pod** inside a **superpod** (1 < 2)
- ✅ Adding a **graph** inside a **pod** (0 < 1)

### Invalid Examples ❌

| Parent Type | Cannot Add |
|-------------|------------|
| cluster | cluster, zone, region |
| superpod | superpod, cluster, zone, region |
| pod | pod, superpod, cluster, zone, region |

**Examples:**
- ❌ Adding a **cluster** inside a **cluster** (3 = 3) - Same type
- ❌ Adding a **cluster** inside a **superpod** (3 > 2) - Parent type
- ❌ Adding a **superpod** inside a **pod** (2 > 1) - Parent type

## Rule 2: Parent Selection

**If a graph node is selected, and it is a valid parent (higher hierarchy level), the new instance is created inside the selected node.**

### Selection Priority

1. **Selected Node (if valid)**: If user has selected a graph node that can contain the new template type
2. **Top Level (fallback)**: If no selection, or selection is invalid, add at top level with no parent

### Examples

#### Case 1: Valid Selection ✅
- **User Action**: Selects a cluster node, then adds a superpod template
- **Validation**: superpod (2) < cluster (3) ✅
- **Result**: New superpod is created **inside** the selected cluster
- **Console**: `Using selected node "n300_lb_cluster" (cluster, level 3) as parent for superpod (level 2)`

#### Case 2: Invalid Selection ❌
- **User Action**: Selects a superpod node, then tries to add a cluster template
- **Validation**: cluster (3) > superpod (2) ❌
- **Result**: Error dialog, no graph created
- **Message**: "Cannot add a 'cluster' inside the selected 'superpod'"

#### Case 3: No Selection ✅
- **User Action**: Nothing selected, adds a superpod template
- **Result**: New superpod is created at **top level** (no parent)
- **Console**: `No valid parent selected. Adding superpod at top level (no parent).`

#### Case 4: Non-Graph Selection ✅
- **User Action**: Selects a shelf/tray/port node, then adds a superpod template
- **Result**: Selection ignored (not a valid parent type), new superpod created at **top level**
- **Console**: `Selected node is not a valid parent (type: shelf). Adding at top level.`

## Rule 3: Positioning

**New graph instances are positioned intelligently based on their parent context.**

### With Parent
- **First child**: Positioned inside parent (centered below parent's position)
- **Additional children**: Positioned to the right of siblings with 600px spacing

### Without Parent (Top Level)
- **First graph**: Positioned at (300, 300)
- **Additional graphs**: Positioned to the right of existing top-level graphs with 600px spacing

## Implementation

### Location
File: `static/js/visualizer.js`  
Function: `addNewGraph()`

### Validation Logic

```javascript
// Define hierarchy
const graphTypeHierarchy = ['graph', 'pod', 'superpod', 'cluster', 'zone', 'region'];

// Step 1: Check if a node is selected
const selectedNodes = cy.nodes(':selected');
if (selectedNodes.length > 0) {
    const selectedNode = selectedNodes[0];
    const selectedType = selectedNode.data('type');
    
    // Step 2: Check if selected node is a valid parent type
    if (selectedNode.isParent() && ['graph', 'superpod', 'pod', 'cluster', 'zone', 'region'].includes(selectedType)) {
        // Step 3: Validate hierarchy
        const selectedHierarchyLevel = graphTypeHierarchy.indexOf(selectedType);
        const newGraphHierarchyLevel = graphTypeHierarchy.indexOf(graphType);
        
        if (newGraphHierarchyLevel < selectedHierarchyLevel) {
            // ACCEPT - Use selected node as parent
            parentNode = selectedNode;
            parentId = selectedNode.id();
        } else {
            // REJECT - Cannot add same or higher level
            alert('Cannot instantiate graph template...');
            return;
        }
    }
}

// Step 4: Fallback - add at top level if no valid parent
if (!parentNode) {
    parentId = null;  // No parent
}
```

### Error Messages

#### Invalid Selection Error

When a user attempts to add a graph inside an invalid parent:

```
Cannot instantiate graph template!

Rule violation: Cannot add a "cluster" inside the selected "superpod".

A graph can only be added inside a parent of higher hierarchy level.
Hierarchy (low to high): graph < pod < superpod < cluster < zone < region

The selected node "superpod1" (superpod, level 2) cannot contain a "cluster" (level 3).

To add this template, either:
• Select a higher-level parent, or
• Deselect all nodes to add at top level
```

## User Experience

### Workflow 1: Add Inside Selected Node ✅

1. User uploads `16_n300_lb_cluster.textproto`
2. User **clicks on cluster node** to select it (highlighted)
3. User clicks "Add Graph"
4. User selects **superpod** template
5. User enters label "superpod5"
6. User clicks "Add Graph"
7. **Validation passes**: superpod (2) < cluster (3) ✅
8. **Result**: New superpod created **inside the selected cluster**
9. **Console**: `Using selected node "n300_lb_cluster" (cluster, level 3) as parent`

### Workflow 2: Add at Top Level ✅

1. User uploads `16_n300_lb_cluster.textproto`
2. User clicks **empty space** to deselect all nodes
3. User clicks "Add Graph"
4. User selects **cluster** template
5. User enters label "cluster_2"
6. User clicks "Add Graph"
7. **No parent selected**
8. **Result**: New cluster created at **top level** (sibling to existing cluster)
9. **Console**: `No valid parent selected. Adding cluster at top level (no parent).`

### Workflow 3: Invalid Selection ❌

1. User uploads `16_n300_lb_cluster.textproto`
2. User **clicks on superpod1** to select it
3. User clicks "Add Graph"
4. User selects **cluster** template (trying to add cluster inside superpod)
5. User enters label "another_cluster"
6. User clicks "Add Graph"
7. **Validation fails**: cluster (3) > superpod (2) ❌
8. **Result**: Error alert appears, no graph created
9. **Alert**: "Cannot add a 'cluster' inside the selected 'superpod'"

## Benefits

### 1. **Prevents Invalid Topologies**
- Ensures network hierarchy makes logical sense
- Cannot create nonsensical structures like "cluster inside superpod"

### 2. **Prevents Duplicate Containers**
- Cannot add "cluster inside cluster"
- Avoids confusing nested same-type containers

### 3. **Flexible Placement**
- Can add inside selected node (when valid)
- Can add at top level (when no selection or invalid)
- Users control where new instances go

### 4. **Clear User Feedback**
- Immediate validation with explanatory error message
- Shows the hierarchy rules clearly
- Provides helpful suggestions (select different parent or deselect)

### 5. **Maintains Data Integrity**
- Export will always produce valid descriptor files
- Import/export round-trips remain consistent
- No broken references or invalid parent-child relationships

### 6. **Intelligent Positioning**
- New graphs positioned relative to siblings
- Maintains visual organization
- Prevents overlapping nodes

## Edge Cases

### Case 1: No Parent (Empty Canvas)
- **Behavior**: Any graph type can be added
- **Reason**: No parent to validate against
- **Result**: Graph added as top-level node

### Case 2: Unknown Graph Type
- **Behavior**: Treated as "graph" (level 0, lowest)
- **Reason**: Falls back to default type
- **Result**: Can be added inside any parent

### Case 3: Custom Graph Types
- **Behavior**: Not in hierarchy list, treated as "graph" (level 0)
- **Reason**: Unknown types default to lowest level
- **Result**: Can be added anywhere (most permissive)

## Testing

### Test 1: Add Inside Selected Node (Valid)
1. Upload `16_n300_lb_cluster.textproto`
2. **Click on the cluster node** (red-bordered) to select it
3. Click "Add Graph" → Select **superpod** template → Enter "superpod5"
4. Click "Add Graph"
5. **Verify**: 
   - Success message appears
   - superpod5 appears **inside** the cluster (as a child)
   - Console: `Using selected node "n300_lb_cluster" (cluster, level 3) as parent for superpod (level 2)`

### Test 2: Add at Top Level (No Selection)
1. Upload `16_n300_lb_cluster.textproto`
2. **Click empty space** to deselect all nodes
3. Click "Add Graph" → Select **cluster** template → Enter "cluster_2"
4. Click "Add Graph"
5. **Verify**: 
   - Success message appears
   - cluster_2 appears at **top level** (sibling to original cluster)
   - Console: `No valid parent selected. Adding cluster at top level (no parent).`

### Test 3: Invalid Selection (Same Type)
1. Upload `16_n300_lb_cluster.textproto`
2. **Click on the cluster node** to select it
3. Click "Add Graph" → Select **cluster** template → Enter "cluster_2"
4. Click "Add Graph"
5. **Verify**: 
   - Error alert appears
   - No new cluster created
   - Alert: "Cannot add a 'cluster' inside the selected 'cluster'"

### Test 4: Invalid Selection (Higher Type)
1. Upload `16_n300_lb_cluster.textproto`
2. **Click on a superpod node** (orange-bordered) to select it
3. Click "Add Graph" → Select **cluster** template → Enter "another_cluster"
4. Click "Add Graph"
5. **Verify**: 
   - Error alert appears
   - No cluster created
   - Alert: "Cannot add a 'cluster' inside the selected 'superpod'"
   - Suggestions shown: Select higher-level parent or deselect

### Test 5: Non-Graph Selection (Falls Back to Top Level)
1. Upload `16_n300_lb_cluster.textproto`
2. **Click on a shelf node** (inside a superpod) to select it
3. Click "Add Graph" → Select **superpod** template → Enter "superpod5"
4. Click "Add Graph"
5. **Verify**: 
   - Success message appears
   - superpod5 appears at **top level** (shelf selection ignored)
   - Console: `Selected node is not a valid parent (type: shelf). Adding at top level.`

### Test 6: Positioning with Siblings
1. Upload `16_n300_lb_cluster.textproto` (has 4 superpods already)
2. **Click on cluster** to select it
3. Add **superpod5**, then **superpod6**
4. **Verify**: 
   - Both new superpods appear inside cluster
   - superpod6 is positioned to the **right** of superpod5
   - 600px spacing between siblings

### Test Hierarchy Enforcement Matrix
```
Selected Parent | Template Type | Expected Result
----------------|---------------|----------------
cluster         | superpod      | ✅ Pass (inside cluster)
cluster         | cluster       | ❌ Fail (same type)
cluster         | zone          | ❌ Fail (higher type)
superpod        | pod           | ✅ Pass (inside superpod)
superpod        | superpod      | ❌ Fail (same type)
superpod        | cluster       | ❌ Fail (higher type)
pod             | graph         | ✅ Pass (inside pod)
pod             | pod           | ❌ Fail (same type)
none (deselect) | any           | ✅ Pass (top level)
shelf           | any           | ✅ Pass (top level, selection ignored)
```

## Future Enhancements

### 1. **Template Filtering** (Smart Dropdown)
Instead of showing error after selection:
- Filter template dropdown based on parent type
- Only show valid templates for current context
- Disable invalid options with tooltip explanation

### 3. **Multi-Level Addition**
- Allow adding multiple levels at once
- E.g., "Add superpod with 4 pods inside"
- Validate entire structure before creation

### 4. **Custom Hierarchy Definitions**
- Allow users to define custom type hierarchies
- Support organization-specific topology structures
- Store hierarchy rules in metadata

## Technical Notes

### Type Inference
Graph type is inferred from template name:
```javascript
if (templateLower.includes('superpod')) graphType = 'superpod';
else if (templateLower.includes('pod')) graphType = 'pod';
else if (templateLower.includes('cluster')) graphType = 'cluster';
```

**Limitation**: Relies on naming convention. Templates should include their type in the name.

### Hierarchy Array
```javascript
const graphTypeHierarchy = ['graph', 'pod', 'superpod', 'cluster', 'zone', 'region'];
```

**Index as level**: Higher index = higher in hierarchy  
**Easy to extend**: Just add new types to the array

### Validation Timing
- Happens BEFORE instantiation starts
- No need to rollback if validation fails
- Fast feedback to user

## Summary

The graph instantiation rules ensure:
- ✅ **Logical network hierarchies** - Enforces proper type ordering
- ✅ **No duplicate container types** - Prevents same-type nesting
- ✅ **Valid parent-child relationships** - Maintains hierarchy constraints
- ✅ **Flexible placement control** - Select parent or add at top level
- ✅ **Clear error messages** - Explains why operations fail with suggestions
- ✅ **Intelligent positioning** - Places new graphs relative to siblings
- ✅ **Data integrity in exports** - Always produces valid descriptors
- ✅ **Better user experience** - Intuitive, selection-based workflow

### Key Features

1. **Selection-Based Placement**: Click a node before adding → new graph goes inside
2. **Automatic Fallback**: No selection or invalid selection → adds at top level
3. **Hierarchy Validation**: Prevents invalid nesting (e.g., cluster in superpod)
4. **Context-Aware**: Ignores non-graph selections (shelves, ports)
5. **Smart Positioning**: Maintains visual organization with sibling spacing

Users can only create valid, sensible network topologies that match real-world infrastructure organization.

