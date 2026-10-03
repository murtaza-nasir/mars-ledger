// After a card action the TV's panel cells wait for the gains flying into them. Each flight holds its
// cell back by the amount still in the air; every token that lands gives its share back, so the number steps up as
// the tokens arrive (the production show holds its numerals the same way). Every hold has a hard deadline from the
// moment its model arrived: a moment that waits behind others, is dropped, or never mounts cannot keep a stale number.
import {useEffect, useState} from 'react';
import {create} from 'zustand';
import type {PublicPlayerModel} from '../../../shared/full';
import {heldValue} from '../../../shared/sync';
import type {Resource} from '../../../shared/types';
import type {Flight} from './actions';

/** The longest a panel cell waits for an action's flight (ms from the model's arrival). */
export const ACTION_HOLD_MS = 4500;

/** One flight's hold: `n` units held back from the cell, `landed` of them given back so far. */
export type ActionHold = {key: string; moment: string; color: string; r: Resource; prod: boolean; n: number; landed: number; until: number};

export const holdKey = (moment: string, f: {r: Resource; prod: boolean}) => `${moment}:${f.r}:${f.prod ? 'prod' : 'stock'}`;

/** Holds for the flights of newly queued action moments (and played cards' gains, with their own deadline `ms`). */
export function holdsFor(moments: Array<{k: string; color: string; flights: Flight[]}>, now: number, ms = ACTION_HOLD_MS): ActionHold[] {
  const out: ActionHold[] = [];
  for (const m of moments) {
    for (const f of m.flights) {
      if (f.n <= 0) continue;
      out.push({key: holdKey(m.k, f), moment: m.k, color: m.color, r: f.r, prod: f.prod, n: f.n, landed: 0, until: now + ms});
    }
  }
  return out;
}

/** A token landed: its share goes back to the cell; a hold with nothing left in the air is gone. */
export function landHold(holds: ActionHold[], key: string, amount: number): ActionHold[] {
  return holds.flatMap((h) => {
    if (h.key !== key) return [h];
    const landed = h.landed + amount;
    return landed >= h.n ? [] : [{...h, landed}];
  });
}

/** How much of `n` units token i of k carries (the shares add up to n). */
export function tokenShare(n: number, k: number, i: number): number {
  return Math.floor((n * (i + 1)) / k) - Math.floor((n * i) / k);
}

/** What still sits in the air for a player: per resource, units held back from the stock and from production. */
export function heldOffsets(holds: ActionHold[], color: string, now: number) {
  const stock: Partial<Record<Resource, number>> = {};
  const prod: Partial<Record<Resource, number>> = {};
  for (const h of holds) {
    if (h.color !== color) continue;
    const left = heldValue({display: h.n - h.landed, until: h.until}, now);
    if (!left) continue;
    const into = h.prod ? prod : stock;
    into[h.r] = (into[h.r] ?? 0) + left;
  }
  return {stock, prod};
}

const PROD_KEY: Record<Resource, keyof PublicPlayerModel> = {
  megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction',
};
const RESOURCES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

/**
 * The panel's numbers with the gains still in the air taken off the latest view, or undefined when nothing is held.
 * Taking the gain off the latest view (not showing the old number) keeps anything else that changed meanwhile.
 */
export function heldPanel(holds: ActionHold[], p: PublicPlayerModel, now: number):
  {amounts?: Record<Resource, number>; prod?: Partial<Record<Resource, number>>} {
  const {stock, prod} = heldOffsets(holds, p.color, now);
  const out: {amounts?: Record<Resource, number>; prod?: Partial<Record<Resource, number>>} = {};
  if (Object.keys(stock).length) {
    out.amounts = Object.fromEntries(RESOURCES.map((r) => [r, Math.max(0, (p[r] as number) - (stock[r] ?? 0))])) as Record<Resource, number>;
  }
  if (Object.keys(prod).length) {
    out.prod = Object.fromEntries(Object.entries(prod).map(([r, n]) => [r, (p[PROD_KEY[r as Resource]] as number) - n]));
  }
  return out;
}

type Store = {
  holds: ActionHold[];
  add: (h: ActionHold[]) => void;
  land: (key: string, amount: number) => void;
  /** a flight with nowhere to land, or a moment that left the screen: its cells show the latest view at once */
  release: (pred: (h: ActionHold) => boolean) => void;
  clear: () => void;
};

export const useActionHolds = create<Store>((set) => ({
  holds: [],
  add: (h) => { if (h.length) set((s) => ({holds: [...s.holds.filter((x) => x.until > Date.now()), ...h]})); },
  land: (key, amount) => set((s) => ({holds: landHold(s.holds, key, amount)})),
  release: (pred) => set((s) => (s.holds.some(pred) ? {holds: s.holds.filter((h) => !pred(h))} : s)),
  clear: () => set((s) => (s.holds.length ? {holds: []} : s)),
}));

// Test hook for the drift harness: the cells held right now, per player colour ("megacredits", "plantsProd").
if (typeof window !== 'undefined') (window as unknown as {__actionHeld?: () => Record<string, Record<string, number>>}).__actionHeld = () => {
  const now = Date.now();
  const out: Record<string, Record<string, number>> = {};
  for (const h of useActionHolds.getState().holds) {
    if (now >= h.until) continue;
    (out[h.color] ??= {})[h.prod ? `${h.r}Prod` : h.r] = h.until - now;
  }
  return out;
};

/** The holds for the panels, re-rendering when one lands and again at the earliest deadline. */
export function useHeldPanels(): ActionHold[] {
  const holds = useActionHolds((s) => s.holds);
  const [, tick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const next = Math.min(...holds.map((h) => h.until).filter((u) => u > now));
    if (!Number.isFinite(next)) return;
    const t = setTimeout(() => tick((n) => n + 1), next - now + 20);
    return () => clearTimeout(t);
  });
  return holds;
}
