// The TR track's pure logic: the frame of 100 square cells round the edge of the screen, which cell a terraform rating
// stands on, how markers on one cell share it, how a marker hops from cell to cell, and who leads. No DOM and no React
// here (trTrack.test.ts).

/** Spaces on the loop: the physical board's track runs 0 to 99, and a rating of 100 or more laps it (100 sits on 0). */
export const TRACK_LEN = 100;
/** Every cell carries its number; every this many it is bolder and the cell a shade warmer. */
export const MAJOR_EVERY = 5;

/** The space a rating stands on: 0..99. Ratings below 0 and fractions are clamped and rounded (a rating is a whole number). */
export function slotOf(tr: number): number {
  const t = Math.max(0, Math.round(Number.isFinite(tr) ? tr : 0));
  return t % TRACK_LEN;
}
/** How many times the rating has gone round: 0 below 100, 1 from 100 to 199, and so on. */
export function lapOf(tr: number): number {
  const t = Math.max(0, Math.round(Number.isFinite(tr) ? tr : 0));
  return Math.floor(t / TRACK_LEN);
}

// ---- the frame: 100 cells round the edge of the screen, clockwise from the top-left corner ---------------------------------

/** How much longer than deep the cells along the edges are, at most about (the corners are square). */
export const CELL_RATIO = 1.1;

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Cell = {
  /** the number on the cell, 0..99 */
  i: number;
  /** its box, px, in screen coordinates */
  x: number; y: number; w: number; h: number;
  /** the edge it runs along; a corner belongs to the edge it starts */
  side: Side;
  corner: boolean;
};
export type Frame = {
  /** the screen */
  W: number; H: number;
  /** the band's depth, px: everything else on the TV sits inside it */
  band: number;
  /** cells between the corners along the top (and the bottom), and down the right (and the left) */
  across: number; down: number;
  cells: Cell[];
};

/** The band's depth for a screen: deep enough that 100 cells of about CELL_RATIO by 1 close the loop (whole px). */
export function bandFor(W: number, H: number): number {
  if (!(W > 0) || !(H > 0)) return 0;
  // 4 corners of band x band, and 96 edge cells of about CELL_RATIO x band: 2(W - 2b) + 2(H - 2b) = 96 * CELL_RATIO * b
  return Math.max(8, Math.floor((W + H) / (48 * CELL_RATIO + 4)));
}

/**
 * The 100 cells for a W x H screen. The four corners are square (band x band); the 96 others share the edges, so many
 * along the top and bottom and the rest down the sides, as near the screen's own proportions as whole cells allow.
 * Cell 0 is the top-left corner; the numbers run clockwise. Edges are whole px, so neighbours meet exactly.
 */
export function frameLayout(W: number, H: number, band = bandFor(W, H)): Frame {
  const b = band;
  const iw = Math.max(1, W - 2 * b), ih = Math.max(1, H - 2 * b);
  const half = (TRACK_LEN - 4) / 2;   // 48 cells: one top run and one side run
  const across = Math.min(half - 1, Math.max(1, Math.round((half * iw) / (iw + ih))));
  const down = half - across;
  const xs = (k: number) => Math.round(b + (k * iw) / across);   // the k-th edge along the top, k = 0..across
  const ys = (k: number) => Math.round(b + (k * ih) / down);
  const cells: Cell[] = [];
  const add = (x: number, y: number, x2: number, y2: number, side: Side, corner: boolean) =>
    cells.push({i: cells.length, x, y, w: x2 - x, h: y2 - y, side, corner});
  add(0, 0, b, b, 'top', true);
  for (let k = 0; k < across; k++) add(xs(k), 0, xs(k + 1), b, 'top', false);
  add(W - b, 0, W, b, 'right', true);
  for (let k = 0; k < down; k++) add(W - b, ys(k), W, ys(k + 1), 'right', false);
  add(W - b, H - b, W, H, 'bottom', true);
  for (let k = across - 1; k >= 0; k--) add(xs(k), H - b, xs(k + 1), H, 'bottom', false);
  add(0, H - b, b, H, 'left', true);
  for (let k = down - 1; k >= 0; k--) add(0, ys(k), b, ys(k + 1), 'left', false);
  return {W, H, band: b, across, down, cells};
}

/** The centre of cell `slot` (a real number: 2.5 is half way from the centre of 2 to the centre of 3; 99.5 is half way to 0). */
export function cellCenter(f: Frame, slot: number): {x: number; y: number} {
  const n = f.cells.length;
  const s = ((slot % n) + n) % n;
  const a = f.cells[Math.floor(s) % n], b = f.cells[(Math.floor(s) + 1) % n], t = s - Math.floor(s);
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  return {x: ax + (bx - ax) * t, y: ay + (by - ay) * t};
}

/** The unit vector from a cell towards the middle of the screen (a corner points along its diagonal). */
export function inward(c: Pick<Cell, 'side' | 'corner' | 'i'>): {x: number; y: number} {
  if (c.corner) {
    const k = Math.SQRT1_2;
    if (c.i === 0) return {x: k, y: k};
    if (c.side === 'right') return {x: -k, y: k};
    if (c.side === 'bottom') return {x: -k, y: -k};
    return {x: k, y: -k};
  }
  return c.side === 'top' ? {x: 0, y: 1} : c.side === 'right' ? {x: -1, y: 0} : c.side === 'bottom' ? {x: 0, y: -1} : {x: 1, y: 0};
}

