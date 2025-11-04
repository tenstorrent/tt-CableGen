#!/usr/bin/env python3
"""Integration tests for hierarchical import functionality in CableGen visualizer

Tests the parsing and visualization of hierarchical cabling descriptors (textproto format)
including graph templates, nested instances, and connection resolution.
"""

import sys
import os
import unittest
import time
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from import_cabling import NetworkCablingCytoscapeVisualizer, PROTOBUF_AVAILABLE


class TestHierarchicalImport(unittest.TestCase):
    """Test cases for hierarchical cabling descriptor import"""
    
    @classmethod
    def setUpClass(cls):
        """Check if protobuf is available"""
        if not PROTOBUF_AVAILABLE:
            raise unittest.SkipTest("Protobuf not available - skipping hierarchical import tests")
    
    def setUp(self):
        """Create visualizer instance for each test"""
        self.visualizer = NetworkCablingCytoscapeVisualizer()
    
    def test_parse_16node_cluster(self):
        """Test parsing of 16-node N300 LB cluster descriptor"""
        # Path to the test descriptor file - try multiple locations
        possible_paths = [
            Path(__file__).parent.parent.parent / "tools" / "tests" / "scaleout" / "cabling_descriptors" / "16_n300_lb_cluster.textproto",
            Path("/proj_sw/user_dev/agupta/tt-metal/tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto")
        ]
        
        descriptor_path = None
        for path in possible_paths:
            if path.exists():
                descriptor_path = path
                break
        
        if not descriptor_path.exists():
            self.skipTest(f"Test descriptor file not found: {descriptor_path}")
        
        # Set format and parse
        self.visualizer.file_format = "descriptor"
        success = self.visualizer.parse_cabling_descriptor(str(descriptor_path))
        
        self.assertTrue(success, "Failed to parse 16-node cluster descriptor")
        self.assertIsNotNone(self.visualizer.cluster_descriptor, "Cluster descriptor is None")
    
    def test_hierarchy_resolution(self):
        """Test that hierarchy resolution produces correct host mappings"""
        possible_paths = [
            Path(__file__).parent.parent.parent / "tools" / "tests" / "scaleout" / "cabling_descriptors" / "16_n300_lb_cluster.textproto",
            Path("/proj_sw/user_dev/agupta/tt-metal/tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto")
        ]
        
        descriptor_path = None
        for path in possible_paths:
            if path.exists():
                descriptor_path = path
                break
        
        if not descriptor_path.exists():
            self.skipTest(f"Test descriptor file not found: {descriptor_path}")
        
        self.visualizer.file_format = "descriptor"
        self.visualizer.parse_cabling_descriptor(str(descriptor_path))
        
        # Check hierarchy resolution
        self.assertIsNotNone(self.visualizer.graph_hierarchy, "Graph hierarchy is None")
        self.assertEqual(len(self.visualizer.graph_hierarchy), 16, 
                        f"Expected 16 leaf devices, got {len(self.visualizer.graph_hierarchy)}")
        
        # Verify all host_ids are present
        host_ids = {node['host_id'] for node in self.visualizer.graph_hierarchy}
        self.assertEqual(host_ids, set(range(16)), "Not all host IDs 0-15 are present")
        
        # Verify all nodes have correct structure
        for node_info in self.visualizer.graph_hierarchy:
            self.assertIn('path', node_info)
            self.assertIn('child_name', node_info)
            self.assertIn('node_type', node_info)
            self.assertIn('host_id', node_info)
            self.assertIn('depth', node_info)
            
            # Path should be ['superpodX', 'nodeY']
            self.assertEqual(len(node_info['path']), 2, 
                           f"Expected path length 2, got {len(node_info['path'])} for {node_info}")
    
    def test_connection_parsing(self):
        """Test that connections are parsed correctly from nested graphs"""
        possible_paths = [
            Path(__file__).parent.parent.parent / "tools" / "tests" / "scaleout" / "cabling_descriptors" / "16_n300_lb_cluster.textproto",
            Path("/proj_sw/user_dev/agupta/tt-metal/tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto")
        ]
        
        descriptor_path = None
        for path in possible_paths:
            if path.exists():
                descriptor_path = path
                break
        
        if not descriptor_path.exists():
            self.skipTest(f"Test descriptor file not found: {descriptor_path}")
        
        self.visualizer.file_format = "descriptor"
        self.visualizer.parse_cabling_descriptor(str(descriptor_path))
        
        # Check connections
        self.assertIsNotNone(self.visualizer.descriptor_connections, "Descriptor connections is None")
        
        # 16-node cluster has 6 intra-superpod connections per superpod (4 superpods = 24)
        # Plus 6 inter-superpod connections = 30 total
        expected_connections = 30
        self.assertEqual(len(self.visualizer.descriptor_connections), expected_connections,
                        f"Expected {expected_connections} connections, got {len(self.visualizer.descriptor_connections)}")
        
        # Verify connection structure
        for conn in self.visualizer.descriptor_connections:
            self.assertIn('port_a', conn)
            self.assertIn('port_b', conn)
            self.assertIn('cable_type', conn)
            self.assertIn('depth', conn)
            
            # Verify port structure
            for port_key in ['port_a', 'port_b']:
                port = conn[port_key]
                self.assertIn('path', port)
                self.assertIn('host_id', port)
                self.assertIn('tray_id', port)
                self.assertIn('port_id', port)
    
    def test_helper_classes_separation(self):
        """Test that helper classes work correctly for separation of concerns"""
        possible_paths = [
            Path(__file__).parent.parent.parent / "tools" / "tests" / "scaleout" / "cabling_descriptors" / "16_n300_lb_cluster.textproto",
            Path("/proj_sw/user_dev/agupta/tt-metal/tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto")
        ]
        
        descriptor_path = None
        for path in possible_paths:
            if path.exists():
                descriptor_path = path
                break
        
        if not descriptor_path.exists():
            self.skipTest(f"Test descriptor file not found: {descriptor_path}")
        
        self.visualizer.file_format = "descriptor"
        self.visualizer.parse_cabling_descriptor(str(descriptor_path))
        
        # Check that helper classes were created
        self.assertTrue(hasattr(self.visualizer, '_hierarchy_resolver'), 
                       "HierarchyResolver not created")
        
        # Test path-to-host_id lookup through helper
        test_path = ['superpod1', 'node1']
        host_id = self.visualizer._hierarchy_resolver.path_to_host_id(test_path)
        self.assertEqual(host_id, 0, f"Expected host_id 0 for path {test_path}, got {host_id}")
    
    def test_performance_optimization(self):
        """Test that performance optimizations provide O(1) lookups"""
        possible_paths = [
            Path(__file__).parent.parent.parent / "tools" / "tests" / "scaleout" / "cabling_descriptors" / "16_n300_lb_cluster.textproto",
            Path("/proj_sw/user_dev/agupta/tt-metal/tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto")
        ]
        
        descriptor_path = None
        for path in possible_paths:
            if path.exists():
                descriptor_path = path
                break
        
        if not descriptor_path.exists():
            self.skipTest(f"Test descriptor file not found: {descriptor_path}")
        
        self.visualizer.file_format = "descriptor"
        self.visualizer.parse_cabling_descriptor(str(descriptor_path))
        
        # Test that path-to-host_id lookup is fast (< 1ms for 1000 lookups)
        test_path = ['superpod2', 'node3']
        
        start_time = time.time()
        for _ in range(1000):
            self.visualizer._path_to_host_id(test_path)
        elapsed = time.time() - start_time
        
        # Should be very fast with O(1) lookup (< 1ms for 1000 lookups)
        self.assertLess(elapsed, 0.001, 
                       f"Path-to-host_id lookup too slow: {elapsed*1000:.2f}ms for 1000 lookups")
    
    def test_visualization_generation(self):
        """Test that complete visualization data can be generated"""
        possible_paths = [
            Path(__file__).parent.parent.parent / "tools" / "tests" / "scaleout" / "cabling_descriptors" / "16_n300_lb_cluster.textproto",
            Path("/proj_sw/user_dev/agupta/tt-metal/tools/tests/scaleout/cabling_descriptors/16_n300_lb_cluster.textproto")
        ]
        
        descriptor_path = None
        for path in possible_paths:
            if path.exists():
                descriptor_path = path
                break
        
        if not descriptor_path.exists():
            self.skipTest(f"Test descriptor file not found: {descriptor_path}")
        
        self.visualizer.file_format = "descriptor"
        self.visualizer.parse_cabling_descriptor(str(descriptor_path))
        
        # Initialize config from first node type
        if self.visualizer.graph_hierarchy:
            node_types = set(node['node_type'] for node in self.visualizer.graph_hierarchy)
            first_node_type = list(node_types)[0]
            config = self.visualizer._node_descriptor_to_config(first_node_type)
            self.visualizer.shelf_unit_type = first_node_type.lower()
            self.visualizer.current_config = config
            self.visualizer.set_shelf_unit_type(self.visualizer.shelf_unit_type)
        
        # Generate visualization
        viz_data = self.visualizer.generate_visualization_data()
        
        self.assertIsNotNone(viz_data, "Visualization data is None")
        self.assertIn('elements', viz_data, "No elements in visualization data")
        
        # Should have visual elements for:
        # - 4 superpod compound nodes
        # - 16 host device compound nodes
        # - 16 shelves
        # - 16*4 = 64 trays (4 per device)
        # - 16*4*2 = 128 ports (2 per tray)
        # - 30 connection edges
        # Total = 4 + 16 + 16 + 64 + 128 + 30 = 258 elements
        elements = viz_data['elements']
        
        # Count different element types
        nodes = [e for e in elements if 'source' not in e.get('data', {})]
        edges = [e for e in elements if 'source' in e.get('data', {})]
        
        self.assertGreater(len(nodes), 200, f"Expected >200 visual nodes, got {len(nodes)}")
        self.assertEqual(len(edges), 30, f"Expected 30 edges, got {len(edges)}")


