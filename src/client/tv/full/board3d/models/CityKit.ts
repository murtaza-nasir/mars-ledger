// Shared kit for the City and Capital models: a procedural Mars colony on one hex.
//
// Four draw calls per city, whatever its size:
//   body  - every tower, block, tube, pad and mast merged into one geometry; a MeshStandardMaterial patched with
//           a rise animation (bottom-up with overshoot), a procedural window grid (warm windows that light with
//           the night, a few flickering, a glint wave that climbs the facades during the build) and owner accents.
//   domes - glass domes: fresnel rim, geodesic frame lines, sheen, interior glow (custom shader, transparent).
//   glow  - every light as a camera-facing quad: beacons, pad lights, owner pylons, the tram, the shuttle with its
//           trail, the crown flare and the build's dust puffs (additive, one shader, one draw).
//   base  - the glowing hex ring in the owner's colour, the stamp flash, the shock ring and the night light pools.
// The geometry is built once per (space id, capital) and shared by every instance; each instance owns only its
// four small materials, which share their compiled programs and read one uniform set updated once per frame.
import {createElement, useEffect, useMemo} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelProps} from './contract';

type V3 = [number, number, number];

// ---- the plan: where everything stands (unit radius; y = 0 is the prism top) ----------------------------
const SLAB = 0.03;
const PALETTE = ['#ece4d6', '#d9c6a8', '#b8c4d0', '#f2ede4', '#cdb79a', '#9fb0c2'].map((c) => new THREE.Color(c));
const DARK = new THREE.Color('#3a3a42');
const STEEL = new THREE.Color('#aab4c0');
const COPPER = new THREE.Color('#c27b4c');
const GREEN = new THREE.Color('#4fae5a');
const WARM = new THREE.Color('#ffb060');
const WHITE = new THREE.Color('#ffffff');
const OWNER_FLAG = 9;

class BodyBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; an: number[] = [];
  tri(a: V3, b: V3, c: V3, color: THREE.Color, an: [number, number, number, number], flip = false) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const pts = flip ? [a, c, b] : [a, b, c];
    for (const p of pts) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color.r, color.g, color.b); this.an.push(an[0], an[1], an[2], an[3]); }
  }
  /** an n-sided frustum standing on y0; capTop closes it. Sides run +z at yaw 0. */
  prism(cx: number, cz: number, r0: number, r1: number, sides: number, yaw: number, y0: number, y1: number, color: THREE.Color,
    an: [number, number, number, number], capTop = true, sx = 1, sz = 1, inward = false, topColor?: THREE.Color) {
    const pt = (i: number, r: number, y: number): V3 => {
      const th = (i / sides) * Math.PI * 2 + yaw;
      return [cx + Math.sin(th) * r * sx, y, cz + Math.cos(th) * r * sz];
    };
    for (let i = 0; i < sides; i++) {
      const a = pt(i, r0, y0), b = pt(i + 1, r0, y0), c = pt(i + 1, r1, y1), d = pt(i, r1, y1);
      this.tri(a, b, c, color, an, inward); this.tri(a, c, d, color, an, inward);
      if (capTop) this.tri([cx, y1, cz], pt(i, r1, y1), pt(i + 1, r1, y1), topColor ?? color, [an[0], an[1], an[2], 0]);
    }
  }
  box(cx: number, cz: number, w: number, d: number, yaw: number, y0: number, y1: number, color: THREE.Color, an: [number, number, number, number], topColor?: THREE.Color) {
    this.prism(cx, cz, Math.SQRT1_2, Math.SQRT1_2, 4, yaw + Math.PI / 4, y0, y1, color, an, true, w, d, false, topColor);
  }
  /** a flat-sided tube from a to b */
  beam(a: V3, b: V3, r: number, sides: number, color: THREE.Color, an: [number, number, number, number]) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / l, ay = dy / l, az = dz / l;
    // any vector not parallel to the axis
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ay) > 0.9) { ux = 1; uy = 0; }
    let px = ay * uz - az * uy, py = az * ux - ax * uz, pz = ax * uy - ay * ux;
    const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
    const qx = ay * pz - az * py, qy = az * px - ax * pz, qz = ax * py - ay * px;
    const ring = (o: V3, i: number): V3 => {
      const th = (i / sides) * Math.PI * 2, c = Math.cos(th) * r, s = Math.sin(th) * r;
      return [o[0] + px * c + qx * s, o[1] + py * c + qy * s, o[2] + pz * c + qz * s];
    };
    for (let i = 0; i < sides; i++) {
      const p0 = ring(a, i), p1 = ring(a, i + 1), q1 = ring(b, i + 1), q0 = ring(b, i);
      this.tri(p0, p1, q1, color, an, true); this.tri(p0, q1, q0, color, an, true);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(this.an, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
    return g;
  }
}

class DomeBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; ctr: number[] = []; idx: number[] = [];
  static LON = 18; static LAT = 7;
  dome(cx: number, y0: number, cz: number, r: number, h: number, delay: number) {
    const {LON, LAT} = DomeBuilder, base = this.pos.length / 3;
    for (let j = 0; j <= LAT; j++) {
      const phi = (j / LAT) * Math.PI / 2;
      for (let i = 0; i <= LON; i++) {
        const th = (i / LON) * Math.PI * 2, nx = Math.sin(phi) * Math.sin(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.cos(th);
        this.pos.push(cx + nx * r, y0 + ny * h, cz + nz * r);
        const l = Math.hypot(nx * h, ny * r, nz * h) || 1;
        this.nor.push(nx * h / l, ny * r / l, nz * h / l);
        this.uv.push(i, j);
        this.ctr.push(cx, y0, cz, delay);
      }
    }
    for (let j = 0; j < LAT; j++) for (let i = 0; i < LON; i++) {
      const a = base + j * (LON + 1) + i, b = a + 1, c = a + LON + 1, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCtr', new THREE.Float32BufferAttribute(this.ctr, 4));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
    return g;
  }
}

const K = {steady: 0, beacon: 1, orbit: 2, dust: 3, tram: 4, owner: 5, crown: 6} as const;
class GlowBuilder {
  pos: number[] = []; cor: number[] = []; p: number[] = []; v: number[] = []; col: number[] = []; idx: number[] = [];
  count = 0;
  add(at: V3, size: number, kind: number, phase: number, delay: number, color: THREE.Color, v: [number, number, number, number] = [0, 0, 0, 0]) {
    const base = this.pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.pos.push(at[0], at[1], at[2]); this.cor.push(cx, cy);
      this.p.push(size, kind, phase, delay); this.v.push(v[0], v[1], v[2], v[3]); this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count++;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.cor, 2));
    g.setAttribute('aP', new THREE.Float32BufferAttribute(this.p, 4));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(this.v, 4));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4);
    return g;
  }
}

type Plan = {body: THREE.BufferGeometry; dome: THREE.BufferGeometry; glow: THREE.BufferGeometry; blobs: Array<[number, number, number, number]>;
  tris: {body: number; dome: number; glow: number}};
const plans = new Map<string, Plan>();

const lerpColor = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

