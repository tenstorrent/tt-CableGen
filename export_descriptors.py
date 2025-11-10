#!/usr/bin/env python3
"""
Export Tool - Extract cabling topology and deployment information from cytoscape.js visualization
Combined version - contains both CablingDescriptor and DeploymentDescriptor export functionality
"""

import json
import argparse
import sys
import os
import tempfile
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional, Any
from collections import defaultdict
import re

# Add the protobuf directory to Python path for protobuf imports
# Check for TT_METAL_HOME environment variable
tt_metal_home = os.environ.get("TT_METAL_HOME")
if not tt_metal_home:
    print("Error: TT_METAL_HOME environment variable is not set")
    print("Please set TT_METAL_HOME to the root directory of your tt-metal repository")
    sys.exit(1)

if not os.path.exists(tt_metal_home):
    print(f"Error: TT_METAL_HOME path does not exist: {tt_metal_home}")
    print("Please set TT_METAL_HOME to a valid directory")
    sys.exit(1)

protobuf_dir = os.path.join(tt_metal_home, "build", "tools", "scaleout", "protobuf")
sys.path.append(protobuf_dir)


try:
    import cluster_config_pb2
    import deployment_pb2
except ImportError as e:
    print(f"Error importing required modules: {e}")
    print(f"Make sure cluster_config_pb2.py and deployment_pb2.py are available in {protobuf_dir}")
    print("This should be: $TT_METAL_HOME/build/tools/scaleout/protobuf/")
    sys.exit(1)

# Import protobuf modules
try:
    from google.protobuf import text_format
    from google.protobuf.message import Message
except ImportError:
    print("Warning: protobuf not available. Deployment descriptor export will not work.")
    text_format = None
    Message = None


class CytoscapeDataParser:
    """Parse Cytoscape.js data and extract connection information"""

    def __init__(self, data: Dict):
        self.data = data
        self.nodes = {}
        self.edges = []
        self._parse_data()

    def _parse_data(self):
        """Parse Cytoscape data into nodes and edges"""
        elements = self.data.get("elements", [])

        for element in elements:
            if "source" in element.get("data", {}):
                # This is an edge
                self.edges.append(element)
            else:
                # This is a node
                node_data = element.get("data", {})
                node_id = node_data.get("id")
                if node_id:
                    self.nodes[node_id] = element

    def extract_hierarchy_info(self, node_id: str) -> Optional[Dict]:
        """Extract shelf/tray/port info from node ID using only patterns that are actually used"""

        # Define patterns with their handlers - only include patterns that are actually used
        # Order matters: more specific patterns first, fallback last
        patterns = [
            # Current standard: <label>-tray#-port# (used by both 20-column and 8-column CSV formats)
            (r"(.+)-tray(\d+)-port(\d+)", self._handle_preferred_port),
            (r"(.+)-tray(\d+)", self._handle_preferred_tray),
            # Legacy ID pattern: port_<hostname>_<tray>_<port> (old node ID convention)
            (r"port_(.+)_(\d+)_(\d+)", self._handle_hostname_port),
            (r"tray_(.+)_(\d+)", self._handle_hostname_tray),
            (r"shelf_(.+)", self._handle_hostname_shelf),
            # Legacy ID pattern: port_<rack>_U<shelf>_<tray>_<port> (old node ID convention)
            (r"port_(\d+)_U(\d+)_(\d+)_(\d+)", self._handle_rack_hierarchy_port),
            (r"tray_(\d+)_U(\d+)_(\d+)", self._handle_rack_hierarchy_tray),
            (r"shelf_(\d+)_U(\d+)", self._handle_rack_hierarchy_shelf),
            # Fallback for any other format
            (r"(.+)", self._handle_preferred_shelf),
        ]

        for pattern, handler in patterns:
            match = re.match(pattern, node_id)
            if match:
                return handler(match.groups())

        return None

    # Pattern handlers for node ID formats (current standard and legacy patterns)
    def _handle_preferred_port(self, groups):
        """Handle <label>-tray#-port# format (current standard node ID format)"""
        return {
            "type": "port",
            "hostname": groups[0],
            "shelf_id": groups[0],
            "tray_id": int(groups[1]),
            "port_id": int(groups[2]),
        }

    def _handle_preferred_tray(self, groups):
        """Handle <label>-tray# format (current standard node ID format)"""
        return {"type": "tray", "hostname": groups[0], "shelf_id": groups[0], "tray_id": int(groups[1])}

    def _handle_preferred_shelf(self, groups):
        """Handle <label> format (current standard node ID format, fallback for any unmatched ID)"""
        return {"type": "shelf", "hostname": groups[0], "shelf_id": groups[0]}

    def _handle_hostname_port(self, groups):
        """Handle port_<hostname>_<tray>_<port> format (legacy node ID pattern)"""
        hostname = groups[0]
        return {
            "type": "port",
            "hostname": hostname,
            "shelf_id": hostname,
            "tray_id": int(groups[1]),
            "port_id": int(groups[2]),
        }

    def _handle_hostname_tray(self, groups):
        """Handle tray_<hostname>_<tray> format (legacy node ID pattern)"""
        hostname = groups[0]
        return {"type": "tray", "hostname": hostname, "shelf_id": hostname, "tray_id": int(groups[1])}

    def _handle_hostname_shelf(self, groups):
        """Handle shelf_<hostname> format (legacy node ID pattern)"""
        hostname = groups[0]
        return {"type": "shelf", "hostname": hostname, "shelf_id": hostname}

    def _handle_rack_hierarchy_port(self, groups):
        """Handle port_<rack>_U<shelf>_<tray>_<port> format (legacy node ID pattern)"""
        shelf_id = f"{groups[0]}_U{groups[1]}"
        return {
            "type": "port",
            "hostname": shelf_id,
            "shelf_id": shelf_id,
            "tray_id": int(groups[2]),
            "port_id": int(groups[3]),
        }

    def _handle_rack_hierarchy_tray(self, groups):
        """Handle tray_<rack>_U<shelf>_<tray> format (legacy node ID pattern)"""
        shelf_id = f"{groups[0]}_U{groups[1]}"
        return {"type": "tray", "hostname": shelf_id, "shelf_id": shelf_id, "tray_id": int(groups[2])}

    def _handle_rack_hierarchy_shelf(self, groups):
        """Handle shelf_<rack>_U<shelf> format (legacy node ID pattern)"""
        shelf_id = f"{groups[0]}_U{groups[1]}"
        return {"type": "shelf", "hostname": shelf_id, "shelf_id": shelf_id}

    def extract_connections(self) -> List[Dict]:
        """Extract connection information from edges"""
        connections = []

        for edge in self.edges:
            edge_data = edge.get("data", {})
            source_id = edge_data.get("source")
            target_id = edge_data.get("target")

            if not source_id or not target_id:
                continue

            # Extract hierarchy info for both endpoints
            source_info = self.extract_hierarchy_info(source_id)
            target_info = self.extract_hierarchy_info(target_id)

            if not source_info or not target_info:
                continue

            # Only process port-to-port connections
            if source_info.get("type") == "port" and target_info.get("type") == "port":
                connection = {
                    "source": {
                        "hostname": source_info.get("hostname"),
                        "shelf_id": source_info.get("shelf_id"),
                        "tray_id": source_info.get("tray_id"),
                        "port_id": source_info.get("port_id"),
                    },
                    "target": {
                        "hostname": target_info.get("hostname"),
                        "shelf_id": target_info.get("shelf_id"),
                        "tray_id": target_info.get("tray_id"),
                        "port_id": target_info.get("port_id"),
                    },
                }
                connections.append(connection)

        return connections


