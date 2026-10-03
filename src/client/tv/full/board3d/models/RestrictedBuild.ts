// Private builders for RestrictedArea.tsx: ground texture, merged compound geometry (per owner colour), radar dish,
// searchlight beam and glow points.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {canvasTexture, GlowSet, hexGrid, mergeParts, type Part} from './NuclearGeo';

const TAU = Math.PI * 2;
export const FENCE_R = 0.88;
export const TOWER_AT: [number, number] = [0.56, -0.4];
export const TOWER_H = 0.7;
export const BEAM_LEN = 0.78;
/** direction (about y) from the searchlight tower to the middle of the compound */
export const BEAM_AIM = Math.atan2(-TOWER_AT[0], -TOWER_AT[1]);
export const RADAR_AT: [number, number] = [0.3, 0.24];
export const RADAR_Y = 0.5;
export const MAST_AT: [number, number] = [-0.64, 0.1];
export const MAST_H = 0.86;
const FLOODS: Array<[number, number]> = [[0.7, 0.4], [-0.68, -0.45], [0.2, -0.72], [-0.6, 0.62]];
const HANGAR = {x: -0.3, z: -0.3};
const HELIPAD = {x: -0.36, z: 0.4, r: 0.16};

let shared: ReturnType<typeof makeShared> | null = null;
export function restrictedAssets() { return (shared ??= makeShared()); }
const perOwner = new Map<string, {structures: THREE.BufferGeometry; glow: THREE.BufferGeometry; pools: THREE.BufferGeometry}>();
export function restrictedOwner(owner: string) {
  let o = perOwner.get(owner);
  if (!o) { o = {structures: structures(owner), glow: glow(owner), pools: pools(owner)}; perOwner.set(owner, o); }
  return o;
}

function rnd(seed: number) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** The fence posts around the hex, in order, minus the gate gap at the +z vertex. */
function fencePosts(): Array<{x: number; z: number; i: number; n: number}> {
  const pts: Array<[number, number]> = [];
  for (let e = 0; e < 6; e++) {
    const a0 = Math.PI / 6 + (e * Math.PI) / 3, a1 = a0 + Math.PI / 3;
    for (let k = 0; k < 5; k++) {
      const t = k / 5;
      pts.push([(Math.cos(a0) * (1 - t) + Math.cos(a1) * t) * FENCE_R, (Math.sin(a0) * (1 - t) + Math.sin(a1) * t) * FENCE_R]);
    }
  }
  const n = pts.length;
  return pts.map(([x, z], i) => ({x, z, i, n})).filter((p) => !(p.z > 0.6 && Math.abs(p.x) < 0.14));
}

