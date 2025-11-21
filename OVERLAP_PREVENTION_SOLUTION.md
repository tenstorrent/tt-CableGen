# Overlap Prevention Solution: Using fcose Layout

## The Problem

Nodes were overlapping when loaded, and the previous "solution" of locking positions had downsides:
- ❌ Locked nodes couldn't be dragged by users
- ❌ Positions could still overlap if Python calculations were off
- ❌ No dynamic adjustment when nodes were added/removed

## The Solution: fcose Layout

**fcose** (Fast Compound Spring Embedder) is a force-directed layout algorithm specifically designed for compound graphs. It provides:

✅ **Automatic Overlap Avoidance** - Nodes repel from siblings  
✅ **Respect Hierarchy** - Children stay inside parents  
✅ **Draggable After Layout** - Users can manually adjust positions  
✅ **Dynamic** - Works with any graph structure  
✅ **Fast** - Optimized for large graphs  

## How It Works

### Force-Based Physics Simulation

fcose uses a physics simulation where:
1. **Nodes repel** from each other (like magnets with same pole)
2. **Edges attract** connected nodes (like springs)
3. **Gravity** pulls nodes toward center
4. **Constraints** keep children inside parents

The algorithm runs iterations until forces balance out, resulting in a layout with no overlaps.

## Configuration

### Initial Load
```javascript
layout: {
    name: 'fcose',
    quality: 'default',
    randomize: false,  // Use Python positions as starting point
    animate: false,
    fit: true,
    padding: 50,
    nodeDimensionsIncludeLabels: true,
    // Repulsion strength - higher = more spacing
    nodeRepulsion: 4500,
    // Ideal distance between connected nodes
    idealEdgeLength: 200,
    // How much children affect parent positioning
    nestingFactor: 0.1,
    // Pull toward center
    gravity: 0.25,
    // Simulation iterations
    numIter: 2500
}
```

### Reset Layout
Same configuration but with `animate: true` for smooth transitions when user clicks "Reset Layout".

## Key Parameters

| Parameter | Value | Effect |
|-----------|-------|--------|
| `nodeRepulsion` | 4500 | Higher = more space between nodes (prevents overlaps) |
| `idealEdgeLength` | 200 | Preferred distance between connected nodes |
| `nestingFactor` | 0.1 | How loosely children are packed (0.1 = tight) |
| `gravity` | 0.25 | Pull toward center (0.25 = moderate) |
| `randomize` | false | Start from Python positions, not random |
| `numIter` | 2500 | More iterations = better layout (slower) |

## Benefits Over Position Locking

| Aspect | Locking | fcose |
|--------|---------|-------|
| Overlap prevention | ❌ Manual calculation | ✅ Automatic |
| User dragging | ❌ Blocked | ✅ Allowed |
| Dynamic graphs | ❌ Needs recalc | ✅ Adapts |
| Hierarchy respect | ❌ Manual | ✅ Built-in |
| Visual quality | ⚠️ Can overlap | ✅ Always neat |

## Files Modified

1. **`templates/index.html`**
   - Added fcose extension scripts:
     - `layout-base@2.0.1`
     - `cose-base@2.2.0`
     - `cytoscape-fcose@2.2.0`

2. **`static/js/visualizer.js`**
   - Changed initial layout from `preset` to `fcose`
   - Updated reset layout to rerun fcose
   - Removed all `node.lock()` calls
   - Updated mode switching to use fcose

## Usage

### For Users

1. **Upload File** - Nodes automatically arrange without overlaps
2. **Drag Nodes** - Manually adjust as needed
3. **Reset Layout** - Click button to rerun fcose and fix overlaps
4. **Add Nodes** - New nodes automatically find space

### Tuning the Layout

If nodes are **too spread out**:
```javascript
nodeRepulsion: 3000  // Lower value = tighter
```

If nodes are **too close**:
```javascript
nodeRepulsion: 6000  // Higher value = more space
```

If you want **more horizontal** arrangement:
```javascript
// Can add alignment constraints in future
```

## Testing

After this change:
1. **Refresh page** (Ctrl+Shift+R to clear cache)
2. **Upload textproto** - Should see nodes arranged horizontally without overlaps
3. **Try dragging** - All nodes should be draggable
4. **Click Reset Layout** - Should animate to clean layout

## Alternative Algorithms

If fcose doesn't work well, other options:

| Algorithm | Pros | Cons |
|-----------|------|------|
| `cose` | Good for compounds | Slower than fcose |
| `cola` | Constraint-based | Requires WebCOLA lib |
| `dagre` | Tree-like DAGs | Not for cycles |
| `breadthfirst` | Simple trees | Vertical only |

fcose is the best balance for compound hierarchical graphs with overlap avoidance.

## Future Enhancements

Possible improvements:
- Add UI controls for `nodeRepulsion` slider
- Save user-adjusted positions to local storage
- Add "horizontal" vs "vertical" layout toggle
- Incremental layout for dynamic changes

