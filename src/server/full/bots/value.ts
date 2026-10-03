// How much a bot thinks things are worth, in M€. Rough on purpose: a card's printed effects (src/shared/data, the
// engine's own card data) are valued by how many generations are left to enjoy them, so production counts early,
// victory points and terraforming count late, and a card that can no longer be played is worth nothing.
import {findCard} from '../../../shared/cards';
import {TILE} from '../../../shared/full';
import type {GameModel, PlayerViewModel, PublicPlayerModel} from '../../../shared/full';
import type {Behavior, CardDef, Countable, Requirement, Resource, Tag} from '../../../shared/types';

/** Global steps left before Mars is terraformed: temperature (2 °C a step), oxygen, oceans. */
export function stepsLeft(g: Pick<GameModel, 'temperature' | 'oxygenLevel' | 'oceans'>): {temperature: number; oxygen: number; oceans: number; total: number} {
  const temperature = Math.max(0, Math.ceil((8 - g.temperature) / 2));
  const oxygen = Math.max(0, 14 - g.oxygenLevel);
  const oceans = Math.max(0, 9 - g.oceans);
  return {temperature, oxygen, oceans, total: temperature + oxygen + oceans};
}

/** Generations still to be played, this one included (an estimate in multiplayer; exact in solo). */
export function generationsLeft(model: Pick<PlayerViewModel, 'game' | 'players'>): number {
  const g = model.game;
  if (model.players.length === 1) return Math.max(1, (g.lastSoloGeneration ?? 14) - g.generation + 1);
  const left = stepsLeft(g).total;
  if (left === 0) return 1;
  const done = 42 - left;
  // Tables speed up as engines grow: never assume fewer steps a generation than this floor.
  const pace = Math.max(3 + model.players.length * 1.2, done / Math.max(1, g.generation - 1));
  return Math.max(1, Math.min(14, Math.ceil(left / pace)));
}

/**
 * Normal v3's estimate of the generations still to be played, this one included. v2 assumed a pace of at least
 * 3 + 1.2 global steps a generation per player, so at a three-player table it expected about seven generations when
 * the game lasts eleven to thirteen, and production looked half as valuable as it is. v3 uses a fit of the remaining
 * generations on the steps left and the generation (bench games, tools/judge/bench.ts: RMSE 3.2 / 1.9 / 0.7
 * generations at 2 / 3 / 4 players, against v2's 4.8 / 2.9 / 2.0), capped by the table's own pace so far, which only
 * grows (a fast table of people ends sooner than bots).
 */
export function generationsLeftV3(model: Pick<PlayerViewModel, 'game' | 'players'>): number {
  const g = model.game;
  if (model.players.length === 1) return Math.max(1, (g.lastSoloGeneration ?? 14) - g.generation + 1);
  const left = stepsLeft(g).total;
  if (left === 0) return 1;
  const [a, b, c] = GENS_FIT[Math.min(4, Math.max(2, model.players.length))];
  let est = a + b * left + c * g.generation;
  const played = g.generation - 1;
  if (played >= 2 && left < 42) est = Math.min(est, left / ((42 - left) / played));
  est = Math.max(est, left / 9);
  return Math.max(1, Math.min(16, Math.round(est)));
}

/** Remaining generations ≈ a + b × steps left + c × generation, by table size (5 players use the 4-player fit). */
export const GENS_FIT: Record<number, [number, number, number]> = {2: [7.8, 0.151, -0.37], 3: [8.75, 0.076, -0.626], 4: [9.0, 0.037, -0.83]};

/** What one unit of a standard resource is worth to have now (M€). */
export function unitValue(r: Resource | string, g: Pick<GameModel, 'temperature' | 'oxygenLevel' | 'oceans'>): number {
  switch (r) {
  case 'megacredits': return 1;
  case 'steel': return 1.7;
  case 'titanium': return 2.7;
  case 'plants': return g.oxygenLevel >= 14 ? 1.1 : 1.6;
  case 'energy': return 1.1;
  case 'heat': return g.temperature >= 8 ? 0.15 : 0.85;
  default: return 1;
  }
}

/** Production is worth a little more per unit than stock of the same thing (steady supply, milestones, awards). */
const PROD_BONUS: Record<string, number> = {megacredits: 1, steel: 1.05, titanium: 1.05, plants: 1.05, energy: 1.25, heat: 1};

