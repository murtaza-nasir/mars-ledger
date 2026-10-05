// Board life's map knowledge, pure: which hexes touch which, which are free to stand on, paths across free hexes,
// and where a scene can happen. Nothing here touches three.js, so the rules are tested in node.
import type {SpaceModel} from '../../../../../shared/full';
import {TILE} from '../../../../../shared/full';

export type GridCell = {id: string; x: number; z: number; space: SpaceModel};
export type Grid = {cells: GridCell[]; byId: Map<string, number>; nbr: number[][]; /** centre to centre distance of neighbours */ pitch: number};

/** Neighbours by distance: two hexes touch when their centres are within 1.1 pitches (the pitch is the smallest gap). */
export function buildGrid(cells: GridCell[]): Grid {
  let pitch = Infinity;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) pitch = Math.min(pitch, Math.hypot(cells[i].x - cells[j].x, cells[i].z - cells[j].z));
  if (!Number.isFinite(pitch)) pitch = 1;
  const nbr = cells.map(() => [] as number[]);
  for (let i = 0; i < cells.length; i++) for (let j = 0; j < cells.length; j++) {
    if (i !== j && Math.hypot(cells[i].x - cells[j].x, cells[i].z - cells[j].z) <= pitch * 1.1) nbr[i].push(j);
  }
  return {cells, byId: new Map(cells.map((c, i) => [c.id, i])), nbr, pitch};
}

/** What keeps a hex from being stood on: a tile, or something about to happen there (a placement's reticle, a held tile, a hovering finger). */
export type Busy = ReadonlySet<string>;

/** Empty land nobody is about to use: the only hexes a character may stand on or cross. */
export function isFree(c: GridCell, busy: Busy): boolean {
  return c.space.spaceType === 'land' && c.space.tileType === undefined && !busy.has(c.id);
}

export function freeMask(g: Grid, busy: Busy): boolean[] { return g.cells.map((c) => isFree(c, busy)); }

/** Shortest path of hex indices from `from` to `to` over free hexes (both ends included), or null; `maxLen` counts hexes. */
export function path(g: Grid, from: number, to: number, free: readonly boolean[], maxLen = 12): number[] | null {
  if (from === to) return free[from] ? [from] : null;
  if (!free[from] || !free[to]) return null;
  const prev = new Map<number, number>([[from, -1]]);
  let frontier = [from];
  for (let depth = 1; depth < maxLen && frontier.length; depth++) {
    const next: number[] = [];
    for (const i of frontier) for (const j of g.nbr[i]) {
      if (!free[j] || prev.has(j)) continue;
      prev.set(j, i);
      if (j === to) {
        const out = [j];
        for (let k = prev.get(j)!; k !== -1; k = prev.get(k)!) out.push(k);
        return out.reverse();
      }
      next.push(j);
    }
    frontier = next;
  }
  return null;
}

/** Steps from `from` to every free hex within `maxSteps` over free hexes. */
export function reach(g: Grid, from: number, free: readonly boolean[], maxSteps: number): Map<number, number> {
  const dist = new Map<number, number>();
  if (!free[from]) return dist;
  dist.set(from, 0);
  let frontier = [from];
  for (let d = 1; d <= maxSteps && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) for (const j of g.nbr[i]) if (free[j] && !dist.has(j)) { dist.set(j, d); next.push(j); }
    frontier = next;
  }
  return dist;
}

export type SiteWant = {
  /** hexes this site needs next to it, by what stands there */
  nextTo?: 'ocean' | 'city' | 'volcano';
  /** stay this many hex steps (at least, at most) from `near` */
  near?: number; minSteps?: number; maxSteps?: number;
  /** hexes to keep away from (other scenes' hexes) and their neighbours */
  exclude?: ReadonlySet<number>;
  /** keep clear of the hexes that carry bonus icons (the board's own information) */
  bonusFree?: boolean;
  /** a last say: false drops the hex (a tall tile hides it from the camera) */
  visible?: (i: number) => boolean;
};

const isOceanTile = (s: SpaceModel) => s.tileType === TILE.OCEAN;
const isCityTile = (s: SpaceModel) => s.tileType === TILE.CITY || s.tileType === TILE.CAPITAL;

/** How much a tile in front of a hex (toward the camera, +z) hides what happens on it: forests and cities and special tiles stand tall, oceans lie flat. */
const hides = (s: SpaceModel) => (s.tileType === undefined ? 0 : s.tileType === TILE.OCEAN ? 0.3 : s.tileType === TILE.GREENERY ? 3 : 4);

