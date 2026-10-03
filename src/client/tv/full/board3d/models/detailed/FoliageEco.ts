// The Ecological Zone plan: two rock-walled terraces, a lake with reeds on the outer one, nests, boulders and research
// markers, and a small grove under the glass dome on the inner one. Static merged geometry, shared per variant.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {hexGround} from '../FoliageKit';
import {Placer, cached, inHex, mulberry} from './FoliageLayout';
import {K, Mesher, hex, hsl, mixc, type V3} from './FoliageMesh';
import {treePal, birch, flower, fern, mushroom, oak, palette, rockCluster, shrub, teal, treeFern, tuft, type Lod} from './FoliageTrees';
import {addKAttr, waterDist, type Water} from './FoliageMat';

export const ECO = {TA: 0.05, TB: 0.115, RA: 0.94, RB: 0.62, DOME: 0.53, WALK: 0.79};

export type EcoPlan = {water: Water; terrace: THREE.BufferGeometry; trees: THREE.BufferGeometry; props: THREE.BufferGeometry; lakeAngle: number; tris: number};

export function planEco(variant: number, lod: Lod, R: number): EcoPlan {
  return cached(`eco|${variant}|${lod}|${R}`, () => build(variant, lod, R));
}

function terraceGeo(R: number, lod: Lod): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const strip = (g: THREE.BufferGeometry, k: number) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal') n.deleteAttribute(a);
    addKAttr(n, k);
    parts.push(n);
  };
  const tier = (r: number, y0: number, y1: number, N: number) => {
    const wall = new THREE.CylinderGeometry(r, r * 1.035, y1 - y0, 6, 1, true); wall.translate(0, (y0 + y1) / 2, 0);
    strip(wall, 1);
    const top = hexGround(r, N); top.translate(0, y1, 0);
    strip(top, 0);
  };
  tier(ECO.RA * R, 0, ECO.TA * R, lod === 'full' ? 5 : 4);
  tier(ECO.RB * R, ECO.TA * R, ECO.TB * R, lod === 'full' ? 4 : 3);
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

