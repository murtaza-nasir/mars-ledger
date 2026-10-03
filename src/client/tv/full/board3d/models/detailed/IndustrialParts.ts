// The Detailed Industrial Center's built parts. Unit space: hex circumradius 1, y = 0 on the prism top.
// Build groups (rise): 0 ground and yard, 1..3 stacks, 4 smelter hall and furnaces, 5 tanks and cooling tower, 6 rail yard and cranes.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Builder, G, hash, triCount} from '../MineKit';

export const SL = 0.024;
export const STACKS: Array<{x: number; z: number; h: number; r0: number; r1: number}> = [
  {x: -0.48, z: -0.56, h: 1.3, r0: 0.078, r1: 0.05},
  {x: -0.2, z: -0.67, h: 1.1, r0: 0.07, r1: 0.046},
  {x: 0.08, z: -0.7, h: 0.95, r0: 0.066, r1: 0.044},
];
export const HALL = {x0: -0.4, x1: 0.24, z0: -0.44, z1: -0.18, h: 0.16};
export const BF = [{x: -0.63, z: -0.3, h: 0.55, r: 0.1}, {x: -0.63, z: -0.07, h: 0.45, r: 0.085}];
export const COOL = {x: 0.52, z: -0.4, h: 0.52};
export const CTRL = {x: 0.0, z: 0.0};
export const BED = {x0: -0.62, x1: -0.24, z: 0.25};
export const LADLE_RAIL = {z0: 0.13, z1: 0.37};
export const RAIL_Z = 0.58;
export const RAIL_X = 0.56;
export const CRANE = {x: 0.3, z0: 0.45, z1: 0.72, h: 0.3};
export const FANS: Array<[number, number, number]> = [[-0.3, 0.19, -0.32], [-0.12, 0.19, -0.36], [0.06, 0.19, -0.3], [-0.58, 0.58, -0.2]];
export const LAMPS: Array<[number, number]> = [[-0.72, 0.4], [-0.3, 0.6], [0.2, 0.38], [0.66, 0.3], [0.7, -0.15], [-0.7, -0.5], [0.3, -0.1]];
export const OWNER_GLOW: Array<[number, number, number]> = [[-0.08, 0.2, -0.17], [0.52, 0.34, -0.2]];

export type IndGeo = {
  body: THREE.BufferGeometry; halls: THREE.BufferGeometry; lit: THREE.BufferGeometry; molten: THREE.BufferGeometry;
  portal: THREE.BufferGeometry; ladle: THREE.BufferGeometry; trolley: THREE.BufferGeometry; container: THREE.BufferGeometry;
  train: THREE.BufferGeometry; fan: THREE.BufferGeometry; tris: number;
};

const STEEL = 0x4a4f56, DARK = 0x2c2f34, LIGHT = 0x8a8f96, YELLOW = 0xe8a317, RUST = 0xa0482a, CONC = 0x8d8a84;

