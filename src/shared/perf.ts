// Performance recordings from phones: the session shape both ends agree on, and the frame statistics.
// The phone records requestAnimationFrame deltas and interaction marks; the server keeps the sessions and the
// /perf page compares them. Nothing personal goes in a session: device facts and timings only.

/** The interactions the phone marks. */
export const PERF_INTERACTIONS = ['open', 'swipe', 'close', 'tab', 'scroll'] as const;
export type PerfInteractionName = typeof PERF_INTERACTIONS[number];

/** The components whose renders are counted during each interaction. */
export const PERF_COMPONENTS = ['PhoneApp', 'FullPhone', 'Seated', 'Board', 'Deck', 'Viewer', 'LiftedFace'] as const;
export type PerfComponent = typeof PERF_COMPONENTS[number];

export type FrameStats = {
  /** Frames painted during the interaction (deltas counted). */
  frames: number;
  /** Deltas longer than 1.5× the refresh interval. */
  dropped: number;
  /** Refresh intervals missed in all (a 50 ms delta at 60 Hz misses 2). */
  missed: number;
  p50: number;
  p95: number;
  max: number;
  over33: number;
  over50: number;
};

export type PerfInteraction = {
  name: PerfInteractionName;
  /** ms since the session started */
  start: number;
  dur: number;
  stats: FrameStats;
  renders: Partial<Record<PerfComponent, number>>;
  /** Long tasks (ms each) that overlapped it; null where the browser has no long-task timing (Safari). */
  longTasks: number[] | null;
  /** The frame deltas themselves, in ms (one decimal), for a closer look later. */
  deltas: number[];
};

export type PerfDevice = {
  ua: string;
  dpr: number;
  screen: {w: number; h: number};
  viewport: {w: number; h: number};
  /** Estimated from the median frame delta. */
  refreshHz: number;
  build: string;
  ios: boolean;
  standalone: boolean;
  longTaskSupported: boolean;
};

export type PerfSession = {
  /** Chosen by the phone when recording starts; an upload of the same session replaces the previous one. */
  id: string;
  startedAt: number;
  sentAt: number;
  /** How long the recorder has run, ms. */
  duration: number;
  /** Optional free-text tag for the session (e.g. "after the shader change"). */
  label: string;
  device: PerfDevice;
  /** Every frame the session saw, not only during interactions. */
  overall: FrameStats;
  interactions: PerfInteraction[];
};

/** Headline numbers for one interaction type in a session. */
export type PerfHeadline = {
  name: PerfInteractionName;
  count: number;
  /** Median over the interactions of each one's p95 delta. */
  p95: number;
  /** Worst single delta in any of them. */
  max: number;
  /** Dropped frames per interaction (mean). */
  droppedPer: number;
  over50Per: number;
  /** Mean duration, ms. */
  dur: number;
  /** Renders of each counted component per interaction (mean). */
  rendersPer: Partial<Record<PerfComponent, number>>;
  /** All counted renders per interaction (mean). */
  rendersTotalPer: number;
};

export type PerfListItem = {
  id: string; startedAt: number; sentAt: number; duration: number; label: string; build: string; ua: string; refreshHz: number;
  overall: FrameStats; headlines: PerfHeadline[];
};

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The value at quantile q (0..1) of an ascending list: nearest-rank, so it is always a real delta. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[k];
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Display rates a phone can run at. The median delta snaps to the nearest one within 12%. */
const RATES = [30, 48, 50, 60, 72, 75, 80, 90, 96, 100, 120, 144];

/**
 * The refresh interval (ms) from frame deltas: the median, which ignores the long frames of a stutter, snapped to
 * a common display rate when it is close to one (ProMotion iPhones run at 120 Hz, or 60 Hz when Safari caps them).
 */
export function estimateRefresh(deltas: number[]): {intervalMs: number; hz: number} {
  const m = median(deltas.filter((d) => d > 2 && d < 250));
  if (!m) return {intervalMs: 1000 / 60, hz: 60};
  const hz = 1000 / m;
  const near = RATES.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
  const snapped = Math.abs(near - hz) / near <= 0.12 ? near : Math.round(hz);
  return {intervalMs: 1000 / snapped, hz: snapped};
}

/** Statistics of a run of frame deltas, given the device's refresh interval. */
export function frameStats(deltas: number[], intervalMs: number): FrameStats {
  if (!deltas.length) return {frames: 0, dropped: 0, missed: 0, p50: 0, p95: 0, max: 0, over33: 0, over50: 0};
  const s = [...deltas].sort((a, b) => a - b);
  let dropped = 0, missed = 0, over33 = 0, over50 = 0;
  for (const d of deltas) {
    if (d > 1.5 * intervalMs) { dropped++; missed += Math.max(1, Math.round(d / intervalMs) - 1); }
    if (d > 33.4) over33++;
    if (d > 50) over50++;
  }
  return {frames: deltas.length, dropped, missed, p50: round1(quantile(s, 0.5)), p95: round1(quantile(s, 0.95)), max: round1(s[s.length - 1]),
    over33, over50};
}

