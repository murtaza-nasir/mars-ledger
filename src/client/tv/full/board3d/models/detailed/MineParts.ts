// The Detailed Mine's built parts: headframe, winding house, conveyor gantry, crusher, processing plant, stockpiles,
// floodlights, haul truck, excavator, hoist cage. Unit space (hex circumradius 1, y = 0 on the prism top).
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Builder, G, clamp01, hash, triCount} from '../MineKit';
import {C, H0, PHI, roadH, roadR, roadTh, type Variant, groundH} from './MineGround';

export const HF = {x: 0.46, z: -0.4};
export const HF_H = 0.9; // headframe height above its base
export const WIND = {x: 0.66, z: -0.2};
export const BELT_S: [number, number, number] = [-0.16, 0.2, -0.06];
export const BELT_E: [number, number, number] = [-0.03, 0.56, -0.54];
export const CRUSH = {x: -0.03, z: -0.66};
export const STACK_S: [number, number, number] = [0.07, 0.46, -0.66];
export const STACK_E: [number, number, number] = [0.25, 0.4, -0.64];
export const PILES: Array<{x: number; z: number; r: number; h: number}> = [
  {x: 0.29, z: -0.64, r: 0.12, h: 0.13}, {x: 0.28, z: 0.64, r: 0.1, h: 0.085}, {x: 0.64, z: 0.2, r: 0.09, h: 0.08}, {x: 0.22, z: 0.7, r: 0.06, h: 0.05},
];
export const FLOODS: Array<[number, number, number]> = [[0.66, 0.0, 0.36], [-0.64, -0.2, 0.34], [0.02, 0.76, 0.34], [-0.2, -0.76, 0.36]];
export const EXC = {x: -0.264, z: 0.022, yaw: 2.5, y: 0.122, s: 0.7};
/** pivot offsets of the excavator's arm, in its house's frame */
export const EXC_BOOM = [0, 0.045, 0.03] as const, EXC_STICK = [0, 0.05, 0.14] as const;
export const PLANT = {x: -0.36, z: -0.52};
export const gy = (x: number, z: number) => groundH(x, z) - 0.012;
export const N_RL = 14;
/** world y of the sheave wheel's axle */
export const wheelY = () => gy(HF.x, HF.z) + HF_H + 0.075;

export type MineGeo = {
  body: THREE.BufferGeometry; lit: THREE.BufferGeometry; wheel: THREE.BufferGeometry; truck: THREE.BufferGeometry; load: THREE.BufferGeometry;
  exTracks: THREE.BufferGeometry; exHouse: THREE.BufferGeometry; exBoom: THREE.BufferGeometry; exStick: THREE.BufferGeometry; cage: THREE.BufferGeometry;
  tris: number;
};

const lump = (g: THREE.BufferGeometry, seed: number, amp: number, rows: number, seg: number) => {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.round((Math.atan2(z, x) / (Math.PI * 2) + 0.5) * seg) % seg, ring = Math.round((y + 0.5) * rows);
    const n = 1 + amp * (hash(a * 7 + ring * 53, seed) * 2 - 1);
    p.setXYZ(i, x * n, y, z * n);
  }
};

/** a heaped ore pile (lumpy cone) with flat-shaded facets in the variant's colours */
function pile(B: Builder, x: number, z: number, r: number, h: number, cols: number[], seed: number, seg: number, rows: number, full: boolean) {
  const g = new THREE.ConeGeometry(1, 1, seg, rows, true);
  lump(g, seed, 0.1, rows, seg);
  const q = g.toNonIndexed();
  q.scale(r, h, r); q.translate(x, gy(x, z) + h / 2 - 0.004, z);
  B.addRaw(q, cols[0], [0.75, 1.1]);
  const col = B.parts[B.parts.length - 1].attributes.color as THREE.BufferAttribute, pos = B.parts[B.parts.length - 1].attributes.position as THREE.BufferAttribute;
  const c = new THREE.Color(), c2 = new THREE.Color();
  for (let t = 0; t < col.count / 3; t++) {
    const yy = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3, f = clamp01((yy - gy(x, z)) / h);
    c.setHex(cols[(Math.floor(hash(Math.floor(t / 4), seed + 3) * 3) + (f > 0.5 ? 1 : 0)) % cols.length]).multiplyScalar(0.8 + 0.3 * hash(t, seed + 4));
    c2.setHex(cols[0]).multiplyScalar(0.7 + 0.4 * f); c.lerp(c2, 0.35);
    for (let k = 0; k < 3; k++) col.setXYZ(t * 3 + k, c.r, c.g, c.b);
  }
  if (full) {
    for (let k = 0; k < 9; k++) {
      const a = hash(k, seed + 9) * 6.283, d = r * (0.2 + 0.7 * hash(k, seed + 10)), s = r * (0.07 + 0.08 * hash(k, seed + 11));
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, ph = h * (1 - d / r) * 0.92;
      B.add(G.ico(), px, gy(x, z) + ph + s * 0.2, pz, cols[k % cols.length], {sx: s * 1.2, sy: s * 0.8, sz: s, rx: k, ry: k * 2.1, ao: [0.8, 1.2]});
    }
  }
}

