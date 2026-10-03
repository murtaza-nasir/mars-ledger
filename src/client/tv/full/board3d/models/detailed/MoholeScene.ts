// Mohole (Detailed): the borehole's geometry, built once per detail level and shared by every instance.
// Unit-radius space (the component scales by the hex radius). Layout, by angle (deg, 0 = +x, 90 = +z toward the camera):
//   rim: apron ring (yard), berm, three terraces with service roads and ramps, a hot lip round the bore (r 0.36)
//   yard: control buildings (58, 122, 338), tank farm (190-226), heat exchangers + fans (298, 326), drill-pipe rack (92),
//         parked haulers (4-30, 156-176), workers, light masts, pipe runs running into the bore
//   tower: a lattice derrick over the bore with platforms, railings, a crown with turning sheaves, beacons
import * as THREE from 'three';
import type {Pt} from './MoholeShaft';
import {band, bar, bx, bxb, cy, cyTaper, fanGeometry, gearGeometry, hauler, Parts, put, rock, slab, tube} from './MoholeKit';

const D2R = Math.PI / 180;
export const polar = (deg: number, r: number): [number, number] => [Math.cos(deg * D2R) * r, Math.sin(deg * D2R) * r];
/** yaw that lays a box's local x along the tangent at this angle (local +z then faces the bore) */
const tang = (deg: number) => -(deg * D2R + Math.PI / 2);

export const Y_APRON = 0.09, Y_CREST = 0.16, TOWER_TOP = 0.98;
const TOWER_BASE = 0.16;
export const hx = (y: number) => 0.4 - (0.4 - 0.085) * ((y - TOWER_BASE) / (TOWER_TOP - TOWER_BASE));

export type MoleLight = [number, number, number, number];
export type MoleGear = {x: number; y: number; z: number; yaw: number; r: number; speed: number; phase: number; towerY?: boolean};
export type MoleFan = {x: number; y: number; z: number; r: number; speed: number; phase: number};
export type MoleScene = {
  rim: THREE.BufferGeometry; depot: THREE.BufferGeometry; tower: THREE.BufferGeometry;
  gears?: THREE.BufferGeometry; fans?: THREE.BufferGeometry; drill?: THREE.BufferGeometry; convoy?: THREE.BufferGeometry;
  gearList: MoleGear[]; fanList: MoleFan[]; vents: Pt[]; lights: MoleLight[];
};

const cache: Record<string, MoleScene> = {};
export function moleScene(full: boolean): MoleScene { return (cache[full ? 'full' : 'lite'] ??= build(full)); }

