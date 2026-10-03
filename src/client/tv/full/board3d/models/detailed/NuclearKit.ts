// Shared kit for the Detailed Nuclear Zone and Restricted Area: merged vertex-coloured geometry where every part can
// rise or drop in, spin about a vertical axis (radars, rotors, patrol vehicles) or glow at night, all in one draw call
// through one patched standard material (procedural panel seams, speckle, grime and weathering streaks).
// Unit space: the hex circumradius is 1; the model's group scales it by p.radius.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export {canvasTexture, ease, GlowSet, glowMaterial, hexGrid, hexR} from '../NuclearGeo';

export const TAU = Math.PI * 2;

export type DPart = {
  g: THREE.BufferGeometry; c: string | number;
  p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number]; q?: THREE.Quaternion;
  /** build-in delay (s) */ d?: number;
  /** > 0 rises out of the ground by this much; < 0 drops in from this far above */ f?: number;
  /** emissive strength (windows, lamps, panels): glows with the night */ gl?: number;
  /** spin about the vertical axis through (x, z): angular speed, phase */ sp?: {w: number; ph?: number; x?: number; z?: number};
  /** full detail only */ hi?: boolean;
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export function mergeD(parts: DPart[], lite: boolean): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (const pt of parts) {
    if (lite && pt.hi) continue;
    const g = pt.g.clone();
    g.deleteAttribute('uv');
    if (!g.index) { const n0 = g.attributes.position.count; g.setIndex(Array.from({length: n0}, (_, i) => i)); }
    if (pt.q) _q.copy(pt.q); else { _e.set(...(pt.r ?? [0, 0, 0])); _q.setFromEuler(_e); }
    _p.set(...(pt.p ?? [0, 0, 0])); _s.set(...(pt.s ?? [1, 1, 1]));
    g.applyMatrix4(_m.compose(_p, _q, _s));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), drop = new Float32Array(n * 2), sp = new Float32Array(n * 4), gl = new Float32Array(n);
    _c.set(pt.c);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      drop[i * 2] = pt.d ?? 0; drop[i * 2 + 1] = pt.f ?? 0;
      if (pt.sp) { sp[i * 4] = pt.sp.w; sp[i * 4 + 1] = pt.sp.ph ?? 0; sp[i * 4 + 2] = pt.sp.x ?? 0; sp[i * 4 + 3] = pt.sp.z ?? 0; }
      gl[i] = pt.gl ?? 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aDrop', new THREE.BufferAttribute(drop, 2));
    g.setAttribute('aSp', new THREE.BufferAttribute(sp, 4));
    g.setAttribute('aGl', new THREE.BufferAttribute(gl, 1));
    list.push(g);
  }
  const out = mergeGeometries(list, false)!;
  list.forEach((g) => g.dispose());
  return out;
}

// ---- primitives (all stand on y = 0, centred in x and z) --------------------------------------------------------
const cacheG = new Map<string, THREE.BufferGeometry>();
function memo(k: string, f: () => THREE.BufferGeometry) { let g = cacheG.get(k); if (!g) { g = f(); cacheG.set(k, g); } return g; }
/** index buffer without the hidden underside (box group 3, cylinder bottom cap) */
function dropGroup(g: THREE.BufferGeometry, gi: number) {
  const gr = g.groups[gi]; if (!gr || !g.index) return g;
  const a = Array.from(g.index.array as ArrayLike<number>); a.splice(gr.start, gr.count);
  g.setIndex(a); g.clearGroups(); return g;
}
export const box = (w: number, h: number, d: number) => memo(`b${w},${h},${d}`, () => { const g = dropGroup(new THREE.BoxGeometry(w, h, d), 3); g.translate(0, h / 2, 0); return g; });
export const cyl = (rt: number, rb: number, h: number, seg = 10) => memo(`c${rt},${rb},${h},${seg}`, () => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); if (rb > 0) dropGroup(g, 2); g.translate(0, h / 2, 0); return g; });
export const sph = (r: number, ws = 10, hs = 7) => memo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const cone = (r: number, h: number, seg = 8) => memo(`k${r},${h},${seg}`, () => { const g = new THREE.ConeGeometry(r, h, seg); g.translate(0, h / 2, 0); return g; });
export const torus = (R: number, r: number, seg = 16, tub = 5, arc = TAU) => memo(`t${R},${r},${seg},${tub},${arc}`, () => { const g = new THREE.TorusGeometry(R, r, tub, seg, arc); g.rotateX(Math.PI / 2); return g; });
/** a unit-height cylinder lying between a and b (scaled by the part's s) */
export function strut(a: [number, number, number], b: [number, number, number], r: number, c: string | number, o: Partial<DPart> = {}, seg = 4): DPart {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  return {g: memo(`u${r},${seg}`, () => new THREE.CylinderGeometry(r, r, 1, seg, 1, true)), c, p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, s: [1, len, 1], ...o};
}
/** a slack cable from a to b as a chain of thin struts (sag in y) */
export function cable(a: [number, number, number], b: [number, number, number], sag: number, n: number, c: string | number, o: Partial<DPart> = {}, r = 0.0028): DPart[] {
  const out: DPart[] = []; let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n, y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
    const pt: [number, number, number] = [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
    out.push(strut(prev, pt, r, c, o, 3)); prev = pt;
  }
  return out;
}

