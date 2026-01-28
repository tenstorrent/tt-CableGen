#!/usr/bin/env python3
"""
Flask web server for Network Cabling Visualizer
Provides CSV upload interface and generates JSON visualization data on-the-fly
"""

import os
import sys
import tempfile
import argparse
import time
import threading
import json
from flask import Flask, request, jsonify, render_template, send_from_directory, Response, make_response
import traceback
from urllib.parse import urlparse

# Add the parent directory to sys.path to import our modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import our existing templating system
from import_cabling import NetworkCablingCytoscapeVisualizer

# Import export functionality
try:
    # Test if export functionality is available
    from export_descriptors import export_cabling_descriptor_for_visualizer, export_deployment_descriptor_for_visualizer, export_flat_cabling_descriptor

    EXPORT_AVAILABLE = True
except ImportError as e:
    EXPORT_AVAILABLE = False

app = Flask(__name__)
# No CORS needed since we're serving everything from the same origin

# HTML template for the main interface


@app.route("/")
def index():
    """Serve the main HTML interface"""
    try:
        # Get node configurations from Python side
        visualizer = NetworkCablingCytoscapeVisualizer()

        # Convert Python configs to JavaScript format
        node_configs = {}
        for node_type, config in visualizer.shelf_unit_configs.items():
            # Convert Python config to JavaScript format
            js_config = {
                "tray_count": config["tray_count"],
                "ports_per_tray": config["port_count"],
                "tray_layout": config["tray_layout"],
            }
            # Convert to uppercase for JavaScript (e.g., 'wh_galaxy' -> 'WH_GALAXY')
            node_configs[node_type.upper()] = js_config

        # Generate cache-busting version based on main JS file modification time
        # This ensures browsers fetch new versions when files are updated
        try:
            main_js_path = os.path.join("static", "js", "visualizer.js")
            if os.path.exists(main_js_path):
                file_mtime = int(os.path.getmtime(main_js_path))
                cache_version = str(file_mtime)
            else:
                # Fallback to current timestamp if file doesn't exist
                cache_version = str(int(time.time()))
        except Exception:
            # Fallback to current timestamp on any error
            cache_version = str(int(time.time()))

        html_content = render_template("index.html", node_configs=node_configs, cache_version=cache_version)
        response = make_response(html_content)
        # Prevent HTML caching to ensure users always get the latest version
        response.cache_control.no_cache = True
        response.cache_control.no_store = True
        response.cache_control.must_revalidate = True
        response.cache_control.max_age = 0
        return response

    except Exception as e:
        # Fallback to template without configs if there's an error
        cache_version = str(int(time.time()))
        html_content = render_template("index.html", node_configs={}, cache_version=cache_version)
        response = make_response(html_content)
        # Prevent HTML caching to ensure users always get the latest version
        response.cache_control.no_cache = True
        response.cache_control.no_store = True
        response.cache_control.must_revalidate = True
        response.cache_control.max_age = 0
        return response


def normalize_github_url(url):
    """
    Normalize GitHub URLs to raw.githubusercontent.com format for direct file access.
    
    Handles various GitHub URL formats:
    - https://github.com/user/repo/blob/branch/path/file.textproto
    - https://raw.githubusercontent.com/user/repo/branch/path/file.textproto
    - https://github.com/user/repo/raw/branch/path/file.textproto
    """
    parsed = urlparse(url)
    
    # Already a raw URL
    if 'raw.githubusercontent.com' in parsed.netloc:
        return url
    
    # GitHub blob URL: github.com/user/repo/blob/branch/path/file
    if 'github.com' in parsed.netloc and '/blob/' in parsed.path:
        # Extract: user/repo/branch/path/file
        path_parts = parsed.path.split('/')
        try:
            blob_index = path_parts.index('blob')
            user = path_parts[blob_index - 2]
            repo = path_parts[blob_index - 1]
            branch = path_parts[blob_index + 1]
            file_path = '/'.join(path_parts[blob_index + 2:])
            
            # Reconstruct as raw URL
            normalized = f"https://raw.githubusercontent.com/{user}/{repo}/{branch}/{file_path}"
            return normalized
        except (ValueError, IndexError):
            pass
    
    # GitHub raw URL (old format): github.com/user/repo/raw/branch/path/file
    if 'github.com' in parsed.netloc and '/raw/' in parsed.path:
        path_parts = parsed.path.split('/')
        try:
            raw_index = path_parts.index('raw')
            user = path_parts[raw_index - 2]
            repo = path_parts[raw_index - 1]
            branch = path_parts[raw_index + 1]
            file_path = '/'.join(path_parts[raw_index + 2:])
            
            normalized = f"https://raw.githubusercontent.com/{user}/{repo}/{branch}/{file_path}"
            return normalized
        except (ValueError, IndexError):
            pass
    
    # Return original URL if we can't normalize it
    return url