export type Ctx = {
  model: PlayerViewModel;
  me: PublicPlayerModel;
  gens: number;
  /** what one victory point is worth now in M€ */
  vp: number;
  /** what one terraform step (1 TR) is worth now in M€ */
  tr: number;
  tags: Record<string, number>;
  solo: boolean;
  /** Normal without the endgame rules (kept only to measure the rules against). */
  v1: boolean;
  /** this looks like the last generation (the endgame rules apply; never set for v1) */
  lastGen: boolean;
  /** Normal v3: research, card values and standard projects of a competent player. Off for v1, v2
   *  and Easy. */
  v3: boolean;
};

export function context(model: PlayerViewModel, opts: {v1?: boolean; v2?: boolean} = {}): Ctx {
  const v1 = !!opts.v1;
  const v3 = !v1 && !opts.v2;
  const gens = v3 ? generationsLeftV3(model) : generationsLeft(model);
  const me = model.thisPlayer;
  return withGens({model, me, gens, vp: 0, tr: 0, tags: tagMap(me), solo: model.players.length === 1, v1, lastGen: false, v3}, gens);
}

/** The same context with another number of generations left (v3 values a card that waits on a requirement as of
 *  the generation it becomes playable). */
export function withGens(ctx: Ctx, gens: number): Ctx {
  // Victory points matter more as the end nears; TR also pays 1 M€ every remaining generation.
  const vp = (gens <= 1 ? 7 : gens <= 3 ? 6 : gens <= 6 ? 5 : 4) + (ctx.v3 && gens > 1 ? V3.vpPlus : 0);
  return {...ctx, gens, vp, tr: vp + Math.max(0, gens - 1), lastGen: !ctx.v1 && gens <= 1};
}

/**
 * What one unit of a resource is worth to this player now. In the last generation steel and titanium buy only the
 * building or space cards still in hand: with none, a metal bonus is worth next to nothing.
 */
export function stockValue(r: Resource | string, ctx: Ctx): number {
  const g = ctx.model.game;
  if (ctx.lastGen && (r === 'steel' || r === 'titanium') && !handUses(r, ctx)) return 0.2;
  return unitValue(r, g);
}

/** Does a card in hand take this metal as payment (building cards steel, space cards titanium)? */
export function handUses(r: 'steel' | 'titanium', ctx: Ctx): boolean {
  const tag = r === 'steel' ? 'building' : 'space';
  return ctx.model.cardsInHand.some((c) => findCard(c.name)?.tags.includes(tag as Tag));
}

export function tagMap(p: PublicPlayerModel): Record<string, number> {
  if (Array.isArray(p.tags)) return Object.fromEntries(p.tags.map((t) => [t.tag, t.count]));
  return {...p.tags};
}

export function countOf(c: Countable | undefined, ctx: Ctx, self?: CardDef): number {
  if (c === undefined) return 0;
  if (typeof c === 'number') return c;
  let n = 1;
  if (c.tag) {
    const tags = Array.isArray(c.tag) ? c.tag : [c.tag];
    n = tags.reduce((a, t) => a + (ctx.tags[t] ?? 0), 0) + (self && tags.some((t) => self.tags.includes(t as Tag)) ? 1 : 0);
    if (c.all || c.others) n += c.others ? 1 : 2;
  } else if (c.cities) {
    n = c.all ? 3 : Math.max(1, ctx.me.citiesCount);
  } else if (c.greeneries || c.oceans) {
    n = 2;
  }
  if (c.per) n = Math.floor(n / c.per);
  if (c.each) n *= c.each;
  return n;
}

