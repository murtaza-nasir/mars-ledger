import {describe, expect, it} from 'vitest';
import {cameraTarget, IDENTITY, LIVE, project, STORY} from '../src/client/tv/full/camera';
import {HEX_R, layout} from '../src/shared/hexgeo';
import boards from '../src/shared/data/boards.json';
import type {SpaceModel} from '../src/shared/full';

// The real maps, laid out exactly as the TV draws them.
const maps = Object.entries(boards as unknown as Record<string, SpaceModel[]>).map(([name, spaces]) => {
  const geo = layout(spaces);
  const discR = geo.width * 0.6;
  const extent = Math.max(...geo.cells.map((c) => Math.hypot(c.cx, c.cy))) + HEX_R;
  return {name, geo, discR, extent};
});

/** The farthest point of the drawn hex field under a camera, as a fraction of the disc radius. */
function reach(cam: ReturnType<typeof cameraTarget>, m: (typeof maps)[number]) {
  let far = 0;
  for (const c of m.geo.cells) {
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      const p = project(cam, {x: c.cx + HEX_R * Math.cos(a), y: c.cy + HEX_R * Math.sin(a)});
      far = Math.max(far, Math.hypot(p.x, p.y));
    }
  }
  return far / m.discR;
}

describe('camera target', () => {
  it('has the three maps to test against', () => {
    expect(maps.map((m) => m.name).sort()).toEqual(['elysium', 'hellas', 'tharsis']);
  });

  for (const m of maps) {
    it(`${m.name}: focusing any single space keeps every hex on the planet`, () => {
      for (const c of m.geo.cells) {
        const cam = cameraTarget([{x: c.cx, y: c.cy}], {discR: m.discR, extent: m.extent, enabled: true});
        expect(cam.scale).toBeGreaterThan(1);
        expect(cam.scale).toBeLessThanOrEqual(LIVE.maxZoom + 1e-9);
        expect(reach(cam, m)).toBeLessThanOrEqual(0.99 + 1e-9);
      }
    });

    it(`${m.name}: story pace stays gentler and on the planet`, () => {
      for (const c of m.geo.cells) {
        const cam = cameraTarget([{x: c.cx, y: c.cy}], {discR: m.discR, extent: m.extent, enabled: true, ...STORY});
        expect(cam.scale).toBeLessThanOrEqual(STORY.maxZoom + 1e-9);
        expect(reach(cam, m)).toBeLessThanOrEqual(0.99 + 1e-9);
      }
    });
  }

  it('random focus sets never push the board off the disc', () => {
    const m = maps[0];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 4);
      const pts = Array.from({length: n}, () => ({x: (rnd() * 2 - 1) * m.discR, y: (rnd() * 2 - 1) * m.discR}));
      expect(reach(cameraTarget(pts, {discR: m.discR, extent: m.extent, enabled: true}), m)).toBeLessThanOrEqual(0.99 + 1e-9);
    }
  });

  it('a placement at the centre gets the most zoom and no pan', () => {
    const m = maps[0];
    const cam = cameraTarget([{x: 0, y: 0}], {discR: m.discR, extent: m.extent, enabled: true});
    expect(cam.scale).toBeCloseTo(Math.min(LIVE.maxZoom, (0.99 * m.discR) / m.extent), 6);
    expect(Math.abs(cam.x) + Math.abs(cam.y)).toBeLessThan(1e-9);
  });

  it('the view moves toward the placement (centre of view shifts toward it)', () => {
    const m = maps[0];
    const p = {x: 200, y: -120};
    const cam = cameraTarget([p], {discR: m.discR, extent: m.extent, enabled: true});
    // the content point now at the screen centre: q = -(x, y) / scale
    const q = {x: -cam.x / cam.scale, y: -cam.y / cam.scale};
    expect(q.x * p.x + q.y * p.y).toBeGreaterThan(0);
    expect(Math.hypot(q.x, q.y)).toBeLessThan(Math.hypot(p.x, p.y));
  });

  it('several placements share the view of their centroid (no jumping between them)', () => {
    const m = maps[0];
    const o = {discR: m.discR, extent: m.extent, enabled: true};
    const a = {x: 150, y: 60}, b = {x: -40, y: 200}, c = {x: 10, y: -90};
    const both = cameraTarget([a, b, c], o);
    const centroid = cameraTarget([{x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3}], o);
    expect(both.x).toBeCloseTo(centroid.x, 9);
    expect(both.y).toBeCloseTo(centroid.y, 9);
    expect(both.scale).toBeCloseTo(centroid.scale, 9);
  });

  it('adding a second placement changes the target only a little (smooth retarget)', () => {
    const m = maps[0];
    const o = {discR: m.discR, extent: m.extent, enabled: true};
    const one = cameraTarget([{x: 120, y: 80}], o);
    const two = cameraTarget([{x: 120, y: 80}, {x: 160, y: 40}], o);
    expect(Math.hypot(two.x - one.x, two.y - one.y)).toBeLessThan(40);
    expect(Math.abs(two.scale - one.scale)).toBeLessThan(0.05);
  });

  it('no move when disabled (reduced motion, cinematic or production show) or with nothing to look at', () => {
    const m = maps[0];
    expect(cameraTarget([{x: 100, y: 100}], {discR: m.discR, extent: m.extent, enabled: false})).toEqual(IDENTITY);
    expect(cameraTarget([], {discR: m.discR, extent: m.extent, enabled: true})).toEqual(IDENTITY);
  });

  it('a board too big to zoom at all stays still', () => {
    expect(cameraTarget([{x: 10, y: 10}], {discR: 100, extent: 99.5, enabled: true})).toEqual(IDENTITY);
  });
});
