#!/usr/bin/env python3
"""
Test script to verify host_index recalculation functionality.

This script demonstrates that when adding nodes to templates in hierarchy mode,
the host_indices are recalculated so that siblings within each template instance
have consecutive numbering.

Usage:
    python3 test_host_index_recalculation.py
"""

import json


def simulate_host_index_recalculation():
    """
    Simulate the host_index recalculation algorithm.
    
    This mimics what happens in the JavaScript function recalculateHostIndicesForTemplates()
    """
    
    # Simulate a hierarchy with multiple template instances
    # Each instance has multiple shelf nodes (hosts)
    graph_structure = {
        'cluster_1': {
            'template_name': 'cluster',
            'children': [
                {'id': 'cluster_1_node_0', 'child_name': 'node_0', 'old_host_index': 0},
                {'id': 'cluster_1_node_1', 'child_name': 'node_1', 'old_host_index': 1},
                {'id': 'cluster_1_node_2', 'child_name': 'node_2', 'old_host_index': 15},  # Added later
            ]
        },
        'cluster_2': {
            'template_name': 'cluster',
            'children': [
                {'id': 'cluster_2_node_0', 'child_name': 'node_0', 'old_host_index': 2},
                {'id': 'cluster_2_node_1', 'child_name': 'node_1', 'old_host_index': 3},
                {'id': 'cluster_2_node_2', 'child_name': 'node_2', 'old_host_index': 16},  # Added later
            ]
        },
        'pod_1': {
            'template_name': 'pod',
            'children': [
                {'id': 'pod_1_node_0', 'child_name': 'node_0', 'old_host_index': 4},
                {'id': 'pod_1_node_1', 'child_name': 'node_1', 'old_host_index': 5},
            ]
        }
    }
    
    print("=" * 80)
    print("HOST INDEX RECALCULATION SIMULATION")
    print("=" * 80)
    print()
    
    print("BEFORE RECALCULATION:")
    print("-" * 80)
    for graph_id, graph_data in graph_structure.items():
        print(f"\n{graph_id} (template: {graph_data['template_name']}):")
        for child in graph_data['children']:
            print(f"  {child['id']}: host_{child['old_host_index']}")
    
    print("\n")
    print("=" * 80)
    print()
    
    # Recalculate host_indices
    next_host_index = 0
    
    for graph_id, graph_data in graph_structure.items():
        # Sort children by child_name
        sorted_children = sorted(graph_data['children'], key=lambda x: x['child_name'])
        
        for child in sorted_children:
            child['new_host_index'] = next_host_index
            next_host_index += 1
    
    print("AFTER RECALCULATION:")
    print("-" * 80)
    for graph_id, graph_data in graph_structure.items():
        print(f"\n{graph_id} (template: {graph_data['template_name']}):")
        sorted_children = sorted(graph_data['children'], key=lambda x: x['child_name'])
        for child in sorted_children:
            old_idx = child['old_host_index']
            new_idx = child['new_host_index']
            change_marker = " (CHANGED)" if old_idx != new_idx else ""
            print(f"  {child['id']}: host_{old_idx} -> host_{new_idx}{change_marker}")
    
    print("\n")
    print("=" * 80)
    print()
    
    print("OBSERVATIONS:")
    print("-" * 80)
    print("1. Siblings within each template instance now have consecutive host_indices")
    print("2. Host indices are sorted by child_name (node_0, node_1, node_2)")
    print("3. The global host_index counter is updated to", next_host_index)
    print("4. This makes it easier to export cabling_descriptor with organized host mappings")
    print()
    
    print("EXPORT BENEFITS:")
    print("-" * 80)
    print("- cluster_1 hosts: [0, 1, 2]")
    print("- cluster_2 hosts: [3, 4, 5]")
    print("- pod_1 hosts: [6, 7]")
    print()
    print("Each template instance's hosts are now grouped together!")
    print()


if __name__ == '__main__':
    simulate_host_index_recalculation()