def extract_filename_from_url(url):
    """Extract filename from URL"""
    parsed = urlparse(url)
    path = parsed.path
    filename = os.path.basename(path)
    
    # If no filename in path, try to get from query params or use default
    if not filename or '.' not in filename:
        # Check if it's a textproto or csv based on content-type or default
        if url.endswith('.textproto') or url.endswith('.csv'):
            return os.path.basename(url.split('?')[0])
        return 'downloaded_file.textproto'
    
    return filename


@app.route("/load_external_file", methods=["GET"])
def load_external_file():
    """Load file from external URL (GitHub, etc.) and process it
    
    Query parameters:
    - url: External URL to fetch (required)
    - filename: Optional filename override
    
    Returns: Same format as /upload_csv (visualization data)
    """
    try:
        file_url = request.args.get('url')
        if not file_url:
            return jsonify({"success": False, "error": "No URL provided. Use ?url=<file_url>"}), 400
        
        # Validate URL scheme
        parsed = urlparse(file_url)
        if parsed.scheme not in ['http', 'https']:
            return jsonify({"success": False, "error": "URL must use http or https protocol"}), 400
        
        # Normalize GitHub URLs
        normalized_url = normalize_github_url(file_url)
        
        # Extract filename
        filename = request.args.get('filename') or extract_filename_from_url(normalized_url)
        
        # Validate file extension
        if not (filename.lower().endswith(".csv") or filename.lower().endswith(".textproto")):
            return jsonify({"success": False, "error": "File must be a CSV or textproto file"}), 400
        
        is_textproto = filename.lower().endswith(".textproto")
        
        # Fetch file from external URL
        try:
            import requests
        except ImportError:
            return jsonify({"success": False, "error": "requests library not available. Please install: pip install requests"}), 500
        
        try:
            # Fetch with timeout and follow redirects
            response = requests.get(
                normalized_url,
                timeout=30,
                allow_redirects=True,
                headers={'User-Agent': 'TT-CableGen/1.0'}  # Some servers require User-Agent
            )
            response.raise_for_status()
            
            # Check content type if available
            content_type = response.headers.get('Content-Type', '').lower()
            if 'html' in content_type and 'github.com' in normalized_url:
                # GitHub might return HTML for some URLs, try to detect
                if '<!DOCTYPE html>' in response.text[:200] or '<html' in response.text[:200]:
                    return jsonify({
                        "success": False,
                        "error": "URL returned HTML instead of file content. Make sure you're using a raw file URL (raw.githubusercontent.com) or the file is publicly accessible."
                    }), 400
            
            file_content = response.content
            
        except requests.exceptions.Timeout:
            return jsonify({"success": False, "error": "Request timed out. The file may be too large or the server is slow."}), 500
        except requests.exceptions.RequestException as e:
            return jsonify({"success": False, "error": f"Failed to fetch file: {str(e)}"}), 500
        
        # Save to temporary file
        prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
        suffix = ".textproto" if is_textproto else ".csv"
        with tempfile.NamedTemporaryFile(mode="w+b", suffix=suffix, delete=False, prefix=prefix) as tmp_file:
            tmp_file.write(file_content)
            tmp_file_path = tmp_file.name
        
        try:
            # Create visualizer instance
            visualizer = NetworkCablingCytoscapeVisualizer()
            
            if is_textproto:
                # Parse cabling descriptor textproto
                visualizer.file_format = "descriptor"
                
                try:
                    if not visualizer.parse_cabling_descriptor(tmp_file_path):
                        return jsonify({"success": False, "error": "Failed to parse cabling descriptor"})
                except ValueError as e:
                    return jsonify({"success": False, "error": str(e)})
                except Exception as e:
                    return jsonify({"success": False, "error": f"Error parsing cabling descriptor: {str(e)}"})
                
                # Get node types from hierarchy and initialize configs
                if visualizer.graph_hierarchy:
                    node_types = set(node['node_type'] for node in visualizer.graph_hierarchy)
                    
                    if node_types:
                        first_node_type = list(node_types)[0]
                        config = visualizer._node_descriptor_to_config(first_node_type)
                        visualizer.shelf_unit_type = visualizer._node_descriptor_to_shelf_type(first_node_type)
                        visualizer.current_config = config
                    else:
                        visualizer.shelf_unit_type = "wh_galaxy"
                        visualizer.current_config = visualizer.shelf_unit_configs["wh_galaxy"]
                    
                    visualizer.set_shelf_unit_type(visualizer.shelf_unit_type)
                    connection_count = len(visualizer.descriptor_connections) if visualizer.descriptor_connections else 0
                else:
                    connection_count = 0
            else:
                # Parse CSV file
                connections = visualizer.parse_csv(tmp_file_path)
                
                if not connections:
                    return jsonify({"success": False, "error": "No valid connections found in CSV file"})
                
                connection_count = len(connections)
            
            # Generate visualization data
            visualization_data = visualizer.generate_visualization_data()
            visualization_data["metadata"]["connection_count"] = connection_count
            
            # Check for unknown node types
            unknown_types = visualizer.get_unknown_node_types()
            if unknown_types:
                visualization_data["metadata"]["unknown_node_types"] = unknown_types
            
            file_type = "cabling descriptor" if is_textproto else "CSV"
            message = f"Successfully loaded {filename} from {parsed.netloc} ({file_type}) with {connection_count} {'nodes' if is_textproto else 'connections'}"
            
            return jsonify({
                "success": True,
                "data": visualization_data,
                "message": message,
                "unknown_types": unknown_types,
                "file_type": "textproto" if is_textproto else "csv",
            })
        
        finally:
            # Clean up temporary file
            try:
                os.unlink(tmp_file_path)
            except OSError:
                # Best-effort cleanup: it's safe to ignore failures when removing the temp file
                pass
        
    except Exception as e:
        error_msg = f"Error loading external file: {str(e)}"
        traceback.print_exc()
        return jsonify({"success": False, "error": error_msg}), 500


