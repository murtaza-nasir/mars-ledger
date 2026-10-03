// The plan of a Detailed City or Capital: where every building, park, pad, road, track, crane and light stands.
// Unit radius, y = 0 is the prism top. One plan per (space id, capital, detail), cached and shared by instances.
// The layout comes from one random stream consumed identically for 'full' and 'lite', so both draw the same tile;
// small parts (balconies, trees, vehicles, people, scaffolds) take a second stream that only 'full' reads.
import * as THREE from 'three';
import {seeded} from '../../tiles3d';
import {DomeBuilder, GK, GlowBuilder, Mesh, type V3} from './CityDetailBuild';

const SLAB = 0.03;
const k = (h: string) => new THREE.Color(h);
const mixc = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);
const PALETTE = ['#f6f1e8', '#e8d2b0', '#b4c4d6', '#c98a66', '#8f9cae', '#f0e0c4', '#dcd5c8', '#e9b99a'].map(k);
const DARK = k('#34343c'), STEEL = k('#aab4c0'), COPPER = k('#c27b4c'), GREEN = k('#4fae5a'), WARM = k('#ffb060'), WHITE = k('#ffffff');
const ASPHALT = k('#3d3d45'), STONE = k('#cdbfae'), ORANGE = k('#e0752f'), AQUA = k('#4fc7e0');
const TREES = ['#3f9a4e', '#2f7f45', '#58b15a', '#7fa83f', '#d98a4a', '#e0a0b8'].map(k);
const TAU = Math.PI * 2;

export type Plan = {
  body: THREE.BufferGeometry; mov: THREE.BufferGeometry; scaf: THREE.BufferGeometry | null; dome: THREE.BufferGeometry; glow: THREE.BufferGeometry;
  blobs: Array<[number, number, number, number]>; light: number; seconds: number;
  tris: {body: number; mov: number; scaf: number; dome: number; glow: number};
};

const MOVER_SPEC: Array<[string, number]> = [['aPiv', 3], ['aMv', 4], ['aDl', 4], ['aE', 1]];
const BODY_SPEC: Array<[string, number]> = [['aAnim', 4], ['aSty', 4]];
const SCAF_SPEC: Array<[string, number]> = [['aAnim', 4]];

