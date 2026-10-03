// The Detailed Commercial District's built parts. Unit space: hex circumradius 1, y = 0 on the prism top.
// Build groups (rise): 0..7 the towers, 8 plaza and fountain, 9 shop arcade, 10 trees, benches and lamps.
import * as THREE from 'three';
import {Builder, G, hash, triCount} from '../MineKit';
import {WINK} from './CommercialTex';

export type Tower = {x: number; z: number; w: number; d: number; h: number; tint: number; kind: 'twin' | 'stepped' | 'cyl' | 'slant' | 'oct' | 'terrace' | 'obelisk'};
export const TOWERS: Tower[] = [
  {x: -0.52, z: -0.4, w: 0.24, d: 0.24, h: 1.42, tint: 0x6a88c8, kind: 'twin'},
  {x: -0.1, z: -0.62, w: 0.24, d: 0.2, h: 1.18, tint: 0x8a6ad0, kind: 'stepped'},
  {x: 0.34, z: -0.5, w: 0.26, d: 0.26, h: 1.3, tint: 0x4aa8ba, kind: 'cyl'},
  {x: 0.64, z: -0.1, w: 0.2, d: 0.2, h: 0.95, tint: 0xb06ac0, kind: 'slant'},
  {x: -0.68, z: 0.0, w: 0.2, d: 0.2, h: 0.85, tint: 0x4ab09a, kind: 'oct'},
  {x: 0.6, z: 0.34, w: 0.18, d: 0.18, h: 0.6, tint: 0x6a8ad8, kind: 'terrace'},
  {x: -0.56, z: 0.38, w: 0.18, d: 0.18, h: 0.52, tint: 0xb0906a, kind: 'terrace'},
  {x: 0.02, z: -0.2, w: 0.15, d: 0.15, h: 0.8, tint: 0x6ab0d8, kind: 'obelisk'},
];
export const NEON = [0xff3aa8, 0x31e8ff, 0xffd23a, 0x7a5cff, 0x4aff9a, 0xff7a3a, 0x31e8ff, 0xff3aa8];
export const PLAZA = {x: 0.02, z: 0.24};
export const SL = 0.022;
export const HOLOS: Array<{x: number; y: number; z: number; w: number; h: number; yaw: number; col: number}> = [
  {x: 0.02, y: 0.64, z: 0.36, w: 0.32, h: 0.19, yaw: 0, col: 0x6ae8ff},
  {x: -0.4, y: 0.42, z: 0.22, w: 0.2, h: 0.13, yaw: 0.6, col: 0xff8ad8},
  {x: 0.46, y: 0.46, z: 0.16, w: 0.2, h: 0.13, yaw: -0.6, col: 0xffe07a},
  {x: 0.02, y: 1.0, z: -0.32, w: 0.26, h: 0.16, yaw: 0, col: 0x9a8aff},
  {x: -0.26, y: 0.76, z: -0.04, w: 0.2, h: 0.12, yaw: 0.35, col: 0x4aff9a},
  {x: 0.3, y: 0.82, z: -0.16, w: 0.2, h: 0.12, yaw: -0.4, col: 0xff7a3a},
];
export const GLOBE = {x: PLAZA.x, y: 0.34, z: PLAZA.z, r: 0.075};
export const BRIDGES: Array<[number, number, number]> = [[0, 1, 0.62], [1, 2, 0.5], [2, 3, 0.4], [0, 4, 0.34], [7, 3, 0.3]];
export const BEACONS: Array<{tower: number; x: number; y: number; z: number; c: number}> = [];
export const N_TAXI = 3, N_DRONE = 8, N_POD = 5;

export type ComGeo = {
  body: THREE.BufferGeometry; towers: THREE.BufferGeometry; lit: THREE.BufferGeometry; signs: THREE.BufferGeometry; water: THREE.BufferGeometry; globe: THREE.BufferGeometry;
  taxi: THREE.BufferGeometry; drone: THREE.BufferGeometry; pod: THREE.BufferGeometry; tris: number;
};

/** a windowed glass cylinder / taper / prism with UVs scaled to the facade tile */
function glassCyl(rb: number, rt: number, h: number, seg: number, thetaStart = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, true, thetaStart).toNonIndexed();
  const uv = g.attributes.uv as THREE.BufferAttribute, circ = Math.PI * 2 * Math.max(rb, rt) * WINK;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h * WINK);
  return g;
}