@app.route("/upload_csv", methods=["POST"])
def upload_csv():
    """Handle CSV file upload and generate visualization JSON"""
    try:
        # Check if file was uploaded
        if "csv_file" not in request.files:
            return jsonify({"success": False, "error": "No CSV file uploaded"})

        file = request.files["csv_file"]

        if file.filename == "":
            return jsonify({"success": False, "error": "No file selected"})

        # Accept both CSV and textproto files
        if not (file.filename.lower().endswith(".csv") or file.filename.lower().endswith(".textproto")):
            return jsonify({"success": False, "error": "File must be a CSV or textproto file"})

        is_textproto = file.filename.lower().endswith(".textproto")
        
        # Save uploaded file to temporary location with unique prefix
        prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
        suffix = ".textproto" if is_textproto else ".csv"
        with tempfile.NamedTemporaryFile(mode="w+b", suffix=suffix, delete=False, prefix=prefix) as tmp_file:
            file.save(tmp_file.name)
            tmp_file_path = tmp_file.name

        try:
            # Create visualizer instance
            visualizer = NetworkCablingCytoscapeVisualizer()

            if is_textproto:
                # Parse cabling descriptor textproto
                visualizer.file_format = "descriptor"  # Set format before parsing
                
                try:
                    if not visualizer.parse_cabling_descriptor(tmp_file_path):
                        return jsonify({"success": False, "error": "Failed to parse cabling descriptor"})
                except ValueError as e:
                    # Catch validation errors (e.g., missing host_id mappings)
                    return jsonify({"success": False, "error": str(e)})
                except Exception as e:
                    # Catch any other parsing errors
                    return jsonify({"success": False, "error": f"Error parsing cabling descriptor: {str(e)}"})
                
                # Get node types from hierarchy and initialize configs
                if visualizer.graph_hierarchy:
                    # Extract unique node types
                    node_types = set(node['node_type'] for node in visualizer.graph_hierarchy)
                    
                    # Set shelf unit type from first node (or default)
                    if node_types:
                        first_node_type = list(node_types)[0]
                        config = visualizer._node_descriptor_to_config(first_node_type)
                        # Use the mapping from _node_descriptor_to_shelf_type to get correct shelf unit type
                        # E.g., "N300_LB_DEFAULT" → "n300_lb"
                        visualizer.shelf_unit_type = visualizer._node_descriptor_to_shelf_type(first_node_type)
                        visualizer.current_config = config
                    else:
                        visualizer.shelf_unit_type = "wh_galaxy"
                        visualizer.current_config = visualizer.shelf_unit_configs["wh_galaxy"]
                    
                    # Initialize templates for descriptor format
                    visualizer.set_shelf_unit_type(visualizer.shelf_unit_type)
                    
                    # Count connections from descriptor
                    connection_count = len(visualizer.descriptor_connections) if visualizer.descriptor_connections else 0
                else:
                    connection_count = 0
                    
            else:
                # Parse CSV file (auto-detects format and node types)
                connections = visualizer.parse_csv(tmp_file_path)

                if not connections:
                    return jsonify({"success": False, "error": "No valid connections found in CSV file"})
                
                connection_count = len(connections)

            # Generate the complete visualization data structure
            visualization_data = visualizer.generate_visualization_data()

            # Add metadata
            visualization_data["metadata"]["connection_count"] = connection_count

            # Check for unknown node types and add to metadata
            unknown_types = visualizer.get_unknown_node_types()
            if unknown_types:
                visualization_data["metadata"]["unknown_node_types"] = unknown_types

            # Create response data
            response_data = visualization_data
            
            file_type = "cabling descriptor" if is_textproto else "CSV"
            message = f"Successfully processed {file.filename} ({file_type}) with {connection_count} {'nodes' if is_textproto else 'connections'}"

            return jsonify(
                {
                    "success": True,
                    "data": response_data,
                    "message": message,
                    "unknown_types": unknown_types,
                    "file_type": "textproto" if is_textproto else "csv",
                }
            )

        finally:
            # Clean up temporary file
            try:
                os.unlink(tmp_file_path)
            except OSError:
                pass  # Ignore cleanup errors

    except Exception as e:
        error_msg = f"Error processing file: {str(e)}"
        traceback.print_exc()  # Print full traceback for debugging
        return jsonify({"success": False, "error": error_msg})


