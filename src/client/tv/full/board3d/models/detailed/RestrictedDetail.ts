// Builders for the Detailed Restricted Area: ground canvas, double chain-link fence, merged compound geometry (hangar with
// a stealth craft nosing out, radar, masts, guard towers, gate, vehicles, tiny people), the helicopter, the searchlight
// and ground-light mesh and the glow points. Unit space (hex circumradius 1).
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  box, canvasTexture, cone, cyl, type DPart, GlowSet, hexGrid, mergeD, noiseDots, rnd, sph, strut, TAU, torus,
} from './NuclearKit';

type V3 = [number, number, number];
export const FENCE_OUT = 0.96, FENCE_IN = 0.84;
const GATE_HALF = 0.1;
export const TOWER_SPOTS: Array<{x: number; z: number; light: boolean; aimX: number; aimZ: number}> = [
  {x: 0.727, z: 0.42, light: false, aimX: 0, aimZ: 0}, {x: -0.727, z: 0.42, light: true, aimX: 0.2, aimZ: -0.1},
  {x: -0.727, z: -0.42, light: false, aimX: 0, aimZ: 0}, {x: 0.727, z: -0.42, light: true, aimX: -0.2, aimZ: 0.15},
];
export const TOWER_H = 0.4;
const HANGAR = {x: -0.2, z: -0.4, len: 0.46, dep: 0.28, h: 0.1};
const RADAR = {x: 0.36, z: -0.32};
const MASTS: Array<{x: number; z: number; h: number}> = [{x: -0.6, z: 0.0, h: 0.95}, {x: 0.6, z: 0.12, h: 0.72}, {x: 0.12, z: -0.64, h: 0.58}];
export const PAD = {x: -0.3, z: 0.36, r: 0.15};
export const HELI_C = {x: -0.05, z: 0.0, r: Math.hypot(PAD.x + 0.05, PAD.z)};
const FLOODS: Array<[number, number]> = [[0.5, 0.62], [-0.5, -0.66], [0.62, -0.1], [-0.62, 0.7]];
const C = {
  conc: '#a9adb1', concD: '#7a8087', steel: '#6b737b', steelD: '#383e45', black: '#17191c', white: '#e8ebee', glass: '#ffd9a0',
  glassB: '#9fd8ff', red: '#d9382e', yellow: '#e8b81d', olive: '#4d5a45', tan: '#9a8a6a', gun: '#2b3138', gunL: '#46505a', orange: '#d9772a',
};

/** the fence posts of one hex ring, with a gate gap at the +z vertex */
function ringPosts(R: number, per: number): Array<{x: number; z: number; i: number; n: number; yaw: number}> {
  const pts: Array<{x: number; z: number; yaw: number}> = [];
  for (let e = 0; e < 6; e++) {
    const a0 = Math.PI / 6 + e * Math.PI / 3, a1 = a0 + Math.PI / 3;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      pts.push({x: (Math.cos(a0) * (1 - t) + Math.cos(a1) * t) * R, z: (Math.sin(a0) * (1 - t) + Math.sin(a1) * t) * R, yaw: Math.atan2(Math.cos(a1) - Math.cos(a0), -(Math.sin(a1) - Math.sin(a0)))});
    }
  }
  const n = pts.length;
  return pts.map((p, i) => ({...p, i, n})).filter((p) => !(p.z > R * 0.75 && Math.abs(p.x) < GATE_HALF + 0.02));
}
const frame = (x: number, z: number, yaw: number) => { const c = Math.cos(yaw), s = Math.sin(yaw); return (l: V3): V3 => [x + l[0] * c + l[2] * s, l[1], z - l[0] * s + l[2] * c]; };

let cache: ReturnType<typeof makeShared> | null = null;
export function restrictedAssets() { return (cache ??= makeShared()); }

