// The rules engine. Pure and deterministic: apply(state, command) -> {state, events}.
// It runs on the server (authoritative) and on phones (preview + prompt discovery).
// When an effect needs a decision it throws NeedsInput; the phone asks the player,
// appends the answer to the command and tries again.
import {findCard, getCard, countedTags} from './cards';
import {AWARD_COSTS, BOARD_NAMES, boardOf, CARD_BUY_COST, GLOBAL, HEAT_PER_TEMPERATURE, MILESTONE_COST,
  STANDARD_PROJECTS, STARTING_TR} from './board';
import {isNarratorMode} from './narrator';
import {isTurnClockSetting} from './clock';
import {BOT_LEVELS, isBotSpeed, MAX_SEATS} from './bots';
import type {Answer, Command, GameEvent, GameState, Payment, PlayerState} from './game';
import {RESOURCES} from './types';
import type {Standing, StandingHelpers} from './board';
import type {Behavior, CardDef, Countable, CountSpec, Requirement, Resource, Tag, TileKind, Trigger, Units} from './types';

// ---------------------------------------------------------------------------------------------
export type Prompt =
  | {kind: 'or'; title: string; options: string[]}
  | {kind: 'player'; title: string; candidates: string[]; allowNone: boolean}
  | {kind: 'card'; title: string; candidates: Array<{owner: string; card: string; resources: number}>; allowNone: boolean}
  | {kind: 'tile'; title: string; tile: TileKind; askOnMars: boolean}
  | {kind: 'yesno'; title: string}
  | {kind: 'resource'; title: string; options: Resource[]}
  | {kind: 'amount'; title: string; min: number; max: number}
  | {kind: 'manual'; title: string; text: string}
  /** pick a card the app does not track in a hand (Valley Trust draws preludes from the deck) */
  | {kind: 'pickCard'; title: string; group: 'prelude'; exclude: string[]};

export class NeedsInput extends Error {
  constructor(public prompt: Prompt) { super('needs input: ' + prompt.kind); }
}
export class RuleError extends Error {}

type Ctx = {
  s: GameState;
  answers: Answer[];
  cursor: number;
  events: GameEvent[];
  /** the card whose play fired the running trigger (Viral Enhancers etc.) */
  triggerCard?: string;
};

function ask<K extends Answer['kind']>(ctx: Ctx, prompt: Prompt, kind: K): Extract<Answer, {kind: K}> {
  const a = ctx.answers[ctx.cursor];
  if (!a) throw new NeedsInput(prompt);
  if (a.kind !== kind) throw new RuleError(`Expected a ${kind} answer, got ${a.kind}`);
  ctx.cursor++;
  return a as Extract<Answer, {kind: K}>;
}

const zero = (): Units => ({megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0});

export function newGame(id: string): GameState {
  return {id, phase: 'lobby', modules: ['base', 'corpera'], players: [], order: [], current: null, generation: 0,
    global: {temperature: GLOBAL.temperature.min, oxygen: 0, oceans: 0, venus: 0}, awards: [], milestones: [],
    seq: 0, startedAt: null, endedAt: null};
}

function newPlayer(id: string, name: string, color: PlayerState['color']): PlayerState {
  return {id, name, color, corporation: null, tr: STARTING_TR, stock: zero(), production: zero(), steelValue: 2,
    titaniumValue: 3, greeneryCost: 8, played: [], usedActions: [], milestones: [], handSize: 0, ready: false,
    passed: false, turnActions: 0, nextCardRequirementBonus: 0, nextCardDiscount: 0,
    tiles: {cityOnMars: 0, cityOffMars: 0, greenery: 0, special: 0, oceans: 0}};
}

export function player(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new RuleError('Unknown player');
  return p;
}
const nameOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)?.name ?? '?';

// ---- derived facts ---------------------------------------------------------------------------
export function cardsInPlay(p: PlayerState): CardDef[] {
  const out: CardDef[] = [];
  if (p.corporation) out.push(getCard(p.corporation));
  for (const c of p.played) { const d = findCard(c.name); if (d) out.push(d); }
  return out;
}

export function tagCount(p: PlayerState, tag: string): number {
  let n = 0;
  for (const c of cardsInPlay(p)) for (const t of countedTags(c)) if (t === tag) n++;
  return n;
}

/** What milestone and award rules need to know (board.ts defines the rules, the engine supplies the facts). */
export const STANDING_HELPERS: StandingHelpers = {
  tags: tagCount,
  distinctTags: (p) => {
    const kinds = new Set<string>();
    for (const c of cardsInPlay(p)) if (c.type !== 'event') for (const t of c.tags) if (t !== 'wild' && t !== 'event') kinds.add(t);
    return kinds.size;
  },
  played: (p) => p.played.map((pc) => findCard(pc.name)).filter((c): c is CardDef => !!c),
  cardResources: (p) => p.played.reduce((a, pc) => a + pc.resources, 0),
};

/** A player's value for a milestone or award: computed, or entered from the physical board when it depends on tile positions. */
export function standingValue(p: PlayerState, st: Standing): number {
  return st.value(p, STANDING_HELPERS) ?? p.manualScores?.[st.name] ?? 0;
}

export function allTags(p: PlayerState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cardsInPlay(p)) for (const t of countedTags(c)) out[t] = (out[t] ?? 0) + 1;
  return out;
}

function count(s: GameState, owner: PlayerState, v: Countable | undefined, here?: string): number {
  if (v === undefined) return 0;
  if (typeof v === 'number') return v;
  const spec = v as CountSpec;
  const pool = spec.all ? s.players : spec.others ? s.players.filter((x) => x.id !== owner.id) : [owner];
  let n = 0;
  if (spec.tag) for (const t of [spec.tag].flat()) for (const p of pool) n += tagCount(p, t);
  // Tiles count across every player unless `all: false`, as in the engine's Counter.
  const tilePool = (spec as {all?: boolean}).all === false ? [owner] : s.players;
  if (spec.cities) {
    for (const p of tilePool) n += spec.cities.where === 'offmars' ? p.tiles.cityOffMars :
      spec.cities.where === 'onmars' ? p.tiles.cityOnMars : p.tiles.cityOnMars + p.tiles.cityOffMars;
  }
  if (spec.greeneries) for (const p of tilePool) n += p.tiles.greenery;
  if (spec.oceans) n += s.global.oceans;
  if (spec.eventsPlayed) for (const p of pool) n += p.played.filter((c) => findCard(c.name)?.type === 'event').length;
  if (spec.resourcesHere && here) n += owner.played.find((c) => c.name === here)?.resources ?? 0;
  if (spec.each) n *= spec.each;
  if (spec.per) n = Math.floor(n / spec.per);
  return n;
}

// ---- requirements, cost, payment -------------------------------------------------------------
export function requirementBonus(p: PlayerState): number {
  return cardsInPlay(p).reduce((a, c) => a + (c.requirementBonus ?? 0), 0) + p.nextCardRequirementBonus;
}

