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
from collections import defaultdict, Counter
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
        """Normalize node type to uppercase standard format and trim whitespace
        
        Also maps alternative names to standard names:
        - "blackhole" -> "BH_GALAXY"
        
        Strips variation suffixes:
        - _DEFAULT suffix (keep _GLOBAL and _AMERICA as distinct types)
        - _X_TORUS, _Y_TORUS, _XY_TORUS suffixes (torus topology variations)
        
        Returns uppercase format for JavaScript NODE_CONFIGS compatibility
        """
        if not node_type:
            return default.upper()
        
        normalized = node_type.strip().lower()
        
        # Strip variation suffixes (order matters: check longer suffixes first)
        # _XY_TORUS must be checked before _X_TORUS and _Y_TORUS
        if normalized.endswith('_xy_torus'):
            normalized = normalized[:-9]  # len('_xy_torus') = 9
        elif normalized.endswith('_x_torus'):
            normalized = normalized[:-8]  # len('_x_torus') = 8
        elif normalized.endswith('_y_torus'):
            normalized = normalized[:-8]  # len('_y_torus') = 8
        elif normalized.endswith('_default'):
            normalized = normalized[:-8]  # len('_default') = 8
        
        # Map alternative names to standard names (lowercase input -> uppercase output)
        type_mappings = {
            "blackhole": "BH_GALAXY",
            "bh_galaxy": "BH_GALAXY",
            "wh_galaxy": "WH_GALAXY",
            "n300_lb": "N300_LB",
            "n300_qb": "N300_QB",
            "p150_lb": "P150_LB",
            "p150_qb_ae": "P150_QB_AE",  # Add P150_QB_AE mapping
            "p150_qb_global": "P150_QB_GLOBAL",
            "p150_qb_america": "P150_QB_AMERICA",
            "p300_qb_ge": "P300_QB_GE",  # Add P300_QB_GE mapping
        }
        
        # Return mapped value or convert to uppercase
        return type_mappings.get(normalized, normalized.upper())

    @staticmethod
    def create_connection_object(source_data, dest_data, cable_length="Unknown", cable_type="400G_AEC"):
        """Create standardized connection object"""
        return {"source": source_data, "destination": dest_data, "cable_length": cable_length, "cable_type": cable_type}

    def __init__(self, shelf_unit_type=None):
        # Data storage
        self.connections = []
        self.rack_units = {}  # rack_num -> set of shelf_u values
        self.shelf_units = {}  # hostname -> node_type for 8-column format
        self.seen_hostnames = set()  # Track all hostnames seen for uniqueness validation
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

        # Define templates for different shelf unit types (uppercase keys for JS compatibility)
        self.shelf_unit_configs = {
            "WH_GALAXY": {
                "tray_count": 4,
                "port_count": 6,  # WH_GALAXY has 6 QSFP-DD ports per tray
                "tray_layout": "vertical",  # T1-T4 arranged vertically (top to bottom)
                # port_layout auto-inferred as 'horizontal' from vertical tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": {"width": 320, "height": 60, "spacing": 10},
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 5},
            },
            "N300_LB": {
                "tray_count": 4,
                "port_count": 2,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "N300_QB": {
                "tray_count": 4,
                "port_count": 2,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "P150_QB": {
                "tray_count": 4,
                "port_count": 4,
                "tray_layout": "vertical",  # T1-T4 arranged vertically (T1 at bottom, T4 at top)
                # port_layout auto-inferred as 'horizontal' from vertical tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "P150_QB_GLOBAL": {
                "tray_count": 4,
                "port_count": 4,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "P150_QB_AMERICA": {
                "tray_count": 4,
                "port_count": 4,
                "tray_layout": "horizontal",  # T1-T4 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' from horizontal tray_layout
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "P150_LB": {
                "tray_count": 8,
                "port_count": 4,
                "tray_layout": "horizontal",  # T1-T8 arranged horizontally (left to right)
                # port_layout auto-inferred as 'vertical' 
                "shelf_dimensions": self.DEFAULT_SHELF_DIMENSIONS.copy(),
                "tray_dimensions": self.DEFAULT_AUTO_TRAY_DIMENSIONS.copy(),
                "port_dimensions": {**self.DEFAULT_PORT_DIMENSIONS, "spacing": 15},
            },
            "BH_GALAXY": {
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
        
        # Hostname to host_index mapping for port ID generation
        self.hostname_to_host_index = {}  # Will be populated during hierarchy creation

    def set_shelf_unit_type(self, shelf_unit_type):
        """Set the shelf unit type and initialize templates"""
        self.shelf_unit_type = self.normalize_node_type(shelf_unit_type)

        # Get current shelf unit configuration
        self.current_config = self.shelf_unit_configs.get(self.shelf_unit_type, self.shelf_unit_configs["WH_GALAXY"])

        # Calculate auto dimensions for trays based on port layout
        self.current_config = self.calculate_auto_dimensions(self.current_config)

        # Initialize element type templates based on format
        if self.file_format == "hierarchical":
            # Full hierarchy with racks
            self.element_templates = {
                "hall": {
                    "dimensions": {"width": "auto", "height": "auto", "padding": 60},
                    "position_type": "horizontal_sequence",  # Halls arranged left-to-right
                    "child_type": "aisle",
                    "style_class": "hall",
                },
                "aisle": {
                    "dimensions": {"width": "auto", "height": "auto", "padding": 40},
                    "position_type": "horizontal_sequence",  # Aisles arranged left-to-right
                    "child_type": "rack",
                    "style_class": "aisle",
                },
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

            # Find the header marker line (contains "Source" and "Destination")
            # The actual column headers are on the NEXT line after the marker
            header_line_idx = None
            
            for i in range(len(lines)):
                line = lines[i].strip().lower()
                # Look for the line with "source" and "destination" markers
                if "source" in line and "destination" in line:
                    # The actual headers are on the next line
                    header_line_idx = i + 1
                    break
            
            # Fallback to old behavior if marker not found
            if header_line_idx is None or header_line_idx >= len(lines):
                print("Warning: Could not find Source/Destination marker line in format detection, using fallback")
                header_line_idx = 1
            
            header_line = lines[header_line_idx].strip()
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
            
        Raises:
            ValueError: If the descriptor is missing critical host_id mappings
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
            
            # CRITICAL VALIDATION: Verify that host_id mappings are defined
            # A cabling descriptor MUST have host_id mappings for the indexed relationship
            # between cabling and deployment descriptors to work correctly
            if not self._validate_host_id_mappings():
                raise ValueError(
                    "Invalid cabling descriptor: Missing host_id mappings in child_mappings. "
                    "A valid cabling descriptor MUST define host_id for each leaf node (host device). "
                    "This is required for the indexed relationship between cabling and deployment descriptors."
                )
            
            # Resolve the hierarchy
            self.graph_hierarchy = self._resolve_graph_hierarchy()
            
            # Validate that hierarchy resolution produced valid host_ids
            if self.graph_hierarchy and not all('host_id' in node for node in self.graph_hierarchy):
                raise ValueError(
                    "Invalid cabling descriptor: Not all nodes have host_id after hierarchy resolution. "
                    "This indicates malformed child_mappings in the descriptor."
                )
            
            # Validate that host_ids are assigned in order (0, 1, 2, 3, ...)
            if self.graph_hierarchy:
                self._validate_host_id_ordering()
            
            # Parse connections
            self.descriptor_connections = self._parse_descriptor_connections()
            
            return True
            
        except ValueError as e:
            # Re-raise ValueError (validation errors) so server can return proper error message
            print(f"Validation error parsing cabling descriptor: {e}")
            raise
        except Exception as e:
            print(f"Error parsing cabling descriptor: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _validate_host_id_mappings(self):
        """Validate that every node specified by root_instance has a host_id assigned
        
        Traverses the root_instance hierarchy and verifies that all leaf nodes
        (nodes with node_ref in templates) have host_id assigned in child_mappings.
        
        Returns:
            True if all nodes have host_id mappings, False otherwise
            
        Raises:
            ValueError: If any nodes are missing host_id, with details about which nodes
        """
        if not self.cluster_descriptor:
            return False
        
        root_instance = self.cluster_descriptor.root_instance
        if not root_instance:
            return False
        
        # Check if there are any child_mappings at all
        if not root_instance.child_mappings:
            return False
        
        # Recursively validate that ALL leaf nodes have host_id
        missing_nodes = []
        self._validate_host_ids_recursive(
            root_instance, 
            root_instance.template_name, 
            [], 
            missing_nodes
        )
        
        if missing_nodes:
            missing_paths = [' > '.join(path) for path in missing_nodes]
            raise ValueError(
                f"Invalid cabling descriptor: Missing host_id for {len(missing_nodes)} node(s). "
                f"Every node specified by root_instance must have a host_id assigned.\n\n"
                f"Missing nodes:\n" + "\n".join(f"  - {' > '.join(path)}" for path in missing_nodes[:20]) +
                (f"\n  ... and {len(missing_nodes) - 20} more" if len(missing_nodes) > 20 else "")
            )
        
        return True
    
    def _validate_host_id_ordering(self):
        """Validate that host_id values are assigned in sequential order (0, 1, 2, 3, ...)
        
        This ensures that host_id assignments match the indexed relationship expected
        between cabling and deployment descriptors (host_id N must correspond to hosts[N]).
        
        Raises:
            ValueError: If host_ids are not sequential, with details about the issue
        """
        if not self.graph_hierarchy:
            return
        
        # Extract all host_id values
        host_ids = [node['host_id'] for node in self.graph_hierarchy if 'host_id' in node]
        
        if not host_ids:
            raise ValueError(
                "Invalid cabling descriptor: No host_id values found in hierarchy. "
                "This indicates the descriptor has no leaf nodes with host_id assignments."
            )
        
        # Check for duplicates
        if len(host_ids) != len(set(host_ids)):
            duplicates = []
            seen = set()
            for host_id in host_ids:
                if host_id in seen:
                    duplicates.append(host_id)
                seen.add(host_id)
            raise ValueError(
                f"Invalid cabling descriptor: Duplicate host_id values found: {sorted(set(duplicates))}. "
                f"Each host_id must be unique. Found {len(host_ids)} nodes but only {len(set(host_ids))} unique host_ids."
            )
        
        # Sort host_ids to check ordering
        sorted_host_ids = sorted(host_ids)
        expected_host_ids = list(range(len(host_ids)))
        
        # Check if they form a consecutive sequence starting from 0
        if sorted_host_ids != expected_host_ids:
            # Find gaps or out-of-order values
            missing = [i for i in expected_host_ids if i not in sorted_host_ids]
            extra = [h for h in sorted_host_ids if h not in expected_host_ids]
            
            error_parts = []
            if missing:
                error_parts.append(f"Missing host_ids: {missing[:10]}{'...' if len(missing) > 10 else ''}")
            if extra:
                error_parts.append(f"Unexpected host_ids: {extra[:10]}{'...' if len(extra) > 10 else ''}")
            
            error_msg = (
                f"Invalid cabling descriptor: host_id values must be assigned in sequential order "
                f"starting from 0 (0, 1, 2, 3, ..., {len(host_ids)-1}). "
                f"Found {len(host_ids)} nodes with host_ids: {sorted_host_ids[:20]}{'...' if len(sorted_host_ids) > 20 else ''}. "
            )
            if error_parts:
                error_msg += " " + ". ".join(error_parts)
            
            raise ValueError(error_msg)
    
    def _validate_host_ids_recursive(self, instance, template_name, current_path, missing_nodes):
        """Recursively validate that all leaf nodes have host_id
        
        Processes children in template.children order for consistency.
        
        Args:
            instance: GraphInstance to validate
            template_name: Name of the template this instance uses
            current_path: List of child names representing the path to this instance
            missing_nodes: List to accumulate paths of nodes missing host_id
        """
        if template_name not in self.cluster_descriptor.graph_templates:
            return
        
        template = self.cluster_descriptor.graph_templates[template_name]
        child_mappings_dict = dict(instance.child_mappings)  # Convert to dict for lookup
        
        # Process children in template order (not child_mappings order)
        for child_instance in template.children:
            child_name = child_instance.name
            
            if child_name not in child_mappings_dict:
                # Child in template but not in child_mappings - skip (will be warned elsewhere)
                continue
            
            child_mapping = child_mappings_dict[child_name]
            child_path = current_path + [child_name]
            
            # Check if this should be a leaf node (has node_ref in template)
            if child_instance.HasField('node_ref'):
                # This is a leaf node - must have host_id
                if not child_mapping.HasField('host_id'):
                    missing_nodes.append(child_path)
            
            # Check if this is a nested graph (has graph_ref in template)
            elif child_instance.HasField('graph_ref'):
                # This is a nested graph - recurse into it
                if child_mapping.HasField('sub_instance'):
                    nested_template_name = child_instance.graph_ref.graph_template
                    self._validate_host_ids_recursive(
                        child_mapping.sub_instance,
                        nested_template_name,
                        child_path,
                        missing_nodes
                    )
                else:
                    # Nested graph instance is missing - this is an error
                    missing_nodes.append(child_path + ['<missing sub_instance>'])

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
            # Try exact match first
            host_id = self._path_to_host_id_map.get(tuple(path))
            if host_id is not None:
                return host_id
            
            # If exact match fails and path has instance-specific names (e.g., "2x_1"),
            # try to find a matching path by template name
            # This handles cases where template definitions use instance-specific names
            # but instances might use different names or be incomplete
            if len(path) > 0:
                # Try to resolve by matching template names instead of instance names
                host_id = self._resolve_path_by_template(path)
                if host_id is not None:
                    return host_id
            
            return None
        
        def _resolve_path_by_template(self, path):
            """Try to resolve a path by matching template names instead of exact child names
            
            This is a fallback for when paths use instance-specific names (e.g., "2x_1")
            but the instance mappings use different names (e.g., "2x_0") or template-relative names.
            
            Args:
                path: List of strings representing path from root
                
            Returns:
                host_id if found, None otherwise
            """
            if not path or not self.parent.cluster_descriptor:
                return None
            
            # Start from root instance
            instance = self.parent.cluster_descriptor.root_instance
            current_path = []
            
            for i, path_element in enumerate(path):
                # Check if this is the last element (leaf node)
                is_last = (i == len(path) - 1)
                
                # Get template for current instance
                template_name = instance.template_name
                if template_name not in self.parent.cluster_descriptor.graph_templates:
                    return None
                
                template = self.parent.cluster_descriptor.graph_templates[template_name]
                
                # Try to find a child in template that matches this path element
                # First try exact match
                child_found = None
                for child_def in template.children:
                    if child_def.name == path_element:
                        child_found = child_def
                        break
                
                # If exact match not found, try to find by template name
                # (for graph children, extract template name from instance-specific name)
                if not child_found and not is_last:
                    # Try to extract base template name (e.g., "2x_1" -> "2x")
                    import re
                    base_match = re.match(r'^(.+?)_\d+$', path_element)
                    base_name = base_match.group(1) if base_match else path_element
                    
                    # Find child that references this template
                    for child_def in template.children:
                        if child_def.HasField('graph_ref'):
                            if child_def.graph_ref.graph_template == base_name:
                                child_found = child_def
                                break
                
                if not child_found:
                    return None
                
                # Get child_mapping - try exact match first, then try any matching template
                child_mapping = None
                if path_element in instance.child_mappings:
                    child_mapping = instance.child_mappings[path_element]
                else:
                    # Try to find child_mapping by matching template
                    # For graph children, match by template name
                    # For node children, match by child name (exact match only)
                    if is_last:
                        # Last element is a leaf node - try to find by child name match
                        # Extract base name if it's instance-specific (e.g., "node_0" -> "node_0")
                        for child_name, mapping in instance.child_mappings.items():
                            if mapping.HasField('host_id'):
                                # Check if child_name matches (exact or base name)
                                if child_name == path_element:
                                    child_mapping = mapping
                                    break
                                # Try base name match (remove _<number> suffix)
                                import re
                                base_match = re.match(r'^(.+?)_\d+$', path_element)
                                if base_match:
                                    base_name = base_match.group(1)
                                    child_base_match = re.match(r'^(.+?)_\d+$', child_name)
                                    if child_base_match and child_base_match.group(1) == base_name:
                                        child_mapping = mapping
                                        break
                    else:
                        # Not last element - should be a graph instance
                        # Find by matching template name
                        expected_template = None
                        if child_found.HasField('graph_ref'):
                            expected_template = child_found.graph_ref.graph_template
                        
                        if expected_template:
                            for child_name, mapping in instance.child_mappings.items():
                                if mapping.HasField('sub_instance'):
                                    if mapping.sub_instance.template_name == expected_template:
                                        child_mapping = mapping
                                        break
                
                if not child_mapping:
                    return None
                
                if is_last:
                    # Last element should be a leaf node (host_id)
                    if child_mapping.HasField('host_id'):
                        return child_mapping.host_id
                    return None
                else:
                    # Not last element - should be a graph instance
                    if child_mapping.HasField('sub_instance'):
                        instance = child_mapping.sub_instance
                        current_path.append(path_element)
                    else:
                        return None
            
            return None
        
        def _resolve_recursive(self, instance, template_name, path, hierarchy, depth):
            """Recursively resolve a Graph Instance"""
            # Store the template name for this path (including root path [])
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
            """Recursively parse connections from a GraphInstance
            
            IMPORTANT: Processes children in template.children order (via _traverse_hierarchy)
            to ensure consistent path resolution. Template connection paths are relative to
            the template and must match child names in the instance.
            """
            if template_name not in self.parent.cluster_descriptor.graph_templates:
                return
            
            template = self.parent.cluster_descriptor.graph_templates[template_name]
            
            # Parse internal connections at this level
            # These connections are defined in the template with relative paths
            # and need to be resolved to absolute paths using the instance's child mappings
            for cable_type, port_connections in template.internal_connections.items():
                for conn in port_connections.connections:
                    # Build absolute paths by prepending instance path to template relative paths
                    # Template paths are relative (e.g., ["node1"] or ["pod1", "node1"])
                    # Instance path is absolute (e.g., ["root", "superpod1"])
                    port_a_path = list(path) + list(conn.port_a.path)
                    port_a_host_id = self.hierarchy_resolver.path_to_host_id(port_a_path)
                    
                    port_b_path = list(path) + list(conn.port_b.path)
                    port_b_host_id = self.hierarchy_resolver.path_to_host_id(port_b_path)
                    
                    # Only add connection if both paths resolve to valid host_ids
                    # This ensures connections are only created for valid leaf nodes
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
                    else:
                        # Log warning if path resolution fails
                        if port_a_host_id is None:
                            self.parent._log_warning(
                                f"Failed to resolve port_a path: {'/'.join(port_a_path)}",
                                {
                                    "template": template_name,
                                    "instance_path": '/'.join(path) if path else 'root',
                                    "relative_path": '/'.join(conn.port_a.path),
                                    "absolute_path": '/'.join(port_a_path)
                                }
                            )
                        if port_b_host_id is None:
                            self.parent._log_warning(
                                f"Failed to resolve port_b path: {'/'.join(port_b_path)}",
                                {
                                    "template": template_name,
                                    "instance_path": '/'.join(path) if path else 'root',
                                    "relative_path": '/'.join(conn.port_b.path),
                                    "absolute_path": '/'.join(port_b_path)
                                }
                            )
            
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
        
        # Store the path-to-host_id map for reference
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
    
    def _get_ordered_children(self, instance, template_name, path):
        """Get children from child_mappings in template order
        
        Args:
            instance: GraphInstance to process
            template_name: Name of the template this instance uses
            path: Current path from root (unused, kept for compatibility)
            
        Returns:
            List of (child_instance, child_mapping, child_name) tuples in template order
            None if template not found
        """
        if template_name not in self.cluster_descriptor.graph_templates:
            return None
        
        template = self.cluster_descriptor.graph_templates[template_name]
        
        # Build ordered list: process children in template order
        ordered_children = []
        child_mappings_dict = dict(instance.child_mappings)  # Convert to dict for lookup
        
        # Process children in template order
        for child_instance in template.children:
            child_name = child_instance.name
            if child_name not in child_mappings_dict:
                continue
            
            child_mapping = child_mappings_dict[child_name]
            ordered_children.append((child_instance, child_mapping, child_name))
        
        return ordered_children
    
    def _traverse_hierarchy(self, instance, template_name, path, depth, 
                           node_callback=None, subgraph_callback=None):
        """Generic hierarchy traversal with callbacks for nodes and subgraphs
        
        This extracts the common pattern from _resolve_instance_recursive and 
        _parse_connections_recursive to reduce code duplication.
        
        IMPORTANT: Processes children in template.children order, not child_mappings order.
        This ensures consistent ordering regardless of how child_mappings is structured.
        
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
        
        # Get ordered children (in template.children order)
        ordered_children = self._get_ordered_children(instance, template_name, path)
        if ordered_children is None:
            return
        
        # Process children in template order
        for child_instance, child_mapping, child_name in ordered_children:
            # Check if this is a leaf node (has host_id) or nested graph (has sub_instance)
            if child_mapping.HasField('host_id'):
                # Leaf node
                if child_instance.HasField('node_ref'):
                    if node_callback:
                        node_callback(child_name, child_mapping, child_instance, path, depth)
                else:
                    self._log_warning(f"Leaf child has host_id but no node_ref", 
                                    {"child": child_name, "template": template_name})
            
            elif child_mapping.HasField('sub_instance'):
                # Nested graph
                if child_instance.HasField('graph_ref'):
                    nested_template_name = child_instance.graph_ref.graph_template
                    if subgraph_callback:
                        subgraph_callback(child_name, child_mapping, child_instance, 
                                        nested_template_name, path, depth)
                else:
                    self._log_warning(f"Nested child has sub_instance but no graph_ref", 
                                    {"child": child_name, "template": template_name})
    
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
        # This maps all NodeDescriptor variations to their base shelf unit type
        descriptor_to_config_map = {
            # WH Galaxy variations
            'wh_galaxy': 'wh_galaxy',
            'wh_galaxy_x_torus': 'wh_galaxy',
            'wh_galaxy_y_torus': 'wh_galaxy',
            'wh_galaxy_xy_torus': 'wh_galaxy',
            # N300 LB variations
            'n300_lb': 'n300_lb',
            'n300_lb_default': 'n300_lb',
            # N300 QB variations
            'n300_qb': 'n300_qb',
            'n300_qb_default': 'n300_qb',
            # P150 LB
            'p150_lb': 'p150_lb',
            # P150 QB AE variations
            'p150_qb_ae': 'p150_qb',
            'p150_qb_ae_default': 'p150_qb',
            # P150 QB other variations (kept as distinct types)
            'p150_qb_global': 'p150_qb_global',
            'p150_qb_america': 'p150_qb_america',
            # P300 QB GE (similar to P150)
            'p300_qb_ge': 'p150_qb',
            # BH Galaxy variations
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
        
        # Normalize config_name to uppercase to match shelf_unit_configs keys
        # shelf_unit_configs uses uppercase keys (e.g., "N300_LB"), but _node_descriptor_to_shelf_type returns lowercase
        config_name_upper = config_name.upper() if config_name else None
        
        # Check if we have a predefined mapping (try both lowercase and uppercase)
        if config_name:
            if config_name in self.shelf_unit_configs:
                return self.shelf_unit_configs[config_name]
            elif config_name_upper in self.shelf_unit_configs:
                return self.shelf_unit_configs[config_name_upper]
        
        # Try to extract info from NodeDescriptor if available in cluster_descriptor
        if self.cluster_descriptor and node_descriptor_name in self.cluster_descriptor.node_descriptors:
            node_desc = self.cluster_descriptor.node_descriptors[node_descriptor_name]
            return self._extract_config_from_node_descriptor(node_desc, node_descriptor_name)
        
        # If not found, create a dynamic config based on heuristics
        
        # Normalize the node descriptor name
        node_type_lower = node_descriptor_name.lower()
        
        # Use reasonable defaults based on naming patterns
        if 'wh' in node_type_lower or 'galaxy' in node_type_lower:
            # Galaxy-style devices typically have 4 trays with 6-14 ports
            base_config = self.shelf_unit_configs['WH_GALAXY'].copy()
        elif 'n300' in node_type_lower or 'p150' in node_type_lower or 'p300' in node_type_lower:
            # N300/P150 style devices typically have 4 trays with 2-4 ports
            base_config = self.shelf_unit_configs['N300_LB'].copy()
        else:
            # Default fallback
            base_config = self.shelf_unit_configs['WH_GALAXY'].copy()
        
        # Store in dynamic configs (use uppercase keys for consistency)
        node_type_upper = node_descriptor_name.upper()
        self.dynamic_configs[node_type_upper] = base_config
        self.shelf_unit_configs[node_type_upper] = base_config
        
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
        
        
        return config

    def parse_csv(self, csv_file):
        """Parse CSV file containing cabling connections with unified flexible parsing"""
        try:
            # First, detect the file format and available fields
            self.file_format = self.detect_csv_format(csv_file)
            if not self.file_format:
                return []


            # Use the new unified parser
            return self.parse_unified_csv(csv_file)

        except Exception as e:
            print(f"Error parsing CSV file: {e}")
            return []

    def parse_unified_csv(self, csv_file):
        """Unified CSV parser that handles any combination of available fields"""
        try:
            lines = self.read_csv_lines(csv_file)
            
            # Find the header marker line (contains "Source" and "Destination")
            # The actual column headers are on the NEXT line after the marker
            header_line_idx = None
            data_start_idx = None
            
            for i in range(len(lines)):
                line = lines[i].strip().lower()
                # Look for the line with "source" and "destination" markers
                if "source" in line and "destination" in line:
                    # The actual headers are on the next line
                    header_line_idx = i + 1
                    data_start_idx = i + 2
                    break
            
            # Fallback to old behavior if marker not found
            if header_line_idx is None or header_line_idx >= len(lines):
                print("Warning: Could not find Source/Destination marker line, using fallback detection")
                header_line_idx = 1
                data_start_idx = 2
            
            header_line = lines[header_line_idx].strip()
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
                    if field_name == "node_type":
                        if len(positions) == 2:
                            # For node_type, use the first position for source and second for destination
                            source_fields[field_name] = positions[0]
                            dest_fields[field_name] = positions[1]
                        elif len(positions) == 1:
                            # Single node_type column - use it for both source and destination
                            # This handles cases like "Source Device" or "Dest Device" where
                            # the node type applies to both ends of the connection
                            source_fields[field_name] = positions[0]
                            dest_fields[field_name] = positions[0]
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
            seen_connections = set()  # Track connections to avoid duplicates
            
            # Process data lines - start from the line after headers (determined earlier)
            data_start_line = data_start_idx  # Use the detected data start position
            for i, line in enumerate(lines[data_start_line:], start=data_start_line):
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
                
                # Generate a unique key for this connection based on endpoints
                # A connection is identified by its source and destination endpoints
                connection_key = self._get_connection_key(source_data, dest_data)
                
                # Only add if we haven't seen this exact connection before
                if connection_key not in seen_connections:
                    seen_connections.add(connection_key)
                    self.connections.append(connection)
                # Skip duplicate connections silently
                
                # Track node types (only add non-empty values)
                source_node_type = source_data.get("node_type")
                dest_node_type = dest_data.get("node_type")
                if source_node_type:
                    node_types_seen.add(source_node_type)
                if dest_node_type:
                    node_types_seen.add(dest_node_type)
                
                # Track location information based on format
                if self.file_format == "hierarchical":
                    self._track_hierarchical_location(source_data, dest_data)
                elif self.file_format == "hostname_based":
                    self._track_hostname_location(source_data, dest_data)
            
            # Create dynamic configurations for unknown node types
            for node_type in node_types_seen:
                if node_type:
                    # Normalize node type before checking (in case it wasn't normalized earlier)
                    normalized_type = self.normalize_node_type(node_type)
                    if normalized_type not in self.shelf_unit_configs:
                        self.analyze_and_create_dynamic_config(normalized_type, self.connections)
            
            # Set default shelf unit type
            # Prefer the most common node type from shelf_units if available (for hostname-based format)
            if not self.shelf_unit_type:
                if self.shelf_units:
                    # Use the most common node type from shelf_units
                    node_type_counts = Counter(self.shelf_units.values())
                    if node_type_counts:
                        self.shelf_unit_type = node_type_counts.most_common(1)[0][0]
                elif node_types_seen:
                    # Fall back to first node type seen
                    self.shelf_unit_type = list(node_types_seen)[0]
                else:
                    self.shelf_unit_type = "WH_GALAXY"
            
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
            if field_positions["node_type"] < len(row_values):
                node_type_value = row_values[field_positions["node_type"]].strip() if row_values[field_positions["node_type"]] else ""
                # Only normalize if the value is non-empty, otherwise leave it unset (will default later if needed)
                if node_type_value:
                    data["node_type"] = self.normalize_node_type(node_type_value)
                # If empty, don't set node_type - let it default to shelf_unit_type when creating nodes
            # If field position is out of bounds, don't set node_type
        
        # Generate label if not provided
        if not data.get("label"):
            if "rack_num" in data and "shelf_u" in data:
                data["label"] = f"{data['rack_num']}{data['shelf_u']}-{data.get('tray', 1)}-{data.get('port', 1)}"
            elif "hostname" in data:
                data["label"] = f"{data['hostname']}-{data.get('tray', 1)}-{data.get('port', 1)}"
            else:
                data["label"] = f"{end_type}-{data.get('tray', 1)}-{data.get('port', 1)}"
        
        return data

    def _get_connection_key(self, source_data, dest_data):
        """
        Generate a unique key for a connection based on its endpoints.
        Two connections with the same source and destination endpoints are considered duplicates.
        Returns a tuple that can be used as a set key.
        """
        def get_endpoint_key(endpoint_data):
            """Generate a key for a single endpoint"""
            # Include all identifying fields for the endpoint
            # Order: hostname, hall, aisle, rack_num, shelf_u, tray, port
            return (
                endpoint_data.get("hostname", ""),
                endpoint_data.get("hall", ""),
                endpoint_data.get("aisle", ""),
                endpoint_data.get("rack_num", ""),
                endpoint_data.get("shelf_u", ""),
                endpoint_data.get("tray", ""),
                endpoint_data.get("port", "")
            )
        
        source_key = get_endpoint_key(source_data)
        dest_key = get_endpoint_key(dest_data)
        
        # Create a normalized key (source, dest) and (dest, source) should be considered the same
        # So we always put the "smaller" endpoint first for consistency
        if source_key < dest_key:
            return (source_key, dest_key)
        else:
            return (dest_key, source_key)

    def _track_hierarchical_location(self, source_data, dest_data):
        """Track location information for hierarchical format"""
        # Track rack units for layout using composite key (hall, aisle, rack_num)
        if "rack_num" in source_data and "shelf_u" in source_data:
            hall = source_data.get("hall", "")
            aisle = source_data.get("aisle", "")
            rack_key = (hall, aisle, source_data["rack_num"])
            self.rack_units.setdefault(rack_key, set()).add(source_data["shelf_u"])
        if "rack_num" in dest_data and "shelf_u" in dest_data:
            hall = dest_data.get("hall", "")
            aisle = dest_data.get("aisle", "")
            rack_key = (hall, aisle, dest_data["rack_num"])
            self.rack_units.setdefault(rack_key, set()).add(dest_data["shelf_u"])
        
        # Track node types for each shelf unit using composite key (hall, aisle, rack, shelf_u)
        if "rack_num" in source_data and "shelf_u" in source_data:
            hall = source_data.get("hall", "")
            aisle = source_data.get("aisle", "")
            shelf_key = f"{hall}_{aisle}_{source_data['rack_num']}_{source_data['shelf_u']}"
            node_type = source_data.get("node_type", "WH_GALAXY")
            self.mixed_node_types[shelf_key] = self.normalize_node_type(node_type)
            self.node_locations[shelf_key] = {
                "hostname": source_data.get("hostname", ""),
                "hall": hall,
                "aisle": aisle,
                "rack_num": source_data["rack_num"],
                "shelf_u": source_data["shelf_u"],
            }
        
        if "rack_num" in dest_data and "shelf_u" in dest_data:
            hall = dest_data.get("hall", "")
            aisle = dest_data.get("aisle", "")
            shelf_key = f"{hall}_{aisle}_{dest_data['rack_num']}_{dest_data['shelf_u']}"
            node_type = dest_data.get("node_type", "WH_GALAXY")
            self.mixed_node_types[shelf_key] = self.normalize_node_type(node_type)
            self.node_locations[shelf_key] = {
                "hostname": dest_data.get("hostname", ""),
                "hall": hall,
                "aisle": aisle,
                "rack_num": dest_data["rack_num"],
                "shelf_u": dest_data["shelf_u"],
            }

    def _track_hostname_location(self, source_data, dest_data):
        """Track location information for hostname-based format"""
        if "hostname" in source_data and source_data.get("hostname"):
            hostname = source_data["hostname"]
            # Validate hostname uniqueness
            if hostname in self.seen_hostnames:
                raise ValueError(
                    f"Duplicate hostname '{hostname}' found in CSV data. "
                    f"Hostnames must be unique across all shelves. "
                    f"Duplicate found in source data: {source_data}"
                )
            self.seen_hostnames.add(hostname)
            
            # Only set node_type if it's actually present in the CSV data
            # If not present, it will use shelf_unit_type when creating the shelf
            node_type = source_data.get("node_type")
            if node_type:
                self.shelf_units[hostname] = self.normalize_node_type(node_type)
        if "hostname" in dest_data and dest_data.get("hostname"):
            hostname = dest_data["hostname"]
            # Validate hostname uniqueness
            if hostname in self.seen_hostnames:
                raise ValueError(
                    f"Duplicate hostname '{hostname}' found in CSV data. "
                    f"Hostnames must be unique across all shelves. "
                    f"Duplicate found in destination data: {dest_data}"
                )
            self.seen_hostnames.add(hostname)
            
            # Only set node_type if it's actually present in the CSV data
            # If not present, it will use shelf_unit_type when creating the shelf
            node_type = dest_data.get("node_type")
            if node_type:
                self.shelf_units[hostname] = self.normalize_node_type(node_type)

    def generate_node_id(self, node_type, *args):
        """Generate consistent node IDs for cytoscape elements
        
        For cabling descriptor imports, uses clean numeric-based IDs:
        - Shelf: "{host_id}" (e.g., "0", "1", "2")
        - Tray: "{host_id}:t{tray_num}" (e.g., "0:t1", "0:t2")
        - Port: "{host_id}:t{tray_num}:p{port_num}" (e.g., "0:t1:p3")
        
        This creates a clean hierarchy that's easy to parse and debug.
        """
        if node_type == "port" and len(args) >= 3:
            # Format: <shelf_id>:t<tray_num>:p<port_num>
            # Example: "0:t1:p3" means host_id=0, tray 1, port 3
            return f"{args[0]}:t{args[1]}:p{args[2]}"
        elif node_type == "tray" and len(args) >= 2:
            # Format: <shelf_id>:t<tray_num>
            # Example: "0:t1" means host_id=0, tray 1
            return f"{args[0]}:t{args[1]}"
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
        
        Note: Initial positions are calculated server-side, then refined client-side in JavaScript.
        See calculateHierarchicalLayout() and applyLocationBasedLayout() in visualizer.js.
        
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
        """Get all child positions for a parent element using templates
        
        Note: Initial positions are calculated server-side, then refined client-side in JavaScript.
        """
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
        """Create a cytoscape node using element template
        
        NOTE: Position calculation is now handled client-side in JavaScript.
        The x, y parameters are kept for API compatibility but positions are no longer set here.
        JavaScript will calculate all positions using hierarchy_calculateLayout() or location_calculateLayout().
        
        STRUCTURE CONSISTENCY: All shelf nodes (and other node types) have consistent structure across
        modes - they include data fields (type, label, parent, custom fields) and CSS classes from
        the template. The only difference between modes is which data fields are populated (e.g.,
        hall/aisle/rack vs logical_path).
        """
        template = self.element_templates[node_type]

        node_data = {"id": node_id, "label": label, "type": node_type, **extra_data}

        # Add parent relationship if specified
        if parent_id:
            node_data["parent"] = parent_id
        
        # Build node structure WITHOUT position
        # JavaScript will calculate positions client-side for consistent layout
        node = {
            "data": node_data,
            "classes": template["style_class"],
        }
        
        # NOTE: Position calculation removed - now handled in JavaScript
        # This ensures single source of truth for layout and consistent appearance across modes

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
        
        Uses a top-down traversal starting from root_instance to ensure parents
        are always created before their children.
        """
        if not self.graph_hierarchy:
            self._log_warning("No graph hierarchy to visualize")
            return
        
        if not self.cluster_descriptor or not self.cluster_descriptor.root_instance:
            self._log_warning("No root_instance found in cluster descriptor")
            return
        
        # Collect all graph paths by traversing from root_instance
        # This ensures proper parent-child ordering
        graph_paths = []
        self._collect_graph_paths_from_root(
            self.cluster_descriptor.root_instance,
            [],
            graph_paths
        )
        
        # Enumerate instances: Convert instance names to {template_name}_{index} format
        # Track instances by template at each parent level for proper enumeration
        self._instance_name_map = {}  # Maps (parent_path, original_name) -> enumerated_name
        self._normalize_instance_names([tuple(p) for p in graph_paths])
        
        # Enumerate nodes: Convert node names to node_0, node_1, etc. per parent
        self._node_name_map = {}  # Maps (parent_path, original_child_name) -> normalized_name
        self._normalize_node_names()
        
        # Create Graph Instance compound visual elements
        # Process in the order collected (parent before children)
        graph_node_map = {}  # path tuple -> Cytoscape visual element ID
        
        for i, graph_path in enumerate(graph_paths):
            self._create_graph_compound_node(graph_path, graph_node_map)
        
        # Create Host Device visual elements (leaf devices with host_ids)
        for device_info in self.graph_hierarchy:
            self._create_node_instance(device_info, graph_node_map)
    
    def _collect_graph_paths_from_root(self, instance, current_path, collected_paths):
        """Recursively collect graph paths by traversing from root_instance
        
        This ensures paths are collected in parent-first order, guaranteeing
        that when we create nodes, parents always exist before children.
        
        IMPORTANT: Processes children in template.children order (not child_mappings order)
        to ensure consistent ordering that matches template definition.
        
        Args:
            instance: Current GraphInstance from the descriptor
            current_path: List representing the path to this instance
            collected_paths: List to accumulate all paths in order
        """
        # Add current path (root is empty list)
        collected_paths.append(list(current_path))
        
        # Get template name for this instance
        template_name = None
        if hasattr(instance, 'template_name'):
            template_name = instance.template_name
        
        # Process children in template order (if template available)
        if template_name and template_name in self.cluster_descriptor.graph_templates:
            template = self.cluster_descriptor.graph_templates[template_name]
            child_mappings_dict = dict(instance.child_mappings) if hasattr(instance, 'child_mappings') else {}
            
            # Process children in template.children order
            for child_instance in template.children:
                child_name = child_instance.name
                
                # Only process graph children (not leaf nodes)
                if child_instance.HasField('graph_ref') and child_name in child_mappings_dict:
                    child_mapping = child_mappings_dict[child_name]
                    
                    if child_mapping.HasField('sub_instance'):
                        child_graph_instance = child_mapping.sub_instance
                        
                        # Build child path
                        child_path = current_path + [child_name]
                        
                        # Recursively collect from this child
                        self._collect_graph_paths_from_root(
                            child_graph_instance,
                            child_path,
                            collected_paths
                        )
        else:
            # Fallback: process in child_mappings order if no template available
            if hasattr(instance, 'child_mappings'):
                for child_name, child_mapping in instance.child_mappings.items():
                    # Check if this is a sub-graph (not a leaf node)
                    if child_mapping.HasField('sub_instance'):
                        child_instance = child_mapping.sub_instance
                        
                        # Build child path
                        child_path = current_path + [child_name]
                        
                        # Recursively collect from this child
                        self._collect_graph_paths_from_root(
                            child_instance,
                            child_path,
                            collected_paths
                        )
    
    def _normalize_instance_names(self, sorted_graph_paths):
        """Normalize instance names to {template_name}_{index} format
        
        Converts arbitrary instance names from the descriptor to enumerated format.
        For example: "superpod1", "superpod2" -> "n300_lb_superpod_0", "n300_lb_superpod_1"
        
        Args:
            sorted_graph_paths: List of graph path tuples, sorted by depth
        """
        # Group instances by (parent_path, template_name) to enumerate them
        instances_by_parent_and_template = {}
        
        for graph_path_tuple in sorted_graph_paths:
            if len(graph_path_tuple) == 0:
                # Root node - no enumeration needed
                continue
            
            # Get template for this path
            template_name = None
            if self._hierarchy_resolver:
                template_name = self._hierarchy_resolver.get_template_for_path(list(graph_path_tuple))
            
            if not template_name:
                continue
            
            # Determine parent path
            parent_path_tuple = graph_path_tuple[:-1] if len(graph_path_tuple) > 1 else ()
            original_name = graph_path_tuple[-1]
            
            # Group by (parent, template)
            key = (parent_path_tuple, template_name)
            if key not in instances_by_parent_and_template:
                instances_by_parent_and_template[key] = []
            instances_by_parent_and_template[key].append((graph_path_tuple, original_name))
        
        # Enumerate instances within each group
        for (parent_path, template_name), instances in instances_by_parent_and_template.items():
            for index, (graph_path_tuple, original_name) in enumerate(instances):
                enumerated_name = f"{template_name}_{index}"
                self._instance_name_map[(parent_path, original_name)] = enumerated_name
    
    def _normalize_node_names(self):
        """Normalize node names to node_0, node_1, etc. per parent
        
        Groups nodes by their parent path and enumerates them sequentially.
        For example: "node1", "node2", "node3" -> "node_0", "node_1", "node_2"
        
        IMPORTANT: Preserves template.children order (not alphabetical order) to ensure
        consistent numbering that matches template definition. This ensures that nodes
        are numbered in the same order they appear in the template, regardless of
        their original names.
        """
        # Group nodes by parent path
        nodes_by_parent = {}
        for device_info in self.graph_hierarchy:
            path = device_info['path']
            parent_path = tuple(path[:-1])  # All but the last element
            original_child_name = device_info['child_name']
            
            if parent_path not in nodes_by_parent:
                nodes_by_parent[parent_path] = []
            nodes_by_parent[parent_path].append((device_info, original_child_name))
        
        # Enumerate nodes within each parent
        for parent_path, nodes in nodes_by_parent.items():
            # Get template for parent to preserve template.children order
            parent_template_name = None
            if self._hierarchy_resolver:
                parent_template_name = self._hierarchy_resolver.get_template_for_path(list(parent_path))
            
            if parent_template_name and parent_template_name in self.cluster_descriptor.graph_templates:
                # Use template.children order
                template = self.cluster_descriptor.graph_templates[parent_template_name]
                nodes_by_name = {name: (dev, name) for dev, name in nodes}
                ordered_nodes = []
                
                # Process in template.children order
                for child_instance in template.children:
                    child_name = child_instance.name
                    if child_name in nodes_by_name:
                        ordered_nodes.append(nodes_by_name[child_name])
                
                # Add any nodes not found in template (shouldn't happen, but handle gracefully)
                for dev, name in nodes:
                    if name not in {n[1] for n in ordered_nodes}:
                        ordered_nodes.append((dev, name))
                
                nodes = ordered_nodes
            else:
                # Fallback: sort alphabetically if no template available
                # Note: This will fail for "node10" < "node2" alphabetically
                nodes.sort(key=lambda x: x[1])  # Sort by original child name
            
            for index, (device_info, original_child_name) in enumerate(nodes):
                normalized_name = f"node_{index}"
                self._node_name_map[(parent_path, original_child_name)] = normalized_name
                # Update the device_info in place
                device_info['child_name'] = normalized_name
    
    def _get_enumerated_name(self, graph_path):
        """Get the enumerated name for a graph path
        
        Args:
            graph_path: List of path elements
            
        Returns:
            Enumerated name if found, otherwise original name
        """
        if len(graph_path) == 0:
            return None  # Root has no enumerated name
        
        parent_path = tuple(graph_path[:-1])
        original_name = graph_path[-1]
        
        return self._instance_name_map.get((parent_path, original_name), original_name)
    
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
        
        # Generate node ID and label using enumerated names
        # Handle root cluster (empty path)
        if len(graph_path) == 0:
            # Root instance - derive ID and label from root_instance.template_name
            root_template_name = None
            if self.cluster_descriptor and self.cluster_descriptor.root_instance:
                root_template_name = self.cluster_descriptor.root_instance.template_name
            
            # Use consistent ID format: graph_ prefix for all graph nodes
            graph_id = "graph_root"
            graph_label = root_template_name if root_template_name else 'cluster'
            
            # Store template name for export
            template_name = root_template_name
            child_name = None  # Root has no child_name
        else:
            # Use enumerated name for label
            enumerated_name = self._get_enumerated_name(graph_path)
            graph_id = "graph_" + "_".join(graph_path)  # Keep original path for ID
            graph_label = enumerated_name  # Use enumerated name for label
        
        # Determine parent (depth-0 is root with no parent, depth-1 are children of root)
        parent_id = None
        if len(graph_path) > 0:
            if len(graph_path) == 1:
                # Top-level nodes (superpods) are children of root
                parent_path_tuple = ()
                parent_id = graph_node_map.get(parent_path_tuple)
            else:
                # Nested nodes have their parent in the hierarchy
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
                    parent_found = True
                    # Extract position if it exists
                    if 'position' in node:
                        parent_x = node['position']['x']
                        parent_y = node['position']['y']
                    break
            if not parent_found and parent_id:
                self._log_warning(f"Parent {parent_id} not found for graph {graph_path}, using (0,0)")
                self._log_warning(f"  Current nodes in self.nodes: {[n['data']['id'] for n in self.nodes if n['data'].get('type') == 'graph']}")
        
        # Count siblings at same depth with same parent
        # Siblings are nodes at the same depth with the same parent path
        if len(graph_path) == 0:
            # Root node has no siblings
            index = 0
        elif len(graph_path) == 1:
            # Top-level graphs (superpods) are children of root, count them
            siblings = [p for p in graph_node_map.keys() if len(p) == 1]
            index = len(siblings)
        else:
            # For nested graphs, siblings share the same parent path
            parent_path_tuple = tuple(graph_path[:-1])
            siblings = [p for p in graph_node_map.keys() 
                       if len(p) == len(graph_path) and p[:-1] == parent_path_tuple]
            index = len(siblings)
        
        # Use calculate_position_in_sequence with parent position for relative positioning
        # This ensures nested graphs are positioned relative to their parent
        x, y = self.calculate_position_in_sequence("graph", index, parent_x=parent_x, parent_y=parent_y, depth=depth)
        
        # Get template name for this graph path
        template_name = None
        if self._hierarchy_resolver:
            template_name = self._hierarchy_resolver.get_template_for_path(graph_path)
        
        # Create graph compound node with calculated position to prevent overlaps
        # For non-root graphs, use the enumerated name as child_name
        child_name = self._get_enumerated_name(graph_path) if len(graph_path) > 0 else None
        
        
        graph_node = self.create_node_from_template(
            "graph",
            graph_id,
            parent_id,
            graph_label,
            x,  # Use calculated position
            y,  # Use calculated position
            graph_path=graph_path,
            depth=depth,
            template_name=template_name,  # Add template name to node data
            child_name=child_name  # Add enumerated child_name for export consistency
        )
        
        # Add to nodes list and map BEFORE processing any children
        self.nodes.append(graph_node)
        graph_node_map[graph_path_tuple] = graph_id
        
    
    def _create_node_instance(self, node_info, graph_node_map):
        """Create a shelf (host device) directly under its parent graph
        
        In hierarchical descriptors, each host device is represented as a shelf node
        that is directly contained by a graph node (e.g., superpod). The shelf IS the 
        physical host - it contains trays and ports but there's no intermediate wrapper.
        
        Structure: Graph (superpod) → Shelf (host_5) → Tray → Port
        
        **CRITICAL: host_index is REQUIRED** - All shelf nodes must have a unique host_index.
        This function uses host_id from node_info as the host_index.
        The host_index is the primary numeric identifier for programmatic access and descriptor mapping.
        
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
            # Nested hierarchy: parent is the containing graph
            parent_path_tuple = tuple(path[:-1])
            parent_id = graph_node_map.get(parent_path_tuple)
        elif len(path) == 1:
            # Flat topology: shelves are direct children of root graph
            parent_id = graph_node_map.get(())
        
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
        
        # Build logical_path using enumerated instance names (e.g., ["n300_lb_cluster_0", "n300_lb_superpod_0"])
        # This uses the existing {template_name}_{index} format from _normalize_instance_names()
        logical_path = []
        for i in range(len(path) - 1):  # Exclude the leaf node itself
            parent_graph_path = path[:i+1]
            enumerated_name = self._get_enumerated_name(parent_graph_path)
            if enumerated_name:
                logical_path.append(enumerated_name)
        
        # Create shelf directly under graph (shelf = host device)
        # Use host_id directly as the ID - it's globally unique and matches deployment descriptor indexing
        # This creates IDs like "0", "1", "2" instead of "shelf_0", "shelf_1", "shelf_2"
        shelf_id = str(host_id)
        shelf_label = f"{child_name} (host_{host_id})"
        
        # IMPORTANT: Cabling descriptor is LOGICAL ONLY - it should NOT set hostname
        # Hostname is a physical/deployment property that comes from deployment descriptor
        # For now, leave hostname empty - it will be populated when deployment descriptor is applied
        
        # CRITICAL: host_index is REQUIRED - must be set at creation time
        # This is the primary numeric identifier for programmatic access and descriptor mapping
        shelf_node = self.create_node_from_template(
            "shelf",
            shelf_id,
            parent_id,
            shelf_label,
            x,
            y,
            host_index=host_id,  # REQUIRED: Globally unique numeric index (LOGICAL identifier)
            shelf_node_type=node_type,  # Store as shelf_node_type (standard field)
            node_descriptor_type=node_type,  # Keep for compatibility
            child_name=child_name,
            hostname="",  # Empty - hostname is a PHYSICAL property from deployment descriptor
            # Logical topology fields for descriptor imports
            logical_path=logical_path,  # Array of enumerated instance names
            is_synthetic_root_child=False  # These nodes have proper logical topology
        )
        
        self.nodes.append(shelf_node)
        
        # Create tray/port structure for this shelf (host)
        # Note: hostname is empty for cabling descriptor imports (deployment property)
        self._create_trays_and_ports(
            shelf_id,
            node_config,
            x,
            y,
            None,  # rack_num
            None,  # shelf_u
            node_type,  # shelf_node_type
            "",  # hostname (empty - physical/deployment property, not from cabling descriptor)
            host_id,  # host_id
            child_name  # node_name
        )
        
        # Extract and create edges for internal connections from NodeDescriptor
        # This handles variations like DEFAULT (QSFP connections), X_TORUS, Y_TORUS, XY_TORUS
        self._create_node_descriptor_internal_connections(shelf_id, node_type, host_id)
    
    def _create_rack_hierarchy(self):
        """Create conditional hierarchy nodes (halls -> aisles -> racks -> shelves -> trays -> ports)
        
        Only creates hierarchy levels when there are multiple instances:
        - Hall level: Only shown if multiple halls exist
        - Aisle level: Only shown if multiple aisles exist (across all halls)
        - Rack level: Always shown
        
        **CRITICAL: host_index is REQUIRED** - All shelf nodes must have a unique host_index.
        This function assigns sequential host_index values starting from 0.
        The host_index is the primary numeric identifier for programmatic access and descriptor mapping.
        """
        # Track global host index for all shelves
        # CRITICAL: host_index is REQUIRED - must be unique and sequential
        host_index_counter = 0
        
        # Build a mapping from hostname to host_index for port ID generation
        self.hostname_to_host_index = {}
        
        # Organize racks by hall and aisle
        # rack_units keys are now tuples: (hall, aisle, rack_num)
        hall_aisle_racks = {}  # {hall: {aisle: [rack_nums]}}
        
        for rack_key in self.rack_units.keys():
            hall, aisle, rack_num = rack_key
            
            if hall not in hall_aisle_racks:
                hall_aisle_racks[hall] = {}
            if aisle not in hall_aisle_racks[hall]:
                hall_aisle_racks[hall][aisle] = []
            hall_aisle_racks[hall][aisle].append(rack_num)
        
        # Sort halls and aisles for consistent ordering
        sorted_halls = sorted(hall_aisle_racks.keys())
        
        # Determine which hierarchy levels to show
        num_halls = len(sorted_halls)
        # Count total unique aisles across all halls
        all_aisles = set()
        for hall in hall_aisle_racks:
            all_aisles.update(hall_aisle_racks[hall].keys())
        num_aisles = len(all_aisles)
        
        show_hall_level = num_halls > 1
        show_aisle_level = num_aisles > 1
        
        # Process all halls
        for hall_idx, hall in enumerate(sorted_halls):
            # Conditionally create hall compound node
            hall_id = None
            if show_hall_level:
                hall_x, hall_y = self.calculate_position_in_sequence("hall", hall_idx)
                hall_id = self.generate_node_id("hall", hall)
                hall_node = self.create_node_from_template(
                    "hall", hall_id, None, f"Hall {hall}", hall_x, hall_y, hall=hall
                )
                self.nodes.append(hall_node)
                base_x, base_y = hall_x, hall_y
            else:
                # No hall level - aisles/racks will be top-level
                base_x, base_y = 0, 0
            
            # Get sorted aisles for this hall
            sorted_aisles = sorted(hall_aisle_racks[hall].keys())
            
            # Process all aisles in this hall
            for aisle_idx, aisle in enumerate(sorted_aisles):
                # Conditionally create aisle compound node
                aisle_id = None
                if show_aisle_level:
                    aisle_x, aisle_y = self.calculate_position_in_sequence("aisle", aisle_idx)
                    aisle_x += base_x
                    aisle_y += base_y
                    aisle_id = self.generate_node_id("aisle", hall, aisle)
                    aisle_parent = hall_id if show_hall_level else None
                    aisle_node = self.create_node_from_template(
                        "aisle", aisle_id, aisle_parent, f"Aisle {aisle}", aisle_x, aisle_y, hall=hall, aisle=aisle
                    )
                    self.nodes.append(aisle_node)
                    rack_base_x, rack_base_y = aisle_x, aisle_y
                else:
                    # No aisle level - racks will be children of hall (or top-level if no hall)
                    rack_base_x, rack_base_y = base_x, base_y
                
                # Get sorted racks for this aisle (right to left ordering)
                rack_numbers = sorted(hall_aisle_racks[hall][aisle], reverse=True)
                
                # Create rack nodes
                for rack_idx, rack_num in enumerate(rack_numbers):
                    rack_x, rack_y = self.calculate_position_in_sequence("rack", rack_idx)
                    rack_x += rack_base_x
                    rack_y += rack_base_y
                    
                    # Get shelf units for this rack using composite key
                    rack_key = (hall, aisle, rack_num)
                    shelf_units = sorted(self.rack_units[rack_key], reverse=True)
                    
                    # Determine rack parent based on what levels are shown
                    if show_aisle_level:
                        rack_parent = aisle_id
                    elif show_hall_level:
                        rack_parent = hall_id
                    else:
                        rack_parent = None
                    
                    # Create rack node with location info
                    # Use composite ID to ensure uniqueness across aisles: rack_hall_aisle_racknum
                    rack_id = self.generate_node_id("rack", hall, aisle, rack_num)
                    rack_node = self.create_node_from_template(
                        "rack", rack_id, rack_parent, f"Rack {rack_num}", rack_x, rack_y, rack_num=rack_num, hall=hall, aisle=aisle
                    )
                    self.nodes.append(rack_node)
                    
                    # Calculate shelf positions
                    shelf_positions = self.get_child_positions_for_parent("rack", shelf_units, rack_x, rack_y)

                    for shelf_u, shelf_x, shelf_y in shelf_positions:
                        # Get the node type and location info for this specific shelf using composite key
                        shelf_key = f"{hall}_{aisle}_{rack_num}_{shelf_u}"
                        shelf_node_type = self.mixed_node_types.get(shelf_key, self.shelf_unit_type)
                        shelf_config = self.shelf_unit_configs.get(shelf_node_type, self.current_config)
                        location_info = self.node_locations.get(shelf_key, {})
                        hostname = location_info.get("hostname", "")
                        
                        # Generate synthetic hostname from location if not provided
                        # This ensures deployment descriptor export works even without explicit hostnames
                        if not hostname or not hostname.strip():
                            # Format: {Hall}{Aisle}{Rack:02d}U{ShelfU:02d} (e.g., "120B02U02")
                            # Ensure rack_num and shelf_u are integers for formatting
                            hostname = f"{hall}{aisle}{int(rack_num):02d}U{int(shelf_u):02d}"
                            # Update location_info with generated hostname for consistency
                            location_info["hostname"] = hostname
                            # Also update node_locations dict so connections can find the hostname
                            if shelf_key in self.node_locations:
                                self.node_locations[shelf_key]["hostname"] = hostname

                        # Create shelf node with host_index as ID (for consistent numeric IDs)
                        # Use host_index for shelf_id to match cabling descriptor format
                        shelf_id = str(host_index_counter)  # Use numeric index as ID (e.g., "0", "1", "2")
                        
                        # Build mapping from hostname to host_index for port ID generation
                        if hostname:
                            # Validate hostname uniqueness
                            if hostname in self.hostname_to_host_index:
                                existing_location = self._get_shelf_location_by_hostname(hostname)
                                current_location = f"Hall {hall}, Aisle {aisle}, Rack {rack_num}, Shelf {shelf_u}"
                                raise ValueError(
                                    f"Duplicate hostname '{hostname}' found. "
                                    f"Hostnames must be unique across all shelves.\n"
                                    f"  Existing location: {existing_location}\n"
                                    f"  Duplicate location: {current_location}"
                                )
                            self.hostname_to_host_index[hostname] = host_index_counter
                        
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
                            host_index=host_index_counter,  # Assign sequential global index
                            hall=location_info.get("hall", hall),  # Use actual hall if not in location_info
                            aisle=location_info.get("aisle", aisle),  # Use actual aisle if not in location_info
                            # Logical topology fields for CSV imports (no logical topology)
                            logical_path=[],  # Empty - no logical topology from CSV
                            is_synthetic_root_child=True  # CSV imports have no logical topology
                        )
                        self.nodes.append(shelf_node)

                        # Update connections to include the generated hostname
                        # This ensures _generate_port_ids can find the hostname when creating edges
                        self._update_connections_with_hostname(hall, aisle, rack_num, shelf_u, hostname)
                        
                        # Create trays and ports (use numeric shelf_id)
                        self._create_trays_and_ports(shelf_id, shelf_config, shelf_x, shelf_y, rack_num, shelf_u, shelf_node_type, hostname, host_id=host_index_counter)
                        host_index_counter += 1

    def _get_shelf_location_by_hostname(self, hostname):
        """Get location information for a shelf by hostname for error messages.
        
        Args:
            hostname: The hostname to look up
            
        Returns:
            String describing the location, or "Unknown location" if not found
        """
        # Search through node_locations for matching hostname
        for shelf_key, location_info in self.node_locations.items():
            if location_info.get("hostname") == hostname:
                hall = location_info.get("hall", "")
                aisle = location_info.get("aisle", "")
                rack_num = location_info.get("rack_num", "")
                shelf_u = location_info.get("shelf_u", "")
                return f"Hall {hall}, Aisle {aisle}, Rack {rack_num}, Shelf {shelf_u}"
        
        # If not found in node_locations, check if we can infer from hostname_to_host_index
        # This is a fallback - we don't have location info stored there
        if hostname in self.hostname_to_host_index:
            return f"Host index {self.hostname_to_host_index[hostname]}"
        
        return "Unknown location"
    
    def _update_connections_with_hostname(self, hall, aisle, rack_num, shelf_u, hostname):
        """Update connections to include hostname for matching location.
        
        This is crucial for edge creation - _generate_port_ids needs the hostname
        to generate correct port IDs that match the created port nodes.
        """
        for connection in self.connections:
            # Update source if it matches this location
            src = connection.get("source", {})
            if (src.get("hall") == hall and 
                src.get("aisle") == aisle and 
                str(src.get("rack_num")) == str(rack_num) and 
                str(src.get("shelf_u")) == str(shelf_u)):
                connection["source"]["hostname"] = hostname
            
            # Update destination if it matches this location
            dst = connection.get("destination", {})
            if (dst.get("hall") == hall and 
                dst.get("aisle") == aisle and 
                str(dst.get("rack_num")) == str(rack_num) and 
                str(dst.get("shelf_u")) == str(shelf_u)):
                connection["destination"]["hostname"] = hostname
    
    def _create_shelf_hierarchy(self):
        """Create shelf-only hierarchy nodes (shelves -> trays -> ports)"""
        # Build a mapping from hostname to host_index for port ID generation
        self.hostname_to_host_index = {}
        
        # Get sorted hostnames for consistent ordering
        hostnames = sorted(self.shelf_units.keys())
        
        # Validate hostname uniqueness (check for duplicates in original data)
        # Note: self.shelf_units is a dict, so duplicate keys would have been overwritten
        # But we should still validate that all provided hostnames are unique
        seen_hostnames = set()
        duplicate_hostnames = []
        for hostname in hostnames:
            if hostname in seen_hostnames:
                duplicate_hostnames.append(hostname)
            seen_hostnames.add(hostname)
        
        if duplicate_hostnames:
            raise ValueError(
                f"Duplicate hostnames found in CSV data. Hostnames must be unique across all shelves.\n"
                f"  Duplicate hostnames: {', '.join(set(duplicate_hostnames))}"
            )

        # Calculate shelf positions using template
        shelf_positions = []
        for shelf_idx, hostname in enumerate(hostnames):
            shelf_x, shelf_y = self.calculate_position_in_sequence("shelf", shelf_idx)
            shelf_positions.append((hostname, shelf_x, shelf_y))
            # Map hostname to host_index for port ID generation
            self.hostname_to_host_index[hostname] = shelf_idx

        # Create all nodes using template-based approach (no racks)
        for shelf_idx, (hostname, shelf_x, shelf_y) in enumerate(shelf_positions):
            # Get the node type for this specific shelf
            shelf_node_type = self.shelf_units.get(hostname, self.shelf_unit_type)
            # Ensure node type is normalized before config lookup
            shelf_node_type = self.normalize_node_type(shelf_node_type)
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
                host_index=shelf_idx,  # Assign sequential index for CSV imports
                shelf_node_type=shelf_node_type,
                # Logical topology fields for CSV imports (no logical topology)
                logical_path=[],  # Empty - no logical topology from CSV
                is_synthetic_root_child=True  # CSV imports have no logical topology
            )
            self.nodes.append(shelf_node)

            # Create trays and ports
            self._create_trays_and_ports(shelf_id, shelf_config, shelf_x, shelf_y, None, None, shelf_node_type, hostname, host_id=shelf_idx)

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
                tray_data["host_index"] = host_id  # Globally unique index
            if node_name is not None:
                tray_data["node_name"] = node_name
            
            # Use numeric host_id for ID generation if available (for consistency with edge generation)
            # Otherwise use shelf_id (for descriptor format where host_id might not be set)
            tray_shelf_id = str(host_id) if host_id is not None else shelf_id
            tray_node_id = self.generate_node_id("tray", tray_shelf_id, tray_id)
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
                    port_data["host_index"] = host_id  # Globally unique index
                if node_name is not None:
                    port_data["node_name"] = node_name
                
                # Use the same shelf_id format as tray for consistency
                # (tray_shelf_id is already calculated above: numeric host_id if available, else shelf_id)
                port_node_id = self.generate_node_id("port", tray_shelf_id, tray_id, port_id)
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
        
        # Start connection counter after any existing edges (e.g., internal connections)
        connection_counter = len(self.edges) + 1
        
        for conn in self.descriptor_connections:
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
            
            # Generate port node IDs using the clean numeric format
            # Shelf IDs are just the host_id (e.g., "0", "1", "2")
            src_shelf_id = str(src_host_id)
            dst_shelf_id = str(dst_host_id)
            src_port_id = self.generate_node_id("port", src_shelf_id, src_tray, src_port)
            dst_port_id = self.generate_node_id("port", dst_shelf_id, dst_tray, dst_port)
            
            # Get color based on depth
            depth = conn['depth']
            color = depth_colors.get(depth, "#999999")
            template_name = conn.get('template_name', f'level_{depth}')
            
            # Create edge data
            edge_data = {
                "data": {
                    "id": f"connection_{connection_counter}",
                    "source": src_port_id,
                    "target": dst_port_id,
                    "cable_type": conn['cable_type'],
                    "connection_number": connection_counter,
                    "color": color,
                    "depth": depth,
                    "template_name": template_name,  # Template where connection is defined
                    "containerTemplate": template_name,  # Also set containerTemplate for consistency with JS-created connections
                    "source_info": f"Host {src_host_id} ({src_node_name}) T{src_tray}P{src_port}",
                    "destination_info": f"Host {dst_host_id} ({dst_node_name}) T{dst_tray}P{dst_port}",
                    # Use template-relative child names (node1, node2) for template export compatibility
                    "source_hostname": src_node_name if src_node_name else f"host_{src_host_id}",
                    "destination_hostname": dst_node_name if dst_node_name else f"host_{dst_host_id}",
                },
                "classes": f"connection depth-{depth}",
            }
            
            self.edges.append(edge_data)
            connection_counter += 1

    def _create_node_descriptor_internal_connections(self, shelf_id, node_type, host_id):
        """Create edges for internal connections defined in a NodeDescriptor
        
        This handles variations like:
        - DEFAULT: Adds QSFP connections (e.g., N300_LB_DEFAULT, P150_QB_AE_DEFAULT)
        - X_TORUS, Y_TORUS, XY_TORUS: Adds torus QSFP connections (e.g., WH_GALAXY_X_TORUS)
        
        Args:
            shelf_id: The shelf node ID (e.g., "0", "1", "2")
            node_type: The node descriptor type (e.g., "N300_LB_DEFAULT", "WH_GALAXY_X_TORUS")
            host_id: The host ID (numeric)
        """
        # Get the NodeDescriptor from cluster_descriptor
        # NodeDescriptors should be defined in the cluster_descriptor when importing
        if not self.cluster_descriptor:
            return
        
        # Try exact match first (case-sensitive)
        node_descriptor = None
        if node_type in self.cluster_descriptor.node_descriptors:
            node_descriptor = self.cluster_descriptor.node_descriptors[node_type]
        else:
            # Try uppercase version (node_type might be stored in different case)
            node_type_upper = node_type.upper()
            if node_type_upper in self.cluster_descriptor.node_descriptors:
                node_descriptor = self.cluster_descriptor.node_descriptors[node_type_upper]
            else:
                # Try lowercase version
                node_type_lower = node_type.lower()
                if node_type_lower in self.cluster_descriptor.node_descriptors:
                    node_descriptor = self.cluster_descriptor.node_descriptors[node_type_lower]
        
        if not node_descriptor:
            # NodeDescriptor not found in cluster_descriptor.node_descriptors map
            # This can happen if the NodeDescriptor is referenced by name but not explicitly defined
            # In C++, find_node_descriptor() creates it using the factory function, but we can't do that in Python
            # However, we can still create internal connections based on known patterns from node.cpp
            node_type_upper = node_type.upper()
            internal_connections = self._get_internal_connections_from_node_type(node_type_upper)
            if internal_connections:
                # Create edges for the known internal connections
                self._create_internal_connection_edges(shelf_id, host_id, internal_connections)
            # Note: If no internal connections found, this is normal - it just means there are no variations
            # in the backend for this node type. No warning needed.
            return
        
        # Extract internal connections from port_type_connections
        # These are connections within the same shelf (same host_id for both ports)
        # Connections are defined as Tray,Port pairs in node.cpp:
        #   - Example: add_connection(qsfp_connections, 1, 1, 4, 1) 
        #     means Tray 1 Port 1 connects to Tray 4 Port 1
        #   - Example: add_connection(qsfp_connections, 1, 3, 2, 3)
        #     means Tray 1 Port 3 connects to Tray 2 Port 3 (X-torus)
        connection_counter = len(self.edges) + 1
        
        # Color for internal connections (different from inter-node connections)
        internal_connection_color = "#00AA00"  # Green for internal connections
        
        # Iterate through all port types (QSFP_DD, WARP100, WARP400, LINKING_BOARD_1, etc.)
        for port_type, port_connections in node_descriptor.port_type_connections.items():
            for conn in port_connections.connections:
                # Extract Tray,Port pairs from the connection
                # Both ports are on the same shelf (same host_id)
                tray_a = conn.port_a.tray_id  # Tray ID for port A (e.g., 1, 2, 3, 4)
                port_a = conn.port_a.port_id  # Port ID for port A (e.g., 1, 2, 3, 4, 5, 6)
                tray_b = conn.port_b.tray_id  # Tray ID for port B (e.g., 1, 2, 3, 4)
                port_b = conn.port_b.port_id  # Port ID for port B (e.g., 1, 2, 3, 4, 5, 6)
                
                # Generate port IDs within the same shelf using format: "{host_id}:t{tray}:p{port}"
                # Example: "0:t1:p1" for host 0, tray 1, port 1
                port_a_id = self.generate_node_id("port", shelf_id, tray_a, port_a)
                port_b_id = self.generate_node_id("port", shelf_id, tray_b, port_b)
                
                # Create edge data for internal connection
                edge_data = {
                    "data": {
                        "id": f"connection_{connection_counter}",
                        "source": port_a_id,
                        "target": port_b_id,
                        "cable_type": port_type,  # Use the port type as cable type (QSFP_DD, WARP100, etc.)
                        "connection_number": connection_counter,
                        "color": internal_connection_color,
                        "depth": -1,  # Internal connections have depth -1 (within same shelf)
                        "template_name": None,  # Internal connections are not from templates
                        "source_info": f"Host {host_id} T{tray_a}P{port_a}",
                        "destination_info": f"Host {host_id} T{tray_b}P{port_b}",
                        "source_hostname": f"host_{host_id}",
                        "destination_hostname": f"host_{host_id}",
                        "is_internal": True,  # Flag to indicate this is an internal connection
                    },
                    "classes": "connection internal-connection",
                }
                
                self.edges.append(edge_data)
                connection_counter += 1

    def _get_internal_connections_from_node_type(self, node_type):
        """Get internal connections based on known node type patterns from node.cpp
        
        This is a fallback when NodeDescriptor is not in cluster_descriptor.node_descriptors.
        Returns a list of connection dicts with port_type, tray_a, port_a, tray_b, port_b.
        """
        node_type_upper = node_type.upper()
        connections = []
        
        # N300_LB_DEFAULT and N300_QB_DEFAULT: QSFP connections
        if node_type_upper in ['N300_LB_DEFAULT', 'N300_QB_DEFAULT']:
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 1, 'tray_b': 4, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 2, 'tray_b': 3, 'port_b': 2},
            ])
        
        # P150_QB_AE_DEFAULT: QSFP connections
        elif node_type_upper == 'P150_QB_AE_DEFAULT':
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 1, 'tray_b': 2, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 2, 'tray_b': 2, 'port_b': 2},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 3, 'tray_b': 4, 'port_b': 3},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 4, 'tray_b': 4, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 3, 'tray_b': 3, 'port_b': 3},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 4, 'tray_b': 3, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 1, 'tray_b': 4, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 2, 'tray_b': 4, 'port_b': 2},
            ])
        
        # WH_GALAXY_X_TORUS: X-torus QSFP connections
        elif node_type_upper == 'WH_GALAXY_X_TORUS':
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 3, 'tray_b': 2, 'port_b': 3},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 4, 'tray_b': 2, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 5, 'tray_b': 2, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 6, 'tray_b': 2, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 6, 'tray_b': 4, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 5, 'tray_b': 4, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 4, 'tray_b': 4, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 3, 'tray_b': 4, 'port_b': 3},
            ])
        
        # WH_GALAXY_Y_TORUS: Y-torus QSFP connections
        elif node_type_upper == 'WH_GALAXY_Y_TORUS':
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 2, 'tray_b': 3, 'port_b': 2},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 1, 'tray_b': 3, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 1, 'tray_b': 4, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 2, 'tray_b': 4, 'port_b': 2},
            ])
        
        # WH_GALAXY_XY_TORUS: Both X and Y torus QSFP connections
        elif node_type_upper == 'WH_GALAXY_XY_TORUS':
            # X-torus connections
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 3, 'tray_b': 2, 'port_b': 3},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 4, 'tray_b': 2, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 5, 'tray_b': 2, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 6, 'tray_b': 2, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 6, 'tray_b': 4, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 5, 'tray_b': 4, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 4, 'tray_b': 4, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 3, 'tray_b': 4, 'port_b': 3},
            ])
            # Y-torus connections
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 2, 'tray_b': 3, 'port_b': 2},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 1, 'tray_b': 3, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 1, 'tray_b': 4, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 2, 'tray_b': 4, 'port_b': 2},
            ])
        
        # BH_GALAXY_X_TORUS: X-torus QSFP connections
        elif node_type_upper == 'BH_GALAXY_X_TORUS':
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 3, 'tray_b': 3, 'port_b': 3},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 4, 'tray_b': 3, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 5, 'tray_b': 3, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 6, 'tray_b': 3, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 6, 'tray_b': 4, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 5, 'tray_b': 4, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 4, 'tray_b': 4, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 3, 'tray_b': 4, 'port_b': 3},
            ])
        
        # BH_GALAXY_Y_TORUS: Y-torus QSFP connections
        elif node_type_upper == 'BH_GALAXY_Y_TORUS':
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 2, 'tray_b': 2, 'port_b': 2},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 1, 'tray_b': 2, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 1, 'tray_b': 4, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 2, 'tray_b': 4, 'port_b': 2},
            ])
        
        # BH_GALAXY_XY_TORUS: Both X and Y torus QSFP connections
        elif node_type_upper == 'BH_GALAXY_XY_TORUS':
            # X-torus connections
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 3, 'tray_b': 3, 'port_b': 3},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 4, 'tray_b': 3, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 5, 'tray_b': 3, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 6, 'tray_b': 3, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 6, 'tray_b': 4, 'port_b': 6},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 5, 'tray_b': 4, 'port_b': 5},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 4, 'tray_b': 4, 'port_b': 4},
                {'port_type': 'QSFP_DD', 'tray_a': 2, 'port_a': 3, 'tray_b': 4, 'port_b': 3},
            ])
            # Y-torus connections
            connections.extend([
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 2, 'tray_b': 2, 'port_b': 2},
                {'port_type': 'QSFP_DD', 'tray_a': 1, 'port_a': 1, 'tray_b': 2, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 1, 'tray_b': 4, 'port_b': 1},
                {'port_type': 'QSFP_DD', 'tray_a': 3, 'port_a': 2, 'tray_b': 4, 'port_b': 2},
            ])
        
        return connections

    def _create_internal_connection_edges(self, shelf_id, host_id, internal_connections):
        """Create edge data for internal connections from a list of connection definitions
        
        Args:
            shelf_id: The shelf node ID (e.g., "0", "1", "2")
            host_id: The host ID (numeric)
            internal_connections: List of connection dicts with port_type, tray_a, port_a, tray_b, port_b
        """
        connection_counter = len(self.edges) + 1
        internal_connection_color = "#00AA00"  # Green for internal connections
        
        for conn_def in internal_connections:
            port_type = conn_def['port_type']
            tray_a = conn_def['tray_a']
            port_a = conn_def['port_a']
            tray_b = conn_def['tray_b']
            port_b = conn_def['port_b']
            
            # Generate port IDs within the same shelf
            port_a_id = self.generate_node_id("port", shelf_id, tray_a, port_a)
            port_b_id = self.generate_node_id("port", shelf_id, tray_b, port_b)
            
            # Create edge data for internal connection
            edge_data = {
                "data": {
                    "id": f"connection_{connection_counter}",
                    "source": port_a_id,
                    "target": port_b_id,
                    "cable_type": port_type,
                    "connection_number": connection_counter,
                    "color": internal_connection_color,
                    "depth": -1,  # Internal connections have depth -1 (within same shelf)
                    "template_name": None,
                    "source_info": f"Host {host_id} T{tray_a}P{port_a}",
                    "destination_info": f"Host {host_id} T{tray_b}P{port_b}",
                    "source_hostname": f"host_{host_id}",
                    "destination_hostname": f"host_{host_id}",
                    "is_internal": True,
                },
                "classes": "connection internal-connection",
            }
            
            self.edges.append(edge_data)
            connection_counter += 1

    def _generate_port_ids(self, connection):
        """Generate source and destination port IDs based on CSV format
        
        Uses hostname -> host_index mapping to generate numeric IDs that match
        the cabling descriptor format (e.g., "0:t1:p1").
        """
        # Get hostnames from connection
        src_hostname = connection["source"].get("hostname", "")
        dst_hostname = connection["destination"].get("hostname", "")
        
        # Map hostnames to host_index (numeric IDs)
        if src_hostname and src_hostname in self.hostname_to_host_index:
            src_shelf_id = str(self.hostname_to_host_index[src_hostname])
        else:
            # Fallback: use composite format if hostname not in mapping
            src_hall = connection["source"].get("hall", "")
            src_aisle = connection["source"].get("aisle", "")
            src_rack_num = connection["source"].get("rack_num", "")
            src_shelf_u = connection["source"].get("shelf_u", "")
            src_shelf_id = f"{src_hall}_{src_aisle}_{src_rack_num}_U{src_shelf_u}"
        
        if dst_hostname and dst_hostname in self.hostname_to_host_index:
            dst_shelf_id = str(self.hostname_to_host_index[dst_hostname])
        else:
            # Fallback: use composite format if hostname not in mapping
            dst_hall = connection["destination"].get("hall", "")
            dst_aisle = connection["destination"].get("aisle", "")
            dst_rack_num = connection["destination"].get("rack_num", "")
            dst_shelf_u = connection["destination"].get("shelf_u", "")
            dst_shelf_id = f"{dst_hall}_{dst_aisle}_{dst_rack_num}_U{dst_shelf_u}"
        
        src_port_id = self.generate_node_id("port", src_shelf_id, connection["source"]["tray"], connection["source"]["port"])
        dst_port_id = self.generate_node_id("port", dst_shelf_id, connection["destination"]["tray"], connection["destination"]["port"])
        
        return src_port_id, dst_port_id

    def _get_connection_color(self, connection):
        """Determine connection color based on whether ports are on the same node"""
        # Use hostname if available, otherwise use rack/shelf format
        src_hostname = connection["source"].get("hostname", "")
        dst_hostname = connection["destination"].get("hostname", "")
        
        # Generate node identifiers for comparison
        if src_hostname:
            source_node_id = src_hostname
        else:
            source_node_id = f"{connection['source'].get('rack_num', '')}_{connection['source'].get('shelf_u', '')}"
        
        if dst_hostname:
            dest_node_id = dst_hostname
        else:
            dest_node_id = f"{connection['destination'].get('rack_num', '')}_{connection['destination'].get('shelf_u', '')}"

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
            # Track the initial root for export optimization
            # The root node was created with id="graph_root"
            root_template_name = self.cluster_descriptor.root_instance.template_name
            metadata["initialRootId"] = "graph_root"
            metadata["initialRootTemplate"] = root_template_name
            
            # Extract template names and their full structure from the cluster descriptor
            # Process templates bottom-up: start with leaf templates (only node_ref children),
            # then build up to templates that reference other templates
            template_data = {}
            
            # Build dependency graph: template -> set of templates it depends on
            template_dependencies = {}
            all_template_names = set(self.cluster_descriptor.graph_templates.keys())
            
            for template_name, template_proto in self.cluster_descriptor.graph_templates.items():
                dependencies = set()
                for child in template_proto.children:
                    if child.HasField("graph_ref"):
                        dependencies.add(child.graph_ref.graph_template)
                template_dependencies[template_name] = dependencies
            
            # Topological sort: process templates bottom-up (leaf templates first)
            # Templates with no dependencies (only node_ref children) come first
            processed_templates = set()
            template_order = []
            
            def process_template(template_name):
                """Process a template and its dependencies recursively"""
                if template_name in processed_templates:
                    return
                
                # Process dependencies first
                for dep_template in template_dependencies.get(template_name, set()):
                    if dep_template in all_template_names:
                        process_template(dep_template)
                
                # Now process this template
                template_order.append(template_name)
                processed_templates.add(template_name)
            
            # Process all templates in dependency order
            for template_name in all_template_names:
                process_template(template_name)
            
            # Process templates in bottom-up order
            for template_name in template_order:
                template_proto = self.cluster_descriptor.graph_templates[template_name]
                # Store the template structure for instantiation in the UI
                template_info = {
                    "name": template_name,
                    "graph_type": "graph",  # All graph templates use type="graph" regardless of hierarchy level
                    "children": []
                }
                
                # Build mappings for normalized names (recursively for nested paths)
                # This needs to handle arbitrary depth hierarchies
                path_mapping = {}  # Maps tuple(original_path) -> normalized_name at each level
                
                # Helper function to recursively build path mappings through all nested templates
                def build_path_mappings_recursive(parent_path_tuple, template_name, depth=0):
                    """
                    Recursively build mappings for all paths through nested templates.
                    
                    Args:
                        parent_path_tuple: Tuple of original names leading to this template
                        template_name: Name of the current template to process
                        depth: Current depth in the hierarchy
                    """
                    if template_name not in self.cluster_descriptor.graph_templates:
                        return
                    
                    template = self.cluster_descriptor.graph_templates[template_name]
                    
                    # Process children in original order to preserve template structure
                    # This ensures that subgraphs appear in the same order as in the textproto
                    node_index = 0
                    graph_template_counters = {}  # Track enumeration index per template type
                    
                    # Process children in the exact order they appear in template.children
                    for child in template.children:
                        if child.HasField("graph_ref"):
                            child_template = child.graph_ref.graph_template
                            # Get enumeration index for this template type
                            if child_template not in graph_template_counters:
                                graph_template_counters[child_template] = 0
                            enum_idx = graph_template_counters[child_template]
                            graph_template_counters[child_template] += 1
                            
                            normalized_name = f"{child_template}_{enum_idx}"
                            child_path = parent_path_tuple + (child.name,)
                            path_mapping[child_path] = normalized_name
                            
                            # Recurse into this child template
                            build_path_mappings_recursive(child_path, child_template, depth + 1)
                        elif child.HasField("node_ref"):
                            normalized_name = f"node_{node_index}"
                            child_path = parent_path_tuple + (child.name,)
                            path_mapping[child_path] = normalized_name
                            node_index += 1
                
                # Build the complete path mapping starting from this template
                build_path_mappings_recursive((), template_name, 0)
                
                # Extract children (nodes or graph references) with normalized names
                for child in template_proto.children:
                    child_info = {}
                    
                    # Look up normalized name from path_mapping
                    child_path_tuple = (child.name,)
                    normalized_name = path_mapping.get(child_path_tuple, child.name)
                    
                    if child.HasField("node_ref"):
                        child_info["name"] = normalized_name
                        child_info["original_name"] = child.name  # Keep original for reference
                        child_info["type"] = "node"
                        child_info["node_descriptor"] = child.node_ref.node_descriptor
                    elif child.HasField("graph_ref"):
                        child_info["name"] = normalized_name
                        child_info["original_name"] = child.name  # Keep original for reference
                        child_info["type"] = "graph"
                        child_info["graph_template"] = child.graph_ref.graph_template
                    
                    template_info["children"].append(child_info)
                
                # Extract internal connections and update paths with normalized names
                template_info["connections"] = []
                for cable_type, conn_list in template_proto.internal_connections.items():
                    for conn in conn_list.connections:
                        # Normalize paths: replace original names with enumerated names
                        # Paths can be arbitrary depth: ["node1"], ["superpod1", "node1"], ["superpod1", "pod1", "node1"], etc.
                        port_a_path = list(conn.port_a.path)
                        port_b_path = list(conn.port_b.path)
                        
                        # Normalize paths using the recursive path_mapping
                        def normalize_path(original_path):
                            """
                            Normalize a path of arbitrary depth.
                            Works by building up the path incrementally and looking up each segment.
                            """
                            normalized = []
                            for i in range(len(original_path)):
                                # Build the path tuple up to this point
                                path_tuple = tuple(original_path[:i+1])
                                
                                # Look up the normalized name for this position
                                if path_tuple in path_mapping:
                                    normalized.append(path_mapping[path_tuple])
                                else:
                                    # Fallback: keep original if not found
                                    normalized.append(original_path[i])
                            
                            return normalized
                        
                        port_a_path = normalize_path(port_a_path)
                        port_b_path = normalize_path(port_b_path)
                        
                        template_info["connections"].append({
                            "cable_type": cable_type,
                            "port_a": {
                                "path": port_a_path,
                                "tray_id": conn.port_a.tray_id,
                                "port_id": conn.port_a.port_id
                            },
                            "port_b": {
                                "path": port_b_path,
                                "tray_id": conn.port_b.tray_id,
                                "port_id": conn.port_b.port_id
                            }
                        })
                
                template_data[template_name] = template_info
            
            metadata["graph_templates"] = template_data
            
            # Track logical topology instances for view switching
            # This represents the actual instance hierarchy that was imported
            logical_topology_instances = {
                "root_template": root_template_name,
                "instance_map": {}  # Maps instance IDs to their template and parent info
            }
            
            # Build instance map from the imported graph nodes
            for node in cytoscape_data["elements"]:
                node_data = node.get("data", {})
                if node_data.get("type") == "graph":
                    # This is a graph instance node
                    instance_id = node_data.get("id")
                    template_name = node_data.get("template_name")
                    parent_id = node_data.get("parent")
                    depth = node_data.get("depth")
                    
                    if instance_id and template_name:
                        logical_topology_instances["instance_map"][instance_id] = {
                            "template_name": template_name,
                            "parent_id": parent_id,
                            "depth": depth,
                            "label": node_data.get("label", "")
                        }
            
            metadata["logical_topology_instances"] = logical_topology_instances
        else:
            # For CSV imports (no logical topology), create a minimal synthetic root structure
            metadata["logical_topology_instances"] = {
                "root_template": "synthetic_root",
                "instance_map": {
                    "synthetic_root": {
                        "template_name": "synthetic_root",
                        "parent_id": None,
                        "depth": 0,
                        "label": "Unassigned Nodes"
                    }
                }
            }
        
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
        visualizer.file_format = "descriptor"  # Set format before parsing
        
        if not visualizer.parse_cabling_descriptor(input_file):
            print("Failed to parse cabling descriptor")
            sys.exit(1)
        
        # Get node types from hierarchy and initialize configs
        if visualizer.graph_hierarchy:
            # Extract unique node types
            node_types = set(node['node_type'] for node in visualizer.graph_hierarchy)
            
            # Set shelf unit type from first node (or default)
            if node_types:
                first_node_type = list(node_types)[0]
                config = visualizer._node_descriptor_to_config(first_node_type)
                visualizer.shelf_unit_type = visualizer.normalize_node_type(first_node_type)
                visualizer.current_config = config
            else:
                visualizer.shelf_unit_type = "WH_GALAXY"
                visualizer.current_config = visualizer.shelf_unit_configs["WH_GALAXY"]
            
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


# ---------------------------------------------------------------------------
# Merge cabling guide data (server-side, used by POST /merge_csv).
# Matches JS merge logic: identity-based node matching, parent resolution, edge dedup.
# ---------------------------------------------------------------------------

def _merge_get_shelf_identity(data):
    """Shelf identity for same-node matching: hostname if non-empty, else hall|aisle|rack_num|shelf_u."""
    if not data:
        return ""
    hostname = (data.get("hostname") or "").strip() if isinstance(data.get("hostname"), str) else ""
    if hostname:
        return hostname
    hall = (data.get("hall") or "").strip() if isinstance(data.get("hall"), str) else ""
    aisle = (data.get("aisle") or "").strip() if isinstance(data.get("aisle"), str) else ""
    rack = "" if data.get("rack_num") is None else str(data["rack_num"])
    shelf_u = "" if data.get("shelf_u") is None else str(data["shelf_u"])
    return f"{hall}|{aisle}|{rack}|{shelf_u}"


def _merge_node_by_id(elements):
    """Return dict id -> data for non-edge elements."""
    out = {}
    for el in elements or []:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if "source" not in d and "target" not in d and d.get("id") is not None:
            out[d["id"]] = d
    return out


def _merge_build_existing_identity_maps(elements):
    """Build maps from existing elements: shelf identity -> shelf id; tray/port keys -> ids."""
    node_by_id = _merge_node_by_id(elements)
    shelf_identity_to_shelf_id = {}
    tray_key_to_id = {}
    port_key_to_id = {}

    for el in elements or []:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if "source" in d or "target" in d:
            continue
        nid = d.get("id")
        if nid is None:
            continue
        t = d.get("type") or "node"
        if t == "shelf":
            identity = _merge_get_shelf_identity(d)
            if identity:
                shelf_identity_to_shelf_id[identity] = nid
            continue
        if t == "tray":
            parent = d.get("parent")
            shelf_data = node_by_id.get(parent) if parent else None
            identity = _merge_get_shelf_identity(shelf_data) if shelf_data else ""
            tray = "" if d.get("tray") is None else str(d["tray"])
            if identity and tray:
                tray_key_to_id[f"{identity}_t{tray}"] = nid
            continue
        if t == "port":
            parent = d.get("parent")
            tray_data = node_by_id.get(parent) if parent else None
            shelf_data = node_by_id.get(tray_data.get("parent")) if tray_data else None
            identity = _merge_get_shelf_identity(shelf_data) if shelf_data else ""
            tray = "" if not tray_data or tray_data.get("tray") is None else str(tray_data["tray"])
            port = "" if d.get("port") is None else str(d["port"])
            if identity and tray and port:
                port_key_to_id[f"{identity}_t{tray}_p{port}"] = nid

    return {
        "shelf_identity_to_shelf_id": shelf_identity_to_shelf_id,
        "tray_key_to_id": tray_key_to_id,
        "port_key_to_id": port_key_to_id,
        "node_by_id": node_by_id,
    }


def merge_cabling_guide_data(existing_data, new_data, prefix):
    """
    Merge new cabling guide (cytoscape elements + metadata) into existing.
    Returns merged { "elements": [...], "metadata": {...} }.
    Matches client logic: identity-based node matching, only add new nodes/edges,
    resolve parent ids to existing graph.
    """
    existing_els = (existing_data or {}).get("elements") or []
    new_els = (new_data or {}).get("elements") or []
    make_id = lambda i: f"{prefix}_{i}" if i else i

    existing_ids = set()
    for el in existing_els:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if d.get("id") is not None and "source" not in d and "target" not in d:
            existing_ids.add(d["id"])

    existing_edge_keys = set()
    for el in existing_els:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        src, tgt = d.get("source"), d.get("target")
        if src is not None and tgt is not None:
            key = f"{src}|{tgt}" if src <= tgt else f"{tgt}|{src}"
            existing_edge_keys.add(key)

    maps = _merge_build_existing_identity_maps(existing_els)
    shelf_id_map = maps["shelf_identity_to_shelf_id"]
    tray_key_map = maps["tray_key_to_id"]
    port_key_map = maps["port_key_to_id"]
    new_node_by_id = _merge_node_by_id(new_els)

    existing_node_id_map = {}
    for el in new_els:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if "source" in d or "target" in d:
            continue
        nid = d.get("id")
        if nid is None:
            continue
        t = d.get("type") or "node"
        if t == "shelf":
            identity = _merge_get_shelf_identity(d)
            if identity and identity in shelf_id_map:
                existing_node_id_map[nid] = shelf_id_map[identity]
            continue
        if t == "tray":
            parent = d.get("parent")
            shelf_data = new_node_by_id.get(parent) if parent else None
            identity = _merge_get_shelf_identity(shelf_data) if shelf_data else ""
            tray = "" if d.get("tray") is None else str(d["tray"])
            key = f"{identity}_t{tray}" if identity and tray else ""
            if key and key in tray_key_map:
                existing_node_id_map[nid] = tray_key_map[key]
            continue
        if t == "port":
            parent = d.get("parent")
            tray_data = new_node_by_id.get(parent) if parent else None
            shelf_data = new_node_by_id.get(tray_data.get("parent")) if tray_data else None
            identity = _merge_get_shelf_identity(shelf_data) if shelf_data else ""
            tray = "" if not tray_data or tray_data.get("tray") is None else str(tray_data["tray"])
            port = "" if d.get("port") is None else str(d["port"])
            key = f"{identity}_t{tray}_p{port}" if identity and tray and port else ""
            if key and key in port_key_map:
                existing_node_id_map[nid] = port_key_map[key]

    id_map = {}
    for el in new_els:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if d.get("id") is None or "source" in d or "target" in d:
            continue
        if d["id"] in existing_node_id_map:
            continue
        id_map[d["id"]] = make_id(d["id"])

    def resolve_parent_id(parent_id):
        if parent_id is None:
            return parent_id
        if parent_id in existing_ids:
            return parent_id
        if parent_id in existing_node_id_map:
            return existing_node_id_map[parent_id]
        return id_map.get(parent_id) or make_id(parent_id)

    new_nodes_to_add = []
    for el in new_els:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if "source" in d or "target" in d:
            continue
        nid = d.get("id")
        if nid is None or nid in existing_node_id_map:
            continue
        data = dict(d)
        new_id = id_map.get(nid) or make_id(nid)
        data["id"] = new_id
        if data.get("parent") is not None:
            data["parent"] = resolve_parent_id(data["parent"])
        new_nodes_to_add.append({"data": data, "group": (el.get("group") or "nodes"), **{k: v for k, v in el.items() if k not in ("data", "group")}})

    merged_node_ids = set(existing_ids)
    for node_el in new_nodes_to_add:
        nid = (node_el.get("data") or {}).get("id")
        if nid is not None:
            merged_node_ids.add(nid)

    added_edge_keys = set(existing_edge_keys)
    new_edges_to_add = []
    for i, el in enumerate(new_els):
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        src, tgt = d.get("source"), d.get("target")
        if src is None or tgt is None:
            continue
        source_id = existing_node_id_map.get(src) or id_map.get(src)
        target_id = existing_node_id_map.get(tgt) or id_map.get(tgt)
        if source_id is None or target_id is None:
            continue
        if source_id not in merged_node_ids or target_id not in merged_node_ids:
            continue
        edge_key = f"{source_id}|{target_id}" if source_id <= target_id else f"{target_id}|{source_id}"
        if edge_key in added_edge_keys:
            continue
        added_edge_keys.add(edge_key)
        edge_data = dict(d)
        edge_data["id"] = f"add_{prefix}_{i}"
        edge_data["source"] = source_id
        edge_data["target"] = target_id
        new_edges_to_add.append({"group": "edges", "data": edge_data})

    # Return existing elements unchanged (same refs) so client-sent parent refs are preserved
    merged_elements = list(existing_els) + new_nodes_to_add + new_edges_to_add

    existing_meta = (existing_data or {}).get("metadata") or {}
    new_meta = (new_data or {}).get("metadata") or {}
    existing_unknown = set(existing_meta.get("unknown_node_types") or [])
    for t in new_meta.get("unknown_node_types") or []:
        existing_unknown.add(t)
    merged_metadata = {
        **existing_meta,
        "connection_count": (existing_meta.get("connection_count") or 0) + (new_meta.get("connection_count") or 0),
        "merged_guide_count": (existing_meta.get("merged_guide_count") or 1) + 1,
    }
    if existing_unknown:
        merged_metadata["unknown_node_types"] = list(existing_unknown)

    return {"elements": merged_elements, "metadata": merged_metadata}


def sort_elements_parents_before_children(elements):
    """Sort so parent nodes come before children (Cytoscape compound requirement)."""
    if not elements:
        return elements
    from functools import cmp_to_key
    type_order = {"hall": 0, "aisle": 1, "rack": 2, "shelf": 3, "tray": 4, "port": 5}
    nodes = []
    edges = []
    for el in elements:
        d = (el.get("data") or {}) if isinstance(el, dict) else {}
        if el.get("group") == "edges" or "source" in d or "target" in d:
            edges.append(el)
        else:
            nodes.append(el)

    def cmp_nodes(a, b):
        da = (a.get("data") or {}) if isinstance(a, dict) else {}
        db = (b.get("data") or {}) if isinstance(b, dict) else {}
        ta, tb = da.get("type") or "", db.get("type") or ""
        oa, ob = type_order.get(ta, 6), type_order.get(tb, 6)
        if oa != ob:
            return oa - ob
        pa, pb = da.get("parent"), db.get("parent")
        if not pa and pb:
            return -1
        if pa and not pb:
            return 1
        if pa and pb and pa != pb:
            ida, idb = da.get("id"), db.get("id")
            if ida == pb:
                return 1
            if idb == pa:
                return -1
        return 0

    nodes.sort(key=cmp_to_key(cmp_nodes))
    return nodes + edges


if __name__ == "__main__":
    main()
