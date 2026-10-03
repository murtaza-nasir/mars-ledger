// What an option does, as concrete deltas (resources, production, TR, VP, tiles) and as one line of text. The judge
// (judge.ts) describes every candidate this way, at every context level: a decision model sees outcomes, not the
// heuristic's scores. Values come from the engine's own card data (src/shared/data) and the board.
import {findCard} from '../../../../shared/cards';
import {BONUS_NAME, TILE} from '../../../../shared/full';
import type {EnginePayment, SpaceModel} from '../../../../shared/full';
import type {Behavior, CardDef, Countable, Requirement} from '../../../../shared/types';
import {neighbours} from '../board';
import type {TileGoal} from '../board';
import {countOf, stepsLeft} from '../value';
import type {Ctx} from '../value';

export const RES = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'] as const;
export type Res = typeof RES[number];
const SHORT: Record<string, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};

export type Effect = {
  /** stock change now (payments included) */
  stock: Partial<Record<Res, number>>;
  /** production change */
  prod: Partial<Record<Res, number>>;
  /** terraform rating gained now (global steps that are still open, plus printed TR) */
  tr: number;
  /** victory points at the end: a number when certain, else a phrase */
  vp: number;
  vpNote?: string;
  tiles: string[];
  other: string[];
};

export const emptyEffect = (): Effect => ({stock: {}, prod: {}, tr: 0, vp: 0, tiles: [], other: []});

function add(m: Partial<Record<Res, number>>, r: string, n: number) {
  if (!n || !(RES as readonly string[]).includes(r)) return;
  m[r as Res] = (m[r as Res] ?? 0) + n;
}

function countText(c: Countable | undefined, ctx: Ctx, self?: CardDef): number {
  return countOf(c, ctx, self);
}

/** Fold a card behavior into an effect (what it does once, when played or used). */
export function behaviorEffect(b: Behavior | null | undefined, ctx: Ctx, self: CardDef | undefined, e: Effect = emptyEffect()): Effect {
  if (!b) return e;
  const left = stepsLeft(ctx.model.game);
  if (b.production) for (const [r, c] of Object.entries(b.production)) add(e.prod, r, countText(c, ctx, self));
  if (b.stock) for (const [r, c] of Object.entries(b.stock)) add(e.stock, r, countText(c, ctx, self));
  if (b.spend) {
    for (const [r, n] of Object.entries(b.spend)) {
      if (typeof n !== 'number') continue;
      if (r === 'resourcesHere') e.other.push(`spends ${n} resource${n === 1 ? '' : 's'} on this card`);
      else if (r === 'cards') e.other.push(`discards ${n} card${n === 1 ? '' : 's'}`);
      else add(e.stock, r, -n);
    }
  }
  if (b.tr !== undefined) e.tr += countText(b.tr, ctx, self);
  if (b.global?.temperature) {
    const n = Math.min(left.temperature, b.global.temperature);
    e.tr += n;
    e.other.push(n ? `temperature +${n} step${n === 1 ? '' : 's'}` : 'temperature already at maximum (no TR)');
  }
  if (b.global?.oxygen) {
    const n = Math.min(left.oxygen, b.global.oxygen);
    e.tr += n;
    e.other.push(n ? `oxygen +${n} step${n === 1 ? '' : 's'}` : 'oxygen already at maximum (no TR)');
  }
  if (b.ocean) {
    const want = b.ocean.count ?? 1;
    const n = Math.min(left.oceans, want);
    e.tr += n;
    e.tiles.push(n ? `${n} ocean${n === 1 ? '' : 's'} (+2 M€ per ocean next to it)` : 'no oceans left to place (no TR)');
  }
  if (b.greenery) {
    e.vp += 1;
    if (left.oxygen > 0) { e.tr += 1; e.other.push('oxygen +1 step'); }
    e.tiles.push('greenery');
  }
  if (b.city) e.tiles.push('city');
  if (b.tile) e.tiles.push(`${(b.tile.title ?? 'special').replace(/\s*tile$/i, '')} tile${b.tile.on === 'ocean' ? ' on an ocean space' : ''}`);
  if (b.drawCard !== undefined) {
    const d = b.drawCard;
    const n = typeof d === 'number' ? d : (d.keep ?? countText(d.count, ctx, self));
    e.other.push(`draw ${n} card${n === 1 ? '' : 's'}`);
  }
  if (b.standardResource !== undefined) e.other.push(`gain ${typeof b.standardResource === 'number' ? b.standardResource : b.standardResource.count} standard resources of your choice`);
  if (b.addResources !== undefined) {
    const n = countText(b.addResources, ctx, self);
    e.other.push(`add ${n} ${self?.resourceType?.toLowerCase() ?? 'resource'}${n === 1 ? '' : 's'} to this card`);
  }
  if (b.addResourcesToAnyCard) {
    const list = Array.isArray(b.addResourcesToAnyCard) ? b.addResourcesToAnyCard : [b.addResourcesToAnyCard];
    for (const a of list) e.other.push(`add ${countText(a.count, ctx, self)} ${a.type?.toLowerCase() ?? 'resource'}(s) to a card`);
  }
  if (b.decreaseAnyProduction) e.other.push(`a rival loses ${b.decreaseAnyProduction.count} ${SHORT[b.decreaseAnyProduction.type] ?? b.decreaseAnyProduction.type} production`);
  if (b.removeAnyPlants) e.other.push(`remove up to ${b.removeAnyPlants} plants from a rival`);
  if (b.removeAnyStock) e.other.push(`remove up to ${b.removeAnyStock.count} ${SHORT[b.removeAnyStock.type]} from a rival`);
  if (b.steal) e.other.push(`steal ${b.steal.count} ${SHORT[b.steal.type]} from a rival`);
  if (b.or?.behaviors.length) e.other.push(`choose one: ${b.or.behaviors.map((x) => x.title).join(' / ')}`);
  if (b.conditional) {
    const then = behaviorEffect(b.conditional.then, ctx, self);
    const els = behaviorEffect(b.conditional.else, ctx, self);
    const have = ctx.tags[b.conditional.tag] ?? 0;
    const used = have >= b.conditional.atLeast ? then : els;
    mergeInto(e, used);
  }
  if (b.steelValue) e.other.push(`steel is worth ${b.steelValue} M€ more`);
  if (b.titanumValue) e.other.push(`titanium is worth ${b.titanumValue} M€ more`);
  if (b.greeneryDiscount) e.other.push(`greeneries cost ${b.greeneryDiscount} plants less`);
  if (b.removeResourcesFromAnyCard) e.other.push(`remove ${b.removeResourcesFromAnyCard.type.toLowerCase()}(s) from a card`);
  if (b.manual) e.other.push(b.manual);
  return e;
}

