// A bot's answer to whatever the engine asks (a PlayerInputModel), built only from the bot's own PlayerViewModel.
// Ported from the soak bot (tests/full/soak.py: Bot, pay_for, option_kind, rank) and made to play sensibly:
// "normal" values cards by what they do and when, funds milestones and awards it can win, converts plants and heat,
// uses card actions and standard projects once its cards are played, places tiles for bonuses and neighbours, and
// buys cards within a budget. "easy" plays legal moves loosely and at random. Normal (v3)
// buys at research by value per M€, plays its best card before any standard
// project and keeps standard projects for idle money, mostly in the endgame; v1 and v2 stay behind Mind flags.
//
// Every choice carries a path ("or2/card:Birds"). When the engine refuses an answer, the runner adds its path to
// `avoid` and asks again, so the next answer is a different option; the turn menu always ends in pass or end turn.
import {findCard} from '../../../shared/cards';
import {BONUS, messageText} from '../../../shared/full';
import type {CardModel, Color, InputResponse, PlayerInputModel, PlayerViewModel, PublicPlayerModel} from '../../../shared/full';
import type {BotLevel} from '../../../shared/bots';
import {rankSpaces, tileGoal} from './board';
import type {BonusWorth} from './board';
import {payFor, payForCard} from './pay';
import {V3, behaviorValue, cardValue, context, energyGap, handValue, playableOdds, readiness, stepsLeft, stockValue, unitValue} from './value';
import type {Ctx} from './value';

export {V3};

export type Decision = {response: InputResponse; path: string; why: string};
/** `v1`: play Normal without the endgame rules; `v2`: play Normal without v3's research, card values and standard
 *  projects. Only the bot arena and bench set them, to measure the rules. */
export type Mind = {level: BotLevel; rng: () => number; avoid: ReadonlySet<string>; v1?: boolean; v2?: boolean};

type Input = PlayerInputModel;
export const titleOf = (w: {title?: unknown}) => messageText(w.title as Parameters<typeof messageText>[0]).trim();

/** What a top-level option does (the engine's titles; same rules as the soak bot's option_kind). */
export type OptionKind = 'play' | 'standard' | 'action' | 'sell' | 'milestone' | 'award' | 'plants' | 'heat' | 'pass' | 'end' | 'undo' | 'firstAction' | 'other';
export function optionKind(o: Input): OptionKind {
  const t = titleOf(o).toLowerCase();
  if (o.type === 'projectCard') return t.includes('standard') ? 'standard' : 'play';
  if (o.type === 'card' && (o as {selectBlueCardAction?: boolean}).selectBlueCardAction) return 'action';
  if (t.includes('standard project')) return 'standard';
  if (t.includes('sell patents')) return 'sell';
  if (t.includes('milestone')) return 'milestone';
  if (t.includes('award')) return 'award';
  if (o.type === 'space' && t.includes('greenery')) return 'plants';
  if (t.includes('heat') && t.includes('temperature')) return 'heat';
  if (t.startsWith('pass')) return 'pass';
  if (t === 'end turn') return 'end';
  if (t.includes('undo')) return 'undo';
  if (t.startsWith('take first action')) return 'firstAction';
  return 'other';
}

/** The turn menu: "Take your first action" / "Take your next action". */
export function isTurnMenu(w: Input): boolean {
  return w.type === 'or' && /^take your (first|next) action/i.test(titleOf(w));
}

/** Answer a prompt, or null when nothing acceptable is left (every path avoided). */
export function decide(w: Input, model: PlayerViewModel, mind: Mind): Decision | null {
  // Easy keeps the old play: the endgame rules are Normal's (and so the Jev level's).
  const ctx = context(model, {v1: mind.v1 || mind.level === 'easy', v2: mind.v2});
  // The Jev level's own moves (and its fallbacks) are Normal's.
  return answer(w, ctx, mind.level === 'jev' ? {...mind, level: 'normal'} : mind, '');
}

type Or = Extract<Input, {type: 'or'}>;
type And = Extract<Input, {type: 'and'}>;
type Initial = Extract<Input, {type: 'initialCards'}>;
type ProjectCard = Extract<Input, {type: 'projectCard'}>;
type CardIn = Extract<Input, {type: 'card'}>;
type SpaceIn = Extract<Input, {type: 'space'}>;

export function answer(w: Input, ctx: Ctx, mind: Mind, where: string): Decision | null {
  switch (w.type) {
  case 'or': return isTurnMenu(w) ? turn(w as Or, ctx, mind, where) : orChoice(w as Or, ctx, mind, where);
  case 'and': return andChoice(w as And, ctx, mind, where);
  case 'initialCards': return initialCards(w as Initial, ctx, mind, where);
  case 'option': return mind.avoid.has(where) ? null : {response: {type: 'option'}, path: where, why: titleOf(w) || 'ok'};
  case 'projectCard': return titleOf(w).toLowerCase().includes('standard') ? standardProject(w as ProjectCard, ctx, mind, where, -Infinity) : playCard(w as ProjectCard, ctx, mind, where, -Infinity);
  case 'card': return cardChoice(w as CardIn, ctx, mind, where);
  case 'space': return spaceChoice(w as SpaceIn, ctx, mind, where);
  case 'player': return playerChoice(w as Extract<Input, {type: 'player'}>, ctx, mind, where);
  case 'amount': return amountChoice(w as Extract<Input, {type: 'amount'}>, ctx, mind, where);
  case 'payment': return paymentChoice(w as Extract<Input, {type: 'payment'}>, ctx, mind, where);
  case 'productionToLose': return productionToLose(w as Extract<Input, {type: 'productionToLose'}>, ctx, mind, where);
  case 'resource': return resourceChoice(w as Extract<Input, {type: 'resource'}>, ctx, mind, where);
  case 'resources': return resourcesChoice(w as Extract<Input, {type: 'resources'}>, ctx, mind, where);
  default: return null;
  }
}

// ---- the turn menu ---------------------------------------------------------------------------
type Plan = {i: number; score: number; leaf?: Decision | null; why: string};