/** deterministic stream */
export function rnd(seed: number) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- the material -----------------------------------------------------------------------------------------------
const VERT_PARTS = /* glsl */`
{
  float spA0 = aSp.x != 0.0 ? uSpin * aSp.x + aSp.y : 0.0;
  if (aSp.x != 0.0) {
    float cs = cos(spA0), sn = sin(spA0); vec2 pv = aSp.zw; vec2 rel = transformed.xz - pv;
    transformed.x = pv.x + rel.x * cs + rel.y * sn; transformed.z = pv.y - rel.x * sn + rel.y * cs;
  }
  float rk = clamp((uAge - aDrop.x) / 0.6, 0.0, 1.0);
  if (uAge < aDrop.x) { transformed.y += aDrop.y >= 0.0 ? -50.0 : 50.0; }
  else if (aDrop.y >= 0.0) { float e = 1.0 - pow(1.0 - rk, 3.0); transformed.y -= (1.0 - e) * aDrop.y; }
  else {
    transformed.y += (1.0 - rk) * (1.0 - rk) * -aDrop.y;
    float tb = uAge - aDrop.x - 0.6;
    if (tb > 0.0) transformed.y += 0.018 * exp(-tb * 8.0) * abs(sin(tb * 16.0));
  }
}`;

export type DetailMat = {mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; u: {uAge: {value: number}; uSpin: {value: number}; uGl: {value: number}}};

/** One patched standard material (and its shadow-depth twin). Write u.uAge / u.uSpin / u.uGl each frame. */
export function detailMaterial(opts: THREE.MeshStandardMaterialParameters = {}): DetailMat {
  const u = {uAge: {value: 999}, uSpin: {value: 0}, uGl: {value: 0.2}};
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.62, metalness: 0.18, ...opts});
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aDrop; attribute vec4 aSp; attribute float aGl; uniform float uAge; uniform float uSpin;
        varying vec3 vPL; varying vec3 vNL; varying float vGl; varying float vSpin;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vPL = position; vNL = objectNormal; vGl = aGl; vSpin = aSp.x != 0.0 ? 1.0 : 0.0;
        if (aSp.x != 0.0) { float a1 = uSpin * aSp.x + aSp.y; float c1 = cos(a1), s1 = sin(a1);
          objectNormal = vec3(c1 * objectNormal.x + s1 * objectNormal.z, objectNormal.y, -s1 * objectNormal.x + c1 * objectNormal.z); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_PARTS}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGl; uniform float uSpin; varying vec3 vPL; varying vec3 vNL; varying float vGl; varying float vSpin;
        float hsh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(normalize(vNL));
          float st = 1.0 - vSpin; float glx = max(vGl, 0.0);
          float spk = hsh(floor(vPL * 260.0));
          diffuseColor.rgb *= 0.93 + 0.14 * spk;
          vec2 q = an.y > 0.7 ? vPL.xz : (an.x > an.z ? vPL.zy : vPL.xy);
          vec2 f = fract(q * 14.0); vec2 dd = min(f, 1.0 - f);
          float wd = fwidth(q.x * 14.0) + fwidth(q.y * 14.0);
          float line = 1.0 - smoothstep(0.012, 0.012 + wd * 1.1 + 0.01, min(dd.x, dd.y));
          diffuseColor.rgb *= 1.0 - 0.2 * line * (1.0 - glx) * st;
          float gm = exp(-vPL.y * 16.0);
          float strk = hsh(vec3(floor(vPL.x * 70.0 + vPL.z * 70.0), 3.0, 0.0));
          float rain = (an.y < 0.5 ? 1.0 : 0.0) * strk * smoothstep(0.0, 0.5, 0.5 - vPL.y * 0.4) * 0.22;
          diffuseColor.rgb *= (1.0 - (0.42 * gm + rain) * st);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * max(vGl, 0.0) * uGl;`);
  };
  mat.customProgramCacheKey = () => 'detail-v1';
  const depth = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking});
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uAge = u.uAge; sh.uniforms.uSpin = u.uSpin;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aDrop; attribute vec4 aSp; uniform float uAge; uniform float uSpin;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_PARTS}`);
  };
  depth.customProgramCacheKey = () => 'detail-depth-v1';
  return {mat, depth, u};
}

