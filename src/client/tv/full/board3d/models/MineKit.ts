// Shared helpers for the Mine, Industrial Center and Commercial District models (all private to this trio):
// a merged-geometry Builder with vertex colours and a "group" attribute, a per-group rise (build-in) vertex
// patch for materials, and a soft/sparkle/smoke Points material. Everything is designed in unit space (hex
// circumradius = 1, y = 0 on the prism top); the model's group scales it by p.radius.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeOutBack = (x: number) => { const k = clamp01(x) - 1; return 1 + 2.9 * k * k * k + 1.9 * k * k; };
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** a 0..1 ramp that starts at `t0` and lasts `len` seconds */
export const ramp = (age: number, t0: number, len: number) => clamp01((age - t0) / len);

/** shared clock for shader animation (set from world.t by whichever model draws first each frame) */
export const timeU = {value: 0};

export const RISE_N = 12;
/** Patch a material so each vertex's y is scaled by rise[aGrp] (a build-in per part). Returns the array. */
export function riseMaterial<T extends THREE.Material>(mat: T, key: string, extra?: (s: {uniforms: Record<string, {value: unknown}>; vertexShader: string; fragmentShader: string}) => void, shared?: Float32Array): {mat: T; rise: Float32Array} {
  const rise = shared ?? new Float32Array(RISE_N).fill(1);
  mat.onBeforeCompile = (s) => {
    s.uniforms.uRise = {value: rise};
    s.uniforms.uTime = timeU;
    s.vertexShader = `attribute float aGrp;\nuniform float uRise[${RISE_N}];\nvarying float vGrp;\nvarying vec3 vLocal;\n` + s.vertexShader
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\nvGrp = aGrp;\nfloat rz = uRise[int(aGrp + 0.5)];\ntransformed.y = rz < 0.015 ? -5.0 : transformed.y * rz;\nvLocal = transformed;');
    extra?.(s as never);
  };
  mat.customProgramCacheKey = () => key;
  return {mat, rise};
}

// ---- geometry templates (unit size, centred) -------------------------------------------------------------
const cache = new Map<string, THREE.BufferGeometry>();
function tpl(key: string, make: () => THREE.BufferGeometry) { let g = cache.get(key); if (!g) { g = make(); cache.set(key, g); } return g; }
export const G = {
  box: () => tpl('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (rt = 1, seg = 12) => tpl(`cyl${rt}_${seg}`, () => new THREE.CylinderGeometry(rt, 1, 1, seg, 1)),
  cone: (seg = 10) => tpl(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg, 1)),
  ico: () => tpl('ico', () => new THREE.IcosahedronGeometry(1, 0)),
  sph: () => tpl('sph', () => new THREE.SphereGeometry(1, 10, 7)),
  torus: (tube = 0.12) => tpl(`tor${tube}`, () => new THREE.TorusGeometry(1, tube, 5, 18)),
  plane: () => tpl('plane', () => new THREE.PlaneGeometry(1, 1)),
};

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export type AddOpts = {
  sx?: number; sy?: number; sz?: number; rx?: number; ry?: number; rz?: number;
  /** fake ambient occlusion: colour multiplier at the part's bottom and top (default 0.7, 1) */
  ao?: [number, number];
  /** override the UVs: u,v scale per metre of face (for window textures); boxes only */
  win?: number;
};