function turn(w: Extract<Input, {type: 'or'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const opts = w.options;
  const g = ctx.model.game;
  const left = stepsLeft(g);
  const me = ctx.me;
  const plans: Plan[] = [];
  const at = (i: number) => `${where}or${i}`;
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    const k = optionKind(o);
    const sub = at(i);
    if (mind.avoid.has(sub)) continue;
    switch (k) {
    case 'milestone': {
      const leaf = orChoice(o as Extract<Input, {type: 'or'}>, ctx, mind, sub + '/');
      // v3: before any card (a rival may claim it first; 5 VP for 8 M€ is the best deal in the game)
      if (leaf) plans.push({i, score: ctx.v3 ? 45 : 5 * ctx.vp - 8 + 6, leaf, why: 'claim a milestone (5 VP for 8 M€)'});
      break;
    }
    case 'award': {
      const leaf = awardChoice(o as Extract<Input, {type: 'or'}>, ctx, mind, sub + '/');
      if (leaf) plans.push({i, score: leaf.score, leaf: leaf.d, why: leaf.d.why});
      break;
    }
    case 'plants': {
      const leaf = spaceChoice(o as Extract<Input, {type: 'space'}>, ctx, mind, sub + '/');
      // Conversions spend what has no better use and raise TR before a rival can: they come first.
      if (leaf) plans.push({i, score: (left.oxygen > 0 ? ctx.tr : 0) + ctx.vp + 3, leaf, why: `convert plants into a greenery (${leaf.why})`});
      break;
    }
    case 'heat':
      if (left.temperature > 0) plans.push({i, score: ctx.tr + 3, leaf: {response: {type: 'option'}, path: sub, why: 'convert heat into temperature'}, why: 'convert heat into temperature'});
      break;
    case 'play': {
      const best = bestPlayable(o as Extract<Input, {type: 'projectCard'}>, ctx, mind, sub + '/');
      // A card already bought is worth playing unless it is clearly a loss (its value is only an estimate).
      // In the last generation (v2) a card that beats a standard project for its price comes before one.
      if (best) plans.push({i, score: playScore(best, ctx), leaf: best.d, why: best.d.why});
      break;
    }
    case 'sell': {
      // v3: cards that will never be played are sold for 1 M€ each (just above passing).
      if (!ctx.v3 || mind.level !== 'normal') break;
      const dead = deadCards(o as CardIn, ctx);
      if (dead.length && !mind.avoid.has(`${sub}/sell`)) plans.push({i, score: 0.03, leaf: {response: {type: 'card', cards: dead}, path: `${sub}/sell`, why: `sell ${dead.join(', ')}`}, why: `sell patents: ${dead.join(', ')}`});
      break;
    }
    case 'action': {
      const best = bestAction(o as Extract<Input, {type: 'card'}>, ctx, mind, sub + '/');
      // Actions come after cards and conversions in a turn, and always before passing.
      if (best) plans.push({i, score: Math.max(0.5, best.value * 0.5), leaf: best.d, why: best.d.why});
      break;
    }
    case 'standard': {
      if (ctx.v3 && mind.level === 'normal') {
        const sp = projectV3(o as Extract<Input, {type: 'projectCard'}>, ctx, mind, sub + '/');
        if (sp) plans.push({i, score: sp.score, leaf: sp, why: sp.why});
        break;
      }
      // The endgame: money that no card in hand needs goes into standard projects (it scores nothing at the end).
      if (!ctx.v1 && ctx.gens <= 3) {
        const late = lateProject(o as Extract<Input, {type: 'projectCard'}>, ctx, mind, sub + '/');
        if (late) plans.push({i, score: late.score, leaf: late, why: late.why});
        break;
      }
      // Standard projects late in the game, or early with money to spare.
      if (ctx.gens > 3 && me.megacredits < 30) break;
      const floor = ctx.gens <= 1 ? -9 : -2; // money left at the end scores nothing
      const leaf = standardProject(o as Extract<Input, {type: 'projectCard'}>, ctx, mind, sub + '/', floor);
      if (leaf) plans.push({i, score: Math.max(0.2, (leaf as Decision & {net?: number}).net ?? 0) * 0.8, leaf, why: leaf.why});
      break;
    }
    case 'firstAction':
      plans.push({i, score: 50, leaf: {response: {type: 'option'}, path: sub, why: titleOf(o)}, why: titleOf(o)});
      break;
    default:
      break;
    }
  }
  if (mind.level === 'easy') return easyTurn(w, ctx, mind, where, plans);
  plans.sort((a, b) => b.score - a.score);
  const best = plans.find((p) => p.score > 0 && p.leaf);
  if (best?.leaf) return wrap(best.i, best.leaf, best.why);
  return passOrEnd(w, ctx, mind, where);
}

function easyTurn(w: Extract<Input, {type: 'or'}>, ctx: Ctx, mind: Mind, where: string, plans: Plan[]): Decision | null {
  const did = ctx.me.actionsTakenThisRound ?? 0;
  const options = plans.filter((p) => p.leaf);
  // An affordable card is played most of the time (a loose player still spends its hand rather than hoarding it).
  const play = options.find((p) => optionKind(w.options[p.i]) === 'play');
  if (play && mind.rng() < 0.75) return wrap(play.i, play.leaf!, play.why);
  if (!options.length || mind.rng() < 0.12 + did * 0.1) return passOrEnd(w, ctx, mind, where) ?? (options[0]?.leaf ? wrap(options[0].i, options[0].leaf, options[0].why) : null);
  const p = options[Math.floor(mind.rng() * options.length)];
  return wrap(p.i, p.leaf!, p.why);
}

