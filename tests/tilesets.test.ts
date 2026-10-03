// Tile sets (which model a tile draws) and the level-of-detail hysteresis.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import boards from '../src/shared/data/boards.json';
import type {SpaceModel} from '../src/shared/full';
import {EDGE_DIRS, edgeToward, hexCorner, LOD, lodStep, oceanEdgeMap, resolveModel, screenSize, setOf, wantDetail} from '../src/client/tv/full/board3d/tilesets';
import type {Detail, LodInput} from '../src/client/tv/full/board3d/tilesets';
import {DEFAULT_TILE_STYLE, parseSettings, tileStyleOf} from '../src/client/tv/settings';
import {FOV, focusView, FOCUS, refDist, restView} from '../src/client/tv/full/board3d/camera3d';
import {board3d, PRISM_R, restPoints} from '../src/client/tv/full/board3d/geometry3d';

const regs = new Map<string, Map<number, string>>([
  ['classic', new Map([[1, 'classic-ocean'], [2, 'classic-greenery'], [3, 'classic-city']])],
  ['detailed', new Map([[2, 'detailed-greenery'], [7, 'detailed-lava']])],
]);

describe('tile set resolver', () => {
  it('draws the chosen set first, then Classic, then the built-in (null)', () => {
    expect(resolveModel(regs, 'detailed', 2)).toBe('detailed-greenery');
    expect(resolveModel(regs, 'detailed', 1)).toBe('classic-ocean');
    expect(resolveModel(regs, 'detailed', 7)).toBe('detailed-lava');
    expect(resolveModel(regs, 'detailed', 99)).toBeNull();
    expect(resolveModel(regs, 'classic', 2)).toBe('classic-greenery');
    // a Detailed-only type is not drawn in Classic: the built-in one stands in
    expect(resolveModel(regs, 'classic', 7)).toBeNull();
  });
  it('a set with no registry yet (its files not loaded) falls back to Classic', () => {
    expect(resolveModel(regs, 'unloaded', 3)).toBe('classic-city');
    expect(resolveModel(new Map(), 'detailed', 3)).toBeNull();
  });
  it('skips models that are not warm yet, so a tile keeps what it draws until the new one is ready', () => {
    const warm = new Set(['classic-greenery', 'classic-ocean']);
    expect(resolveModel(regs, 'detailed', 2, (m) => warm.has(m))).toBe('classic-greenery');
    expect(resolveModel(regs, 'detailed', 7, (m) => warm.has(m))).toBeNull();
    expect(resolveModel(regs, 'detailed', 3, (m) => warm.has(m))).toBeNull();
    warm.add('detailed-greenery');
    expect(resolveModel(regs, 'detailed', 2, (m) => warm.has(m))).toBe('detailed-greenery');
  });
  it('switching back while the chosen set warms keeps the other set\'s warm model, never the built-in one', () => {
    const warm = new Set(['detailed-greenery', 'detailed-lava']);
    // Classic chosen, its greenery not warm yet: the Detailed one stays
    expect(resolveModel(regs, 'classic', 2, (m) => warm.has(m))).toBe('detailed-greenery');
    // a type Classic has no model for stays built-in in Classic, warm or not
    expect(resolveModel(regs, 'classic', 7, (m) => warm.has(m))).toBeNull();
    warm.add('classic-greenery');
    expect(resolveModel(regs, 'classic', 2, (m) => warm.has(m))).toBe('classic-greenery');
  });
  it('a model file belongs to its meta.set, else its folder, else Classic', () => {
    expect(setOf('./models/City.tsx')).toBe('classic');
    expect(setOf('./models/detailed/City.tsx')).toBe('detailed');
    expect(setOf('./models/City.tsx', 'classic')).toBe('classic');
    expect(setOf('./models/detailed/City.tsx', 'detailed')).toBe('detailed');
  });
  it('the TV stores a tile style per screen only once picked; otherwise it follows the default (Detailed)', () => {
    expect(DEFAULT_TILE_STYLE).toBe('detailed');
    expect(parseSettings(null).tileStyle).toBeNull();
    expect(tileStyleOf(parseSettings(null))).toBe(DEFAULT_TILE_STYLE);
    // a screen that saved other options still follows the default
    expect(tileStyleOf(parseSettings(JSON.stringify({hum: false, textSize: 'xl'})))).toBe(DEFAULT_TILE_STYLE);
    expect(tileStyleOf(parseSettings(JSON.stringify({tileStyle: 'detailed'})))).toBe('detailed');
    expect(tileStyleOf(parseSettings(JSON.stringify({tileStyle: 'classic'})))).toBe('classic');
    expect(parseSettings(JSON.stringify({tileStyle: 'fancy'})).tileStyle).toBeNull();
  });
});

