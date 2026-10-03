// Tree species and undergrowth for the Detailed living tiles. Every builder writes into a Mesher in tile-local
// coordinates (y = 0 on the prism top). `lod` 'lite' merges the branch structure into a few big crowns so the same
// tree reads at a glance with a fraction of the triangles.
import {K, Mesher, hsl, mixc, v3, type V3} from './FoliageMesh';

export type Lod = 'full' | 'lite';
export type Species = 'conifer' | 'oak' | 'birch' | 'teal' | 'fern' | 'oldoak' | 'oldfir' | 'redwood';
export type Pal = {hue: number; sat: number; lit: number; bark: V3};

const BARK = hsl(0.07, 0.35, 0.3);
export const palette = (hueShift: number): Pal => ({hue: 0.27 + hueShift, sat: 0.6, lit: 0.34, bark: BARK});

/** a seeded palette for one tree: mostly healthy greens, some yellow-green, gold, rust and orange crowns (conifers stay cool) */
export function treePal(r: () => number, base: Pal, conifer = false): Pal {
  const x = r();
  const v = (hue: number, sat: number, lit: number): Pal => ({...base, hue: hue + (r() - 0.5) * 0.025, sat: sat * (0.9 + r() * 0.2), lit: lit * (0.9 + r() * 0.2)});
  if (conifer) return x < 0.12 ? v(0.4, 0.45, 0.28) : x < 0.2 ? v(0.2, 0.55, 0.3) : v(base.hue + (r() - 0.5) * 0.06, base.sat, base.lit * 0.85);
  if (x < 0.4) return v(base.hue + (r() - 0.5) * 0.08, base.sat, base.lit);
  if (x < 0.55) return v(0.19, 0.6, 0.36);
  if (x < 0.72) return v(0.125, 0.7, 0.4);
  if (x < 0.85) return v(0.06, 0.65, 0.36);
  if (x < 0.93) return v(0.085, 0.8, 0.42);
  return v(0.34, 0.55, 0.3);
}

const leaf = (p: Pal, rnd: () => number, dh = 0.06, dl = 0.1): V3 => hsl(p.hue + (rnd() - 0.5) * dh, p.sat * (0.8 + rnd() * 0.35), p.lit + (rnd() - 0.4) * dl);
const bark = (rnd: () => number, k = 1): V3 => { const b = BARK; const f = (0.85 + rnd() * 0.3) * k; return [b[0] * f, b[1] * f, b[2] * f]; };

/** Straight-ish branch from a to b, returns the tip. Wiggles a little for a hand-grown look. */
function branch(m: Mesher, rnd: () => number, a: V3, b: V3, r0: number, r1: number, sides: number, c0: V3, c1: V3, wig = 0.06) {
  const mid: V3 = [(a[0] + b[0]) / 2 + (rnd() - 0.5) * wig * v3.len(v3.sub(b, a)), (a[1] + b[1]) / 2 + (rnd() - 0.2) * wig * v3.len(v3.sub(b, a)), (a[2] + b[2]) / 2 + (rnd() - 0.5) * wig * v3.len(v3.sub(b, a))];
  m.limb([a, mid, b], [r0, (r0 + r1) / 2, r1], sides, c0, c1);
}

