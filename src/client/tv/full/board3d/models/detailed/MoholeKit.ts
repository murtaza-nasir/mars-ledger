// Mohole (Detailed): the merged-geometry kit. Parts (from the Classic builder) carry colour, glow and owner weights;
// this file adds the shapes the borehole needs (noisy lathe bands, slabs along a path, gears, fans, trucks) and a
// weathered, shaft-lit material: grime from local noise, a warm uplight on every surface that faces the bore.
import * as THREE from 'three';
import {Parts} from '../MoholeBuild';

export {Parts};
export const BOX = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

type O = {glow?: number; owner?: number; vary?: number};
export type Xf = {x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number};

/** add any geometry with a full transform */
export function put(parts: Parts, g: THREE.BufferGeometry, t: Xf, color: THREE.ColorRepresentation, o: O = {}) {
  _q.setFromEuler(_e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0));
  _m.compose(_p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0), _q, _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1));
  parts.add(g, _m, color, o.glow ?? 0, o.owner ?? 0, o.vary ?? 0.1);
}
/** a box centred at (x,y,z) with size (w,h,d), yawed */
export function bx(parts: Parts, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, o: O & {ry?: number; rx?: number; rz?: number} = {}) {
  put(parts, BOX, {x, y, z, sx: w, sy: h, sz: d, ry: o.ry, rx: o.rx, rz: o.rz}, color, o);
}
/** a box whose base sits at y (so foundations and walls read as standing on something) */
export function bxb(parts: Parts, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, o: O & {ry?: number} = {}) {
  bx(parts, x, y + h / 2, z, w, h, d, color, o);
}
const CYL: Record<string, THREE.CylinderGeometry> = {};
const cylG = (seg: number, cap = true) => CYL[seg + (cap ? 'c' : 'o')] ??= new THREE.CylinderGeometry(1, 1, 1, seg, 1, !cap);
/** an upright cylinder (rTop/rBot via scale is not possible: separate unit cylinder per call for tapers) */
export function cy(parts: Parts, x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, o: O & {seg?: number; rx?: number; rz?: number; ry?: number} = {}) {
  put(parts, cylG(o.seg ?? 10), {x, y, z, sx: r, sy: h, sz: r, rx: o.rx, rz: o.rz, ry: o.ry}, color, o);
}
export function cyTaper(parts: Parts, x: number, y: number, z: number, rTop: number, rBot: number, h: number, color: THREE.ColorRepresentation, o: O & {seg?: number} = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 10, 1);
  put(parts, g, {x, y, z}, color, o); g.dispose();
}
/** a cylinder between two points */
export function tube(parts: Parts, a: [number, number, number], b: [number, number, number], r: number, color: THREE.ColorRepresentation, o: O & {seg?: number} = {}) {
  _x.set(...a); _y.set(...b);
  const len = _x.distanceTo(_y);
  _q.setFromUnitVectors(_up, _z.copy(_y).sub(_x).normalize());
  _m.compose(_p.copy(_x).add(_y).multiplyScalar(0.5), _q, _s.set(r, len, r));
  parts.add(cylG(o.seg ?? 6), _m, color, o.glow ?? 0, o.owner ?? 0, o.vary ?? 0.08);
}
/** a square strut between two points */
export function bar(parts: Parts, a: [number, number, number], b: [number, number, number], t: number, color: THREE.ColorRepresentation, o: O = {}) {
  parts.strut(a[0], a[1], a[2], b[0], b[1], b[2], t, color, o);
}
/** a flat slab running from a to b (a ramp or road strip): width across, thickness thick */
export function slab(parts: Parts, a: [number, number, number], b: [number, number, number], width: number, thick: number, color: THREE.ColorRepresentation, o: O = {}) {
  _x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _x.length(); _x.normalize();
  _z.crossVectors(_x, _up).normalize(); _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(thick), _z.multiplyScalar(width));
  _m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0, (a[2] + b[2]) / 2);
  parts.add(BOX, _m, color, o.glow ?? 0, o.owner ?? 0, o.vary ?? 0.08);
}