class VisualizerCytoscapeDataParser(CytoscapeDataParser):
    """Parser for visualizer-specific Cytoscape data"""

    def extract_connections(self) -> List[Dict]:
        """Extract connection information from edges"""
        connections = []

        for edge in self.edges:
            edge_data = edge.get("data", {})
            source_id = edge_data.get("source")
            target_id = edge_data.get("target")

            if not source_id or not target_id:
                continue

            # Extract hierarchy info for both endpoints
            source_info = self.extract_hierarchy_info(source_id)
            target_info = self.extract_hierarchy_info(target_id)

            if not source_info or not target_info:
                continue

            # Only process port-to-port connections
            if source_info.get("type") == "port" and target_info.get("type") == "port":
                # Get hostname from multiple sources (priority order):
                # 1. Edge data (source_hostname/destination_hostname from 20-column format)
                # 2. Node data (from port/tray/shelf hierarchy)
                source_hostname = (
                    edge_data.get("source_hostname")
                    or self._get_hostname_from_port(source_id)
                )
                target_hostname = (
                    edge_data.get("destination_hostname")
                    or self._get_hostname_from_port(target_id)
                )

                # Get node_type from the shelf nodes
                source_node_type = self._get_node_type_from_port(source_id)
                target_node_type = self._get_node_type_from_port(target_id)

                connection = {
                    "source": {
                        "hostname": source_hostname,
                        "shelf_id": source_info.get("shelf_id"),
                        "tray_id": source_info.get("tray_id"),
                        "port_id": source_info.get("port_id"),
                        "node_type": source_node_type,
                    },
                    "target": {
                        "hostname": target_hostname,
                        "shelf_id": target_info.get("shelf_id"),
                        "tray_id": target_info.get("tray_id"),
                        "port_id": target_info.get("port_id"),
                        "node_type": target_node_type,
                    },
                }
                connections.append(connection)

        return connections

    def _get_hostname_from_port(self, port_id: str) -> Optional[str]:
        """Get hostname from a port node's data (for 20-column format)"""
        # Find the port node in the cytoscape data
        for element in self.data.get("elements", []):
            if element.get("data", {}).get("id") == port_id:
                node_data = element.get("data", {})
                # Check if hostname is stored directly in the port data
                hostname = node_data.get("hostname")
                if hostname and hostname.strip():
                    return hostname.strip()

                # If not in port data, traverse up to get from parent shelf
                parent_id = node_data.get("parent")
                if parent_id:
                    # Find the parent (tray) node
                    for parent_element in self.data.get("elements", []):
                        if parent_element.get("data", {}).get("id") == parent_id:
                            parent_data = parent_element.get("data", {})
                            hostname = parent_data.get("hostname")
                            if hostname and hostname.strip():
                                return hostname.strip()

                            # Traverse up to shelf level
                            grandparent_id = parent_data.get("parent")
                            if grandparent_id:
                                for grandparent_element in self.data.get("elements", []):
                                    if grandparent_element.get("data", {}).get("id") == grandparent_id:
                                        grandparent_data = grandparent_element.get("data", {})
                                        hostname = grandparent_data.get("hostname")
                                        if hostname and hostname.strip():
                                            return hostname.strip()
        return None

    def _get_node_type_from_port(self, port_id: str) -> str:
        """Get node_type from a port by traversing up to the shelf node (always 2 levels up: Port -> Tray -> Shelf)"""
        # Find the port node
        for element in self.data.get("elements", []):
            if element.get("data", {}).get("id") == port_id:
                # Get parent (tray)
                tray_id = element.get("data", {}).get("parent")
                if not tray_id:
                    raise ValueError(f"Port '{port_id}' has no parent (expected tray)")
                
                # Find tray and get its parent (shelf)
                for tray_element in self.data.get("elements", []):
                    if tray_element.get("data", {}).get("id") == tray_id:
                        shelf_id = tray_element.get("data", {}).get("parent")
                        if not shelf_id:
                            raise ValueError(f"Tray '{tray_id}' has no parent (expected shelf)")
                        
                        # Find shelf and get node_type
                        for shelf_element in self.data.get("elements", []):
                            if shelf_element.get("data", {}).get("id") == shelf_id:
                                node_type = shelf_element.get("data", {}).get("shelf_node_type")
                                if not node_type:
                                    raise ValueError(f"Shelf '{shelf_id}' is missing shelf_node_type")
                                return node_type.upper()
        
        raise ValueError(f"Could not find port '{port_id}' in cytoscape data")


