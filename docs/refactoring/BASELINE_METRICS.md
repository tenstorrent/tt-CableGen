# Baseline Metrics - Pre-Refactoring

**Date:** November 20, 2024  
**Branch:** refactor/visualizer-cleanup

## Current State Analysis

### File Statistics

- **Total Lines:** 9,860 lines
- **Main File:** `static/js/visualizer.js` (388KB)
- **Functions:** ~150+ functions
- **Global Variables:** ~20+ globals

### Detailed Metrics

```bash
# Line count
wc -l static/js/visualizer.js
# Output: 9860 static/js/visualizer.js

# Function count
grep -c '^function' static/js/visualizer.js
# Output: ~150

# Global variable count
grep -c '^let \|^var \|^const ' static/js/visualizer.js
# Output: ~20+
```

### Code Structure

- **Single monolithic file:** All logic in one 9,860-line file
- **No module separation:** Location, hierarchy, and common code mixed
- **Global state:** ~20 global variables scattered throughout
- **No tests:** 0% test coverage
- **Magic numbers:** Constants hardcoded throughout
- **Duplicate code:** Node creation repeated 6+ times

### Identified Issues

1. **Maintainability:** Nearly impossible to find specific functionality
2. **Testing:** Cannot test individual components
3. **Onboarding:** New developers overwhelmed by file size
4. **Debugging:** Hard to trace state changes
5. **Feature additions:** High risk of breaking existing code

## Target Metrics

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Lines in main file | 9,860 | <1,000 | 90% |
| Global variables | ~20 | 3-5 | 75% |
| Test coverage | 0% | 80%+ | N/A |
| Largest function | ~200 lines | <50 lines | 75% |
| Duplicate code blocks | High | None | 100% |

## Tools Installation

**Note:** npm tools installation requires Node.js environment:
```bash
npm install --save-dev eslint prettier jest @testing-library/dom madge jsdoc
```

This should be run when Node.js is available in the environment.

## Next Steps

Proceed with Phase 1: Configuration Extraction