function makePlan(id: string, grand: boolean, lite: boolean): Plan {
  const F = !lite;
  const rnd = seeded(id, grand ? 31 : 5), rd = seeded(id, grand ? 77 : 55);
  const R = (a: number, b: number) => a + (b - a) * rnd();
  const Rd = (a: number, b: number) => a + (b - a) * rd();
  const body = new Mesh(BODY_SPEC), mov = new Mesh(MOVER_SPEC), scaf = new Mesh(SCAF_SPEC);
  const dome = new DomeBuilder(F ? 24 : 16, F ? 9 : 6), glow = new GlowBuilder();
  const blobs: Plan['blobs'] = [];
  const LIGHT = grand ? 3.5 : 3.1, FALL = grand ? 3.4 : 3.0, ARRIVE = LIGHT + 0.2;
  let seedN = 1, seedD = 100;
  const setB = (base: number, delay: number, win: number, cw = 0.05, ch = 0.06, ty = 0) => body.set([base, delay, seedN++ * 1.37 + 0.53, win], [cw, ch, ty, 0]);
  /** the same for parts only the full plan has (its own counter, so the shared parts keep their window patterns) */
  const setD = (base: number, delay: number, win: number, cw = 0.05, ch = 0.06, ty = 0) => body.set([base, delay, seedD++ * 1.91 + 0.17, win], [cw, ch, ty, 0]);
  const rise = (x: number, z: number, kk: number) => (grand ? 1.2 : 1.05) + (Math.hypot(x, z) / 0.8) * 0.8 + kk * 0.2 + rnd() * 0.1;
  const pick = () => PALETTE[Math.floor(rnd() * PALETTE.length)];

  // a mover part: pivot, kind (0 still, 1 spin about the pivot, 2 line ping-pong, 3 line loop, 4 bob, 5 arc ping-pong,
  // 6 shuttle lift cycle, 7 arc loop), speed, phase, amp (span / height), delta, delay, emissive (1 lit, 2 owner)
  const mv = (piv: V3, kind: number, speed: number, phase: number, amp: number, delta: V3 = [0, 0, 0], delay = ARRIVE, em = 0) =>
    mov.set(piv, [kind, speed, phase, amp], [delta[0], delta[1], delta[2], delay], [em]);

  // ---- placement ---------------------------------------------------------------------------------------------------
  const taken: Array<{x: number; z: number; r: number}> = [{x: 0, z: 0.7, r: 0.17}];
  const place = (r: number, gap: number, maxD = 0.7, front: boolean | 'back' = false) => {
    let best: {x: number; z: number} | null = null;
    for (let kk = 0; kk < 160; kk++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * (maxD - r);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r + gap)) {
        if (!front) { best = {x, z}; break; }
        if (!best || (front === 'back' ? z < best.z : z > best.z)) best = {x, z};
        if (kk > 60 && best) break;
      }
    }
    if (best) taken.push({x: best.x, z: best.z, r});
    return best;
  };
  type Item = {x: number; z: number; r: number; h: number; kind: 'tower' | 'dome' | 'block' | 'pad'; delay: number};
  const items: Item[] = [];
  const scaffolds: Array<{x: number; z: number; r: number; h: number}> = [];

  // ---- foundation: the stamped slab, a hex frame, service plates ------------------------------------------------------
  body.set([-0.02, -1, 0, -3], [0.1, 0.08, 1, 0]);
  body.prism(0, 0, 0.93, 0.93, 6, 0, -0.02, SLAB, mixc(DARK, COPPER, 0.25), {top: mixc(k('#6a5a50'), STEEL, 0.2)});
  if (F) {
    // raised hex curb with an inset groove
    body.set([SLAB, -1, 0, 0], [0.1, 0.08, 0, 0]);
    body.prism(0, 0, 0.93, 0.93, 6, 0, SLAB, SLAB + 0.012, mixc(STEEL, DARK, 0.4), {cap: false});
    body.prism(0, 0, 0.96, 0.96, 6, 0, -0.02, SLAB * 0.5, mixc(DARK, COPPER, 0.3), {cap: false});
    setD(SLAB, 0.5, 0, 0.1, 0.1, 0);
    for (let i = 0; i < 6; i++) {
      const c0 = [Math.sin((i / 6) * TAU) * 0.915, Math.cos((i / 6) * TAU) * 0.915], c1 = [Math.sin(((i + 1) / 6) * TAU) * 0.915, Math.cos(((i + 1) / 6) * TAU) * 0.915];
      for (let q = 0; q < 7; q++) {
        const t0 = q / 7, t1 = (q + 1) / 7;
        const p0: V3 = [c0[0] + (c1[0] - c0[0]) * t0, SLAB + 0.032, c0[1] + (c1[1] - c0[1]) * t0], p1: V3 = [c0[0] + (c1[0] - c0[0]) * t1, SLAB + 0.032, c0[1] + (c1[1] - c0[1]) * t1];
        body.beam([p0[0], SLAB, p0[2]], p0, 0.0022, 4, STEEL);
        body.beam(p0, p1, 0.0014, 3, mixc(STEEL, WHITE, 0.3));
      }
    }
  }

  // ---- ring road and its arc (the +z gap keeps the owner's cube and the camera's view open) ----------------------------
  const RA0 = 0.5, RA1 = TAU - 0.5, ROAD_R = 0.77, TRACK_Y = 0.27;
  const arcStrip = (r0: number, r1: number, y: number, a0: number, a1: number, n: number, color: THREE.Color, every = 1) => {
    for (let i = 0; i < n; i += every) {
      const aa = a0 + (a1 - a0) * (i / n), ab = a0 + (a1 - a0) * ((i + (every > 1 ? 0.5 : 1)) / n);
      const p = (a: number, r: number): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];
      body.tri(p(aa, r0), p(aa, r1), p(ab, r1), color); body.tri(p(aa, r0), p(ab, r1), p(ab, r0), color);
    }
  };
  body.set([SLAB, 0.4, 0, -3], [0.1, 0.08, 0, 0]);
  arcStrip(ROAD_R - 0.035, ROAD_R + 0.035, SLAB + 0.002, RA0, RA1, F ? 56 : 28, ASPHALT);
  if (F) { body.set([SLAB, 0.5, 0, -3], [0.1, 0.08, 0, 0]); arcStrip(ROAD_R - 0.003, ROAD_R + 0.003, SLAB + 0.0035, RA0, RA1, 84, k('#e8dcc0'), 2); }

  // ---- glass parks -----------------------------------------------------------------------------------------------------
  const domeSpots: Array<{x: number; z: number; r: number}> = [];
  if (grand) {
    taken.push({x: 0, z: 0, r: 0.4});
    const n = 3, off = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU + (rnd() - 0.5) * 0.3, r = R(0.17, 0.21), d = 0.7 - r - 0.02;
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (Math.hypot(x, z - 0.7) < r + 0.17) continue;
      taken.push({x, z, r}); domeSpots.push({x, z, r});
    }
  } else {
    const n = rnd() < 0.6 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const r = R(0.2, 0.27), p = place(r, 0.03, 0.72, true);
      if (p) domeSpots.push({...p, r});
    }
  }
  const tree = (x: number, y: number, z: number, s: number, c: THREE.Color) => {
    if (F) {
      body.prism(x, z, 0.0035 * s, 0.003 * s, 4, 0, y, y + 0.012 * s, k('#6a4a34'), {cap: false});
      body.prism(x, z, 0.02 * s, 0.002, 6, 0, y + 0.008 * s, y + 0.034 * s, c, {cap: false});
      body.prism(x, z, 0.015 * s, 0.002, 6, 0, y + 0.024 * s, y + 0.048 * s, mixc(c, WHITE, 0.12), {cap: false});
    } else body.prism(x, z, 0.02 * s, 0.002, 5, 0, y, y + 0.045 * s, c, {cap: false});
  };
  domeSpots.forEach((d, i) => {
    const delay = (grand ? 1.5 : 1.35) + i * 0.15, h = d.r * R(0.78, 0.95);
    dome.dome(d.x, SLAB, d.z, d.r, h, delay);
    // glazed skirt, lawn, lake, paths, pavilions, trees
    setB(SLAB, delay - 0.3, 0.8, 0.04, 0.04, 1);
    body.prism(d.x, d.z, d.r * 1.05, d.r * 1.05, F ? 20 : 14, 0, SLAB, SLAB + 0.045, mixc(STEEL, WHITE, 0.2), {top: STEEL});
    body.set([SLAB, delay - 0.3, 0, -6], [0.1, 0.1, 0, 0]);
    body.prism(d.x, d.z, d.r * 0.95, d.r * 0.95, F ? 20 : 12, 0, SLAB, SLAB + 0.05, GREEN);
    const la = rnd() * TAU, lx = d.x + Math.sin(la) * d.r * 0.3, lz = d.z + Math.cos(la) * d.r * 0.3, lr = d.r * 0.26;
    body.set([SLAB + 0.05, delay - 0.2, 0, -1], [0.1, 0.1, 0, 0]);
    body.prism(lx, lz, lr, lr, F ? 14 : 8, 0, SLAB + 0.05, SLAB + 0.054, AQUA);
    const pa = rnd() * 3;
    if (F) { body.set([SLAB + 0.05, delay, 1, -4], [0.1, 0.1, 0, 0]); body.obox([lx, SLAB + 0.057, lz], [lr * 2.5, 0.004, 0.014], pa + 0.8, 0, STONE); }
    body.set([SLAB + 0.05, delay - 0.1, 0, -4], [0.1, 0.1, 0, 0]);
    if (F) {
      body.obox([d.x, SLAB + 0.052, d.z], [d.r * 1.7, 0.003, 0.018], pa, 0, STONE);
      body.obox([d.x, SLAB + 0.052, d.z], [d.r * 1.3, 0.003, 0.014], pa + 1.4, 0, STONE);
    }
    const nb = 3 + Math.floor(rnd() * 3);
    for (let b = 0; b < nb; b++) {
      const a = rnd() * 6.28, dd = Math.sqrt(rnd()) * d.r * 0.62, bx = d.x + Math.sin(a) * dd, bz = d.z + Math.cos(a) * dd, bh = R(0.06, 0.14) * (d.r / 0.25), yw = rnd();
      const col = mixc(WARM, WHITE, 0.4);
      if (Math.hypot(bx - lx, bz - lz) < lr + 0.02) continue;
      setB(SLAB + 0.05, delay + 0.1, 0.75, 0.03, 0.035, 3);
      body.box(bx, bz, 0.045, 0.045, yw, SLAB + 0.05, SLAB + 0.05 + bh * 0.7, col, mixc(col, DARK, 0.4));
    }
    const nt = F ? 20 : 4;
    for (let t = 0; t < nt; t++) {
      const a = Rd(0, TAU), dd = Math.sqrt(rd()) * d.r * 0.8, x = d.x + Math.sin(a) * dd, z = d.z + Math.cos(a) * dd;
      if (Math.hypot(x - lx, z - lz) < lr + 0.012) continue;
      body.set([SLAB + 0.05, delay + 0.25 + t * 0.012, 1 + t, -6], [0.1, 0.1, 0, 0]);
      tree(x, SLAB + 0.05, z, Rd(0.8, 1.5) * (d.r / 0.23), TREES[Math.floor(rd() * TREES.length)]);
    }
    if (F) for (let p = 0; p < 3; p++) {
      const s0 = Rd(0, TAU), x0 = d.x + Math.sin(s0) * d.r * 0.5, z0 = d.z + Math.cos(s0) * d.r * 0.5;
      mv([x0, SLAB + 0.06, z0], 3, Rd(0.03, 0.07), Rd(0, 1), 0, [Rd(-0.12, 0.12), 0, Rd(-0.12, 0.12)], delay + 0.9);
      person(x0, SLAB + 0.05, z0, Rd(0, 1));
    }
    glow.add([d.x, SLAB + h * 0.25, d.z], d.r * 0.8, GK.steady, rnd() * 6, delay + 0.3, WARM);
    glow.add([lx, SLAB + 0.08, lz], 0.07, GK.shimmer, rnd() * 6, delay + 0.4, AQUA);
    blobs.push([d.x, d.z, d.r * 1.0, 0.5]);
    items.push({x: d.x, z: d.z, r: d.r, h: 0.12, kind: 'dome', delay});
  });
  // a person: a tiny capsule on a mover loop (the caller has set the mover's motion just before)
  function person(x: number, y: number, z: number, hue: number) {
    const c = new THREE.Color().setHSL(hue, 0.55, 0.55);
    mov.prism(x, z, 0.0042, 0.0034, 5, 0, y, y + 0.014, c, {top: k('#e8c9a8')});
  }

  // ---- building types ----------------------------------------------------------------------------------------------------
  const antenna = (x: number, y: number, z: number, len: number, delay: number, hero: boolean, bk: number) => {
    body.set([y, delay + 0.3, 0, 0], [0.1, 0.1, 0, 0]);
    body.beam([x, y, z], [x, y + len, z], 0.0045, 4, STEEL);
    if (F) { body.beam([x - 0.02, y + len * 0.6, z], [x + 0.02, y + len * 0.6, z], 0.0025, 4, STEEL); body.beam([x, y + len * 0.8, z - 0.015], [x, y + len * 0.8, z + 0.015], 0.0025, 4, STEEL); }
    glow.add([x, y + len + 0.01, z], hero ? 0.2 : 0.13, GK.beacon, bk * 6.28, delay + 0.75, k(bk > 0.55 ? '#ff4a3a' : '#ffffff'), [0, 0, 0, 2.2 + bk * 1.2]);
  };
  /** rooftop gear: solar rows, dish, tank, vent; only the full plan has them */
  const roofGear = (x: number, z: number, r: number, y: number, delay: number, variant: number) => {
    body.set([y, delay + 0.25, 0, 0], [0.1, 0.1, 0, 0]);
    body.box(x + r * 0.15, z - r * 0.1, r * 0.7, r * 0.5, 0.3, y, y + 0.025, mixc(STEEL, DARK, 0.4), mixc(STEEL, DARK, 0.5));
    if (!F) return;
    if (variant === 0) {
      body.set([y, delay + 0.35, 0, -2], [0.1, 0.1, 0, 0]);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) body.obox([x - r * 0.45 + i * r * 0.32, y + 0.035, z + r * 0.35 + j * r * 0.34], [r * 0.28, 0.003, r * 0.28], 0, 0.5, mixc(DARK, k('#1a2850'), 0.7));
    } else if (variant === 1) {
      body.set([y, delay + 0.35, 0, 0], [0.1, 0.1, 0, 0]);
      body.prism(x + r * 0.35, z + r * 0.3, 0.025, 0.025, 8, 0, y, y + 0.05, k('#c9ccd2'));
      body.prism(x - r * 0.3, z + r * 0.35, 0.018, 0.018, 8, 0, y, y + 0.035, k('#d9c6a8'));
    } else if (variant === 3) {
      body.set([y, delay + 0.35, 0, 0], [0.1, 0.1, 0, 0]);
      for (let i = 0; i < 4; i++) body.box(x - r * 0.4 + i * r * 0.27, z + r * 0.35, r * 0.2, r * 0.2, 0, y, y + 0.014 + (i % 2) * 0.008, k('#d3d6dc'));
      body.prism(x + r * 0.2, z - r * 0.3, 0.012, 0.012, 6, 0, y, y + 0.06, STEEL);
    } else if (variant === 4) {
      body.set([y, delay + 0.35, 0, -3], [0.1, 0.1, 0, 0]);
      body.prism(x, z + r * 0.15, r * 0.5, r * 0.5, 14, 0, y, y + 0.006, ASPHALT);
      body.set([y, delay + 0.4, 0, -1], [0.1, 0.1, 0, 0]);
      body.annulus(x, z + r * 0.15, r * 0.34, r * 0.4, 14, y + 0.0065, k('#ffe9c0'));
    } else {
      body.set([y, delay + 0.35, 0, 0], [0.1, 0.1, 0, 0]);
      body.prism(x - r * 0.2, z + r * 0.3, 0.03, 0.006, 8, 0, y + 0.025, y + 0.045, k('#e8e8ec'), {cap: false});
      body.beam([x - r * 0.2, y, z + r * 0.3], [x - r * 0.2, y + 0.03, z + r * 0.3], 0.003, 4, STEEL);
      body.set([y, delay + 0.35, 0, -1], [0.1, 0.1, 0, 0]);
      body.prism(x + r * 0.4, z, 0.016, 0.016, 8, 0, y, y + 0.003, k('#8ff0ff'));
    }
  };
  const rotor = (x: number, y: number, z: number, speed: number, len: number, delay: number) => {
    mv([x, y, z], 1, speed, Rd(0, 6), 0, [0, 0, 0], delay);
    mov.obox([x, y, z], [len, 0.003, 0.006], 0, 0, STEEL);
    mov.obox([x, y, z], [0.006, 0.003, len], 0, 0, STEEL);
  };

  type TowerOpts = {band?: boolean};
  /** habitat stack: drums with balcony rings, panel seams and a roof deck */
  const drum = (x: number, z: number, rad: number, h: number, delay: number, o: TowerOpts = {}) => {
    const sides = F ? 12 : 8, yaw = rnd() * 1.5, col = pick(), win = R(0.5, 0.8);
    const n = Math.max(2, Math.round((h - SLAB) / 0.2));
    let rr = rad, y = SLAB;
    for (let t = 0; t < n; t++) {
      const y1 = SLAB + ((h - SLAB) * (t + 1)) / n, r1 = rr * 0.955;
      setB(y, delay + t * 0.07, win, 0.05, 0.06, 3);
      body.prism(x, z, rr, r1, sides, yaw, y, y1, mixc(col, WHITE, t * 0.05), {cap: t === n - 1, top: mixc(col, DARK, 0.5)});
      if (o.band && t === Math.floor(n / 2)) { setB(y, delay + t * 0.07 + 0.2, 9, 0.05, 0.06, 0); body.prism(x, z, r1 * 1.025, r1 * 1.025, sides, yaw, y1 - 0.034, y1 - 0.004, WHITE, {cap: false}); }
      if (F && t < n - 1) { setD(y1, delay + t * 0.07 + 0.1, 0, 0.05, 0.06, 0); body.ledge(x, z, r1, r1 * 1.1, sides, yaw, y1 - 0.008, 0.008, mixc(col, DARK, 0.35)); }
      rr = t < n - 1 ? r1 * 0.985 : r1; y = y1;
    }
    scaffolds.push({x, z, r: rad, h});
    return h;
  };
  /** slab tower: setbacks, ribbon windows, corner fins, a rooftop plant */
  const slab = (x: number, z: number, rad: number, h: number, delay: number) => {
    const yaw = rnd() * 3, col = pick(), w = rad * 1.75, d = rad * 1.35, win = R(0.5, 0.8);
    const h1 = SLAB + (h - SLAB) * 0.58, h2 = SLAB + (h - SLAB) * 0.86;
    setB(SLAB, delay, win, 0.05, 0.065, 1);
    body.box(x, z, w, d, yaw, SLAB, h1, col, mixc(col, DARK, 0.5));
    setB(h1, delay + 0.12, win, 0.05, 0.065, 1);
    body.box(x, z, w * 0.78, d * 0.78, yaw, h1, h2, mixc(col, WHITE, 0.25), mixc(col, DARK, 0.5));
    setB(h2, delay + 0.24, win, 0.05, 0.065, 1);
    body.box(x, z, w * 0.5, d * 0.55, yaw, h2, h, mixc(col, WHITE, 0.4), mixc(col, DARK, 0.5));
    if (F) {
      setD(SLAB, delay + 0.05, 0, 0.05, 0.06, 0);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) body.box(x + (sx * w / 2) * cy + (sz * d / 2) * sy, z - (sx * w / 2) * sy + (sz * d / 2) * cy, 0.014, 0.014, yaw, SLAB, h1 + 0.03, mixc(col, DARK, 0.3));
      setD(h1, delay + 0.14, 0, 0.05, 0.06, 0);
      body.box(x, z, w * 1.06, d * 1.06, yaw, h1 - 0.012, h1, mixc(col, DARK, 0.35));
      setD(h2, delay + 0.26, 0, 0.05, 0.06, 0);
      body.box(x, z, w * 0.84, d * 0.84, yaw, h2 - 0.01, h2, mixc(col, DARK, 0.35));
    }
    scaffolds.push({x, z, r: rad * 1.1, h: h1});
    return h;
  };
  /** glass spire: a tapered curtain-wall hexagon with a lit crown band */
  const spire = (x: number, z: number, rad: number, h: number, delay: number, owner: boolean) => {
    const yaw = rnd() * 1, win = R(0.6, 0.85);
    setB(SLAB, delay, win, 0.032, 0.042, 2);
    body.prism(x, z, rad, rad * 0.55, 6, yaw, SLAB, h, mixc(k('#c4d4e2'), WHITE, 0.15), {top: mixc(STEEL, DARK, 0.4)});
    if (F) {
      setD(SLAB, delay + 0.1, 0, 0.05, 0.06, 0);
      for (let q = 0; q < 6; q++) {
        const a = yaw + (q / 6) * TAU;
        body.beam([x + Math.sin(a) * rad * 1.02, SLAB, z + Math.cos(a) * rad * 1.02], [x + Math.sin(a) * rad * 0.58, h * 0.97, z + Math.cos(a) * rad * 0.58], 0.0055, 4, mixc(STEEL, WHITE, 0.4));
      }
      for (let t = 1; t < 4; t++) { setD(SLAB + (h - SLAB) * (t / 4), delay + 0.1 * t, 0, 0.05, 0.06, 0); const y = SLAB + (h - SLAB) * (t / 4), r = rad - (rad * 0.45) * (y / h); body.ledge(x, z, r, r * 1.09, 6, yaw, y, 0.008, mixc(STEEL, DARK, 0.3)); }
    }
    setB(h * 0.72, delay + 0.3, owner ? 9 : -1, 0.05, 0.06, 0);
    const rb = rad - rad * 0.45 * 0.72;
    body.prism(x, z, rb * 1.03, rb * 1.03, 6, yaw, h * 0.72, h * 0.72 + 0.035, WHITE, {cap: false});
    scaffolds.push({x, z, r: rad, h});
    return h;
  };
  /** terraced arcology: stepped tiers, planted terraces, a glass atrium core */
  const terraced = (x: number, z: number, rad: number, h: number, delay: number, hero: boolean) => {
    const tiers = hero ? 5 : 4, yaw = rnd() * 0.8, col = pick(), sides = F ? 10 : 8;
    let rr = rad, y = SLAB;
    const th = (h - SLAB) / tiers;
    for (let t = 0; t < tiers; t++) {
      const y1 = y + th, r1 = rr * 0.93, rn = rr * 0.76;
      setB(y, delay + t * 0.12, 0.7, 0.05, 0.06, 3);
      body.prism(x, z, rr, r1, sides, yaw, y, y1, mixc(col, WHITE, t * 0.08), {top: GREEN});
      // the terrace: a planted ring between this tier's edge and the next tier's wall
      body.set([y1, delay + t * 0.12 + 0.2, 0, -6], [0.1, 0.1, 0, 0]);
      body.annulus(x, z, rn, r1, sides, y1 + 0.003, GREEN, yaw);
      if (F) {
        setD(y1, delay + t * 0.12 + 0.1, 0, 0.05, 0.06, 0);
        body.ledge(x, z, r1, r1 * 1.07, sides, yaw, y1 - 0.01, 0.01, mixc(col, DARK, 0.3));
        body.set([y1, delay + t * 0.12 + 0.3, 3 + t, -6], [0.1, 0.1, 0, 0]);
        const nt = 3 + t;
        for (let q = 0; q < nt; q++) { const a = Rd(0, TAU), rr2 = (rn + r1) / 2; tree(x + Math.sin(a) * rr2, y1 + 0.003, z + Math.cos(a) * rr2, Rd(0.55, 0.9), TREES[Math.floor(rd() * TREES.length)]); }
      }
      if (t === 1) { setB(y1, delay + t * 0.12 + 0.3, 9, 0.05, 0.06, 0); body.prism(x, z, r1 * 1.035, r1 * 1.035, sides, yaw, y1 - 0.04, y1 - 0.006, WHITE, {cap: false}); }
      y = y1; rr = rn;
    }
    setB(SLAB, delay + 0.3, 0.9, 0.04, 0.05, 2);
    body.prism(x, z, rad * 0.26, rad * 0.22, 6, yaw, SLAB, h + 0.08, k('#bcd8ea'), {top: DARK});
    scaffolds.push({x, z, r: rad, h});
    return h + 0.08;
  };

  const tower = (x: number, z: number, rad: number, h: number, delay: number, hero: boolean) => {
    const style = hero ? 3 : Math.floor(rnd() * 3);
    const bk = rnd();
    let topY = h;
    if (style === 0) topY = drum(x, z, rad, h, delay, {band: bk > 0.4});
    else if (style === 1) topY = slab(x, z, rad, h, delay);
    else if (style === 2) topY = spire(x, z, rad, h, delay, true);
    else topY = terraced(x, z, rad, h, delay, true);
    const gv = Math.floor(rd() * 5);
    if (style !== 2) roofGear(x, z, rad * (style === 3 ? 0.5 : 0.8), topY, delay + 0.2, gv);
    if (rnd() < 0.55 || hero) antenna(x, topY, z, R(0.07, 0.16) * (hero ? 1.6 : 1), delay + 0.3, hero, bk);
    if (F) {
      if (hero || bk < 0.35) { // a turning radar on the hero and on some of the others
        mv([x, topY + 0.08, z], 1, hero ? 1.4 : 0.9, Rd(0, 6), 0, [0, 0, 0], delay + 1.6);
        mov.obox([x, topY + 0.08, z], [0.06, 0.006, 0.01], 0, 0, STEEL);
        mov.obox([x, topY + 0.065, z], [0.006, 0.03, 0.006], 0, 0, STEEL);
      }
      if (style !== 3 && h > 0.5) { // habitat modules docked on the flank
        const na = Rd(0, TAU);
        setD(topY * 0.4, delay + 1.4, 0, 0.05, 0.06, 0);
        for (let q = 0; q < 2; q++) {
          const a = na + q * 2.4, yy = SLAB + (topY - SLAB) * (0.3 + 0.28 * q), r0 = rad * 0.9, r1 = rad + 0.08;
          body.beam([x + Math.sin(a) * r0, yy, z + Math.cos(a) * r0], [x + Math.sin(a) * r1, yy, z + Math.cos(a) * r1], 0.017, 8, mixc(STEEL, WHITE, 0.45), true);
          body.beam([x + Math.sin(a) * (r1 - 0.01), yy + 0.02, z + Math.cos(a) * (r1 - 0.01)], [x + Math.sin(a) * (r1 - 0.01), yy - 0.04, z + Math.cos(a) * (r1 - 0.01)], 0.003, 4, STEEL);
          setD(yy, delay + 1.5, -1, 0.05, 0.06, 0);
          body.beam([x + Math.sin(a) * (r1 * 0.97), yy + 0.0, z + Math.cos(a) * (r1 * 0.97)], [x + Math.sin(a) * (r1 + 0.001), yy + 0.0, z + Math.cos(a) * (r1 + 0.001)], 0.0125, 6, k('#ffe2a8'));
          setD(topY * 0.4, delay + 1.4, 0, 0.05, 0.06, 0);
        }
      }
      if (style === 1 || style === 0) { // billboard
        const c = [k('#ff3fa4'), k('#35e0ff'), k('#ffd24a'), k('#8cff6a')][Math.floor(rd() * 4)];
        body.set([topY, delay + 0.4, rd() * 20, -5], [0.1, 0.1, 0, 0]);
        body.obox([x, topY + 0.045, z + rad * 0.55], [0.07, 0.03, 0.005], 0, 0, c);
        glow.add([x, topY + 0.045, z + rad * 0.62], 0.1, GK.neon, rd() * 4, delay + 1.2, c);
      }
    }
    items.push({x, z, r: rad, h: topY, kind: 'tower', delay});
    if (h > 0.9) blobs.push([x, z, 0.3, 0.35]);
    return topY;
  };

  // ---- the Capital's grand spire ---------------------------------------------------------------------------------------
  if (grand) {
    const col = k('#f2eadc'), d0 = 1.3, cc = mixc(col, DARK, 0.5);
    // plaza
    body.set([SLAB, 0.45, 0, -4], [0.1, 0.08, 0, 0]);
    body.prism(0, 0, 0.4, 0.4, F ? 32 : 16, 0, SLAB, SLAB + 0.008, mixc(STONE, WHITE, 0.15), {top: STONE});
    body.set([SLAB, 0.55, 0, -4], [0.1, 0.08, 0, 0]);
    body.annulus(0, 0, 0.372, 0.4, F ? 32 : 16, SLAB + 0.0085, mixc(STONE, DARK, 0.35));
    // podium
    setB(SLAB, d0, 0.75, 0.05, 0.055, 3);
    body.prism(0, 0, 0.3, 0.27, 16, 0.1, SLAB, 0.26, col, {top: GREEN});
    body.set([0.26, d0 + 0.3, 0, -6], [0.1, 0.1, 0, 0]);
    body.annulus(0, 0, 0.2, 0.27, 16, 0.263, GREEN, 0.1);
    // tiers
    setB(0.26, d0 + 0.2, 0.75, 0.05, 0.06, 0);
    body.prism(0, 0, 0.2, 0.17, 12, 0.2, 0.26, 0.78, col, {top: cc});
    setB(0.78, d0 + 0.4, 0.8, 0.03, 0.04, 2);
    body.prism(0, 0, 0.15, 0.115, 12, 0.2, 0.78, 1.42, mixc(col, STEEL, 0.28), {top: cc});
    setB(1.42, d0 + 0.6, 0.8, 0.026, 0.036, 2);
    body.prism(0, 0, 0.1, 0.07, 8, 0.2, 1.42, 2.02, mixc(col, WHITE, 0.4), {top: cc});
    setB(1.62, d0 + 0.85, 9, 0.05, 0.06, 0);
    body.prism(0, 0, 0.112, 0.112, 12, 0.2, 1.62, 1.66, WHITE, {cap: false});
    // gold belts
    body.set([0.78, d0 + 0.5, 0, -1], [0.1, 0.1, 0, 0]);
    body.prism(0, 0, 0.152, 0.152, 12, 0.2, 0.775, 0.795, k('#ffcf7a'), {cap: false});
    body.set([1.42, d0 + 0.7, 0, -1], [0.1, 0.1, 0, 0]);
    body.prism(0, 0, 0.102, 0.102, 8, 0.2, 1.415, 1.43, k('#ffcf7a'), {cap: false});
    // sky-garden ring platform
    const ry = 1.04, ro = 0.34, ri = 0.13, rc = mixc(STEEL, WHITE, 0.2);
    setB(ry, d0 + 0.7, 0, 0.05, 0.06, 0);
    body.prism(0, 0, ro, ro, 20, 0, ry, ry + 0.045, rc, {cap: false});
    body.annulus(0, 0, ri, ro, 20, ry + 0.045, rc);
    body.set([ry, d0 + 0.9, 0, -6], [0.1, 0.1, 0, 0]);
    body.annulus(0, 0, ri + 0.05, ro - 0.03, 20, ry + 0.047, GREEN);
    body.set([ry, d0 + 1.0, 0, -1], [0.1, 0.1, 0, 0]);
    body.prism(0, 0, ro + 0.001, ro + 0.001, 20, 0, ry + 0.02, ry + 0.034, k('#9fe8ff'), {cap: false});
    if (F) {
      body.set([ry, d0 + 1.0, 4, -6], [0.1, 0.1, 0, 0]);
      for (let q = 0; q < 14; q++) { const a = (q / 14) * TAU, rr = Rd(0.2, 0.31); tree(Math.sin(a) * rr, ry + 0.047, Math.cos(a) * rr, Rd(0.6, 0.95), TREES[Math.floor(rd() * TREES.length)]); }
    }
    for (let i = 0; i < 20; i += 2) {
      const a0 = (i / 20) * TAU;
      glow.add([Math.sin(a0) * (ro - 0.01), ry + 0.08, Math.cos(a0) * (ro - 0.01)], 0.055, GK.steady, i, d0 + 1.25 + i * 0.012, k('#9fe8ff'));
    }
    // colonnade around the podium: columns, a lit architrave
    {
      const NC = F ? 18 : 12, cr = 0.335, ch = 0.15;
      body.set([SLAB, d0 + 0.2, 0, 0], [0.1, 0.1, 0, 0]);
      for (let i = 0; i < NC; i++) {
        const a = (i / NC) * TAU + 0.1, a2 = ((i + 1) / NC) * TAU + 0.1;
        const p: V3 = [Math.sin(a) * cr, SLAB, Math.cos(a) * cr];
        if (Math.hypot(p[0], p[2] - 0.7) < 0.2) continue;
        body.beam(p, [p[0], ch, p[2]], F ? 0.0065 : 0.007, F ? 6 : 4, mixc(STONE, WHITE, 0.3));
        body.beam([p[0], ch, p[2]], [Math.sin(a2) * cr, ch, Math.cos(a2) * cr], 0.005, 4, mixc(STONE, WHITE, 0.2));
      }
      body.set([SLAB, d0 + 0.3, 0, -1], [0.1, 0.1, 0, 0]);
      if (F) for (let i = 0; i < NC; i++) { const a = (i / NC) * TAU + 0.1 + 0.1, a2 = ((i + 1) / NC) * TAU + 0.1 - 0.1; if (Math.hypot(Math.sin(a) * cr, Math.cos(a) * cr - 0.7) < 0.2) continue; body.beam([Math.sin(a) * cr, ch - 0.009, Math.cos(a) * cr], [Math.sin(a2) * cr, ch - 0.009, Math.cos(a2) * cr], 0.0025, 3, k('#ffd98a')); }
    }
    // flying buttresses
    setB(SLAB, d0 + 0.3, 0, 0.05, 0.06, 0);
    for (let i = 0; i < 6; i++) {
      const a = 0.4 + i * (TAU / 6);
      body.beam([Math.sin(a) * 0.34, SLAB, Math.cos(a) * 0.34], [Math.sin(a) * 0.12, 0.98, Math.cos(a) * 0.12], 0.014, 4, mixc(STEEL, WHITE, 0.3));
      if (F) body.beam([Math.sin(a) * 0.34, SLAB, Math.cos(a) * 0.34], [Math.sin(a) * 0.34, ry, Math.cos(a) * 0.34], 0.007, 4, STEEL);
    }
    // crown: curved prongs around a lit core, the needle and a flare
    body.set([2.0, d0 + 1.0, 0, 0], [0.1, 0.1, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      body.beam([Math.sin(a) * 0.075, 2.0, Math.cos(a) * 0.075], [Math.sin(a) * 0.03, 2.3, Math.cos(a) * 0.03], 0.006, 4, k('#f2d9a0'));
    }
    body.beam([0, 2.0, 0], [0, 2.52, 0], 0.01, 4, STEEL);
    body.set([2.0, d0 + 1.0, 0, -1], [0.1, 0.1, 0, 0]);
    body.prism(0, 0, 0.04, 0.012, 8, 0, 2.0, 2.28, k('#ffe9b0'), {cap: false});
    glow.add([0, 2.3, 0], 0.4, GK.crown, 0, d0 + 1.35, k('#ffe9b0'));
    glow.add([0, 2.54, 0], 0.16, GK.beacon, 1, d0 + 1.4, k('#ff4a3a'), [0, 0, 0, 2.4]);
    glow.add([0, 1.64, 0], 0.22, GK.owner, 1, d0 + 1.0, WHITE);
    // banners: poles with owner flags around the podium
    setB(SLAB, d0 + 0.4, 9, 0.05, 0.06, 0);
    for (let i = 0; i < 4; i++) {
      const a = 0.4 + i * (TAU / 4) + 0.78, x = Math.sin(a) * 0.37, z = Math.cos(a) * 0.37;
      body.set([SLAB, d0 + 0.4, 0, 0], [0.1, 0.1, 0, 0]);
      body.beam([x, SLAB, z], [x, 0.2, z], 0.004, 4, STEEL);
      body.set([SLAB, d0 + 0.5, 0, 9], [0.1, 0.1, 0, 0]);
      body.obox([x + Math.cos(a) * 0.016, 0.16, z - Math.sin(a) * 0.016], [0.002, 0.07, 0.03], -a, 0, WHITE);
      glow.add([x, 0.215, z], 0.12, GK.owner, i, d0 + 0.9, WHITE);
    }
    // planters and lamps around the plaza, people strolling on it
    for (let i = 0; i < 12; i++) {
      const a = 0.25 + (i / 12) * TAU, x = Math.sin(a) * 0.385, z = Math.cos(a) * 0.385;
      const sk = rnd(); // consumed identically
      if (Math.hypot(x, z - 0.7) < 0.17 + 0.03) continue;
      if (F) { body.set([SLAB, d0 + 0.6, 3 + i, -6], [0.1, 0.1, 0, 0]); tree(x, SLAB + 0.008, z, 0.7 + sk * 0.4, TREES[i % TREES.length]); }
      glow.add([Math.sin(a + 0.13) * 0.385, SLAB + 0.03, Math.cos(a + 0.13) * 0.385], 0.06, GK.steady, i, d0 + 1.1, k('#ffe2a8'));
    }
    if (F) for (let i = 0; i < 8; i++) {
      const a = Rd(0, TAU), rr = Rd(0.3, 0.37), x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      if (Math.hypot(x, z - 0.7) < 0.2) continue;
      mv([x, SLAB + 0.02, z], 3, Rd(0.03, 0.06), Rd(0, 1), 0, [Math.cos(a) * Rd(-0.12, 0.12), 0, -Math.sin(a) * Rd(-0.12, 0.12)], ARRIVE);
      person(x, SLAB + 0.008, z, Rd(0, 1));
    }
    // fountain core: a lit basin before the podium
    body.set([SLAB, d0 + 0.2, 0, -1], [0.1, 0.1, 0, 0]);
    blobs.push([0, 0, 0.5, 0.8]);
    items.push({x: 0, z: 0, r: 0.3, h: 1.0, kind: 'tower', delay: d0});
    scaffolds.push({x: 0, z: 0, r: 0.3, h: 1.9});
  }

  // ---- landing pad, parked shuttle, gantry, tanks -----------------------------------------------------------------------------
  const padR = 0.16, pp = place(padR, 0.02, 0.72, true);
  if (pp) {
    const delay = 0.6;
    body.set([SLAB, delay, 0, -3], [0.1, 0.08, 0, 0]);
    body.prism(pp.x, pp.z, padR, padR, F ? 24 : 14, 0, SLAB, SLAB + 0.02, ASPHALT, {top: mixc(ASPHALT, STEEL, 0.15)});
    body.set([SLAB, delay + 0.2, 0, -3], [0.1, 0.08, 0, 0]);
    body.annulus(pp.x, pp.z, padR * 0.62, padR * 0.68, F ? 24 : 14, SLAB + 0.0215, k('#e8dcc0'));
    if (F) {
      body.obox([pp.x - 0.025, SLAB + 0.0215, pp.z], [0.012, 0.002, 0.07], 0, 0, k('#e8dcc0'));
      body.obox([pp.x + 0.025, SLAB + 0.0215, pp.z], [0.012, 0.002, 0.07], 0, 0, k('#e8dcc0'));
      body.obox([pp.x, SLAB + 0.0215, pp.z], [0.05, 0.002, 0.012], 0, 0, k('#e8dcc0'));
      // service gantry and two tanks beside the pad
      const gx = pp.x + padR * 0.95, gz = pp.z;
      setD(SLAB, delay + 0.4, 0, 0.05, 0.06, 0);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) body.beam([gx + sx * 0.014, SLAB, gz + sz * 0.014], [gx + sx * 0.012, 0.3, gz + sz * 0.012], 0.0035, 4, ORANGE);
      for (let l = 1; l < 6; l++) { const y = SLAB + l * 0.05, w = 0.014 - l * 0.0004; body.beam([gx - w, y, gz - w], [gx + w, y, gz + w], 0.0028, 4, ORANGE); body.beam([gx - w, y, gz + w], [gx + w, y, gz - w], 0.0028, 4, ORANGE); }
      body.beam([gx, 0.22, gz], [pp.x + 0.02, 0.2, pp.z], 0.004, 4, ORANGE);
      body.prism(gx + 0.045, gz + 0.06, 0.02, 0.02, 10, 0, SLAB, SLAB + 0.05, k('#e8e8ec'), {top: STEEL});
      body.prism(gx + 0.045, gz - 0.02, 0.016, 0.016, 10, 0, SLAB, SLAB + 0.04, k('#d9c6a8'), {top: STEEL});
      glow.add([gx, 0.31, gz], 0.12, GK.beacon, 2, delay + 1.0, k('#ff4a3a'), [0, 0, 0, 2.8]);
    }
    for (let i = 0; i < (F ? 12 : 8); i++) {
      const a = (i / (F ? 12 : 8)) * TAU;
      glow.add([pp.x + Math.sin(a) * padR * 0.92, SLAB + 0.03, pp.z + Math.cos(a) * padR * 0.92], 0.06, GK.steady, i * 0.8, 1.3 + i * 0.05, k('#ffb84a'));
    }
    // the shuttle: a lander on its legs that lifts off now and then and comes back down
    const P = R(36, 52), sph = rnd(), sy = SLAB + 0.022, amp = 0.9 + 0.5 * rnd();
    const sx = pp.x, sz = pp.z;
    mv([sx, sy, sz], 6, P, sph, amp, [0, 0, 0], ARRIVE + 0.4);
    mov.prism(sx, sz, 0.02, 0.016, 8, 0, sy + 0.012, sy + 0.075, k('#f2eee6'), {cap: false});
    mov.prism(sx, sz, 0.016, 0.0025, 8, 0, sy + 0.075, sy + 0.115, k('#f2eee6'), {cap: false});
    mov.prism(sx, sz, 0.0205, 0.0205, 8, 0, sy + 0.05, sy + 0.056, ORANGE, {cap: false});
    mov.set([sx, sy, sz], [6, P, sph, amp], [0, 0, 0, ARRIVE + 0.4], [2]);
    mov.prism(sx, sz, 0.0208, 0.0208, 8, 0, sy + 0.062, sy + 0.068, WHITE, {cap: false});
    mov.set([sx, sy, sz], [6, P, sph, amp], [0, 0, 0, ARRIVE + 0.4], [1]);
    mov.obox([sx + 0.0185, sy + 0.095, sz], [0.003, 0.012, 0.004], 0, 0, k('#9fe0ff'));
    mov.set([sx, sy, sz], [6, P, sph, amp], [0, 0, 0, ARRIVE + 0.4], [0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      mov.beam([sx + Math.sin(a) * 0.014, sy + 0.04, sz + Math.cos(a) * 0.014], [sx + Math.sin(a) * 0.034, sy, sz + Math.cos(a) * 0.034], 0.0022, 4, STEEL);
      mov.obox([sx + Math.sin(a) * 0.026, sy + 0.04, sz + Math.cos(a) * 0.026], [0.003, 0.05, 0.026], a + Math.PI / 2, 0, mixc(STEEL, WHITE, 0.4));
    }
    glow.add([sx, sy + 0.005, sz], 0.2, GK.flame, sph, ARRIVE + 0.4, k('#ffc890'), [amp, 0, 0, P]);
    blobs.push([pp.x, pp.z, 0.22, 0.6]);
    items.push({x: pp.x, z: pp.z, r: padR, h: 0.03, kind: 'pad', delay});
  }

  // ---- construction edge: a half-built frame, a tower crane, stock and a truck ------------------------------------------------------
  const cp = place(0.12, 0.02, 0.7, 'back');
  if (cp) {
    const {x, z} = cp, delay = 0.9 + rnd() * 0.3;
    setB(SLAB, delay, 0.7, 0.05, 0.055, 0);
    body.box(x, z, 0.16, 0.13, 0.4, SLAB, 0.15, mixc(pick(), DARK, 0.1), DARK);
    body.set([0.15, delay + 0.2, 0, 0], [0.1, 0.1, 0, 0]);
    const fl = [0.15, 0.25, 0.35, 0.44];
    const cy = Math.cos(0.4), sy = Math.sin(0.4);
    const cor = (sx: number, sz: number): [number, number] => [x + (sx * 0.075) * cy + (sz * 0.06) * sy, z - (sx * 0.075) * sy + (sz * 0.06) * cy];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [px, pz] = cor(sx, sz); body.beam([px, 0.15, pz], [px, 0.47 + (F ? 0.03 * (sx + sz) : 0), pz], 0.0045, 4, mixc(STEEL, DARK, 0.3)); }
    for (let f = 1; f < (F ? 4 : 2); f++) body.box(x, z, 0.155, 0.125, 0.4, fl[f] - 0.006, fl[f], mixc(STEEL, WHITE, 0.2));
    if (F) {
      for (let f = 1; f < 3; f++) { const [a1, a2] = cor(-1, -1), [b1, b2] = cor(1, -1); body.beam([a1, fl[f], a2], [b1, fl[f + 1], b2], 0.0025, 4, ORANGE); const [c1, c2] = cor(-1, 1), [d1, d2] = cor(1, 1); body.beam([c1, fl[f + 1], c2], [d1, fl[f], d2], 0.0025, 4, ORANGE); }
      // stock on the ground
      for (let q = 0; q < 4; q++) { setD(SLAB, delay + 0.5 + q * 0.1, 0, 0.05, 0.06, 0); body.box(x + Rd(-0.12, 0.12) - 0.1, z + Rd(0.06, 0.14), 0.04, 0.02, Rd(0, 3), SLAB, SLAB + 0.02 + (q % 2) * 0.02, [ORANGE, k('#3f7fc2'), k('#e8e8e8'), k('#c9a23a')][q]); }
    }
    // the crane: lattice mast in the body, the jib and hook on a mover
    const mx = x + 0.13, mz = z - 0.02, mh = 0.58;
    setB(SLAB, delay + 0.3, 0, 0.05, 0.06, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) body.beam([mx + sx * 0.012, SLAB, mz + sz * 0.012], [mx + sx * 0.009, mh, mz + sz * 0.009], 0.0032, 4, k('#f0b43a'));
    for (let l = 1; l < (F ? 12 : 4); l++) {
      const y = SLAB + l * (mh - SLAB) / (F ? 12 : 4), w = 0.011 - l * 0.00012;
      body.beam([mx - w, y, mz - w], [mx + w, y + (mh / 12), mz + w], 0.0022, 4, k('#f0b43a'));
      if (F) body.beam([mx - w, y + 0.02, mz + w], [mx + w, y, mz - w], 0.0022, 4, k('#f0b43a'));
    }
    const dir = rnd() < 0.5 ? 1 : -1, ph = rnd() * 6;
    mv([mx, mh, mz], 1, 0.16 * dir, ph, 0, [0, 0, 0], delay + 1.6);
    const jy = mh + 0.02;
    mov.beam([mx - 0.1, jy, mz], [mx + 0.3, jy, mz], 0.005, 4, k('#f0b43a'));
    mov.beam([mx - 0.1, jy + 0.02, mz], [mx + 0.3, jy, mz], 0.0025, 4, k('#f0b43a'));
    mov.beam([mx, jy + 0.07, mz], [mx + 0.3, jy, mz], 0.0018, 3, STEEL);
    mov.beam([mx, jy + 0.07, mz], [mx - 0.1, jy, mz], 0.0018, 3, STEEL);
    mov.beam([mx, jy, mz], [mx, jy + 0.07, mz], 0.005, 4, k('#f0b43a'));
    mov.obox([mx - 0.09, jy - 0.01, mz], [0.035, 0.022, 0.025], 0, 0, mixc(STEEL, DARK, 0.5));
    mov.obox([mx + 0.005, jy - 0.014, mz + 0.012], [0.02, 0.02, 0.016], 0, 0, k('#e8e8e8'));
    mov.beam([mx + 0.2, jy, mz], [mx + 0.2, jy - 0.2, mz], 0.0012, 3, DARK);
    mov.obox([mx + 0.2, jy - 0.208, mz], [0.014, 0.01, 0.014], 0, 0, ORANGE);
    glow.add([mx, mh + 0.095, mz], 0.14, GK.beacon, 3, delay + 1.2, k('#ff3a2a'), [0, 0, 0, 3.0]);
    glow.add([x, 0.5, z], 0.1, GK.beacon, 1, delay + 1.3, k('#ffb040'), [0, 0, 0, 2.0]);
    if (F) { // a truck going back and forth on the site
      mv([x, SLAB + 0.01, z + 0.16], 2, 0.5, rd() * 6, 0, [-0.22, 0, 0.02], ARRIVE);
      mov.obox([x + 0.03, SLAB + 0.012, z + 0.16], [0.032, 0.012, 0.018], 0, 0, k('#e0b030'));
      mov.obox([x + 0.04, SLAB + 0.02, z + 0.16], [0.012, 0.01, 0.016], 0, 0, k('#34343c'));
    }
    blobs.push([x, z, 0.2, 0.35]);
    items.push({x, z, r: 0.1, h: 0.3, kind: 'block', delay});
  }

  // ---- towers, then blocks -----------------------------------------------------------------------------------------------------
  const nT = grand ? 6 + Math.floor(rnd() * 3) : 8 + Math.floor(rnd() * 3);
  for (let i = 0; i < nT; i++) {
    const hero = !grand && i === 0;
    const rad = hero ? R(0.17, 0.2) : grand ? R(0.07, 0.1) : R(0.09, 0.13);
    const p = place(rad, 0.014, grand ? 0.7 : 0.68, hero ? 'back' : false);
    if (!p) continue;
    let h = hero ? R(1.25, 1.55) : grand ? R(0.4, 0.9) : 0.35 + Math.pow(rnd(), 1.3) * 0.85;
    if (!hero) h *= 1 - 0.5 * Math.min(1, Math.max(0, (p.z + 0.15) / 0.8));
    tower(p.x, p.z, rad, h, rise(p.x, p.z, hero ? 1 : 0), hero);
  }
  const nB = grand ? 2 : 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < nB; i++) {
    const w = R(0.15, 0.25), d = R(0.12, 0.19), p = place(Math.max(w, d) * 0.58, 0.025, 0.7);
    if (!p) continue;
    const h = R(0.14, 0.32), delay = rise(p.x, p.z, 0), yaw = rnd() * 3.14, col = pick();
    setB(SLAB, delay, R(0.65, 0.9), 0.05, 0.055, 1);
    body.box(p.x, p.z, w, d, yaw, SLAB, h, col, mixc(col, DARK, 0.45));
    body.set([h, delay + 0.2, 0, -6], [0.1, 0.1, 0, 0]);
    body.box(p.x + w * 0.12, p.z, w * 0.5, d * 0.6, yaw, h, h + 0.012, GREEN);
    const gv = Math.floor(rd() * 5);
    roofGear(p.x - w * 0.15, p.z, Math.min(w, d) * 0.5, h + 0.012, delay + 0.2, gv);
    glow.add([p.x + w * 0.35, h + 0.03, p.z - d * 0.3], 0.07, GK.steady, rnd() * 6, delay + 0.7, k('#ffd27a'));
    if (F) { // vents and an owner banner on the block's front edge
      const nv = rd();
      if (nv > 0.4) { setD(h, delay + 0.3, 9, 0.05, 0.06, 0); body.box(p.x, p.z + d * 0.5 + 0.004, w * 0.5, 0.006, yaw, h * 0.4, h * 0.85, WHITE); }
    }
    items.push({x: p.x, z: p.z, r: Math.max(w, d) * 0.5, h, kind: 'block', delay});
    scaffolds.push({x: p.x, z: p.z, r: Math.max(w, d) * 0.55, h: Math.min(h, 0.2)});
  }

  // ---- low-rise fillers: solar fields, cargo yards, tank farms, habitat pods, small plazas -------------------------------------------------------
  const nF = grand ? 8 : 12;
  for (let i = 0; i < nF; i++) {
    const fr = R(0.075, 0.12), fk = Math.floor(rnd() * 5), p = place(fr, 0.012, 0.71, true);
    const fyaw = rnd() * 3.14, delay = rise(p ? p.x : 0, p ? p.z : 0, 0) + 0.1;
    if (!p) continue;
    const {x, z} = p;
    if (fk === 0) { // solar field
      setB(SLAB, delay, -3, 0.1, 0.1, 0);
      body.box(x, z, fr * 1.8, fr * 1.3, fyaw, SLAB, SLAB + 0.008, mixc(DARK, COPPER, 0.15));
      const cy = Math.cos(fyaw), sy = Math.sin(fyaw), cols = F ? 4 : 2, rows = F ? 2 : 1;
      body.set([SLAB + 0.008, delay + 0.2, 0, -2], [0.1, 0.1, 0, 0]);
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        const lx = ((a + 0.5) / cols - 0.5) * fr * 1.6, lz = ((b + 0.5) / rows - 0.5) * fr * 1.0;
        body.obox([x + lx * cy + lz * sy, SLAB + 0.03, z - lx * sy + lz * cy], [fr * 1.6 / cols * 0.9, 0.003, fr * 1.0 / rows * 0.9], fyaw, 0.55, DARK);
      }
    } else if (fk === 1) { // cargo yard
      const cc = [ORANGE, k('#3f7fc2'), k('#e8e8e8'), k('#c9a23a'), k('#4f9a5a')];
      const n = F ? 7 : 4;
      for (let q = 0; q < n; q++) {
        const qa = rnd(), qb = rnd(), qc = Math.floor(rnd() * 5), qh = rnd() < 0.4;
        setB(SLAB, delay + q * 0.06, 0, 0.1, 0.1, 0);
        body.box(x + (qa - 0.5) * fr * 1.3, z + (qb - 0.5) * fr * 1.1, 0.04, 0.018, fyaw, SLAB, SLAB + 0.017, cc[qc]);
        if (qh) body.box(x + (qa - 0.5) * fr * 1.3, z + (qb - 0.5) * fr * 1.1, 0.04, 0.018, fyaw, SLAB + 0.017, SLAB + 0.034, cc[(qc + 2) % 5]);
      }
      glow.add([x, SLAB + 0.06, z], 0.07, GK.beacon, i, delay + 0.8, k('#ffb040'), [0, 0, 0, 2.5]);
    } else if (fk === 2) { // tank farm
      for (let q = 0; q < 3; q++) {
        const qa = (q / 3) * TAU + fyaw, qh = R(0.05, 0.09), tx = x + Math.sin(qa) * fr * 0.5, tz = z + Math.cos(qa) * fr * 0.5;
        setB(SLAB, delay + q * 0.08, 0, 0.1, 0.1, 0);
        body.prism(tx, tz, 0.024, 0.024, F ? 12 : 7, 0, SLAB, SLAB + qh, mixc(k('#e8e8ec'), WARM, 0.15 * q), {top: STEEL});
        if (F) { body.prism(tx, tz, 0.0255, 0.0255, 12, 0, SLAB + qh * 0.5, SLAB + qh * 0.5 + 0.006, STEEL, {cap: false}); body.beam([tx, SLAB + qh, tz], [x, SLAB + qh + 0.012, z], 0.003, 4, STEEL); }
      }
      if (F) body.prism(x, z, 0.007, 0.007, 6, 0, SLAB, SLAB + 0.1, STEEL, {top: STEEL});
    } else if (fk === 3) { // habitat pods linked by short tubes
      const n = 3;
      let px = 0, pz = 0;
      for (let q = 0; q < n; q++) {
        const qa = (q / n) * TAU + fyaw, tx = x + Math.sin(qa) * fr * 0.55, tz = z + Math.cos(qa) * fr * 0.55, qh = R(0.05, 0.09), col = pick();
        setB(SLAB, delay + q * 0.07, 0.75, 0.04, 0.045, 1);
        body.prism(tx, tz, 0.035, 0.034, F ? 10 : 7, 0, SLAB, SLAB + qh, col, {cap: false});
        setB(SLAB + qh, delay + q * 0.07 + 0.1, 0, 0.1, 0.1, 0);
        body.prism(tx, tz, 0.036, 0.008, F ? 10 : 7, 0, SLAB + qh, SLAB + qh + 0.02, mixc(col, DARK, 0.35), {cap: false});
        if (F) { setD(SLAB + qh, delay + q * 0.07 + 0.2, 0, 0.1, 0.1, 0); body.beam([tx, SLAB + qh + 0.02, tz], [tx, SLAB + qh + 0.045, tz], 0.0022, 4, STEEL); }
        if (q > 0) body.beam([px, SLAB + 0.025, pz], [tx, SLAB + 0.025, tz], 0.007, F ? 6 : 4, mixc(STEEL, WHITE, 0.3));
        px = tx; pz = tz;
      }
      glow.add([x, SLAB + 0.1, z], 0.08, GK.steady, i, delay + 0.8, k('#ffd27a'));
    } else { // little plaza with a fountain, trees and strollers
      setB(SLAB, delay, -4, 0.1, 0.1, 0);
      body.set([SLAB, delay, 0, -4], [0.1, 0.1, 0, 0]);
      body.prism(x, z, fr, fr, F ? 14 : 8, 0, SLAB, SLAB + 0.006, STONE);
      body.set([SLAB + 0.006, delay + 0.2, 0, -1], [0.1, 0.1, 0, 0]);
      body.prism(x, z, fr * 0.38, fr * 0.38, F ? 12 : 7, 0, SLAB + 0.006, SLAB + 0.014, AQUA);
      glow.add([x, SLAB + 0.03, z], 0.09, GK.shimmer, i, delay + 0.8, AQUA);
      body.set([SLAB, delay + 0.3, 1 + i, -6], [0.1, 0.1, 0, 0]);
      const nt = F ? 5 : 2;
      for (let q = 0; q < nt; q++) { const qa = (q / nt) * TAU + fyaw; tree(x + Math.sin(qa) * fr * 0.7, SLAB + 0.006, z + Math.cos(qa) * fr * 0.7, 0.8, TREES[(q + i) % TREES.length]); }
      if (F) for (let q = 0; q < 3; q++) {
        const qa = Rd(0, TAU);
        mv([x, SLAB + 0.02, z], 1, Rd(0.2, 0.5) * (q % 2 ? -1 : 1), Rd(0, 6), 0, [0, 0, 0], ARRIVE);
        person(x + Math.sin(qa) * fr * 0.55, SLAB + 0.006, z + Math.cos(qa) * fr * 0.55, Rd(0, 1));
      }
    }
    blobs.push([x, z, fr * 0.9, 0.3]);
  }

  // ---- connecting tubes ---------------------------------------------------------------------------------------------------------
  const tubeCol = mixc(STEEL, WHITE, 0.3);
  for (let i = 1; i < items.length; i++) {
    const A_ = items[i];
    let best = -1, bd = 1e9;
    for (let j = 0; j < i; j++) { const d = Math.hypot(items[j].x - A_.x, items[j].z - A_.z) - items[j].r - A_.r; if (d < bd) { bd = d; best = j; } }
    if (best < 0 || bd > 0.36) continue;
    const B_ = items[best];
    const ground = A_.kind !== 'tower' || B_.kind !== 'tower';
    const y = ground ? SLAB + 0.07 : Math.max(0.2, Math.min(A_.h, B_.h) * 0.45);
    const dx = B_.x - A_.x, dz = B_.z - A_.z, l = Math.hypot(dx, dz) || 1;
    const a: V3 = [A_.x + (dx / l) * A_.r * 0.7, y, A_.z + (dz / l) * A_.r * 0.7];
    const b: V3 = [B_.x - (dx / l) * B_.r * 0.7, y, B_.z - (dz / l) * B_.r * 0.7];
    const delay = Math.max(A_.delay, B_.delay) + 0.3;
    body.set([y - 0.03, delay, 0, 0], [0.1, 0.1, 0, 0]);
    body.beam(a, b, ground ? 0.03 : 0.022, F ? 8 : 5, tubeCol);
    if (F) {
      body.set([y - 0.03, delay + 0.2, 0, -1], [0.1, 0.1, 0, 0]);
      body.beam([a[0], y + 0.001, a[2]], [b[0], y + 0.001, b[2]], ground ? 0.012 : 0.008, 5, k('#ffe2a8'));
      // a sliver of a skybridge pod riding inside
      mv([(a[0] + b[0]) / 2, y, (a[2] + b[2]) / 2], 2, Rd(0.3, 0.6), Rd(0, 6), 0, [(b[0] - a[0]) * 0.5, 0, (b[2] - a[2]) * 0.5], ARRIVE + 0.2, 1);
      mov.obox([a[0] + (b[0] - a[0]) * 0.25, y, a[2] + (b[2] - a[2]) * 0.25], [0.025, 0.01, 0.012], Math.atan2(-(b[2] - a[2]), b[0] - a[0]), 0, k('#fff2c8'));
    }
    glow.add([(a[0] + b[0]) / 2, y - 0.04, (a[2] + b[2]) / 2], 0.1, GK.steady, rnd() * 6, delay + 0.5, k('#ffe2a8'));
  }

  // ---- ring road: lamps, cars; the maglev: girder, rails, pylons, pods --------------------------------------------------------------------
  const nl = F ? 22 : 12;
  for (let i = 0; i < nl; i++) {
    const a = RA0 + ((RA1 - RA0) * (i + 0.5)) / nl;
    glow.add([Math.sin(a) * (ROAD_R + 0.05), SLAB + 0.04, Math.cos(a) * (ROAD_R + 0.05)], 0.07, GK.steady, i, 1.4 + i * 0.03, k('#ffe9c0'));
    if (F) { body.set([SLAB, 1.0, 0, 0], [0.1, 0.1, 0, 0]); body.beam([Math.sin(a) * (ROAD_R + 0.05), SLAB, Math.cos(a) * (ROAD_R + 0.05)], [Math.sin(a) * (ROAD_R + 0.05), SLAB + 0.035, Math.cos(a) * (ROAD_R + 0.05)], 0.0022, 4, STEEL); }
  }
  const NSEG = F ? 40 : 24;
  const trackAt = (a: number, r = ROAD_R, y = TRACK_Y): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];
  for (let i = 0; i < NSEG; i++) {
    const a0 = RA0 + ((RA1 - RA0) * i) / NSEG, a1 = RA0 + ((RA1 - RA0) * (i + 1)) / NSEG;
    const delay = 0.8 + (i / NSEG) * 1.6;
    body.set([TRACK_Y - 0.02, delay, 0, 0], [0.1, 0.1, 0, 0]);
    body.beam(trackAt(a0), trackAt(a1), 0.013, 4, mixc(STEEL, WHITE, 0.4));
    if (F) {
      body.set([TRACK_Y, delay + 0.05, 0, -1], [0.1, 0.1, 0, 0]);
      body.beam(trackAt(a0, ROAD_R - 0.007, TRACK_Y + 0.011), trackAt(a1, ROAD_R - 0.007, TRACK_Y + 0.011), 0.0022, 3, k('#7fe0ff'));
      body.beam(trackAt(a0, ROAD_R + 0.007, TRACK_Y + 0.011), trackAt(a1, ROAD_R + 0.007, TRACK_Y + 0.011), 0.0022, 3, k('#7fe0ff'));
    }
    if (i % (F ? 3 : 5) === 0) {
      const p = trackAt(a0, ROAD_R + 0.045, SLAB);
      body.set([SLAB, delay, 0, 0], [0.1, 0.1, 0, 0]);
      body.prism(p[0], p[2], 0.009, 0.007, 4, a0, SLAB, TRACK_Y - 0.012, mixc(STEEL, WHITE, 0.3), {cap: false});
      body.beam([p[0], TRACK_Y - 0.014, p[2]], trackAt(a0, ROAD_R, TRACK_Y - 0.012), 0.006, 4, mixc(STEEL, WHITE, 0.3));
      glow.add(trackAt(a0, ROAD_R, TRACK_Y - 0.03), 0.07, GK.steady, i, delay + 0.8, k('#bfe9ff'));
      if (i % (F ? 9 : 10) === 0 && i > 0) {
        body.set([SLAB, delay + 0.2, 0, 9], [0.1, 0.1, 0, 0]);
        body.box(p[0], p[2], 0.022, 0.022, a0, TRACK_Y - 0.03, TRACK_Y - 0.012, WHITE);
        glow.add([p[0], TRACK_Y - 0.02, p[2]], 0.2, GK.owner, i, delay + 0.9, WHITE);
      }
    }
  }
  // pods: two trains of three cars sharing a ping-pong sweep along the arc
  const nTrain = grand ? 2 : F ? 2 : 1;
  for (let t = 0; t < nTrain; t++) {
    const sp = 0.4 + 0.1 * t + 0.08 * rnd(), ph = rnd() * 6, span = RA1 - RA0 - 0.55;
    for (let c = 0; c < 3; c++) {
      const a = RA0 + 0.28 + c * 0.075;
      mv(trackAt(a, ROAD_R, TRACK_Y + 0.02), 5, sp, ph, span, [0, 0, 0], ARRIVE + 0.2 + t * 0.2);
      const p = trackAt(a, ROAD_R, TRACK_Y + 0.022);
      mov.obox(p, [0.064, 0.02, 0.026], a, 0, k('#f4f1ea'), k('#d8dde4'));
      mov.set(trackAt(a, ROAD_R, TRACK_Y + 0.02), [5, sp, ph, span], [0, 0, 0, ARRIVE + 0.2 + t * 0.2], [1]);
      if (F) mov.obox([p[0], p[1] + 0.003, p[2]], [0.058, 0.007, 0.0275], a, 0, k('#ffe2b0'));
      mov.set(trackAt(a, ROAD_R, TRACK_Y + 0.02), [5, sp, ph, span], [0, 0, 0, ARRIVE + 0.2 + t * 0.2], [2]);
      mov.obox([p[0], p[1] - 0.007, p[2]], [0.066, 0.004, 0.0275], a, 0, WHITE);
      mov.set(trackAt(a, ROAD_R, TRACK_Y + 0.02), [5, sp, ph, span], [0, 0, 0, ARRIVE + 0.2 + t * 0.2], [0]);
      if (c === 1) glow.add([p[0], p[1] + 0.02, p[2]], 0.1, GK.arc, ph, ARRIVE + 0.4, k('#d8f4ff'), [span, sp, 0, 0]);
    }
  }
  // cars on the road, two ways
  const nCar = F ? 7 : 3;
  for (let c = 0; c < nCar; c++) {
    const dirn = c % 2 ? -1 : 1, sp = dirn * (0.03 + 0.012 * (c % 3)), ph = rnd() * 2, span = RA1 - RA0 - 0.12;
    const lane = ROAD_R + dirn * 0.016, a = RA0 + 0.06, kind = c % 3;
    const p = trackAt(a, lane, SLAB + 0.008);
    const col = [k('#f2f0ea'), k('#d2573c'), k('#4f86c2'), k('#e0b030')][c % 4];
    const yaw = dirn > 0 ? a : a + Math.PI;
    mv(p, 7, sp, ph, span, [0, 0, 0], ARRIVE + 0.3);
    mov.obox(p, kind === 2 ? [0.04, 0.012, 0.016] : [0.026, 0.009, 0.014], yaw, 0, col);
    if (F) {
      mov.obox([p[0], p[1] + 0.008, p[2]], kind === 2 ? [0.012, 0.01, 0.014] : [0.013, 0.007, 0.012], yaw, 0, DARK);
      mov.set(p, [7, sp, ph, span], [0, 0, 0, ARRIVE + 0.3], [1]);
      mov.obox([p[0] + Math.cos(yaw) * 0.013 * dirn * dirn, p[1], p[2] - Math.sin(yaw) * 0.013], [0.002, 0.004, 0.011], yaw, 0, k('#fff2c8'));
      mov.set(p, [7, sp, ph, span], [0, 0, 0, ARRIVE + 0.3], [0]);
    }
    glow.add([p[0], p[1] + 0.002, p[2]], 0.045, GK.arcLoop, ph, ARRIVE + 0.4, k(dirn > 0 ? '#fff0c8' : '#ff6a4a'), [span, sp, 0, 0]);
  }

  // ---- traffic overhead: ships circling, drones, a rover or two ---------------------------------------------------------------------------
  const nShip = grand ? 2 : 1;
  for (let s = 0; s < nShip; s++) {
    const sr = 0.5 + 0.18 * s, sh = (grand ? 1.5 : 1.2) + 0.3 * s, sp = (0.1 + 0.05 * s) * (s ? -1 : 1) * (rnd() < 0.5 ? 1 : -1), ph = rnd();
    const p: V3 = [0, sh, sr];
    mv([0, sh, sr], 7, sp, ph, TAU, [0, 0, 0], ARRIVE + 0.6);
    mov.obox(p, [0.055, 0.012, 0.02], (sp > 0 ? 0 : Math.PI), 0, k('#e8ecf2'));
    if (F) {
      mov.obox([p[0], p[1], p[2]], [0.02, 0.004, 0.06], (sp > 0 ? 0 : Math.PI), 0, mixc(STEEL, WHITE, 0.3));
      mov.set(p, [7, sp, ph, TAU], [0, 0, 0, ARRIVE + 0.6], [1]);
      mov.obox([p[0], p[1] + 0.008, p[2]], [0.014, 0.004, 0.012], 0, 0, k('#9fe0ff'));
      mov.set(p, [7, sp, ph, TAU], [0, 0, 0, ARRIVE + 0.6], [0]);
    }
    glow.add(p, 0.08, GK.arcLoop, ph, ARRIVE + 0.7, k('#d8f4ff'), [TAU, sp, 0, 0]);
    for (let q = 1; q < 4; q++) glow.add(p, 0.06 - q * 0.011, GK.arcLoop, ph - q * 0.012 * Math.sign(sp), ARRIVE + 0.7, k('#ffb870'), [TAU, sp, 0, 0]);
  }
  if (F) {
    const hi = items.filter((i) => i.kind === 'tower' && i.h > 0.6);
    hi.slice(0, 3).forEach((it, q) => {
      const dr = Rd(0.05, 0.09);
      mv([it.x, it.h * 0.6, it.z], 1, Rd(0.9, 1.5) * (q % 2 ? -1 : 1), Rd(0, 6), 0, [0, 0, 0], ARRIVE + 0.5);
      mov.obox([it.x + it.r + dr, it.h * 0.6, it.z], [0.016, 0.004, 0.016], 0, 0, DARK);
      mov.obox([it.x + it.r + dr, it.h * 0.6 + 0.004, it.z], [0.026, 0.0015, 0.004], 0, 0, STEEL);
      glow.add([it.x + it.r + dr, it.h * 0.6, it.z], 0.05, GK.beacon, q, ARRIVE + 0.6, k('#ff5a4a'), [0, 0, 0, 4]);
    });
  }

  // ---- owner pylons on the hex corners (the front corner keeps the owner's cube) ----------------------------------------------------------------------------
  for (let kk = 1; kk < 6; kk++) {
    const a = (kk / 6) * TAU, x = Math.sin(a) * 0.9, z = Math.cos(a) * 0.9, d = 0.35 + kk * 0.05;
    body.set([SLAB, d, 0, 9], [0.1, 0.1, 0, 0]);
    body.prism(x, z, 0.022, 0.016, 6, 0, SLAB, SLAB + 0.12, WHITE);
    glow.add([x, SLAB + 0.14, z], 0.14, GK.owner, kk, d + 0.5, WHITE);
  }

  // ---- dust: a stamp ring at the start, puffs where the big structures rise ----------------------------------------------------------------------------------
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + rnd() * 0.3, d = 0.6 + rnd() * 0.28;
    glow.add([Math.sin(a) * d, 0.05, Math.cos(a) * d], 0.13 + rnd() * 0.1, GK.dust, 0, 0.27, k('#d9a67a'), [Math.sin(a) * 0.35, 0.2 + rnd() * 0.15, Math.cos(a) * 0.35, 0]);
  }
  for (const it of items.filter((i) => i.kind !== 'pad').slice(0, 10)) {
    glow.add([it.x, 0.05, it.z], 0.14, GK.dust, 0, it.delay + 0.1, k('#cfa07c'), [(rnd() - 0.5) * 0.2, 0.18, (rnd() - 0.5) * 0.2, 0]);
  }
  // the dust where scaffolds let go
  for (const s of scaffolds.slice(0, 7)) glow.add([s.x, 0.05, s.z], 0.18, GK.dust, 0, FALL + 0.5, k('#cfa07c'), [0.05, 0.16, 0.05, 0]);

  // ---- scaffolds (full only): posts, rings and braces that rise, then fall away --------------------------------------------------------------------------------------
  if (F) {
    const yel = k('#d8a43a'), grey = mixc(STEEL, DARK, 0.25);
    for (const s of scaffolds) {
      const n = s.r > 0.15 ? 8 : 6, rs = s.r * 1.22 + 0.02, rows = Math.max(2, Math.round(s.h / 0.11)), step = s.h / rows;
      const a0 = 0.3 + (s.x + s.z) * 2, appear0 = 0.35 + Math.hypot(s.x, s.z) * 0.4;
      const fall0 = FALL + Math.hypot(s.x, s.z) * 0.15;
      const bm = (a: V3, b: V3, r: number, c: THREE.Color) => {
        const base = Math.min(a[1], b[1]);
        scaf.set([base, appear0 + base * 0.6, fall0 + (s.h - base) * 0.25 + rd() * 0.15, rd() * 50]);
        scaf.beam(a, b, r, 4, c);
      };
      const P = (i: number, y: number): V3 => [s.x + Math.sin(a0 + (i / n) * TAU) * rs, y, s.z + Math.cos(a0 + (i / n) * TAU) * rs];
      for (let i = 0; i < n; i++) bm(P(i, SLAB), P(i, s.h + 0.04), 0.0045, grey);
      for (let r = 1; r <= rows; r++) {
        const y = SLAB + r * step;
        for (let i = 0; i < n; i++) {
          bm(P(i, y), P(i + 1, y), 0.0032, r % 2 ? yel : grey);
          if (r % 2 === 0 && i % 2 === 0) bm(P(i, y - step), P(i + 1, y), 0.0022, grey);
        }
      }
    }
  }

  while (blobs.length < 6) blobs.push([0, 0, 0.01, 0]);
  const bg = body.geometry(), mg = mov.geometry(), dg = dome.geometry(), gg = glow.geometry();
  const sg = F ? scaf.geometry() : null;
  return {
    body: bg, mov: mg, scaf: sg, dome: dg, glow: gg, blobs: blobs.slice(0, 6), light: LIGHT, seconds: grand ? 5.4 : 4.7,
    tris: {body: body.tris, mov: mov.tris, scaf: F ? scaf.tris : 0, dome: dg.index!.count / 3, glow: gg.index!.count / 3},
  };
}

const cache = new Map<string, Plan>();
export function cityDetailPlan(id: string, grand: boolean, lite: boolean): Plan {
  const key = `${id}|${grand ? 'c' : 't'}|${lite ? 'l' : 'f'}`;
  let p = cache.get(key);
  if (!p) { p = makePlan(id, grand, lite); cache.set(key, p); }
  return p;
}