class TestHelperClassFunctionality(unittest.TestCase):
    """Test the helper classes in isolation"""
    
    @classmethod
    def setUpClass(cls):
        """Check if protobuf is available"""
        if not PROTOBUF_AVAILABLE:
            raise unittest.SkipTest("Protobuf not available - skipping helper class tests")
    
    def test_hierarchy_resolver_initialization(self):
        """Test HierarchyResolver can be initialized"""
        visualizer = NetworkCablingCytoscapeVisualizer()
        resolver = visualizer.HierarchyResolver(visualizer)
        
        self.assertIsNotNone(resolver)
        self.assertEqual(resolver.parent, visualizer)
    
    def test_connection_resolver_initialization(self):
        """Test ConnectionResolver can be initialized"""
        visualizer = NetworkCablingCytoscapeVisualizer()
        hierarchy_resolver = visualizer.HierarchyResolver(visualizer)
        conn_resolver = visualizer.ConnectionResolver(visualizer, hierarchy_resolver)
        
        self.assertIsNotNone(conn_resolver)
        self.assertEqual(conn_resolver.parent, visualizer)
        self.assertEqual(conn_resolver.hierarchy_resolver, hierarchy_resolver)


def run_tests():
    """Run all tests and return success status"""
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == '__main__':
    success = run_tests()
    sys.exit(0 if success else 1)