function makePlan(id: string, grand: boolean): Plan {
  const rnd = seeded(id, grand ? 31 : 5);
  const R = (a: number, b: number) => a + (b - a) * rnd();
  const body = new BodyBuilder(), dome = new DomeBuilder(), glow = new GlowBuilder();
  const blobs: Plan['blobs'] = [];
  const T = grand ? 2.4 : 2.2;
  const taken: Array<{x: number; z: number; r: number}> = [{x: 0, z: 0.7, r: 0.17}]; // the owner's cube keeps its front corner
  // front = true prefers spots toward the camera (+z), so domes are not hidden behind the skyline
  const place = (r: number, gap: number, maxD = 0.76, front: boolean | 'back' = false) => {
    let best: {x: number; z: number} | null = null;
    for (let k = 0; k < 160; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (maxD - r);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r + gap)) {
        if (!front) { best = {x, z}; break; }
        if (!best || (front === 'back' ? z < best.z : z > best.z)) best = {x, z};
        if (k > 60 && best) break;
      }
    }
    if (best) taken.push({x: best.x, z: best.z, r});
    return best;
  };
  type Item = {x: number; z: number; r: number; h: number; kind: 'tower' | 'dome' | 'block' | 'pad'; delay: number};
  const items: Item[] = [];
  let seedN = 1;
  const A = (base: number, delay: number, win: number): [number, number, number, number] => [base, delay, seedN++ * 1.37 + rnd(), win];
  const rise = (x: number, z: number, k: number) => (grand ? 0.34 : 0.28) + (Math.hypot(x, z) / 0.8) * (T * 0.3) + k * 0.2 + rnd() * 0.08;

  // foundation slab: the stamp (delay < 0)
  body.prism(0, 0, 0.86, 0.86, 6, 0, -0.02, SLAB, lerpColor(DARK, COPPER, 0.18), [-0.02, -1, 0, 0], true, 1, 1, false, lerpColor(DARK, STEEL, 0.25));

  // glass domes
  const domeSpots: Array<{x: number; z: number; r: number}> = [];
  if (grand) {
    taken.push({x: 0, z: 0, r: 0.27});
    const n = 4, off = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.25, r = R(0.2, 0.25), d = 0.76 - r - 0.03;
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (Math.hypot(x, z - 0.7) < r + 0.17) continue;
      taken.push({x, z, r}); domeSpots.push({x, z, r});
    }
  } else {
    const n = rnd() < 0.6 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const r = R(0.22, 0.3), p = place(r, 0.03, 0.78, true);
      if (p) domeSpots.push({...p, r});
    }
  }
  domeSpots.forEach((d, i) => {
    const delay = (grand ? 1.0 : 0.85) + i * 0.13, h = d.r * R(0.75, 0.95);
    dome.dome(d.x, SLAB, d.z, d.r, h, delay);
    // rim, garden and little buildings under the glass
    body.prism(d.x, d.z, d.r * 1.04, d.r * 1.04, 16, 0, SLAB, SLAB + 0.045, lerpColor(STEEL, WHITE, 0.2), A(SLAB, delay - 0.3, 0));
    body.prism(d.x, d.z, d.r * 0.93, d.r * 0.93, 12, 0, SLAB, SLAB + 0.05, GREEN, A(SLAB, delay - 0.3, -1));
    const nb = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < nb; k++) {
      const a = rnd() * 6.28, dd = Math.sqrt(rnd()) * d.r * 0.62, bx = d.x + Math.sin(a) * dd, bz = d.z + Math.cos(a) * dd, bh = R(0.06, 0.15) * (d.r / 0.25);
      if (rnd() < 0.5) body.prism(bx, bz, 0.022, 0.003, 6, 0, SLAB + 0.05, SLAB + 0.05 + bh * 1.2, lerpColor(GREEN, WHITE, 0.1), A(SLAB + 0.05, delay + 0.1, -1));
      else body.box(bx, bz, 0.05, 0.05, rnd(), SLAB + 0.05, SLAB + 0.05 + bh * 0.7, lerpColor(WARM, WHITE, 0.2), A(SLAB + 0.05, delay + 0.1, -1));
    }
    glow.add([d.x, SLAB + h * 0.25, d.z], d.r * 1.3, K.steady, rnd() * 6, delay + 0.3, WARM);
    blobs.push([d.x, d.z, d.r * 1.0, 0.5]);
    items.push({x: d.x, z: d.z, r: d.r, h: 0.12, kind: 'dome', delay});
  });

  const tower = (x: number, z: number, rad: number, h: number, delay: number, hero: boolean) => {
    const sides = [4, 6, 8][Math.floor(rnd() * 3)], yaw = rnd() * 1.5;
    const col = PALETTE[Math.floor(rnd() * PALETTE.length)], win = R(0.5, 0.8), style = hero ? 2 : Math.floor(rnd() * 3);
    const top = lerpColor(col, DARK, 0.55);
    let topY = h;
    if (style === 0) {
      body.prism(x, z, rad, rad * 0.9, sides, yaw, SLAB, h, col, A(SLAB, delay, win), true, 1, 1, false, top);
      body.prism(x, z, rad * 0.5, rad * 0.5, 6, yaw, h, h + 0.07, lerpColor(STEEL, DARK, 0.35), A(h, delay + 0.2, 0));
      topY = h + 0.07;
    } else if (style === 1) {
      const h1 = h * 0.62;
      body.prism(x, z, rad, rad * 0.96, sides, yaw, SLAB, h1, col, A(SLAB, delay, win), true, 1, 1, false, top);
      body.prism(x, z, rad * 0.66, rad * 0.6, sides, yaw + 0.4, h1, h, lerpColor(col, WHITE, 0.3), A(h1, delay + 0.18, win), true, 1, 1, false, top);
    } else {
      body.prism(x, z, rad, rad * (hero ? 0.5 : 0.62), sides, yaw, SLAB, h, col, A(SLAB, delay, win), true, 1, 1, false, top);
    }
    if (hero) {
      body.prism(x, z, rad * 0.86, rad * 0.86, sides, yaw, h * 0.7, h * 0.7 + 0.04, WHITE, A(h * 0.7, delay + 0.3, OWNER_FLAG));
    }
    if (rnd() < 0.55 || hero) {
      const al = R(0.06, 0.16) * (hero ? 1.6 : 1);
      body.beam([x, topY, z], [x, topY + al, z], 0.009, 4, STEEL, A(topY, delay + 0.3, 0));
      glow.add([x, topY + al + 0.01, z], hero ? 0.2 : 0.13, K.beacon, rnd() * 6.28, delay + 0.75, new THREE.Color(rnd() < 0.6 ? '#ff4a3a' : '#ffffff'), [0, 0, 0, R(2.2, 3.4)]);
    }
    // a few lit setbacks on the shaft read as terraces from the camera
    items.push({x, z, r: rad, h: topY, kind: 'tower', delay});
    if (h > 0.9) blobs.push([x, z, 0.3, 0.35]);
  };

  if (grand) {
    // the arcology: three tiers, a ring platform, flying buttresses, a spire and a crown flare
    const col = new THREE.Color('#f0e8da'), cc = lerpColor(col, DARK, 0.5);
    const d0 = 0.34;
    body.prism(0, 0, 0.28, 0.23, 8, 0.2, SLAB, 0.72, col, A(SLAB, d0, 0.72), true, 1, 1, false, cc);
    body.prism(0, 0, 0.2, 0.15, 8, 0.2, 0.72, 1.38, lerpColor(col, STEEL, 0.25), A(0.72, d0 + 0.2, 0.72), true, 1, 1, false, cc);
    body.prism(0, 0, 0.13, 0.07, 8, 0.2, 1.38, 2.0, lerpColor(col, WHITE, 0.4), A(1.38, d0 + 0.4, 0.7), true, 1, 1, false, cc);
    body.prism(0, 0, 0.115, 0.115, 8, 0.2, 1.62, 1.67, WHITE, A(1.62, d0 + 0.7, OWNER_FLAG));
    // ring platform
    const ry = 1.06, ro = 0.36, ri = 0.24, N = 16, rc = lerpColor(STEEL, WHITE, 0.2);
    body.prism(0, 0, ro, ro, N, 0, ry, ry + 0.05, rc, A(ry, d0 + 0.55, 0), false);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 6.2832, a1 = ((i + 1) / N) * 6.2832;
      const o0: V3 = [Math.sin(a0) * ro, ry + 0.05, Math.cos(a0) * ro], o1: V3 = [Math.sin(a1) * ro, ry + 0.05, Math.cos(a1) * ro];
      const i0: V3 = [Math.sin(a0) * ri, ry + 0.05, Math.cos(a0) * ri], i1: V3 = [Math.sin(a1) * ri, ry + 0.05, Math.cos(a1) * ri];
      body.tri(o0, i0, i1, rc, A(ry, d0 + 0.55, 0)); body.tri(o0, i1, o1, rc, A(ry, d0 + 0.55, 0));
      if (i % 2 === 0) glow.add([Math.sin(a0) * (ro - 0.02), ry + 0.09, Math.cos(a0) * (ro - 0.02)], 0.1, K.steady, i, d0 + 1.05 + i * 0.015, new THREE.Color('#9fe8ff'));
    }
    body.prism(0, 0, ro * 1.0, ro * 1.0, N, 0, ry + 0.05, ry + 0.075, WHITE, A(ry + 0.05, d0 + 0.6, OWNER_FLAG), false);
    // buttresses
    for (let i = 0; i < 4; i++) {
      const a = 0.78 + i * 1.5708;
      body.beam([Math.sin(a) * 0.5, SLAB, Math.cos(a) * 0.5], [Math.sin(a) * 0.19, 0.86, Math.cos(a) * 0.19], 0.018, 4, STEEL, A(SLAB, d0 + 0.35, 0));
    }
    body.beam([0, 2.0, 0], [0, 2.5, 0], 0.012, 4, STEEL, A(2.0, d0 + 0.8, 0));
    glow.add([0, 2.52, 0], 0.36, K.crown, 0, d0 + 1.25, new THREE.Color('#ffe9b0'));
    glow.add([0, 1.67, 0], 0.22, K.owner, 1, d0 + 1.0, WHITE);
    for (let i = 0; i < 2; i++) glow.add([0, 1.72, 0], 0.07, K.orbit, 0, d0 + 1.2, new THREE.Color('#bfeaff'), [0.26, 0, 0, 1.3 * (i ? -1 : 1)]);
    blobs.push([0, 0, 0.45, 0.8]);
    items.push({x: 0, z: 0, r: 0.27, h: 1.0, kind: 'tower', delay: d0});
  }

  // towers (hero first), then blocks
  const nT = grand ? 7 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < nT; i++) {
    const hero = !grand && i === 0;
    const rad = hero ? R(0.17, 0.2) : R(0.09, 0.14);
    const p = place(rad, 0.025, 0.76, hero ? 'back' : false);
    if (!p) continue;
    let h = hero ? R(1.55, 1.95) : grand ? R(0.4, 1.0) : 0.35 + Math.pow(rnd(), 1.3) * 0.85;
    if (!hero) h *= 1 - 0.5 * Math.min(1, Math.max(0, (p.z + 0.15) / 0.8)); // the skyline climbs away from the camera
    tower(p.x, p.z, rad, h, rise(p.x, p.z, hero ? 1 : 0), hero);
  }
  const nB = grand ? 3 : 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < nB; i++) {
    const w = R(0.15, 0.26), d = R(0.12, 0.2), p = place(Math.max(w, d) * 0.58, 0.025);
    if (!p) continue;
    const h = R(0.14, 0.32), delay = rise(p.x, p.z, 0), yaw = rnd() * 3.14, col = PALETTE[Math.floor(rnd() * PALETTE.length)];
    body.box(p.x, p.z, w, d, yaw, SLAB, h, col, A(SLAB, delay, R(0.65, 0.9)), lerpColor(col, DARK, 0.45));
    // rooftop garden and a unit or two
    body.box(p.x + w * 0.12, p.z, w * 0.5, d * 0.6, yaw, h, h + 0.012, GREEN, A(h, delay + 0.2, -1));
    body.box(p.x - w * 0.3, p.z + d * 0.2, 0.04, 0.04, yaw, h, h + 0.04, DARK, A(h, delay + 0.2, 0));
    glow.add([p.x + w * 0.35, h + 0.03, p.z - d * 0.3], 0.07, K.steady, rnd() * 6, delay + 0.7, new THREE.Color('#ffd27a'));
    items.push({x: p.x, z: p.z, r: Math.max(w, d) * 0.5, h, kind: 'block', delay});
  }

  // landing pad with ring lights, and a mast
  const padR = 0.15, pp = place(padR, 0.02, 0.8);
  if (pp) {
    const delay = 0.5;
    body.prism(pp.x, pp.z, padR, padR, 14, 0, SLAB, SLAB + 0.025, DARK, A(SLAB, delay, 0), true, 1, 1, false, lerpColor(DARK, STEEL, 0.15));
    body.prism(pp.x, pp.z, padR * 0.55, padR * 0.55, 14, 0, SLAB + 0.025, SLAB + 0.03, lerpColor(WARM, WHITE, 0.4), A(SLAB + 0.025, delay + 0.2, -1));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.2832;
      glow.add([pp.x + Math.sin(a) * padR * 0.9, SLAB + 0.05, pp.z + Math.cos(a) * padR * 0.9], 0.06, K.steady, i * 0.8, 1.3 + i * 0.05, new THREE.Color('#ffb84a'));
    }
    blobs.push([pp.x, pp.z, 0.22, 0.6]);
    items.push({x: pp.x, z: pp.z, r: padR, h: 0.03, kind: 'pad', delay});
  }
  const mp = place(0.04, 0.02, 0.78);
  if (mp) {
    const mh = R(0.8, 1.1), d = 0.9;
    body.prism(mp.x, mp.z, 0.028, 0.006, 4, 0.4, SLAB, SLAB + mh, STEEL, A(SLAB, d, 0), false);
    for (let i = 1; i < 3; i++) body.box(mp.x, mp.z, 0.13 - i * 0.04, 0.012, i, SLAB + mh * 0.3 * i + 0.1, SLAB + mh * 0.3 * i + 0.115, STEEL, A(SLAB + mh * 0.3 * i + 0.1, d + 0.1, 0));
    glow.add([mp.x, SLAB + mh + 0.02, mp.z], 0.16, K.beacon, 0.5, 1.5, new THREE.Color('#ff4030'), [0, 0, 0, 3.1]);
  }

  // connecting tubes: each structure links to its nearest earlier neighbour
  const tubeCol = lerpColor(STEEL, WHITE, 0.3);
  let tramAt: {a: V3; b: V3; len: number} | null = null;
  for (let i = 1; i < items.length; i++) {
    const A_ = items[i];
    let best = -1, bd = 1e9;
    for (let j = 0; j < i; j++) { const d = Math.hypot(items[j].x - A_.x, items[j].z - A_.z) - items[j].r - A_.r; if (d < bd) { bd = d; best = j; } }
    if (best < 0 || bd > 0.38) continue;
    const B_ = items[best];
    const ground = A_.kind !== 'tower' || B_.kind !== 'tower';
    const y = ground ? SLAB + 0.07 : Math.max(0.2, Math.min(A_.h, B_.h) * 0.45);
    const dx = B_.x - A_.x, dz = B_.z - A_.z, l = Math.hypot(dx, dz) || 1;
    const a: V3 = [A_.x + (dx / l) * A_.r * 0.7, y, A_.z + (dz / l) * A_.r * 0.7];
    const b: V3 = [B_.x - (dx / l) * B_.r * 0.7, y, B_.z - (dz / l) * B_.r * 0.7];
    const delay = Math.max(A_.delay, B_.delay) + 0.3;
    body.beam(a, b, ground ? 0.03 : 0.022, 6, tubeCol, A(y - 0.03, delay, 0));
    glow.add([(a[0] + b[0]) / 2, y - 0.04, (a[2] + b[2]) / 2], 0.1, K.steady, rnd() * 6, delay + 0.5, new THREE.Color('#ffe2a8'));
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (!tramAt || len > tramAt.len) tramAt = {a: [a[0], a[1] + 0.05, a[2]], b: [b[0], b[1] + 0.05, b[2]], len};
  }
  if (tramAt) {
    const t = tramAt, v: [number, number, number, number] = [t.b[0] - t.a[0], 0, t.b[2] - t.a[2], 0.9];
    glow.add(t.a, 0.11, K.tram, 0, 1.5, new THREE.Color('#fff2c8'), v);
    glow.add(t.a, 0.07, K.tram, -0.18, 1.5, new THREE.Color('#ffb060'), v);
  }

  // owner pylons on the hex corners (the front corner keeps the owner's cube)
  for (let k = 1; k < 6; k++) {
    const a = (k / 6) * 6.2832, x = Math.sin(a) * 0.8, z = Math.cos(a) * 0.8, d = 0.3 + k * 0.05;
    body.prism(x, z, 0.022, 0.016, 6, 0, SLAB, SLAB + 0.15, WHITE, A(SLAB, d, OWNER_FLAG));
    glow.add([x, SLAB + 0.17, z], 0.2, K.owner, k, d + 0.5, WHITE);
  }

  // the shuttle that circles the city, with its trail
  const sh = grand ? 1.6 : 1.1, sr = 0.62, sp = R(0.5, 0.7) * (rnd() < 0.5 ? 1 : -1), ph = rnd() * 6;
  for (let i = 0; i < 5; i++) glow.add([0, sh + (grand ? 0.2 : 0), 0], 0.1 - i * 0.012, K.orbit, ph - i * 0.09 * Math.sign(sp), 1.6, i ? new THREE.Color('#ffb870') : new THREE.Color('#d8f4ff'), [sr, 0, 0, sp]);

  // dust: a stamp ring at the start, puffs where the big structures rise
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * 6.2832 + rnd() * 0.3, d = 0.55 + rnd() * 0.25;
    glow.add([Math.sin(a) * d, 0.05, Math.cos(a) * d], 0.13 + rnd() * 0.1, K.dust, 0, 0.27, new THREE.Color('#d9a67a'), [Math.sin(a) * 0.35, 0.2 + rnd() * 0.15, Math.cos(a) * 0.35, 0]);
  }
  for (const it of items.filter((i) => i.kind !== 'pad').slice(0, 9)) {
    glow.add([it.x, 0.05, it.z], 0.14, K.dust, 0, it.delay + 0.1, new THREE.Color('#cfa07c'), [(rnd() - 0.5) * 0.2, 0.18, (rnd() - 0.5) * 0.2, 0]);
  }

  while (blobs.length < 6) blobs.push([0, 0, 0.01, 0]);
  const bg = body.geometry(), dg = dome.geometry(), gg = glow.geometry();
  return {body: bg, dome: dg, glow: gg, blobs: blobs.slice(0, 6),
    tris: {body: bg.attributes.position.count / 3, dome: dg.index!.count / 3, glow: gg.index!.count / 3}};
}

