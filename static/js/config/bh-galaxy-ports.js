/**
 * BH Galaxy external port layout - per-tray, per-port mapping
 * Mesh vis: ports 1-6 at inner positions (stepped back), 7-14 at outer (edges)
 */

const TRAY_CONFIG = {
    1: {
        horizontalEdge: 'top', verticalEdge: 'left',
        horizontalInner: [1, 2], horizontalOuter: [8, 10, 12, 14],
        verticalInner: [3, 4, 5, 6], verticalOuter: [7, 11, 9, 13]
    },
    2: {
        horizontalEdge: 'bottom', verticalEdge: 'left',
        horizontalInner: [1, 2], horizontalOuter: [8, 10, 12, 14],
        verticalInner: [3, 4, 5, 6], verticalOuter: [7, 11, 9, 13]
    },
    3: {
        horizontalEdge: 'top', verticalEdge: 'right',
        horizontalInner: [1, 2], horizontalOuter: [8, 10, 12, 14],
        verticalInner: [3, 4, 5, 6], verticalOuter: [7, 11, 9, 13]
    },
    4: {
        horizontalEdge: 'bottom', verticalEdge: 'right',
        horizontalInner: [1, 2], horizontalOuter: [8, 10, 12, 14],
        verticalInner: [3, 4, 5, 6], verticalOuter: [7, 11, 9, 13]
    }
};

/**
 * Get edge, order and tier for a BH Galaxy port.
 * @param {number} trayId - Tray ID (1-4)
 * @param {number} portId - Port ID (1-14)
 * @returns {{ edge: string, order: number, tier: 'outer'|'inner' } | null}
 */
export function getBhGalaxyPortEdge(trayId, portId) {
    const tray = TRAY_CONFIG[trayId];
    if (!tray) return null;

    let hIdx = tray.horizontalInner.indexOf(portId);
    if (hIdx >= 0) return { edge: tray.horizontalEdge, order: hIdx, tier: 'inner' };
    hIdx = tray.horizontalOuter.indexOf(portId);
    if (hIdx >= 0) return { edge: tray.horizontalEdge, order: hIdx, tier: 'outer' };

    let vIdx = tray.verticalInner.indexOf(portId);
    if (vIdx >= 0) return { edge: tray.verticalEdge, order: vIdx, tier: 'inner' };
    vIdx = tray.verticalOuter.indexOf(portId);
    if (vIdx >= 0) return { edge: tray.verticalEdge, order: vIdx, tier: 'outer' };

    return null;
}