function structures(owner: string): THREE.BufferGeometry {
  const parts: Part[] = [];
  const box = (w: number, h: number, d: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; };
  const cyl = (rt: number, rb: number, h: number, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, h / 2, 0); return g; };
  const DROP = -0.9;
  // ---- fence: posts rise in a ripple round the perimeter, rails follow ----
  const posts = fencePosts();
  const post = cyl(0.007, 0.009, 0.1, 5), cap = cyl(0.014, 0.014, 0.012, 6);
  for (const p of posts) {
    const d = 0.05 + (p.i / p.n) * 0.95;
    parts.push({g: post, c: '#59616a', p: [p.x, 0, p.z], f: 0.2, d});
    parts.push({g: cap, c: owner, p: [p.x, 0.1, p.z], f: 0.2, d});
    const q = posts.find((o) => o.i === p.i + 1) ?? (p.i === p.n - 1 ? posts.find((o) => o.i === 0) : undefined);
    if (!q) continue;
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    if (len > 0.3) continue;
    const rail = new THREE.BoxGeometry(0.007, 0.007, len);
    for (const y of [0.04, 0.078]) parts.push({g: rail, c: '#7a828a', p: [(p.x + q.x) / 2, y, (p.z + q.z) / 2], r: [0, ang, 0], f: 0.2, d: d + 0.02});
  }
  // gate: two pylons and a striped barrier arm
  for (const s of [-1, 1]) {
    parts.push({g: box(0.035, 0.14, 0.035), c: '#2f343a', p: [s * 0.14, 0, 0.86], f: 0.2, d: 0.9});
    parts.push({g: cyl(0.02, 0.02, 0.012, 8), c: owner, p: [s * 0.14, 0.14, 0.86], f: 0.2, d: 0.9});
  }
  parts.push({g: box(0.1, 0.012, 0.012), c: '#d8d8d4', p: [-0.05, 0.075, 0.86], f: DROP, d: 1.3});
  for (let k = 0; k < 3; k++) parts.push({g: box(0.016, 0.014, 0.014), c: '#d4382c', p: [-0.095 + k * 0.04, 0.075, 0.86], f: DROP, d: 1.3});
  // ---- hangar: walls, vaulted roof, ribs, owner stripe, dark doors ----
  const H = HANGAR, hl = 0.52, hw = 0.34, wall = 0.14, rr = hw / 2, ry = 1.4;
  parts.push({g: box(hl, wall, hw), c: '#9aa3ab', p: [H.x, 0, H.z], f: DROP, d: 0.5});
  const roof = new THREE.CylinderGeometry(rr, rr, hl, 22, 1, false, 0, Math.PI); roof.rotateZ(Math.PI / 2); roof.scale(1, ry, 1);
  parts.push({g: roof, c: '#c9d0d6', p: [H.x, wall, H.z], f: DROP, d: 0.5});
  const rib = new THREE.TorusGeometry(rr * 1.01, 0.007, 4, 14, Math.PI); rib.rotateY(Math.PI / 2); rib.scale(1, ry, 1);
  for (let k = 0; k < 6; k++) parts.push({g: rib, c: '#6f7880', p: [H.x - hl / 2 + 0.03 + (k * (hl - 0.06)) / 5, wall, H.z], f: DROP, d: 0.5});
  parts.push({g: box(hl + 0.01, 0.012, 0.035), c: owner, p: [H.x, wall + rr * ry - 0.004, H.z], f: DROP, d: 0.55});
  parts.push({g: box(0.003, 0.2, hw * 0.6), c: '#1b1f24', p: [H.x + hl / 2 + 0.002, 0, H.z], f: DROP, d: 0.5});
  // lit open doors on the front: warm interior with a dark frame
  parts.push({g: box(hw * 0.7, 0.215, 0.003), c: '#1b1f24', p: [H.x, 0, H.z + hw / 2 + 0.0012], f: DROP, d: 0.5});
  parts.push({g: box(hw * 0.62, 0.2, 0.003), c: '#ffc977', p: [H.x, 0, H.z + hw / 2 + 0.0032], f: DROP, d: 0.5});
  // windows along the long wall
  for (let k = 0; k < 5; k++) parts.push({g: box(0.05, 0.04, 0.003), c: '#ffe6a0', p: [H.x - 0.2 + k * 0.1, 0.06, H.z - hw / 2 - 0.0015], f: DROP, d: 0.5});
  // ---- guard towers: legs, cab, owner roof ----
  const tower = (x: number, z: number, h: number, d: number, tilt = 0.06) => {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const leg = cyl(0.008, 0.011, h, 5);
      parts.push({g: leg, c: '#4a5058', p: [x + sx * 0.032, 0, z + sz * 0.032], r: [-sz * tilt, 0, sx * tilt], f: DROP, d});
    }
    parts.push({g: box(0.1, 0.012, 0.1), c: '#3d4349', p: [x, h, z], f: DROP, d});
    parts.push({g: box(0.08, 0.06, 0.08), c: '#6b737b', p: [x, h + 0.012, z], f: DROP, d});
    parts.push({g: box(0.081, 0.022, 0.081), c: '#15262e', p: [x, h + 0.03, z], f: DROP, d});
    const roofG = new THREE.ConeGeometry(0.075, 0.05, 4); roofG.rotateY(Math.PI / 4);
    parts.push({g: roofG, c: owner, p: [x, h + 0.097, z], f: DROP, d});
  };
  tower(TOWER_AT[0], TOWER_AT[1], TOWER_H, 0.9, 0.0);
  tower(-0.6, 0.5, 0.42, 1.1);
  tower(0.62, 0.4, 0.4, 1.2);
  // ---- radar block + mast (the dish itself spins in its own mesh) ----
  parts.push({g: box(0.2, 0.14, 0.18), c: '#aab2b9', p: [RADAR_AT[0], 0, RADAR_AT[1]], f: DROP, d: 1.0});
  parts.push({g: box(0.205, 0.014, 0.185), c: owner, p: [RADAR_AT[0], 0.14, RADAR_AT[1]], f: DROP, d: 1.0});
  parts.push({g: cyl(0.016, 0.03, RADAR_Y - 0.154 - 0.03, 8), c: '#6b737b', p: [RADAR_AT[0], 0.154, RADAR_AT[1]], f: DROP, d: 1.0});
  parts.push({g: cyl(0.03, 0.03, 0.03, 8), c: owner, p: [RADAR_AT[0], RADAR_Y - 0.05, RADAR_AT[1]], f: DROP, d: 1.0});
  // ---- comms mast: tapered lattice with cross arms and a small dish ----
  parts.push({g: cyl(0.006, 0.02, MAST_H, 6), c: '#8a929a', p: [MAST_AT[0], 0, MAST_AT[1]], f: DROP, d: 1.15});
  parts.push({g: cyl(0.045, 0.05, 0.03, 8), c: '#4a5058', p: [MAST_AT[0], 0, MAST_AT[1]], f: DROP, d: 1.15});
  for (const [y, w] of [[0.3, 0.1], [0.5, 0.075], [0.7, 0.055]] as const) parts.push({g: box(w, 0.008, 0.008), c: '#c9ced3', p: [MAST_AT[0], y, MAST_AT[1]], f: DROP, d: 1.2});
  parts.push({g: cyl(0.02, 0.02, 0.012, 8), c: owner, p: [MAST_AT[0], 0.42, MAST_AT[1]], f: DROP, d: 1.2});
  const mdish = new THREE.SphereGeometry(0.04, 10, 5, 0, TAU, 0, 1.2); mdish.rotateZ(-Math.PI / 2);
  parts.push({g: mdish, c: '#e8ecef', p: [MAST_AT[0] + 0.015, 0.6, MAST_AT[1]], f: DROP, d: 1.25});
  // floodlight poles at the corners
  for (const [x, z] of FLOODS) {
    parts.push({g: cyl(0.007, 0.01, 0.26, 5), c: '#5b636b', p: [x, 0, z], f: DROP, d: 1.0});
    parts.push({g: box(0.06, 0.02, 0.025), c: '#f4f1e6', p: [x, 0.26, z], f: DROP, d: 1.0});
  }
  // ---- containers, tank, flags ----
  const cont = box(0.16, 0.06, 0.07);
  parts.push({g: cont, c: '#7d8a95', p: [-0.02, 0, -0.64], f: DROP, d: 1.0});
  parts.push({g: cont, c: owner, p: [0.17, 0, -0.64], f: DROP, d: 1.1});
  parts.push({g: cont, c: '#a2602f', p: [0.08, 0.06, -0.64], r: [0, 0.08, 0], f: DROP, d: 1.25});
  parts.push({g: cyl(0.06, 0.06, 0.1, 14), c: '#b6bcc2', p: [0.7, 0, -0.04], f: DROP, d: 1.1});
  parts.push({g: cyl(0.062, 0.062, 0.016, 14), c: owner, p: [0.7, 0.07, -0.04], f: DROP, d: 1.1});
  for (const s of [-1, 1]) {
    parts.push({g: cyl(0.006, 0.006, 0.26, 5), c: '#d5d9dd', p: [s * 0.23, 0, 0.74], f: DROP, d: 1.3});
    parts.push({g: box(0.07, 0.045, 0.004), c: owner, p: [s * 0.23 + 0.037, 0.2, 0.74], f: DROP, d: 1.35});
  }
  return mergeParts(parts);
}