function makeShared() {
  const S = 2048, px = (v: number) => ((v + 1) / 2) * S, pr = (v: number) => (v / 2) * S;
  const map = canvasTexture(S, (g) => {
    g.fillStyle = '#4a4e55'; g.fillRect(0, 0, S, S);
    const r = rnd(11);
    noiseDots(g, S, r, 30000, [80, 84, 92], 0.12, 0.36, 3);
    // slab seams
    g.strokeStyle = 'rgba(15,17,20,0.5)'; g.lineWidth = 2;
    for (let k = -5; k <= 5; k++) { const v = px(k * 0.2); g.beginPath(); g.moveTo(v, 0); g.lineTo(v, S); g.stroke(); g.beginPath(); g.moveTo(0, v); g.lineTo(S, v); g.stroke(); }
    g.strokeStyle = 'rgba(200,210,225,0.06)'; for (let k = -5; k <= 5; k++) { const v = px(k * 0.2) + 3; g.beginPath(); g.moveTo(v, 0); g.lineTo(v, S); g.stroke(); g.beginPath(); g.moveTo(0, v); g.lineTo(S, v); g.stroke(); }
    // oil stains and tyre marks
    for (let i = 0; i < 40; i++) { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, 'rgba(20,22,26,0.4)'); gr.addColorStop(1, 'rgba(20,22,26,0)'); g.save(); g.translate(r() * S, r() * S); g.scale(12 + r() * 38, 10 + r() * 24); g.rotate(r() * 3); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); }
    // outer verge between the fences: gravel strip
    g.lineJoin = 'round';
    const hexPath = (R: number) => { g.beginPath(); for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; const x = px(Math.cos(a) * R), y = px(Math.sin(a) * R); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    hexPath(0.98); g.fillStyle = '#5b5446'; g.fill(); hexPath(0.8); g.fillStyle = '#464a51'; g.fill();
    noiseDots(g, S, r, 12000, [110, 100, 82], 0.2, 0.5, 2);
    // safety line inside the inner fence, and the outer kerb
    hexPath(0.8); g.lineWidth = 8; g.strokeStyle = '#e6c12a'; g.setLineDash([26, 18]); g.stroke(); g.setLineDash([]);
    hexPath(0.985); g.lineWidth = 6; g.strokeStyle = '#1c1f23'; g.stroke();
    // road from the gate to the centre, dashed
    g.fillStyle = '#25272b'; g.fillRect(px(-0.1), px(0.0), px(0.1) - px(-0.1), px(1) - px(0.0));
    g.fillStyle = '#e8e6d4'; for (let z = 0.1; z < 0.95; z += 0.12) g.fillRect(px(0) - 3, px(z), 6, 36);
    g.fillStyle = '#d8d8d0'; g.fillRect(px(-0.1), px(0.72), px(0.1) - px(-0.1), 5); g.fillRect(px(-0.1), px(0.74), px(0.1) - px(-0.1), 5);
    // helipad
    const hx = px(PAD.x), hz = px(PAD.z), hr = pr(PAD.r);
    g.fillStyle = '#1e2024'; g.beginPath(); g.arc(hx, hz, hr * 1.2, 0, TAU); g.fill();
    g.strokeStyle = '#f0ecd8'; g.lineWidth = 9; g.beginPath(); g.arc(hx, hz, hr, 0, TAU); g.stroke();
    g.strokeStyle = '#d8b429'; g.lineWidth = 5; g.beginPath(); g.arc(hx, hz, hr * 1.13, 0, TAU); g.stroke();
    g.fillStyle = '#f0ecd8'; g.font = `bold ${hr * 1.3}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', hx, hz + 4);
    // hangar apron, hazard stripe and parking bays
    g.fillStyle = 'rgba(14,16,20,0.55)'; g.fillRect(px(HANGAR.x - 0.26), px(HANGAR.z - 0.16), pr(0.52), pr(0.52));
    g.save(); g.beginPath(); g.rect(px(HANGAR.x - 0.24), px(HANGAR.z + 0.2), pr(0.48), 14); g.clip();
    for (let k = -20; k < 80; k++) { g.fillStyle = k % 2 ? '#ffd42a' : '#15171a'; g.beginPath(); g.moveTo(px(HANGAR.x - 0.24) + k * 14, px(HANGAR.z + 0.2) + 14); g.lineTo(px(HANGAR.x - 0.24) + k * 14 + 14, px(HANGAR.z + 0.2) + 14); g.lineTo(px(HANGAR.x - 0.24) + k * 14 + 28, px(HANGAR.z + 0.2)); g.lineTo(px(HANGAR.x - 0.24) + k * 14 + 14, px(HANGAR.z + 0.2)); g.fill(); }
    g.restore();
    g.strokeStyle = '#d9d9cf'; g.lineWidth = 3; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(px(0.26 + k * 0.08), px(0.3)); g.lineTo(px(0.26 + k * 0.08), px(0.48)); g.stroke(); }
    // bunker hatch ring and stencils
    g.strokeStyle = '#e6c12a'; g.lineWidth = 7; g.beginPath(); g.arc(px(0), px(0.02), pr(0.15), 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,212,42,0.92)'; g.font = 'bold 40px sans-serif'; g.save(); g.translate(px(0.34), px(0.72)); g.rotate(-0.4); g.fillText('KEEP OUT', 0, 0); g.restore();
    g.font = 'bold 30px sans-serif'; g.fillStyle = 'rgba(240,236,216,0.85)'; g.fillText('HANGAR 7', px(HANGAR.x), px(HANGAR.z + 0.27));
    g.save(); g.translate(px(RADAR.x), px(RADAR.z + 0.2)); g.fillText('LAB B', 0, 0); g.restore();
    g.fillStyle = 'rgba(217,56,46,0.8)'; g.font = 'bold 24px sans-serif'; g.fillText('AUTHORISED ONLY', px(0), px(0.88));
  });
  const bump = canvasTexture(1024, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); const r = rnd(8);
    for (let i = 0; i < 26000; i++) { const v = 100 + r() * 60; g.fillStyle = `rgba(${v},${v},${v},${0.3 + r() * 0.4})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
    g.strokeStyle = 'rgba(30,30,30,0.9)'; g.lineWidth = 2; for (let k = -5; k <= 5; k++) { const v = ((k * 0.2 + 1) / 2) * s; g.beginPath(); g.moveTo(v, 0); g.lineTo(v, s); g.stroke(); g.beginPath(); g.moveTo(0, v); g.lineTo(s, v); g.stroke(); }
  });
  bump.colorSpace = THREE.NoColorSpace;
  const ground = hexGrid(1, 12, () => 0.003, 0.985);
  const groundMat = new THREE.MeshStandardMaterial({map, bumpMap: bump, bumpScale: 1.2, roughness: 0.78, metalness: 0.08});

  // chain-link fence texture: diamond mesh, a coil of razor wire along the top and a hint of rail
  const fenceTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(190,198,206,0.95)'; g.lineWidth = 2.4;
    for (let k = -8; k < 24; k++) { g.beginPath(); g.moveTo(k * 16, 128); g.lineTo(k * 16 + 128, 0); g.stroke(); g.beginPath(); g.moveTo(k * 16, 0); g.lineTo(k * 16 + 128, 128); g.stroke(); }
    g.clearRect(0, 0, 256, 22);
    g.strokeStyle = 'rgba(210,214,220,1)'; g.lineWidth = 3.2; g.beginPath();
    for (let x = 0; x <= 256; x += 8) { const y = 11 + Math.sin(x * 0.4) * 8; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.fillStyle = 'rgba(160,168,176,1)'; g.fillRect(0, 21, 256, 5); g.fillRect(0, 122, 256, 6);
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  })();
  const fenceGeo = (lite: boolean) => {
    const pos: number[] = [], uv: number[] = [], rip: number[] = [], idx: number[] = [];
    const addRing = (R: number, H: number, per: number) => {
      const posts = ringPosts(R, per); const byI = new Map(posts.map((p) => [p.i, p]));
      for (const p of posts) {
        const q = byI.get((p.i + 1) % p.n); if (!q || Math.hypot(q.x - p.x, q.z - p.z) > R * 0.3) continue;
        const len = Math.hypot(q.x - p.x, q.z - p.z), n = pos.length / 3, d = 0.05 + (p.i / p.n) * 0.95;
        for (const [pp, u, v] of [[p, 0, 0], [q, len * 9, 0], [q, len * 9, 1], [p, 0, 1]] as Array<[typeof p, number, number]>) { pos.push(pp.x, 0.004 + v * H, pp.z); uv.push(u, v); rip.push(d + (pp === q ? 0.02 : 0)); }
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    };
    addRing(FENCE_OUT, 0.105, 9); addRing(FENCE_IN, 0.085, 8);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aRip', new THREE.Float32BufferAttribute(rip, 1)); g.setIndex(idx);
    g.computeVertexNormals(); void lite; return g;
  };
  const fences = {full: fenceGeo(false), lite: fenceGeo(true)};
  const makeFenceMat = () => {
    const uAge = {value: 999};
    const m = new THREE.MeshStandardMaterial({map: fenceTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7, color: '#d8dde2', emissive: '#10151a'});
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uAge = uAge;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRip; uniform float uAge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float k = clamp((uAge - aRip) / 0.5, 0.0, 1.0); k = 1.0 - pow(1.0 - k, 3.0); transformed.y *= k; if (uAge < aRip) transformed.y = -1.0; }');
    };
    m.customProgramCacheKey = () => 'fence-v1';
    return {mat: m, uAge};
  };

  // ---- the structures ----
  const geoCache = new Map<string, THREE.BufferGeometry>();
  const structures = (owner: string, lite: boolean) => {
    const k = owner + lite; let g = geoCache.get(k);
    if (!g) { g = mergeD(buildParts(owner, lite), lite); geoCache.set(k, g); }
    return g;
  };
  const heliGeo = new Map<boolean, THREE.BufferGeometry>();
  const heli = (owner: string, lite: boolean) => { const k = lite; let g = heliGeo.get(k); if (!g) { g = mergeD(heliParts(owner, lite), lite); heliGeo.set(k, g); } return g; };
  const lightGeo = new Map<string, THREE.BufferGeometry>();
  const lights = (owner: string, lite: boolean) => { const k = owner + lite; let g = lightGeo.get(k); if (!g) { g = buildLights(owner, lite); lightGeo.set(k, g); } return g; };
  return {ground, groundMat, fences, makeFenceMat, structures, heli, lights};
}

