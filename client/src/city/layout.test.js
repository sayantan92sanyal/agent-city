import { describe, expect, test } from 'vitest';
import { TILE_W, TILE_H, isoToScreen, layoutCity } from './layout.js';

const fakeProjects = (n, agents) =>
  Array.from({ length: n }, (_, i) => ({
    projectPath: `/p/${i}`,
    projectName: `proj${i}`,
    agents: Array.from({ length: agents }, (_, j) => ({ id: `a${i}-${j}`, name: `agent${j}` })),
  }));

const GAP = 1;
// true when no two rects, each expanded by GAP/2... i.e. real gap >= GAP tile
const noOverlaps = (rects) => {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (Math.max(gapX, gapY) < GAP) return false;
    }
  return true;
};
const inside = (r, p) =>
  p.x >= r.x + 1 && p.x <= r.x + r.w - 2 && p.y >= r.y + 1 && p.y <= r.y + r.h - 2;

describe('isoToScreen', () => {
  test('projects tile coords', () => {
    expect(isoToScreen({ x: 2, y: 1 })).toEqual({ left: TILE_W / 2, top: (3 * TILE_H) / 2 });
  });
});

describe('layoutCity', () => {
  test('no two plots or plaza/lot overlap, for 1..20 projects', () => {
    for (let n = 1; n <= 20; n++) {
      const { plaza, plots, lot } = layoutCity(fakeProjects(n, 3));
      expect(plots).toHaveLength(n);
      expect(noOverlaps([plaza, lot, ...plots.map((p) => p.rect)])).toBe(true);
    }
  });

  test('no overlaps with mixed plot sizes', () => {
    const ps = [0, 1, 9, 4, 17, 2, 30, 5].map((c, i) => ({
      ...fakeProjects(1, c)[0],
      projectPath: `/m/${i}`,
    }));
    const { plaza, plots, lot } = layoutCity(ps);
    expect(noOverlaps([plaza, lot, ...plots.map((p) => p.rect)])).toBe(true);
  });

  test('every agent gets a distinct slot inside its plot, hire post is free', () => {
    const projects = fakeProjects(5, 7);
    const { plots } = layoutCity(projects);
    plots.forEach((plot, i) => {
      const slots = plot.slots;
      expect(slots.map((s) => s.agentId)).toEqual(projects[i].agents.map((a) => a.id));
      const keys = new Set(slots.map((s) => `${s.x},${s.y}`));
      expect(keys.size).toBe(slots.length);
      slots.forEach((s) => expect(inside(plot.rect, s)).toBe(true));
      expect(inside(plot.rect, plot.hirePost)).toBe(true);
      expect(keys.has(`${plot.hirePost.x},${plot.hirePost.y}`)).toBe(false);
    });
  });

  test('broken agents still get a slot', () => {
    const projects = [
      { projectPath: '/x', projectName: 'x', agents: [{ id: 'a', name: 'a', error: 'bad' }, { id: 'b', name: 'b' }] },
    ];
    expect(layoutCity(projects).plots[0].slots).toHaveLength(2);
  });

  test('layout is deterministic', () => {
    const ps = fakeProjects(6, 4);
    expect(layoutCity(ps)).toEqual(layoutCity(ps));
  });

  test('zero projects still yields plaza and lot', () => {
    const c = layoutCity([]);
    expect(c.plots).toEqual([]);
    expect(c.plaza).toMatchObject({ w: 6, h: 6 });
    expect(c.lot).toBeTruthy();
    expect(noOverlaps([c.plaza, c.lot])).toBe(true);
  });

  test('a playground with 0 agents gets a 4x4 plot and a hire post', () => {
    const { plots } = layoutCity(fakeProjects(1, 0));
    expect(plots[0].rect).toMatchObject({ w: 4, h: 4 });
    expect(plots[0].slots).toEqual([]);
    expect(inside(plots[0].rect, plots[0].hirePost)).toBe(true);
  });

  test('plot size grows with agent count', () => {
    // 5 agents -> 3 columns at a 3-tile pitch: 3*3 + 1 = 10.
    expect(layoutCity(fakeProjects(1, 5)).plots[0].rect).toMatchObject({ w: 10, h: 10 });
  });

  test('slots sit 3 tiles apart, inside the fence margin, with the hire post free, up to 30 agents', () => {
    for (let n = 1; n <= 30; n++) {
      const [plot] = layoutCity(fakeProjects(1, n)).plots;
      const keys = new Set(plot.slots.map((s) => `${s.x},${s.y}`));
      expect(keys.size).toBe(n);
      plot.slots.forEach((s) => expect(inside(plot.rect, s)).toBe(true));
      expect(inside(plot.rect, plot.hirePost)).toBe(true);
      expect(keys.has(`${plot.hirePost.x},${plot.hirePost.y}`)).toBe(false);
      for (const a of plot.slots)
        for (const b of plot.slots) {
          if (a === b) continue;
          expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(3);
        }
    }
  });

  test('the slot grid is centred in the plot', () => {
    for (const n of [1, 2, 4, 5, 9, 12]) {
      const [plot] = layoutCity(fakeProjects(1, n)).plots;
      const { rect, slots } = plot;
      const xs = slots.map((s) => s.x);
      const ys = slots.map((s) => s.y);
      // Free tiles before the first slot and after the last differ by at most one.
      const before = (v, o) => Math.min(...v) - o;
      const after = (v, o, size) => o + size - 1 - Math.max(...v);
      expect(Math.abs(before(xs, rect.x) - after(xs, rect.x, rect.w))).toBeLessThanOrEqual(1);
      expect(Math.abs(before(ys, rect.y) - after(ys, rect.y, rect.h))).toBeLessThanOrEqual(1);
    }
  });

  test('origin shifts everything into a (0,0) container', () => {
    const { plaza, plots, lot, width, height, origin } = layoutCity(fakeProjects(7, 3));
    const rects = [plaza, lot, ...plots.map((p) => p.rect)];
    for (const r of rects) {
      const corners = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x, y: r.y + r.h },
        { x: r.x + r.w, y: r.y + r.h },
      ];
      for (const c of corners) {
        const s = isoToScreen(c);
        expect(s.left + origin.left).toBeGreaterThanOrEqual(0);
        expect(s.top + origin.top).toBeGreaterThanOrEqual(0);
        expect(s.left + origin.left).toBeLessThanOrEqual(width);
        expect(s.top + origin.top).toBeLessThanOrEqual(height);
      }
    }
  });
});
