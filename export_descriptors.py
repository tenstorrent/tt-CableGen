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
except ImportError as e:
    print(f"Warning: protobuf not available. Deployment descriptor export will not work. Error: {e}")
    text_format = None
    Message = None


# Configuration: Field patterns that should be formatted as single lines
# These are regex patterns that match the start of fields in the textproto output.
# The patterns should match the field name followed by opening brace.
# 
# Examples: 
#   - r'value \{' matches "value {" (for ChildMapping.value)
#   - r'port_a \{' matches "port_a {" (for PortConnection.port_a)  
#   - r'port_b \{' matches "port_b {" (for PortConnection.port_b)
#   - r'child_mappings \{' matches "child_mappings {" (for GraphInstance.child_mappings)
#
# To enable single-line formatting, add patterns to this list:
#   SINGLE_LINE_FIELD_PATTERNS = [r'value \{', r'port_a \{', r'port_b \{']
#
# Note: The patterns use regex syntax. Special characters like '{' need to be escaped as '\{'
SINGLE_LINE_FIELD_PATTERNS = [r'^connections \{', r'^graph_ref \{', r'^node_ref \{', r'^child_mappings \{']  # Empty by default - user can configure

# Configuration: Minimum depth for single-line formatting
# This is a dictionary mapping field patterns to their minimum depth.
# 
# Positive values: Depth from top (0-indexed). Depth 0 = root level, depth 1 = one level nested, etc.
#   Single-line formatting applies at the specified depth and ALL deeper levels.
#   Example: {r'^value \{': 2} formats at depth 2, 3, 4, ... from the top
#
# Negative values: Depth from bottom. -1 = bottom level, -2 = one level above bottom, etc.
#   Single-line formatting applies at the specified depth from bottom and ALL deeper levels.
#   Example: {r'^sub_instance \{': -2} formats at 2 levels above bottom and deeper
#
# If a pattern is not in this dict, it applies at all depths.
# Note: Patterns should match those in SINGLE_LINE_FIELD_PATTERNS (including ^ anchor if present)
SINGLE_LINE_DEPTH_LIMITS = {r'^child_mappings \{': -3}  # Empty by default - applies to all depths

# Configuration: Fields that should use array shorthand syntax
# If empty list [], automatically detects and converts ALL repeated fields to array syntax.
# If list of field names provided, only converts those specific fields.
# Example: ['path'] will convert only 'path' fields:
#   path: "value1"
#   path: "value2"
#   to: path: ["value1", "value2"]
# Example: [] will automatically convert all repeated fields to arrays
# NOTE: Array shorthand only works for scalar/primitive fields (strings, ints, bools, enums).
# Message types (like 'connections', 'children') cannot use array shorthand in textproto.
ARRAY_SHORTHAND_FIELDS = ['path']  # Only scalar fields - message types don't support array shorthand

# Configuration: Graph template ordering in output
# Options:
#   'alphabetical' - Sort template names A-Z
#   'bottom-up'    - Leaf templates first (those with only node refs), then composites that reference them
#   'top-down'     - Root template first, then referenced templates in depth order
#   'none'         - Preserve original order (dict insertion order)
GRAPH_TEMPLATE_ORDER = 'bottom-up'


def sort_graph_templates(graph_templates_meta: dict, order: str = 'bottom-up') -> list:
    """Sort graph templates according to the specified ordering.
    
    Args:
        graph_templates_meta: Dict of template_name -> template_info
        order: Ordering strategy ('alphabetical', 'bottom-up', 'top-down', 'none')
        
    Returns:
        List of (template_name, template_info) tuples in the desired order
    """
    if order == 'none':
        return list(graph_templates_meta.items())
    
    if order == 'alphabetical':
        return sorted(graph_templates_meta.items(), key=lambda x: x[0])
    
    # Build dependency graph for hierarchical sorting
    # A template "depends on" templates it references via graph_ref
    template_deps = {}  # template_name -> set of templates it references
    
    for template_name, template_info in graph_templates_meta.items():
        deps = set()
        for child in template_info.get('children', []):
            if child.get('type') == 'graph':
                ref_template = child.get('graph_template')
                if ref_template and ref_template in graph_templates_meta:
                    deps.add(ref_template)
        template_deps[template_name] = deps
    
    # Topological sort
    sorted_templates = []
    remaining = set(graph_templates_meta.keys())
    
    while remaining:
        # Find templates with no remaining dependencies
        ready = [t for t in remaining if not (template_deps[t] & remaining)]
        
        if not ready:
            # Circular dependency - just add remaining in alphabetical order
            ready = sorted(remaining)
        
        # Sort ready templates alphabetically for consistent output
        ready.sort()
        
        for t in ready:
            sorted_templates.append(t)
            remaining.remove(t)
    
    if order == 'top-down':
        sorted_templates.reverse()
    
    return [(name, graph_templates_meta[name]) for name in sorted_templates]