/** Soft additive ground pools: fence tips, floodlit corners, hangar doors, tower lamps (vertex colour = tint x strength). */
function pools(owner: string): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const quad = (x: number, z: number, rx: number, rz: number, color: string, k: number) => {
    c.set(color); const n = pos.length / 3;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x + u * rx, 0.005, z + v * rz); col.push(c.r * k, c.g * k, c.b * k); uv.push(u, v); }
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
  };
  for (const p of fencePosts()) quad(p.x, p.z, 0.1, 0.1, owner, 0.55);
  for (const [x, z] of FLOODS) quad(x, z, 0.3, 0.3, '#fff0cc', 0.8);
  quad(HANGAR.x, HANGAR.z + 0.4, 0.3, 0.26, '#ffb85a', 1.0);
  quad(HANGAR.x, HANGAR.z - 0.34, 0.3, 0.12, '#ffc870', 0.4);
  quad(HELIPAD.x, HELIPAD.z, 0.24, 0.24, '#bfe0ff', 0.45);
  quad(-0.6, 0.5, 0.18, 0.18, '#ffd98a', 0.5); quad(0.62, 0.4, 0.18, 0.18, '#ffd98a', 0.5);
  quad(0, 0.9, 0.2, 0.15, '#ff9a8a', 0.3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

function glow(owner: string): THREE.BufferGeometry {
  const s = new GlowSet();
  const posts = fencePosts();
  for (const p of posts) s.add(p.x, 0.108, p.z, owner, 0.07, 1, {phase: p.i / p.n, speed: 6.283 / 3.6 * 3 * 0 + 1.75, delay: 0.4 + (p.i / p.n) * 0.95});
  for (const sx of [-1, 1]) s.add(sx * 0.14, 0.155, 0.86, sx < 0 ? '#ff3b30' : '#3bff7a', 0.1, 0, {delay: 1.0});
  const lamp = (x: number, z: number, h: number, d: number) => s.add(x, h + 0.04, z, '#ffd98a', 0.16, 0, {delay: d});
  lamp(TOWER_AT[0], TOWER_AT[1], TOWER_H, 1.2); lamp(-0.6, 0.5, 0.3, 1.3); lamp(0.62, 0.4, 0.28, 1.4);
  s.add(TOWER_AT[0], TOWER_H + 0.16, TOWER_AT[1], '#ff3b30', 0.11, 1, {phase: 0.2, speed: 3.3, delay: 1.3});
  s.add(TOWER_AT[0], TOWER_H + 0.04, TOWER_AT[1] , '#fff0c8', 0.3, 0, {delay: 1.6}); // searchlight source
  s.add(RADAR_AT[0], RADAR_Y + 0.07, RADAR_AT[1], '#ff3b30', 0.1, 1, {phase: 0.5, speed: 2.4, delay: 1.5});
  // comms mast: blinking red lights up its length
  [[MAST_H + 0.02, 0.0, 0.16], [0.7, 0.33, 0.11], [0.5, 0.66, 0.1], [0.3, 0.99, 0.09]].forEach(([y, ph, sz], i) => s.add(MAST_AT[0], y, MAST_AT[1], '#ff3326', sz, 1, {phase: ph, speed: 2.6, delay: 1.3 + i * 0.05}));
  // hangar: door glow, lit windows and interior
  s.add(HANGAR.x, 0.1, HANGAR.z + 0.17, '#ffb957', 0.4, 0, {delay: 1.0});
  s.add(HANGAR.x + 0.14, 0.09, HANGAR.z + 0.18, '#ffc874', 0.2, 0, {delay: 1.0});
  s.add(HANGAR.x - 0.14, 0.09, HANGAR.z + 0.18, '#ffc874', 0.2, 0, {delay: 1.0});
  for (let k = 0; k < 5; k++) s.add(HANGAR.x - 0.2 + k * 0.1, 0.08, HANGAR.z - 0.18, '#ffd58a', 0.1, 0, {delay: 1.0});
  // floodlit corners
  for (const [x, z] of FLOODS) s.add(x, 0.25, z, '#fff3d0', 0.28, 0, {delay: 1.1});
  // helipad edge lights
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; s.add(HELIPAD.x + Math.cos(a) * HELIPAD.r * 1.08, 0.014, HELIPAD.z + Math.sin(a) * HELIPAD.r * 1.08, '#cfe9ff', 0.085, 1, {phase: k / 12, speed: 3.0, delay: 1.1}); }
  return s.build();
}