/** The worth of a one-off effect (a card's behavior or an action), in M€. */
export function behaviorValue(b: Behavior | null | undefined, ctx: Ctx, self?: CardDef): number {
  if (!b) return 0;
  const g = ctx.model.game;
  const left = stepsLeft(g);
  const payouts = Math.max(0, ctx.gens - 0.4);
  let v = 0;
  if (b.production) {
    for (const [r, c] of Object.entries(b.production)) {
      v += countOf(c, ctx, self) * (ctx.v3 ? V3.prodScale * prodValueV3(r, ctx) * Math.min(payouts, heatPayouts(r, ctx, payouts)) : unitValue(r, g) * (PROD_BONUS[r] ?? 1) * payouts);
    }
  }
  if (b.stock) for (const [r, c] of Object.entries(b.stock)) v += countOf(c, ctx, self) * stockValue(r, ctx);
  if (b.spend) {
    for (const [r, n] of Object.entries(b.spend)) {
      if (typeof n === 'number' && r !== 'resourcesHere' && r !== 'cards') v -= n * stockValue(r, ctx);
      if (r === 'resourcesHere' && typeof n === 'number') v -= n * 1.5;
      if (r === 'cards' && typeof n === 'number') v -= n * 2.5;
    }
  }
  if (b.tr !== undefined) v += countOf(b.tr, ctx, self) * ctx.tr;
  if (b.global) {
    if (b.global.temperature) v += Math.min(left.temperature, b.global.temperature) * ctx.tr;
    if (b.global.oxygen) v += Math.min(left.oxygen, b.global.oxygen) * ctx.tr;
  }
  if (b.ocean) v += Math.min(left.oceans, b.ocean.count ?? 1) * (ctx.tr + 2);
  if (b.greenery) v += (left.oxygen > 0 ? ctx.tr : 0) + ctx.vp + 2;
  if (b.city) v += cityValue(ctx);
  if (b.tile) v += 3;
  if (b.drawCard !== undefined) {
    const d = b.drawCard;
    // A card drawn in the last generation rarely gets played before the end.
    const each = ctx.lastGen ? 0.5 : ctx.v3 ? V3.drawEach : 3.5;
    v += typeof d === 'number' ? d * each : (d.keep ?? countOf(d.count, ctx, self)) * each;
  }
  if (b.standardResource !== undefined) v += (typeof b.standardResource === 'number' ? b.standardResource : b.standardResource.count) * 1.6;
  if (b.addResources !== undefined) v += countOf(b.addResources, ctx, self) * resourceWorth(self, ctx);
  if (b.addResourcesToAnyCard) {
    const list = Array.isArray(b.addResourcesToAnyCard) ? b.addResourcesToAnyCard : [b.addResourcesToAnyCard];
    for (const a of list) v += countOf(a.count, ctx, self) * 1.5;
  }
  // Attacks hurt a rival: worth a little at a busy table, nothing alone.
  const rivals = ctx.model.players.length - 1;
  if (rivals > 0) {
    if (b.decreaseAnyProduction) v += b.decreaseAnyProduction.count * 1.2;
    if (b.removeAnyPlants) v += Math.min(b.removeAnyPlants, 4) * 0.6;
    if (b.removeAnyStock) v += b.removeAnyStock.count * 0.4;
    if (b.steal) v += b.steal.count * stockValue(b.steal.type, ctx);
  }
  if (b.or?.behaviors.length) v += Math.max(...b.or.behaviors.map((x) => behaviorValue(x, ctx, self)));
  if (b.conditional) v += Math.max(behaviorValue(b.conditional.then, ctx, self) * 0.7, behaviorValue(b.conditional.else, ctx, self));
  if (b.steelValue) v += b.steelValue * (ctx.me.steelProduction + 1) * payouts * 0.6;
  if (b.titanumValue) v += b.titanumValue * (ctx.me.titaniumProduction + 1) * payouts * 0.8;
  if (b.greeneryDiscount) v += b.greeneryDiscount * Math.min(3, payouts) * 1.2;
  if (b.copyProductionBox) v += 3 * payouts;
  if (b.nextCardDiscount) v += b.nextCardDiscount * 0.6;
  if (b.exchangeProduction) v += 2;
  return v;
}

function cityValue(ctx: Ctx): number {
  // A city scores a point per neighbouring greenery at the end and is the anchor for greeneries of your own.
  return 3 + Math.min(ctx.gens, 5) * 1.2 + (ctx.gens <= 3 ? ctx.vp : 0);
}

/** What one resource on this card is worth (animals and microbes that score points are worth their share). */
function resourceWorth(def: CardDef | undefined, ctx: Ctx): number {
  const vp = def?.victoryPoints;
  if (vp && typeof vp === 'object' && vp.resourcesHere) {
    if (vp.ifAny) return ctx.vp * 0.8;
    if (vp.each) return vp.each * ctx.vp;
    return ctx.vp / (vp.per ?? 1);
  }
  return 1;
}