@app.route("/export_cabling_descriptor", methods=["POST"])
def export_cabling_descriptor():
    """Export ClusterDescriptor from cytoscape visualization data
    
    IMPORTANT: Cabling descriptor export is based ONLY on hierarchy/topology information:
    - hostname, node_type, logical_path, template_name, child_name, connections
    - Physical location fields (hall, aisle, rack, shelf_u) are NEVER used
    """
    if not EXPORT_AVAILABLE:
        return jsonify({"success": False, "error": "Export functionality not available. Missing dependencies."}), 500

    try:
        # Get cytoscape data from request
        cytoscape_data = request.get_json()
        if not cytoscape_data or "elements" not in cytoscape_data:
            return jsonify({"success": False, "error": "Invalid cytoscape data"}), 400

        # Debug: Check if edges are present
        elements = cytoscape_data.get("elements", [])
        nodes = [el for el in elements if "source" not in el.get("data", {})]
        edges = [el for el in elements if "source" in el.get("data", {})]
        print(f"[EXPORT_CABLING] Received {len(nodes)} nodes and {len(edges)} edges")
        
        # Generate textproto content (based on hierarchy information only)
        textproto_content = export_cabling_descriptor_for_visualizer(cytoscape_data)

        # Return as plain text for download
        return Response(
            textproto_content,
            mimetype="text/plain",
            headers={"Content-Disposition": "attachment; filename=cabling_descriptor.textproto"},
        )

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/export_flat_cabling_descriptor", methods=["POST"])
def export_flat_cabling_descriptor_route():
    """Export CablingDescriptor using flat structure (extracted_topology template)
    
    This is used for CSV imports in location mode where there's no hierarchical structure.
    Creates a single "extracted_topology" template with all shelves as direct children.
    """
    if not EXPORT_AVAILABLE:
        return jsonify({"success": False, "error": "Export functionality not available. Missing dependencies."}), 500

    try:
        # Get cytoscape data from request
        cytoscape_data = request.get_json()
        if not cytoscape_data or "elements" not in cytoscape_data:
            return jsonify({"success": False, "error": "Invalid cytoscape data"}), 400

        # Debug: Check if edges are present
        elements = cytoscape_data.get("elements", [])
        nodes = [el for el in elements if "source" not in el.get("data", {})]
        edges = [el for el in elements if "source" in el.get("data", {})]
        print(f"[EXPORT_FLAT_CABLING] Received {len(nodes)} nodes and {len(edges)} edges")
        
        # Generate textproto content using flat export (extracted_topology template)
        textproto_content = export_flat_cabling_descriptor(cytoscape_data)

        # Return as plain text for download
        return Response(
            textproto_content,
            mimetype="text/plain",
            headers={"Content-Disposition": "attachment; filename=cabling_descriptor.textproto"},
        )

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/export_deployment_descriptor", methods=["POST"])
def export_deployment_descriptor():
    """Export DeploymentDescriptor from cytoscape visualization data"""
    try:
        # Get cytoscape data from request
        cytoscape_data = request.get_json()
        if not cytoscape_data or "elements" not in cytoscape_data:
            return jsonify({"success": False, "error": "Invalid cytoscape data"}), 400

        # Generate textproto content
        textproto_content = export_deployment_descriptor_for_visualizer(cytoscape_data)

        # Return as plain text for download
        return Response(
            textproto_content,
            mimetype="text/plain",
            headers={"Content-Disposition": "attachment; filename=deployment_descriptor.textproto"},
        )

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/apply_deployment_descriptor", methods=["POST"])
def apply_deployment_descriptor():
    """Apply deployment descriptor to existing visualization (add physical location info)
    
    This endpoint is used when:
    1. User has already loaded a cabling descriptor (logical topology) in the Topology tab
    2. User wants to add physical location information by uploading a deployment descriptor
    
    IMPORTANT: The cabling descriptor and deployment descriptor are tightly coupled by index:
    - Cabling descriptor assigns host_id (0, 1, 2, ...) to each host via child_mappings
    - Deployment descriptor lists hosts in array order: hosts[0], hosts[1], hosts[2], ...
    - host_id N in cabling descriptor MUST correspond to hosts[N] in deployment descriptor
    
    This function:
    1. Parses deployment descriptor and builds map: host_id -> location info (indexed by array position)
    2. Matches shelf nodes by their host_index/host_id field (set during cabling descriptor import)
    3. Updates shelf nodes with physical location fields (hall, aisle, rack_num, shelf_u)
    4. Validates that hostnames match between descriptors (warning only, uses host_id for mapping)
    """
    if not EXPORT_AVAILABLE:
        return jsonify({"success": False, "error": "Export functionality not available. Missing dependencies."}), 500
    
    try:
        # Check if file was uploaded
        if "deployment_file" not in request.files:
            return jsonify({"success": False, "error": "No deployment descriptor file uploaded"})
        
        file = request.files["deployment_file"]
        
        if file.filename == "":
            return jsonify({"success": False, "error": "No file selected"})
        
        if not file.filename.lower().endswith(".textproto"):
            return jsonify({"success": False, "error": "File must be a textproto file"})
        
        # Get the current cytoscape data from the form
        cytoscape_json = request.form.get("cytoscape_data")
        if not cytoscape_json:
            return jsonify({"success": False, "error": "No cytoscape data provided"}), 400
        
        cytoscape_data = json.loads(cytoscape_json)
        if not cytoscape_data or "elements" not in cytoscape_data:
            return jsonify({"success": False, "error": "Invalid cytoscape data"}), 400
        
        # Save uploaded file to temporary location
        prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
        with tempfile.NamedTemporaryFile(mode="w+b", suffix=".textproto", delete=False, prefix=prefix) as tmp_file:
            file.save(tmp_file.name)
            tmp_file_path = tmp_file.name
        
        try:
            # Parse deployment descriptor
            from export_descriptors import deployment_pb2
            from google.protobuf import text_format
            
            with open(tmp_file_path, 'r') as f:
                textproto_content = f.read()
            
            deployment_desc = deployment_pb2.DeploymentDescriptor()
            text_format.Parse(textproto_content, deployment_desc)
            
            # CRITICAL: Build a map of host_id -> location info
            # The deployment descriptor hosts list is indexed: hosts[0], hosts[1], hosts[2], etc.
            # These indices MUST correspond to the host_id values in the cabling descriptor
            # i.e., host_id=0 in cabling descriptor → hosts[0] in deployment descriptor
            location_map = {}
            hostname_map = {}  # Also track by hostname for validation/warnings
            
            for host_id, host in enumerate(deployment_desc.hosts):
                hostname = host.host.strip() if host.host else ""
                location_info = {
                    "hall": host.hall if host.hall else "",
                    "aisle": host.aisle if host.aisle else "",
                    "rack_num": host.rack if host.rack else 0,
                    "shelf_u": host.shelf_u if host.shelf_u else 0,
                    "hostname": hostname,  # Store hostname for validation
                }
                
                # Map by host_id (index in deployment descriptor)
                location_map[host_id] = location_info
                
                # Also track by hostname for validation
                if hostname:
                    hostname_map[hostname] = host_id
            
            # Update shelf nodes in cytoscape data with location information
            # Match by host_index/host_id field (from cabling descriptor import)
            updated_count = 0
            mismatches = []  # Track hostname mismatches for validation
            missing_host_ids = []  # Track host_ids not found in deployment descriptor
            
            for element in cytoscape_data.get("elements", []):
                # Skip edges
                if "source" in element.get("data", {}):
                    continue
                
                node_data = element.get("data", {})
                node_type = node_data.get("type")
                
                # Only update shelf nodes
                if node_type == "shelf":
                    # Get host_id from shelf node (set during cabling descriptor import)
                    # Try both field names for compatibility
                    host_id = node_data.get("host_index")
                    if host_id is None:
                        host_id = node_data.get("host_id")
                    
                    if host_id is not None and host_id in location_map:
                        # Update ALL physical/deployment fields using the indexed mapping
                        location = location_map[host_id]
                        
                        # Physical location fields
                        node_data["hall"] = location["hall"]
                        node_data["aisle"] = location["aisle"]
                        node_data["rack_num"] = location["rack_num"]
                        node_data["shelf_u"] = location["shelf_u"]
                        
                        # Hostname (CRITICAL: hostname is a deployment property, not logical)
                        # The cabling descriptor should NOT set hostnames - they come from deployment descriptor
                        deploy_hostname = location["hostname"]
                        if deploy_hostname:
                            viz_hostname = node_data.get("hostname", "").strip()
                            if viz_hostname and viz_hostname != deploy_hostname:
                                # Track mismatch for warning (but still apply the deployment descriptor hostname)
                                mismatches.append({
                                    "host_id": host_id,
                                    "viz_hostname": viz_hostname,
                                    "deploy_hostname": deploy_hostname
                                })
                            # Always use hostname from deployment descriptor
                            node_data["hostname"] = deploy_hostname
                        
                        updated_count += 1
                    elif host_id is not None:
                        missing_host_ids.append(host_id)
            
            # Prepare response message with validation info
            message = f"Successfully applied deployment descriptor to {updated_count} hosts"
            warnings = []
            
            if missing_host_ids:
                warnings.append(f"{len(missing_host_ids)} host_id(s) from visualization not found in deployment descriptor: {missing_host_ids[:5]}")
            
            if mismatches:
                warnings.append(f"{len(mismatches)} hostname mismatches detected (host_id mapping used, but hostnames differ)")
                for mismatch in mismatches[:3]:  # Show first 3 mismatches
                    warnings.append(f"  host_id={mismatch['host_id']}: viz='{mismatch['viz_hostname']}' vs deploy='{mismatch['deploy_hostname']}'")
            
            if warnings:
                message += "<br><strong>⚠️ Warnings:</strong><br>" + "<br>".join(warnings)
            
            return jsonify({
                "success": True,
                "data": cytoscape_data,
                "message": message,
                "updated_count": updated_count,
                "mismatches": mismatches,
                "missing_host_ids": missing_host_ids,
            })
        
        finally:
            # Clean up temporary file
            try:
                os.unlink(tmp_file_path)
            except OSError:
                pass
    
    except Exception as e:
        error_msg = f"Error applying deployment descriptor: {str(e)}"
        traceback.print_exc()
        return jsonify({"success": False, "error": error_msg}), 500


