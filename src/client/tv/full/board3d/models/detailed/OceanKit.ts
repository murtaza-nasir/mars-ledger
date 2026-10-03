// Geometry, textures, materials and per-sea layout for the Detailed Ocean (Ocean.tsx). Everything shared is built once;
// each sea (keyed by space id) gets its own small kit: beach and rocks, kelp beds, fish, gulls, motes, props.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {seeded} from '../../tiles3d';
import {
  BIRD_FRAG, BIRD_VERT, FISH_FRAG, FISH_VERT, JET_FRAG, JET_VERT, KELP_FRAG, KELP_VERT, MOTE_FRAG, MOTE_VERT,
  SEABED_FRAG, SEABED_VERT, WATER_FRAG, WATER_VERT,
} from './WaterShaders';

export const R0 = 0.475;           // PRISM_R: the layout below is in world units for this radius
export const WY = 0.016;           // waterline above the prism top
export const FLOOR = 0.001;
export const SHORE_H = 0.022;
const SQ3 = Math.sqrt(3);

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const prof = (hd: number) => ss(0.70, 1.0, hd) * (SHORE_H - FLOOR);
// edges run clockwise seen from above, from the edge between the +z corner and the next one clockwise (as ModelProps.oceanEdges)
const EN: Array<[number, number]> = [[-0.5, 0.8660254], [-1, 0], [-0.5, -0.8660254], [0.5, -0.8660254], [1, 0], [0.5, 0.8660254]];
export const cornerAt = (k: number): [number, number] => [-R0 * Math.sin((k * Math.PI) / 3), R0 * Math.cos((k * Math.PI) / 3)];
/** mirror of shoreField in WaterShaders.ts: beach height above FLOOR at (x, z), beaches only on edges where open[i] is 0 */
export function beachH(x: number, z: number, open: readonly number[]): number {
  const apo = R0 * 0.8660254, hd = EN.map(([nx, nz]) => (x * nx + z * nz) / apo);
  let h = 0;
  for (let i = 0; i < 6; i++) {
    if (open[i]) continue;
    let g = 1;
    for (const j of [(i + 5) % 6, (i + 1) % 6]) if (open[j]) g = Math.min(g, ss(0, 0.25, hd[i] - hd[j]));
    h = Math.max(h, ss(0.70, 1.0, hd[i]) * g * (SHORE_H - FLOOR));
  }
  return h;
}
/** hex distance, 1.0 on the rim (pointy-top) */
export const hexN = (x: number, z: number, R = R0) => Math.max(Math.abs(x), Math.abs(0.5 * x + 0.8660254 * z), Math.abs(-0.5 * x + 0.8660254 * z)) / (R * 0.8660254);

// ---- the shared uniforms (each sea writes its own before it draws) -------------------------------------------------
export const U = {
  uTime: {value: 0}, uNight: {value: 0}, uAge: {value: 99}, uR: {value: R0}, uScale: {value: 800},
  uSeed: {value: new THREE.Vector3()},
  uFl: {value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]},
  uBuoy: {value: new THREE.Vector4()}, uRaft: {value: new THREE.Vector3()},
  uBird: {value: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)]},
  uPatch: {value: Array.from({length: 6}, () => new THREE.Vector3())},
  uOpen: {value: [0, 0, 0, 0, 0, 0]},
};


// ---- swell, mirrored from the shader so props ride the same waves ------------------------------------------------------
const WAVES: Array<[number, number, number, number, number]> = [
  [0.86, 0.51, 26, 1.25, 0.0017], [-0.40, 0.92, 37, 1.55, 0.0012], [0.12, -0.99, 55, 1.9, 0.0007],
];
/** swell height and slope at world (x, z) into out = [h, dx, dz] */
export function swellAt(x: number, z: number, t: number, out: number[]) {
  const qx = x + 0.010 * Math.sin(z * 23 + t * 0.35), qz = z + 0.010 * Math.cos(x * 19 - t * 0.30);
  let h = 0, gx = 0, gz = 0;
  for (const [dx, dz, k, w, a] of WAVES) {
    const l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
    const ph = (qx * ux + qz * uz) * k + w * t;
    h += a * Math.sin(ph); const c = a * k * Math.cos(ph); gx += ux * c; gz += uz * c;
  }
  out[0] = h; out[1] = gx; out[2] = gz;
}
export const blinkAt = (t: number, seed: number) => {
  const ph = ((t / 2.6 + seed) % 1 + 1) % 1;
  return ss(0, 0.02, ph) * ss(0.15, 0.11, ph) + ss(0.22, 0.24, ph) * ss(0.36, 0.32, ph);
};

// ---- lattices ---------------------------------------------------------------------------------------------------
/** A hexagonal disc of unit circumradius (pointy-top) on a triangular lattice: 6 * n^2 triangles. */
export function hexLattice(n: number): THREE.BufferGeometry {
  const s = 1 / n, id = new Map<number, number>(), pos: number[] = [], idx: number[] = [];
  const key = (q: number, r: number) => (q + 64) * 256 + (r + 64);
  const ok = (q: number, r: number) => Math.abs(q) <= n && Math.abs(r) <= n && Math.abs(q + r) <= n;
  for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
    if (!ok(q, r)) continue;
    id.set(key(q, r), pos.length / 3);
    pos.push((q * Math.cos(Math.PI / 6)) * s, 0, -(q * Math.sin(Math.PI / 6) + r) * s);
  }
  for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
    if (ok(q, r) && ok(q + 1, r) && ok(q, r + 1)) idx.push(id.get(key(q, r))!, id.get(key(q, r + 1))!, id.get(key(q + 1, r))!);
    if (ok(q + 1, r) && ok(q, r + 1) && ok(q + 1, r + 1)) idx.push(id.get(key(q + 1, r))!, id.get(key(q, r + 1))!, id.get(key(q + 1, r + 1))!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.1, 0), 1);
  return g;
}

