// Reactions from phones: validated, rate-limited per player, quiet while a show begins, relayed to
// the TV only. Nothing is stored.
import {REACTION_QUIET_MS, ReactionLimiter, inQuietWindow, isSticker} from '../shared/reactions';
import type {Reaction} from '../shared/reactions';
import type {GameState} from '../shared/game';

export type ReactVerdict =
  | {ok: true; reaction: Reaction}
  /** dropped on purpose (a show is starting): the phone is told it went through, the TV never sees it */
  | {ok: true; reaction: null}
  | {ok: false; error: string; retryInMs?: number};

export class ReactionDesk {
  private limiter = new ReactionLimiter();
  private seq = 0;

  /**
   * @param speaker the player id this socket said hello as (a phone may only react as itself)
   * @param quietStarts server times at which a show began (production show, companion production)
   */
  judge(state: GameState, speaker: string | null, msg: {playerId: string; sticker: unknown}, now: number, quietStarts: Array<number | null>): ReactVerdict {
    const p = state.players.find((x) => x.id === msg.playerId);
    if (!p) return {ok: false, error: 'Only players at the table can react'};
    if (speaker !== null && speaker !== p.id) return {ok: false, error: 'A phone can only react for its own player'};
    if (state.phase === 'lobby') return {ok: false, error: 'Reactions open when the game starts'};
    if (!isSticker(msg.sticker)) return {ok: false, error: 'Unknown sticker'};
    const take = this.limiter.take(p.id, now);
    if (!take.ok) return {ok: false, error: `Too many reactions: try again in ${Math.ceil(take.retryInMs / 1000)} s`, retryInMs: take.retryInMs};
    if (inQuietWindow(quietStarts, now, REACTION_QUIET_MS)) return {ok: true, reaction: null};
    return {ok: true, reaction: {id: `r${now.toString(36)}-${++this.seq}`, playerId: p.id, color: p.color, name: p.name, sticker: msg.sticker, at: now}};
  }
}
