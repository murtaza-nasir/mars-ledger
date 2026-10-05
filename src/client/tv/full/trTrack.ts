// The TR track's pure logic: where a terraform rating sits on the loop around the board, how markers on near or equal
// ratings fan out, how a marker hops from one rating to another, and who leads. No DOM and no React here (trTrack.test.ts).

/** Spaces on the loop: the physical board's track runs 0 to 99, and a rating of 100 or more laps it (100 sits on 0). */
export const TRACK_LEN = 100;
/** A number every this many spaces; the spaces between carry ticks only. */
export const LABEL_EVERY = 5;

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

// ---- the loop: a rounded rectangle, clockwise from the top edge -----------------------------------------------------------

export type TrackShape = {
  /** centre line's box, px, relative to the overlay */
  x: number; y: number; w: number; h: number;
  /** corner radius of the centre line */
  r: number;
};
export type TrackPoint = {x: number; y: number; /** unit outward normal */ nx: number; ny: number};

/** Total length of the centre line. */
export function perimeter(s: TrackShape): number {
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  return 2 * (s.w - 2 * r) + 2 * (s.h - 2 * r) + 2 * Math.PI * r;
}

/**
 * The point `d` px along the centre line (any real number; it wraps). Zero is where the top edge's straight part begins,
 * just right of the top-left corner; the loop runs clockwise as seen on screen.
 */
export function pointAt(s: TrackShape, d: number): TrackPoint {
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const top = s.w - 2 * r, side = s.h - 2 * r, arc = (Math.PI * r) / 2;
  const P = 2 * top + 2 * side + 4 * arc;
  let t = ((d % P) + P) % P;
  const x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
  if (t < top) return {x: x0 + r + t, y: y0, nx: 0, ny: -1};
  t -= top;
  if (t < arc) { const a = t / r; return {x: x1 - r + Math.sin(a) * r, y: y0 + r - Math.cos(a) * r, nx: Math.sin(a), ny: -Math.cos(a)}; }
  t -= arc;
  if (t < side) return {x: x1, y: y0 + r + t, nx: 1, ny: 0};
  t -= side;
  if (t < arc) { const a = t / r; return {x: x1 - r + Math.cos(a) * r, y: y1 - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a)}; }
  t -= arc;
  if (t < top) return {x: x1 - r - t, y: y1, nx: 0, ny: 1};
  t -= top;
  if (t < arc) { const a = t / r; return {x: x0 + r - Math.sin(a) * r, y: y1 - r + Math.cos(a) * r, nx: -Math.sin(a), ny: Math.cos(a)}; }
  t -= arc;
  if (t < side) return {x: x0, y: y1 - r - t, nx: -1, ny: 0};
  t -= side;
  const a = t / r;
  return {x: x0 + r - Math.cos(a) * r, y: y0 + r - Math.sin(a) * r, nx: -Math.cos(a), ny: -Math.sin(a)};
}

/** The point at the middle of space `slot` (a real number: 2.5 is between spaces 2 and 3 as drawn); spaces are equal arcs of the loop. */
export function slotPoint(s: TrackShape, slot: number): TrackPoint {
  const P = perimeter(s);
  return pointAt(s, ((slot + 0.5) * P) / TRACK_LEN);
}

// ---- markers on one number or close numbers ---------------------------------------------------------------------------

/**
 * Where each marker is drawn, in track spaces (real numbers on the loop), given the spaces they stand on. A marker
 * keeps its own space unless another is closer than `gap` spaces; neighbours then spread symmetrically about their
 * common centre, `gap` apart, in the order of their spaces (equal spaces keep the order given). Pure, and circular:
 * a cluster across the 99 to 0 seam is spread like any other.
 */
export function spreadSlots(slots: readonly number[], gap: number): number[] {
  const n = slots.length;
  if (n < 2 || gap <= 0) return slots.slice();
  const order = slots.map((_, i) => i).sort((a, b) => slots[a] - slots[b] || a - b);
  // cut the circle at its widest gap so a cluster over the seam sits in one run
  let cut = 0, widest = -1;
  for (let k = 0; k < n; k++) {
    const a = slots[order[k]], b = slots[order[(k + 1) % n]];
    const d = k === n - 1 ? b + TRACK_LEN - a : b - a;
    if (d > widest) { widest = d; cut = (k + 1) % n; }
  }
  const seq = Array.from({length: n}, (_, k) => order[(cut + k) % n]);
  // unwrapped, rising along the run: the values after the seam get a lap added
  const base: number[] = [];
  seq.forEach((idx, k) => { let v = slots[idx]; if (k > 0) while (v < base[k - 1]) v += TRACK_LEN; base.push(v); });
  // clusters: runs closer than gap, merged until none overlap
  type C = {from: number; to: number; at: number};
  let cl: C[] = base.map((b, k) => ({from: k, to: k, at: b}));
  const place = (c: C) => { const m = c.to - c.from + 1; return Array.from({length: m}, (_, j) => c.at + (j - (m - 1) / 2) * gap); };
  for (let guard = 0; guard < n * n + 4; guard++) {
    let merged = false;
    for (let i = 0; i + 1 < cl.length; i++) {
      const a = place(cl[i]), b = place(cl[i + 1]);
      if (b[0] - a[a.length - 1] < gap - 1e-9) {
        const from = cl[i].from, to = cl[i + 1].to;
        // the centre that keeps the merged run as close as possible to where its members really stand
        let sum = 0; const m = to - from + 1;
        for (let k = from; k <= to; k++) sum += base[k] - (k - from - (m - 1) / 2) * gap;
        cl.splice(i, 2, {from, to, at: sum / m});
        merged = true; break;
      }
    }
    if (!merged) break;
  }
  const out = new Array<number>(n);
  for (const c of cl) place(c).forEach((v, j) => { out[seq[c.from + j]] = ((v % TRACK_LEN) + TRACK_LEN) % TRACK_LEN; });
  return out;
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
