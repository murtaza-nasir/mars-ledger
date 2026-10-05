// What each TV's 3D board did lately: TVs report quality-ladder changes (shared/tv3d.ts) over the websocket; the server
// logs each one and keeps the latest per TV for /api/health (`tv3d`). In memory only; a restart forgets them (a TV
// that starts at a reduced level reports that again). Rate-limited per TV and in all, so a misbehaving page cannot
// flood the log.
import {ReactionLimiter} from '../shared/reactions';
import {cleanTv3dReport, tv3dLine, TV3D_LEVELS} from '../shared/tv3d';
import type {Tv3dReport} from '../shared/tv3d';

/** The latest report per TV, as /api/health shows it. */
export type Tv3dHealth = Record<string, {level: number; levelId: string; label: string; dir: Tv3dReport['dir']; p95: number | null; median: number | null;
  slow: number | null; size: string; render: string | null; at: string}>;

export class Tv3dDesk {
  private latest = new Map<string, Tv3dReport & {at: number}>();
  private perTv = new ReactionLimiter(12, 60_000);
  private all = new ReactionLimiter(40, 60_000);
  constructor(private maxTvs = 12) {}

  /** A TV's report: the log line to print, or null when it is malformed or over the rate limit. */
  report(raw: unknown, now: number): string | null {
    const r = cleanTv3dReport(raw);
    if (!r || !this.perTv.take(r.tv, now).ok || !this.all.take('all', now).ok) return null;
    this.latest.delete(r.tv);
    this.latest.set(r.tv, {...r, at: now});
    // the oldest TVs give way (a Map keeps insertion order, and a report re-inserts its TV last)
    while (this.latest.size > this.maxTvs) this.latest.delete(this.latest.keys().next().value!);
    return tv3dLine(r);
  }

  health(): Tv3dHealth {
    const out: Tv3dHealth = {};
    for (const [tv, r] of this.latest) {
      out[tv] = {level: r.level, levelId: TV3D_LEVELS[r.level].id, label: TV3D_LEVELS[r.level].label, dir: r.dir, p95: r.p95, median: r.median, slow: r.slow,
        size: r.size, render: r.render, at: new Date(r.at).toISOString()};
    }
    return out;
  }
}