/** Layered spruce / fir: trunk, whorls of drooping branches, a needle spray along each. */
export function conifer(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, pal: Pal, fat = 1) {
  const full = lod === 'full';
  const L = full ? (H > 0.5 ? 8 : 6) : 5, nb = 4;
  const trunkC = bark(rnd);
  m.limb([[x, 0, z], [x + (rnd() - 0.5) * 0.01 * H, H * 0.5, z], [x, H * 0.99, z]], [H * 0.032, H * 0.017, H * 0.003], full ? 5 : 4, trunkC, bark(rnd, 0.8));
  const rot = rnd() * 6.28;
  for (let i = 0; i < L; i++) {
    const f = 0.16 + 0.8 * i / (L - 1), y = f * H, reach = (0.07 + (1 - f) * 0.33) * H * fat * (0.9 + rnd() * 0.2);
    const cl = leaf(pal, rnd, 0.04, 0.06);
    const topLit = 1 + (f - 0.4) * 0.5;
    if (!full) {
      m.c = [x, y, z]; m.kind = K.LEAF;
      m.cone([x, y - H * 0.045, z], [x, y + H * 0.13, z], reach * 0.95, 7, [cl[0] * 0.8 * topLit, cl[1] * 0.82 * topLit, cl[2] * 0.8 * topLit], [cl[0] * topLit, cl[1] * topLit, cl[2] * topLit], rnd());
      continue;
    }
    m.c = [x, y, z]; m.kind = K.LEAF;
    m.cone([x, y - H * 0.03, z], [x, y + H * 0.075, z], reach * 0.8, 8, [cl[0] * 0.78 * topLit, cl[1] * 0.8 * topLit, cl[2] * 0.78 * topLit], [cl[0] * topLit, cl[1] * topLit, cl[2] * topLit], rnd());
    for (let k = 0; k < nb; k++) {
      const ang = rot + i * 1.1 + (k / nb) * 6.283 + (rnd() - 0.5) * 0.5;
      const dir: V3 = [Math.cos(ang), -0.14 - rnd() * 0.1, Math.sin(ang)];
      const tip: V3 = [x + dir[0] * reach, y + dir[1] * reach, z + dir[2] * reach];
      m.kind = K.BARK; m.c = null;
      m.tube([x, y, z], tip, H * 0.007, H * 0.003, 3, trunkC, bark(rnd, 0.9));
      const mid: V3 = [x + dir[0] * reach * 0.62, y + dir[1] * reach * 0.62 - H * 0.012, z + dir[2] * reach * 0.62];
      m.blob(mid, [dir[0], 0, dir[2]], [reach * 0.6, H * 0.04, reach * 0.36], 0, 0.16, [cl[0] * topLit, cl[1] * topLit, cl[2] * topLit], {speckle: 0.2, smooth: false});
    }
  }
  m.kind = K.LEAF; m.c = [x, H * 0.99, z];
  if (full) m.cone([x, H * 0.9, z], [x, H * 1.03, z], H * 0.035, 4, leaf(pal, rnd), leaf(pal, rnd));
  m.kind = K.BARK; m.c = null;
}

/** Broadleaf with a buttressed trunk, forking limbs and leaf-clump crowns. */
export function oak(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, pal: Pal, wide = 1, bigTrunk = 1) {
  const full = lod === 'full';
  const th = H * 0.42, lean = (rnd() - 0.5) * 0.05 * H;
  const trunkC = bark(rnd), trunkT = bark(rnd, 0.85);
  const r0 = H * 0.04 * bigTrunk;
  m.limb([[x, 0, z], [x + lean * 0.5, th * 0.35, z], [x + lean, th * 0.7, z + lean * 0.4], [x + lean * 1.2, th, z + lean * 0.5]], [r0 * 1.15, r0, r0 * 0.8, r0 * 0.62], full ? 7 : 5, trunkC, trunkT);
  const base: V3 = [x + lean * 1.2, th, z + lean * 0.5];
  if (full) {
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.28 + i * 1.57;
      m.tube([x + Math.cos(a) * r0 * 0.5, th * 0.3, z + Math.sin(a) * r0 * 0.5], [x + Math.cos(a) * r0 * 2.2, 0, z + Math.sin(a) * r0 * 2.2], r0 * 0.5, r0 * 0.28, 4, trunkT, trunkC);
    }
  }
  const nP = full ? 3 : 2, w = wide;
  const crownC = (): V3 => leaf(pal, rnd);
  for (let i = 0; i < nP; i++) {
    const a = rnd() * 6.28 + i * (6.283 / nP);
    const dx = Math.cos(a), dz = Math.sin(a);
    const mid: V3 = [base[0] + dx * H * 0.1 * w, th + H * 0.12, base[2] + dz * H * 0.1 * w];
    const tip: V3 = [base[0] + dx * H * 0.2 * w, th + H * 0.24, base[2] + dz * H * 0.2 * w];
    if (full) {
      m.kind = K.BARK; m.c = null;
      m.limb([base, mid, tip], [r0 * 0.5, r0 * 0.36, r0 * 0.2], 5, trunkT, bark(rnd, 0.9));
      for (let k = 0; k < 2; k++) {
        const b = a + (k ? 0.8 : -0.8) + (rnd() - 0.5) * 0.4;
        const t2: V3 = [mid[0] + Math.cos(b) * H * 0.15 * w, mid[1] + H * (0.16 + rnd() * 0.08), mid[2] + Math.sin(b) * H * 0.15 * w];
        m.kind = K.BARK; m.c = null;
        branch(m, rnd, mid, t2, r0 * 0.24, r0 * 0.11, 4, trunkT, bark(rnd), 0.1);
        const cc = crownC();
        m.blob(t2, [1, 0, 0], [H * 0.12, H * 0.1, H * 0.12], 1, 0.2, cc, {speckle: 0.16});
        for (let q = 0; q < 2; q++) m.blob([t2[0] + (rnd() - 0.5) * H * 0.2, t2[1] + (rnd() - 0.6) * H * 0.1, t2[2] + (rnd() - 0.5) * H * 0.2], [1, 0, 0], [H * 0.07, H * 0.055, H * 0.07], 0, 0.22, crownC(), {speckle: 0.18});
      }
      m.blob(tip, [1, 0, 0], [H * 0.13, H * 0.105, H * 0.13], 1, 0.2, crownC(), {speckle: 0.16});
    } else {
      m.kind = K.BARK; m.c = null;
      m.tube(base, tip, r0 * 0.45, r0 * 0.2, 4, trunkT, bark(rnd));
      m.blob([tip[0] + dx * H * 0.05, tip[1], tip[2] + dz * H * 0.05], [1, 0, 0], [H * 0.17, H * 0.13, H * 0.17], 0, 0.2, crownC(), {speckle: 0.16});
    }
  }
  m.kind = K.BARK; m.c = null;
  m.blob([base[0], th + H * 0.36, base[2]], [1, 0, 0], [H * 0.14, H * 0.11, H * 0.14], full ? 1 : 0, 0.2, crownC(), {speckle: 0.14});
}

