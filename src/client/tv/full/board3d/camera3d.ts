// The 3D board's camera, as pure maths. A view looks at a point on the board plane from a distance, tilted back
// from straight down by `polar` and swung around the vertical by `azimuth`. At rest the map fills the frame (the free
// region between the TV's columns) in a 3/4 tilt; a placement (or a big moment) dollies in and tilts toward the spot,
// then returns.

export type View = {tx: number; tz: number; dist: number; polar: number; azimuth: number};

export const FOV = 22; // degrees, vertical, across the frame (the free region the board fills): a long lens keeps the far rows within a fifth of the near ones
export const REST_POLAR = 0.64; // ~37° from straight down: the prisms show their sides
/** The resting tilt is chosen per frame shape within this range: steeper fills a tall frame, shallower a wide one. */
export const REST_TILT = {min: 0.56, max: 0.76, step: 0.01} as const;
// A live placement dives in: the tile centred, about two-fifths of the screen tall, seen at a low angle with its
// neighbours around it. Several placements at once pull back until all of them fit.
export const FOCUS = {pull: 1, zoom: 6.5, polar: 1.0, swing: 0.16, clamp: 0.95} as const;
/** A board-life visit: a gentle pass toward a vignette, milder than a placement's dive. */
export const VISIT_FOCUS = {pull: 0.6, zoom: 2.1, polar: 0.82, swing: 0.1, clamp: 0.85} as const;
export const STORY_FOCUS = {pull: 0.4, zoom: 1.3, polar: 0.72, swing: 0.08, clamp: 0.5} as const;

/** A world point [x, y, z]. */
export type P3 = readonly [number, number, number];
/** A rectangle in frame coordinates: x and y run from -1 to 1 across the frame (y up). */
export type FrameRect = {x0: number; x1: number; y0: number; y1: number};

/** Where a world point falls in the frame seen through view v (frame aspect = width / height): x and y from -1 to 1
 *  across the frame (y up), and its depth in front of the camera. */
export function frameXY(v: View, aspect: number, p: P3): {x: number; y: number; depth: number} {
  const [cx, cy, cz] = cameraPosition(v);
  // forward, right and up of a camera looking at (tx, 0, tz)
  let fx = v.tx - cx, fy = -cy, fz = v.tz - cz;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; // forward x (0, 1, 0)
  const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
  const depth = dx * fx + dy * fy + dz * fz;
  const t = Math.tan((FOV * Math.PI) / 360);
  return {x: (dx * rx + dz * rz) / (depth * t * aspect), y: (dx * ux + dy * uy + dz * uz) / (depth * t), depth};
}

function bounds(v: View, aspect: number, pts: readonly P3[]): FrameRect {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const q = frameXY(v, aspect, p);
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
  }
  return {x0, x1, y0, y1};
}

/** Centres the points in the frame and moves the camera until they just fill it (to `fill` of each half), at the
 *  given tilt. The long lens keeps this nearly linear, so a few rounds converge. */