/** Unmet requirements, in plain words. Empty means playable. */
export function unmetRequirements(s: GameState, p: PlayerState, card: CardDef): string[] {
  const out: string[] = [];
  const bonus = requirementBonus(p);
  for (const r of card.requirements as Requirement[]) {
    for (const param of ['temperature', 'oxygen', 'oceans', 'venus'] as const) {
      const need = r[param];
      if (need === undefined) continue;
      const have = s.global[param];
      const tol = bonus * (param === 'temperature' || param === 'venus' ? 2 : 1);
      const unit = param === 'temperature' ? '°C' : param === 'oxygen' || param === 'venus' ? '%' : ' oceans';
      if (r.max ? have > need + tol : have < need - tol) out.push(`${r.max ? 'At most' : 'At least'} ${need}${unit}`);
    }
    // A wild tag (Research Coordination) counts as any tag for requirements.
    if (r.tag && tagCount(p, r.tag) + (r.tag === 'wild' ? 0 : tagCount(p, 'wild')) < (r.count ?? 1)) out.push(`${r.count ?? 1} ${r.tag} tag${(r.count ?? 1) > 1 ? 's' : ''}`);
    if (r.production && p.production[r.production] < (r.count ?? 1)) out.push(`${r.production} production`);
    if (r.greeneries !== undefined && p.tiles.greenery < r.greeneries) out.push(`${r.greeneries} greenery tile`);
    if (r.cities !== undefined) {
      const pool = r.all ? s.players : [p];
      const have = pool.reduce((a, x) => a + x.tiles.cityOnMars + x.tiles.cityOffMars, 0);
      if (have < r.cities) out.push(`${r.cities} cities${r.all ? ' in play' : ''}`);
    }
    if (r.tr !== undefined && p.tr < r.tr) out.push(`TR ${r.tr}`);
  }
  return out;
}

export function cardCost(p: PlayerState, card: CardDef): number {
  let cost = card.cost ?? 0;
  for (const c of cardsInPlay(p)) {
    for (const d of c.cardDiscount) {
      if (!d.tag) cost -= d.amount;
      else if (card.tags.includes(d.tag)) cost -= d.per === 'card' ? d.amount : d.amount * card.tags.filter((t) => t === d.tag).length;
    }
  }
  cost -= p.nextCardDiscount;
  return Math.max(0, cost);
}

export function standardProjectCost(p: PlayerState, project: string): number {
  const sp = STANDARD_PROJECTS.find((x) => x.id === project);
  if (!sp) throw new RuleError('Unknown standard project');
  let cost = sp.cost;
  for (const c of cardsInPlay(p)) for (const d of c.standardProjectDiscount ?? []) if (d.project === project) cost -= d.amount;
  return Math.max(0, cost);
}

export function canUseHeat(p: PlayerState): boolean {
  return cardsInPlay(p).some((c) => c.heatAsMC);
}

export type PayOpts = {steel: boolean; titanium: boolean; tags?: readonly Tag[]};

/** A card in play whose resources pay for this card (Psychrophiles' microbes for plant cards), if any. */
export function resourcePayer(p: PlayerState, tags: readonly Tag[] | undefined): {card: string; value: number; available: number} | null {
  if (!tags?.length) return null;
  for (const pc of p.played) {
    const d = findCard(pc.name);
    if (d?.payWithResources && tags.includes(d.payWithResources.tag)) return {card: pc.name, value: d.payWithResources.value, available: pc.resources};
  }
  return null;
}

export function paymentValue(p: PlayerState, pay: Payment, opts: PayOpts): number {
  const payer = resourcePayer(p, opts.tags);
  return (pay.megacredits ?? 0) + (opts.steel ? (pay.steel ?? 0) * p.steelValue : 0) +
    (opts.titanium ? (pay.titanium ?? 0) * p.titaniumValue : 0) + (canUseHeat(p) ? pay.heat ?? 0 : 0) +
    (payer ? (pay.cardResources ?? 0) * payer.value : 0);
}

/** Cheapest sensible default: steel/titanium first, then M€. */
export function suggestPayment(p: PlayerState, cost: number, opts: PayOpts): Payment {
  let left = cost;
  const pay: Payment = {};
  if (opts.titanium && p.stock.titanium) {
    const n = Math.min(p.stock.titanium, Math.floor(left / p.titaniumValue));
    if (n) { pay.titanium = n; left -= n * p.titaniumValue; }
  }
  if (opts.steel && p.stock.steel) {
    const n = Math.min(p.stock.steel, Math.floor(left / p.steelValue));
    if (n) { pay.steel = n; left -= n * p.steelValue; }
  }
  pay.megacredits = left;
  return pay;
}

function pay(p: PlayerState, cost: number, payment: Payment, opts: PayOpts) {
  const payer = resourcePayer(p, opts.tags);
  if (payment.cardResources) {
    if (payment.cardResources < 0) throw new RuleError('Negative payment');
    if (!payer) throw new RuleError('No card resources can pay for this card');
    if (payment.cardResources > payer.available) throw new RuleError(`Not enough resources on ${payer.card}`);
  }
  for (const r of ['megacredits', 'steel', 'titanium', 'heat'] as const) {
    const n = payment[r] ?? 0;
    if (n < 0) throw new RuleError('Negative payment');
    if (n > p.stock[r]) throw new RuleError(`Not enough ${r === 'megacredits' ? 'M€' : r}`);
  }
  if (payment.steel && !opts.steel) throw new RuleError('Steel only pays for building tags');
  if (payment.titanium && !opts.titanium) throw new RuleError('Titanium only pays for space tags');
  if (payment.heat && !canUseHeat(p)) throw new RuleError('Heat cannot pay here');
  const value = paymentValue(p, payment, opts);
  if (value < cost) throw new RuleError(`Payment of ${value} M€ is short of ${cost} M€`);
  if ((payment.megacredits ?? 0) + (payment.heat ?? 0) > cost) throw new RuleError('Paying more M€ than the cost');
  for (const r of ['megacredits', 'steel', 'titanium', 'heat'] as const) p.stock[r] -= payment[r] ?? 0;
  if (payer && payment.cardResources) p.played.find((c) => c.name === payer.card)!.resources -= payment.cardResources;
}

// ---- effects ---------------------------------------------------------------------------------
const MIN_PRODUCTION: Units = {megacredits: -5, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0};
const label: Record<Resource, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};

function addProduction(p: PlayerState, r: Resource, n: number) {
  if (p.production[r] + n < MIN_PRODUCTION[r]) throw new RuleError(`Not enough ${label[r]} production`);
  p.production[r] += n;
}

function gainTR(ctx: Ctx, p: PlayerState, n: number) {
  if (!n) return;
  p.tr += n;
  if (n > 0) p.trRaisedGeneration = ctx.s.generation;
  ctx.events.push({kind: 'tr', player: p.id, delta: n});
}

/** Raise a global parameter by `steps`, awarding TR and board bonuses to `p`. */
export function raiseGlobal(ctx: Ctx, p: PlayerState | null, param: 'temperature' | 'oxygen', steps: number) {
  const g = GLOBAL[param];
  for (let i = 0; i < Math.abs(steps); i++) {
    const from = ctx.s.global[param];
    const dir = Math.sign(steps);
    const to = from + dir * g.step;
    if (to > g.max || to < g.min) break;
    ctx.s.global[param] = to;
    ctx.events.push({kind: 'global', player: p?.id ?? null, param, from, to});
    if (!p || dir < 0) continue;
    gainTR(ctx, p, 1);
    if (param === 'temperature' && (to === -24 || to === -20)) addProduction(p, 'heat', 1);
    if (param === 'temperature' && to === 0) placeTile(ctx, p, 'ocean', 'Temperature bonus: place an ocean');
    if (param === 'oxygen' && to === 8) raiseGlobal(ctx, p, 'temperature', 1);
  }
}

