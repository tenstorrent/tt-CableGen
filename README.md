# tt-CableGen: Network Cabling Visualizer for Tenstorrent Scale-Out Deployments

For scale-out deployments of Tenstorrent Wormhole and Blackhole hardware, this tool can be used to visualize how to connect multiple systems for a specific multi-node scale-out topology.

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

## What Can It Do?

| Feature | Description |
|---------|-------------|
| **Visualize** | Interactive graph with pan, zoom, and hierarchical node structure |
| **Edit** | Add/remove nodes, create connections, create node groupings, modify properties |
| **Import/Export** | Generate cabling descriptors, deployment descriptors, and cabling guides. Transfer work so it can be consumed by various parties |

## Supported Hardware

- **Wormhole**: WH_GALAXY variants, N300_LB, N300_QB
- **Blackhole**: BH_GALAXY variants, P150_LB, P150_QB variants

## Basic Usage

### Importing a Topology

1. Drag & drop a `.csv` or `.textproto` file onto the site
2. Click **"Generate Visualization"**

### Editing

- **Add nodes**: Use "Add New Node" panel to create shelf nodes
- **Create connections**: Enable edit mode → click source port → click destination port
- **Edit nodes**: Double-click any shelf node
- **Delete**: Select item + press Delete/Backspace

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

1. Panning: Clicking and dragging on the blank background will allow the user to move around the visualized topologies.
2. Node/Connection Info: In both modes clicking on the a connected port will show the connection info panel with details about the connection and the endpoints. 
3. Connection Creation: In both modes clicking on an unconnected port will allow the user to create a connection to another unconnected port.
4. Element Deletion: In both modes, selcting an element and clicking the delete button (or pressing Backspace/Delete) will delete the element. This will delete any contained nodes/connections. Multiple elements can be selected and deleted at once by holding Shift/Cmd/Ctrl and clicking on the elements to select them.

**📖 For detailed Location Mode documentation, see [README-LOCATION.md](README-LOCATION.md)**

**📖 For detailed Hierarchy Mode documentation, see [README-HIERARCHY.md](README-HIERARCHY.md)**

### Visualizer Descriptors/Files

See [TT-Metal Scaleout tools](https://github.com/tenstorrent/tt-metal/tree/main/tools/scaleout) page for more information on how our descriptor files are structured, their specific use cases, and how they fit in with our flows. 


---

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues or questions, please open an issue in the project repository.