const at = (size: number, focused = false, onScreen = true): LodInput => ({size, focused, onScreen});

describe('level of detail', () => {
  it('goes full above the upper threshold and back to lite only below the lower one', () => {
    expect(LOD.down).toBeLessThan(LOD.up);
    expect(wantDetail('lite', at(LOD.up), 1e6)).toBe('full');
    expect(wantDetail('lite', at(LOD.up - 0.001), 1e6)).toBe('lite');
    // between the two thresholds a tile keeps its level, whichever it has
    const mid = (LOD.up + LOD.down) / 2;
    expect(wantDetail('lite', at(mid), 1e6)).toBe('lite');
    expect(wantDetail('full', at(mid), 1e6)).toBe('full');
    expect(wantDetail('full', at(LOD.down - 0.001), 1e6)).toBe('lite');
  });
  it('holds a level for the dwell time, except that a focused tile goes full at once', () => {
    expect(wantDetail('lite', at(0.5), LOD.dwellMs - 1)).toBe('lite');
    expect(wantDetail('lite', at(0.5), LOD.dwellMs)).toBe('full');
    expect(wantDetail('full', at(0.01), LOD.dwellMs - 1)).toBe('full');
    expect(wantDetail('lite', at(0.01, true), 0)).toBe('full');
  });
  it('only a tile on screen goes full; off screen, a full tile stays full while large and goes lite once small', () => {
    expect(wantDetail('lite', at(0.9, false, false), 1e6)).toBe('lite');
    expect(wantDetail('full', at(0.9, false, false), 1e6)).toBe('full');
    expect(wantDetail('full', at(0.01, false, false), 1e6)).toBe('lite');
  });
  it('a size wobbling across one threshold does not flicker', () => {
    // a tile oscillating ±0.01 around the upper threshold, one sample per frame for 3 s
    let d: Detail = 'lite', changedAt = -1e9, switches = 0;
    for (let f = 0; f < 180; f++) {
      const now = f * 16.7;
      const size = LOD.up + (f % 2 ? 0.01 : -0.01);
      const n = wantDetail(d, at(size), now - changedAt);
      if (n !== d) { d = n; changedAt = now; switches++; }
    }
    expect(switches).toBe(1);
    expect(d).toBe('full');
  });
  it('switches at most perFrame tiles per frame, focused ones first and then the largest', () => {
    const tiles = Array.from({length: 10}, (_, i) => ({id: `t${i}`, detail: 'lite' as Detail, changedAt: -1e9, size: LOD.up + 0.05 + i * 0.01, focused: i === 0, onScreen: true}));
    const step = lodStep(tiles, 0);
    expect(step.length).toBe(LOD.perFrame + 1);
    expect(step[0]).toEqual({id: 't0', detail: 'full'});
    expect(step.slice(1).map((s) => s.id)).toEqual(['t9', 't8', 't7'].slice(0, LOD.perFrame));
  });
  it('the resting view is lite everywhere and a placement dive brings the focused tile far past the threshold', () => {
    const geo = board3d((boards as unknown as Record<string, SpaceModel[]>).tharsis);
    const R = geo.discR;
    for (const aspect of [16 / 9, 4 / 3, 1.1]) {
      const rest = restView(restPoints(geo), aspect);
      // the nearest hex at rest is closer than the aim point: at most ~20 % closer
      expect(screenSize(PRISM_R, rest.dist * 0.8, FOV)).toBeLessThan(LOD.down);
      const dive = focusView([{x: 0, z: 0}], rest, {enabled: true, R});
      expect(refDist(R) / dive.dist).toBeCloseTo(FOCUS.zoom, 5);
      expect(screenSize(PRISM_R, dive.dist, FOV)).toBeGreaterThan(LOD.up);
    }
  });
});

