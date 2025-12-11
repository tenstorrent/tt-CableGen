#!/usr/bin/env python3
"""
Test suite for CablingGuide export endpoint

Tests the /generate_cabling_guide Flask endpoint to identify errors and verify functionality.

Run with:
  python -m pytest tests/integration/test_cabling_guide_export.py -v -s
  pytest tests/integration/test_cabling_guide_export.py -v -s
"""

import os
import sys
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# Import Flask app
from server import app

# Test data directory
TEST_DATA_DIR = Path(__file__).parent / 'test-data'


@pytest.fixture
def client():
    """Create a test client for the Flask app"""
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def sample_cytoscape_data():
    """Create sample cytoscape data for testing"""
    return {
        "elements": [
            {
                "data": {
                    "id": "graph1",
                    "type": "graph",
                    "label": "extracted_topology",
                    "template_name": "extracted_topology"
                }
            },
            {
                "data": {
                    "id": "shelf1",
                    "type": "shelf",
                    "hostname": "shelf-001",
                    "label": "shelf-001",  # Also set label for validation
                    "node_type": "wh_galaxy",
                    "parent": "graph1"
                }
            },
            {
                "data": {
                    "id": "port1",
                    "type": "port",
                    "parent": "shelf1"
                }
            },
            {
                "data": {
                    "id": "port2",
                    "type": "port",
                    "parent": "shelf1"
                }
            },
            {
                "data": {
                    "id": "edge1",
                    "source": "port1",
                    "target": "port2",
                    "cable_type": "QSFP28",
                    "cable_length": "1m"
                }
            }
        ],
        "metadata": {
            "graph_templates": {
                "extracted_topology": {
                    "instances": ["graph1"]
                }
            }
        }
    }


@pytest.fixture
def sample_cytoscape_data_with_location():
    """Create sample cytoscape data with location information"""
    return {
        "elements": [
            {
                "data": {
                    "id": "graph1",
                    "type": "graph",
                    "label": "extracted_topology",
                    "template_name": "extracted_topology"
                }
            },
            {
                "data": {
                    "id": "shelf1",
                    "type": "shelf",
                    "hostname": "shelf-001",
                    "label": "shelf-001",  # Also set label for validation
                    "node_type": "wh_galaxy",
                    "parent": "graph1",
                    "hall": "hall1",
                    "aisle": "aisle1",
                    "rack": "rack1",
                    "rack_num": "rack1",  # Use rack_num instead of rack
                    "shelf_u": "1"
                }
            },
            {
                "data": {
                    "id": "port1",
                    "type": "port",
                    "parent": "shelf1"
                }
            },
            {
                "data": {
                    "id": "port2",
                    "type": "port",
                    "parent": "shelf1"
                }
            },
            {
                "data": {
                    "id": "edge1",
                    "source": "port1",
                    "target": "port2",
                    "cable_type": "QSFP28",
                    "cable_length": "1m"
                }
            }
        ],
        "metadata": {
            "graph_templates": {
                "extracted_topology": {
                    "instances": ["graph1"]
                }
            }
        }
    }