function placeTile(ctx: Ctx, p: PlayerState, tile: TileKind, title?: string, opts: {onMars?: boolean} = {}) {
  if (tile === 'ocean' && ctx.s.global.oceans >= GLOBAL.oceans.max) {
    ctx.events.push({kind: 'note', player: p.id, text: 'All oceans are placed'});
    return;
  }
  const a = ask(ctx, {kind: 'tile', tile, title: title ?? `Place a ${tile} tile on the board`,
    askOnMars: tile === 'city' && opts.onMars === undefined}, 'tile');
  const bonus = a.bonus ?? {};
  for (const r of RESOURCES) if (bonus[r]) p.stock[r] += bonus[r]!;
  if (bonus.cards) p.handSize += bonus.cards;
  const onMars = opts.onMars ?? a.onMars ?? true;
  ctx.events.push({kind: 'tile', player: p.id, tile});
  if (tile === 'city') { if (onMars) p.tiles.cityOnMars++; else p.tiles.cityOffMars++; }
  if (tile === 'greenery') { p.tiles.greenery++; raiseGlobal(ctx, p, 'oxygen', 1); }
  if (tile === 'special') p.tiles.special++;
  if (tile === 'ocean') {
    const from = ctx.s.global.oceans;
    ctx.s.global.oceans++;
    p.tiles.oceans++;
    ctx.events.push({kind: 'global', player: p.id, param: 'oceans', from, to: from + 1});
    gainTR(ctx, p, 1);
  }
  fireTriggers(ctx, p, {when: 'tilePlaced', tile, onMars: tile !== 'city' || onMars,
    bonusSteelOrTitanium: !!(bonus.steel || bonus.titanium)});
}

/** Protected Habitats: opponents may not remove this player's plants, animals or microbes. */
function hasHabitatProtection(p: PlayerState): boolean {
  return cardsInPlay(p).some((c) => c.protects === 'plantsAnimalsMicrobes');
}

function cardResourceCandidates(ctx: Ctx, owners: PlayerState[],
  match: {type?: string; tag?: Tag; exclude?: string; min?: number; removingBy?: string}) {
  const out: Array<{owner: string; card: string; resources: number}> = [];
  for (const o of owners) {
    for (const pc of o.played) {
      const d = findCard(pc.name);
      if (!d?.resourceType) continue;
      if (match.removingBy !== undefined) {
        if (d.protects === 'thisCard') continue;
        if (o.id !== match.removingBy && hasHabitatProtection(o) && ['Animal', 'Microbe'].includes(d.resourceType)) continue;
      }
      if (match.type && d.resourceType !== match.type) continue;
      if (match.tag && !d.tags.includes(match.tag)) continue;
      if (match.exclude === pc.name) continue;
      if (match.min !== undefined && pc.resources < match.min) continue;
      out.push({owner: o.id, card: pc.name, resources: pc.resources});
    }
  }
  return out;
}

function productionBox(d: CardDef): Behavior | undefined {
  if (d.behavior?.production) return {production: d.behavior.production};
  const opts = d.behavior?.or?.behaviors;
  if (opts?.length && opts.every((o) => o.production)) {
    return {or: {title: `${d.name}: which production?`, behaviors: opts.map((o) => ({title: o.title, production: o.production}))}};
  }
  return undefined;
}

