// Event to reaction, and the queue that hands reactions to the director. Pure and small: a reaction is a request
// with an expiry; nothing waits for it. Cooldowns keep a burst of events (three oceans in a row) to one scene.
import type {LifeEvent} from './events';
import {TILE} from '../../../../../shared/full';

export type ReactionKind = 'surf' | 'fish' | 'bricks' | 'flag' | 'cover' | 'coin' | 'shades' | 'conveyor' | 'catch' | 'camwave';

export type ReactionRequest = {
  kind: ReactionKind;
  /** the hex it happens beside (a placement) */
  spaceId?: string;
  /** when it was asked for and how long it stays worth doing (ms, wall clock) */
  at: number; ttl: number;
  /** higher goes first and may push an ambient scene aside */
  priority: number;
};

export const PRIORITY: Record<ReactionKind, number> = {cover: 9, coin: 6, shades: 5, surf: 4, fish: 4, bricks: 4, flag: 4, conveyor: 3, catch: 2, camwave: 2};
/** Seconds before the same kind may play again. */
export const COOLDOWN_S: Record<ReactionKind, number> = {cover: 14, coin: 12, shades: 25, surf: 8, fish: 8, bricks: 8, flag: 8, conveyor: 30, catch: 100, camwave: 100};
/** How long each request stays alive (ms): placements wait for their tile to drop; production waits for the show. */
const TTL: Record<ReactionKind, number> = {cover: 6000, coin: 15000, shades: 20000, surf: 40000, fish: 40000, bricks: 40000, flag: 40000, conveyor: 60000, catch: 10000, camwave: 10000};
/** At most this many requests come out of one update. */
export const PER_UPDATE = 2;

/** Map one update's events to reactions. `rnd` picks between the two options of a placement. */
export function reactionsFor(events: readonly LifeEvent[], now: number, rnd: () => number): ReactionRequest[] {
  const out: ReactionRequest[] = [];
  const add = (kind: ReactionKind, spaceId?: string) => { if (!out.some((r) => r.kind === kind)) out.push({kind, spaceId, at: now, ttl: TTL[kind], priority: PRIORITY[kind]}); };
  for (const e of events) {
    if (e.kind === 'impact' || e.kind === 'attack') add('cover');
    else if (e.kind === 'mc') add('coin');
    else if (e.kind === 'temp') add('shades');
    else if (e.kind === 'production') add('conveyor');
    else if (e.kind === 'tile') {
      if (e.tileType === TILE.OCEAN) add(rnd() < 0.5 ? 'surf' : 'fish', e.spaceId);
      else if (e.tileType === TILE.CITY || e.tileType === TILE.CAPITAL) add(rnd() < 0.5 ? 'bricks' : 'flag', e.spaceId);
    }
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, PER_UPDATE);
}

/** The idle table's reaction: playing catch with an ice chunk, or waving at the camera. */
export function idleReaction(now: number, rnd: () => number): ReactionRequest {
  const kind: ReactionKind = rnd() < 0.5 ? 'catch' : 'camwave';
  return {kind, at: now, ttl: TTL[kind], priority: PRIORITY[kind]};
}

/** Waiting reactions: expire, de-duplicate by cooldown, hand out the best one that can start. */
export class ReactionQueue {
  private q: ReactionRequest[] = [];
  private lastPlayed = new Map<ReactionKind, number>();
  /** Requests waiting. */
  get size() { return this.q.length; }
  get waiting(): readonly ReactionRequest[] { return this.q; }

  push(reqs: readonly ReactionRequest[], nowMs: number) {
    for (const r of reqs) {
      const last = this.lastPlayed.get(r.kind);
      if (last !== undefined && nowMs - last < COOLDOWN_S[r.kind] * 1000) continue;
      if (this.q.some((x) => x.kind === r.kind && x.spaceId === r.spaceId)) continue;
      this.q.push(r);
    }
    if (this.q.length > 6) this.q.splice(0, this.q.length - 6);
  }

  /** Drop what has expired; take the best request that `ready` accepts (a placement waits for its tile). Marks it played. */
  take(nowMs: number, ready: (r: ReactionRequest) => boolean): ReactionRequest | null {
    this.q = this.q.filter((r) => nowMs - r.at < r.ttl);
    const order = [...this.q].sort((a, b) => b.priority - a.priority || a.at - b.at);
    for (const r of order) {
      if (!ready(r)) continue;
      this.q.splice(this.q.indexOf(r), 1);
      this.lastPlayed.set(r.kind, nowMs);
      return r;
    }
    return null;
  }

  clear() { this.q = []; }
}