export function buildCommercial(owner: number, full: boolean): ComGeo {
  const B = new Builder(), T = new Builder(), L = new Builder();
  const STEEL = 0x3a3f50;
  const cs = full ? 14 : 8;
  const tor = (tube: number) => (full ? G.torus(tube) : new THREE.TorusGeometry(1, tube, 3, 12));
  const bea = (tw: number, x: number, y: number, z: number, c: number) => { BEACONS.push({tower: tw, x, y, z, c}); L.add(G.sph(), x, y, z, c, {sx: 0.014, sy: 0.014, sz: 0.014, ao: [1, 1]}); };
  BEACONS.length = 0;
  const glass = (x: number, y: number, z: number, w: number, h: number, d: number, tint: number) => T.box(x, y, z, w, h, d, tint, {win: WINK, ao: [0.65, 1.08]});
  const glassGeo = (g: THREE.BufferGeometry, x: number, y: number, z: number, tint: number) => { g.translate(x, y, z); T.addRaw(g, tint, [0.65, 1.08]); };

  // ---------- base slab, streets, podium plazas ----------
  B.grp = L.grp = 8;
  B.add(G.cyl(1, 6), 0, SL / 2, 0, 0x2c3048, {sx: 0.97, sy: SL, sz: 0.97, ao: [1, 1]});
  B.add(G.cyl(1, 6), 0, SL + 0.002, 0, 0x383d5c, {sx: 0.92, sy: 0.004, sz: 0.92, ao: [1, 1]});
  if (full) {
    for (let i = 0; i < 12; i++) L.box(-0.55 + i * 0.1, SL + 0.005, 0.02, 0.05, 0.002, 0.006, i % 2 ? 0xffd23a : 0x31e8ff);
    for (let i = 0; i < 8; i++) L.box(-0.0, SL + 0.005, -0.48 + i * 0.09, 0.006, 0.002, 0.045, i % 2 ? 0xff3aa8 : 0x7a5cff);
  }
  // plaza: a lit hex floor with concentric rings and a star inlay
  const px = PLAZA.x, pz = PLAZA.z;
  B.add(G.cyl(1, 6), px, SL + 0.007, pz, 0x2a2e48, {sx: 0.4, sy: 0.012, sz: 0.4, ao: [1, 1]});
  for (const [r, c] of [[0.35, owner], [0.27, 0x31e8ff], [0.2, 0xff3aa8]] as const) L.add(tor(0.03), px, SL + 0.016, pz, c, {sx: r, sy: r, sz: 0.3, rx: Math.PI / 2, ao: [1, 1]});
  if (full) for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.283; L.box(px + Math.cos(a) * 0.27 - 0.003, SL + 0.014, pz + Math.sin(a) * 0.27 - 0.003, 0.006, 0.002, 0.06, k % 2 ? 0xffd23a : 0x7a5cff, {ry: -a + Math.PI / 2}); }
  // fountain: basin, tiers, spire
  B.cyl(px, SL + 0.012, pz, 0.125, 0.026, 0x8a92b0, 1, full ? 24 : 12, {ao: [0.7, 1.1]});
  B.cyl(px, SL + 0.028, pz, 0.108, 0.01, 0x1a2036, 1, full ? 24 : 12, {ao: [1, 1]});
  L.add(tor(0.06), px, SL + 0.04, pz, 0x31e8ff, {sx: 0.118, sy: 0.118, sz: 0.118, rx: Math.PI / 2, ao: [1, 1]});
  B.cyl(px, SL + 0.036, pz, 0.014, 0.1, 0xb8c0d8, 0.6, 10);
  B.cyl(px, SL + 0.075, pz, 0.05, 0.012, 0xb8c0d8, 0.8, full ? 16 : 10);
  B.cyl(px, SL + 0.12, pz, 0.036, 0.01, 0xb8c0d8, 0.8, full ? 14 : 8);
  B.cyl(px, SL + 0.13, pz, 0.006, 0.07, 0xb8c0d8, 0.3, 6);
  L.add(G.sph(), px, SL + 0.2, pz, 0xbfefff, {sx: 0.012, sy: 0.012, sz: 0.012, ao: [1, 1]});
  // water surface (its own shader mesh)
  const W = new THREE.CylinderGeometry(0.108, 0.108, 0.002, full ? 28 : 12).toNonIndexed(); W.translate(0, SL + 0.038, 0);
  const water = W;

  // ---------- group 10: lamps, benches, trees, kiosks ----------
  B.grp = L.grp = 10;
  const lampN = full ? 8 : 4;
  for (let i = 0; i < lampN; i++) {
    const a = (i / lampN) * 6.283 + 0.4, x = px + Math.cos(a) * 0.34, z = pz + Math.sin(a) * 0.34;
    B.cyl(x, SL, z, 0.004, 0.09, 0x20243a, 0.6, 5); L.add(G.sph(), x, SL + 0.1, z, i % 2 ? 0xff9ad8 : 0x9affea, {sx: 0.012, sy: 0.012, sz: 0.012, ao: [1, 1]});
  }
  if (full) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283 + 0.1, x = px + Math.cos(a) * 0.3, z = pz + Math.sin(a) * 0.3;
      B.box(x - 0.025, SL, z - 0.008, 0.05, 0.012, 0.016, 0x4a4f6a, {ry: -a + Math.PI / 2});
      L.box(x - 0.024, SL + 0.012, z - 0.008, 0.048, 0.002, 0.004, owner, {ry: -a + Math.PI / 2});
    }
    // neon trees in planters
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283 + 0.5, x = px + Math.cos(a) * 0.4, z = pz + Math.sin(a) * 0.4 * 0.95;
      if (Math.abs(x) > 0.62 || z > 0.55) continue;
      B.cyl(x, SL, z, 0.02, 0.016, 0x4a4f6a, 1, 8); B.cyl(x, SL + 0.016, z, 0.004, 0.05, 0x3a2e28, 0.6, 5);
      L.add(G.ico(), x, SL + 0.082, z, i % 2 ? 0x9a6aff : 0x4affc8, {sx: 0.026, sy: 0.024, sz: 0.026, rx: i, ao: [0.7, 1.1]});
    }
    // kiosks with domes
    for (const [x, z, c] of [[-0.3, 0.1, 0xff7a3a], [0.34, 0.08, 0x31e8ff], [0.0, 0.52, 0xff3aa8]] as Array<[number, number, number]>) {
      B.cyl(x, SL, z, 0.04, 0.035, 0x4a4f6a, 1, 10); B.add(G.sph(), x, SL + 0.035, z, 0xb8c0d8, {sx: 0.042, sy: 0.022, sz: 0.042});
      L.cyl(x, SL + 0.03, z, 0.042, 0.006, c, 1, 10);
    }
  }

  // ---------- groups 9: shop arcade along the front ----------
  B.grp = L.grp = 9;
  const SH = [0xd8588a, 0x58b8d8, 0xe8b048, 0x8a68d8, 0x58d8a0];
  const nSh = full ? 5 : 4;
  for (let i = 0; i < nSh; i++) {
    const x = (full ? -0.46 : -0.4) + i * (full ? 0.23 : 0.27), z = 0.62 - Math.abs(x) * 0.12;
    B.box(x - 0.1, SL, z - 0.05, 0.2, 0.09 + (i % 2) * 0.03, 0.1, 0x4a5070, {ao: [0.6, 1.05]});
    B.add(G.box(), x, SL + 0.075 + (i % 2) * 0.03, z + 0.062, SH[i], {sx: 0.2, sy: 0.008, sz: 0.045, rx: 0.5, ao: [0.8, 1.1]});
    L.box(x - 0.085, SL + 0.016, z + 0.0505, 0.17, 0.04, 0.004, i % 2 ? 0xfff0c0 : 0xffd9a0);
    L.box(x - 0.09, SL + 0.075 + (i % 2) * 0.03, z + 0.052, 0.18, 0.006, 0.004, NEON[(i + 2) % NEON.length]);
    if (full) {
      for (let k = 0; k < 3; k++) B.box(x - 0.085 + k * 0.058, SL, z + 0.052, 0.006, 0.056, 0.006, 0x20243a);
      B.cyl(x - 0.1, SL, z + 0.08, 0.004, 0.08, 0xb8c0d8, 1, 5); B.cyl(x + 0.1, SL, z + 0.08, 0.004, 0.08, 0xb8c0d8, 1, 5);
      B.box(x - 0.1, SL + 0.09, z - 0.05, 0.2, 0.01, 0.13, 0x2f3348);
      L.box(x - 0.1, SL + 0.098, z + 0.078, 0.2, 0.004, 0.004, SH[i]);
    }
  }
  // side pavilions
  if (full) for (const [x, z, c] of [[-0.62, 0.3, 0x58b8d8], [0.64, 0.2, 0xe8b048]] as Array<[number, number, number]>) { B.cyl(x, SL, z, 0.07, 0.05, 0x4a5070, 1, 12); B.add(G.sph(), x, SL + 0.05, z, 0x9aa4c4, {sx: 0.07, sy: 0.04, sz: 0.07}); L.cyl(x, SL + 0.044, z, 0.072, 0.008, c, 1, 12); L.box(x - 0.03, SL + 0.016, z + 0.068, 0.06, 0.022, 0.004, 0xfff0c0); }

  // ---------- towers (groups 0..7) ----------
  TOWERS.forEach((t, i) => {
    B.grp = T.grp = L.grp = i;
    const neon = i % 3 === 0 ? owner : NEON[i % NEON.length], neon2 = NEON[(i + 3) % NEON.length];
    // podium
    B.box(t.x - t.w * 0.7, SL, t.z - t.d * 0.7, t.w * 1.4, 0.045, t.d * 1.4, 0x3a4060, {ao: [0.7, 1.05]});
    L.box(t.x - t.w * 0.7 - 0.003, SL + 0.04, t.z - t.d * 0.7 - 0.003, t.w * 1.4 + 0.006, 0.006, t.d * 1.4 + 0.006, neon2, {ao: [1, 1]});
    const y0 = SL + 0.045;
    const corners = (w: number, d: number, h: number, base: number, c: number) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (full || (sx > 0) === (sz > 0)) L.box(t.x + sx * (w / 2) - 0.004, base, t.z + sz * (d / 2) - 0.004, 0.008, h, 0.008, c, {ao: [1, 1]}); };
    const ring = (w: number, d: number, y: number, c: number) => { L.box(t.x - w / 2 - 0.004, y, t.z - d / 2 - 0.004, w + 0.008, 0.007, d + 0.008, c, {ao: [1, 1]}); };
    if (t.kind === 'twin') {
      glass(t.x - t.w / 2, y0, t.z - t.d / 2, t.w, t.h * 0.82, t.d, t.tint);
      ring(t.w, t.d, y0 + t.h * 0.82, neon);
      for (const dx of [-1, 1]) { glass(t.x + dx * 0.045 - 0.04, y0 + t.h * 0.82, t.z - 0.07, 0.08, t.h * 0.18, 0.14, t.tint); B.cyl(t.x + dx * 0.045, y0 + t.h, t.z, 0.006, 0.2, 0xb8c0d8, 0.3, 6); bea(i, t.x + dx * 0.045, y0 + t.h + 0.2, t.z, dx > 0 ? owner : 0xff3030); }
      corners(t.w, t.d, t.h * 0.82, y0, neon);
      if (full) for (let k = 1; k < 5; k++) ring(t.w, t.d, y0 + t.h * 0.16 * k, k % 2 ? neon2 : neon);
    } else if (t.kind === 'stepped') {
      const tiers = [[1, 0.52], [0.78, 0.26], [0.56, 0.22]];
      let y = y0;
      tiers.forEach(([s, f], k) => {
        const w = t.w * s, d = t.d * s, h = t.h * f;
        glass(t.x - w / 2, y, t.z - d / 2, w, h, d, t.tint);
        corners(w, d, h, y, k % 2 ? neon2 : neon);
        ring(w, d, y + h - 0.004, neon);
        B.box(t.x - w / 2 - 0.006, y + h, t.z - d / 2 - 0.006, w + 0.012, 0.008, d + 0.012, STEEL);
        y += h;
      });
      B.cyl(t.x, y, t.z, 0.006, 0.16, 0xb8c0d8, 0.3, 6); bea(i, t.x, y + 0.16, t.z, owner);
    } else if (t.kind === 'cyl') {
      const r = t.w / 2;
      glassGeo(glassCyl(r, r * 0.94, t.h, cs, 0), t.x, y0 + t.h / 2, t.z, t.tint);
      const nb = full ? 6 : 3;
      for (let k = 1; k <= nb; k++) L.add(tor(0.025), t.x, y0 + (t.h * k) / (nb + 1), t.z, k % 2 ? neon : neon2, {sx: r * (1 - 0.06 * k / nb), sy: r * (1 - 0.06 * k / nb), sz: 0.3, rx: Math.PI / 2, ao: [1, 1]});
      B.cyl(t.x, y0 + t.h, t.z, r * 0.96, 0.02, STEEL, 1, cs); L.cyl(t.x, y0 + t.h + 0.02, t.z, r * 0.9, 0.006, neon, 1, cs);
      B.cyl(t.x, y0 + t.h + 0.02, t.z, 0.008, 0.2, 0xb8c0d8, 0.3, 6); bea(i, t.x, y0 + t.h + 0.22, t.z, owner);
      if (full) { // helipad ring
        L.add(tor(0.04), t.x, y0 + t.h + 0.03, t.z, 0xffffff, {sx: r * 0.6, sy: r * 0.6, sz: 0.2, rx: Math.PI / 2, ao: [1, 1]});
        for (const dx of [-0.02, 0.02]) L.box(t.x + dx - 0.003, y0 + t.h + 0.03, t.z - 0.025, 0.006, 0.002, 0.05, 0xffffff);
        L.box(t.x - 0.02, y0 + t.h + 0.03, t.z - 0.003, 0.04, 0.002, 0.006, 0xffffff);
      }
    } else if (t.kind === 'slant') {
      glass(t.x - t.w / 2, y0, t.z - t.d / 2, t.w, t.h * 0.86, t.d, t.tint);
      T.add(G.box(), t.x, y0 + t.h * 0.86 + 0.05, t.z, t.tint, {sx: t.w, sy: 0.02, sz: t.d * 1.06, rx: 0.5, ao: [0.9, 1.1]});
      B.box(t.x - t.w / 2, y0 + t.h * 0.86, t.z - t.d / 2, t.w, 0.006, t.d, STEEL);
      corners(t.w, t.d, t.h * 0.86, y0, neon);
      ring(t.w, t.d, y0 + t.h * 0.86 - 0.004, neon2);
      bea(i, t.x, y0 + t.h * 0.86 + 0.12, t.z, owner);
      if (full) for (let k = 1; k < 4; k++) ring(t.w, t.d, y0 + t.h * 0.2 * k, k % 2 ? neon : neon2);
    } else if (t.kind === 'oct') {
      const r = t.w / 2;
      glassGeo(glassCyl(r, r, t.h, 8, Math.PI / 8), t.x, y0 + t.h / 2, t.z, t.tint);
      B.cyl(t.x, y0 + t.h, t.z, r * 1.06, 0.02, STEEL, 1, 8); L.add(tor(0.04), t.x, y0 + t.h + 0.02, t.z, neon, {sx: r * 1.02, sy: r * 1.02, sz: 0.3, rx: Math.PI / 2, ao: [1, 1]});
      for (let k = 0; k < 8; k++) if (full || k % 2 === 0) { const a = (k + 0.5) * Math.PI / 4 + Math.PI / 8 - Math.PI / 8; L.box(t.x + Math.cos(a) * r * 1.03 - 0.004, y0, t.z + Math.sin(a) * r * 1.03 - 0.004, 0.008, t.h, 0.008, k % 2 ? neon2 : neon, {ao: [1, 1]}); }
      B.add(G.cone(8), t.x, y0 + t.h + 0.09, t.z, 0xb8c0d8, {sx: r * 0.5, sy: 0.14, sz: r * 0.5}); bea(i, t.x, y0 + t.h + 0.17, t.z, owner);
    } else if (t.kind === 'terrace') {
      let y = y0;
      const steps = [[1, 0.4, 0, 0], [0.84, 0.32, 0.03, 0.02], [0.66, 0.28, -0.02, 0.03]];
      steps.forEach(([s, f, ox, oz], k) => {
        const w = t.w * s, d = t.d * s, h = t.h * f;
        glass(t.x + ox - w / 2, y, t.z + oz - d / 2, w, h, d, t.tint);
        B.box(t.x + ox - w / 2 - 0.006, y + h, t.z + oz - d / 2 - 0.006, w + 0.012, 0.007, d + 0.012, 0x3a4060);
        L.box(t.x + ox - w / 2 - 0.006, y + h - 0.003, t.z + oz - d / 2 - 0.006, w + 0.012, 0.005, d + 0.012, k % 2 ? neon2 : neon, {ao: [1, 1]});
        if (full) { B.add(G.ico(), t.x + ox + w * 0.25, y + h + 0.012, t.z + oz + d * 0.25, 0x2a6a4a, {sx: 0.02, sy: 0.012, sz: 0.02}); L.add(G.ico(), t.x + ox - w * 0.2, y + h + 0.012, t.z + oz - d * 0.1, 0x6aff9a, {sx: 0.012, sy: 0.01, sz: 0.012, ao: [0.8, 1.1]}); }
        y += h;
      });
      B.cyl(t.x, y, t.z, 0.005, 0.1, 0xb8c0d8, 0.3, 5); bea(i, t.x, y + 0.1, t.z, owner);
    } else { // obelisk: a tapering square tower
      glassGeo(glassCyl(t.w * 0.72, t.w * 0.36, t.h, 4, Math.PI / 4), t.x, y0 + t.h / 2, t.z, t.tint);
      B.add(G.cone(4), t.x, y0 + t.h + 0.045, t.z, 0xb8c0d8, {sx: t.w * 0.28, sy: 0.09, sz: t.w * 0.28, ry: Math.PI / 4});
      L.add(tor(0.05), t.x, y0 + t.h * 0.5, t.z, neon, {sx: t.w * 0.5, sy: t.w * 0.5, sz: 0.3, rx: Math.PI / 2, ry: 0, ao: [1, 1]});
      bea(i, t.x, y0 + t.h + 0.11, t.z, owner);
      if (full) L.add(tor(0.05), t.x, y0 + t.h * 0.78, t.z, neon2, {sx: t.w * 0.4, sy: t.w * 0.4, sz: 0.3, rx: Math.PI / 2, ao: [1, 1]});
    }
  });

  // ---------- sky-bridges (join the group of the later tower) ----------
  const bridge = (a: number, bI: number, y: number) => {
    const ta = TOWERS[a], tb = TOWERS[bI];
    B.grp = L.grp = Math.max(a, bI);
    B.tube(ta.x, y, ta.z, tb.x, y, tb.z, 0.026, 0x8aa0c8, full ? 8 : 6, [0.8, 1]);
    L.tube(ta.x, y + 0.012, ta.z + 0.012, tb.x, y + 0.012, tb.z + 0.012, 0.006, 0x31e8ff, 4, [1, 1]);
    if (full) {
      L.tube(ta.x, y - 0.012, ta.z - 0.012, tb.x, y - 0.012, tb.z - 0.012, 0.005, 0xff3aa8, 4, [1, 1]);
      for (const e of [ta, tb]) { const dx = tb.x - ta.x, dz = tb.z - ta.z, ln = Math.hypot(dx, dz); B.add(tor(0.2), e.x + (e === ta ? dx / ln : -dx / ln) * e.w * 0.52, y, e.z + (e === ta ? dz / ln : -dz / ln) * e.d * 0.52, 0x2f3348, {sx: 0.03, sy: 0.03, sz: 0.03, ry: Math.atan2(dx, dz) + Math.PI / 2 * 0, ao: [1, 1]}); }
    }
  };
  for (const [a, b, y] of BRIDGES) bridge(a, b, y);

  // ---------- holographic signs: neon strips on the towers (grp i), hologram panels (grp 8..13) ----------
  const pos: number[] = [], uv: number[] = [], col: number[] = [], grp: number[] = [], idx: number[] = [];
  const quad = (cx: number, cy: number, cz: number, w: number, h: number, yaw: number, row: number, color: number, u0: number, uw: number, g: number) => {
    const base = pos.length / 3, c = new THREE.Color(color), cs2 = Math.cos(yaw), sn = Math.sin(yaw);
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      pos.push(cx + u * w * cs2, cy + v * h, cz - u * w * sn);
      uv.push(u0 + (u + 0.5) * uw, (7 - row + v + 0.5) / 8); col.push(c.r, c.g, c.b); grp.push(g);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  TOWERS.forEach((t, i) => {
    const wd = t.kind === 'cyl' || t.kind === 'oct' ? t.w * 0.66 : t.w * 0.92, off = t.kind === 'cyl' || t.kind === 'oct' ? t.w * 0.5 + 0.006 : t.d / 2 + 0.006;
    quad(t.x, t.h * (0.5 + 0.1 * hash(i, 1)), t.z + off, wd, wd / 4, 0, i % 4, NEON[i % NEON.length], i % 2 ? 0.5 : 0, 0.5, i);
    if (full && t.h > 0.8) quad(t.x - off, t.h * (0.25 + 0.1 * hash(i, 2)), t.z, wd * 0.9, wd * 0.9 / 4, Math.PI / 2, (i + 1) % 4, NEON[(i + 2) % NEON.length], i % 2 ? 0 : 0.5, 0.5, i);
  });
  HOLOS.forEach((h, i) => quad(h.x, h.y, h.z, h.w, h.h, h.yaw, 4 + (i % 4), h.col, 0, 0.25, 8 + i));
  const signs = new THREE.BufferGeometry();
  signs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); signs.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  signs.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); signs.setAttribute('aGrp', new THREE.Float32BufferAttribute(grp, 1));
  signs.setIndex(idx);
  const globe = new THREE.SphereGeometry(GLOBE.r, full ? 24 : 12, full ? 14 : 8);

  // ---------- vehicles ----------
  const Tx = new Builder();
  Tx.add((full ? G.sph() : G.ico()), 0, 0.012, 0, 0xdfe6f4, {sx: 0.02, sy: 0.011, sz: 0.045, ao: [0.8, 1.1]});
  Tx.box(-0.045, 0.008, -0.004, 0.09, 0.003, 0.016, 0xb8c0d8); Tx.add((full ? G.sph() : G.ico()), 0, 0.02, 0.012, 0x20304a, {sx: 0.013, sy: 0.008, sz: 0.02});
  Tx.box(-0.004, 0.012, -0.05, 0.008, 0.02, 0.016, 0x8a92b0);
  Tx.add(G.cyl(1, full ? 8 : 5), -0.045, 0.012, -0.004, 0x31e8ff, {sx: 0.008, sy: 0.003, sz: 0.008, ao: [1, 1]}); Tx.add(G.cyl(1, full ? 8 : 5), 0.045, 0.012, -0.004, 0x31e8ff, {sx: 0.008, sy: 0.003, sz: 0.008, ao: [1, 1]});
  Tx.box(-0.006, 0.0, 0.02, 0.012, 0.004, 0.02, 0xff3aa8);
  const Dr = new Builder();
  Dr.box(-0.014, 0.0, -0.014, 0.028, 0.01, 0.028, 0x30343e);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { Dr.bar(0, 0.006, 0, dx * 0.026, 0.01, dz * 0.026, 0.004, 0x20232a); Dr.cyl(dx * 0.026, 0.01, dz * 0.026, 0.012, 0.003, 0xa8b0c0, 1, 8); }
  Dr.box(-0.008, -0.008, -0.008, 0.016, 0.008, 0.016, 0x20232a);
  const Pd = new Builder();
  Pd.box(-0.012, 0, -0.018, 0.024, 0.016, 0.036, 0xdfe6f4, {ao: [0.8, 1.1]}); Pd.box(-0.0125, 0.005, -0.014, 0.025, 0.007, 0.028, 0x20304a); Pd.box(-0.004, 0.016, -0.004, 0.008, 0.006, 0.008, 0x8a92b0);

  if (!full) L.grp = 8, L.cyl(px, SL + 0.038, pz, 0.105, 0.002, 0x2a8aaa, 1, 12);
  const body = B.build(), towers = T.build(), lit = L.build(), taxi = Tx.build(), drone = Dr.build(), pod = Pd.build();
  const tc = (g: THREE.BufferGeometry) => (g.attributes.position ? triCount(g) : 0);
  const sg = signs.index ? signs.index.count / 3 : 0;
  const tris = tc(body) + tc(towers) + tc(lit) + sg + (full ? tc(water) + tc(globe) + tc(taxi) * N_TAXI + tc(drone) * N_DRONE + tc(pod) * N_POD : tc(taxi) * (N_TAXI + 3));
  return {body, towers, lit, signs, water, globe, taxi, drone, pod, tris};
}
