// Geometry builders of the Detailed City and Capital: flat-shaded primitives with per-vertex animation attributes,
// a dome builder and a light-sprite builder. Everything is plain arrays turned into BufferGeometry once per plan.
import * as THREE from 'three';

export type V3 = [number, number, number];
type Col = THREE.Color;

export class Mesh {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  private ex: number[][];
  stamp: number[] = [];
  constructor(private spec: Array<[string, number]>) { this.ex = spec.map(() => []); }
  set(...parts: number[][]) { this.stamp = parts.flat(); }
  private vert(p: V3, n: V3, c: Col) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c.r, c.g, c.b);
    let o = 0;
    for (let i = 0; i < this.spec.length; i++) { const sz = this.spec[i][1]; for (let k = 0; k < sz; k++) this.ex[i].push(this.stamp[o + k]); o += sz; }
  }
  get tris() { return this.pos.length / 9; }
  tri(a: V3, b: V3, c: V3, color: Col, flip = false) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const pts = flip ? [a, c, b] : [a, b, c];
    for (const p of pts) this.vert(p, [nx, ny, nz], color);
  }
  /** a quad whose normal faces away from `ctr` */
  quad(a: V3, b: V3, c: V3, d: V3, color: Col, ctr: V3) {
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const m: V3 = [(a[0] + c[0]) / 2 - ctr[0], (a[1] + c[1]) / 2 - ctr[1], (a[2] + c[2]) / 2 - ctr[2]];
    if (nx * m[0] + ny * m[1] + nz * m[2] >= 0) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
    else { this.tri(a, c, b, color); this.tri(a, d, c, color); }
  }
  /** an n-sided frustum standing on y0 (sides run +z at yaw 0); sx/sz stretch it; cap closes the top */
  prism(cx: number, cz: number, r0: number, r1: number, sides: number, yaw: number, y0: number, y1: number, color: Col,
    o: {cap?: boolean; sx?: number; sz?: number; top?: Col; inward?: boolean} = {}) {
    const {cap = true, sx = 1, sz = 1, inward = false} = o;
    const pt = (i: number, r: number, y: number): V3 => {
      const th = (i / sides) * Math.PI * 2 + yaw;
      return [cx + Math.sin(th) * r * sx, y, cz + Math.cos(th) * r * sz];
    };
    for (let i = 0; i < sides; i++) {
      const a = pt(i, r0, y0), b = pt(i + 1, r0, y0), c = pt(i + 1, r1, y1), d = pt(i, r1, y1);
      this.tri(a, b, c, color, inward); this.tri(a, c, d, color, inward);
      if (cap) this.tri([cx, y1, cz], pt(i, r1, y1), pt(i + 1, r1, y1), o.top ?? color);
    }
  }
  box(cx: number, cz: number, w: number, d: number, yaw: number, y0: number, y1: number, color: Col, top?: Col) {
    this.prism(cx, cz, Math.SQRT1_2, Math.SQRT1_2, 4, yaw + Math.PI / 4, y0, y1, color, {sx: w, sz: d, top});
  }
  /** a flat ring at height y (faces up) */
  annulus(cx: number, cz: number, r0: number, r1: number, sides: number, y: number, color: Col, yaw = 0) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2 + yaw, a1 = ((i + 1) / sides) * Math.PI * 2 + yaw;
      const p = (a: number, r: number): V3 => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
      this.tri(p(a0, r0), p(a0, r1), p(a1, r1), color); this.tri(p(a0, r0), p(a1, r1), p(a1, r0), color);
    }
  }
  /** a balcony / ledge ring around a shaft: outer wall plus a flat top */
  ledge(cx: number, cz: number, r0: number, r1: number, sides: number, yaw: number, y: number, t: number, color: Col, topColor?: Col) {
    this.prism(cx, cz, r1, r1, sides, yaw, y, y + t, color, {cap: false});
    this.annulus(cx, cz, r0, r1, sides, y + t, topColor ?? color, yaw);
  }
  disc(cx: number, cz: number, r: number, y: number, sides: number, color: Col) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      this.tri([cx, y, cz], [cx + Math.sin(a0) * r, y, cz + Math.cos(a0) * r], [cx + Math.sin(a1) * r, y, cz + Math.cos(a1) * r], color);
    }
  }
  /** a flat-sided tube from a to b */
  beam(a: V3, b: V3, r: number, sides: number, color: Col, caps = false) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / l, ay = dy / l, az = dz / l;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ay) > 0.9) { ux = 1; uy = 0; }
    let px = ay * uz - az * uy, py = az * ux - ax * uz, pz = ax * uy - ay * ux;
    const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
    const qx = ay * pz - az * py, qy = az * px - ax * pz, qz = ax * py - ay * px;
    const ring = (o: V3, i: number): V3 => {
      const th = (i / sides) * Math.PI * 2, c = Math.cos(th) * r, s = Math.sin(th) * r;
      return [o[0] + px * c + qx * s, o[1] + py * c + qy * s, o[2] + pz * c + qz * s];
    };
    for (let i = 0; i < sides; i++) {
      const p0 = ring(a, i), p1 = ring(a, i + 1), q1 = ring(b, i + 1), q0 = ring(b, i);
      this.tri(p0, p1, q1, color, true); this.tri(p0, q1, q0, color, true);
      if (caps) {
        // end caps, facing along the axis
        this.cap(a, p0, p1, [-ax, -ay, -az], color);
        this.cap(b, q0, q1, [ax, ay, az], color);
      }
    }
  }
  private cap(c: V3, p: V3, q: V3, out: V3, color: Col) {
    const nx = (p[1] - c[1]) * (q[2] - c[2]) - (p[2] - c[2]) * (q[1] - c[1]);
    const ny = (p[2] - c[2]) * (q[0] - c[0]) - (p[0] - c[0]) * (q[2] - c[2]);
    const nz = (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0]);
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) this.tri(c, p, q, color); else this.tri(c, q, p, color);
  }
  /** an oriented box: size (w, h, d), tilted about its x axis by pitch, then turned about y by yaw */
  obox(c: V3, size: V3, yaw: number, pitch: number, color: Col, top?: Col) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const P = (sxn: number, syn: number, szn: number): V3 => {
      const lx = sxn * size[0] / 2, ly0 = syn * size[1] / 2, lz0 = szn * size[2] / 2;
      const ly = ly0 * cp - lz0 * sp, lz = ly0 * sp + lz0 * cp;
      return [c[0] + lx * cy + lz * sy, c[1] + ly, c[2] - lx * sy + lz * cy];
    };
    const f: Array<[V3, V3, V3, V3, Col]> = [
      [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), top ?? color],
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), color],
      [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), color],
      [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), color],
      [P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), color],
    ];
    for (const [a, b, cc, d, col] of f) this.quad(a, b, cc, d, col, c);
  }
  geometry(radius = 3.2): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    this.spec.forEach(([name, sz], i) => g.setAttribute(name, new THREE.Float32BufferAttribute(this.ex[i], sz)));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), radius);
    return g;
  }
}

