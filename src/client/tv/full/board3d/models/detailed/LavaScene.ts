// Lava Flows (Detailed): the solid props, built once per detail level (unit-radius space).
//   rocks: cooled basalt columns (a standing cluster and fallen ones), spatter and bombs on the cone, boulders in the flows
//   post:  the scientific monitoring post: pad, tripod, instrument shelter, solar array, mast with yagi and dish,
//          seismometer, cabling, an owner-colour banner and beacon
//   spin:  the anemometer cups on the mast top (full only; merged static into the post in lite)
import * as THREE from 'three';
import {coneHeight, RC} from './LavaGround';
import type {LavaBeacon} from './LavaFX';
import {bar, bx, bxb, cy, cyTaper, Parts, put, rock, tube} from './MoholeKit';

const D2R = Math.PI / 180;
export const polar = (deg: number, r: number): [number, number] => [Math.cos(deg * D2R) * r, Math.sin(deg * D2R) * r];
export const POST_DEG = 148, POST_R = 0.68;
export const MAST_TOP = 0.5;

export type LavaScene = {rocks: THREE.BufferGeometry; spatter?: THREE.BufferGeometry; post: THREE.BufferGeometry; spin?: THREE.BufferGeometry; beacons: LavaBeacon[]; postPos: [number, number]; mastTop: number};
const cache: Record<string, LavaScene> = {};
export function lavaScene(full: boolean): LavaScene { return (cache[full ? 'full' : 'lite'] ??= build(full)); }

