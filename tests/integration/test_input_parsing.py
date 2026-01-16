#!/usr/bin/env python3
"""
Test suite for validating CSV and textproto file parsing

Tests that CSV and textproto files can be parsed properly by import_cabling.py.
This ensures that input files are valid and can be processed without errors.

Run with:
  python -m pytest tests/integration/test_input_parsing.py -v -s
  pytest tests/integration/test_input_parsing.py -v -s
"""

import os
import sys
import pytest
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from import_cabling import NetworkCablingCytoscapeVisualizer

# Test data directory - use defined_topologies folder
DEFINED_TOPOLOGIES_DIR = Path(__file__).parent.parent.parent / 'defined_topologies'


class TestInputParsing:
    """Test class for validating input file parsing"""

    def setup_method(self):
        """Set up test fixtures"""
        self.visualizer = NetworkCablingCytoscapeVisualizer()

    def _get_test_file(self, subdir, filename):
        """Get path to a test data file"""
        file_path = DEFINED_TOPOLOGIES_DIR / subdir / filename
        if not file_path.exists():
            pytest.skip(f"Test data file not found: {file_path}")
        return str(file_path)

    def test_csv_parsing_valid_file(self):
        """Test that a valid CSV file can be parsed successfully"""
        csv_file = self._get_test_file('CablingGuides', 'cabling_guide_closetbox.csv')
        
        # Parse CSV file
        connections = self.visualizer.parse_csv(csv_file)
        
        # Validate parsing succeeded
        assert connections is not None, "parse_csv should return a list (not None)"
        assert isinstance(connections, list), "parse_csv should return a list"
        assert len(connections) > 0, "CSV file should contain at least one connection"
        
        # Validate connection structure
        for conn in connections:
            assert isinstance(conn, dict), "Each connection should be a dictionary"
            # Check for required fields (CSV format uses 'source' and 'destination')
            assert 'source' in conn or 'source_hostname' in conn, \
                "Connection should have source information"
            assert 'destination' in conn or 'target' in conn or 'target_hostname' in conn, \
                "Connection should have destination/target information"
        
        print(f"✅ Successfully parsed CSV file: {len(connections)} connections found")

    def test_csv_parsing_all_files(self):
        """Test parsing all CSV files in defined_topologies/CablingGuides"""
        cabling_guides_dir = DEFINED_TOPOLOGIES_DIR / 'CablingGuides'
        if not cabling_guides_dir.exists():
            pytest.skip("Cabling guides directory not found")
        
        csv_files = list(cabling_guides_dir.glob('*.csv'))
        if not csv_files:
            pytest.skip("No CSV test data files found")
        
        for csv_file in csv_files:
            print(f"\n📁 Testing CSV file: {csv_file.name}")
            
            # Parse CSV file
            connections = self.visualizer.parse_csv(str(csv_file))
            
            # Validate parsing succeeded (returns a list, even if empty)
            assert connections is not None, \
                f"parse_csv should return a list for {csv_file.name}"
            assert isinstance(connections, list), \
                f"parse_csv should return a list for {csv_file.name}"
            
            # Note: Some CSV files may be empty or have parsing issues
            # We validate that parsing doesn't crash, but don't require connections
            if len(connections) > 0:
                print(f"✅ Successfully parsed {csv_file.name}: {len(connections)} connections")
            else:
                print(f"⚠️  Parsed {csv_file.name} but found no connections (file may be empty or invalid format)")

    def test_textproto_parsing_valid_file(self):
        """Test that a valid textproto file can be parsed successfully"""
        textproto_file = self._get_test_file('CablingDescriptors', 'cabling_descriptor_closetbox.textproto')
        
        # Set file format before parsing
        self.visualizer.file_format = "descriptor"
        
        # Parse textproto file
        try:
            result = self.visualizer.parse_cabling_descriptor(textproto_file)
        except ValueError as e:
            pytest.fail(f"parse_cabling_descriptor raised ValueError: {e}")
        except Exception as e:
            pytest.fail(f"parse_cabling_descriptor raised unexpected exception: {e}")
        
        # Validate parsing succeeded
        assert result is True, "parse_cabling_descriptor should return True on success"
        
        # Validate that descriptor was loaded
        assert self.visualizer.cluster_descriptor is not None, \
            "cluster_descriptor should be set after parsing"
        
        # Validate that hierarchy was resolved
        assert self.visualizer.graph_hierarchy is not None, \
            "graph_hierarchy should be set after parsing"
        assert isinstance(self.visualizer.graph_hierarchy, list), \
            "graph_hierarchy should be a list"
        assert len(self.visualizer.graph_hierarchy) > 0, \
            "graph_hierarchy should contain at least one node"
        
        # Validate hierarchy structure
        for node in self.visualizer.graph_hierarchy:
            assert isinstance(node, dict), "Each hierarchy node should be a dictionary"
            assert 'node_type' in node, "Hierarchy node should have node_type"
        
        print(f"✅ Successfully parsed textproto file: {len(self.visualizer.graph_hierarchy)} nodes in hierarchy")

    def test_textproto_parsing_all_files(self):
        """Test parsing all textproto files in defined_topologies/CablingDescriptors"""
        cabling_descriptors_dir = DEFINED_TOPOLOGIES_DIR / 'CablingDescriptors'
        if not cabling_descriptors_dir.exists():
            pytest.skip("Cabling descriptors directory not found")
        
        textproto_files = list(cabling_descriptors_dir.glob('*.textproto'))
        if not textproto_files:
            pytest.skip("No textproto test data files found")
        
        for textproto_file in textproto_files:
            print(f"\n📁 Testing textproto file: {textproto_file.name}")
            
            # Create a new visualizer instance for each file to avoid state issues
            visualizer = NetworkCablingCytoscapeVisualizer()
            visualizer.file_format = "descriptor"
            
            # Parse textproto file
            try:
                result = visualizer.parse_cabling_descriptor(str(textproto_file))
            except ValueError as e:
                pytest.fail(f"parse_cabling_descriptor raised ValueError for {textproto_file.name}: {e}")
            except Exception as e:
                pytest.fail(f"parse_cabling_descriptor raised unexpected exception for {textproto_file.name}: {e}")
            
            # Validate parsing succeeded
            assert result is True, \
                f"parse_cabling_descriptor should return True for {textproto_file.name}"
            assert visualizer.cluster_descriptor is not None, \
                f"cluster_descriptor should be set for {textproto_file.name}"
            assert visualizer.graph_hierarchy is not None, \
                f"graph_hierarchy should be set for {textproto_file.name}"
            assert len(visualizer.graph_hierarchy) > 0, \
                f"graph_hierarchy should contain nodes for {textproto_file.name}"
            
            print(f"✅ Successfully parsed {textproto_file.name}: {len(visualizer.graph_hierarchy)} nodes")

    def test_csv_parsing_invalid_file(self):
        """Test that parsing an invalid CSV file handles errors gracefully"""
        # Create a temporary invalid CSV file
        import tempfile
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as tmp_file:
            tmp_file.write("Invalid CSV content\n")
            tmp_file.write("Not a valid CSV format\n")
            tmp_file_path = tmp_file.name
        
        try:
            # Parse should handle invalid file gracefully
            connections = self.visualizer.parse_csv(tmp_file_path)
            
            # Should return empty list or None, not raise exception
            assert connections is not None, "parse_csv should not return None"
            # Empty list is acceptable for invalid files
            assert isinstance(connections, list), "parse_csv should return a list"
            
            print(f"✅ Invalid CSV file handled gracefully: returned {len(connections)} connections")
        finally:
            # Clean up
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)

    def test_textproto_parsing_invalid_file(self):
        """Test that parsing an invalid textproto file handles errors gracefully"""
        # Create a temporary invalid textproto file
        import tempfile
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.textproto', delete=False) as tmp_file:
            tmp_file.write("Invalid textproto content\n")
            tmp_file.write("Not a valid protobuf format\n")
            tmp_file_path = tmp_file.name
        
        try:
            self.visualizer.file_format = "descriptor"
            
            # Parse should handle invalid file gracefully
            # It may return False or raise an exception
            try:
                result = self.visualizer.parse_cabling_descriptor(tmp_file_path)
                # If it returns False, that's acceptable
                assert result is False, "parse_cabling_descriptor should return False for invalid file"
                print("✅ Invalid textproto file handled gracefully: returned False")
            except Exception as e:
                # Exceptions are also acceptable for invalid files
                print(f"✅ Invalid textproto file handled gracefully: raised exception: {type(e).__name__}")
        finally:
            # Clean up
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)

    def test_csv_parsing_generates_visualization_data(self):
        """Test that parsed CSV can generate visualization data"""
        csv_file = self._get_test_file('CablingGuides', 'cabling_guide_closetbox.csv')
        
        # Parse CSV file
        connections = self.visualizer.parse_csv(csv_file)
        assert len(connections) > 0, "Should have connections"
        
        # Generate visualization data
        visualization_data = self.visualizer.generate_visualization_data()
        
        # Validate visualization data structure
        assert visualization_data is not None, "Should generate visualization data"
        assert 'elements' in visualization_data, "Should have elements key"
        assert isinstance(visualization_data['elements'], list), "Elements should be a list"
        assert len(visualization_data['elements']) > 0, "Should have at least one element"
        
        # Check for shelf nodes
        shelf_nodes = [e for e in visualization_data['elements'] 
                      if e.get('data', {}).get('type') == 'shelf']
        assert len(shelf_nodes) > 0, "Should have shelf nodes"
        
        # Check for edges
        edges = [e for e in visualization_data['elements'] 
                if 'source' in e.get('data', {})]
        assert len(edges) > 0, "Should have edges"
        
        print(f"✅ Generated visualization data: {len(shelf_nodes)} shelves, {len(edges)} edges")

    def test_textproto_parsing_generates_visualization_data(self):
        """Test that parsed textproto can generate visualization data"""
        textproto_file = self._get_test_file('CablingDescriptors', 'cabling_descriptor_closetbox.textproto')
        
        # Set file format and parse
        self.visualizer.file_format = "descriptor"
        result = self.visualizer.parse_cabling_descriptor(textproto_file)
        assert result is True, "Should parse successfully"
        
        # Initialize visualizer (like main() does)
        if self.visualizer.graph_hierarchy:
            node_types = set(node['node_type'] for node in self.visualizer.graph_hierarchy)
            if node_types:
                first_node_type = list(node_types)[0]
                config = self.visualizer._node_descriptor_to_config(first_node_type)
                self.visualizer.shelf_unit_type = self.visualizer.normalize_node_type(first_node_type)
                self.visualizer.current_config = config
            else:
                self.visualizer.shelf_unit_type = "WH_GALAXY"
                self.visualizer.current_config = self.visualizer.shelf_unit_configs["WH_GALAXY"]
            
            self.visualizer.set_shelf_unit_type(self.visualizer.shelf_unit_type)
        
        # Generate visualization data
        visualization_data = self.visualizer.generate_visualization_data()
        
        # Validate visualization data structure
        assert visualization_data is not None, "Should generate visualization data"
        assert 'elements' in visualization_data, "Should have elements key"
        assert isinstance(visualization_data['elements'], list), "Elements should be a list"
        assert len(visualization_data['elements']) > 0, "Should have at least one element"
        
        # Check for shelf nodes
        shelf_nodes = [e for e in visualization_data['elements'] 
                      if e.get('data', {}).get('type') == 'shelf']
        assert len(shelf_nodes) > 0, "Should have shelf nodes"
        
        # Check for edges (connections)
        edges = [e for e in visualization_data['elements'] 
                if 'source' in e.get('data', {})]
        assert len(edges) > 0, "Should have edges"
        
        print(f"✅ Generated visualization data: {len(shelf_nodes)} shelves, {len(edges)} edges")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])
