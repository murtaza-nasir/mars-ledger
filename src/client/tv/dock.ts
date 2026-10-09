// The TV's bottom-left dock: one narrow column with the sound toggle above the options gear, then the radio deck
// (full game), then the log lane, which runs on to the right edge. Sized in vw with a px floor, so a TV browser zoomed out (a large TV
// at 25 %: a 6144 CSS px page) still shows them at the same share of the screen.
// While the TR track's frame runs round the screen (full game), every edge offset here keeps clear of it (clearOfFrame).
import {clearOfFrame} from './full/trTrack';

export const DOCK_LEFT = clearOfFrame('0.7vw', '0.5vw');
/**
 * How far everything along the foot of the screen moves up while the frame shows: one amount for all of it (the
 * dock, the log lane, the caption, the columns' feet), so they keep their places relative to each other; enough for
 * the lowest of them (the dock, 1.2vh up) to clear the band by 0.8vh. Zero without the frame.
 */
export const FOOT_SHIFT = 'max(0px, calc(var(--trb, 0px) - 0.4vh))';
export const DOCK_BOTTOM = `calc(1.2vh + ${FOOT_SHIFT})`;
export const DOCK_GAP = '0.5vw';
/** The gear's and the sound toggle's diameter. */
export const DOCK_BUTTON = 'max(2.1vw, 30px)';
/** The sound toggle sits right above the gear. */
export const SOUND_LEFT = DOCK_LEFT;
export const SOUND_BOTTOM = `calc(${DOCK_BOTTOM} + ${DOCK_BUTTON} + ${DOCK_GAP})`;
/** Where the dock's button column ends. */
export const DOCK_END = `calc(${DOCK_LEFT} + ${DOCK_BUTTON})`;
/** Where the log lane starts when nothing else is in the dock. */
export const LANE_LEFT = `calc(${DOCK_END} + 1vw)`;

// ---- the full game's columns and lane, inside the TR track's frame when it shows -------------------------------------
/** The tops of the instrument column and the player column. */
export const COLUMN_TOP = clearOfFrame('4vh', '1.1vh');
/** The log lane's foot. */
export const LANE_BOTTOM = `calc(2.6vh + ${FOOT_SHIFT})`;
/** The feet of the two columns, above the lane. */
export const COLUMN_BOTTOM = `calc(9vh + ${FOOT_SHIFT})`;
/** The "tap for sound" chip's distance from the bottom-right corner (both ways). */
export const SOUND_CHIP_INSET = clearOfFrame('1.6vw');
/** A top-centre notice's distance from the top: the original, or clear of the frame. */
export const topClear = (orig: string) => clearOfFrame(orig, '0.8vh');