def reorder_graph_templates_in_textproto(textproto_text: str, order: str = 'bottom-up') -> str:
    """Reorder graph_templates entries in textproto output.
    
    This post-processes the textproto to reorder the graph_templates { ... } blocks.
    
    Args:
        textproto_text: The textproto text to process
        order: Ordering strategy ('alphabetical', 'bottom-up', 'top-down', 'none')
        
    Returns:
        Textproto text with graph_templates reordered
    """
    import re
    
    if order == 'none':
        return textproto_text
    
    lines = textproto_text.split('\n')
    
    # Find all graph_templates entries: "graph_templates { key: "name" value { ... } }"
    # or multi-line version with graph_templates { on its own line
    
    # First, identify the structure - we need to find each graph_templates block
    template_blocks = []  # List of (template_name, start_line, end_line, block_text)
    other_lines_before = []  # Lines before graph_templates section
    other_lines_after = []  # Lines after graph_templates section
    
    i = 0
    in_graph_templates_section = False
    graph_templates_started = False
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Check if this line starts a graph_templates entry
        if stripped.startswith('graph_templates {'):
            in_graph_templates_section = True
            graph_templates_started = True
            
            # Extract the template name from "key: "name""
            template_name = None
            block_lines = [line]
            
            # Check if key is on the same line or next line
            key_match = re.search(r'key:\s*"([^"]+)"', stripped)
            if key_match:
                template_name = key_match.group(1)
            
            # Find the end of this block by counting braces
            brace_count = stripped.count('{') - stripped.count('}')
            j = i + 1
            
            while j < len(lines) and brace_count > 0:
                next_line = lines[j]
                block_lines.append(next_line)
                next_stripped = next_line.strip()
                
                # Look for key on subsequent lines if not found yet
                if not template_name:
                    key_match = re.search(r'key:\s*"([^"]+)"', next_stripped)
                    if key_match:
                        template_name = key_match.group(1)
                
                brace_count += next_stripped.count('{') - next_stripped.count('}')
                j += 1
            
            if template_name:
                template_blocks.append((template_name, '\n'.join(block_lines)))
            else:
                # Couldn't parse template name - keep as-is
                template_blocks.append((f'_unknown_{len(template_blocks)}', '\n'.join(block_lines)))
            
            i = j
            continue
        
        # Track lines before/after graph_templates section
        if not graph_templates_started:
            other_lines_before.append(line)
        elif not in_graph_templates_section or not stripped.startswith('graph_templates'):
            # Check if we're past all graph_templates
            if graph_templates_started and not stripped.startswith('graph_templates'):
                in_graph_templates_section = False
                other_lines_after.append(line)
            else:
                other_lines_before.append(line)
        
        i += 1
    
    # If no template blocks found, return as-is
    if not template_blocks:
        return textproto_text
    
    # Build dependency graph for hierarchical sorting
    template_deps = {}
    for name, block in template_blocks:
        deps = set()
        # Find graph_ref { graph_template: "..." } references in the block
        for match in re.finditer(r'graph_template:\s*"([^"]+)"', block):
            ref_name = match.group(1)
            deps.add(ref_name)
        template_deps[name] = deps
    
    # Sort according to order
    if order == 'alphabetical':
        sorted_blocks = sorted(template_blocks, key=lambda x: x[0])
    else:
        # Topological sort for bottom-up or top-down
        sorted_names = []
        remaining = {name for name, _ in template_blocks}
        name_to_block = {name: block for name, block in template_blocks}
        
        while remaining:
            # Find templates with no remaining dependencies
            ready = [t for t in remaining if not (template_deps.get(t, set()) & remaining)]
            
            if not ready:
                # Circular dependency - add remaining alphabetically
                ready = sorted(remaining)
            
            ready.sort()
            
            for t in ready:
                sorted_names.append(t)
                remaining.remove(t)
        
        if order == 'top-down':
            sorted_names.reverse()
        
        sorted_blocks = [(name, name_to_block[name]) for name in sorted_names if name in name_to_block]
    
    # Reconstruct output
    result_lines = other_lines_before
    for name, block in sorted_blocks:
        result_lines.append(block)
    result_lines.extend(other_lines_after)
    
    return '\n'.join(result_lines)