class DeploymentDataParser:
    """Parse Cytoscape.js data and extract deployment information"""

    def __init__(self, data: Dict):
        self.data = data
        self.nodes = {}
        self._parse_data()

    def _parse_data(self):
        """Parse Cytoscape data into nodes"""
        elements = self.data.get("elements", [])

        for element in elements:
            if "source" not in element.get("data", {}):
                # This is a node (not an edge)
                node_data = element.get("data", {})
                node_id = node_data.get("id")
                if node_id:
                    self.nodes[node_id] = element

    def _extract_host_info(self, node_id: str, node_data: Dict) -> Optional[Dict]:
        """Extract host information from a shelf node"""
        # Check if this is a shelf node
        if node_data.get("type") != "shelf":
            return None

        # Extract hostname and location information
        # Only use hostname from data - never fall back to node_id (which is immutable)
        hostname = node_data.get("hostname")
        hall = node_data.get("hall")
        aisle = node_data.get("aisle")
        rack_num = node_data.get("rack_num") or node_data.get("rack")
        shelf_u = node_data.get("shelf_u")
        node_type = node_data.get("shelf_node_type")

        # Convert node_type to uppercase for internal storage
        if node_type:
            node_type = node_type.upper()

        # Normalize shelf_u to integer (strip 'U' prefix if present)
        if shelf_u is not None:
            if isinstance(shelf_u, str) and shelf_u.startswith("U"):
                shelf_u = int(shelf_u[1:])
            else:
                shelf_u = int(shelf_u)

        # Build host info dictionary with all available data
        host_info = {}

        # Add hostname if available (20-column format or 8-column format)
        if hostname and hostname.strip():
            host_info["hostname"] = hostname.strip()

        # Add location information if available (20-column format with full hierarchy)
        has_location = (
            hall and hall.strip() and aisle and aisle.strip() and rack_num is not None and shelf_u is not None
        )

        if has_location:
            host_info["hall"] = hall.strip()
            host_info["aisle"] = aisle.strip()
            host_info["rack_num"] = int(rack_num)
            host_info["shelf_u"] = shelf_u

        # Add node type if available
        if node_type:
            host_info["node_type"] = node_type

        # Return None if we have neither hostname nor location info
        if not host_info.get("hostname") and not has_location:
            return None

        return host_info

    def extract_hosts(self) -> List[Dict]:
        """Extract host information from shelf nodes"""
        hosts = []

        for node_id, node_element in self.nodes.items():
            node_data = node_element.get("data", {})
            host_info = self._extract_host_info(node_id, node_data)

            if host_info:
                hosts.append(host_info)

        return hosts


def extract_host_list_from_connections(cytoscape_data: Dict) -> List[Tuple[str, str]]:
    """
    Extract a consistent, sorted list of (hostname, node_type) from the visualization.
    
    This function extracts hosts from:
    1. Connections (connected shelf nodes)
    2. Standalone shelf nodes (nodes without connections)
    
    This function is used by BOTH CablingDescriptor and DeploymentDescriptor exports
    to ensure they have the exact same host list in the exact same order.
    
    IMPORTANT FOR EMPTY CANVAS:
    This function works correctly for empty canvas scenarios where users:
    - Create an empty canvas (createEmptyVisualization in visualizer.js)
    - Manually add nodes using the "Add Node" button (addNewNode in visualizer.js)
    - Draw connections between ports
    - Export descriptors
    
    The addNewNode function creates shelf nodes with:
    - hostname: Required for host identification
    - shelf_node_type: Required for node type (WH_N150, GS_E150, etc.)
    - hall, aisle, rack_num, shelf_u: Optional location data
    
    Returns:
        List of (hostname, node_type) tuples, sorted alphabetically by hostname
        
    The index in this list corresponds to:
    - CablingDescriptor: child_mappings[hostname].host_id = i
    - DeploymentDescriptor: deployment_descriptor.hosts[i]
    """
    parser = VisualizerCytoscapeDataParser(cytoscape_data)
    connections = parser.extract_connections()
    
    # Build host_info dict from connections
    host_info = {}
    def extract_and_validate_host(connection, role, host_info):
        host = connection[role].get("hostname", "")
        if host:
            host = host.strip()
        if host and host not in host_info:
            node_type = connection[role].get("node_type")
            if not node_type:
                raise ValueError(f"Missing node_type for {role} host '{host}' in connection")
            host_info[host] = node_type

    for connection in connections:
        extract_and_validate_host(connection, "source", host_info)
        extract_and_validate_host(connection, "target", host_info)
    
    # Also extract standalone nodes (shelf nodes without connections)
    deployment_parser = DeploymentDataParser(cytoscape_data)
    all_shelf_nodes = deployment_parser.extract_hosts()
    
    for shelf_node in all_shelf_nodes:
        hostname = shelf_node.get("hostname", "").strip()
        node_type = shelf_node.get("node_type")
        
        # Validate node_type is present
        if not node_type:
            raise ValueError(f"Missing node_type for standalone host '{hostname}'")
        
        # Add to host_info if not already present (connections take precedence)
        if hostname and hostname not in host_info:
            host_info[hostname] = node_type
    
    # Return sorted list of (hostname, node_type) tuples
    sorted_hosts = sorted(host_info.items())
    
    return sorted_hosts


