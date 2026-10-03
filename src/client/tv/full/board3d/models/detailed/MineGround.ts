// The Detailed Mine's ground: a stepped open pit (six benches with strata), a carved spiral haul road, a rolled plateau
// that falls to the prism's edge, procedural strata / dust textures, and the shader patch that "carves" the pit during
// the build-in. Unit space: hex circumradius 1, y = 0 on the prism top.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {clamp01, hash, smooth, timeU} from '../MineKit';

export type Variant = {
  strata: number[]; pile: number[]; chunk: number; emissive: number; spark: number; sparkle: number; ground: number; vein: number; pool: number; metal: number;
};
export const VARIANTS: Record<string, Variant> = {
  area: {strata: [0x4a362c, 0x5d4636, 0x6e5240, 0x7c5d47, 0x8a6a4e, 0x97765a], pile: [0x8a5e40, 0x76787c, 0x6a6258], chunk: 0xb59a7e, emissive: 0x3a2a1a, spark: 0xffe0b0, sparkle: 0.5, ground: 0x80604a, vein: 0xc9a77a, pool: 0x35505e, metal: 0.3},
  steel: {strata: [0x4a2418, 0x5e2f20, 0x74392a, 0x8a4430, 0x9c5036, 0xaa5c3e], pile: [0xb04a26, 0x92391f, 0xc4663a], chunk: 0xc9663c, emissive: 0x7a2a10, spark: 0xffb27a, sparkle: 0.7, ground: 0x8c4a34, vein: 0xe0a070, pool: 0x4a3a30, metal: 0.55},
  titanium: {strata: [0x2f3844, 0x3b4755, 0x485767, 0x586a7e, 0x687d94, 0x7890a8], pile: [0x7a98c4, 0x6888b8, 0x9ab8e0], chunk: 0xcde0f8, emissive: 0x2e62a8, spark: 0xd8eeff, sparkle: 1, ground: 0x687a8c, vein: 0xbfe0ff, pool: 0x2a5a86, metal: 0.85},
};
export const variantOf = (t: number) => (t === 27 ? 'steel' : t === 28 ? 'titanium' : 'area');

export const C = {x: -0.08, z: 0.16};
/** the pit's overall scale */
const S = 0.88;
export const H0 = 0.3;
export const PHI = Math.PI * 2 * 1.3;
export const TH0 = 0.5;
export const roadR = (phi: number) => (0.575 - 0.395 * (Math.max(phi, 0) / PHI)) * S;
export const roadH = (phi: number) => (phi <= 0 ? H0 : H0 - (H0 - 0.016) * (phi / PHI));
export const roadTh = (phi: number) => TH0 - phi;
export const roadX = (phi: number) => C.x + roadR(phi) * Math.cos(roadTh(phi));
export const roadZ = (phi: number) => C.z + roadR(phi) * Math.sin(roadTh(phi));

/** 1 at the hex boundary, 0 at the centre (pointy-top hex, corners on ±z) */
export const hexNorm = (x: number, z: number) => Math.max(Math.abs(x) / 0.866, 0.577 * Math.abs(x) + Math.abs(z));
const plateau = (x: number, z: number) => Math.max(0.002, H0 * (1 - smooth(0.78, 0.99, hexNorm(x, z))));
/** the ground's height outside the pit (placement of buildings) */
export const groundH = (x: number, z: number) => {
  const r = Math.hypot(x - C.x, z - C.z);
  return r < 0.66 * S ? profileH(r) : plateau(x, z);
};

const PROFILE: Array<[number, number]> = ([[0, 0.004], [0.06, 0.01], [0.1, 0.014], [0.12, 0.064], [0.2, 0.07], [0.22, 0.116], [0.3, 0.122], [0.32, 0.168], [0.4, 0.174], [0.42, 0.218], [0.49, 0.224], [0.51, 0.264], [0.56, 0.27], [0.585, 0.3], [0.62, 0.318], [0.66, 0.3]] as Array<[number, number]>).map(([r, h]) => [r * S, h] as [number, number]);
export function profileH(r: number): number {
  for (let i = 1; i < PROFILE.length; i++) if (r <= PROFILE[i][0]) { const [r0, h0] = PROFILE[i - 1], [r1, h1] = PROFILE[i]; return h0 + (h1 - h0) * (r - r0) / (r1 - r0); }
  return H0;
}
/** distance from the pit centre to the hex boundary along angle th */
function rEdge(th: number, rho = 0.99): number {
  const dx = Math.cos(th), dz = Math.sin(th);
  let best = 9;
  for (const [nx, nz, b] of [[1, 0, 0.866], [-1, 0, 0.866], [0.5, 0.866, 0.866], [-0.5, 0.866, 0.866], [0.5, -0.866, 0.866], [-0.5, -0.866, 0.866]] as const) {
    const nd = nx * dx + nz * dz;
    if (nd > 1e-4) best = Math.min(best, (b * rho - (nx * C.x + nz * C.z)) / nd);
  }
  return best;
}