/** Slender white birch with hanging, pale leaf clumps. */
export function birch(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, pal: Pal) {
  const full = lod === 'full';
  const white: V3 = [0.78, 0.76, 0.7], dark: V3 = [0.12, 0.1, 0.09];
  const lean = (rnd() - 0.5) * 0.08 * H;
  const segs = full ? 6 : 3;
  for (let i = 0; i < segs; i++) {
    const f0 = i / segs, f1 = (i + 1) / segs;
    const p0: V3 = [x + lean * f0 * f0, f0 * H * 0.8, z], p1: V3 = [x + lean * f1 * f1, f1 * H * 0.8, z];
    m.kind = K.BARK; m.c = null;
    m.tube(p0, p1, H * 0.022 * (1 - f0 * 0.7), H * 0.022 * (1 - f1 * 0.7), 5, i % 2 ? white : mixc(white, dark, 0.28), white, false, i);
    if (full) m.tube(p1, [p1[0], p1[1] + H * 0.006, p1[2]], H * 0.0225 * (1 - f1 * 0.7), H * 0.0225 * (1 - f1 * 0.7), 5, dark, dark);
  }
  const top: V3 = [x + lean, H * 0.8, z];
  const nB = full ? 6 : 3;
  for (let i = 0; i < nB; i++) {
    const a = rnd() * 6.28, f = 0.4 + 0.6 * i / nB, y = f * H * 0.8;
    const bs: V3 = [x + lean * f * f, y, z];
    const tip: V3 = [bs[0] + Math.cos(a) * H * (0.1 + (1 - f) * 0.14), y + H * 0.1, bs[2] + Math.sin(a) * H * (0.1 + (1 - f) * 0.14)];
    m.kind = K.BARK; m.c = null;
    if (full) m.tube(bs, tip, H * 0.007, H * 0.003, 3, white, dark);
    const cl = hsl(pal.hue - 0.03 + (rnd() - 0.5) * 0.04, 0.55, 0.3 + rnd() * 0.08);
    m.blob([tip[0], tip[1] - H * 0.02, tip[2]], [Math.cos(a), 0, Math.sin(a)], [H * 0.075, H * 0.08, H * 0.07], full ? 0 : 0, 0.2, cl, {speckle: 0.2});
  }
  m.kind = K.BARK; m.c = null;
  m.blob([top[0], top[1] + H * 0.1, top[2]], [1, 0, 0], [H * 0.085, H * 0.13, H * 0.085], 0, 0.2, hsl(pal.hue - 0.02, 0.58, 0.32), {speckle: 0.2});
}

