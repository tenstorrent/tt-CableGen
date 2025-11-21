# Connection Placement Level Selection Feature

## Overview

When adding connections in the logical view, users can now choose which graph template level the connection should be part of. This addresses the complexity of hierarchical topologies where a connection can be placed at multiple levels, resulting in different numbers of instantiated connections.

## How It Works

### User Workflow

1. **Enable Cabling Editing Mode**
   - Click the "Enable Cabling Editing" button in the sidebar

2. **Select Two Ports**
   - Click on the first port (source)
   - Click on the second port (target)

3. **Choose Placement Level** (if applicable)
   - If the topology has multiple graph hierarchy levels, a modal dialog appears
   - The modal shows all possible placement levels from closest common parent to root
   - Each level displays:
     - **Level name** (e.g., "superpod1")
     - **Instance count** - How many times the connection will be instantiated
     - **Template name** (e.g., "n300_lb_superpod")
     - **Hierarchy depth** - Position in the tree (Root, Level 1, Level 2, etc.)
     - **Connection type** - Template-level or instance-specific

4. **Select a Level**
   - Click on any placement option to create the connection at that level
   - Click Cancel or click outside the modal to abort

### Automatic Behavior

- **Physical View (CSV imports)**: No modal shown - connections created directly
- **Logical View with no hierarchy**: No modal shown - single placement level used
- **Logical View with hierarchy**: Modal shown for level selection

## Technical Details

### Placement Level Enumeration

The system finds all possible placement levels by:

1. Finding the shelf nodes for both ports (Port → Tray → Shelf)
2. Collecting all graph-type ancestors for each shelf
3. Finding common ancestors between the two lists
4. Ordering from closest (most specific) to root (most general)

### Instance Count Calculation

The instance count shown in the modal indicates how many connection instances will be created:

#### Template-Level Connections
When you select a placement level that **matches the closest common ancestor**:
- **Type**: Template-level connection
- **Count**: Number of instances of that template
- **Effect**: Connection pattern created in ALL template instances
- **Use case**: Editing the template that applies to multiple instances

**Example**: Connect node1→node2 in superpod1, choose superpod level
- If there are 4 superpods: Shows "4 instances"
- Creates connection in superpod1, superpod2, superpod3, superpod4

#### Instance-Specific Connections
When you select a placement level that is **higher than the closest common ancestor**:
- **Type**: Instance-specific connection
- **Count**: 1 instance
- **Effect**: Single connection with full paths from higher level
- **Use case**: Creating unique connections between specific instances

**Example**: Connect node1→node2 in superpod1, choose cluster level
- Shows "1 instance"
- Creates only one connection (with full paths like ["superpod1","node1"])

### Data Storage

Connections store the chosen placement level in the edge metadata:

```javascript
{
    id: "edge_...",
    source: "port_1",
    target: "port_2",
    template_name: "n300_lb_superpod",  // Graph template where connection is defined
    depth: 2,                            // Hierarchy depth of the template
    // ... other connection properties
}
```

This metadata is critical for:
- **Export**: Ensuring connections are placed in the correct graph template in the exported descriptor
- **Visualization**: Coloring connections by hierarchy level
- **Deletion**: Removing all instances of a template-level connection

## Example Scenarios

### Scenario 1: Superpod-Level Connection

**Topology**: Cluster with 4 superpods, each superpod has 4 nodes

**User Action**: Connect node1 to node2 within superpod1

**Modal Shows**:
1. **superpod1**
   - Instances: **4 instances** (if 4 superpods exist)
   - Template: `n300_lb_superpod`
   - Type: Template-level
   - Effect: Connection created in all 4 superpods
   
2. **cluster_root**
   - Instances: **1 instance**
   - Template: `n300_lb_cluster`
   - Type: Instance-specific
   - Effect: Single connection with full paths from cluster level

**User Selects**: 
- Option 1 if editing the template (applies to all superpods)
- Option 2 if creating a unique connection in just superpod1

