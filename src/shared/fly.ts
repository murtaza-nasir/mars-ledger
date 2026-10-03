// Flying the TV camera from a phone (experimental): the phone's sticks travel to the TV as one compact packet of six
// small integers, about 25 times a second, over the table's websocket. Only the latest phone to start flies.

/** What the pilot asks for now: move (strafe right x, forward y), look (turn right x, look up y), climb, and a boost.
 *  Each from -1 to 1 (boost from 0 to 1). */
export type FlyInput = {mx: number; my: number; lx: number; ly: number; lift: number; boost: number};
export const NO_INPUT: FlyInput = {mx: 0, my: 0, lx: 0, ly: 0, lift: 0, boost: 0};

/** How often a phone sends its sticks while someone is flying. */
export const FLY_HZ = 25;
/** The server drops packets past this rate from one socket. */
export const FLY_MAX_HZ = 45;
/** The TV treats a phone that has gone quiet this long as hands off (the camera glides to a stop). */
export const FLY_STALE_MS = 600;

/** What the TV can do: off (the experimental switch is off, or no 3D board), ready, or flying now. */
export type FlyTvState = 'off' | 'ready' | 'flying';
/** What every phone hears: the best TV state at the table and whose phone flies (null: none, or the TV's own keys). */
export type FlyStatus = {tv: FlyTvState; pilot: string | null};

const q = (v: number, lo: number) => Math.round(Math.max(lo, Math.min(1, Number.isFinite(v) ? v : 0)) * 100);

/** The packet for an input: six integers, -100 to 100 (boost 0 to 100). */
export function packFly(i: FlyInput): number[] {
  return [q(i.mx, -1), q(i.my, -1), q(i.lx, -1), q(i.ly, -1), q(i.lift, -1), q(i.boost, 0)];
}

/** The input a packet carries, or null when it is not one. Out-of-range values are clamped. */
export function unpackFly(a: unknown): FlyInput | null {
  if (!Array.isArray(a) || a.length !== 6 || !a.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const c = (x: number, lo: number) => Math.max(lo, Math.min(1, Math.round(x) / 100));
  return {mx: c(a[0], -1), my: c(a[1], -1), lx: c(a[2], -1), ly: c(a[3], -1), lift: c(a[4], -1), boost: c(a[5], 0)};
}

/** True when nothing is pressed. */
export function isIdle(i: FlyInput, eps = 0.02): boolean {
  return Math.abs(i.mx) < eps && Math.abs(i.my) < eps && Math.abs(i.lx) < eps && Math.abs(i.ly) < eps && Math.abs(i.lift) < eps;
}