def _validate_shelf_hostnames(cytoscape_data):
    """Check if ALL shelf nodes have hostnames. Raises ValueError if any are missing."""
    elements = cytoscape_data.get("elements", [])
    
    shelf_nodes = []
    missing_hostname_nodes = []
    
    for element in elements:
        # Skip edges
        if "source" in element.get("data", {}):
            continue
        
        node_data = element.get("data", {})
        node_type = node_data.get("type")
        
        # Collect all shelf nodes
        if node_type == "shelf":
            shelf_nodes.append(node_data)
            
            # Check if hostname is missing or empty
            hostname = node_data.get("label") or node_data.get("id") or ""
            if not hostname.strip():
                node_id = node_data.get("id", "unknown")
                missing_hostname_nodes.append(node_id)
    
    if missing_hostname_nodes:
        raise ValueError(
            f"Cabling guide generation requires all shelf nodes to have hostnames. "
            f"Missing hostnames for {len(missing_hostname_nodes)} node(s): {', '.join(missing_hostname_nodes[:5])}"
            + (f" and {len(missing_hostname_nodes) - 5} more..." if len(missing_hostname_nodes) > 5 else "")
        )
    
    if not shelf_nodes:
        raise ValueError("No shelf nodes found in the graph")


def _has_location_info(cytoscape_data):
    """Check if ALL shelf nodes have location information (hall/aisle/rack/shelf)"""
    elements = cytoscape_data.get("elements", [])
    
    shelf_nodes = []
    for element in elements:
        # Skip edges
        if "source" in element.get("data", {}):
            continue
        
        node_data = element.get("data", {})
        node_type = node_data.get("type")
        
        # Collect all shelf nodes
        if node_type == "shelf":
            shelf_nodes.append(node_data)
    
    # If no shelf nodes, return False (no location info)
    if not shelf_nodes:
        return False
    
    # Check that ALL shelf nodes have location information
    for node_data in shelf_nodes:
        hall = node_data.get("hall")
        aisle = node_data.get("aisle")
        rack_num = node_data.get("rack_num")
        shelf_u = node_data.get("shelf_u")
        
        # If this node is missing location info, return False
        has_location = all([
            hall and str(hall).strip(),
            aisle and str(aisle).strip(),
            rack_num is not None and str(rack_num).strip() != '',
            shelf_u is not None and str(shelf_u).strip() != ''
        ])
        
        if not has_location:
            return False
    
    # All nodes have location info
    return True


