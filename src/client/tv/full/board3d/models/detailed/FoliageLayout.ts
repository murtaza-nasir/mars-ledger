// Layout helpers shared by the three Detailed living tiles: hex tests, dart-throwing placement with keep-out zones,
// and a cache so every space with the same variant shares its geometry (a space picks one of a handful of layouts and one of six
// 60-degree turns, so neighbouring forests still differ).
import type * as THREE from 'three';
import {mulberry} from './FoliageRng';

export const inHex = (x: number, z: number, R: number, k: number) => {
  const ax = Math.abs(x), az = Math.abs(z), lim = R * 0.866 * k;
  return ax <= lim && ax * 0.5 + az * 0.866 <= lim;
};

export type Keep = (x: number, z: number) => boolean;
export type Spot = {x: number; z: number; r: number};
export class Placer {
  placed: Spot[] = [];
  constructor(public rnd: () => number, public R: number, public spread: number, public keeps: Keep[] = []) {}
  /** try to place a circle of radius r (in world units); gap scales the spacing against what is already there */
  try(r: number, gap = 1, tries = 60, test?: (x: number, z: number) => boolean): Spot | null {
    for (let k = 0; k < tries; k++) {
      const x = (this.rnd() * 2 - 1) * this.R, z = (this.rnd() * 2 - 1) * this.R;
      if (!inHex(x, z, this.R, this.spread)) continue;
      if (this.keeps.some((f) => f(x, z))) continue;
      if (test && !test(x, z)) continue;
      if (this.placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * gap)) continue;
      const s = {x, z, r}; this.placed.push(s); return s;
    }
    return null;
  }
}

export type Built = {
  [k: string]: THREE.BufferGeometry | number | string | object | undefined;
};
const caches = new Map<string, unknown>();
export function cached<T>(key: string, make: () => T): T {
  let v = caches.get(key) as T | undefined;
  if (!v) { v = make(); caches.set(key, v); }
  return v;
}
export const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export { mulberry };