function mergeInto(e: Effect, x: Effect) {
  for (const [r, n] of Object.entries(x.stock)) add(e.stock, r, n ?? 0);
  for (const [r, n] of Object.entries(x.prod)) add(e.prod, r, n ?? 0);
  e.tr += x.tr; e.vp += x.vp; e.tiles.push(...x.tiles); e.other.push(...x.other);
}

/** Printed victory points of a card, as a number when fixed and a note otherwise. */
export function pointsEffect(def: CardDef, ctx: Ctx, e: Effect): Effect {
  const vp = def.victoryPoints;
  if (vp === null || vp === undefined) return e;
  if (typeof vp === 'number') { e.vp += vp; return e; }
  if (vp === 'special') { e.vpNote = 'special VP (see card)'; return e; }
  const res = def.resourceType?.toLowerCase() ?? 'resource';
  if (vp.resourcesHere) {
    e.vpNote = vp.ifAny ? `${vp.ifAny} VP if any ${res} here` : vp.each ? `${vp.each} VP per ${res} here` : `1 VP per ${vp.per ?? 1} ${res}${(vp.per ?? 1) === 1 ? '' : 's'} here`;
    return e;
  }
  if (vp.tag) { e.vpNote = `1 VP per ${vp.per ?? 1} ${vp.tag} tag${(vp.per ?? 1) === 1 ? '' : 's'} (you have ${ctx.tags[vp.tag] ?? 0})`; return e; }
  if (vp.cities) { e.vpNote = `1 VP per ${vp.per ?? 1} ${vp.all ? '' : 'of your '}cities`; return e; }
  e.vpNote = 'VP (see card)';
  return e;
}

/** A project card played now: what it does, its points, and the lasting parts (action, discount, triggers). */
export function cardEffect(name: string, ctx: Ctx): Effect {
  const def = findCard(name);
  if (!def) return {...emptyEffect(), other: [`${name} (no card data)`]};
  const e = behaviorEffect(def.behavior, ctx, def);
  pointsEffect(def, ctx, e);
  if (def.action) e.other.push(`gives an action: ${actionText(def, ctx)}`);
  for (const d of def.cardDiscount ?? []) e.other.push(`${d.tag ? d.tag + ' ' : ''}cards cost ${d.amount} M€ less`);
  for (const t of def.triggers ?? []) e.other.push(`effect: ${t.text}`);
  return e;
}

export function actionText(def: CardDef, ctx: Ctx): string {
  const a = def.action;
  if (!a) return cardText(def);
  const cost = Object.entries(a.spend ?? {}).filter(([r, n]) => typeof n === 'number' && r in SHORT).map(([r, n]) => `${n} ${SHORT[r]}`);
  const gain = formatEffect(behaviorEffect({...a, spend: Object.fromEntries(Object.entries(a.spend ?? {}).filter(([r]) => !(r in SHORT)))}, ctx, def), {bare: true});
  const text = cost.length ? `pay ${cost.join(' and ')} to get ${gain || 'its effect'}` : gain;
  return text || cardText(def);
}

export function paymentEffect(pay: EnginePayment | null | undefined, e: Effect): Effect {
  if (!pay) return e;
  add(e.stock, 'megacredits', -(pay.megacredits ?? 0));
  add(e.stock, 'steel', -(pay.steel ?? 0));
  add(e.stock, 'titanium', -(pay.titanium ?? 0));
  add(e.stock, 'heat', -(pay.heat ?? 0));
  return e;
}