// ---- structures --------------------------------------------------------------------------------------------------
function buildParts(owner: string, lite: boolean): DPart[] {
  const P: DPart[] = [];
  const add = (g: THREE.BufferGeometry, c: string | number, p: V3, o: Partial<DPart> = {}) => { P.push({g, c, p, ...o}); };
  const DROP = -0.9;
  // ---- fence posts: two rings, owner-lit caps, rails, outward arms on the outer one ----
  for (const [R, per, H, outer] of [[FENCE_OUT, 9, 0.105, true], [FENCE_IN, 8, 0.085, false]] as Array<[number, number, number, boolean]>) {
    const posts = ringPosts(R, per);
    for (const p of posts) {
      if (lite && p.i % 2) continue;
      const d = 0.05 + (p.i / p.n) * 0.95;
      add(cyl(0.0045, 0.006, H, 5), C.steel, [p.x, 0, p.z], {f: 0.2, d});
      add(box(0.014, 0.008, 0.014), owner, [p.x, H, p.z], {f: 0.2, d, gl: 1.2});
      if (outer && !lite) { const ox = Math.cos(Math.atan2(p.z, p.x)) * 0.012, oz = Math.sin(Math.atan2(p.z, p.x)) * 0.012; P.push(strut([p.x, H - 0.012, p.z], [p.x + ox, H + 0.004, p.z + oz], 0.0018, C.steel, {f: 0.2, d}, 3)); }
    }
    if (!lite) for (let e = 0; e < 6; e++) { // top rails
      const a0 = Math.PI / 6 + e * Math.PI / 3, a1 = a0 + Math.PI / 3;
      const A: V3 = [Math.cos(a0) * R, H, Math.sin(a0) * R], B: V3 = [Math.cos(a1) * R, H, Math.sin(a1) * R];
      if (e === 1 || e === 2) { // the gate vertex (+z) touches edges 0 and 1 (a=90deg is the vertex between e=0 and e=1)
        // fallthrough: shorten below
      }
      const gateE = e === 0 || e === 1;
      if (!gateE) P.push(strut(A, B, 0.0022, C.steel, {f: 0.2, d: 0.6}, 3));
      else {
        const t = (GATE_HALF + 0.02) / R / (Math.sqrt(3) / 2 * 0 + 1) * 1.0;
        const lerp = (u: number): V3 => [A[0] + (B[0] - A[0]) * u, H, A[2] + (B[2] - A[2]) * u];
        if (e === 0) P.push(strut(A, lerp(1 - t * 1.15), 0.0022, C.steel, {f: 0.2, d: 0.6}, 3)); else P.push(strut(lerp(t * 1.15), B, 0.0022, C.steel, {f: 0.2, d: 0.6}, 3));
      }
    }
  }
  // ---- gate: pylons with lights, a barrier arm, a booth, guards, flags ----
  for (const s of [-1, 1]) {
    add(box(0.04, 0.15, 0.04), C.gun, [s * 0.14, 0, 0.9], {f: 0.2, d: 0.9});
    add(box(0.044, 0.012, 0.044), owner, [s * 0.14, 0.15, 0.9], {f: 0.2, d: 0.9, gl: 0.8});
    add(box(0.008, 0.008, 0.004), s < 0 ? C.red : '#3bff7a', [s * 0.14, 0.12, 0.878], {f: 0.2, d: 0.9, gl: 1});
  }
  add(box(0.18, 0.012, 0.012), C.white, [-0.0, 0.07, 0.9], {f: DROP, d: 1.3});
  for (let k = 0; k < 4; k++) add(box(0.018, 0.013, 0.013), C.red, [-0.075 + k * 0.045, 0.07, 0.9], {f: DROP, d: 1.3});
  add(box(0.075, 0.06, 0.06), C.conc, [0.17, 0, 0.78], {f: DROP, d: 1.1});
  add(box(0.08, 0.008, 0.065), owner, [0.17, 0.06, 0.78], {f: DROP, d: 1.1});
  add(box(0.06, 0.026, 0.004), C.glass, [0.17, 0.028, 0.748], {f: DROP, d: 1.1, gl: 1});
  if (!lite) { add(box(0.004, 0.026, 0.03), C.glass, [0.1315, 0.028, 0.78], {f: DROP, d: 1.1, gl: 1}); add(box(0.03, 0.01, 0.03), C.steelD, [0.17, 0.068, 0.78], {f: DROP, d: 1.1}); }
  for (const s of [-1, 1]) { // flags on poles
    add(cyl(0.0035, 0.0035, 0.26, 5), C.white, [s * 0.25, 0, 0.8], {f: DROP, d: 1.3});
    add(box(0.075, 0.042, 0.003), owner, [s * 0.25 + 0.04, 0.2, 0.8], {f: DROP, d: 1.35, gl: 0.15});
  }
  // ---- hangar ----
  {
    const H = HANGAR, L = H.len, W = H.dep, h = H.h, t = 0.012, d = 0.5;
    const vaultG = new THREE.CylinderGeometry(0.5, 0.5, L + 0.012, lite ? 8 : 20, 1, false, 0, Math.PI); vaultG.rotateZ(Math.PI / 2); vaultG.scale(1, 2 * 0.1, W + 0.012);
    add(box(L, h, t), C.conc, [H.x, 0, H.z - W / 2 + t / 2], {f: DROP, d});
    for (const s of [-1, 1]) add(box(t, h, W), C.conc, [H.x + s * (L / 2 - t / 2), 0, H.z], {f: DROP, d});
    const open = 0.34, oh = 0.088;
    for (const s of [-1, 1]) add(box((L - open) / 2, h, t), C.conc, [H.x + s * (open / 2 + (L - open) / 4), 0, H.z + W / 2 - t / 2], {f: DROP, d});
    add(box(open, h - oh, t), C.conc, [H.x, oh, H.z + W / 2 - t / 2], {f: DROP, d});
    add(vaultG, '#bfc6cc', [H.x, h, H.z], {f: DROP, d: d + 0.05});
    add(box(L + 0.016, 0.012, 0.04), owner, [H.x, h + 0.097, H.z], {f: DROP, d: d + 0.05});
    // interior: floor, lit back wall, ceiling lamps
    add(box(L - 0.02, 0.003, W - 0.02), '#2c3036', [H.x, 0.004, H.z], {f: DROP, d});
    add(box(L - 0.03, h - 0.01, 0.003), '#d6e6ff', [H.x, 0.005, H.z - W / 2 + t + 0.002], {f: DROP, d, gl: 0.7});
    for (const s of [-1, 1]) add(box(0.003, h - 0.01, W - 0.04), '#c9dcff', [H.x + s * (L / 2 - t - 0.002), 0.005, H.z], {f: DROP, d, gl: 0.5});
    // door frame trim, owner stripe over the opening, window slits on the long wall
    add(box(open + 0.012, 0.008, 0.006), C.yellow, [H.x, oh, H.z + W / 2 + 0.002], {f: DROP, d});
    for (let k = 0; k < 6; k++) add(box(0.036, 0.016, 0.003), C.glass, [H.x - 0.17 + k * 0.068, 0.06, H.z - W / 2 - 0.0015], {f: DROP, d, gl: 1});
    if (!lite) {
      for (let k = 0; k < 7; k++) P.push({g: (() => { const g = new THREE.TorusGeometry(0.15, 0.0045, 3, 14, Math.PI); g.rotateY(Math.PI / 2); g.scale(1, 0.1 / 0.15 * 0.98, 1); return g; })(), c: C.concD, p: [H.x - L / 2 + 0.02 + k * (L - 0.04) / 6, h, H.z], f: DROP, d: d + 0.05});
      for (let k = 0; k < 3; k++) { add(cyl(0.009, 0.009, 0.02, 8), C.steelD, [H.x - 0.12 + k * 0.12, h + 0.095, H.z - 0.06], {f: DROP, d: d + 0.1}); add(cyl(0.012, 0.012, 0.004, 8), C.steel, [H.x - 0.12 + k * 0.12, h + 0.113, H.z - 0.06], {f: DROP, d: d + 0.1}); }
      add(box(0.05, 0.03, 0.04), C.concD, [H.x + L / 2 + 0.03, 0, H.z - 0.04], {f: DROP, d});
    }
    // the experimental craft: a dark flying wing on a dolly, its nose past the doorway
    const shp = new THREE.Shape();
    shp.moveTo(0, 0.19); shp.lineTo(0.034, 0.12); shp.lineTo(0.15, -0.035); shp.lineTo(0.145, -0.075); shp.lineTo(0.06, -0.05); shp.lineTo(0.03, -0.085); shp.lineTo(0, -0.07);
    shp.lineTo(-0.03, -0.085); shp.lineTo(-0.06, -0.05); shp.lineTo(-0.145, -0.075); shp.lineTo(-0.15, -0.035); shp.lineTo(-0.034, 0.12); shp.closePath();
    const wing = new THREE.ExtrudeGeometry(shp, {depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.005, bevelSegments: 1}); wing.rotateX(Math.PI / 2); // plan z = -shape y after rotate
    const cz = H.z + W / 2 + 0.07 - 0.19; // nose 0.07 past the front wall
    add(wing, C.gun, [H.x, 0.04, cz], {f: DROP, d: 1.2});
    add(sph(0.026, 12, 6), C.gunL, [H.x, 0.046, cz + 0.07], {s: [1, 0.55, 2.4], f: DROP, d: 1.2});
    add(sph(0.014, 8, 5), C.glassB, [H.x, 0.054, cz + 0.1], {s: [1, 0.6, 1.8], f: DROP, d: 1.2, gl: 0.6});
    for (const s of [-1, 1]) { P.push(strut([H.x + s * 0.15, 0.046, cz - 0.035], [H.x + s * 0.036, 0.046, cz + 0.12], 0.0018, C.glassB, {f: DROP, d: 1.2, gl: 1.4}, 3)); add(box(0.02, 0.012, 0.006), '#ffb060', [H.x + s * 0.04, 0.04, cz - 0.07], {f: DROP, d: 1.2, gl: 1.6}); }
    add(box(0.12, 0.012, 0.07), C.steelD, [H.x, 0.014, cz + 0.02], {f: DROP, d: 1.2});
    for (const s of [-1, 1]) for (const zz of [-0.01, 0.05]) add((() => { const g = new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8); g.rotateZ(Math.PI / 2); return g; })(), C.black, [H.x + s * 0.06, 0.008, cz + zz], {f: DROP, d: 1.2});
  }
  // ---- lab block, radome and the radar dish ----
  {
    const d = 1.0;
    add(box(0.26, 0.13, 0.2), '#aeb4ba', [RADAR.x, 0, RADAR.z], {f: DROP, d});
    add(box(0.265, 0.012, 0.205), owner, [RADAR.x, 0.13, RADAR.z], {f: DROP, d, gl: 0.3});
    for (let k = 0; k < 5; k++) for (let m = 0; m < 2; m++) if (!lite || m === 1) add(box(0.03, 0.022, 0.003), (k * 3 + m * 5) % 4 === 0 ? '#1d2a33' : C.glass, [RADAR.x - 0.1 + k * 0.05, 0.026 + m * 0.045, RADAR.z + 0.1015], {f: DROP, d, gl: (k * 3 + m * 5) % 4 === 0 ? 0 : 0.9});
    if (!lite) {
      for (let k = 0; k < 4; k++) add(box(0.03, 0.022, 0.003), k % 3 ? C.glass : '#1d2a33', [RADAR.x - 0.075 + k * 0.05, 0.07, RADAR.z - 0.1015], {f: DROP, d, gl: k % 3 ? 0.9 : 0});
      add(box(0.05, 0.024, 0.05), C.steel, [RADAR.x - 0.08, 0.142, RADAR.z + 0.05], {f: DROP, d}); add(cyl(0.012, 0.012, 0.006, 8), C.steelD, [RADAR.x - 0.08, 0.166, RADAR.z + 0.05], {f: DROP, d});
      add(box(0.04, 0.02, 0.04), C.steel, [RADAR.x + 0.07, 0.142, RADAR.z + 0.06], {f: DROP, d});
      add(sph(0.032, 12, 7), C.white, [RADAR.x + 0.085, 0.145, RADAR.z - 0.05], {f: DROP, d});
    }
    // pedestal + yoke + dish (the dish spins about the vertical through the pedestal)
    add(cyl(0.016, 0.026, 0.3, 10), '#c3c9ce', [RADAR.x, 0.142, RADAR.z], {f: DROP, d});
    add(cyl(0.04, 0.04, 0.02, 12), owner, [RADAR.x, 0.4, RADAR.z], {f: DROP, d, gl: 0.3});
    const tilt = 0.75, sp = {w: 0.9, ph: 0, x: RADAR.x, z: RADAR.z};
    const R0 = 0.26, cap = new THREE.SphereGeometry(R0, lite ? 16 : 28, lite ? 5 : 8, 0, TAU, 0, 0.72); cap.translate(0, -R0, 0); cap.scale(1, -1, 1); cap.rotateX(tilt);
    const at = (s: number): V3 => [RADAR.x, 0.44 + s * Math.cos(tilt), RADAR.z + s * Math.sin(tilt)];
    add(cap, '#eef1f3', [RADAR.x, 0.44, RADAR.z], {sp, f: DROP, d});
    P.push(strut(at(0.01), at(0.22), 0.0035, C.steelD, {sp, f: DROP, d}, 4));
    add(sph(0.012, 8, 5), C.red, at(0.225), {sp, f: DROP, d, gl: 0.6});
    if (!lite) for (let k = 0; k < 3; k++) { const a = k * TAU / 3; P.push(strut(at(0.01), [RADAR.x + Math.cos(a) * 0.12, 0.44 + 0.17 * Math.cos(tilt) + 0.0 - 0.0 + (Math.sin(a) * 0.12) * 0, RADAR.z + Math.sin(a) * 0.12 * Math.cos(tilt) + 0.17 * Math.sin(tilt) * 0], 0.0025, C.steel, {sp, f: DROP, d}, 3)); }
  }
  // ---- guard towers ----
  const gtower = (x: number, z: number, lamp: boolean, d: number) => {
    const h = TOWER_H, bw = 0.045, tw = 0.032;
    const leg = (sx: number, sz: number, y: number): V3 => { const w = bw + (tw - bw) * (y / h); return [x + sx * w, y, z + sz * w]; };
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) P.push(strut(leg(sx, sz, 0), leg(sx, sz, h), 0.0045, C.steel, {f: DROP, d}, 4));
    const lv = lite ? [0, h * 0.5, h] : [0, h * 0.25, h * 0.5, h * 0.75, h];
    for (let k = 0; k < lv.length - 1; k++) for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]] as Array<[[number, number], [number, number]]>) {
      P.push(strut(leg(a[0], a[1], lv[k]), leg(b[0], b[1], lv[k + 1]), 0.0022, C.steelD, {f: DROP, d}, 3));
      if (!lite) P.push(strut(leg(b[0], b[1], lv[k]), leg(a[0], a[1], lv[k + 1]), 0.0022, C.steelD, {f: DROP, d}, 3));
    }
    add(box(0.1, 0.01, 0.1), C.steelD, [x, h, z], {f: DROP, d});
    add(box(0.082, 0.058, 0.082), C.concD, [x, h + 0.01, z], {f: DROP, d});
    add(box(0.0835, 0.024, 0.0835), '#15262e', [x, h + 0.028, z], {f: DROP, d, gl: 0.35});
    add(cone(0.075, 0.05, 4), owner, [x, h + 0.068, z], {r: [0, Math.PI / 4, 0], f: DROP, d, gl: 0.15});
    if (!lite) for (const s of [-1, 1]) { P.push(strut([x + s * 0.052, h + 0.012, z + 0.052], [x + s * 0.052, h + 0.04, z + 0.052], 0.0015, C.steel, {f: DROP, d}, 3)); P.push(strut([x + s * 0.052, h + 0.04, z - 0.052], [x + s * 0.052, h + 0.04, z + 0.052], 0.0015, C.steel, {f: DROP, d}, 3)); }
    add(box(0.016, 0.008, 0.02), C.black, [x, h + 0.118, z], {f: DROP, d});
    add(box(0.022, 0.016, 0.026), C.steelD, [x, h + 0.118 - 0.002, z], {f: DROP, d});
    if (lamp) add(cyl(0.011, 0.011, 0.018, 8), '#fff2c8', [x, h + 0.136, z], {f: DROP, d, gl: 1.6});
  };
  TOWER_SPOTS.forEach((t, i) => gtower(t.x, t.z, t.light, 0.9 + i * 0.1));
  // ---- masts with cross-arms, guys and dishes ----
  MASTS.forEach((M, i) => {
    const d = 1.15 + i * 0.05, h = M.h;
    const leg = (a: number, y: number): V3 => { const w = 0.03 * (1 - 0.8 * (y / h)); return [M.x + Math.cos(a) * w, y, M.z + Math.sin(a) * w]; };
    for (let k = 0; k < 3; k++) P.push(strut(leg(k * TAU / 3 + 0.5, 0), leg(k * TAU / 3 + 0.5, h), 0.0035, C.steel, {f: DROP, d}, 4));
    const lv = lite ? [0, h * 0.5, h] : [0, h * 0.2, h * 0.4, h * 0.6, h * 0.8, h];
    for (let k = 0; k < lv.length - 1; k++) for (let m = 0; m < 3; m++) {
      const a = m * TAU / 3 + 0.5, b = (m + 1) * TAU / 3 + 0.5;
      P.push(strut(leg(a, lv[k]), leg(b, lv[k + 1]), 0.0015, C.steelD, {f: DROP, d}, 3));
      if (!lite) P.push(strut(leg(b, lv[k]), leg(a, lv[k + 1]), 0.0015, C.steelD, {f: DROP, d}, 3));
    }
    add(cyl(0.05, 0.055, 0.014, 8), C.concD, [M.x, 0, M.z], {f: DROP, d});
    for (const [y, w] of [[h * 0.45, 0.06], [h * 0.68, 0.05], [h * 0.88, 0.036]] as Array<[number, number]>) {
      P.push(strut([M.x - w, y, M.z], [M.x + w, y, M.z], 0.0025, C.white, {f: DROP, d}, 3));
      if (!lite) { P.push(strut([M.x + w, y, M.z], [M.x + w, y + 0.03, M.z], 0.0015, C.white, {f: DROP, d}, 3)); P.push(strut([M.x - w, y, M.z], [M.x - w, y + 0.03, M.z], 0.0015, C.white, {f: DROP, d}, 3)); }
    }
    const dg = new THREE.SphereGeometry(0.03, 10, 4, 0, TAU, 0, 1.1); dg.rotateX(Math.PI / 2);
    add(dg, '#f1f4f6', [M.x, h * 0.58, M.z + 0.03], {f: DROP, d});
    add(sph(0.007, 6, 4), C.red, [M.x, h + 0.012, M.z], {f: DROP, d, gl: 1});
    if (!lite) for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 1.0; P.push(strut([M.x, h * 0.62, M.z], [M.x + Math.cos(a) * 0.17, 0.004, M.z + Math.sin(a) * 0.17], 0.0012, '#9aa2aa', {f: DROP, d: d + 0.1}, 3)); }
  });
  // ---- bunker hatch at the centre ----
  add(cyl(0.11, 0.115, 0.012, lite ? 8 : 12), C.steelD, [0, 0, 0.02], {f: DROP, d: 0.9});
  add(torus(0.1, 0.006, lite ? 10 : 16, 3), C.yellow, [0, 0.012, 0.02], {f: DROP, d: 0.9});
  add(box(0.085, 0.006, 0.17), C.steel, [-0.0425, 0.012, 0.02], {s: [1, 1, 0.9], f: DROP, d: 0.9});
  add(box(0.085, 0.006, 0.17), C.steel, [0.0425, 0.012, 0.02], {s: [1, 1, 0.9], f: DROP, d: 0.9});
  add(box(0.006, 0.007, 0.15), '#ff7a30', [0, 0.013, 0.02], {f: DROP, d: 0.9, gl: 1.5});
  if (!lite) { add(box(0.03, 0.04, 0.02), C.steelD, [0.14, 0, -0.05], {f: DROP, d: 1.0}); add(box(0.022, 0.012, 0.003), '#6bd0ff', [0.14, 0.026, -0.038], {f: DROP, d: 1.0, gl: 1}); }
  // ---- floodlights ----
  for (const [x, z] of FLOODS) {
    add(cyl(0.004, 0.006, 0.26, 5), C.steel, [x, 0, z], {f: DROP, d: 1.0});
    add(box(0.065, 0.02, 0.026), '#f4f1e6', [x, 0.26, z], {f: DROP, d: 1.0, gl: 1.6});
    if (!lite) add(box(0.07, 0.004, 0.03), C.steelD, [x, 0.282, z], {f: DROP, d: 1.0});
  }
  // ---- vehicles ----
  const wheel = (() => { const g = new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 8); g.rotateZ(Math.PI / 2); return g; })();
  const veh = (x: number, z: number, yaw: number, kind: 'jeep' | 'truck' | 'van' | 'tractor' | 'bowser', color: string, d: number) => {
    const F = frame(x, z, yaw), r: V3 = [0, yaw, 0];
    const b = (w: number, hh: number, dd: number, c: string | number, l: V3, o: Partial<DPart> = {}) => P.push({g: box(w, hh, dd), c, p: F(l), r, f: DROP, d, ...o});
    const wheels = (xs: number, zs: number[], rr = 1) => { if (!lite) for (const zz of zs) for (const s of [-1, 1]) P.push({g: wheel, c: C.black, p: F([s * xs, 0.0075 * rr, zz]), r, s: [1, rr, rr], f: DROP, d}); };
    if (kind === 'jeep') { b(0.034, 0.012, 0.07, color, [0, 0.006, 0]); b(0.032, 0.02, 0.032, color, [0, 0.016, 0.006]); b(0.0325, 0.01, 0.0015, '#22343c', [0, 0.024, -0.0105], {gl: 0.1}); b(0.03, 0.003, 0.03, C.black, [0, 0.036, 0.006]); wheels(0.019, [-0.022, 0.022]); }
    if (kind === 'truck') { b(0.038, 0.016, 0.1, C.olive, [0, 0.006, 0]); b(0.036, 0.024, 0.03, color, [0, 0.016, -0.034]); b(0.0365, 0.01, 0.0015, '#22343c', [0, 0.03, -0.0495]); b(0.038, 0.036, 0.062, '#6f7a62', [0, 0.018, 0.022]); wheels(0.021, [-0.032, 0.012, 0.036]); }
    if (kind === 'van') { b(0.036, 0.03, 0.075, C.white, [0, 0.006, 0]); b(0.0365, 0.008, 0.0015, '#22343c', [0, 0.026, -0.0375]); b(0.037, 0.006, 0.076, owner, [0, 0.016, 0], {gl: 0.25}); b(0.01, 0.004, 0.012, C.orange, [0, 0.037, -0.01], {gl: 1}); wheels(0.02, [-0.024, 0.024]); }
    if (kind === 'tractor') { b(0.026, 0.01, 0.045, '#d9a621', [0, 0.008, 0]); b(0.022, 0.018, 0.02, '#d9a621', [0, 0.018, 0.005]); b(0.004, 0.004, 0.002, '#fff2c0', [0, 0.014, -0.0235], {gl: 1}); wheels(0.016, [-0.015, 0.016], 1.2); }
    if (kind === 'bowser') { b(0.036, 0.022, 0.026, '#c6c9cc', [0, 0.006, -0.04]); P.push({g: (() => { const g = new THREE.CylinderGeometry(0.019, 0.019, 0.07, 10); g.rotateX(Math.PI / 2); return g; })(), c: '#d3d5d8', p: F([0, 0.025, 0.014]), r, f: DROP, d}); b(0.039, 0.007, 0.072, owner, [0, 0.026, 0.014], {gl: 0.25}); wheels(0.02, [-0.04, 0.0, 0.03]); }
    if (!lite) { b(0.006, 0.004, 0.002, '#fff2c0', [-0.011, 0.012, -0.036 - (kind === 'truck' ? 0.014 : 0)], {gl: 1.2}); b(0.006, 0.004, 0.002, '#fff2c0', [0.011, 0.012, -0.036 - (kind === 'truck' ? 0.014 : 0)], {gl: 1.2}); }
  };
  veh(0.32, 0.4, 0.1, 'truck', '#c9ccce', 1.2); veh(0.42, 0.38, -0.15, 'jeep', '#8a8f62', 1.25); veh(0.5, 0.4, 0.2, 'van', C.white, 1.3);
  veh(0.12, -0.18, 0.5, 'tractor', '#d9a621', 1.3); veh(0.62, 0.0, 1.57, 'bowser', '#c6c9cc', 1.35); veh(-0.02, 0.5, 3.1, 'jeep', '#3a4047', 1.35);
  veh(-0.2, 0.05, -0.4, 'van', '#d8dde0', 1.4);
  // ---- containers, generator, tanks, crates ----
  const cont = (x: number, z: number, y: number, yaw: number, c: string, d: number) => { add(box(0.07, 0.036, 0.16), c, [x, y, z], {r: [0, yaw, 0], f: DROP, d}); if (!lite) add(box(0.072, 0.003, 0.162), C.steelD, [x, y + 0.036, z], {r: [0, yaw, 0], f: DROP, d}); };
  cont(-0.56, -0.12, 0, 0.05, '#7d8a95', 1.0); cont(-0.56, -0.28, 0, -0.04, owner, 1.05); cont(-0.56, -0.12, 0.036, 0.05, '#a2602f', 1.2); cont(-0.56, 0.06, 0, 0.0, '#566a5a', 1.1);
  add(box(0.07, 0.04, 0.05), '#8a929a', [0.55, 0, -0.06], {f: DROP, d: 1.1}); add(box(0.07, 0.006, 0.054), owner, [0.55, 0.04, -0.06], {f: DROP, d: 1.1, gl: 0.3});
  add(cyl(0.032, 0.032, 0.07, lite ? 8 : 14), '#b6bcc2', [0.62, 0, 0.3], {f: DROP, d: 1.1}); add(cyl(0.034, 0.034, 0.01, lite ? 8 : 14), owner, [0.62, 0.05, 0.3], {f: DROP, d: 1.1});
  if (!lite) {
    for (let k = 0; k < 4; k++) add(box(0.018, 0.016, 0.018), k % 2 ? '#9a7a44' : '#7a6538', [-0.46 + (k % 2) * 0.02, Math.floor(k / 2) * 0.016, 0.22], {r: [0, k * 0.3, 0], f: DROP, d: 1.2});
    // lamp posts along the road and the helipad's windsock
    for (const z of [0.2, 0.4, 0.6]) for (const s of [-1, 1]) { add(cyl(0.003, 0.004, 0.06, 5), C.steel, [s * 0.12, 0, z], {f: DROP, d: 1.0}); add(box(0.014, 0.004, 0.008), '#fff2c8', [s * 0.12, 0.06, z], {f: DROP, d: 1.0, gl: 1.4}); }
    add(cyl(0.003, 0.003, 0.12, 5), C.white, [PAD.x - 0.19, 0, PAD.z + 0.08], {f: DROP, d: 1.3}); add(cone(0.014, 0.05, 7), C.orange, [PAD.x - 0.19, 0.1, PAD.z + 0.08 + 0.025], {r: [Math.PI / 2 + 0.2, 0, 0], f: DROP, d: 1.35});
    // tiny people: guards at the gate, a technician at the hatch
    const person = (x: number, z: number, c: string, d: number) => { add(cyl(0.0035, 0.0045, 0.014, 5), c, [x, 0, z], {f: DROP, d}); add(sph(0.0035, 5, 4), '#d8b090', [x, 0.0175, z], {f: DROP, d}); };
    person(0.2, 0.84, '#2d3a2d', 1.4); person(0.21, 0.8, '#2d3a2d', 1.4); person(-0.18, 0.84, '#2d3a2d', 1.4); person(-0.0, 0.7, '#e0e4e8', 1.4); person(0.12, 0.04, '#e0e4e8', 1.4); person(-0.15, -0.18, '#e0e4e8', 1.4); person(0.33, 0.46, '#2d3a2d', 1.4);
    // fuel hose reel, hydrants and barrels at the apron
    for (let k = 0; k < 3; k++) add(cyl(0.007, 0.007, 0.016, 8), k === 1 ? C.red : '#2b5d9a', [HANGAR.x + 0.3, 0, HANGAR.z + 0.28 + k * 0.016], {f: DROP, d: 1.2});
  }
  return P;
}

