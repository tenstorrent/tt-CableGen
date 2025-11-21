#!/usr/bin/env python3
"""
Test script to verify that empty canvas exports maintain correct host list/enumeration
between CablingDescriptor and DeploymentDescriptor
"""

import json
import sys
import os

# Set up environment for testing
os.environ.setdefault("TT_METAL_HOME", "/proj_sw/user_dev/agupta/tt-metal")

from export_descriptors import (
    extract_host_list_from_connections,
    export_flat_cabling_descriptor,
    export_deployment_descriptor_for_visualizer,
)


def create_empty_canvas_test_data():
    """
    Create test data that simulates an empty canvas with manually added nodes and connections.
    This mimics what happens when a user:
    1. Clicks "Create Canvas"
    2. Adds nodes via "Add Node" button
    3. Draws connections between ports
    """
    # Simulate 3 manually added shelf nodes with connections
    test_data = {
        "elements": [
            # Node 1: galaxy-01 (WH_GALAXY)
            {
                "data": {
                    "id": "galaxy-01",
                    "label": "galaxy-01",
                    "type": "shelf",
                    "hostname": "galaxy-01",
                    "shelf_node_type": "WH_GALAXY",
                    "hall": "A",
                    "aisle": "1",
                    "rack_num": 1,
                    "shelf_u": 10
                },
                "position": {"x": 100, "y": 100},
                "classes": "shelf"
            },
            # Tray 1 for galaxy-01
            {
                "data": {
                    "id": "galaxy-01-tray1",
                    "parent": "galaxy-01",
                    "label": "T1",
                    "type": "tray",
                    "tray": 1
                },
                "position": {"x": 100, "y": 50},
                "classes": "tray"
            },
            # Port 1 on Tray 1 of galaxy-01
            {
                "data": {
                    "id": "galaxy-01-tray1-port1",
                    "parent": "galaxy-01-tray1",
                    "label": "P1",
                    "type": "port",
                    "port": 1
                },
                "position": {"x": 80, "y": 50},
                "classes": "port"
            },
            
            # Node 2: galaxy-02 (WH_GALAXY)
            {
                "data": {
                    "id": "galaxy-02",
                    "label": "galaxy-02",
                    "type": "shelf",
                    "hostname": "galaxy-02",
                    "shelf_node_type": "WH_GALAXY",
                    "hall": "A",
                    "aisle": "1",
                    "rack_num": 1,
                    "shelf_u": 11
                },
                "position": {"x": 300, "y": 100},
                "classes": "shelf"
            },
            # Tray 1 for galaxy-02
            {
                "data": {
                    "id": "galaxy-02-tray1",
                    "parent": "galaxy-02",
                    "label": "T1",
                    "type": "tray",
                    "tray": 1
                },
                "position": {"x": 300, "y": 50},
                "classes": "tray"
            },
            # Port 1 on Tray 1 of galaxy-02
            {
                "data": {
                    "id": "galaxy-02-tray1-port1",
                    "parent": "galaxy-02-tray1",
                    "label": "P1",
                    "type": "port",
                    "port": 1
                },
                "position": {"x": 280, "y": 50},
                "classes": "port"
            },
            
            # Node 3: galaxy-03 (BH_GALAXY) - Standalone node without connections
            {
                "data": {
                    "id": "galaxy-03",
                    "label": "galaxy-03",
                    "type": "shelf",
                    "hostname": "galaxy-03",
                    "shelf_node_type": "BH_GALAXY",
                    "hall": "A",
                    "aisle": "2",
                    "rack_num": 2,
                    "shelf_u": 10
                },
                "position": {"x": 500, "y": 100},
                "classes": "shelf"
            },
            # Tray 1 for galaxy-03
            {
                "data": {
                    "id": "galaxy-03-tray1",
                    "parent": "galaxy-03",
                    "label": "T1",
                    "type": "tray",
                    "tray": 1
                },
                "position": {"x": 500, "y": 50},
                "classes": "tray"
            },
            # Port 1 on Tray 1 of galaxy-03
            {
                "data": {
                    "id": "galaxy-03-tray1-port1",
                    "parent": "galaxy-03-tray1",
                    "label": "P1",
                    "type": "port",
                    "port": 1
                },
                "position": {"x": 480, "y": 50},
                "classes": "port"
            },
            
            # Connection between galaxy-01 and galaxy-02
            {
                "data": {
                    "id": "edge-1",
                    "source": "galaxy-01-tray1-port1",
                    "target": "galaxy-02-tray1-port1",
                    "type": "connection"
                }
            }
        ],
        "metadata": {
            "visualization_mode": "location"
        }
    }
    
    return test_data