function fitAt(pts: readonly P3[], aspect: number, polar: number, fill = 1): View {
  const t = Math.tan((FOV * Math.PI) / 360);
  const v: View = {tx: 0, tz: 0, dist: 30, polar, azimuth: 0};
  for (let i = 0; i < 60; i++) {
    const b = bounds(v, aspect, pts);
    const s = Math.max((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2) / fill;
    const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
    v.tx += mx * v.dist * t * aspect;
    v.tz -= (my * v.dist * t) / Math.cos(polar);
    v.dist *= s;
    if (Math.abs(s - 1) < 1e-6 && Math.abs(mx) < 1e-6 && Math.abs(my) < 1e-6) break;
  }
  return v;
}

function hits(v: View, aspect: number, pts: readonly P3[], avoid: readonly FrameRect[]): boolean {
  if (!avoid.length) return false;
  for (const p of pts) {
    const q = frameXY(v, aspect, p);
    for (const a of avoid) if (q.x > a.x0 && q.x < a.x1 && q.y > a.y0 && q.y < a.y1) return true;
  }
  return false;
}

/**
 * The resting view: the board's content (every hex, the off-map spaces, room for the tallest models) fills the frame,
 * the free region between the TV's columns. The tilt is picked within REST_TILT for the largest tiles on the
 * farthest row (the smallest on screen). `avoid` lists parts of the frame something else covers
 * (in frame coordinates); the board then shrinks and slides, as little as needed, to keep out of them.
 */
export function restView(pts: readonly P3[], aspect: number, avoid: readonly FrameRect[] = [], polar?: number): View {
  if (!pts.length) return {tx: 0, tz: 0, dist: 20, polar: polar ?? REST_POLAR, azimuth: 0};
  // the tiles on the farthest row are the smallest (the tilt foreshortens them, the lens shrinks them with distance):
  // the tilt that draws them largest wins
  let zFar = Infinity;
  for (const p of pts) if (p[1] === 0 && p[2] < zFar) zFar = p[2];
  const farArea = (v: View) => {
    const a = frameXY(v, aspect, [-0.25, 0, zFar + 0.25]), b = frameXY(v, aspect, [0.25, 0, zFar + 0.25]), c = frameXY(v, aspect, [0, 0, zFar + 0.5]);
    return Math.abs(b.x - a.x) * aspect * Math.abs(c.y - a.y);
  };
  let best: View | null = polar === undefined ? null : fitAt(pts, aspect, polar), score = -Infinity;
  // (a tilt the TV options pin replaces the search)
  for (let p = REST_TILT.min; polar === undefined && p <= REST_TILT.max + 1e-9; p += REST_TILT.step) {
    const v = fitAt(pts, aspect, p);
    const sc = farArea(v);
    if (sc > score + 1e-12) { score = sc; best = v; }
  }
  const v = best!;
  if (!hits(v, aspect, pts, avoid)) return v;
  // pull back a step at a time; at each, try the placements the slack allows, nearest the centre first
  const t = Math.tan((FOV * Math.PI) / 360);
  const shifts: Array<[number, number]> = [];
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) shifts.push([i / 4, j / 4]);
  shifts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  for (let m = 1.02; m < 2.5; m += 0.02) {
    const base = fitAt(pts, aspect, v.polar, 1 / m);
    const slack = 1 - 1 / m;
    for (const [sx, sy] of shifts) {
      const c = {...base, tx: base.tx - sx * slack * base.dist * t * aspect, tz: base.tz + (sy * slack * base.dist * t) / Math.cos(v.polar)};
      if (!hits(c, aspect, pts, avoid)) return c;
    }
  }
  return v;
}

// ---- the TV options' zoom and tilt for the resting board (experimental) -------------------------------------------
/** The zoom slider: the board's size against the automatic framing (1 = automatic). */
export const REST_ZOOM = {min: 0.8, max: 1.4, step: 0.05} as const;
/** The tilt slider, in degrees from straight down (the automatic tilt is chosen in REST_TILT, 32° on every TV measured). */
export const REST_TILT_DEG = {min: 20, max: 60, step: 2} as const;

const clampTo = (v: number, lo: number, hi: number, step: number) => Math.round(Math.max(lo, Math.min(hi, v)) / step) * step;
/** A zoom from the options, on the slider's range and steps (anything not a number is automatic: 1). */
export function clampZoom(z: unknown): number {
  return typeof z === 'number' && Number.isFinite(z) ? Math.round(clampTo(z, REST_ZOOM.min, REST_ZOOM.max, REST_ZOOM.step) * 100) / 100 : 1;
}
/** A tilt from the options, in degrees, on the slider's range and steps; null stays automatic. */
export function clampTilt(t: unknown): number | null {
  return typeof t === 'number' && Number.isFinite(t) ? clampTo(t, REST_TILT_DEG.min, REST_TILT_DEG.max, REST_TILT_DEG.step) : null;
}

/**
 * The resting view with the options' zoom and tilt: the automatic framing at the chosen tilt (the board refitted to
 * the frame), then moved closer or further by the zoom around the same centre. Zooming in stops where a point of
 * `keep` (by default the content itself) would leave `room`, the part of the frame the screen shows (frame
 * coordinates); `zoom` is what was applied and `maxZoom` how far in this tilt allows.
 */
