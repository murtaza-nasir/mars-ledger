// The planned second action and the off-turn tray: pure rules, so they are tested without a browser.
// A plan lives on this phone only (localStorage); nothing here is ever sent to the server, the TV or other players.
import {findCard} from '../../../../shared/cards';
import {canMake, moveLabel, project, SP_IDS, worldFromView} from '../../../../shared/projection';
import type {Move, Projection} from '../../../../shared/projection';
import type {CardModel, PlayerInputModel, PlayerViewModel} from '../../../../shared/full';
import {isTurnMenu, optionKind, standardProjectReason, unavailableReason} from '../model';

/** What can be planned as a second action (no payment: it is chosen when the plan is carried out). */
export type PlannedMove =
  | {kind: 'play'; card: string}
  | {kind: 'standard'; project: string}
  | {kind: 'action'; card: string}
  | {kind: 'plants'}
  | {kind: 'heat'};

export type Plan = {
  v: 1;
  /** the first move it was planned after, in words ("Play Lichen") */
  after: string;
  second: PlannedMove;
  /** the game moment the plan was made at: the player's turn menu before the first action */
  made: {generation: number; gameAge: number; undoCount: number};
  /** the newest moment this phone has seen since (to notice the game going back between two views) */
  seen: {gameAge: number; undoCount: number};
};

/** Where the player stands, from their own view. */
export type PlanNow = {generation: number; gameAge: number; undoCount: number; phase: string;
  /** this player is the active player */
  active: boolean;
  /** actions taken in this turn */
  acts: number;
  /** their turn menu is open (not a follow-up question) */
  menu: boolean};

export function planNow(model: PlayerViewModel): PlanNow {
  return {generation: model.game.generation, gameAge: model.game.gameAge, undoCount: model.game.undoCount, phase: model.game.phase,
    active: model.thisPlayer.isActive, acts: model.thisPlayer.actionsTakenThisRound ?? 0, menu: isTurnMenu(model.waitingFor)};
}

/**
 * What becomes of a plan in a new view:
 *  - waiting: the first action is still being chosen or answered;
 *  - ready: the first action is done and the turn menu is open again ("Your planned move: ...");
 *  - busy: the second action is under way (its follow-up questions are open);
 *  - drop: the plan no longer applies, with the reason. `quiet` drops need no notice (the turn simply went on).
 * Dropped on: a new generation, an undo or a move taken back (the game went back), the turn ending (another player is
 * now moving, or the player passed), and a turn menu with no action taken at a later moment (the turn came round again).
 */
export type Fate = {s: 'waiting'} | {s: 'ready'} | {s: 'busy'} | {s: 'drop'; why: string; quiet?: boolean};

export function planFate(plan: Plan, now: PlanNow): Fate {
  if (now.generation !== plan.made.generation) return {s: 'drop', why: 'A new generation started, so your plan was dropped.'};
  if (now.undoCount !== plan.seen.undoCount || now.gameAge < plan.seen.gameAge) return {s: 'drop', why: 'The game went back, so your plan was dropped.'};
  if (now.phase !== 'action' || !now.active) return {s: 'drop', why: 'Your turn ended, so your plan was dropped.', quiet: true};
  if (now.acts === 0) {
    if (now.menu && now.gameAge !== plan.made.gameAge) return {s: 'drop', why: 'Your turn ended, so your plan was dropped.', quiet: true};
    return {s: 'waiting'};
  }
  if (now.acts === 1) return now.menu ? {s: 'ready'} : {s: 'busy'};
  return {s: 'drop', why: 'Your turn ended.', quiet: true};
}

/** The plan after a new view has been seen (the newest moment moves forward; it never moves back). */
export function seenNow(plan: Plan, now: PlanNow): Plan {
  if (now.gameAge <= plan.seen.gameAge && now.undoCount === plan.seen.undoCount) return plan;
  return {...plan, seen: {gameAge: Math.max(plan.seen.gameAge, now.gameAge), undoCount: now.undoCount}};
}

/** May the player plan a second action now? On their own turn menu, before the turn's first action. */
export function canPlan(model: PlayerViewModel): boolean {
  const n = planNow(model);
  return n.phase === 'action' && n.active && n.acts === 0 && n.menu;
}

export function newPlan(model: PlayerViewModel, after: string, second: PlannedMove): Plan {
  const g = model.game;
  return {v: 1, after, second, made: {generation: g.generation, gameAge: g.gameAge, undoCount: g.undoCount}, seen: {gameAge: g.gameAge, undoCount: g.undoCount}};
}

export const planLabel = (m: PlannedMove) => moveLabel(m as Move);

// ---- checking a due plan against the real game -------------------------------------------------
export type PlanCheck = {ok: true; option: number; preview: Projection} | {ok: false; reason: string};