/** The teal Martian cultivar: a curved, ribbed trunk and stacked layered discs that glow at night. */
export function teal(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, _pal: Pal) {
  const full = lod === 'full';
  const lean = (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.06) * H;
  const tc = hsl(0.5, 0.2, 0.18);
  m.limb([[x, 0, z], [x + lean * 0.25, H * 0.3, z], [x + lean * 0.7, H * 0.62, z + lean * 0.2], [x + lean, H * 0.82, z + lean * 0.3]], [H * 0.032, H * 0.022, H * 0.017, H * 0.012], full ? 6 : 4, tc, hsl(0.45, 0.3, 0.26));
  const cx = x + lean, cz = z + lean * 0.3;
  const n = full ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const f = i / n, r = H * (0.27 - f * 0.1), y = H * (0.8 + f * 0.17);
    const col = hsl(0.47 + rnd() * 0.05, 0.6, 0.27 + f * 0.05);
    m.blob([cx + (rnd() - 0.5) * 0.02 * H, y, cz], [1, 0, 0], [r, H * 0.055, r], i === 0 && full ? 1 : 0, 0.16, col, {speckle: 0.2, top: 0.5});
  }
  if (full) {
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + rnd(); m.kind = K.BARK; m.c = null; m.tube([cx, H * 0.78, cz], [cx + Math.cos(a) * H * 0.2, H * 0.84, cz + Math.sin(a) * H * 0.2], H * 0.006, H * 0.003, 3, tc, tc); }
  }
  m.kind = K.BARK; m.c = null;
}

/** A tree fern: fibrous stem and a crown of arching, serrated fronds. */
export function treeFern(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, pal: Pal) {
  const full = lod === 'full';
  const sc = hsl(0.08, 0.35, 0.14);
  m.kind = K.BARK; m.c = null;
  m.limb([[x, 0, z], [x + (rnd() - 0.5) * 0.04 * H, H * 0.5, z], [x, H * 0.72, z]], [H * 0.045, H * 0.04, H * 0.03], full ? 6 : 4, sc, hsl(0.07, 0.3, 0.2));
  const n = full ? 9 : 6;
  for (let i = 0; i < n; i++) frond(m, rnd, [x, H * 0.72, z], rnd() * 6.28 + i * 0.7, H * (0.4 + rnd() * 0.15), H * 0.045, 0.55 + rnd() * 0.3, pal, full ? 4 : 2);
  m.kind = K.BARK; m.c = null;
}

/** One arching frond (strip of segments, double sided). */
export function frond(m: Mesher, rnd: () => number, o: V3, ang: number, len: number, wid: number, arch: number, pal: Pal, segs = 3) {
  const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
  const c0 = hsl(pal.hue + (rnd() - 0.5) * 0.04, pal.sat, pal.lit * 0.8), c1 = hsl(pal.hue + 0.02, pal.sat * 0.9, pal.lit * 1.5);
  m.kind = K.BLADE; m.c = o;
  let prev: V3 = o, prevW = wid * 0.2;
  for (let i = 1; i <= segs; i++) {
    const f = i / segs, out = len * f, up = len * (Math.sin(f * 1.6 * arch + 0.5) * 0.55) - len * f * f * arch * 0.6;
    const p: V3 = [o[0] + dx * out, o[1] + up + len * 0.08 * f, o[2] + dz * out];
    const w = wid * (Math.sin(f * 3.14159 * 0.9 + 0.2) + 0.15) * (1 - f * 0.25);
    const a0: V3 = [prev[0] - px * prevW, prev[1], prev[2] - pz * prevW], a1: V3 = [prev[0] + px * prevW, prev[1], prev[2] + pz * prevW];
    const b0: V3 = [p[0] - px * w, p[1], p[2] - pz * w], b1: V3 = [p[0] + px * w, p[1], p[2] + pz * w];
    const cA = mixc(c0, c1, (i - 1) / segs), cB = mixc(c0, c1, f);
    m.flat2(a0, b0, b1, cA, cB, cB); m.flat2(a0, b1, a1, cA, cB, cA);
    prev = p; prevW = w;
  }
  m.kind = K.BARK; m.c = null;
}

