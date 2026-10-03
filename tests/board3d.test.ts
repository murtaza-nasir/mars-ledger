// The 3D board: its geometry against the engine's boards, the camera's framing, clamping and
// springs, the frame-time fallback, and the TV settings that switch it.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import boards from '../src/shared/data/boards.json';
import {BOARD_NAMES} from '../src/shared/board';
import type {SpaceModel} from '../src/shared/full';
import {HEX_R, HEX_W, layout} from '../src/client/tv/full/geometry';
import {board3d, HEIGHT, MODEL_TALL, prismHeight, PRISM_R, restPoints, restScale, TILE_HEIGHT, UNIT} from '../src/client/tv/full/board3d/geometry3d';
import {cameraPosition, fallbackStep, FALLBACK, FOCUS, focusView, FOV, frameXY, lensOf, MOMENT, momentView, moveAmount, p95, refDist, REST_POLAR, REST_TILT, restView, stepView, ZERO_VEL}
  from '../src/client/tv/full/board3d/camera3d';
import type {View} from '../src/client/tv/full/board3d/camera3d';
import {KICK, seeded, SPECIAL_MODELS, TILE_RENDERERS} from '../src/client/tv/full/board3d/tiles3d';
import {TILE} from '../src/shared/full';
import {DEFAULT_SETTINGS, parseSettings} from '../src/client/tv/settings';

type BoardSpace = SpaceModel & {adjacent: string[]};
const DATA = boards as unknown as Record<string, BoardSpace[]>;

/** Project a world point with a camera at view v onto a w×h canvas. */
function projector(v: View, w: number, h: number) {
  const cam = new THREE.PerspectiveCamera(FOV, w / h, 0.5, 200);
  cam.position.set(...cameraPosition(v));
  cam.lookAt(v.tx, 0, v.tz);
  cam.updateMatrixWorld();
  return (x: number, y: number, z: number) => { const p = new THREE.Vector3(x, y, z).project(cam); return {x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h}; };
}