export function cityPlan(id: string, grand: boolean): Plan {
  const k = id + (grand ? '#c' : '#t');
  let p = plans.get(k);
  if (!p) { p = makePlan(id, grand); plans.set(k, p); }
  return p;
}

// ---- shaders ----------------------------------------------------------------------------------------------
const HASH = `float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

const BODY_VS_PARS = `uniform float uAge; attribute vec4 aAnim; varying vec3 vOP; varying vec3 vON; varying vec4 vAn; varying float vK;`;
const BODY_VS = `#include <begin_vertex>
vOP = position; vON = normal; vAn = aAnim;
if (aAnim.y < -0.5) {
  float st = clamp(uAge / 0.3, 0.0, 1.0);
  transformed.y += (1.0 - st * st) * 0.8; vK = 1.0;
} else {
  float t = clamp((uAge - aAnim.y) / 0.6, 0.0, 1.0), u = t - 1.0;
  float k = t <= 0.0 ? 0.0 : 1.0 + 2.2 * u * u * u + 1.2 * u * u;
  transformed.y = aAnim.x + (position.y - aAnim.x) * k; vK = t;
}`;
const BODY_FS_PARS = `uniform float uAge; uniform float uNight; uniform float uTime; uniform float uMove; uniform vec3 uOwner;
varying vec3 vOP; varying vec3 vON; varying vec4 vAn; varying float vK;
${HASH}`;
const BODY_FS_COLOR = `#include <color_fragment>
if (vK <= 0.0) discard;
float wm = 0.0; float wLit = 0.0; vec3 wcol = vec3(0.0);
float reveal = 0.0; float band = 0.0;
{
  float wy = vOP.y;
  float wave = uAge - (0.95 + wy * 0.5);
  reveal = smoothstep(0.0, 0.2, wave); band = exp(-wave * wave * 28.0);
}
if (vAn.w > 0.0 && vAn.w < 5.0 && abs(vON.y) < 0.5 && vOP.y > 0.07) {
  vec2 tg = normalize(vec2(-vON.z, vON.x));
  float uu = dot(vOP.xz, tg) / 0.055; float vv = vOP.y / 0.08;
  vec2 cell = vec2(floor(uu), floor(vv)); vec2 f = fract(vec2(uu, vv));
  wm = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
  float h = hash(cell + vAn.z * 17.0), h2 = hash(cell * 1.7 + 3.1 + vAn.z), h3 = hash(cell * 2.3 + 9.7 + vAn.z);
  wLit = step(h, vAn.w);
  wcol = mix(vec3(1.0, 0.66, 0.32), vec3(0.78, 0.92, 1.0), step(0.82, h2));
  if (h3 > 0.95) wLit *= 0.35 + 0.65 * step(0.0, sin(uTime * (5.0 + h3 * 40.0) + h3 * 60.0) * uMove + (1.0 - uMove));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.07, 0.12), wm * 0.9);
}
float accent = step(5.0, vAn.w);
if (accent > 0.5) diffuseColor.rgb = uOwner;`;
const BODY_FS_EMIT = `#include <emissivemap_fragment>
totalEmissiveRadiance += wm * wcol * wLit * (uNight * 1.25 * reveal + 0.08 * reveal);
totalEmissiveRadiance += wm * vec3(1.0, 0.92, 0.75) * band * (0.4 + wLit * 1.6);
if (accent > 0.5) totalEmissiveRadiance += uOwner * (0.5 + uNight * 1.4 + band * 1.5);
if (vAn.w < 0.0) totalEmissiveRadiance += diffuseColor.rgb * (0.12 + uNight * 0.9) * reveal;`;

const DOME_VS = `uniform float uAge; attribute vec2 aUV; attribute vec4 aCtr;
varying vec3 vWP; varying vec3 vN; varying vec2 vUV; varying float vS;
void main() {
  float t = clamp((uAge - aCtr.w) / 0.6, 0.0, 1.0), u = t - 1.0;
  float s = t <= 0.0 ? 0.0 : 1.0 + 2.6 * u * u * u + 1.6 * u * u;
  vec3 c = aCtr.xyz; vec3 p = c + (position - c) * s;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vUV = aUV; vS = t;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DOME_FS = `uniform float uAge; uniform float uNight; uniform float uTime; uniform float uMove;
varying vec3 vWP; varying vec3 vN; varying vec2 vUV; varying float vS;
void main() {
  if (vS <= 0.0) discard;
  vec3 V = normalize(cameraPosition - vWP); vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float fr = pow(1.0 - abs(dot(N, V)), 2.4);
  vec3 L = normalize(vec3(0.4, 0.8, 0.5));
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 36.0) * (1.0 - uNight * 0.75);
  float streak = pow(max(0.0, sin(dot(vWP.xz, vec2(1.0, 0.6)) * 14.0 + uTime * 0.7 * uMove)), 40.0) * fr;
  vec2 g = abs(fract(vUV - 0.5) - 0.5) / max(fwidth(vUV), vec2(0.0001));
  float lat = 1.0 - min(g.y, 1.0);
  float lon = (1.0 - min(g.x, 1.0)) * (1.0 - smoothstep(4.6, 6.2, vUV.y));
  float line = max(lat, lon);
  vec3 tint = vec3(0.35, 0.62, 0.82);
  vec3 col = tint * 0.22 + vec3(0.62, 0.88, 1.0) * fr * 1.3 + vec3(1.0, 0.8, 0.5) * uNight * (0.18 + 0.2 * (1.0 - fr));
  col += vec3(0.8, 0.95, 1.0) * line * (0.5 + uNight * 0.5) + vec3(1.0) * (spec * 0.9 + streak * 0.6);
  float a = 0.09 + 0.5 * fr + line * 0.5 + spec * 0.6 + streak * 0.4 + uNight * 0.08;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
  #include <colorspace_fragment>
}`;

const GLOW_VS = `attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aV; attribute vec3 aCol;
uniform float uAge; uniform float uTime; uniform float uMove; uniform float uR; uniform float uNight; uniform vec3 uOwner;
varying vec2 vC; varying vec3 vCol; varying float vI; varying float vFlare;
void main() {
  float kind = aP.y; float size = aP.x; float ph = aP.z; float dl = aP.w;
  vec3 pos = position; float I = 1.0; vFlare = 0.0; vec3 col = aCol;
  float on = smoothstep(dl, dl + 0.1, uAge);
  float glint = uAge > dl ? exp(-(uAge - dl) * 5.0) * 2.5 : 0.0;
  float lvl = 0.35 + 0.65 * uNight;
  float tm = uTime * uMove;
  if (kind < 0.5) { I = on * lvl * (1.0 + glint) * (0.88 + 0.12 * sin(tm * 2.0 + ph)); }
  else if (kind < 1.5) {
    float b = mix(1.0, pow(0.5 + 0.5 * sin(uTime * aV.w + ph), 5.0), uMove);
    I = on * (0.55 + 0.45 * uNight) * (0.12 + 0.88 * b) * (1.0 + glint); vFlare = 1.0;
  } else if (kind < 2.5) {
    float a = uTime * aV.w + ph;
    pos += vec3(cos(a) * aV.x, aV.y + 0.03 * sin(a * 3.0), sin(a) * aV.x);
    I = on * (0.8 + 0.5 * uNight) * (1.0 + glint * 0.5); vFlare = 0.4;
  } else if (kind < 3.5) {
    float k = clamp((uAge - dl) / 1.0, 0.0, 1.0);
    pos += aV.xyz * (1.0 - (1.0 - k) * (1.0 - k));
    I = (uAge > dl ? 1.0 : 0.0) * (1.0 - k) * min(k * 10.0, 1.0) * 0.14; size *= 1.0 + k * 1.4;
  } else if (kind < 4.5) {
    float s = 0.5 - 0.5 * cos(uTime * aV.w + ph);
    pos += aV.xyz * s; I = on * (0.85 + 0.4 * uNight); vFlare = 0.3;
  } else if (kind < 5.5) {
    col = uOwner; I = on * (0.7 + 0.6 * uNight) * (0.9 + 0.1 * sin(tm * 2.0 + ph)) * (1.0 + glint);
  } else {
    I = on * (0.55 + 0.9 * uNight) * (1.0 + glint * 1.5) * (0.88 + 0.12 * sin(tm * 1.5)); vFlare = 1.0;
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float sz = size * uR;
  mv.xy += aCorner * sz; mv.z += sz * 0.5;
  gl_Position = projectionMatrix * mv;
  vC = aCorner; vCol = col; vI = I;
}`;
const GLOW_FS = `varying vec2 vC; varying vec3 vCol; varying float vI; varying float vFlare;
void main() {
  float d = length(vC); if (d > 1.0) discard;
  float halo = exp(-d * d * 5.0), core = exp(-d * d * 38.0);
  float fl = vFlare * (exp(-abs(vC.x) * 20.0) * exp(-abs(vC.y) * 2.2) + exp(-abs(vC.y) * 20.0) * exp(-abs(vC.x) * 2.2));
  float fade = 1.0 - smoothstep(0.35, 1.0, d);
  vec3 c = (vCol * (halo * 0.6 + fl * 0.85) + vec3(1.0) * core * 0.9) * fade;
  gl_FragColor = vec4(c * vI, 1.0);
  #include <colorspace_fragment>
}`;

const BASE_VS = `varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BASE_FS = `uniform float uAge; uniform float uNight; uniform float uTime; uniform float uMove; uniform vec3 uOwner; uniform vec4 uBlob[6];
varying vec2 vP;
void main() {
  vec2 p = vP; float r = length(p);
  float hd = max(abs(p.y) * 0.8660254 + abs(p.x) * 0.5, abs(p.x));  // pointy-top like the prisms: corners on ±z
  float a = atan(p.x, p.y); float an = a / 6.2831853 + 0.5;
  float rev = clamp((uAge - 0.08) / 0.7, 0.0, 1.0);
  float vis = step(an, rev * 1.02);
  float chase = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(a * 3.0 - uTime * 1.4 * uMove), 3.0);
  float ring = 1.0 - smoothstep(0.014, 0.03, abs(hd - 0.83));
  vec3 col = uOwner * ring * (1.2 + uNight * 1.0) * chase * vis;
  col += uOwner * 0.3 * exp(-pow((hd - 0.83) * 13.0, 2.0)) * vis * (0.6 + uNight);
  col += uOwner * 0.3 * (1.0 - smoothstep(0.004, 0.012, abs(hd - 0.69))) * vis * (0.5 + uNight);
  col += vec3(1.0, 0.9, 0.7) * exp(-uAge * 5.0) * 0.22 * step(hd, 0.88);
  float wr = (uAge - 0.22) * 2.4;
  col += mix(uOwner, vec3(1.0), 0.5) * exp(-pow((r - wr) * 8.0, 2.0)) * clamp(1.0 - (uAge - 0.22) * 0.9, 0.0, 1.0) * step(0.22, uAge) * 0.9;
  float pool = 0.0;
  for (int i = 0; i < 6; i++) { vec4 b = uBlob[i]; vec2 q = p - b.xy; pool += b.w * exp(-dot(q, q) / (b.z * b.z)); }
  pool += 0.25 * (1.0 - smoothstep(0.2, 0.9, hd));
  col += vec3(1.0, 0.68, 0.38) * pool * uNight * 0.38 * clamp((uAge - 1.1) / 0.6, 0.0, 1.0);
  col *= 1.0 - smoothstep(0.88, 0.95, hd);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// ---- shared base geometry -----------------------------------------------------------------------------------
let basePlane: THREE.PlaneGeometry | null = null;
const getBase = () => {
  if (!basePlane) { basePlane = new THREE.PlaneGeometry(2.2, 2.2); basePlane.rotateX(-Math.PI / 2); basePlane.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2); }
  return basePlane;
};