export function run(ctx: Ctx, p: PlayerState, b: Behavior | null | undefined, card?: string) {
  if (!b) return;
  const s = ctx.s;
  if (b.requires === 'trRaisedThisGeneration' && p.trRaisedGeneration !== s.generation) {
    throw new RuleError('Your terraform rating has not gone up this generation');
  }
  if (b.spend) {
    for (const r of RESOURCES) {
      const n = b.spend[r];
      if (!n) continue;
      if (p.stock[r] < n) throw new RuleError(`Needs ${n} ${label[r]}`);
      p.stock[r] -= n;
    }
    if (b.spend.resourcesHere) {
      const pc = p.played.find((c) => c.name === card);
      if (!pc || pc.resources < b.spend.resourcesHere) throw new RuleError('Not enough resources on this card');
      pc.resources -= b.spend.resourcesHere;
    }
    if (b.spend.cards) {
      if (p.handSize < b.spend.cards) throw new RuleError('Not enough cards in hand');
      p.handSize -= b.spend.cards;
    }
  }
  if (b.or) {
    const a = ask(ctx, {kind: 'or', title: b.or.title ?? 'Choose one', options: b.or.behaviors.map((x) => x.title)}, 'or');
    const chosen = b.or.behaviors[a.index];
    if (!chosen) throw new RuleError('Invalid choice');
    run(ctx, p, chosen, card);
  }
  if (b.optional) {
    const a = ask(ctx, {kind: 'yesno', title: b.optional.title}, 'yesno');
    if (a.yes) run(ctx, p, b.optional.behavior, card);
  }
  // Attacks on production resolve before the player's own gains, so a card cannot target its own new production.
  if (b.decreaseAnyProduction) {
    const {type, count: n} = b.decreaseAnyProduction;
    const cands = s.players.filter((x) => x.production[type] - n >= MIN_PRODUCTION[type]).map((x) => x.id);
    if (!cands.length) throw new RuleError(`Nobody has ${n} ${label[type]} production to lose`);
    {
      const a = ask(ctx, {kind: 'player', title: `Decrease any ${label[type]} production ${n} step${n > 1 ? 's' : ''}`, candidates: cands, allowNone: false}, 'player');
      if (!a.playerId || !cands.includes(a.playerId)) throw new RuleError('Choose a player');
      addProduction(player(s, a.playerId), type, -n);
      if (a.playerId !== p.id) ctx.events.push({kind: 'attack', player: p.id, target: a.playerId, what: `−${n} ${label[type]} production`});
    }
  }
  if (b.production) for (const r of RESOURCES) if (b.production[r] !== undefined) addProduction(p, r, count(s, p, b.production[r], card));
  if (b.stock) {
    for (const r of RESOURCES) {
      if (b.stock[r] === undefined) continue;
      const n = count(s, p, b.stock[r], card);
      if (p.stock[r] + n < 0) throw new RuleError(`Not enough ${label[r]}`);
      p.stock[r] += n;
    }
  }
  if (b.standardResource) {
    const n = typeof b.standardResource === 'number' ? b.standardResource : b.standardResource.count;
    const a = ask(ctx, {kind: 'resource', title: `Gain ${n} of one resource`, options: ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat']}, 'resource');
    p.stock[a.resource] += n;
  }
  if (b.addResources !== undefined && card) {
    const pc = p.played.find((c) => c.name === card);
    if (pc) pc.resources += count(s, p, b.addResources, card);
  }
  if (b.addResourcesToTriggerCard) {
    const target = ctx.triggerCard && p.played.find((c) => c.name === ctx.triggerCard);
    if (target && findCard(target.name)?.resourceType) target.resources += b.addResourcesToTriggerCard;
  }
  if (b.addResourcesToAnyCard) {
    for (const spec of [b.addResourcesToAnyCard].flat()) {
      const n = count(s, p, spec.count, card);
      const cands = cardResourceCandidates(ctx, [p], {type: spec.type, tag: spec.tag,
        exclude: 'excludeThis' in spec && spec.excludeThis ? card : undefined, min: 'min' in spec ? spec.min : undefined});
      if (!cands.length) { ctx.events.push({kind: 'note', player: p.id, text: `No card can take ${spec.type ?? 'the resource'}`}); continue; }
      const target = cands.length === 1 ? cands[0] : (() => {
        const a = ask(ctx, {kind: 'card', title: `Add ${n} ${spec.type ?? 'resource'} to a card`, candidates: cands, allowNone: false}, 'card');
        return cands.find((c) => c.card === a.card && c.owner === a.owner);
      })();
      if (!target) throw new RuleError('Invalid card');
      player(s, target.owner).played.find((c) => c.name === target.card)!.resources += n;
    }
  }
  if (b.removeResourcesFromAnyCard) {
    const spec = b.removeResourcesFromAnyCard;
    const n = count(s, p, spec.count ?? 1, card);
    const owners = spec.source === 'self' ? [p] : spec.source === 'opponents' ? s.players.filter((x) => x.id !== p.id) : s.players;
    const cands = cardResourceCandidates(ctx, owners, {type: spec.type, min: 1, exclude: card, removingBy: p.id});
    if (!cands.length && !spec.upTo) throw new RuleError(`There is no ${spec.type} to remove`);
    if (cands.length) {
      const a = ask(ctx, {kind: 'card', title: `Remove ${n} ${spec.type} from a card`, candidates: cands, allowNone: false}, 'card');
      const t = cands.find((c) => c.card === a.card && c.owner === a.owner);
      if (!t) throw new RuleError('Invalid card');
      const pc = player(s, t.owner).played.find((c) => c.name === t.card)!;
      pc.resources = Math.max(0, pc.resources - n);
      if (t.owner !== p.id) ctx.events.push({kind: 'attack', player: p.id, target: t.owner, what: `took ${n} ${spec.type} from ${t.card}`});
    } else ctx.events.push({kind: 'note', player: p.id, text: `No ${spec.type} to remove`});
  }
  if (b.removeAnyPlants) {
    const n = b.removeAnyPlants;
    const cands = s.players.filter((x) => x.stock.plants > 0 && (x.id === p.id || !hasHabitatProtection(x))).map((x) => x.id);
    if (cands.length) {
      const a = ask(ctx, {kind: 'player', title: `Remove up to ${n} plants from any player`, candidates: cands, allowNone: true}, 'player');
      if (a.playerId) {
        const t = player(s, a.playerId);
        const lost = Math.min(n, t.stock.plants);
        t.stock.plants -= lost;
        if (t.id !== p.id) ctx.events.push({kind: 'attack', player: p.id, target: t.id, what: `−${lost} plants`});
      }
    }
  }
  if (b.steal) {
    const {type, count: n} = b.steal;
    const cands = s.players.filter((x) => x.id !== p.id && x.stock[type] > 0).map((x) => x.id);
    if (cands.length) {
      const a = ask(ctx, {kind: 'player', title: `Steal up to ${n} ${label[type]}`, candidates: cands, allowNone: true}, 'player');
      if (a.playerId) {
        const t = player(s, a.playerId);
        const got = Math.min(n, t.stock[type]);
        t.stock[type] -= got; p.stock[type] += got;
        ctx.events.push({kind: 'attack', player: p.id, target: t.id, what: `stole ${got} ${label[type]}`});
      }
    }
  }
  if (b.removeAnyStock) {
    const {type, count: n} = b.removeAnyStock;
    const cands = s.players.filter((x) => x.stock[type] > 0 && (type !== 'plants' || x.id === p.id || !hasHabitatProtection(x))).map((x) => x.id);
    if (cands.length) {
      const a = ask(ctx, {kind: 'player', title: `Remove up to ${n} ${label[type]} from any player`, candidates: cands, allowNone: true}, 'player');
      if (a.playerId) {
        if (!cands.includes(a.playerId)) throw new RuleError('Choose a player');
        const t = player(s, a.playerId);
        const lost = Math.min(n, t.stock[type]);
        t.stock[type] -= lost;
        if (t.id !== p.id) ctx.events.push({kind: 'attack', player: p.id, target: t.id, what: `−${lost} ${label[type]}`});
      }
    }
  }
  if (b.exchangeProduction) {
    const {from, to} = b.exchangeProduction;
    const max = p.production[from] - MIN_PRODUCTION[from];
    if (max < 1) throw new RuleError(`No ${label[from]} production to convert`);
    const a = ask(ctx, {kind: 'amount', title: `Move how many steps of ${label[from]} production to ${label[to]}?`, min: 1, max}, 'amount');
    const v = Math.floor(a.value);
    if (v < 1 || v > max) throw new RuleError('Invalid amount');
    addProduction(p, from, -v);
    addProduction(p, to, v);
  }
  if (b.exchangeStock) {
    const {from, to} = b.exchangeStock;
    const a = ask(ctx, {kind: 'amount', title: `Spend how much ${label[from]} for ${label[to]}?`, min: 0, max: p.stock[from]}, 'amount');
    const v = Math.floor(a.value);
    if (v < 0 || v > p.stock[from]) throw new RuleError('Invalid amount');
    p.stock[from] -= v;
    p.stock[to] += v;
  }
  if (b.conditional) {
    const c = b.conditional;
    run(ctx, p, tagCount(p, c.tag) >= c.atLeast ? c.then : c.else, card);
  }
  if (b.copyProductionBox) {
    const tag = b.copyProductionBox.tag;
    const cands = p.played.filter((pc) => pc.name !== card).map((pc) => findCard(pc.name))
      .filter((d): d is CardDef => !!d && d.tags.includes(tag) && !!productionBox(d))
      .map((d) => ({owner: p.id, card: d.name, resources: 0}));
    if (!cands.length) throw new RuleError(`You have no ${tag} card with a production box`);
    const a = ask(ctx, {kind: 'card', title: 'Copy the production box of which card?', candidates: cands, allowNone: false}, 'card');
    if (!a.card || !cands.some((c) => c.card === a.card)) throw new RuleError('Invalid card');
    run(ctx, p, productionBox(getCard(a.card)), a.card);
  }
  if (b.nextCardRequirementBonus) p.nextCardRequirementBonus = b.nextCardRequirementBonus;
  if (b.nextCardDiscount) p.nextCardDiscount = b.nextCardDiscount;
  if (b.tr !== undefined) gainTR(ctx, p, count(s, p, b.tr, card));
  if (b.global?.temperature) raiseGlobal(ctx, p, 'temperature', b.global.temperature);
  if (b.global?.oxygen) raiseGlobal(ctx, p, 'oxygen', b.global.oxygen);
  if (b.city) placeTile(ctx, p, 'city', b.city.on === 'volcanic' ? 'Place a city tile on a volcanic area' : undefined, b.city.space ? {onMars: false} : {onMars: true});
  if (b.greenery) placeTile(ctx, p, 'greenery');
  if (b.ocean) for (let i = 0; i < (b.ocean.count ?? 1); i++) placeTile(ctx, p, 'ocean', 'Place an ocean tile');
  if (b.tile) placeTile(ctx, p, 'special', b.tile.title ? `Place the ${b.tile.title} tile` : 'Place the special tile');
  if (b.titanumValue) p.titaniumValue += b.titanumValue;
  if (b.steelValue) p.steelValue += b.steelValue;
  if (b.greeneryDiscount) p.greeneryCost -= b.greeneryDiscount;
  if (b.drawCard !== undefined) {
    const spec = typeof b.drawCard === 'number' ? {count: b.drawCard} : b.drawCard;
    const n = count(s, p, spec.count, card);
    if (spec.pay) {
      const a = ask(ctx, {kind: 'yesno', title: `Look at the top card. Buy it for ${CARD_BUY_COST} M€?`}, 'yesno');
      if (a.yes) {
        if (p.stock.megacredits < CARD_BUY_COST) throw new RuleError('Not enough M€');
        p.stock.megacredits -= CARD_BUY_COST; p.handSize++;
      }
    } else {
      const keep = spec.keep ?? n;
      p.handSize += keep;
      const filter = spec.tag ? ` until you reveal ${n} with a ${spec.tag} tag` : '';
      ctx.events.push({kind: 'note', player: p.id, text: spec.keep ? `Draw ${n} cards${filter}, keep ${keep}` : `Draw ${n} card${n > 1 ? 's' : ''}${filter}`});
    }
  }
  if (b.raiseLowestProduction) {
    const lowest = Math.min(...RESOURCES.map((r) => p.production[r]));
    const options = RESOURCES.filter((r) => p.production[r] === lowest);
    const r = options.length === 1 ? options[0]
      : ask(ctx, {kind: 'resource', title: 'Increase one of your lowest productions 1 step', options}, 'resource').resource;
    if (!options.includes(r)) throw new RuleError(`${label[r]} production is not one of your lowest`);
    addProduction(p, r, 1);
  }
  if (b.fundAwardFree) {
    if (s.awards.length >= 3) throw new RuleError('All three awards are funded');
    const open = boardOf(s).awards.filter((a) => !s.awards.some((x) => x.name === a.name));
    const a = ask(ctx, {kind: 'or', title: 'Fund an award for free', options: open.map((x) => x.name)}, 'or');
    const award = open[a.index];
    if (!award) throw new RuleError('Invalid choice');
    s.awards.push({name: award.name, fundedBy: p.id});
    ctx.events.push({kind: 'award', player: p.id, name: award.name});
  }
  if (b.playPrelude) {
    const exclude = s.players.flatMap((x) => [...(x.preludes ?? []), ...x.played.map((c) => c.name)]);
    const a = ask(ctx, {kind: 'pickCard', title: 'Draw 3 preludes and play one of them', group: 'prelude', exclude}, 'pickCard');
    const card = findCard(a.card);
    if (!card || card.group !== 'prelude' || !s.modules.includes(card.module)) throw new RuleError(`${a.card} is not a prelude in this game`);
    if (exclude.includes(card.name)) throw new RuleError(`${card.name} is already in play`);
    playPreludeCard(ctx, p, card);
  }
  if (b.playCardNow) {
    p.preludeCardPlay = b.playCardNow;
    ctx.events.push({kind: 'note', player: p.id, text: b.playCardNow});
  }
  if (b.manual) {
    ask(ctx, {kind: 'manual', title: 'Do this by hand', text: b.manual}, 'ack');
    ctx.events.push({kind: 'note', player: p.id, text: b.manual});
  }
}

// ---- triggers --------------------------------------------------------------------------------
type TriggerEvent =
  | {when: 'cardPlayed'; card: CardDef}
  | {when: 'tilePlaced'; tile: TileKind; onMars: boolean; bonusSteelOrTitanium: boolean}
  | {when: 'standardProject'; project: string; cost: number};

function fireTriggers(ctx: Ctx, actor: PlayerState, ev: TriggerEvent) {
  for (const owner of ctx.s.players) {
    for (const c of cardsInPlay(owner)) {
      for (const t of c.triggers) {
        if (!matches(t, owner, actor, ev)) continue;
        const times = t.when === 'cardPlayed' && t.perTag && ev.when === 'cardPlayed' ?
          ev.card.tags.filter((x) => t.tags?.includes(x)).length : 1;
        const behavior = owner.id === actor.id && t.selfBehavior ? t.selfBehavior : t.behavior;
        const prev = ctx.triggerCard;
        ctx.triggerCard = ev.when === 'cardPlayed' ? ev.card.name : undefined;
        for (let i = 0; i < times; i++) run(ctx, owner, behavior, c.name);
        ctx.triggerCard = prev;
        ctx.events.push({kind: 'note', player: owner.id, text: `${c.name}: ${t.text}`});
      }
    }
  }
}

function matches(t: Trigger, owner: PlayerState, actor: PlayerState, ev: TriggerEvent): boolean {
  if (t.when !== ev.when) return false;
  if (t.scope === 'self' && owner.id !== actor.id) return false;
  if (t.scope === 'others' && owner.id === actor.id) return false;
  if (ev.when === 'cardPlayed') {
    if (t.tags && !ev.card.tags.some((x) => t.tags!.includes(x))) return false;
    if (t.cardType && ev.card.type !== t.cardType) return false;
    if (t.minCost !== undefined && (ev.card.cost ?? 0) < t.minCost) return false;
    if (t.hasVictoryPoints) {
      const vp = ev.card.victoryPoints;
      if (vp === null || vp === undefined || (typeof vp === 'number' && vp < 0)) return false;
    }
  }
  if (ev.when === 'tilePlaced') {
    if (t.tile && t.tile !== ev.tile) return false;
    if (t.tileOnMars && !ev.onMars) return false;
    if (t.bonusSteelOrTitanium && !ev.bonusSteelOrTitanium) return false;
  }
  if (ev.when === 'standardProject') {
    if (t.standardProjectExcludes?.includes(ev.project)) return false;
    if (t.minCost !== undefined && ev.cost < t.minCost) return false;
  }
  return true;
}

// ---- preludes --------------------------------------------------------------------------------
/** Put a prelude on the table and resolve it (its triggers fire as for any card played). */
function playPreludeCard(ctx: Ctx, p: PlayerState, card: CardDef) {
  p.played.push({name: card.name, resources: 0, generation: ctx.s.generation});
  p.preludesPlayed = [...(p.preludesPlayed ?? []), card.name];
  ctx.events.push({kind: 'cardPlayed', player: p.id, card: card.name, tags: card.tags, cardType: card.type, cost: 0});
  run(ctx, p, card.behavior, card.name);
  fireTriggers(ctx, p, {when: 'cardPlayed', card});
}

const preludesLeft = (p: PlayerState) => (p.preludes ?? []).filter((c) => !(p.preludesPlayed ?? []).includes(c));

/** After a prelude step: stay with this player while they have preludes (or a card) to play, then move on in turn
 *  order; when everyone is done the first generation's action rounds begin. */
function advancePreludes(ctx: Ctx) {
  const s = ctx.s;
  const cur = s.current ? player(s, s.current) : undefined;
  if (cur && (cur.preludeCardPlay || preludesLeft(cur).length)) return;
  const next = s.order.find((id) => preludesLeft(player(s, id)).length > 0);
  if (next) {
    s.current = next;
    ctx.events.push({kind: 'turn', player: next});
    return;
  }
  startActions(ctx);
}

function startActions(ctx: Ctx) {
  const s = ctx.s;
  s.phase = 'action';
  for (const x of s.players) x.ready = false;
  s.current = s.order[0];
  ctx.events.push({kind: 'turn', player: s.current});
}

// ---- turn flow -------------------------------------------------------------------------------
function requireTurn(s: GameState, p: PlayerState) {
  if (s.phase === 'preludes' && p.preludeCardPlay) {
    if (s.current !== p.id) throw new RuleError(`It is ${nameOf(s, s.current ?? '')}'s turn`);
    return;
  }
  if (s.phase !== 'action') throw new RuleError('Not in the action phase');
  if (s.current !== p.id) throw new RuleError(`It is ${nameOf(s, s.current ?? '')}'s turn`);
}

function tookAction(ctx: Ctx, p: PlayerState) {
  p.turnActions++;
  if (p.turnActions >= 2) nextTurn(ctx);
}

function nextTurn(ctx: Ctx) {
  const s = ctx.s;
  const cur = s.current ? s.players.find((x) => x.id === s.current) : undefined;
  if (cur) cur.turnActions = 0;
  const live = s.order.filter((id) => !player(s, id).passed);
  if (!live.length) return productionPhase(ctx);
  const i = s.current ? s.order.indexOf(s.current) : -1;
  for (let k = 1; k <= s.order.length; k++) {
    const id = s.order[(i + k) % s.order.length];
    if (!player(s, id).passed) { s.current = id; ctx.events.push({kind: 'turn', player: id}); return; }
  }
}

export function gameShouldEnd(s: GameState): boolean {
  return s.global.temperature >= GLOBAL.temperature.max && s.global.oxygen >= GLOBAL.oxygen.max &&
    s.global.oceans >= GLOBAL.oceans.max;
}

function productionPhase(ctx: Ctx) {
  const s = ctx.s;
  s.phase = 'production';
  ctx.events.push({kind: 'production', generation: s.generation});
  for (const p of s.players) {
    p.stock.heat += p.stock.energy;
    p.stock.energy = 0;
    for (const r of RESOURCES) p.stock[r] += p.production[r];
    p.stock.megacredits += p.tr;
    p.usedActions = p.usedActions.filter((a) => a.startsWith('first:'));
    p.passed = false; p.ready = false; p.turnActions = 0;
    p.nextCardDiscount = 0; p.nextCardRequirementBonus = 0;
  }
  s.current = null;
  if (gameShouldEnd(s)) { s.phase = 'finalGreenery'; return; }
  s.generation++;
  s.order = [...s.order.slice(1), s.order[0]];
  s.phase = 'research';
  ctx.events.push({kind: 'generation', generation: s.generation});
}

// ---- apply -----------------------------------------------------------------------------------
export type ApplyResult = {state: GameState; events: GameEvent[]};

export function apply(state: GameState, cmd: Command, answers?: Answer[]): ApplyResult {
  const s = structuredClone(state);
  const ctx: Ctx = {s, answers: answers ?? ('answers' in cmd ? cmd.answers : []), cursor: 0, events: []};
  s.seq++;
  switch (cmd.t) {
  case 'join': {
    if (s.phase !== 'lobby') throw new RuleError('The game has already started');
    if (s.players.some((p) => p.id === cmd.playerId)) break;
    if (s.players.length >= 5) throw new RuleError('The game is full');
    if (cmd.profileId && s.players.some((p) => p.profileId === cmd.profileId)) throw new RuleError('That profile is already at the table');
    s.players.push(newPlayer(cmd.playerId, cmd.name.trim().slice(0, 20) || 'Player', cmd.color));
    if (cmd.profileId) s.players[s.players.length - 1].profileId = cmd.profileId;
    ctx.events.push({kind: 'joined', player: cmd.playerId});
    break;
  }
  case 'addBot': {
    if (s.phase !== 'lobby') throw new RuleError('The game has already started');
    if (!(BOT_LEVELS as readonly string[]).includes(cmd.level)) throw new RuleError('Unknown bot level');
    if (s.players.some((p) => p.id === cmd.botId)) throw new RuleError('That seat is already at the table');
    if (s.players.length >= MAX_SEATS) throw new RuleError('The game is full');
    if (s.players.some((p) => p.color === cmd.color)) throw new RuleError('That colour is taken');
    const name = cmd.name.trim().slice(0, 20) || 'Bot';
    if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new RuleError(`${name} is already at the table`);
    const bot = newPlayer(cmd.botId, name, cmd.color);
    bot.bot = cmd.level;
    s.players.push(bot);
    ctx.events.push({kind: 'joined', player: cmd.botId});
    break;
  }
  case 'claimProfile': {
    const p = player(s, cmd.playerId);
    if (cmd.profileId && s.players.some((x) => x.id !== p.id && x.profileId === cmd.profileId)) throw new RuleError('That profile is already at the table');
    if (cmd.profileId) p.profileId = cmd.profileId; else delete p.profileId;
    break;
  }
  case 'leave':
    if (s.phase !== 'lobby') throw new RuleError('Players cannot leave a running game');
    s.players = s.players.filter((p) => p.id !== cmd.playerId);
    break;
  case 'rename': {
    const p = player(s, cmd.playerId);
    p.name = cmd.name.trim().slice(0, 20) || p.name;
    p.color = cmd.color;
    if (cmd.beginner !== undefined) p.beginner = cmd.beginner;
    break;
  }
  case 'start': {
    if (s.phase !== 'lobby') throw new RuleError('Already started');
    if (s.players.length < 1) throw new RuleError('Nobody has joined');
    if (cmd.mode !== 'full' && s.players.some((p) => p.bot)) throw new RuleError('Bots play full games only: choose Full game, or remove the bots');
    s.modules = [...new Set([...cmd.modules, ...(s.prelude ? ['prelude'] : [])])];
    if (cmd.title) s.title = cmd.title;
    if (cmd.mode === 'full') s.draft = cmd.draft ?? true;
    s.order = cmd.order.filter((id) => s.players.some((p) => p.id === id));
    for (const p of s.players) if (!s.order.includes(p.id)) s.order.push(p.id);
    s.generation = 1;
    s.startedAt = Date.now();
    s.mode = cmd.mode ?? 'companion';
    // The server resolves 'random' before committing, so the log replays to the same board.
    const board = cmd.board ?? (s.boardChoice && s.boardChoice !== 'random' ? s.boardChoice : 'tharsis');
    if (!(BOARD_NAMES as readonly string[]).includes(board)) throw new RuleError(`Unknown board ${board}`);
    s.board = board;
    ctx.events.push({kind: 'board', board, random: s.boardChoice === 'random'});
    if (s.mode === 'full') {
      // The engine service owns the rules from here; the server creates that game and passes the link.
      if (!cmd.link) throw new RuleError('The full game could not be created');
      s.full = cmd.link;
      s.phase = 'full';
    } else s.phase = 'setup';
    ctx.events.push({kind: 'started'});
    break;
  }
  case 'chooseCorp': {
    if (s.phase !== 'setup') throw new RuleError('Corporations are chosen at setup');
    const p = player(s, cmd.playerId);
    if (p.ready) throw new RuleError('Corporation already chosen');
    const corp = getCard(cmd.corporation);
    if (corp.group !== 'corporation') throw new RuleError(`${corp.name} is not a corporation`);
    p.corporation = corp.name;
    const beginner = corp.name === 'Beginner Corporation';
    p.stock.megacredits = corp.startingMegaCredits ?? 0;
    const buy = beginner ? 0 : cmd.cardsKept * CARD_BUY_COST;
    if (buy > p.stock.megacredits) throw new RuleError('Not enough M€ to keep that many cards');
    p.stock.megacredits -= buy;
    p.handSize = beginner ? 0 : cmd.cardsKept;
    if (s.modules.includes('prelude')) {
      const names = [...new Set(cmd.preludes ?? [])];
      if (names.length !== 2) throw new RuleError('Choose the two preludes you keep');
      for (const n of names) {
        const c = findCard(n);
        if (!c || c.group !== 'prelude' || !s.modules.includes(c.module)) throw new RuleError(`${n} is not a prelude in this game`);
        if (s.players.some((x) => x.id !== p.id && x.preludes?.includes(n))) throw new RuleError(`${n} is already kept by another player`);
      }
      p.preludes = names;
      p.preludesPlayed = [];
    }
    run(ctx, p, corp.behavior, corp.name);
    p.ready = true;
    ctx.events.push({kind: 'corp', player: p.id, corporation: corp.name});
    if (s.players.every((x) => x.ready)) {
      if (s.modules.includes('prelude')) {
        // Preludes are played in turn order before the first action round.
        s.phase = 'preludes';
        for (const x of s.players) x.ready = false;
        s.current = null;
        advancePreludes(ctx);
      } else startActions(ctx);
    }
    break;
  }
  case 'playPrelude': {
    if (s.phase !== 'preludes') throw new RuleError('Preludes are played at the start of the game');
    const p = player(s, cmd.playerId);
    if (s.current !== p.id) throw new RuleError(`It is ${nameOf(s, s.current ?? '')}'s turn to play preludes`);
    if (p.preludeCardPlay) throw new RuleError('Play or skip the card your prelude allows first');
    if (!preludesLeft(p).includes(cmd.card)) throw new RuleError(`${cmd.card} is not one of your preludes to play`);
    playPreludeCard(ctx, p, getCard(cmd.card));
    advancePreludes(ctx);
    break;
  }
  case 'skipPreludeCard': {
    const p = player(s, cmd.playerId);
    if (!p.preludeCardPlay) throw new RuleError('There is no card to skip');
    if (s.current !== p.id) throw new RuleError(`It is ${nameOf(s, s.current ?? '')}'s turn`);
    p.preludeCardPlay = null;
    p.nextCardDiscount = 0;
    p.nextCardRequirementBonus = 0;
    ctx.events.push({kind: 'note', player: p.id, text: `${p.name} played no card from hand`});
    if (s.phase === 'preludes') advancePreludes(ctx);
    else tookAction(ctx, p);
    break;
  }
  case 'research': {
    if (s.phase !== 'research') throw new RuleError('Not in the research phase');
    const p = player(s, cmd.playerId);
    if (p.ready) throw new RuleError('Research already done');
    const n = Math.max(0, Math.min(4, Math.floor(cmd.cardsBought)));
    if (n * CARD_BUY_COST > p.stock.megacredits) throw new RuleError('Not enough M€');
    p.stock.megacredits -= n * CARD_BUY_COST;
    p.handSize += n;
    p.ready = true;
    if (s.players.every((x) => x.ready)) {
      s.phase = 'action';
      for (const x of s.players) x.ready = false;
      s.current = s.order[0];
      ctx.events.push({kind: 'turn', player: s.current});
    }
    break;
  }
  case 'playCard': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    const card = getCard(cmd.card);
    if (card.group !== 'project') throw new RuleError(`${card.name} is not a project card`);
    if (p.played.some((c) => c.name === card.name)) throw new RuleError(`${card.name} is already in play`);
    const cost = cardCost(p, card);
    pay(p, cost, cmd.payment, {steel: card.tags.includes('building'), titanium: card.tags.includes('space'), tags: card.tags});
    // one-shot bonuses are consumed by this card (and may be re-armed by its own behavior)
    p.nextCardDiscount = 0;
    p.nextCardRequirementBonus = 0;
    p.handSize = Math.max(0, p.handSize - 1);
    p.played.push({name: card.name, resources: 0, generation: s.generation});
    ctx.events.push({kind: 'cardPlayed', player: p.id, card: card.name, tags: card.tags, cardType: card.type, cost});
    const fromPrelude = !!p.preludeCardPlay;
    p.preludeCardPlay = null;
    run(ctx, p, card.behavior, card.name);
    fireTriggers(ctx, p, {when: 'cardPlayed', card});
    // A card played through a prelude is part of that prelude, not an action of its own.
    if (s.phase === 'preludes' && fromPrelude) advancePreludes(ctx);
    else tookAction(ctx, p);
    break;
  }
  case 'action': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    const card = getCard(cmd.card);
    const isFirst = card.group === 'corporation' && card.firstAction && !p.usedActions.includes('first:' + card.name);
    if (!isFirst) {
      if (!card.action) throw new RuleError(`${card.name} has no action`);
      if (card.name !== p.corporation && !p.played.some((c) => c.name === card.name)) throw new RuleError(`${card.name} is not in play`);
      if (p.usedActions.includes(card.name)) throw new RuleError(`${card.name} was already used this generation`);
      p.usedActions.push(card.name);
    } else p.usedActions.push('first:' + card.name);
    ctx.events.push({kind: 'action', player: p.id, card: card.name});
    let beh = isFirst ? card.firstAction : card.action;
    // An M€ cost on an action goes through normal payment (steel/titanium where allowed, Helion's heat).
    const mc = beh?.spend?.megacredits;
    if (beh && beh.spend && mc) {
      if (beh.requires === 'trRaisedThisGeneration' && p.trRaisedGeneration !== s.generation) {
        throw new RuleError('Your terraform rating has not gone up this generation');
      }
      const given = cmd.payment && Object.values(cmd.payment).some((v) => v) ? cmd.payment : {megacredits: mc};
      pay(p, mc, given, {steel: !!beh.spend.canUseSteel, titanium: !!beh.spend.canUseTitanium});
      beh = {...beh, spend: {...beh.spend, megacredits: 0}};
    }
    run(ctx, p, beh, card.name);
    // Valley Trust's prelude may allow a card from hand: the action finishes when that card is played or skipped.
    if (!p.preludeCardPlay) tookAction(ctx, p);
    break;
  }
  case 'standardProject': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    const sp = STANDARD_PROJECTS.find((x) => x.id === cmd.project);
    if (!sp) throw new RuleError('Unknown standard project');
    if (sp.id === 'sellPatents') {
      const a = ask(ctx, {kind: 'amount', title: 'How many cards do you sell?', min: 1, max: Math.max(1, p.handSize)}, 'amount');
      p.handSize = Math.max(0, p.handSize - a.value);
      p.stock.megacredits += a.value;
    } else {
      pay(p, standardProjectCost(p, sp.id), cmd.payment, {steel: false, titanium: false});
      run(ctx, p, sp.behavior);
    }
    ctx.events.push({kind: 'standardProject', player: p.id, project: sp.name});
    fireTriggers(ctx, p, {when: 'standardProject', project: sp.id, cost: sp.cost});
    tookAction(ctx, p);
    break;
  }
  case 'convertPlants': {
    const p = player(s, cmd.playerId);
    if (s.phase !== 'finalGreenery') requireTurn(s, p);
    if (p.stock.plants < p.greeneryCost) throw new RuleError(`Needs ${p.greeneryCost} plants`);
    p.stock.plants -= p.greeneryCost;
    placeTile(ctx, p, 'greenery', 'Place a greenery tile');
    if (s.phase === 'action') tookAction(ctx, p);
    break;
  }
  case 'convertHeat': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    if (s.global.temperature >= GLOBAL.temperature.max) throw new RuleError('Temperature is at its maximum');
    if (p.stock.heat < HEAT_PER_TEMPERATURE) throw new RuleError(`Needs ${HEAT_PER_TEMPERATURE} heat`);
    p.stock.heat -= HEAT_PER_TEMPERATURE;
    raiseGlobal(ctx, p, 'temperature', 1);
    tookAction(ctx, p);
    break;
  }
  case 'claimMilestone': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    if (s.milestones.length >= 3) throw new RuleError('All three milestones are claimed');
    if (s.milestones.some((m) => m.name === cmd.milestone)) throw new RuleError('Already claimed');
    const m = boardOf(s).milestones.find((x) => x.name === cmd.milestone);
    if (!m) throw new RuleError(`${cmd.milestone} is not a milestone on ${boardOf(s).title}`);
    // Standings the companion engine cannot see (hand size, tile positions) are claimed on trust.
    const v = m.value(p, STANDING_HELPERS);
    if (m.goal !== undefined && !m.manual && v !== null && v < m.goal) throw new RuleError(`${m.name} needs: ${m.text}`);
    if (p.stock.megacredits < MILESTONE_COST) throw new RuleError('Not enough M€');
    p.stock.megacredits -= MILESTONE_COST;
    s.milestones.push({name: m.name, claimedBy: p.id});
    p.milestones.push(m.name);
    ctx.events.push({kind: 'milestone', player: p.id, name: m.name});
    tookAction(ctx, p);
    break;
  }
  case 'fundAward': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    if (s.awards.length >= 3) throw new RuleError('All three awards are funded');
    if (s.awards.some((a) => a.name === cmd.award)) throw new RuleError('Already funded');
    if (!boardOf(s).awards.some((a) => a.name === cmd.award)) throw new RuleError(`${cmd.award} is not an award on ${boardOf(s).title}`);
    const cost = AWARD_COSTS[s.awards.length];
    if (p.stock.megacredits < cost) throw new RuleError('Not enough M€');
    p.stock.megacredits -= cost;
    s.awards.push({name: cmd.award, fundedBy: p.id});
    ctx.events.push({kind: 'award', player: p.id, name: cmd.award});
    tookAction(ctx, p);
    break;
  }
  case 'endTurn': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    if (p.preludeCardPlay) throw new RuleError('Play or skip the card your prelude allows first');
    if (p.turnActions < 1) throw new RuleError('Take an action or pass');
    nextTurn(ctx);
    break;
  }
  case 'pass': {
    const p = player(s, cmd.playerId);
    requireTurn(s, p);
    if (p.preludeCardPlay) throw new RuleError('Play or skip the card your prelude allows first');
    p.passed = true;
    ctx.events.push({kind: 'pass', player: p.id});
    nextTurn(ctx);
    break;
  }
  case 'adjust': {
    const t = player(s, cmd.target);
    for (const r of RESOURCES) {
      if (cmd.stock?.[r]) t.stock[r] = Math.max(0, t.stock[r] + cmd.stock[r]!);
      if (cmd.production?.[r]) t.production[r] = Math.max(MIN_PRODUCTION[r], t.production[r] + cmd.production[r]!);
    }
    if (cmd.tr) t.tr += cmd.tr;
    if (cmd.handSize) t.handSize = Math.max(0, t.handSize + cmd.handSize);
    if (cmd.cardResources) {
      const pc = t.played.find((c) => c.name === cmd.cardResources!.card);
      if (pc) pc.resources = Math.max(0, pc.resources + cmd.cardResources.delta);
    }
    if (cmd.note) ctx.events.push({kind: 'note', player: cmd.playerId, text: cmd.note});
    break;
  }
  case 'setGlobal': {
    const g = GLOBAL[cmd.param];
    const v = Math.max(g.min, Math.min(g.max, cmd.value));
    const from = s.global[cmd.param];
    s.global[cmd.param] = v;
    ctx.events.push({kind: 'global', player: null, param: cmd.param, from, to: v});
    break;
  }
  case 'boardVP': {
    const p = player(s, cmd.playerId);
    p.boardVP = {cityAdjacency: cmd.cityAdjacency, other: cmd.other};
    if (cmd.manual) {
      const known = new Set([...boardOf(s).milestones, ...boardOf(s).awards].filter((x) => x.positional).map((x) => x.name));
      for (const [name, n] of Object.entries(cmd.manual)) {
        if (!known.has(name)) throw new RuleError(`${name} is counted automatically`);
        p.manualScores = {...p.manualScores, [name]: Math.max(0, Math.min(99, Math.floor(n)))};
      }
    }
    break;
  }
  case 'setPrelude': {
    if (s.phase !== 'lobby') throw new RuleError('Prelude is chosen before the game starts');
    s.prelude = !!cmd.on;
    break;
  }
  case 'setTurnClock': {
    // Any time: the clock is a nudge, so a table can turn it on mid-game when someone is slow.
    if (!isTurnClockSetting(cmd.clock)) throw new RuleError('Unknown turn clock');
    s.turnClock = cmd.clock;
    break;
  }
  case 'setBotSpeed': {
    // Any time: a table that finds the bots too quick (or too slow) changes it mid-game.
    if (!isBotSpeed(cmd.speed)) throw new RuleError('Unknown bot speed');
    s.botSpeed = cmd.speed;
    break;
  }
  case 'setFastMode': {
    // The engine fixes fast mode when it creates the game.
    if (s.phase !== 'lobby') throw new RuleError('Fast mode is chosen before the game starts');
    s.fastMode = !!cmd.on;
    break;
  }
  case 'setBoard': {
    if (s.phase !== 'lobby') throw new RuleError('The map is chosen before the game starts');
    if (cmd.board !== 'random' && !(BOARD_NAMES as readonly string[]).includes(cmd.board)) throw new RuleError('Unknown map');
    s.boardChoice = cmd.board;
    break;
  }
  case 'narrator': {
    if (!isNarratorMode(cmd.mode)) throw new RuleError('Unknown mission control setting');
    s.narrator = cmd.mode;
    ctx.events.push({kind: 'narrator', player: s.players.some((p) => p.id === cmd.playerId) ? cmd.playerId : null, mode: cmd.mode});
    break;
  }
  case 'posterArt': {
    s.posterUnique = !!cmd.unique;
    break;
  }
  case 'endGame': {
    if (s.phase === 'lobby') throw new RuleError('The game has not started');
    s.phase = 'ended';
    s.endedAt = Date.now();
    ctx.events.push({kind: 'ended'});
    break;
  }
  }
  return {state: s, events: ctx.events};
}