function makeShared() {
  const S = 1024, px = (v: number) => ((v + 1) / 2) * S;
  const map = canvasTexture(S, (g) => {
    g.fillStyle = '#41454c'; g.fillRect(0, 0, S, S);
    const r = rnd(11);
    for (let i = 0; i < 9000; i++) { const v = 50 + r() * 50; g.fillStyle = `rgba(${v},${v + 3},${v + 8},${0.15 + r() * 0.25})`; g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3); }
    // slab seams
    g.strokeStyle = 'rgba(190,200,215,0.16)'; g.lineWidth = 2;
    for (let k = -4; k <= 4; k++) { g.beginPath(); g.moveTo(px(k * 0.25), 0); g.lineTo(px(k * 0.25), S); g.stroke(); g.beginPath(); g.moveTo(0, px(k * 0.25)); g.lineTo(S, px(k * 0.25)); g.stroke(); }
    // tyre marks and oil stains
    for (let i = 0; i < 16; i++) { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, 'rgba(30,32,36,0.35)'); gr.addColorStop(1, 'rgba(30,32,36,0)'); g.save(); g.translate(r() * S, r() * S); g.scale(10 + r() * 30, 10 + r() * 20); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); }
    // yellow safety line just inside the fence
    g.strokeStyle = '#ffd42a'; g.lineWidth = 7; g.beginPath();
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; const x = px(Math.cos(a) * 0.8), y = px(Math.sin(a) * 0.8); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    // road from the gate to the compound centre, dashed
    g.fillStyle = '#25272b'; g.fillRect(px(-0.1), px(0.12), px(0.1) - px(-0.1), px(1) - px(0.12));
    g.fillStyle = '#fffbea'; for (let z = 0.2; z < 0.95; z += 0.12) g.fillRect(px(0) - 3, px(z), 6, 36);
    // helipad
    const hx = px(HELIPAD.x), hz = px(HELIPAD.z), hr = (HELIPAD.r / 2) * S;
    g.fillStyle = '#1f2125'; g.beginPath(); g.arc(hx, hz, hr * 1.15, 0, TAU); g.fill();
    g.strokeStyle = '#fffbea'; g.lineWidth = 9; g.beginPath(); g.arc(hx, hz, hr, 0, TAU); g.stroke();
    g.fillStyle = '#fffbea'; g.font = `bold ${hr * 1.3}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', hx, hz + 3);
    // hangar apron and a hazard-striped keep-out zone
    g.fillStyle = 'rgba(18,20,24,0.6)'; g.fillRect(px(HANGAR.x - 0.34), px(HANGAR.z - 0.2), px(HANGAR.x + 0.34) - px(HANGAR.x - 0.34), px(HANGAR.z + 0.42) - px(HANGAR.z - 0.2));
    g.save(); g.beginPath(); g.rect(px(HANGAR.x - 0.3), px(HANGAR.z + 0.24), px(HANGAR.x + 0.3) - px(HANGAR.x - 0.3), 12); g.clip();
    for (let k = -20; k < 60; k++) { g.fillStyle = k % 2 ? '#ffd42a' : '#15171a'; g.beginPath(); g.moveTo(px(HANGAR.x - 0.3) + k * 14, px(HANGAR.z + 0.24) + 12); g.lineTo(px(HANGAR.x - 0.3) + k * 14 + 14, px(HANGAR.z + 0.24) + 12); g.lineTo(px(HANGAR.x - 0.3) + k * 14 + 26, px(HANGAR.z + 0.24)); g.lineTo(px(HANGAR.x - 0.3) + k * 14 + 12, px(HANGAR.z + 0.24)); g.fill(); }
    g.restore();
    // "RESTRICTED" stencil near the gate
    g.save(); g.translate(px(0.4), px(0.64)); g.fillStyle = 'rgba(255,212,42,0.95)'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('KEEP OUT', 0, 0); g.restore();
  });
  const ground = hexGrid(1, 12, () => 0.003, 0.985);
  const groundMat = new THREE.MeshStandardMaterial({map, roughness: 0.82, metalness: 0.05});

  // radar dish: a shallow cap, a feed arm and the feed horn, in group space (the mesh spins about y)
  const cap = new THREE.SphereGeometry(0.2, 28, 8, 0, TAU, 0, 0.62); cap.scale(1, 0.6, 1); cap.rotateX(0.6);
  const arm = new THREE.CylinderGeometry(0.005, 0.005, 0.17, 5); arm.rotateX(Math.PI / 2 - 0.55); arm.translate(0, 0.07, 0.1);
  const horn = new THREE.SphereGeometry(0.014, 8, 6); horn.translate(0, 0.14, 0.17);
  const post = new THREE.CylinderGeometry(0.012, 0.016, 0.07, 6); post.translate(0, -0.03, 0);
  cap.translate(0, 0.03, 0.05);
  for (const g of [cap, arm, horn, post]) g.deleteAttribute('uv');
  const dish = mergeGeometries([cap, arm, horn, post], false)!;
  const dishMat = new THREE.MeshStandardMaterial({color: '#f1f4f6', roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide});

  // searchlight: cone (apex at the lamp) plus a pool of light where it lands, baked in the sweeping group's space
  const ang = Math.atan2(BEAM_LEN, TOWER_H + 0.05);
  const L = Math.hypot(BEAM_LEN, TOWER_H + 0.05);
  const cone = new THREE.ConeGeometry(0.15, L, 24, 1, true); cone.translate(0, -L / 2, 0); cone.rotateX(-ang);
  const pool = new THREE.CircleGeometry(0.16, 24); pool.rotateX(-Math.PI / 2); pool.scale(1, 1, 1.7); pool.translate(0, -(TOWER_H + 0.05) + 0.004, BEAM_LEN);
  const kind = (g: THREE.BufferGeometry, k: number) => { g.deleteAttribute('uv'); g.setAttribute('aK', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1)); };
  kind(cone, 0); kind(pool, 1);
  const beam = mergeGeometries([cone, pool], false)!;
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {uNight: {value: 0}},
    vertexShader: `attribute float aK; varying float vK; varying vec3 vN; varying vec3 vV; varying float vT; varying vec2 vPool;
      void main(){ vK=aK; vT=length(position)/${L.toFixed(3)}; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=-mv.xyz;
        vPool=(position.xz-vec2(0.,${BEAM_LEN.toFixed(3)}))/vec2(.16,.272); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uNight; varying float vK; varying vec3 vN; varying vec3 vV; varying float vT; varying vec2 vPool;
      void main(){
        float k=mix(.3,1.,uNight); vec3 c=vec3(1.,.93,.75);
        float a;
        if (vK<.5) { float e=pow(abs(dot(normalize(vN),normalize(vV))),1.2); a=e*(1.-vT)*.2*k+.35*k*pow(1.-vT,6.); }
        else { a=(1.-smoothstep(0.,1.,length(vPool)))*.34*k; }
        gl_FragColor=vec4(c*a,1.);
      }`,
  });
  const poolMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: {uNight: {value: 0}},
    vertexShader: `attribute vec2 aUv; varying vec2 vU; varying vec3 vC; void main(){ vU=aUv; vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uNight; varying vec2 vU; varying vec3 vC; void main(){ float r=length(vU); float a=pow(clamp(1.-r,0.,1.),2.2); gl_FragColor=vec4(vC*a*mix(.12,1.,uNight),1.); }`,
  });
  return {ground, groundMat, dish, dishMat, beam, beamMat, poolMat};
}
