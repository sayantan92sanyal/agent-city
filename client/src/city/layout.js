export const TILE_W = 64;
export const TILE_H = 32;

const PLAZA_SIZE = 6;
const LOT_SIZE = 4;
const GAP = 1;
const PAD = 64;

export function isoToScreen({ x, y }) {
  return { left: ((x - y) * TILE_W) / 2, top: ((x + y) * TILE_H) / 2 };
}

// Agents stand SLOT_PITCH tiles apart so bubbles and name labels never collide.
const SLOT_PITCH = 3;
const gridCols = (agentCount) => Math.ceil(Math.sqrt(agentCount)) || 1;
// cols*3 + 1 leaves the slot span plus a 1-tile fence margin on each side, and
// the far margin's inner tile (w-2) for the hire post, which no slot reaches.
const plotSize = (agentCount) => Math.max(4, gridCols(agentCount) * SLOT_PITCH + 1);

// Ring cells (cx, cy) around (0,0), ring 1 first, clockwise from top-left; deterministic.
function* spiralCells() {
  for (let r = 1; ; r++) {
    for (let cx = -r; cx <= r; cx++) yield [cx, -r];
    for (let cy = -r + 1; cy <= r; cy++) yield [r, cy];
    for (let cx = r - 1; cx >= -r; cx--) yield [cx, r];
    for (let cy = r - 1; cy > -r; cy--) yield [-r, cy];
  }
}

/** Lays out plaza, plots and lot in tile units; add `origin` ({left, top} px) to isoToScreen results to fit a container whose top-left is (0,0). */
export function layoutCity(projects) {
  const sizes = projects.map((p) => plotSize(p.agents.length));
  // Every ring cell is `pitch` tiles wide, so rects centered in cells keep a >=1 tile gap.
  const pitch = Math.max(PLAZA_SIZE, LOT_SIZE, ...sizes) + GAP;
  const centered = (cx, cy, size) => ({
    x: cx * pitch - Math.floor(size / 2),
    y: cy * pitch - Math.floor(size / 2),
    w: size,
    h: size,
  });

  const cells = spiralCells();
  const plaza = centered(0, 0, PLAZA_SIZE);
  const plots = projects.map((project, i) => {
    const [cx, cy] = cells.next().value;
    const rect = centered(cx, cy, sizes[i]);
    const n = project.agents.length;
    const cols = gridCols(n);
    const rows = Math.ceil(n / cols) || 1;
    // The slot grid is centred in the tiles inside the fence margin (1..w-2).
    const usable = rect.w - 2;
    const offX = Math.floor((usable - ((cols - 1) * SLOT_PITCH + 1)) / 2);
    const offY = Math.floor((usable - ((rows - 1) * SLOT_PITCH + 1)) / 2);
    const slots = project.agents.map((agent, k) => ({
      agentId: agent.id,
      x: rect.x + 1 + offX + (k % cols) * SLOT_PITCH,
      y: rect.y + 1 + offY + Math.floor(k / cols) * SLOT_PITCH,
    }));
    return {
      projectPath: project.projectPath,
      rect,
      slots,
      hirePost: { x: rect.x + rect.w - 2, y: rect.y + rect.h - 2 },
    };
  });
  const [lx, ly] = cells.next().value;
  const lot = centered(lx, ly, LOT_SIZE);

  let minL = Infinity, minT = Infinity, maxL = -Infinity, maxT = -Infinity;
  for (const r of [plaza, lot, ...plots.map((p) => p.rect)]) {
    for (const c of [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h },
      { x: r.x + r.w, y: r.y + r.h },
    ]) {
      const s = isoToScreen(c);
      minL = Math.min(minL, s.left);
      maxL = Math.max(maxL, s.left);
      minT = Math.min(minT, s.top);
      maxT = Math.max(maxT, s.top);
    }
  }

  return {
    plaza,
    plots,
    lot,
    origin: { left: PAD - minL, top: PAD - minT },
    width: maxL - minL + 2 * PAD,
    height: maxT - minT + 2 * PAD,
  };
}