def export_cabling_descriptor_for_visualizer(cytoscape_data: Dict, filename_prefix: str = "cabling_descriptor") -> str:
    """Export CablingDescriptor from Cytoscape data
    
    In hierarchy mode: Exports a recursive graph structure preserving the hierarchy
    In location mode: Exports a flat structure with all hosts at the root level
    """
    if cluster_config_pb2 is None:
        raise ImportError("cluster_config_pb2 not available")

    # Check visualization mode from metadata
    metadata = cytoscape_data.get("metadata", {})
    visualization_mode = metadata.get("visualization_mode", "location")
    
    if visualization_mode == "hierarchy":
        # Export hierarchical structure
        return export_hierarchical_cabling_descriptor(cytoscape_data)
    else:
        # Export flat structure (original behavior for location mode)
        return export_flat_cabling_descriptor(cytoscape_data)


def export_hierarchical_cabling_descriptor(cytoscape_data: Dict) -> str:
    """Export CablingDescriptor preserving the hierarchical structure (graphs, superpods, pods, etc.)
    
    This function uses the template_name already tagged on graph nodes to define each unique
    template only once, avoiding duplicate template definitions.
    """
    if cluster_config_pb2 is None:
        raise ImportError("cluster_config_pb2 not available")
    
    # Get connections for building the topology
    parser = VisualizerCytoscapeDataParser(cytoscape_data)
    connections = parser.extract_connections()
    
    # Get all elements
    elements = cytoscape_data.get("elements", [])
    
    # Build a map of node_id -> element for easy lookup
    element_map = {}
    for el in elements:
        if "data" in el and "id" in el["data"]:
            element_map[el["data"]["id"]] = el
    
    # Find root hierarchical nodes (compound nodes without parents, excluding racks)
    # A hierarchical container is any compound node that isn't a rack/tray/port
    # (i.e., it contains shelves or other graphs)
    root_graph_nodes = []
    for el in elements:
        el_data = el.get("data", {})
        el_type = el_data.get("type")
        has_parent = el_data.get("parent")
        
        # Skip non-hierarchical types (rack, tray, port are physical location containers)
        if el_type in ["rack", "tray", "port"]:
            continue
            
        # Check if this is a root node (no parent) and has children
        if not has_parent:
            # Check if it has children
            has_children = any(child.get("data", {}).get("parent") == el_data.get("id") 
                             for child in elements)
            if has_children:
                root_graph_nodes.append(el)
    
    if not root_graph_nodes:
        # No hierarchical structure found - fall back to flat export
        print("No hierarchical structure found, using flat export")
        return export_flat_cabling_descriptor(cytoscape_data)
    
    # Create ClusterDescriptor
    cluster_desc = cluster_config_pb2.ClusterDescriptor()
    
    # Collect all unique template names from graph nodes
    # We'll build each template only once
    print("Collecting unique graph templates...")
    unique_templates = set()
    nodes_by_template = {}  # template_name -> list of node elements using it
    
    for el in elements:
        el_data = el.get("data", {})
        el_type = el_data.get("type")
        
        # Skip non-hierarchical types
        if el_type in ["rack", "tray", "port", "shelf"]:
            continue
        
        # Get template name if available
        template_name = el_data.get("template_name")
        if template_name:
            unique_templates.add(template_name)
            if template_name not in nodes_by_template:
                nodes_by_template[template_name] = []
            nodes_by_template[template_name].append(el)
    
    print(f"Found {len(unique_templates)} unique graph templates: {sorted(unique_templates)}")
    
    # Track which templates have been built
    built_templates = set()
    
    # If there's only one root graph, use it directly
    if len(root_graph_nodes) == 1:
        root_graph_el = root_graph_nodes[0]
        root_graph_data = root_graph_el.get("data", {})
        root_graph_label = root_graph_data.get("label", root_graph_data.get("id", "root"))
        root_template_name = root_graph_data.get("template_name", f"template_{root_graph_label}")
        
        print(f"Building hierarchical descriptor with single root: {root_graph_label} (template: {root_template_name})")
        
        # Build the root template and all referenced templates recursively
        root_template = build_graph_template_with_reuse(
            root_graph_el, element_map, connections, cluster_desc, built_templates
        )
        
        if root_template:
            cluster_desc.graph_templates[root_template_name].CopyFrom(root_template)
            
            # Create root instance
            root_instance = cluster_config_pb2.GraphInstance()
            root_instance.template_name = root_template_name
            
            # Add child mappings and nested instances
            host_id = 0
            host_id = add_child_mappings_with_reuse(
                root_graph_el, element_map, root_instance, host_id
            )
            
            cluster_desc.root_instance.CopyFrom(root_instance)
            
            print(f"Exported {host_id} hosts in hierarchical structure with {len(built_templates)} unique templates")
    else:
        # Multiple root graphs - create a synthetic "total_view" root that contains all of them
        print(f"Building hierarchical descriptor with {len(root_graph_nodes)} root graphs - creating total_view container")
        
        # Create a synthetic root template that contains all root graphs as children
        root_template = cluster_config_pb2.GraphTemplate()
        root_template_name = "template_total_view"
        
        # Process each root graph as a child of the synthetic root
        for root_graph_el in root_graph_nodes:
            root_graph_data = root_graph_el.get("data", {})
            root_graph_label = root_graph_data.get("label", root_graph_data.get("id", "root"))
            child_template_name = root_graph_data.get("template_name", f"template_{root_graph_label}")
            
            print(f"  Processing root graph: {root_graph_label} (template: {child_template_name})")
            
            # Build template for this root graph (only if not already built)
            if child_template_name not in built_templates:
                child_template = build_graph_template_with_reuse(
                    root_graph_el, element_map, connections, cluster_desc, built_templates
                )
                
                if child_template:
                    # Add child template to cluster descriptor
                    cluster_desc.graph_templates[child_template_name].CopyFrom(child_template)
            
            # Add reference to this template in synthetic root
            child = root_template.children.add()
            child.name = root_graph_label
            child.graph_ref.graph_template = child_template_name
            print(f"    Added graph_ref to '{root_graph_label}' referencing template '{child_template_name}'")
        
        # Add all connections to the synthetic root
        port_connections = root_template.internal_connections["QSFP_DD"]
        for connection in connections:
            conn = port_connections.connections.add()
            conn.port_a.tray_id = connection["source"]["tray_id"]
            conn.port_a.port_id = connection["source"]["port_id"]
            conn.port_b.tray_id = connection["target"]["tray_id"]
            conn.port_b.port_id = connection["target"]["port_id"]
        
        # Add the synthetic root template
        cluster_desc.graph_templates[root_template_name].CopyFrom(root_template)
        
        # Create root instance
        root_instance = cluster_config_pb2.GraphInstance()
        root_instance.template_name = root_template_name
        
        # Add child instances for each root graph
        host_id = 0
        for root_graph_el in root_graph_nodes:
            root_graph_data = root_graph_el.get("data", {})
            root_graph_label = root_graph_data.get("label", root_graph_data.get("id", "root"))
            child_template_name = root_graph_data.get("template_name", f"template_{root_graph_label}")
            
            # Create a nested GraphInstance for this root graph
            nested_instance = cluster_config_pb2.GraphInstance()
            nested_instance.template_name = child_template_name
            
            # Add child mappings recursively for this graph
            host_id = add_child_mappings_with_reuse(root_graph_el, element_map, nested_instance, host_id)
            
            # Add the nested instance to the root's child_mappings
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.sub_instance.CopyFrom(nested_instance)
            root_instance.child_mappings[root_graph_label].CopyFrom(child_mapping)
        
        cluster_desc.root_instance.CopyFrom(root_instance)
        
        print(f"Exported {host_id} hosts in hierarchical structure with {len(built_templates)} unique templates")
    
    return text_format.MessageToString(cluster_desc)


