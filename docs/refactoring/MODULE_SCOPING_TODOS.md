# Module Scoping Issues - TODOs and Next Steps

## Problem Summary

After converting `visualizer.js` to a module (`type="module"`), multiple scoping errors have occurred because functions are no longer accessible from inline `onclick` handlers in HTML.

### Errors Encountered

- `uploadFile is not defined`
- `currentData is not defined`
- `initialVisualizationData is not defined`
- `location_switchMode is not defined`
- `updateModeIndicator is not defined`
- `showExportStatus is not defined`
- And others...

## Current Workaround

Functions are manually exposed to `window` object in `visualizer.js`, and HTML uses `window.functionName()` with `typeof` checks. This works but is:
- Error-prone (easy to miss functions)
- Pollutes global namespace
- Requires maintenance overhead
- Not a sustainable solution

## Immediate Action Items

### Before Phase 0

- [x] Document all scoping issues as TODOs in code
- [x] Add comprehensive comments explaining the problem and solution
- [ ] **TODO**: Audit all HTML onclick handlers and document which functions they call
- [ ] **TODO**: Create a checklist of all functions that need to be exposed
- [ ] **TODO**: Add runtime checks/warnings if functions are called but not exposed

### During Phase 6.4 (UI & Event Management)

1. **Priority**: Replace inline onclick handlers with event listeners
2. Create `static/js/ui/event-manager.js` early in Phase 6
3. Migrate all onclick handlers systematically:
   ```javascript
   // Replace:
   <button onclick="uploadFile()">
   
   // With:
   document.getElementById('uploadBtn').addEventListener('click', uploadFile);
   ```
4. Move inline script functions to appropriate modules
5. Remove all `window.*` function exposures once event listeners are in place

## Success Criteria

- Zero inline `onclick` handlers in HTML
- Zero functions exposed to `window` object (except intentional public API)
- All event handling centralized in EventManager
- No runtime "is not defined" errors
- Type safety improved (functions are imported, not accessed globally)

## Estimated Effort

- Audit and documentation: 2-4 hours
- Event listener migration: 1-2 days
- Testing and verification: 1 day
- **Total: ~1 week** (can be done in parallel with other Phase 6 work)

## Risk

**Medium** - Requires careful testing to ensure no functionality is broken, but low risk since we're just changing how events are bound, not changing the event handlers themselves.

## Related Files

- `static/js/visualizer.js` - Contains TODO comments about scoping issues
- `templates/index.html` - Contains inline onclick handlers that need migration
- `docs/refactoring/visualizer-refactoring-plan.plan.md` - Full refactoring plan

