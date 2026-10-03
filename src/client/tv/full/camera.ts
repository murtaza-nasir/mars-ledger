// The TV board's camera: a lens inside the planet disc. The disc, its rim and the off-map spaces stay put;
// the terrain and the hex field zoom and pan as one group, clipped to the disc. All maths is in board units.
//
// A point p of the hex field is drawn at scale * p + (x, y). With the view centred on content point q,
// (x, y) = -scale * q, and the farthest drawn content sits at scale * (extent + |q|). Keeping that inside the
// disc is what "the board never leaves the planet" means, so zoom and pan are solved together.

export type Cam = {x: number; y: number; scale: number};
export const IDENTITY: Cam = {x: 0, y: 0, scale: 1};

export type CamOptions = {
  /** radius of the planet disc the content is clipped to */
  discR: number;
  /** distance from the centre to the farthest drawn content (hex centre + circumradius) */
  extent: number;
  maxZoom?: number;
  minZoom?: number;
  /** how far toward the focus the view centre moves (0 = stay, 1 = centre it) */
  pull?: number;
  /** fraction of the disc radius the content may use */
  margin?: number;
  /** false under reduced motion, or while a cinematic or the production show covers the board */
  enabled: boolean;
};

export const LIVE = {maxZoom: 1.15, minZoom: 1.06, pull: 0.42};
export const STORY = {maxZoom: 1.1, minZoom: 1.04, pull: 0.3};

export function cameraTarget(points: Array<{x: number; y: number}>, o: CamOptions): Cam {
  if (!o.enabled || !points.length) return IDENTITY;
  const maxZoom = o.maxZoom ?? LIVE.maxZoom;
  const minZoom = o.minZoom ?? LIVE.minZoom;
  const pull = o.pull ?? LIVE.pull;
  const room = (o.margin ?? 0.99) * o.discR;
  // Several placements at once (or within the hold) share one view: their centroid.
  const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
  let qx = pull * cx;
  let qy = pull * cy;
  const want = Math.hypot(qx, qy);
  // The most zoom that still fits the wanted pan, within [minZoom, maxZoom] and never past what fits at all.
  const fitAll = room / o.extent;
  let scale = Math.min(maxZoom, Math.max(minZoom, room / (o.extent + want)), fitAll);
  if (scale <= 1) return IDENTITY;
  // Shorten the pan so the farthest content stays on the planet at this zoom.
  const allowed = Math.max(0, room / scale - o.extent);
  if (want > allowed) {
    const k = want > 0 ? allowed / want : 0;
    qx *= k; qy *= k;
  }
  if (Math.hypot(qx, qy) < 1e-9) scale = Math.min(scale, fitAll);
  return {x: -scale * qx, y: -scale * qy, scale};
}

/** Where content point p is drawn under cam (used by tests and by anything placed over the board). */
export function project(cam: Cam, p: {x: number; y: number}): {x: number; y: number} {
  return {x: cam.scale * p.x + cam.x, y: cam.scale * p.y + cam.y};
}