describe.each(BOARD_NAMES)('%s board in 3D', (name) => {
  const spaces = DATA[name];
  const onMap = spaces.filter((s) => s.x >= 0);
  const geo = board3d(spaces);

  it('places all 61 spaces exactly where the flat board does, scaled into the world', () => {
    const flat = layout(spaces);
    expect(geo.cells).toHaveLength(61);
    for (const c of flat.cells) {
      const c3 = geo.cells.find((x) => x.id === c.id)!;
      expect(c3.x).toBeCloseTo(c.cx * UNIT, 9);
      expect(c3.z).toBeCloseTo(c.cy * UNIT, 9);
    }
  });

  it('puts every space next to exactly its engine neighbours, and the prisms never overlap', () => {
    const w = HEX_W * UNIT;
    for (const s of onMap) {
      const a = geo.cells.find((c) => c.id === s.id)!;
      const near = geo.cells.filter((b) => b.id !== s.id && Math.hypot(a.x - b.x, a.z - b.z) < w * 1.1).map((b) => b.id).sort();
      expect({id: s.id, n: near}).toEqual({id: s.id, n: s.adjacent});
      for (const b of geo.cells) if (b.id !== s.id) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(PRISM_R * Math.sqrt(3) - 1e-9);
    }
  });

  it('keeps every space on the planet plate, and Ganymede and Phobos off the map at the top', () => {
    expect(geo.extent).toBeLessThan(geo.discR);
    expect(geo.offMap.map((o) => [o.id, o.label])).toEqual([['01', 'Ganymede'], ['02', 'Phobos']]);
    const topRow = Math.min(...geo.cells.map((c) => c.z));
    for (const o of geo.offMap) {
      expect(o.z).toBeLessThan(topRow + HEX_R * UNIT);
      expect(Math.abs(o.x)).toBeGreaterThan(Math.max(...geo.cells.filter((c) => Math.abs(c.z - topRow) < 1e-9).map((c) => Math.abs(c.x))));
      expect(Math.hypot(o.x, o.z)).toBeLessThan(geo.discR * 1.15);
    }
  });

  it('gives ocean spaces lower prisms than land, varies land subtly and deterministically, and raises tiles by kind', () => {
    for (const s of onMap) {
      const h = prismHeight(s);
      expect(h).toBe(prismHeight(s));
      const base = s.spaceType === 'ocean' ? HEIGHT.ocean : HEIGHT.land;
      expect(Math.abs(h - base)).toBeLessThanOrEqual(HEIGHT.variation / 2 + 1e-12);
    }
    const land = onMap.find((s) => s.spaceType === 'land')!;
    expect(prismHeight({...land, tileType: 2})).toBe(TILE_HEIGHT.city);
    expect(prismHeight({...land, tileType: 1})).toBe(TILE_HEIGHT.ocean);
    expect(prismHeight({...land, tileType: 0})).toBe(TILE_HEIGHT.greenery);
    expect(Object.keys(TILE_RENDERERS).sort()).toEqual(['city', 'greenery', 'ocean', 'special']);
    for (const [k, r] of Object.entries(TILE_RENDERERS)) expect(r.height).toBe(TILE_HEIGHT[k as keyof typeof TILE_HEIGHT]);
  });

  it('gives every kind a model, every placeable special its own, and a camera bounce per kind', () => {
    for (const r of Object.values(TILE_RENDERERS)) expect(r.Model).toBeTypeOf('function');
    const specials = Object.values(TILE).filter((t) => t !== TILE.GREENERY && t !== TILE.OCEAN && t !== TILE.CITY && t !== TILE.CAPITAL);
    expect([...SPECIAL_MODELS].sort((a, b) => a - b)).toEqual([...specials].sort((a, b) => a - b));
    for (const k of Object.keys(TILE_RENDERERS)) expect(KICK[k as keyof typeof KICK]).toBeGreaterThan(0);
  });

  it('seeds each tile from its space id: the same space always grows the same city', () => {
    const a = seeded('31'), b = seeded('31'), c = seeded('32');
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });

  // the free region between the TV's columns (FullTv measures it): 1920x1080, the 90" TV at 1536x729 (and 6144x2916),
  // the small TV at 3840x2016, and a narrow one
  it.each([[1064, 971], [851, 648], [2125, 1835], [700, 900]])('fills a %ix%i frame with the map at rest, nothing clipped (Ganymede, Phobos, tall models)', (w, h) => {
    const pts = restPoints(geo);
    const rest = restView(pts, w / h);
    expect(rest.polar).toBeGreaterThanOrEqual(REST_TILT.min - 1e-9);
    expect(rest.polar).toBeLessThanOrEqual(REST_TILT.max + 1e-9);
    let mx = 0, my = 0;
    for (const p of pts) {
      const q = frameXY(rest, w / h, p);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(1 + 1e-6); expect(Math.abs(q.y)).toBeLessThanOrEqual(1 + 1e-6);
      mx = Math.max(mx, Math.abs(q.x)); my = Math.max(my, Math.abs(q.y));
    }
    // it touches the frame on one axis at least (that is what fills means)
    expect(Math.max(mx, my)).toBeGreaterThan(0.999);
    // the tallest model over the farthest row and the off-map spaces are among the points
    const top = Math.min(...geo.cells.map((c) => c.z));
    expect(pts.some((p) => Math.abs(p[2] - top) < PRISM_R && p[1] > MODEL_TALL * PRISM_R)).toBe(true);
    for (const o of geo.offMap) expect(pts.some((p) => Math.hypot(p[0] - o.x, p[2] - o.z) < PRISM_R * 1.3)).toBe(true);
    const at = (x: number, y: number, z: number) => { const q = frameXY(rest, w / h, [x, y, z]); return {x: (q.x + 1) / 2 * w, y: (1 - q.y) / 2 * h}; };
    const first = geo.cells.find((c) => c.id === onMap.find((s) => s.y === 0)!.id)!;
    const last = geo.cells.find((c) => c.id === onMap.find((s) => s.y === 8)!.id)!;
    expect(at(first.x, 0, first.z).y).toBeLessThan(at(last.x, 0, last.z).y);
    // a 3/4 tilt: the far row is foreshortened and further away, but keeps about 70% of the near row's height
    const s = restScale(geo, rest, w, h);
    expect(s.pxPerUnit * 2 * HEX_R).toBeGreaterThan(s.hexPx * 0.68);
    expect(s.pxPerUnit * 2 * HEX_R).toBeLessThan(s.hexPx);
  });

  it('keeps the resting map out of a corner something else covers (the radio deck), shrinking only as needed', () => {
    const pts = restPoints(geo), w = 851, h = 648;
    const free = restView(pts, w / h);
    const deck = {x0: -1.1, x1: -0.45, y0: -1.1, y1: -0.35};
    const v = restView(pts, w / h, [deck]);
    expect(v.dist).toBeGreaterThan(free.dist);
    expect(v.dist).toBeLessThan(free.dist * 1.6);
    for (const p of pts) {
      const q = frameXY(v, w / h, p);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(1 + 1e-6); expect(Math.abs(q.y)).toBeLessThanOrEqual(1 + 1e-6);
      expect(q.x > deck.x0 && q.x < deck.x1 && q.y > deck.y0 && q.y < deck.y1).toBe(false);
    }
  });

  it('draws through the lens what the frame maths says: the frame inside a full-screen canvas', () => {
    const W = 1920, H = 1080, f = {x: 227, y: 17, w: 1064, h: 971};
    const rest = restView(restPoints(geo), f.w / f.h);
    const l = lensOf(W, H, f);
    const cam = new THREE.PerspectiveCamera(l.fov, l.aspect, 0.5, 200);
    cam.setViewOffset(...l.view);
    cam.position.set(...cameraPosition(rest));
    cam.lookAt(rest.tx, 0, rest.tz);
    cam.updateMatrixWorld();
    for (const c of geo.cells.filter((_, i) => i % 5 === 0)) {
      const p = new THREE.Vector3(c.x, 0.1, c.z).project(cam);
      const q = frameXY(rest, f.w / f.h, [c.x, 0.1, c.z]);
      expect((p.x + 1) / 2 * W).toBeCloseTo(f.x + (q.x + 1) / 2 * f.w, 3);
      expect((1 - p.y) / 2 * H).toBeCloseTo(f.y + (1 - q.y) / 2 * f.h, 3);
    }
  });
});

