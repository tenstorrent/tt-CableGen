# Network Cabling Visualizer

A web-based interactive tool for visualizing, creating, and managing network topology and cabling configurations for data center infrastructure.

## Overview

The Network Cabling Visualizer is a Flask-based web application that provides an intuitive interface for working with network cabling configurations. It enables users to visualize existing network topologies, create new ones from scratch, modify configurations interactively, and export results in multiple industry-standard formats.

## Key Features

### Visualization Capabilities

- **Interactive Graph Visualization**: Pan, zoom, and explore network topologies using Cytoscape.js
- **Hierarchical Node Structure**: Supports nested compound nodes representing:
  - Racks → Shelves → Trays → Ports (location mode)
  - Graph Templates → Graph Instances → Shelves → Trays → Ports (hierarchy mode)
- **Dual Visualization Modes**:
  - **Location Mode**: Physical layout view organized by rack locations (Hall/Aisle/Rack/Shelf)
  - **Hierarchy Mode**: Logical topology view with hierarchical groupings (Graph Templates/Instances)
- **Visual Feedback**: Color-coded connections, port status indicators, and connection legends
- **Collapsible Nodes**: Expand/collapse rack and graph compound nodes to manage visual complexity

### Import Capabilities

#### CSV Format Support
The visualizer supports multiple CSV format variations:

1. **Hierarchical CSV** (with location information):
   - Columns: `hostname`, `hall`, `aisle`, `rack_num`, `shelf_u`, `tray`, `port`, `cable_type`, `cable_length`, `dest_hostname`, `dest_hall`, `dest_aisle`, `dest_rack_num`, `dest_shelf_u`, `dest_tray`, `dest_port`
   - Organizes nodes by physical data center location

2. **Hostname-based CSV** (simplified):
   - Columns: `hostname`, `tray`, `port`, `cable_type`, `cable_length`, `dest_hostname`, `dest_tray`, `dest_port`
   - Useful when location information is not available or not required

3. **Minimal CSV** (basic connections/limited support):
   - Supports even simpler formats with auto-detection of column headers
   - Will attempt to parse source/destination host properties and (and tray, port endpoints for connections)
   - Auto-configures missing cable information with defaults