### Scenario 2: Inter-Superpod Connection

**Topology**: Cluster with 4 superpods

**User Action**: Connect node in superpod1 to node in superpod2

**Modal Shows**:
1. **cluster_root**
   - Instances: **1 instance** (only one cluster)
   - Template: `n300_lb_cluster`
   - Type: Template-level
   - Effect: Connection created at cluster level

**User Selects**: Option 1 (only common ancestor available)

### Scenario 3: Nested Hierarchy

**Topology**: Region → Cluster → Superpod → Nodes

**User Action**: Connect two nodes within the same superpod

**Modal Shows**:
1. **superpod1**
   - Instances: **3 instances** (if cluster has 3 superpods)
   - Template: `n300_lb_superpod`
   - Type: Template-level
   
2. **cluster1**
   - Instances: **1 instance** (only this cluster)
   - Template: `n300_lb_cluster`
   - Type: Instance-specific
   
3. **region1**
   - Instances: **1 instance** (only this region)
   - Template: `datacenter_region`
   - Type: Instance-specific

**User Selects**: 
- Option 1 to edit the superpod template (affects 3 superpods)
- Option 2/3 for unique connections at higher levels

## UI Design

### Modal Dialog

The modal features:
- **Level name**: Large, bold heading for each option
- **Highlighted instance count**: Blue badge showing "1 instance" or "N instances" in a prominent light blue box
- **Template and depth info**: Clean display below the instance count
- **Easy dismissal**: Cancel button or click outside modal
- **Hover effects**: Visual feedback on selection options

### Styling

- All options: Gray border, white background
- Hover: Blue border, light blue background, slight lift animation  
- **Instance count**: Bright blue badge (white text) in a light blue highlight box with blue left border
- Compact layout: Only essential information displayed

## Implementation Files

### JavaScript (`static/js/visualizer.js`)

**New Functions**:
- `enumeratePlacementLevels(sourcePort, targetPort)` - Find all possible placement levels
- `calculateDuplicationCount(graphNode, sourceShelf, targetShelf)` - Count instances at a level
- `showConnectionPlacementModal(sourceNode, targetNode, placementLevels)` - Display modal
- `selectConnectionPlacementLevel(sourceNode, targetNode, selectedLevel)` - Handle selection
- `cancelConnectionPlacement()` - Close modal
- `handleModalOverlayClick(event)` - Close on outside click
- `createConnectionAtLevel(sourceNode, targetNode, selectedLevel)` - Create connection with level

**Modified Functions**:
- `createConnection(sourceId, targetId)` - Check for hierarchy and show modal if needed

### HTML (`templates/index.html`)

**New Elements**:
- Modal overlay with backdrop
- Modal content container
- Dynamic placement options container
- Styled buttons and option cards

**New Styles**:
- `.modal-overlay` - Full-screen backdrop
- `.modal-content` - Dialog box
- `.placement-option` - Selection cards
- `.placement-option.recommended` - Green highlight for recommended
- Responsive styling for hover/click effects

## Export Integration

The chosen placement level is preserved in the connection's metadata:
- `template_name`: Used during export to place connection in correct graph template
- `depth`: Used for visualization and validation

Connections are exported to the correct template levels based on the placement_level metadata.

## Benefits

1. **Explicit Control**: Users explicitly choose connection scope instead of automatic inference
2. **Visibility**: Clear view of instantiation counts before committing
3. **Flexibility**: Easy to place connections at any valid hierarchy level
4. **Validation**: Only valid placement options are shown
5. **Documentation**: Self-documenting through the modal descriptions

## Future Enhancements

Potential improvements:
- **Preview**: Visual highlighting of affected instances before confirming
- **Batch creation**: Create connections at multiple levels simultaneously
- **Pattern detection**: Suggest patterns based on existing connections
- **Undo/Redo**: Support for connection placement operations
- **Advanced filtering**: Filter by duplication count or template type

