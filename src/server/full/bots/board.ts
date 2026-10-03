// Where a bot puts a tile. Spaces are scored by what the placement pays now (printed bonuses, ocean neighbours) and
// what it is worth at the end (greeneries beside your own cities, cities among greeneries), using the engine's own
// board coordinates (src/shared/hexgeo.ts lays them out; neighbours are the cells one hex apart).
import {BONUS, TILE} from '../../../shared/full';
import type {Color, SpaceModel} from '../../../shared/full';
import {HEX_W, layout} from '../../../shared/hexgeo';

export type TileGoal = 'greenery' | 'city' | 'ocean' | 'other';

/** Which tile a space prompt is placing, from its title ("Select space for greenery tile", ...). */
export function tileGoal(title: string): TileGoal {
  const t = title.toLowerCase();
  if (t.includes('greenery') || t.includes('plants into')) return 'greenery';
  if (t.includes('ocean')) return 'ocean';
  if (t.includes('city') || t.includes('capital')) return 'city';
  return 'other';
}

export type BonusWorth = Partial<Record<number, number>>;

const BONUS_VALUE: Record<number, number> = {
  [BONUS.TITANIUM]: 2.8, [BONUS.STEEL]: 1.8, [BONUS.PLANT]: 1.6, [BONUS.DRAW_CARD]: 3.2, [BONUS.HEAT]: 0.9, [BONUS.MEGACREDITS]: 1,
};

/** Each space's neighbours on the map (off-map spaces have none). */
export function neighbours(spaces: SpaceModel[]): Map<string, SpaceModel[]> {
  const {cells} = layout(spaces);
  const out = new Map<string, SpaceModel[]>();
  for (const a of cells) {
    out.set(a.id, cells.filter((b) => b !== a && Math.hypot(a.cx - b.cx, a.cy - b.cy) < HEX_W * 1.05).map((b) => b.space));
  }
  return out;
}

const isCity = (s: SpaceModel) => s.tileType === TILE.CITY || s.tileType === TILE.CAPITAL;
const isGreenery = (s: SpaceModel) => s.tileType === TILE.GREENERY;
const isOcean = (s: SpaceModel) => s.tileType === TILE.OCEAN;
const empty = (s: SpaceModel) => s.tileType === undefined;

/** A placement's worth in M€ for this player (higher is better). */
export function spaceScore(id: string, goal: TileGoal, me: Color, spaces: SpaceModel[], adj: Map<string, SpaceModel[]>, worth: BonusWorth = {}): number {
  const s = spaces.find((x) => x.id === id);
  if (!s) return -99;
  const around = adj.get(id) ?? [];
  let v = 0;
  for (const b of s.bonus ?? []) v += worth[b] ?? BONUS_VALUE[b] ?? 0.5;
  // Every ocean beside the new tile pays 2 M€.
  v += around.filter(isOcean).length * 2;
  if (goal === 'greenery') {
    v += around.filter((n) => isCity(n) && n.color === me).length * 4.5;
    v -= around.filter((n) => isCity(n) && n.color !== me && n.color !== undefined).length * 2; // a point for a rival's city
    v += around.filter((n) => n.color === me).length * 0.6;
  } else if (goal === 'city') {
    v += around.filter(isGreenery).length * 3.5;
    // room to grow: free land next to the city is where your greeneries go
    v += around.filter((n) => empty(n) && n.spaceType === 'land').length * 1.1;
    v += around.filter((n) => n.color === me && isGreenery(n)).length * 0.5;
  } else if (goal === 'ocean') {
    // keep land beside your own cities free for greeneries: an ocean there takes nothing from you
    v -= around.filter((n) => isCity(n) && n.color === me).length * 0.3;
  } else {
    v += around.filter((n) => n.color === me).length * 0.3;
  }
  return v;
}

/** The spaces offered, best first (ties keep the engine's order). `worth` overrides what a printed bonus is worth
 *  (the endgame: metal and cards are worth little in the last generation). */
export function rankSpaces(offered: readonly string[], goal: TileGoal, me: Color, spaces: SpaceModel[], worth: BonusWorth = {}): Array<{id: string; score: number}> {
  const adj = neighbours(spaces);
  return offered.map((id, i) => ({id, score: spaceScore(id, goal, me, spaces, adj, worth), i}))
    .sort((a, b) => b.score - a.score || a.i - b.i).map(({id, score}) => ({id, score}));
}