/** Points printed on the card, as M€ (resource points include what its action is expected to add). */
function pointsValue(def: CardDef, ctx: Ctx, uses?: number): number {
  const vp = def.victoryPoints;
  if (vp === null || vp === undefined) return 0;
  if (typeof vp === 'number') return vp * ctx.vp;
  if (vp === 'special') return 1.5 * ctx.vp;
  if (vp.resourcesHere) {
    const perGen = def.action?.addResources !== undefined ? countOf(def.action.addResources, ctx, def) : 0;
    const expected = perGen * (uses ?? Math.max(0, ctx.gens - 0.5)) + (def.behavior?.addResources !== undefined ? countOf(def.behavior.addResources, ctx, def) : 0);
    return Math.max(expected > 0 ? 1 : 0.4, expected) * resourceWorth(def, ctx) * 0.9;
  }
  if (vp.tag) return ((ctx.tags[vp.tag] ?? 0) + 1 + Math.min(2, ctx.gens / 3)) / (vp.per ?? 1) * ctx.vp;
  if (vp.cities) return (vp.all ? 2.5 : Math.max(1, ctx.me.citiesCount)) / (vp.per ?? 1) * ctx.vp;
  return ctx.vp;
}

/** The worth of having this card in play (its effect now, its points, its action and lasting effects), before paying for it. */
export function cardValue(def: CardDef, ctx: Ctx): number {
  if (ctx.v3) return cardValueV3(def, ctx);
  let v = behaviorValue(def.behavior, ctx, def) + pointsValue(def, ctx);
  if (def.action) v += Math.max(0, behaviorValue(def.action, ctx, def)) * Math.max(0, ctx.gens - 0.7) * 0.7 + 0.5;
  for (const d of def.cardDiscount ?? []) v += d.amount * Math.min(ctx.gens, 6) * (d.tag ? 0.7 : 1.4);
  if (def.triggers?.length) v += def.triggers.length * Math.min(ctx.gens, 6) * 0.9;
  if (def.requirementBonus) v += Math.min(ctx.gens, 5) * 0.8;
  // Tags feed milestones, awards and requirements; science and Jovian tags pay off most often.
  if (def.type !== 'event') for (const t of def.tags) v += t === 'science' || t === 'jovian' ? 1.2 : 0.5;
  return v;
}

/**
 * How likely the card is to become playable before the game ends (1 = now or soon, 0 = never), from its global,
 * tag and production requirements.
 */
export function playableOdds(def: CardDef, ctx: Ctx): number {
  if (ctx.v3) return readiness(def, ctx).odds;
  const g = ctx.model.game;
  let odds = 1;
  const reqs: Requirement[] = def.requirements ?? [];
  const pacePerGen = Math.max(1, stepsLeft(g).total / Math.max(1, ctx.gens));
  for (const r of reqs) {
    const param = r.temperature !== undefined ? 'temperature' : r.oxygen !== undefined ? 'oxygen' : r.oceans !== undefined ? 'oceans' : r.venus !== undefined ? 'venus' : null;
    if (param === 'venus') return 0;
    if (param) {
      const have = param === 'temperature' ? g.temperature : param === 'oxygen' ? g.oxygenLevel : g.oceans;
      const want = r[param]!;
      const scale = param === 'temperature' ? 2 : 1;
      if (r.max) { if (have > want) return 0; continue; }
      if (have >= want) continue;
      // each global is a third of the work: it moves about a third of the table's pace
      const gensNeeded = (want - have) / scale / Math.max(0.6, pacePerGen / 3);
      if (gensNeeded >= ctx.gens) return 0.05;
      odds *= 1 - gensNeeded / (ctx.gens + 1);
      continue;
    }
    if (r.tag) {
      const have = (ctx.tags[r.tag] ?? 0) + (r.tag !== 'wild' ? ctx.tags.wild ?? 0 : 0);
      const need = r.count ?? 1;
      if (r.max) { if (have > need) return 0; continue; }
      if (have < need) odds *= need - have > 2 ? 0.15 : 0.5;
      continue;
    }
    if (r.production) {
      const p = productionOf(ctx.me, r.production);
      if (p < (r.count ?? 1)) odds *= 0.5;
      continue;
    }
    if (r.cities !== undefined || r.greeneries !== undefined) { odds *= 0.7; continue; }
    if (r.tr !== undefined && ctx.me.terraformRating < (r.count ?? r.tr)) odds *= 0.6;
  }
  return odds;
}