function passOrEnd(w: Extract<Input, {type: 'or'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const idx = (k: OptionKind) => w.options.findIndex((o, i) => optionKind(o) === k && !mind.avoid.has(`${where}or${i}`));
  const end = idx('end');
  const pass = idx('pass');
  // Ending the turn keeps the bot in the generation: worth it while a good card in hand may become playable soon.
  const waiting = ctx.model.cardsInHand.some((c) => {
    const def = findCard(c.name);
    return def && (c.calculatedCost ?? def.cost ?? 0) <= ctx.me.megacredits && handValue(c.name, c.calculatedCost, ctx) > 4;
  });
  if (end >= 0 && (waiting || pass < 0)) return {response: {type: 'or', index: end, response: {type: 'option'}}, path: `${where}or${end}`, why: 'end turn'};
  if (pass >= 0) return {response: {type: 'or', index: pass, response: {type: 'option'}}, path: `${where}or${pass}`, why: 'pass'};
  if (end >= 0) return {response: {type: 'or', index: end, response: {type: 'option'}}, path: `${where}or${end}`, why: 'end turn'};
  return null;
}

function wrap(i: number, leaf: Decision, why: string): Decision {
  return {response: {type: 'or', index: i, response: leaf.response}, path: leaf.path, why};
}

// ---- cards -----------------------------------------------------------------------------------
function tagsOf(name: string): string[] {
  return findCard(name)?.tags ?? [];
}

export type Scored = {d: Decision; net: number; value: number};

/** Playable cards with a payment, best first (normal) or shuffled (easy). */
export function playables(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string): Scored[] {
  const out: Scored[] = [];
  for (const c of w.cards) {
    if (c.isDisabled) continue;
    const path = `${where}card:${c.name}`;
    if (mind.avoid.has(path)) continue;
    const cost = c.calculatedCost ?? findCard(c.name)?.cost ?? 0;
    const pay = payForCard(ctx.me, cost, tagsOf(c.name), w.paymentOptions);
    if (!pay) continue;
    const def = findCard(c.name);
    // v3: a card that spends stock the player lacks is offered by the engine but refused (Local Heat Trapping)
    if (ctx.v3 && def && !canSpend(def, ctx, pay)) continue;
    const value = def ? cardValue(def, ctx) : cost;
    const net = value - cost;
    out.push({d: {response: {type: 'projectCard', card: c.name, payment: pay}, path, why: `play ${c.name} (worth ${Math.round(value)}, costs ${cost})`}, net, value});
  }
  if (mind.level === 'easy') return shuffle(out, mind.rng);
  return out.sort((a, b) => b.net - a.net);
}

/** Turn-menu score of playing a card: above every endgame standard project and card action when it is worth its
 *  price (v3 plays a card it bought unless it has become clearly a loss). */
export function playScore(best: Scored, ctx: Ctx): number {
  if (ctx.lastGen) return Math.max(best.net + 5, 0.4);
  return best.net + 5;
}

/** Whether the player holds the stock a card's effect spends (heat, plants, energy...) after paying for it. */
function canSpend(def: NonNullable<ReturnType<typeof findCard>>, ctx: Ctx, pay: {heat: number}): boolean {
  for (const [r, n] of Object.entries(def.behavior?.spend ?? {})) {
    if (typeof n !== 'number' || r === 'megacredits' || r === 'resourcesHere' || r === 'cards') continue;
    const have = Number((ctx.me as unknown as Record<string, number>)[r] ?? 0) - (r === 'heat' ? pay.heat : 0);
    if (have < n) return false;
  }
  return true;
}

function bestPlayable(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string): Scored | null {
  const list = playables(w, ctx, mind, where);
  if (mind.level === 'easy') return list[0] ?? null;
  // v3: worth its price at what money is worth now (flush, a card returning 80 % beats idle money)
  if (ctx.v3 && !ctx.lastGen) {
    const k = shadowPrice(ctx, Math.max(0, handPipeline(ctx)));
    return list.find((x) => x.value - k * (x.value - x.net) > V3.playFloor) ?? null;
  }
  // In the last generation only what scores now counts: points, TR, tiles. v2: a card must then beat what its price
  // buys as a standard project (about 1 VP for 14 M€), so production and card draw stay in hand.
  if (ctx.lastGen) return list.find((x) => x.value > 0 && x.value >= LAST_GEN_MC * (x.value - x.net)) ?? null;
  return list.find((x) => x.net > -5 || (ctx.gens <= 1 && x.value > 0)) ?? null;
}

function playCard(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string, floor: number): Decision | null {
  const list = playables(w, ctx, mind, where);
  return list.find((x) => x.net >= floor)?.d ?? list[0]?.d ?? null;
}

/** The best blue-card action to use (its effect minus what it spends), or null if none helps. */
function bestAction(w: Extract<Input, {type: 'card'}>, ctx: Ctx, mind: Mind, where: string): Scored | null {
  const list: Scored[] = [];
  for (const c of w.cards) {
    if (c.isDisabled) continue;
    const path = `${where}card:${c.name}`;
    if (mind.avoid.has(path)) continue;
    const def = findCard(c.name);
    const value = def?.action ? behaviorValue(def.action, ctx, def) : 1;
    list.push({d: {response: {type: 'card', cards: [c.name]}, path, why: `use the action of ${c.name}`}, net: value, value});
  }
  if (mind.level === 'easy') return shuffle(list, mind.rng)[0] ?? null;
  list.sort((a, b) => b.value - a.value);
  // An action whose value the bot cannot see (e.g. a manual step) is still tried: actions are rarely a loss.
  return list.find((x) => x.value > -1) ?? null;
}

export const SP_VALUE: Record<string, (ctx: Ctx) => number> = {
  'Aquifer': (ctx) => (stepsLeft(ctx.model.game).oceans ? ctx.tr + 2 : -99),
  'Asteroid:SP': (ctx) => (stepsLeft(ctx.model.game).temperature ? ctx.tr : -99),
  'Greenery': (ctx) => (stepsLeft(ctx.model.game).oxygen ? ctx.tr : 0) + ctx.vp + 2,
  'City': (ctx) => 3 + Math.min(ctx.gens, 5) * 1.2 + (ctx.gens <= 3 ? ctx.vp : 0) + Math.max(0, ctx.gens - 0.4),
  'Power Plant:SP': (ctx) => unitValue('energy', ctx.model.game) * 1.25 * Math.max(0, ctx.gens - 0.4),
};

/** What one M€ is worth in the last generation, against what it buys as a standard project (1 VP, about 7 M€ of
 *  worth, for 14 M€). */
export const LAST_GEN_MC = 0.5;

/** Money to keep this generation for the worthwhile cards in hand (none in the last generation, when a card that
 *  cannot be played now will not be). Next generation's income arrives before those cards are played. */
export function handReserve(ctx: Ctx): number {
  if (ctx.gens <= 1) return 0;
  let need = 0;
  for (const c of ctx.model.cardsInHand) {
    if (handValue(c.name, c.calculatedCost, ctx) <= 2) continue;
    // v3: only cards that can be played by next generation hold money back
    if (ctx.v3) { const def = findCard(c.name); if (!def || readiness(def, ctx).delay > 1.2) continue; }
    need += c.calculatedCost ?? findCard(c.name)?.cost ?? 0;
  }
  return Math.max(0, need - (ctx.me.megacreditProduction + ctx.me.terraformRating));
}

/** Next generation's income: M€ production plus TR. */
export const income = (ctx: Ctx) => Math.max(0, ctx.me.megacreditProduction + ctx.me.terraformRating);

/**
 * v3's standard project. Last three generations: v2's rule (idle money into the best project that does something).
 * Earlier: only money beyond about one generation of spending (next generation's income, or the cards in hand that
 * will be ready plus a research), and only a project that returns most of its price (no Power Plant unless cards
 * wait for energy).
 * A project that completes a milestone the player can then claim comes first in either case.
 */
export function projectV3(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string): (Decision & {net: number; score: number}) | null {
  let best: (Decision & {net: number; score: number}) | null = null;
  for (const x of projectsV3(w, ctx, mind, where)) if (!best || x.score > best.score || (x.score === best.score && x.net > best.net)) best = x;
  return best;
}

/** Every standard project v3 would consider now, with its turn-menu score (the judge offers them as candidates). */
export function projectsV3(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string): Array<Decision & {net: number; score: number}> {
  const me = ctx.me;
  const heat = w.paymentOptions?.heat ? me.heat : 0;
  const race = milestoneRace(ctx);
  const out: Array<Decision & {net: number; score: number}> = [];
  for (const c of w.cards) {
    if (c.isDisabled) continue;
    const path = `${where}card:${c.name}`;
    const valueOf = SP_VALUE[c.name];
    if (!valueOf || mind.avoid.has(path)) continue;
    const cost = c.calculatedCost ?? 0;
    let value = valueOf(ctx);
    // A power plant only when energy is what the cards wait for, and early enough for them to pay.
    if (c.name === 'Power Plant:SP') {
      if (!race[c.name] && (!energyGap(ctx) || ctx.gens < 4)) continue;
      value += Math.min(6, ctx.gens) * 0.9;
    }
    const pay = payFor(me, cost, {heat: !!w.paymentOptions?.heat, steel: !!w.paymentOptions?.steel, titanium: !!w.paymentOptions?.titanium});
    if (!pay) continue;
    const net = value - cost;
    const short = race[c.name];
    let score: number;
    if (short && me.megacredits + heat - cost >= 8) score = 5 * ctx.vp - 8 + net; // claimable next turn
    else if (ctx.gens <= 3) {
      const spare = me.megacredits + heat - handReserve(ctx);
      if (value < 2 || cost > spare) continue;
      score = lateProjectScore(net);
    } else {
      // only money beyond about one generation of spending (the next research, the cards that will be ready)
      const keep = Math.max(handReserve(ctx) + V3.idleKeep, income(ctx));
      if (cost > me.megacredits + heat - keep || value < cost * V3.idleRatio) continue;
      score = lateProjectScore(net) * 0.5;
    }
    out.push({response: {type: 'projectCard', card: c.name, payment: pay}, path, why: `standard project ${c.name.replace(':SP', '')} (${short ? 'for a milestone' : 'spend idle money'})`, net, score});
  }
  return out;
}

/** The standard project that would bring the player to an unclaimed milestone's threshold (Mayor: 3 cities,
 *  Gardener: 3 greeneries, Terraformer: 35 TR, Energizer: 6 energy production), when fewer than three are claimed. */
export function milestoneRace(ctx: Ctx): Record<string, boolean> {
  const g = ctx.model.game;
  const out: Record<string, boolean> = {};
  if (g.milestones.filter((m) => m.color).length >= 3) return out;
  const need: Record<string, {at: number; projects: string[]}> = {
    Mayor: {at: 3, projects: ['City']}, Gardener: {at: 3, projects: ['Greenery']}, Terraformer: {at: 35, projects: ['Greenery', 'Aquifer', 'Asteroid:SP']},
    Energizer: {at: 6, projects: ['Power Plant:SP']}, Ecologist: {at: 4, projects: []},
  };
  for (const m of g.milestones) {
    const n = need[m.name];
    if (!n || m.color) continue;
    const mine = m.scores.find((s) => s.color === ctx.me.color)?.score ?? 0;
    if (mine === n.at - 1) for (const p of n.projects) out[p] = true;
  }
  return out;
}

/** v3: cards in hand that will not be played before the end (sold for 1 M€ each). */
export function deadCards(w: Extract<Input, {type: 'card'}>, ctx: Ctx): string[] {
  return w.cards.filter((c) => {
    const def = findCard(c.name);
    if (!def) return false;
    const {odds} = readiness(def, ctx);
    if (odds <= 0.05) return true;
    // last generation: what cannot be played now never will be
    return ctx.lastGen && (odds < 1 || (c.calculatedCost ?? def.cost ?? 0) > ctx.me.megacredits + ctx.me.steel * ctx.me.steelValue + ctx.me.titanium * ctx.me.titaniumValue);
  }).slice(0, w.max).map((c) => c.name);
}

/** Turn-menu score of an endgame standard project: above passing, below every card, conversion and action. */
export const lateProjectScore = (net: number) => Math.max(0.05, 0.3 + net / 100);

/**
 * The endgame standard project (v2, last three generations): the best one that does something (a TR, a tile) and
 * that the money no card in hand needs can pay for, or null.
 */
export function lateProject(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string): (Decision & {net: number; score: number}) | null {
  const spare = ctx.me.megacredits + (w.paymentOptions?.heat ? ctx.me.heat : 0) - handReserve(ctx);
  let best: (Decision & {net: number; score: number}) | null = null;
  for (const c of w.cards) {
    if (c.isDisabled) continue;
    const path = `${where}card:${c.name}`;
    const valueOf = SP_VALUE[c.name];
    if (!valueOf || mind.avoid.has(path)) continue;
    const cost = c.calculatedCost ?? 0;
    const value = valueOf(ctx);
    if (value < 2 || cost > spare) continue;
    const pay = payFor(ctx.me, cost, {heat: !!w.paymentOptions?.heat, steel: !!w.paymentOptions?.steel, titanium: !!w.paymentOptions?.titanium});
    if (!pay) continue;
    const net = value - cost;
    if (!best || net > best.net) best = {response: {type: 'projectCard', card: c.name, payment: pay}, path, why: `standard project ${c.name.replace(':SP', '')} (spend idle money)`, net, score: lateProjectScore(net)};
  }
  return best;
}

export function standardProject(w: Extract<Input, {type: 'projectCard'}>, ctx: Ctx, mind: Mind, where: string, floor: number): (Decision & {net?: number}) | null {
  const list: Array<Decision & {net: number}> = [];
  for (const c of w.cards) {
    if (c.isDisabled) continue;
    const path = `${where}card:${c.name}`;
    if (mind.avoid.has(path)) continue;
    const valueOf = SP_VALUE[c.name];
    if (!valueOf && floor > -Infinity) continue; // unknown projects (e.g. Sell Patents) only when forced
    const cost = c.calculatedCost ?? 0;
    const pay = payFor(ctx.me, cost, {heat: !!w.paymentOptions?.heat, steel: !!w.paymentOptions?.steel, titanium: !!w.paymentOptions?.titanium});
    if (!pay) continue;
    const net = (valueOf ? valueOf(ctx) : 0) - cost;
    list.push({response: {type: 'projectCard', card: c.name, payment: pay}, path, why: `standard project ${c.name.replace(':SP', '')}`, net});
  }
  if (mind.level === 'easy') return shuffle(list, mind.rng)[0] ?? null;
  list.sort((a, b) => b.net - a.net);
  return list.find((x) => x.net >= floor) ?? null;
}

function awardChoice(w: Extract<Input, {type: 'or'}>, ctx: Ctx, mind: Mind, where: string): {d: Decision; score: number} | null {
  const g = ctx.model.game;
  const cost = Number(/(\d+)/.exec(titleOf(w))?.[1] ?? 8);
  if (ctx.me.megacredits < cost) return null;
  let best: {d: Decision; score: number} | null = null;
  w.options.forEach((o, i) => {
    const path = `${where}or${i}`;
    if (mind.avoid.has(path)) return;
    const name = titleOf(o);
    const a = g.awards.find((x) => x.name === name);
    if (!a || a.color) return;
    const r = awardOdds(a, ctx, cost);
    if (!r) return;
    const {lead, hold, score} = r;
    if (mind.level === 'normal' && hold === 0) return;
    if (mind.level === 'normal' && score <= 0) return;
    if (!best || score > best.score) best = {d: {response: {type: 'or', index: i, response: {type: 'option'}}, path, why: `fund ${name} (leads by ${lead})`}, score};
  });
  return best;
}

/** An unfunded award's lead for this player, the chance the lead holds, and its expected worth net of the cost
 *  (null when the player is not ahead or level). */
export function awardOdds(a: {scores: Array<{color: Color; score: number}>}, ctx: Ctx, cost: number): {lead: number; hold: number; score: number} | null {
  const mine = a.scores.find((s) => s.color === ctx.me.color)?.score ?? 0;
  const others = a.scores.filter((s) => s.color !== ctx.me.color).map((s) => s.score);
  const top = others.length ? Math.max(...others) : 0;
  const lead = mine - top;
  if (mine <= 0 || lead < 0) return null;
  // 5 VP for first (2 for second); a lead late in the game is likely to hold.
  const hold = ctx.gens <= 2 ? (lead > 0 ? 0.9 : 0.6) : ctx.gens <= 4 ? (lead >= 2 ? 0.75 : 0) : (lead >= 4 ? 0.6 : 0);
  return {lead, hold, score: hold * 5 * ctx.vp + (1 - hold) * 2 * ctx.vp * 0.5 - cost};
}

/** Card prompts outside the turn menu: research, draft, keep, discard, add resources to a card, card actions. */
function cardChoice(w: Extract<Input, {type: 'card'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const t = titleOf(w).toLowerCase();
  const cards = w.cards;
  const pick = (names: string[], why: string): Decision | null => {
    const path = `${where}card:${names.join('+')}`;
    if (mind.avoid.has(path)) return null;
    return {response: {type: 'card', cards: names}, path, why};
  };
  if (w.selectBlueCardAction) {
    const best = bestAction(w, ctx, mind, where);
    return best?.d ?? null;
  }
  const byValue = (list: readonly CardModel[]) => [...list].map((c) => ({c, v: mind.level === 'easy' ? mind.rng() : handValue(c.name, c.calculatedCost, ctx)}))
    .sort((a, b) => b.v - a.v);
  if (t.includes('to buy') && ctx.v3 && mind.level === 'normal') {
    const sel = researchV3(cards, w.max, ctx);
    const chosen = sel.length >= w.min ? sel : byValue(cards).slice(0, w.min).map((x) => x.c.name);
    return pick(chosen, chosen.length ? `buy ${chosen.join(', ')}` : 'buy nothing') ?? pick(byValue(cards).slice(0, w.min).map((x) => x.c.name), 'buy the minimum');
  }
  if (t.includes('to buy')) {
    const budget = buyBudget(ctx, mind);
    const ranked = byValue(cards);
    const n = Math.min(w.max, budget);
    const chosen = (mind.level === 'easy' ? ranked.slice(0, n) : ranked.filter((x) => x.v > 1.5).slice(0, n)).map((x) => x.c.name);
    const sel = chosen.length >= w.min ? chosen : ranked.slice(0, w.min).map((x) => x.c.name);
    return pick(sel, sel.length ? `buy ${sel.join(', ')}` : 'buy nothing') ?? pick(ranked.slice(0, w.min).map((x) => x.c.name), 'buy the minimum');
  }
  // v3: resources are removed from a rival's card when the prompt offers one (Ants, Predators), the one that
  // scores them first; v2 took them from whichever card it valued least, often its own.
  if (ctx.v3 && mind.level === 'normal' && /^select card to remove/.test(t)) {
    const mine = new Set((ctx.me.tableau ?? []).map((c) => c.name));
    const ranked = [...cards].sort((a, b) => Number(mine.has(a.name)) - Number(mine.has(b.name))
      || (mine.has(a.name) ? resourceTargetValue(a.name) - resourceTargetValue(b.name) : resourceTargetValue(b.name) - resourceTargetValue(a.name))
      || (b.resources ?? 0) - (a.resources ?? 0));
    for (const c of ranked) { const d = pick([c.name], `remove from ${c.name}${mine.has(c.name) ? ' (own)' : ''}`); if (d) return d; }
    return null;
  }
  if (t.includes('sell') || t.includes('discard') || t.includes('remove')) {
    // give up the least useful cards, only as many as required
    const ranked = byValue(cards).reverse();
    const k = Math.max(w.min, t.includes('sell') ? 0 : Math.min(1, w.max));
    for (let off = 0; off + k <= ranked.length; off++) {
      const d = pick(ranked.slice(off, off + k).map((x) => x.c.name), `give up ${ranked.slice(off, off + k).map((x) => x.c.name).join(', ') || 'nothing'}`);
      if (d) return d;
    }
    return null;
  }
  // keep / draft / take: the most useful; add resources: a card that scores them
  const isResourceTarget = /add|move|resource|microbe|animal|science|floater/.test(t) && !t.includes('keep');
  const ranked = isResourceTarget
    ? [...cards].map((c) => ({c, v: mind.level === 'easy' ? mind.rng() : resourceTargetValue(c.name)})).sort((a, b) => b.v - a.v)
    : byValue(cards);
  const k = Math.max(w.min, Math.min(t.includes('two cards') ? 2 : 1, w.max));
  for (let off = 0; off + k <= ranked.length; off++) {
    const names = ranked.slice(off, off + k).map((x) => x.c.name);
    const d = pick(names, `${isResourceTarget ? 'add to' : 'keep'} ${names.join(', ')}`);
    if (d) return d;
  }
  return k === 0 ? pick([], 'none') : null;
}

export function resourceTargetValue(name: string): number {
  const vp = findCard(name)?.victoryPoints;
  if (vp && typeof vp === 'object' && vp.resourcesHere) return 3 / (vp.per ?? 1);
  return 0;
}

/** Cards to buy this research: normal keeps money for the generation's plays; easy buys up to two when it can. */
/** Cards in hand above which a bot buys nothing: hoarding drains the deck (an empty deck can leave the engine's
 *  draft asking for a card that does not exist) and money sits idle in cards that never get played. */
export const HAND_CAP: Record<BotLevel, number> = {normal: 8, easy: 6, jev: 8};

/** v3: cards in hand that may still be played, above which research buys nothing (dead cards do not count; the
 *  hard cap keeps the deck from draining). */
export const HAND_CAP_V3 = {live: 10, all: 14};

/** v3: what a card's gain in research must reach, by generations left: early anything that pays back, late only
 *  clear wins, nothing in the last generation. */
export function buyThreshold(ctx: Ctx): number {
  if (ctx.lastGen) return Infinity;
  return ctx.gens <= 2 ? V3.buyLate : ctx.gens <= 4 ? V3.buyMid : V3.buyEarly;
}

/**
 * v3: what one M€ is worth in this player's hands, from how much money the next generation or so brings (stock,
 * metal, 1.5 generations of income) against what the cards it already holds will cost. Short of money, a M€ is
 * worth more than its face (1.15); flush, the alternative use is a standard project at about 0.6-0.8 of its price,
 * so a card that returns 80 % of its price beats leaving the money idle (0.75).
 */
export function shadowPrice(ctx: Ctx, pipeline = handPipeline(ctx)): number {
  const me = ctx.me;
  const capacity = me.megacredits + me.steel * me.steelValue + me.titanium * me.titaniumValue + 1.5 * income(ctx);
  const slack = (capacity - pipeline) / Math.max(15, income(ctx));
  return Math.max(V3.kMin, Math.min(V3.kMax, V3.kMax - 0.05 - V3.kSlope * slack));
}

/** v3: what the live cards in hand (likely to be played) will cost. */
export function handPipeline(ctx: Ctx): number {
  let sum = 0;
  for (const c of ctx.model.cardsInHand) {
    const def = findCard(c.name);
    if (def && readiness(def, ctx).odds >= 0.3) sum += c.calculatedCost ?? def.cost ?? 0;
  }
  return sum;
}

/** v3: a card's research gain: its odds times (value when it can be played, minus its price at the shadow price),
 *  minus the 3 M€ it costs to buy. */
export function buyGain(c: CardModel, ctx: Ctx, k: number): number {
  const def = findCard(c.name);
  if (!def) return -99;
  const price = c.calculatedCost ?? def.cost ?? 0;
  const {odds} = readiness(def, ctx);
  // handValue is (value - price) × odds; move the price to the shadow price
  return handValue(c.name, price, ctx) + odds * price * (1 - k) - 3 * k;
}

/**
 * v3 research: the cards whose gain beats the threshold, best first, as many as the money allows after keeping
 * enough for the best card in hand that is ready to play, with at most ten live cards in hand.
 */
export function researchV3(cards: readonly CardModel[], max: number, ctx: Ctx): string[] {
  const me = ctx.me;
  const hand = ctx.model.cardsInHand.map((c) => {
    const def = findCard(c.name);
    const r = def ? readiness(def, ctx) : {odds: 0, delay: 0};
    return {c, r, cost: c.calculatedCost ?? def?.cost ?? 0};
  });
  const live = hand.filter((x) => x.r.odds >= 0.3);
  const metal = me.steel * me.steelValue + me.titanium * me.titaniumValue;
  const ready = live.filter((x) => x.r.odds >= 0.95 && x.r.delay < 0.5 && x.cost <= me.megacredits + metal).sort((a, b) => b.cost - a.cost)[0];
  // keep the price of the best ready card (at most half the money), and never less than a quarter of it
  const keep = Math.max(me.megacredits * 0.25, Math.min(ready ? Math.max(0, ready.cost - metal) : 0, me.megacredits * 0.5));
  const room = Math.min(HAND_CAP_V3.live - live.length, HAND_CAP_V3.all - hand.length);
  const budget = Math.min(max, room, Math.max(0, Math.floor((me.megacredits - keep) / 3)));
  let pipeline = handPipeline(ctx);
  const out: string[] = [];
  const left = [...cards];
  // Greedy: the best gain at the current shadow price; each card bought raises the pipeline (and the price).
  while (out.length < budget && left.length) {
    const k = shadowPrice(ctx, pipeline + out.length * 3);
    const scored = left.map((c) => ({c, g: buyGain(c, ctx, k)})).sort((a, b) => b.g - a.g);
    const best = scored[0];
    if (best.g < buyThreshold(ctx)) break;
    out.push(best.c.name);
    pipeline += best.c.calculatedCost ?? findCard(best.c.name)?.cost ?? 0;
    left.splice(left.indexOf(best.c), 1);
  }
  return out;
}

export function buyBudget(ctx: Ctx, mind: Mind): number {
  const mc = ctx.me.megacredits;
  const room = Math.max(0, HAND_CAP[mind.level] - ctx.model.cardsInHand.length);
  if (mind.level === 'easy') return Math.min(room, Math.max(0, Math.min(2, Math.floor((mc - 6) / 3))));
  // Late in the game a card has little time to pay back; early, cards are the engine.
  const reserve = ctx.gens <= 1 ? 999 : ctx.gens <= 2 ? 20 : 4 + ctx.me.megacreditProduction;
  return Math.min(room, Math.max(0, Math.min(4, Math.floor((mc - reserve) / 3))));
}

// ---- initial cards: corporation, preludes, the starting hand ---------------------------------
function initialCards(w: Extract<Input, {type: 'initialCards'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  if (mind.avoid.has(where + 'initial') && mind.avoid.has(where + 'initial-safe')) return null;
  const safe = mind.avoid.has(where + 'initial');
  const kind = (o: Input) => {
    const t = titleOf(o).toLowerCase();
    return t.includes('corporation') ? 'corp' : t.includes('prelude') ? 'prelude' : t.includes('ceo') ? 'ceo' : 'project';
  };
  const corpStep = w.options.find((o) => kind(o) === 'corp') as Extract<Input, {type: 'card'}> | undefined;
  const corps = corpStep?.cards ?? [];
  const corpScore = (name: string) => {
    const def = findCard(name);
    if (!def) return 0;
    return (def.startingMegaCredits ?? 40) + behaviorValue(def.behavior, ctx, def) + cardValue({...def, behavior: null, victoryPoints: null}, ctx) * 0.5;
  };
  // v3: a corporation is also worth what it adds to the best starting cards (its tag effects and discounts).
  const projStep = w.options.find((o) => kind(o) === 'project') as Extract<Input, {type: 'card'}> | undefined;
  const fit = (name: string) => {
    if (!ctx.v3 || mind.level !== 'normal' || !projStep) return 0;
    const cctx = withCorp(ctx, name);
    const vs = projStep.cards.map((c) => Math.max(0, handValue(c.name, c.calculatedCost, cctx) - 3)).sort((a, b) => b - a);
    return vs.slice(0, 5).reduce((a, b) => a + b, 0) * 0.5;
  };
  const corp = mind.level === 'easy' || safe ? corps[Math.floor(mind.rng() * corps.length)]?.name ?? corps[0]?.name
    : [...corps].sort((a, b) => corpScore(b.name) + fit(b.name) - corpScore(a.name) - fit(a.name))[0]?.name;
  const startMC = findCard(corp ?? '')?.startingMegaCredits ?? 40;
  const responses: InputResponse[] = [];
  let bought: string[] = [];
  for (const o of w.options) {
    const k = kind(o);
    const step = o as Extract<Input, {type: 'card'}>;
    if (k === 'corp') { responses.push({type: 'card', cards: corp ? [corp] : []}); continue; }
    if (k === 'prelude' || k === 'ceo') {
      const ranked = [...step.cards].map((c) => {
        const def = findCard(c.name);
        return {c, v: mind.level === 'easy' ? mind.rng() : def ? behaviorValue(def.behavior, ctx, def) + cardValue({...def, behavior: null}, ctx) : 0};
      }).sort((a, b) => b.v - a.v);
      responses.push({type: 'card', cards: ranked.slice(0, step.max).map((x) => x.c.name)});
      continue;
    }
    // Starting hand: keep the cards worth more than their 3 M€, leaving money to play them.
    const budget = safe ? 0 : Math.max(0, Math.floor((startMC - (mind.level === 'easy' ? 12 : 15)) / 3));
    const cctx = ctx.v3 && corp && mind.level === 'normal' ? withCorp(ctx, corp) : ctx;
    const ranked = [...step.cards].map((c) => ({c, v: mind.level === 'easy' ? mind.rng() : handValue(c.name, c.calculatedCost, cctx)})).sort((a, b) => b.v - a.v);
    // v3: a card must pay back its 3 M€ with some margin (the research rule's early threshold)
    const floor = cctx.v3 && mind.level === 'normal' ? 3 + buyThreshold(cctx) : 2;
    bought = (mind.level === 'easy' ? ranked : ranked.filter((x) => x.v > floor)).slice(0, Math.min(step.max, budget)).map((x) => x.c.name);
    responses.push({type: 'card', cards: bought});
  }
  return {response: {type: 'initialCards', responses}, path: where + (safe ? 'initial-safe' : 'initial'), why: `found ${corp ?? '?'}, keep ${bought.length} card${bought.length === 1 ? '' : 's'}`};
}

/** The context as if the corporation were already in play (its tags, its starting production and its effects). */
function withCorp(ctx: Ctx, corp: string): Ctx {
  const def = findCard(corp);
  if (!def) return ctx;
  const tags = {...ctx.tags};
  for (const t of def.tags) tags[t] = (tags[t] ?? 0) + 1;
  const prod = def.behavior?.production ?? {};
  const n = (r: string) => (typeof prod[r as keyof typeof prod] === 'number' ? prod[r as keyof typeof prod] as number : 0);
  const me = {...ctx.me, tableau: [...(ctx.me.tableau ?? []), {name: corp}], megacreditProduction: ctx.me.megacreditProduction + n('megacredits'),
    steelProduction: ctx.me.steelProduction + n('steel'), titaniumProduction: ctx.me.titaniumProduction + n('titanium'),
    plantProduction: ctx.me.plantProduction + n('plants'), energyProduction: ctx.me.energyProduction + n('energy'), heatProduction: ctx.me.heatProduction + n('heat')};
  return {...ctx, me, tags};
}

// ---- other prompts ---------------------------------------------------------------------------
const SKIP = /^(do not|don't|do nothing|skip|none|no thanks|pass\b)/i;

/** An attack option's title: "Remove 2 plants from red", "Steal 3 M€ from green" (the engine names the player by
 *  colour and states the amount it will really take). */
const ATTACK = /^(remove|steal) (\d+) (.+?) from (\w+)$/i;
const RESOURCE_WORD: Record<string, string> = {'m€': 'megacredits', 'mc': 'megacredits', 'megacredit': 'megacredits', 'plant': 'plants'};

/**
 * What an attack option is worth (v2): what it takes (a steal also gains it), more against the rival who leads on
 * points; never against yourself. Null when the title is not an attack on a player.
 */
export function attackScore(title: string, ctx: Ctx): number | null {
  const m = ATTACK.exec(title.trim());
  if (!m) return null;
  const target = ctx.model.players.find((p) => p.color === m[4].toLowerCase());
  if (!target) return null;
  if (target.color === ctx.me.color) return -99;
  const word = m[3].toLowerCase();
  const res = RESOURCE_WORD[word] ?? word;
  const vp = (p: PublicPlayerModel) => p.victoryPointsBreakdown?.total ?? p.terraformRating;
  const rivals = ctx.model.players.filter((p) => p.color !== ctx.me.color);
  const leader = rivals.length > 1 && vp(target) >= Math.max(...rivals.map(vp));
  return Number(m[2]) * unitValue(res, ctx.model.game) * (m[1].toLowerCase() === 'steal' ? 2 : 1) * (leader ? 1.5 : 1);
}

function orChoice(w: Extract<Input, {type: 'or'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const order = w.options.map((o, i) => ({o, i}));
  // Normal: do something rather than nothing, in the engine's order (its first option is the card's main effect).
  // v2: attacks go by their worth (the leader first, never yourself), not the engine's player order.
  // Easy: any option at random. Undo is never chosen.
  const attacks = ctx.v1 ? [] : order.map((x) => attackScore(titleOf(x.o), ctx));
  const harmful = (x: {i: number}) => (attacks[x.i] ?? 0) < 0;
  const ranked = mind.level === 'easy' ? shuffle(order, mind.rng)
    : [
      ...order.filter((x) => !SKIP.test(titleOf(x.o)) && !harmful(x)).sort((a, b) => (attacks[b.i] ?? 0) - (attacks[a.i] ?? 0)),
      ...order.filter((x) => SKIP.test(titleOf(x.o))),
      ...order.filter(harmful),
    ];
  for (const {o, i} of ranked) {
    if (optionKind(o) === 'undo') continue;
    const sub = `${where}or${i}`;
    if (mind.avoid.has(sub)) continue;
    const leaf = answer(o, ctx, mind, sub + '/');
    if (leaf) return {response: {type: 'or', index: i, response: leaf.response}, path: leaf.path, why: leaf.why || titleOf(o)};
  }
  return null;
}

function andChoice(w: Extract<Input, {type: 'and'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  // Several amounts that must add up (spread resources over cards): try the first one at its maximum, then the next...
  const amounts = w.options.every((o) => o.type === 'amount');
  if (amounts) {
    for (let k = 0; k < w.options.length; k++) {
      const path = `${where}and:max${k}`;
      if (mind.avoid.has(path)) continue;
      const responses: InputResponse[] = w.options.map((o, j) => ({type: 'amount', amount: j === k ? (o as {max: number}).max : (o as {min: number}).min}));
      return {response: {type: 'and', responses}, path, why: `all to ${titleOf(w.options[k]) || 'the first'}`};
    }
    const path = `${where}and:min`;
    if (mind.avoid.has(path)) return null;
    return {response: {type: 'and', responses: w.options.map((o) => ({type: 'amount', amount: (o as {min: number}).min}))}, path, why: 'the minimum'};
  }
  const responses: InputResponse[] = [];
  const paths: string[] = [];
  for (let j = 0; j < w.options.length; j++) {
    const leaf = answer(w.options[j], ctx, mind, `${where}and${j}/`);
    if (!leaf) return null;
    responses.push(leaf.response);
    paths.push(leaf.path);
  }
  return {response: {type: 'and', responses}, path: `${where}and[${paths.join(',')}]`, why: 'each part'};
}

export function spaceChoice(w: Extract<Input, {type: 'space'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const goal = tileGoal(titleOf(w));
  const offered = w.spaces.filter((id) => !mind.avoid.has(`${where}space:${id}`));
  if (!offered.length) return null;
  if (mind.level === 'easy') {
    const id = offered[Math.floor(mind.rng() * offered.length)];
    return {response: {type: 'space', spaceId: id}, path: `${where}space:${id}`, why: `${goal} at ${id}`};
  }
  const [best] = rankSpaces(offered, goal, ctx.me.color, ctx.model.game.spaces, bonusWorth(ctx));
  return {response: {type: 'space', spaceId: best.id}, path: `${where}space:${best.id}`, why: `${goal} at ${best.id} (worth ${best.score.toFixed(1)})`};
}

/** What printed space bonuses are worth now when it differs from the usual (v2, last generation): steel and titanium
 *  with no card in hand to spend them on, a card drawn too late to play, heat once the temperature is maxed. */
export function bonusWorth(ctx: Ctx): BonusWorth {
  if (!ctx.lastGen) return {};
  const w: BonusWorth = {[BONUS.STEEL]: Math.min(1.8, stockValue('steel', ctx)), [BONUS.TITANIUM]: Math.min(2.8, stockValue('titanium', ctx)), [BONUS.DRAW_CARD]: 0.5};
  if (stepsLeft(ctx.model.game).temperature === 0) w[BONUS.HEAT] = 0.1;
  return w;
}

function playerChoice(w: Extract<Input, {type: 'player'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const list = w.players.filter((c) => !mind.avoid.has(`${where}player:${c}`));
  if (!list.length) return null;
  const others = list.filter((c) => c !== ctx.me.color);
  const pool = others.length ? others : list;
  // Hurt the leader (most points, then highest TR); the neutral player in solo games counts as nobody's.
  const score = (c: Color) => {
    const p = ctx.model.players.find((x) => x.color === c);
    return p ? (p.victoryPointsBreakdown?.total ?? p.terraformRating) : -1;
  };
  const pickC = mind.level === 'easy' ? pool[Math.floor(mind.rng() * pool.length)] : [...pool].sort((a, b) => score(b) - score(a))[0];
  return {response: {type: 'player', player: pickC}, path: `${where}player:${pickC}`, why: `target ${nameOf(ctx.model.players, pickC)}`};
}

function nameOf(players: PublicPlayerModel[], c: Color): string {
  return players.find((p) => p.color === c)?.name ?? c;
}

function amountChoice(w: Extract<Input, {type: 'amount'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const t = titleOf(w).toLowerCase();
  const low = /lose|remove from your|decrease your/.test(t);
  const tries = mind.level === 'easy' ? [Math.round(w.min + mind.rng() * (w.max - w.min)), w.max, w.min] : low ? [w.min, w.max] : [w.max, w.min];
  for (const n of tries) {
    const path = `${where}amount:${n}`;
    if (!mind.avoid.has(path)) return {response: {type: 'amount', amount: n}, path, why: `${n}`};
  }
  return null;
}

function paymentChoice(w: Extract<Input, {type: 'payment'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const path = `${where}payment`;
  if (mind.avoid.has(path)) {
    // Retry with M€ only (plus heat if allowed), in case metal was not accepted here.
    if (mind.avoid.has(path + ':mc')) return null;
    const p = payFor(ctx.me, w.amount, {heat: !!w.paymentOptions?.heat});
    return p ? {response: {type: 'payment', payment: p}, path: path + ':mc', why: `pay ${w.amount} M€`} : null;
  }
  const p = payFor(ctx.me, w.amount, {steel: !!w.paymentOptions?.steel, titanium: !!w.paymentOptions?.titanium, heat: !!w.paymentOptions?.heat});
  return p ? {response: {type: 'payment', payment: p}, path, why: `pay ${w.amount}`} : null;
}

function productionToLose(w: Extract<Input, {type: 'productionToLose'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const path = `${where}production`;
  if (mind.avoid.has(path)) return null;
  // Lose the least valuable production first.
  const g = ctx.model.game;
  const units: Record<string, number> = {};
  let left = w.payProduction.cost;
  const order = Object.entries(w.payProduction.units).sort((a, b) => unitValue(a[0], g) - unitValue(b[0], g));
  for (const [r, n] of order) {
    const k = Math.min(n, left);
    units[r] = k; left -= k;
  }
  return {response: {type: 'productionToLose', units}, path, why: 'give up the cheapest production'};
}

function resourceChoice(w: Extract<Input, {type: 'resource'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const g = ctx.model.game;
  const list = w.include.filter((r) => !mind.avoid.has(`${where}resource:${r}`));
  if (!list.length) return null;
  const r = mind.level === 'easy' ? list[Math.floor(mind.rng() * list.length)] : [...list].sort((a, b) => unitValue(b, g) - unitValue(a, g))[0];
  return {response: {type: 'resource', resource: r}, path: `${where}resource:${r}`, why: r};
}

function resourcesChoice(w: Extract<Input, {type: 'resources'}>, ctx: Ctx, mind: Mind, where: string): Decision | null {
  const g = ctx.model.game;
  const kinds = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];
  const best = mind.level === 'easy' ? kinds[Math.floor(mind.rng() * kinds.length)] : [...kinds].sort((a, b) => unitValue(b, g) - unitValue(a, g))[0];
  for (const r of [best, 'megacredits']) {
    const path = `${where}resources:${r}`;
    if (mind.avoid.has(path)) continue;
    const units = Object.fromEntries(kinds.map((k) => [k, k === r ? w.count : 0]));
    return {response: {type: 'resources', units}, path, why: `${w.count} ${r}`};
  }
  return null;
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The last-resort answer when every considered path was refused: pass or end the turn, else the first option. */
export function safeDefault(input: Input, avoid: ReadonlySet<string>): Decision | null {
  if (input.type === 'or') {
    const w = input as Or;
    const kinds: OptionKind[] = ['pass', 'end'];
    for (const k of kinds) {
      const i = w.options.findIndex((o) => optionKind(o) === k);
      if (i >= 0 && !avoid.has(`safe:or${i}`)) return {response: {type: 'or', index: i, response: {type: 'option'}}, path: `safe:or${i}`, why: k};
    }
    for (let i = 0; i < w.options.length; i++) {
      const o = w.options[i];
      if (o.type === 'option' && optionKind(o) !== 'undo' && !avoid.has(`safe:or${i}`)) return {response: {type: 'or', index: i, response: {type: 'option'}}, path: `safe:or${i}`, why: titleOf(o) || 'first option'};
    }
    return null;
  }
  if (input.type === 'card') {
    const w = input as CardIn;
    if (w.min === 0 && !avoid.has('safe:none')) return {response: {type: 'card', cards: []}, path: 'safe:none', why: 'none'};
    if (!avoid.has('safe:first')) return {response: {type: 'card', cards: w.cards.slice(0, Math.max(1, w.min)).map((c) => c.name)}, path: 'safe:first', why: 'the first card'};
  }
  if (input.type === 'space') {
    const w = input as SpaceIn;
    if (w.spaces.length && !avoid.has('safe:space')) return {response: {type: 'space', spaceId: w.spaces[0]}, path: 'safe:space', why: 'the first space'};
  }
  if (input.type === 'option' && !avoid.has('safe:option')) return {response: {type: 'option'}, path: 'safe:option', why: 'ok'};
  return null;
}

export {playableOdds};
