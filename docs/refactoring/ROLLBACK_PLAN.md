# Rollback Plan

## Strategy

Each phase is implemented on a separate Git branch to allow easy rollback if issues are encountered.

## Branch Structure

```
main (production)
  └── refactor/visualizer-cleanup (main refactoring branch)
      ├── refactor/phase-1 (configuration extraction)
      ├── refactor/phase-2 (state management)
      ├── refactor/phase-3 (node factory)
      ├── refactor/phase-4 (module separation)
      ├── refactor/phase-5 (API & utilities)
      ├── refactor/phase-6 (UI & events)
      ├── refactor/phase-7 (testing & docs)
      └── refactor/phase-8 (polish)
```

## Rollback Procedures

### Option 1: Revert Specific Phase

If a specific phase introduces issues:

```bash
# Identify the problematic commit
git log --oneline

# Revert the commit
git revert <commit-hash>

# Or reset to before the phase
git reset --hard <commit-before-phase>
```

### Option 2: Switch to Previous Branch

```bash
# Go back to previous phase
git checkout refactor/phase-<N-1>
```

### Option 3: Use Legacy File

Keep a backup of the original visualizer.js:

```bash
# Create backup (do this once)
cp static/js/visualizer.js static/js/visualizer-legacy.js
git add static/js/visualizer-legacy.js
git commit -m "Backup original visualizer.js"

# Restore if needed
cp static/js/visualizer-legacy.js static/js/visualizer.js
```

### Option 4: Complete Rollback

If the entire refactoring needs to be rolled back:

```bash
# Return to main branch
git checkout main

# Or delete refactoring branches
git branch -D refactor/visualizer-cleanup
git branch -D refactor/phase-*
```

## Testing Before Merge

Before merging any phase to the main refactoring branch:

1. ✅ All tests pass
2. ✅ Manual testing of key features
3. ✅ No linter errors
4. ✅ Performance is acceptable
5. ✅ Documentation updated

## Merge Strategy

```bash
# After completing and testing a phase
git checkout refactor/visualizer-cleanup
git merge refactor/phase-N --no-ff
git tag phase-N-complete
```

The `--no-ff` flag creates a merge commit for easy reversion.

## Emergency Procedures

If production is broken:

1. **Immediate:** Switch to backup file
   ```bash
   cp static/js/visualizer-legacy.js static/js/visualizer.js
   ```

2. **Quick fix:** Cherry-pick specific fixes
   ```bash
   git cherry-pick <fix-commit>
   ```

3. **Full revert:** Revert the merge
   ```bash
   git revert -m 1 <merge-commit>
   ```

## Validation Checklist

After any rollback:

- [ ] Application loads without errors
- [ ] Can import cabling descriptors
- [ ] Can create manual nodes
- [ ] Can create connections
- [ ] Can switch between modes
- [ ] Can export descriptors
- [ ] Can generate cabling guide

## Contact

Document any issues encountered and rollback actions taken in:
`docs/refactoring/ISSUES_LOG.md`

