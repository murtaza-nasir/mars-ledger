// The board layout lives in src/shared so the server can draw the same board on the end-of-game poster.
export * from '../../../shared/hexgeo';

import {HEX_W as W, ROW_H as RH} from '../../../shared/hexgeo';

/**
 * Where the TV draws an off-map space (Ganymede top left, Phobos top right), in board units. They sit in the empty
 * corners beside the top row, inside the width of the widest row, so the map needs no extra width for them.
 */
export function offMapAt(i: number): {cx: number; cy: number} {
  return {cx: (i === 0 ? -1 : 1) * W * 3.8, cy: -4 * RH};
}