def build_graph_template_with_reuse(node_el, element_map, connections, cluster_desc, built_templates):
    """Build a GraphTemplate, reusing templates for nodes with the same template_name
    
    Args:
        node_el: The node element to build a template for
        element_map: Map of node_id -> element
        connections: List of all connections
        cluster_desc: The ClusterDescriptor being built
        built_templates: Set of template names that have already been built
    
    Returns:
        GraphTemplate for this node
    """
    if cluster_config_pb2 is None:
        return None
        
    node_data = node_el.get("data", {})
    node_id = node_data.get("id")
    node_type = node_data.get("type")
    node_label = node_data.get("label", node_id)
    node_template_name = node_data.get("template_name", f"template_{node_label}")
    
    print(f"Building template '{node_template_name}' for {node_type} '{node_label}' (id: {node_id})")
    
    # Mark this template as built
    built_templates.add(node_template_name)
    
    graph_template = cluster_config_pb2.GraphTemplate()
    
    # Find all direct children of this node
    children = [el for el in element_map.values() 
                if el.get("data", {}).get("parent") == node_id]
    
    print(f"  Found {len(children)} direct children")
    
    # Process each child
    for child_el in children:
        child_data = child_el.get("data", {})
        child_id = child_data.get("id")
        child_type = child_data.get("type")
        child_label = child_data.get("label", child_id)
        
        # Determine if this is a leaf node (shelf) or a hierarchical container
        is_leaf = child_type == "shelf"
        is_physical_container = child_type in ["rack", "tray", "port"]
        
        if is_leaf:
            # This is a leaf node (actual hardware)
            child = graph_template.children.add()
            child_name = child_data.get("hostname", child_label)
            child.name = child_name
            # Look for node_type in shelf_node_type field (standard field name)
            node_descriptor = child_data.get("shelf_node_type") or child_data.get("node_descriptor_type") or child_data.get("node_type", "UNKNOWN")
            if not node_descriptor or node_descriptor == "UNKNOWN":
                raise ValueError(f"Shelf '{child_label}' (hostname: {child_data.get('hostname')}) is missing shelf_node_type")
            child.node_ref.node_descriptor = node_descriptor.upper()
            print(f"    Added leaf node '{child_name}' with descriptor '{node_descriptor}'")
            
        elif not is_physical_container:
            # This is a hierarchical container (any compound node that's not rack/tray/port)
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            print(f"    Processing hierarchical child '{child_label}' (type: {child_type}, template: {child_template_name})")
            
            # Only build this child's template if it hasn't been built yet
            if child_template_name not in built_templates:
                # Recursively build template for this child
                child_template = build_graph_template_with_reuse(
                    child_el, element_map, connections, cluster_desc, built_templates
                )
                
                if child_template:
                    # Add child template to cluster descriptor
                    cluster_desc.graph_templates[child_template_name].CopyFrom(child_template)
                    print(f"    Built and added new template '{child_template_name}' to cluster descriptor")
            else:
                print(f"    Template '{child_template_name}' already built, reusing it")
            
            # Add reference to this template in parent
            child = graph_template.children.add()
            child.name = child_label
            child.graph_ref.graph_template = child_template_name
            print(f"    Added graph_ref to '{child_label}' referencing template '{child_template_name}'")
    
    # Add connections that are within this graph scope
    # Only add connections between children of this node
    child_ids = {child_el.get("data", {}).get("id") for child_el in children}
    
    port_connections = graph_template.internal_connections["QSFP_DD"]
    for connection in connections:
        source_hostname = connection["source"]["hostname"]
        target_hostname = connection["target"]["hostname"]
        
        # Check if both endpoints are within this graph's children
        # (We need to traverse down to shelf level to check)
        if is_connection_within_scope(source_hostname, target_hostname, child_ids, element_map):
            conn = port_connections.connections.add()
            
            # Build path to source
            source_path = get_path_to_host(source_hostname, node_id, element_map)
            for path_elem in source_path:
                conn.port_a.path.append(path_elem)
            conn.port_a.tray_id = connection["source"]["tray_id"]
            conn.port_a.port_id = connection["source"]["port_id"]
            
            # Build path to target
            target_path = get_path_to_host(target_hostname, node_id, element_map)
            for path_elem in target_path:
                conn.port_b.path.append(path_elem)
            conn.port_b.tray_id = connection["target"]["tray_id"]
            conn.port_b.port_id = connection["target"]["port_id"]
    
    return graph_template