describe('the 3D camera', () => {
  const geo = board3d(DATA.tharsis);
  const R = geo.discR;
  const rest = restView(restPoints(geo), 1.2);

  it('stays at rest when moves are off, with nothing to look at, or under reduced motion (enabled false)', () => {
    const corner = geo.cells[0];
    expect(focusView([], rest, {enabled: true, R})).toEqual(rest);
    expect(focusView([{x: corner.x, z: corner.z}], rest, {enabled: false, R})).toEqual(rest);
  });

  it('dollies in and tilts toward a placement, swung to its side', () => {
    const left = geo.cells.reduce((a, b) => (b.x < a.x ? b : a));
    const v = focusView([{x: left.x, z: left.z}], rest, {enabled: true, R});
    expect(v.dist).toBeCloseTo(refDist(R) / FOCUS.zoom);
    expect(v.polar).toBeGreaterThan(rest.polar);
    expect(v.tx).toBeLessThan(0);
    expect(v.azimuth).toBeGreaterThan(0);
  });

  it('never pans past the clamp, so the plate stays the subject, for every space on every map', () => {
    for (const name of BOARD_NAMES) {
      const g = board3d(DATA[name]);
      for (const c of [...g.cells, ...g.offMap]) {
        const v = focusView([{x: c.x, z: c.z}], rest, {enabled: true, R: g.discR});
        expect(Math.hypot(v.tx, v.tz)).toBeLessThanOrEqual(FOCUS.clamp * g.discR + 1e-9);
      }
      // a far ask (well off the plate) is clamped too
      const far = focusView([{x: 50, z: -50}], rest, {enabled: true, R: g.discR});
      expect(Math.hypot(far.tx, far.tz)).toBeCloseTo(FOCUS.clamp * g.discR);
    }
  });

  it('keeps the whole focused space on screen at the closest view, for every space', () => {
    const w = 1067, h = 961;
    const r0 = restView(restPoints(geo), w / h);
    for (const c of geo.cells) {
      const v = focusView([{x: c.x, z: c.z}], r0, {enabled: true, R});
      const at = projector(v, w, h);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const p = at(c.x + Math.cos(a) * PRISM_R, 0.15, c.z + Math.sin(a) * PRISM_R);
        expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(w);
        expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(h);
      }
    }
  });

  it('dives to a placement: the model middle sits at the centre of the screen, the hex about two-fifths tall', () => {
    const w = 1067, h = 961;
    const r0 = restView(restPoints(geo), w / h);
    for (const c of geo.cells.filter((_, i) => i % 7 === 0)) {
      const y = 0.4;
      const v = focusView([{x: c.x, z: c.z, y}], r0, {enabled: true, R});
      const at = projector(v, w, h);
      const mid = at(c.x, y, c.z);
      // centred unless the space is near the rim, where the pan clamp holds the plate in view
      if (Math.hypot(c.x, c.z) < FOCUS.clamp * R * 0.95) {
        expect(Math.abs(mid.x - w / 2)).toBeLessThan(w * 0.04);
        expect(Math.abs(mid.y - h / 2)).toBeLessThan(h * 0.04);
      }
      const top = at(c.x, 0.15, c.z - PRISM_R), bottom = at(c.x, 0.15, c.z + PRISM_R);
      expect((bottom.y - top.y) / h).toBeGreaterThan(0.3);
    }
  });

  it('shares a centroid for several placements at once', () => {
    const a = geo.cells[10], b = geo.cells[50];
    const both = focusView([{x: a.x, z: a.z}, {x: b.x, z: b.z}], rest, {enabled: true, R});
    const mid = focusView([{x: (a.x + b.x) / 2, z: (a.z + b.z) / 2}], rest, {enabled: true, R});
    expect(both.tx).toBeCloseTo(mid.tx); expect(both.tz).toBeCloseTo(mid.tz);
  });

  it('springs converge without overshooting far, and a retarget mid-move keeps velocity (no snap)', () => {
    const target = focusView([{x: geo.cells[0].x, z: geo.cells[0].z}], rest, {enabled: true, R});
    let s = {view: rest, vel: {...ZERO_VEL}};
    let minDist = Infinity;
    for (let i = 0; i < 300; i++) { s = stepView(s.view, s.vel, target, 1 / 60); minDist = Math.min(minDist, s.view.dist); }
    expect(s.view.dist).toBeCloseTo(target.dist, 3);
    expect(s.view.tx).toBeCloseTo(target.tx, 3);
    expect(target.dist - minDist).toBeLessThan((rest.dist - target.dist) * 0.08);
    // retarget halfway: the next frame moves on from where it was, at most one frame's travel
    let m = {view: rest, vel: {...ZERO_VEL}};
    for (let i = 0; i < 15; i++) m = stepView(m.view, m.vel, target, 1 / 60);
    const other = focusView([{x: geo.cells[60].x, z: geo.cells[60].z}], rest, {enabled: true, R});
    const before = m.view;
    const next = stepView(m.view, m.vel, other, 1 / 60);
    expect(Math.abs(next.view.tx - before.tx)).toBeLessThan(Math.abs(m.vel.tx) / 60 + 0.02);
    expect(Math.sign(next.vel.dist)).toBe(Math.sign(m.vel.dist));
  });

  it('measures the move for the fog: 0 at rest, 1 fully in', () => {
    const v = focusView([{x: 0, z: 0}], rest, {enabled: true, R});
    expect(moveAmount(rest, rest)).toBe(0);
    expect(moveAmount(v, rest, 'live', refDist(R))).toBeCloseTo(1);
  });

  it('flies over for a big moment, then lets go', () => {
    const mid = momentView(rest, MOMENT.hold / 2, 'max')!;
    expect(mid.dist).toBeLessThan(rest.dist);
    expect(mid.polar).toBeGreaterThan(rest.polar);
    expect(momentView(rest, 0, 'max')!.azimuth).toBeLessThan(0);
    expect(momentView(rest, MOMENT.hold, 'max')!.azimuth).toBeGreaterThan(0);
    expect(momentView(rest, MOMENT.hold / 2, 'step')!.dist).toBeGreaterThan(mid.dist);
    expect(momentView(rest, MOMENT.hold + 0.01, 'max')).toBeNull();
    expect(momentView(rest, -1, 'max')).toBeNull();
  });

  it('flies a big moment as a low pass across the board, well above the tallest model, on every map', () => {
    for (const name of BOARD_NAMES) {
      const g = board3d(DATA[name]);
      const r0 = restView(restPoints(g), 1067 / 961);
      let minY = Infinity;
      const xs: number[] = [];
      for (let t = 0; t <= MOMENT.hold; t += 0.1) {
        const v = momentView(r0, t, 'max', refDist(g.discR))!;
        minY = Math.min(minY, cameraPosition(v)[1]);
        xs.push(v.tx);
      }
      // down among the fog decks (well below the resting camera) but above every model (models stand ≤ ~1.2)
      expect(minY).toBeGreaterThan(2.5);
      expect(minY).toBeLessThan(cameraPosition(r0)[1] * 0.3);
      // the aim travels across the board, left to right
      expect(xs[0]).toBeLessThan(-g.discR * 0.3);
      expect(xs[xs.length - 1]).toBeGreaterThan(g.discR * 0.3);
    }
  });

  it('dives low enough to pass down through the fog decks', () => {
    const v = focusView([{x: 0, z: 0, y: 0.4}], rest, {enabled: true, R});
    // the lowest fog deck hangs at 0.16 of the reference camera's height; a dive ends below it
    expect(cameraPosition(v)[1]).toBeLessThan(refDist(R) * Math.cos(REST_POLAR) * 0.16);
    expect(cameraPosition(v)[1]).toBeGreaterThan(1.3);
  });
});