export function CityModel(p: ModelProps & {grand: boolean}) {
  const {id, grand, color, radius, top, night, age} = p;
  const plan = useMemo(() => cityPlan(id, grand), [id, grand]);
  const hex = (color && color !== 'neutral' ? PLAYER_HEX[color] : null) ?? '#d8e2e8';
  const inst = useMemo(() => {
    const U = {
      uAge: {value: 999}, uNight: {value: 0}, uTime: {value: 0}, uMove: {value: 1}, uR: {value: 1},
      uOwner: {value: new THREE.Color(hex)}, uBlob: {value: plan.blobs.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3]))},
    };
    const bodyMat = new THREE.MeshStandardMaterial({vertexColors: true, metalness: 0.25, roughness: 0.55});
    bodyMat.customProgramCacheKey = () => 'cityBody';
    bodyMat.onBeforeCompile = (sh) => {
      for (const k of ['uAge', 'uNight', 'uTime', 'uMove', 'uOwner'] as const) sh.uniforms[k] = U[k];
      sh.vertexShader = BODY_VS_PARS + '\n' + sh.vertexShader.replace('#include <begin_vertex>', BODY_VS);
      sh.fragmentShader = BODY_FS_PARS + '\n' + sh.fragmentShader.replace('#include <color_fragment>', BODY_FS_COLOR).replace('#include <emissivemap_fragment>', BODY_FS_EMIT);
    };
    const pick = (keys: Array<keyof typeof U>) => Object.fromEntries(keys.map((k) => [k, U[k]]));
    const domeMat = new THREE.ShaderMaterial({uniforms: pick(['uAge', 'uNight', 'uTime', 'uMove']), vertexShader: DOME_VS, fragmentShader: DOME_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: {derivatives: true} as never});
    const glowMat = new THREE.ShaderMaterial({uniforms: pick(['uAge', 'uNight', 'uTime', 'uMove', 'uR', 'uOwner']), vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    const baseMat = new THREE.ShaderMaterial({uniforms: pick(['uAge', 'uNight', 'uTime', 'uMove', 'uOwner', 'uBlob']), vertexShader: BASE_VS, fragmentShader: BASE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    return {U, bodyMat, domeMat, glowMat, baseMat};
  }, [plan, hex]);
  useEffect(() => () => { inst.bodyMat.dispose(); inst.domeMat.dispose(); inst.glowMat.dispose(); inst.baseMat.dispose(); }, [inst]);

  useFrame(() => {
    const U = inst.U;
    U.uAge.value = world.reduced ? 999 : age();
    U.uNight.value = night;
    U.uMove.value = world.reduced ? 0 : 1;
    U.uTime.value = world.reduced ? 3.3 : world.t;
    U.uR.value = radius;
  });

  return createElement('group', {position: [0, top, 0], scale: radius},
    createElement('mesh', {geometry: getBase(), material: inst.baseMat, position: [0, SLAB + 0.004, 0], renderOrder: 1, frustumCulled: false}),
    createElement('mesh', {geometry: plan.body, material: inst.bodyMat, frustumCulled: false}),
    createElement('mesh', {geometry: plan.dome, material: inst.domeMat, renderOrder: 2, frustumCulled: false}),
    createElement('mesh', {geometry: plan.glow, material: inst.glowMat, renderOrder: 3, frustumCulled: false}),
  );
}

/** triangle counts of a plan, for the report */
export function cityStats(id: string, grand: boolean) { const p = cityPlan(id, grand); return p.tris; }