export class Builder {
  parts: THREE.BufferGeometry[] = [];
  /** the build-in group that following parts belong to */
  grp = 0;
  /** index jitter so that neighbouring parts differ slightly in tone */
  private n = 0;

  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: number, o: AddOpts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1;
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const cnt = pos.count;
    const col = new Float32Array(cnt * 3), grp = new Float32Array(cnt).fill(this.grp);
    const [a0, a1] = o.ao ?? [0.7, 1];
    // bounds for the occlusion gradient
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < cnt; i++) { const yy = pos.getY(i); if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    const jit = 0.94 + 0.12 * hash(this.n++);
    _c.setHex(color);
    for (let i = 0; i < cnt; i++) {
      const f = y1 > y0 ? (pos.getY(i) - y0) / (y1 - y0) : 1;
      const k = (a0 + (a1 - a0) * f) * jit;
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    }
    if (o.win && uv) {
      for (let i = 0; i < cnt; i++) {
        const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i));
        if (ay > 0.5) { uv.setXY(i, 0.02, 0.02); continue; }
        const w = ax > 0.5 ? sz : sx;
        uv.setXY(i, uv.getX(i) * w * o.win + 0.02, uv.getY(i) * sy * o.win + 0.02);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGrp', new THREE.BufferAttribute(grp, 1));
    this.parts.push(g);
    return this;
  }

  /** a box with its bottom-left-back CORNER at (x, y, z) */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, o: AddOpts = {}) {
    return this.add(G.box(), x + w / 2, y + h / 2, z + d / 2, color, {...o, sx: w, sy: h, sz: d});
  }
  /** a (tapered) cylinder with its bottom centre at (x, y, z) */
  cyl(x: number, y: number, z: number, r: number, h: number, color: number, rTop = 1, seg = 12, o: AddOpts = {}) {
    return this.add(G.cyl(rTop, seg), x, y + h / 2, z, color, {...o, sx: r, sy: h, sz: r});
  }
  /** a bar between two points (square section t) */
  bar(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, color: number, ao?: [number, number]) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    // orient the box's local z along (dx, dy, dz)
    const geo = G.box().index ? G.box().toNonIndexed() : G.box().clone();
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const mm = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), qq, new THREE.Vector3(t, t, len));
    geo.applyMatrix4(mm);
    return this.addRaw(geo, color, ao);
  }
  /** a round pipe between two points */
  tube(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, color: number, seg = 8, ao?: [number, number]) {
    const geo = G.cyl(1, seg).toNonIndexed();
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0), len = dir.length();
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), qq, new THREE.Vector3(r, len, r)));
    return this.addRaw(geo, color, ao);
  }
  /** append geometry that is already placed (position + normal [+ uv]); colours it flat with the AO gradient */
  addRaw(geo: THREE.BufferGeometry, color: number, ao: [number, number] = [0.7, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, cnt = pos.count;
    const col = new Float32Array(cnt * 3);
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < cnt; i++) { const yy = pos.getY(i); if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    _c.setHex(color);
    for (let i = 0; i < cnt; i++) {
      const f = y1 > y0 ? (pos.getY(i) - y0) / (y1 - y0) : 1;
      const k = ao[0] + (ao[1] - ao[0]) * f;
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGrp', new THREE.BufferAttribute(new Float32Array(cnt).fill(this.grp), 1));
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    this.parts = this.parts.map((p) => (p.index ? p.toNonIndexed() : p));
    for (const p of this.parts) { for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color', 'aGrp'].includes(k)) p.deleteAttribute(k); if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); }
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    return g;
  }
}

export const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// ---- one Points object: soft glow, star sparkle, smoke ------------------------------------------------------
export type Glow = {
  points: THREE.Points; n: number;
  pos: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array; kind: Float32Array;
  dirty: () => void;
};
const GLOW_VERT = `
attribute vec3 aCol; attribute float aSize; attribute float aAlpha; attribute float aKind;
uniform float uScale;
varying vec3 vCol; varying float vA; varying float vK;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.01), 0.0, 96.0);
  vCol = aCol; vA = aAlpha; vK = aKind;
}`;
const GLOW_FRAG = `
varying vec3 vCol; varying float vA; varying float vK;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float soft = pow(max(1.0 - d, 0.0), 2.0);
  float a = soft;
  if (vK > 1.5) {
    float sx = smoothstep(0.1, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y));
    float sy = smoothstep(0.1, 0.0, abs(c.y)) * smoothstep(0.5, 0.0, abs(c.x));
    a = max(soft * 0.8, max(sx, sy));
  } else if (vK < 0.5) {
    a = smoothstep(1.0, 0.25, d) * 0.9;
  }
  a *= vA;
  if (a < 0.003) discard;
  float add = step(0.5, vK);
  gl_FragColor = vec4(vCol * a, a * (1.0 - add));
}`;
const glowUniforms = {uScale: {value: 600}};
let glowMat: THREE.ShaderMaterial | null = null;
export function glowMaterial() {
  if (!glowMat) {
    glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: glowUniforms,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  }
  return glowMat;
}
/** call each frame with the canvas height in device pixels and the camera's vertical fov (degrees) */
export function setGlowScale(heightPx: number, fovDeg: number) { glowUniforms.uScale.value = heightPx * 0.5 / Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5); }

export function makeGlow(n: number): Glow {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1), size = new Float32Array(n), alpha = new Float32Array(n), kind = new Float32Array(n).fill(1);
  const aP = new THREE.BufferAttribute(pos, 3), aC = new THREE.BufferAttribute(col, 3), aS = new THREE.BufferAttribute(size, 1), aA = new THREE.BufferAttribute(alpha, 1), aK = new THREE.BufferAttribute(kind, 1);
  for (const a of [aP, aC, aS, aA]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aP); geo.setAttribute('aCol', aC); geo.setAttribute('aSize', aS); geo.setAttribute('aAlpha', aA); geo.setAttribute('aKind', aK);
  const points = new THREE.Points(geo, glowMaterial());
  points.frustumCulled = false;
  return {points, n, pos, col, size, alpha, kind, dirty: () => { aP.needsUpdate = true; aC.needsUpdate = true; aS.needsUpdate = true; aA.needsUpdate = true; }};
}

export function setCol(a: Float32Array, i: number, hex: number, k = 1) {
  a[i * 3] = ((hex >> 16) & 255) / 255 * k; a[i * 3 + 1] = ((hex >> 8) & 255) / 255 * k; a[i * 3 + 2] = (hex & 255) / 255 * k;
}

/** a deterministic hash in 0..1 for index i */
export const hash = (i: number, s = 0) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

/** Night lighting baked into a standard material: lamp pools (xyz + radius per lamp) lift the vertex colour as emissive. */
export function lampPatch(nLamps: number) {
  const lamps = new Float32Array(nLamps * 4);
  const uLit = {value: 0};
  const extra = (s: {uniforms: Record<string, {value: unknown}>; vertexShader: string; fragmentShader: string}) => {
    s.uniforms.uLamps = {value: lamps}; s.uniforms.uLit = uLit;
    s.fragmentShader = `uniform vec4 uLamps[${nLamps}];\nuniform float uLit;\nvarying vec3 vLocal;\n` + s.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float pool = 0.05;
      for (int i = 0; i < ${nLamps}; i++) pool += 1.0 - smoothstep(0.0, uLamps[i].w, distance(vLocal, uLamps[i].xyz));
      totalEmissiveRadiance += diffuseColor.rgb * uLit * pool * vec3(1.1, 0.9, 0.62);`);
  };
  return {lamps, uLit, extra};
}