function build(variant: number, lod: Lod, R: number): EcoPlan {
  const rnd = mulberry(0xec0 + variant * 6151);
  const TA = ECO.TA * R, TB = ECO.TB * R;
  const lakeAngle = Math.PI / 2 + (rnd() - 0.5) * 0.5;
  const lc: [number, number] = [Math.cos(lakeAngle) * 0.73, Math.sin(lakeAngle) * 0.73];
  const water: Water = {pond: [lc[0], lc[1], 0.21 + rnd() * 0.03, 0.075 + rnd() * 0.012], path: [[9, 9], [9.1, 9.1]], width: 0.01};
  const wd = (x: number, z: number) => waterDist(water, x / R, z / R) * R;
  const pal = palette((rnd() - 0.5) * 0.04);
  const tm = new Mesher(), pm = new Mesher();

  // ---- the grove under the dome (inner terrace)
  const grove = new Placer(rnd, R * 0.4, 0.95, []);
  const gT: Array<{sp: string; x: number; z: number; H: number; seed: number}> = [];
  const gTry = (sp: string, n: number, h0: number, h1: number, rad: number) => {
    for (let i = 0; i < n; i++) {
      const H = R * (h0 + rnd() * (h1 - h0));
      const s = grove.try(R * rad, 1, 60, (x, z) => Math.hypot(x, z) < R * 0.36); if (!s) continue;
      gT.push({sp, x: s.x, z: s.z, H, seed: Math.floor(rnd() * 1e9)});
    }
  };
  gTry('oak', 4, 0.32, 0.42, 0.075); gTry('birch', 3, 0.34, 0.44, 0.05); gTry('teal', 3, 0.27, 0.36, 0.08); gTry('fern', 3, 0.14, 0.2, 0.08);
  for (const t of gT) {
    const r = mulberry(t.seed);
    tm.set([t.x, 0, t.z], t.H, r(), r());
    // trees are built at y = 0 and lifted by the terrace height (the builders place feet at y = 0)
    const from = tm.p.length;
    const q = treePal(r, pal);
    if (t.sp === 'oak') oak(tm, r, t.x, t.z, t.H, lod, q, 0.55);
    else if (t.sp === 'birch') birch(tm, r, t.x, t.z, t.H, lod, q);
    else if (t.sp === 'teal') teal(tm, r, t.x, t.z, t.H, lod, q);
    else treeFern(tm, r, t.x, t.z, t.H, lod, q);
    lift(tm, from, TB);
  }
  const rg = grove.placed.map((p) => p);
  const gfree = (x: number, z: number, r: number) => rg.every((t) => Math.hypot(t.x - x, t.z - z) > t.r * 0.4 + r);
  // grove floor: ferns, shrubs, flowers, tufts, a mushroom ring
  const fcols: V3[] = [hex('#ffe45e'), hex('#ff93c4'), hex('#ffffff'), hex('#9ab8ff')];
  const gl = (n: number, make: (x: number, z: number, r: () => number) => void, rad: number) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = R * 0.38 * Math.sqrt(rnd()), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!gfree(x, z, rad)) continue;
      const from = pm.p.length, r = mulberry(Math.floor(rnd() * 1e9)); make(x, z, r); lift(pm, from, TB);
    }
  };
  gl(10, (x, z, r) => fern(pm, r, x, z, R * (0.07 + r() * 0.04), pal, lod), R * 0.03);
  gl(8, (x, z, r) => shrub(pm, r, x, z, R * (0.035 + r() * 0.02), pal, lod, r() < 0.4), R * 0.03);
  if (lod === 'full') {
    gl(26, (x, z, r) => flower(pm, r, x, z, R * (0.05 + r() * 0.03), fcols[Math.floor(r() * 4)], lod), R * 0.01);
    gl(30, (x, z, r) => tuft(pm, r, x, z, R * (0.04 + r() * 0.03), pal, 5), R * 0.01);
    gl(3, (x, z, r) => { for (let j = 0; j < 3; j++) mushroom(pm, r, x + (r() - 0.5) * R * 0.04, z + (r() - 0.5) * R * 0.04, R * (0.015 + r() * 0.012), lod); }, R * 0.03);
  }

  // ---- the outer terrace: reeds, nests, boulders
  const free = (x: number, z: number) => wd(x, z) > R * 0.02 && Math.hypot(x, z) > R * 0.66 && Math.hypot(x, z) < R * 0.9 && inHex(x, z, R, 0.97);
  // reeds and cattails ring the lake
  const [lcx, lcz, lrx, lrz] = water.pond;
  const nReed = 16;
  for (let i = 0; i < nReed; i++) {
    const a = rnd() * 6.283, k = 1.02 + rnd() * 0.18;
    const x = (lcx + Math.cos(a) * lrx * k) * R, z = (lcz + Math.sin(a) * lrz * k) * R;
    if (Math.hypot(x, z) < R * 0.66 || Math.hypot(x, z) > R * 0.9 || !inHex(x, z, R, 0.95)) continue;
    const r = mulberry(Math.floor(rnd() * 1e9)), h = R * (0.09 + r() * 0.06);
    const from = pm.p.length;
    pm.set([x, 0, z], h, r(), r());
    const nb = lod === 'full' ? 4 : 2;
    for (let b = 0; b < nb; b++) {
      const aa = r() * 6.28, bx = x + Math.cos(aa) * R * 0.012, bz = z + Math.sin(aa) * R * 0.012, l = h * (0.7 + r() * 0.4), lean = l * (0.1 + r() * 0.3);
      const c0 = hsl(0.2 + r() * 0.04, 0.5, 0.2), c1 = hsl(0.2 + r() * 0.04, 0.55, 0.4), w = R * 0.007;
      pm.kind = K.BLADE; pm.c = [bx, 0, bz];
      pm.flat2([bx - w, 0, bz], [bx + w, 0, bz], [bx + Math.cos(aa) * lean, l, bz + Math.sin(aa) * lean], c0, c0, c1);
    }
    if (lod === 'full' && r() < 0.5) {
      const l = h * 1.05;
      pm.kind = K.BLADE; pm.c = [x, 0, z];
      pm.tube([x, 0, z], [x + R * 0.006, l, z], R * 0.003, R * 0.003, 3, hsl(0.18, 0.4, 0.3));
      pm.tube([x + R * 0.006, l * 0.9, z], [x + R * 0.007, l * 1.12, z], R * 0.0075, R * 0.0065, 5, hsl(0.06, 0.55, 0.2), hsl(0.06, 0.5, 0.26), true);
    }
    pm.kind = K.BARK; pm.c = null;
    lift(pm, from, TA);
  }
  // nests: a ring of twigs, eggs, and one sitting bird
  const nestAngles = [lakeAngle + 2.2, lakeAngle + 3.6, lakeAngle + 5.0].map((a) => a + (rnd() - 0.5) * 0.3);
  const nests: Array<[number, number]> = [];
  nestAngles.forEach((a, ni) => {
    const nr = R * (0.7 + rnd() * 0.03), x = Math.cos(a) * nr, z = Math.sin(a) * nr;
    nests.push([x, z]);
    const from = pm.p.length, r = mulberry(Math.floor(rnd() * 1e9));
    pm.set([x, 0, z], R * 0.05, r(), r());
    const nrad = R * 0.036, tw = hsl(0.08, 0.4, 0.22);
    const nT = lod === 'full' ? 12 : 8;
    for (let i = 0; i < nT; i++) {
      const a0 = i / nT * 6.283, a1 = a0 + 0.9;
      pm.kind = K.BARK; pm.c = null;
      pm.tube([x + Math.cos(a0) * nrad, R * 0.006, z + Math.sin(a0) * nrad], [x + Math.cos(a1) * nrad * 1.02, R * 0.014, z + Math.sin(a1) * nrad * 1.02], R * 0.0045, R * 0.003, 3, tw, mixc(tw, [0.4, 0.28, 0.14], 0.5));
    }
    pm.kind = K.STRUCT; pm.c = null;
    pm.fan([x, R * 0.012, z], [0, 1, 0], nrad * 0.9, 8, hsl(0.09, 0.3, 0.14));
    if (ni === 1 && lod === 'full') {
      // a mother bird on the eggs
      const white = hsl(0.09, 0.12, 0.88);
      pm.blob([x, R * 0.03, z], [1, 0, 0], [R * 0.028, R * 0.02, R * 0.022], 1, 0.05, white, {leaf: false, speckle: 0.05});
      pm.blob([x + R * 0.02, R * 0.044, z], [1, 0, 0], [R * 0.012, R * 0.012, R * 0.012], 0, 0.05, white, {leaf: false, speckle: 0.05});
      pm.cone([x + R * 0.03, R * 0.044, z], [x + R * 0.044, R * 0.043, z], R * 0.005, 4, hsl(0.1, 0.9, 0.5));
    } else {
      const eg = lod === 'full' ? 3 : 2;
      for (let e = 0; e < eg; e++) {
        const ea = e * 2.1 + r() * 2;
        pm.blob([x + Math.cos(ea) * nrad * 0.35, R * 0.02, z + Math.sin(ea) * nrad * 0.35], [1, 0, 0], [R * 0.013, R * 0.017, R * 0.013], lod === 'full' ? 1 : 0, 0.03, hsl(0.12, 0.2, 0.86 - e * 0.04), {leaf: false, speckle: 0.06});
      }
    }
    pm.kind = K.BARK; pm.c = null;
    lift(pm, from, TA);
  });
  // boulders on the outer terrace
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 30; k++) {
      const a = rnd() * 6.283, d = R * (0.68 + rnd() * 0.2), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!free(x, z) || wd(x, z) < R * 0.04 || nests.some(([nx, nz]) => Math.hypot(nx - x, nz - z) < R * 0.1)) continue;
      const from = pm.p.length, r = mulberry(Math.floor(rnd() * 1e9));
      rockCluster(pm, r, x, z, R * (0.03 + rnd() * 0.03), lod);
      lift(pm, from, TA); break;
    }
  }
  // research markers (owner-coloured cloth and beacons)
  const mk = (x: number, z: number, kind: 'tripod' | 'mast' | 'stake', y0: number, seed: number) => {
    const r = mulberry(seed), from = pm.p.length;
    pm.set([x, 0, z], R * 0.25, r(), r());
    const steel = hsl(0.58, 0.1, 0.62), dark = hsl(0.6, 0.15, 0.2);
    pm.kind = K.STRUCT; pm.c = null;
    if (kind === 'tripod') {
      const hgt = R * 0.1;
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; pm.tube([x + Math.cos(a) * R * 0.035, 0, z + Math.sin(a) * R * 0.035], [x, hgt, z], R * 0.003, R * 0.0025, 3, steel, steel); }
      pm.blob([x, hgt + R * 0.012, z], [1, 0, 0], [R * 0.018, R * 0.012, R * 0.014], 0, 0.0, dark, {leaf: false, speckle: 0.05, smooth: false});
      pm.fan([x, hgt + R * 0.028, z], [0.3, 1, 0], R * 0.016, 6, hsl(0.58, 0.5, 0.45), hsl(0.6, 0.5, 0.28));
      pm.kind = K.FLAG; pm.c = [x, hgt, z];
      pm.flat2([x + R * 0.018, hgt + R * 0.005, z], [x + R * 0.018, hgt + R * 0.035, z], [x + R * 0.05, hgt + R * 0.022, z + R * 0.006], [1, 1, 1]);
    } else if (kind === 'mast') {
      const hgt = R * 0.26;
      pm.tube([x, 0, z], [x, hgt, z], R * 0.006, R * 0.0035, 5, steel, steel);
      for (let i = 0; i < 2; i++) pm.tube([x, hgt * (0.5 + i * 0.22), z], [x + (i ? -1 : 1) * R * 0.03, hgt * (0.5 + i * 0.22) + R * 0.01, z], R * 0.0025, R * 0.002, 3, steel, steel);
      for (let i = 0; i < 3; i++) { const a = i * 2.094; pm.blob([x + Math.cos(a) * R * 0.022, hgt + R * 0.004, z + Math.sin(a) * R * 0.022], [1, 0, 0], [R * 0.007, R * 0.006, R * 0.007], 0, 0, steel, {leaf: false, speckle: 0, smooth: false}); }
      pm.kind = K.OWNER; pm.c = [x, hgt + R * 0.02, z];
      pm.blob([x, hgt + R * 0.02, z], [1, 0, 0], [R * 0.011, R * 0.011, R * 0.011], 1, 0, [1, 1, 1], {leaf: false, speckle: 0, top: 0});
    } else {
      const hgt = R * 0.075;
      pm.tube([x, 0, z], [x, hgt, z], R * 0.0028, R * 0.0028, 3, hsl(0.09, 0.4, 0.3), hsl(0.09, 0.4, 0.3));
      pm.fan([x, hgt, z], [0, 0, 1], R * 0.014, 4, hsl(0.14, 0.9, 0.6), hsl(0.14, 0.8, 0.5));
      pm.kind = K.FLAG; pm.c = [x, hgt, z];
      pm.flat2([x, hgt + R * 0.012, z], [x, hgt + R * 0.03, z], [x + R * 0.026, hgt + R * 0.022, z + R * 0.004], [1, 1, 1]);
    }
    pm.kind = K.BARK; pm.c = null;
    lift(pm, from, y0);
  };
  const markA = lakeAngle + 0.9, markB = lakeAngle + 4.2;
  mk(Math.cos(markA) * R * 0.78, Math.sin(markA) * R * 0.78, 'tripod', TA, 11);
  mk(Math.cos(markB) * R * 0.78, Math.sin(markB) * R * 0.78, 'mast', TA, 12);
  mk(Math.cos(lakeAngle - 0.55) * R * 0.76, Math.sin(lakeAngle - 0.55) * R * 0.76, 'stake', TA, 13);
  for (let i = 0; i < 3; i++) { const a = lakeAngle + 1.6 + i * 1.0; mk(Math.cos(a) * R * 0.6 * 1.0, Math.sin(a) * R * 0.6, 'stake', TB, 20 + i); }
  // the dome's base ring: a glowing owner-coloured collar with posts
  const dr = ECO.DOME * R;
  pm.set([0, 0, 0], R * 0.2, 0, 0);
  pm.kind = K.OWNER; pm.c = [0, TB, 0];
  const from0 = pm.p.length;
  const N = 36;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * 6.283, a1 = (i + 1) / N * 6.283;
    pm.tube([Math.cos(a0) * dr, 0, Math.sin(a0) * dr], [Math.cos(a1) * dr, 0, Math.sin(a1) * dr], R * 0.006, R * 0.006, 4, [1, 1, 1]);
  }
  lift(pm, from0, TB + R * 0.004);
  pm.kind = K.STRUCT; pm.c = null;
  const from1 = pm.p.length;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * 6.283 + 0.26;
    pm.tube([Math.cos(a) * dr * 1.04, 0, Math.sin(a) * dr * 1.04], [Math.cos(a) * dr * 1.04, R * 0.035, Math.sin(a) * dr * 1.04], R * 0.01, R * 0.008, 4, hsl(0.58, 0.1, 0.5), hsl(0.58, 0.1, 0.6), true);
  }
  lift(pm, from1, TB);
  pm.kind = K.BARK;
  return {water, terrace: terraceGeo(R, lod), trees: tm.build(), props: pm.build(), lakeAngle, tris: tm.tris + pm.tris};
}

/** shift everything written to the mesher since array index `from` up by dy (the builders put feet at y = 0), origins and clump centres included */
function lift(m: Mesher, from: number, dy: number) {
  const v0 = from / 3;
  for (let v = v0; v < m.p.length / 3; v++) { m.p[v * 3 + 1] += dy; m.aO[v * 3 + 1] += dy; m.aC[v * 3 + 1] += dy; }
}
