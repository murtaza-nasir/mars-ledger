// Shared private helpers for NuclearZone.tsx and RestrictedArea.tsx: merged vertex-coloured geometry with a
// per-part build-in (rise / drop) driven by one uniform, and a single Points shader for glows, vapour and sparks.
// Everything is in "unit" space (hex circumradius = 1); the model's group scales it by p.radius.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Circumradius of a pointy-top unit hex at angle phi (from +x towards +z). */
export function hexR(phi: number): number {
  const a = Math.sqrt(3) / 2, s = Math.PI / 3;
  const m = ((((phi + Math.PI / 6) % s) + s) % s) - Math.PI / 6;
  return a / Math.cos(m);
}

export type Part = {
  g: THREE.BufferGeometry; c: string | number;
  p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number];
  /** build-in delay (s) */ d?: number;
  /** > 0: rises out of the ground by this much; < 0: drops in from this far above */ f?: number;
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const list = parts.map((pt) => {
    const g = pt.g.clone();
    g.deleteAttribute('uv');
    _e.set(...(pt.r ?? [0, 0, 0]));
    _q.setFromEuler(_e);
    _p.set(...(pt.p ?? [0, 0, 0]));
    _s.set(...(pt.s ?? [1, 1, 1]));
    g.applyMatrix4(_m.compose(_p, _q, _s));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), drop = new Float32Array(n * 2);
    _c.set(pt.c);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      drop[i * 2] = pt.d ?? 0; drop[i * 2 + 1] = pt.f ?? 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aDrop', new THREE.BufferAttribute(drop, 2));
    return g;
  });
  const out = mergeGeometries(list, false)!;
  list.forEach((g) => g.dispose());
  return out;
}

/** A vertex-coloured standard material whose parts rise or drop in as uAge passes each part's delay. */
export function riseMaterial(opts: THREE.MeshStandardMaterialParameters = {}) {
  const uAge = {value: 999};
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.7, metalness: 0.1, ...opts});
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAge = uAge;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aDrop;\nuniform float uAge;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float rk = clamp((uAge - aDrop.x) / 0.6, 0.0, 1.0);
          if (uAge < aDrop.x) { transformed.y += aDrop.y >= 0.0 ? -50.0 : 50.0; }
          else if (aDrop.y >= 0.0) { float e = 1.0 - pow(1.0 - rk, 3.0); transformed.y -= (1.0 - e) * aDrop.y; }
          else {
            transformed.y += (1.0 - rk) * (1.0 - rk) * -aDrop.y;
            float tb = uAge - aDrop.x - 0.6;
            if (tb > 0.0) transformed.y += 0.018 * exp(-tb * 8.0) * abs(sin(tb * 16.0));
          }
        }`);
  };
  m.customProgramCacheKey = () => 'rise-v1';
  return {mat: m, uAge};
}

// ---- glow points ------------------------------------------------------------------------------------------
// kind 0 steady glow, 1 blinking glow, 2 vapour (rises, grows, fades), 3 shimmer spark (rises, twinkles)
export class GlowSet {
  pos: number[] = []; col: number[] = []; p: number[] = []; t: number[] = [];
  private c = new THREE.Color();
  add(x: number, y: number, z: number, color: string | number, size: number, kind: 0 | 1 | 2 | 3,
    o: {phase?: number; speed?: number; delay?: number; rise?: number; drift?: number} = {}) {
    this.c.set(color);
    this.pos.push(x, y, z); this.col.push(this.c.r, this.c.g, this.c.b);
    this.p.push(size, kind, o.phase ?? 0, o.speed ?? 1);
    this.t.push(o.delay ?? 0, o.rise ?? 0, o.drift ?? 0);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aP', new THREE.Float32BufferAttribute(this.p, 4));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 3));
    // the vertex shader moves points, so give the culling sphere generous room
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 2);
    return g;
  }
}

const GLOW_VS = /* glsl */`
uniform float uTime, uAge, uNight, uH;
attribute vec3 aCol; attribute vec4 aP; attribute vec3 aT;
varying vec3 vCol; varying float vA; varying float vW;
void main() {
  float kind = aP.y; vec3 pos = position; float size = aP.x; float a = 1.0; float w = 0.0;
  float ap = smoothstep(aT.x, aT.x + 0.4, uAge);
  float night = mix(0.55, 1.0, uNight);
  if (kind < 0.5) { a = night; }
  else if (kind < 1.5) {
    float b = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(uTime * aP.w + aP.z * 6.2831));
    a = (0.12 + 0.88 * b) * night;
  } else if (kind < 2.5) {
    float f = fract(uTime * aP.w * 0.1 + aP.z);
    pos.y += f * aT.y; pos.x += f * aT.z + sin(f * 5.0 + aP.z * 40.0) * 0.012; pos.z += cos(f * 4.0 + aP.z * 30.0) * 0.012;
    size *= 0.45 + 1.9 * f;
    a = sin(3.14159 * f) * 0.42 * mix(1.0, 0.7, uNight); w = 1.0;
  } else {
    float f = fract(uTime * aP.w * 0.1 + aP.z);
    pos.y += f * aT.y; pos.x += sin(uTime * 1.3 + aP.z * 30.0) * aT.z; pos.z += cos(uTime * 1.1 + aP.z * 21.0) * aT.z;
    a = sin(3.14159 * f) * (0.55 + 0.45 * sin(uTime * 7.0 + aP.z * 50.0)) * mix(0.55, 1.0, uNight);
  }
  a *= ap; size *= mix(0.3, 1.0, ap);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float sc = length(modelMatrix[0].xyz);
  gl_PointSize = min(size * sc * projectionMatrix[1][1] * uH * 0.5 / max(-mv.z, 0.01), 240.0);
  vCol = aCol; vA = a; vW = w;
}`;
const GLOW_FS = /* glsl */`
varying vec3 vCol; varying float vA; varying float vW;
void main() {
  vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float g = vW > 0.5 ? smoothstep(1.0, 0.0, r) : exp(-r * 4.5);
  vec3 c = vW > 0.5 ? vCol : mix(vCol, vec3(1.0), exp(-r * 16.0) * 0.75);
  float al = vA * g;
  gl_FragColor = vec4(c * al, al * vW);
}`;

export function glowMaterial() {
  const m = new THREE.ShaderMaterial({
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {uTime: {value: 0}, uAge: {value: 999}, uNight: {value: 0}, uH: {value: 1080}},
  });
  return m;
}

export const ease = {
  out3: (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3),
  back: (x: number) => { const k = Math.min(1, Math.max(0, x)), c = 1.8; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  clamp: (x: number) => Math.min(1, Math.max(0, x)),
};

/** A square canvas texture, drawn once. */
export function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  return t;
}

/** A hex-shaped polar grid (unit circumradius, pointy-top) with a height function; uv is planar x/z. */
export function hexGrid(rings: number, segs: number, height: (x: number, z: number) => number, inset = 0.985): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const f = i / rings;
    for (let j = 0; j < segs; j++) {
      const phi = (j / segs) * Math.PI * 2, rr = f * hexR(phi) * inset;
      const x = Math.cos(phi) * rr, z = Math.sin(phi) * rr;
      pos.push(x, height(x, z), z); uv.push((x + 1) / 2, 1 - (z + 1) / 2);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