/** a periodic radial wobble, so rings of rock are not perfect circles */
export function wob(a: number, seed: number): number {
  return Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 + seed * 2.3) * 0.3 + Math.sin(a * 13 + seed * 4.1) * 0.2;
}
/** a lathe band through the (r,y) points, wobbled and jittered into rock; amp is the radial wobble in unit-radius space */
export function band(parts: Parts, pts: Array<[number, number]>, color: THREE.ColorRepresentation, o: O & {seg?: number; amp?: number; seed?: number; jy?: number} = {}) {
  const seg = o.seg ?? 72, amp = o.amp ?? 0, seed = o.seed ?? 0, jy = o.jy ?? 0;
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    const k = r > 0 ? 1 + (amp * wob(a, seed)) / Math.max(r, 0.2) : 1;
    p.setX(i, x * k); p.setZ(i, z * k);
    if (jy) p.setY(i, p.getY(i) + jy * wob(a * 2 + 1, seed + 5) * 0.5);
  }
  g.computeVertexNormals();
  parts.add(g, _m.identity(), color, o.glow ?? 0, o.owner ?? 0, o.vary ?? 0.25);
  g.dispose();
}
/** boulders: faceted icosahedra, squashed */
const ROCK = new THREE.IcosahedronGeometry(1, 0);
export function rock(parts: Parts, x: number, y: number, z: number, s: number, color: THREE.ColorRepresentation, rnd: () => number, o: O = {}) {
  put(parts, ROCK, {x, y: y + s * 0.35, z, sx: s * (0.9 + rnd() * 0.5), sy: s * (0.55 + rnd() * 0.4), sz: s * (0.9 + rnd() * 0.5), ry: rnd() * 6.28, rx: (rnd() - 0.5) * 0.5}, color, {vary: 0.25, ...o});
}

/** a gear in the xy plane (axis z), unit radius: hub, rim, spokes and teeth */
export function gearGeometry(teeth = 12, spokes = 5, color: THREE.ColorRepresentation = '#c7a64a', simple = false): THREE.BufferGeometry {
  const p = new Parts();
  if (simple) { const d = new THREE.CylinderGeometry(0.95, 0.95, 0.12, 8); put(p, d, {rx: Math.PI / 2}, color); d.dispose(); put(p, BOX, {sx: 1.7, sy: 0.12, sz: 0.2}, '#6e7178'); return p.build(); }
  const ring = new THREE.TorusGeometry(0.82, 0.1, 5, teeth * 2); put(p, ring, {}, color); ring.dispose();
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8); put(p, hub, {rx: Math.PI / 2}, '#6e7178'); hub.dispose();
  for (let i = 0; i < spokes; i++) { const a = (i / spokes) * Math.PI * 2; put(p, BOX, {x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5, sx: 0.64, sy: 0.09, sz: 0.1, rz: a}, color); }
  for (let i = 0; i < teeth; i++) { const a = (i / teeth) * Math.PI * 2; put(p, BOX, {x: Math.cos(a) * 0.97, y: Math.sin(a) * 0.97, sx: 0.2, sy: 0.15, sz: 0.2, rz: a}, color); }
  return p.build();
}
/** a fan in the xz plane (axis y), unit radius */
export function fanGeometry(blades = 6): THREE.BufferGeometry {
  const p = new Parts();
  cy(p, 0, 0, 0, 0.13, 0.12, '#3b3d44', {seg: 8});
  for (let i = 0; i < blades; i++) { const a = (i / blades) * Math.PI * 2; put(p, BOX, {x: Math.cos(a) * 0.5, z: Math.sin(a) * 0.5, sx: 0.78, sy: 0.02, sz: 0.2, ry: -a, rx: 0.0}, '#d3d6dc'); }
  const shroud = new THREE.TorusGeometry(0.95, 0.035, 4, 24); put(p, shroud, {rx: Math.PI / 2}, '#8c9099'); shroud.dispose();
  return p.build();
}

