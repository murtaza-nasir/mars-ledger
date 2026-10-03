// This phone's private plans: the planned second action and the off-turn tray's pinned cards, per game and seat.
// Kept in localStorage (they survive a reload) and nowhere else: nothing here goes to the server, the TV or another phone.
import {useEffect} from 'react';
import {create} from 'zustand';
import type {PlayerViewModel} from '../../../../shared/full';
import {livePins, planFate, planNow, seenNow} from './rules';
import type {Fate, Plan} from './rules';

const KEY = 'mars-ledger-plans';

type Saved = {plans: Record<string, Plan>; pins: Record<string, string[]>};

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (raw && typeof raw === 'object') return {plans: raw.plans ?? {}, pins: raw.pins ?? {}};
  } catch { /* private mode or a damaged entry: start empty */ }
  return {plans: {}, pins: {}};
}

function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify({plans: s.plans, pins: s.pins})); } catch { /* keep it for this visit */ }
}

type PlanStore = Saved & {
  /** the seat this phone shows: `${gameId}:${playerId}` */
  key: string | null;
  /** the plan's fate in the newest view */
  fate: Fate | null;
  /** a short line after a plan was dropped by the game (an undo, a new generation) */
  notice: {text: string; at: number} | null;
  setPlan: (p: Plan | null) => void;
  togglePin: (name: string) => void;
  clearPins: () => void;
};

export const usePlans = create<PlanStore>((set, get) => ({
  ...load(),
  key: null,
  fate: null,
  notice: null,
  setPlan: (p) => {
    const k = get().key;
    if (!k) return;
    const plans = {...get().plans};
    if (p) plans[k] = p; else delete plans[k];
    set({plans, fate: p ? get().fate ?? {s: 'waiting'} : null});
    save(get());
  },
  togglePin: (name) => {
    const k = get().key;
    if (!k) return;
    const cur = get().pins[k] ?? [];
    const pins = {...get().pins, [k]: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]};
    set({pins});
    save(get());
  },
  clearPins: () => {
    const k = get().key;
    if (!k) return;
    const pins = {...get().pins};
    delete pins[k];
    set({pins});
    save(get());
  },
}));

/** This seat's plan (null when none). */
export const usePlan = () => usePlans((s) => (s.key ? s.plans[s.key] ?? null : null));
export const usePins = () => usePlans((s) => (s.key ? s.pins[s.key] : undefined)) ?? NONE;
const NONE: string[] = [];

/** Drop this seat's plan (Back, Drop, an undo this phone asked for). */
export function dropPlan(why?: string) {
  const s = usePlans.getState();
  if (!s.key || !s.plans[s.key]) return;
  s.setPlan(null);
  if (why) usePlans.setState({notice: {text: why, at: Date.now()}});
}

/**
 * Re-check the plan and the tray on every new view of this seat: the plan's fate (waiting, ready, dropped) and the
 * pins still in hand. Runs in the phone only; it reads the view and writes nothing but this phone's storage.
 */
export function usePlanSync(model: PlayerViewModel, gameId: string | undefined, playerId: string) {
  const key = gameId ? `${gameId}:${playerId}` : null;
  const n = planNow(model);
  const hand = model.cardsInHand.map((c) => c.name).join('\u0000');
  useEffect(() => {
    const st = usePlans.getState();
    if (st.key !== key) usePlans.setState({key, fate: null});
    if (!key) return;
    const plan = usePlans.getState().plans[key];
    if (plan) {
      const fate = planFate(plan, n);
      if (fate.s === 'drop') {
        dropPlan(fate.quiet ? undefined : fate.why);
      } else {
        const next = seenNow(plan, n);
        if (next !== plan) {
          usePlans.setState((s) => ({plans: {...s.plans, [key]: next}}));
          save(usePlans.getState());
        }
        if (usePlans.getState().fate?.s !== fate.s) usePlans.setState({fate});
      }
    } else if (st.fate) usePlans.setState({fate: null});
    const pins = usePlans.getState().pins[key];
    if (pins?.length) {
      const live = livePins(model, pins);
      if (live.length !== pins.length) {
        usePlans.setState((s) => ({pins: {...s.pins, [key]: live}}));
        save(usePlans.getState());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n.generation, n.gameAge, n.undoCount, n.phase, n.active, n.acts, n.menu, hand]);
}

/** Is this seat's plan due now (its first action done, the turn menu open again)? Read straight from storage, so a
 *  caller deciding whether to open the decision sheet does not wait for the sync to run. */
export function planIsReady(model: PlayerViewModel): boolean {
  const s = usePlans.getState();
  const plan = s.key ? s.plans[s.key] : undefined;
  return !!plan && planFate(plan, planNow(model)).s === 'ready';
}

export type {Fate};