def add_child_mappings_with_reuse(node_el, element_map, graph_instance, host_id):
    """Add child mappings to a GraphInstance
    
    Args:
        node_el: The node element to add mappings for
        element_map: Map of node_id -> element
        graph_instance: The GraphInstance to add mappings to
        host_id: Current host_id counter
    
    Returns:
        Updated host_id counter
    """
    if cluster_config_pb2 is None:
        return host_id
        
    node_data = node_el.get("data", {})
    node_id = node_data.get("id")
    
    # Find all direct children of this node
    children = [el for el in element_map.values() 
                if el.get("data", {}).get("parent") == node_id]
    
    # Process each child
    for child_el in children:
        child_data = child_el.get("data", {})
        child_type = child_data.get("type")
        child_label = child_data.get("label", child_data.get("id"))
        
        # Skip physical containers (rack, tray, port)
        if child_type in ["rack", "tray", "port"]:
            continue
        
        if child_type == "shelf":
            # This is a leaf node - map it to a host_id
            child_name = child_data.get("hostname", child_label)
            
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.host_id = host_id
            graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
            
            host_id += 1
            
        else:
            # This is a hierarchical container - create a nested instance
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            nested_instance = cluster_config_pb2.GraphInstance()
            nested_instance.template_name = child_template_name
            
            # Recursively add child mappings
            host_id = add_child_mappings_with_reuse(child_el, element_map, nested_instance, host_id)
            
            # Add the nested instance to this graph's child_mappings
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.sub_instance.CopyFrom(nested_instance)
            graph_instance.child_mappings[child_label].CopyFrom(child_mapping)
    
    return host_id


