// Tile sets and level of detail, as pure logic: which model a tile draws, and when a model of a detailed set
// draws its 'full' or its 'lite' variant. tiles3d.tsx holds the registries and the warm-up; Board3D's rig feeds the
// level of detail from the camera.

export type Detail = 'full' | 'lite';
/** 'classic' is models/*.tsx; every other set lives in models/<set>/. */
export type TileSet = 'classic' | 'detailed';
export const TILE_SETS: TileSet[] = ['classic', 'detailed'];
export const DEFAULT_SET: TileSet = 'classic';

/** The set a model file belongs to: its meta.set, else the folder it sits in (models/<set>/x.tsx), else Classic. */
export function setOf(path: string, metaSet?: string): string {
  if (metaSet) return metaSet;
  const m = /models\/([^/]+)\/[^/]+$/.exec(path);
  return m ? m[1] : 'classic';
}

/**
 * The model a tile draws: the chosen set's model for its type, then Classic's, then none (the built-in one). A
 * model that is not usable yet (still warming up) is skipped; while the one it should draw is still warming, a tile
 * keeps a warm model of another set (e.g. Detailed's while Classic warms after a switch back) rather than dropping
 * to the built-in one.
 */
export function resolveModel<M>(registries: ReadonlyMap<string, ReadonlyMap<number, M>>, set: string, tileType: number,
  usable: (m: M) => boolean = () => true): M | null {
  const order = set === 'classic' ? ['classic'] : [set, 'classic'];
  let waiting = false;
  for (const s of order) {
    const m = registries.get(s)?.get(tileType);
    if (!m) continue;
    if (usable(m)) return m;
    waiting = true;
  }
  if (waiting) for (const [s, reg] of registries) {
    if (order.includes(s)) continue;
    const m = reg.get(tileType);
    if (m && usable(m)) return m;
  }
  return null;
}

// ---- level of detail ----------------------------------------------------------------------------------------
/**
 * A tile's size on screen is its hex's diameter as a fraction of the screen's height (resolution-independent).
 * Measured on a late-game board (1080p and 4K alike): at the resting view every hex is 0.10–0.11; a held placement
 * dive has ~28 tiles on screen at 0.36–1.0, the focused one and its neighbours above 0.5; a big-moment pass peaks at
 * ~0.5 for its nearest tiles. A tile goes full above `up` (about a dozen tiles in a dive: the ones the camera is down
 * among) and back to lite below `down` (hysteresis in size), and holds a level for at least `dwellMs` (hysteresis in
 * time), so a tile near a threshold never flickers. At most `perFrame` tiles switch in one frame (a switch can mount
 * meshes), the largest first.
 */
export const LOD = {up: 0.5, down: 0.38, dwellMs: 600, perFrame: 3} as const;

export type LodInput = {
  /** hex diameter on screen / screen height */
  size: number;
  /** a placement in focus, the dive's hold, a test poke */
  focused: boolean;
  /** inside the view: only a tile on screen goes full (one beside the camera stays full while it is large, so a
   *  tile that slips out of frame does not flip back and forth; a small one off screen goes lite) */
  onScreen: boolean;
};

/** The level a tile wants now, from the level it has and when it last changed. */
export function wantDetail(prev: Detail, x: LodInput, sinceSwitchMs: number, o: {up: number; down: number; dwellMs: number} = LOD): Detail {
  // the focused tile goes full at once, whatever the dwell
  if (x.focused) return 'full';
  const want: Detail = prev === 'full' ? (x.size < o.down ? 'lite' : 'full') : (x.onScreen && x.size >= o.up ? 'full' : 'lite');
  if (want !== prev && sinceSwitchMs < o.dwellMs) return prev;
  return want;
}

export type LodTile = {id: string; detail: Detail; changedAt: number};

/**
 * One frame of the level-of-detail director: which tiles switch now. Focused tiles first, then the largest on
 * screen; at most `perFrame` per frame (focused tiles do not count against it).
 */
export function lodStep(tiles: Array<LodTile & LodInput>, now: number, o: {up: number; down: number; dwellMs: number; perFrame: number} = LOD):
  Array<{id: string; detail: Detail}> {
  // (a plain loop: this runs every frame, and only the tiles that change get an entry)
  const want: Array<{t: LodTile & LodInput; d: Detail}> = [];
  for (const t of tiles) { const d = wantDetail(t.detail, t, now - t.changedAt, o); if (d !== t.detail) want.push({t, d}); }
  want.sort((a, b) => Number(b.t.focused) - Number(a.t.focused) || b.t.size - a.t.size);
  const out: Array<{id: string; detail: Detail}> = [];
  let budget = o.perFrame;
  for (const {t, d} of want) {
    if (!t.focused) { if (budget <= 0) continue; budget--; }
    out.push({id: t.id, detail: d});
  }
  return out;
}

/** A hex's diameter on screen as a fraction of the screen height, for a camera at `dist` with vertical fov `fovDeg`. */
export function screenSize(radius: number, dist: number, fovDeg: number): number {
  return dist <= 0 ? Infinity : (2 * radius / dist) / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

// ---- ocean edges ----------------------------------------------------------------------------------------------
/** Each edge's outward direction in the ground plane (x, z), in ModelProps.oceanEdges order: clockwise seen from
 *  above (x right, +z towards the camera, as the TV shows the board), starting with the edge between the +z corner
 *  and the next corner clockwise. Corner k sits at (-sin(60°k), cos(60°k)) × R; edge i runs from corner i to i + 1.
 *  (three's CylinderGeometry walks its corners the other way round: its vertex j is corner (6 - j) % 6.) */
export const EDGE_DIRS: ReadonlyArray<readonly [number, number]> = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = ((120 + 60 * i) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)] as const;
});

/** Corner k of a hex of circumradius r, in the same order (corner 0 on +z, then clockwise seen from above: -x first).
 *  Edge i runs from corner i to corner i + 1. The Detailed Ocean's cornerAt/EN (models/detailed/OceanKit.ts) follow
 *  this; tests/tilesets.test.ts holds the two together. */
export function hexCorner(k: number, r = 1): [number, number] {
  return [-r * Math.sin((k * Math.PI) / 3), r * Math.cos((k * Math.PI) / 3)];
}

/** Which edge of a hex faces a neighbour at (dx, dz) from its centre. */
export function edgeToward(dx: number, dz: number): number {
  const deg = (Math.atan2(dz, dx) * 180) / Math.PI;
  return ((Math.round((deg - 120) / 60) % 6) + 6) % 6;
}

/**
 * Every ocean tile's six edges: true where another ocean tile borders it. Neighbours are the cells at the hex
 * spacing (the closest centre-to-centre distance on the board, ± 15 %); off-map spaces have none.
 */
export function oceanEdgeMap(cells: ReadonlyArray<{id: string; x: number; z: number; ocean: boolean}>): Map<string, boolean[]> {
  const out = new Map<string, boolean[]>();
  const oceans = cells.filter((c) => c.ocean);
  if (!oceans.length) return out;
  let step = Infinity;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const d = Math.hypot(cells[i].x - cells[j].x, cells[i].z - cells[j].z);
    if (d > 1e-9 && d < step) step = d;
  }
  for (const c of oceans) {
    const e = [false, false, false, false, false, false];
    for (const o of oceans) {
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (Math.abs(Math.hypot(dx, dz) - step) > step * 0.15) continue;
      e[edgeToward(dx, dz)] = true;
    }
    out.set(c.id, e);
  }
  return out;
}