export function adjustedRest(pts: readonly P3[], aspect: number, avoid: readonly FrameRect[], adj: {zoom: number | null; tilt: number | null}, room: FrameRect,
  keep: readonly P3[] = pts): {view: View; zoom: number; maxZoom: number} {
  const tilt = clampTilt(adj.tilt);
  const base = restView(pts, aspect, avoid, tilt === null ? undefined : (tilt * Math.PI) / 180);
  const want = clampZoom(adj.zoom ?? 1);
  const inside = (z: number) => {
    const b = bounds({...base, dist: base.dist / z}, aspect, keep);
    return b.x0 >= room.x0 && b.x1 <= room.x1 && b.y0 >= room.y0 && b.y1 <= room.y1;
  };
  // the most zoom that keeps the content on screen (at 1 it fills the frame, which the screen holds)
  let maxZoom: number = REST_ZOOM.max;
  if (!inside(maxZoom)) {
    let lo = 1, hi: number = REST_ZOOM.max;
    if (!inside(1)) hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
    maxZoom = lo;
  }
  const zoom = Math.min(want, Math.max(1, maxZoom));
  return {view: {...base, dist: base.dist / zoom}, zoom, maxZoom};
}

/** The lens for a frame (x, y, w, h) inside a W×H canvas: FOV spans the frame's height and the view's centre sits at
 *  the frame's centre, while the canvas around it shows more of the world. As three's camera takes it: the canvas's
 *  own vertical fov and aspect, and an off-centre window (setViewOffset) on an image the canvas's size. */
export function lensOf(W: number, H: number, f: {x: number; y: number; w: number; h: number}): {fov: number; aspect: number; view: [number, number, number, number, number, number]} {
  return {fov: (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * H / f.h) * 180) / Math.PI, aspect: W / H,
    view: [W, H, W / 2 - (f.x + f.w / 2), H / 2 - (f.y + f.h / 2), W, H]};
}

/** Frame px per world unit along the board's depth at the resting view (the smallest over the hexes, so the far rows
 *  read) and the largest hex's height in frame px. */
export function restScaleOf(rest: View, cells: ReadonlyArray<{x: number; z: number}>, hexR: number, w: number, h: number): {pxPerWorld: number; hexPx: number} {
  let pxPerWorld = Infinity, hexPx = 0;
  for (const c of cells) {
    const a = frameXY(rest, w / h, [c.x, 0.1, c.z - hexR]), b = frameXY(rest, w / h, [c.x, 0.1, c.z + hexR]);
    const span = Math.abs(b.y - a.y) / 2 * h;
    pxPerWorld = Math.min(pxPerWorld, span / (2 * hexR));
    hexPx = Math.max(hexPx, span);
  }
  return {pxPerWorld: Number.isFinite(pxPerWorld) ? pxPerWorld : 1, hexPx};
}

export type FocusOptions = {enabled: boolean; mode?: 'live' | 'story' | 'visit'; R: number};

/** The distance moves are measured from: where a camera framing the whole plate (radius R) at the standard tilt
 *  would stand. Dives and passes keep their size on screen however close the resting view fills the frame. */
export function refDist(R: number): number {
  return ((R * Math.cos(REST_POLAR) + R * 0.12) * 1.06) / Math.tan((FOV * Math.PI) / 360);
}

/** Where to look for these spaces (world x/z). Several at once share their centroid. Never pans past
 *  `clamp` × R from the centre, so the plate stays the subject. */
export function focusView(points: Array<{x: number; z: number; y?: number}>, rest: View, o: FocusOptions): View {
  if (!o.enabled || !points.length) return rest;
  const f = o.mode === 'visit' ? VISIT_FOCUS : o.mode === 'story' ? STORY_FOCUS : FOCUS;
  const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const cz = points.reduce((a, p) => a + p.z, 0) / points.length;
  let tx = cx * f.pull, tz = cz * f.pull;
  const r = Math.hypot(tx, tz), max = f.clamp * o.R;
  if (r > max) { tx *= max / r; tz *= max / r; }
  const side = Math.max(-1, Math.min(1, cx / (o.R * 0.7)));
  const spread = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.z - cz)));
  // `y`: the height of what stands on the spaces (a model's middle). The camera aims at it, not at the ground under
  // it (the ground point behind it, y·tan(polar) further from the camera), and stands back a little for a tall one.
  const y = Math.max(0, ...points.map((p) => p.y ?? 0));
  const zoom = (spread > 0 ? Math.min(f.zoom, Math.max(1.3, (1.2 * o.R) / (2 * spread + 1))) : f.zoom) / (1 + y * 0.35);
  const azimuth = -side * f.swing, lift = y * Math.tan(f.polar);
  return {tx: tx - lift * Math.sin(azimuth), tz: tz - lift * Math.cos(azimuth), dist: Math.min(rest.dist, refDist(o.R) / zoom), polar: f.polar, azimuth};
}