// ---- a flickering arc between two points (electric arcs, welding), additive, camera-facing ribbons -----------------
export class ArcSet {
  pos: number[] = []; ab: number[] = []; aux: number[] = []; side: number[] = []; idx: number[] = [];
  /** an arc from a to b: n segments, wire thickness w (world units), strength k, phase ph */
  add(a: [number, number, number], b: [number, number, number], n: number, w: number, k: number, ph: number) {
    for (let side = 0; side < 2; side++) {
      const base = this.pos.length / 3;
      for (let i = 0; i <= n; i++) for (const sg of [-1, 1]) {
        this.pos.push(...a); this.ab.push(...b);
        this.aux.push(i / n, w, k, ph);
        this.side.push(side ? 0 : sg, side ? sg : 0);
      }
      for (let i = 0; i < n; i++) { const o = base + i * 2; this.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.ab, 3));
    g.setAttribute('aX', new THREE.Float32BufferAttribute(this.aux, 4));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.side, 2));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 1.5);
    return g;
  }
}
export function arcMaterial(tint = '#9cc8ff') {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {uTime: {value: 0}, uNight: {value: 0}, uTint: {value: new THREE.Color(tint)}},
    vertexShader: `uniform float uTime; attribute vec3 aB; attribute vec4 aX; attribute vec2 aS; varying float vI;
      float h(float x){ return fract(sin(x * 91.3 + 17.7) * 43758.5453); }
      void main(){
        float u = aX.x; float step_ = floor(uTime * 16.0 + aX.w * 7.0);
        float on = h(step_ + aX.w * 13.0) > 0.45 ? 1.0 : 0.0;
        vec3 p = mix(position, aB, u);
        float amp = sin(3.14159 * u) * 0.028;
        p += vec3(h(step_ + u * 11.0) - 0.5, h(step_ * 1.7 + u * 7.0) - 0.5, h(step_ * 2.3 + u * 5.0) - 0.5) * amp * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float sc = length(modelMatrix[0].xyz);
        mv.xy += aS * aX.y * sc * 0.5;
        vI = on * aX.z * (0.55 + 0.45 * h(step_ + 3.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uTint; uniform float uNight; varying float vI;
      void main(){ float k = vI * mix(0.7, 1.4, uNight); gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.55) * k, 1.0); }`,
  });
}

/** soft round blob texture for ground pools etc. is drawn in shaders; this is the cheap value noise helper for canvases */
export function noiseDots(g: CanvasRenderingContext2D, S: number, r: () => number, n: number, rgb: [number, number, number], aMin: number, aMax: number, sMax = 3) {
  for (let i = 0; i < n; i++) {
    const v = (r() - 0.5) * 70;
    g.fillStyle = `rgba(${Math.max(0, Math.min(255, rgb[0] + v)) | 0},${Math.max(0, Math.min(255, rgb[1] + v)) | 0},${Math.max(0, Math.min(255, rgb[2] + v)) | 0},${aMin + r() * (aMax - aMin)})`;
    g.fillRect(r() * S, r() * S, 1 + r() * sMax, 1 + r() * sMax);
  }
}