def format_message_as_textproto(message, single_line_field_patterns=None, depth_limits=None):
    """
    Format a protobuf message to textproto format, with optional single-line formatting
    for specific field patterns.
    
    Args:
        message: The protobuf message to format
        single_line_field_patterns: List of regex patterns matching field names that should
                                   be formatted as single lines along with their content.
                                   Patterns should match the field name followed by opening brace.
                                   Examples: [r'value \{', r'port_a \{', r'port_b \{']
                                   If None, uses SINGLE_LINE_FIELD_PATTERNS global config.
        depth_limits: Optional dict mapping patterns to minimum depth.
                     Positive values: depth from top (0-indexed)
                     Negative values: depth from bottom (-1 = bottom, -2 = one above bottom, etc.)
                     Single-line formatting applies at the specified depth and ALL deeper levels.
                     Patterns not in dict apply at all depths.
                     If None, uses SINGLE_LINE_DEPTH_LIMITS global config.
    
    Returns:
        String representation of the message in textproto format
    
    Raises:
        ImportError: If protobuf text_format module is not available
    """
    if text_format is None:
        raise ImportError(
            "protobuf text_format not available. "
            "Please ensure protobuf is installed and TT_METAL_HOME is set correctly. "
            "The protobuf Python modules should be available at: "
            "$TT_METAL_HOME/build/tools/scaleout/protobuf/"
        )
    
    # Generate the textproto output
    output = text_format.MessageToString(message)
    
    # Reorder graph_templates section according to configured ordering
    # This applies to ClusterDescriptor messages with graph_templates
    if GRAPH_TEMPLATE_ORDER != 'none':
        output = reorder_graph_templates_in_textproto(output, GRAPH_TEMPLATE_ORDER)
    
    # Apply array shorthand formatting FIRST (before single-line formatting)
    # This ensures repeated fields are converted to arrays before any collapsing happens
    # Always call this function - it handles empty list for auto-detection
    output = apply_array_shorthand(output, ARRAY_SHORTHAND_FIELDS)
    
    # Use global config if not provided
    if single_line_field_patterns is None:
        single_line_field_patterns = SINGLE_LINE_FIELD_PATTERNS
    if depth_limits is None:
        depth_limits = SINGLE_LINE_DEPTH_LIMITS
    
    # Apply single-line formatting if patterns are specified
    if single_line_field_patterns:
        output = apply_single_line_formatting(output, single_line_field_patterns, depth_limits=depth_limits)
    
    return output


