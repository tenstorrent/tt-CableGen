#!/bin/bash
# Cleanup script to keep only the last ~10 test runs in debug_output directory
# Usage: ./cleanup_debug_output.sh [number_to_keep]

DEBUG_OUTPUT_DIR="tests/integration/debug_output"
KEEP_COUNT=${1:-10}  # Default to 10 if not specified

if [ ! -d "$DEBUG_OUTPUT_DIR" ]; then
    echo "Error: Directory $DEBUG_OUTPUT_DIR does not exist"
    exit 1
fi

# Get all directories sorted by modification time (newest first)
# Exclude . and .. entries
DIRS=$(find "$DEBUG_OUTPUT_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')

# Count total directories
TOTAL=$(echo "$DIRS" | wc -l)

if [ "$TOTAL" -le "$KEEP_COUNT" ]; then
    echo "Only $TOTAL test run(s) found, keeping all (limit is $KEEP_COUNT)"
    exit 0
fi

echo "Found $TOTAL test run directories"
echo "Keeping the last $KEEP_COUNT test runs..."

# Get directories to delete (skip first KEEP_COUNT)
TO_DELETE=$(echo "$DIRS" | tail -n +$((KEEP_COUNT + 1)))

if [ -z "$TO_DELETE" ]; then
    echo "No directories to delete"
    exit 0
fi

# Count directories to delete
DELETE_COUNT=$(echo "$TO_DELETE" | wc -l)
echo "Deleting $DELETE_COUNT old test run(s)..."

# Delete old directories
DELETED=0
for dir in $TO_DELETE; do
    dirname=$(basename "$dir")
    echo "  Deleting: $dirname"
    rm -rf "$dir"
    if [ $? -eq 0 ]; then
        DELETED=$((DELETED + 1))
    else
        echo "    Warning: Failed to delete $dirname"
    fi
done

echo ""
echo "Cleanup complete: Deleted $DELETED of $DELETE_COUNT directories"
echo "Kept the last $KEEP_COUNT test runs"

