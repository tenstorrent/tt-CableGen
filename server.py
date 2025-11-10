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
from flask import Flask, request, jsonify, render_template, send_from_directory, Response
import traceback

# Add the parent directory to sys.path to import our modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import our existing templating system
from import_cabling import NetworkCablingCytoscapeVisualizer

# Import export functionality
try:
    # Test if export functionality is available
    from export_descriptors import export_cabling_descriptor_for_visualizer, export_deployment_descriptor_for_visualizer

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

        return render_template("index.html", node_configs=node_configs)

    except Exception as e:
        # Fallback to template without configs if there's an error
        return render_template("index.html", node_configs={})


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

        if not file.filename.lower().endswith(".csv"):
            return jsonify({"success": False, "error": "File must be a CSV file"})

        # Save uploaded file to temporary location with unique prefix
        prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
        with tempfile.NamedTemporaryFile(mode="w+b", suffix=".csv", delete=False, prefix=prefix) as tmp_file:
            file.save(tmp_file.name)
            tmp_csv_path = tmp_file.name

        try:
            # Create visualizer instance and process the CSV (auto-detects format and node types)
            visualizer = NetworkCablingCytoscapeVisualizer()

            # Parse CSV file (this will auto-detect format and node types)
            connections = visualizer.parse_csv(tmp_csv_path)

            if not connections:
                return jsonify({"success": False, "error": "No valid connections found in CSV file"})

            # Generate the complete visualization data structure
            visualization_data = visualizer.generate_visualization_data()

            # Add metadata
            visualization_data["metadata"]["connection_count"] = len(connections)

            # Check for unknown node types and add to metadata
            unknown_types = visualizer.get_unknown_node_types()
            if unknown_types:
                visualization_data["metadata"]["unknown_node_types"] = unknown_types

            # Create response data
            response_data = visualization_data

            return jsonify(
                {
                    "success": True,
                    "data": response_data,
                    "message": f"Successfully processed {file.filename} with {len(connections)} connections",
                    "unknown_types": unknown_types,
                }
            )

        finally:
            # Clean up temporary file
            try:
                os.unlink(tmp_csv_path)
            except OSError:
                pass  # Ignore cleanup errors

    except Exception as e:
        error_msg = f"Error processing CSV: {str(e)}"
        return jsonify({"success": False, "error": error_msg})


@app.route("/export_cabling_descriptor", methods=["POST"])
def export_cabling_descriptor():
    """Export ClusterDescriptor from cytoscape visualization data"""
    if not EXPORT_AVAILABLE:
        return jsonify({"success": False, "error": "Export functionality not available. Missing dependencies."}), 500

    try:
        # Get cytoscape data from request
        cytoscape_data = request.get_json()
        if not cytoscape_data or "elements" not in cytoscape_data:
            return jsonify({"success": False, "error": "Invalid cytoscape data"}), 400

        # Generate textproto content
        textproto_content = export_cabling_descriptor_for_visualizer(cytoscape_data)

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
    """Generate CablingGuide CSV and/or FSD using the cabling generator"""
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
        
        # Check if location information is present
        has_location = _has_location_info(cytoscape_data)
        use_simple_format = not has_location

        # Generate temporary files for descriptors with unique prefixes
        prefix = f"cablegen_{int(time.time())}_{threading.get_ident()}_"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".textproto", delete=False, prefix=prefix) as cabling_file:
            cabling_content = export_cabling_descriptor_for_visualizer(cytoscape_data)
            cabling_file.write(cabling_content)
            cabling_path = cabling_file.name

        with tempfile.NamedTemporaryFile(mode="w", suffix=".textproto", delete=False, prefix=prefix) as deployment_file:
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


@app.route("/static/<path:filename>")
def static_files(filename):
    """Serve static files if needed"""
    return send_from_directory("static", filename)


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