/** A score for standing on hex i: bonus icons (the board's information) and tall tiles in front of it (toward the camera, +z) both count against it. */
export function siteScore(g: Grid, i: number, bonusFree = true): number {
  const c = g.cells[i];
  let s = 0;
  if (c.space.bonus.length) s -= bonusFree ? 6 : 1.5;
  if (c.space.highlight) s -= 0.5;
  for (const j of g.nbr[i]) {
    const n = g.cells[j];
    if (n.z > c.z + g.pitch * 0.3) s -= hides(n.space);
    else if (Math.abs(n.z - c.z) <= g.pitch * 0.3) s -= hides(n.space) * 0.15;
  }
  return s;
}

/** All free hexes that fit what a scene wants, best first (ties keep board order so the choice stays deterministic). */
export function candidateSites(g: Grid, free: readonly boolean[], want: SiteWant = {}, from?: number): number[] {
  const dist = from !== undefined ? reach(g, from, free, want.maxSteps ?? 99) : null;
  const out: Array<{i: number; s: number}> = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (!free[i]) continue;
    if (want.exclude?.has(i) || g.nbr[i].some((j) => want.exclude?.has(j))) continue;
    if (dist) {
      const d = dist.get(i);
      if (d === undefined || d < (want.minSteps ?? 0)) continue;
    }
    if (want.nextTo) {
      const ok = g.nbr[i].some((j) => {
        const sp = g.cells[j].space;
        return want.nextTo === 'ocean' ? isOceanTile(sp) : want.nextTo === 'city' ? isCityTile(sp) : sp.highlight === 'volcanic';
      });
      if (!ok) continue;
    }
    const score = siteScore(g, i, want.bonusFree ?? true);
    if (want.bonusFree && g.cells[i].space.bonus.length) continue;
    if (want.visible && !want.visible(i)) continue;
    out.push({i, s: score});
  }
  return out.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.i);
}

/** Pick one site among the best few, with the caller's random number in [0, 1). */
export function pickSite(g: Grid, free: readonly boolean[], rnd: number, want: SiteWant = {}, from?: number): number | null {
  const all = candidateSites(g, free, want, from);
  if (!all.length) return null;
  const top = all.filter((i) => siteScore(g, i, want.bonusFree ?? true) >= siteScore(g, all[0], want.bonusFree ?? true) - 1.01);
  return top[Math.min(top.length - 1, Math.floor(rnd * top.length))];
}

/** The free hex nearest a given hex (by hex steps through any hexes, then by distance), for a reaction to a placement. */
export function nearestFree(g: Grid, id: string, free: readonly boolean[], exclude?: ReadonlySet<number>): number | null {
  const start = g.byId.get(id);
  if (start === undefined) return null;
  const seen = new Set([start]);
  let frontier = [start];
  while (frontier.length) {
    const hits = frontier.filter((i) => free[i] && !exclude?.has(i)).sort((a, b) => siteScore(g, b) - siteScore(g, a) || a - b);
    if (hits.length) return hits[0];
    const next: number[] = [];
    for (const i of frontier) for (const j of g.nbr[i]) if (!seen.has(j)) { seen.add(j); next.push(j); }
    frontier = next;
  }
  return null;
}

/** Every free hex that borders hex `id` (a placement's neighbours), for a scene that happens beside a tile. */
export function freeAround(g: Grid, id: string, free: readonly boolean[]): number[] {
  const i = g.byId.get(id);
  return i === undefined ? [] : g.nbr[i].filter((j) => free[j]);
}

/** Straight-line points of a hex path for walking: `from`, the centre of every hex between the ends, then `to`. */
export function walkPoints(g: Grid, hexes: readonly number[], from: {x: number; z: number}, to: {x: number; z: number}): Array<{x: number; z: number}> {
  const mid = hexes.slice(1, -1).map((i) => ({x: g.cells[i].x, z: g.cells[i].z}));
  return [{...from}, ...mid, {...to}];
}

/**
 * Whether a tile between the camera and a figure on hex i hides it: the line from the camera to a point `h` above the hex's top
 * passes over some other tile's hex lower than that tile's top (`topOf`, a height estimate by tile kind).
 */
export function blockedFrom(g: Grid, i: number, cam: {x: number; y: number; z: number}, topOf: (s: SpaceModel) => number, h: number, heights: readonly number[]): boolean {
  const c = g.cells[i];
  const tx = c.x, tz = c.z, ty = (heights[i] ?? 0) + h;
  const dx = tx - cam.x, dz = tz - cam.z, len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return false;
  for (let j = 0; j < g.cells.length; j++) {
    if (j === i) continue;
    const o = g.cells[j];
    if (o.space.tileType === undefined) continue;
    const s = ((o.x - cam.x) * dx + (o.z - cam.z) * dz) / len2;
    if (s <= 0 || s >= 1) continue;
    const px = cam.x + dx * s, pz = cam.z + dz * s;
    if (Math.hypot(o.x - px, o.z - pz) > g.pitch * 0.42) continue;
    const lineY = cam.y + (ty - cam.y) * s;
    if (lineY < (heights[j] ?? 0) + topOf(o.space)) return true;
  }
  return false;
}
