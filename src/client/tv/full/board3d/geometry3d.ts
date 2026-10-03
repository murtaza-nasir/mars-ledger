// The 3D board's geometry: the same hex layout as the flat board (src/shared/hexgeo.ts), laid on the ground plane.
// Board units become world units by UNIT; the flat board's y (rows, downwards) becomes world +z, so the camera,
// sitting on the +z side, sees row 0 at the top of the screen exactly as the flat board draws it.
import {HEX_R, layout, offMapAt} from '../geometry';
import type {SpaceModel} from '../../../../shared/full';
import {tileKind} from '../../../../shared/full';
import {restScaleOf} from './camera3d';
import type {P3, View} from './camera3d';

export const UNIT = 0.01;
/** a hex prism's circumradius in world units (a hair under the board's, so neighbours show a seam) */
export const PRISM_R = (HEX_R - 2.5) * UNIT;

export type Cell3 = {id: string; x: number; z: number; space: SpaceModel; /** board units, for the flat helpers */ cx: number; cy: number};
export type OffMap3 = {id: string; x: number; z: number; space: SpaceModel; label: string};

export type Board3 = {
  cells: Cell3[];
  offMap: OffMap3[];
  /** radius of the planet plate the board sits on */
  discR: number;
  /** farthest prism edge from the centre */
  extent: number;
};

export function board3d(spaces: SpaceModel[]): Board3 {
  const geo = layout(spaces);
  const cells = geo.cells.map((c) => ({id: c.id, x: c.cx * UNIT, z: c.cy * UNIT, space: c.space, cx: c.cx, cy: c.cy}));
  // Same places as the flat board: Ganymede top-left, Phobos top-right, in the corners beside the top row.
  const offMap = geo.offMap.map((s, i) => {
    const at = offMapAt(i);
    return {id: s.id, space: s, label: s.id === '02' ? 'Phobos' : 'Ganymede', x: at.cx * UNIT, z: at.cy * UNIT};
  });
  const extent = Math.max(0, ...cells.map((c) => Math.hypot(c.x, c.z))) + HEX_R * UNIT;
  return {cells, offMap, discR: geo.width * 0.6 * UNIT, extent};
}

/** A deterministic small number in [0, 1) per space, for the terrain's subtle variation. */
export function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Prism heights in world units. Empty land stands a little proud of the plate; ocean-reserved spaces sit lower;
 *  a placed tile raises its space by its kind (models stand on top of this). */
export const HEIGHT = {land: 0.07, ocean: 0.035, variation: 0.022} as const;
export const TILE_HEIGHT: Record<'ocean' | 'greenery' | 'city' | 'special', number> = {ocean: 0.06, greenery: 0.11, city: 0.15, special: 0.12};

export function prismHeight(s: SpaceModel): number {
  const kind = tileKind(s.tileType);
  if (kind) return TILE_HEIGHT[kind];
  const base = s.spaceType === 'ocean' ? HEIGHT.ocean : HEIGHT.land;
  return base + (jitter(s.id) - 0.5) * HEIGHT.variation;
}

// ---- what the resting camera frames, and the screen-size maths for the textures ------------------------------
/** The tallest a tile model stands above its hex top, in hex radii (models/contract.ts: below ~2.5 × radius). */
export const MODEL_TALL = 2.5;
/** How high the off-map pads float. */
export const PAD_LIFT = 0.32;

/** The points the resting view must keep in the frame: every hex's corners at its foot and at the highest tile top,
 *  room above every space for the tallest model, and the off-map pads with their rings and models. */
export function restPoints(geo: Board3): P3[] {
  const top = Math.max(...Object.values(TILE_HEIGHT));
  const out: P3[] = [];
  const ring = (x: number, z: number, r: number, y: number) => {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      out.push([x + r * Math.cos(a), y, z + r * Math.sin(a)]);
    }
  };
  for (const c of geo.cells) {
    ring(c.x, c.z, PRISM_R * 1.04, 0);
    ring(c.x, c.z, PRISM_R, top);
    ring(c.x, c.z, PRISM_R * 0.6, top + MODEL_TALL * PRISM_R);
  }
  for (const o of geo.offMap) {
    ring(o.x, o.z, PRISM_R * 1.23, PAD_LIFT);
    ring(o.x, o.z, PRISM_R * 0.6, PAD_LIFT + top + MODEL_TALL * PRISM_R);
  }
  return out;
}

/** Screen px per board unit along the board's depth (foreshortened) at the resting camera, the smallest over
 *  all spaces; and the largest hex's on-screen height. Labels are sized from the first so the far rows read.
 *  `w` and `h` are the frame's size in px. */
export function restScale(geo: Board3, rest: View, w: number, h: number): {pxPerUnit: number; hexPx: number} {
  const s = restScaleOf(rest, geo.cells, HEX_R * UNIT, w, h);
  return {pxPerUnit: s.pxPerWorld * UNIT, hexPx: s.hexPx};
}

/** What a zoomed-in resting view (the TV options' experimental zoom) keeps on screen: every hex's middle and the edges
 *  of its top half a hex radius toward the near and far rows, at the highest tile top; Ganymede and Phobos with their
 *  models' lower half. The tallest models on the outer rows may reach past the screen's edge. */
export function keepPoints(geo: Board3): P3[] {
  const top = Math.max(...Object.values(TILE_HEIGHT));
  const out: P3[] = [];
  for (const c of geo.cells) for (const dz of [-0.5, 0, 0.5]) out.push([c.x, top, c.z + dz * PRISM_R]);
  for (const o of geo.offMap) out.push([o.x, PAD_LIFT, o.z], [o.x, PAD_LIFT + top + 0.5 * MODEL_TALL * PRISM_R, o.z]);
  return out;
}