export function productionOf(p: PublicPlayerModel, r: Resource | string): number {
  switch (r) {
  case 'megacredits': return p.megacreditProduction;
  case 'steel': return p.steelProduction;
  case 'titanium': return p.titaniumProduction;
  case 'plants': return p.plantProduction;
  case 'energy': return p.energyProduction;
  case 'heat': return p.heatProduction;
  default: return 0;
  }
}

/** The worth of keeping a card in hand to play later: its value when played, minus its cost, times its odds. */
export function handValue(name: string, cost: number | undefined, ctx: Ctx): number {
  const def = findCard(name);
  if (!def) return 0;
  const price = cost ?? def.cost ?? 0;
  if (ctx.v3) {
    const {odds, delay} = readiness(def, ctx);
    if (odds <= 0) return Math.min(0, -price * 0.1);
    // A card that waits for a requirement is played later: its production pays fewer times.
    const later = delay >= 0.5 ? withGens(ctx, Math.max(1, ctx.gens - Math.round(delay))) : ctx;
    return (cardValueV3(def, later) - price) * odds;
  }
  return (cardValue(def, ctx) - price) * playableOdds(def, ctx);
}

// ---- Normal v3 ---------------------------------------------------------------------------------

/** v3's tuning (chosen on the bench's development seeds). */
export const V3 = {
  /** research: the gain a card must reach with more than four, three or four, and two or fewer generations left */
  buyEarly: 0.5, buyMid: 2.5, buyLate: 5,
  /** the shadow price of a M€: bounds and how fast it falls with spare money (in generations of income) */
  kMin: 0.75, kMax: 1.15, kSlope: 0.25,
  /** a card in hand is played while its value beats its price at the shadow price by more than this */
  playFloor: -3,
  /** mid-game standard projects: M€ kept for next generation's research, and the least value per M€ */
  idleKeep: 9, idleRatio: 0.65,
  /** valuation: production scale, victory points added to the M€ worth of a point, worth of a drawn card */
  prodScale: 1, vpPlus: 0, drawEach: 3.5,
};


/** v3: one unit of production for one generation. Energy that nothing uses only turns into heat (cards that need
 *  energy add their own bonus, cardValueV3). */
export function prodValueV3(r: Resource | string, ctx: Ctx): number {
  const g = ctx.model.game;
  if (r === 'energy') return 0.95;
  return unitValue(r, g) * (PROD_BONUS[r] ?? 1);
}

/** v3: heat (and energy, which becomes heat) produces TR only until the temperature is maxed; after that it is
 *  worth next to nothing. Payouts are capped at the generations the temperature is likely to take, plus one. */
function heatPayouts(r: string, ctx: Ctx, payouts: number): number {
  if (r !== 'heat' && r !== 'energy') return payouts;
  const left = stepsLeft(ctx.model.game);
  if (!left.total) return 0;
  // the globals move together; temperature with a smaller share of the steps left is maxed sooner
  const tempGens = ctx.gens * Math.min(1, 3 * left.temperature / left.total);
  const capped = Math.min(payouts, tempGens + 1);
  // energy keeps some worth for actions and cards that use it
  return r === 'energy' ? Math.max(capped, payouts * 0.4) : capped;
}

/**
 * v3: how likely the card is to become playable (odds) and how many generations it is likely to wait (delay).
 * Beyond v2's global and tag requirements it checks what the card takes away: a card that lowers energy (or plant,
 * heat, steel, titanium) production needs that much production first, and M€ production may not drop below -5.
 * v2 missed these, so its hand filled with cards like Strip Mine and Fuel Factory it could never play, the hand cap
 * stopped research, and its money piled up.
 */