#### TextProto Format Support
- **Cabling Descriptor**: Protocol buffer text format defining cluster topology
  - Supports hierarchical graph structures with templates and instances
  - Defines node types, connections, and network topology
  - Enables reuse of common topology patterns through templates
  - See ![TT-Metal Scaleout tools ](https://github.com/tenstorrent/tt-metal/tree/main/tools/scaleout) for more info

The parser auto-detects file format and node types, making it easy to work with various input sources.

### Export Capabilities

#### 1. Cabling Descriptor Export
Exports the current visualization as a `CablingDescriptor` textproto file:
- Preserves hierarchical graph structure (in hierarchy mode)
- Exports flat structure with all hosts at root level (in location mode)
- Includes all node configurations, connections, and metadata
- Can be re-imported for round-trip editing

#### 2. Deployment Descriptor Export
Exports a `DeploymentDescriptor` textproto file:
- Lists all hosts with their physical locations (Hall/Aisle/Rack/Shelf)
- Used in conjunction with CablingDescriptor for complete system definition
- Required input for cabling guide generation

#### 3. Cabling Guide Generation
Generates production-ready cabling documentation:
- **Cabling Guide CSV**: Detailed connection instructions for datacenter technicians
  - Two format options:
    - **Detailed format** (with location info): Includes Hall/Aisle/Rack/Shelf for each endpoint
    - **Simple format** (hostname-based): Uses hostnames only when location unavailable
  - Auto-detects which format to use based on available data
- **Factory System Descriptor (FSD)**: Complete system specification textproto
- Requires TT-Metal repo to be on system and specified through `TT_METAL_HOME` environment variable

### Interactive Editing Features

#### Create From Scratch
- **Empty Canvas Mode**: Start with a blank canvas and build topology manually
- **Add Nodes**: Create new shelf nodes with specified:
  - Node type (hardware configuration)
  - Hostname
  - Optional location information (Hall, Aisle, Rack, Shelf)
- **Add Graph Instances**: In hierarchy mode, instantiate graph templates

#### Connection Management
- **Visual Connection Creation**:
  - Enable editing mode
  - Click first port (source)
  - Click second port (target)
  - Connection automatically created with configurable properties
- **Connection Properties**: Edit cable type and length for each connection
- **Connection Deletion**: Select and delete connections using UI or keyboard shortcuts

#### Node Editing
- **Shelf Node Editing**: Double-click shelf nodes to edit:
  - Hostname
  - Location information (Hall, Aisle, Rack number, Shelf U)
  - Node type
- **Node Deletion**: Delete individual shelf nodes, entire racks, or graph instances
- **Drag and Position**: Move nodes and compound structures around the canvas

#### Port Management
- **Port Status Visualization**: 
  - Connected ports shown in default color
  - Unconnected ports highlighted in orange (in edit mode)
  - Selected ports shown with distinct styling
- **Port Information Display**: Click ports to view connection details and metadata

### Supported Hardware Types

The visualizer supports a wide range of Tenstorrent hardware configurations:

#### Wormhole Series
- **WH_GALAXY**: 4 trays, 6 ports per tray
- **WH_GALAXY_X_TORUS**: WH_GALAXY with X-axis torus topology
- **WH_GALAXY_Y_TORUS**: WH_GALAXY with Y-axis torus topology  
- **WH_GALAXY_XY_TORUS**: WH_GALAXY with full torus topology

- **N300_LB**: 4 trays, 2 ports per tray, horizontal layout (blank/no connectiviy and default connectivity)
- **N300_QB**: 4 trays, 2 ports per tray, horizontal layout (blank/no connectiviy and default connectivity)

#### Blackhole Series
- **BH_GALAXY**: 4 trays, 14 ports per tray
- **BH_GALAXY_X_TORUS**: BH_GALAXY with X-axis torus topology
- **BH_GALAXY_Y_TORUS**: BH_GALAXY with Y-axis torus topology
- **BH_GALAXY_XY_TORUS**: BH_GALAXY with full torus topology

- **P150_LB**: 8 trays, 4 ports per tray
- **P150_QB_AMERICA**: 4 trays, 4 ports per tray, horizontal layout
- **P150_QB_GLOBAL**: 4 trays, 4 ports per tray, horizontal layout
- **P150_QB_AE**: P150 QB AE configuration
- **P150_QB_AE_DEFAULT**: Default P150 QB AE configuration

Each node type has a predefined configuration specifying:
- Number of trays
- Ports per tray
- Physical layout orientation (horizontal/vertical)
- Default spacing and dimensions

## Architecture

### Backend (Python/Flask)
- **`server.py`**: Flask web server providing REST API endpoints
- **`import_cabling.py`**: Core visualization engine with CSV and textproto parsing
- **`export_descriptors.py`**: Export logic for generating descriptors and cabling guides

### Frontend (JavaScript)
- **`visualizer.js`**: Client-side application logic
  - Cytoscape.js integration and graph management
  - Interactive editing features
  - Event handling and UI updates
  - Export/import coordination
- **`index.html`**: Web interface template
  - Upload section for file imports
  - Control panels for editing operations
  - Information displays for node/connection details
  - Export controls with customizable filenames

### External Integration
- **C++ Cabling Generator**: Backend tool for generating production cabling guides
  - Invoked via subprocess from Flask server
  - Requires `TT_METAL_HOME` environment variable
  - Generates both CSV cabling guides and Factory System Descriptors

## Installation and Setup

### Prerequisites
- Python 3.7+
- Flask 3.0.2
- Werkzeug 3.0.1
- protobuf 3.20.0
- TT_METAL_HOME environment variable (for cabling guide generation)
- Compiled cabling generator at `$TT_METAL_HOME/build/tools/scaleout/run_cabling_generator`

### Installation

1. **Install Python dependencies**:
```bash
pip install -r requirements.txt
```

2. **Set up environment** (for cabling guide generation):
```bash
export TT_METAL_HOME=/path/to/tt-metal
# Ensure the cabling generator is built:
# cd $TT_METAL_HOME && ./build_metal.sh
```

3. **Run the server**:
```bash
python server.py
```

The server will start on `http://localhost:5000` by default.

### Command Line Options

```bash
python server.py [OPTIONS]

Options:
  -p, --port PORT          Port number to run the server on (default: 5000)
  --host HOST             Host address to bind to (default: 0.0.0.0)
  --debug                 Run in debug mode (default: enabled)
  --no-debug              Disable debug mode
```

### Docker Deployment

The project includes Docker support with two configurations:

#### Local Development (No Authentication)
```bash
make build-local     # Build Docker images
make up-local        # Start services
make logs-local      # View logs
make shell-local     # Open shell in container
make down-local      # Stop services
```

#### Production (With OAuth2 Authentication)
```bash
make setup          # Create .env from template
# Edit .env with OAuth2 configuration
make build          # Build all services
make up             # Start with nginx + OAuth2
make logs           # View logs
make down           # Stop services
```

## Usage Guide

### Starting the Server

```bash
python server.py --port 5000
```

Open your browser to `http://localhost:5000`

### Importing Network Topology

#### Option 1: Upload CSV or TextProto File
1. Click **"Choose File"** or drag and drop file onto upload area
2. Select a `.csv` or `.textproto` file
3. Click **"Generate Visualization"**
4. The topology will be rendered automatically

#### Option 2: Create From Scratch
1. Click **"Create Empty Canvas"** button
2. The editing interface will open with a blank canvas
3. Use **"Add New Node"** to create shelf nodes
4. Use connection editing to wire nodes together

### Working with Visualizations

#### Location Mode (CSV Import)
- Nodes are organized by physical location
- Compound nodes represent racks containing shelves
- Editing location information updates the rack grouping
- Double-click racks to collapse/expand

#### Hierarchy Mode (TextProto Import)
- Nodes are organized by logical topology
- Graph templates and instances form the hierarchy
- Can instantiate new instances of graph templates
- Double-click graph nodes to collapse/expand



### Exporting Results

#### Export Cabling Descriptor
1. Optionally enter a custom **Filename Prefix**
2. Click **"Export Cabling Descriptor"**
3. Downloads a `.textproto` file with complete topology definition
4. Can be re-imported for further editing

#### Export Deployment Descriptor
1. Ensure all nodes have location information (Hall/Aisle/Rack/Shelf)
2. Click **"Export Deployment Descriptor"**
3. Downloads a `.textproto` file with deployment configuration

#### Generate Cabling Guide
1. **Prerequisites**:
   - `TT_METAL_HOME` environment variable set
   - Cabling generator built at `$TT_METAL_HOME/build/tools/scaleout/run_cabling_generator`
2. Click **"Generate Cabling Guide"**
3. Downloads a CSV file with detailed cabling instructions
4. Format automatically selected:
   - **Detailed**: If all nodes have location information
   - **Simple**: If any nodes lack location information

#### Generate Factory System Descriptor
1. Same prerequisites as cabling guide
2. Click **"Generate Factory System Descriptor (FSD)"**
3. Downloads complete factory system specification as `.textproto`

## File Formats

### CSV Format (Cabling Guide)

CSV files use a **2-line header** format where:
- **Line 1**: Groups columns into Source/Destination/Cable info sections
- **Line 2**: Contains the actual column names

#### Example CSV Format:
```csv
Source,,,,,,,,,Destination,,,,,,,,,Cable Length,Cable Type
Hostname,Hall,Aisle,Rack,Shelf U,Tray,Port,Label,Node Type,Hostname,Hall,Aisle,Rack,Shelf U,Tray,Port,Label,Node Type,,
host_1,,,00,U00,1,3,00U00-1-3,P150_LB,host_2,,,00,U00,2,3,00U00-2-3,P150_LB,,
```

**Column Definitions:**
- **Source section**: Hostname, Hall, Aisle, Rack, Shelf U, Tray, Port, Label, Node Type
- **Destination section**: Same fields as source
- **Cable info**: Cable Length, Cable Type

**Note**: Hall and Aisle columns may be empty if location information is not available (simplified format).

### TextProto Format (Cabling Descriptor)

The Cabling Descriptor uses protocol buffer text format with the following structure:

```protobuf
# Define reusable graph templates
graph_templates {
  key: "template_name"
  value {
    # Define child nodes or sub-graphs
    children {
      name: "node1"
      node_ref { node_descriptor: "N300_LB_DEFAULT" }
    }
    children {
      name: "subgraph1"
      graph_ref { graph_template: "another_template" }
    }
    
    # Define internal connections by cable type
    internal_connections {
      key: "QSFP_DD"
      value {
        connections {
          port_a { path: ["node1"] tray_id: 1 port_id: 2 }
          port_b { path: ["node2"] tray_id: 1 port_id: 2 }
        }
        connections {
          port_a { path: ["subgraph1", "inner_node"] tray_id: 3 port_id: 1 }
          port_b { path: ["node1"] tray_id: 3 port_id: 1 }
        }
      }
    }
  }
}

# Root instance that maps templates to physical hosts
root_instance {
  template_name: "template_name"
  
  # Map child names to host IDs or sub-instances
  child_mappings {
    key: "node1"
    value { host_id: 0 }
  }
  child_mappings {
    key: "subgraph1"
    value {
      sub_instance {
        template_name: "another_template"
        child_mappings {
          key: "inner_node"
          value { host_id: 1 }
        }
      }
    }
  }
}
```

**Key Elements:**
- `graph_templates`: Map of template names to graph definitions (reusable patterns)
- `children`: List of child nodes (either `node_ref` for devices or `graph_ref` for sub-graphs)
- `internal_connections`: Connections within the template, organized by cable type
- `path`: Array specifying hierarchical path to a node (e.g., `["superpod1", "node2"]`)
- `root_instance`: The top-level graph instance that assigns actual host IDs to template nodes

### TextProto Format (Deployment Descriptor)

```protobuf
hosts {
  location {
    hall: "A"
    aisle: "01"
    rack_num: 1
    shelf_u: 10
  }
}
```

## Development

### Project Structure

```
tt-CableGen/
├── server.py                   # Flask web server
├── import_cabling.py          # Visualization engine and parsers
├── export_descriptors.py      # Export logic
├── requirements.txt           # Python dependencies
├── templates/
│   └── index.html            # Web interface template
├── static/
│   └── js/
│       └── visualizer.js     # Client-side application
├── docker-compose.yml         # Production Docker setup
├── docker-compose.local.yml   # Local development Docker setup
├── Dockerfile                 # Application container
├── Makefile                  # Docker management commands
└── nginx/                     # Nginx and OAuth2 configuration
```

### Extending Node Types

To add a new node type:

1. To ensure that Cabling Guide exports work makes sure that the NodeType is added in TT-METAL as well 

1. **Add to `import_cabling.py`**:
```python
self.shelf_unit_configs = {
    ...
    'new_node_type': {
        'tray_count': 4,
        'port_count': 6,
        'tray_layout': 'vertical',
        'tray_spacing': 30,
        ...
    }
}
```

2. **Add to `_node_descriptor_to_shelf_type` mapping**:
```python
descriptor_to_config_map = {
    ...
    'new_node_type': 'new_node_type',
}
```

3. **Update `templates/index.html`** dropdown:
```html
<option value="NEW_NODE_TYPE">NEW_NODE_TYPE (4 trays, 6 ports each)</option>
```

The configuration will automatically be synchronized between backend and frontend. 

## Keyboard Shortcuts

- **Delete / Backspace**: Delete selected connection or node while in Edit Mode
- **Double-click** shelf node: Open editing interface
- **Double-click** rack/graph node: Collapse/expand
- **Drag**: Move nodes
- **Mouse wheel**: Zoom in/out
- **Click + drag** on background: Pan canvas

## License

See LICENSE file for details.

## Support

For issues, questions, or contributions, please refer to the project repository and raise issues/requests.