// ---- canvas textures --------------------------------------------------------------------------------------------
let sandTex: THREE.CanvasTexture | null = null;
function sandTexture(): THREE.CanvasTexture {
  if (sandTex) return sandTex;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!, r = seeded('ocean-sand', 3);
  g.fillStyle = '#efe0bc'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) { const v = 170 + r() * 85; g.fillStyle = `rgba(${v},${v * 0.88},${v * 0.66},${0.25 + r() * 0.4})`; g.fillRect(r() * N, r() * N, 1 + r() * 1.6, 1 + r() * 1.6); }
  for (let i = 0; i < 170; i++) { // pebbles
    const x = r() * N, y = r() * N, rr = 2 + r() * 5, v = 110 + r() * 100;
    for (const [ox, oy] of [[0, 0], [-N, 0], [N, 0], [0, -N], [0, N]]) {
      g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},0.8)`; g.beginPath(); g.ellipse(x + ox, y + oy, rr, rr * (0.6 + r() * 0.4), r() * 3, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.ellipse(x + ox - rr * 0.25, y + oy - rr * 0.25, rr * 0.4, rr * 0.3, 0, 0, 6.283); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (sandTex = t);
}

// ---- the shore: beach ring and rocks, one mesh --------------------------------------------------------------------
function vnoise(x: number, z: number) {
  const h = (i: number, j: number) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
}
const SRGB = (hex: number) => new THREE.Color(hex);

function shoreGeometry(id: string, lite: boolean, open: readonly number[]): THREE.BufferGeometry | null {
  if (open.every((o) => o)) return null;
  const r = seeded(id, 311);
  const M = lite ? 10 : 22, J = lite ? 3 : 6, hd0 = 0.86, hd1 = 1.0;
  const corner = cornerAt;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const col0 = new THREE.Color();
  const cols = {dry: SRGB(0xe6d3a6), wetSand: SRGB(0xb9a678), gravel: SRGB(0x8d8576), dark: SRGB(0x5c564e), moss: SRGB(0x56603a)};
  const per = 6 * M;
  for (let j = 0; j <= J; j++) {
    const hd = hd0 + (hd1 - hd0) * (j / J);
    for (let e = 0; e < 6; e++) for (let m = 0; m < M; m++) {
      const [ax, az] = corner(e), [bx, bz] = corner(e + 1), t = m / M;
      const x = (ax + (bx - ax) * t) * hd, z = (az + (bz - az) * t) * hd;
      const bump = (vnoise(x * 70, z * 70) - 0.5) * 0.0035 + (vnoise(x * 24 + 5, z * 24) - 0.5) * 0.004;
      const edgeFade = j === 0 ? 0 : 1;
      const lip = 0;
      const bh = beachH(x, z, open);
      pos.push(x, FLOOR + bh + (bump + lip) * edgeFade * Math.min(1, bh / 0.004), z);
      uv.push(x * 3.2, z * 3.2);
      const h = bh / (SHORE_H - FLOOR);
      const gr = vnoise(x * 38 + 9, z * 38);
      col0.copy(cols.wetSand).lerp(cols.dry, ss(0.35, 0.8, h));
      col0.lerp(cols.gravel, ss(0.55, 0.75, gr) * 0.7);
      col0.lerp(cols.dark, ss(0.7, 0.85, vnoise(x * 12 + 2, z * 12 + 7)) * 0.55);
      if (vnoise(x * 20 + 31, z * 20) > 0.74) col0.lerp(cols.moss, 0.45);
      col.push(col0.r, col0.g, col0.b);
    }
  }
  for (let j = 0; j < J; j++) for (let i = 0; i < per; i++) {
    if (open[Math.floor(i / M)]) continue;
    const a = j * per + i, b = j * per + ((i + 1) % per), c = (j + 1) * per + i, d = (j + 1) * per + ((i + 1) % per);
    idx.push(a, b, c, b, d, c);
  }
  const ring = new THREE.BufferGeometry();
  ring.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ring.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  ring.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  ring.setIndex(idx);
  ring.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [ring.toNonIndexed()];
  // rocks: pebbles along the whole beach, boulders at the waterline
  const closedN = open.filter((o) => !o).length / 6;
  const nPeb = Math.round((lite ? 26 : 70) * closedN), nBig = Math.max(1, Math.round((lite ? 5 : 11) * closedN));
  const apo = R0 * 0.8660254;
  const ico = (rad: number, detail: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, rot: number, c: THREE.Color) => {
    const g = new THREE.IcosahedronGeometry(rad, detail);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) { // jitter, same for equal corners
      const jx = vnoise(p.getX(v) * 90 + x * 50, p.getZ(v) * 90 + z * 50) * 0.5 + 0.75;
      p.setXYZ(v, p.getX(v) * jx * sx, p.getY(v) * jx * sy, p.getZ(v) * jx * sz);
    }
    g.rotateY(rot); g.translate(x, y, z);
    const cc = new Float32Array(p.count * 3), uu = new Float32Array(p.count * 2);
    for (let v = 0; v < p.count; v++) { cc[v * 3] = c.r; cc[v * 3 + 1] = c.g; cc[v * 3 + 2] = c.b; uu[v * 2] = p.getX(v) * 3.2; uu[v * 2 + 1] = p.getZ(v) * 3.2; }
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uu, 2));
    g.computeVertexNormals();
    return g;
  };
  const place = (rad: number, hdLo: number, hdHi: number) => {
    const hd = Math.min(hdLo + (hdHi - hdLo) * r(), 0.985 - rad / apo);
    const closed = [0, 1, 2, 3, 4, 5].filter((i) => !open[i]);
    const e = closed[Math.floor(r() * closed.length)];
    const lo = open[(e + 5) % 6] ? 0.28 : 0.02, hi = open[(e + 1) % 6] ? 0.72 : 0.98;
    const t = lo + (hi - lo) * r();
    const [ax, az] = corner(e), [bx, bz] = corner(e + 1);
    const x = (ax + (bx - ax) * t) * hd, z = (az + (bz - az) * t) * hd;
    return {x, z, y: FLOOR + beachH(x, z, open)};
  };
  for (let i = 0; i < nPeb + nBig; i++) {
    const big = i >= nPeb;
    const rad = big ? 0.016 + r() * 0.016 : 0.004 + r() * 0.006;
    const pl = place(rad, big ? 0.80 : 0.88, big ? 0.93 : 0.985);
    const tone = 0.28 + r() * 0.35;
    const c = new THREE.Color().setRGB(tone, tone * (0.9 + r() * 0.08), tone * (0.8 + r() * 0.1)); if (r() < 0.2) c.lerp(SRGB(0x56603a), 0.4);
    parts.push(ico(rad, big && !lite ? 1 : 0, 1 + r() * 0.4, 0.55 + r() * 0.3, 1 + r() * 0.4, pl.x, pl.y + rad * 0.12, pl.z, r() * 6.28, c));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// the beach colours are sRGB hex; vertex colours are used as linear by three, so convert once
function linearColors(g: THREE.BufferGeometry) {
  const c = g.attributes.color as THREE.BufferAttribute;
  const t = new THREE.Color();
  for (let i = 0; i < c.count; i++) { t.setRGB(c.getX(i), c.getY(i), c.getZ(i)); t.convertSRGBToLinear(); c.setXYZ(i, t.r, t.g, t.b); }
}

// ---- materials -----------------------------------------------------------------------------------------------------
type Mats = {
  waterFull: THREE.ShaderMaterial; waterLite: THREE.ShaderMaterial; seabed: THREE.ShaderMaterial; kelp: THREE.ShaderMaterial;
  fish: THREE.ShaderMaterial; bird: THREE.ShaderMaterial; mote: THREE.ShaderMaterial; jet: THREE.ShaderMaterial;
  shore: THREE.MeshStandardMaterial; props: THREE.MeshStandardMaterial; ice: THREE.MeshStandardMaterial;
  seabedGeo: THREE.BufferGeometry; waterFullGeo: THREE.BufferGeometry; waterLiteGeo: THREE.BufferGeometry;
  kelpBlade: THREE.BufferGeometry; fishBody: THREE.BufferGeometry; gull: THREE.BufferGeometry; jetGeo: THREE.BufferGeometry;
};
let mats: Mats | null = null;
export function getMats(): Mats {
  if (mats) return mats;
  const sm = (vertexShader: string, fragmentShader: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
    new THREE.ShaderMaterial({uniforms: U as unknown as Record<string, THREE.IUniform>, vertexShader, fragmentShader, ...extra});
  const shore = new THREE.MeshStandardMaterial({map: sandTexture(), bumpMap: sandTexture(), bumpScale: 2.2, vertexColors: true, roughness: 0.82, metalness: 0});
  shore.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvL = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vL;\nuniform float uTime;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float swashL = 0.0022 * sin(uTime * 1.3 + vL.x * 21.0 + vL.z * 17.0) + 0.0015 * sin(uTime * 2.1 - vL.z * 33.0);
        float wetK = 1.0 - smoothstep(${WY.toFixed(4)} + swashL, ${WY.toFixed(4)} + swashL + 0.0045, vL.y);
        float filmK = smoothstep(0.0024, 0.0, abs(vL.y - (${WY.toFixed(4)} + swashL + 0.0006))) * 0.7;
        diffuseColor.rgb *= mix(1.0, 0.68, wetK);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.92), filmK);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, wetK);');
  };
  const wAttrs = {uniforms: U as unknown as Record<string, THREE.IUniform>};
  mats = {
    waterFull: new THREE.ShaderMaterial({...wAttrs, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, side: THREE.DoubleSide}),
    waterLite: new THREE.ShaderMaterial({...wAttrs, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, defines: {LITE: ''}, side: THREE.DoubleSide}),
    seabed: sm(SEABED_VERT, SEABED_FRAG, {side: THREE.DoubleSide}),
    kelp: sm(KELP_VERT, KELP_FRAG, {side: THREE.DoubleSide}),
    fish: sm(FISH_VERT, FISH_FRAG, {side: THREE.DoubleSide}),
    bird: sm(BIRD_VERT, BIRD_FRAG, {side: THREE.DoubleSide}),
    mote: sm(MOTE_VERT, MOTE_FRAG, {transparent: true, depthWrite: false}),
    jet: sm(JET_VERT, JET_FRAG, {transparent: true, depthWrite: false, side: THREE.DoubleSide}),
    shore, props: new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.5, metalness: 0.25}),
    ice: new THREE.MeshPhysicalMaterial({vertexColors: true, roughness: 0.25, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, emissive: 0x3d7f9c, emissiveIntensity: 0.55}),
    seabedGeo: hexLattice(18), waterFullGeo: hexLattice(26), waterLiteGeo: hexLattice(12),
    kelpBlade: kelpBladeGeo(), fishBody: fishGeo(), gull: gullGeo(), jetGeo: cylinderGeo(),
  };
  return mats;
}

function cylinderGeo() { const g = new THREE.CylinderGeometry(1, 1, 1, 18, 12, true); g.translate(0, 0.5, 0); return g; }

function kelpBladeGeo(): THREE.BufferGeometry {
  const S = 7, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= S; i++) { pos.push(-1, i / S, 0, 1, i / S, 0); }
  for (let i = 0; i < S; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.1, 0), 1);
  return g;
}

function fishGeo(): THREE.BufferGeometry {
  // a spindle: stations along x (nose +1 … tail -0.55), diamond cross-section, plus a forked tail
  const st: Array<[number, number, number]> = [[1, 0.0, 0.0], [0.7, 0.2, 0.14], [0.25, 0.3, 0.2], [-0.2, 0.22, 0.14], [-0.55, 0.07, 0.05]];
  const pos: number[] = [], idx: number[] = [];
  pos.push(st[0][0], 0, 0);
  for (let i = 1; i < st.length; i++) pos.push(st[i][0], st[i][1], 0, st[i][0], 0, st[i][2], st[i][0], -st[i][1] * 0.8, 0, st[i][0], 0, -st[i][2]);
  const ring = (i: number) => 1 + (i - 1) * 4;
  for (let k = 0; k < 4; k++) idx.push(0, ring(1) + k, ring(1) + (k + 1) % 4);
  for (let i = 1; i < st.length - 1; i++) for (let k = 0; k < 4; k++) {
    const a = ring(i) + k, b = ring(i) + (k + 1) % 4, c = ring(i + 1) + k, d = ring(i + 1) + (k + 1) % 4;
    idx.push(a, b, c, b, d, c);
  }
  const t = pos.length / 3;
  pos.push(-0.5, 0, 0, -1.05, 0.28, 0, -0.9, 0, 0, -1.05, -0.28, 0);
  idx.push(t, t + 1, t + 2, t, t + 2, t + 3);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.01, 0), 1);
  return g;
}

function gullGeo(): THREE.BufferGeometry {
  // body (spindle), two wings of three segments each, tail
  const pos: number[] = [], idx: number[] = [];
  const tri = (...p: number[]) => { const b = pos.length / 3; pos.push(...p); idx.push(b, b + 1, b + 2); };
  tri(0.0, 0.0, 0.5, -0.07, 0.0, 0.0, 0.07, 0.0, 0.0);
  tri(0.0, 0.05, 0.5, -0.07, 0.0, 0.0, 0.07, 0.0, 0.0);
  tri(0.0, 0.0, -0.3, -0.07, 0.0, 0.0, 0.07, 0.0, 0.0);
  tri(0.0, 0.0, -0.55, -0.1, 0.0, -0.3, 0.1, 0.0, -0.3);
  for (const s of [-1, 1]) {
    tri(s * 0.05, 0.0, 0.18, s * 0.5, 0.0, 0.08, s * 0.05, 0.0, -0.18);
    tri(s * 0.5, 0.0, 0.08, s * 0.5, 0.0, -0.1, s * 0.05, 0.0, -0.18);
    tri(s * 0.5, 0.0, 0.08, s * 1.0, 0.0, -0.18, s * 0.5, 0.0, -0.12);
    tri(s * 0.5, 0.0, 0.08, s * 0.95, 0.0, -0.12, s * 1.0, 0.0, -0.3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 1);
  return g;
}

// ---- props: buoy, raft and ice floes (vertex-coloured, merged) ------------------------------------------------------------------
type Tint = THREE.Color;
function paint(g: THREE.BufferGeometry, c: Tint): THREE.BufferGeometry {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const lin = (hex: number | string) => new THREE.Color(hex as number).convertSRGBToLinear();
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const o = g.index ? g.toNonIndexed() : g;
  o.deleteAttribute('uv');
  return o;
}
function mergeKeep(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const gs = parts.map(clean);
  const m = mergeGeometries(gs, false)!;
  for (const g of gs) g.dispose();
  return m;
}

export function buoyGeometry(accent: string): THREE.BufferGeometry {
  const A = lin(accent), W = lin(0xf4f4ee), D = lin(0x2c3036), Y = lin(0xe8c340), RD = lin(0xd83b2a), G = lin(0x8d949b);
  const p: THREE.BufferGeometry[] = [];
  const torus = new THREE.TorusGeometry(0.021, 0.0075, 8, 20); torus.rotateX(Math.PI / 2); p.push(paint(torus, W));
  const stripe = new THREE.TorusGeometry(0.0212, 0.0079, 6, 20, Math.PI / 2); stripe.rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++) { const s = stripe.clone(); s.rotateY(i * Math.PI / 2); p.push(paint(s, i % 2 ? W : A)); }
  // tapered body in three bands, owner colour at the bottom and top
  const bands: Array<[number, number, number, Tint]> = [[0.0185, 0.0165, 0.010, A], [0.0165, 0.0145, 0.010, W], [0.0145, 0.0125, 0.010, A]];
  let y = 0.010;
  for (const [r1, r0, h, c] of bands) { const b = new THREE.CylinderGeometry(r0 * 0.99, r1, h, 14, 1); b.translate(0, y + h / 2, 0); p.push(paint(b, c)); y += h; }
  const deck = new THREE.CylinderGeometry(0.016, 0.0125, 0.003, 14); deck.translate(0, y + 0.0015, 0); p.push(paint(deck, G));
  const keel = new THREE.ConeGeometry(0.012, 0.03, 10); keel.rotateX(Math.PI); keel.translate(0, -0.012, 0); p.push(paint(keel, D));
  const chain = new THREE.TorusGeometry(0.004, 0.0012, 5, 8); chain.translate(0, -0.03, 0); p.push(paint(chain, G));
  const mast = new THREE.CylinderGeometry(0.0022, 0.0028, 0.05, 6); mast.translate(0, 0.063, 0); p.push(paint(mast, D));
  // lantern cage: six rods between two rings, a red cap on top
  const ringG = new THREE.TorusGeometry(0.0075, 0.0007, 4, 12); ringG.rotateX(Math.PI / 2);
  for (const yy of [0.081, 0.095]) { const r = ringG.clone(); r.translate(0, yy, 0); p.push(paint(r, D)); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, rod = new THREE.CylinderGeometry(0.0005, 0.0005, 0.014, 3); rod.translate(Math.cos(a) * 0.0075, 0.088, Math.sin(a) * 0.0075); p.push(paint(rod, D)); }
  const cap = new THREE.ConeGeometry(0.0095, 0.009, 10); cap.translate(0, 0.1, 0); p.push(paint(cap, RD));
  // radar reflector, anemometer arms and a solar panel
  const rr = new THREE.OctahedronGeometry(0.0075); rr.scale(1, 0.7, 1); rr.translate(0, 0.0745, 0); p.push(paint(rr, Y));
  const panel = new THREE.BoxGeometry(0.022, 0.0016, 0.013); panel.rotateX(0.5); panel.translate(0, 0.052, 0.011); p.push(paint(panel, lin(0x1f4577)));
  for (const s of [-1, 1]) { const rung = new THREE.BoxGeometry(0.0012, 0.0012, 0.008); rung.translate(s * 0.007, 0.03, 0.0185); p.push(paint(rung, D)); }
  return mergeKeep(p);
}

/** the research raft: two pontoons and a deck, a lit cabin, an A-frame crane, solar panel, mast and flag */
export function raftGeometry(accent: string): {hull: THREE.BufferGeometry; windows: THREE.BufferGeometry} {
  const A = lin(accent), W = lin(0xf2f4f4), D = lin(0x30343a), DECK = lin(0xb9bec2), YEL = lin(0xf0b92b), BLUE = lin(0x2a5f9a), STEEL = lin(0xd8dde0);
  const p: THREE.BufferGeometry[] = [], win: THREE.BufferGeometry[] = [];
  // pontoons: capsule hulls with a raised bow
  for (const z of [-0.030, 0.030]) {
    const cap = new THREE.CapsuleGeometry(0.0105, 0.104, 4, 10); cap.rotateZ(Math.PI / 2); cap.scale(1, 0.85, 1); cap.translate(0, 0.0, z); p.push(paint(cap, YEL));
    const band = new THREE.CylinderGeometry(0.0108, 0.0108, 0.006, 10); band.rotateZ(Math.PI / 2); band.scale(1, 0.85, 1); band.translate(0.0, 0.0, z);
    for (const x of [-0.035, 0.035]) { const b = band.clone(); b.translate(x, 0, 0); p.push(paint(b, A)); }
  }
  // deck with plank lines and a rail
  const deck = new THREE.BoxGeometry(0.108, 0.003, 0.07); deck.translate(0, 0.0095, 0); p.push(paint(deck, DECK));
  for (let i = 0; i < 5; i++) { const pl = new THREE.BoxGeometry(0.108, 0.0004, 0.0008); pl.translate(0, 0.0112, -0.028 + i * 0.014); p.push(paint(pl, lin(0x7c8288))); }
  for (const [x, z, sx, sz] of [[0, 0.034, 0.108, 0.0012], [0, -0.034, 0.108, 0.0012], [0.053, 0, 0.0012, 0.068]] as number[][]) { const r = new THREE.BoxGeometry(sx, 0.0012, sz); r.translate(x, 0.0195, z); p.push(paint(r, STEEL)); }
  for (let i = 0; i < 7; i++) for (const z of [-0.034, 0.034]) { const po = new THREE.CylinderGeometry(0.0007, 0.0007, 0.009, 4); po.translate(-0.053 + i * 0.0177, 0.0155, z); p.push(paint(po, STEEL)); }
  // cabin with a roof in the owner colour, window band, door and roof lamp
  const cabin = new THREE.BoxGeometry(0.04, 0.026, 0.032); cabin.translate(-0.026, 0.0235, -0.006); p.push(paint(cabin, W));
  const roof = new THREE.BoxGeometry(0.044, 0.004, 0.036); roof.translate(-0.026, 0.0385, -0.006); p.push(paint(roof, A));
  const stripe = new THREE.BoxGeometry(0.0404, 0.004, 0.0324); stripe.translate(-0.026, 0.0155, -0.006); p.push(paint(stripe, A));
  for (const [x, z, w, h] of [[-0.036, 0.0102, 0.011, 0.009], [-0.02, 0.0102, 0.011, 0.009]] as number[][]) {
    const wd = new THREE.BoxGeometry(w, h, 0.0016); wd.translate(x, 0.0255, z); win.push(paint(wd, W));
  }
  for (const z of [-0.0225, 0.0105]) { const wd = new THREE.BoxGeometry(0.0016, 0.009, 0.009); wd.translate(-0.0058, 0.0255, z); win.push(paint(wd, W)); }
  const door = new THREE.BoxGeometry(0.0085, 0.017, 0.0016); door.translate(-0.036, 0.021, 0.0102); door.translate(0.0, 0, 0); p.push(paint(door, D));
  const lamp = new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 8); lamp.translate(-0.026, 0.0425, -0.006); p.push(paint(lamp, RDK));
  // A-frame crane over the stern, with a boom, cable and hook
  for (const z of [-0.026, 0.026]) {
    for (const s of [-1, 1]) { const leg = new THREE.CylinderGeometry(0.0012, 0.0014, 0.048, 5); leg.rotateZ(s * 0.32); leg.translate(0.040 + s * 0.007, 0.034, z); p.push(paint(leg, YEL)); }
  }
  const beam = new THREE.BoxGeometry(0.0025, 0.0025, 0.056); beam.translate(0.040, 0.0575, 0); p.push(paint(beam, YEL));
  const sheave = new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 10); sheave.rotateX(Math.PI / 2); sheave.translate(0.040, 0.0575, 0); p.push(paint(sheave, D));
  const cable = new THREE.CylinderGeometry(0.0004, 0.0004, 0.03, 3); cable.translate(0.040, 0.041, 0.0); p.push(paint(cable, D));
  const hook = new THREE.TorusGeometry(0.0022, 0.0007, 4, 8, 4.5); hook.translate(0.040, 0.0245, 0); p.push(paint(hook, STEEL));
  const bar = new THREE.BoxGeometry(0.0025, 0.0025, 0.034); bar.translate(0.040, 0.0235, 0); void bar;
  // sample winch and sensors
  const winch = new THREE.CylinderGeometry(0.005, 0.005, 0.012, 10); winch.rotateX(Math.PI / 2); winch.translate(0.026, 0.0155, 0.0); p.push(paint(winch, D));
  const mast = new THREE.CylinderGeometry(0.0013, 0.0017, 0.07, 6); mast.translate(-0.026, 0.075, -0.006); p.push(paint(mast, STEEL));
  const flag = new THREE.BoxGeometry(0.022, 0.012, 0.0012); flag.translate(-0.015, 0.103, -0.006); p.push(paint(flag, A));
  const arm = new THREE.BoxGeometry(0.03, 0.0012, 0.0012); arm.translate(-0.026, 0.086, -0.006); p.push(paint(arm, STEEL));
  for (const s of [-1, 1]) { const cup = new THREE.SphereGeometry(0.0032, 6, 4); cup.translate(-0.026 + s * 0.015, 0.086, -0.006); p.push(paint(cup, W)); }
  const panel = new THREE.BoxGeometry(0.036, 0.0015, 0.024); panel.rotateX(-0.45); panel.translate(0.005, 0.0335, 0.0215); p.push(paint(panel, BLUE));
  const dish = new THREE.SphereGeometry(0.008, 8, 4, 0, 6.283, 0, 1.2); dish.rotateX(0.5); dish.translate(-0.026, 0.048, -0.006); void dish;
  const crate = new THREE.BoxGeometry(0.016, 0.01, 0.012); crate.translate(0.008, 0.016, -0.02); p.push(paint(crate, lin(0xb8442f)));
  return {hull: mergeKeep(p), windows: mergeKeep(win)};
}
const RDK = lin(0xd83b2a);

export function floeGeometry(seed: () => number, size: number): THREE.BufferGeometry {
  const N = 14, ang: number[] = [], rad: number[] = [];
  for (let i = 0; i < N; i++) { ang.push((i / N) * Math.PI * 2 + (seed() - 0.5) * 0.3); rad.push(size * (0.7 + seed() * 0.45)); }
  const top = lin(0xeaf6fb), side = lin(0x9fd4e6), under = lin(0x5db0cf);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const th = 0.0075, bump = 0.0035;
  const push = (x: number, y: number, z: number, c: THREE.Color) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  const c0 = push(0, th + bump, 0, top);
  const rimTop: number[] = [], rimBot: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = Math.cos(ang[i]) * rad[i], z = Math.sin(ang[i]) * rad[i] * 0.85;
    rimTop.push(push(x, th, z, top)); rimBot.push(push(x * 0.8, -0.003, z * 0.8, i % 2 ? side : under));
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(c0, rimTop[j], rimTop[i]);
    idx.push(rimTop[i], rimTop[j], rimBot[i], rimTop[j], rimBot[j], rimBot[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return ng;
}

// ---- one sea's own layout -------------------------------------------------------------------------------------------------
export type Kit = {
  seed: THREE.Vector3;
  cold: boolean;
  patches: THREE.Vector3[];
  buoy: {x: number; z: number; ph: number};
  raft: {x: number; z: number; rot: number};
  floes: Array<{x: number; z: number; r: number; ang: number; sp: number; geo: THREE.BufferGeometry}>;
  birds: Array<{cx: number; cz: number; rho: number; h: number; w: number; ph: number; hp: number}>;
  shoreFull: THREE.BufferGeometry | null; shoreLite: THREE.BufferGeometry | null;
  kelp: THREE.BufferGeometry; fish: THREE.BufferGeometry; birdsGeo: THREE.BufferGeometry;
  motesFull: THREE.BufferGeometry; motesLite: THREE.BufferGeometry;
  buoyG: THREE.BufferGeometry; raftG: THREE.BufferGeometry; windowsG: THREE.BufferGeometry; floeAll: THREE.BufferGeometry; propsLite: THREE.BufferGeometry;
  vents: THREE.BufferGeometry; windowsLite: THREE.BufferGeometry;
};
const kits = new Map<string, Kit>();

function randomInHex(r: () => number, hdMax: number, hdMin = 0): [number, number] {
  for (let k = 0; k < 40; k++) {
    const x = (r() * 2 - 1) * R0 * hdMax, z = (r() * 2 - 1) * R0 * hdMax, h = hexN(x, z);
    if (h <= hdMax && h >= hdMin) return [x, z];
  }
  return [0, 0];
}

export function getKit(id: string, accent: string, open: readonly number[]): Kit {
  const key = id + accent + open.join('');
  const hit = kits.get(key);
  if (hit) return hit;
  const r = seeded(id, 77);
  const seed = new THREE.Vector3(r(), r(), r());
  const cold = r() < 0.4;
  const sector = r() * Math.PI * 2;
  const polar = (ang: number, hd: number): [number, number] => { // a point at hex distance hd in direction ang
    const dx = Math.sin(ang), dz = Math.cos(ang), n = hexN(dx, dz);
    return [(dx / n) * hd, (dz / n) * hd];
  };
  const closedAt = (p: [number, number]) => { let bi = 0, bd = -9; EN.forEach(([nx, nz], i) => { const d = p[0] * nx + p[1] * nz; if (d > bd) { bd = d; bi = i; } }); return !open[bi]; };
  const b = polar(sector, 0.5), rf = polar(sector + 2.1, 0.46);
  const rr = seeded(id, 91);
  const patches: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 30; k++) {
      const [x, z] = randomInHex(rr, 0.72, 0.18);
      const cand = new THREE.Vector3(x, z, 0.05 + rr() * 0.03);
      if (patches.every((q) => Math.hypot(q.x - x, q.y - z) > 0.14)) { patches.push(cand); break; }
    }
  }
  while (patches.length < 6) patches.push(new THREE.Vector3(0, 0, 0));
  const buoy = {x: b[0], z: b[1], ph: rr()};
  const raft = {x: rf[0], z: rf[1], rot: rr() * 6.28};
  const fr = seeded(id, 55), floes: Kit['floes'] = [];
  if (cold) {
    const n = 2 + Math.floor(fr() * 2);
    for (let i = 0; i < n; i++) {
      const a = sector + 4.2 + (i - 1) * 0.75 + fr() * 0.3, hd = 0.35 + fr() * 0.25, p = polar(a, hd);
      const size = 0.045 + fr() * 0.035;
      floes.push({x: p[0], z: p[1], r: size * 0.95, ang: fr() * 6.28, sp: (fr() - 0.5) * 0.04, geo: floeGeometry(fr, size)});
    }
  }
  const birds: Kit['birds'] = [];
  for (let i = 0; i < 3; i++) birds.push({cx: (rr() - 0.5) * 0.06, cz: (rr() - 0.5) * 0.06, rho: 0.14 + rr() * 0.12, h: 0.2 + rr() * 0.1, w: (0.45 + rr() * 0.35) * (rr() < 0.5 ? -1 : 1), ph: rr() * 6.28, hp: rr() * 6.28});

  const shoreFull = shoreGeometry(id, false, open), shoreLite = shoreGeometry(id, true, open);
  if (shoreFull) linearColors(shoreFull);
  if (shoreLite) linearColors(shoreLite);
  const buoyG = buoyGeometry(accent), raftParts = raftGeometry(accent), raftG = raftParts.hull, windowsG = raftParts.windows;
  const floeAll = floes.length ? mergeGeometries(floes.map((f) => { const g = f.geo.clone(); g.rotateY(f.ang); g.translate(f.x, 0, f.z); return g; }), false)! : new THREE.BufferGeometry();

  // kelp: each bed holds a handful of plants of three or four blades
  const kr = seeded(id, 13), kb: number[] = [], ks: number[] = [], kp: number[] = [];
  for (const pt of patches) {
    if (pt.z <= 0) continue;
    const plants = 8 + Math.floor(kr() * 4);
    for (let i = 0; i < plants; i++) {
      const a = kr() * 6.28, d = Math.sqrt(kr()) * pt.z * 0.85, x = pt.x + Math.cos(a) * d, z = pt.y + Math.sin(a) * d;
      const hd = hexN(x, z);
      if (hd > 0.76) continue;
      const blades = 4 + Math.floor(kr() * 2), delay = kr() * 1.0;
      for (let k = 0; k < blades; k++) {
        kb.push(x + (kr() - 0.5) * 0.008, FLOOR + prof(hd), z + (kr() - 0.5) * 0.008);
        ks.push(kr() * 6.28, 0.010 + kr() * 0.004, 0.0030 + kr() * 0.0015, (kr() - 0.5) * 0.9);
        kp.push(kr() * 6.28, delay + kr() * 0.3);
      }
    }
  }
  const kelp = new THREE.InstancedBufferGeometry().copy(getMats().kelpBlade as THREE.InstancedBufferGeometry);
  kelp.instanceCount = kb.length / 3;
  kelp.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(kb), 3));
  kelp.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(ks), 4));
  kelp.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(kp), 2));
  kelp.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.01, 0), R0);

  // fish: two schools circling at different depths, one of them orange
  const fs = seeded(id, 29), f0: number[] = [], f1: number[] = [];
  const schools = [{n: 7, orange: false}, {n: 5, orange: false}, {n: 3, orange: true}];
  for (const sc of schools) {
    const cx = (fs() - 0.5) * 0.12, cz = (fs() - 0.5) * 0.12, rad = 0.12 + fs() * 0.15, sp = (0.45 + fs() * 0.35) * (fs() < 0.5 ? -1 : 1), ph = fs() * 6.28, dep = 0.004 + fs() * 0.005;
    for (let i = 0; i < sc.n; i++) {
      f0.push(cx, cz, rad * (1 + (fs() - 0.5) * 0.18), sp * (1 + (fs() - 0.5) * 0.05));
      f1.push(ph + (fs() - 0.5) * 0.5, FLOOR + dep + (fs() - 0.5) * 0.004, 0.011 + fs() * 0.006, sc.orange ? 0.9 : fs() * 0.6);
    }
  }
  const fish = new THREE.InstancedBufferGeometry().copy(getMats().fishBody as THREE.InstancedBufferGeometry);
  fish.instanceCount = f0.length / 4;
  fish.setAttribute('aF0', new THREE.InstancedBufferAttribute(new Float32Array(f0), 4));
  fish.setAttribute('aF1', new THREE.InstancedBufferAttribute(new Float32Array(f1), 4));
  fish.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.01, 0), R0);

  const birdsGeo = new THREE.InstancedBufferGeometry().copy(getMats().gull as THREE.InstancedBufferGeometry);
  birdsGeo.instanceCount = 3;
  birdsGeo.setAttribute('aB0', new THREE.InstancedBufferAttribute(new Float32Array(12), 4).setUsage(THREE.DynamicDrawUsage));
  birdsGeo.setAttribute('aB1', new THREE.InstancedBufferAttribute(new Float32Array(6), 2).setUsage(THREE.DynamicDrawUsage));
  birdsGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), R0 * 2);

  const motes = (nPlank: number, nSpray: number, nVent: number, nRim: number, glow: boolean) => {
    const mr = seeded(id, 5), pos: number[] = [], A: number[] = [], B: number[] = [];
    const add = (x: number, y: number, z: number, kind: number, b0 = 0, b1 = 0, b2 = 0) => { pos.push(x, y, z); A.push(kind, mr(), mr(), mr()); B.push(b0, b1, b2, mr()); };
    for (let i = 0; i < nPlank; i++) { const [x, z] = randomInHex(mr, 0.8); add(x, FLOOR + 0.003 + mr() * 0.009, z, 0); }
    for (let i = 0; i < nSpray; i++) { const a = mr() * 6.283, p = polar(a, 0.9); if (closedAt(p)) add(p[0], WY, p[1], 1); }
    if (glow) add(0, 0, 0, 2);
    for (let i = 0; i < nVent; i++) add(0, WY, 0, 3, Math.floor(mr() * 5) / 5 + 0.01, mr(), mr());
    for (let i = 0; i < nRim; i++) { const a = mr() * 6.283, p = polar(a, 0.9); if (closedAt(p)) add(p[0], WY, p[1], 4); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.1, 0), R0 * 2);
    return g;
  };
  // vents for the jets and their droplets share the shader's layout (see ventPos in WaterShaders.ts)
  const ventPos: Array<[number, number, number, number]> = [[0, 0, 1.0, 0]];
  for (let i = 1; i < 5; i++) {
    const ang = seed.x * 6.283 + (i - 1) * 1.5708 + 0.4 * Math.sin(i * 3);
    ventPos.push([Math.cos(ang) * R0 * 0.5, Math.sin(ang) * R0 * 0.5, 0.55, 0.10 + 0.12 * i]);
  }
  const vents = new THREE.InstancedBufferGeometry().copy(getMats().jetGeo as THREE.InstancedBufferGeometry);
  vents.instanceCount = 5;
  vents.setAttribute('aV', new THREE.InstancedBufferAttribute(new Float32Array(ventPos.flatMap((v) => [v[0], v[1], v[2]])), 3));
  vents.setAttribute('aD', new THREE.InstancedBufferAttribute(new Float32Array(ventPos.map((v) => v[3])), 1));
  vents.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), R0 * 2);

  // lite: buoy, raft and floes baked at rest into one mesh
  const lp: THREE.BufferGeometry[] = [];
  let winLite: THREE.BufferGeometry | null = null;
  { const g = buoyG.clone(); g.scale(1.25, 1.25, 1.25); g.translate(buoy.x, WY + 0.002, buoy.z); lp.push(g); }
  { const g = raftG.clone(); g.scale(1.3, 1.3, 1.3); g.rotateY(raft.rot); g.translate(raft.x, WY - 0.001, raft.z); lp.push(g); }
  { const g = windowsG.clone(); g.scale(1.3, 1.3, 1.3); g.rotateY(raft.rot); g.translate(raft.x, WY - 0.001, raft.z); winLite = g; }
  const propsLite = mergeGeometries(lp, false)!;
  for (const g of lp) g.dispose();

  const kit: Kit = {
    seed, cold, patches, buoy, raft, floes, birds, shoreFull, shoreLite, kelp, fish, birdsGeo,
    motesFull: motes(70, 34, 150, 70, true), motesLite: motes(26, 12, 80, 40, true),
    buoyG, raftG, windowsG, floeAll, propsLite, vents, windowsLite: winLite!,
  };
  kits.set(key, kit);
  return kit;
}