describe('ocean edges', () => {
  // a pointy-top cluster at the board's hex spacing: a centre and neighbours by edge index
  const R = PRISM_R, step = R * Math.sqrt(3);
  const at2 = (i: number): [number, number] => [EDGE_DIRS[i][0] * step, EDGE_DIRS[i][1] * step];
  it('edge 0 runs from the +z corner to the next corner clockwise seen from above (towards -x), and so on round', () => {
    // corner k at (-sin 60k, cos 60k): edge i's outward normal is the mean of corners i and i + 1
    const corner = (k: number) => hexCorner(k);
    for (let i = 0; i < 6; i++) {
      const a = corner(i), b = corner(i + 1), n = Math.hypot(a[0] + b[0], a[1] + b[1]);
      expect(EDGE_DIRS[i][0]).toBeCloseTo((a[0] + b[0]) / n, 9);
      expect(EDGE_DIRS[i][1]).toBeCloseTo((a[1] + b[1]) / n, 9);
    }
    // seen from above with +z towards the camera (the TV's view), edge 0 faces the lower left, edge 1 the left,
    // edge 3 the upper right, edge 4 the right
    expect(EDGE_DIRS[0][0]).toBeLessThan(0); expect(EDGE_DIRS[0][1]).toBeGreaterThan(0);
    expect(EDGE_DIRS[1]).toEqual([-1, expect.closeTo(0, 9)]);
    expect(EDGE_DIRS[4][0]).toBeCloseTo(1, 9);
  });
  it('is the Detailed Ocean\'s own convention (OceanKit cornerAt and EN)', async () => {
    const kit = await import('../src/client/tv/full/board3d/models/detailed/OceanKit') as unknown as {cornerAt?: (k: number) => [number, number]; R0?: number};
    const src = (await import('node:fs')).readFileSync('src/client/tv/full/board3d/models/detailed/OceanKit.ts', 'utf8');
    // EN (not exported): the edges' outward normals
    const en = JSON.parse(/const EN[^=]*=\s*(\[\[[^;]*\]\]);/.exec(src)![1]) as Array<[number, number]>;
    for (let i = 0; i < 6; i++) { expect(en[i][0]).toBeCloseTo(EDGE_DIRS[i][0], 6); expect(en[i][1]).toBeCloseTo(EDGE_DIRS[i][1], 6); }
    for (let k = 0; k < 6; k++) {
      const [x, z] = kit.cornerAt!(k), [hx, hz] = hexCorner(k, kit.R0!);
      expect(x).toBeCloseTo(hx, 9); expect(z).toBeCloseTo(hz, 9);
    }
  });
  it('matches the prism: CylinderGeometry has its corners on ±z, walked the other way round', () => {
    const g = new THREE.CylinderGeometry(R, R, 1, 6, 1, true);
    const pos = g.getAttribute('position');
    const ring = Array.from({length: 6}, (_, j) => [pos.getX(j), pos.getZ(j)]);
    expect(ring[0][0]).toBeCloseTo(0, 6); expect(ring[0][1]).toBeCloseTo(R, 6);
    for (let j = 0; j < 6; j++) {
      const k = (6 - j) % 6;
      expect(ring[j][0]).toBeCloseTo(-Math.sin((k * Math.PI) / 3) * R, 6);
      expect(ring[j][1]).toBeCloseTo(Math.cos((k * Math.PI) / 3) * R, 6);
    }
    // each edge's direction points across the middle of that prism side
    for (let i = 0; i < 6; i++) {
      const a = ring[(6 - i) % 6], b = ring[(6 - i - 1 + 6) % 6];
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, n = Math.hypot(mx, mz);
      expect(mx / n).toBeCloseTo(EDGE_DIRS[i][0], 6); expect(mz / n).toBeCloseTo(EDGE_DIRS[i][1], 6);
    }
  });
  it('marks the edges where another ocean tile borders, on a known cluster', () => {
    // centre C; oceans on edges 1 (left) and 4 (right); land on edge 0; A is on edge 3 of C, so C is on A's edge 0
    const [lx, lz] = at2(1), [rx, rz] = at2(4), [gx, gz] = at2(0), [ax, az] = at2(3);
    const cells = [
      {id: 'C', x: 0, z: 0, ocean: true}, {id: 'L', x: lx, z: lz, ocean: true}, {id: 'R', x: rx, z: rz, ocean: true},
      {id: 'G', x: gx, z: gz, ocean: false}, {id: 'A', x: ax, z: az, ocean: true}, {id: 'far', x: 5 * step, z: 0, ocean: true},
    ];
    const m = oceanEdgeMap(cells);
    expect(m.get('C')).toEqual([false, true, false, true, true, false]);
    expect(m.get('L')!.map(Number).join('')).toBe('000010');
    // A also touches R (both border C, 60° apart): R lies on A's edge 5 (lower right), A on R's edge 2 (upper left)
    expect(m.get('A')).toEqual([true, false, false, false, false, true]);
    expect(m.get('R')).toEqual([false, true, true, false, false, false]);
    expect(m.get('far')).toEqual([false, false, false, false, false, false]);
    expect(m.has('G')).toBe(false);
    expect(edgeToward(-1, 0)).toBe(1);
    expect(edgeToward(1, 0)).toBe(4);
  });
  it('on a real board: every ocean edge flag is symmetric and lands on an adjacent space', () => {
    const spaces = (boards as Record<string, SpaceModel[]>).tharsis;
    const geo = board3d(spaces);
    const cells = geo.cells.map((c) => ({id: c.id, x: c.x, z: c.z, ocean: c.space.spaceType === 'ocean'}));
    const m = oceanEdgeMap(cells);
    const byId = new Map(cells.map((c) => [c.id, c]));
    const step0 = Math.min(...cells.flatMap((a) => cells.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z))));
    let flags = 0;
    for (const [id, e] of m) {
      const c = byId.get(id)!;
      e.forEach((on, i) => {
        if (!on) return;
        flags++;
        // the neighbour in that direction is an ocean whose opposite edge (i + 3) is set
        const n = cells.find((o) => o.ocean && Math.hypot(o.x - c.x - EDGE_DIRS[i][0] * step0, o.z - c.z - EDGE_DIRS[i][1] * step0) < step0 * 0.1)!;
        expect(n).toBeTruthy();
        expect(m.get(n.id)![(i + 3) % 6]).toBe(true);
      });
    }
    expect(flags).toBeGreaterThan(10);
  });
  it('on every map, with every ocean space filled, the flags are exactly the engine adjacency between oceans', () => {
    for (const [name, spaces] of Object.entries(boards as unknown as Record<string, Array<SpaceModel & {adjacent?: string[]}>>)) {
      const geo = board3d(spaces);
      const ocean = new Set(geo.cells.filter((c) => c.space.spaceType === 'ocean').map((c) => c.id));
      const m = oceanEdgeMap(geo.cells.map((c) => ({id: c.id, x: c.x, z: c.z, ocean: ocean.has(c.id)})));
      for (const sp of spaces) {
        if (!ocean.has(sp.id)) continue;
        const engine = (sp.adjacent ?? []).filter((a) => ocean.has(a)).length;
        expect([name, sp.id, m.get(sp.id)!.filter(Boolean).length]).toEqual([name, sp.id, engine]);
      }
    }
  });
});
