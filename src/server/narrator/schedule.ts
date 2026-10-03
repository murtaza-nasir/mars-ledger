// Which notable moment gets a line, and when. At most one line per MIN_GAP_MS, each moment at most once,
// the most notable waiting moment first, and a moment older than MAX_AGE_MS is dropped rather than
// narrated late. Only one line is in flight at a time.
import type {NarratorEvent} from './detect';

export const MIN_GAP_MS = 25_000;
export const MAX_AGE_MS = 20_000;

export class Scheduler {
  private waiting: NarratorEvent[] = [];
  private seen = new Set<string>();
  private lastSpokeAt = -Infinity;
  private busy = false;

  constructor(private minGapMs = MIN_GAP_MS, private maxAgeMs = MAX_AGE_MS) {}

  /** Offer detected moments. Keys already offered are ignored, so a moment is never narrated twice. */
  offer(events: NarratorEvent[]) {
    for (const e of events) {
      if (this.seen.has(e.key)) continue;
      this.seen.add(e.key);
      this.waiting.push(e);
    }
  }

  /**
   * The moment to narrate now, or null. Call regularly. The caller must call `done` when the line is
   * finished (sent or abandoned) before another moment can be taken.
   */
  take(now: number): NarratorEvent | null {
    this.waiting = this.waiting.filter((e) => now - e.at <= this.maxAgeMs);
    if (this.busy || now - this.lastSpokeAt < this.minGapMs || !this.waiting.length) return null;
    // most notable first; among equals the newest (it is the freshest news)
    this.waiting.sort((a, b) => b.priority - a.priority || b.at - a.at);
    const e = this.waiting.shift()!;
    this.busy = true;
    return e;
  }

  /** The line for the taken moment is finished. `spoke` false means nothing reached the TV (no gap needed). */
  done(now: number, spoke: boolean) {
    this.busy = false;
    if (spoke) this.lastSpokeAt = now;
  }

  /** Forget waiting moments (the table turned narration off, or a new game began). Seen keys are kept. */
  clear() {
    this.waiting = [];
  }

  get pending(): number { return this.waiting.length; }
}