type Ring = {r: number; h: number; k: number; outer?: number};
function rings(full: boolean): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < PROFILE.length; i++) {
    const [r, h] = PROFILE[i];
    const k = Math.min(6, Math.floor(h / 0.05));
    if (i > 0 && full) {
      const [r0, h0] = PROFILE[i - 1];
      if (Math.abs(h - h0) < 0.012 && r - r0 > 0.04) { // a tread: subdivide for the road's carve
        const n = Math.floor((r - r0) / 0.026);
        for (let s = 1; s <= n; s++) { const f = s / (n + 1); out.push({r: r0 + (r - r0) * f, h: h0 + (h - h0) * f, k}); }
      }
    }
    out.push({r, h, k});
  }
  const outer = full ? [0.1, 0.2, 0.3, 0.42, 0.54, 0.65, 0.75, 0.84, 0.92, 1] : [0.35, 0.65, 0.88, 1];
  for (const f of outer) out.push({r: 0.66 * S, h: H0, k: 7, outer: f});
  return out;
}

const wob = (th: number, k: number) => 0.034 * (Math.sin(th * 3 + k * 1.7) + 0.6 * Math.sin(th * 5 + k * 2.9) + 0.35 * Math.sin(th * 9 + k * 0.7));

const cc = new THREE.Color(), cc2 = new THREE.Color();
export function terrainGeo(v: Variant, full: boolean): THREE.BufferGeometry {
  const RG = rings(full), rows = RG.length, cols = full ? 112 : 34;
  const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), y0 = new Float32Array(rows * cols);
  const rd = new Float32Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    const g = RG[i];
    for (let j = 0; j < cols; j++) {
      const th = (j / cols) * Math.PI * 2, n = i * cols + j;
      let x: number, z: number, h: number, ra: number;
      if (g.outer) {
        ra = g.r + g.outer * (rEdge(th) - g.r); x = C.x + Math.cos(th) * ra; z = C.z + Math.sin(th) * ra; h = plateau(x, z);
      } else {
        ra = g.r * (1 + (g.r > 0.1 ? wob(th, g.k) : 0)); x = C.x + Math.cos(th) * ra; z = C.z + Math.sin(th) * ra; h = g.h;
        if (g.r > 0.1 && g.r < 0.53) h += (hash(i * 131 + j, 5) - 0.5) * 0.006;
      }
      // the haul road is cut into the benches
      let wRoad = 0;
      const base = (((TH0 - th) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      for (const phi of [base - Math.PI * 2, base, base + Math.PI * 2]) {
        if (phi > PHI || phi < -0.45) continue;
        const d = Math.abs(ra - roadR(phi)), w = 1 - smooth(0.05, 0.11, d);
        if (w > wRoad) { wRoad = w; h += (roadH(phi) - 0.006 - h) * w; }
      }
      rd[n] = wRoad;
      pos[n * 3] = x; pos[n * 3 + 1] = h; pos[n * 3 + 2] = z;
      uv[n * 2] = (th / (Math.PI * 2)) * 9; uv[n * 2 + 1] = h * 7;
      y0[n] = g.outer ? h : H0;
      // colour: strata by height, dark in the pit, dusty ground on the plateau
      const f = clamp01(h / 0.3) * (v.strata.length - 1), i0 = Math.floor(f), i1 = Math.min(v.strata.length - 1, i0 + 1);
      cc.setHex(v.strata[i0]); cc2.setHex(v.strata[i1]); cc.lerp(cc2, f - i0);
      const dust = smooth(0.26, 0.31, h) * (g.outer ? 1 : 0.6);
      cc.lerp(cc2.setHex(v.ground), dust);
      const dark = 0.55 + 0.6 * smooth(0, 0.18, h) + (hash(i * 31 + j, 7) - 0.5) * 0.22;
      cc.multiplyScalar(dark * 1.6);
      if (wRoad > 0.5) cc.lerp(cc2.setHex(0x37322e), 0.6);
      col[n * 3] = cc.r; col[n * 3 + 1] = cc.g; col[n * 3 + 2] = cc.b;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + (j + 1) % cols, d = (i + 1) * cols + j, e = (i + 1) * cols + (j + 1) % cols;
    idx.push(a, b, d, b, e, d);
  }
  // pit floor cap (ring 0 is r = 0: all one point)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aY0', new THREE.BufferAttribute(y0, 1));
  g.setAttribute('aRoad', new THREE.BufferAttribute(new Float32Array(rows * cols), 1));
  g.setIndex(idx);
  const t = g.toNonIndexed();
  t.computeVertexNormals();
  void rd;
  return t;
}

/** the road: quads with flat colours (kerbs, asphalt, a dashed centre line) */
export function roadGeo(full: boolean): THREE.BufferGeometry {
  const N = full ? 150 : 44;
  const XS = full ? [-0.066, -0.055, -0.045, -0.006, 0.006, 0.045, 0.055, 0.066] : [-0.066, -0.055, -0.045, 0.045, 0.055, 0.066];
  const YS = full ? [0, 0.014, 0.003, 0.003, 0.003, 0.003, 0.014, 0] : [0, 0.014, 0.003, 0.003, 0.014, 0];
  const pos: number[] = [], col: number[] = [], uv: number[] = [], y0: number[] = [], rd: number[] = [];
  const ring = (n: number) => {
    const phi = (n / N) * PHI * 0.99, th = roadTh(phi), rr = roadR(phi), y = roadH(phi) + 0.004;
    return XS.map((dx, k) => { const r = rr + dx; return [C.x + Math.cos(th) * r, y + YS[k], C.z + Math.sin(th) * r]; });
  };
  let prev = ring(0);
  for (let n = 1; n <= N; n++) {
    const cur = ring(n);
    for (let k = 0; k < XS.length - 1; k++) {
      const last = XS.length - 2, mid = full ? 3 : -1;
      let hex: number;
      if (k === 0 || k === last) hex = 0x5a4a38;
      else if (k === 1 || k === last - 1) hex = Math.floor(n / 3) % 2 ? 0xc8b48a : 0x6a5a44;
      else if (k === mid) hex = Math.floor(n / 4) % 2 ? 0x2a2825 : 0xd8b640;
      else hex = 0x2c2a28;
      cc.setHex(hex).multiplyScalar(0.95 + 0.1 * hash(n * 7 + k));
      const q = [prev[k], prev[k + 1], cur[k + 1], cur[k]];
      for (const ix of [0, 1, 2, 0, 2, 3]) {
        pos.push(q[ix][0], q[ix][1], q[ix][2]); col.push(cc.r, cc.g, cc.b); uv.push(0, 0);
        y0.push(H0 - 0.05); rd.push(1);
      }
    }
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aY0', new THREE.Float32BufferAttribute(y0, 1));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(rd, 1));
  g.computeVertexNormals();
  return g;
}

export function groundGeo(v: Variant, full: boolean): THREE.BufferGeometry {
  const a = terrainGeo(v, full), b = roadGeo(full);
  const m = mergeGeometries([a, b], false);
  a.dispose(); b.dispose();
  return m;
}

// ---- textures ----------------------------------------------------------------------------------------------------------
let texs: {strata: THREE.CanvasTexture; top: THREE.CanvasTexture; grunge: THREE.CanvasTexture} | null = null;
export function mineTextures() {
  if (texs) return texs;
  const mk = (draw: (g: CanvasRenderingContext2D, w: number) => void, srgb = true) => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    draw(c.getContext('2d')!, 256);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  };
  const strata = mk((g, W) => {
    g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, W, W);
    let y = 0, i = 0;
    while (y < W) {
      const th = 5 + hash(i, 1) * 20, l = 128 + hash(i, 2) * 110;
      g.fillStyle = `rgb(${l},${l - 4 + hash(i, 3) * 8},${l - 8 + hash(i, 4) * 12})`;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin((x / W) * Math.PI * 2 * (1 + (i % 3)) + i) * 2.2);
      g.lineTo(W, y + th + 2); g.lineTo(0, y + th + 2); g.fill();
      if (hash(i, 6) > 0.55) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, W, 1.5); }
      if (hash(i, 7) > 0.8) { g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, y + th * 0.4, W, 1.5); }
      y += th; i++;
    }
    for (let k = 0; k < 2600; k++) { const l = hash(k, 11) > 0.5 ? 255 : 0; g.fillStyle = `rgba(${l},${l},${l},${0.04 + hash(k, 12) * 0.08})`; g.fillRect(hash(k, 13) * W, hash(k, 14) * W, 1 + hash(k, 15) * 3, 1 + hash(k, 16) * 2); }
  });
  const top = mk((g, W) => {
    g.fillStyle = '#c8c0b4'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 220; k++) {
      const x = hash(k, 21) * W, y = hash(k, 22) * W, r = 6 + hash(k, 23) * 26, l = 150 + hash(k, 24) * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${l},${l - 6},${l - 14},0.35)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let k = 0; k < 900; k++) { const l = 70 + hash(k, 25) * 170; g.fillStyle = `rgba(${l},${l - 6},${l - 12},0.55)`; g.beginPath(); g.arc(hash(k, 26) * W, hash(k, 27) * W, 0.6 + hash(k, 28) * 2, 0, 6.3); g.fill(); }
    // wheel ruts
    g.strokeStyle = 'rgba(40,30,20,0.18)'; g.lineWidth = 5;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, 30 + k * 62); g.bezierCurveTo(80, 20 + k * 62, 160, 60 + k * 62, W, 34 + k * 62); g.stroke(); }
  });
  const grunge = mk((g, W) => {
    g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 500; k++) { const l = 120 + hash(k, 31) * 135; g.fillStyle = `rgba(${l},${l},${l},0.18)`; g.fillRect(hash(k, 32) * W, hash(k, 33) * W, 2 + hash(k, 34) * 14, 1 + hash(k, 35) * 5); }
    for (let k = 0; k < 26; k++) { const x = hash(k, 36) * W; const gr = g.createLinearGradient(x, 0, x, 140 * hash(k, 37) + 30); gr.addColorStop(0, 'rgba(70,40,20,0.3)'); gr.addColorStop(1, 'rgba(70,40,20,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + hash(k, 38) * 4, 180); }
    g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, W - 2);
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, W / 2); g.lineTo(W, W / 2); g.moveTo(W / 2, 0); g.lineTo(W / 2, W); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.4)'; for (const [x, y] of [[10, 10], [W - 10, 10], [10, W - 10], [W - 10, W - 10]]) { g.beginPath(); g.arc(x, y, 2.2, 0, 6.3); g.fill(); }
  });
  texs = {strata, top, grunge};
  return texs;
}