def build_graph_template_recursive(node_el, element_map, connections, cluster_desc):
    """Recursively build a GraphTemplate from a hierarchical node structure
    
    NOTE: This is the old function that doesn't support template reuse.
    Use build_graph_template_with_reuse for new code.
    """
    if cluster_config_pb2 is None:
        return None
        
    node_data = node_el.get("data", {})
    node_id = node_data.get("id")
    node_type = node_data.get("type")
    node_label = node_data.get("label", node_id)
    
    print(f"Building template for {node_type} '{node_label}' (id: {node_id})")
    
    graph_template = cluster_config_pb2.GraphTemplate()
    
    # Find all direct children of this node
    children = [el for el in element_map.values() 
                if el.get("data", {}).get("parent") == node_id]
    
    print(f"  Found {len(children)} direct children")
    
    # Process each child
    for child_el in children:
        child_data = child_el.get("data", {})
        child_id = child_data.get("id")
        child_type = child_data.get("type")
        child_label = child_data.get("label", child_id)
        
        # Determine if this is a leaf node (shelf) or a hierarchical container
        is_leaf = child_type == "shelf"
        is_physical_container = child_type in ["rack", "tray", "port"]
        
        if is_leaf:
            # This is a leaf node (actual hardware)
            child = graph_template.children.add()
            child_name = child_data.get("hostname", child_label)
            child.name = child_name
            # Look for node_type in shelf_node_type field (standard field name)
            node_descriptor = child_data.get("shelf_node_type") or child_data.get("node_descriptor_type") or child_data.get("node_type", "UNKNOWN")
            if not node_descriptor or node_descriptor == "UNKNOWN":
                raise ValueError(f"Shelf '{child_label}' (hostname: {child_data.get('hostname')}) is missing shelf_node_type")
            child.node_ref.node_descriptor = node_descriptor.upper()
            print(f"    Added leaf node '{child_name}' with descriptor '{node_descriptor}'")
            
        elif not is_physical_container:
            # This is a hierarchical container (any compound node that's not rack/tray/port)
            # These represent logical groupings (could be named anything: superpod, pod, zone, etc.)
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            print(f"    Processing hierarchical child '{child_label}' (type: {child_type})")
            
            # Recursively build template for this child
            child_template = build_graph_template_recursive(child_el, element_map, connections, cluster_desc)
            
            if child_template:
                # Add child template to cluster descriptor
                cluster_desc.graph_templates[child_template_name].CopyFrom(child_template)
                print(f"    Added template '{child_template_name}' to cluster descriptor")
                
                # Add reference to this template in parent
                child = graph_template.children.add()
                child.name = child_label
                child.graph_ref.graph_template = child_template_name
                print(f"    Added graph_ref to '{child_label}' referencing template '{child_template_name}'")
    
    # Add connections that are within this graph scope
    # Only add connections between children of this node
    child_ids = {child_el.get("data", {}).get("id") for child_el in children}
    
    port_connections = graph_template.internal_connections["QSFP_DD"]
    for connection in connections:
        source_hostname = connection["source"]["hostname"]
        target_hostname = connection["target"]["hostname"]
        
        # Check if both endpoints are within this graph's children
        # (We need to traverse down to shelf level to check)
        if is_connection_within_scope(source_hostname, target_hostname, child_ids, element_map):
            conn = port_connections.connections.add()
            
            # Build path to source
            source_path = get_path_to_host(source_hostname, node_id, element_map)
            for path_elem in source_path:
                conn.port_a.path.append(path_elem)
            conn.port_a.tray_id = connection["source"]["tray_id"]
            conn.port_a.port_id = connection["source"]["port_id"]
            
            # Build path to target
            target_path = get_path_to_host(target_hostname, node_id, element_map)
            for path_elem in target_path:
                conn.port_b.path.append(path_elem)
            conn.port_b.tray_id = connection["target"]["tray_id"]
            conn.port_b.port_id = connection["target"]["port_id"]
    
    return graph_template


def is_connection_within_scope(source_hostname, target_hostname, child_ids, element_map):
    """Check if both endpoints of a connection are within the given scope (child_ids)"""
    # Find shelf nodes with these hostnames
    source_found = False
    target_found = False
    
    for el in element_map.values():
        data = el.get("data", {})
        if data.get("type") == "shelf":
            hostname = data.get("hostname")
            if hostname == source_hostname:
                # Check if this shelf is a descendant of any child in child_ids
                if is_descendant_of_any(el, child_ids, element_map):
                    source_found = True
            if hostname == target_hostname:
                if is_descendant_of_any(el, child_ids, element_map):
                    target_found = True
    
    return source_found and target_found


def is_descendant_of_any(node_el, ancestor_ids, element_map):
    """Check if a node is a descendant of any node in ancestor_ids"""
    current = node_el
    while current:
        parent_id = current.get("data", {}).get("parent")
        if not parent_id:
            break
        if parent_id in ancestor_ids:
            return True
        current = element_map.get(parent_id)
    return False


def get_path_to_host(hostname, scope_node_id, element_map):
    """Get the path from scope_node_id down to the host with given hostname"""
    # Find the shelf node with this hostname
    shelf_node = None
    for el in element_map.values():
        data = el.get("data", {})
        if data.get("type") == "shelf" and data.get("hostname") == hostname:
            shelf_node = el
            break
    
    if not shelf_node:
        return [hostname]
    
    # Build path from scope_node_id down to shelf_node
    path = []
    current = shelf_node
    
    while current:
        data = current.get("data", {})
        node_id = data.get("id")
        
        if node_id == scope_node_id:
            break
            
        # Add node label/name to path (at the beginning)
        if data.get("type") == "shelf":
            path.insert(0, data.get("hostname", data.get("label", node_id)))
        else:
            path.insert(0, data.get("label", node_id))
        
        # Move up to parent
        parent_id = data.get("parent")
        if not parent_id:
            break
        current = element_map.get(parent_id)
    
    return path if path else [hostname]


def add_child_mappings_recursive(node_el, element_map, graph_instance, host_id):
    """Recursively add child mappings and nested instances for all nodes in the hierarchy
    
    For leaf nodes (shelves): Creates ChildMapping with host_id
    For hierarchical nodes (any non-physical container): Creates nested GraphInstance with its own children
    """
    if cluster_config_pb2 is None:
        return host_id
        
    node_data = node_el.get("data", {})
    node_id = node_data.get("id")
    
    # Find all direct children
    children = [el for el in element_map.values() 
                if el.get("data", {}).get("parent") == node_id]
    
    for child_el in children:
        child_data = child_el.get("data", {})
        child_type = child_data.get("type")
        child_label = child_data.get("label", child_data.get("id"))
        
        # Determine if this is a leaf node (shelf) or a hierarchical container
        is_leaf = child_type == "shelf"
        is_physical_container = child_type in ["rack", "tray", "port"]
        
        if is_leaf:
            # Leaf node - add mapping
            child_name = child_data.get("hostname", child_label)
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.host_id = host_id
            graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
            print(f"  Mapped host '{child_name}' to host_id {host_id}")
            host_id += 1
            
        elif not is_physical_container:
            # Hierarchical child (any compound node that's not rack/tray/port)
            # These represent logical groupings (could be named anything: superpod, pod, zone, region, etc.)
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            # Create a new GraphInstance for this child
            nested_instance = cluster_config_pb2.GraphInstance()
            nested_instance.template_name = child_template_name
            
            # Recursively populate the nested instance
            host_id = add_child_mappings_recursive(child_el, element_map, nested_instance, host_id)
            
            # Add the nested instance to the parent's child_mappings
            # Use sub_instance (which is a GraphInstance) to get the child
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.sub_instance.CopyFrom(nested_instance)
            graph_instance.child_mappings[child_label].CopyFrom(child_mapping)
            
            print(f"  Created nested instance for '{child_label}' with template '{child_template_name}'")
    
    return host_id