@app.route("/generate_cabling_guide", methods=["POST"])
def generate_cabling_guide():
    """Generate CablingGuide CSV and/or FSD using the cabling generator
    
    IMPORTANT: The cabling guide generation uses:
    - CablingDescriptor: ALWAYS uses flat export (extracted_topology template) regardless of hierarchy
      This avoids "multiple root nodes" errors and provides a simpler structure for the cabling generator
    - DeploymentDescriptor: Uses physical location information (hall, aisle, rack, shelf_u) when available
    
    The --simple flag is set based on whether location information exists in the DeploymentDescriptor.
    """
    import subprocess
    import tempfile
    import os
    from pathlib import Path

    try:
        # Get request data
        data = request.get_json()
        if not data or "cytoscape_data" not in data or "input_prefix" not in data:
            return jsonify({"success": False, "error": "Invalid request data"}), 400

        cytoscape_data = data["cytoscape_data"]
        input_prefix = data["input_prefix"]
        generate_type = data.get("generate_type", "both")  # 'cabling_guide', 'fsd', or 'both'
        
        # Validate that all shelf nodes have hostnames - will raise ValueError if not
        _validate_shelf_hostnames(cytoscape_data)
        
        # Check if location information is present (for deployment descriptor)
        # This only affects the output format of the cabling guide (detailed vs simple)
        # It does NOT affect the cabling descriptor which is always based on hierarchy
        has_location = _has_location_info(cytoscape_data)
        use_simple_format = not has_location

        # Generate temporary files for descriptors with unique prefixes
        prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".textproto", delete=False, prefix=prefix) as cabling_file:
            # Cabling descriptor: Always use flat export for cabling guide generation
            # This avoids "multiple root nodes" errors and provides a simpler structure
            cabling_content = export_flat_cabling_descriptor(cytoscape_data)
            cabling_file.write(cabling_content)
            cabling_path = cabling_file.name

        with tempfile.NamedTemporaryFile(mode="w", suffix=".textproto", delete=False, prefix=prefix) as deployment_file:
            # Deployment descriptor: Uses physical location information when available
            deployment_content = export_deployment_descriptor_for_visualizer(cytoscape_data)
            deployment_file.write(deployment_content)
            deployment_path = deployment_file.name

        try:
            # Get TT_METAL_HOME environment variable
            tt_metal_home = os.environ.get("TT_METAL_HOME")
            if not tt_metal_home:
                return jsonify({"success": False, "error": "TT_METAL_HOME environment variable not set"}), 500

            # Path to the cabling generator executable
            generator_path = os.path.join(tt_metal_home, "build", "tools", "scaleout", "run_cabling_generator")

            if not os.path.exists(generator_path):
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": f"Cabling generator not found at {generator_path}. Make sure to run ./build_metal.sh on the server first.",
                        }
                    ),
                    500,
                )

            # Create temporary output directory with unique prefix
            prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
            with tempfile.TemporaryDirectory(prefix=prefix) as temp_output_dir:
                # Don't change directory - let the C++ tool create out/scaleout in temp_output_dir
                # We'll pass the temp_output_dir as working directory to subprocess
                
                try:
                    # Run the cabling generator with proper command-line flags
                    cmd = [
                        generator_path,
                        "-c", os.path.abspath(cabling_path),      # -c, --cluster
                        "-d", os.path.abspath(deployment_path),  # -d, --deployment  
                        "-o", input_prefix                          # -o, --output
                    ]
                    
                    # Add --simple flag if no location information is present
                    if use_simple_format:
                        cmd.append("--simple")
                        print(f"[INFO] No location information detected - using simple format")
                    else:
                        print(f"[INFO] Location information detected - using hierarchical format")
                    
                    print(f"Running command: {' '.join(cmd)}")  # Debug logging
                    print(f"Working directory: {temp_output_dir}")  # Debug logging

                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=temp_output_dir)

                    if result.returncode != 0:
                        # Enhanced error reporting with both stdout and stderr
                        error_details = []
                        if result.stdout:
                            error_details.append(f"STDOUT: {result.stdout}")
                        if result.stderr:
                            error_details.append(f"STDERR: {result.stderr}")
                        
                        error_message = f"Cabling generator failed (exit code {result.returncode})"
                        if error_details:
                            error_message += f"\n\nDetails:\n" + "\n".join(error_details)
                        
                        return jsonify({
                            "success": False, 
                            "error": error_message,
                            "error_type": "generation_failed",
                            "exit_code": result.returncode,
                            "stdout": result.stdout,
                            "stderr": result.stderr
                        }), 500

                    # Look for generated files in the temp output directory
                    output_dir = Path(temp_output_dir) / "out" / "scaleout"
                    cabling_guide_path = output_dir / f"cabling_guide_{input_prefix}.csv"
                    fsd_path = output_dir / f"factory_system_descriptor_{input_prefix}.textproto"

                    # Prepare response based on generate_type
                    response_data = {"success": True}

                    if generate_type in ["cabling_guide", "both"]:
                        if not cabling_guide_path.exists():
                            return jsonify({
                                "success": False, 
                                "error": f"Cabling guide file not found at {cabling_guide_path}",
                                "error_type": "file_not_found",
                                "expected_path": str(cabling_guide_path)
                            }), 500
                        try:
                            cabling_content = cabling_guide_path.read_text()
                            response_data["cabling_guide_content"] = cabling_content
                            response_data["cabling_guide_filename"] = f"cabling_guide_{input_prefix}.csv"
                        except Exception as e:
                            return jsonify({
                                "success": False, 
                                "error": f"Failed to read cabling guide file: {str(e)}",
                                "error_type": "file_read_error"
                            }), 500

                    if generate_type in ["fsd", "both"]:
                        if not fsd_path.exists():
                            return jsonify({
                                "success": False, 
                                "error": f"FSD file not found at {fsd_path}",
                                "error_type": "file_not_found",
                                "expected_path": str(fsd_path)
                            }), 500
                        try:
                            fsd_content = fsd_path.read_text()
                            response_data["fsd_content"] = fsd_content
                            response_data["fsd_filename"] = f"factory_system_descriptor_{input_prefix}.textproto"
                        except Exception as e:
                            return jsonify({
                                "success": False, 
                                "error": f"Failed to read FSD file: {str(e)}",
                                "error_type": "file_read_error"
                            }), 500

                    return jsonify(response_data)

                except subprocess.TimeoutExpired as e:
                    return jsonify({
                        "success": False,
                        "error": f"Cabling generator timed out after 60 seconds",
                        "error_type": "timeout",
                        "command": ' '.join(cmd)
                    }), 500
                except Exception as e:
                    return jsonify({
                        "success": False,
                        "error": f"Failed to run cabling generator: {str(e)}",
                        "error_type": "execution_error",
                        "command": ' '.join(cmd)
                    }), 500

                finally:
                    pass  # No need to change directory back since we used cwd parameter

        finally:
            # Clean up temporary descriptor files
            try:
                os.unlink(cabling_path)
                os.unlink(deployment_path)
            except:
                pass

    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "Cabling generator timed out"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/favicon.ico")
