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
            # Cabling descriptor format: <host_id>:t<tray>:p<port> (e.g., "0:t1:p3")
            # CSV imports now also use this format (numeric shelf IDs)
            (r"^(\d+):t(\d+):p(\d+)$", self._handle_descriptor_port),
            (r"^(\d+):t(\d+)$", self._handle_descriptor_tray),
            (r"^(\d+)$", self._handle_descriptor_shelf),
            # CSV standard: <label>-tray#-port# format
            (r"^(.+)-tray(\d+)-port(\d+)$", self._handle_preferred_port),
            (r"^(.+)-tray(\d+)$", self._handle_preferred_tray),
            # Hostname-based ID pattern: port_<hostname>_<tray>_<port>
            (r"^port_(.+)_(\d+)_(\d+)$", self._handle_hostname_port),
            (r"^tray_(.+)_(\d+)$", self._handle_hostname_tray),
            (r"^shelf_(.+)$", self._handle_hostname_shelf),
            # Rack hierarchy ID pattern: port_<rack>_U<shelf>_<tray>_<port>
            (r"^port_(\d+)_U(\d+)_(\d+)_(\d+)$", self._handle_rack_hierarchy_port),
            (r"^tray_(\d+)_U(\d+)_(\d+)$", self._handle_rack_hierarchy_tray),
            (r"^shelf_(\d+)_U(\d+)$", self._handle_rack_hierarchy_shelf),
            # Fallback for any other format
            (r"^(.+)$", self._handle_preferred_shelf),
        ]

        for pattern, handler in patterns:
            match = re.match(pattern, node_id)
            if match:
                return handler(match.groups())

        return None

    # Pattern handlers for node ID formats
    def _handle_descriptor_port(self, groups):
        """Handle <host_id>:t<tray>:p<port> format (cabling descriptor format)
        Example: "0:t1:p3" → host_id=0, tray=1, port=3
        """
        host_id = groups[0]
        return {
            "type": "port",
            "hostname": host_id,  # Use host_id as identifier
            "shelf_id": host_id,
            "tray_id": int(groups[1]),
            "port_id": int(groups[2]),
        }
    
    def _handle_descriptor_tray(self, groups):
        """Handle <host_id>:t<tray> format (cabling descriptor format)
        Example: "0:t1" → host_id=0, tray=1
        """
        host_id = groups[0]
        return {
            "type": "tray",
            "hostname": host_id,
            "shelf_id": host_id,
            "tray_id": int(groups[1])
        }
    
    def _handle_descriptor_shelf(self, groups):
        """Handle <host_id> format (cabling descriptor format)
        Example: "0" → host_id=0
        """
        host_id = groups[0]
        return {
            "type": "shelf",
            "hostname": host_id,
            "shelf_id": host_id
        }
    
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
        """Handle port_<hostname>_<tray>_<port> format"""
        hostname = groups[0]
        return {
            "type": "port",
            "hostname": hostname,
            "shelf_id": hostname,
            "tray_id": int(groups[1]),
            "port_id": int(groups[2]),
        }

    def _handle_hostname_tray(self, groups):
        """Handle tray_<hostname>_<tray> format"""
        hostname = groups[0]
        return {"type": "tray", "hostname": hostname, "shelf_id": hostname, "tray_id": int(groups[1])}

    def _handle_hostname_shelf(self, groups):
        """Handle shelf_<hostname> format"""
        hostname = groups[0]
        return {"type": "shelf", "hostname": hostname, "shelf_id": hostname}

    def _handle_rack_hierarchy_port(self, groups):
        """Handle port_<rack>_U<shelf>_<tray>_<port> format"""
        shelf_id = f"{groups[0]}_U{groups[1]}"
        return {
            "type": "port",
            "hostname": shelf_id,
            "shelf_id": shelf_id,
            "tray_id": int(groups[2]),
            "port_id": int(groups[3]),
        }

    def _handle_rack_hierarchy_tray(self, groups):
        """Handle tray_<rack>_U<shelf>_<tray> format"""
        shelf_id = f"{groups[0]}_U{groups[1]}"
        return {"type": "tray", "hostname": shelf_id, "shelf_id": shelf_id, "tray_id": int(groups[2])}

    def _handle_rack_hierarchy_shelf(self, groups):
        """Handle shelf_<rack>_U<shelf> format"""
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
        
        edges_processed = 0
        edges_skipped_no_ids = 0
        edges_skipped_no_info = 0
        edges_skipped_not_ports = 0
        edges_skipped_no_hostname = 0
        
        for edge in self.edges:
            edges_processed += 1
            edge_data = edge.get("data", {})
            source_id = edge_data.get("source")
            target_id = edge_data.get("target")

            if not source_id or not target_id:
                edges_skipped_no_ids += 1
                continue

            # Extract hierarchy info for both endpoints
            source_info = self.extract_hierarchy_info(source_id)
            target_info = self.extract_hierarchy_info(target_id)

            if not source_info or not target_info:
                edges_skipped_no_info += 1
                if edges_processed <= 5:  # Debug first few failures
                    print(f"[extract_connections] Edge {edges_processed}: source_id={source_id}, target_id={target_id}, source_info={source_info}, target_info={target_info}")
                continue

            # Only process port-to-port connections
            source_type = source_info.get("type")
            target_type = target_info.get("type")
            if source_type != "port" or target_type != "port":
                edges_skipped_not_ports += 1
                if edges_processed <= 5:  # Debug first few failures
                    print(f"[extract_connections] Edge {edges_processed}: Not port-to-port (source={source_type}, target={target_type})")
                continue
            
            # Get hostname from node hierarchy (port -> tray -> shelf)
            # This ensures we always use the current hostname from the shelf node,
            # not stale data that might be stored in edge metadata
            source_hostname = self._get_hostname_from_port(source_id)
            target_hostname = self._get_hostname_from_port(target_id)
            
            # Fallback to edge data only if we can't traverse the hierarchy
            # (e.g., for CSV imports where edge might have hostname but nodes don't)
            if not source_hostname:
                source_hostname = edge_data.get("source_hostname")
            if not target_hostname:
                target_hostname = edge_data.get("destination_hostname")
            
            # Skip if we still don't have hostnames
            if not source_hostname or not target_hostname:
                edges_skipped_no_hostname += 1
                if edges_processed <= 5:  # Debug first few failures
                    print(f"[extract_connections] Edge {edges_processed}: Missing hostname (source={source_hostname}, target={target_hostname})")
                continue

            # Get node_type and host_id from the shelf nodes
            # host_id is optional (may be None for CSV imports without host_index)
            source_node_type = self._get_node_type_from_port(source_id)
            target_node_type = self._get_node_type_from_port(target_id)
            try:
                source_host_id = self._get_host_id_from_port(source_id)
            except ValueError:
                source_host_id = None  # CSV imports may not have host_index
            try:
                target_host_id = self._get_host_id_from_port(target_id)
            except ValueError:
                target_host_id = None  # CSV imports may not have host_index

            connection = {
                "source": {
                    "hostname": source_hostname,
                    "shelf_id": source_info.get("shelf_id"),
                    "tray_id": source_info.get("tray_id"),
                    "port_id": source_info.get("port_id"),
                    "node_type": source_node_type,
                    "host_id": source_host_id,
                },
                "target": {
                    "hostname": target_hostname,
                    "shelf_id": target_info.get("shelf_id"),
                    "tray_id": target_info.get("tray_id"),
                    "port_id": target_info.get("port_id"),
                    "node_type": target_node_type,
                    "host_id": target_host_id,
                },
                # Extract depth and template info for hierarchical export
                "depth": edge_data.get("depth"),
                "template_name": edge_data.get("template_name"),
                "instance_path": edge_data.get("instance_path"),
            }
            connections.append(connection)

        return connections

    def _get_hostname_from_port(self, port_id: str) -> Optional[str]:
        """Get hostname from a port node's data
        
        Handles multiple formats:
        1. Port ID format like "0:t1:p2" (descriptor/CSV format) - extract host_id and look up shelf
        2. Port has hostname directly in its data
        3. Traverse hierarchy: port -> tray -> shelf
        """
        # Check if port_id matches descriptor format (e.g., "0:t1:p2")
        import re
        descriptor_match = re.match(r"^(\d+):t\d+:p\d+$", port_id)
        if descriptor_match:
            # Extract host_id (numeric shelf ID)
            host_id_str = descriptor_match.group(1)
            # Find the shelf node with this ID
            for element in self.data.get("elements", []):
                node_data = element.get("data", {})
                if node_data.get("id") == host_id_str and node_data.get("type") == "shelf":
                    # Found the shelf - get its hostname
                    hostname = node_data.get("hostname")
                    if hostname and hostname.strip():
                        return hostname.strip()
                    # If no hostname, the host_id itself might be used as identifier
                    # This happens in CSV imports where hostname might not be set initially
                    # Return host_id_str as fallback identifier (consistent with _handle_descriptor_port)
                    return host_id_str
        
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
        """Get node_type from a port by traversing up to the shelf node
        
        Works in both logical hierarchy mode (Port -> Tray -> Shelf) 
        and physical location mode (Port -> Tray -> Shelf -> Rack -> ...)
        """
        # Find the port node
        for element in self.data.get("elements", []):
            if element.get("data", {}).get("id") == port_id:
                # Get parent (tray)
                tray_id = element.get("data", {}).get("parent")
                if not tray_id:
                    raise ValueError(f"Port '{port_id}' has no parent (expected tray)")
                
                # Find tray and get its parent (should be shelf)
                for tray_element in self.data.get("elements", []):
                    if tray_element.get("data", {}).get("id") == tray_id:
                        parent_id = tray_element.get("data", {}).get("parent")
                        if not parent_id:
                            raise ValueError(f"Tray '{tray_id}' has no parent (expected shelf)")
                        
                        # Find the parent node - it should be a shelf
                        # Build a map for efficient lookup
                        elements_by_id = {el.get("data", {}).get("id"): el for el in self.data.get("elements", []) if "data" in el and "id" in el.get("data", {})}
                        
                        parent_element = elements_by_id.get(parent_id)
                        if not parent_element:
                            raise ValueError(f"Could not find parent '{parent_id}' of tray '{tray_id}'")
                        
                        parent_type = parent_element.get("data", {}).get("type")
                        
                        # Verify it's a shelf node
                        if parent_type != "shelf":
                            raise ValueError(f"Tray '{tray_id}' parent is '{parent_type}', expected 'shelf'. Hierarchy may be incorrect.")
                        
                        # Get node_type from shelf
                        node_type = parent_element.get("data", {}).get("shelf_node_type")
                        if not node_type:
                            raise ValueError(f"Shelf '{parent_id}' is missing shelf_node_type")
                        # Preserve full node type including variations (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
                        # Only normalize to uppercase for consistency
                        node_type = node_type.upper()
                        return node_type
        
        raise ValueError(f"Could not find port '{port_id}' in cytoscape data")

    def _get_host_id_from_port(self, port_id: str) -> int:
        """Get host_id from a port by traversing up to the shelf node
        
        Works in both logical hierarchy mode (Port -> Tray -> Shelf) 
        and physical location mode (Port -> Tray -> Shelf -> Rack -> ...)
        
        Returns:
            int: The host_index/host_id value from the shelf node
            
        Raises:
            ValueError: If hierarchy is malformed or host_index/host_id is missing
        """
        # Find the port node
        for element in self.data.get("elements", []):
            if element.get("data", {}).get("id") == port_id:
                # Get parent (tray)
                tray_id = element.get("data", {}).get("parent")
                if not tray_id:
                    raise ValueError(f"Port '{port_id}' has no parent (expected tray)")
                
                # Find tray and get its parent (should be shelf)
                for tray_element in self.data.get("elements", []):
                    if tray_element.get("data", {}).get("id") == tray_id:
                        parent_id = tray_element.get("data", {}).get("parent")
                        if not parent_id:
                            raise ValueError(f"Tray '{tray_id}' has no parent (expected shelf)")
                        
                        # Find the parent node - it should be a shelf
                        # Build a map for efficient lookup
                        elements_by_id = {el.get("data", {}).get("id"): el for el in self.data.get("elements", []) if "data" in el and "id" in el.get("data", {})}
                        
                        parent_element = elements_by_id.get(parent_id)
                        if not parent_element:
                            raise ValueError(f"Could not find parent '{parent_id}' of tray '{tray_id}'")
                        
                        parent_type = parent_element.get("data", {}).get("type")
                        
                        # Verify it's a shelf node
                        if parent_type != "shelf":
                            raise ValueError(f"Tray '{tray_id}' parent is '{parent_type}', expected 'shelf'. Hierarchy may be incorrect.")
                        
                        # Get host_id from shelf
                        # CRITICAL: Use explicit None check, not 'or', because host_index can be 0 (which is falsy)
                        host_id = parent_element.get("data", {}).get("host_index")
                        if host_id is None:
                            # Fallback to host_id field name
                            host_id = parent_element.get("data", {}).get("host_id")
                        
                        if host_id is None:
                            # Debug: show available fields
                            available_fields = list(parent_element.get("data", {}).keys())
                            raise ValueError(
                                f"Shelf '{parent_id}' is missing host_index/host_id (required for template-based export). "
                                f"Available fields: {available_fields}"
                            )
                        return host_id
        
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

        # Convert node_type to uppercase and strip variation suffixes (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
        if node_type:
            node_type = node_type.upper()
            # Order matters: check longer suffixes first (_XY_TORUS before _X_TORUS/_Y_TORUS)
            if node_type.endswith('_XY_TORUS'):
                node_type = node_type[:-9]  # len('_XY_TORUS') = 9
            elif node_type.endswith('_X_TORUS'):
                node_type = node_type[:-8]  # len('_X_TORUS') = 8
            elif node_type.endswith('_Y_TORUS'):
                node_type = node_type[:-8]  # len('_Y_TORUS') = 8
            elif node_type.endswith('_DEFAULT'):
                node_type = node_type[:-8]  # len('_DEFAULT') = 8

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
    Extract a consistent list of (hostname, node_type) from the visualization, sorted by host_index.
    
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
    - shelf_node_type: Required for node type (WH_GALAXY, N300_LB, BH_GALAXY, P150_LB, etc.)
    - hall, aisle, rack_num, shelf_u: Optional location data
    
    Returns:
        List of (hostname, node_type) tuples, sorted by host_index
        
    CRITICAL INDEXED RELATIONSHIP:
    The index (i) in this list MUST match the host_index from the cabling descriptor:
    - CablingDescriptor: child_mappings[hostname].host_id = host_index
    - DeploymentDescriptor: deployment_descriptor.hosts[host_index].host = hostname
    
    This means: host_index N in cabling descriptor MUST map to hosts[N] in deployment descriptor.
    We sort by host_index (NOT alphabetically) to maintain this critical relationship.
    """
    # Build a map of host_index -> (hostname, node_type) from shelf nodes
    # This preserves the indexed relationship from the cabling descriptor
    host_by_index = {}
    host_without_index = []  # For CSV imports without host_index
    
    # Extract all shelf nodes directly to get host_index
    elements = cytoscape_data.get("elements", [])
    
    for element in elements:
        if "source" in element.get("data", {}):
            continue  # Skip edges
        
        node_data = element.get("data", {})
        if node_data.get("type") == "shelf":
            hostname = node_data.get("hostname", "").strip()
            node_type = node_data.get("shelf_node_type") or node_data.get("node_type")
            host_index = node_data.get("host_index")
            
            # Fallback to host_id if host_index not present
            if host_index is None:
                host_index = node_data.get("host_id")
            
            if not hostname or not node_type:
                continue  # Skip incomplete nodes
            
            if host_index is not None:
                # Has host_index (from cabling descriptor import)
                host_by_index[host_index] = (hostname, node_type)
            else:
                # No host_index (from CSV import)
                host_without_index.append((hostname, node_type))
    
    # Determine export strategy based on whether nodes have host_index
    if host_by_index and not host_without_index:
        # All nodes have host_index - this is from a cabling descriptor import
        # Sort by host_index to maintain the indexed relationship
        sorted_indices = sorted(host_by_index.keys())
        sorted_hosts = [host_by_index[idx] for idx in sorted_indices]
        return sorted_hosts
    
    elif host_without_index and not host_by_index:
        # No nodes have host_index - this is from a CSV import
        # Sort alphabetically by hostname for consistent ordering
        # Indices will be assigned dynamically based on this order
        sorted_hosts = sorted(host_without_index)
        return sorted_hosts
    
    elif host_by_index and host_without_index:
        # Mixed - some have host_index, some don't
        # This is an error state (shouldn't happen in normal usage)
        raise ValueError(
            f"Inconsistent visualization state: {len(host_by_index)} nodes have host_index, "
            f"but {len(host_without_index)} nodes don't. "
            f"This usually means nodes from different sources (CSV and descriptor) were mixed. "
            f"Please use a consistent data source."
        )
    
    else:
        # No valid hosts found
        raise ValueError(
            "No valid hosts found for export. "
            "Hosts must have both hostname and node_type defined."
        )


def export_flat_cabling_descriptor(cytoscape_data: Dict) -> str:
    """Export CablingDescriptor using flat/simple structure (for CSV imports)
    
    This is a simplified export that creates a single "extracted_topology" template
    with all shelves as direct children. Used when exporting from CSV imports where
    there's no hierarchical structure to preserve.
    
    This matches the old flat export behavior before hierarchical support was added.
    """
    if cluster_config_pb2 is None:
        raise ImportError("cluster_config_pb2 not available")

    # Get connections for building the topology
    parser = VisualizerCytoscapeDataParser(cytoscape_data)
    connections = parser.extract_connections()
    
    print(f"[export_flat_cabling_descriptor] Extracted {len(connections)} connections from cytoscape data")
    if len(connections) == 0:
        # Debug: Check what edges exist
        elements = cytoscape_data.get("elements", [])
        edges = [el for el in elements if "source" in el.get("data", {})]
        print(f"[export_flat_cabling_descriptor] Found {len(edges)} edges in cytoscape data")
        if len(edges) > 0:
            print(f"[export_flat_cabling_descriptor] Sample edge: {edges[0].get('data', {})}")

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
        # Preserve full node type including variations (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
        # Only normalize to uppercase for consistency
        normalized_node_type = node_type.upper()
        child.node_ref.node_descriptor = normalized_node_type

    # Add connections to graph template
    port_connections = graph_template.internal_connections["QSFP_DD"]  # Default port type
    connections_added = 0
    for connection in connections:
        # Validate connection has required fields
        source_hostname = connection["source"].get("hostname")
        target_hostname = connection["target"].get("hostname")
        source_tray_id = connection["source"].get("tray_id")
        target_tray_id = connection["target"].get("tray_id")
        source_port_id = connection["source"].get("port_id")
        target_port_id = connection["target"].get("port_id")
        
        if not all([source_hostname, target_hostname, source_tray_id is not None, target_tray_id is not None, 
                   source_port_id is not None, target_port_id is not None]):
            print(f"[export_flat_cabling_descriptor] Skipping incomplete connection: source={source_hostname}, target={target_hostname}, tray_ids=({source_tray_id}, {target_tray_id}), port_ids=({source_port_id}, {target_port_id})")
            continue
        
        conn = port_connections.connections.add()

        # Source port - use actual hostname directly
        conn.port_a.path.append(source_hostname)
        conn.port_a.tray_id = source_tray_id
        conn.port_a.port_id = source_port_id

        # Target port - use actual hostname directly
        conn.port_b.path.append(target_hostname)
        conn.port_b.tray_id = target_tray_id
        conn.port_b.port_id = target_port_id
        
        connections_added += 1
    
    print(f"[export_flat_cabling_descriptor] Added {connections_added} connections to template (from {len(connections)} extracted)")

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


def export_cabling_descriptor_for_visualizer(cytoscape_data: Dict, filename_prefix: str = "cabling_descriptor") -> str:
    """Export CablingDescriptor from Cytoscape data
    
    Strategy:
    - For CSV imports (flat structure): Use simple flat export
    - For hierarchical imports: Export using graph templates structure (hierarchical)
    """
    if cluster_config_pb2 is None:
        raise ImportError("cluster_config_pb2 not available")

    # Check if shelf nodes have logical topology information
    # This includes:
    # 1. Shelf nodes with non-empty logical_path (from descriptor imports)
    # 2. Graph nodes present (including "extracted_topology" template from mode switching)
    elements = cytoscape_data.get("elements", [])
    has_logical_topology = False
    
    # Check for graph nodes first (including extracted_topology template)
    has_graph_nodes = any(
        el.get("data", {}).get("type") in ["graph", "superpod", "pod", "cluster", "zone", "region"]
        for el in elements
    )
    
    if has_graph_nodes:
        has_logical_topology = True
    else:
        # Fallback: check for shelf nodes with non-empty logical_path
        for element in elements:
            node_data = element.get("data", {})
            if node_data.get("type") == "shelf":
                logical_path = node_data.get("logical_path")
                if logical_path and len(logical_path) > 0:
                    has_logical_topology = True
                    break
    
    if has_logical_topology:
        # Nodes have logical topology - export hierarchical structure
        # Check if we have graph_templates in metadata for accurate export
        metadata = cytoscape_data.get("metadata", {})
        graph_templates_meta = metadata.get("graph_templates")
        
        # Check if graph_templates exists and is not empty (empty dict {} is falsy in Python)
        if graph_templates_meta and len(graph_templates_meta) > 0:
            # Use metadata templates for exact round-trip
            return export_from_metadata_templates(cytoscape_data, graph_templates_meta)
        else:
            # Build hierarchy from logical_path data
            return export_hierarchical_cabling_descriptor(cytoscape_data)
    else:
        # No logical topology - this is a CSV import, use flat export
        # This is simpler and doesn't require the complex hierarchy building
        return export_flat_cabling_descriptor(cytoscape_data)


def export_from_metadata_templates(cytoscape_data: Dict, graph_templates_meta: Dict) -> str:
    """Export using pre-built templates from metadata (descriptor round-trip)
    
    When importing a cabling descriptor, the metadata contains the complete template
    structure. This function converts it back to protobuf format, preserving the
    original structure exactly.
    
    For CSV imports that were switched to hierarchy mode, connections may not be
    in metadata, so we extract them from cytoscape edges and add them to templates.
    
    Args:
        cytoscape_data: The cytoscape visualization data
        graph_templates_meta: The graph_templates dict from metadata
        
    Returns:
        String representation of the ClusterDescriptor protobuf
    """
    cluster_desc = cluster_config_pb2.ClusterDescriptor()
    
    # Get root template name from cytoscape data
    # The visualizer should have stored this during import
    metadata = cytoscape_data.get("metadata", {})
    
    # Find root graph nodes (nodes without parents) to determine actual root template
    elements = cytoscape_data.get("elements", [])
    root_nodes = [el for el in elements 
                  if el.get("data", {}).get("type") == "graph" 
                  and not el.get("data", {}).get("parent")]
    
    # Determine root template name from actual root node(s) in the graph
    root_template_name = None
    if len(root_nodes) == 1:
        # Single root node - use its template_name
        root_node_data = root_nodes[0].get("data", {})
        root_template_name = root_node_data.get("template_name")
        if root_template_name:
            print(f"Using root template '{root_template_name}' from actual root node '{root_node_data.get('id')}'")
    elif len(root_nodes) > 1:
        # Multiple root nodes - check if they all have the same template
        root_template_names = set()
        empty_root_templates = []
        for root_node in root_nodes:
            template_name = root_node.get("data", {}).get("template_name")
            if template_name:
                root_template_names.add(template_name)
                # Check if this root node is empty (has no children)
                root_node_id = root_node.get("data", {}).get("id")
                root_node_children = [el for el in elements 
                                     if el.get("data", {}).get("parent") == root_node_id]
                if len(root_node_children) == 0:
                    empty_root_templates.append(template_name)
        
        # Prioritize empty root template error over multiple root templates error
        if empty_root_templates:
            empty_templates_str = ", ".join(sorted(set(empty_root_templates)))
            raise ValueError(
                f"Cannot export CablingDescriptor: Empty root template(s) found: {empty_templates_str}. "
                f"Root templates must contain at least one child node or graph reference."
            )
        
        if len(root_template_names) == 1:
            root_template_name = root_template_names.pop()
            print(f"Using root template '{root_template_name}' from {len(root_nodes)} root nodes")
        else:
            # Multiple different templates - this is an error case
            template_names_str = ", ".join(sorted(root_template_names))
            raise ValueError(
                f"Cannot export CablingDescriptor: Multiple root templates found in graph ({template_names_str}). "
                f"A singular root template is required for CablingDescriptor export."
            )
    
    # Fallback: if no root nodes found or root node has no template_name, 
    # try to find root template from metadata (template that contains graph refs)
    if not root_template_name:
        print("No root template found in graph nodes, falling back to metadata detection")
        for template_name, template_info in graph_templates_meta.items():
            children = template_info.get('children', [])
            # Root template has children that are graph references
            if any(child.get('type') == 'graph' for child in children):
                root_template_name = template_name
                print(f"Using root template '{root_template_name}' from metadata (has graph refs)")
                break
    
    # Final fallback: use the first template as root
    if not root_template_name:
        root_template_name = list(graph_templates_meta.keys())[0]
        print(f"Using first template '{root_template_name}' as root (fallback)")
    
    # Extract connections from cytoscape edges if not already in metadata
    # This handles CSV imports that were switched to hierarchy mode
    parser = VisualizerCytoscapeDataParser(cytoscape_data)
    cytoscape_connections = parser.extract_connections()
    print(f"[export_from_metadata_templates] Extracted {len(cytoscape_connections)} connections from cytoscape edges")
    
    # Check if any template already has connections in metadata
    has_metadata_connections = any(
        template_info.get('connections', []) 
        for template_info in graph_templates_meta.values()
    )
    
    if not has_metadata_connections and cytoscape_connections:
        # No connections in metadata - match cytoscape connections to templates
        print(f"[export_from_metadata_templates] No connections in metadata, matching {len(cytoscape_connections)} cytoscape connections to templates")
        
        # Build a map of template_name -> list of connections for that template
        template_connections_map = {}
        for template_name in graph_templates_meta.keys():
            template_connections_map[template_name] = []
        
        # For each connection, determine which template it belongs to
        for conn in cytoscape_connections:
            source_hostname = conn["source"].get("hostname")
            target_hostname = conn["target"].get("hostname")
            
            if not source_hostname or not target_hostname:
                continue
            
            # Find which template contains both hostnames
            # For extracted_topology, all connections belong to it
            template_name = conn.get("template_name")
            if not template_name:
                # Default to root template (extracted_topology for CSV imports)
                template_name = root_template_name
            
            # Convert connection to metadata format
            conn_meta = {
                "port_a": {
                    "path": [source_hostname],
                    "tray_id": conn["source"].get("tray_id"),
                    "port_id": conn["source"].get("port_id")
                },
                "port_b": {
                    "path": [target_hostname],
                    "tray_id": conn["target"].get("tray_id"),
                    "port_id": conn["target"].get("port_id")
                }
            }
            
            if template_name in template_connections_map:
                template_connections_map[template_name].append(conn_meta)
            else:
                # Fallback to root template
                template_connections_map[root_template_name].append(conn_meta)
        
        # Add connections to metadata templates
        for template_name, conns in template_connections_map.items():
            if conns and template_name in graph_templates_meta:
                if 'connections' not in graph_templates_meta[template_name]:
                    graph_templates_meta[template_name]['connections'] = []
                graph_templates_meta[template_name]['connections'].extend(conns)
                print(f"[export_from_metadata_templates] Added {len(conns)} connections to template '{template_name}'")
    
    # Build all graph templates from metadata (excluding empty ones)
    for template_name, template_info in graph_templates_meta.items():
        graph_template = cluster_config_pb2.GraphTemplate()
        
        # Add children
        for child_info in template_info.get('children', []):
            child = graph_template.children.add()
            child.name = child_info['name']
            
            if child_info.get('type') == 'node':
                # Leaf node
                child.node_ref.node_descriptor = child_info['node_descriptor']
            elif child_info.get('type') == 'graph':
                # Graph reference
                child.graph_ref.graph_template = child_info['graph_template']
        
        # Add connections (with deduplication)
        connections_list = template_info.get('connections', [])
        print(f"[export_from_metadata_templates] Template '{template_name}': {len(connections_list)} connections in metadata")
        if connections_list:
            port_connections = graph_template.internal_connections["QSFP_DD"]
            seen_connections = set()  # Track seen connections to prevent duplicates
            duplicate_count = 0
            connections_added_to_protobuf = 0
            
            for conn_info in connections_list:
                # Skip connections with invalid paths (e.g., containing "[Circular Reference]")
                port_a_path = conn_info.get('port_a', {}).get('path', [])
                port_b_path = conn_info.get('port_b', {}).get('path', [])
                
                # Check if paths contain "[Circular Reference]" or are invalid
                if not isinstance(port_a_path, list) or not isinstance(port_b_path, list):
                    print(f"    Warning: Skipping connection with invalid path types in template '{template_name}'")
                    continue
                
                # Filter out "[Circular Reference]" strings and other invalid path elements
                port_a_path_clean = [p for p in port_a_path if isinstance(p, str) and p != "[Circular Reference]"]
                port_b_path_clean = [p for p in port_b_path if isinstance(p, str) and p != "[Circular Reference]"]
                
                # Skip if paths are empty after cleaning
                if not port_a_path_clean or not port_b_path_clean:
                    print(f"    Warning: Skipping connection with empty or invalid path in template '{template_name}'")
                    continue
                
                # Create a normalized connection key for deduplication (order-independent)
                port_a_tray = conn_info['port_a']['tray_id']
                port_a_port = conn_info['port_a']['port_id']
                port_b_tray = conn_info['port_b']['tray_id']
                port_b_port = conn_info['port_b']['port_id']
                
                # Normalize: use lexicographically smaller path as first element
                # This makes A->B and B->A connections compare as equal
                path_a_tuple = tuple(port_a_path_clean)
                path_b_tuple = tuple(port_b_path_clean)
                
                if path_a_tuple < path_b_tuple or (path_a_tuple == path_b_tuple and (port_a_tray, port_a_port) < (port_b_tray, port_b_port)):
                    conn_key = (path_a_tuple, port_a_tray, port_a_port, path_b_tuple, port_b_tray, port_b_port)
                else:
                    conn_key = (path_b_tuple, port_b_tray, port_b_port, path_a_tuple, port_a_tray, port_a_port)
                
                # Skip if we've already seen this connection
                if conn_key in seen_connections:
                    duplicate_count += 1
                    continue
                
                seen_connections.add(conn_key)
                
                conn = port_connections.connections.add()
                
                # Port A
                for path_elem in port_a_path_clean:
                    conn.port_a.path.append(path_elem)
                conn.port_a.tray_id = port_a_tray
                conn.port_a.port_id = port_a_port
                
                # Port B
                for path_elem in port_b_path_clean:
                    conn.port_b.path.append(path_elem)
                conn.port_b.tray_id = port_b_tray
                conn.port_b.port_id = port_b_port
                connections_added_to_protobuf += 1
            
            if duplicate_count > 0:
                print(f"    Removed {duplicate_count} duplicate connection(s) from template '{template_name}'")
            print(f"[export_from_metadata_templates] Template '{template_name}': Added {connections_added_to_protobuf} connections to protobuf (from {len(connections_list)} in metadata)")
        
        # Only add non-empty templates
        if len(graph_template.children) > 0:
            cluster_desc.graph_templates[template_name].CopyFrom(graph_template)
        else:
            print(f"Skipping empty template '{template_name}' from metadata")
    
    # Build root instance from cytoscape nodes
    # Parse all elements to get the hierarchy
    root_instance = cluster_config_pb2.GraphInstance()
    root_instance.template_name = root_template_name
    
    # Find all graph nodes and build the child_mappings hierarchy
    elements = cytoscape_data.get("elements", [])
    element_map = {el.get("data", {}).get("id"): el for el in elements if "data" in el}
    
    # Find root graph nodes (nodes without parents)
    root_nodes = [el for el in elements 
                  if el.get("data", {}).get("type") == "graph" 
                  and not el.get("data", {}).get("parent")]
    
    # Check if the single root node is the visible root cluster
    # If so, process its children directly instead of wrapping it
    if len(root_nodes) == 1:
        root_node_el = root_nodes[0]
        root_node_data = root_node_el.get("data", {})
        root_node_id = root_node_data.get("id", "")
        
        # Get the root node's template name
        root_node_label = root_node_data.get("label", root_node_data.get("id"))
        root_node_template = root_node_data.get("template_name", f"template_{root_node_label}")
        
        # The visible root cluster has id "graph_root_cluster" or matches the root template
        # If the root node's template matches the root template, process its children directly
        is_visible_root = (root_node_id == "graph_root_cluster" or 
                          root_node_id.startswith("graph_root_") or
                          root_node_template == root_template_name)
        
        if is_visible_root:
            # Process children of the visible root directly
            host_id = 0
            host_id = add_child_mappings_with_reuse(root_node_el, element_map, root_instance, host_id, cluster_desc)
        else:
            # This is a regular top-level node with a different template, wrap it (if non-empty)
            # Only create instance if template is non-empty
            if root_node_template in cluster_desc.graph_templates:
                nested_instance = cluster_config_pb2.GraphInstance()
                nested_instance.template_name = root_node_template
                host_id = 0
                host_id = add_child_mappings_with_reuse(root_node_el, element_map, nested_instance, host_id, cluster_desc)
                
                child_mapping = cluster_config_pb2.ChildMapping()
                child_mapping.sub_instance.CopyFrom(nested_instance)
                root_instance.child_mappings[root_node_label].CopyFrom(child_mapping)
    else:
        # Multiple top-level nodes - not allowed
        template_names = [el.get("data", {}).get("template_name") or el.get("data", {}).get("label", "unknown") 
                         for el in root_nodes]
        template_names_str = ", ".join(template_names)
        raise ValueError(
            f"Cannot export CablingDescriptor: Multiple root templates found ({template_names_str}). "
            f"A singular root template containing all nodes and connections is required for CablingDescriptor export."
        )
    
    cluster_desc.root_instance.CopyFrom(root_instance)
    
    return text_format.MessageToString(cluster_desc)


def export_hierarchical_cabling_descriptor(cytoscape_data: Dict) -> str:
    """Export CablingDescriptor preserving the hierarchical structure (graphs, superpods, pods, etc.)
    
    This function uses the template_name already tagged on graph nodes to define each unique
    template only once, avoiding duplicate template definitions.
    """
    if cluster_config_pb2 is None:
        raise ImportError("cluster_config_pb2 not available")
    
    # Check if metadata has pre-built graph_templates (from descriptor import)
    metadata = cytoscape_data.get("metadata", {})
    graph_templates_meta = metadata.get("graph_templates")
    
    # Check if graph_templates exists and is not empty (empty dict {} is falsy in Python)
    if graph_templates_meta and len(graph_templates_meta) > 0:
        # Use metadata templates - this preserves the original descriptor structure
        return export_from_metadata_templates(cytoscape_data, graph_templates_meta)
    
    # Otherwise, build templates from cytoscape node structure
    
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
    
    # Find all top-level graph nodes (graph nodes with no parent)
    # With the new flexible instantiation, users can have multiple top-level graphs
    root_graph_nodes = []
    for el in elements:
        el_data = el.get("data", {})
        el_type = el_data.get("type")
        has_parent = el_data.get("parent")
        
        # Skip non-graph types (rack, tray, port, shelf are physical containers, not topology)
        if el_type not in ["graph", "superpod", "pod", "cluster", "zone", "region"]:
            continue
        
        # Look for graph nodes without parents
        if not has_parent:
            root_graph_nodes.append(el)
    
    if not root_graph_nodes:
        # No hierarchical structure found - this should not happen as mode switching creates "extracted_topology" template
        raise ValueError(
            "Cannot export cabling descriptor: No root graph nodes found. "
            "Please switch to topology mode first, which will create the proper hierarchy structure."
        )
    
    
    # Create ClusterDescriptor
    cluster_desc = cluster_config_pb2.ClusterDescriptor()
    
    # Collect all unique template names from graph nodes
    # We'll build each template only once
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
    
    
    # Track which templates have been built
    built_templates = set()
    
    # Build templates for all top-level nodes and their children
    empty_root_templates = []
    for root_node in root_graph_nodes:
        root_data = root_node.get("data", {})
        template_name = root_data.get("template_name")
        if template_name and template_name not in built_templates:
            template = build_graph_template_with_reuse(
                root_node, element_map, connections, cluster_desc, built_templates
            )
            # Only add non-empty templates
            if template and len(template.children) > 0:
                cluster_desc.graph_templates[template_name].CopyFrom(template)
            elif template and len(template.children) == 0:
                empty_root_templates.append(template_name)
    
    # Error if any root template is empty
    if empty_root_templates:
        raise ValueError(
            f"Cannot export CablingDescriptor: Empty root template(s) found: {', '.join(empty_root_templates)}. "
            f"Root templates must contain at least one child node or graph reference."
        )
    
    # Create root instance using tracking flag for efficiency
    # Check if we can use the original imported root template (no top-level changes)
    has_top_level_additions = metadata.get("hasTopLevelAdditions", False)
    initial_root_template = metadata.get("initialRootTemplate")
    initial_root_id = metadata.get("initialRootId")
    
    # Initialize use_initial_root to False (default)
    use_initial_root = False
    
    # Use initial root template if:
    # 1. No top-level additions tracked (flag is False)
    # 2. Initial root template name is available
    # 3. Initial root node still exists in the graph
    if (not has_top_level_additions and 
        initial_root_template and 
        initial_root_id and
        initial_root_id in element_map):
        use_initial_root = True
    
    if use_initial_root:
        # No changes at top level - use original root template directly
        root_graph_el = element_map[initial_root_id]
        
        root_instance = cluster_config_pb2.GraphInstance()
        root_instance.template_name = initial_root_template
        
        # Add child mappings and nested instances
        # The root_graph_el represents the root cluster, so we add its children to root_instance
        host_id = 0
        host_id = add_child_mappings_with_reuse(
            root_graph_el, element_map, root_instance, host_id, cluster_desc
        )
        
        cluster_desc.root_instance.CopyFrom(root_instance)
    elif len(root_graph_nodes) == 1:
        # Single top-level node - use it directly as the root
        root_graph_el = root_graph_nodes[0]
        root_graph_data = root_graph_el.get("data", {})
        root_template_name = root_graph_data.get("template_name", "root_template")
        
        # Special case: "extracted_topology" is always the root template (from mode switching)
        # Use it directly without wrapping
        if root_template_name and root_template_name == "extracted_topology":
            root_instance = cluster_config_pb2.GraphInstance()
            root_instance.template_name = root_template_name
            
            # Add child mappings from the root's children
            host_id = 0
            host_id = add_child_mappings_with_reuse(
                root_graph_el, element_map, root_instance, host_id, cluster_desc
            )
            
            cluster_desc.root_instance.CopyFrom(root_instance)
        else:
            # Check if this is a "visible root" that was created during import
            # The ID is always "graph_root_cluster" for imported roots
            root_id = root_graph_data.get("id", "")
            is_visible_root = (root_id == "graph_root_cluster" or 
                              root_id.startswith("graph_root_"))
            
            if is_visible_root:
                # This node IS the root cluster - use it directly
                root_instance = cluster_config_pb2.GraphInstance()
                root_instance.template_name = root_template_name
                
                # Add child mappings from the root's children
                host_id = 0
                host_id = add_child_mappings_with_reuse(
                    root_graph_el, element_map, root_instance, host_id, cluster_desc
                )
                
                cluster_desc.root_instance.CopyFrom(root_instance)
            else:
                # This is a regular top-level node - use it directly as root
                # (No need to wrap it, just use its template_name)
                root_instance = cluster_config_pb2.GraphInstance()
                root_instance.template_name = root_template_name
                
                # Add child mappings and nested instances
                host_id = 0
                host_id = add_child_mappings_with_reuse(
                    root_graph_el, element_map, root_instance, host_id, cluster_desc
                )
                
                cluster_desc.root_instance.CopyFrom(root_instance)
    else:
        # Multiple top-level nodes - not allowed
        template_names = [el.get("data", {}).get("template_name") or el.get("data", {}).get("label", "unknown") 
                         for el in root_graph_nodes]
        template_names_str = ", ".join(template_names)
        raise ValueError(
            f"Cannot export CablingDescriptor: Multiple root templates found ({template_names_str}). "
            f"A singular root template containing all nodes and connections is required for CablingDescriptor export."
        )
        
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
    
    # Skip if this template has already been built (from a different instance)
    if node_template_name in built_templates:
        return None
    
    
    # Mark this template as being built (do this BEFORE processing to prevent recursion)
    built_templates.add(node_template_name)
    
    graph_template = cluster_config_pb2.GraphTemplate()
    
    # Find all direct children of this node
    children = [el for el in element_map.values() 
                if el.get("data", {}).get("parent") == node_id]
    
    
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
            # Use child_name field which stores the template-relative name (e.g., "node1")
            # This is the clean name from the template, independent of instance-specific data
            child_name = child_data.get("child_name", child_label)
            child.name = child_name
            # Look for node_type in shelf_node_type field (standard field name)
            node_descriptor = child_data.get("shelf_node_type") or child_data.get("node_descriptor_type") or child_data.get("node_type", "UNKNOWN")
            if not node_descriptor or node_descriptor == "UNKNOWN":
                # Note: hostname is optional here (it's a deployment property, not logical)
                hostname_display = child_data.get('hostname') or '(not set - deployment property)'
                raise ValueError(f"Shelf '{child_label}' (hostname: {hostname_display}) is missing shelf_node_type")
            # Preserve full node type including variations (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
            # Only normalize to uppercase for consistency
            node_descriptor = node_descriptor.upper()
            child.node_ref.node_descriptor = node_descriptor
            
        elif not is_physical_container:
            # This is a hierarchical container (any compound node that's not rack/tray/port)
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            
            # Only build this child's template if it hasn't been built yet
            if child_template_name not in built_templates:
                # Recursively build template for this child
                child_template = build_graph_template_with_reuse(
                    child_el, element_map, connections, cluster_desc, built_templates
                )
                
                if child_template and len(child_template.children) > 0:
                    # Add child template to cluster descriptor (only if non-empty)
                    cluster_desc.graph_templates[child_template_name].CopyFrom(child_template)
                    print(f"    Built and added new template '{child_template_name}' to cluster descriptor")
                elif child_template and len(child_template.children) == 0:
                    # Template is empty, remove from built_templates so it's not referenced
                    built_templates.discard(child_template_name)
                    print(f"    Template '{child_template_name}' is empty, skipping")
                    continue  # Skip adding reference to this empty template
            else:
                print(f"    Template '{child_template_name}' already built, reusing it")
            
            # Check if template actually exists in cluster_desc before adding reference
            if child_template_name not in cluster_desc.graph_templates:
                print(f"    Template '{child_template_name}' not in cluster (empty), skipping reference")
                continue
            
            # Add reference to this template in parent
            child = graph_template.children.add()
            child.name = child_label
            child.graph_ref.graph_template = child_template_name
    
    # Build a set of host_ids for THIS instance's children
    # We need to only include connections from THIS specific instance, not all instances of the template
    # Using host_index (stored in shelf nodes) because child_name is the same across all instances (e.g., all have "node1")
    child_host_ids = set()
    child_id_to_name = {}  # Map host_index to child_name for path resolution
    
    for child_el in children:
        child_data = child_el.get("data", {})
        child_type = child_data.get("type")
        if child_type == "shelf":
            # Read host_index from shelf node (this is the field name used in shelf nodes)
            # CRITICAL: Use explicit None check, not 'or', because host_index can be 0 (which is falsy)
            host_id = child_data.get("host_index")
            if host_id is None:
                # Fallback to host_id field name
                host_id = child_data.get("host_id")
            child_id = child_data.get("id")
            child_label = child_data.get("label", child_id)
            # Use same fallback logic as when adding children to template (line 1117)
            child_name = child_data.get("child_name", child_label)
            if host_id is not None:
                child_host_ids.add(host_id)
                # Always add to mapping (with fallback, child_name should never be empty)
                child_id_to_name[host_id] = child_name
    
    # Add connections that belong to this template
    # IMPORTANT: Since multiple instances use the same template, we only take connections
    # from THIS specific instance to build the generic template
    port_connections = graph_template.internal_connections["QSFP_DD"]
    connections_added = 0
    
    for connection in connections:
        # Check if this connection belongs to this template AND this specific instance
        connection_template = connection.get("template_name")
        
        # First check if template matches
        if connection_template:
            if connection_template != node_template_name:
                continue
        
        # Then check if BOTH endpoints are from THIS instance (not other instances of same template)
        # Use host_id to identify the specific instance
        source_host_id = connection["source"].get("host_id")
        target_host_id = connection["target"].get("host_id")
        
        if source_host_id not in child_host_ids or target_host_id not in child_host_ids:
            continue  # This connection is from a different instance of the same template
        
        # Get template-relative child names from host_ids
        # IMPORTANT: Validate BEFORE calling .add() to avoid creating incomplete protobuf objects
        source_child_name = child_id_to_name.get(source_host_id)
        target_child_name = child_id_to_name.get(target_host_id)
        
        if not source_child_name or not target_child_name:
            print(f"    Warning: Could not find child_name for host_id {source_host_id} or {target_host_id}")
            continue
        
        # Add the connection to this template (only after validation passes)
        conn = port_connections.connections.add()
        
        # Build path using template-relative child names
        source_path = get_path_to_host(source_child_name, node_id, element_map)
        for path_elem in source_path:
            conn.port_a.path.append(path_elem)
        conn.port_a.tray_id = connection["source"]["tray_id"]
        conn.port_a.port_id = connection["source"]["port_id"]
        
        # Build path using template-relative child names
        target_path = get_path_to_host(target_child_name, node_id, element_map)
        for path_elem in target_path:
            conn.port_b.path.append(path_elem)
        conn.port_b.tray_id = connection["target"]["tray_id"]
        conn.port_b.port_id = connection["target"]["port_id"]
        
        connections_added += 1
    
    
    return graph_template


def add_child_mappings_with_reuse(node_el, element_map, graph_instance, host_id, cluster_desc=None):
    """Add child mappings to a GraphInstance
    
    Args:
        node_el: The node element to add mappings for
        element_map: Map of node_id -> element
        graph_instance: The GraphInstance to add mappings to
        host_id: Current host_id counter
        cluster_desc: Optional ClusterDescriptor to get template order
    
    Returns:
        Updated host_id counter
    """
    if cluster_config_pb2 is None:
        return host_id
        
    node_data = node_el.get("data", {})
    node_id = node_data.get("id")
    node_label = node_data.get("label", "")
    template_name = node_data.get("template_name")
    
    # Find all direct children of this node
    all_children = [el for el in element_map.values() 
                    if el.get("data", {}).get("parent") == node_id]
    
    # If we have a template and cluster_desc, process children in template order
    # This ensures host_id assignment matches the template's child order
    if template_name and cluster_desc and template_name in cluster_desc.graph_templates:
        template = cluster_desc.graph_templates[template_name]
        # Build a map of child_name -> element for lookup
        children_by_name = {}
        for child_el in all_children:
            child_data = child_el.get("data", {})
            child_name = child_data.get("child_name") or child_data.get("label") or child_data.get("id")
            children_by_name[child_name] = child_el
        
        # Process children in template order
        children = []
        for template_child in template.children:
            child_name = template_child.name
            if child_name in children_by_name:
                children.append(children_by_name[child_name])
    else:
        # No template order available, use element_map order
        # Sort by host_index if available to maintain consistent ordering
        children = sorted(all_children, key=lambda el: (
            el.get("data", {}).get("host_index", float('inf')),
            el.get("data", {}).get("child_name", ""),
            el.get("data", {}).get("label", ""),
            el.get("data", {}).get("id", "")
        ))
    
    # Process each child
    for child_el in children:
        child_data = child_el.get("data", {})
        child_type = child_data.get("type")
        child_label = child_data.get("label", child_data.get("id"))
        child_id = child_data.get("id")
        
        
        # Skip physical containers (rack, tray, port)
        if child_type in ["rack", "tray", "port"]:
            continue
        
        if child_type == "shelf":
            # This is a leaf node - map it to a host_id
            # Use child_name which is the template-relative name
            child_name = child_data.get("child_name", child_label)
            
            
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.host_id = host_id
            graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
            
            host_id += 1
            
        else:
            # This is a hierarchical container - create a nested instance
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            # Use child_name (template-relative name) instead of label for consistency
            child_name = child_data.get("child_name", child_label)
            
            
            nested_instance = cluster_config_pb2.GraphInstance()
            nested_instance.template_name = child_template_name
            
            # Recursively add child mappings (pass cluster_desc to maintain template order)
            host_id = add_child_mappings_with_reuse(child_el, element_map, nested_instance, host_id, cluster_desc)
            
            # Add the nested instance to this graph's child_mappings
            # Use child_name for the key to match template structure
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.sub_instance.CopyFrom(nested_instance)
            graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
    
    return host_id


def build_graph_template_recursive(node_el, element_map, connections, cluster_desc):
    """Recursively build a GraphTemplate from a hierarchical node structure
    
    Note: For template reuse support, use build_graph_template_with_reuse instead.
    """
    if cluster_config_pb2 is None:
        return None
        
    node_data = node_el.get("data", {})
    node_id = node_data.get("id")
    node_type = node_data.get("type")
    node_label = node_data.get("label", node_id)
    
    
    graph_template = cluster_config_pb2.GraphTemplate()
    
    # Find all direct children of this node
    children = [el for el in element_map.values() 
                if el.get("data", {}).get("parent") == node_id]
    
    
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
            # Preserve full node type including variations (_DEFAULT, _X_TORUS, _Y_TORUS, _XY_TORUS)
            # Only normalize to uppercase for consistency
            node_descriptor = node_descriptor.upper()
            child.node_ref.node_descriptor = node_descriptor
            
        elif not is_physical_container:
            # This is a hierarchical container (any compound node that's not rack/tray/port)
            # These represent logical groupings (could be named anything: superpod, pod, zone, etc.)
            child_template_name = child_data.get("template_name", f"template_{child_label}")
            
            
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


def get_path_to_host(child_name, scope_node_id, element_map):
    """Get the path from scope_node_id down to the host with given child_name
    
    Args:
        child_name: Template child name (e.g., "node1")
        scope_node_id: The scope node ID to build path from
        element_map: Map of element IDs to elements
    """
    # Find the shelf node with this child_name
    shelf_node = None
    for el in element_map.values():
        data = el.get("data", {})
        if data.get("type") == "shelf" and data.get("child_name") == child_name:
            shelf_node = el
            break
    
    if not shelf_node:
        return [child_name]
    
    # Build path from scope_node_id down to shelf_node
    path = []
    current = shelf_node
    
    while current:
        data = current.get("data", {})
        node_id = data.get("id")
        
        if node_id == scope_node_id:
            break
            
        # Add node child_name/label to path (at the beginning)
        if data.get("type") == "shelf":
            path.insert(0, data.get("child_name", data.get("label", node_id)))
        else:
            path.insert(0, data.get("label", node_id))
        
        # Move up to parent
        parent_id = data.get("parent")
        if not parent_id:
            break
        current = element_map.get(parent_id)
    
    return path if path else [child_name]


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
            # Use child_name which is the template-relative name
            child_name = child_data.get("child_name", child_label)
            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.host_id = host_id
            graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
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
            
    
    return host_id


def _ensure_host_indices(cytoscape_data: Dict, sorted_hosts: List[Tuple[str, str]]) -> None:
    """Ensure all shelf nodes have host_index set.
    
    For CSV imports, shelf nodes won't have host_index. This function dynamically
    assigns host_index based on the sorted host list order.
    
    Args:
        cytoscape_data: The cytoscape visualization data (modified in-place)
        sorted_hosts: List of (hostname, node_type) tuples in the order they should be indexed
    """
    # Build a map: hostname -> index
    hostname_to_index = {hostname: idx for idx, (hostname, _) in enumerate(sorted_hosts)}
    
    # Update shelf nodes with their host_index if missing
    elements = cytoscape_data.get("elements", [])
    for element in elements:
        if "source" in element.get("data", {}):
            continue  # Skip edges
        
        node_data = element.get("data", {})
        if node_data.get("type") == "shelf":
            hostname = node_data.get("hostname", "").strip()
            
            # Only set host_index if it's missing
            if node_data.get("host_index") is None and node_data.get("host_id") is None:
                if hostname in hostname_to_index:
                    # Dynamically assign host_index based on sorted position
                    node_data["host_index"] = hostname_to_index[hostname]


def export_deployment_descriptor_for_visualizer(
    cytoscape_data: Dict, filename_prefix: str = "deployment_descriptor"
) -> str:
    """Export DeploymentDescriptor from Cytoscape data

    Prioritizes PHYSICAL LOCATION fields (hall, aisle, rack, shelf_u) from shelf nodes.
    Ignores logical topology fields (logical_path).
    
    Supports both 8-column format (hostname only) and 20-column format (hostname + location)
    
    IMPORTANT: This uses the SAME host list in the SAME order as the CablingDescriptor
    because the cabling generator uses host_id indices to map between them.
    
    PREREQUISITE: Hostnames must be set (from CSV import OR from applying deployment descriptor).
    If you imported a cabling descriptor, you must apply a deployment descriptor first before
    exporting a deployment descriptor.
    """
    if deployment_pb2 is None:
        raise ImportError("deployment_pb2 not available")

    # Get the common sorted host list (shared with CablingDescriptor)
    sorted_hosts = extract_host_list_from_connections(cytoscape_data)
    
    # Check if hostnames are set - deployment descriptor requires hostnames
    if not sorted_hosts or all(not hostname for hostname, _ in sorted_hosts):
        raise ValueError(
            "Cannot export deployment descriptor: No hostnames found. "
            "Hostnames are physical/deployment properties. "
            "If you imported a cabling descriptor, please apply a deployment descriptor first "
            "using the 'Upload Deployment Descriptor' option in the Location tab or when switching to physical mode."
        )
    
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
        
        # Set PHYSICAL LOCATION information if available (20-column format)
        # This prioritizes physical location fields and ignores logical topology fields
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