export function readiness(def: CardDef, ctx: Ctx): {odds: number; delay: number} {
  const g = ctx.model.game;
  let odds = 1;
  let delay = 0;
  const reqs: Requirement[] = def.requirements ?? [];
  const left = stepsLeft(g);
  const pacePerGen = Math.max(1, left.total / Math.max(1, ctx.gens));
  const bonus = ctx.me.tableau?.some((c) => findCard(c.name)?.requirementBonus) ? 2 : 0;
  for (const r of reqs) {
    const param = r.temperature !== undefined ? 'temperature' : r.oxygen !== undefined ? 'oxygen' : r.oceans !== undefined ? 'oceans' : r.venus !== undefined ? 'venus' : null;
    if (param === 'venus') return {odds: 0, delay: 0};
    if (param) {
      const have = param === 'temperature' ? g.temperature : param === 'oxygen' ? g.oxygenLevel : g.oceans;
      const scale = param === 'temperature' ? 2 : 1;
      const want = r[param]!;
      if (r.max) {
        if (have > want + bonus * scale) return {odds: 0, delay: 0};
        // A maximum soon passed: playable now, but only for a short while.
        const room = (want + bonus * scale - have) / scale;
        if (room < pacePerGen / 3) odds *= 0.6;
        continue;
      }
      if (have + bonus * scale >= want) continue;
      const gensNeeded = (want - bonus * scale - have) / scale / Math.max(0.6, pacePerGen / 3);
      if (gensNeeded >= ctx.gens - 0.5) return {odds: 0.03, delay: ctx.gens};
      odds *= 1 - gensNeeded / (ctx.gens + 1);
      delay = Math.max(delay, gensNeeded);
      continue;
    }
    if (r.tag) {
      const have = (ctx.tags[r.tag] ?? 0) + (r.tag !== 'wild' ? ctx.tags.wild ?? 0 : 0);
      const need = r.count ?? 1;
      if (r.max) { if (have > need) return {odds: 0, delay: 0}; continue; }
      const missing = need - have;
      if (missing > 0) {
        // tags of the same kind in hand make the requirement likelier
        const inHand = ctx.model.cardsInHand.filter((c) => c.name !== def.name && findCard(c.name)?.tags.includes(r.tag!)).length;
        odds *= Math.min(0.9, (missing === 1 ? 0.5 : missing === 2 ? 0.25 : 0.08) + inHand * 0.15);
        delay = Math.max(delay, missing * 1.5);
      }
      continue;
    }
    if (r.production) {
      const missing = (r.count ?? 1) - productionOf(ctx.me, r.production);
      if (missing > 0) { odds *= missing === 1 ? 0.5 : 0.25; delay = Math.max(delay, 1.5 * missing); }
      continue;
    }
    if (r.cities !== undefined) {
      if (ctx.me.citiesCount < (r.count ?? r.cities)) { odds *= 0.6; delay = Math.max(delay, 1.5); }
      continue;
    }
    if (r.greeneries !== undefined) { odds *= 0.7; delay = Math.max(delay, 1); continue; }
    if (r.tr !== undefined && ctx.me.terraformRating < (r.count ?? r.tr)) { odds *= 0.6; delay = Math.max(delay, 2); }
  }
  // A tile that must go next to a city needs a city on Mars.
  if (def.behavior?.tile?.on === 'next to a city' && !g.spaces.some((x) => x.tileType === TILE.CITY || x.tileType === TILE.CAPITAL)) { odds *= 0.6; delay = Math.max(delay, 1); }
  // What the card takes away must be there to take.
  for (const [res, c] of Object.entries(def.behavior?.production ?? {})) {
    if (typeof c !== 'number' || c >= 0) continue;
    const have = productionOf(ctx.me, res) + (res === 'megacredits' ? 5 : 0);
    const missing = -c - have;
    if (missing > 0) {
      // Energy comes from cards or the power plant project; other production rarely appears just to be spent.
      const k = res === 'energy' ? (missing === 1 ? 0.55 : 0.3) : 0.2;
      odds *= k;
      delay = Math.max(delay, 1.2 * missing);
    }
  }
  return {odds, delay};
}

/** v3: energy that the cards in hand and the actions in play would use but production does not cover. */
export function energyGap(ctx: Ctx): number {
  let need = 0;
  for (const c of ctx.model.cardsInHand) {
    const e = findCard(c.name)?.behavior?.production?.energy;
    if (typeof e === 'number' && e < 0) need += -e;
  }
  for (const c of ctx.me.tableau ?? []) {
    const e = findCard(c.name)?.action?.spend?.energy;
    if (typeof e === 'number') need += e;
  }
  return Math.max(0, Math.min(6, need) - ctx.me.energyProduction);
}

/** v3: how often a card's action is likely to be used: once a generation, less when what it spends is not produced,
 *  and no more often than the global it raises has steps left. */