// ---- helicopter (own mesh, animated by the component) --------------------------------------------------------------
function heliParts(owner: string, lite: boolean): DPart[] {
  const P: DPart[] = [];
  const add = (g: THREE.BufferGeometry, c: string | number, p: V3, o: Partial<DPart> = {}) => P.push({g, c, p, ...o});
  // origin: centre of the skids on the ground; front is +z
  add(sph(0.03, lite ? 10 : 14, lite ? 6 : 8), '#2f3a2c', [0, 0.04, 0], {s: [0.8, 0.8, 1.7]});
  add(sph(0.022, 10, 6), C.glassB, [0, 0.046, 0.034], {s: [0.9, 0.75, 1.1], gl: 0.4});
  add(box(0.012, 0.012, 0.09), '#2f3a2c', [0, 0.03, -0.09]);
  add(box(0.004, 0.026, 0.02), '#2f3a2c', [0, 0.034, -0.14], {r: [0.4, 0, 0]});
  add(box(0.034, 0.006, 0.05), owner, [0, 0.055, -0.01], {gl: 0.4});
  for (const s of [-1, 1]) { P.push(strut([s * 0.022, 0.0045, -0.04], [s * 0.022, 0.0045, 0.06], 0.0025, C.steelD, {}, 4)); P.push(strut([s * 0.022, 0.0045, -0.025], [s * 0.016, 0.026, -0.02], 0.0018, C.steelD, {}, 3)); P.push(strut([s * 0.022, 0.0045, 0.04], [s * 0.016, 0.026, 0.03], 0.0018, C.steelD, {}, 3)); }
  add(cyl(0.004, 0.005, 0.02, 6), C.steelD, [0, 0.07, 0]);
  for (let k = 0; k < (lite ? 2 : 4); k++) { const a = k * (lite ? Math.PI : Math.PI / 2); P.push(strut([0, 0.092, 0], [Math.sin(a) * 0.1, 0.092, Math.cos(a) * 0.1], 0.0022, '#2a2e33', {sp: {w: 1, ph: 0, x: 0, z: 0}}, 3)); }
  add(sph(0.007, 6, 4), C.red, [0, 0.062, -0.17], {gl: 1.2, s: [1, 1, 1]});
  add(box(0.014, 0.004, 0.006), '#fff2c0', [0, 0.04, 0.062], {gl: 1.6});
  return P;
}