/** A tile placed on a space: what the space pays now and what the neighbours mean at the end. */
export function spaceEffect(id: string, goal: TileGoal, ctx: Ctx, adj = neighbours(ctx.model.game.spaces)): Effect {
  const e = emptyEffect();
  const spaces = ctx.model.game.spaces;
  const s = spaces.find((x) => x.id === id);
  if (!s) return e;
  const around = adj.get(id) ?? [];
  let cards = 0;
  for (const b of s.bonus ?? []) {
    const name = BONUS_NAME[b];
    if (name === 'card') cards++;
    else if (name === 'ocean') e.other.push('ocean space bonus');
    else if (name) add(e.stock, name, 1);
  }
  if (cards) e.other.push(`draw ${cards} card${cards === 1 ? '' : 's'}`);
  const oceans = around.filter((n) => n.tileType === TILE.OCEAN).length;
  add(e.stock, 'megacredits', oceans * 2);
  const me = ctx.me.color;
  const isCity = (n: SpaceModel) => n.tileType === TILE.CITY || n.tileType === TILE.CAPITAL;
  const myCities = around.filter((n) => isCity(n) && n.color === me).length;
  const rivalCities = around.filter((n) => isCity(n) && n.color !== me && n.color !== undefined).length;
  const greeneries = around.filter((n) => n.tileType === TILE.GREENERY).length;
  const freeLand = around.filter((n) => n.tileType === undefined && n.spaceType === 'land').length;
  if (goal === 'greenery') {
    if (myCities) { e.vp += myCities; e.other.push(`next to ${myCities} of your cities (+${myCities} VP)`); }
    if (rivalCities) e.other.push(`next to ${rivalCities} rival cit${rivalCities === 1 ? 'y' : 'ies'} (+${rivalCities} VP for them)`);
  } else if (goal === 'city') {
    if (greeneries) { e.vp += greeneries; e.other.push(`${greeneries} greener${greeneries === 1 ? 'y' : 'ies'} next to it (+${greeneries} VP now)`); }
    e.other.push(`${freeLand} free land space${freeLand === 1 ? '' : 's'} around it for future greeneries`);
  } else if (goal === 'ocean') {
    if (myCities) e.other.push(`takes a space next to your city`);
  }
  if (oceans) e.other.push(`${oceans} ocean${oceans === 1 ? '' : 's'} adjacent`);
  return e;
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** One line: "+2 M€ production, -14 M€, +1 TR, +1 VP, tiles: greenery; draw 1 card". */
export function formatEffect(e: Effect, o: {bare?: boolean} = {}): string {
  const parts: string[] = [];
  const stock = RES.filter((r) => e.stock[r]).map((r) => `${sign(e.stock[r]!)} ${SHORT[r]}`);
  const prod = RES.filter((r) => e.prod[r]).map((r) => `${sign(e.prod[r]!)} ${SHORT[r]} production`);
  if (prod.length) parts.push(prod.join(', '));
  if (stock.length) parts.push(stock.join(', '));
  if (e.tr) parts.push(`${sign(e.tr)} TR`);
  if (e.vp) parts.push(`${sign(e.vp)} VP`);
  if (e.vpNote) parts.push(e.vpNote);
  if (e.tiles.length) parts.push(`tile: ${e.tiles.join(', ')}`);
  if (e.other.length) parts.push(e.other.join('; '));
  if (!parts.length && !o.bare) return 'no direct effect';
  return parts.join('; ');
}

/** A card's printed text (engine data). */
export function cardText(def: CardDef): string {
  const t = [def.description ?? '', ...(def.text ?? [])].filter(Boolean).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function requirementText(reqs: Requirement[] | undefined): string {
  if (!reqs?.length) return '';
  return reqs.map((r) => {
    const m = r.max ? 'max ' : '';
    if (r.temperature !== undefined) return `${m}${r.temperature} °C`;
    if (r.oxygen !== undefined) return `${m}${r.oxygen}% oxygen`;
    if (r.oceans !== undefined) return `${m}${r.oceans} oceans`;
    if (r.venus !== undefined) return `${m}${r.venus}% venus`;
    if (r.tag) return `${m}${r.count ?? 1} ${r.tag} tag${(r.count ?? 1) === 1 ? '' : 's'}`;
    if (r.production) return `${r.production} production`;
    if (r.cities !== undefined) return `${r.count ?? r.cities} cities`;
    if (r.greeneries !== undefined) return `${r.count ?? r.greeneries} greeneries`;
    if (r.tr !== undefined) return `TR ${r.count ?? r.tr}`;
    return 'requirement';
  }).join(', ');
}

/** "Mohole Area (20 M€, building; requires ...)" */
export function cardHeader(name: string, cost?: number): string {
  const def = findCard(name);
  if (!def) return name;
  const bits = [`${cost ?? def.cost ?? 0} M€`];
  if (def.tags.length) bits.push(def.tags.join('/'));
  if (def.type === 'event') bits.push('event');
  const req = requirementText(def.requirements);
  if (req) bits.push(`requires ${req}`);
  return `${name} (${bits.join(', ')})`;
}