/** An old-growth giant: massive fluted trunk, root buttresses, a few long limbs, moss, vines, high clumped crown. */
export function oldoak(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, pal: Pal, cs = 0.7) {
  const full = lod === 'full';
  const trunkC = bark(rnd, 1.0), trunkT = bark(rnd, 0.8);
  const r0 = H * 0.065, th = H * 0.5;
  const lean = (rnd() - 0.5) * 0.04 * H;
  m.kind = K.BARK; m.c = null;
  m.limb([[x, 0, z], [x + lean * 0.2, th * 0.3, z], [x + lean * 0.6, th * 0.65, z], [x + lean, th, z + lean * 0.3]], [r0 * 1.1, r0 * 0.85, r0 * 0.68, r0 * 0.55], full ? 9 : 6, trunkC, trunkT);
  const nR = full ? 6 : 3;
  for (let i = 0; i < nR; i++) {
    const a = i / nR * 6.283 + rnd();
    const rr = r0 * 3.2;
    m.tube([x + Math.cos(a) * r0 * 0.5, th * 0.34, z + Math.sin(a) * r0 * 0.5], [x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr], r0 * 0.55, r0 * 0.3, full ? 5 : 3, trunkT, trunkC);
  }
  const moss = hsl(0.26, 0.5, 0.2);
  if (full) {
    // moss collar on the trunk and a little shelf fungus
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.28;
      m.kind = K.LEAF; m.blob([x + Math.cos(a) * r0 * 0.8, th * (0.12 + rnd() * 0.5), z + Math.sin(a) * r0 * 0.8], [1, 0, 0], [r0 * 0.5, r0 * 0.5, r0 * 0.5], 0, 0.3, moss, {speckle: 0.2});
    }
    m.kind = K.BARK; m.c = null;
  }
  const base: V3 = [x + lean, th, z + lean * 0.3];
  const nP = full ? 4 : 3;
  for (let i = 0; i < nP; i++) {
    const a = rnd() * 6.28 + i * (6.283 / nP);
    const dx = Math.cos(a), dz = Math.sin(a);
    const mid: V3 = [base[0] + dx * H * 0.12, th + H * 0.1, base[2] + dz * H * 0.12];
    const tip: V3 = [base[0] + dx * H * 0.24, th + H * 0.26, base[2] + dz * H * 0.24];
    m.kind = K.BARK; m.c = null;
    m.limb([base, mid, tip], [r0 * 0.5, r0 * 0.36, r0 * 0.22], full ? 6 : 4, trunkT, bark(rnd, 0.9));
    const cc = leaf(pal, rnd, 0.06, 0.07);
    if (full) {
      for (let k = 0; k < 2; k++) {
        const b = a + (k ? 0.7 : -0.7);
        const t2: V3 = [tip[0] + Math.cos(b) * H * 0.12, tip[1] + H * (0.12 + rnd() * 0.06), tip[2] + Math.sin(b) * H * 0.12];
        m.kind = K.BARK; m.c = null;
        branch(m, rnd, tip, t2, r0 * 0.2, r0 * 0.1, 4, trunkT, bark(rnd), 0.1);
        m.blob(t2, [1, 0, 0], [H * 0.16 * cs, H * 0.115 * cs, H * 0.16 * cs], 1, 0.2, leaf(pal, rnd, 0.06, 0.07), {speckle: 0.15});
      }
    }
    m.blob(tip, [1, 0, 0], [H * 0.22 * cs, H * 0.14 * cs, H * 0.22 * cs], full ? 1 : 0, 0.2, cc, {speckle: 0.15});
  }
  m.kind = K.BARK; m.c = null;
  m.blob([base[0], th + H * 0.4, base[2]], [1, 0, 0], [H * 0.22 * cs, H * 0.14 * cs, H * 0.22 * cs], full ? 1 : 0, 0.2, leaf(pal, rnd, 0.05, 0.07), {speckle: 0.14});
  if (full) {
    // hanging vines
    const vine = hsl(0.28, 0.5, 0.16);
    for (let i = 0; i < 5; i++) {
      const a = rnd() * 6.28, rr = H * (0.12 + rnd() * 0.14);
      const top: V3 = [base[0] + Math.cos(a) * rr, th + H * (0.2 + rnd() * 0.15), base[2] + Math.sin(a) * rr];
      m.kind = K.BLADE; m.c = top;
      const l = H * (0.14 + rnd() * 0.1);
      m.flat2(top, [top[0] + 0.004 * H, top[1] - l, top[2]], [top[0] - 0.004 * H, top[1] - l * 0.98, top[2] + 0.002 * H], vine, mixc(vine, [0.2, 0.55, 0.2], 0.4), vine);
    }
    m.kind = K.BARK; m.c = null;
  }
}