export function actionUses(def: CardDef, ctx: Ctx): number {
  const a = def.action;
  if (!a) return 0;
  let uses = Math.max(0, ctx.gens - 0.7);
  for (const [res, need] of Object.entries(a.spend ?? {})) {
    if (typeof need !== 'number' || need <= 0 || res === 'megacredits' || res === 'resourcesHere' || res === 'cards') continue;
    const prod = productionOf(ctx.me, res) + (res === 'energy' && def.behavior?.production?.energy ? Number(def.behavior.production.energy) || 0 : 0);
    const stock = Number((ctx.me as unknown as Record<string, number>)[res] ?? 0);
    const supply = prod + stock / Math.max(1, ctx.gens);
    uses *= Math.max(0.15, Math.min(1, supply / need));
  }
  const left = stepsLeft(ctx.model.game);
  if (a.global?.oxygen) uses = Math.min(uses, left.oxygen * 0.6);
  if (a.global?.temperature) uses = Math.min(uses, left.temperature * 0.6);
  if (a.ocean) uses = Math.min(uses, left.oceans * 0.6);
  return uses;
}

/** v3: what a card's tags add in this tableau: the corporation's and cards' tag triggers (Point Luna's draw per Earth
 *  tag, Mining Guild's steel, ...) and requirements of cards in hand it helps meet. */
export function tagSynergy(def: CardDef, ctx: Ctx): number {
  if (!def.tags.length) return 0;
  let v = 0;
  for (const c of ctx.me.tableau ?? []) {
    const t = findCard(c.name);
    for (const trig of t?.triggers ?? []) {
      if (trig.when !== 'cardPlayed' || trig.scope === 'others' || !trig.tags?.length) continue;
      const hits = trig.perTag ? def.tags.filter((x) => trig.tags!.includes(x)).length : def.tags.some((x) => trig.tags!.includes(x)) ? 1 : 0;
      if (hits) v += hits * Math.max(0.5, behaviorValue(trig.behavior, ctx, t));
    }
  }
  if (def.type === 'event') return v;
  // A tag that a card in hand needs moves that card toward playable.
  for (const c of ctx.model.cardsInHand) {
    if (c.name === def.name) continue;
    const req = findCard(c.name)?.requirements?.find((r) => r.tag && !r.max && def.tags.includes(r.tag));
    if (req && (ctx.tags[req.tag!] ?? 0) < (req.count ?? 1)) v += 2;
  }
  return Math.min(v, 12);
}

/** v3's card value: v2's, with actions limited by what they spend, energy production worth more while cards need it,
 *  tag synergy, and uncertain points (resources a card has yet to collect) discounted early. */
export function cardValueV3(def: CardDef, ctx: Ctx): number {
  let v = behaviorValue(def.behavior, ctx, def);
  const pts = pointsValue(def, ctx, def.action ? actionUses(def, ctx) : undefined);
  const vp = def.victoryPoints;
  v += vp && typeof vp === 'object' && vp.resourcesHere && ctx.gens > 4 ? pts * 0.85 : pts;
  if (def.action) {
    // An action that adds production pays less with every later use: value the average use, at mid-remaining game.
    let per = behaviorValue(def.action, def.action.production ? withGens(ctx, Math.max(1, Math.ceil(ctx.gens / 2))) : ctx, def);
    // "Add a resource here, or spend n here for X": X comes once every n + 1 uses.
    const spender = def.action.or?.behaviors.find((x) => typeof x.spend?.resourcesHere === 'number');
    if (spender) {
      const n = spender.spend!.resourcesHere as number;
      per = Math.max(behaviorValue(spender, ctx, def) + n * 1.5, 0) / (n + 1);
    }
    v += Math.max(0, per) * actionUses(def, ctx) * 0.75 + 0.5;
  }
  for (const d of def.cardDiscount ?? []) v += d.amount * Math.min(ctx.gens, 6) * (d.tag ? 0.7 : 1.4);
  if (def.triggers?.length) v += def.triggers.length * Math.min(ctx.gens, 6) * 0.9;
  if (def.requirementBonus) v += Math.min(ctx.gens, 5) * 0.8;
  if (def.type !== 'event') for (const t of def.tags) v += t === 'science' || t === 'jovian' ? 1.2 : 0.5;
  v += tagSynergy(def, ctx);
  // Energy that unlocks cards in hand or actions in play is worth more than its heat.
  const e = def.behavior?.production?.energy;
  if (typeof e === 'number' && e > 0 && !ctx.lastGen) v += Math.min(e, energyGap(ctx)) * Math.min(6, ctx.gens) * 0.9;
  return v;
}