function build(F: boolean): MoleScene {
  let k = 7; const rnd = () => { k = (Math.imul(k, 1664525) + 1013904223) | 0; return (k >>> 0) / 4294967296; };
  const SEG = F ? 96 : 30;
  const vents: Pt[] = [], lights: MoleLight[] = [], gearList: MoleGear[] = [], fanList: MoleFan[] = [];
  const steel = '#b9bcc4', dark = '#2b2d33', conc = '#a9a79f', yel = '#e6b422', orange = '#e2742a';

  // ================================================== rim ==================================================
  const rim = new Parts();
  band(rim, [[0.85, 0.0], [0.84, Y_APRON]], '#4f3328', {seg: SEG, amp: 0.008, seed: 1});
  band(rim, [[0.84, Y_APRON], [0.70, Y_APRON]], '#6b5d4e', {seg: SEG, vary: 0.18});
  band(rim, [[0.745, Y_APRON + 0.002], [0.70, Y_APRON + 0.002]], '#2b2c31', {seg: SEG, vary: 0.05});   // yard road
  band(rim, [[0.70, Y_APRON], [0.66, Y_CREST]], '#7a4a34', {seg: SEG, amp: 0.006, seed: 2, vary: 0.3});
  const terr: Array<[number, number, number, number, string, string]> = [
    // outer r, inner r, y, next y, bench colour, wall colour
    [0.66, 0.595, 0.16, 0.125, '#4d433a', '#a85f3c'],
    [0.56, 0.505, 0.125, 0.09, '#4d433a', '#b9704a'],
    [0.47, 0.425, 0.09, 0.05, '#4d433a', '#c98150'],
  ];
  terr.forEach(([ro, ri, y, yn, cb, cw], i) => {
    band(rim, [[ro, y], [ri, y]], cb, {seg: SEG, amp: 0.004, seed: 3 + i, vary: 0.22});
    band(rim, [[ri + 0.012, y + 0.002], [ri + 0.044, y + 0.002]].map(([r, yy]) => [r, yy] as [number, number]), '#2d2e33', {seg: SEG, vary: 0.04}); // road lane
    const wo = ri, wi = i === 0 ? 0.56 : i === 1 ? 0.47 : 0.395;
    // the cut face: two strata
    const ym = (y + yn) / 2;
    band(rim, [[wo, y], [(wo + wi) / 2, ym]], cw, {seg: SEG, amp: 0.004, seed: 9 + i, vary: 0.3, jy: 0.003});
    band(rim, [[(wo + wi) / 2, ym], [wi, yn]], i % 2 ? '#8e5a3e' : '#7d4c36', {seg: SEG, amp: 0.004, seed: 12 + i, vary: 0.3, jy: 0.003});
  });
  band(rim, [[0.395, 0.05], [0.36, 0.05]], '#ff7a2a', {seg: SEG, glow: 1.5, vary: 0.2});
  band(rim, [[0.405, 0.052], [0.395, 0.052]], '#b04418', {seg: SEG, glow: 0.7, vary: 0.3});
  // ramps cut across the walls (service roads), with a yellow edge line
  for (const [deg, tier] of [[35, 0], [215, 0], [125, 1], [305, 1], [20, 2], [200, 2]] as Array<[number, number]>) {
    const [ro, ri, y, yn] = [terr[tier][1] + 0.012, tier === 0 ? 0.56 : tier === 1 ? 0.47 : 0.395, terr[tier][2], terr[tier][3]];
    const [ax, az] = polar(deg, ro + 0.014), [bx2, bz] = polar(deg, ri - 0.004);
    slab(rim, [ax, y + 0.004, az], [bx2, yn + 0.004, bz], 0.045, 0.006, '#2a2b30', {});
    if (F) { slab(rim, [ax, y + 0.0075, az], [bx2, yn + 0.0075, bz], 0.004, 0.002, yel, {}); }
  }
  // lane dashes and kerbs
  if (F) {
    for (const [r, y, n] of [[0.627, 0.1625, 34], [0.5325, 0.1275, 26], [0.4475, 0.0925, 20]] as Array<[number, number, number]>) {
      for (let i = 0; i < n; i++) { const a = (i / n) * 360 + 3; const [x, z] = polar(a, r); bx(rim, x, y, z, 0.026, 0.003, 0.005, '#d9c36a', {ry: tang(a)}); }
    }
    for (let i = 0; i < 40; i++) { const a = (i / 40) * 360 + 4; const [x, z] = polar(a, 0.723); bx(rim, x, Y_APRON + 0.003, z, 0.03, 0.002, 0.004, '#d9d9d9', {ry: tang(a)}); }
    // retaining blocks on the apron's outer edge and spoil boulders
    for (let i = 0; i < 48; i++) { const a = (i / 48) * 360; const [x, z] = polar(a, 0.838); bxb(rim, x, 0.0, z, 0.06, 0.1, 0.02, i % 2 ? '#8b8f96' : '#767a82', {ry: tang(a)}); }
    for (let i = 0; i < 26; i++) { const a = rnd() * 360, r = 0.675 + rnd() * 0.015; const [x, z] = polar(a, r); rock(rim, x, Y_APRON + (0.7 - r) * -1.7 + 0.0, z, 0.012 + rnd() * 0.016, '#6b3d2a', rnd); }
    // terrace guard rails and lamps
    for (let i = 0; i < 28; i++) { const a = (i / 28) * 360 + 2; const [x, z] = polar(a, 0.658); bxb(rim, x, Y_CREST, z, 0.006, 0.026, 0.006, yel, {ry: tang(a)}); }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 360 + 11; const [x, z] = polar(a, 0.58); bxb(rim, x, 0.125, z, 0.006, 0.03, 0.006, '#9a9da5');
      bx(rim, x, 0.158, z, 0.016, 0.01, 0.016, '#ffd9a0', {glow: 1, owner: i % 3 === 0 ? 1 : 0}); }
  } else {
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 360 + 11; const [x, z] = polar(a, 0.58); bxb(rim, x, 0.125, z, 0.01, 0.03, 0.01, '#9a9da5');
      bx(rim, x, 0.158, z, 0.02, 0.012, 0.02, '#ffd9a0', {glow: 1, owner: i % 3 === 0 ? 1 : 0}); }
    for (let i = 0; i < 6; i++) { const a = rnd() * 360, r = 0.675; const [x, z] = polar(a, r); rock(rim, x, 0.13, z, 0.02, '#6b3d2a', rnd); }
  }

  // ================================================== yard (depot) ==================================================
  const depot = new Parts();
  const lamp = (deg: number, r: number, h = 0.15) => {
    const [x, z] = polar(deg, r); cy(depot, x, Y_APRON + h / 2, z, 0.0045, h, '#9a9da5', {seg: 5});
    bx(depot, x, Y_APRON + h + 0.005, z, 0.03, 0.012, 0.02, '#fff', {glow: 1.1, owner: 0, ry: tang(deg)}); lights.push([x, Y_APRON + h + 0.03, z, 0]);
  };
  const building = (deg: number, r: number, w: number, h: number, d: number, body: string, storeys: number, owner = true) => {
    const [x, z] = polar(deg, r), ry = tang(deg);
    const fx = Math.cos(ry), fz = -Math.sin(ry); // local x in world (x,z)
    const ix = Math.sin(ry), iz = Math.cos(ry);  // local +z in world: toward the bore
    bxb(depot, x, 0, z, w + 0.02, Y_APRON, d + 0.02, '#807b72', {ry});
    bxb(depot, x, Y_APRON, z, w, h, d, body, {ry});
    bxb(depot, x, Y_APRON + h, z, w + 0.012, 0.008, d + 0.012, '#5b5e66', {ry});
    if (owner) { bxb(depot, x, Y_APRON + h + 0.008, z, w * 0.9, 0.004, d * 0.28, '#fff', {ry, owner: 1, glow: 0.45}); }
    if (F) {
      // windows on both long faces and the ends: rows by storey
      const cols = Math.max(2, Math.floor(w / 0.04));
      for (let s = 0; s < storeys; s++) {
        const wy = Y_APRON + (h / storeys) * (s + 0.55);
        for (let c = 0; c < cols; c++) {
          const lx = (c - (cols - 1) / 2) * (w / cols);
          const lit = rnd() > 0.15 ? '#ffd27a' : '#6d7480';
          for (const side of [1, -1]) bx(depot, x + fx * lx + ix * side * (d / 2 + 0.001), wy, z + fz * lx + iz * side * (d / 2 + 0.001), 0.022, 0.016, 0.004, lit, {ry, glow: lit === '#ffd27a' ? 1.15 : 0.1});
        }
        for (const side of [1, -1]) bx(depot, x + fx * side * (w / 2 + 0.001), wy, z + fz * side * (w / 2 + 0.001), 0.004, 0.016, 0.022, '#ffd27a', {ry, glow: 1.0});
      }
      // door, roof plant, antenna
      bx(depot, x + ix * (d / 2 + 0.001), Y_APRON + 0.014, z + iz * (d / 2 + 0.001), 0.02, 0.028, 0.004, '#3a3d44', {ry});
      bxb(depot, x + fx * w * 0.22, Y_APRON + h + 0.008, z + fz * w * 0.22, 0.04, 0.016, 0.03, '#c9ccd2', {ry});
      cy(depot, x - fx * w * 0.25, Y_APRON + h + 0.022, z - fz * w * 0.25, 0.012, 0.028, '#8c9099', {seg: 8});
      tube(depot, [x - fx * w * 0.38, Y_APRON + h + 0.008, z - fz * w * 0.38], [x - fx * w * 0.38, Y_APRON + h + 0.12, z - fz * w * 0.38], 0.002, '#cfd2d8', {seg: 4});
      lights.push([x - fx * w * 0.38, Y_APRON + h + 0.122, z - fz * w * 0.38, 1]);
    } else {
      bxb(depot, x, Y_APRON + h * 0.25, z, w * 0.9, h * 0.22, d + 0.004, '#ffd27a', {ry, glow: 1.1});
      tube(depot, [x - fx * w * 0.38, Y_APRON + h + 0.008, z - fz * w * 0.38], [x - fx * w * 0.38, Y_APRON + h + 0.12, z - fz * w * 0.38], 0.003, '#cfd2d8', {seg: 3});
      lights.push([x - fx * w * 0.38, Y_APRON + h + 0.122, z - fz * w * 0.38, 1]);
    }
  };
  building(58, 0.785, 0.2, 0.09, 0.1, '#c9c7c0', 2);
  building(52, 0.785, 0.01, 0.01, 0.01, '#c9c7c0', 1, false);
  building(122, 0.79, 0.17, 0.065, 0.095, '#b9bcc0', 2);
  building(338, 0.79, 0.15, 0.06, 0.09, '#c3c1b8', 1);
  // comms dish on the second building
  { const [x, z] = polar(122, 0.79); cy(depot, x + 0.05, Y_APRON + 0.1, z, 0.006, 0.05, '#8c9099', {seg: 5});
    const dish = new THREE.SphereGeometry(0.035, F ? 10 : 6, F ? 6 : 4, 0, Math.PI * 2, 0, 1.1); put(depot, dish, {x: x + 0.05, y: Y_APRON + 0.135, z, rx: 0.9, sx: 1, sy: 0.6, sz: 1}, '#e9ebef'); dish.dispose(); }

  // tank farm
  for (const [deg, r, h] of [[190, 0.785, 0.17], [208, 0.79, 0.14], [226, 0.785, 0.19]] as Array<[number, number, number]>) {
    const [x, z] = polar(deg, r);
    cy(depot, x, Y_APRON + 0.005, z, 0.075, 0.01, '#6a6f78', {seg: F ? 16 : 8});
    cy(depot, x, Y_APRON + 0.01 + h / 2, z, 0.062, h, '#d4d6db', {seg: F ? 18 : 9});
    cy(depot, x, Y_APRON + 0.01 + h * 0.55, z, 0.0635, 0.034, '#fff', {seg: F ? 18 : 9, owner: 1, glow: 0.35});
    const dome = new THREE.SphereGeometry(0.062, F ? 14 : 6, F ? 4 : 2, 0, Math.PI * 2, 0, 0.9); put(depot, dome, {x, y: Y_APRON + 0.01 + h - 0.004, z, sy: 0.55}, '#aeb1b8'); dome.dispose();
    if (F) {
      for (let i = 1; i < 4; i++) cy(depot, x, Y_APRON + 0.01 + (h * i) / 4, z, 0.0635, 0.003, '#8a8e96', {seg: 18});
      bar(depot, [x + 0.064, Y_APRON + 0.012, z], [x + 0.064, Y_APRON + 0.01 + h, z], 0.005, '#7c8088');
      tube(depot, [x - 0.03, Y_APRON + 0.01 + h, z], [x - 0.03, Y_APRON + 0.01 + h + 0.05, z], 0.006, '#9a9da5', {seg: 6});
      vents.push([x - 0.03, Y_APRON + 0.065 + h, z]);
    }
  }
  // pipe bridge between the tanks and the exchangers, low along the apron
  { const a = polar(226, 0.74), b = polar(298, 0.74);
    for (let i = 0; i < 2; i++) { const o = i * 0.016;
      tube(depot, [a[0] - o * 0.4, Y_APRON + 0.07 + o, a[1] + 0.02], [b[0] + 0.04, Y_APRON + 0.07 + o, b[1]], 0.008, i ? '#b5632e' : steel, {seg: 7}); } }

  // heat exchangers: horizontal shells on saddles, a fan deck on top, stacks
  for (const [deg, r] of [[298, 0.785], [326, 0.785]] as Array<[number, number]>) {
    const [x, z] = polar(deg, r), ry = tang(deg), fx = Math.cos(ry), fz = -Math.sin(ry);
    bxb(depot, x, 0, z, 0.26, Y_APRON, 0.1, '#807b72', {ry});
    for (const s of [-0.08, 0.08]) bxb(depot, x + fx * s, Y_APRON, z + fz * s, 0.016, 0.03, 0.07, '#4a4d55', {ry});
    cy(depot, x, Y_APRON + 0.05, z, 0.04, 0.2, '#c2c5cb', {seg: F ? 14 : 7, rx: Math.PI / 2, ry: ry + Math.PI / 2});
    if (F) for (const s of [-0.1, -0.06, 0.06, 0.1]) cy(depot, x + fx * s, Y_APRON + 0.05, z + fz * s, 0.0425, 0.008, '#6e7178', {seg: 14, rx: Math.PI / 2, ry: ry + Math.PI / 2});
    cy(depot, x + fx * 0.1, Y_APRON + 0.05, z + fz * 0.1, 0.042, 0.012, '#fff', {seg: F ? 14 : 7, rx: Math.PI / 2, ry: ry + Math.PI / 2, owner: 1, glow: 0.35});
    // fan deck
    for (const s of [-0.055, 0.055]) {
      bxb(depot, x + fx * s, Y_APRON + 0.092, z + fz * s, 0.07, 0.006, 0.07, '#767a82', {ry});
      if (F) for (const c of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bxb(depot, x + fx * s + fx * c[0] * 0.03 + Math.sin(ry) * c[1] * 0.03, Y_APRON + 0.05, z + fz * s + fx * 0 + Math.cos(ry) * c[1] * 0.03 + fz * c[0] * 0.03, 0.005, 0.042, 0.005, '#4a4d55');
      fanList.push({x: x + fx * s, y: Y_APRON + 0.105, z: z + fz * s, r: 0.034, speed: s > 0 ? 9 : -8, phase: s * 40});
      if (!F) { cy(depot, x + fx * s, Y_APRON + 0.102, z + fz * s, 0.032, 0.008, '#3b3d44', {seg: 8}); }
    }
    // stack and vents
    cyTaper(depot, x - fx * 0.115, Y_APRON + 0.1, z - fz * 0.115, 0.01, 0.014, 0.2, '#8c9099', {seg: 8});
    cy(depot, x - fx * 0.115, Y_APRON + 0.205, z - fz * 0.115, 0.016, 0.01, '#4a4d55', {seg: 8});
    vents.push([x - fx * 0.115, Y_APRON + 0.215, z - fz * 0.115]);
    cy(depot, x + fx * 0.04, Y_APRON + 0.1, z + fz * 0.04, 0.007, 0.07, '#9a9da5', {seg: 6});
    vents.push([x + fx * 0.04, Y_APRON + 0.14, z + fz * 0.04]);
  }

  // pipe runs into the bore: three parallel lines on posts over the berm and terraces, flanged, ending at the lip
  for (let q = 0; q < (F ? 3 : 2); q++) {
    const deg = 308 + q * 5.2, col = ['#b5632e', steel, '#3f7fa5'][q];
    const pts: Array<[number, number, number]> = [];
    const prof: Array<[number, number]> = [[0.76, 0.135], [0.7, 0.135], [0.66, 0.2], [0.6, 0.2], [0.56, 0.165], [0.5, 0.165], [0.47, 0.13], [0.43, 0.13], [0.41, 0.095]];
    for (const [r, y] of prof) { const [x, z] = polar(deg, r); pts.push([x, y, z]); }
    for (let i = 0; i + 1 < pts.length; i++) {
      tube(depot, pts[i], pts[i + 1], 0.0065, col, {seg: F ? 7 : 4});
      if (F) { const s = new THREE.SphereGeometry(0.0085, 6, 4); put(depot, s, {x: pts[i + 1][0], y: pts[i + 1][1], z: pts[i + 1][2]}, '#8c9099'); s.dispose(); }
      if (F && i % 2 === 0) { const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, (pts[i][2] + pts[i + 1][2]) / 2];
        cy(depot, m[0], m[1], m[2], 0.0095, 0.006, '#d0d2d8', {seg: 8, rx: 0}); }
    }
    for (const i of [1, 3, 5, 7]) { const [x, y, z] = pts[i]; const base = i === 1 ? Y_APRON : i === 3 ? Y_CREST : i === 5 ? 0.125 : 0.09; bxb(depot, x, base, z, 0.007, y - base - 0.004, 0.007, '#4a4d55'); }
  }

  // drill-pipe rack: stacked lengths on cradles at 92 degrees
  { const [x, z] = polar(92, 0.785), ry = tang(92), fx = Math.cos(ry), fz = -Math.sin(ry);
    for (const s of [-0.07, 0.0, 0.07]) bxb(depot, x + fx * s, Y_APRON, z + fz * s, 0.012, 0.02, 0.1, '#5b5e66', {ry});
    let n = 0;
    for (let row = 0; row < 3; row++) for (let c = 0; c < 4 - row; c++) {
      const off = (c - (3 - row) / 2) * 0.022, yy = Y_APRON + 0.028 + row * 0.019;
      const ix = Math.sin(ry), iz = Math.cos(ry);
      tube(depot, [x + fx * 0.09 + ix * off, yy, z + fz * 0.09 + iz * off], [x - fx * 0.09 + ix * off, yy, z - fz * 0.09 + iz * off], 0.0105, n++ % 3 === 0 ? yel : '#7a7e86', {seg: F ? 8 : 4});
    }
  }
  // containers (stacked) at 250 degrees
  { const [x, z] = polar(251, 0.79), ry = tang(251);
    bxb(depot, x, Y_APRON, z, 0.12, 0.04, 0.045, '#2f6f9a', {ry});
    bxb(depot, x, Y_APRON + 0.04, z, 0.12, 0.04, 0.045, '#c4562a', {ry});
    if (F) for (let i = -2; i <= 2; i++) { const fx = Math.cos(ry), fz = -Math.sin(ry); bxb(depot, x + fx * i * 0.024, Y_APRON + 0.002, z + fz * i * 0.024, 0.002, 0.076, 0.047, '#2a2d33', {ry}); }
  }
  // parked haulers on the yard road
  for (const [deg, s] of [[6, 0.66], [18, 0.66], [30, 0.66], [158, 0.68], [172, 0.68]].filter((_, i) => F || i % 2 === 0) as Array<[number, number]>) {
    const [x, z] = polar(deg, 0.722);
    hauler(depot, x, Y_APRON + 0.003, z, tang(deg) + (deg > 90 ? Math.PI : 0), s, ['#e2b52a', '#d89a24', '#e2b52a', '#e0a82a', '#d89a24'][Math.floor(deg) % 5], deg === 30 ? 0.22 : 0, F);
  }
  // lamps
  for (const d of [20, 80, 100, 140, 180, 245, 280, 355]) lamp(d, 0.67 + (d % 3) * 0.0, 0.14);
  // workers: hi-vis vests (owner colour on one)
  if (F) for (const [deg, r, own] of [[56, 0.72, 0], [60, 0.72, 1], [120, 0.72, 0], [92, 0.72, 1], [300, 0.72, 0], [336, 0.72, 0], [188, 0.73, 1]] as Array<[number, number, number]>) {
    const [x, z] = polar(deg, r), y = Y_APRON;
    cy(depot, x, y + 0.01, z, 0.004, 0.02, '#2b2f3a', {seg: 5});
    bxb(depot, x, y + 0.018, z, 0.011, 0.016, 0.007, own ? '#fff' : orange, {owner: own, glow: own ? 0.3 : 0});
    bxb(depot, x, y + 0.034, z, 0.007, 0.007, 0.007, '#e3b48f');
    bxb(depot, x, y + 0.04, z, 0.009, 0.003, 0.009, '#f2f2f2');
  }

  // ================================================== tower ==================================================
  const tower = new Parts();
  const N = 6;
  const levelY = (i: number) => TOWER_BASE + ((TOWER_TOP - TOWER_BASE) * i) / N;
  const corners = (y: number): Array<[number, number]> => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * hx(y), b * hx(y)] as [number, number]);
  const tt = F ? 0.022 : 0.026;
  for (const [cx, cz] of corners(TOWER_BASE)) { bxb(tower, cx, 0.0, cz, 0.07, TOWER_BASE + 0.012, 0.07, '#7d7870'); bxb(tower, cx, TOWER_BASE, cz, 0.06, 0.012, 0.06, '#4a4d55'); }
  for (let i = 0; i < N; i++) {
    const y0 = levelY(i), y1 = levelY(i + 1), c0 = corners(y0), c1 = corners(y1);
    for (let c = 0; c < 4; c++) {
      const n = (c + 1) % 4;
      bar(tower, [c0[c][0], y0, c0[c][1]], [c1[c][0], y1, c1[c][1]], tt, i % 2 ? '#d2a62c' : '#c7cad0');
      // X braces on the face between corner c and n (single diagonal in lite)
      if (F || i % 2 === 0) bar(tower, [c0[c][0], y0, c0[c][1]], [c1[n][0], y1, c1[n][1]], 0.008, '#80848c');
      if (F && i % 2 === 0) bar(tower, [c0[n][0], y0, c0[n][1]], [c1[c][0], y1, c1[c][1]], 0.008, '#80848c');
      if (F && i % 2 === 1) bar(tower, [c1[c][0], y1, c1[c][1]], [c1[n][0], y1, c1[n][1]], 0.011, '#9a9da5');
    }
  }
  // platforms: frame, deck grating, rails, owner light strips
  for (const lv of [2, 4]) {
    const y = levelY(lv), h = hx(y) + 0.028;
    bxb(tower, 0, y - 0.004, h, h * 2 + 0.03, 0.008, 0.035, '#5f636b'); bxb(tower, 0, y - 0.004, -h, h * 2 + 0.03, 0.008, 0.035, '#5f636b');
    bxb(tower, h, y - 0.004, 0, 0.035, 0.008, h * 2 + 0.03, '#5f636b'); bxb(tower, -h, y - 0.004, 0, 0.035, 0.008, h * 2 + 0.03, '#5f636b');
    bxb(tower, 0, y + 0.034, h + 0.012, h * 2 + 0.05, 0.007, 0.006, yel); bxb(tower, 0, y + 0.034, -h - 0.012, h * 2 + 0.05, 0.007, 0.006, yel);
    bxb(tower, h + 0.012, y + 0.034, 0, 0.006, 0.007, h * 2 + 0.05, yel); bxb(tower, -h - 0.012, y + 0.034, 0, 0.006, 0.007, h * 2 + 0.05, yel);
    bx(tower, 0, y + 0.002, h + 0.02, h * 1.5, 0.008, 0.006, '#fff', {owner: 1, glow: 0.8}); bx(tower, 0, y + 0.002, -h - 0.02, h * 1.5, 0.008, 0.006, '#fff', {owner: 1, glow: 0.8});
    if (F) for (let i = -3; i <= 3; i++) { const o = (i / 3) * h * 0.9; bxb(tower, o, y, h + 0.012, 0.004, 0.034, 0.004, yel); bxb(tower, o, y, -h - 0.012, 0.004, 0.034, 0.004, yel); bxb(tower, h + 0.012, y, o, 0.004, 0.034, 0.004, yel); bxb(tower, -h - 0.012, y, o, 0.004, 0.034, 0.004, yel); }
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) lights.push([sx * (h + 0.02), y + 0.05, sz * (h + 0.02), (lv + (sx > 0 ? 1 : 0)) % 2 === 0 ? 1 : 0]);
  }
  // a stair/ladder cage up one face
  if (F) { const c0 = corners(TOWER_BASE), c1 = corners(levelY(5));
    for (let i = 0; i < 24; i++) { const t = i / 24, y = TOWER_BASE + (levelY(5) - TOWER_BASE) * t, h = hx(y) + 0.02; bxb(tower, -h * 0.4, y, h + 0.004, 0.05, 0.003, 0.01, '#d0d2d8'); }
    void c0; void c1; }
  // crown: block, sheave housing, lightning mast, beacons
  bxb(tower, 0, TOWER_TOP, 0, 0.26, 0.04, 0.2, '#3d4047');
  bxb(tower, 0, TOWER_TOP + 0.04, 0, 0.2, 0.04, 0.14, '#5f636b');
  for (const sx of [-1, 1]) { bxb(tower, sx * 0.055, TOWER_TOP + 0.08, 0.055, 0.012, 0.09, 0.012, '#3d4047'); bxb(tower, sx * 0.055, TOWER_TOP + 0.08, -0.055, 0.012, 0.09, 0.012, '#3d4047'); }
  bxb(tower, 0, TOWER_TOP + 0.158, 0, 0.16, 0.014, 0.12, '#9a9da5');
  bxb(tower, 0, TOWER_TOP + 0.172, 0, 0.12, 0.004, 0.09, '#fff', {owner: 1, glow: 0.8});
  tube(tower, [0, TOWER_TOP + 0.17, 0], [0, TOWER_TOP + 0.34, 0], 0.003, '#cfd2d8', {seg: 4});
  { const o = new THREE.IcosahedronGeometry(0.018, F ? 1 : 0); put(tower, o, {y: TOWER_TOP + 0.35}, '#fff', {owner: 1, glow: 1.8, vary: 0}); o.dispose(); }
  lights.push([0, TOWER_TOP + 0.38, 0, 1]);
  for (const [sx, sz] of [[1, 1], [-1, -1]]) lights.push([sx * 0.07, TOWER_TOP + 0.17, sz * 0.05, 0]);
  // the two sheaves: static in lite, instanced and turning in full
  for (const sx of [-1, 1]) {
    const g: MoleGear = {x: sx * 0.058, y: TOWER_TOP + 0.082, z: 0, yaw: 0, r: 0.052, speed: sx > 0 ? 2.4 : -2.4, phase: sx};
    gearList.push(g);
  }
  // drawworks: a winch house with two meshing gears, at the foot of the tower on the apron (angle 270)
  { const [x, z] = polar(272, 0.79), ry = tang(272);
    bxb(tower, x, 0, z, 0.2, Y_APRON + 0.01, 0.1, '#807b72', {ry});
    bxb(tower, x, Y_APRON + 0.01, z, 0.19, 0.07, 0.09, '#4a4d55', {ry});
    bxb(tower, x, Y_APRON + 0.08, z, 0.2, 0.01, 0.1, '#8c9099', {ry});
    bx(tower, x, Y_APRON + 0.105, z, 0.04, 0.045, 0.03, '#e2b52a', {ry});
    const [ox, oz] = polar(272, 0.79 + 0.049);
    const yaw = Math.PI / 2 - 272 * D2R;
    gearList.push({x: ox + Math.sin(yaw) * 0.0 + Math.cos(yaw) * -0.045, y: Y_APRON + 0.05, z: oz + Math.sin(yaw) * 0.0 - Math.sin(yaw) * -0.045, yaw, r: 0.045, speed: 1.8, phase: 0});
    gearList.push({x: ox + Math.cos(yaw) * 0.04, y: Y_APRON + 0.05, z: oz - Math.sin(yaw) * 0.04, yaw, r: 0.04, speed: -2.0, phase: 0.26});
    // hoist line from the drawworks up to the crown
    tube(tower, [x, Y_APRON + 0.1, z], [0.08, TOWER_TOP + 0.08, 0.0], 0.003, '#17181b', {seg: 4});
  }

  if (!F) {
    // lite: the sheaves, fans and drill stand still, merged into the tower and yard
    const gg = gearGeometry(10, 4, '#cfa43a', true);
    for (const g of gearList) put(tower, gg, {x: g.x, y: g.y, z: g.z, ry: g.yaw, sx: g.r, sy: g.r, sz: g.r}, '#fff', {vary: 0});
    gg.dispose();
    for (let i = 0; i < 2; i++) { const a = 90 + i * 140; const [x, z] = polar(a, 0.532); hauler(depot, x, 0.1285, z, tang(a) + Math.PI, 0.38, '#e2b52a', 0, false); }
    cy(tower, 0, 0.42, 0, 0.026, 0.76, '#4a4d55', {seg: 6});
    cy(tower, 0, 0.775, 0, 0.0045, 0.5, '#17181b', {seg: 3});
    bxb(tower, 0, 0.74, 0, 0.1, 0.07, 0.07, '#e2b52a');
    cy(tower, 0, 0.04, 0, 0.03, 0.05, '#ff9a3a', {seg: 6, glow: 1.4});
  }
  const sc: MoleScene = {rim: rim.build(), depot: depot.build(), tower: tower.build(), gearList, fanList, vents, lights};
  if (F) {
    sc.gears = gearGeometry(14, 5, '#cfa43a'); sc.fans = fanGeometry(6);
    const d = new Parts();
    bxb(d, 0, 0.74, 0, 0.1, 0.07, 0.07, '#e2b52a'); bxb(d, 0, 0.8, 0, 0.12, 0.012, 0.05, '#3d4047');
    cy(d, 0, 0.775, 0, 0.0045, 0.5, '#17181b', {seg: 4});
    bxb(d, 0, 0.6, 0, 0.05, 0.14, 0.05, '#6c7078');
    cy(d, 0, 0.5, 0, 0.036, 0.1, '#80848c', {seg: 10});
    cy(d, 0, 0.18, 0, 0.026, 0.62, '#4a4d55', {seg: 10});
    for (let i = 0; i < 12; i++) { const y = 0.42 - i * 0.045, a = i * 0.9; bx(d, Math.cos(a) * 0.035, y, Math.sin(a) * 0.035, 0.05, 0.007, 0.012, '#c8cad0', {ry: -a}); bx(d, -Math.cos(a) * 0.035, y, -Math.sin(a) * 0.035, 0.05, 0.007, 0.012, '#c8cad0', {ry: -a}); }
    cy(d, 0, 0.03, 0, 0.03, 0.05, '#ff9a3a', {seg: 8, glow: 1.4});
    sc.drill = d.build();
    const cv = new Parts();
    for (const [a, c] of [[0, '#e2b52a'], [150, '#d89a24'], [255, '#e2b52a']] as Array<[number, string]>) {
      const [x, z] = polar(-a, 0.532);
      hauler(cv, x, 0.1285, z, a * D2R - Math.PI / 2 + Math.PI, 0.38, c);
    }
    sc.convoy = cv.build();
  }
  return sc;
}
