// The 3D board's quality ladder as both ends see it: the levels (client board3d/quality.ts steps through them), and
// the small report a TV sends when it changes level, which the server logs and keeps for /api/health (`tv3d`).

/** The ladder's levels, best first; each keeps the savings of the ones above it. The last is the flat board. */
export const TV3D_LEVELS = [
  {id: 'full', label: 'full quality'},
  {id: 'res85', label: 'reduced resolution (85%)'},
  {id: 'res70', label: 'reduced resolution (70%)'},
  {id: 'effects', label: 'reduced resolution and effects'},
  {id: 'noTerraformers', label: 'terraformers paused'},
  {id: 'noLife', label: 'board life paused'},
  {id: 'lite', label: 'simpler tiles'},
  {id: 'flat', label: 'flat board'},
] as const;
export type LevelId = typeof TV3D_LEVELS[number]['id'];

/**
 * A TV's report: which level it is at now and why. `dir`: stepped down or up, fell back to the flat board, started at
 * a remembered level, or was reset to full quality in the TV options. The frame figures are the judged window's
 * (95th percentile and median in ms, `slow` the share of frames over 25 ms); `size` is the page as
 * `<width>x<height>@<density>`, `render` the 3D canvas in device pixels.
 */
export type Tv3dReport = {
  tv: string; level: number; dir: 'down' | 'up' | 'flat' | 'start' | 'reset';
  p95: number | null; median: number | null; slow: number | null; size: string; render: string | null;
};

const DIRS = ['down', 'up', 'flat', 'start', 'reset'] as const;
const num = (v: unknown, max: number, k = 10) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v * k) / k) : null);
const word = (v: unknown, n: number, re: RegExp) => (typeof v === 'string' && re.test(v) ? v.slice(0, n) : null);

/** A report from the wire, or null when it is malformed. */
export function cleanTv3dReport(raw: unknown): Tv3dReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const tv = word(o.tv, 16, /^[a-z0-9-]{1,16}$/i);
  const level = typeof o.level === 'number' && Number.isInteger(o.level) && o.level >= 0 && o.level < TV3D_LEVELS.length ? o.level : null;
  const dir = DIRS.includes(o.dir as Tv3dReport['dir']) ? o.dir as Tv3dReport['dir'] : null;
  const size = word(o.size, 32, /^[0-9]{1,5}x[0-9]{1,5}@[0-9.]{1,6}$/);
  if (!tv || level === null || !dir || !size) return null;
  return {tv, level, dir, p95: num(o.p95, 10_000), median: num(o.median, 10_000), slow: num(o.slow, 1, 100), size, render: word(o.render, 16, /^[0-9]{1,5}x[0-9]{1,5}$/)};
}

/** The server log line, e.g. "3D: TV k3x9 stepped down to reduced resolution (85%): p95 34 ms at 1536x729@2.5". */
export function tv3dLine(r: Tv3dReport): string {
  const label = TV3D_LEVELS[r.level].label;
  const what = r.dir === 'down' ? `stepped down to ${label}` : r.dir === 'up' ? `stepped up to ${label}` : r.dir === 'flat' ? 'fell back to the flat board'
    : r.dir === 'start' ? `started at ${label}` : `was reset to ${label}`;
  const frames = r.p95 !== null ? `: p95 ${Math.round(r.p95)} ms${r.median !== null ? `, median ${Math.round(r.median)} ms` : ''}${r.slow !== null ? `, ${Math.round(r.slow * 100)}% over 25 ms` : ''}` : '';
  return `3D: TV ${r.tv} ${what}${frames} at ${r.size}${r.render ? ` (canvas ${r.render})` : ''}`;
}