def favicon():
    """Serve favicon"""
    import hashlib
    response = send_from_directory("static/img", "favicon.ico")
    
    # Generate ETag for cache validation
    try:
        file_path = os.path.join("static", "img", "favicon.ico")
        if os.path.exists(file_path):
            stat = os.stat(file_path)
            etag = hashlib.md5(f"{stat.st_mtime}-{stat.st_size}".encode()).hexdigest()
            response.set_etag(etag)
    except Exception:
        pass
    
    # Add cache headers - allow caching but require revalidation
    response.cache_control.max_age = 3600  # 1 hour
    response.cache_control.public = True
    response.cache_control.must_revalidate = True
    return response


@app.route("/static/<path:filename>")
def static_files(filename):
    """Serve static files if needed"""
    import hashlib
    response = send_from_directory("static", filename)
    
    # Generate ETag based on file content for better cache validation
    try:
        file_path = os.path.join("static", filename)
        if os.path.exists(file_path):
            # Generate ETag from file modification time and size
            stat = os.stat(file_path)
            etag = hashlib.md5(f"{stat.st_mtime}-{stat.st_size}".encode()).hexdigest()
            response.set_etag(etag)
    except Exception:
        pass
    
    # Add cache headers - allow caching but require revalidation
    # This ensures browsers check for updates regularly
    response.cache_control.max_age = 3600  # 1 hour (reduced from 1 day for faster updates)
    response.cache_control.public = True
    response.cache_control.must_revalidate = True
    return response