export function buildIndustrial(owner: number, full: boolean): IndGeo {
  const B = new Builder(), H = new Builder(), L = new Builder(), M = new Builder();
  const cs = full ? 12 : 6, scs = full ? 12 : 8;

  // ---------- group 0: ground, yard, rails ----------
  B.grp = H.grp = L.grp = M.grp = 0;
  B.add(G.cyl(1, 6), 0, SL / 2, 0, 0x6e6a64, {sx: 0.97, sy: SL, sz: 0.97, ao: [1, 1]});
  B.add(G.cyl(1, 6), 0, SL + 0.002, 0, 0x7d7a74, {sx: 0.9, sy: 0.004, sz: 0.9, ao: [1, 1]});
  if (full) {
    // concrete plates, painted lanes and drains
    for (let i = 0; i < 9; i++) { const x = -0.55 + (i % 3) * 0.55, z = -0.5 + Math.floor(i / 3) * 0.5; B.box(x - 0.2, SL + 0.003, z - 0.2, 0.4, 0.002, 0.4, i % 2 ? 0x84817a : 0x77746e, {ao: [1, 1]}); }
    for (let i = 0; i < 18; i++) L.box(-0.62 + i * 0.07, SL + 0.005, 0.02, 0.035, 0.002, 0.008, 0xd8b640);
    for (let i = 0; i < 10; i++) B.box(0.52, SL + 0.004, -0.1 + i * 0.07, 0.008, 0.002, 0.035, 0xe0e0e0);
    for (let i = 0; i < 6; i++) B.box(-0.1 + i * 0.1, SL + 0.004, 0.42, 0.04, 0.003, 0.012, 0x2a2d31);
  }
  // rail spur with sleepers, two rails, bumpers, a siding
  const nTies = full ? 36 : 12;
  for (let i = 0; i < nTies; i++) B.box(-RAIL_X + i * (2 * RAIL_X / (nTies - 1)) - 0.01, SL, RAIL_Z - 0.05, 0.02, 0.008, 0.1, 0x4a3a2a);
  for (const dz of [-0.03, 0.03]) B.box(-RAIL_X, SL + 0.008, RAIL_Z + dz - 0.005, 2 * RAIL_X, 0.008, 0.01, 0x9a9fa8);
  for (const sx of [-1, 1]) { B.box(sx * RAIL_X - 0.015, SL, RAIL_Z - 0.045, 0.03, 0.03, 0.09, RUST); L.box(sx * RAIL_X - 0.012, SL + 0.03, RAIL_Z - 0.04, 0.024, 0.006, 0.08, 0xff3030); }
  if (full) {
    for (let i = 0; i < 10; i++) B.box(-0.55 + i * 0.045, SL, 0.42 - 0.0, 0.015, 0.006, 0.07, 0x4a3a2a, {ry: 0});
    B.box(-0.58, SL + 0.006, 0.43, 0.46, 0.006, 0.008, 0x9a9fa8); B.box(-0.58, SL + 0.006, 0.47, 0.46, 0.006, 0.008, 0x9a9fa8);
  }
  // lamp posts
  for (const [x, z] of (full ? LAMPS : LAMPS.slice(0, 5))) { B.cyl(x, SL, z, 0.005, 0.2, DARK, 0.7, 5); B.box(x - 0.025, SL + 0.195, z - 0.01, 0.05, 0.01, 0.02, 0x2f3338); L.box(x - 0.022, SL + 0.193, z + 0.008, 0.044, 0.006, 0.004, 0xffe2a0); }
  // drums, pallets, crates
  const clutter: Array<[number, number, number]> = [[-0.08, 0.5, RUST], [-0.04, 0.52, 0x4a7aa0], [0.0, 0.5, RUST], [0.02, 0.54, 0xb8863a], [-0.12, 0.54, 0x4a7aa0], [0.62, 0.35, RUST], [0.66, 0.4, 0x4a7aa0], [-0.45, 0.04, 0xb8863a], [-0.4, 0.07, RUST]];
  for (const [x, z, c] of clutter.slice(0, full ? 9 : 4)) B.cyl(x, SL, z, 0.016, 0.036, c, 1, 8);
  if (full) {
    for (let i = 0; i < 6; i++) B.box(0.38 + (i % 3) * 0.06, SL, 0.3 + Math.floor(i / 3) * 0.05, 0.05, 0.035 + (i % 2) * 0.02, 0.04, i % 2 ? 0xb8863a : 0x4a6a8a);
    // ingot stacks
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4 - r; c++) B.box(-0.28 + c * 0.04 + r * 0.02, SL + r * 0.018, 0.48, 0.036, 0.016, 0.02, 0xb0b4ba, {ao: [0.8, 1.2]});
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) B.box(-0.08 + c * 0.04 + r * 0.02, SL + r * 0.018, 0.34, 0.036, 0.016, 0.02, 0xc0a070, {ao: [0.8, 1.2]});
    // ore heaps
    for (let k = 0; k < 2; k++) { const g = new THREE.ConeGeometry(0.08, 0.07, 9, 2, true).toNonIndexed(); g.translate(-0.72 + k * 0.08, SL + 0.035, 0.1 + k * 0.1); B.addRaw(g, k ? 0x6a5a48 : 0x3a3a3c, [0.8, 1.1]); }
  }
  // ground pipe run to the tank farm
  B.tube(0.1, SL + 0.01, 0.3, 0.5, SL + 0.01, 0.34, 0.01, 0xc65a2a);

  // ---------- groups 1..3: stacks ----------
  STACKS.forEach((s, i) => {
    B.grp = H.grp = L.grp = M.grp = 1 + i;
    B.cyl(s.x, SL, s.z, s.r0 * 1.7, 0.04, 0x5a554e, 0.9, scs);
    const n = full ? 10 : 6;
    for (let k = 0; k < n; k++) {
      const y0 = (k / n) * s.h, y1 = ((k + 1) / n) * s.h, ra = s.r0 + (s.r1 - s.r0) * (y0 / s.h), rb = s.r0 + (s.r1 - s.r0) * (y1 / s.h);
      const stripe = k >= n * 0.6;
      B.cyl(s.x, SL + y0, s.z, ra, y1 - y0, stripe ? (k % 2 ? 0xe8e2d4 : 0xb0382c) : (k % 2 ? 0x9a8f84 : 0x8a8076), rb / ra, scs, {ao: [0.62, 1.05]});
    }
    B.cyl(s.x, SL + s.h - 0.012, s.z, s.r1 * 1.16, 0.034, 0x2d2b2a, 0.88, scs);
    L.cyl(s.x, SL + s.h + 0.02, s.z, s.r1 * 0.9, 0.006, 0xff8a2a, 1, scs);
    L.cyl(s.x, SL + s.h * 0.74, s.z, (s.r0 + (s.r1 - s.r0) * 0.74) * 1.06, 0.02, owner, 1, scs);
    B.bar(s.x + s.r0 * 0.98, SL + 0.04, s.z + 0.012, s.x + s.r1 * 1.1, SL + s.h - 0.05, s.z + 0.012, 0.007, 0x2d2b2a);
    if (full) {
      for (let k = 0; k < Math.floor(s.h / 0.045); k++) { const y = SL + 0.05 + k * 0.045, r = s.r0 + (s.r1 - s.r0) * (k * 0.045 / s.h); B.box(s.x - 0.008, y, s.z + r * 1.03 + 0.002, 0.016, 0.004, 0.012, 0x6a6f76); }
      for (const f of [0.55, 0.84]) {
        const y = SL + s.h * f, r = s.r0 + (s.r1 - s.r0) * f;
        B.cyl(s.x, y, s.z, r * 1.5, 0.008, 0x3a3d42, 1, scs);
        for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; B.cyl(s.x + Math.cos(a) * r * 1.5, y, s.z + Math.sin(a) * r * 1.5, 0.003, 0.03, 0x6a6f76, 1, 4); }
        B.add(G.torus(0.05), s.x, y + 0.03, s.z, 0xe8a317, {sx: r * 1.5, sy: r * 1.5, sz: r * 1.5, rx: Math.PI / 2, ao: [1, 1]});
      }
    }
    B.cyl(s.x, SL + s.h + 0.02, s.z, 0.003, 0.06, DARK, 1, 4);
    L.add(G.sph(), s.x, SL + s.h + 0.085, s.z, 0xff3030, {sx: 0.011, sy: 0.011, sz: 0.011, ao: [1, 1]});
  });

  // ---------- group 4: smelter hall, blast furnaces, control room ----------
  B.grp = H.grp = L.grp = M.grp = 4;
  const hw = HALL.x1 - HALL.x0, hd = HALL.z1 - HALL.z0;
  H.box(HALL.x0, SL, HALL.z0, hw, HALL.h, hd, 0xdcdfe4, {win: 8, ao: [0.65, 1.05]});
  B.box(HALL.x0 - 0.008, SL + HALL.h - 0.006, HALL.z0 - 0.008, hw + 0.016, 0.012, hd + 0.016, 0x3a3d42);
  const teeth = 5;
  for (let i = 0; i < teeth; i++) {
    const x = HALL.x0 + (i + 0.5) * hw / teeth;
    B.add(G.box(), x, SL + HALL.h + 0.032, (HALL.z0 + HALL.z1) / 2 + 0.01, 0x5a5f66, {sx: hw / teeth * 0.96, sy: 0.008, sz: hd * 1.02, rx: 0.3, ao: [0.9, 1.1]});
    L.box(x - hw / teeth * 0.45, SL + HALL.h + 0.012, HALL.z0 + 0.012, hw / teeth * 0.9, 0.034, 0.004, 0xffe2a0);
    if (full) B.box(x - hw / teeth * 0.48, SL + HALL.h, HALL.z0 + 0.004, 0.004, 0.04, hd * 0.96, 0x4a4f56);
  }
  L.box(HALL.x0, SL + HALL.h - 0.012, HALL.z1 + 0.004, hw, 0.008, 0.006, owner);
  if (!full) for (let i = 0; i < 8; i++) L.box(HALL.x0 + 0.03 + i * 0.078, SL + 0.118, HALL.z1 + 0.003, 0.046, 0.022, 0.003, i % 3 === 1 ? 0x5a4a30 : 0xffd9a0);
  // furnace bay doors on the front, with glowing mouths and frames
  for (let i = 0; i < 3; i++) {
    const x = HALL.x0 + 0.1 + i * 0.2;
    B.box(x - 0.058, SL, HALL.z1 - 0.002, 0.116, 0.1, 0.012, 0x2d2b2a);
    L.box(x - 0.045, SL + 0.01, HALL.z1 + 0.011, 0.09, 0.075, 0.004, i === 1 ? 0xffb050 : 0xff7a1a);
    if (full) for (let k = 0; k < 4; k++) B.box(x - 0.045 + k * 0.03, SL + 0.01, HALL.z1 + 0.014, 0.004, 0.075, 0.004, 0x2d2b2a);
    M.box(x - 0.04, SL + 0.002, HALL.z1 + 0.02, 0.08, 0.004, 0.03, 0xff7a1a);
  }
  if (full) {
    // vents, roof stack, skylight rows, a gantry crane rail inside seen through the gable
    for (const [vx, vz] of [[-0.3, -0.3], [-0.05, -0.34], [0.14, -0.28]]) { B.cyl(vx, SL + HALL.h + 0.02, vz, 0.012, 0.05, 0x6a6f76, 1.3, 8); }
    for (let i = 0; i < 4; i++) B.box(HALL.x0 + 0.02, SL + 0.012 + i * 0.03, HALL.z1 + 0.004, 0.003, 0.004, 0.004, 0x5a5f66);
    B.tube(HALL.x1, SL + HALL.h - 0.02, -0.34, 0.1 - 0.0, SL + HALL.h + 0.05, -0.5, 0.012, 0xb0b4ba);
    // ducts from the hall roof to the three stacks
    STACKS.forEach((s, k) => B.tube(-0.3 + k * 0.2, SL + HALL.h + 0.05, HALL.z0 + 0.04, s.x, SL + 0.12 + k * 0.01, s.z + s.r0, 0.016, k % 2 ? 0xb0b4ba : 0x9aa0a8));
  }
  // blast furnaces
  BF.forEach((f, i) => {
    const n = 5;
    for (let k = 0; k < n; k++) {
      const y0 = SL + (k / n) * f.h, y1 = SL + ((k + 1) / n) * f.h, ra = f.r * (1 - 0.35 * (k / n)), rb = f.r * (1 - 0.35 * ((k + 1) / n));
      B.cyl(f.x, y0, f.z, ra, y1 - y0, k === 0 ? 0x7a4a34 : (k % 2 ? 0x8a9098 : 0x767c84), rb / ra, cs, {ao: [0.7, 1.05]});
    }
    B.add(G.cone(cs), f.x, SL + f.h + 0.035, f.z, 0x3a3d42, {sx: f.r * 0.7, sy: 0.07, sz: f.r * 0.7});
    B.cyl(f.x, SL + f.h + 0.065, f.z, 0.012, 0.05, DARK, 1.2, 8);
    L.cyl(f.x, SL + f.h * 0.15, f.z + f.r * 0.98, 0.018, 0.01, 0xffa030, 1, 8);
    L.box(f.x - 0.02, SL + 0.022, f.z + f.r * 0.9, 0.04, 0.026, 0.01, 0xff7a1a);
    if (full) {
      for (let k = 0; k < (full ? 3 : 2); k++) { const a = 0.7 + k * 0.9; B.cyl(f.x + Math.cos(a) * f.r * 1.45, SL, f.z + Math.sin(a) * f.r * 1.45, 0.02, f.h * 0.5, 0x6e7680, 1, 10); if (full) B.add(G.sph(), f.x + Math.cos(a) * f.r * 1.45, SL + f.h * 0.55, f.z + Math.sin(a) * f.r * 1.45, 0x6e7680, {sx: 0.02, sy: 0.012, sz: 0.02}); B.cyl(f.x + Math.cos(a) * f.r * 1.45, SL + f.h * 0.3, f.z + Math.sin(a) * f.r * 1.45, 0.0215, 0.008, 0xc65a2a, 1, 10); }
      // spiral stair + downcomer + hot-blast ring
      for (let k = 0; k < 14; k++) { const a = k * 0.55, r = f.r * (1 - 0.35 * (k / 14) * (f.h * (k / 14) / f.h)) * 1.12; B.box(f.x + Math.cos(a) * r - 0.012, SL + 0.03 + k * (f.h * 0.85 / 14), f.z + Math.sin(a) * r - 0.012, 0.024, 0.004, 0.024, 0x6a6f76); }
      B.tube(f.x, SL + f.h + 0.1, f.z, f.x + 0.12, SL + f.h * 0.5, f.z - 0.08, 0.012, 0xb0b4ba); B.tube(f.x + 0.12, SL + f.h * 0.5, f.z - 0.08, f.x + 0.12, SL + 0.02, f.z - 0.08, 0.014, 0xb0b4ba);
      B.add(G.torus(0.08), f.x, SL + f.h * 0.3, f.z, 0xc65a2a, {sx: f.r * 1.05, sy: f.r * 1.05, sz: f.r * 1.05, rx: Math.PI / 2, ao: [1, 1]});
    }
  });
  // molten runners from the furnaces to the casting bed
  M.box(-0.67, SL + 0.004, BF[1].z + 0.08, 0.036, 0.006, 0.17, 0xff7a1a);
  M.box(-0.67, SL + 0.004, BF[0].z + 0.08, 0.036, 0.006, 0.12, 0xff7a1a);
  B.box(-0.678, SL, BF[1].z + 0.075, 0.052, 0.008, 0.18, 0x3a2e28);
  // control room on legs, beside the pipe rack
  const cx = CTRL.x, cz = CTRL.z;
  for (const [dx, dz] of [[-0.05, -0.03], [0.05, -0.03], [0.05, 0.03], [-0.05, 0.03]]) B.cyl(cx + dx, SL, cz + dz, 0.006, 0.12, DARK, 1, 5);
  B.box(cx - 0.07, SL + 0.12, cz - 0.045, 0.14, 0.008, 0.09, 0x3a3d42);
  H.box(cx - 0.065, SL + 0.128, cz - 0.04, 0.13, 0.065, 0.08, 0xb8c4d4, {win: 9, ao: [0.8, 1]});
  B.box(cx - 0.07, SL + 0.193, cz - 0.045, 0.14, 0.008, 0.09, 0x2f3338);
  L.box(cx - 0.055, SL + 0.14, cz + 0.0405, 0.11, 0.03, 0.004, 0xbfe4ff);
  L.box(cx - 0.07, SL + 0.123, cz + 0.046, 0.14, 0.004, 0.004, owner);
  for (let k = 0; k < 6; k++) B.box(cx + 0.075 + k * 0.012, SL + k * 0.02, cz + 0.0, 0.014, 0.004, 0.03, LIGHT);
  if (full) { B.cyl(cx + 0.03, SL + 0.2, cz, 0.003, 0.04, DARK, 1, 4); B.add(G.cone(8), cx + 0.03, SL + 0.245, cz, 0xc8ccd2, {sx: 0.02, sy: 0.01, sz: 0.02, rx: Math.PI}); }
  // second small lit cabin by the rail yard
  B.box(-0.52, SL, 0.5, 0.1, 0.055, 0.07, 0x7a7e86, {ao: [0.6, 1]}); B.box(-0.525, SL + 0.055, 0.495, 0.11, 0.008, 0.08, 0x3a3d42); L.box(-0.5, SL + 0.025, 0.5702, 0.06, 0.02, 0.004, 0xffd27a);
  // pipe rack along the hall front
  B.grp = 0;
  for (let i = 0; i < (full ? 12 : 5); i++) {
    const x = -0.5 + i * (full ? 0.09 : 0.25);
    B.box(x - 0.005, SL, -0.115, 0.01, 0.15, 0.01, 0x3a3d42); B.box(x - 0.005, SL, -0.075, 0.01, 0.15, 0.01, 0x3a3d42);
    B.box(x - 0.01, SL + 0.15, -0.12, 0.02, 0.008, 0.05, 0x3a3d42);
    if (full && i % 3 === 1) B.bar(x, SL, -0.115, x, SL + 0.15, -0.075, 0.004, 0x5a5f66);
  }
  const PIPES: Array<[number, number, number]> = [[-0.108, 0.162, 0xc65a2a], [-0.098, 0.164, 0xb0b4ba], [-0.088, 0.162, 0x4a7aa0], [-0.078, 0.164, 0xe8c040]];
  for (const [z, y, c] of PIPES) B.tube(-0.52, SL + y, z, 0.52, SL + y, z, 0.0075, c as number, full ? 8 : 6, [1, 1]);
  if (full) {
    for (let i = 0; i < 9; i++) { const x = -0.45 + i * 0.12; for (const [z, y, c] of PIPES) { void c; B.add(G.cyl(1, 8), x, SL + y, z, 0x9aa0a8, {rz: Math.PI / 2, sx: 0.0105, sy: 0.012, sz: 0.0105}); } }
    for (const x of [-0.3, 0.1, 0.38]) { B.cyl(x, SL + 0.165, -0.108, 0.003, 0.02, DARK, 1, 4); B.add(G.torus(0.2), x, SL + 0.19, -0.108, 0xc02a1a, {sx: 0.012, sy: 0.012, sz: 0.012, rx: Math.PI / 2, ao: [1, 1]}); }
    B.tube(0.52, SL + 0.162, -0.108, 0.5, SL + 0.3, -0.25, 0.0075, 0xc65a2a); B.tube(0.52, SL + 0.164, -0.098, 0.56, SL + 0.07, 0.0, 0.0075, 0xb0b4ba);
  }
  B.tube(-0.52, SL + 0.162, -0.108, -0.55, SL + 0.15, -0.2, 0.0075, 0xc65a2a);

  // ---------- group 5: tanks and cooling tower ----------
  B.grp = H.grp = L.grp = M.grp = 5;
  // cooling tower (lathe) with a basin and a ring of columns
  const pts: THREE.Vector2[] = [];
  const NL = full ? 10 : 6;
  for (let k = 0; k <= NL; k++) { const f = k / NL, r = 0.15 - 0.07 * Math.sin(Math.min(1, f * 1.15) * 1.7) + 0.02 * f * f; pts.push(new THREE.Vector2(Math.max(0.08, r), SL + 0.045 + f * (COOL.h - 0.045))); }
  const lg = new THREE.LatheGeometry(pts, full ? 20 : 12).toNonIndexed();
  lg.translate(COOL.x, 0, COOL.z);
  B.addRaw(lg, 0xb8b2a6, [0.6, 1.05]);
  B.cyl(COOL.x, SL, COOL.z, 0.185, 0.012, 0x35505e, 1, full ? 20 : 12); B.cyl(COOL.x, SL + 0.006, COOL.z, 0.18, 0.004, 0x3a7a8a, 1, full ? 20 : 12);
  for (let k = 0; k < (full ? 16 : 5); k++) { const a = (k / (full ? 16 : 5)) * 6.283; B.bar(COOL.x + Math.cos(a) * 0.165, SL, COOL.z + Math.sin(a) * 0.165, COOL.x + Math.cos(a) * 0.15, SL + 0.05, COOL.z + Math.sin(a) * 0.15, 0.012, 0x8a857c); }
  L.cyl(COOL.x, SL + COOL.h - 0.006, COOL.z, 0.115, 0.008, owner, 1.0, full ? 20 : 12);
  if (full) for (let k = 0; k < 8; k++) { const a = k * 0.8; B.box(COOL.x + Math.cos(a) * 0.13 - 0.01, SL + 0.07 + (k % 4) * 0.012, COOL.z + Math.sin(a) * 0.13 - 0.01, 0.02, 0.004, 0.02, 0x5a554e); }
  // spherical tank on legs
  const sphx = 0.6, sphz = -0.02, sr = 0.09;
  B.add(G.sph(), sphx, SL + 0.13 + sr, sphz, 0xe4e0d4, {sx: sr, sy: sr, sz: sr, ao: [0.65, 1.1]});
  B.cyl(sphx, SL + 0.13 + sr * 0.95, sphz, sr * 1.01, 0.01, 0xc65a2a, 1, 16);
  for (let k = 0; k < (full ? 6 : 4); k++) { const a = k * (full ? 1.047 : 1.571); B.bar(sphx + Math.cos(a) * sr * 0.8, SL, sphz + Math.sin(a) * sr * 0.8, sphx + Math.cos(a) * sr * 0.75, SL + 0.13 + sr * 0.7, sphz + Math.sin(a) * sr * 0.75, 0.008, 0x5a5f66); }
  if (full) { for (let k = 0; k < 6; k++) { const a = k * 1.047; B.bar(sphx + Math.cos(a) * sr * 0.8, SL + 0.06, sphz + Math.sin(a) * sr * 0.8, sphx + Math.cos(a + 1.047) * sr * 0.8, SL + 0.07, sphz + Math.sin(a + 1.047) * sr * 0.8, 0.004, 0x5a5f66); } B.cyl(sphx, SL + 0.13 + sr * 2 - 0.005, sphz, 0.006, 0.03, 0x5a5f66, 1, 5); }
  // vertical tanks with conical roofs, rings, ladders and a pump house
  for (const [tx, tz, tr, th, c] of [[0.43, 0.14, 0.075, 0.19, 0xd8d4c8], [0.62, 0.24, 0.06, 0.14, 0xcfd3d6], [0.2, 0.3, 0.05, 0.1, 0xe4d8b8]] as Array<[number, number, number, number, number]>) {
    B.cyl(tx, SL, tz, tr, th, c, 1, cs + 4, {ao: [0.6, 1.05]});
    B.add(G.cone(cs + 4), tx, SL + th + 0.02, tz, 0x8a857c, {sx: tr * 1.02, sy: 0.04, sz: tr * 1.02});
    L.cyl(tx, SL + th * 0.62, tz, tr * 1.012, 0.012, owner, 1, cs + 4);
    if (full) {
      for (const f of [0.3, 0.55, 0.8]) B.cyl(tx, SL + th * f, tz, tr * 1.03, 0.005, 0x8a857c, 1, 16);
      for (let k = 0; k < 10; k++) B.box(tx + tr * 0.9 - 0.006, SL + 0.01 + k * (th / 10), tz + tr * 0.48, 0.012, 0.004, 0.012, 0x6a6f76);
      B.tube(tx - tr, SL + 0.025, tz, tx - tr - 0.06, SL + 0.025, tz + 0.04, 0.007, 0xc65a2a);
    }
  }
  B.box(0.3, SL, 0.09, 0.06, 0.04, 0.05, 0x5a5f66); L.box(0.31, SL + 0.016, 0.1405, 0.04, 0.014, 0.004, 0xffd27a);
  // horizontal bullet tank
  if (full) { B.add(G.cyl(1, 14), 0.2, SL + 0.045, 0.14, 0xb8b2a6, {rz: Math.PI / 2, sx: 0.04, sy: 0.14, sz: 0.04, ao: [0.6, 1.05]}); for (const dx of [-0.045, 0.045]) B.box(0.2 + dx - 0.006, SL, 0.14 - 0.03, 0.012, 0.025, 0.06, 0x4a4f56); }

  // ---------- group 6: rail yard, gantry cranes ----------
  B.grp = H.grp = L.grp = M.grp = 6;
  // ladle gantry rails and the casting bed
  for (const z of [LADLE_RAIL.z0, LADLE_RAIL.z1]) { B.box(BED.x0 - 0.04, SL, z - 0.008, BED.x1 - BED.x0 + 0.1, 0.01, 0.016, 0x5a5f66); }
  B.box(BED.x0 - 0.02, SL, BED.z - 0.04, BED.x1 - BED.x0 + 0.04, 0.012, 0.08, 0x3a2e28);
  const nm = full ? 10 : 6;
  for (let i = 0; i < nm; i++) {
    const x = BED.x0 + 0.005 + i * ((BED.x1 - BED.x0) / nm);
    B.box(x, SL + 0.012, BED.z - 0.03, (BED.x1 - BED.x0) / nm - 0.008, 0.014, 0.06, 0x5a4a42);
    M.box(x + 0.004, SL + 0.025, BED.z - 0.022, (BED.x1 - BED.x0) / nm - 0.016, 0.004, 0.044, 0xff7a1a);
  }
  // container gantry crane: four legs and a beam across the rail, container stack beside it
  const cr = CRANE;
  for (const z of [cr.z0, cr.z1]) for (const dx of [-0.05, 0.05]) { B.bar(cr.x + dx, SL, z, cr.x + dx * 0.8, SL + cr.h, z, 0.012, YELLOW, [0.8, 1]); }
  for (const dx of [-0.05, 0.05]) B.box(cr.x + dx * 0.8 - 0.008, SL + cr.h - 0.006, cr.z0, 0.016, 0.014, cr.z1 - cr.z0, 0xe8a317);
  B.box(cr.x - 0.056, SL + cr.h - 0.004, cr.z0 - 0.008, 0.112, 0.01, 0.016, 0x3a3d42); B.box(cr.x - 0.056, SL + cr.h - 0.004, cr.z1 - 0.008, 0.112, 0.01, 0.016, 0x3a3d42);
  if (full) for (const z of [cr.z0, cr.z1]) { B.bar(cr.x - 0.05, SL + 0.02, z, cr.x + 0.04, SL + cr.h - 0.02, z, 0.005, 0x6a6f76); B.bar(cr.x + 0.05, SL + 0.02, z, cr.x - 0.04, SL + cr.h - 0.02, z, 0.005, 0x6a6f76); B.box(cr.x - 0.06, SL, z - 0.012, 0.12, 0.008, 0.024, 0x3a3d42); }
  L.box(cr.x - 0.006, SL + cr.h + 0.01, cr.z0 - 0.01, 0.012, 0.012, 0.012, 0xff3030);
  const CONT = [0x4a6a8a, RUST, 0xb8863a, 0x4a7a5a, 0x8a4a6a, 0xc0a040];
  for (let i = 0; i < 2; i++) B.box(cr.x - 0.025, SL + i * 0.034, 0.66 - 0.0125, 0.05, 0.032, 0.025, CONT[i], {ao: [0.75, 1.05]});
  for (let i = 0; i < (full ? 4 : 2); i++) B.box(cr.x + 0.11 + (i % 2) * 0.055, SL + Math.floor(i / 2) * 0.034, 0.64, 0.05, 0.032, 0.026, CONT[i + 2], {ao: [0.75, 1.05]});

  // moving parts ---------------------------------------------------------------------
  // ladle portal (rides the rails along x): four legs, a beam, a trolley and a cab
  const P = new Builder();
  for (const z of [LADLE_RAIL.z0, LADLE_RAIL.z1]) for (const dx of [-0.028, 0.028]) P.bar(dx, SL + 0.01, z - BED.z, dx, SL + 0.27, z - BED.z, 0.011, YELLOW, [0.8, 1]);
  P.box(-0.036, SL + 0.265, LADLE_RAIL.z0 - BED.z - 0.01, 0.012, 0.014, LADLE_RAIL.z1 - LADLE_RAIL.z0 + 0.02, 0xe8a317);
  P.box(0.024, SL + 0.265, LADLE_RAIL.z0 - BED.z - 0.01, 0.012, 0.014, LADLE_RAIL.z1 - LADLE_RAIL.z0 + 0.02, 0xe8a317);
  P.box(-0.04, SL + 0.28, -0.03, 0.08, 0.03, 0.06, 0x3a3d42); P.box(-0.036, SL + 0.3, -0.026, 0.05, 0.02, 0.05, 0xb8c4d4);
  if (full) for (const z of [LADLE_RAIL.z0, LADLE_RAIL.z1]) { P.add(G.cyl(1, 8), -0.028, SL + 0.01, z - BED.z, 0x2a2d31, {rz: Math.PI / 2, sx: 0.012, sy: 0.016, sz: 0.012}); P.add(G.cyl(1, 8), 0.028, SL + 0.01, z - BED.z, 0x2a2d31, {rz: Math.PI / 2, sx: 0.012, sy: 0.016, sz: 0.012}); }
  P.bar(-0.03, SL + 0.265, -0.1, 0.03, SL + 0.265, 0.1, 0.004, 0x6a6f76);
  // ladle: tapered cup with a lip, ears and a bail; origin at its pivot (the ears), hangs below
  const Lb = new Builder();
  Lb.add(G.cyl(1.3, full ? 12 : 8), 0, -0.04, 0, 0x8a4a30, {sx: 0.038, sy: 0.075, sz: 0.038, ao: [0.65, 1.1]});
  Lb.cyl(0, 0.0, 0, 0.05, 0.008, 0x3a3d42, 1, full ? 12 : 8);
  M_ladleSurface(Lb);
  Lb.box(-0.062, -0.01, -0.006, 0.014, 0.012, 0.012, 0x3a3d42); Lb.box(0.048, -0.01, -0.006, 0.014, 0.012, 0.012, 0x3a3d42);
  Lb.bar(-0.056, -0.004, 0, 0, 0.07, 0, 0.005, 0x2a2d31); Lb.bar(0.056, -0.004, 0, 0, 0.07, 0, 0.005, 0x2a2d31);
  // trolley and spreader of the container crane (origin on the beam), plus the carried container
  const Tr = new Builder();
  Tr.box(-0.03, 0.0, -0.015, 0.06, 0.016, 0.03, 0x3a3d42); Tr.box(-0.02, 0.016, -0.01, 0.04, 0.012, 0.02, 0xe8a317);
  Tr.add(G.cyl(1, 6), 0, -0.002, 0, 0x6a6f76, {sx: 0.004, sy: 0.01, sz: 0.004});
  const Ct = new Builder();
  Ct.box(-0.025, 0, -0.0125, 0.05, 0.016, 0.025, 0x3a3d42);
  Ct.box(-0.025, -0.032, -0.0125, 0.05, 0.032, 0.025, 0xc0a040, {ao: [0.75, 1.05]});

  // ---------- train: a switcher and three cars (one rigid mesh running along z) ----------
  const Tn = new Builder();
  const Lo = Tn;
  Lo.box(-0.03, 0.012, -0.075 + 0.2, 0.06, 0.03, 0.15, 0x3a3d42); Lo.box(-0.032, 0.03, -0.075 + 0.2, 0.064, 0.026, 0.07, owner, {ao: [0.8, 1]});
  Lo.box(-0.028, 0.04, 0.01 + 0.2, 0.056, 0.032, 0.06, 0xe8a317); Lo.box(-0.024, 0.07, 0.008 + 0.2, 0.048, 0.006, 0.066, 0x2a2d31);
  Lo.box(-0.022, 0.048, 0.07 + 0.2, 0.044, 0.014, 0.003, 0x1a2430);
  Lo.box(-0.03, 0.024, 0.075 + 0.2, 0.06, 0.012, 0.01, 0x2a2d31);
  Lo.box(-0.02, 0.07, -0.03 + 0.2, 0.01, 0.016, 0.01, DARK); Lo.cyl(0.012, 0.072, -0.04 + 0.2, 0.007, 0.02, DARK, 1.4, 6);
  L.grp = 6;
  for (const z of [-0.055, -0.02, 0.045]) for (const x of [-0.032, 0.032]) Lo.add(G.cyl(1, full ? 8 : 5), x, 0.014, z + 0.2, 0x1c1d1f, {rz: Math.PI / 2, sx: 0.014, sy: 0.01, sz: 0.014, ao: [1, 1]});
  const wagon = (zc: number, kind: number, col: number) => {
    Tn.box(-0.028, 0.014, zc - 0.068, 0.056, 0.01, 0.136, 0x3a3d42);
    if (kind === 0) { // ore hopper
      Tn.add(G.cyl(0.62, 8), 0, 0.044, zc, col, {sx: 0.034, sy: 0.044, sz: 0.07, ao: [0.7, 1.05]});
      Tn.box(-0.03, 0.058, zc - 0.07, 0.06, 0.008, 0.14, col, {ao: [0.9, 1.05]});
      const ore = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(); ore.scale(0.03, 0.012, 0.06); ore.translate(0, 0.068, zc);
      Tn.addRaw(ore, 0x3a3a38, [0.8, 1.1]);
    } else if (kind === 1) { // tank car
      Tn.add(G.cyl(1, 12), 0, 0.045, zc, col, {rx: Math.PI / 2, sx: 0.03, sy: 0.12, sz: 0.03, ao: [0.65, 1.08]});
      Tn.box(-0.004, 0.072, zc - 0.03, 0.008, 0.012, 0.06, 0x3a3d42);
    } else { // flat car with a stack of ingots
      Tn.box(-0.03, 0.024, zc - 0.07, 0.06, 0.008, 0.14, col);
      for (let k = 0; k < 6; k++) Tn.box(-0.022 + (k % 2) * 0.024, 0.032 + Math.floor(k / 2) * 0.014, zc - 0.045 + Math.floor(k / 2) * 0.0 + (k % 2) * 0.0, 0.02, 0.012, 0.09, 0xb0b4ba, {ao: [0.8, 1.15]});
    }
    for (const z of [-0.045, 0.045]) for (const x of [-0.03, 0.03]) Tn.add(G.cyl(1, full ? 8 : 5), x, 0.012, zc + z, 0x1c1d1f, {rz: Math.PI / 2, sx: 0.012, sy: 0.008, sz: 0.012, ao: [1, 1]});
    Tn.box(-0.004, 0.02, zc + 0.07, 0.008, 0.008, 0.02, 0x2a2d31);
  };
  wagon(0.02, 0, RUST); wagon(-0.14, 1, 0x4a6a8a); wagon(-0.3, 2, 0x5a4a3a);
  // roof fans
  const Fn = new Builder();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; Fn.add(G.box(), Math.cos(a) * 0.022, 0.004, Math.sin(a) * 0.022, 0x9aa0a8, {sx: 0.04, sy: 0.003, sz: 0.012, ry: -a, ao: [1, 1]}); }
  Fn.cyl(0, 0, 0, 0.008, 0.012, 0x3a3d42, 1, 8);

  let body = B.build(), halls = H.build(), lit = L.build(), molten = M.build();
  let portal = P.build(), ladle = Lb.build(), trolley = Tr.build(), container = Ct.build(), fan = Fn.build();
  const train = Tn.build();
  if (!full) {
    // lite: the cranes, the ladle and the fans stand in place inside the body mesh; the halls take plain colours
    const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rz = 0) => g.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(1, 1, 1)));
    const parts: THREE.BufferGeometry[] = [body, halls, at(portal, -0.42, 0, BED.z), at(ladle, -0.42, SL + 0.18, BED.z, 0, 0.5), at(trolley, CRANE.x, SL + CRANE.h - 0.012, 0.58), at(container, CRANE.x, SL + CRANE.h - 0.03, 0.58)];
    for (const [fx, fy, fz] of FANS.slice(0, 2)) parts.push(at(fan, fx, fy, fz));
    const merged = mergeGeometries(parts, false);
    const litm = mergeGeometries([lit, molten], false);
    body.dispose(); lit.dispose(); molten.dispose();
    body = merged; lit = litm; halls = new THREE.BufferGeometry(); molten = new THREE.BufferGeometry();
    portal = new THREE.BufferGeometry(); ladle = new THREE.BufferGeometry(); trolley = new THREE.BufferGeometry(); container = new THREE.BufferGeometry(); fan = new THREE.BufferGeometry();
  }
  const tc = (g: THREE.BufferGeometry) => (g.attributes.position ? triCount(g) : 0);
  const tris = tc(body) + tc(halls) + tc(lit) + tc(molten) + tc(portal) + tc(ladle) + tc(trolley) + tc(container) + tc(train) + (full ? tc(fan) * FANS.length : 0);
  void hash;
  return {body, halls, lit, molten, portal, ladle, trolley, container, train, fan, tris};
}

/** the glowing metal surface inside the ladle (drawn in the ladle's own colours, always bright) */
function M_ladleSurface(b: Builder) { b.cyl(0, 0.03, 0, 0.044, 0.006, 0xffa030, 1, 12, {ao: [1, 1]}); }
