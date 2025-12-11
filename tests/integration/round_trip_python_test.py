#!/usr/bin/env python3
"""
Python-based round-trip tests for import/export flows

These tests use the actual Python import/export functions to verify:
1. Import data (CSV or cabling descriptor)
2. Export data (cabling descriptor or deployment descriptor)
3. Re-import exported data
4. Verify consistency

Test data files should be placed in tests/integration/test-data/

Run with: 
  python -m pytest tests/integration/round_trip_python_test.py
  python tests/integration/round_trip_python_test.py
  
  # With pytest, use -s to see output and --save-debug-files to save exported files:
  pytest tests/integration/round_trip_python_test.py -v -s --save-debug-files
"""

import os
import sys
import tempfile
import json
import argparse
import pytest
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from import_cabling import NetworkCablingCytoscapeVisualizer
from export_descriptors import export_cabling_descriptor_for_visualizer, export_deployment_descriptor_for_visualizer


# Test data directory
TEST_DATA_DIR = Path(__file__).parent / 'test-data'


@pytest.fixture(scope="class")
def debug_mode(request):
    """Fixture to get debug mode from pytest command-line option"""
    return request.config.getoption("--save-debug-files", default=False)


@pytest.fixture(scope="class")
def debug_dir(debug_mode):
    """Fixture to create debug directory if debug mode is enabled"""
    if debug_mode:
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        debug_path = os.path.join(os.getcwd(), 'tests', 'integration', 'debug_output', timestamp)
        os.makedirs(debug_path, exist_ok=True)
        print(f"\n🐛 DEBUG MODE: Exported files will be saved to: {debug_path}\n")
        return debug_path
    return None


@pytest.fixture(scope="class", autouse=True)
def setup_debug_settings(request, debug_mode, debug_dir):
    """Fixture to set debug settings on test class before tests run"""
    # This runs automatically before the test class
    request.cls.debug = debug_mode
    request.cls.debug_dir = debug_dir


