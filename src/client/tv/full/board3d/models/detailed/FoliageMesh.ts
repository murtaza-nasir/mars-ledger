// Mesh builder for the Detailed living tiles. Everything is written into ONE static BufferGeometry with the
// per-vertex data the vegetation shader needs:
//   color   rgb
//   aO      the origin of the thing (a tree's foot): growth scales about it, wind bends from it
//   aC      centre of a leaf clump / flower head: leaf-out scales about it, flutter orbits it
//   aI      x = kind (0 bark, 1 leaf, 2 rock, 3 petal, 4 cap, 5 owner glow, 6 rune stone, 7 blade/frond, 8 structure: plain painted colour, 9 owner-coloured cloth that waves)
//           y = phase, z = height of the thing (world), w = growth delay 0..1
import * as THREE from 'three';

export type V3 = [number, number, number];
export const K = {BARK: 0, LEAF: 1, ROCK: 2, PETAL: 3, CAP: 4, OWNER: 5, RUNE: 6, BLADE: 7, STRUCT: 8, FLAG: 9} as const;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3 = {add, sub, mul, len, nrm, cross, dot};

/** a stable hash of a direction, 0..1 (so shared vertices of a blob jitter together) */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * 997) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.round(y * 991) + 17, 0xc2b2ae35) ^ Math.imul(Math.round(z * 983) + 71, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

/** a basis whose first axis is `u` */
export function basis(u: V3): [V3, V3, V3] {
  const a = nrm(u);
  const up: V3 = Math.abs(a[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const d = dot(up, a);
  const b = nrm(sub(up, mul(a, d))), c = cross(a, b);
  return [a, b, c];
}

const _ico: Record<number, number[][]> = {};
function icoFaces(detail: number): number[][] {
  if (_ico[detail]) return _ico[detail];
  const g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const p = g.getAttribute('position'), out: number[][] = [];
  for (let i = 0; i < p.count; i += 3) out.push([p.getX(i), p.getY(i), p.getZ(i), p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1), p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)]);
  return (_ico[detail] = out);
}

export class Mesher {
  p: number[] = []; n: number[] = []; col: number[] = []; aO: number[] = []; aC: number[] = []; aI: number[] = [];
  /** state stamped on every vertex */
  o: V3 = [0, 0, 0]; c: V3 | null = null; kind = 0; ph = 0; H = 1; dl = 0;
  get tris() { return this.p.length / 9; }

  set(o: V3, H: number, ph: number, dl: number) { this.o = o; this.H = H; this.ph = ph; this.dl = dl; this.c = null; this.kind = 0; }

  vert(p: V3, n: V3, c: V3) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]);
    this.aO.push(this.o[0], this.o[1], this.o[2]);
    const k = this.c ?? p; this.aC.push(k[0], k[1], k[2]);
    this.aI.push(this.kind, this.ph, this.H, this.dl);
  }
  tri(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, ca: V3, cb: V3, cc: V3) { this.vert(a, na, ca); this.vert(b, nb, cb); this.vert(c, nc, cc); }
  flat(a: V3, b: V3, c: V3, ca: V3, cb: V3 = ca, cc: V3 = ca) {
    let n = nrm(cross(sub(b, a), sub(c, a)));
    if (!isFinite(n[0])) n = [0, 1, 0];
    this.tri(a, b, c, n, n, n, ca, cb, cc);
  }
  /** a double-sided flat triangle (blades, fronds): both faces so nothing needs a side flag */
  flat2(a: V3, b: V3, c: V3, ca: V3, cb: V3 = ca, cc: V3 = ca) { this.flat(a, b, c, ca, cb, cc); this.flat(a, c, b, ca, cc, cb); }

  /** a tapered tube from a to b; smooth radial normals */
  tube(a: V3, b: V3, r0: number, r1: number, sides: number, c0: V3, c1: V3 = c0, cap = false, rot = 0) {
    const [u, s, t] = basis(sub(b, a));
    for (let i = 0; i < sides; i++) {
      const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2;
      const d0: V3 = add(mul(s, Math.cos(a0)), mul(t, Math.sin(a0))), d1: V3 = add(mul(s, Math.cos(a1)), mul(t, Math.sin(a1)));
      const p00 = add(a, mul(d0, r0)), p01 = add(a, mul(d1, r0)), p10 = add(b, mul(d0, r1)), p11 = add(b, mul(d1, r1));
      this.tri(p00, p10, p11, d0, d0, d1, c0, c1, c1);
      this.tri(p00, p11, p01, d0, d1, d1, c0, c1, c0);
    }
    if (cap) {
      for (let i = 0; i < sides; i++) {
        const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2;
        const p0 = add(b, mul(add(mul(s, Math.cos(a0)), mul(t, Math.sin(a0))), r1)), p1 = add(b, mul(add(mul(s, Math.cos(a1)), mul(t, Math.sin(a1))), r1));
        this.tri(b, p0, p1, u, u, u, c1, c1, c1);
      }
    }
  }

  /** a bent limb through points with a radius at each */
  limb(pts: V3[], radii: number[], sides: number, c0: V3, c1: V3 = c0, capEnd = false) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const f0 = i / (pts.length - 1), f1 = (i + 1) / (pts.length - 1);
      this.tube(pts[i], pts[i + 1], radii[i], radii[i + 1], sides, mixc(c0, c1, f0), mixc(c0, c1, f1), capEnd && i + 2 === pts.length, 0.3 * i);
    }
  }

  /** an oriented ellipsoid made from an icosahedron, jittered, with a lit-from-above colour gradient and per-face colour speckle */
  blob(centre: V3, ax: V3, radii: V3, detail: number, jit: number, base: V3, o: {speckle?: number; top?: number; leaf?: boolean; smooth?: boolean; drop?: number} = {}) {
    const [u, s, t] = basis(ax);
    const sp = o.speckle ?? 0.12, topK = o.top ?? 0.35;
    const keep = this.c, kk = this.kind;
    if (o.leaf !== false) { this.c = centre; if (this.kind === 0) this.kind = K.LEAF; }
    const P = (x: number, y: number, z: number): [V3, V3, number] => {
      const j = 1 + (hash3(x, y, z) - 0.5) * 2 * jit;
      const q: V3 = add(centre, add(add(mul(u, x * radii[0] * j), mul(s, y * radii[1] * j)), mul(t, z * radii[2] * j)));
      const n = nrm(add(add(mul(u, x / radii[0]), mul(s, y / radii[1])), mul(t, z / radii[2])));
      return [q, n, y];
    };
    for (const f of icoFaces(detail)) {
      const A = P(f[0], f[1], f[2]), B = P(f[3], f[4], f[5]), C = P(f[6], f[7], f[8]);
      const fh = hash3(f[0] + f[3] + f[6], f[1] + f[4] + f[7], f[2] + f[5] + f[8]);
      const k = 1 + (fh - 0.5) * 2 * sp;
      const shade = (up: number): V3 => { const g = 1 + topK * (up * 0.5 - 0.1) ; return [base[0] * g * k, base[1] * g * k * (1 + (fh - 0.5) * 0.12), base[2] * g * k]; };
      // dropping the "up" axis: the basis's s axis is not world up, so use the world-space normal's y for the gradient
      const up = (n: V3) => n[1];
      if (o.smooth === false) {
        const n = nrm(add(add(A[1], B[1]), C[1]));
        this.tri(A[0], B[0], C[0], n, n, n, shade(up(A[1])), shade(up(B[1])), shade(up(C[1])));
      } else this.tri(A[0], B[0], C[0], A[1], B[1], C[1], shade(up(A[1])), shade(up(B[1])), shade(up(C[1])));
    }
    this.c = keep; this.kind = kk;
  }

  /** a faceted rock: jittered icosahedron with flat normals and a moss-on-top colour */
  rock(centre: V3, radii: V3, detail: number, jit: number, stone: V3, moss: V3, mossAmt = 0.8, yaw = 0) {
    const keep = this.kind; this.kind = K.ROCK;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const P = (x: number, y: number, z: number): V3 => {
      const j = 1 + (hash3(x, y, z) - 0.5) * 2 * jit;
      const yy = y * radii[1] * j;
      const px = x * radii[0] * j, pz = z * radii[2] * j;
      return [centre[0] + px * cy - pz * sy, centre[1] + Math.max(yy, -radii[1] * 0.25), centre[2] + px * sy + pz * cy];
    };
    for (const f of icoFaces(detail)) {
      const A = P(f[0], f[1], f[2]), B = P(f[3], f[4], f[5]), C = P(f[6], f[7], f[8]);
      const n = nrm(cross(sub(B, A), sub(C, A)));
      const fh = hash3(f[0] * 3, f[1] * 3, f[2] * 3);
      const m = Math.max(0, Math.min(1, (n[1] - 0.25) * 2.4)) * mossAmt;
      const sh = 0.78 + fh * 0.4;
      const c: V3 = [stone[0] * sh + (moss[0] - stone[0] * sh) * m, stone[1] * sh + (moss[1] - stone[1] * sh) * m, stone[2] * sh + (moss[2] - stone[2] * sh) * m];
      this.tri(A, B, C, n, n, n, c, c, c);
    }
    this.kind = keep;
  }

  /** a jittered stone slab (rock strata): a box with a lumpy top, flat shaded, banded colour, moss on the lid */
  slab(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, jit: number, stone: V3, moss: V3, mossAmt: number, seed: number) {
    const keep = this.kind; this.kind = K.ROCK;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const nx = 3, nz = 3;
    const H = (i: number, j: number, top: boolean): V3 => {
      const u = i / nx * 2 - 1, v = j / nz * 2 - 1, edge = Math.max(Math.abs(u), Math.abs(v));
      const jj = (hash3(i + seed, j * 3 + seed, top ? 7 : 3) - 0.5) * 2 * jit;
      const px = u * w / 2 * (1 + jj * 0.3 * (edge > 0.9 ? 1 : 0)), pz = v * d / 2 * (1 + jj * 0.3 * (edge > 0.9 ? 1 : 0));
      const y = top ? y1 + jj * (y1 - y0) * 0.25 - (edge > 0.9 ? (y1 - y0) * 0.08 : 0) : y0;
      return [cx + px * cy - pz * sy, y, cz + px * sy + pz * cy];
    };
    const col = (n: V3, y: number, h: number): V3 => {
      const m = Math.max(0, Math.min(1, (n[1] - 0.45) * 2.2)) * mossAmt;
      const sh = 0.8 + h * 0.35 + (((y - y0) / Math.max(1e-4, y1 - y0)) - 0.5) * 0.12;
      return [stone[0] * sh + (moss[0] - stone[0] * sh) * m, stone[1] * sh + (moss[1] - stone[1] * sh) * m, stone[2] * sh + (moss[2] - stone[2] * sh) * m];
    };
    const quad = (a: V3, b: V3, c: V3, d: V3, h: number) => {
      const n = nrm(cross(sub(b, a), sub(c, a)));
      const cc = col(n, (a[1] + c[1]) / 2, h);
      this.tri(a, b, c, n, n, n, cc, cc, cc); this.tri(a, c, d, n, n, n, cc, cc, cc);
    };
    // lid
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = H(i, j, true), b = H(i + 1, j, true), c = H(i + 1, j + 1, true), dd = H(i, j + 1, true);
      quad(a, dd, c, b, hash3(i, j, seed));
    }
    // four walls, each split in two bands so the strata catch the light
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= nx; i++) ring.push([i, 0]);
    for (let j = 1; j <= nz; j++) ring.push([nx, j]);
    for (let i = nx - 1; i >= 0; i--) ring.push([i, nz]);
    for (let j = nz - 1; j >= 1; j--) ring.push([0, j]);
    for (let k = 0; k < ring.length; k++) {
      const [i0, j0] = ring[k], [i1, j1] = ring[(k + 1) % ring.length];
      const t0 = H(i0, j0, true), t1 = H(i1, j1, true), b0 = H(i0, j0, false), b1 = H(i1, j1, false);
      const m0: V3 = [(t0[0] + b0[0]) / 2 + (hash3(i0, j0, seed + 5) - 0.5) * (y1 - y0) * 0.08, (t0[1] + b0[1]) / 2, (t0[2] + b0[2]) / 2], m1: V3 = [(t1[0] + b1[0]) / 2 + (hash3(i1, j1, seed + 5) - 0.5) * (y1 - y0) * 0.08, (t1[1] + b1[1]) / 2, (t1[2] + b1[2]) / 2];
      quad(t0, m0, m1, t1, hash3(k, 1, seed)); quad(m0, b0, b1, m1, hash3(k, 2, seed));
    }
    this.kind = keep;
  }

  /** a cone / spire (flat shaded) */
  cone(base: V3, tip: V3, r: number, sides: number, c0: V3, c1: V3 = c0, rot = 0) {
    const [, s, t] = basis(sub(tip, base));
    for (let i = 0; i < sides; i++) {
      const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2;
      const p0 = add(base, mul(add(mul(s, Math.cos(a0)), mul(t, Math.sin(a0))), r)), p1 = add(base, mul(add(mul(s, Math.cos(a1)), mul(t, Math.sin(a1))), r));
      this.flat(p0, tip, p1, c0, c1, c0);
    }
  }

  /** a flat disc / fan facing `up` (petals, lily pads, mushroom caps seen from above) */
  fan(centre: V3, up: V3, r: number, sides: number, c0: V3, c1: V3 = c0, lift = 0) {
    const [u, s, t] = basis(up);
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
      const p0 = add(centre, add(mul(add(mul(s, Math.cos(a0)), mul(t, Math.sin(a0))), r), mul(u, -lift)));
      const p1 = add(centre, add(mul(add(mul(s, Math.cos(a1)), mul(t, Math.sin(a1))), r), mul(u, -lift)));
      this.flat(add(centre, mul(u, lift * 0.0)), p1, p0, c0, c1, c1);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const F = (a: number[], k: number) => new THREE.BufferAttribute(new Float32Array(a), k);
    g.setAttribute('position', F(this.p, 3)); g.setAttribute('normal', F(this.n, 3)); g.setAttribute('color', F(this.col, 3));
    g.setAttribute('aO', F(this.aO, 3)); g.setAttribute('aC', F(this.aC, 3)); g.setAttribute('aI', F(this.aI, 4));
    g.computeBoundingSphere();
    return g;
  }
}

export function mixc(a: V3, b: V3, t: number): V3 { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const _c = new THREE.Color();
/** hsl to the linear-ish triple the vertex colours use (three treats vertex colours as linear, so go through Color) */
export function hsl(h: number, s: number, l: number): V3 { _c.setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace); return [_c.r, _c.g, _c.b]; }
export function hex(c: string): V3 { _c.set(c); return [_c.r, _c.g, _c.b]; }
