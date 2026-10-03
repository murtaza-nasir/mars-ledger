// Board text sizing, shared by the board and its tiles.
import {createContext, useContext} from 'react';

/**
 * Board text in board units. The board is drawn in SVG units that the screen scales by k px per unit, so a fixed
 * font size would be tiny on a big TV. Labels are sized from the screen instead: `text` is the chosen TV text size
 * (1.65% of the screen height times the size factor), `min` is the legibility floor (1.6%), `icon` scales the
 * bonus glyphs with the text size (capped so three still fit in one hex).
 */
export type BoardType = {text: number; min: number; icon: number};
export const BoardTypeContext = createContext<BoardType>({text: 13, min: 13, icon: 1.05});
export const useBoardType = () => useContext(BoardTypeContext);

/** Font size (board units) for a label of `chars` characters that must fit `width` units: the chosen size,
 *  shrunk only as far as the legibility floor. `em` is the average glyph width of the font cut used. */
export function fitText(t: BoardType, chars: number, width: number, em = 0.42): number {
  return Math.max(t.min, Math.min(t.text, width / Math.max(1, chars * em)));
}