class TestRoundTrip:
    """Test class for round-trip import/export flows"""
    
    # These will be set by the setup_debug_settings fixture
    debug = False
    debug_dir = None
    
    def setup_method(self):
        """Set up test fixtures"""
        self.visualizer = NetworkCablingCytoscapeVisualizer()
        self.temp_dir = tempfile.mkdtemp(prefix='cablegen_test_')
        
        # Ensure test-data directory exists
        TEST_DATA_DIR.mkdir(exist_ok=True)
    
    def teardown_method(self):
        """Clean up test fixtures"""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def _get_test_file(self, filename):
        """Get path to a test data file"""
        file_path = TEST_DATA_DIR / filename
        if not file_path.exists():
            raise FileNotFoundError(
                f"Test data file not found: {file_path}\n"
                f"Please create test data files in {TEST_DATA_DIR}"
            )
        return str(file_path)
    
    def _initialize_descriptor_visualizer(self, visualizer):
        """Initialize visualizer after parsing cabling descriptor
        
        This follows the same pattern as import_cabling.py main() and server.py
        to ensure templates are properly initialized.
        
        IMPORTANT: This MUST be called after parse_cabling_descriptor() and before
        generate_visualization_data() to ensure element_templates['graph'] exists.
        """
        # Ensure file_format is set (should already be set, but be defensive)
        if visualizer.file_format != "descriptor":
            visualizer.file_format = "descriptor"
        
        if visualizer.graph_hierarchy:
            # Extract unique node types
            node_types = set(node['node_type'] for node in visualizer.graph_hierarchy)
            
            # Set shelf unit type from first node (or default)
            if node_types:
                first_node_type = list(node_types)[0]
                config = visualizer._node_descriptor_to_config(first_node_type)
                visualizer.shelf_unit_type = visualizer._node_descriptor_to_shelf_type(first_node_type)
                visualizer.current_config = config
            else:
                visualizer.shelf_unit_type = "wh_galaxy"
                visualizer.current_config = visualizer.shelf_unit_configs["wh_galaxy"]
        else:
            # No hierarchy yet - use default
            visualizer.shelf_unit_type = "wh_galaxy"
            visualizer.current_config = visualizer.shelf_unit_configs["wh_galaxy"]
        
        # Initialize templates for descriptor format (this sets up element_templates['graph'])
        # This MUST be called to create element_templates['graph'] entry
        visualizer.set_shelf_unit_type(visualizer.shelf_unit_type)
        
        # Verify that 'graph' template was created
        if 'graph' not in visualizer.element_templates:
            raise RuntimeError(
                f"Failed to initialize 'graph' template. element_templates keys: {list(visualizer.element_templates.keys())}"
            )
    
    def _find_test_file(self, extension):
        """Find a test file with the given extension"""
        test_files = list(TEST_DATA_DIR.glob(f'*.{extension}'))
        if not test_files:
            raise FileNotFoundError(
                f"No {extension} files found in {TEST_DATA_DIR}\n"
                f"Please add a {extension} test file to {TEST_DATA_DIR}"
            )
        # Use the first file found, or you could make this smarter
        return str(test_files[0])
    
    def _count_shelf_nodes(self, visualization_data):
        """Count shelf nodes in visualization data"""
        if not visualization_data or 'elements' not in visualization_data:
            return 0
        return sum(1 for elem in visualization_data['elements'] 
                  if elem.get('data', {}).get('type') == 'shelf')
    
    def _count_connections(self, visualization_data):
        """Count connections (edges) in visualization data"""
        if not visualization_data or 'elements' not in visualization_data:
            return 0
        return sum(1 for elem in visualization_data['elements'] 
                  if 'source' in elem.get('data', {}) and 'target' in elem.get('data', {}))
    
    def _extract_hostnames(self, visualization_data):
        """Extract set of hostnames from shelf nodes (excluding empty strings)"""
        hostnames = set()
        if visualization_data and 'elements' in visualization_data:
            for elem in visualization_data['elements']:
                node_data = elem.get('data', {})
                if node_data.get('type') == 'shelf' and 'hostname' in node_data:
                    hostname = node_data['hostname']
                    if hostname and str(hostname).strip():  # Only add non-empty hostnames
                        hostnames.add(str(hostname).strip())
        return hostnames
    
    def _extract_location_data(self, visualization_data):
        """Extract location data from shelf nodes as a dict: hostname -> location dict"""
        locations = {}
        if visualization_data and 'elements' in visualization_data:
            for elem in visualization_data['elements']:
                node_data = elem.get('data', {})
                if node_data.get('type') == 'shelf' and 'hostname' in node_data:
                    hostname = node_data['hostname']
                    locations[hostname] = {
                        'hall': node_data.get('hall', ''),
                        'aisle': node_data.get('aisle', ''),
                        'rack_num': node_data.get('rack_num', 0),
                        'shelf_u': node_data.get('shelf_u', 0)
                    }
        return locations
    
    def _parse_deployment_descriptor(self, textproto_content):
        """Parse deployment descriptor textproto and extract location data
        
        Returns:
            dict: hostname -> location dict (hall, aisle, rack, shelf_u)
        """
        try:
            from export_descriptors import deployment_pb2
            from google.protobuf import text_format
            
            deployment_desc = deployment_pb2.DeploymentDescriptor()
            text_format.Parse(textproto_content, deployment_desc)
            
            locations = {}
            for host in deployment_desc.hosts:
                hostname = host.host.strip() if host.host else None
                if hostname:
                    locations[hostname] = {
                        'hall': host.hall if host.hall else '',
                        'aisle': host.aisle if host.aisle else '',
                        'rack': host.rack if host.rack else 0,
                        'shelf_u': host.shelf_u if host.shelf_u else 0
                    }
            return locations
        except Exception as e:
            raise ValueError(f"Failed to parse deployment descriptor: {e}")
    
    def test_csv_import_export_cabling_descriptor_round_trip(self, csv_file=None):
        """Test: CSV import -> export cabling descriptor -> re-import
        
        Args:
            csv_file: Optional path to CSV file. If not provided, will use first .csv file found in test-data/
        """
        # Step 1: Use provided CSV file or find one in test-data
        if csv_file is None:
            csv_file = self._find_test_file('csv')
        elif not os.path.isabs(csv_file):
            csv_file = self._get_test_file(csv_file)
        
        # Step 2: Import CSV
        connections = self.visualizer.parse_csv(csv_file)
        initial_connection_count = len(connections)
        assert initial_connection_count > 0, "CSV import should produce connections"
        
        # Step 3: Generate visualization data
        visualization_data = self.visualizer.generate_visualization_data()
        assert 'elements' in visualization_data, "Visualization data should have elements"
        
        # Count initial shelf nodes and connections
        initial_shelf_count = self._count_shelf_nodes(visualization_data)
        initial_edge_count = self._count_connections(visualization_data)
        initial_hostnames = self._extract_hostnames(visualization_data)
        
        assert initial_shelf_count > 0, "Should have shelf nodes after CSV import"
        assert initial_edge_count > 0, "Should have connections/edges after CSV import"
        assert len(initial_hostnames) > 0, "Should have hostnames after CSV import"
        
        # Step 4: Export cabling descriptor
        cytoscape_data = {
            'elements': visualization_data['elements'],
            'metadata': visualization_data.get('metadata', {})
        }
        
        exported_textproto = export_cabling_descriptor_for_visualizer(cytoscape_data)
        assert exported_textproto, "Export should produce textproto content"
        assert len(exported_textproto.strip()) > 0, "Exported textproto should not be empty"
        
        # Step 5: Save exported textproto to file
        exported_file = os.path.join(self.temp_dir, 'exported.textproto')
        with open(exported_file, 'w') as f:
            f.write(exported_textproto)
        
        # Verify file was created
        assert os.path.exists(exported_file), f"Exported file was not created: {exported_file}"
        assert os.path.getsize(exported_file) > 0, f"Exported file is empty: {exported_file}"
        
        # Save to debug directory if debug mode is enabled
        if self.debug and self.debug_dir:
            debug_file = os.path.join(self.debug_dir, 'csv_exported_cabling_descriptor.textproto')
            with open(debug_file, 'w') as f:
                f.write(exported_textproto)
            print(f"🐛 DEBUG: Saved exported cabling descriptor to: {debug_file}")
            print(f"    Preview (first 500 chars):\n{exported_textproto[:500]}...\n")
        
        # Step 6: Re-import the exported textproto
        visualizer2 = NetworkCablingCytoscapeVisualizer()
        visualizer2.file_format = "descriptor"
        
        success = visualizer2.parse_cabling_descriptor(exported_file)
        assert success, "Re-import should succeed"
        
        # Initialize templates for re-imported data (required for descriptor format)
        self._initialize_descriptor_visualizer(visualizer2)
        
        # Step 7: Generate re-imported visualization data for comparison
        reimported_visualization_data = visualizer2.generate_visualization_data()
        
        # Step 8: Verify consistency - thorough data presence and correctness checks
        assert visualizer2.graph_hierarchy is not None, "Re-imported data should have graph hierarchy"
        reimported_host_count = len(visualizer2.graph_hierarchy) if visualizer2.graph_hierarchy else 0
        assert reimported_host_count > 0, "Re-imported data should have hosts"
        
        # Count shelf nodes and connections in re-imported data
        reimported_shelf_count = self._count_shelf_nodes(reimported_visualization_data)
        reimported_edge_count = self._count_connections(reimported_visualization_data)
        reimported_hostnames = self._extract_hostnames(reimported_visualization_data)
        
        # Verify counts match
        assert reimported_shelf_count == initial_shelf_count, \
            f"Shelf node count should match: {reimported_shelf_count} == {initial_shelf_count}"
        assert reimported_edge_count == initial_edge_count, \
            f"Connection/edge count should match: {reimported_edge_count} == {initial_edge_count}"
        assert reimported_host_count == initial_shelf_count, \
            f"Host count should match shelf count: {reimported_host_count} == {initial_shelf_count}"
        
        # Verify hostnames are preserved (if re-imported data has hostnames)
        # Note: Cabling descriptors may not preserve hostnames (they use host_ids), so this check is lenient
        # CSV -> cabling descriptor -> re-import may lose hostnames since cabling descriptors use host_ids
        if reimported_hostnames and len(reimported_hostnames) > 0:
            # If re-imported data has hostnames, they should match
            assert initial_hostnames == reimported_hostnames, \
                f"Hostnames should match if present. Initial: {initial_hostnames}, Re-imported: {reimported_hostnames}"
        else:
            # If no hostnames in re-imported data, that's okay for cabling descriptor format
            # Just verify we have the same number of hosts (hostnames may be lost in CSV->descriptor conversion)
            assert reimported_host_count == len(initial_hostnames), \
                f"Host count should match even if hostnames not preserved: {reimported_host_count} == {len(initial_hostnames)}"
        
        print("✓ CSV -> Export -> Re-import round-trip test passed")
    
    def test_cabling_descriptor_import_export_round_trip(self, textproto_file=None):
        """Test: Cabling descriptor import -> export -> re-import
        
        Args:
            textproto_file: Optional path to textproto file. If not provided, will use first .textproto file found in test-data/
        """
        # Step 1: Use provided textproto file or find one in test-data
        if textproto_file is None:
            input_file = self._find_test_file('textproto')
        elif not os.path.isabs(textproto_file):
            input_file = self._get_test_file(textproto_file)
        else:
            input_file = textproto_file
        
        # Step 2: Import cabling descriptor
        self.visualizer.file_format = "descriptor"
        success = self.visualizer.parse_cabling_descriptor(input_file)
        assert success, "Import should succeed"
        
        # Step 2.5: Initialize templates (required for descriptor format)
        # This follows the same pattern as import_cabling.py main() and server.py
        self._initialize_descriptor_visualizer(self.visualizer)
        
        # Get initial host count
        initial_hosts = len(self.visualizer.graph_hierarchy) if self.visualizer.graph_hierarchy else 0
        assert initial_hosts > 0, "Should have imported hosts"
        
        # Step 3: Generate visualization data
        visualization_data = self.visualizer.generate_visualization_data()
        
        # Step 4: Export cabling descriptor
        cytoscape_data = {
            'elements': visualization_data['elements'],
            'metadata': visualization_data.get('metadata', {})
        }
        
        exported_textproto = export_cabling_descriptor_for_visualizer(cytoscape_data)
        assert exported_textproto, "Export should produce textproto content"
        
        # Step 5: Save exported textproto
        exported_file = os.path.join(self.temp_dir, 'exported.textproto')
        with open(exported_file, 'w') as f:
            f.write(exported_textproto)
        
        # Verify file was created
        assert os.path.exists(exported_file), f"Exported file was not created: {exported_file}"
        assert os.path.getsize(exported_file) > 0, f"Exported file is empty: {exported_file}"
        
        # Save to debug directory if debug mode is enabled
        if self.debug and self.debug_dir:
            debug_file = os.path.join(self.debug_dir, 'descriptor_exported_cabling_descriptor.textproto')
            with open(debug_file, 'w') as f:
                f.write(exported_textproto)
            print(f"🐛 DEBUG: Saved exported cabling descriptor to: {debug_file}")
            print(f"    Preview (first 500 chars):\n{exported_textproto[:500]}...\n")
        
        # Step 6: Re-import the exported textproto
        visualizer2 = NetworkCablingCytoscapeVisualizer()
        visualizer2.file_format = "descriptor"
        
        success = visualizer2.parse_cabling_descriptor(exported_file)
        assert success, "Re-import should succeed"
        
        # Initialize templates for re-imported data (required before generate_visualization_data)
        self._initialize_descriptor_visualizer(visualizer2)
        
        # Step 7: Generate re-imported visualization data for comparison
        reimported_visualization_data = visualizer2.generate_visualization_data()
        
        # Step 8: Verify consistency - thorough data presence and correctness checks
        reimported_hosts = len(visualizer2.graph_hierarchy) if visualizer2.graph_hierarchy else 0
        assert reimported_hosts == initial_hosts, f"Host count should match: {reimported_hosts} == {initial_hosts}"
        
        # Count shelf nodes and connections
        initial_shelf_count = self._count_shelf_nodes(visualization_data)
        initial_edge_count = self._count_connections(visualization_data)
        initial_hostnames = self._extract_hostnames(visualization_data)
        
        reimported_shelf_count = self._count_shelf_nodes(reimported_visualization_data)
        reimported_edge_count = self._count_connections(reimported_visualization_data)
        reimported_hostnames = self._extract_hostnames(reimported_visualization_data)
        
        # Verify counts match
        assert reimported_shelf_count == initial_shelf_count, \
            f"Shelf node count should match: {reimported_shelf_count} == {initial_shelf_count}"
        assert reimported_edge_count == initial_edge_count, \
            f"Connection/edge count should match: {reimported_edge_count} == {initial_edge_count}"
        assert reimported_hosts == initial_shelf_count, \
            f"Host count should match shelf count: {reimported_hosts} == {initial_shelf_count}"
        
        # Verify hostnames are preserved
        assert initial_hostnames == reimported_hostnames, \
            f"Hostnames should match exactly. Initial: {initial_hostnames}, Re-imported: {reimported_hostnames}"
        
        # Verify graph templates are preserved (check that templates exist, but don't check specific names)
        if visualization_data.get('metadata', {}).get('graph_templates'):
            initial_templates = set(visualization_data['metadata']['graph_templates'].keys())
            reimported_templates = set(reimported_visualization_data.get('metadata', {}).get('graph_templates', {}).keys())
            assert initial_templates == reimported_templates, \
                f"Graph templates should be preserved: {initial_templates} == {reimported_templates}"
        
        print("✓ Cabling descriptor round-trip test passed")
    
    def test_export_deployment_descriptor(self, csv_file=None):
        """Test: Export deployment descriptor from visualization data
        
        Args:
            csv_file: Optional path to CSV file. If not provided, will use first .csv file found in test-data/
        """
        # Step 1: Use provided CSV file or find one in test-data
        if csv_file is None:
            csv_file = self._find_test_file('csv')
        elif not os.path.isabs(csv_file):
            csv_file = self._get_test_file(csv_file)
        
        # Step 2: Import CSV
        connections = self.visualizer.parse_csv(csv_file)
        assert len(connections) > 0, "CSV import should produce connections"
        
        # Step 3: Generate visualization data
        visualization_data = self.visualizer.generate_visualization_data()
        
        # Count initial shelf nodes
        initial_shelf_count = self._count_shelf_nodes(visualization_data)
        initial_hostnames = self._extract_hostnames(visualization_data)
        assert initial_shelf_count > 0, "Should have shelf nodes after CSV import"
        assert len(initial_hostnames) > 0, "Should have hostnames after CSV import"
        
        # Step 4: Add location data to shelf nodes (simulate user input)
        # Only add if not already present (don't overwrite existing data)
        added_location_data = {}  # Track what we added for verification
        for element in visualization_data['elements']:
            node_data = element.get('data', {})
            if node_data.get('type') == 'shelf':
                hostname = node_data.get('hostname')
                if not hostname:
                    continue
                    
                # Check if location data already exists
                has_location = all(key in node_data for key in ['hall', 'aisle', 'rack_num', 'shelf_u'])
                
                if not has_location:
                    # Add location data only if missing
                    if 'hall' not in node_data:
                        node_data['hall'] = 'A'
                    if 'aisle' not in node_data:
                        node_data['aisle'] = '1'
                    if 'rack_num' not in node_data:
                        node_data['rack_num'] = 1
                    if 'shelf_u' not in node_data:
                        node_data['shelf_u'] = 1
                    
                    # Track what we added
                    added_location_data[hostname] = {
                        'hall': node_data['hall'],
                        'aisle': node_data['aisle'],
                        'rack_num': node_data['rack_num'],
                        'shelf_u': node_data['shelf_u']
                    }
        
        # Extract all location data after adding (includes existing + newly added)
        expected_locations = self._extract_location_data(visualization_data)
        
        # Step 5: Export deployment descriptor
        cytoscape_data = {
            'elements': visualization_data['elements'],
            'metadata': visualization_data.get('metadata', {})
        }
        
        exported_deployment = export_deployment_descriptor_for_visualizer(cytoscape_data)
        assert exported_deployment, "Export should produce deployment descriptor"
        assert 'hosts' in exported_deployment, "Exported textproto should contain hosts (deployment descriptor format)"
        assert len(exported_deployment.strip()) > 0, "Exported deployment descriptor should not be empty"
        
        # Step 6: Parse exported deployment descriptor and verify correctness
        exported_locations = self._parse_deployment_descriptor(exported_deployment)
        
        # Verify all hostnames are present (order doesn't matter for deployment descriptor)
        assert set(exported_locations.keys()) == initial_hostnames, \
            f"Exported hostnames should match. Expected: {initial_hostnames}, Got: {set(exported_locations.keys())}"
        
        # Verify host count matches
        assert len(exported_locations) == initial_shelf_count, \
            f"Host count in deployment descriptor should match shelf count: {len(exported_locations)} == {initial_shelf_count}"
        
        # Verify location data matches (for hosts that have location data)
        # Order doesn't matter - just verify all location data is present and correct
        for hostname, expected_loc in expected_locations.items():
            if hostname in exported_locations:
                exported_loc = exported_locations[hostname]
                # Compare location fields (handle type conversion - rack_num might be string or int)
                # Hall and aisle are strings
                assert str(exported_loc['hall']) == str(expected_loc['hall']), \
                    f"Hall mismatch for {hostname}: {exported_loc['hall']} != {expected_loc['hall']}"
                assert str(exported_loc['aisle']) == str(expected_loc['aisle']), \
                    f"Aisle mismatch for {hostname}: {exported_loc['aisle']} != {expected_loc['aisle']}"
                # Convert both to int for comparison (rack_num might be string like '02' or int)
                expected_rack = int(expected_loc['rack_num']) if expected_loc['rack_num'] else 0
                exported_rack = int(exported_loc['rack']) if exported_loc['rack'] else 0
                assert exported_rack == expected_rack, \
                    f"Rack mismatch for {hostname}: {exported_rack} != {expected_rack}"
                # Convert both to int for comparison (shelf_u might be string or int)
                expected_shelf_u = int(expected_loc['shelf_u']) if expected_loc['shelf_u'] else 0
                exported_shelf_u = int(exported_loc['shelf_u']) if exported_loc['shelf_u'] else 0
                assert exported_shelf_u == expected_shelf_u, \
                    f"Shelf_u mismatch for {hostname}: {exported_shelf_u} != {expected_shelf_u}"
        
        # Save to debug directory if debug mode is enabled
        if self.debug and self.debug_dir:
            debug_file = os.path.join(self.debug_dir, 'exported_deployment_descriptor.textproto')
            with open(debug_file, 'w') as f:
                f.write(exported_deployment)
            print(f"🐛 DEBUG: Saved exported deployment descriptor to: {debug_file}")
            print(f"    Preview (first 500 chars):\n{exported_deployment[:500]}...\n")
        
        print("✓ Deployment descriptor export test passed")
    
    def test_round_trip_preserves_host_ids(self, textproto_file=None):
        """Test: Verify that host IDs are preserved through round-trip
        
        Args:
            textproto_file: Optional path to textproto file. If not provided, will use first .textproto file found in test-data/
        """
        # Step 1: Use provided textproto file or find one in test-data
        if textproto_file is None:
            input_file = self._find_test_file('textproto')
        elif not os.path.isabs(textproto_file):
            input_file = self._get_test_file(textproto_file)
        else:
            input_file = textproto_file
        
        # Step 2: Import
        self.visualizer.file_format = "descriptor"
        self.visualizer.parse_cabling_descriptor(input_file)
        
        # Initialize templates (required for descriptor format)
        self._initialize_descriptor_visualizer(self.visualizer)
        
        # Step 3: Extract host IDs from imported data
        imported_host_ids = set()
        if self.visualizer.graph_hierarchy:
            for node in self.visualizer.graph_hierarchy:
                if 'host_id' in node:
                    imported_host_ids.add(node['host_id'])
        
        assert len(imported_host_ids) > 0, "Should have imported host IDs"
        
        # Step 4: Export
        visualization_data = self.visualizer.generate_visualization_data()
        cytoscape_data = {
            'elements': visualization_data['elements'],
            'metadata': visualization_data.get('metadata', {})
        }
        
        exported_textproto = export_cabling_descriptor_for_visualizer(cytoscape_data)
        
        # Step 5: Re-import
        exported_file = os.path.join(self.temp_dir, 'exported.textproto')
        with open(exported_file, 'w') as f:
            f.write(exported_textproto)
        
        # Verify file was created
        assert os.path.exists(exported_file), f"Exported file was not created: {exported_file}"
        assert os.path.getsize(exported_file) > 0, f"Exported file is empty: {exported_file}"
        
        visualizer2 = NetworkCablingCytoscapeVisualizer()
        visualizer2.file_format = "descriptor"
        visualizer2.parse_cabling_descriptor(exported_file)
        
        # Initialize templates for re-imported data (required for descriptor format)
        self._initialize_descriptor_visualizer(visualizer2)
        
        # Step 6: Generate re-imported visualization data for comparison
        reimported_visualization_data = visualizer2.generate_visualization_data()
        
        # Step 7: Verify host IDs match (correctness check)
        reimported_host_ids = set()
        if visualizer2.graph_hierarchy:
            for node in visualizer2.graph_hierarchy:
                if 'host_id' in node:
                    reimported_host_ids.add(node['host_id'])
        
        assert imported_host_ids == reimported_host_ids, \
            f"Host IDs should match: {imported_host_ids} == {reimported_host_ids}"
        
        # Step 8: Verify data presence - shelf nodes and connections
        initial_shelf_count = self._count_shelf_nodes(visualization_data)
        initial_edge_count = self._count_connections(visualization_data)
        initial_hostnames = self._extract_hostnames(visualization_data)
        
        reimported_shelf_count = self._count_shelf_nodes(reimported_visualization_data)
        reimported_edge_count = self._count_connections(reimported_visualization_data)
        reimported_hostnames = self._extract_hostnames(reimported_visualization_data)
        
        # Verify counts match
        assert reimported_shelf_count == initial_shelf_count, \
            f"Shelf node count should match: {reimported_shelf_count} == {initial_shelf_count}"
        assert reimported_edge_count == initial_edge_count, \
            f"Connection/edge count should match: {reimported_edge_count} == {initial_edge_count}"
        assert len(reimported_host_ids) == initial_shelf_count, \
            f"Host ID count should match shelf count: {len(reimported_host_ids)} == {initial_shelf_count}"
        
        # Verify hostnames are preserved
        assert initial_hostnames == reimported_hostnames, \
            f"Hostnames should match exactly. Initial: {initial_hostnames}, Re-imported: {reimported_hostnames}"
        
        print("✓ Host ID preservation test passed")