/** Is the planned move on the real turn menu now? If not, why not, in plain words ("Now 3 M€ short"). */
export function checkPlan(model: PlayerViewModel, m: PlannedMove): PlanCheck {
  const w = model.waitingFor;
  if (!w || !isTurnMenu(w)) return {ok: false, reason: 'Your turn menu is not open.'};
  const options = (w as {options: PlayerInputModel[]}).options;
  const option = planOption(w, m);
  const world = worldFromView(model);
  if (option >= 0) return {ok: true, option, preview: project(world, m)};
  // why not: the phone's own reading of the real state, in the present tense
  if ((m.kind === 'play') && !model.cardsInHand.some((c) => c.name === m.card)) return {ok: false, reason: `${m.card} is no longer in your hand.`};
  if (m.kind === 'standard') {
    const c = options.flatMap((o) => (o.type === 'projectCard' ? (o as {cards: CardModel[]}).cards : [])).find((x) => x.name === m.project);
    return {ok: false, reason: `${standardProjectReason(m.project, c?.calculatedCost ?? 0, model)}.`.replace(/^(\d+) M€ needed, you have (\d+) M€\.$/, (_, need, have) => `Now ${Number(need) - Number(have)} M€ short.`)};
  }
  if (m.kind === 'plants' || m.kind === 'heat') {
    const r = unavailableReason(m.kind, model);
    return {ok: false, reason: `${r.replace(/^(\d+) (plants|heat) needed, you have (\d+)$/, (_, need, what, have) => `Now ${Number(need) - Number(have)} ${what} short`)}.`};
  }
  const why = canMake(world, m, world.state, 'now');
  if (why) return {ok: false, reason: `${nowWords(why.text)}.`};
  return {ok: false, reason: m.kind === 'action' ? `${m.card} cannot be used right now.` : 'The game does not allow it right now.'};
}

/** "3 M€ short" as it reads now ("Now 3 M€ short"); requirement reasons come in the present tense already. */
export function nowWords(reason: string): string {
  const short = /^(\d+) (M€|plants|heat) short$/.exec(reason);
  return short ? `Now ${short[1]} ${short[2]} short` : reason;
}

/** Index of the turn-menu option that makes this move (and offers it enabled), or −1. */
export function planOption(w: PlayerInputModel | undefined, m: PlannedMove): number {
  if (!w || w.type !== 'or') return -1;
  const options = w.options as PlayerInputModel[];
  const has = (o: PlayerInputModel, name: string) => ((o as {cards?: CardModel[]}).cards ?? []).some((c) => c.name === name && !c.isDisabled);
  return options.findIndex((o) => {
    const k = optionKind(o);
    switch (m.kind) {
    case 'play': return k === 'play' && has(o, m.card);
    case 'standard': return k === 'standard' && has(o, m.project);
    case 'action': return k === 'action' && has(o, m.card);
    case 'plants': return k === 'plants';
    case 'heat': return k === 'heat';
    }
  });
}

/** The name a turn-menu option's follow-up preselects for this move (the card or standard project). */
export function planPreselect(m: PlannedMove): string | undefined {
  return m.kind === 'play' || m.kind === 'action' ? m.card : m.kind === 'standard' ? m.project : undefined;
}

export const isPlannable = (m: Move): m is PlannedMove & Move => ['play', 'standard', 'action', 'plants', 'heat'].includes(m.kind);
export const knownProject = (name: string) => !!SP_IDS[name];

// ---- the off-turn tray -------------------------------------------------------------------------
export type TrayTotals = {
  cards: Array<{name: string; cost: number}>;
  cost: number;
  /** M€ now, and next generation's income (TR plus M€ production) */
  mc: number; income: number;
  /** how much of the pinned building / space cards' cost steel and titanium could pay, with next generation's metal */
  steel: number; titanium: number;
  /** what the pins could be paid with by the start of next generation's actions */
  available: number;
  /** M€ left over (negative: short) */
  left: number;
};

/** The pinned cards' total cost against M€ now plus next generation's income, with steel and titanium where they pay. */
export function trayTotals(model: PlayerViewModel, pins: string[]): TrayTotals {
  const me = model.thisPlayer;
  const cards = pins.map((n) => model.cardsInHand.find((c) => c.name === n)).filter((c): c is CardModel => !!c)
    .map((c) => ({name: c.name, cost: c.calculatedCost ?? findCard(c.name)?.cost ?? 0}));
  const cost = cards.reduce((a, c) => a + c.cost, 0);
  const income = me.terraformRating + me.megacreditProduction;
  const tagged = (t: string) => cards.filter((c) => findCard(c.name)?.tags.includes(t as never)).reduce((a, c) => a + c.cost, 0);
  // metal never pays more than the cards it can pay for
  const steel = Math.min(tagged('building'), (me.steel + me.steelProduction) * me.steelValue);
  const titanium = Math.min(tagged('space'), (me.titanium + me.titaniumProduction) * me.titaniumValue);
  const available = me.megacredits + income + steel + titanium;
  return {cards, cost, mc: me.megacredits, income, steel, titanium, available, left: available - cost};
}

/** Pins that are still in the hand (a card played or sold leaves the tray). */
export function livePins(model: PlayerViewModel, pins: string[]): string[] {
  return pins.filter((n) => model.cardsInHand.some((c) => c.name === n));
}
