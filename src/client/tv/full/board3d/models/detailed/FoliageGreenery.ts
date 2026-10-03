// The Greenery forest plan: one of several layouts (per variant, shared by every space using it), built as static
// merged geometry for 'full' and 'lite'. Both use the same placements, species, heights and colours; lite just merges
// branch structure into crowns and drops the smallest props.
import * as THREE from 'three';
import {hexGround} from '../FoliageKit';
import {Placer, cached, inHex, mulberry} from './FoliageLayout';
import {Mesher, hex, hsl, type V3} from './FoliageMesh';
import {treePal, birch, conifer, fern, flower, lantern, log, mushroom, oak, palette, rockCluster, shrub, teal, treeFern, tuft, type Lod, type Species} from './FoliageTrees';
import {addKAttr, waterDist, type Water} from './FoliageMat';

export type GreenPlan = {water: Water; ground: THREE.BufferGeometry; trees: THREE.BufferGeometry; props: THREE.BufferGeometry; lantern: [number, number]; flowerAt: Array<[number, number]>; triTrees: number; triProps: number};

export function planGreenery(variant: number, lod: Lod, R: number): GreenPlan {
  return cached(`green|${variant}|${lod}|${R}`, () => build(variant, lod, R));
}

function build(variant: number, lod: Lod, R: number): GreenPlan {
  const rnd = mulberry(0x6e5 + variant * 7919);
  // water: a pond and a stream wandering to the hex edge
  const a0 = 0.7 + rnd() * 1.7, ae = a0 + (a0 < 1.55 ? 1 : -1) * (0.7 + rnd() * 0.6);
  const pr = 0.3 + rnd() * 0.12;
  const pond: [number, number, number, number] = [Math.cos(a0) * pr, Math.sin(a0) * pr, 0.2 + rnd() * 0.04, 0.13 + rnd() * 0.03];
  const path: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const f = i / 5, r = pr + (0.98 - pr) * f, a = a0 + (ae - a0) * f + Math.sin(f * 3.1 + variant) * 0.16 * f;
    path.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const water: Water = {pond, path, width: 0.034};
  const wd = (x: number, z: number) => waterDist(water, x / R, z / R) * R;
  // lantern: opposite side of the pond, near the rim
  const la = a0 + 3.14 + (rnd() - 0.5) * 0.7, lx = Math.cos(la) * 0.72 * R, lz = Math.sin(la) * 0.72 * R;
  const keepLantern = (x: number, z: number) => Math.hypot(x - lx, z - lz) < R * 0.14;
  const pl = new Placer(rnd, R, 0.8, [(x, z) => wd(x, z) < R * 0.13 || Math.hypot((x - pond[0] * R) / (pond[2] * R + R * 0.15), (z - pond[1] * R) / (pond[3] * R + R * 0.17)) < 1, keepLantern]);

  const pal = palette((rnd() - 0.5) * 0.03);
  type Item = {sp: Species; x: number; z: number; H: number; seed: number};
  const items: Item[] = [];
  const addTree = (sp: Species, n: number, hMin: number, hMax: number, rad: number) => {
    for (let i = 0; i < n; i++) {
      const H = R * (hMin + rnd() * (hMax - hMin));
      const s = pl.try(R * rad * (H / R), 0.9, 80); if (!s) continue;
      items.push({sp, x: s.x, z: s.z, H, seed: Math.floor(rnd() * 1e9)});
    }
  };
  addTree('oak', 5, 0.8, 1.1, 0.14);
  addTree('conifer', 6, 0.85, 1.35, 0.11);
  addTree('birch', 4, 0.7, 1.0, 0.08);
  addTree('teal', 3, 0.55, 0.8, 0.15);
  addTree('fern', 3, 0.22, 0.32, 0.4);
  // small things take what room is left (water and the lantern stay clear)
  const plp = new Placer(rnd, R, 0.9, [(x, z) => wd(x, z) < R * 0.03, keepLantern]);
  const small: Array<{k: string; x: number; z: number; s: number; seed: number}> = [];
  const trunks = pl.placed;
  const free = (x: number, z: number, r: number) => trunks.every((t) => Math.hypot(t.x - x, t.z - z) > t.r * 0.45 + r);
  const spot = (r: number, test?: (x: number, z: number) => boolean) => plp.try(r, 0, 40, (x, z) => free(x, z, r) && (!test || test(x, z)));
  const bankSpot = () => {
    for (let k = 0; k < 40; k++) {
      const t = rnd(), i = Math.min(4, Math.floor(t * 5));
      const [ax, az] = path[i], [bx, bz] = path[i + 1], f = rnd();
      const px = (ax + (bx - ax) * f) * R, pz = (az + (bz - az) * f) * R, ang = rnd() * 6.28;
      const d = R * (0.05 + rnd() * 0.04);
      const x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
      if (inHex(x, z, R, 0.86) && wd(x, z) > R * 0.012 && free(x, z, R * 0.03)) return {x, z};
    }
    return null;
  };
  const nRock = 5, nLog = 2, nFern = 15, nShrub = 6, nFlower = 34, nTuft = 44, nMush = 5;
  for (let i = 0; i < nRock; i++) { const s = i < 3 ? bankSpot() : spot(R * 0.06); if (s) small.push({k: 'rock', x: s.x, z: s.z, s: R * (0.04 + rnd() * 0.04), seed: Math.floor(rnd() * 1e9)}); }
  for (let i = 0; i < nLog; i++) { const s = spot(R * 0.12); if (s) small.push({k: 'log', x: s.x, z: s.z, s: R * (0.2 + rnd() * 0.1), seed: Math.floor(rnd() * 1e9)}); }
  for (let i = 0; i < nFern; i++) { const s = spot(R * 0.045); if (s) small.push({k: 'fern', x: s.x, z: s.z, s: R * (0.1 + rnd() * 0.06), seed: Math.floor(rnd() * 1e9)}); }
  for (let i = 0; i < nShrub; i++) { const s = spot(R * 0.06); if (s) small.push({k: 'shrub', x: s.x, z: s.z, s: R * (0.05 + rnd() * 0.04), seed: Math.floor(rnd() * 1e9)}); }
  const flowerAt: Array<[number, number]> = [];
  for (let c = 0; c < 4; c++) {
    const cs = spot(R * 0.04); if (!cs) continue;
    flowerAt.push([cs.x, cs.z]);
    for (let i = 0; i < Math.ceil(nFlower / 4); i++) {
      const a = rnd() * 6.28, d = R * 0.1 * Math.sqrt(rnd()), x = cs.x + Math.cos(a) * d, z = cs.z + Math.sin(a) * d;
      if (inHex(x, z, R, 0.86) && wd(x, z) > R * 0.02 && free(x, z, R * 0.02)) small.push({k: 'flower' + c, x, z, s: R * (0.06 + rnd() * 0.04), seed: Math.floor(rnd() * 1e9)});
    }
  }
  for (let i = 0; i < nTuft; i++) { const s = spot(R * 0.02); if (s) small.push({k: 'tuft', x: s.x, z: s.z, s: R * (0.05 + rnd() * 0.04), seed: Math.floor(rnd() * 1e9)}); }
  for (let i = 0; i < nMush; i++) {
    const s = spot(R * 0.04); if (!s) continue;
    for (let j = 0; j < 3; j++) small.push({k: 'mush', x: s.x + (rnd() - 0.5) * R * 0.05, z: s.z + (rnd() - 0.5) * R * 0.05, s: R * (0.02 + rnd() * 0.02), seed: Math.floor(rnd() * 1e9)});
  }

  const tm = new Mesher();
  for (const it of items) {
    const r = mulberry(it.seed);
    tm.set([it.x, 0, it.z], it.H, r(), r());
    const p = treePal(r, pal, it.sp === 'conifer');
    if (it.sp === 'oak') oak(tm, r, it.x, it.z, it.H, lod, p, 0.55 + r() * 0.2);
    else if (it.sp === 'conifer') conifer(tm, r, it.x, it.z, it.H, lod, {...p, hue: p.hue + 0.05, lit: p.lit * 0.85}, 0.62 + r() * 0.16);
    else if (it.sp === 'birch') birch(tm, r, it.x, it.z, it.H, lod, {...p, hue: p.hue - 0.01, lit: p.lit * 1.25});
    else if (it.sp === 'teal') teal(tm, r, it.x, it.z, it.H, lod, p);
    else treeFern(tm, r, it.x, it.z, it.H, lod, {...p, lit: p.lit * 1.1});
  }
  const pm = new Mesher();
  const fcols: V3[] = [hex('#ffe45e'), hex('#ff93c4'), hex('#ffffff'), hex('#9ab8ff')];
  for (const s of small) {
    if (lod === 'lite' && (s.k.startsWith('flower') || s.k === 'tuft' || s.k === 'mush')) continue;
    const r = mulberry(s.seed);
    const p = {...pal, lit: pal.lit * 1.15};
    if (s.k === 'rock') rockCluster(pm, r, s.x, s.z, s.s, lod);
    else if (s.k === 'log') log(pm, r, s.x, s.z, s.s, s.s * 0.11, r() * 6.28, lod);
    else if (s.k === 'fern') fern(pm, r, s.x, s.z, s.s, p, lod);
    else if (s.k === 'shrub') shrub(pm, r, s.x, s.z, s.s, p, lod, r() < 0.5);
    else if (s.k.startsWith('flower')) flower(pm, r, s.x, s.z, s.s, fcols[Number(s.k.slice(6)) % 4], lod);
    else if (s.k === 'tuft') tuft(pm, r, s.x, s.z, s.s, p, 6);
    else if (s.k === 'mush') mushroom(pm, r, s.x, s.z, s.s, lod);
  }
  lantern(pm, lx, lz, R * 0.28);
  void hsl;
  const ground = addKAttr(hexGround(R * 0.995, lod === 'full' ? 8 : 6));
  const tg = tm.build(), pg = pm.build();
  return {water, ground, trees: tg, props: pg, lantern: [lx, lz], flowerAt, triTrees: tm.tris, triProps: pm.tris};
}