def run_tests(test_all=False, debug=False):
    """Run all tests
    
    Args:
        test_all: If True, run tests on all CSV/textproto files in test-data directory
        debug: If True, save exported files to debug directory for inspection
    """
    test_instance = TestRoundTrip(debug=debug)
    
    try:
        test_instance.setup_method()
        
        if test_all:
            print("Running round-trip tests on ALL files in test-data directory...")
            print("=" * 60)
            
            # Get all CSV files
            csv_files = sorted(TEST_DATA_DIR.glob('*.csv'))
            # Get all textproto files
            textproto_files = sorted(TEST_DATA_DIR.glob('*.textproto'))
            
            if not csv_files and not textproto_files:
                print(f"No CSV or textproto files found in {TEST_DATA_DIR}")
                print("Please add test files to the test-data directory.")
                sys.exit(1)
            
            passed = 0
            failed = 0
            failed_files = []
            
            # Test all CSV files
            for csv_file in csv_files:
                print(f"\n📄 Testing CSV file: {csv_file.name}")
                print("-" * 60)
                try:
                    test_instance.test_csv_import_export_cabling_descriptor_round_trip(csv_file=str(csv_file))
                    test_instance.test_export_deployment_descriptor(csv_file=str(csv_file))
                    print(f"✓ All tests passed for {csv_file.name}")
                    passed += 1
                except Exception as e:
                    print(f"✗ Tests failed for {csv_file.name}: {e}")
                    failed += 1
                    failed_files.append(str(csv_file))
                    import traceback
                    traceback.print_exc()
            
            # Test all textproto files
            for textproto_file in textproto_files:
                print(f"\n📄 Testing textproto file: {textproto_file.name}")
                print("-" * 60)
                try:
                    test_instance.test_cabling_descriptor_import_export_round_trip(textproto_file=str(textproto_file))
                    test_instance.test_round_trip_preserves_host_ids(textproto_file=str(textproto_file))
                    print(f"✓ All tests passed for {textproto_file.name}")
                    passed += 1
                except Exception as e:
                    print(f"✗ Tests failed for {textproto_file.name}: {e}")
                    failed += 1
                    failed_files.append(str(textproto_file))
                    import traceback
                    traceback.print_exc()
            
            # Summary
            print("\n" + "=" * 60)
            print(f"Test Summary:")
            print(f"  ✓ Passed: {passed}")
            print(f"  ✗ Failed: {failed}")
            if failed_files:
                print(f"\nFailed files:")
                for f in failed_files:
                    print(f"  - {f}")
            print("=" * 60)
            
            if failed > 0:
                sys.exit(1)
            else:
                print("All tests passed! ✓")
                if debug:
                    print(f"\n🐛 DEBUG: All exported files saved to: {test_instance.debug_dir}")
        else:
            print("Running round-trip tests...")
            print("=" * 60)
            
            test_instance.test_csv_import_export_cabling_descriptor_round_trip()
            test_instance.test_cabling_descriptor_import_export_round_trip()
            test_instance.test_export_deployment_descriptor()
            test_instance.test_round_trip_preserves_host_ids()
            
            print("=" * 60)
            print("All tests passed! ✓")
            if debug:
                print(f"\n🐛 DEBUG: All exported files saved to: {test_instance.debug_dir}")
        
    except Exception as e:
        print(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        test_instance.teardown_method()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Run import/export round-trip tests',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run tests on first file found (default)
  python tests/integration/round_trip_python_test.py
  
  # Run tests on ALL files in test-data directory
  python tests/integration/round_trip_python_test.py --all
  
  # Run tests with debug output (saves exported files for inspection)
  python tests/integration/round_trip_python_test.py --debug
        """
    )
    parser.add_argument(
        '--all',
        action='store_true',
        help='Run tests on all CSV and textproto files in test-data directory'
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Save exported files to debug directory for inspection'
    )
    
    args = parser.parse_args()
    run_tests(test_all=args.all, debug=args.debug)