/** a mining haul truck facing +x: frame, bed (tipped a little), cab with an owner roof, wheels. Returns nothing: adds to parts. */
export function hauler(parts: Parts, x: number, y: number, z: number, ry: number, s: number, body: string, tip = 0.0, fine = true) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [x + (lx * c + lz * sn) * s, y + ly * s, z + (-lx * sn + lz * c) * s];
  const B = (lx: number, ly: number, lz: number, w: number, h: number, d: number, col: string, o: O = {}) => { const [px, py, pz] = at(lx, ly, lz); bx(parts, px, py, pz, w * s, h * s, d * s, col, {ry, ...o}); };
  B(0, 0.075, 0, 0.36, 0.04, 0.13, '#2b2d33');
  const [bxp, byp, bzp] = at(-0.03, 0.15, 0);
  put(parts, BOX, {x: bxp, y: byp, z: bzp, sx: 0.28 * s, sy: 0.075 * s, sz: 0.15 * s, ry, rz: tip}, body);
  const [bx2, by2, bz2] = at(-0.03, 0.2, 0);
  put(parts, BOX, {x: bx2, y: by2, z: bz2, sx: 0.26 * s, sy: 0.02 * s, sz: 0.13 * s, ry, rz: tip}, '#6b5a48', {vary: 0.3});
  B(0.17, 0.15, 0, 0.1, 0.09, 0.12, body);
  if (fine) B(0.2, 0.17, 0, 0.05, 0.04, 0.115, '#9fc5da', {glow: 0.25});
  B(0.17, 0.205, 0, 0.1, 0.012, 0.13, '#fff', {owner: 1, glow: 0.4});
  for (const [wx, wz] of [[0.12, 0.075], [0.12, -0.075], [-0.12, 0.075], [-0.12, -0.075]] as Array<[number, number]>) {
    const [px, py, pz] = at(wx, 0.05, wz);
    cy(parts, px, py, pz, 0.052 * s, 0.045 * s, '#17181b', {seg: fine ? 9 : 5, rx: Math.PI / 2, ry});
    if (fine) { const [hx, hy, hz] = at(wx, 0.05, wz * 1.28);
    cy(parts, hx, hy, hz, 0.024 * s, 0.01 * s, '#c8cad0', {seg: 6, rx: Math.PI / 2, ry}); }
  }
  const [lx, ly, lz] = at(0.225, 0.1, 0);
  bx(parts, lx, ly, lz, 0.012 * s, 0.014 * s, 0.1 * s, '#fff2c0', {glow: 0.9, ry});
}

/** the weathered, shaft-lit rig material. One program shared by all; uniforms per instance. */
export type MoleU = {uOwner: {value: THREE.Color}; uGlow: {value: number}; uPulse: {value: number}; uShaft: {value: number}; uT: {value: number}};
export function moleMaterial(shared?: MoleU): {mat: THREE.MeshStandardMaterial; u: MoleU} {
  const u: MoleU = shared ?? {uOwner: {value: new THREE.Color('#ffffff')}, uGlow: {value: 0.4}, uPulse: {value: 1}, uShaft: {value: 0.5}, uT: {value: 0}};
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.66, metalness: 0.32, side: THREE.DoubleSide});
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aOwn;\nvarying float vGlow;\nvarying float vOwn;\nvarying vec3 vLP;\nvarying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vOwn = aOwn; vLP = position; vLN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uOwner; uniform float uGlow, uPulse, uShaft, uT; varying float vGlow; varying float vOwn; varying vec3 vLP; varying vec3 vLN;
float mh(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float mn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(mh(i),mh(i+vec3(1,0,0)),f.x),mix(mh(i+vec3(0,1,0)),mh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(mh(i+vec3(0,0,1)),mh(i+vec3(1,0,1)),f.x),mix(mh(i+vec3(0,1,1)),mh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 baseTint = mix(vColor.rgb, uOwner, vOwn);
float gr = mn(vLP*vec3(46.,60.,46.))*.6 + mn(vLP*vec3(150.,190.,150.))*.4;
float low = 1. - smoothstep(.0, .34, vLP.y);
float dirt = clamp(low*.55 + (gr-.5)*.5, 0., 1.);
float own = step(.5, vOwn);
baseTint *= mix(1.08, .62, dirt*(1.-own*.6));
baseTint *= .86 + .28*gr;
diffuseColor.rgb = baseTint;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += baseTint * vGlow * uGlow * uPulse;
{ vec2 rd = vLP.xz; float rl = length(rd); vec2 inward = -rd/max(rl,1e-3);
  float face = clamp(dot(normalize(vLN.xz+1e-4), inward)*.6 + .4, 0., 1.) * (.45 + .55*clamp(dot(vLN, vec3(0.,0.,0.))+1.,0.,1.));
  float reach = exp(-max(rl-.36,0.)*3.4) * exp(-max(vLP.y-.04,0.)*1.1);
  float flick = .9 + .1*sin(uT*5.3 + vLP.x*9.);
  totalEmissiveRadiance += vec3(1.,.36,.08) * face * reach * uShaft * flick * (.12 + .5*gr) * (1.-own*.5); }`);
  };
  mat.customProgramCacheKey = () => 'moleDetailRig';
  return {mat, u};
}