def apply_single_line_formatting(textproto_text, field_patterns, depth_limits=None):
    """
    Post-process textproto text to format specific fields as single lines.
    
    This function finds fields matching the patterns and formats them and their
    descendants as single lines by collapsing newlines and extra spaces.
    
    Args:
        textproto_text: The textproto text to process
        field_patterns: List of regex patterns matching field names to format as single lines
        depth_limits: Optional dict mapping patterns to minimum depth.
                     Positive values: depth from top (0-indexed)
                     Negative values: depth from bottom (-1 = bottom, -2 = one above bottom, etc.)
                     Single-line formatting applies at the specified depth and ALL deeper levels.
                     Patterns not in dict apply at all depths.
    
    Returns:
        Processed textproto text with specified fields formatted as single lines
    """
    import re
    
    if not field_patterns:
        return textproto_text
    
    depth_limits = depth_limits or {}
    
    # Build a combined pattern that matches any of the field patterns
    # Also track which pattern matched for depth checking
    pattern_list = [(pattern, re.compile(pattern)) for pattern in field_patterns]
    
    # First pass: Calculate maximum depth for each pattern (needed for negative depth limits)
    lines = textproto_text.split('\n')
    base_indent = None
    pattern_max_depths = {}  # pattern -> max_depth
    
    # Check if we have any negative depth limits
    has_negative_limits = any(d < 0 for d in depth_limits.values())
    
    if has_negative_limits:
        # First pass: find max depth for each pattern
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            
            indent = len(line) - len(line.lstrip())
            if base_indent is None:
                base_indent = indent
            
            depth = (indent - base_indent) // 2 if base_indent is not None else 0
            
            # Check if this line matches any pattern
            for pattern, pattern_re in pattern_list:
                if pattern_re.search(stripped):
                    # Normalize pattern for lookup
                    lookup_pattern = pattern
                    if lookup_pattern not in depth_limits:
                        pattern_without_anchor = lookup_pattern.lstrip('^')
                        if pattern_without_anchor in depth_limits:
                            lookup_pattern = pattern_without_anchor
                        else:
                            pattern_with_anchor = '^' + lookup_pattern
                            if pattern_with_anchor in depth_limits:
                                lookup_pattern = pattern_with_anchor
                    
                    if lookup_pattern in depth_limits and depth_limits[lookup_pattern] < 0:
                        # Track max depth for this pattern
                        if lookup_pattern not in pattern_max_depths:
                            pattern_max_depths[lookup_pattern] = depth
                        else:
                            pattern_max_depths[lookup_pattern] = max(pattern_max_depths[lookup_pattern], depth)
                    break
    
    # Second pass: Apply formatting with depth checking
    result_lines = []
    i = 0
    base_indent = None  # Reset for second pass
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Skip empty lines but preserve them
        if not stripped:
            result_lines.append(line)
            i += 1
            continue
        
        # Calculate indentation level (in spaces, assuming 2-space indentation)
        indent = len(line) - len(line.lstrip())
        if base_indent is None:
            base_indent = indent
        
        # Calculate depth: (indent - base_indent) // 2 (assuming 2-space indentation)
        # This gives us depth 0, 1, 2, etc.
        depth = (indent - base_indent) // 2 if base_indent is not None else 0
        
        # Check if this line matches any pattern
        matched_pattern = None
        for pattern, pattern_re in pattern_list:
            if pattern_re.search(stripped):
                matched_pattern = pattern
                break
        
        if matched_pattern:
            # Check minimum depth for this pattern
            # Normalize pattern lookup: try exact match, then try without ^ anchor
            min_depth = depth_limits.get(matched_pattern)
            lookup_pattern = matched_pattern
            
            if min_depth is None:
                # Try pattern without ^ anchor if it exists
                pattern_without_anchor = matched_pattern.lstrip('^')
                min_depth = depth_limits.get(pattern_without_anchor)
                if min_depth is not None:
                    lookup_pattern = pattern_without_anchor
                else:
                    # Also try with ^ anchor if original didn't have it
                    pattern_with_anchor = '^' + matched_pattern
                    min_depth = depth_limits.get(pattern_with_anchor)
                    if min_depth is not None:
                        lookup_pattern = pattern_with_anchor
            
            if min_depth is not None:
                # Handle negative depth (from bottom)
                if min_depth < 0:
                    # Convert to absolute depth from top
                    max_depth = pattern_max_depths.get(lookup_pattern, depth)
                    # min_depth is negative, so we want depth >= (max_depth + min_depth)
                    # e.g., if max_depth=5 and min_depth=-2, format at depth >= 3 (5-2)
                    # This means: format at 2 levels above bottom and deeper (depths 3, 4, 5)
                    # Clamp to 0 since depth can't be negative
                    absolute_min_depth = max(0, max_depth + min_depth)
                    if depth < absolute_min_depth:
                        # Depth is less than minimum - don't format as single line
                        result_lines.append(line)
                        i += 1
                        continue
                else:
                    # Positive depth (from top)
                    if depth < min_depth:
                        # Depth is less than minimum - don't format as single line
                        result_lines.append(line)
                        i += 1
                        continue
            
            # Found a matching field - collect until matching closing brace
            # Preserve the indentation of the first line
            indent = len(line) - len(line.lstrip())
            
            # Count opening and closing braces in the first line
            brace_count = stripped.count('{') - stripped.count('}')
            single_line_parts = [stripped]
            j = i + 1
            
            # Collect subsequent lines until braces are balanced
            while j < len(lines) and brace_count > 0:
                next_line = lines[j]
                next_stripped = next_line.strip()
                
                # Count braces in this line
                brace_count += next_line.count('{') - next_line.count('}')
                
                if next_stripped:  # Only add non-empty lines
                    single_line_parts.append(next_stripped)
                
                j += 1
            
            # Join parts with single spaces, removing extra whitespace
            single_line_content = ' '.join(part for part in single_line_parts if part)
            result_lines.append(' ' * indent + single_line_content)
            i = j
        else:
            # Normal line, add as-is
            result_lines.append(line)
            i += 1
    
    return '\n'.join(result_lines)


