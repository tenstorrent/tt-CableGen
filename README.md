# tt-CableGen: Network Cabling Visualizer for Tenstorrent Scale-Out Deployments

For scale-out deployments of Tenstorrent Wormhole and Blackhole hardware, this tool can be used to visualize how to connect multiple systems for a specific multi-node scale-out topology.

<!-- Remember to update the table of contents when adding new sections -->
## Table of Contents

- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Basic Usage](#basic-usage)
- [What Can It Do?](#what-can-it-do)
- [Supported Hardware](#supported-hardware)
- [Basic Usage](#basic-usage-1)
  - [Importing a Topology](#importing-a-topology)
  - [Editing](#editing)
  - [Copy and Paste](#copy-and-paste)
  - [Exporting](#exporting)
- [Docker Deployment](#docker-deployment)
- [Detailed Documentation](#detailed-documentation)
  - [General Interactions](#general-interactions)
  - [Visualizer Descriptors/Files](#visualizer-descriptorsfiles)
- [License](#license)
- [Support](#support)

![Python](https://img.shields.io/badge/python-3.7+-blue.svg)
![Flask](https://img.shields.io/badge/flask-3.0.2-green.svg)

<p align="center">
  <img src="static/img/8x16-bh.png" alt="8x16 BH-Galaxy Mesh Topology" width="800">
  <br>
  <em>Example: 4× BH-Galaxy systems forming an 8×16 mesh with 2D-torus connections</em>
</p>

## Quick Start

This tool is built with 2 modes of use in mind: 
1. A **Physical Deployment** (with racking information) mode that is useful for visualizing nodes in a simplified view of how they would be organized in data center Aisles/Racks/Shelves. See [README-LOCATION.md](README-LOCATION.md) for detailed documentation.
2. A **Logical Hierarchy** (with clustering/pod information) mode that is useful for visualizing node groupings in terms of graphs and subgraphs. See [README-HIERARCHY.md](README-HIERARCHY.md) for detailed documentation.

### Prerequisites

The tool is mostly self-packaged as a docker image packaged as part of the repo. This docker environment takes care of all JavaScript, Python, and [tt-Metal](https://github.com/tenstorrent/tt-metal) dependencies. For most deployments we have a Makefile that serves as as simple interface for managing the application. For a simple deployment to test out tool functionality we recommend the make commands with the `-local` suffixes. For more secure, production enviroments, we recommend the default `make` commands (which require some extra environment configuration, see [README-COMPOSE.md](README-COMPOSE.md) for more detail).

### Basic Usage 

Select a predefined topology from the [Defined Topologies](defined_topologies/README.md) folder and upload the desired CSV or TextProto file to visualize your network topology. Alternatively, click a mode tab and then **"Create Empty Canvas"** to build one from scratch, with different Tenstorrent node types!

Please regularly hard refresh the page (Ctrl+Shift+R / Cmd+Shift+R) to ensure you are using the latest version of the tool.

## What Can It Do?

| Feature | Description |
|---------|-------------|
| **Visualize** | Interactive graph with pan, zoom, and hierarchical node structure |
| **Edit** | Add/remove nodes, create connections, create node groupings, modify properties |
| **Import/Export** | Generate cabling descriptors, deployment descriptors, and cabling guides. Transfer work so it can be consumed by various parties |

## Supported Hardware

- **Wormhole**: WH_GALAXY, N300_LB, N300_QB
- **Blackhole**: BH_GALAXY, P150_LB, P150_QB

## Basic Usage

### Starting a New Visualization

- **Drag & Drop**: Drag & drop a `.csv` or `.textproto` file onto the site to start a new visualization.
- **Create Empty Canvas**: Click the "Create Empty Canvas" button under the "Physical Deployment" or "Logical Hierarchy" tab to start a new visualization from scratch.

### Editing

- **Enable Edit Mode**: Click the "Enable Cabling Editing" button under the "Cabling Editor" section to enable edit mode.
- **Add nodes**: Use "Add New Node" panel to create shelf nodes.
- **Create connections**: Enable edit mode → click source port → click destination port.
- **Edit nodes**: Double-click any shelf node to edit the node properties.
- **Delete**: Select item + press Delete/Backspace.

### Copy and Paste

Copy and paste works in both **Physical Deployment** (Location) and **Logical Hierarchy** modes when **Cabling Editing** is enabled. Use **Ctrl+C** (or **Cmd+C** on Mac) to copy and **Ctrl+V** (or **Cmd+V** on Mac) to paste.

| Mode | Copy | Paste |
|------|------|--------|
| **Location** | Select one or more shelves, or a hall/aisle/rack to copy all shelves under it. Connections between nodes in the selection are included. | **Ctrl+V** opens a **Paste destination** modal. Choose where to place the pasted shelves (e.g. hall, aisle, rack, shelf U). You can paste into a selected rack or at a new location. |
| **Hierarchy** | Select one or more graph instances or shelves. Full subtrees and connections between nodes in the selection are included. | **Ctrl+V** pastes under the currently selected graph instance (or at root if no graph selected). New instances use the prefix `copy`. No modal. |

- **Multi-select**: Use **Shift+Click** or **Ctrl/Cmd+Click** to select multiple nodes before copying.
- **Paste requirements**: Paste is only available when Cabling Editing is enabled. In Location mode, paste is only allowed when the session started in Location mode (e.g. from a CSV import).

### Exporting

- **Cabling Descriptor**: Topology definition (hierarchy-based)
- **Deployment Descriptor**: Physical location mapping (tied to a Cabling Descriptor usually)
- **Cabling Guide**: CSV instructions for technicians (requires `TT_METAL_HOME`)

## Docker Deployment

See [README-COMPOSE.md](README-COMPOSE.md) for containerized deployment options.

---

## Detailed Documentation

### General Interactions

The visualizer has 2 distinct modes which expose different information but there are common flows/functionality between them. 

1. Panning/Dragging: Clicking and dragging on the blank background will allow the user to move around the visualized topologies. Clicking on a node and dragging will move the node. In both modes, clicking the "Reset Layout" button will reset the layout to calculated default positions.
2. Node/Connection Info: In both modes clicking on the a connected port will show the connection info panel with details about the connection and the endpoints. 
3. Connection Creation: In both modes clicking on an unconnected port will allow the user to create a connection to another unconnected port.
4. Element Deletion: In both modes, selcting an element and clicking the delete button (or pressing Backspace/Delete) will delete the element. This will delete any contained nodes/connections. Multiple elements can be selected and deleted at once by holding Shift/Cmd/Ctrl and clicking on the elements to select them.
5. Copy and Paste: In both modes, **Ctrl+C** / **Cmd+C** copies the current selection (shelves and internal connections in Location mode; graph instances/shelves and subtrees in Hierarchy mode). **Ctrl+V** / **Cmd+V** pastes: in Location mode a paste-destination modal appears to choose hall/aisle/rack/shelf U; in Hierarchy mode content is pasted under the selected graph or at root. See [Copy and Paste](#copy-and-paste) and the mode-specific READMEs for usage flows.

**📖 For detailed Location Mode documentation, see [README-LOCATION.md](README-LOCATION.md)**

**📖 For detailed Hierarchy Mode documentation, see [README-HIERARCHY.md](README-HIERARCHY.md)**

### Visualizer Descriptors/Files

See [TT-Metal Scaleout tools](https://github.com/tenstorrent/tt-metal/tree/main/tools/scaleout) page for more information on how our descriptor files are structured, their specific use cases, and how they fit in with our flows. 


---

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues or questions, please open an issue in the project repository.