/** World position of the camera for a view. */
export function cameraPosition(v: View): [number, number, number] {
  const s = Math.sin(v.polar), c = Math.cos(v.polar);
  return [v.tx + v.dist * s * Math.sin(v.azimuth), v.dist * c, v.tz + v.dist * s * Math.cos(v.azimuth)];
}

type Vel = {tx: number; tz: number; dist: number; polar: number; azimuth: number};
export const ZERO_VEL: Vel = {tx: 0, tz: 0, dist: 0, polar: 0, azimuth: 0};
const KEYS: Array<keyof View> = ['tx', 'tz', 'dist', 'polar', 'azimuth'];

/** One spring step (semi-implicit Euler, sub-stepped): retargets keep velocity, so a new placement mid-move
 *  bends the path instead of snapping. */
export function stepView(cur: View, vel: Vel, target: View, dt: number, stiffness = 9, damping = 6): {view: View; vel: Vel} {
  const v = {...cur}, w = {...vel};
  // (a long frame, e.g. the first after the board was paused, integrates at most 0.1 s)
  const steps = Math.max(1, Math.ceil(Math.min(dt, 0.1) / (1 / 120)));
  const h = Math.min(dt, 0.1) / steps;
  for (let i = 0; i < steps; i++) {
    for (const k of KEYS) {
      const a = stiffness * (target[k] - v[k]) - damping * w[k];
      w[k] += a * h;
      v[k] += w[k] * h;
    }
  }
  return {view: v, vel: w};
}

/** A big moment (a bonus step, a parameter at its maximum): a long low pass across the board, down in the fog
 *  between the towers, and back up. `t` is seconds since the moment began; null once it is over. Placements
 *  still win: the rig uses this only while no placement is in focus. The camera stays well above the tallest model
 *  (at full strength it flies about 3.2 world units up; models stand at most ~1.2). */
export const MOMENT = {hold: 4.6, zoom: 3.2, polar: 1.1, swing: 0.36, travel: 0.11, maxDelayMs: 20000, settleMs: 900} as const;
export function momentView(rest: View, t: number, strength: 'step' | 'max', ref = rest.dist): View | null {
  if (t < 0 || t > MOMENT.hold) return null;
  const k = strength === 'max' ? 1 : 0.65;
  // the aim point travels across the board and the camera swings with it, so the flight reads as a pass
  const a = (t / MOMENT.hold) * 2 - 1;
  const s = Math.sin(a * Math.PI / 2);
  return {tx: rest.tx + s * ref * MOMENT.travel * k, tz: rest.tz * 0.5, dist: Math.min(rest.dist, ref / (1 + (MOMENT.zoom - 1) * k)),
    polar: rest.polar + (MOMENT.polar - rest.polar) * k, azimuth: a * MOMENT.swing * k};
}

/** How far into a move the camera is (0 at rest, 1 fully in): drives the fog. */
export function moveAmount(cur: View, rest: View, mode: 'live' | 'story' | 'visit' = 'live', ref = rest.dist): number {
  const f = mode === 'visit' ? VISIT_FOCUS : mode === 'story' ? STORY_FOCUS : FOCUS;
  const full = rest.dist - Math.min(rest.dist, ref / f.zoom);
  return full <= 0 ? 0 : Math.max(0, Math.min(1, (rest.dist - cur.dist) / full));
}

// ---- frame times (the quality ladder judges windows of them: quality.ts) -------------------------------------
export function p95(samples: number[]): number {
  if (!samples.length) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}