def apply_array_shorthand(textproto_text, field_names=None):
    """
    Convert repeated field entries to array shorthand syntax.
    
    This function finds consecutive repeated field entries and converts them to
    array syntax. For example:
    
    Before:
      path: "value1"
      path: "value2"
      path: "value3"
    
    After:
      path: ["value1", "value2", "value3"]
    
    Args:
        textproto_text: The textproto text to process
        field_names: List of field names to convert to array syntax (e.g., ['path']).
                    If empty list [] or None, automatically detects all repeated fields.
    
    Returns:
        Processed textproto text with repeated fields converted to arrays
    """
    import re
    
    lines = textproto_text.split('\n')
    result_lines = []
    i = 0
    
    # Pattern to match any field assignment: "field_name: value"
    field_pattern = r'^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$'
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Skip empty lines
        if not stripped:
            result_lines.append(line)
            i += 1
            continue
        
        # Try to match a field assignment
        match = re.match(field_pattern, stripped)
        
        if match:
            field_name = match.group(1)
            indent = len(line) - len(line.lstrip())
            
            # Check if we should process this field
            # If field_names is provided and not empty, only process those fields
            # If field_names is empty/None, process all fields
            should_process = (not field_names or len(field_names) == 0 or field_name in field_names)
            
            if should_process:
                # Found a matching field - collect consecutive entries
                values = []
                j = i
                
                # Collect consecutive lines with the same field name at the same indentation
                while j < len(lines):
                    current_line = lines[j]
                    current_stripped = current_line.strip()
                    
                    # Skip empty lines but continue looking
                    if not current_stripped:
                        j += 1
                        continue
                    
                    current_indent = len(current_line) - len(current_line.lstrip())
                    
                    # If indentation decreased, we've moved to a parent scope - stop
                    if current_indent < indent:
                        break
                    
                    # Check if it's the same field at the same indentation level
                    current_match = re.match(field_pattern, current_stripped)
                    
                    if (current_match and 
                        current_match.group(1) == field_name and 
                        current_indent == indent):
                        # Extract the value (handle quoted strings and other values)
                        value = current_match.group(2).strip()
                        values.append(value)
                        j += 1
                    elif current_indent == indent:
                        # Different field at same indentation - stop collecting
                        break
                    else:
                        # Different indentation (greater) - might be nested, skip for now
                        # but this shouldn't happen for consecutive fields
                        j += 1
                        continue
                
                # If we have multiple values, format as array
                if len(values) > 1:
                    # Format as array: field: ["value1", "value2", "value3"]
                    array_content = ', '.join(values)
                    result_lines.append(' ' * indent + f'{field_name}: [{array_content}]')
                    i = j
                else:
                    # Single value - keep as-is
                    result_lines.append(line)
                    i += 1
            else:
                # Field not in the list - keep as-is
                result_lines.append(line)
                i += 1
        else:
            # Not a field assignment - keep as-is
            result_lines.append(line)
            i += 1
    
    return '\n'.join(result_lines)


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
        """
        Extract shelf/tray/port info from node ID.
        
        **PRIMARY PATH**: Read host_id from node_data.host_index (if node exists in self.nodes)
        **FALLBACK PATH**: Parse node_id string using regex patterns (legacy support)
        
        This unified approach ensures we always use host_index when available,
        falling back to parsing only when necessary.
        """
        # PRIMARY PATH: Try to get node data and read host_index
        if node_id in self.nodes:
            node_element = self.nodes[node_id]
            node_data = node_element.get("data", {})
            host_id = node_data.get("host_index") or node_data.get("host_id")
            
            if host_id is not None:
                # We have host_id from node data - extract tray/port from node_id if needed
                host_id_str = str(host_id)
                
                # Try to extract tray/port from descriptor format: {host_id}:t{tray}:p{port}
                tray_port_match = re.match(r"^(\d+):t(\d+)(?::p(\d+))?$", node_id)
                if tray_port_match:
                    parsed_host_id = tray_port_match.group(1)
                    if parsed_host_id == host_id_str:
                        tray_id = int(tray_port_match.group(2))
                        if tray_port_match.group(3):
                            # Port format
                            return {
                                "type": "port",
                                "hostname": host_id_str,
                                "shelf_id": host_id_str,
                                "tray_id": tray_id,
                                "port_id": int(tray_port_match.group(3))
                            }
                        else:
                            # Tray format
                            return {
                                "type": "tray",
                                "hostname": host_id_str,
                                "shelf_id": host_id_str,
                                "tray_id": tray_id
                            }
                elif node_id == host_id_str:
                    # Simple shelf ID match
                    return {
                        "type": "shelf",
                        "hostname": host_id_str,
                        "shelf_id": host_id_str
                    }
        
        # FALLBACK PATH: Parse node_id string using regex patterns (legacy support)
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
                continue

            # Only process port-to-port connections
            source_type = source_info.get("type")
            target_type = target_info.get("type")
            if source_type != "port" or target_type != "port":
                edges_skipped_not_ports += 1
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
        """
        Get hostname/host_id from a port node's data
        
        **PRIMARY PATH**: Read host_index from port node data, then look up shelf node
        **FALLBACK PATH**: Parse port_id string to extract host_id (legacy support)
        
        Handles multiple formats:
        1. Port ID format like "0:t1:p2" (descriptor/CSV format) - extract host_id and look up shelf
        2. Port has hostname directly in its data
        3. Traverse hierarchy: port -> tray -> shelf
        """
        # PRIMARY PATH: Try to get port node and read host_index from its data
        if port_id in self.nodes:
            port_element = self.nodes[port_id]
            port_data = port_element.get("data", {})
            host_id = port_data.get("host_index") or port_data.get("host_id")
            
            if host_id is not None:
                # We have host_id from port data - look up the shelf node
                # Try to find shelf node with this host_id
                for shelf_id, shelf_element in self.nodes.items():
                    shelf_data = shelf_element.get("data", {})
                    if shelf_data.get("type") == "shelf":
                        shelf_host_id = shelf_data.get("host_index") or shelf_data.get("host_id")
                        if shelf_host_id == host_id:
                            # Found matching shelf - return its hostname or host_id
                            return shelf_data.get("hostname") or str(host_id)
        
        # FALLBACK PATH: Parse port_id string (legacy support)
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
    # CRITICAL: host_index is now REQUIRED - all nodes must have it set (via DFS or at creation)
    host_by_index = {}
    seen_hostnames = {}  # Track hostnames for duplicate detection
    
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
            
            # Fallback to host_id if host_index not present (for backward compatibility)
            if host_index is None:
                host_index = node_data.get("host_id")
            
            if not hostname or not node_type:
                continue  # Skip incomplete nodes
            
            # CRITICAL: host_index is now REQUIRED - raise error if missing
            if host_index is None:
                raise ValueError(
                    f"Shelf node '{hostname}' is missing required host_index. "
                    f"This should not happen - all shelf nodes must have host_index set at creation "
                    f"or via DFS recalculation. If nodes were collapsed, try expanding the hierarchy and try again."
                )
            
            # CRITICAL: Detect duplicate host_index values (Issue #3)
            if host_index in host_by_index:
                existing_hostname, existing_node_type = host_by_index[host_index]
                raise ValueError(
                    f"Duplicate host_index {host_index} detected: "
                    f"'{hostname}' (type: {node_type}) conflicts with "
                    f"'{existing_hostname}' (type: {existing_node_type}). "
                    f"Each shelf node must have a unique host_index. "
                    f"Please run DFS recalculation to ensure unique host_index values."
                )
            
            # Track hostnames for duplicate detection (same hostname should have same host_index)
            if hostname in seen_hostnames:
                if seen_hostnames[hostname] != host_index:
                    raise ValueError(
                        f"Hostname '{hostname}' appears with different host_index values: "
                        f"{seen_hostnames[hostname]} and {host_index}. "
                        f"This indicates inconsistent node data."
                    )
            else:
                seen_hostnames[hostname] = host_index
            
            # Store in map
            host_by_index[host_index] = (hostname, node_type)
    
    if not host_by_index:
        # No valid hosts found (e.g. payload missing shelf nodes when hierarchy was collapsed)
        raise ValueError(
            "No valid hosts found for export. "
            "Hosts must have both hostname, node_type, and host_index defined. "
            "If nodes were collapsed, try expanding the hierarchy and try again."
        )
    
    # Sort by host_index to maintain the indexed relationship
    sorted_indices = sorted(host_by_index.keys())
    sorted_hosts = [host_by_index[idx] for idx in sorted_indices]
    return sorted_hosts


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
    return format_message_as_textproto(cluster_desc, single_line_field_patterns=SINGLE_LINE_FIELD_PATTERNS, depth_limits=SINGLE_LINE_DEPTH_LIMITS)


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
    
    # Check if any template already has connections in metadata
    has_metadata_connections = any(
        template_info.get('connections', []) 
        for template_info in graph_templates_meta.values()
    )
    
    if not has_metadata_connections and cytoscape_connections:
        # No connections in metadata - match cytoscape connections to templates
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
    
    # Build all graph templates from metadata (excluding empty ones)
    # Sort templates according to configured ordering
    sorted_templates = sort_graph_templates(graph_templates_meta, GRAPH_TEMPLATE_ORDER)
    for template_name, template_info in sorted_templates:
        graph_template = cluster_config_pb2.GraphTemplate()
        
        # Add children (deduplicate by name so lowest-level template has no duplicate node_ref)
        seen_child_names = set()
        for child_info in template_info.get('children', []):
            child_name = child_info.get('name')
            if not child_name or child_name in seen_child_names:
                continue
            seen_child_names.add(child_name)
            child = graph_template.children.add()
            child.name = child_name
            
            if child_info.get('type') == 'node':
                # Leaf node
                child.node_ref.node_descriptor = child_info['node_descriptor']
            elif child_info.get('type') == 'graph':
                # Graph reference
                child.graph_ref.graph_template = child_info['graph_template']
        
        # Add connections (with deduplication)
        connections_list = template_info.get('connections', [])
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
    
    return format_message_as_textproto(cluster_desc, single_line_field_patterns=SINGLE_LINE_FIELD_PATTERNS, depth_limits=SINGLE_LINE_DEPTH_LIMITS)


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
        
    return format_message_as_textproto(cluster_desc, single_line_field_patterns=SINGLE_LINE_FIELD_PATTERNS, depth_limits=SINGLE_LINE_DEPTH_LIMITS)


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
    all_children = [el for el in element_map.values() 
                    if el.get("data", {}).get("parent") == node_id]
    
    # Deduplicate children to avoid adding the same child multiple times
    # when there are multiple instances of the same template
    # A template definition should only list each child once, regardless of instance count
    # For graph children, deduplicate by (child_name, template_name) tuple
    # For node children, deduplicate by child_name
    seen_children = set()
    children = []
    for child_el in all_children:
        child_data = child_el.get("data", {})
        child_type = child_data.get("type")
        child_name = child_data.get("child_name", child_data.get("label", child_data.get("id")))
        
        # Create a unique key for deduplication
        if child_type == "shelf":
            # For node children, use just child_name
            child_key = ("node", child_name)
        else:
            # For graph children, use template_name as the key (not child_name)
            # This ensures all instances of the same template are treated as the same child
            # The template name is what we'll use in the template definition anyway
            child_template_name = child_data.get("template_name", f"template_{child_name}")
            child_key = ("graph", child_template_name)
        
        # Only process each unique child once
        if child_key not in seen_children:
            seen_children.add(child_key)
            children.append(child_el)
        else:
            # Skip duplicate - this child was already added from another instance
            print(f"    Skipping duplicate child '{child_name}' in template '{node_template_name}' (already added from another instance)")
    
    # Process each child (now deduplicated)
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
            
            # For graph children, use the template name as the child name in the template definition
            # This ensures consistency - the child name matches what we're referencing (the template)
            # Instance-specific names like "2x_0", "2x_1" should not appear in template definitions
            child_name_for_template = child_template_name
            
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
            # Use the extracted base name (template name) for consistency
            child.name = child_name_for_template
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
        source_path = get_path_to_host(source_child_name, node_id, element_map, cluster_desc)
        for path_elem in source_path:
            conn.port_a.path.append(path_elem)
        conn.port_a.tray_id = connection["source"]["tray_id"]
        conn.port_a.port_id = connection["source"]["port_id"]
        
        # Build path using template-relative child names
        target_path = get_path_to_host(target_child_name, node_id, element_map, cluster_desc)
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
        
        # Process children in template order (deduplicate by name so host_id is consecutive 0,1,2,...)
        children = []
        seen_child_names = set()
        for template_child in template.children:
            child_name = template_child.name
            if child_name in children_by_name and child_name not in seen_child_names:
                seen_child_names.add(child_name)
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
            # Use visualizer metadata host_index/host_id when present; otherwise fall back to counter
            child_name = child_data.get("child_name", child_label)
            node_host_id = child_data.get("host_index")
            if node_host_id is None:
                node_host_id = child_data.get("host_id")
            if node_host_id is not None:
                mapping_host_id = int(node_host_id)
            else:
                mapping_host_id = host_id
                host_id += 1

            child_mapping = cluster_config_pb2.ChildMapping()
            child_mapping.host_id = mapping_host_id
            graph_instance.child_mappings[child_name].CopyFrom(child_mapping)
            
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
            source_path = get_path_to_host(source_hostname, node_id, element_map, cluster_desc)
            for path_elem in source_path:
                conn.port_a.path.append(path_elem)
            conn.port_a.tray_id = connection["source"]["tray_id"]
            conn.port_a.port_id = connection["source"]["port_id"]
            
            # Build path to target
            target_path = get_path_to_host(target_hostname, node_id, element_map, cluster_desc)
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


