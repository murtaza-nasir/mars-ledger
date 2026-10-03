// The full-game TV's free region: the room between the instrument column on the left and the player column on the
// right, above the log lane. The board's box takes all of it (the resting board fills the box); the planet behind
// the board reaches under the columns, which sit on top. Measured from the page, so it follows the columns as they
// change; anything else that pokes into the region (the radio deck) is reported for the board to keep out of.
import {useEffect, useState} from 'react';
import type {ScreenRect} from './board3d/Board3D';

export type BoardRegion = {left: number; top: number; width: number; height: number; avoid: ScreenRect[]};

/** Gaps between the region and what bounds it, as fractions of the screen width (sides) and height (top, bottom). */
export const REGION_GAP = {side: 0.008, top: 0.016, bottom: 0.008} as const;
/** The log lane's height to keep clear: two ticker lines (its widest fit) at 1.0vw × the TV text size, line height 1.25. */
const LANE_LINES_VW = 2 * 1.25 * 1.0;

const rectOf = (el: Element | null | undefined) => (el ? el.getBoundingClientRect() : null);

/** The region now, or null before the columns are laid out. Pure reads of the page. */
export function measureRegion(column: HTMLElement | null): BoardRegion | null {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!vw || !vh) return null;
  const left = rectOf(document.querySelector('[data-globals]')?.parentElement);
  const right = rectOf(column);
  const laneEl = document.querySelector('[data-log-lane]');
  const lane = rectOf(laneEl);
  if (!left || !right || !left.width || !right.width) return null;
  let bottom = vh;
  if (lane && laneEl) {
    const tvt = parseFloat(getComputedStyle(laneEl).getPropertyValue('--tvt')) || 1;
    bottom = Math.min(lane.top, lane.bottom - (LANE_LINES_VW * tvt * vw) / 100);
  }
  const r = {left: left.right + REGION_GAP.side * vw, right: right.left - REGION_GAP.side * vw, top: REGION_GAP.top * vh, bottom: bottom - REGION_GAP.bottom * vh};
  if (r.right - r.left < vw * 0.2 || r.bottom - r.top < vh * 0.3) return null;
  // the radio deck (bottom-left corner) can reach into the region; rounded out to 1% of the screen so a new track
  // name does not move the board
  const avoid: ScreenRect[] = [];
  for (const el of document.querySelectorAll('[data-radio]')) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || Number(getComputedStyle(el).opacity) < 0.05) continue;
    if (b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom) continue;
    const q = (x: number, s: number, up: boolean) => (up ? Math.ceil(x / s) : Math.floor(x / s)) * s;
    avoid.push({left: q(b.left, vw / 100, false), top: q(b.top, vh / 100, false), right: q(b.right, vw / 100, true), bottom: q(b.bottom, vh / 100, true)});
  }
  return {left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.right - r.left), height: Math.round(r.bottom - r.top), avoid};
}

const same = (a: BoardRegion | null, b: BoardRegion | null) => !!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height && JSON.stringify(a.avoid) === JSON.stringify(b.avoid);

/** The region, kept up to date: on resize, and once a second (the columns and the radio deck change without one). */
export function useBoardRegion(column: React.RefObject<HTMLElement | null>, deps: unknown[]): BoardRegion | null {
  const [region, setRegion] = useState<BoardRegion | null>(null);
  useEffect(() => {
    const read = () => { const r = measureRegion(column.current); if (r) setRegion((p) => (same(p, r) ? p : r)); };
    read();
    const raf = requestAnimationFrame(read);
    window.addEventListener('resize', read);
    const t = setInterval(read, 1000);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', read); clearInterval(t); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  (window as unknown as {__boardRegion?: unknown}).__boardRegion = region;
  return region;
}