export class DomeBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; ctr: number[] = []; idx: number[] = [];
  constructor(private LON: number, private LAT: number) {}
  dome(cx: number, y0: number, cz: number, r: number, h: number, delay: number) {
    const {LON, LAT} = this, base = this.pos.length / 3;
    for (let j = 0; j <= LAT; j++) {
      const phi = (j / LAT) * Math.PI / 2;
      for (let i = 0; i <= LON; i++) {
        const th = (i / LON) * Math.PI * 2, nx = Math.sin(phi) * Math.sin(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.cos(th);
        this.pos.push(cx + nx * r, y0 + ny * h, cz + nz * r);
        const l = Math.hypot(nx * h, ny * r, nz * h) || 1;
        this.nor.push(nx * h / l, ny * r / l, nz * h / l);
        this.uv.push(i * 12 / LON, j * 6 / LAT);
        this.ctr.push(cx, y0, cz, delay);
      }
    }
    for (let j = 0; j < LAT; j++) for (let i = 0; i < LON; i++) {
      const a = base + j * (LON + 1) + i, b = a + 1, c = a + LON + 1, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCtr', new THREE.Float32BufferAttribute(this.ctr, 4));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3.2);
    return g;
  }
}

export const GK = {steady: 0, beacon: 1, dust: 3, line: 4, owner: 5, crown: 6, neon: 7, flame: 8, arc: 9, arcLoop: 10, shimmer: 11} as const;
export class GlowBuilder {
  pos: number[] = []; cor: number[] = []; p: number[] = []; v: number[] = []; col: number[] = []; idx: number[] = [];
  count = 0;
  add(at: V3, size: number, kind: number, phase: number, delay: number, color: Col, v: [number, number, number, number] = [0, 0, 0, 0]) {
    const base = this.pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.pos.push(at[0], at[1], at[2]); this.cor.push(cx, cy);
      this.p.push(size, kind, phase, delay); this.v.push(v[0], v[1], v[2], v[3]); this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count++;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.cor, 2));
    g.setAttribute('aP', new THREE.Float32BufferAttribute(this.p, 4));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(this.v, 4));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4);
    return g;
  }
}