def get_path_to_host(child_name, scope_node_id, element_map, cluster_desc=None):
    """Get the path from scope_node_id down to the host with given child_name
    
    Args:
        child_name: Template child name (e.g., "node1")
        scope_node_id: The scope node ID to build path from
        element_map: Map of element IDs to elements
        cluster_desc: Optional ClusterDescriptor to look up template-relative child names
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
        
        node_type = data.get("type")
        
        # Add node child_name/label to path (at the beginning)
        if node_type == "shelf":
            # For shelf nodes, use child_name (template-relative)
            path.insert(0, data.get("child_name", data.get("label", node_id)))
        elif node_type == "graph":
            # For graph nodes, use template-relative child name from template definition
            template_name = data.get("template_name")
            child_name_from_data = data.get("child_name")
            
            # If we have cluster_desc, look up the parent template to get the correct child name
            if cluster_desc and template_name:
                parent_id = data.get("parent")
                if parent_id:
                    parent_el = element_map.get(parent_id)
                    if parent_el:
                        parent_template_name = parent_el.get("data", {}).get("template_name")
                        if parent_template_name and parent_template_name in cluster_desc.graph_templates:
                            parent_template = cluster_desc.graph_templates[parent_template_name]
                            # Find the child entry in parent template that matches this graph's template
                            for child_def in parent_template.children:
                                if child_def.HasField('graph_ref') and child_def.graph_ref.graph_template == template_name:
                                    # Use the child name from template definition (template-relative, e.g., "2x")
                                    path.insert(0, child_def.name)
                                    break
                            else:
                                # Child not found in parent template - use template name as fallback
                                path.insert(0, template_name)
                        else:
                            # Parent template not found - use template name
                            path.insert(0, template_name)
                    else:
                        # Parent element not found - use template name
                        path.insert(0, template_name)
                else:
                    # Root node - use template name
                    path.insert(0, template_name)
            else:
                # No cluster_desc available - try to extract base name from instance-specific name
                # Remove trailing _<number> pattern (e.g., "2x_1" -> "2x")
                import re
                if template_name:
                    # Prefer template name if available
                    path.insert(0, template_name)
                elif child_name_from_data:
                    base_name_match = re.match(r'^(.+?)_\d+$', child_name_from_data)
                    if base_name_match:
                        path.insert(0, base_name_match.group(1))
                    else:
                        path.insert(0, child_name_from_data)
                else:
                    path.insert(0, data.get("label", node_id))
        else:
            # For other node types, use label
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
    return format_message_as_textproto(deployment_descriptor, single_line_field_patterns=SINGLE_LINE_FIELD_PATTERNS, depth_limits=SINGLE_LINE_DEPTH_LIMITS)