// ---- searchlight beams and ground light pools (one additive mesh) ------------------------------------------------
function buildLights(owner: string, lite: boolean): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], kind: number[] = [], bb: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const push = (p: V3, n: V3, color: THREE.Color, k: number, u: [number, number], b: [number, number, number, number]) => { pos.push(...p); nor.push(...n); col.push(color.r, color.g, color.b); uv.push(...u); kind.push(k); bb.push(...b); };
  const pool = (x: number, z: number, rx: number, rz: number, color: string, k: number) => {
    c.set(color).multiplyScalar(k); const n = pos.length / 3;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) push([x + u * rx, 0.005, z + v * rz], [0, 1, 0], c, 2, [u, v], [0, 0, 0, 0]);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
  };
  for (const p of [...ringPosts(FENCE_OUT, 9), ...ringPosts(FENCE_IN, 8)]) if (!lite || p.i % 2 === 0) pool(p.x, p.z, 0.075, 0.075, owner, 0.5);
  for (const [x, z] of FLOODS) pool(x, z, 0.3, 0.3, '#fff0cc', 0.8);
  pool(HANGAR.x, HANGAR.z + 0.34, 0.34, 0.22, '#ffb85a', 0.9); pool(PAD.x, PAD.z, 0.22, 0.22, '#bfe0ff', 0.5);
  for (const t of TOWER_SPOTS) pool(t.x, t.z, 0.17, 0.17, '#ffd98a', 0.5);
  pool(0, 0.9, 0.22, 0.12, '#ff9a8a', 0.4); pool(0.17, 0.78, 0.1, 0.1, '#ffe0a0', 0.5);
  for (const m of [[0.12, 0.35], [-0.12, 0.35], [0.12, 0.55], [-0.12, 0.55]]) pool(m[0], m[1], 0.09, 0.09, '#fff0cc', 0.35);
  // searchlights: cone from the lamp to the ground, aimed at the yard, swept in the shader
  const white = new THREE.Color(1, 0.93, 0.75);
  TOWER_SPOTS.forEach((t, i) => {
    if (!t.light) return;
    const ay = TOWER_H + 0.136, ax = t.x, az = t.z;
    const aim = Math.atan2(-ax + t.aimX, -az + t.aimZ);
    const LEN = 0.95, dep = Math.atan2(ay, LEN * 0.82);
    const L = Math.hypot(LEN * 0.82, ay), seg = lite ? 10 : 18, base = pos.length / 3;
    const ca = Math.cos(aim), sa = Math.sin(aim);
    const toWorld = (lx: number, ly: number, lz: number): V3 => [ax + lx * ca + lz * sa, ay + ly, az - lx * sa + lz * ca];
    const dir: V3 = [0, -Math.sin(dep), Math.cos(dep)];
    push(toWorld(0, 0, 0), [0, 1, 0], white, 0, [0, 0], [ax, az, aim, i * 2.1]);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU, r = 0.1;
      // ring at the far end, perpendicular to the beam direction
      const px_ = Math.cos(a) * r, py_ = Math.sin(a) * r;
      const lx = dir[0] * L + px_, ly = dir[1] * L + py_ * Math.cos(dep), lz = dir[2] * L - py_ * Math.sin(dep);
      const w = toWorld(lx, ly, lz); w[1] = Math.max(0.004, w[1]);
      const nrm: V3 = [Math.cos(a), Math.sin(a), 0];
      push(w, nrm, white, 0, [1, 0], [ax, az, aim, i * 2.1]);
    }
    for (let k = 0; k < seg; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % seg));
    // the pool where it lands
    const pc = toWorld(dir[0] * L, 0, dir[2] * L), n0 = pos.length / 3, cc = new THREE.Color(1, 0.93, 0.75);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const w = toWorld(dir[0] * L + u * 0.12, 0, dir[2] * L + v * 0.2); push([w[0], 0.006, w[2]], [0, 1, 0], cc, 1, [u, v], [ax, az, aim, i * 2.1]);
    }
    void pc; idx.push(n0, n0 + 2, n0 + 1, n0, n0 + 3, n0 + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aU', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(kind, 1)); g.setAttribute('aB', new THREE.Float32BufferAttribute(bb, 4)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 2);
  return g;
}

