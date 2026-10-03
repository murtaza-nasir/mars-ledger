// Which parts of a model update the TV's move pipeline presents in sequence: the played cards that get a card moment,
// the new tiles that wait for their card's drop phase, and whether an attack follows a card. The sound layer leaves
// these cues to the pipeline (the card's cue sounds as it travels, the tile's as it drops, the attack's as it lands);
// FullTv uses the same reading to queue the moments. Pure.
import {findCard} from '../../../../shared/cards';
import {TILE} from '../../../../shared/full';
import type {Color, SpectatorModel} from '../../../../shared/full';
import {isRewind} from '../../../../shared/sync';

export type Sequenced = {
  /** played cards with a card moment, 'color|name' in update order */
  cards: string[];
  /** new tiles that drop with a card: space id -> [the card's key, tile type] */
  tiles: Map<string, {card: string; tileType: number}>;
};

/** Cards that never get a card moment: corporations (their own reveal), preludes (revealed with the founders). */
export function hasCardMoment(name: string): boolean {
  const g = findCard(name)?.group;
  return g !== 'corporation' && g !== 'prelude';
}

/**
 * The cards and tiles of an update the pipeline sequences. A new tile goes with the first such card of its owner;
 * an ocean (no owner) with the first such card of the update. `flicked`: cards a phone flicked to the TV (shown by
 * the flick layer instead).
 */
export function sequencedBy(prev: SpectatorModel | null, next: SpectatorModel, flicked: (color: Color, name: string) => boolean = () => false): Sequenced {
  const out: Sequenced = {cards: [], tiles: new Map()};
  if (!prev || prev.id !== next.id || isRewind(prev.game, next.game)) return out;
  const firstOf = new Map<Color, string>();
  for (const p of next.players) {
    const old = prev.players.find((x) => x.color === p.color);
    if (!old) continue;
    const had = new Set(old.tableau.map((c) => c.name));
    for (const c of p.tableau) {
      if (had.has(c.name) || !hasCardMoment(c.name) || flicked(p.color, c.name)) continue;
      const key = `${p.color}|${c.name}`;
      out.cards.push(key);
      if (!firstOf.has(p.color)) firstOf.set(p.color, key);
    }
  }
  if (!out.cards.length) return out;
  const before = new Map(prev.game.spaces.map((s) => [s.id, s.tileType]));
  for (const s of next.game.spaces) {
    if (s.tileType === undefined || before.get(s.id) !== undefined) continue;
    const owner = s.color && s.color !== 'neutral' ? firstOf.get(s.color) : undefined;
    const card = owner ?? (s.tileType === TILE.OCEAN || !s.color || s.color === 'neutral' ? out.cards[0] : undefined);
    if (card) out.tiles.set(s.id, {card, tileType: s.tileType});
  }
  return out;
}