/** A tall straight old-growth conifer with a narrow, deep crown (redwood-like). */
export function oldfir(m: Mesher, rnd: () => number, x: number, z: number, H: number, lod: Lod, pal: Pal) {
  const full = lod === 'full';
  const trunkC = bark(rnd, 1.1);
  m.kind = K.BARK; m.c = null;
  const r0 = H * 0.034;
  m.limb([[x, 0, z], [x + (rnd() - 0.5) * 0.01 * H, H * 0.4, z], [x, H * 0.98, z]], [r0, r0 * 0.6, r0 * 0.1], full ? 8 : 5, trunkC, bark(rnd, 0.85));
  if (full) for (let i = 0; i < 5; i++) { const a = rnd() * 6.28; m.tube([x + Math.cos(a) * r0 * 0.5, H * 0.07, z + Math.sin(a) * r0 * 0.5], [x + Math.cos(a) * r0 * 2.3, 0, z + Math.sin(a) * r0 * 2.3], r0 * 0.45, r0 * 0.28, 4, bark(rnd, 0.8), trunkC); }
  const L = full ? 9 : 6, nb = 4;
  const rot = rnd() * 6.28;
  for (let i = 0; i < L; i++) {
    const f = 0.34 + 0.64 * i / (L - 1), y = f * H, reach = (0.05 + (1 - f) * 0.26) * H;
    const cl = leaf(pal, rnd, 0.04, 0.05); cl[1] *= 1.05;
    const g = 1 + (f - 0.5) * 0.45;
    if (!full) {
      m.c = [x, y, z]; m.kind = K.LEAF;
      m.cone([x, y - H * 0.04, z], [x, y + H * 0.11, z], reach * 0.9, 7, [cl[0] * 0.8 * g, cl[1] * 0.82 * g, cl[2] * 0.8 * g], [cl[0] * g, cl[1] * g, cl[2] * g], rnd());
      continue;
    }
    m.c = [x, y, z]; m.kind = K.LEAF;
    m.cone([x, y - H * 0.03, z], [x, y + H * 0.085, z], reach * 0.78, 8, [cl[0] * 0.78 * g, cl[1] * 0.8 * g, cl[2] * 0.78 * g], [cl[0] * g, cl[1] * g, cl[2] * g], rnd());
    for (let k = 0; k < nb; k++) {
      const ang = rot + i * 1.3 + k / nb * 6.283 + (rnd() - 0.5) * 0.5;
      const dir: V3 = [Math.cos(ang), -0.16 - rnd() * 0.08, Math.sin(ang)];
      const tip: V3 = [x + dir[0] * reach, y + dir[1] * reach, z + dir[2] * reach];
      m.kind = K.BARK; m.c = null;
      m.tube([x, y, z], tip, H * 0.0045, H * 0.002, 3, trunkC, bark(rnd));
      m.blob([x + dir[0] * reach * 0.62, y + dir[1] * reach * 0.62 - H * 0.01, z + dir[2] * reach * 0.62], [dir[0], 0, dir[2]], [reach * 0.6, H * 0.034, reach * 0.34], 0, 0.16, [cl[0] * g, cl[1] * g, cl[2] * g], {speckle: 0.2, smooth: false});
    }
  }
  m.kind = K.LEAF; m.c = [x, H, z];
  if (full) m.cone([x, H * 0.93, z], [x, H * 1.03, z], H * 0.022, 4, leaf(pal, rnd), leaf(pal, rnd));
  m.kind = K.BARK; m.c = null;
}

// ---- undergrowth -------------------------------------------------------------------------------------------------