@app.route("/api/node_configs", methods=["GET"])
def get_node_configs():
    """Get node configurations from Python side to ensure consistency"""
    try:
        # Create a visualizer instance to get the configurations
        visualizer = NetworkCablingCytoscapeVisualizer()

        # Convert Python configs to JavaScript format
        node_configs = {}
        for node_type, config in visualizer.shelf_unit_configs.items():
            # Convert Python config to JavaScript format
            js_config = {
                "tray_count": config["tray_count"],
                "ports_per_tray": config["port_count"],
                "tray_layout": config["tray_layout"],
            }
            # Convert to uppercase for JavaScript (e.g., 'wh_galaxy' -> 'WH_GALAXY')
            node_configs[node_type.upper()] = js_config

        return jsonify({"success": True, "node_configs": node_configs})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def main():
    """Main function with command line argument parsing"""
    parser = argparse.ArgumentParser(description="Network Cabling Visualizer Web Server")
    parser.add_argument("-p", "--port", type=int, default=5000, help="Port number to run the server on (default: 5000)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address to bind to (default: 0.0.0.0)")
    parser.add_argument("--debug", action="store_true", help="Run in debug mode (default: enabled)")
    parser.add_argument("--no-debug", dest="debug", action="store_false", help="Disable debug mode")
    parser.set_defaults(debug=True)

    args = parser.parse_args()

    print("Starting Network Cabling Visualizer Server...")
    print(f"Access the application at: http://localhost:{args.port}")
    if args.debug:
        print("Debug mode: ENABLED")
    print("Press Ctrl+C to stop the server")

    # Run Flask development server with explicit threading configuration
    # Note: Flask development server uses threading by default, but we make it explicit
    # for multi-user safety. Each request runs in its own thread with isolated state.
    app.run(debug=args.debug, host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
