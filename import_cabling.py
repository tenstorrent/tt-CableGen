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


class NetworkCablingCytoscapeVisualizer:
    """Professional network cabling topology visualizer using cytoscape.js with templates
    
    Features:
    - Unified CSV parser supporting multiple formats (hierarchical, hostname-based, minimal)
    - Template-based element positioning to reduce redundancy
    - Hierarchical compound nodes (Racks > Shelf Units > Trays > Ports)
    - Intelligent edge routing with automatic collision avoidance
    - Interactive web interface with zoom, pan, and selection
    - Color coding by cable length with visual hierarchy
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
        self.csv_format = None  # Will be detected: '20_column' or '8_column'
        self.mixed_node_types = {}  # For 20-column format with mixed types
        self.dynamic_configs = {}  # For unknown node types discovered from CSV data

        # Cytoscape elements
        self.nodes = []
        self.edges = []

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
        if self.csv_format == "hierarchical":
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

    def parse_csv(self, csv_file):
        """Parse CSV file containing cabling connections with unified flexible parsing"""
        try:
            # First, detect the CSV format and available fields
            self.csv_format = self.detect_csv_format(csv_file)
            if not self.csv_format:
                return []

            print(f"Detected CSV format: {self.csv_format}")

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
                    if self.csv_format == "hierarchical":
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
                if self.csv_format == "hierarchical":
                    self._track_hierarchical_location(source_data, dest_data)
                elif self.csv_format == "hostname_based":
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

    def calculate_position_in_sequence(self, element_type, index, parent_x=0, parent_y=0):
        """Calculate position for an element in a sequence based on its template"""
        template = self.element_templates[element_type]
        dimensions = template["dimensions"]
        position_type = template["position_type"]

        if position_type == "horizontal_sequence":
            # Elements arranged left-to-right (e.g., racks, ports)
            x = parent_x + index * (dimensions["width"] + dimensions["spacing"])
            y = parent_y

        elif position_type == "vertical_sequence":
            # Elements arranged top-to-bottom (e.g., trays)
            x = parent_x
            y = parent_y + index * (dimensions["height"] + dimensions["spacing"])

        elif position_type == "vertical_sequence_reversed":
            # Elements arranged bottom-to-top (e.g., shelves with lower U at bottom)
            x = parent_x
            # Note: This will be corrected in the calling function with total count
            y = parent_y + index * (dimensions["height"] + dimensions["spacing"])

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

        node = {
            "data": node_data,
            "classes": template["style_class"],
            "position": {"x": x + template["dimensions"]["width"] / 2, "y": y + template["dimensions"]["height"] / 2},
        }

        return node

    def create_hierarchical_nodes(self):
        """Create hierarchical compound nodes using templates for positioning"""
        self.create_hierarchical_nodes_unified()

    def create_hierarchical_nodes_unified(self):
        """Create hierarchical nodes using unified approach based on detected format"""

        if self.csv_format == "hierarchical":
            # Full hierarchy with racks
            self._create_rack_hierarchy()
        elif self.csv_format in ["hostname_based", "minimal"]:
            # Shelf-only hierarchy
            self._create_shelf_hierarchy()

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

    def _create_trays_and_ports(self, shelf_id, shelf_config, shelf_x, shelf_y, rack_num, shelf_u, shelf_node_type, hostname):
        """Create trays and ports for a shelf"""
        # Create trays based on this shelf's specific configuration
        tray_count = shelf_config["tray_count"]
        tray_ids = list(range(1, tray_count + 1))  # T1, T2, T3, T4 (or however many)
        tray_positions = self.get_child_positions_for_parent("shelf", tray_ids, shelf_x, shelf_y)

        for tray_id, tray_x, tray_y in tray_positions:
            # Create tray node
            tray_node_id = self.generate_node_id("tray", shelf_id, tray_id)
            tray_node = self.create_node_from_template(
                "tray",
                tray_node_id,
                shelf_id,
                f"T{tray_id}",
                tray_x,
                tray_y,
                rack_num=rack_num,
                shelf_u=shelf_u,
                tray=tray_id,
                shelf_node_type=shelf_node_type,
                hostname=hostname,
            )
            self.nodes.append(tray_node)

            # Create ports based on this shelf's specific configuration
            port_count = shelf_config["port_count"]
            port_ids = list(range(1, port_count + 1))  # P1, P2, ... (based on config)
            port_positions = self.get_child_positions_for_parent("tray", port_ids, tray_x, tray_y)

            for port_id, port_x, port_y in port_positions:
                # Create port node
                port_node_id = self.generate_node_id("port", shelf_id, tray_id, port_id)
                port_node = self.create_node_from_template(
                    "port",
                    port_node_id,
                    tray_node_id,
                    f"P{port_id}",
                    port_x,
                    port_y,
                    rack_num=rack_num,
                    shelf_u=shelf_u,
                    tray=tray_id,
                    port=port_id,
                    shelf_node_type=shelf_node_type,
                    hostname=hostname,
                )
                self.nodes.append(port_node)

    def create_connection_edges(self):
        """Create edges representing connections between ports"""
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
                    "label": f"#{i}",
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
        
        return {
            "nodes": cytoscape_data["elements"],
            "edges": [],
            "metadata": {
                "total_connections": len(self.connections),
                "total_nodes": len([n for n in cytoscape_data["elements"] if "source" not in n.get("data", {})]),
            },
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
        description="Demonstrate template-based generation of Cytoscape.js elements with auto-detected CSV format and node types"
    )
    parser.add_argument(
        "csv_file", help="Input CSV cabling file (supports 20-column with hostname or 8-column hostname format)"
    )
    parser.add_argument(
        "-o",
        "--output",
        default="templated_demo_data.json",
        help="Output JSON file for generated Cytoscape.js data (default: templated_demo_data.json)",
    )

    args = parser.parse_args()

    # Create visualizer without specifying shelf unit type (will be auto-detected from CSV)
    visualizer = NetworkCablingCytoscapeVisualizer()

    connections = visualizer.parse_csv(args.csv_file)
    if not connections:
        sys.exit(1)

    # Generate hierarchical nodes using the template system
    visualizer.create_diagram(args.output)


if __name__ == "__main__":
    main()