function build(F: boolean): LavaScene {
  let k = 11; const rnd = () => { k = (Math.imul(k, 1664525) + 1013904223) | 0; return (k >>> 0) / 4294967296; };
  const beacons: LavaBeacon[] = [];
  const rocks = new Parts();
  const spat = F ? new Parts() : rocks;

  // basalt columns: a standing cluster, tallest toward the middle, plus fallen ones
  const colCount = F ? 30 : 14;
  for (let i = 0; i < colCount; i++) {
    const a = 222 + (rnd() - 0.5) * 70, r = 0.58 + rnd() * 0.2 + Math.abs(a - 222) * 0.0007;
    const [x, z] = polar(a, r);
    const mid = 1 - Math.abs(a - 222) / 36;
    const h = 0.05 + mid * 0.11 + rnd() * 0.06, rad = 0.026 + rnd() * 0.014;
    const seg = F ? 6 : 6;
    const tilt = (rnd() - 0.5) * 0.12;
    const col = ['#2b2a31', '#35333b', '#252429', '#403b3f'][i % 4];
    put(rocks, cylG(seg), {x, y: h / 2 - 0.004, z, sx: rad, sy: h, sz: rad, ry: rnd() * 1.0, rx: tilt, rz: tilt * 0.7}, col, {vary: 0.18});
    if (F && rnd() > 0.55) bx(rocks, x, h - 0.002, z, rad * 1.1, 0.004, rad * 1.1, '#ff6a1a', {glow: 0.8, ry: 0.5});  // a hot top
  }
  for (let i = 0; i < (F ? 4 : 2); i++) {
    const a = 205 + i * 28, r = 0.74 + (i % 2) * 0.04; const [x, z] = polar(a, r);
    put(rocks, cylG(6), {x, y: 0.03, z, sx: 0.03, sy: 0.13, sz: 0.03, rz: Math.PI / 2, ry: a * D2R + 0.4}, '#2e2c33', {vary: 0.18});
  }
  // glowing seams at the foot of the columns
  if (F) for (let i = 0; i < 9; i++) { const a = 205 + i * 5.5, r = 0.56 + rnd() * 0.05; const [x, z] = polar(a, r); bx(rocks, x, 0.012, z, 0.07, 0.004, 0.012, '#ff5a14', {glow: 1.1, ry: -a * D2R}); }
  // spatter and bombs on the cone flanks, and a hot ring round the crater lip
  const bombs = F ? 70 : 28;
  for (let i = 0; i < bombs; i++) {
    const a = rnd() * 360, r = 0.1 + Math.pow(rnd(), 0.8) * (RC - 0.04); const [x, z] = polar(a, r);
    const hot = rnd() > 0.55;
    rock(spat, x, coneHeight(r) - 0.006, z, 0.008 + rnd() * 0.012, hot ? '#ff7a22' : '#2a2025', rnd, {glow: hot ? 1.0 : 0});
  }
  for (let i = 0; i < (F ? 26 : 12); i++) {
    const a = (i / (F ? 26 : 12)) * 360 + rnd() * 8, r = 0.098 + rnd() * 0.01; const [x, z] = polar(a, r);
    rock(spat, x, coneHeight(r) - 0.004, z, 0.013 + rnd() * 0.008, i % 3 ? '#e8541a' : '#3a2a28', rnd, {glow: i % 3 ? 1.3 : 0.2});
  }
  // boulders strewn across the flows
  const boulders = F ? 46 : 20;
  for (let i = 0; i < boulders; i++) {
    const a = rnd() * 360, r = 0.42 + rnd() * 0.42; const [x, z] = polar(a, r);
    if (Math.abs(a - POST_DEG) < 18 && r > 0.55) continue;
    rock(rocks, x, 0.0, z, 0.012 + rnd() * 0.022, rnd() > 0.7 ? '#4a3a36' : '#2a2a30', rnd);
  }

  // ---------------------------------------------------------------- monitoring post
  const post = new Parts();
  const [px, pz] = polar(POST_DEG, POST_R);
  const steel = '#b9bcc4', dk = '#2b2d33';
  bxb(post, px, 0, pz, 0.17, 0.02, 0.17, '#8c8a85');
  bxb(post, px, 0.02, pz, 0.15, 0.004, 0.15, '#4a4d55');
  // tripod legs and mast
  for (const [dx, dz] of [[1, 0.6], [-1, 0.6], [0, -1.2]] as Array<[number, number]>) bar(post, [px + dx * 0.065, 0.022, pz + dz * 0.065], [px + dx * 0.008, 0.2, pz + dz * 0.008], 0.008, '#8c9099');
  tube(post, [px, 0.02, pz], [px, MAST_TOP - 0.02, pz], 0.0055, steel, {seg: F ? 6 : 4});
  for (const y of [0.12, 0.26, 0.38]) bx(post, px, y, pz, 0.03, 0.006, 0.03, '#6c7078');
  // instrument shelter (white louvred box) and data logger
  bxb(post, px + 0.045, 0.07, pz - 0.035, 0.06, 0.07, 0.05, '#e9eaec', {ry: 0.3});
  if (F) for (let i = 0; i < 5; i++) bx(post, px + 0.045, 0.086 + i * 0.01, pz - 0.035, 0.062, 0.004, 0.052, '#b8bbc0', {ry: 0.3});
  bxb(post, px + 0.045, 0.14, pz - 0.035, 0.07, 0.006, 0.06, '#9a9da5', {ry: 0.3});
  bxb(post, px - 0.05, 0.022, pz + 0.04, 0.05, 0.045, 0.035, '#2d5e86', {ry: -0.4});
  bx(post, px - 0.05, 0.05, pz + 0.04 + 0.019, 0.03, 0.012, 0.004, '#9fe3ff', {ry: -0.4, glow: 0.9});
  // solar array: two panels on a frame, tilted toward the sun
  for (const s of [-1, 1]) {
    const cx = px + s * 0.065 - 0.02, cz = pz - 0.07;
    const panel = new THREE.BoxGeometry(0.1, 0.006, 0.075);
    put(post, panel, {x: cx, y: 0.115, z: cz, rx: -0.6}, '#17315a', {vary: 0.05}); panel.dispose();
    if (F) for (let i = 0; i < 4; i++) { const g = new THREE.BoxGeometry(0.1, 0.002, 0.0022); put(post, g, {x: cx, y: 0.1195 + i * 0.0018, z: cz - 0.027 + i * 0.018, rx: -0.6}, '#5b8bd0', {vary: 0.02}); g.dispose(); }
    bar(post, [cx, 0.03, cz - 0.018], [cx, 0.105, cz + 0.002], 0.006, '#8c9099');
    bar(post, [cx, 0.03, cz + 0.03], [cx, 0.13, cz + 0.032], 0.006, '#8c9099');
  }
  // antennas: a yagi with elements, a dish, a whip, and the owner banner
  const ax = px, az = pz;
  bx(post, ax, MAST_TOP - 0.1, az, 0.14, 0.006, 0.006, steel, {ry: 0.5});
  const els = F ? 5 : 3;
  for (let i = 0; i < els; i++) { const t = (i / (els - 1) - 0.5) * 0.12; bx(post, ax + Math.cos(0.5) * t, MAST_TOP - 0.1, az - Math.sin(0.5) * t, 0.003, 0.003, 0.05 - i * 0.004, '#d3d6dc', {ry: 0.5}); }
  { const dish = new THREE.SphereGeometry(0.04, F ? 10 : 6, F ? 5 : 3, 0, Math.PI * 2, 0, 1.15); put(post, dish, {x: ax, y: MAST_TOP - 0.2, z: az + 0.0, rx: -0.7, ry: 2.2, sy: 0.55}, '#eceef1'); dish.dispose();
    tube(post, [ax, MAST_TOP - 0.19, az], [ax - 0.02, MAST_TOP - 0.16, az - 0.03], 0.002, '#6c7078', {seg: 4}); }
  tube(post, [ax + 0.012, MAST_TOP - 0.04, az], [ax + 0.012, MAST_TOP + 0.06, az], 0.0018, steel, {seg: 4});
  // owner banner on a short yard arm, plus a lit panel on the shelter
  bx(post, ax - 0.012, MAST_TOP - 0.06, az, 0.024, 0.003, 0.003, steel);
  bx(post, ax - 0.036, MAST_TOP - 0.083, az, 0.05, 0.04, 0.003, '#fff', {owner: 1, glow: 0.6});
  bxb(post, px + 0.045, 0.036, pz - 0.035 + 0.027, 0.05, 0.014, 0.003, '#fff', {owner: 1, glow: 0.7, ry: 0.3});
  { const o = new THREE.IcosahedronGeometry(0.014, F ? 1 : 0); put(post, o, {x: ax, y: MAST_TOP + 0.015, z: az}, '#fff', {owner: 1, glow: 1.8, vary: 0}); o.dispose(); }
  beacons.push([ax, MAST_TOP + 0.04, az, 1]);
  beacons.push([ax + 0.012, MAST_TOP + 0.062, az, 0]);
  beacons.push([px + 0.045, 0.16, pz - 0.035, 0]);
  // seismometer dome on a concrete plinth, cabled to the mast, with a warning post
  const [sx, sz] = [px - 0.075, pz - 0.03];
  cy(post, sx, 0.024, sz, 0.026, 0.008, '#8c8a85', {seg: F ? 10 : 6});
  { const d = new THREE.SphereGeometry(0.022, F ? 10 : 6, F ? 5 : 3, 0, Math.PI * 2, 0, Math.PI / 2); put(post, d, {x: sx, y: 0.028, z: sz}, '#d6d8dc'); d.dispose(); }
  if (F) { tube(post, [sx + 0.02, 0.026, sz], [px, 0.03, pz], 0.0025, '#17181b', {seg: 4}); tube(post, [px - 0.05, 0.03, pz + 0.04], [px, 0.03, pz], 0.0025, '#17181b', {seg: 4}); }
  // hazard-striped bollards round the pad
  for (let i = 0; i < (F ? 6 : 3); i++) { const a = (i / (F ? 6 : 3)) * Math.PI * 2 + 0.3; cy(post, px + Math.cos(a) * 0.1, 0.014 + 0.02, pz + Math.sin(a) * 0.1, 0.005, 0.04, i % 2 ? '#e6b422' : '#2b2d33', {seg: 5}); }

  let spin: THREE.BufferGeometry | undefined;
  const cups = new Parts();
  const addCups = (p: Parts, ox: number, oy: number, oz: number) => {
    cyTaper(p, ox, oy, oz, 0.003, 0.003, 0.02, '#6c7078', {seg: 4});
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      tube(p, [ox, oy, oz], [ox + Math.cos(a) * 0.04, oy, oz + Math.sin(a) * 0.04], 0.0015, '#8c9099', {seg: 4});
      const c = new THREE.SphereGeometry(0.011, F ? 6 : 4, F ? 4 : 3, 0, Math.PI * 2, 0, Math.PI / 2);
      put(p, c, {x: ox + Math.cos(a) * 0.04, y: oy, z: oz + Math.sin(a) * 0.04, rx: Math.PI / 2, ry: -a + 1.57}, '#e8e9ec'); c.dispose();
    }
  };
  if (F) { addCups(cups, 0, 0, 0); spin = cups.build(); } else addCups(post, ax - 0.0, MAST_TOP + 0.0, az);

  return {rocks: rocks.build(), spatter: F ? (spat as Parts).build() : undefined, post: post.build(), spin, beacons, postPos: [px, pz], mastTop: MAST_TOP};
}
const CYL: Record<number, THREE.CylinderGeometry> = {};
function cylG(seg: number) { return (CYL[seg] ??= new THREE.CylinderGeometry(1, 1, 1, seg, 1)); }
void bar;
