#!/usr/bin/env python3
"""
Test script to verify that empty templates are excluded from cabling descriptor export.

This test creates a scenario with:
1. A non-empty template (has children)
2. An empty template (no children)

Expected behavior: Only the non-empty template should appear in the exported descriptor.
"""

import sys
import json

# Mock cytoscape data with one empty graph and one non-empty graph
def create_test_data_with_empty_template():
    """Create test data where one template is empty (no children)"""
    return {
        "elements": [
            # Non-empty graph - has a child shelf node
            {
                "data": {
                    "id": "graph_1",
                    "type": "graph",
                    "label": "non_empty_graph",
                    "template_name": "non_empty_template"
                }
            },
            {
                "data": {
                    "id": "shelf_1",
                    "type": "shelf",
                    "label": "host_0",
                    "hostname": "host_0",
                    "parent": "graph_1",
                    "child_name": "node_0",
                    "shelf_node_type": "N300_LB",
                    "host_id": 0,
                    "logical_path": ["non_empty_graph", "node_0"]
                }
            },
            # Empty graph - has no children
            {
                "data": {
                    "id": "graph_2",
                    "type": "graph",
                    "label": "empty_graph",
                    "template_name": "empty_template"
                }
            }
        ],
        "metadata": {
            "total_nodes": 1,
            "total_connections": 0
        }
    }


def test_empty_template_filtering():
    """Test that empty templates are filtered out of the export"""
    print("Testing empty template filtering...")
    print("=" * 60)
    
    try:
        from export_descriptors import export_cabling_descriptor_for_visualizer
        
        # Create test data
        test_data = create_test_data_with_empty_template()
        
        print("\nTest data structure:")
        print("- non_empty_graph (has 1 child shelf)")
        print("- empty_graph (has 0 children)")
        print()
        
        # Export cabling descriptor
        result = export_cabling_descriptor_for_visualizer(test_data)
        
        print("Export result:")
        print("-" * 60)
        print(result)
        print("-" * 60)
        print()
        
        # Verify results
        if "empty_template" in result:
            print("❌ FAIL: empty_template should NOT be in the export")
            return False
        else:
            print("✅ PASS: empty_template correctly excluded from export")
        
        if "non_empty_template" in result:
            print("✅ PASS: non_empty_template correctly included in export")
        else:
            print("❌ FAIL: non_empty_template should be in the export")
            return False
        
        print()
        print("=" * 60)
        print("All tests passed! Empty templates are correctly filtered.")
        return True
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_empty_template_filtering()
    sys.exit(0 if success else 1)