// ---- the terrain material ------------------------------------------------------------------------------------------
export function terrainMaterial(lampsN: number, lamps: Float32Array, uLit: {value: number}) {
  const T = mineTextures();
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, map: T.strata, bumpMap: T.strata, bumpScale: 2.2, roughness: 0.92, metalness: 0.04});
  const uCarve = {value: 1};
  mat.onBeforeCompile = (s) => {
    s.uniforms.uCarve = uCarve; s.uniforms.uTop = {value: T.top}; s.uniforms.uLamps = {value: lamps}; s.uniforms.uLit = uLit; s.uniforms.uTime = timeU;
    s.vertexShader = `attribute float aY0; attribute float aRoad; uniform float uCarve; varying float vRoad; varying vec3 vNrmL; varying vec3 vPosL; varying float vP;\n` + s.vertexShader
      .replace('#include <beginnormal_vertex>', `float dep = 1.0 - clamp(position.y / ${H0.toFixed(3)}, 0.0, 1.0);
        float pr = clamp((uCarve - dep * 0.55) / 0.45, 0.0, 1.0); pr = pr * pr * (3.0 - 2.0 * pr); vP = pr;
        vec3 objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, pr));
        vNrmL = objectNormal;
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.x, mix(aY0, position.y, pr), position.z);
        vRoad = aRoad; vPosL = transformed;`);
    s.fragmentShader = `uniform sampler2D uTop; uniform vec4 uLamps[${lampsN}]; uniform float uLit; varying float vRoad; varying vec3 vNrmL; varying vec3 vPosL; varying float vP;\n` + s.fragmentShader
      .replace('#include <map_fragment>', `vec4 sc = texture2D(map, vMapUv);
        vec3 tp = texture2D(uTop, vPosL.xz * 2.4 + 0.37).rgb;
        float up = smoothstep(0.6, 0.86, normalize(vNrmL).y);
        diffuseColor.rgb *= mix(mix(sc.rgb, tp, up), vec3(1.0), vRoad);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float pool = 0.04;
        for (int i = 0; i < ${lampsN}; i++) pool += 1.0 - smoothstep(0.0, uLamps[i].w, distance(vPosL, uLamps[i].xyz));
        totalEmissiveRadiance += diffuseColor.rgb * uLit * pool * vec3(1.1, 0.9, 0.62);`);
  };
  mat.customProgramCacheKey = () => 'mine-terrain-' + lampsN;
  return {mat, uCarve};
}