/** Headline numbers per interaction type, in PERF_INTERACTIONS order (types with no interactions left out). */
export function headlines(interactions: PerfInteraction[]): PerfHeadline[] {
  const out: PerfHeadline[] = [];
  for (const name of PERF_INTERACTIONS) {
    const xs = interactions.filter((i) => i.name === name);
    if (!xs.length) continue;
    const n = xs.length;
    const rendersPer: Partial<Record<PerfComponent, number>> = {};
    let total = 0;
    for (const c of PERF_COMPONENTS) {
      const sum = xs.reduce((a, i) => a + (i.renders[c] ?? 0), 0);
      if (sum) rendersPer[c] = round1(sum / n);
      total += sum;
    }
    out.push({name, count: n, p95: round1(median(xs.map((i) => i.stats.p95))), max: round1(Math.max(...xs.map((i) => i.stats.max))),
      droppedPer: round1(xs.reduce((a, i) => a + i.stats.dropped, 0) / n), over50Per: round1(xs.reduce((a, i) => a + i.stats.over50, 0) / n),
      dur: Math.round(xs.reduce((a, i) => a + i.dur, 0) / n), rendersPer, rendersTotalPer: round1(total / n)});
  }
  return out;
}

// ---- validation: the server stores only what this shape allows -----------------------------------------------

const num = (v: unknown, lo: number, hi: number, dflt = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const MAX_INTERACTIONS = 2000;
const MAX_DELTAS = 4000;

function cleanStats(v: unknown): FrameStats {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (k: string) => num(o[k], 0, 1e7);
  return {frames: n('frames'), dropped: n('dropped'), missed: n('missed'), p50: n('p50'), p95: n('p95'), max: n('max'), over33: n('over33'), over50: n('over50')};
}

/** A session as the phone sent it, rebuilt field by field (unknown fields dropped, numbers clamped); null if unusable. */
export function cleanSession(body: unknown): PerfSession | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const id = str(b.id, 40);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  const d = (b.device && typeof b.device === 'object' ? b.device : {}) as Record<string, unknown>;
  const box = (v: unknown) => { const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>; return {w: num(o.w, 0, 20000), h: num(o.h, 0, 20000)}; };
  const device: PerfDevice = {ua: str(d.ua, 400), dpr: num(d.dpr, 0, 10, 1), screen: box(d.screen), viewport: box(d.viewport), refreshHz: num(d.refreshHz, 0, 500),
    build: str(d.build, 80), ios: d.ios === true, standalone: d.standalone === true, longTaskSupported: d.longTaskSupported === true};
  const names = new Set<string>(PERF_INTERACTIONS);
  const comps = new Set<string>(PERF_COMPONENTS);
  const interactions: PerfInteraction[] = (Array.isArray(b.interactions) ? b.interactions : []).slice(-MAX_INTERACTIONS).flatMap((v): PerfInteraction[] => {
    if (!v || typeof v !== 'object') return [];
    const i = v as Record<string, unknown>;
    if (typeof i.name !== 'string' || !names.has(i.name)) return [];
    const r = (i.renders && typeof i.renders === 'object' ? i.renders : {}) as Record<string, unknown>;
    const renders: Partial<Record<PerfComponent, number>> = {};
    for (const [k, n] of Object.entries(r)) if (comps.has(k)) renders[k as PerfComponent] = num(n, 0, 1e6);
    return [{name: i.name as PerfInteractionName, start: num(i.start, 0, 1e9), dur: num(i.dur, 0, 1e6), stats: cleanStats(i.stats), renders,
      longTasks: Array.isArray(i.longTasks) ? i.longTasks.slice(0, 500).map((x) => num(x, 0, 1e6)) : null,
      deltas: (Array.isArray(i.deltas) ? i.deltas : []).slice(0, MAX_DELTAS).map((x) => round1(num(x, 0, 1e5)))}];
  });
  return {id, startedAt: num(b.startedAt, 0, 1e14), sentAt: num(b.sentAt, 0, 1e14), duration: num(b.duration, 0, 1e9), label: str(b.label, 80),
    device, overall: cleanStats(b.overall), interactions};
}

/** A short device line from a user agent: "iPhone · iOS 18.6 · Safari". */
export function deviceLine(ua: string): string {
  const ios = /(iPhone|iPad|iPod).*?OS (\d+)_(\d+)/.exec(ua);
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  const browser = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS|Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  if (ios) return `${ios[1]} · iOS ${ios[2]}.${ios[3]} · ${browser}`;
  if (android) return `Android ${android[1]} · ${browser}`;
  if (/Macintosh/.test(ua)) return `Mac · ${browser}`;
  if (/Linux/.test(ua)) return `Linux · ${browser}`;
  if (/Windows/.test(ua)) return `Windows · ${browser}`;
  return browser;
}
