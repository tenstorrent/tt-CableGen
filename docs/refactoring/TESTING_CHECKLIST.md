# Testing Checklist - Post-Refactoring

**Date:** November 20, 2024  
**Branch:** refactor/phase-1  
**Phases Completed:** 0-5

---

## Pre-Testing Setup

1. **Start the Flask server:**
   ```bash
   cd /proj_sw/user_dev/agupta/tt-CableGen
   python server.py
   ```

2. **Open browser console** (F12) to monitor for errors

3. **Clear browser cache** if needed to ensure latest JavaScript loads

---

## Test Categories

### 1. Module Loading & Initialization
- [ ] Page loads without errors
- [ ] No console errors about missing modules
- [ ] All imports resolve correctly
- [ ] State initializes properly
- [ ] Factories initialize correctly
- [ ] Modules initialize correctly
- [ ] API client initializes correctly

### 2. File Upload (Location Mode)
- [ ] Upload CSV file successfully
- [ ] Visualization renders correctly
- [ ] Nodes appear in correct positions
- [ ] Tray/port layout is correct
- [ ] Connection legend displays correctly
- [ ] Unknown node types show warning (if applicable)

### 3. File Upload (Hierarchy Mode)
- [ ] Upload textproto/descriptor file successfully
- [ ] Visualization renders correctly
- [ ] Graph nodes appear correctly
- [ ] Template colors assigned correctly
- [ ] Template legend displays correctly
- [ ] Hierarchical structure is correct

### 4. Node Creation
- [ ] Add node in location mode works
- [ ] Add node in hierarchy mode works
- [ ] Node appears with correct type
- [ ] Trays and ports created correctly
- [ ] Tray/port layout arranges correctly
- [ ] Host index increments correctly

### 5. Connection Creation
- [ ] Enable connection editing mode
- [ ] Create connection between two ports
- [ ] Connection appears correctly
- [ ] Connection color is correct (location mode)
- [ ] Connection color is correct (hierarchy mode)
- [ ] Port connection status updates

### 6. Connection Deletion
- [ ] Select connection and delete
- [ ] Delete via keyboard (Backspace/Delete)
- [ ] Connection removed correctly
- [ ] Port connection status updates

### 7. Node Deletion
- [ ] Select shelf node and delete
- [ ] Select rack node and delete
- [ ] Select graph node and delete
- [ ] Children deleted correctly
- [ ] Connections cleaned up

### 8. Mode Switching
- [ ] Switch from location to hierarchy mode
- [ ] Switch from hierarchy to location mode
- [ ] Data preserved correctly
- [ ] Layout recalculates correctly
- [ ] Legend updates correctly

### 9. Layout Functions
- [ ] Reset layout works
- [ ] Location layout arranges correctly
- [ ] Hierarchy layout arranges correctly
- [ ] Tray/port arrangement works

### 10. Export Functions
- [ ] Export cabling descriptor
- [ ] Export deployment descriptor
- [ ] Generate cabling guide
- [ ] Generate FSD
- [ ] Files download correctly
- [ ] File content is correct

### 11. Template Colors
- [ ] Template colors assigned consistently
- [ ] Colors match legend
- [ ] Colors persist across mode switches

### 12. Drag & Drop
- [ ] Nodes are draggable (except trays/ports)
- [ ] Trays/ports are not draggable
- [ ] Drag restrictions work correctly

### 13. UI Interactions
- [ ] Buttons enable/disable correctly
- [ ] Loading states display correctly
- [ ] Error messages display correctly
- [ ] Success messages display correctly
- [ ] Notification banner works

### 14. State Management
- [ ] Mode state persists correctly
- [ ] Selection state works correctly
- [ ] Edit mode state works correctly
- [ ] Data state persists correctly

---

## Known Issues to Watch For

1. **Module Import Errors:** Check browser console for ES6 module import failures
2. **State Sync Issues:** Legacy globals should stay in sync with state
3. **Factory Usage:** Some node creation paths may not use factories yet
4. **API Client:** Verify all API calls go through client (check Network tab)

---

## Browser Compatibility

Test in:
- [ ] Chrome/Chromium (recommended)
- [ ] Firefox
- [ ] Safari (if available)

**Note:** ES6 modules require modern browsers (not IE11)

---

## Error Reporting

If you encounter errors:

1. **Check browser console** for:
   - Import errors
   - Runtime errors
   - State errors
   - API errors

2. **Check Network tab** for:
   - Failed API requests
   - 404 errors for modules
   - CORS issues

3. **Document:**
   - Error message
   - Steps to reproduce
   - Browser/version
   - Console output

---

## Quick Smoke Test

**Fastest way to verify basic functionality:**

1. Start server
2. Open browser to application
3. Upload a small CSV file
4. Create one connection
5. Export cabling descriptor
6. Check console for errors

**If all pass, proceed with full test suite above.**

---

## Rollback Instructions

If critical issues found:

```bash
# Return to main branch
git checkout main

# Or revert specific commits
git log --oneline  # Find problematic commit
git revert <commit-hash>
```

