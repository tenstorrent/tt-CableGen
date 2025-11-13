#!/usr/bin/env python3
"""
Network Cabling Visualizer - Cytoscape.js Implementation with Templates
Generates professional interactive network topology diagrams using cytoscape.js

Features:
- Template-based element positioning to reduce redundancy
- Hierarchical compound nodes (Racks > Shelf Units > Trays > Ports)
- Intelligent edge routing with automatic collision avoidance
- Interactive web interface with zoom, pan, and selection
- Color coding by cable length with visual hierarchy
"""

import argparse
import sys
import json
import random
from collections import defaultdict
import os

# Protobuf imports for cabling descriptor support
tt_metal_home = os.environ.get("TT_METAL_HOME")
if tt_metal_home and os.path.exists(tt_metal_home):
    protobuf_dir = os.path.join(tt_metal_home, "build", "tools", "scaleout", "protobuf")
    if os.path.exists(protobuf_dir):
        sys.path.insert(0, protobuf_dir)

try:
    import cluster_config_pb2
    import node_config_pb2
    from google.protobuf import text_format
    PROTOBUF_AVAILABLE = True
except ImportError:
    cluster_config_pb2 = None
    node_config_pb2 = None
    text_format = None
    PROTOBUF_AVAILABLE = False


class NetworkCablingCytoscapeVisualizer:
    """Professional network cabling topology visualizer using cytoscape.js with templates
    
    Features:
    - Unified CSV parser supporting multiple formats (hierarchical, hostname-based, minimal)
    - Template-based element positioning to reduce redundancy
    - Hierarchical compound nodes (Racks > Shelf Units > Trays > Ports)
    - Intelligent edge routing with automatic collision avoidance
    - Interactive web interface with zoom, pan, and selection
    - Color coding by cable length with visual hierarchy
    
    Terminology:
    To avoid confusion with the overloaded term "node", this codebase uses precise terminology:
    
    - **Graph Template**: A reusable pattern defining a network topology structure (e.g., superpod)
    - **Graph Instance**: A concrete instantiation of a graph template with specific hosts
    - **Host Device / Device Node**: A physical piece of hardware (server) in the cluster
    - **Visual Element / Cytoscape Node**: A visual element in the Cytoscape.js graph
    - **Leaf Device**: A terminal node in the hierarchical tree structure (has a host_id)
    
    Hierarchy (descriptor format):
      Graph Template → Graph Instance → Host Device → Shelf → Tray → Port
    
    Hierarchy (CSV format):
      Rack → Shelf → Tray → Port
    """

    # Common dimensions used by all node types
    DEFAULT_SHELF_DIMENSIONS = {
        "width": "auto",  # Will be calculated based on tray layout
        "height": "auto",  # Will be calculated based on tray layout
        "padding": 15,  # Padding around trays inside shelf
    }

    # Common port dimensions (only spacing varies)
    DEFAULT_PORT_DIMENSIONS = {"width": 35, "height": 25}

    # Common tray dimensions for auto-calculated layouts
    DEFAULT_AUTO_TRAY_DIMENSIONS = {
        "width": "auto",  # Will be calculated based on port layout
        "height": "auto",  # Will be calculated based on port layout
        "spacing": 25,
        "padding": 8,  # Padding around ports inside tray
    }

    # Edge styling constants
    BASE_CONTROL_DISTANCE = 60
    CONTROL_WEIGHTS = [0.25, 0.75]
    LABEL_POSITION_MIN = 0.2
    LABEL_POSITION_MAX = 0.8

    # Graph compound node layout constants (for hierarchical descriptor format)
    # Note: Width is now "auto" - these are just used for spacing calculations
    GRAPH_COMPOUND_WIDTH = 800  # Estimated width for auto-sized compound
    GRAPH_COMPOUND_SPACING = 150  # Spacing between graph compounds

    # Utility methods for common CSV parsing patterns
    @staticmethod
    def read_csv_lines(csv_file):
        """Read CSV file and return lines, skipping first two header lines"""
        with open(csv_file, "r") as file:
            lines = file.readlines()

        if len(lines) < 3:
            raise ValueError("CSV file must have at least 2 header lines and data")

        return lines

    @staticmethod
    def normalize_shelf_u(shelf_u_value):
        """Normalize shelf U value to numeric format (without U prefix)"""
        if not shelf_u_value:
            return "01"
        # Remove U prefix if present and ensure 2-digit format
        if shelf_u_value.startswith("U"):
            return shelf_u_value[1:].zfill(2)
        return shelf_u_value.zfill(2)

    @staticmethod
    def normalize_rack(rack_value):
        """Normalize rack number to 2-digit format"""
        if not rack_value:
            return "01"
        return rack_value.zfill(2)

    @staticmethod
    def safe_int(value, default=1):
        """Safely convert string to int with default fallback"""
        if value and value.isdigit():
            return int(value)
        return default

    @staticmethod
    def normalize_node_type(node_type, default="WH_GALAXY"):
        """Normalize node type to lowercase and trim whitespace"""
        if not node_type:
            return default.lower()
        return node_type.strip().lower()

    @staticmethod
    def create_connection_object(source_data, dest_data, cable_length="Unknown", cable_type="400G_AEC"):
        """Create standardized connection object"""
        return {"source": source_data, "destination": dest_data, "cable_length": cable_length, "cable_type": cable_type}

    def __init__(self, shelf_unit_type=None):
        # Data storage
        self.connections = []
        self.rack_units = {}  # rack_num -> set of shelf_u values
        self.shelf_units = {}  # hostname -> node_type for 8-column format
        self.shelf_unit_type = shelf_unit_type.lower() if shelf_unit_type else None
        self.file_format = None  # Will be detected: 'hierarchical', 'hostname_based', 'minimal', or 'descriptor'
        self.mixed_node_types = {}  # For 20-column format with mixed types
        self.dynamic_configs = {}  # For unknown node types discovered from CSV data

        # Cytoscape elements
        self.nodes = []
        self.edges = []
        
        # Cabling descriptor data (for textproto format)
        self.cluster_descriptor = None  # ClusterDescriptor protobuf
        self.graph_hierarchy = []  # Resolved hierarchy from descriptor
        self.descriptor_connections = []  # Connections from cabling descriptor with hierarchy info

        # Define templates for different shelf unit types
        self.shelf_unit_configs = {
            "wh_galaxy": {
                "tray_count": 4,
                "port_count": 6,
                "tray_layout": "vertical",  # T1-T4 arranged vertically (top to bottom)
                # port_layout auto-inferred as 'horizontal' from vertical tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": {"width": 320, "height": 60, "spacing": 10},
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 5},
            },
            "n300_lb": {
                "tray_count": 4,
                "port_count": 2,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "n300_qb": {
                "tray_count": 4,
                "port_count": 2,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "p150_qb": {
                "tray_count": 4,
                "port_count": 4,
                "tray_layout": "vertical",  # T1-T4 arranged vertically (T1 at bottom, T4 at top)
                # port_layout auto-inferred as 'horizontal' from vertical tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "p150_qb_global": {
                "tray_count": 4,
                "port_count": 4,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "p150_qb_america": {
                "tray_count": 4,
                "port_count": 4,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "p150_lb": {
                "tray_count": 8,
                "port_count": 4,
                "tray_layout": "horizontal",  # T1-T8 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' 
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "bh_galaxy": {
                "tray_count": 4,
                "port_count": 14,
                "tray_layout": "vertical",  # T1-T4 arranged vertically (top to bottom)
                # port_layout auto-inferred as 'horizontal' from vertical tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": {"width": 320, "height": 60, "spacing": 10},
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 5},
            },
        }

        # Get current shelf unit configuration - will be set after CSV parsing
        self.current_config = None

        # Calculate auto dimensions for trays based on port layout - will be done after config is set
        # This will be called in set_shelf_unit_type()

        # Element type templates - will be initialized after shelf unit type is determined
        self.element_templates = {}

        # Visual styling - colors for connection types
        self.intra_node_color = "#4CAF50"  # Green for connections within the same node
        self.inter_node_color = "#2196F3"  # Blue for connections between different nodes

        # Location information for nodes (hall, aisle info)
        self.node_locations = {}  # Will store hall/aisle info keyed by shelf_key

    def set_shelf_unit_type(self, shelf_unit_type):
        """Set the shelf unit type and initialize templates"""
        self.shelf_unit_type = shelf_unit_type.lower()

        # Get current shelf unit configuration
        self.current_config = self.shelf_unit_configs.get(self.shelf_unit_type, self.shelf_unit_configs["wh_galaxy"])

        # Calculate auto dimensions for trays based on port layout
        self.current_config = self.calculate_auto_dimensions(self.current_config)

        # Initialize element type templates based on format
        if self.file_format == "hierarchical":
            # Full hierarchy with racks
            self.element_templates = {
                "rack": {
                    "dimensions": {"width": 450, "height": 500, "spacing": 150},  # Generous spacing to prevent overlap
                    "position_type": "horizontal_sequence",  # Racks arranged left-to-right
                    "child_type": "shelf",
                    "style_class": "rack",
                },
                "shelf": {
                    "dimensions": self.current_config["shelf_dimensions"],
                    "dimensions_spacing": 60,  # Generous spacing to prevent overlap (shelves can be ~300px tall)
                    "position_type": "vertical_sequence",  # Shelves sorted descending, so higher U naturally goes to top
                    "child_type": "tray",
                    "style_class": f"shelf shelf-{self.shelf_unit_type}",
                },
                "tray": {
                    "dimensions": self.current_config["tray_dimensions"],
                    "position_type": "vertical_sequence"
                    if self.current_config["tray_layout"] == "vertical"
                    else "horizontal_sequence",
                    "child_type": "port",
                    "style_class": f"tray tray-{self.shelf_unit_type}",
                },
                "port": {
                    "dimensions": self.current_config["port_dimensions"],
                    "position_type": "vertical_sequence"
                    if self.infer_port_layout(self.current_config["tray_layout"]) == "vertical"
                    else "horizontal_sequence",
                    "child_type": None,
                    "style_class": "port",  # Unified port styling regardless of shelf type
                },
            }
            # Add spacing to shelf template
            self.element_templates["shelf"]["dimensions"]["spacing"] = self.element_templates["shelf"][
                "dimensions_spacing"
            ]
        elif self.file_format == "descriptor":
            # Graph hierarchy for cabling descriptors
            # Physical device structure (shelf/tray/port) should match CSV import configuration
            # Layout strategy: arrange elements OPPOSITE to their content's dominant dimension
            
            # Physical device layout from config (same as CSV import)
            tray_layout = self.current_config["tray_layout"]
            port_layout = self.infer_port_layout(tray_layout)
            
            # Physical device positioning - MUST match CSV import
            tray_position = "vertical_sequence" if tray_layout == "vertical" else "horizontal_sequence"
            port_position = "vertical_sequence" if port_layout == "vertical" else "horizontal_sequence"
            
            # Shelf positioning: Opposite of tray dominance for balanced layout
            # If trays are horizontal → shelf is width-dominant → arrange shelves vertically
            # If trays are vertical → shelf is height-dominant → arrange shelves horizontally
            shelf_position = "vertical_sequence" if tray_layout == "horizontal" else "horizontal_sequence"
            
            # Graph positioning: Opposite of shelf arrangement (which is opposite of tray)
            # If shelves are vertical → graph is height-dominant → arrange graphs horizontally
            # If shelves are horizontal → graph is width-dominant → arrange graphs vertically
            self._base_alternation = "horizontal_sequence" if shelf_position == "vertical_sequence" else "vertical_sequence"
            
            self.element_templates = {
                "graph": {
                    "dimensions": {"width": "auto", "height": "auto", "spacing": 0.15, "padding": 0.10},  # Adaptive: 15% spacing, 10% padding
                    "position_type": None,  # Will be determined dynamically based on depth
                    "child_type": "shelf",  # Graphs now contain shelves (hosts) directly
                    "style_class": "graph",
                },
                "shelf": {
                    "dimensions": self.current_config["shelf_dimensions"],
                    "dimensions_spacing": 30,
                    "position_type": shelf_position,  # Shelves horizontal within graphs
                    "child_type": "tray",
                    "style_class": f"shelf shelf-{self.shelf_unit_type}",
                },
                "tray": {
                    "dimensions": self.current_config["tray_dimensions"],
                    "position_type": tray_position,  # From config (same as CSV)
                    "child_type": "port",
                    "style_class": f"tray tray-{self.shelf_unit_type}",
                },
                "port": {
                    "dimensions": self.current_config["port_dimensions"],
                    "position_type": port_position,  # From config (same as CSV)
                    "child_type": None,
                    "style_class": "port",
                },
            }
            # Add spacing to shelf template
            self.element_templates["shelf"]["dimensions"]["spacing"] = self.element_templates["shelf"][
                "dimensions_spacing"
            ]
        else:
            # Shelf-only format for hostname_based and minimal
            self.element_templates = {
                "shelf": {
                    "dimensions": self.current_config["shelf_dimensions"],
                    "dimensions_spacing": 50,  # More spacing between independent shelf units
                    "position_type": "horizontal_sequence",  # Shelf units arranged left-to-right
                    "child_type": "tray",
                    "style_class": f"shelf shelf-{self.shelf_unit_type}",
                },
                "tray": {
                    "dimensions": self.current_config["tray_dimensions"],
                    "position_type": "vertical_sequence"
                    if self.current_config["tray_layout"] == "vertical"
                    else "horizontal_sequence",
                    "child_type": "port",
                    "style_class": f"tray tray-{self.shelf_unit_type}",
                },
                "port": {
                    "dimensions": self.current_config["port_dimensions"],
                    "position_type": "vertical_sequence"
                    if self.infer_port_layout(self.current_config["tray_layout"]) == "vertical"
                    else "horizontal_sequence",
                    "child_type": None,
                    "style_class": "port",  # Unified port styling regardless of shelf type
                },
            }
            # Add spacing to shelf template
            self.element_templates["shelf"]["dimensions"]["spacing"] = self.element_templates["shelf"][
                "dimensions_spacing"
            ]

    def detect_csv_format(self, csv_file):
        """Detect CSV format by examining headers and available fields"""
        try:
            with open(csv_file, "r") as file:
                lines = file.readlines()

            if len(lines) < 2:
                raise ValueError("CSV file must have at least 2 header lines")

            # Parse headers to detect available fields
            # Look for the line that contains actual column headers (not grouping headers)
            header_line = None
            for i in range(1, min(3, len(lines))):  # Check lines 1 and 2
                line = lines[i].strip()
                if line and not line.startswith("Source") and not line.startswith("Destination"):
                    # This looks like actual column headers
                    header_line = line
                    break
            
            if not header_line:
                # Fallback to line 2 if no proper headers found
                header_line = lines[1].strip()
            
            headers = [h.strip().lower() for h in header_line.split(",")]
            
            # Define field mappings for different CSV formats
            field_mappings = {
                "hostname": ["hostname", "host", "node"],
                "hall": ["hall", "building", "facility"],
                "aisle": ["aisle", "row", "corridor"],
                "rack": ["rack", "rack_num", "rack_number"],
                "shelf_u": ["shelf u", "shelf_u", "shelf", "u", "unit"],
                "tray": ["tray", "tray_num", "tray_number"],
                "port": ["port", "port_num", "port_number"],
                "label": ["label", "id", "identifier"],
                "node_type": ["node type", "node_type", "type", "model"],
                "cable_length": ["cable length", "cable_length", "length"],
                "cable_type": ["cable type", "cable_type", "cable"]
            }
            
            # Detect which fields are available
            available_fields = {}
            for field_name, possible_headers in field_mappings.items():
                for header in headers:
                    if any(possible in header.lower() for possible in possible_headers):
                        available_fields[field_name] = header
                        break
            
            # Determine format based on available fields
            if "rack" in available_fields and "shelf_u" in available_fields:
                return "hierarchical"  # Has rack/shelf hierarchy
            elif "hostname" in available_fields:
                return "hostname_based"  # Uses hostnames instead of rack/shelf
            else:
                return "minimal"  # Only has tray/port/node_type
                
        except Exception as e:
            return None

    def analyze_and_create_dynamic_config(self, node_type, connections):
        """Analyze CSV data to create dynamic configuration for unknown node types"""

        # Track maximum tray and port numbers seen for this node type
        max_tray = 0
        max_port = 0

        for connection in connections:
            # Check both source and destination
            if connection["source"].get("node_type") == node_type:
                max_tray = max(max_tray, connection["source"]["tray"])
                max_port = max(max_port, connection["source"]["port"])
            if connection["destination"].get("node_type") == node_type:
                max_tray = max(max_tray, connection["destination"]["tray"])
                max_port = max(max_port, connection["destination"]["port"])

        # Determine layout based on tray/port ratios (heuristic)
        # If more trays than ports, likely horizontal tray layout
        # If more ports than trays, likely vertical tray layout
        if max_tray >= max_port:
            tray_layout = "horizontal"
        else:
            tray_layout = "vertical"

        # Port layout is automatically inferred from tray layout
        port_layout = self.infer_port_layout(tray_layout)

        # Create dynamic configuration
        dynamic_config = {
            "tray_count": max_tray,
            "port_count": max_port,
            "tray_layout": tray_layout,
            "port_layout": port_layout,
            "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
            "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
            "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
        }

        # Store the dynamic configuration
        self.dynamic_configs[node_type] = dynamic_config
        self.shelf_unit_configs[node_type] = dynamic_config  # Also add to main configs

        return dynamic_config

    def get_unknown_node_types(self):
        """Return list of node types that were dynamically created (unknown)"""
        return list(self.dynamic_configs.keys())

    def infer_port_layout(self, tray_layout):
        """Automatically infer port layout from tray layout"""
        # If trays are vertical, ports should be horizontal
        # If trays are horizontal, ports should be vertical
        return "horizontal" if tray_layout == "vertical" else "vertical"

    def calculate_auto_dimensions(self, config):
        """Calculate automatic tray and shelf dimensions based on layout"""
        # Create a copy of config for modifications
        config = config.copy()

        # Step 1: Calculate tray dimensions if needed
        if config["tray_dimensions"].get("width") == "auto" or config["tray_dimensions"].get("height") == "auto":
            port_width = config["port_dimensions"]["width"]
            port_height = config["port_dimensions"]["height"]
            port_spacing = config["port_dimensions"]["spacing"]
            port_count = config["port_count"]
            tray_padding = config["tray_dimensions"].get("padding", 8)

            # Infer port layout from tray layout
            port_layout = self.infer_port_layout(config["tray_layout"])

            # Calculate based on port layout
            if port_layout == "vertical":
                # Ports stacked vertically: width = port_width + padding, height = ports + spacing + padding
                auto_tray_width = port_width + 2 * tray_padding
                auto_tray_height = port_count * port_height + (port_count - 1) * port_spacing + 2 * tray_padding
            else:  # horizontal
                # Ports arranged horizontally: width = ports + spacing + padding, height = port_height + padding
                auto_tray_width = port_count * port_width + (port_count - 1) * port_spacing + 2 * tray_padding
                auto_tray_height = port_height + 2 * tray_padding

            config["tray_dimensions"] = config["tray_dimensions"].copy()

            if config["tray_dimensions"].get("width") == "auto":
                config["tray_dimensions"]["width"] = auto_tray_width
            if config["tray_dimensions"].get("height") == "auto":
                config["tray_dimensions"]["height"] = auto_tray_height

        # Step 2: Calculate shelf dimensions based on tray layout
        if config["shelf_dimensions"].get("width") == "auto" or config["shelf_dimensions"].get("height") == "auto":
            tray_width = config["tray_dimensions"]["width"]
            tray_height = config["tray_dimensions"]["height"]
            tray_spacing = config["tray_dimensions"]["spacing"]
            tray_count = config["tray_count"]
            shelf_padding = config["shelf_dimensions"].get("padding", 15)

            # Calculate based on tray layout
            if config["tray_layout"] == "vertical":
                # Trays stacked vertically: width = tray_width + padding, height = trays + spacing + padding
                auto_shelf_width = tray_width + 2 * shelf_padding
                auto_shelf_height = tray_count * tray_height + (tray_count - 1) * tray_spacing + 2 * shelf_padding
            else:  # horizontal
                # Trays arranged horizontally: width = trays + spacing + padding, height = tray_height + padding
                auto_shelf_width = tray_count * tray_width + (tray_count - 1) * tray_spacing + 2 * shelf_padding
                auto_shelf_height = tray_height + 2 * shelf_padding

            config["shelf_dimensions"] = config["shelf_dimensions"].copy()

            if config["shelf_dimensions"].get("width") == "auto":
                config["shelf_dimensions"]["width"] = auto_shelf_width
            if config["shelf_dimensions"].get("height") == "auto":
                config["shelf_dimensions"]["height"] = auto_shelf_height

        return config

    def parse_cabling_descriptor(self, textproto_file):
        """Parse cabling descriptor textproto file
        
        Args:
            textproto_file: Path to .textproto file containing ClusterDescriptor
            
        Returns:
            True if parsing succeeded, False otherwise
        """
        if not PROTOBUF_AVAILABLE:
            print("Error: Protobuf support not available. Cannot parse cabling descriptor.")
            print("Make sure TT_METAL_HOME is set and protobuf files are built.")
            return False
        
        try:
            # Read textproto file
            with open(textproto_file, 'r') as f:
                textproto_content = f.read()
            
            # Parse into ClusterDescriptor
            self.cluster_descriptor = cluster_config_pb2.ClusterDescriptor()
            text_format.Parse(textproto_content, self.cluster_descriptor)
            
            print(f"Successfully parsed cabling descriptor: {textproto_file}")
            print(f"  Graph templates: {len(self.cluster_descriptor.graph_templates)}")
            print(f"  Root instance template: {self.cluster_descriptor.root_instance.template_name}")
            
            # Resolve the hierarchy
            self.graph_hierarchy = self._resolve_graph_hierarchy()
            print(f"  Resolved hierarchy: {len(self.graph_hierarchy)} leaf nodes")
            
            # Parse connections
            self.descriptor_connections = self._parse_descriptor_connections()
            print(f"  Parsed connections: {len(self.descriptor_connections)} connections")
            
            return True
            
        except Exception as e:
            print(f"Error parsing cabling descriptor: {e}")
            import traceback
            traceback.print_exc()
            return False

    def _log_warning(self, message, context=None):
        """Log a warning message with optional context
        
        Provides consistent warning logging throughout the hierarchical import code.
        Warnings are used for non-critical issues (missing optional data, etc.)
        while exceptions are reserved for critical failures.
        
        Args:
            message: The warning message
            context: Optional dict with contextual information (template_name, path, etc.)
        """
        if context:
            context_str = ", ".join(f"{k}={v}" for k, v in context.items())
            print(f"Warning: {message} [{context_str}]")
        else:
            print(f"Warning: {message}")
    
    # ===== Helper Classes for Separation of Concerns =====
    
    class HierarchyResolver:
        """Helper class for resolving graph hierarchy from cabling descriptors
        
        Encapsulates the logic for traversing GraphInstance/GraphTemplate structures
        and extracting the flat list of leaf devices with their configurations.
        """
        
        def __init__(self, parent):
            """Initialize with reference to parent visualizer
            
            Args:
                parent: The NetworkCablingCytoscapeVisualizer instance
            """
            self.parent = parent
            self._path_to_host_id_map = {}
            self._path_to_template_map = {}  # Maps graph instance paths to their template names
        
        def resolve_hierarchy(self):
            """Resolve complete graph hierarchy
            
            Returns:
                List of leaf device info dicts, sorted by path for consistent ordering
            """
            if not self.parent.cluster_descriptor:
                return []
            
            hierarchy = []
            root_instance = self.parent.cluster_descriptor.root_instance
            root_template_name = root_instance.template_name
            
            self._resolve_recursive(root_instance, root_template_name, [], hierarchy, 0)
            
            # Sort hierarchy by path for consistent ordering
            # This ensures predictable layout (e.g., node1, node2, node3, node4)
            hierarchy.sort(key=lambda x: x['path'])
            
            # Build lookup map for O(1) path-to-host_id lookups
            self._path_to_host_id_map = {tuple(node['path']): node['host_id'] 
                                          for node in hierarchy}
            
            return hierarchy
        
        def get_template_for_path(self, path):
            """Get the template name for a graph instance path
            
            Args:
                path: List of strings representing path from root
                
            Returns:
                Template name if found, None otherwise
            """
            return self._path_to_template_map.get(tuple(path))
        
        def path_to_host_id(self, path):
            """Convert a path to a host_id using O(1) lookup
            
            Args:
                path: List of strings representing path from root
                
            Returns:
                host_id if found, None otherwise
            """
            return self._path_to_host_id_map.get(tuple(path))
        
        def _resolve_recursive(self, instance, template_name, path, hierarchy, depth):
            """Recursively resolve a Graph Instance"""
            # Store the template name for this path
            if path:  # Don't store root with empty path
                self._path_to_template_map[tuple(path)] = template_name
            
            def node_callback(child_name, child_mapping, child_instance, path, depth):
                node_descriptor_name = child_instance.node_ref.node_descriptor
                hierarchy.append({
                    'path': path + [child_name],
                    'child_name': child_name,
                    'node_type': node_descriptor_name,
                    'host_id': child_mapping.host_id,
                    'depth': depth
                })
            
            def subgraph_callback(child_name, child_mapping, child_instance, nested_template_name, path, depth):
                self._resolve_recursive(
                    child_mapping.sub_instance,
                    nested_template_name,
                    path + [child_name],
                    hierarchy,
                    depth + 1
                )
            
            self.parent._traverse_hierarchy(instance, template_name, path, depth, 
                                          node_callback, subgraph_callback)
    
    class ConnectionResolver:
        """Helper class for resolving connections from cabling descriptors
        
        Encapsulates the logic for parsing connections defined in graph templates
        and resolving them to concrete host device connections.
        """
        
        def __init__(self, parent, hierarchy_resolver):
            """Initialize with reference to parent and hierarchy resolver
            
            Args:
                parent: The NetworkCablingCytoscapeVisualizer instance
                hierarchy_resolver: HierarchyResolver instance for path lookups
            """
            self.parent = parent
            self.hierarchy_resolver = hierarchy_resolver
        
        def resolve_connections(self):
            """Resolve all connections from descriptor
            
            Returns:
                List of connection dicts with hierarchy info
            """
            connections = []
            root_instance = self.parent.cluster_descriptor.root_instance
            self._parse_recursive(
                root_instance,
                root_instance.template_name,
                [],
                connections,
                0
            )
            return connections
        
        def _parse_recursive(self, instance, template_name, path, connections, depth):
            """Recursively parse connections from a GraphInstance"""
            if template_name not in self.parent.cluster_descriptor.graph_templates:
                return
            
            template = self.parent.cluster_descriptor.graph_templates[template_name]
            
            # Parse internal connections at this level
            for cable_type, port_connections in template.internal_connections.items():
                for conn in port_connections.connections:
                    port_a_path = list(path) + list(conn.port_a.path)
                    port_a_host_id = self.hierarchy_resolver.path_to_host_id(port_a_path)
                    
                    port_b_path = list(path) + list(conn.port_b.path)
                    port_b_host_id = self.hierarchy_resolver.path_to_host_id(port_b_path)
                    
                    if port_a_host_id is not None and port_b_host_id is not None:
                        connections.append({
                            'port_a': {
                                'path': port_a_path,
                                'host_id': port_a_host_id,
                                'tray_id': conn.port_a.tray_id,
                                'port_id': conn.port_a.port_id
                            },
                            'port_b': {
                                'path': port_b_path,
                                'host_id': port_b_host_id,
                                'tray_id': conn.port_b.tray_id,
                                'port_id': conn.port_b.port_id
                            },
                            'cable_type': cable_type,
                            'depth': depth,
                            'template_name': template_name,
                            'instance_path': '/'.join(path) if path else 'root'
                        })
            
            # Recurse into nested graphs
            def subgraph_callback(child_name, child_mapping, child_instance, nested_template_name, path, depth):
                self._parse_recursive(
                    child_mapping.sub_instance,
                    nested_template_name,
                    path + [child_name],
                    connections,
                    depth + 1
                )
            
            self.parent._traverse_hierarchy(instance, template_name, path, depth, 
                                          node_callback=None, subgraph_callback=subgraph_callback)
    
    # ===== End Helper Classes =====
    
    def _resolve_graph_hierarchy(self):
        """Resolve graph hierarchy from ClusterDescriptor using HierarchyResolver
        
        Delegates to HierarchyResolver helper class for clean separation of concerns.
        
        Returns:
            List of dicts with structure:
            [{
                'path': ['root', 'superpod1', 'node1'],  # Path from root to this node
                'child_name': 'node1',                    # Name of this child
                'node_type': 'N300_LB_DEFAULT',           # NodeDescriptor type
                'host_id': 0,                              # Host ID assignment
                'depth': 2                                 # Depth in hierarchy
            }, ...]
        """
        if not self.cluster_descriptor:
            return []
        
        # Use HierarchyResolver helper for clean separation of concerns
        self._hierarchy_resolver = self.HierarchyResolver(self)
        hierarchy = self._hierarchy_resolver.resolve_hierarchy()
        
        # Store the path-to-host_id map for backward compatibility with existing code
        self._path_to_host_id_map = self._hierarchy_resolver._path_to_host_id_map
        
        return hierarchy
    
    def _find_child_in_template(self, template, child_name):
        """Find a child instance by name in a template
        
        Args:
            template: GraphTemplate to search
            child_name: Name of the child to find
            
        Returns:
            ChildInstance if found, None otherwise
        """
        for child in template.children:
            if child.name == child_name:
                return child
        return None
    
    def _traverse_hierarchy(self, instance, template_name, path, depth, 
                           node_callback=None, subgraph_callback=None):
        """Generic hierarchy traversal with callbacks for nodes and subgraphs
        
        This extracts the common pattern from _resolve_instance_recursive and 
        _parse_connections_recursive to reduce code duplication.
        
        Args:
            instance: GraphInstance to traverse
            template_name: Name of the template this instance uses
            path: Current path from root (list of strings)
            depth: Current depth in hierarchy
            node_callback: Optional callback(child_name, child_mapping, child_instance, path, depth)
                          called for leaf nodes (those with host_id)
            subgraph_callback: Optional callback(child_name, child_mapping, child_instance, 
                              nested_template_name, path, depth) called for nested subgraphs
        """
        # Get the template
        if template_name not in self.cluster_descriptor.graph_templates:
            self._log_warning(f"Template not found in graph_templates", 
                            {"template": template_name})
            return
        
        template = self.cluster_descriptor.graph_templates[template_name]
        
        # Process each child mapping
        for child_name, child_mapping in instance.child_mappings.items():
            # Find the corresponding ChildInstance in the template
            child_instance = self._find_child_in_template(template, child_name)
            
            if not child_instance:
                self._log_warning(f"Child not found in template", 
                                {"child": child_name, "template": template_name})
                continue
            
            # Check if this is a leaf node (has host_id) or nested graph (has sub_instance)
            if child_mapping.HasField('host_id'):
                # Leaf node
                if child_instance.HasField('node_ref'):
                    if node_callback:
                        node_callback(child_name, child_mapping, child_instance, path, depth)
                else:
                    self._log_warning(f"Leaf child has host_id but no node_ref", 
                                    {"child": child_name})
            
            elif child_mapping.HasField('sub_instance'):
                # Nested graph
                if child_instance.HasField('graph_ref'):
                    nested_template_name = child_instance.graph_ref.graph_template
                    if subgraph_callback:
                        subgraph_callback(child_name, child_mapping, child_instance, 
                                        nested_template_name, path, depth)
                else:
                    self._log_warning(f"Nested child has sub_instance but no graph_ref", 
                                    {"child": child_name})
    
    def _resolve_instance_recursive(self, instance, template_name, path, hierarchy, depth):
        """Recursively resolve a Graph Instance to extract leaf devices (host nodes)
        
        Traverses the graph instance hierarchy and collects all leaf devices (those with
        host_id assignments). This flattens the hierarchical structure into a list of
        concrete host devices with their paths and configurations.
        
        Args:
            instance: GraphInstance protobuf to resolve
            template_name: Name of the graph template this instance uses
            path: Current path from root (list of strings)
            hierarchy: Output list to append leaf device info to
            depth: Current depth in the graph instance hierarchy
        """
        # Define callback for leaf nodes
        def node_callback(child_name, child_mapping, child_instance, path, depth):
            node_descriptor_name = child_instance.node_ref.node_descriptor
            hierarchy.append({
                'path': path + [child_name],
                'child_name': child_name,
                'node_type': node_descriptor_name,
                'host_id': child_mapping.host_id,
                'depth': depth
            })
        
        # Define callback for nested subgraphs
        def subgraph_callback(child_name, child_mapping, child_instance, nested_template_name, path, depth):
            self._resolve_instance_recursive(
                instance=child_mapping.sub_instance,
                template_name=nested_template_name,
                path=path + [child_name],
                hierarchy=hierarchy,
                depth=depth + 1
            )
        
        # Use generic traversal helper
        self._traverse_hierarchy(instance, template_name, path, depth, 
                                node_callback, subgraph_callback)

    def _parse_descriptor_connections(self):
        """Parse connections from cabling descriptor using ConnectionResolver
        
        Delegates to ConnectionResolver helper class for clean separation of concerns.
        
        Returns:
            List of connection dicts with hierarchy info
        """
        # Use ConnectionResolver helper with the HierarchyResolver for path lookups
        connection_resolver = self.ConnectionResolver(self, self._hierarchy_resolver)
        return connection_resolver.resolve_connections()
    
    def _parse_connections_recursive(self, instance, template_name, path, connections, depth):
        """Recursively parse connections from a GraphInstance
        
        Args:
            instance: GraphInstance to parse
            template_name: Name of the template
            path: Current path from root
            connections: Output list to append connections to
            depth: Current depth (determines connection level/color)
        """
        # Get the template
        if template_name not in self.cluster_descriptor.graph_templates:
            return
        
        template = self.cluster_descriptor.graph_templates[template_name]
        
        # Parse internal connections at this level FOR THIS SPECIFIC INSTANCE
        # These connections are defined in the template but need to be instantiated
        # for each concrete instance with its specific child mappings
        for cable_type, port_connections in template.internal_connections.items():
            for conn in port_connections.connections:
                # Resolve port_a path relative to this instance
                port_a_path = list(path) + list(conn.port_a.path)
                port_a_host_id = self._path_to_host_id(port_a_path)
                
                # Resolve port_b path relative to this instance
                port_b_path = list(path) + list(conn.port_b.path)
                port_b_host_id = self._path_to_host_id(port_b_path)
                
                if port_a_host_id is not None and port_b_host_id is not None:
                    connections.append({
                        'port_a': {
                            'path': port_a_path,
                            'host_id': port_a_host_id,
                            'tray_id': conn.port_a.tray_id,
                            'port_id': conn.port_a.port_id
                        },
                        'port_b': {
                            'path': port_b_path,
                            'host_id': port_b_host_id,
                            'tray_id': conn.port_b.tray_id,
                            'port_id': conn.port_b.port_id
                        },
                        'cable_type': cable_type,
                        'depth': depth,  # Connection level (0=cluster, 1=superpod, etc.)
                        'template_name': template_name,  # Graph template name where connection is defined
                        'instance_path': '/'.join(path) if path else 'root'
                    })
        
        # Recurse into nested graphs - IMPORTANT: Each nested graph instance
        # will have its own copy of its template's internal connections
        # Define callback for nested subgraphs (leaf nodes don't matter here)
        def subgraph_callback(child_name, child_mapping, child_instance, nested_template_name, path, depth):
            # Recurse with incremented depth
            self._parse_connections_recursive(
                instance=child_mapping.sub_instance,
                template_name=nested_template_name,
                path=path + [child_name],
                connections=connections,
                depth=depth + 1
            )
        
        # Use generic traversal helper (node_callback=None since we don't process leaf nodes here)
        self._traverse_hierarchy(instance, template_name, path, depth, 
                                node_callback=None, subgraph_callback=subgraph_callback)
    
    def _path_to_host_id(self, path):
        """Convert a path to a host_id by looking up in hierarchy
        
        Args:
            path: List of strings representing path from root
            
        Returns:
            host_id if found, None otherwise
        """
        # Use O(1) dictionary lookup instead of O(n) linear search
        return self._path_to_host_id_map.get(tuple(path))

    def _node_descriptor_to_shelf_type(self, node_descriptor_name):
        """Map NodeDescriptor name to shelf unit type key
        
        Args:
            node_descriptor_name: Name of the NodeDescriptor (e.g., 'WH_GALAXY_Y_TORUS', 'N300_LB_DEFAULT')
            
        Returns:
            Shelf unit type key (e.g., 'n300_lb', 'wh_galaxy')
        """
        # Normalize the node descriptor name
        node_type_lower = node_descriptor_name.lower()
        
        # Map descriptor names to existing configs
        descriptor_to_config_map = {
            'wh_galaxy': 'wh_galaxy',
            'wh_galaxy_x_torus': 'wh_galaxy',
            'wh_galaxy_y_torus': 'wh_galaxy',
            'wh_galaxy_xy_torus': 'wh_galaxy',
            'n300_lb': 'n300_lb',
            'n300_lb_default': 'n300_lb',
            'n300_qb': 'n300_qb',
            'n300_qb_default': 'n300_qb',
            'p150_qb_ae': 'p150_qb',
            'p150_qb_ae_default': 'p150_qb',
            'p150_qb_global': 'p150_qb_global',
            'p150_qb_america': 'p150_qb_america',
            'p300_qb_ge': 'p150_qb',  # Similar to P150
            'bh_galaxy': 'bh_galaxy',
            'bh_galaxy_x_torus': 'bh_galaxy',
            'bh_galaxy_y_torus': 'bh_galaxy',
            'bh_galaxy_xy_torus': 'bh_galaxy',
        }
        
        return descriptor_to_config_map.get(node_type_lower, node_type_lower)
    
    def _node_descriptor_to_config(self, node_descriptor_name):
        """Map NodeDescriptor name to shelf configuration
        
        Args:
            node_descriptor_name: Name of the NodeDescriptor (e.g., 'WH_GALAXY_Y_TORUS', 'N300_LB_DEFAULT')
            
        Returns:
            Config dict with tray_count, port_count, and layout info
        """
        # Get the mapped shelf unit type
        config_name = self._node_descriptor_to_shelf_type(node_descriptor_name)
        
        # Check if we have a predefined mapping
        if config_name and config_name in self.shelf_unit_configs:
            return self.shelf_unit_configs[config_name]
        
        # Try to extract info from NodeDescriptor if available in cluster_descriptor
        if self.cluster_descriptor and node_descriptor_name in self.cluster_descriptor.node_descriptors:
            node_desc = self.cluster_descriptor.node_descriptors[node_descriptor_name]
            return self._extract_config_from_node_descriptor(node_desc, node_descriptor_name)
        
        # If not found, create a dynamic config based on heuristics
        print(f"Creating dynamic config for unknown node type: {node_descriptor_name}")
        
        # Normalize the node descriptor name
        node_type_lower = node_descriptor_name.lower()
        
        # Use reasonable defaults based on naming patterns
        if 'wh' in node_type_lower or 'galaxy' in node_type_lower:
            # Galaxy-style devices typically have 4 trays with 6-14 ports
            base_config = self.shelf_unit_configs['wh_galaxy'].copy()
        elif 'n300' in node_type_lower or 'p150' in node_type_lower or 'p300' in node_type_lower:
            # N300/P150 style devices typically have 4 trays with 2-4 ports
            base_config = self.shelf_unit_configs['n300_lb'].copy()
        else:
            # Default fallback
            base_config = self.shelf_unit_configs['wh_galaxy'].copy()
        
        # Store in dynamic configs
        self.dynamic_configs[node_type_lower] = base_config
        self.shelf_unit_configs[node_type_lower] = base_config
        
        return base_config
    
    def _extract_config_from_node_descriptor(self, node_descriptor, descriptor_name):
        """Extract configuration from a NodeDescriptor protobuf
        
        Args:
            node_descriptor: NodeDescriptor protobuf message
            descriptor_name: Name of the descriptor (for logging)
            
        Returns:
            Config dict with tray_count, port_count, and layout
        """
        # Extract tray count from boards
        tray_count = len(node_descriptor.boards.board) if node_descriptor.boards else 4
        
        # Extract port count by analyzing port_type_connections
        # Count unique ports across all connection types
        unique_ports = set()
        for port_type, port_conns in node_descriptor.port_type_connections.items():
            for conn in port_conns.connections:
                unique_ports.add((conn.port_a.tray_id, conn.port_a.port_id))
                unique_ports.add((conn.port_b.tray_id, conn.port_b.port_id))
        
        # Calculate max port per tray
        if unique_ports:
            ports_per_tray = {}
            for tray_id, port_id in unique_ports:
                if tray_id not in ports_per_tray:
                    ports_per_tray[tray_id] = 0
                ports_per_tray[tray_id] = max(ports_per_tray[tray_id], port_id)
            port_count = max(ports_per_tray.values()) if ports_per_tray else 2
        else:
            # Default if no connections defined
            port_count = 2
        
        # Determine layout based on tray/port ratio
        if tray_count >= port_count:
            tray_layout = "horizontal"
        else:
            tray_layout = "vertical"
        
        # Create config
        config = {
            "tray_count": tray_count,
            "port_count": port_count,
            "tray_layout": tray_layout,
            "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
            "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
            "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
        }
        
        print(f"Extracted config from NodeDescriptor '{descriptor_name}': "
              f"{tray_count} trays, {port_count} ports, {tray_layout} layout")
        
        return config

    def parse_csv(self, csv_file):
        """Parse CSV file containing cabling connections with unified flexible parsing"""
        try:
            # First, detect the file format and available fields
            self.file_format = self.detect_csv_format(csv_file)
            if not self.file_format:
                return []

            print(f"Detected file format: {self.file_format}")

            # Use the new unified parser
            return self.parse_unified_csv(csv_file)

        except Exception as e:
            print(f"Error parsing CSV file: {e}")
            return []

    def parse_unified_csv(self, csv_file):
        """Unified CSV parser that handles any combination of available fields"""
        try:
            lines = self.read_csv_lines(csv_file)
            
            # Parse headers to get field mappings
            # Look for the line that contains actual column headers (not grouping headers)
            header_line = None
            for i in range(1, min(3, len(lines))):  # Check lines 1 and 2
                line = lines[i].strip()
                if line and not line.startswith("Source") and not line.startswith("Destination"):
                    # This looks like actual column headers
                    header_line = line
                    break
            
            if not header_line:
                # Fallback to line 2 if no proper headers found
                header_line = lines[1].strip()
            
            headers = [h.strip() for h in header_line.split(",")]
            
            # Define field mappings
            field_mappings = {
                "hostname": ["hostname", "host", "node"],
                "hall": ["hall", "building", "facility", "data hall"],
                "aisle": ["aisle", "row", "corridor"],
                "rack": ["rack", "rack_num", "rack_number"],
                "shelf_u": ["shelf u", "shelf_u", "shelf", "u", "unit"],
                "tray": ["tray", "tray_num", "tray_number"],
                "port": ["port", "port_num", "port_number"],
                "label": ["label", "id", "identifier"],
                "node_type": ["node type", "node_type", "type", "model"],
                "cable_length": ["cable length", "cable_length", "length"],
                "cable_type": ["cable type", "cable_type", "cable"]
            }
            
            # Map headers to field names - handle duplicate field names
            field_positions = {}
            for i, header in enumerate(headers):
                header_lower = header.lower()
                for field_name, possible_headers in field_mappings.items():
                    # Use exact matching to avoid false positives
                    if header_lower in possible_headers:
                        # Store all positions for each field name
                        if field_name not in field_positions:
                            field_positions[field_name] = []
                        field_positions[field_name].append(i)
                        break
            
            # Also check the first line (grouping header) for cable fields
            if len(lines) > 0:
                first_line = lines[0].strip()
                first_line_parts = first_line.split(',')
                for i, part in enumerate(first_line_parts):
                    part_lower = part.lower()
                    for field_name, possible_headers in field_mappings.items():
                        if any(possible in part_lower for possible in possible_headers):
                            # Store all positions for each field name
                            if field_name not in field_positions:
                                field_positions[field_name] = []
                            field_positions[field_name].append(i)
                            break
            
            # Special case: handle "Source Device" and "Dest Device" fields
            for i, header in enumerate(headers):
                header_lower = header.lower()
                if header_lower == "source device":
                    if "node_type" not in field_positions:
                        field_positions["node_type"] = []
                    field_positions["node_type"].append(i)
                elif header_lower == "dest device":
                    if "node_type" not in field_positions:
                        field_positions["node_type"] = []
                    field_positions["node_type"].append(i)
            
            # Determine if we have source/destination pairs or single connection
            # Check if we have duplicate field names (indicating source/destination structure)
            has_source_dest = any(len(positions) > 1 for positions in field_positions.values())
            
            source_fields = {}
            dest_fields = {}
            
            if has_source_dest:
                # Split fields into source and destination based on duplicate field names
                # Find the first occurrence of a duplicate field name to determine split point
                dest_start_pos = None
                for field_name, positions in field_positions.items():
                    if len(positions) > 1:
                        # Find the first duplicate position
                        for i in range(1, len(positions)):
                            if positions[i] != positions[i-1] + 1:
                                dest_start_pos = positions[i]
                                break
                        if dest_start_pos is not None:
                            break
                
                # If no non-consecutive duplicates found, use the first duplicate position
                if dest_start_pos is None:
                    for field_name, positions in field_positions.items():
                        if len(positions) > 1:
                            dest_start_pos = positions[1]  # Use the second occurrence
                            break
                
                if dest_start_pos is None:
                    # Fallback: use mid_point calculation
                    if self.file_format == "hierarchical":
                        if len(headers) >= 20:
                            dest_start_pos = 7
                        else:
                            dest_start_pos = 9
                    else:
                        dest_start_pos = 4
                
                for field_name, positions in field_positions.items():
                    # Special handling for node_type fields
                    if field_name == "node_type" and len(positions) == 2:
                        # For node_type, use the first position for source and second for destination
                        source_fields[field_name] = positions[0]
                        dest_fields[field_name] = positions[1]
                    else:
                        # Find source position (first occurrence before dest_start_pos)
                        source_pos = None
                        dest_pos = None
                        for pos in positions:
                            if pos < dest_start_pos and source_pos is None:
                                source_pos = pos
                            elif pos >= dest_start_pos and dest_pos is None:
                                dest_pos = pos
                        
                        # Always assign source position if it exists
                        if source_pos is not None:
                            source_fields[field_name] = source_pos
                        # Always assign destination position if it exists
                        if dest_pos is not None:
                            dest_fields[field_name] = dest_pos
                
            else:
                # Single connection format - use all fields
                for field_name, positions in field_positions.items():
                    if positions:
                        field_positions[field_name] = positions[0]  # Use first occurrence
            
            node_types_seen = set()
            
            # Process data lines - start from line 3 (index 2) or after headers
            data_start_line = 2  # Default to line 3 (index 2)
            for i, line in enumerate(lines[2:], start=2):
                line = line.strip()
                if not line:
                    continue
                
                # Skip if this looks like a header line
                if line.startswith("Source") or line.startswith("Destination") or line.startswith("Hostname") or line.startswith("Data Hall"):
                    continue
                
                row_values = line.split(",")
                
                # Validate tray and port fields before parsing to avoid creating fake connections
                if has_source_dest:
                    # Check if source and destination tray/port fields are filled
                    source_tray = row_values[source_fields.get("tray", -1)] if source_fields.get("tray", -1) < len(row_values) else ""
                    source_port = row_values[source_fields.get("port", -1)] if source_fields.get("port", -1) < len(row_values) else ""
                    dest_tray = row_values[dest_fields.get("tray", -1)] if dest_fields.get("tray", -1) < len(row_values) else ""
                    dest_port = row_values[dest_fields.get("port", -1)] if dest_fields.get("port", -1) < len(row_values) else ""
                else:
                    # Single connection format - check first half for source, second half for destination
                    mid_point = len(row_values) // 2
                    source_tray = row_values[field_positions.get("tray", -1)] if field_positions.get("tray", -1) < len(row_values) else ""
                    source_port = row_values[field_positions.get("port", -1)] if field_positions.get("port", -1) < len(row_values) else ""
                    dest_tray = row_values[field_positions.get("tray", -1) + mid_point] if field_positions.get("tray", -1) + mid_point < len(row_values) else ""
                    dest_port = row_values[field_positions.get("port", -1) + mid_point] if field_positions.get("port", -1) + mid_point < len(row_values) else ""
                
                # Skip rows where tray or port are not filled
                if not source_tray or not source_port or not dest_tray or not dest_port:
                    continue
                
                if has_source_dest:
                    # Parse source and destination separately
                    source_data = self._parse_connection_end(row_values, source_fields, "source")
                    dest_data = self._parse_connection_end(row_values, dest_fields, "destination")
                else:
                    # Single connection format - assume first half is source, second half is destination
                    mid_point = len(row_values) // 2
                    source_data = self._parse_connection_end(row_values[:mid_point], field_positions, "source")
                    dest_data = self._parse_connection_end(row_values[mid_point:], 
                                                         {k: v-mid_point for k, v in field_positions.items()}, "destination")
                
                # Extract cable information
                cable_length = "Unknown"
                cable_type = "400G_AEC"
                
                # Look for cable info in the row - check all positions for cable fields
                for field_name, positions in field_positions.items():
                    if field_name == "cable_length" and positions:
                        for pos in positions:
                            if pos < len(row_values) and row_values[pos]:
                                cable_length = row_values[pos]
                                break
                    elif field_name == "cable_type" and positions:
                        for pos in positions:
                            if pos < len(row_values) and row_values[pos]:
                                cable_type = row_values[pos]
                                break
                
                # Create connection object
                connection = {
                    "source": source_data,
                    "destination": dest_data,
                    "cable_length": cable_length,
                    "cable_type": cable_type
                }
                
                self.connections.append(connection)
                
                # Track node types
                node_types_seen.add(source_data.get("node_type", ""))
                node_types_seen.add(dest_data.get("node_type", ""))
                
                # Track location information based on format
                if self.file_format == "hierarchical":
                    self._track_hierarchical_location(source_data, dest_data)
                elif self.file_format == "hostname_based":
                    self._track_hostname_location(source_data, dest_data)
            
            # Create dynamic configurations for unknown node types
            for node_type in node_types_seen:
                if node_type and node_type not in self.shelf_unit_configs:
                    self.analyze_and_create_dynamic_config(node_type, self.connections)
            
            # Set default shelf unit type
            if not self.shelf_unit_type and node_types_seen:
                self.shelf_unit_type = list(node_types_seen)[0]
            elif not self.shelf_unit_type:
                self.shelf_unit_type = "wh_galaxy"
            
            # Initialize templates
            self.set_shelf_unit_type(self.shelf_unit_type)
            
            return self.connections
            
        except Exception as e:
            print(f"Error in unified CSV parsing: {e}")
            return []

    def _parse_connection_end(self, row_values, field_positions, end_type):
        """Parse one end of a connection (source or destination)"""
        data = {}
        
        # Extract available fields
        if "hostname" in field_positions:
            data["hostname"] = row_values[field_positions["hostname"]] if field_positions["hostname"] < len(row_values) else ""
        
        if "hall" in field_positions:
            data["hall"] = row_values[field_positions["hall"]] if field_positions["hall"] < len(row_values) else ""
        
        if "aisle" in field_positions:
            data["aisle"] = row_values[field_positions["aisle"]] if field_positions["aisle"] < len(row_values) else ""
        
        if "rack" in field_positions:
            data["rack_num"] = self.normalize_rack(row_values[field_positions["rack"]]) if field_positions["rack"] < len(row_values) else "01"
        
        if "shelf_u" in field_positions:
            data["shelf_u"] = self.normalize_shelf_u(row_values[field_positions["shelf_u"]]) if field_positions["shelf_u"] < len(row_values) else "01"
        
        if "tray" in field_positions:
            data["tray"] = self.safe_int(row_values[field_positions["tray"]]) if field_positions["tray"] < len(row_values) else 1
        
        if "port" in field_positions:
            data["port"] = self.safe_int(row_values[field_positions["port"]]) if field_positions["port"] < len(row_values) else 1
        
        if "label" in field_positions:
            data["label"] = row_values[field_positions["label"]] if field_positions["label"] < len(row_values) else ""
        
        if "node_type" in field_positions:
            data["node_type"] = self.normalize_node_type(row_values[field_positions["node_type"]]) if field_positions["node_type"] < len(row_values) else "wh_galaxy"
        
        # Generate label if not provided
        if not data.get("label"):
            if "rack_num" in data and "shelf_u" in data:
                data["label"] = f"{data['rack_num']}{data['shelf_u']}-{data.get('tray', 1)}-{data.get('port', 1)}"
            elif "hostname" in data:
                data["label"] = f"{data['hostname']}-{data.get('tray', 1)}-{data.get('port', 1)}"
            else:
                data["label"] = f"{end_type}-{data.get('tray', 1)}-{data.get('port', 1)}"
        
        return data

    def _track_hierarchical_location(self, source_data, dest_data):
        """Track location information for hierarchical format"""
        # Track rack units for layout
        if "rack_num" in source_data and "shelf_u" in source_data:
            self.rack_units.setdefault(source_data["rack_num"], set()).add(source_data["shelf_u"])
        if "rack_num" in dest_data and "shelf_u" in dest_data:
            self.rack_units.setdefault(dest_data["rack_num"], set()).add(dest_data["shelf_u"])
        
        # Track node types for each shelf unit
        if "rack_num" in source_data and "shelf_u" in source_data:
            shelf_key = f"{source_data['rack_num']}_{source_data['shelf_u']}"
            node_type = source_data.get("node_type", "wh_galaxy")
            self.mixed_node_types[shelf_key] = self.normalize_node_type(node_type)
            self.node_locations[shelf_key] = {
                "hostname": source_data.get("hostname", ""),
                "hall": source_data.get("hall", ""),
                "aisle": source_data.get("aisle", ""),
                "rack_num": source_data["rack_num"],
                "shelf_u": source_data["shelf_u"],
            }
        
        if "rack_num" in dest_data and "shelf_u" in dest_data:
            shelf_key = f"{dest_data['rack_num']}_{dest_data['shelf_u']}"
            node_type = dest_data.get("node_type", "wh_galaxy")
            self.mixed_node_types[shelf_key] = self.normalize_node_type(node_type)
            self.node_locations[shelf_key] = {
                "hostname": dest_data.get("hostname", ""),
                "hall": dest_data.get("hall", ""),
                "aisle": dest_data.get("aisle", ""),
                "rack_num": dest_data["rack_num"],
                "shelf_u": dest_data["shelf_u"],
            }

    def _track_hostname_location(self, source_data, dest_data):
        """Track location information for hostname-based format"""
        if "hostname" in source_data and source_data.get("hostname"):
            node_type = source_data.get("node_type", "wh_galaxy")
            self.shelf_units[source_data["hostname"]] = self.normalize_node_type(node_type)
        if "hostname" in dest_data and dest_data.get("hostname"):
            node_type = dest_data.get("node_type", "wh_galaxy")
            self.shelf_units[dest_data["hostname"]] = self.normalize_node_type(node_type)

    def generate_node_id(self, node_type, *args):
        """Generate consistent node IDs for cytoscape elements"""
        if node_type == "port" and len(args) >= 3:
            # Format: <label>-tray#-port#
            return f"{args[0]}-tray{args[1]}-port{args[2]}"
        elif node_type == "tray" and len(args) >= 2:
            # Format: <label>-tray#
            return f"{args[0]}-tray{args[1]}"
        elif node_type == "shelf":
            # Format: <label> - for hierarchical format, use rack_U_shelf format (shelf already numeric)
            if len(args) >= 2:
                return f"{args[0]}_U{args[1]}"
            else:
                return str(args[0])
        else:
            # Fallback to original format for other cases
            return f"{node_type}_{'_'.join(str(arg) for arg in args)}"

    def get_position_type_for_depth(self, depth):
        """Determine position type for a graph at a given depth based on content dominance
        
        Strategy: Each level is arranged opposite to its children's dominant dimension.
        The base alternation is set based on the physical device structure, and we
        alternate from there for nested graphs.
        
        Args:
            depth: Depth in graph hierarchy (0 = top-level graph, 1 = nested graph, etc.)
        
        Returns:
            "horizontal_sequence" or "vertical_sequence"
        """
        # Get base alternation (determined from physical device structure)
        base = self._base_alternation if hasattr(self, '_base_alternation') else "horizontal_sequence"
        
        # For depth 0, use the base alternation directly
        # For each subsequent depth, alternate
        if depth % 2 == 0:
            return base
        else:
            # Odd depths alternate from base
            return "vertical_sequence" if base == "horizontal_sequence" else "horizontal_sequence"
    
    def calculate_position_in_sequence(self, element_type, index, parent_x=0, parent_y=0, depth=None):
        """Calculate position for an element in a sequence based on its template
        
        Args:
            element_type: Type of element (graph, node_instance, shelf, etc.)
            index: Index of element in sequence
            parent_x, parent_y: Parent position
            depth: For graph elements, the depth in graph hierarchy
        """
        template = self.element_templates[element_type]
        dimensions = template["dimensions"]
        position_type = template["position_type"]
        
        # For graph elements, determine position_type dynamically based on depth
        if element_type == "graph" and position_type is None and depth is not None:
            position_type = self.get_position_type_for_depth(depth)
        
        # Get width and height first, using moderate defaults if "auto" to prevent overlaps
        # Auto-sized compound nodes will be sized by Cytoscape based on content
        # Use balanced estimates for graph elements - not too tight, not too loose
        width = dimensions.get("width", 0)
        if width == "auto":
            # Balanced width estimate
            width = 600 if element_type == "graph" else 500
        height = dimensions.get("height", 0)
        if height == "auto":
            # Balanced height estimate to prevent overlaps while staying compact
            height = 450 if element_type == "graph" else 500
        
        # Calculate padding and spacing as percentages of element size for adaptive layout
        # This makes larger elements have proportionally larger spacing
        padding_value = dimensions.get("padding", 0)
        spacing_value = dimensions.get("spacing", 0)
        
        # Check if padding/spacing are percentages (stored as decimals, e.g., 0.1 = 10%)
        # or absolute pixel values (integers >= 1)
        if isinstance(padding_value, float) and 0 < padding_value < 1:
            # Padding as percentage of element size
            padding = padding_value * max(width, height)
        else:
            # Absolute pixel value
            padding = padding_value
            
        if isinstance(spacing_value, float) and 0 < spacing_value < 1:
            # Spacing as percentage of element size (use dimension relevant to layout direction)
            if position_type == "horizontal_sequence":
                spacing = spacing_value * width
            elif position_type in ["vertical_sequence", "vertical_sequence_reversed"]:
                spacing = spacing_value * height
            else:
                spacing = spacing_value * max(width, height)
        else:
            # Absolute pixel value
            spacing = spacing_value

        if position_type == "horizontal_sequence":
            # Elements arranged left-to-right (e.g., racks, ports)
            x = parent_x + padding + index * (width + spacing)
            y = parent_y + padding

        elif position_type == "vertical_sequence":
            # Elements arranged top-to-bottom (e.g., trays)
            x = parent_x + padding
            y = parent_y + padding + index * (height + spacing)

        elif position_type == "vertical_sequence_reversed":
            # Elements arranged bottom-to-top (e.g., shelves with lower U at bottom)
            x = parent_x + padding
            # Note: This will be corrected in the calling function with total count
            y = parent_y + padding + index * (height + spacing)
        
        elif position_type == "grid":
            # Elements arranged in a grid (e.g., node instances within a graph)
            grid_columns = template.get("grid_columns", 3)  # Default to 3 columns
            row = index // grid_columns
            col = index % grid_columns
            x = parent_x + padding + col * (width + spacing)
            y = parent_y + padding + row * (height + spacing)

        return x, y

    def get_child_positions_for_parent(self, parent_type, child_indices, parent_x, parent_y):
        """Get all child positions for a parent element using templates"""
        template = self.element_templates[parent_type]
        child_type = template["child_type"]

        if not child_type:
            return []

        child_positions = []
        for index, child_id in enumerate(child_indices):
            x, y = self.calculate_position_in_sequence(child_type, index, parent_x, parent_y)
            child_positions.append((child_id, x, y))

        # Handle reversed sequences (e.g., shelves)
        child_template = self.element_templates[child_type]
        if child_template["position_type"] == "vertical_sequence_reversed":
            # Reverse the Y positions so lower indices are at bottom
            total_count = len(child_indices)
            corrected_positions = []
            for child_id, x, original_y in child_positions:
                # Calculate position from bottom instead of top
                corrected_index = total_count - 1 - child_positions.index((child_id, x, original_y))
                _, corrected_y = self.calculate_position_in_sequence(child_type, corrected_index, parent_x, parent_y)
                corrected_positions.append((child_id, x, corrected_y))
            return corrected_positions

        return child_positions

    def create_node_from_template(self, node_type, node_id, parent_id, label, x, y, **extra_data):
        """Create a cytoscape node using element template"""
        template = self.element_templates[node_type]

        node_data = {"id": node_id, "label": label, "type": node_type, **extra_data}

        # Add parent relationship if specified
        if parent_id:
            node_data["parent"] = parent_id

        # Handle "auto" dimensions for compound nodes
        width = template["dimensions"]["width"]
        height = template["dimensions"]["height"]
        
        # Build node structure
        node = {
            "data": node_data,
            "classes": template["style_class"],
        }
        
        # Only add position if x and y are provided (not None)
        # This allows Cytoscape to auto-layout certain compound nodes
        if x is not None and y is not None:
            # For auto-sized nodes, use position as-is (Cytoscape will auto-size)
            # For fixed-size nodes, center the position
            if width == "auto" or height == "auto":
                pos_x = x
                pos_y = y
            else:
                pos_x = x + width / 2
                pos_y = y + height / 2
            
            node["position"] = {"x": pos_x, "y": pos_y}

        return node

    def create_hierarchical_nodes(self):
        """Create hierarchical compound nodes using templates for positioning"""
        self.create_hierarchical_nodes_unified()

    def create_hierarchical_nodes_unified(self):
        """Create hierarchical nodes using unified approach based on detected format"""

        if self.file_format == "hierarchical":
            # Full hierarchy with racks
            self._create_rack_hierarchy()
        elif self.file_format in ["hostname_based", "minimal"]:
            # Shelf-only hierarchy
            self._create_shelf_hierarchy()
        elif self.file_format == "descriptor":
            # Graph hierarchy from cabling descriptor
            self._create_graph_hierarchy()

    def _create_graph_hierarchy(self):
        """Create hierarchical visual structure from cabling descriptor
        
        Creates nested compound visual elements for the logical graph topology:
        - Graph Instance elements for logical groupings (superpods, pods, etc.)
        - Host Device elements for individual physical servers
        - Shelf/tray/port elements for physical connectivity structure
        """
        if not self.graph_hierarchy:
            self._log_warning("No graph hierarchy to visualize")
            return
        
        # NOTE: Future optimization opportunity - could group devices by depth to optimize
        # layout calculations by processing level-by-level
        
        # Track all graph instance paths that need compound visual elements
        # NOTE: Root cluster is implicit (not visualized), only child graphs are shown
        graph_paths = set()
        
        for device_info in self.graph_hierarchy:
            path = device_info['path']
            # Add all parent paths (excluding the leaf device itself)
            for i in range(len(path) - 1):
                graph_paths.add(tuple(path[:i+1]))
        
        # Sort graph instance paths by depth (shorter first), then alphabetically
        # This ensures consistent ordering (e.g., superpod1, superpod2, superpod3, superpod4)
        sorted_graph_paths = sorted(graph_paths, key=lambda p: (len(p), p))
        
        # Create Graph Instance compound visual elements
        graph_node_map = {}  # path tuple -> Cytoscape visual element ID
        for graph_path_tuple in sorted_graph_paths:
            graph_path = list(graph_path_tuple)
            self._create_graph_compound_node(graph_path, graph_node_map)
        
        # Create Host Device visual elements (leaf devices with host_ids)
        for device_info in self.graph_hierarchy:
            self._create_node_instance(device_info, graph_node_map)
    
    def _create_graph_compound_node(self, graph_path, graph_node_map):
        """Create a visual compound element for a Graph Instance (e.g., superpod, pod)
        
        Graph Instances are logical groupings in the hierarchy (e.g., superpod1, pod2).
        They are rendered as compound visual elements in Cytoscape that contain their
        child graph instances or host devices.
        
        Args:
            graph_path: List of strings representing path to this graph instance (e.g., ['superpod1'])
            graph_node_map: Dict mapping path tuples to Cytoscape visual element IDs
        """
        graph_path_tuple = tuple(graph_path)
        
        # Skip if already created
        if graph_path_tuple in graph_node_map:
            return
        
        # Generate node ID and label
        graph_id = "graph_" + "_".join(graph_path)
        graph_label = graph_path[-1]  # Use last element as label
        
        # Determine parent (root cluster is implicit, so depth-1 nodes have no parent)
        parent_id = None
        if len(graph_path) > 1:
            parent_path_tuple = tuple(graph_path[:-1])
            parent_id = graph_node_map.get(parent_path_tuple)
        
        # Calculate position using alternating layout based on depth
        # Position type alternates at each depth level
        depth = len(graph_path)
        
        # Get parent's position for relative positioning
        parent_x = 0
        parent_y = 0
        if parent_id:
            # Find parent node to get its position
            parent_found = False
            for node in self.nodes:
                if node['data']['id'] == parent_id:
                    if 'position' in node:
                        parent_x = node['position']['x']
                        parent_y = node['position']['y']
                        parent_found = True
                    break
            if not parent_found and parent_id:
                self._log_warning(f"Parent {parent_id} not found for graph {graph_path}, using (0,0)")
        
        # Count siblings at same depth with same parent
        # Siblings are nodes at the same depth with the same parent path
        if len(graph_path) > 1:
            # For nested graphs, siblings share the same parent path
            parent_path_tuple = tuple(graph_path[:-1])  # Convert to tuple for comparison
            siblings = [p for p in graph_node_map.keys() 
                       if len(p) == len(graph_path) and p[:-1] == parent_path_tuple]
            index = len(siblings)
        else:
            # For top-level graphs (depth 1), count all graphs at depth 1
            siblings = [p for p in graph_node_map.keys() if len(p) == 1]
            index = len(siblings)
        
        # Use calculate_position_in_sequence with parent position for relative positioning
        # This ensures nested graphs are positioned relative to their parent
        x, y = self.calculate_position_in_sequence("graph", index, parent_x=parent_x, parent_y=parent_y, depth=depth)
        
        # Get template name for this graph path
        template_name = None
        if self._hierarchy_resolver:
            template_name = self._hierarchy_resolver.get_template_for_path(graph_path)
        
        # Create graph compound node with calculated position to prevent overlaps
        graph_node = self.create_node_from_template(
            "graph",
            graph_id,
            parent_id,
            graph_label,
            x,  # Use calculated position
            y,  # Use calculated position
            graph_path=graph_path,
            depth=depth,
            template_name=template_name  # Add template name to node data
        )
        
        self.nodes.append(graph_node)
        graph_node_map[graph_path_tuple] = graph_id
    
    def _create_node_instance(self, node_info, graph_node_map):
        """Create a shelf (host device) directly under its parent graph
        
        In hierarchical descriptors, each host device is represented as a shelf node
        that is directly contained by a graph node (e.g., superpod). The shelf IS the 
        physical host - it contains trays and ports but there's no intermediate wrapper.
        
        Structure: Graph (superpod) → Shelf (host_5) → Tray → Port
        
        Args:
            node_info: Dict with path, child_name, node_type, host_id, depth for the host device
            graph_node_map: Dict mapping graph instance paths to Cytoscape visual element IDs
        """
        path = node_info['path']
        child_name = node_info['child_name']
        node_type = node_info['node_type']
        host_id = node_info['host_id']
        
        # Get node configuration
        node_config = self._node_descriptor_to_config(node_type)
        node_config = self.calculate_auto_dimensions(node_config)
        
        # Determine parent graph node
        parent_id = None
        if len(path) > 1:
            parent_path_tuple = tuple(path[:-1])
            parent_id = graph_node_map.get(parent_path_tuple)
        
        # Generate unique ID for this node instance
        node_instance_id = f"node_instance_{host_id}_{child_name}"
        
        # Calculate position within parent
        # Find siblings (other nodes at same depth with same parent)
        # Sort siblings by path to ensure consistent ordering
        siblings = sorted([n for n in self.graph_hierarchy if n['path'][:-1] == path[:-1]], 
                         key=lambda x: x['path'])
        sibling_index = siblings.index(node_info)
        
        # Get parent graph's absolute position if it exists
        # For Cytoscape compound nodes, children must be positioned in ABSOLUTE coordinates
        # to prevent all graphs from auto-centering at the same location
        parent_x = 0
        parent_y = 0
        if parent_id and parent_id in [n['data']['id'] for n in self.nodes]:
            # Find parent node to get its intended position
            for node in self.nodes:
                if node['data']['id'] == parent_id:
                    # Parent might not have position (auto-layout), use 0,0 as default
                    if 'position' in node:
                        parent_x = node['position']['x']
                        parent_y = node['position']['y']
                    break
        
        # Position based on sibling index within parent
        # CRITICAL: Use parent's absolute position so shelves are positioned absolutely
        # This prevents all graphs from auto-centering at the same spot
        x, y = self.calculate_position_in_sequence("shelf", sibling_index, parent_x=parent_x, parent_y=parent_y)
        
        # Create shelf directly under graph (shelf = host device)
        shelf_id = f"shelf_{host_id}_{child_name}"
        shelf_label = f"{child_name} (host_{host_id})"
        
        shelf_node = self.create_node_from_template(
            "shelf",
            shelf_id,
            parent_id,
            shelf_label,
            x,
            y,
            host_id=host_id,
            shelf_node_type=node_type,  # Store as shelf_node_type (standard field)
            node_descriptor_type=node_type,  # Keep for compatibility
            child_name=child_name,
            hostname=child_name  # Also store as hostname
        )
        
        self.nodes.append(shelf_node)
        
        # Create tray/port structure for this shelf (host)
        self._create_trays_and_ports(
            shelf_id,
            node_config,
            x,
            y,
            None,  # rack_num
            None,  # shelf_u
            node_type,  # shelf_node_type
            child_name,  # hostname
            host_id,  # host_id
            child_name  # node_name
        )
    
    def _create_rack_hierarchy(self):
        """Create full hierarchy nodes (racks -> shelves -> trays -> ports)"""
        # Get sorted rack numbers for consistent ordering (right to left)
        rack_numbers = sorted(self.rack_units.keys(), reverse=True)

        # Calculate rack positions using template
        rack_positions = []
        for rack_idx, rack_num in enumerate(rack_numbers):
            rack_x, rack_y = self.calculate_position_in_sequence("rack", rack_idx)
            rack_positions.append((rack_num, rack_x, rack_y))

        # Create all nodes using template-based approach
        for rack_num, rack_x, rack_y in rack_positions:
            # Get shelf units for this rack to extract hall/aisle info
            # Sort in descending order so higher U numbers are at top
            shelf_units = sorted(self.rack_units[rack_num], reverse=True)

            # Get hall and aisle info from the first shelf in this rack (if available)
            hall = ""
            aisle = ""
            if shelf_units:
                first_shelf_key = f"{rack_num}_{shelf_units[0]}"
                first_shelf_info = self.node_locations.get(first_shelf_key, {})
                hall = first_shelf_info.get("hall", "")
                aisle = first_shelf_info.get("aisle", "")

            # Create rack node with location info
            rack_id = self.generate_node_id("rack", rack_num)
            rack_node = self.create_node_from_template(
                "rack", rack_id, None, f"Rack {rack_num}", rack_x, rack_y, rack_num=rack_num, hall=hall, aisle=aisle
            )
            self.nodes.append(rack_node)

            # Calculate shelf positions
            shelf_positions = self.get_child_positions_for_parent("rack", shelf_units, rack_x, rack_y)

            for shelf_u, shelf_x, shelf_y in shelf_positions:
                # Get the node type and location info for this specific shelf
                shelf_key = f"{rack_num}_{shelf_u}"
                shelf_node_type = self.mixed_node_types.get(shelf_key, self.shelf_unit_type)
                shelf_config = self.shelf_unit_configs.get(shelf_node_type, self.current_config)
                location_info = self.node_locations.get(shelf_key, {})
                hostname = location_info.get("hostname", "")

                # Create shelf node with hostname as ID (hostname is primary identifier)
                # Use hostname for shelf_id, not rack_shelf format
                shelf_id = self.generate_node_id("shelf", hostname) if hostname else self.generate_node_id("shelf", rack_num, shelf_u)
                shelf_label = f"{hostname}" if hostname else f"Shelf {shelf_u}"
                shelf_node = self.create_node_from_template(
                    "shelf",
                    shelf_id,
                    rack_id,
                    shelf_label,
                    shelf_x,
                    shelf_y,
                    rack_num=rack_num,
                    shelf_u=shelf_u,
                    shelf_node_type=shelf_node_type,
                    hostname=hostname,
                    hall=location_info.get("hall", ""),
                    aisle=location_info.get("aisle", ""),
                )
                self.nodes.append(shelf_node)

                # Create trays and ports
                self._create_trays_and_ports(shelf_id, shelf_config, shelf_x, shelf_y, rack_num, shelf_u, shelf_node_type, hostname)

    def _create_shelf_hierarchy(self):
        """Create shelf-only hierarchy nodes (shelves -> trays -> ports)"""
        # Get sorted hostnames for consistent ordering
        hostnames = sorted(self.shelf_units.keys())

        # Calculate shelf positions using template
        shelf_positions = []
        for shelf_idx, hostname in enumerate(hostnames):
            shelf_x, shelf_y = self.calculate_position_in_sequence("shelf", shelf_idx)
            shelf_positions.append((hostname, shelf_x, shelf_y))

        # Create all nodes using template-based approach (no racks)
        for hostname, shelf_x, shelf_y in shelf_positions:
            # Get the node type for this specific shelf
            shelf_node_type = self.shelf_units.get(hostname, self.shelf_unit_type)
            shelf_config = self.shelf_unit_configs.get(shelf_node_type, self.current_config)

            # Create shelf node (no parent)
            shelf_id = self.generate_node_id("shelf", hostname)
            shelf_node = self.create_node_from_template(
                "shelf",
                shelf_id,
                None,
                f"{hostname}",
                shelf_x,
                shelf_y,
                hostname=hostname,
                shelf_node_type=shelf_node_type,
            )
            self.nodes.append(shelf_node)

            # Create trays and ports
            self._create_trays_and_ports(shelf_id, shelf_config, shelf_x, shelf_y, None, None, shelf_node_type, hostname)

    def _create_trays_and_ports(self, shelf_id, shelf_config, shelf_x, shelf_y, rack_num, shelf_u, 
                               shelf_node_type, hostname, host_id=None, node_name=None):
        """Create trays and ports for a shelf
        
        Args:
            shelf_id: ID of the shelf parent node
            shelf_config: Configuration dict for the shelf
            shelf_x, shelf_y: Position of the shelf
            rack_num: Rack number (can be None for descriptor format)
            shelf_u: Shelf U number (can be None for descriptor format)
            shelf_node_type: Node type (can be None for descriptor format)
            hostname: Hostname for the shelf
            host_id: Optional host ID (for descriptor format)
            node_name: Optional node name (for descriptor format)
        """
        # Create trays based on this shelf's specific configuration
        tray_count = shelf_config["tray_count"]
        tray_ids = list(range(1, tray_count + 1))  # T1, T2, T3, T4 (or however many)
        tray_positions = self.get_child_positions_for_parent("shelf", tray_ids, shelf_x, shelf_y)

        for tray_id, tray_x, tray_y in tray_positions:
            # Create tray node with flexible data based on what's provided
            tray_data = {
                "tray": tray_id,
            }
            # Add rack/shelf hierarchy data if provided (CSV format)
            if rack_num is not None:
                tray_data["rack_num"] = rack_num
            if shelf_u is not None:
                tray_data["shelf_u"] = shelf_u
            if shelf_node_type is not None:
                tray_data["shelf_node_type"] = shelf_node_type
            if hostname is not None:
                tray_data["hostname"] = hostname
            # Add descriptor format data if provided
            if host_id is not None:
                tray_data["host_id"] = host_id
            if node_name is not None:
                tray_data["node_name"] = node_name
            
            tray_node_id = self.generate_node_id("tray", shelf_id, tray_id)
            tray_node = self.create_node_from_template(
                "tray",
                tray_node_id,
                shelf_id,
                f"T{tray_id}",
                tray_x,
                tray_y,
                **tray_data
            )
            self.nodes.append(tray_node)

            # Create ports based on this shelf's specific configuration
            port_count = shelf_config["port_count"]
            port_ids = list(range(1, port_count + 1))  # P1, P2, ... (based on config)
            port_positions = self.get_child_positions_for_parent("tray", port_ids, tray_x, tray_y)

            for port_id, port_x, port_y in port_positions:
                # Create port node with flexible data
                port_data = {
                    "tray": tray_id,
                    "port": port_id,
                }
                # Add rack/shelf hierarchy data if provided (CSV format)
                if rack_num is not None:
                    port_data["rack_num"] = rack_num
                if shelf_u is not None:
                    port_data["shelf_u"] = shelf_u
                if shelf_node_type is not None:
                    port_data["shelf_node_type"] = shelf_node_type
                if hostname is not None:
                    port_data["hostname"] = hostname
                # Add descriptor format data if provided
                if host_id is not None:
                    port_data["host_id"] = host_id
                if node_name is not None:
                    port_data["node_name"] = node_name
                
                port_node_id = self.generate_node_id("port", shelf_id, tray_id, port_id)
                port_node = self.create_node_from_template(
                    "port",
                    port_node_id,
                    tray_node_id,
                    f"P{port_id}",
                    port_x,
                    port_y,
                    **port_data
                )
                self.nodes.append(port_node)

    def create_connection_edges(self):
        """Create edges representing connections between ports"""
        # Handle descriptor connections differently
        if self.file_format == "descriptor" and self.descriptor_connections:
            self._create_descriptor_edges()
            return
        
        # Regular CSV-based connections
        for i, connection in enumerate(self.connections, 1):
            # Generate port IDs based on format
            src_port_id, dst_port_id = self._generate_port_ids(connection)
            
            # Determine connection color
            color = self._get_connection_color(connection)
            
            # Generate edge styling properties
            edge_props = self._generate_edge_properties(i)
            
            # Create edge data
            edge_data = {
                "data": {
                    "id": f"connection_{i}",
                    "source": src_port_id,
                    "target": dst_port_id,
                    "cable_length": connection["cable_length"],
                    "cable_type": connection["cable_type"],
                    "connection_number": i,
                    "color": color,
                    "source_info": connection["source"]["label"],
                    "destination_info": connection["destination"]["label"],
                    "source_hostname": connection["source"].get("hostname", ""),
                    "destination_hostname": connection["destination"].get("hostname", ""),
                    **edge_props,
                },
                "classes": "connection",
            }

            self.edges.append(edge_data)
    
    def _create_descriptor_edges(self):
        """Create edges from cabling descriptor connections"""
        # Rainbow color palette for different hierarchy depths - distinct colors for easy visual separation
        depth_colors = {
            0: "#E74C3C",  # Depth 0: Red (cluster level - inter-superpod connections)
            1: "#E67E22",  # Depth 1: Orange (superpod level - intra-superpod connections)
            2: "#F1C40F",  # Depth 2: Yellow
            3: "#27AE60",  # Depth 3: Green
            4: "#3498DB",  # Depth 4: Blue
            5: "#9B59B6",  # Depth 5: Purple
            6: "#E91E63",  # Depth 6+: Magenta/Pink
        }
        
        # Build O(1) lookup map for host_id -> node_info (performance optimization)
        # This avoids O(n*m) nested loop lookups
        host_id_to_node_info = {node['host_id']: node for node in self.graph_hierarchy}
        
        for i, conn in enumerate(self.descriptor_connections, 1):
            # Generate port IDs
            src_host_id = conn['port_a']['host_id']
            src_tray = conn['port_a']['tray_id']
            src_port = conn['port_a']['port_id']
            
            dst_host_id = conn['port_b']['host_id']
            dst_tray = conn['port_b']['tray_id']
            dst_port = conn['port_b']['port_id']
            
            # Find node names from hierarchy using O(1) dictionary lookup
            src_node_info = host_id_to_node_info.get(src_host_id)
            dst_node_info = host_id_to_node_info.get(dst_host_id)
            
            src_node_name = src_node_info['child_name'] if src_node_info else None
            dst_node_name = dst_node_info['child_name'] if dst_node_info else None
            
            # Generate port node IDs
            src_shelf_id = f"shelf_{src_host_id}_{src_node_name}"
            dst_shelf_id = f"shelf_{dst_host_id}_{dst_node_name}"
            src_port_id = self.generate_node_id("port", src_shelf_id, src_tray, src_port)
            dst_port_id = self.generate_node_id("port", dst_shelf_id, dst_tray, dst_port)
            
            # Get color based on depth
            depth = conn['depth']
            color = depth_colors.get(depth, "#999999")
            template_name = conn.get('template_name', f'level_{depth}')
            
            # Create edge data
            edge_data = {
                "data": {
                    "id": f"connection_{i}",
                    "source": src_port_id,
                    "target": dst_port_id,
                    "cable_type": conn['cable_type'],
                    "connection_number": i,
                    "color": color,
                    "depth": depth,
                    "template_name": template_name,
                    "source_info": f"Host {src_host_id} ({src_node_name}) T{src_tray}P{src_port}",
                    "destination_info": f"Host {dst_host_id} ({dst_node_name}) T{dst_tray}P{dst_port}",
                    # Use template-relative child names (node1, node2) for template export compatibility
                    "source_hostname": src_node_name if src_node_name else f"host_{src_host_id}",
                    "destination_hostname": dst_node_name if dst_node_name else f"host_{dst_host_id}",
                },
                "classes": f"connection depth-{depth}",
            }
            
            self.edges.append(edge_data)

    def _generate_port_ids(self, connection):
        """Generate source and destination port IDs based on CSV format"""
        # ALWAYS use hostname for node IDs, regardless of format
        # The rack/shelf columns are only for location metadata
        src_hostname = connection["source"].get("hostname", "unknown")
        dst_hostname = connection["destination"].get("hostname", "unknown")
        src_port_id = self.generate_node_id("port", src_hostname, connection["source"]["tray"], connection["source"]["port"])
        dst_port_id = self.generate_node_id("port", dst_hostname, connection["destination"]["tray"], connection["destination"]["port"])
        
        return src_port_id, dst_port_id

    def _get_connection_color(self, connection):
        """Determine connection color based on whether ports are on the same node"""
        # Always use hostname to determine same-node connections
        source_node_id = connection["source"].get("hostname", "unknown")
        dest_node_id = connection["destination"].get("hostname", "unknown")

        return self.intra_node_color if source_node_id == dest_node_id else self.inter_node_color

    def _generate_edge_properties(self, connection_index):
        """Generate edge styling properties"""
        # Generate random label position along the edge
        random.seed(connection_index)  # Use connection index as seed for consistent positioning
        label_position = self.LABEL_POSITION_MIN + (random.random() * (self.LABEL_POSITION_MAX - self.LABEL_POSITION_MIN))
        
        # Create control point arrays for edge routing
        control_point_distance = self.BASE_CONTROL_DISTANCE
        control_distances = [control_point_distance, -control_point_distance]
        
        return {
            "control_point_distances": control_distances,
            "control_point_weights": self.CONTROL_WEIGHTS,
            "direction_multiplier": 1,
            "label_position": label_position,
        }

    def generate_cytoscape_data(self):
        """Generate complete cytoscape.js data structure"""
        self.nodes = []
        self.edges = []

        # Create hierarchical nodes using templates
        self.create_hierarchical_nodes()

        # Create connection edges
        self.create_connection_edges()

        return {"elements": self.nodes + self.edges}

    def generate_visualization_data(self):
        """Generate cytoscape.js visualization data structure (library method)"""
        cytoscape_data = self.generate_cytoscape_data()
        
        # Use descriptor_connections for descriptor format, regular connections otherwise
        connection_count = (len(self.descriptor_connections) if self.file_format == "descriptor" and self.descriptor_connections 
                          else len(self.connections))
        
        metadata = {
            "total_connections": connection_count,
            "total_nodes": len([n for n in cytoscape_data["elements"] if "source" not in n.get("data", {})]),
            "file_format": self.file_format,  # Include format for legend switching
        }
        
        # If this is a descriptor file, include the graph templates for the UI
        if self.file_format == "descriptor" and self.cluster_descriptor:
            # Extract template names and their full structure from the cluster descriptor
            template_data = {}
            for template_name, template_proto in self.cluster_descriptor.graph_templates.items():
                # Store the template structure for instantiation in the UI
                template_info = {
                    "name": template_name,
                    "children": []
                }
                
                # Extract children (nodes or graph references)
                for child in template_proto.children:
                    child_info = {
                        "name": child.name
                    }
                    
                    if child.HasField("node_ref"):
                        child_info["type"] = "node"
                        child_info["node_descriptor"] = child.node_ref.node_descriptor
                    elif child.HasField("graph_ref"):
                        child_info["type"] = "graph"
                        child_info["graph_template"] = child.graph_ref.graph_template
                    
                    template_info["children"].append(child_info)
                
                # Extract internal connections
                template_info["connections"] = []
                for cable_type, conn_list in template_proto.internal_connections.items():
                    for conn in conn_list.connections:
                        template_info["connections"].append({
                            "cable_type": cable_type,
                            "port_a": {
                                "path": list(conn.port_a.path),
                                "tray_id": conn.port_a.tray_id,
                                "port_id": conn.port_a.port_id
                            },
                            "port_b": {
                                "path": list(conn.port_b.path),
                                "tray_id": conn.port_b.tray_id,
                                "port_id": conn.port_b.port_id
                            }
                        })
                
                template_data[template_name] = template_info
            
            metadata["graph_templates"] = template_data
            print(f"Added {len(template_data)} graph templates to metadata: {list(template_data.keys())}")
        
        return {
            "nodes": cytoscape_data["elements"],
            "edges": [],
            "metadata": metadata,
            "elements": cytoscape_data["elements"],
        }

    def create_diagram(self, output_file="templated_demo_data.json"):
        """Create network cabling topology diagram using cytoscape.js with templates"""

        # Generate cytoscape data
        cytoscape_data = self.generate_visualization_data()

        # For demonstration, save the data structure
        with open(output_file, "w") as f:
            json.dump(cytoscape_data, f, indent=2)

        return cytoscape_data


def main():
    """Main entry point with command line interface for template demo"""
    parser = argparse.ArgumentParser(
        description="Visualize network topology from CSV cabling files or textproto cabling descriptors"
    )
    parser.add_argument(
        "input_file", 
        help="Input CSV cabling file or .textproto cabling descriptor"
    )
    parser.add_argument(
        "-o",
        "--output",
        default="templated_demo_data.json",
        help="Output JSON file for generated Cytoscape.js data (default: templated_demo_data.json)",
    )

    args = parser.parse_args()

    # Detect file type
    input_file = args.input_file
    is_textproto = input_file.endswith('.textproto')
    
    # Create visualizer without specifying shelf unit type (will be auto-detected)
    visualizer = NetworkCablingCytoscapeVisualizer()

    if is_textproto:
        # Parse cabling descriptor
        print(f"Parsing cabling descriptor: {input_file}")
        visualizer.file_format = "descriptor"  # Set format before parsing
        
        if not visualizer.parse_cabling_descriptor(input_file):
            print("Failed to parse cabling descriptor")
            sys.exit(1)
        
        # Get node types from hierarchy and initialize configs
        if visualizer.graph_hierarchy:
            # Extract unique node types
            node_types = set(node['node_type'] for node in visualizer.graph_hierarchy)
            print(f"Node types found: {node_types}")
            
            # Set shelf unit type from first node (or default)
            if node_types:
                first_node_type = list(node_types)[0]
                config = visualizer._node_descriptor_to_config(first_node_type)
                visualizer.shelf_unit_type = first_node_type.lower()
                visualizer.current_config = config
            else:
                visualizer.shelf_unit_type = "wh_galaxy"
                visualizer.current_config = visualizer.shelf_unit_configs["wh_galaxy"]
            
            # Initialize templates for descriptor format
            visualizer.set_shelf_unit_type(visualizer.shelf_unit_type)
        
    else:
        # Parse CSV file
        print(f"Parsing CSV file: {input_file}")
        connections = visualizer.parse_csv(input_file)
        if not connections:
            print("Failed to parse CSV file")
            sys.exit(1)

    # Generate hierarchical nodes using the template system
    visualizer.create_diagram(args.output)
    print(f"Visualization data written to: {args.output}")


if __name__ == "__main__":
    main()
