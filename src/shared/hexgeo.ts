// Board hex layout (all three maps share it). The engine gives each space (x, y): y is the row (0..8), x the column in a
// 9-wide grid whose rows start at |4 − y|. Pointy-top hexes; odd rows interleave by half a hex.
import type {SpaceModel} from './full';

export const HEX_R = 50; // circumradius in board units
export const HEX_W = Math.sqrt(3) * HEX_R; // flat-to-flat width
export const ROW_H = 1.5 * HEX_R;

export type Cell = {id: string; cx: number; cy: number; space: SpaceModel};

export function hexPoints(r = HEX_R, cx = 0, cy = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Board cells in board units, centred on (0, 0). Off-map spaces (x = −1) are returned separately. */
export function layout(spaces: SpaceModel[]): {cells: Cell[]; offMap: SpaceModel[]; width: number; height: number} {
  const cells: Cell[] = [];
  const offMap: SpaceModel[] = [];
  for (const s of spaces) {
    if (s.x < 0 || s.y < 0) { offMap.push(s); continue; }
    const indent = Math.abs(4 - s.y);
    const col = s.x - indent;
    const cx = (col - (8 - indent) / 2) * HEX_W;
    const cy = (s.y - 4) * ROW_H;
    cells.push({id: s.id, cx, cy, space: s});
  }
  return {cells, offMap, width: 9 * HEX_W, height: 8 * ROW_H + 2 * HEX_R};
}
