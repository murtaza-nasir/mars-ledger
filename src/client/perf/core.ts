// The recorder's bookkeeping, free of the browser so it can be tested: a ring of frame deltas, a histogram of every
// delta in the session, and the open/close book of interaction marks.
import {frameStats, quantile, type FrameStats, type PerfComponent, type PerfInteraction, type PerfInteractionName} from '../../shared/perf';

/** The last `capacity` frames: when each ended (rAF timestamp) and its delta. */
export class FrameRing {
  private ts: Float64Array;
  private dt: Float32Array;
  private head = 0;
  private size = 0;
  constructor(readonly capacity = 1 << 15) {
    this.ts = new Float64Array(capacity);
    this.dt = new Float32Array(capacity);
  }
  push(t: number, delta: number) {
    this.ts[this.head] = t;
    this.dt[this.head] = delta;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  get length() { return this.size; }
  /** Deltas of the frames that ended after `from` and no later than `to`, oldest first. */
  between(from: number, to: number): number[] {
    const out: number[] = [];
    for (let k = this.size; k > 0; k--) {
      const i = (this.head - k + this.capacity) % this.capacity;
      const t = this.ts[i];
      if (t > from && t <= to) out.push(this.dt[i]);
    }
    return out;
  }
  /** The most recent n deltas. */
  recent(n: number): number[] {
    const out: number[] = [];
    for (let k = Math.min(n, this.size); k > 0; k--) out.push(this.dt[(this.head - k + this.capacity) % this.capacity]);
    return out;
  }
}

/** Every delta of the session in 0.5 ms buckets (up to 250 ms; longer ones land in the last bucket, the max is kept). */
export class DeltaHistogram {
  static readonly STEP = 0.5;
  static readonly BUCKETS = 501;
  readonly counts = new Uint32Array(DeltaHistogram.BUCKETS);
  total = 0;
  max = 0;
  add(d: number) {
    const i = Math.min(DeltaHistogram.BUCKETS - 1, Math.max(0, Math.floor(d / DeltaHistogram.STEP)));
    this.counts[i]++;
    this.total++;
    if (d > this.max) this.max = d;
  }
  /** The bucket midpoint at quantile q. */
  quantile(q: number): number {
    if (!this.total) return 0;
    const rank = Math.max(1, Math.ceil(q * this.total));
    let seen = 0;
    for (let i = 0; i < this.counts.length; i++) {
      seen += this.counts[i];
      if (seen >= rank) return i === this.counts.length - 1 ? this.max : (i + 0.5) * DeltaHistogram.STEP;
    }
    return this.max;
  }
  /** The same statistics frameStats gives, from the buckets (dropped and missed use bucket midpoints). */
  stats(intervalMs: number): FrameStats {
    let dropped = 0, missed = 0, over33 = 0, over50 = 0;
    for (let i = 0; i < this.counts.length; i++) {
      const n = this.counts[i];
      if (!n) continue;
      const d = i === this.counts.length - 1 ? this.max : (i + 0.5) * DeltaHistogram.STEP;
      if (d > 1.5 * intervalMs) { dropped += n; missed += n * Math.max(1, Math.round(d / intervalMs) - 1); }
      if (d > 33.4) over33 += n;
      if (d > 50) over50 += n;
    }
    const r = (v: number) => Math.round(v * 10) / 10;
    return {frames: this.total, dropped, missed, p50: r(this.quantile(0.5)), p95: r(this.quantile(0.95)), max: r(this.max), over33, over50};
  }
  /** The median delta (for the refresh estimate). */
  median(): number { return this.quantile(0.5); }
}

export type MarkPhase = 'start' | 'end';
type Open = {start: number; renders: Record<string, number>};

/** Pairs start and end marks into interactions. A start within `joinMs` of an open one of the same name belongs to it
 *  (a drag start and the move it triggers mark the same swipe; a second flick of the deck before it settles is the
 *  same scroll); a later start replaces it (its end was lost, e.g. an animation that was interrupted). An end with
 *  nothing open is ignored; an interaction longer than `staleMs` is dropped. */
export class MarkBook {
  private open = new Map<PerfInteractionName, Open>();
  constructor(private staleMs = 8000, private joinMs = 1000) {}
  start(name: PerfInteractionName, t: number, renders: Record<string, number>) {
    const o = this.open.get(name);
    if (o && t - o.start < this.joinMs) return;
    this.open.set(name, {start: t, renders: {...renders}});
  }
  /** Closes the interaction; returns its start time and the renders counted since, or null when none was open. */
  end(name: PerfInteractionName, t: number, renders: Record<string, number>): {start: number; renders: Partial<Record<PerfComponent, number>>} | null {
    const o = this.open.get(name);
    this.open.delete(name);
    if (!o || t - o.start >= this.staleMs || t < o.start) return null;
    const diff: Partial<Record<PerfComponent, number>> = {};
    for (const [k, v] of Object.entries(renders)) {
      const d = v - (o.renders[k] ?? 0);
      if (d > 0) diff[k as PerfComponent] = d;
    }
    return {start: o.start, renders: diff};
  }
  isOpen(name: PerfInteractionName) { return this.open.has(name); }
}

/** Builds one interaction record from its frames. Times are performance.now() values; `origin` is the session start. */
export function buildInteraction(name: PerfInteractionName, start: number, end: number, deltas: number[], intervalMs: number,
  renders: Partial<Record<PerfComponent, number>>, longTasks: number[] | null, origin: number): PerfInteraction {
  return {name, start: Math.round(start - origin), dur: Math.round(end - start), stats: frameStats(deltas, intervalMs), renders, longTasks,
    deltas: deltas.map((d) => Math.round(d * 10) / 10)};
}

export {quantile};