def export_flat_cabling_descriptor(cytoscape_data: Dict) -> str:
    """Export CablingDescriptor with flat structure (original behavior for location mode)"""
    if cluster_config_pb2 is None:
        raise ImportError("cluster_config_pb2 not available")

    # Get connections for building the topology
    parser = VisualizerCytoscapeDataParser(cytoscape_data)
    connections = parser.extract_connections()

    # Get the common sorted host list (shared with DeploymentDescriptor)
    sorted_hosts = extract_host_list_from_connections(cytoscape_data)

    # Create ClusterDescriptor with full structure
    cluster_desc = cluster_config_pb2.ClusterDescriptor()

    # Create graph template
    template_name = "extracted_topology"
    graph_template = cluster_config_pb2.GraphTemplate()
    
    # Add child instances (one per host) using ACTUAL HOSTNAMES as child names
    # This avoids confusion and makes connections clearly map to the right hosts
    for i, (hostname, node_type) in enumerate(sorted_hosts):
        child = graph_template.children.add()
        child.name = hostname  # Use actual hostname instead of generic "host_i"
        child.node_ref.node_descriptor = node_type.upper()  # Ensure node_descriptor is capitalized

    # Add connections to graph template
    port_connections = graph_template.internal_connections["QSFP_DD"]  # Default port type
    for connection in connections:
        conn = port_connections.connections.add()

        # Source port - use actual hostname directly
        conn.port_a.path.append(connection["source"]["hostname"])
        conn.port_a.tray_id = connection["source"]["tray_id"]
        conn.port_a.port_id = connection["source"]["port_id"]

        # Target port - use actual hostname directly
        conn.port_b.path.append(connection["target"]["hostname"])
        conn.port_b.tray_id = connection["target"]["tray_id"]
        conn.port_b.port_id = connection["target"]["port_id"]

    # Add graph template to cluster descriptor
    cluster_desc.graph_templates[template_name].CopyFrom(graph_template)

    # Create root instance
    root_instance = cluster_config_pb2.GraphInstance()
    root_instance.template_name = template_name

    # Map each child (by actual hostname) to its host_id (using the same sorted host list)
    for i, (hostname, node_type) in enumerate(sorted_hosts):
        child_mapping = cluster_config_pb2.ChildMapping()
        child_mapping.host_id = i
        root_instance.child_mappings[hostname].CopyFrom(child_mapping)  # Use actual hostname as key

    cluster_desc.root_instance.CopyFrom(root_instance)

    # Return the content directly
    return text_format.MessageToString(cluster_desc)


def export_deployment_descriptor_for_visualizer(
    cytoscape_data: Dict, filename_prefix: str = "deployment_descriptor"
) -> str:
    """Export DeploymentDescriptor from Cytoscape data

    Supports both 8-column format (hostname only) and 20-column format (hostname + location)
    
    IMPORTANT: This uses the SAME host list in the SAME order as the CablingDescriptor
    because the cabling generator uses host_id indices to map between them.
    """
    if deployment_pb2 is None:
        raise ImportError("deployment_pb2 not available")

    # Get the common sorted host list (shared with CablingDescriptor)
    sorted_hosts = extract_host_list_from_connections(cytoscape_data)
    
    # Get detailed deployment information for each host
    deployment_parser = DeploymentDataParser(cytoscape_data)
    all_hosts = deployment_parser.extract_hosts()
    
    # Create a map of hostname -> deployment info
    host_deployment_info = {}
    for host_data in all_hosts:
        hostname = host_data.get("hostname", "").strip()
        if hostname:
            host_deployment_info[hostname] = host_data
    
    # Create DeploymentDescriptor with hosts in the SAME order as CablingDescriptor
    deployment_descriptor = deployment_pb2.DeploymentDescriptor()
    
    # Iterate in the exact same order (using the common sorted host list)
    for i, (hostname, node_type) in enumerate(sorted_hosts):
        host_proto = deployment_descriptor.hosts.add()
        
        # Set hostname
        host_proto.host = hostname
        
        # Get deployment info if available
        deployment_info = host_deployment_info.get(hostname, {})
        
        # Set location information if available (20-column format)
        if "hall" in deployment_info and deployment_info["hall"]:
            host_proto.hall = deployment_info["hall"]
        if "aisle" in deployment_info and deployment_info["aisle"]:
            host_proto.aisle = deployment_info["aisle"]
        if "rack_num" in deployment_info:
            host_proto.rack = deployment_info["rack_num"]
        if "shelf_u" in deployment_info:
            host_proto.shelf_u = deployment_info["shelf_u"]
        
        # Set node type (from the common host list)
        if node_type:
            host_proto.node_type = node_type

    # Return the content directly instead of a file path
    return text_format.MessageToString(deployment_descriptor)