describe('the frame-time fallback', () => {
  const fast = Array(180).fill(16.7);
  const slow = Array(60).fill(40);
  it('computes the 95th percentile', () => {
    expect(p95([...Array(95).fill(10), ...Array(5).fill(50)])).toBe(50);
    expect(p95([...Array(96).fill(10), ...Array(4).fill(50)])).toBe(10);
    expect(p95([])).toBe(0);
  });
  it('ignores the warm-up and windows with too few frames', () => {
    expect(fallbackStep({bad: 0}, slow, FALLBACK.warmupMs - 1)).toEqual({bad: 0, fallback: false});
    expect(fallbackStep({bad: 1}, slow.slice(0, 10), 10000)).toEqual({bad: 1, fallback: false});
  });
  it('falls back only after consecutive slow windows; one good window resets', () => {
    let st = fallbackStep({bad: 0}, slow, 5000);
    expect(st).toMatchObject({bad: 1, fallback: false});
    st = fallbackStep(st, fast, 8000);
    expect(st).toMatchObject({bad: 0, fallback: false});
    st = fallbackStep(st, slow, 11000);
    st = fallbackStep(st, slow, 14000);
    expect(st.fallback).toBe(true);
  });
  it('skips windows in which the page did not have focus', () => {
    expect(fallbackStep({bad: 1}, slow, 9000, false)).toEqual({bad: 1, fallback: false});
    const st = fallbackStep(fallbackStep({bad: 0}, slow, 5000), slow, 8000);
    expect(st.fallback).toBe(true);
    expect(st.stats).toEqual({p95: 40, median: 40, gaps: 0, frames: 60});
  });
  it('reports the share of held-back frames', () => {
    const st = fallbackStep({bad: 0}, [...Array(30).fill(16.7), ...Array(10).fill(120)], 5000);
    expect(st.stats?.gaps).toBe(0.25);
  });
  it('treats a frame just inside the budget as fine', () => {
    expect(fallbackStep({bad: 1}, Array(100).fill(FALLBACK.budgetP95), 9000)).toMatchObject({bad: 0, fallback: false});
  });
});

describe('3D board settings', () => {
  it('defaults the 3D board and camera moves on', () => {
    expect(DEFAULT_SETTINGS.board3d).toBe(true);
    expect(DEFAULT_SETTINGS.cameraMoves).toBe(true);
  });
  it('keeps saved switches and ignores junk', () => {
    expect(parseSettings(JSON.stringify({board3d: false, cameraMoves: false}))).toMatchObject({board3d: false, cameraMoves: false});
    expect(parseSettings(JSON.stringify({board3d: 'no', cameraMoves: 0}))).toMatchObject({board3d: true, cameraMoves: true});
    expect(parseSettings('not json')).toMatchObject({board3d: true, cameraMoves: true});
  });
});
