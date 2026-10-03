// A question no answer can satisfy. Upstream engine edge case: when the project deck and the
// discard pile are both empty, the draft can deal a player an empty hand that still requires one card
// ({type: 'card', cards: [], min: 1}). The engine refuses every answer, so the game cannot go on. The server
// spots such a question, says so once, and the table abandons the game from the game menu.
import type {PlayerInputModel} from './full';
import {messageText} from './full';

export type DeadEnd = {gameId: string; player: string; prompt: string; reason: string; at: number};

/** Why this question cannot be answered, or null when some answer exists. Optional questions are never dead ends. */
export function deadEndReason(w: PlayerInputModel | undefined): string | null {
  if (!w || w.optional) return null;
  if (w.type === 'card') {
    const c = w as Extract<PlayerInputModel, {type: 'card'}>;
    if (c.cards.length < c.min) return c.cards.length === 0 ? 'no cards are left to deal' : `only ${c.cards.length} of the ${c.min} required cards are offered`;
    return null;
  }
  if (w.type === 'space') {
    const s = w as Extract<PlayerInputModel, {type: 'space'}>;
    return s.spaces.length ? null : 'there is no space to choose';
  }
  if (w.type === 'or') {
    const opts = (w as Extract<PlayerInputModel, {type: 'or'}>).options;
    if (!opts.length) return 'there is nothing to choose';
    const reasons = opts.map(deadEndReason);
    return reasons.every((r) => r) ? reasons[0] : null;
  }
  if (w.type === 'and' || w.type === 'initialCards') {
    for (const o of (w as Extract<PlayerInputModel, {type: 'and'}>).options) {
      const r = deadEndReason(o);
      if (r) return r;
    }
  }
  return null;
}

/** The notice for phones and the TV. */
export function deadEndText(d: Pick<DeadEnd, 'player' | 'reason'>): {title: string; line: string} {
  const cards = d.reason.startsWith('no cards') || d.reason.startsWith('only ');
  const what = cards ? `The project cards ran out: ${d.player} must pick a card, but ${d.reason}.` : `${d.player} is asked to choose, but ${d.reason}.`;
  return {title: 'The game cannot continue', line: `${what} Open the game menu and abandon this game to start a new one.`};
}

export function promptTitle(w: PlayerInputModel): string {
  return messageText(w.title);
}
