// Board life's drawing kit: parts merged into one skinned mesh (every part is rigidly bound to one bone, so a whole
// character, or every prop, is one draw call that animates by moving bones), the shared lit material, and a sphere
// patch generator for faces, helmets, hair and visors.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The night's glow for every life material: 0 by day, up to 1 deep at night (headlamps, antennas, screens). */
export const glow = {value: 0};

/** Lit, vertex-coloured, with a per-vertex glow that follows the night. One program serves every life mesh. */
export function lifeMaterial(map?: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.62, metalness: 0.04, map: map ?? null});
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = glow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * (0.15 + uGlow * 1.5);');
  };
  m.customProgramCacheKey = () => 'board-life-v1';
  return m;
}

/** Collects parts, each bound to a bone; build() merges them into one geometry with skin indices and weights. */
export class Parts {
  private list: THREE.BufferGeometry[] = [];
  private col = new THREE.Color();
  /** vertices so far, for locating a part in the merged geometry */
  count = 0;

  /** `uv`: where every vertex of this part samples the material's map (the atlas' white texel unless given). */
  add(geo: THREE.BufferGeometry, bone: number, color: string | number, glowAmt = 0, uv: [number, number] | null = [0.9375, 0.0625]): this {
    const g = geo;
    const n = g.getAttribute('position').count;
    this.col.set(color as THREE.ColorRepresentation);
    const c = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), gl = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = this.col.r; c[i * 3 + 1] = this.col.g; c[i * 3 + 2] = this.col.b; si[i * 4] = bone; sw[i * 4] = 1; gl[i] = glowAmt; }
    const out = new THREE.BufferGeometry();
    if (g.index) out.setIndex(g.index.clone());
    else out.setIndex(Array.from({length: n}, (_, i) => i));
    out.setAttribute('position', g.getAttribute('position').clone());
    out.setAttribute('normal', g.getAttribute('normal').clone());
    const uvAttr = g.getAttribute('uv');
    if (uv || !uvAttr) {
      const u = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { u[i * 2] = uv?.[0] ?? 0.9375; u[i * 2 + 1] = uv?.[1] ?? 0.0625; }
      out.setAttribute('uv', new THREE.BufferAttribute(u, 2));
    } else out.setAttribute('uv', uvAttr.clone());
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    out.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    this.list.push(out);
    this.count += n;
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    for (const p of this.list) p.dispose();
    this.list = [];
    return g;
  }
}

// ---- small shape helpers (all in the rig's rest-pose space; y up, the front is +z) -----------------------------
const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number): T => { g.translate(x, y, z); return g; };

export const ball = (r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 10) => { const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 3)); g.scale(sx, sy, sz); return at(g, x, y, z); };
export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => at(new THREE.BoxGeometry(w, h, d), x, y, z);
/** A rounded block: a box with its corners pulled into a soft shape (a sphere's normals blend in), cheap and cute. */
export const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0, seg = 8) => at(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z);
export const cone = (r: number, h: number, x = 0, y = 0, z = 0, seg = 6) => at(new THREE.ConeGeometry(r, h, seg), x, y, z);
export const capsule = (r: number, len: number, x = 0, y = 0, z = 0, seg = 8) => at(new THREE.CapsuleGeometry(r, len, 3, seg), x, y, z);
export const torus = (r: number, tube: number, x = 0, y = 0, z = 0, seg = 10) => at(new THREE.TorusGeometry(r, tube, 5, seg), x, y, z);
export const ico = (r: number, x = 0, y = 0, z = 0, detail = 0) => at(new THREE.IcosahedronGeometry(r, detail), x, y, z);

/** Apply a rotation then a translation to a geometry (rotation about the origin, Euler XYZ). */
export function place<T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
}

/**
 * A patch of a sphere around (cx, cy, cz): azimuth phi from the front (+z) toward +x, polar angle theta from the top.
 * `th0` and `th1` may depend on phi (a helmet's rim sits higher in front). UVs run 0..1 across the patch.
 */
export function patch(R: number, cx: number, cy: number, cz: number, phi0: number, phi1: number, th0: number | ((phi: number) => number), th1: number | ((phi: number) => number),
  nP = 12, nT = 6, sy = 1): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nP; i++) {
    const u = i / nP, phi = phi0 + (phi1 - phi0) * u;
    const a = typeof th0 === 'number' ? th0 : th0(phi), b = typeof th1 === 'number' ? th1 : th1(phi);
    for (let j = 0; j <= nT; j++) {
      const v = j / nT, th = a + (b - a) * v;
      const nx = Math.sin(th) * Math.sin(phi), ny = Math.cos(th), nz = Math.sin(th) * Math.cos(phi);
      pos.push(cx + R * nx, cy + R * ny * sy, cz + R * nz);
      nor.push(nx, ny, nz);
      uv.push(u, 1 - v);
    }
  }
  for (let i = 0; i < nP; i++) for (let j = 0; j < nT; j++) {
    const a = i * (nT + 1) + j, b = (i + 1) * (nT + 1) + j;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A skinned mesh over `bones` (the first bone's ancestors carry the transform); bound at the rest pose already set. */
export function skinnedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, bones: THREE.Bone[], root: THREE.Object3D): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}

/** Turn a surface inside out (winding and normals), so a bowl shows its inside. */
export function flip<T extends THREE.BufferGeometry>(g: T): T {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1), b = idx.getX(i + 2); idx.setX(i + 1, b); idx.setX(i + 2, a); }
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
