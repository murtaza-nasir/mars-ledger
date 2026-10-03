// The Natural Preserve plan: old-growth giants, a stratified cliff with a stepped waterfall into a pool and stream,
// a ring of standing stones with glowing runes, and the ranger beacon tower. Static merged geometry, shared per variant.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {hexGround} from '../FoliageKit';
import {Placer, cached, inHex, mulberry} from './FoliageLayout';
import {K, Mesher, hex, hsl, mixc, type V3} from './FoliageMesh';
import {treePal, birch, conifer, flower, fern, log, mushroom, oak, oldfir, oldoak, palette, rockCluster, shrub, teal, treeFern, tuft, type Lod} from './FoliageTrees';
import {addKAttr, waterDist, type Water} from './FoliageMat';

export type PreservePlan = {
  water: Water; ground: THREE.BufferGeometry; trees: THREE.BufferGeometry; props: THREE.BufferGeometry;
  fall: Array<[number, number]>; fallAt: [number, number]; fallW: number; beacon: [number, number, number]; poolAt: [number, number]; tris: number;
};

export function planPreserve(variant: number, lod: Lod, R: number): PreservePlan {
  return cached(`pres|${variant}|${lod}|${R}`, () => build(variant, lod, R));
}

function build(variant: number, lod: Lod, R: number): PreservePlan {
  const rnd = mulberry(0x9a5 + variant * 4409);
  const full = lod === 'full';
  const flip = variant % 2 ? -1 : 1;
  const mx = (x: number) => x * flip;
  // cliff block at the back; fronts step forward toward the camera as the layers go down
  const cx = mx(-0.04 + (rnd() - 0.5) * 0.12), zb = -0.6;
  const layers = [
    {y0: 0, y1: 0.17, front: zb + 0.15, w: 0.66}, {y0: 0.16, y1: 0.33, front: zb + 0.1, w: 0.62}, {y0: 0.32, y1: 0.47, front: zb + 0.05, w: 0.56}, {y0: 0.46, y1: 0.62, front: zb, w: 0.5},
  ];
  const pool: [number, number, number, number] = [cx, zb + 0.27, 0.2, 0.1];
  const path: Array<[number, number]> = [[cx, zb + 0.27], [cx - flip * 0.1, zb + 0.46], [cx - flip * 0.26, zb + 0.66], [cx - flip * 0.2, zb + 0.9], [cx - flip * 0.3, zb + 1.15], [cx - flip * 0.42, zb + 1.45]];
  const water: Water = {pond: pool, path, width: 0.03};
  const wd = (x: number, z: number) => waterDist(water, x / R, z / R) * R;
  const beacon: [number, number] = [mx(0.34), 0.2];
  const inCliff = (x: number, z: number) => Math.abs(x / R - cx) < 0.42 && z / R < zb + 0.36;
  const pal = palette(-0.01 + (rnd() - 0.5) * 0.03);
  const stone = hsl(0.1, 0.07, 0.44), moss = hsl(0.26, 0.5, 0.24);
  const tm = new Mesher(), pm = new Mesher();

  // ---- standing stones round the beacon clearing
  const nStone = 7;
  for (let i = 0; i < nStone; i++) {
    const a = i / nStone * 6.283 + 0.4 + (rnd() - 0.5) * 0.15, rr = R * (0.27 + (rnd() - 0.5) * 0.03);
    const x = beacon[0] * R + Math.cos(a) * rr, z = beacon[1] * R + Math.sin(a) * rr;
    if (wd(x, z) < R * 0.05 || !inHex(x, z, R, 0.92)) continue;
    const r = mulberry(Math.floor(rnd() * 1e9)), h = R * (0.17 + r() * 0.1);
    pm.set([x, 0, z], h, r(), r());
    pm.kind = K.RUNE; pm.c = null;
    const lean = (r() - 0.5) * 0.12, grey = mixc(stone, [0.5, 0.5, 0.5], 0.2);
    pm.limb([[x, -R * 0.01, z], [x + lean * h * 0.5, h * 0.55, z], [x + lean * h, h, z + lean * h * 0.3]], [R * 0.048, R * 0.04, R * 0.026], 4, grey, mixc(grey, [0.6, 0.6, 0.6], 0.2), true);
    pm.cone([x + lean * h, h, z + lean * h * 0.3], [x + lean * h * 1.05, h * 1.1, z + lean * h * 0.3], R * 0.026, 4, grey, grey);
    pm.kind = K.LEAF; pm.c = [x, R * 0.012, z];
    if (full) pm.blob([x, R * 0.012, z], [1, 0, 0], [R * 0.06, R * 0.02, R * 0.06], 0, 0.3, moss, {speckle: 0.2});
    pm.kind = K.BARK; pm.c = null;
  }

  // ---- the ranger beacon: stepped stone base, banded hex tower, balcony, lantern room with owner glow, roof
  {
    const [bx, bz] = [beacon[0] * R, beacon[1] * R];
    pm.set([bx, 0, bz], R * 0.62, 0.3, 0.05);
    pm.kind = K.ROCK; pm.c = null;
    const gStone = mixc(stone, [0.7, 0.68, 0.6], 0.3);
    pm.tube([bx, 0, bz], [bx, R * 0.04, bz], R * 0.115, R * 0.1, 6, gStone, gStone, true);
    pm.tube([bx, R * 0.04, bz], [bx, R * 0.075, bz], R * 0.085, R * 0.075, 6, gStone, gStone, true);
    const bands = full ? 5 : 3, th = R * 0.44;
    for (let i = 0; i < bands; i++) {
      const f0 = i / bands, f1 = (i + 1) / bands;
      const c = i % 2 ? mixc(gStone, [0.35, 0.32, 0.28], 0.25) : mixc(gStone, [0.8, 0.78, 0.7], 0.2);
      pm.tube([bx, R * 0.075 + th * f0, bz], [bx, R * 0.075 + th * f1, bz], R * (0.062 - f0 * 0.018), R * (0.062 - f1 * 0.018), 6, c, c, false, 0.52);
    }
    const yTop = R * 0.075 + th;
    pm.kind = K.STRUCT;
    const metal = hsl(0.08, 0.2, 0.18);
    pm.tube([bx, yTop, bz], [bx, yTop + R * 0.012, bz], R * 0.07, R * 0.07, 6, metal, metal, true);
    const rail = full ? 12 : 6;
    for (let i = 0; i < rail; i++) { const a = i / rail * 6.283; pm.tube([bx + Math.cos(a) * R * 0.066, yTop + R * 0.012, bz + Math.sin(a) * R * 0.066], [bx + Math.cos(a) * R * 0.066, yTop + R * 0.04, bz + Math.sin(a) * R * 0.066], R * 0.0025, R * 0.0025, 3, metal, metal); }
    // lantern room: glowing owner-coloured glass between six posts
    pm.kind = K.OWNER; pm.c = [bx, yTop + R * 0.065, bz];
    pm.blob([bx, yTop + R * 0.065, bz], [1, 0, 0], [R * 0.03, R * 0.04, R * 0.03], full ? 1 : 0, 0.02, [1, 1, 1], {leaf: false, speckle: 0, top: 0});
    pm.kind = K.STRUCT; pm.c = null;
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; pm.tube([bx + Math.cos(a) * R * 0.036, yTop + R * 0.012, bz + Math.sin(a) * R * 0.036], [bx + Math.cos(a) * R * 0.036, yTop + R * 0.11, bz + Math.sin(a) * R * 0.036], R * 0.003, R * 0.003, 3, metal, metal); }
    pm.cone([bx, yTop + R * 0.108, bz], [bx, yTop + R * 0.165, bz], R * 0.052, 6, hsl(0.04, 0.4, 0.22), hsl(0.04, 0.4, 0.3));
    pm.tube([bx, yTop + R * 0.16, bz], [bx, yTop + R * 0.2, bz], R * 0.003, R * 0.002, 3, metal, metal);
    // a little door and window slits on the shaft
    if (full) {
      pm.kind = K.STRUCT;
      pm.fan([bx, R * 0.075 + R * 0.04, bz + R * 0.064], [0, 0.1, 1], R * 0.013, 4, hsl(0.07, 0.4, 0.2), hsl(0.07, 0.4, 0.2));
    }
    pm.kind = K.BARK; pm.c = null;
  }

  // ---- cliff strata
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const w = L.w * R, d = (L.front - (zb - 0.18)) * R, zc = ((L.front + (zb - 0.18)) / 2) * R;
    const tone = [hsl(0.08, 0.1, 0.4), hsl(0.1, 0.18, 0.46), hsl(0.07, 0.12, 0.36), hsl(0.09, 0.2, 0.44)][i];
    pm.set([cx * R, 0, zc], (L.y1 - L.y0) * R * 1.3, rnd(), rnd() * 0.5);
    pm.slab(cx * R, zc, w, d, L.y0 * R, L.y1 * R, (rnd() - 0.5) * 0.06, 0.16, tone, moss, i === 3 ? 0.9 : 0.55, 11 + i * 17 + variant);
  }
  // a few small trees and shrubs on the cliff's lid
  {
    const topY = layers[3].y1 * R;
    const lift = (m: Mesher, from: number) => { for (let v = from / 3; v < m.p.length / 3; v++) { m.p[v * 3 + 1] += topY; m.aO[v * 3 + 1] += topY; m.aC[v * 3 + 1] += topY; } };
    const topAt: Array<[string, number, number, number]> = [['conifer', -0.14, -0.74, 0.3], ['conifer', 0.12, -0.72, 0.26], ['birch', 0.0, -0.78, 0.3], ['shrub', -0.06, -0.68, 0.05], ['shrub', 0.17, -0.66, 0.045]];
    for (const [sp, dx, z, h] of topAt) {
      const x = (cx + dx) * R, zz = z * R, r = mulberry(Math.floor(rnd() * 1e9)), from = tm.p.length;
      tm.set([x, 0, zz], h * R, r(), r());
      if (sp === 'conifer') conifer(tm, r, x, zz, h * R, lod, {...pal, hue: pal.hue + 0.04}, 0.7);
      else if (sp === 'birch') birch(tm, r, x, zz, h * R, lod, pal);
      else shrub(tm, r, x, zz, h * R, pal, lod, false);
      lift(tm, from);
    }
  }
  // boulders flanking the cliff and the pool
  const bouldAt: Array<[number, number, number]> = [[cx - 0.33, zb + 0.1, 0.07], [cx + 0.34, zb + 0.14, 0.06], [cx - 0.26, zb + 0.34, 0.045], [cx + 0.25, zb + 0.34, 0.05], [cx - 0.3, zb + 0.02, 0.05]];
  for (const [bx, bz, s] of bouldAt) {
    const x = bx * R, z = bz * R;
    if (!inHex(x, z, R, 0.94)) continue;
    pm.set([x, 0, z], s * R * 1.5, rnd(), rnd());
    rockCluster(pm, mulberry(Math.floor(rnd() * 1e9)), x, z, s * R, lod, stone, moss);
  }
  // hanging moss and little ferns on the ledges
  for (let i = 0; i < (full ? 7 : 3); i++) {
    const L = layers[Math.floor(rnd() * 4)], x = (cx + (rnd() - 0.5) * L.w * 0.8) * R, z = (L.front - 0.03 - rnd() * 0.05) * R;
    const r = mulberry(Math.floor(rnd() * 1e9)), from = pm.p.length;
    fern(pm, r, x, z, R * (0.05 + r() * 0.03), pal, lod);
    for (let v = from / 3; v < pm.p.length / 3; v++) { pm.p[v * 3 + 1] += L.y1 * R; pm.aO[v * 3 + 1] += L.y1 * R; pm.aC[v * 3 + 1] += L.y1 * R; }
  }

  // ---- trees: old-growth giants behind, smaller things in front
  const pl = new Placer(rnd, R, 0.84, [(x, z) => inCliff(x, z), (x, z) => Math.abs(x / R - cx) < 0.3 && z / R < 0.5, (x, z) => wd(x, z) < R * 0.1, (x, z) => Math.hypot(x - beacon[0] * R, z - beacon[1] * R) < R * 0.42]);
  const items: Array<{sp: string; x: number; z: number; H: number; seed: number}> = [];
  const add = (sp: string, n: number, h0: number, h1: number, rad: number, test?: (x: number, z: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      const H = R * (h0 + rnd() * (h1 - h0)), s = pl.try(R * rad * (H / R), 0.9, 90, test); if (!s) continue;
      items.push({sp, x: s.x, z: s.z, H, seed: Math.floor(rnd() * 1e9)});
    }
  };
  const back = (x: number, z: number) => z < R * 0.05 && Math.abs(x - cx * R) > R * 0.42;
  add('oldoak', 2, 1.0, 1.2, 0.1, back);
  add('oldfir', 5, 1.0, 1.35, 0.06, (x, z) => back(x, z));
  add('oak', 3, 0.36, 0.5, 0.1);
  add('birch', 3, 0.42, 0.58, 0.07);
  add('teal', 2, 0.34, 0.44, 0.14);
  add('fern', 3, 0.22, 0.3, 0.35);
  for (const it of items) {
    const r = mulberry(it.seed);
    tm.set([it.x, 0, it.z], it.H, r(), r());
    const q = treePal(r, pal, it.sp === 'oldfir');
    if (it.sp === 'oldoak') oldoak(tm, r, it.x, it.z, it.H, lod, q);
    else if (it.sp === 'oldfir') oldfir(tm, r, it.x, it.z, it.H, lod, {...q, hue: q.hue + 0.04, lit: q.lit * 0.85});
    else if (it.sp === 'oak') oak(tm, r, it.x, it.z, it.H, lod, q, 0.55 + r() * 0.15);
    else if (it.sp === 'birch') birch(tm, r, it.x, it.z, it.H, lod, q);
    else if (it.sp === 'teal') teal(tm, r, it.x, it.z, it.H, lod, q);
    else treeFern(tm, r, it.x, it.z, it.H, lod, q);
  }

  // ---- undergrowth
  const plp = new Placer(rnd, R, 0.9, [(x, z) => inCliff(x, z) && z < R * (zb + 0.2), (x, z) => wd(x, z) < R * 0.03, (x, z) => Math.hypot(x - beacon[0] * R, z - beacon[1] * R) < R * 0.2]);
  const free = (x: number, z: number, r: number) => pl.placed.every((t) => Math.hypot(t.x - x, t.z - z) > t.r * 0.45 + r);
  const spot = (r: number) => plp.try(r, 0, 40, (x, z) => free(x, z, r));
  const fcols: V3[] = [hex('#ffd24a'), hex('#ff8ab8'), hex('#ffffff'), hex('#b49aff')];
  for (let i = 0; i < 16; i++) { const s = spot(R * 0.045); if (!s) continue; const r = mulberry(Math.floor(rnd() * 1e9)); fern(pm, r, s.x, s.z, R * (0.09 + r() * 0.06), pal, lod); }
  for (let i = 0; i < 6; i++) { const s = spot(R * 0.06); if (!s) continue; const r = mulberry(Math.floor(rnd() * 1e9)); shrub(pm, r, s.x, s.z, R * (0.045 + r() * 0.03), pal, lod, r() < 0.4); }
  for (let i = 0; i < 4; i++) { const s = spot(R * 0.07); if (!s) continue; const r = mulberry(Math.floor(rnd() * 1e9)); rockCluster(pm, r, s.x, s.z, R * (0.035 + r() * 0.03), lod, stone, moss); }
  for (let i = 0; i < 2; i++) { const s = spot(R * 0.13); if (!s) continue; const r = mulberry(Math.floor(rnd() * 1e9)); log(pm, r, s.x, s.z, R * (0.24 + r() * 0.1), R * 0.026, r() * 6.28, lod); }
  for (let c = 0; c < 4; c++) {
    const cs = spot(R * 0.04); if (!cs) continue;
    for (let i = 0; i < 6; i++) {
      const a = rnd() * 6.28, d = R * 0.09 * Math.sqrt(rnd()), x = cs.x + Math.cos(a) * d, z = cs.z + Math.sin(a) * d;
      if (inHex(x, z, R, 0.86) && wd(x, z) > R * 0.02 && free(x, z, R * 0.02)) { const r = mulberry(Math.floor(rnd() * 1e9)); flower(pm, r, x, z, R * (0.055 + r() * 0.03), fcols[c % 4], lod); }
    }
  }
  for (let i = 0; i < 6; i++) {
    const s = spot(R * 0.04); if (!s) continue;
    const r = mulberry(Math.floor(rnd() * 1e9));
    for (let j = 0; j < 3; j++) mushroom(pm, r, s.x + (r() - 0.5) * R * 0.05, s.z + (r() - 0.5) * R * 0.05, R * (0.02 + r() * 0.016), lod);
  }
  for (let i = 0; i < 40; i++) { const s = spot(R * 0.02); if (!s) continue; const r = mulberry(Math.floor(rnd() * 1e9)); if (full) tuft(pm, r, s.x, s.z, R * (0.05 + r() * 0.04), pal, 6); }

  // ---- the stepped fall (profile in R units -> world, z forward from the top lip)
  const fz = (v: number) => v * R;
  const fall: Array<[number, number]> = [
    [-0.02, 0.625], [0.0, 0.625], [0.012, 0.59], [0.02, 0.48], [0.05, 0.476], [0.062, 0.45], [0.07, 0.34], [0.1, 0.336], [0.112, 0.31], [0.12, 0.18], [0.15, 0.176], [0.162, 0.15], [0.17, 0.03], [0.2, 0.012],
  ].map(([h, y]) => [fz(h + 0.012), fz(y)]);
  void tuft;
  const ground = addKAttr(hexGround(R * 0.995, full ? 8 : 6));
  const tg = tm.build(), pg = pm.build();
  return {water, ground, trees: tg, props: pg, fall, fallAt: [cx * R, zb * R], fallW: 0.2 * R, beacon: [beacon[0] * R, R * 0.075 + R * 0.44 + R * 0.065, beacon[1] * R], poolAt: [pool[0], pool[1]], tris: tm.tris + pm.tris};
}

export function mergeVeg(plan: PreservePlan, key: string): THREE.BufferGeometry {
  return cached(`pres-merge|${key}`, () => mergeGeometries([plan.trees, plan.props], false)!);
}