def test_host_list_consistency():
    """Test that host list extraction is consistent for empty canvas scenario"""
    print("=" * 80)
    print("Testing Empty Canvas Export - Host List/Enumeration Consistency")
    print("=" * 80)
    print()
    
    # Create test data
    test_data = create_empty_canvas_test_data()
    print("✓ Created test data simulating empty canvas with 3 nodes:")
    print("  - galaxy-01 (WH_GALAXY) - connected")
    print("  - galaxy-02 (WH_GALAXY) - connected")
    print("  - galaxy-03 (BH_GALAXY) - standalone (no connections)")
    print()
    
    # Extract host list
    try:
        host_list = extract_host_list_from_connections(test_data)
        print("✓ Successfully extracted host list:")
        for idx, (hostname, node_type) in enumerate(host_list):
            print(f"  [{idx}] {hostname} ({node_type})")
        print()
        
        # Verify all nodes are included
        hostnames = [h[0] for h in host_list]
        expected_hosts = ["galaxy-01", "galaxy-02", "galaxy-03"]
        
        if set(hostnames) == set(expected_hosts):
            print("✓ All nodes are included in host list (including standalone node)")
        else:
            print(f"✗ Host list mismatch!")
            print(f"  Expected: {expected_hosts}")
            print(f"  Got: {hostnames}")
            return False
        
        # Verify sorting
        if hostnames == sorted(expected_hosts):
            print("✓ Host list is correctly sorted alphabetically")
        else:
            print(f"✗ Host list is not sorted correctly!")
            print(f"  Expected order: {sorted(expected_hosts)}")
            print(f"  Got order: {hostnames}")
            return False
        
        print()
        
    except Exception as e:
        print(f"✗ Failed to extract host list: {e}")
        return False
    
    # Export CablingDescriptor
    try:
        cabling_desc = export_flat_cabling_descriptor(test_data)
        print("✓ Successfully exported CablingDescriptor")
        
        # Check that host_id mappings are present
        if "child_mappings" in cabling_desc:
            print("✓ CablingDescriptor contains child_mappings with host_id assignments")
            
            # Verify host IDs match the sorted host list order
            for idx, (hostname, _) in enumerate(host_list):
                mapping_key = f'child_mappings {{\n  key: "{hostname}"'
                if mapping_key in cabling_desc:
                    # Extract host_id from the descriptor
                    # Look for pattern like: host_id: N
                    import re
                    pattern = rf'{re.escape(mapping_key)}.*?host_id:\s*(\d+)'
                    match = re.search(pattern, cabling_desc, re.DOTALL)
                    if match:
                        host_id = int(match.group(1))
                        if host_id == idx:
                            print(f"  ✓ {hostname} has host_id={idx} (matches host list index)")
                        else:
                            print(f"  ✗ {hostname} has host_id={host_id} (expected {idx})")
                            return False
        else:
            print("✗ CablingDescriptor missing child_mappings")
            return False
        
        print()
        
    except Exception as e:
        print(f"✗ Failed to export CablingDescriptor: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Export DeploymentDescriptor
    try:
        deployment_desc = export_deployment_descriptor_for_visualizer(test_data)
        print("✓ Successfully exported DeploymentDescriptor")
        
        # Verify hosts are in the same order
        if "hosts {" in deployment_desc:
            print("✓ DeploymentDescriptor contains hosts entries")
            
            # Extract hosts in order from the descriptor
            import re
            # The host field can be anywhere in the hosts block
            host_pattern = r'host:\s*"([^"]+)"'
            found_hosts = re.findall(host_pattern, deployment_desc)
            
            expected_order = [h[0] for h in host_list]
            if found_hosts == expected_order:
                print(f"✓ DeploymentDescriptor hosts are in same order as CablingDescriptor:")
                for idx, hostname in enumerate(found_hosts):
                    print(f"  [{idx}] {hostname}")
            else:
                print(f"✗ Host order mismatch!")
                print(f"  Expected: {expected_order}")
                print(f"  Got: {found_hosts}")
                return False
        else:
            print("✗ DeploymentDescriptor missing hosts entries")
            return False
        
        print()
        
    except Exception as e:
        print(f"✗ Failed to export DeploymentDescriptor: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print("=" * 80)
    print("✓ ALL TESTS PASSED")
    print("=" * 80)
    print()
    print("Summary:")
    print("  - Host list extraction works correctly for empty canvas")
    print("  - Both connected and standalone nodes are included")
    print("  - Host list is sorted alphabetically")
    print("  - CablingDescriptor host_id assignments match host list indices")
    print("  - DeploymentDescriptor hosts are in same order as CablingDescriptor")
    print()
    
    return True


if __name__ == "__main__":
    success = test_host_list_consistency()
    sys.exit(0 if success else 1)