export function fern(m: Mesher, rnd: () => number, x: number, z: number, h: number, pal: Pal, lod: Lod) {
  const n = lod === 'full' ? 7 : 4;
  m.set([x, 0, z], h, rnd(), rnd());
  for (let i = 0; i < n; i++) frond(m, rnd, [x, h * 0.05, z], rnd() * 6.28, h * (0.8 + rnd() * 0.5), h * 0.14, 0.5 + rnd() * 0.5, pal, lod === 'full' ? 3 : 2);
}
export function tuft(m: Mesher, rnd: () => number, x: number, z: number, h: number, pal: Pal, n = 6) {
  m.set([x, 0, z], h, rnd(), rnd());
  m.kind = K.BLADE;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.28, r = h * 0.25 * rnd(), l = h * (0.6 + rnd() * 0.5), lean = (0.1 + rnd() * 0.35) * l;
    const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
    const c0 = hsl(pal.hue + 0.02 + rnd() * 0.04, 0.5, 0.16), c1 = hsl(pal.hue + 0.05 + rnd() * 0.04, 0.55, 0.38);
    const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean, w = h * 0.05;
    m.c = [bx, 0, bz];
    m.flat2([bx - Math.sin(a) * w, 0, bz + Math.cos(a) * w], [bx + Math.sin(a) * w, 0, bz - Math.cos(a) * w], [tx, l, tz], c0, c0, c1);
  }
  m.kind = K.BARK; m.c = null;
}
export function shrub(m: Mesher, rnd: () => number, x: number, z: number, s: number, pal: Pal, lod: Lod, berry = false) {
  m.set([x, 0, z], s * 1.6, rnd(), rnd());
  const n = lod === 'full' ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.28, r = i ? s * 0.5 : 0;
    m.blob([x + Math.cos(a) * r, s * (0.55 + i * 0.05), z + Math.sin(a) * r], [1, 0, 0], [s * (0.9 - i * 0.18), s * 0.7, s * (0.9 - i * 0.18)], 0, 0.22, leaf(pal, rnd, 0.08, 0.08), {speckle: 0.2});
  }
  if (berry && lod === 'full') {
    m.kind = K.PETAL; for (let i = 0; i < 4; i++) { const a = rnd() * 6.28; const c: V3 = [x + Math.cos(a) * s * 0.8, s * (0.5 + rnd() * 0.5), z + Math.sin(a) * s * 0.8]; m.c = c; m.blob(c, [1, 0, 0], [s * 0.1, s * 0.1, s * 0.1], 0, 0.1, hsl(0.98, 0.7, 0.4), {leaf: false, speckle: 0.1}); }
    m.kind = K.BARK; m.c = null;
  }
}
export function flower(m: Mesher, rnd: () => number, x: number, z: number, h: number, col: V3, lod: Lod) {
  m.set([x, 0, z], h, rnd(), rnd());
  const lean = (rnd() - 0.5) * h * 0.4;
  const top: V3 = [x + lean, h, z + (rnd() - 0.5) * h * 0.3];
  const stem = hsl(0.27, 0.5, 0.2);
  m.kind = K.BLADE; m.c = [x, 0, z];
  const w = h * 0.03;
  m.flat2([x - w, 0, z], [x + w, 0, z], top, stem, stem, stem);
  m.kind = K.PETAL; m.c = top;
  const nn = lod === 'full' ? 6 : 4;
  const [, s, t] = ((): [V3, V3, V3] => { const u: V3 = [0.15, 1, 0.1]; const a = v3.nrm(v3.cross(Math.abs(u[1]) < 0.95 ? [0, 0, 1] : [1, 0, 0], u)); return [u, a, v3.cross(u, a)]; })();
  const r = h * 0.28, cc = hsl(0.12, 0.9, 0.55);
  for (let i = 0; i < nn; i++) {
    const a0 = i / nn * 6.283, a1 = (i + 1) / nn * 6.283;
    const p0: V3 = v3.add(top, v3.mul(v3.add(v3.mul(s, Math.cos(a0)), v3.mul(t, Math.sin(a0))), r));
    const p1: V3 = v3.add(top, v3.mul(v3.add(v3.mul(s, Math.cos(a1)), v3.mul(t, Math.sin(a1))), r));
    const up: V3 = [top[0], top[1] + r * 0.18, top[2]];
    m.flat(up, p1, p0, cc, col, col); m.flat(up, p0, p1, cc, col, col);
  }
  m.kind = K.BARK; m.c = null;
}
export function mushroom(m: Mesher, rnd: () => number, x: number, z: number, s: number, lod: Lod) {
  m.set([x, 0, z], s * 2, rnd(), rnd());
  const cap = rnd() < 0.5 ? hsl(0.55 + rnd() * 0.08, 0.7, 0.5) : hsl(0.0 + rnd() * 0.04, 0.7, 0.45);
  m.kind = K.BARK; m.c = null;
  m.tube([x, 0, z], [x, s * 0.8, z], s * 0.12, s * 0.09, lod === 'full' ? 5 : 3, hsl(0.1, 0.1, 0.8), hsl(0.1, 0.1, 0.7));
  m.kind = K.CAP; m.c = [x, s * 0.85, z];
  m.blob([x, s * 0.85, z], [1, 0, 0], [s * 0.5, s * 0.28, s * 0.5], lod === 'full' ? 1 : 0, 0.05, cap, {leaf: false, speckle: 0.08});
  m.kind = K.BARK; m.c = null;
}
export function log(m: Mesher, rnd: () => number, x: number, z: number, len: number, r: number, yaw: number, lod: Lod) {
  m.set([x, 0, z], r * 2.5, rnd(), rnd());
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  const a: V3 = [x - dx * len / 2, r * 0.75, z - dz * len / 2], b: V3 = [x + dx * len / 2, r * 0.7, z + dz * len / 2];
  const c = bark(rnd, 0.9), c2 = bark(rnd, 1.2);
  m.kind = K.BARK; m.c = null;
  const sides = lod === 'full' ? 8 : 5;
  m.limb([a, [x, r * 0.8, z + 0.01 * len], b], [r, r * 0.95, r * 0.9], sides, c, c2);
  const cut = hsl(0.09, 0.45, 0.45);
  m.fan(b, [dx, 0.05, dz], r * 0.9, sides, cut, hsl(0.07, 0.4, 0.3));
  if (lod === 'full') {
    m.fan(a, [-dx, 0.05, -dz], r * 0.9, sides, cut, hsl(0.07, 0.4, 0.3));
    m.kind = K.LEAF;
    for (let i = 0; i < 3; i++) { const f = 0.15 + rnd() * 0.7; const cc: V3 = [x + dx * (f - 0.5) * len, r * 1.6, z + dz * (f - 0.5) * len]; m.c = cc; m.blob(cc, [dx, 0, dz], [len * 0.12, r * 0.38, r * 0.7], 0, 0.3, hsl(0.26, 0.55, 0.22), {speckle: 0.2}); }
    m.kind = K.BARK; m.c = null;
    const ph = hsl(0.1, 0.2, 0.65);
    for (let i = 0; i < 2; i++) { const f = 0.3 + rnd() * 0.4, ps: V3 = [x + dx * (f - 0.5) * len + dz * r * 0.9, r * (0.7 + rnd() * 0.5), z + dz * (f - 0.5) * len - dx * r * 0.9]; m.fan(ps, [dz, 0.1, -dx], r * 0.35, 5, ph, hsl(0.08, 0.3, 0.5)); }
  }
}
export function rockCluster(m: Mesher, rnd: () => number, x: number, z: number, s: number, lod: Lod, stone: V3 = hsl(0.08, 0.06, 0.34), moss: V3 = hsl(0.26, 0.5, 0.2)) {
  m.set([x, 0, z], s * 1.4, rnd(), rnd());
  const d = lod === 'full' ? 1 : 0, yaw = rnd() * 6.28;
  m.rock([x, s * 0.25, z], [s, s * 0.7, s * 0.85], d, 0.22, stone, moss, 0.9, yaw);
  const n = lod === 'full' ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.28, r = s * (0.9 + rnd() * 0.4), q = s * (0.35 + rnd() * 0.25);
    m.rock([x + Math.cos(a) * r, q * 0.25, z + Math.sin(a) * r], [q, q * 0.7, q * 0.9], 0, 0.25, stone, moss, 0.9, rnd() * 6);
  }
}

/** A simple owner lantern post (owner-glow orb on a dark pole). */
export function lantern(m: Mesher, x: number, z: number, h: number) {
  m.set([x, 0, z], h, 0, 0);
  m.kind = K.BARK; m.c = null;
  const dark = hsl(0.08, 0.2, 0.1);
  m.tube([x, 0, z], [x, h, z], h * 0.025, h * 0.016, 6, dark, dark, true);
  m.tube([x, h * 0.55, z], [x + h * 0.12, h * 0.8, z], h * 0.012, h * 0.01, 4, dark, dark);
  m.kind = K.OWNER; m.c = [x + h * 0.15, h * 0.76, z];
  m.blob([x + h * 0.15, h * 0.76, z], [1, 0, 0], [h * 0.07, h * 0.09, h * 0.07], 1, 0.02, [1, 1, 1], {leaf: false, speckle: 0, top: 0});
  m.kind = K.BARK; m.c = null;
}
