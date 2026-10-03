// The live game the lifted card view counts its hints from (cardHints.ts). A phone provides it once, high up;
// only the lifted view reads it, so a model update never re-renders a deck through this context.
import {createContext, useContext, useMemo, type ReactNode} from 'react';
import type {PlayerViewModel} from '../../../shared/full';
import type {CardDef} from '../../../shared/types';
import {hintsFor, hintWorldFromFull, type CardHint, type HintWorld} from '../cardHints';

const Ctx = createContext<HintWorld | null>(null);

/** Full games: the engine's view for this phone. */
export function FullHintWorld({model, children}: {model: PlayerViewModel; children: ReactNode}) {
  const world = useMemo(() => hintWorldFromFull(model), [model]);
  return <Ctx.Provider value={world}>{children}</Ctx.Provider>;
}

export function HintWorldProvider({world, children}: {world: HintWorld | null; children: ReactNode}) {
  return <Ctx.Provider value={world}>{children}</Ctx.Provider>;
}

export const useHintWorld = () => useContext(Ctx);

const EMPTY: CardHint[] = [];
/** Hints for a card, the same array while their words are the same (a model update that changes nothing about
 *  this card leaves the lifted face alone). */
export function useCardHints(card: CardDef | null | undefined): CardHint[] {
  const world = useHintWorld();
  const hints = useMemo(() => (card ? hintsFor(world, card) : EMPTY), [world, card]);
  const key = hints.map((h) => `${h.tone}:${h.text}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (hints.length ? hints : EMPTY), [key]);
}
