// The TV's bottom-left dock: one narrow column with the sound toggle above the options gear, then the radio deck
// (full game), then the log lane, which runs on to the right edge. Sized in vw with a px floor, so a TV browser zoomed out (a large TV
// at 25 %: a 6144 CSS px page) still shows them at the same share of the screen.
export const DOCK_LEFT = '0.7vw';
export const DOCK_BOTTOM = '1.2vh';
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