function boulder(B: Builder, x: number, z: number, s: number, color: number, k: number) {
  B.add(G.ico(), x, gy(x, z) + s * 0.4, z, color, {sx: s, sy: s * 0.7, sz: s * 0.9, rx: k, ry: k * 1.7, rz: k * 0.4, ao: [0.7, 1.15]});
}

export function buildParts(v: Variant, owner: number, rights: boolean, full: boolean): MineGeo {
  const B = new Builder(), L = new Builder();
  const STEEL = 0x4a4f56, DARK = 0x2c2f34, LIGHT = 0x8a8f96, YELLOW = 0xe8a317;
  const cs = full ? 10 : 6;

  // ---------- group 0: infrastructure on the pit and plateau ----------
  B.grp = 0; L.grp = 0;
  // pit-floor pool and pump
  B.cyl(C.x, 0.004, C.z, 0.072, 0.014, v.pool, 1, full ? 18 : 10, {ao: [1, 1]});
  if (full) {
    B.box(C.x + 0.06, 0.014, C.z - 0.03, 0.035, 0.03, 0.025, YELLOW); B.cyl(C.x + 0.075, 0.044, C.z - 0.02, 0.006, 0.02, DARK, 1, 6);
    B.tube(C.x + 0.07, 0.02, C.z - 0.015, C.x + 0.12, 0.024, C.z - 0.07, 0.006, 0x1d1f22, 6, [1, 1]);
    // blast-hole markers and survey stakes on the floor benches
    for (let i = 0; i < 12; i++) {
      const th = hash(i, 3) * 6.283, r = 0.1 + hash(i, 4) * 0.35, x = C.x + Math.cos(th) * r * 0.9, z = C.z + Math.sin(th) * r * 0.9;
      const gh = groundH(x, z);
      if (gh > 0.01) B.cyl(x, gh - 0.003, z, 0.004, 0.026, i % 3 ? 0xd8d0c0 : 0xe8601a, 1, 5);
    }
  }
  // road lamps (poles here, lamp heads in the lit mesh)
  for (let i = 0; i < N_RL; i += full ? 1 : 2) {
    const phi = ((i + 0.5) / N_RL) * PHI * 0.96, th = roadTh(phi), r = roadR(phi) + 0.075;
    const x = C.x + Math.cos(th) * r, z = C.z + Math.sin(th) * r, y = roadH(phi);
    B.cyl(x, y, z, 0.004, 0.034, DARK, 1, 5);
    L.box(x - 0.007, y + 0.032, z - 0.007, 0.014, 0.009, 0.014, 0xffe2a0);
  }
  // boulders on the benches and the plateau
  const BRK = [0x6a5a4c, 0x5a4a3e, 0x7a6a58];
  for (let i = 0; i < (full ? 26 : 4); i++) {
    const a = hash(i, 41) * 6.283, d = 0.6 + hash(i, 42) * 0.32, x = C.x + Math.cos(a) * d * 1.05, z = C.z + Math.sin(a) * d;
    if (Math.abs(x) > 0.74 || groundH(x, z) < 0.12 || Math.hypot(x - HF.x, z - HF.z) < 0.18 || Math.hypot(x - PLANT.x, z - PLANT.z) < 0.25) continue;
    boulder(B, x, z, 0.014 + 0.022 * hash(i, 43), BRK[i % 3], i);
  }
  // fence around the rim (posts + rails), leaving the road mouth open
  if (full) {
    const R = 0.6 * 0.88 + 0.12, N = 64;
    let prev: [number, number] | null = null;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * 6.283;
      const x = C.x + Math.cos(th) * R * (1 + 0.04 * Math.sin(th * 3)), z = C.z + Math.sin(th) * R * (1 + 0.04 * Math.sin(th * 3));
      const gh = groundH(x, z);
      if (hexN(x, z) > 0.8 || gh < 0.25 || Math.abs(th - 0.5) < 0.2 || Math.abs(th - 0.5 - 6.283) < 0.2) { prev = null; continue; }
      B.cyl(x, gh - 0.004, z, 0.004, 0.032, i % 4 ? 0x6a6f76 : 0xd8d0c0, 1, 5);
      if (prev) { B.tube(prev[0], gh + 0.024, prev[1], x, gh + 0.024, z, 0.0025, 0xc8c0a8, 4, [1, 1]); B.tube(prev[0], gh + 0.012, prev[1], x, gh + 0.012, z, 0.002, 0x8a8f96, 4, [1, 1]); }
      prev = [x, z];
    }
  }

  // ---------- group 1: conveyor, crusher, plant, piles, floods ----------
  B.grp = 1; L.grp = 1;
  const [sx, sy, sz] = BELT_S, [ex, ey, ez] = BELT_E;
  const bl = Math.hypot(ex - sx, ey - sy, ez - sz), ux = (ex - sx) / bl, uy = (ey - sy) / bl, uz = (ez - sz) / bl;
  const px = -uz, pz = ux, pl = Math.hypot(px, pz), qx = px / pl, qz = pz / pl; // horizontal perpendicular
  // belt: two side rails, the belt itself and a cover plate along the upper half
  for (const sd of [-1, 1]) B.bar(sx + qx * 0.03 * sd, sy, sz + qz * 0.03 * sd, ex + qx * 0.03 * sd, ey, ez + qz * 0.03 * sd, 0.012, LIGHT, [0.8, 1]);
  B.bar(sx, sy - 0.012, sz, ex, ey - 0.012, ez, 0.05, 0x1c1d20, [0.9, 1]);
  B.bar(sx, sy + 0.001, sz, ex, ey + 0.001, ez, 0.042, 0x303236, [1, 1]);
  const NT = full ? 6 : 4;
  for (let i = 0; i <= NT; i++) {
    const t = (i + 0.4) / (NT + 0.8), x = sx + (ex - sx) * t, y = sy + (ey - sy) * t, z = sz + (ez - sz) * t, g = Math.max(0, groundH(x, z) - 0.01);
    for (const sd of [-1, 1]) B.bar(x + qx * 0.034 * sd, g, z + qz * 0.034 * sd, x + qx * 0.03 * sd, y - 0.01, z + qz * 0.03 * sd, 0.012, 0x55595f);
    if (full) {
      B.bar(x - qx * 0.034, g + 0.03, z - qz * 0.034, x + qx * 0.03, y - 0.04, z + qz * 0.03, 0.006, 0x6a6f76);
      B.bar(x + qx * 0.034, g + 0.03, z + qz * 0.034, x - qx * 0.03, y - 0.04, z - qz * 0.03, 0.006, 0x6a6f76);
      B.box(x + qx * 0.0 - 0.034, y - 0.014, z - 0.03, 0.068, 0.006, 0.06, DARK, {ry: Math.atan2(ux, uz)});
    }
    L.box(x - 0.009, y + 0.028, z - 0.009, 0.018, 0.01, 0.018, t > 0.5 ? 0xffb347 : 0x6dff9a);
  }
  if (full) {
    for (let i = 0; i < 18; i++) { // idlers
      const t = (i + 0.5) / 18, x = sx + (ex - sx) * t, y = sy + (ey - sy) * t + 0.006, z = sz + (ez - sz) * t;
      B.add(G.cyl(1, 6), x, y, z, 0x7a7f87, {rz: Math.PI / 2, ry: Math.atan2(ux, uz), sx: 0.008, sy: 0.062, sz: 0.008, ao: [1, 1]});
    }
    // handrail on the belt gantry
    B.bar(sx - qx * 0.04, sy + 0.04, sz - qz * 0.04, ex - qx * 0.04, ey + 0.04, ez - qz * 0.04, 0.005, 0xe8a317);
  }
  // feed hopper at the foot of the belt
  B.box(sx - 0.05, sy - 0.1, sz - 0.03, 0.1, 0.08, 0.1, 0x5b5f66, {ao: [0.6, 1]});
  B.add(G.cyl(0.4, 4), sx, sy - 0.015, sz + 0.02, 0x7a7f87, {sx: 0.075, sy: 0.05, sz: 0.075, ry: Math.PI / 4, ao: [0.7, 1]});
  // crusher tower
  const cx = CRUSH.x, cz = CRUSH.z, cg = gy(cx, cz);
  B.box(cx - 0.13, cg, cz - 0.09, 0.26, 0.2, 0.17, 0x676c74, {win: 0, ao: [0.55, 1]});
  B.box(cx - 0.12, cg + 0.2, cz - 0.08, 0.24, 0.02, 0.15, DARK);
  B.add(G.cyl(0.5, 4), cx, cg + 0.3, cz, 0x8a8f96, {sx: 0.12, sy: 0.12, sz: 0.1, ry: Math.PI / 4, ao: [0.8, 1.1]}); // hopper at the head
  B.box(cx - 0.05, ey - cg + cg - 0.015, cz + 0.07, 0.1, 0.02, 0.05, 0x5b5f66); // belt head chute
  B.cyl(cx - 0.08, cg + 0.22, cz - 0.04, 0.012, 0.14, STEEL, 1, 6); B.cyl(cx + 0.07, cg + 0.22, cz - 0.05, 0.016, 0.1, STEEL, 1, 6); // vents
  L.box(cx - 0.1, cg + 0.12, cz + 0.082, 0.07, 0.04, 0.004, 0xffc86a); L.box(cx + 0.02, cg + 0.12, cz + 0.082, 0.06, 0.04, 0.004, 0xffc86a);
  L.box(cx - 0.13, cg + 0.19, cz + 0.082, 0.26, 0.008, 0.006, owner);
  if (full) {
    for (let i = 0; i < 5; i++) B.box(cx - 0.125, cg + 0.04 + i * 0.03, cz + 0.082, 0.25, 0.004, 0.004, 0x5a5f66); // cladding ribs
    B.box(cx + 0.13, cg + 0.02, cz - 0.04, 0.05, 0.12, 0.08, 0x4a4f56); // motor room
    L.box(cx + 0.135, cg + 0.07, cz - 0.0, 0.003, 0.03, 0.04, 0xffb347);
    for (let i = 0; i < 6; i++) B.box(cx + 0.18, cg + 0.0 + i * 0.022, cz - 0.01, 0.012, 0.004, 0.04, LIGHT); // ladder-ish
    B.tube(cx + 0.13, cg + 0.12, cz, cx + 0.2, cg + 0.04, cz + 0.06, 0.008, 0xc65a2a);
    B.cyl(cx - 0.1, cg - 0.01, cz + 0.14, 0.02, 0.05, 0x3a3d42, 1, 8); B.cyl(cx + 0.1, cg - 0.01, cz + 0.14, 0.02, 0.05, 0x3a3d42, 1, 8);
  }
  // stacker conveyor dropping onto the ore pile
  const [tx0, ty0, tz0] = STACK_S, [tx1, ty1, tz1] = STACK_E;
  B.bar(tx0, ty0, tz0, tx1, ty1, tz1, 0.045, 0x1c1d20, [0.9, 1]);
  for (const sd of [-1, 1]) B.bar(tx0, ty0 + 0.02, tz0 + 0.026 * sd, tx1, ty1 + 0.02, tz1 + 0.026 * sd, 0.008, LIGHT);
  B.bar(tx1 - 0.04, gy(tx1, tz1), tz1, tx1 - 0.03, ty1 - 0.01, tz1, 0.014, 0x55595f);
  B.bar(tx0 + 0.04, cg, tz0 - 0.03, tx0 + 0.04, ty0 - 0.01, tz0 - 0.03, 0.012, 0x55595f);
  // processing plant
  const [plx, plz] = [PLANT.x, PLANT.z], pg = gy(plx, plz);
  B.box(plx - 0.14, pg, plz - 0.09, 0.2, 0.1, 0.13, 0x6c7178, {ao: [0.6, 1]});
  for (let i = 0; i < 4; i++) B.add(G.box(), plx - 0.12 + i * 0.05, pg + 0.115, plz - 0.025, 0x4a4f56, {sx: 0.05, sy: 0.012, sz: 0.14, rx: 0.34, ao: [0.9, 1]});
  L.box(plx - 0.13, pg + 0.05, plz + 0.043, 0.18, 0.025, 0.004, 0xffc86a);
  L.box(plx - 0.14, pg + 0.098, plz + 0.044, 0.2, 0.008, 0.006, owner);
  B.box(plx - 0.04, pg, plz + 0.06, 0.1, 0.06, 0.08, 0x5a5f66); L.box(plx - 0.02, pg + 0.03, plz + 0.141, 0.06, 0.022, 0.004, 0xffd27a);
  // silos with domes, thickener tank, stack
  for (const [dx, dz, r, h] of [[0.14, -0.04, 0.036, 0.19], [0.14, 0.04, 0.036, 0.16], [0.07, 0.06, 0.03, 0.14]] as Array<[number, number, number, number]>) {
    B.cyl(plx + dx, pg, plz + dz, r, h, 0xd8d4c8, 1, cs + 4, {ao: [0.55, 1]}); B.add(G.sph(), plx + dx, pg + h, plz + dz, 0xd8d4c8, {sx: r, sy: r * 0.5, sz: r});
    if (full) { B.cyl(plx + dx, pg + h * 0.4, plz + dz, r * 1.04, 0.006, 0x8a8f96, 1, 12); B.cyl(plx + dx, pg + h * 0.75, plz + dz, r * 1.04, 0.006, 0x8a8f96, 1, 12); }
  }
  B.cyl(plx - 0.2, pg, plz + 0.05, 0.075, 0.035, 0x7a7f87, 1, cs + 6, {ao: [0.6, 1]});
  L.add(G.cyl(1, 14), plx - 0.2, pg + 0.036, plz + 0.05, 0x3a7a8a, {sx: 0.065, sy: 0.004, sz: 0.065, ao: [1, 1]});
  B.cyl(plx - 0.2, pg + 0.034, plz + 0.05, 0.006, 0.01, DARK, 1, 6);
  B.cyl(plx - 0.17, pg, plz - 0.07, 0.016, 0.3, 0x5a5650, 0.7, cs);
  B.cyl(plx - 0.17, pg + 0.3, plz - 0.07, 0.013, 0.008, 0xc65a2a, 1.1, cs);
  L.add(G.cyl(1, 8), plx - 0.17, pg + 0.31, plz - 0.07, 0xff6a1a, {sx: 0.011, sy: 0.004, sz: 0.011, ao: [1, 1]});
  if (full) {
    for (let i = 0; i < 4; i++) B.cyl(plx - 0.17, pg + 0.07 + i * 0.07, plz - 0.07, 0.0175 - i * 0.0013, 0.012, i % 2 ? 0xe8e4d8 : 0xc65a2a, 0.95, 10);
    B.tube(plx + 0.14, pg + 0.17, plz - 0.04, plx - 0.1, pg + 0.12, plz - 0.04, 0.007, 0xb0b4ba); B.tube(plx + 0.14, pg + 0.15, plz + 0.04, plx + 0.07, pg + 0.12, plz + 0.06, 0.006, 0xc65a2a);
    B.tube(plx - 0.1, pg + 0.12, plz - 0.04, plx - 0.1, pg + 0.0, plz - 0.04, 0.007, 0xb0b4ba);
    B.tube(plx - 0.2, pg + 0.03, plz + 0.05, plx - 0.2, pg + 0.045, plz - 0.03, 0.006, 0x4a7aa0); B.tube(plx - 0.2, pg + 0.045, plz - 0.03, plx - 0.1, pg + 0.08, plz - 0.04, 0.006, 0x4a7aa0);
    // railing + walkway on the shed roof, a small rotary dryer drum
    B.add(G.cyl(1, 14), plx - 0.04, pg + 0.034, plz - 0.11, 0x8a5a3a, {rz: Math.PI / 2, sx: 0.026, sy: 0.17, sz: 0.026, ao: [0.7, 1]});
    for (const dx of [-0.1, 0.0, 0.1]) B.box(plx - 0.04 + dx - 0.004, pg, plz - 0.126, 0.008, 0.02, 0.03, DARK);
    // shipping containers
    for (const [cx2, cz2, cy, c, ry] of [[0.2, 0.7, 0, 0xb8863a, 0], [0.19, 0.7, 0.035, 0x4a6a8a, 0], [0.3, 0.72, 0, 0xa0482a, 0.2]] as Array<[number, number, number, number, number]>) {
      B.add(G.box(), cx2, gy(cx2, cz2) + 0.02 + cy, cz2, c, {sx: 0.09, sy: 0.034, sz: 0.036, ry, ao: [0.75, 1]});
    }
    // pipe bridge between plant and crusher
    B.tube(plx + 0.17, pg + 0.2, plz + 0.0, cx - 0.1, cg + 0.2, cz + 0.0, 0.007, 0xc65a2a); B.tube(plx + 0.17, pg + 0.2, plz - 0.01, cx - 0.1, cg + 0.2, cz - 0.01, 0.005, 0xb0b4ba);
  }
  // control cabin with a flagpole
  const cbx = 0.5, cbz = 0.46, cbg = gy(cbx, cbz);
  B.box(cbx - 0.06, cbg, cbz - 0.04, 0.12, 0.06, 0.08, 0xd8d4c8, {ao: [0.6, 1]}); B.box(cbx - 0.065, cbg + 0.06, cbz - 0.045, 0.13, 0.008, 0.09, 0x4a4f56);
  L.box(cbx - 0.05, cbg + 0.025, cbz + 0.0405, 0.1, 0.022, 0.004, 0xffd27a);
  B.cyl(cbx + 0.1, gy(cbx + 0.1, cbz - 0.1), cbz - 0.1, 0.004, 0.2, 0xc8ccd2, 1, 5);
  L.box(cbx + 0.103, gy(cbx + 0.1, cbz - 0.1) + 0.12, cbz - 0.1 - 0.0, 0.07, 0.044, 0.004, owner);
  // stockpiles
  PILES.forEach((p, i) => pile(B, p.x, p.z, p.r, p.h, v.pile, 100 + i * 17, full ? 20 : 10, full ? 6 : 3, full));
  // floodlight poles with light bars
  for (const [fx, fz, fh] of FLOODS) {
    const g = gy(fx, fz);
    B.cyl(fx, g, fz, 0.007, fh, DARK, 0.6, 6);
    B.box(fx - 0.035, g + fh - 0.002, fz - 0.012, 0.07, 0.022, 0.024, 0x2f3338);
    for (let i = 0; i < (full ? 4 : 2); i++) L.box(fx - 0.03 + i * (full ? 0.019 : 0.04), g + fh + 0.002, fz + 0.011, full ? 0.014 : 0.024, 0.014, 0.004, 0xfff1cc);
    if (full) { B.bar(fx, g + fh * 0.4, fz, fx + 0.03, g + fh * 0.2, fz + 0.02, 0.004, 0x55595f); B.box(fx - 0.014, g, fz - 0.014, 0.028, 0.012, 0.028, 0x6a6f76); }
  }

  // ---------- group 2: headframe + winding house ----------
  B.grp = 2; L.grp = 2;
  const hb = gy(HF.x, HF.z), top = hb + HF_H;
  const lw0 = 0.11, lw1 = 0.034;
  const leg = (i: number, f: number) => { const sxn = i & 1 ? 1 : -1, szn = i & 2 ? 1 : -1, w = lw0 + (lw1 - lw0) * f; return [HF.x + sxn * w, hb + HF_H * f, HF.z + szn * w] as const; };
  for (let i = 0; i < 4; i++) { const a = leg(i, 0), b = leg(i, 1); B.bar(a[0], a[1], a[2], b[0], b[1], b[2], 0.016, 0x3a3d42, [0.75, 1]); }
  const levels = full ? [0, 0.18, 0.36, 0.54, 0.72, 0.9, 1] : [0, 0.4, 0.8, 1];
  levels.forEach((f, li) => {
    for (let i = 0; i < 4; i++) {
      const [a, b] = [[0, 1], [1, 3], [3, 2], [2, 0]][i];
      const A = leg(a, f), Bp = leg(b, f);
      B.bar(A[0], A[1], A[2], Bp[0], Bp[1], Bp[2], 0.008, 0x4a4f56);
      if (li > 0 && (full || a % 2 === 0)) { // X braces on each face between levels
        const A0 = leg(a, levels[li - 1]), B0 = leg(b, levels[li - 1]);
        B.bar(A0[0], A0[1], A0[2], Bp[0], Bp[1], Bp[2], 0.005, 0x6a6f76); B.bar(B0[0], B0[1], B0[2], A[0], A[1], A[2], 0.005, 0x6a6f76);
      }
    }
  });
  // top platform, A-frame for the sheave, rails, mid deck, ladder
  B.box(HF.x - 0.07, top - 0.004, HF.z - 0.07, 0.14, 0.012, 0.14, 0x3a3d42);
  B.box(HF.x - 0.065, top + 0.008, HF.z - 0.012, 0.012, 0.09, 0.024, 0x2f3338); B.box(HF.x + 0.053, top + 0.008, HF.z - 0.012, 0.012, 0.09, 0.024, 0x2f3338);
  B.bar(HF.x - 0.06, top + 0.09, HF.z, HF.x - 0.062, top + 0.008, HF.z - 0.05, 0.007, 0x2f3338); B.bar(HF.x + 0.06, top + 0.09, HF.z, HF.x + 0.062, top + 0.008, HF.z + 0.05, 0.007, 0x2f3338);
  const dk = hb + HF_H * 0.5, dw = lw0 + (lw1 - lw0) * 0.5;
  B.box(HF.x - dw - 0.01, dk, HF.z - dw - 0.01, dw * 2 + 0.02, 0.008, dw * 2 + 0.02, 0x3a3d42);
  if (full) {
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as Array<[number[], number[]]>) {
      B.bar(HF.x + a[0] * (dw + 0.01), dk + 0.03, HF.z + a[1] * (dw + 0.01), HF.x + b[0] * (dw + 0.01), dk + 0.03, HF.z + b[1] * (dw + 0.01), 0.004, YELLOW);
    }
    for (let i = 0; i < 14; i++) B.box(HF.x - 0.012, hb + 0.02 + i * 0.062, HF.z + lw0 * (1 - (0.02 + i * 0.062) / HF_H * 0.7) + 0.012, 0.024, 0.004, 0.008, LIGHT);
  }
  // shaft collar, with a dark mouth, and a stripe of owner colour on every leg
  B.box(HF.x - 0.09, hb, HF.z - 0.09, 0.18, 0.025, 0.18, 0x6a6258, {ao: [0.6, 1]});
  B.box(HF.x - 0.05, hb + 0.024, HF.z - 0.05, 0.1, 0.002, 0.1, 0x0c0c0e);
  for (let i = 0; i < 4; i++) { const a = leg(i, 0.34), b = leg(i, 0.42); L.bar(a[0], a[1], a[2], b[0], b[1], b[2], 0.019, owner, [1, 1]); }
  L.add(G.sph(), HF.x, top + 0.115, HF.z, owner, {sx: 0.03, sy: 0.03, sz: 0.03, ao: [1, 1]});
  B.cyl(HF.x, top + 0.09, HF.z, 0.004, 0.025, 0x2f3338, 1, 5);
  // cables from the wheel to the winding house drum
  const wy = top + 0.005;
  for (const dz of [-0.01, 0.01]) B.tube(HF.x + 0.0, wy + 0.07, HF.z + dz, WIND.x - 0.04, gy(WIND.x, WIND.z) + 0.07, WIND.z - 0.03 + dz, 0.0035, 0x1d1f22, 4, [1, 1]);
  // winding house
  const wgy = gy(WIND.x, WIND.z);
  B.box(WIND.x - 0.08, wgy, WIND.z - 0.06, 0.16, 0.085, 0.12, 0x676c74, {ao: [0.6, 1]});
  B.add(G.box(), WIND.x, wgy + 0.103, WIND.z, 0x3a3d42, {sx: 0.17, sy: 0.01, sz: 0.13, rz: 0.0, rx: 0.13, ao: [0.9, 1]});
  L.box(WIND.x - 0.06, wgy + 0.035, WIND.z + 0.0605, 0.12, 0.028, 0.004, 0xffd27a);
  B.box(WIND.x - 0.02, wgy + 0.085, WIND.z + 0.02, 0.04, 0.03, 0.04, 0x5a5f66);
  if (full) { B.cyl(WIND.x + 0.05, wgy + 0.09, WIND.z - 0.03, 0.008, 0.05, 0x3a3d42, 1, 6); B.add(G.cyl(1, 12), WIND.x - 0.1, wgy + 0.04, WIND.z, 0x5a5f66, {rz: Math.PI / 2, sx: 0.025, sy: 0.04, sz: 0.025}); }

  // wheel (own mesh, turns about x)
  const W = new Builder();
  W.add(full ? G.torus(0.1) : new THREE.TorusGeometry(1, 0.1, 4, 12), 0, 0, 0, 0xc8ccd2, {sx: 0.085, sy: 0.085, sz: 0.085, ry: Math.PI / 2, ao: [1, 1]});
  for (let i = 0; i < (full ? 4 : 3); i++) { const a = (i / (full ? 4 : 3)) * Math.PI; W.bar(0, Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0, -Math.cos(a) * 0.085, -Math.sin(a) * 0.085, 0.009, 0x9aa0a8, [1, 1]); }
  W.add(G.cyl(1, 8), 0, 0, 0, 0xffb347, {rz: Math.PI / 2, sx: 0.02, sy: 0.05, sz: 0.02, ao: [1, 1]});
  if (full) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; W.box(-0.012 + 0, Math.cos(a) * 0.088 - 0.004, Math.sin(a) * 0.088 - 0.004, 0.024, 0.008, 0.008, 0x707580); }

  // ---------- haul truck ----------
  const T = new Builder();
  T.box(-0.026, 0.016, -0.06, 0.052, 0.012, 0.125, 0x2a2d31);
  T.add(G.box(), 0, 0.046, -0.03, YELLOW, {sx: 0.066, sy: 0.03, sz: 0.078, rx: -0.12, ao: [0.7, 1.05]});
  T.box(-0.036, 0.052, -0.07, 0.006, 0.026, 0.085, 0xd8940a); T.box(0.03, 0.052, -0.07, 0.006, 0.026, 0.085, 0xd8940a);
  if (full) T.box(-0.036, 0.056, -0.072, 0.072, 0.02, 0.006, 0xd8940a);
  T.box(-0.03, 0.028, 0.026, 0.06, 0.032, 0.042, YELLOW);
  T.box(-0.033, 0.07, -0.002, 0.066, 0.006, 0.06, 0xc88a0a);
  T.box(-0.022, 0.04, 0.066, 0.044, 0.015, 0.004, 0x1a2430);
  if (full) T.box(-0.025, 0.02, 0.068, 0.05, 0.018, 0.006, 0x3a3d42);
  T.box(-0.036, 0.056, -0.0, 0.072, 0.006, 0.008, owner);
  T.box(-0.029, 0.03, 0.068, 0.012, 0.007, 0.004, 0xfff3d0); T.box(0.017, 0.03, 0.068, 0.012, 0.007, 0.004, 0xfff3d0);
  if (full) { T.box(-0.03, 0.024, -0.062, 0.012, 0.007, 0.004, 0xff3030); T.box(0.018, 0.024, -0.062, 0.012, 0.007, 0.004, 0xff3030); }
  T.box(-0.004, 0.077, 0.02, 0.008, 0.008, 0.008, 0xffa010);
  for (const [wx, wz] of [[-0.036, -0.04], [0.036, -0.04], [-0.036, 0.046], [0.036, 0.046]]) {
    T.add(G.cyl(1, full ? 12 : 6), wx, 0.02, wz, 0x1c1d1f, {rz: Math.PI / 2, sx: 0.02, sy: 0.016, sz: 0.02, ao: [1, 1]});
    if (full) T.add(G.cyl(1, 8), wx + Math.sign(wx) * 0.007, 0.02, wz, 0x9a9fa6, {rz: Math.PI / 2, sx: 0.009, sy: 0.006, sz: 0.009, ao: [1, 1]});
  }
  if (full) { T.cyl(0.02, 0.058, 0.03, 0.004, 0.026, DARK, 1, 5); for (let i = 0; i < 4; i++) T.box(-0.028, 0.03 + i * 0.006, 0.058, 0.004, 0.003, 0.012, LIGHT); }
  // load heap (instanced separately so it can come and go)
  const ld = new THREE.IcosahedronGeometry(1, full ? 1 : 0);
  lump(ld, 12, 0.18, 2, 6);
  ld.scale(0.03, 0.018, 0.036); ld.translate(0, 0.066, -0.03);
  const LD = new Builder(); LD.addRaw(ld.toNonIndexed(), v.pile[0], [0.8, 1.15]);
  const lc = LD.parts[0].attributes.color as THREE.BufferAttribute, cc = new THREE.Color();
  for (let t = 0; t < lc.count / 3; t++) { cc.setHex(v.pile[t % v.pile.length]).multiplyScalar(0.7 + 0.55 * hash(t, 77)); for (let k = 0; k < 3; k++) lc.setXYZ(t * 3 + k, cc.r, cc.g, cc.b); }

  // ---------- excavator (facing +z; tracks, house, boom, stick + bucket) ----------
  const XT = new Builder(), XH = new Builder(), XB = new Builder(), XS = new Builder();
  for (const sd of [-1, 1]) {
    XT.box(sd * 0.034 - 0.011, 0.0, -0.06, 0.022, 0.024, 0.12, 0x24272b);
    XT.add(G.cyl(1, 8), sd * 0.034, 0.012, 0.06, 0x2f3338, {rz: Math.PI / 2, sx: 0.013, sy: 0.022, sz: 0.013, ao: [1, 1]});
    XT.add(G.cyl(1, 8), sd * 0.034, 0.012, -0.06, 0x2f3338, {rz: Math.PI / 2, sx: 0.013, sy: 0.022, sz: 0.013, ao: [1, 1]});
    if (full) for (let i = 0; i < 9; i++) XT.box(sd * 0.034 - 0.0125, 0.0, -0.058 + i * 0.0145, 0.025, 0.0035, 0.007, 0x4a4f56);
  }
  XT.box(-0.03, 0.012, -0.04, 0.06, 0.016, 0.08, 0x3a3d42);
  XH.add(G.cyl(1, 12), 0, 0.03, 0, 0x3a3d42, {sx: 0.04, sy: 0.012, sz: 0.04, ao: [1, 1]});
  XH.box(-0.032, 0.034, -0.06, 0.064, 0.032, 0.1, YELLOW);
  XH.box(-0.03, 0.034, -0.075, 0.06, 0.036, 0.028, 0x4a4f56); // counterweight
  XH.box(-0.032, 0.066, -0.05, 0.064, 0.004, 0.08, 0xc88a0a);
  XH.box(-0.032, 0.05, 0.02, 0.036, 0.034, 0.036, YELLOW); XH.box(-0.028, 0.055, 0.052, 0.028, 0.022, 0.003, 0x1a2430); XH.box(-0.0345, 0.055, 0.03, 0.003, 0.02, 0.022, 0x1a2430);
  XH.box(-0.032, 0.083, 0.02, 0.036, 0.004, 0.036, 0xc88a0a);
  XH.cyl(0.02, 0.07, -0.05, 0.004, 0.025, DARK, 1, 5); XH.box(-0.032, 0.05, 0.0155, 0.064, 0.005, 0.003, owner);
  XB.add(G.box(), 0, 0.01, 0.055, YELLOW, {sx: 0.016, sy: 0.016, sz: 0.12, rx: -0.5, ao: [0.8, 1]});
  XB.add(G.box(), 0, 0.05, 0.095, YELLOW, {sx: 0.016, sy: 0.016, sz: 0.1, rx: 0.05, ao: [0.8, 1]});
  XB.bar(0, 0.0, 0.01, 0.01, 0.075, 0.07, 0.006, LIGHT);
  XS.add(G.box(), 0, -0.012, 0.045, YELLOW, {sx: 0.012, sy: 0.014, sz: 0.1, rx: 0.5, ao: [0.8, 1]});
  XS.box(-0.02, -0.07, 0.08, 0.04, 0.003, 0.04, 0x6a6f76); XS.box(-0.021, -0.07, 0.08, 0.003, 0.03, 0.04, 0x6a6f76); XS.box(0.018, -0.07, 0.08, 0.003, 0.03, 0.04, 0x6a6f76);
  XS.box(-0.02, -0.07, 0.118, 0.04, 0.03, 0.003, 0x6a6f76);
  for (let i = 0; i < 4; i++) XS.box(-0.018 + i * 0.012, -0.07, 0.122, 0.004, 0.012, 0.006, 0xc8ccd2);

  // ---------- hoist cage ----------
  const K = new Builder();
  K.box(-0.026, 0, -0.026, 0.052, 0.003, 0.052, 0x3a3d42);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) K.bar(dx * 0.025, 0.0, dz * 0.025, dx * 0.025, 0.07, dz * 0.025, 0.004, 0xe8a317, [1, 1]);
  K.box(-0.028, 0.068, -0.028, 0.056, 0.004, 0.056, 0xe8a317);
  K.box(-0.02, 0.003, -0.026, 0.04, 0.03, 0.002, 0x2a3036);
  K.add(G.cyl(0.4, 6), 0, 0.075, 0, 0x8a8f96, {sx: 0.014, sy: 0.016, sz: 0.014, ao: [1, 1]});

  let body = B.build();
  const lit = L.build(), wheel = W.build();
  let truck = T.build(), load = LD.build();
  const exTracks = XT.build(), exHouse = XH.build(), exBoom = XB.build(), exStick = XS.build();
  let cage = K.build();
  if (!full) {
    // lite: the excavator stands in one digging pose inside the body mesh; the truck carries its load
    const M0 = new THREE.Matrix4().compose(new THREE.Vector3(EXC.x, EXC.y, EXC.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, EXC.yaw, 0)), new THREE.Vector3(EXC.s, EXC.s, EXC.s));
    const Mh = M0.clone().multiply(new THREE.Matrix4().makeRotationY(1.1));
    const Mb = Mh.clone().multiply(new THREE.Matrix4().makeTranslation(...EXC_BOOM)).multiply(new THREE.Matrix4().makeRotationX(-0.55));
    const Ms = Mb.clone().multiply(new THREE.Matrix4().makeTranslation(...EXC_STICK)).multiply(new THREE.Matrix4().makeRotationX(0.5));
    const at = (g: THREE.BufferGeometry, m: THREE.Matrix4) => g.clone().applyMatrix4(m);
    const merged = mergeGeometries([body, at(exTracks, M0), at(exHouse, Mh), at(exBoom, Mb), at(exStick, Ms)], false);
    body.dispose(); body = merged;
    const t2 = mergeGeometries([truck, load], false); truck.dispose(); truck = t2;
    cage.dispose(); cage = new THREE.BufferGeometry();
  }
  const tris = triCount(body) + triCount(lit) + triCount(wheel) + triCount(truck) * 3 + (full ? triCount(load) * 3 + triCount(exTracks) + triCount(exHouse) + triCount(exBoom) + triCount(exStick) + triCount(cage) : 0);
  void rights; void H0;
  return {body, lit, wheel, truck, load, exTracks, exHouse, exBoom, exStick, cage, tris};
}

function hexN(x: number, z: number) { return Math.max(Math.abs(x) / 0.866, 0.577 * Math.abs(x) + Math.abs(z)); }