/** Dry-run a command: returns the next question, an error, or the resulting state. */
export type Preview =
  | {ok: true; state: GameState; events: GameEvent[]}
  | {ok: false; prompt: Prompt}
  | {ok: false; error: string};

export function preview(state: GameState, cmd: Command): Preview {
  try {
    const r = apply(state, cmd);
    return {ok: true, ...r};
  } catch (e) {
    if (e instanceof NeedsInput) return {ok: false, prompt: e.prompt};
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}

// ---- scoring ---------------------------------------------------------------------------------
export type Score = {tr: number; milestones: number; awards: number; greenery: number; cities: number; cards: number; other: number; total: number};

export function cardVP(s: GameState, p: PlayerState, c: CardDef): number {
  const vp = c.victoryPoints;
  if (vp === null || vp === 'special') return 0;
  if (typeof vp === 'number') return vp;
  const here = p.played.find((x) => x.name === c.name)?.resources ?? 0;
  if (vp.resourcesHere && vp.ifAny !== undefined) return here > 0 ? vp.ifAny : 0;
  if (vp.resourcesHere) return vp.each ? here * vp.each : Math.floor(here / (vp.per ?? 1));
  if (vp.tag) return Math.floor(tagCount(p, vp.tag) / (vp.per ?? 1));
  if (vp.cities) return Math.floor(s.players.reduce((a, x) => a + (vp.all || x.id === p.id ? x.tiles.cityOnMars + x.tiles.cityOffMars : 0), 0) / (vp.per ?? 1));
  return 0;
}

export function awardPlaces(s: GameState, award: string): Array<{player: string; value: number; place: 1 | 2 | null}> {
  const a = boardOf(s).awards.find((x) => x.name === award);
  if (!a) return [];
  const rows = s.players.map((p) => ({player: p.id, value: standingValue(p, a)})).sort((x, y) => y.value - x.value);
  const top = rows[0]?.value;
  const firsts = rows.filter((r) => r.value === top);
  const second = firsts.length === 1 ? rows.find((r) => r.value < top)?.value : undefined;
  return rows.map((r) => ({...r, place: r.value === top ? 1 : second !== undefined && r.value === second && s.players.length > 2 ? 2 : null}));
}

export function score(s: GameState, p: PlayerState): Score {
  const milestones = p.milestones.length * 5;
  let awards = 0;
  for (const a of s.awards) {
    const place = awardPlaces(s, a.name).find((r) => r.player === p.id)?.place;
    awards += place === 1 ? 5 : place === 2 ? 2 : 0;
  }
  const cards = cardsInPlay(p).reduce((a, c) => a + cardVP(s, p, c), 0);
  const greenery = p.tiles.greenery;
  const cities = p.boardVP?.cityAdjacency ?? 0;
  const other = p.boardVP?.other ?? 0;
  return {tr: p.tr, milestones, awards, greenery, cities, cards, other,
    total: p.tr + milestones + awards + greenery + cities + cards + other};
}