/** A CSS length that keeps an edge-anchored offset clear of the frame: the original offset, or the band plus `gap`, whichever is more. */
export function clearOfFrame(orig: string, gap = '0.6vw'): string {
  return `max(${orig}, calc(var(--trb, 0px) + ${gap}))`;
}

// ---- markers on one cell ----------------------------------------------------------------------------------------------

/** A marker's place in its cell: offset from the cell's centre and diameter, both as fractions of the band. */
export type StackPlace = {dx: number; dy: number; size: number};
/** A lone marker's diameter, as a fraction of the band. */
export const MARKER = 0.8;
const PILES: StackPlace[][] = [
  [{dx: 0, dy: 0, size: MARKER}],
  [{dx: -0.17, dy: -0.15, size: 0.62}, {dx: 0.17, dy: 0.15, size: 0.62}],
  [{dx: 0, dy: -0.19, size: 0.54}, {dx: -0.21, dy: 0.17, size: 0.54}, {dx: 0.21, dy: 0.17, size: 0.54}],
  [{dx: -0.2, dy: -0.2, size: 0.5}, {dx: 0.2, dy: -0.2, size: 0.5}, {dx: -0.2, dy: 0.2, size: 0.5}, {dx: 0.2, dy: 0.2, size: 0.5}],
  [{dx: -0.22, dy: -0.22, size: 0.46}, {dx: 0.22, dy: -0.22, size: 0.46}, {dx: -0.22, dy: 0.22, size: 0.46}, {dx: 0.22, dy: 0.22, size: 0.46}, {dx: 0, dy: 0, size: 0.46}],
];

/**
 * Where each marker sits, given the cells they stand on (a marker in mid-hop passes `null`: it sits alone at full size).
 * Markers on one cell share it: two side by side on a diagonal, three in a triangle, four in a square, five in a square
 * with one on top, smaller as there are more, in the order given. Six or more (not a real game) pile on the five.
 */
export function stackPlaces(slots: ReadonlyArray<number | null>): StackPlace[] {
  const groups = new Map<number, number[]>();
  slots.forEach((s, i) => { if (s === null) return; const g = groups.get(s) ?? []; g.push(i); groups.set(s, g); });
  return slots.map((s, i) => {
    if (s === null) return PILES[0][0];
    const g = groups.get(s)!;
    const pile = PILES[Math.min(PILES.length, g.length) - 1];
    return pile[Math.min(g.indexOf(i), pile.length - 1)];
  });
}

// ---- a hop from one rating to another ---------------------------------------------------------------------------------

export type HopPlan = {
  /** the rating the hop starts from */
  from: number;
  /** the ratings stood on one after another, ending at the new rating (empty when nothing moved) */
  steps: number[];
  /** ms each step takes */
  stepMs: number;
  /** a jump of this many steps or more kicks up dust where it lands */
  puff: boolean;
};
/** Steps over longer than this many ms in total get quicker per step. */
export const HOP_TOTAL_MS = 1100;
export const HOP_MIN_MS = 45;
export const HOP_MAX_MS = 150;
/** A jump this long or longer kicks up dust. */
export const PUFF_FROM = 3;

/** How a marker travels from `from` to `to`: one hop per rating, quicker when the jump is long, with a puff on a long one. */
export function hopPlan(from: number, to: number): HopPlan {
  const a = Math.max(0, Math.round(from)), b = Math.max(0, Math.round(to));
  const n = Math.abs(b - a);
  if (n === 0) return {from: a, steps: [], stepMs: HOP_MAX_MS, puff: false};
  const dir = b > a ? 1 : -1;
  // a very long jump (a retired game, a rewind) does not hop a hundred times: it hops the last twelve
  const first = n > 12 ? b - dir * 12 : a;
  const origin = first;
  const steps: number[] = [];
  for (let t = first + dir; dir > 0 ? t <= b : t >= b; t += dir) steps.push(t);
  const stepMs = Math.min(HOP_MAX_MS, Math.max(HOP_MIN_MS, HOP_TOTAL_MS / steps.length));
  return {from: origin, steps, stepMs, puff: n >= PUFF_FROM};
}

/** The rating of a marker `ms` into its plan, as a real number between two steps (for placing it mid-hop), the hop's lift 0..1, and whether it has landed. */
export function hopAt(plan: HopPlan, ms: number): {tr: number; lift: number; done: boolean} {
  const n = plan.steps.length;
  if (!n) return {tr: plan.from, lift: 0, done: true};
  const k = Math.max(0, ms) / plan.stepMs;
  const i = Math.floor(k);
  if (i >= n) return {tr: plan.steps[n - 1], lift: 0, done: true};
  const prev = i === 0 ? plan.from : plan.steps[i - 1];
  const f = k - i;
  // the run is even and the lift is a sine: up and down within each step
  return {tr: prev + (plan.steps[i] - prev) * f, lift: Math.sin(Math.PI * f), done: false};
}

// ---- who leads --------------------------------------------------------------------------------------------------------

/** The colour with the strictly highest rating (the leader wiggles), or null when the top is shared or nobody has more than 0. */
export function leaderOf(players: ReadonlyArray<{color: string; tr: number}>): string | null {
  let best: {color: string; tr: number} | null = null, tie = false;
  for (const p of players) {
    if (!best || p.tr > best.tr) { best = p; tie = false; } else if (p.tr === best.tr) tie = true;
  }
  return best && !tie && best.tr > 0 ? best.color : null;
}