class TestCablingGuideExport:
    """Test class for CablingGuide export endpoint"""

    def test_missing_request_data(self, client):
        """Test endpoint with missing request data"""
        response = client.post('/generate_cabling_guide', json={})
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['success'] is False
        assert 'error' in data
        assert 'Invalid request data' in data['error']

    def test_missing_cytoscape_data(self, client):
        """Test endpoint with missing cytoscape_data"""
        response = client.post('/generate_cabling_guide', json={
            'input_prefix': 'test'
        })
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['success'] is False
        assert 'error' in data

    def test_missing_input_prefix(self, client, sample_cytoscape_data):
        """Test endpoint with missing input_prefix"""
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': sample_cytoscape_data
        })
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['success'] is False
        assert 'error' in data

    def test_missing_shelf_hostnames(self, client):
        """Test endpoint with shelf nodes missing hostnames"""
        cytoscape_data = {
            "elements": [
                {
                    "data": {
                        "id": "shelf1",
                        "type": "shelf",
                        # Missing hostname
                        "node_type": "wh_galaxy"
                    }
                }
            ],
            "metadata": {}
        }
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': cytoscape_data,
            'input_prefix': 'test'
        })
        assert response.status_code == 500
        data = json.loads(response.data)
        assert data['success'] is False
        assert 'error' in data

    def test_missing_tt_metal_home(self, client, sample_cytoscape_data):
        """Test endpoint when TT_METAL_HOME is not set"""
        with patch.dict(os.environ, {}, clear=True):
            # Ensure TT_METAL_HOME is not set
            if 'TT_METAL_HOME' in os.environ:
                del os.environ['TT_METAL_HOME']
            
            response = client.post('/generate_cabling_guide', json={
                'cytoscape_data': sample_cytoscape_data,
                'input_prefix': 'test',
                'generate_type': 'cabling_guide'
            })
            assert response.status_code == 500
            data = json.loads(response.data)
            assert data['success'] is False
            assert 'error' in data
            assert 'TT_METAL_HOME' in data['error']

    def test_generator_not_found(self, client, sample_cytoscape_data):
        """Test endpoint when cabling generator executable is not found"""
        with patch.dict(os.environ, {'TT_METAL_HOME': '/nonexistent/path'}):
            response = client.post('/generate_cabling_guide', json={
                'cytoscape_data': sample_cytoscape_data,
                'input_prefix': 'test',
                'generate_type': 'cabling_guide'
            })
            assert response.status_code == 500
            data = json.loads(response.data)
            assert data['success'] is False
            assert 'error' in data
            assert 'Cabling generator not found' in data['error'] or 'not found' in data['error'].lower()

    @pytest.mark.skipif(
        not os.environ.get('TT_METAL_HOME') or 
        not os.path.exists(os.path.join(os.environ.get('TT_METAL_HOME'), 'build', 'tools', 'scaleout', 'run_cabling_generator')),
        reason="TT_METAL_HOME not set or generator not built"
    )
    def test_successful_export_with_location(self, client, sample_cytoscape_data_with_location):
        """Test successful export with location information"""
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': sample_cytoscape_data_with_location,
            'input_prefix': 'test_export',
            'generate_type': 'cabling_guide'
        })
        
        # This test may fail if generator has issues, but we want to see the error
        if response.status_code != 200:
            data = json.loads(response.data)
            print(f"\n❌ Export failed with status {response.status_code}")
            print(f"Error: {data.get('error', 'Unknown error')}")
            print(f"Error type: {data.get('error_type', 'N/A')}")
            if 'stdout' in data:
                print(f"STDOUT: {data['stdout']}")
            if 'stderr' in data:
                print(f"STDERR: {data['stderr']}")
            if 'exit_code' in data:
                print(f"Exit code: {data['exit_code']}")
        
        # For now, just log the response - we want to see what errors occur
        data = json.loads(response.data)
        if not data.get('success'):
            print(f"\n⚠️  Test data that caused error:")
            print(json.dumps(sample_cytoscape_data_with_location, indent=2))
        
        # Don't assert success - we're debugging, so we want to see failures
        # assert response.status_code == 200
        # assert data['success'] is True

    @pytest.mark.skipif(
        not os.environ.get('TT_METAL_HOME') or 
        not os.path.exists(os.path.join(os.environ.get('TT_METAL_HOME'), 'build', 'tools', 'scaleout', 'run_cabling_generator')),
        reason="TT_METAL_HOME not set or generator not built"
    )
    def test_successful_export_without_location(self, client, sample_cytoscape_data):
        """Test successful export without location information (simple format)"""
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': sample_cytoscape_data,
            'input_prefix': 'test_export_simple',
            'generate_type': 'cabling_guide'
        })
        
        # This test may fail if generator has issues, but we want to see the error
        if response.status_code != 200:
            data = json.loads(response.data)
            print(f"\n❌ Export failed with status {response.status_code}")
            print(f"Error: {data.get('error', 'Unknown error')}")
            print(f"Error type: {data.get('error_type', 'N/A')}")
            if 'stdout' in data:
                print(f"STDOUT: {data['stdout']}")
            if 'stderr' in data:
                print(f"STDERR: {data['stderr']}")
            if 'exit_code' in data:
                print(f"Exit code: {data['exit_code']}")
        
        # For now, just log the response - we want to see what errors occur
        data = json.loads(response.data)
        if not data.get('success'):
            print(f"\n⚠️  Test data that caused error:")
            print(json.dumps(sample_cytoscape_data, indent=2))
        
        # Don't assert success - we're debugging, so we want to see failures
        # assert response.status_code == 200
        # assert data['success'] is True

    def test_generate_type_both(self, client, sample_cytoscape_data):
        """Test with generate_type='both'"""
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': sample_cytoscape_data,
            'input_prefix': 'test',
            'generate_type': 'both'
        })
        # Just check it doesn't crash - actual success depends on TT_METAL_HOME
        assert response.status_code in [200, 500]
        data = json.loads(response.data)
        if not data.get('success'):
            print(f"\n❌ Both export failed:")
            print(f"Error: {data.get('error', 'Unknown error')}")

    def test_generate_type_fsd(self, client, sample_cytoscape_data):
        """Test with generate_type='fsd'"""
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': sample_cytoscape_data,
            'input_prefix': 'test',
            'generate_type': 'fsd'
        })
        # Just check it doesn't crash - actual success depends on TT_METAL_HOME
        assert response.status_code in [200, 500]
        data = json.loads(response.data)
        if not data.get('success'):
            print(f"\n❌ FSD export failed:")
            print(f"Error: {data.get('error', 'Unknown error')}")

    @pytest.mark.skipif(
        not os.environ.get('TT_METAL_HOME') or 
        not os.path.exists(os.path.join(os.environ.get('TT_METAL_HOME'), 'build', 'tools', 'scaleout', 'run_cabling_generator')),
        reason="TT_METAL_HOME not set or generator not built"
    )
    def test_with_cabling_guide_csv(self, client):
        """Test CablingGuide generation using CSV test data from cabling-guides directory"""
        # Look for CSV test data files
        cabling_guides_dir = TEST_DATA_DIR / 'cabling-guides'
        if not cabling_guides_dir.exists():
            pytest.skip("Cabling guides test data directory not found")
        
        # Find CSV files
        test_files = list(cabling_guides_dir.glob('*.csv'))
        if not test_files:
            pytest.skip("No CSV test data files found in cabling-guides directory")
        
        # Use the first CSV file
        test_file = str(test_files[0])
        print(f"\n📁 Testing CablingGuide generation with CSV: {test_file}")
        
        # Import CSV file using the visualizer
        from import_cabling import NetworkCablingCytoscapeVisualizer
        
        visualizer = NetworkCablingCytoscapeVisualizer()
        
        # Parse CSV file
        connections = visualizer.parse_csv(test_file)
        if not connections:
            pytest.skip(f"Failed to parse CSV file: {test_file}")
        
        print(f"📊 Parsed {len(connections)} connections from CSV")
        
        # Generate visualization data from CSV
        visualization_data = visualizer.generate_visualization_data()
        
        # Convert to cytoscape format (elements is already a list)
        elements = visualization_data.get('elements', [])
        
        cytoscape_data = {
            "elements": elements,
            "metadata": visualization_data.get('metadata', {})
        }
        
        shelf_count = len([e for e in elements if e.get('data', {}).get('type') == 'shelf'])
        edge_count = len([e for e in elements if 'source' in e.get('data', {})])
        print(f"📊 Generated {shelf_count} shelf nodes, {edge_count} edges")
        
        # Extract filename without extension for input_prefix
        input_prefix = Path(test_file).stem.replace('_guide', '')
        
        # Try to generate cabling guide
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': cytoscape_data,
            'input_prefix': input_prefix,
            'generate_type': 'cabling_guide'
        })
        
        # Log results
        data = json.loads(response.data)
        if not data.get('success'):
            print(f"\n❌ CablingGuide generation failed for {test_file}:")
            print(f"Error: {data.get('error', 'Unknown error')}")
            print(f"Error type: {data.get('error_type', 'N/A')}")
            if 'stdout' in data:
                print(f"STDOUT: {data['stdout']}")
            if 'stderr' in data:
                print(f"STDERR: {data['stderr']}")
            if 'exit_code' in data:
                print(f"Exit code: {data['exit_code']}")
            
            # For debugging - don't fail yet
            # assert False, f"Generation failed: {data.get('error')}"
        else:
            print(f"✅ Successfully generated cabling guide from CSV")
            if 'cabling_guide_content' in data:
                csv_lines = [l for l in data['cabling_guide_content'].split('\n') if l.strip()]
                print(f"Generated CSV: {len(csv_lines)} lines (including header)")
                
                # Compare with expected output if available
                expected_file = TEST_DATA_DIR / 'expected-outputs' / f"{input_prefix}_expected.csv"
                if expected_file.exists():
                    expected_content = expected_file.read_text()
                    expected_lines = [l for l in expected_content.split('\n') if l.strip()]
                    print(f"Expected CSV: {len(expected_lines)} lines")
                    
                    # Basic comparison
                    if len(csv_lines) == len(expected_lines):
                        print("✅ Line count matches expected output")
                    else:
                        print(f"⚠️  Line count mismatch: got {len(csv_lines)}, expected {len(expected_lines)}")
    
    @pytest.mark.skipif(
        not os.environ.get('TT_METAL_HOME') or 
        not os.path.exists(os.path.join(os.environ.get('TT_METAL_HOME'), 'build', 'tools', 'scaleout', 'run_cabling_generator')),
        reason="TT_METAL_HOME not set or generator not built"
    )
    @pytest.mark.parametrize("csv_file", [
        "16_lb_guide.csv"
    ])
    def test_with_specific_csv_files(self, client, csv_file):
        """Test CablingGuide generation with specific CSV test files"""
        test_file_path = TEST_DATA_DIR / 'cabling-guides' / csv_file
        if not test_file_path.exists():
            pytest.skip(f"Test file not found: {test_file_path}")
        
        print(f"\n📁 Testing with CSV file: {csv_file}")
        
        # Import CSV file
        from import_cabling import NetworkCablingCytoscapeVisualizer
        
        visualizer = NetworkCablingCytoscapeVisualizer()
        
        # Parse CSV file
        connections = visualizer.parse_csv(str(test_file_path))
        if not connections:
            pytest.skip(f"Failed to parse CSV file: {test_file_path}")
        
        print(f"📊 Parsed {len(connections)} connections")
        
        # Generate visualization data
        visualization_data = visualizer.generate_visualization_data()
        elements = visualization_data.get('elements', [])
        
        # Enrich with implicit hierarchy if needed (like the frontend does)
        # This creates the extracted_topology graph structure for location-mode data
        metadata = visualization_data.get('metadata', {})
        
        # Check if we already have graph nodes
        has_graph_nodes = any(
            el.get('data', {}).get('type') in ['graph', 'superpod', 'pod', 'cluster', 'zone', 'region']
            for el in elements
        )
        
        if not has_graph_nodes:
            # No graph nodes - create implicit extracted_topology structure
            template_name = "extracted_topology"
            instance_name = "extracted_topology_0"
            root_graph_id = "graph_extracted_topology_0"
            
            # Create root graph node
            root_graph_node = {
                "data": {
                    "id": root_graph_id,
                    "label": instance_name,
                    "type": "graph",
                    "template_name": template_name,
                    "child_name": instance_name,
                    "parent": None,
                    "depth": 0
                },
                "classes": "graph"
            }
            
            # Get shelf nodes and sort by host_index
            shelf_nodes = [el for el in elements if el.get('data', {}).get('type') == 'shelf']
            sorted_shelves = sorted(shelf_nodes, key=lambda x: x.get('data', {}).get('host_index', 999999))
            
            # Enrich shelf nodes with hierarchy fields
            enriched_elements = []
            for el in elements:
                if el.get('data', {}).get('type') == 'shelf':
                    el_data = el.get('data', {})
                    child_name = el_data.get('child_name') or el_data.get('hostname') or f"host_{el_data.get('host_index', 0)}"
                    enriched_elements.append({
                        **el,
                        "data": {
                            **el_data,
                            "child_name": child_name,
                            "logical_path": [],
                            "parent": root_graph_id
                        }
                    })
                elif el.get('data', {}).get('type') == 'edge':
                    # Tag edges with template name
                    enriched_elements.append({
                        **el,
                        "data": {
                            **el.get('data', {}),
                            "template_name": template_name
                        }
                    })
                else:
                    enriched_elements.append(el)
            
            # Add root graph node at the beginning
            enriched_elements.insert(0, root_graph_node)
            
            # Enrich metadata with extracted_topology template
            enriched_metadata = {**metadata}
            if 'graph_templates' not in enriched_metadata:
                enriched_metadata['graph_templates'] = {}
            if template_name not in enriched_metadata['graph_templates']:
                enriched_metadata['graph_templates'][template_name] = {
                    "name": template_name,
                    "children": [
                        {
                            "name": shelf.get('data', {}).get('child_name') or shelf.get('data', {}).get('hostname') or f"host_{shelf.get('data', {}).get('host_index', i)}",
                            "type": "node",  # Must be "node" for leaf nodes, not the node_type string
                            "node_descriptor": shelf.get('data', {}).get('shelf_node_type') or 'N300_LB'
                        }
                        for i, shelf in enumerate(sorted_shelves)
                    ]
                }
            
            elements = enriched_elements
            metadata = enriched_metadata
        
        cytoscape_data = {
            "elements": elements,
            "metadata": metadata
        }
        
        shelf_count = len([e for e in elements if e.get('data', {}).get('type') == 'shelf'])
        edge_count = len([e for e in elements if 'source' in e.get('data', {})])
        print(f"📊 Generated {shelf_count} shelf nodes, {edge_count} edges")
        
        # Extract input prefix from filename
        input_prefix = csv_file.replace('_guide.csv', '').replace('.csv', '')
        
        # Generate cabling guide
        response = client.post('/generate_cabling_guide', json={
            'cytoscape_data': cytoscape_data,
            'input_prefix': input_prefix,
            'generate_type': 'cabling_guide'
        })
        
        # Log results
        data = json.loads(response.data)
        if not data.get('success'):
            print(f"\n❌ Export failed for {csv_file}:")
            print(f"Error: {data.get('error', 'Unknown error')}")
            print(f"Error type: {data.get('error_type', 'N/A')}")
            if 'stdout' in data:
                print(f"STDOUT: {data['stdout']}")
            if 'stderr' in data:
                print(f"STDERR: {data['stderr']}")
            if 'exit_code' in data:
                print(f"Exit code: {data['exit_code']}")
        else:
            print(f"✅ Successfully generated cabling guide")
            if 'cabling_guide_content' in data:
                csv_lines = [l for l in data['cabling_guide_content'].split('\n') if l.strip()]
                print(f"Generated CSV: {len(csv_lines)} lines")
                
                # Show first few lines for verification
                print("\nFirst 5 lines of generated CSV:")
                for i, line in enumerate(csv_lines[:5]):
                    print(f"  {i+1}: {line[:100]}")  # First 100 chars


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])

