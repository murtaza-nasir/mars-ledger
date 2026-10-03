// Mohole: a tiny merged-geometry builder. Parts carry a colour, a glow weight and an "owner" weight, so the
// whole rig is one draw call whose owner colour is a uniform (the geometry is shared by every instance).
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Parts {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = []; private glow: number[] = []; private own: number[] = [];
  private k = 1;
  private rnd() { this.k = (Math.imul(this.k, 1664525) + 1013904223) | 0; return (this.k >>> 0) / 4294967296; }

  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, glow = 0, owner = 0, vary = 0.12) {
    const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    const p = ng.attributes.position, n = ng.attributes.normal;
    _c.set(color);
    // one tone shift per triangle, so plates and rock read as faceted rather than flat
    for (let i = 0; i < p.count; i++) {
      if (i % 3 === 0) this.k2 = 1 + (this.rnd() - 0.5) * 2 * vary;
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(_c.r * this.k2, _c.g * this.k2, _c.b * this.k2);
      this.glow.push(glow); this.own.push(owner);
    }
    ng.dispose();
  }
  private k2 = 1;

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, o: {glow?: number; owner?: number; ry?: number} = {}) {
    _q.setFromAxisAngle(_up, o.ry ?? 0);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    this.add(BOX, _m, color, o.glow, o.owner);
  }
  cyl(cx: number, cy: number, cz: number, rTop: number, rBot: number, h: number, color: THREE.ColorRepresentation, o: {glow?: number; owner?: number; seg?: number} = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 12, 1);
    _m.makeTranslation(cx, cy, cz);
    this.add(g, _m, color, o.glow, o.owner); g.dispose();
  }
  /** a square-section strut between two points */
  strut(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, color: THREE.ColorRepresentation, o: {glow?: number; owner?: number} = {}) {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = _a.distanceTo(_b);
    _q.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
    _m.compose(_p.copy(_a).add(_b).multiplyScalar(0.5), _q, _s.set(t, len, t));
    this.add(BOX, _m, color, o.glow, o.owner);
  }
  geo(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, o: {glow?: number; owner?: number; vary?: number; x?: number; y?: number; z?: number} = {}) {
    _m.makeTranslation(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    this.add(g, _m, color, o.glow, o.owner, o.vary);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('aOwn', new THREE.Float32BufferAttribute(this.own, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Lit vertex-colour material with per-vertex glow (emissive in the vertex colour) and an owner-colour switch.
 *  One program is shared by every instance; each instance owns its uniforms. */
export type RigUniforms = {uOwner: {value: THREE.Color}; uGlow: {value: number}; uPulse: {value: number}};
export function makeRigMaterial(): {mat: THREE.MeshStandardMaterial; u: RigUniforms} {
  const u: RigUniforms = {uOwner: {value: new THREE.Color('#ffffff')}, uGlow: {value: 0.4}, uPulse: {value: 1}};
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide});
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aOwn;\nvarying float vGlow;\nvarying float vOwn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vOwn = aOwn;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uOwner;\nuniform float uGlow;\nuniform float uPulse;\nvarying float vGlow;\nvarying float vOwn;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 baseTint = mix(vColor.rgb, uOwner, vOwn);\ndiffuseColor.rgb = baseTint;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += baseTint * vGlow * uGlow * uPulse;');
  };
  mat.customProgramCacheKey = () => 'moleRig';
  return {mat, u};
}
