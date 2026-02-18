/**
 * WH Galaxy mesh port layout - per-tray, per-port mapping
 * Each tray has its own ordering along each edge.
 * Port groups: [1,2] = horizontal edge (X-torus); [3,4,5,6] = vertical edge (Y-torus)
 */

/**
 * Per-tray configuration: edge assignment and port ordering.
 * WH chassis diagram: T1 top-left, T2 top-right, T3 bottom-left, T4 bottom-right.
 * Order arrays define the sequence ports appear along that tray's edge segment.
 */
const TRAY_CONFIG = {
    1: { horizontalEdge: 'top', verticalEdge: 'left', horizontalOrder: [1, 2], verticalOrder: [3, 4, 5, 6] },
    2: { horizontalEdge: 'top', verticalEdge: 'right', horizontalOrder: [1, 2], verticalOrder: [3, 4, 5, 6] },
    3: { horizontalEdge: 'bottom', verticalEdge: 'left', horizontalOrder: [1, 2], verticalOrder: [3, 4, 5, 6] },
    4: { horizontalEdge: 'bottom', verticalEdge: 'right', horizontalOrder: [1, 2], verticalOrder: [3, 4, 5, 6] }
};

/**
 * Get edge, order and tier for a WH Galaxy port.
 * First 6 ports share same arrangement as BH (all outer tier).
 * @param {number} trayId - Tray ID (1-4)
 * @param {number} portId - Port ID (1-6)
 * @returns {{ edge: string, order: number, tier: 'outer'|'inner' } | null}
 */
export function getWhGalaxyPortEdge(trayId, portId) {
    const tray = TRAY_CONFIG[trayId];
    if (!tray) return null;

    const hIdx = tray.horizontalOrder.indexOf(portId);
    if (hIdx >= 0) return { edge: tray.horizontalEdge, order: hIdx, tier: 'outer' };
    const vIdx = tray.verticalOrder.indexOf(portId);
    if (vIdx >= 0) return { edge: tray.verticalEdge, order: vIdx, tier: 'outer' };
    return null;
}