export function lightMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
    uniforms: {uNight: {value: 0}, uTime: {value: 0}, uOn: {value: 1}, uMotion: {value: 1}},
    vertexShader: `uniform float uTime; uniform float uMotion; attribute float aK; attribute vec2 aU; attribute vec4 aB;
      varying float vK; varying vec2 vU; varying vec3 vC; varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){
        vec3 p = position; vec3 n = normal; float dl = 0.0;
        if (aK < 1.5) { dl = sin(uTime * 0.55 + aB.w) * 0.8 * uMotion; vec2 rel = p.xz - aB.xy; float cs = cos(dl), sn = sin(dl);
          p.x = aB.x + rel.x * cs + rel.y * sn; p.z = aB.y - rel.x * sn + rel.y * cs; n = vec3(n.x * cs + n.z * sn, n.y, -n.x * sn + n.z * cs); }
        vK = aK; vU = aU; vC = color; vT = aU.x;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * n); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNight; uniform float uOn; uniform float uTime; varying float vK; varying vec2 vU; varying vec3 vC; varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){
        float k = mix(0.3, 1.0, uNight); float a;
        if (vK < 0.5) { float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.1); float f = 1.0 - vT; a = (e * 0.2 * pow(f, 0.7) + 0.35 * pow(f, 5.0)) * k * uOn * (0.9 + 0.1 * sin(uTime * 9.0 + vT * 20.0)); gl_FragColor = vec4(vec3(1.0, 0.93, 0.75) * a, 1.0); }
        else if (vK < 1.5) { a = (1.0 - smoothstep(0.0, 1.0, length(vU))) * 0.34 * k * uOn; gl_FragColor = vec4(vec3(1.0, 0.93, 0.75) * a, 1.0); }
        else { float r = length(vU); a = pow(clamp(1.0 - r, 0.0, 1.0), 2.2) * mix(0.12, 1.0, uNight) * uOn; gl_FragColor = vec4(vC * a, 1.0); }
      }`,
  });
}

// ---- glow points -------------------------------------------------------------------------------------------------
export function restrictedGlow(owner: string, rand: () => number, lite: boolean): THREE.BufferGeometry {
  const g = new GlowSet();
  for (const [R, per, H, ph] of [[FENCE_OUT, 9, 0.113, 0], [FENCE_IN, 8, 0.093, 0.5]] as Array<[number, number, number, number]>) {
    for (const p of ringPosts(R, per)) { if (lite && p.i % 2) continue; g.add(p.x, H, p.z, owner, lite ? 0.075 : 0.06, 1, {phase: (p.i / p.n + ph * 0.0) % 1, speed: 1.75, delay: 0.4 + (p.i / p.n) * 0.95}); }
  }
  for (const sx of [-1, 1]) g.add(sx * 0.14, 0.123, 0.878, sx < 0 ? '#ff3b30' : '#3bff7a', 0.08, 0, {delay: 1.0});
  TOWER_SPOTS.forEach((t, i) => { if (t.light) { g.add(t.x, TOWER_H + 0.15, t.z, '#fff0c8', 0.34, 0, {delay: 1.6}); } g.add(t.x, TOWER_H + 0.04, t.z, '#ffd98a', 0.16, 0, {delay: 1.2 + i * 0.05}); g.add(t.x, TOWER_H + 0.18 + (t.light ? 0.0 : -0.06), t.z, '#ff3b30', 0.1, 1, {phase: i * 0.27, speed: 3.1, delay: 1.3}); });
  MASTS.forEach((M, i) => {
    g.add(M.x, M.h + 0.016, M.z, '#ff3326', 0.15, 1, {phase: i * 0.31, speed: 2.4, delay: 1.3});
    if (!lite) for (const f of [0.3, 0.6]) g.add(M.x, M.h * f, M.z, '#ff3326', 0.1, 1, {phase: i * 0.31 + f * 0.5, speed: 2.4, delay: 1.35});
  });
  g.add(RADAR.x, 0.44 + 0.22 * Math.cos(0.75) + 0.02, RADAR.z + 0.22 * Math.sin(0.75), '#ff3b30', 0.1, 1, {phase: 0.5, speed: 2.4, delay: 1.5});
  g.add(HANGAR.x, 0.09, HANGAR.z + 0.1, '#ffbb70', 0.45, 0, {delay: 1.0});
  g.add(HANGAR.x, 0.04, HANGAR.z + 0.2, '#9fd0ff', 0.2, 0, {delay: 1.2});
  for (const [x, z] of FLOODS) g.add(x, 0.272, z, '#fff3d0', 0.3, 0, {delay: 1.1});
  g.add(0, 0.03, 0.02, '#ff8a30', 0.18, 1, {phase: 0.2, speed: 1.2, delay: 1.2});
  for (let k = 0; k < (lite ? 8 : 14); k++) { const a = (k / (lite ? 8 : 14)) * TAU; g.add(PAD.x + Math.cos(a) * PAD.r * 1.12, 0.012, PAD.z + Math.sin(a) * PAD.r * 1.12, '#cfe9ff', 0.075, 1, {phase: k / 14, speed: 3.0, delay: 1.1}); }
  if (!lite) { g.add(0.17, 0.065, 0.78, '#ffe0a0', 0.12, 0, {delay: 1.1}); for (const z of [0.2, 0.4, 0.6]) for (const s of [-1, 1]) g.add(s * 0.12, 0.063, z, '#fff2c8', 0.12, 0, {delay: 1.1}); }
  void rand; void sph;
  return g.build();
}

export function mergeRestricted(parts: THREE.BufferGeometry[]) { return mergeGeometries(parts, false)!; }
