// Relevant counts for a card, from the live game: "You have 3 space tags, 4 with this card: +4 M€ production".
// Pure (no React). Most hints come from the card's declarative data (behavior, action, victory points,
// requirements, discounts), counted the way the engine counts them (vendor/tm Counter.ts, Tags.ts,
// TagCardRequirement.ts):
//   - your own tags for an effect: face-up tags plus wild tags, plus this card's tags while it is not yet played;
//   - your own tags for victory points: face-up tags only (no wild tags);
//   - opponents' tags: face-up tags only (their wild tags never count for you);
//   - tag requirements: face-up plus wild tags for "at least", face-up only for "at most";
//   - played events keep no tags but the event tag (the engine model's tag counts already leave them out).
// Cards whose rule the data does not describe get a hand-written entry (MANUAL below).
import {findCard} from '../../shared/cards';
import {layout, HEX_W} from '../../shared/hexgeo';
import type {GameState} from '../../shared/game';
import type {PlayerViewModel, PublicPlayerModel} from '../../shared/full';
import type {Behavior, CardDef, CountSpec, Countable, Requirement, Resource, Tag, Units} from '../../shared/types';

export type HintTone = 'met' | 'unmet' | 'info';
export type CardHint = {key: string; text: string; tone: HintTone; source: 'derived' | 'manual'};

export type HintPlayer = {
  id: string; name: string;
  /** face-up tag counts: events contribute only to 'event'; wild tags under 'wild' */
  tags: Partial<Record<Tag, number>>;
  /** cards on the table, with the resources on them */
  cards: Array<{name: string; resources: number}>;
  tr: number;
  production: Units;
  stock: Units;
  cities: {onMars: number; offMars: number};
  greeneries: number;
};

export type HintWorld = {
  /** whose phone this is (null: a screen with no seat) */
  me: string | null;
  players: HintPlayer[];
  global: {temperature: number; oxygen: number; oceans: number; venus: number};
  /** the viewer's own hand, by name (for discount cards) */
  hand: string[];
  /** Tiles next to a player's special tile (full games only: companion games have no board positions). */
  nextTo?: (owner: string, tileType: number) => {city: number; ocean: number} | undefined;
};

/** Whose point of view, and whether the card is already on that player's table. */
export type HintViewer = {owner: string; place: 'hand' | 'table'};

// ---- words -----------------------------------------------------------------------------------
const PROPER = new Set(['jovian', 'earth', 'venus', 'moon', 'mars']);
const tagWord = (t: string) => (PROPER.has(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const RES_WORD: Record<Resource, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plant', energy: 'energy', heat: 'heat'};
const STOCK_WORD: Record<Resource, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tags = (n: number, t: string) => plural(n, `${tagWord(t)} tag`);
function resWord(type: string | null, n: number): string {
  const t = (type ?? 'resource').toLowerCase();
  if (t === 'science') return plural(n, 'science resource');
  return plural(n, t);
}
function listWords(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
const article = (t: string) => (/^[aeiou]/i.test(t) ? 'an' : 'a');
const fmtTemp = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n)} °C`;

type Who = {has: string; have: string; opp: string; your: string; you: string; yours: string};
function who(world: HintWorld, owner: HintPlayer): Who {
  const mine = owner.id === world.me;
  return mine ? {has: 'You have', have: 'you have', opp: 'Opponents have', your: 'your', you: 'you', yours: 'yours'}
    : {has: `${owner.name} has`, have: `${owner.name} has`, opp: `${owner.name}'s opponents have`, your: `${owner.name}'s`, you: owner.name, yours: 'theirs'};
}

// ---- counting --------------------------------------------------------------------------------
const tagN = (p: HintPlayer, t: Tag) => p.tags[t] ?? 0;
/** effect counting ('default'): face-up + wild; scoring and opponents ('raw'): face-up only */
function ownTags(p: HintPlayer, t: Tag, mode: 'default' | 'raw') {
  return tagN(p, t) + (mode === 'default' && t !== 'wild' ? tagN(p, 'wild') : 0);
}
const selfTags = (card: CardDef, t: Tag | Tag[]) => card.tags.filter((x) => [t].flat().includes(x)).length;

type Counted = {n: number; phrase: string};

/** A countable from the card's data, counted for `owner`, with the words for what was counted. */
function countSpec(world: HintWorld, owner: HintPlayer, card: CardDef, spec: CountSpec, unplayed: boolean, mode: 'default' | 'raw', here?: number): Counted | null {
  const w = who(world, owner);
  const opponents = world.players.filter((p) => p.id !== owner.id);
  let n = 0;
  const parts: string[] = [];
  if (spec.tag !== undefined) {
    if (Array.isArray(spec.tag)) {
      const base = spec.tag.reduce((a, t) => a + tagN(owner, t), 0) + (mode === 'default' ? tagN(owner, 'wild') : 0);
      const self = unplayed ? selfTags(card, spec.tag) : 0;
      n += base + self;
      parts.push(`${w.has} ${base} ${listWords(spec.tag.map(tagWord))} tag${base === 1 ? '' : 's'}${self ? `, ${base + self} with this card` : ''}`);
    } else if (spec.others) {
      const sum = opponents.reduce((a, p) => a + tagN(p, spec.tag as Tag), 0);
      n += sum;
      parts.push(`${w.opp} ${tags(sum, spec.tag)}`);
    } else {
      const t = spec.tag;
      const base = ownTags(owner, t, mode);
      const wild = mode === 'default' && t !== 'wild' ? tagN(owner, 'wild') : 0;
      const self = unplayed ? selfTags(card, t) : 0;
      const theirs = spec.all ? opponents.reduce((a, p) => a + tagN(p, t), 0) : 0;
      n += base + self + theirs;
      let s = `${w.has} ${tags(base, t)}`;
      if (wild) s += ` including ${wild} wild`;
      if (self) s += `, ${base + self} with this card`;
      if (spec.all) s += `; opponents ${theirs}`;
      parts.push(s);
    }
  }
  const tilePool = (spec as {all?: boolean}).all === false ? [owner] : world.players;
  const ownOnly = tilePool.length === 1 && world.players.length > 1;
  if (spec.cities) {
    const where = spec.cities.where;
    const c = tilePool.reduce((a, p) => a + (where === 'onmars' ? p.cities.onMars : where === 'offmars' ? p.cities.offMars : p.cities.onMars + p.cities.offMars), 0);
    n += c;
    const place = where === 'onmars' ? ' on Mars' : where === 'offmars' ? ' in space' : ownOnly ? '' : ' in play';
    parts.push(ownOnly ? `${w.has} ${plural(c, 'city', 'cities')}${place}` : `${plural(c, 'city', 'cities')}${place}`);
  }
  if (spec.greeneries) {
    const g = tilePool.reduce((a, p) => a + p.greeneries, 0);
    n += g;
    parts.push(ownOnly ? `${w.has} ${plural(g, 'greenery', 'greeneries')}` : `${plural(g, 'greenery', 'greeneries')} in play`);
  }
  if (spec.oceans) {
    n += world.global.oceans;
    parts.push(`${plural(world.global.oceans, 'ocean')} placed`);
  }
  if (spec.eventsPlayed) {
    const pool = spec.all ? world.players : spec.others ? opponents : [owner];
    const e = pool.reduce((a, p) => a + tagN(p, 'event'), 0);
    n += e;
    parts.push(pool.length === 1 ? `${w.has} played ${plural(e, 'event')}` : `${plural(e, 'event')} played`);
  }
  if (spec.resourcesHere) {
    if (here === undefined) return null;
    n += here;
    parts.push(here ? `${resWord(card.resourceType, here)} here` : `No ${resWord(card.resourceType, 2).replace(/^2 /, '')} here yet`);
  }
  if (!parts.length) return null;
  if (spec.each) n *= spec.each;
  if (spec.per) n = Math.floor(n / spec.per);
  return {n, phrase: parts.join('; ')};
}

/** What a counted behavior gives, in words: "+4 M€ production", "gain 3 plants", "+2 TR". */
type Effect = {phrase: string; gives: string; gain?: boolean};
function effects(b: Behavior, card: CardDef, count: (c: Countable) => Counted | null): Effect[] {
  const out: Effect[] = [];
  const push = (c: Countable | undefined, words: (n: number) => string, gain?: boolean) => {
    if (c === undefined || typeof c === 'number') return;
    const r = count(c);
    if (r) out.push({phrase: r.phrase, gives: words(r.n), gain});
  };
  for (const [r, c] of Object.entries(b.production ?? {}) as Array<[Resource, Countable]>) push(c, (n) => `+${n} ${RES_WORD[r]} production`);
  for (const [r, c] of Object.entries(b.stock ?? {}) as Array<[Resource, Countable]>) push(c, (n) => `${n} ${STOCK_WORD[r]}`, true);
  push(b.tr, (n) => `+${n} TR`);
  if (b.addResources !== undefined) push(b.addResources, (n) => `${resWord(card.resourceType, n)} added here`);
  if (b.drawCard && typeof b.drawCard === 'object') push(b.drawCard.count, (n) => `draw ${plural(n, 'card')}`);
  return out;
}

function playerTagsForReq(p: HintPlayer, t: Tag, max: boolean) {
  return max ? tagN(p, t) : ownTags(p, t, 'default');
}

function requirementBonus(p: HintPlayer): number {
  return p.cards.reduce((a, c) => a + (findCard(c.name)?.requirementBonus ?? 0), 0);
}

function requirementHint(world: HintWorld, owner: HintPlayer, r: Requirement, i: number): CardHint | null {
  const w = who(world, owner);
  const n = r.count ?? 1;
  const g = world.global;
  const bonus = requirementBonus(owner);
  const key = `req${i}`;
  const mk = (text: string, ok: boolean): CardHint => ({key, text, tone: ok ? 'met' : 'unmet', source: 'derived'});
  const globalReq = (have: number, need: number, step: number, words: string, now: string, bare = false) => {
    const tol = bonus * step;
    const strict = r.max ? have <= need : have >= need;
    const ok = r.max ? have <= need + tol : have >= need - tol;
    return mk(`${words}: ${bare ? '' : 'now '}${now}${ok && !strict ? ` (within ${w.your} ${plural(bonus, 'step')} of leeway)` : ''}`, ok);
  };
  if (r.temperature !== undefined) return globalReq(g.temperature, r.temperature, 2, `Requires ${fmtTemp(r.temperature)} or ${r.max ? 'colder' : 'warmer'}`, fmtTemp(g.temperature));
  if (r.oxygen !== undefined) return globalReq(g.oxygen, r.oxygen, 1, `Oxygen ${r.oxygen}% ${r.max ? 'max' : 'min'}`, `${g.oxygen}%`);
  if (r.oceans !== undefined) return globalReq(g.oceans, r.oceans, 1, `${r.max ? 'At most' : 'Requires'} ${plural(r.oceans, 'ocean')}`, `${g.oceans} placed`, true);
  if (r.venus !== undefined) return globalReq(g.venus, r.venus, 2, `Venus ${r.venus}% ${r.max ? 'max' : 'min'}`, `${g.venus}%`);
  if (r.tag) {
    const have = playerTagsForReq(owner, r.tag, !!r.max);
    const wild = r.max || r.tag === 'wild' ? 0 : tagN(owner, 'wild');
    const ok = r.max ? have <= n : have >= n;
    const need = n === 1 && !r.max ? `${article(r.tag)} ${tagWord(r.tag)} tag` : tags(n, r.tag);
    return mk(`${r.max ? 'At most' : 'Requires'} ${need}: ${w.have} ${have}${wild ? ` including ${wild} wild` : ''}`, ok);
  }
  if (r.production) {
    const have = owner.production[r.production] ?? 0;
    return mk(`Requires ${n} ${RES_WORD[r.production]} production: ${w.have} ${have}`, have >= n);
  }
  if (r.greeneries !== undefined) {
    return mk(`Requires ${plural(r.greeneries, 'greenery', 'greeneries')} of ${w.yours}: ${w.have} ${owner.greeneries}`, owner.greeneries >= r.greeneries);
  }
  if (r.cities !== undefined) {
    const pool = r.all ? world.players : [owner];
    const have = pool.reduce((a, p) => a + p.cities.onMars + p.cities.offMars, 0);
    return mk(r.all ? `Requires ${plural(r.cities, 'city', 'cities')} in play: ${have} now` : `Requires ${plural(r.cities, 'city', 'cities')} of ${w.yours}: ${w.have} ${have}`, have >= r.cities);
  }
  if (r.tr !== undefined) return mk(`Requires TR ${r.tr}: ${w.your === 'your' ? 'yours is' : `${w.your} is`} ${owner.tr}`, owner.tr >= r.tr);
  return null;
}

// ---- hand-written entries --------------------------------------------------------------------
type Ctx = {world: HintWorld; owner: HintPlayer; card: CardDef; viewer: HintViewer; w: Who};
const MANUAL: Record<string, (c: Ctx) => string | null> = {
  // "Each time any Jovian tag is put into play, including this, increase your M€ production 1 step."
  'Saturn Systems': ({world}) => {
    const all = world.players.reduce((a, p) => a + tagN(p, 'jovian'), 0);
    return `${tags(all, 'jovian')} in play so far`;
  },
  // Copies the production box of one of your building cards.
  'Robotic Workforce': ({owner, w, viewer}) => {
    if (viewer.place === 'table') return null;
    const n = owner.cards.filter((c) => {
      const d = findCard(c.name);
      return !!d && d.type !== 'event' && d.tags.includes('building') && !!d.behavior?.production && Object.keys(d.behavior.production).length > 0;
    }).length;
    return n ? `${w.has} ${plural(n, 'building card')} with a production box to copy` : `${w.has} no building cards with a production box to copy`;
  },
};

// ---- the hints -------------------------------------------------------------------------------
export function cardHints(card: CardDef, world: HintWorld, viewer: HintViewer): CardHint[] {
  const owner = world.players.find((p) => p.id === viewer.owner);
  if (!owner) return [];
  const out: CardHint[] = [];
  const w = who(world, owner);
  const unplayed = viewer.place === 'hand';
  const here = viewer.place === 'table' ? owner.cards.find((c) => c.name === card.name)?.resources ?? 0 : undefined;
  const add = (key: string, text: string, tone: HintTone = 'info', source: CardHint['source'] = 'derived') => out.push({key, text, tone, source});

  // requirements: only before the card is played
  if (unplayed) card.requirements.forEach((r, i) => { const h = requirementHint(world, owner, r, i); if (h) out.push(h); });

  // what playing it gives (one-off effects matter only before it is played)
  if (unplayed && card.behavior) {
    const b = card.behavior;
    effects(b, card, (c) => countSpec(world, owner, card, c as CountSpec, true, 'default')).forEach((e, i) => add(`play${i}`, `${e.phrase}: ${e.gain ? 'gain ' : ''}${e.gives}`));
    if (b.conditional) {
      const {tag, atLeast, then: yes, else: no} = b.conditional;
      const have = ownTags(owner, tag, 'default') + selfTags(card, tag);
      const ok = have >= atLeast;
      const better = describeFixed(yes);
      const gives = ok ? better : no ? describeFixed(no) : '';
      add('cond', `${w.has} ${tags(have, tag)}${ok ? '' : ` (${atLeast} needed for ${better})`}${gives ? `: ${gives}` : ''}`, ok ? 'met' : 'unmet');
    }
  }

  // its action: what it spends against what the owner has, and what a counted gain comes to now
  if (card.action) {
    const a = card.action;
    if (viewer.place === 'table' && a.spend) {
      for (const [r, need] of Object.entries(a.spend) as Array<[string, unknown]>) {
        if (!(r in RES_WORD) || typeof need !== 'number') continue;
        const have = owner.stock[r as Resource] ?? 0;
        add(`spend-${r}`, `Its action spends ${need} ${STOCK_WORD[r as Resource]}: ${w.have} ${have}`, have >= need ? 'met' : 'unmet');
      }
    }
    effects(a, card, (c) => countSpec(world, owner, card, c as CountSpec, false, 'default', here))
      .forEach((e, i) => add(`act${i}`, `${e.phrase}: its action gives ${e.gives}`));
  }

  // victory points that depend on the game
  const vp = card.victoryPoints;
  if (vp && typeof vp === 'object') {
    const per = vp.per ?? 1;
    const each = vp.each ?? 1;
    const now = unplayed ? 'so far' : 'now';
    if (vp.resourcesHere) {
      if (here !== undefined) {
        const pts = vp.ifAny !== undefined ? (here > 0 ? vp.ifAny : 0) : Math.floor(here * each / per);
        const what = here ? resWord(card.resourceType, here) : `No ${(card.resourceType ?? 'resource').toLowerCase()}${card.resourceType === 'Science' ? ' resources' : 's'}`;
        add('vp', `${what} here${here ? '' : ' yet'}: ${plural(pts, 'VP', 'VP')} now${!here && vp.ifAny ? ` (${vp.ifAny} with one)` : ''}`, 'info');
      }
    } else if (vp.nextToThis && (vp.cities || vp.oceans)) {
      const tile = tileTypeOf(card);
      const near = viewer.place === 'table' && tile !== undefined ? world.nextTo?.(owner.id, tile) : undefined;
      if (near) {
        const n = vp.cities ? near.city : near.ocean;
        add('vp', `${vp.cities ? plural(n, 'city', 'cities') : plural(n, 'ocean')} next to it: ${n} extra VP now`);
      }
    } else if (vp.tag || vp.cities || vp.oceans) {
      const spec: CountSpec = {tag: vp.tag, cities: vp.cities as CountSpec['cities'], oceans: vp.oceans, per: vp.per, each: vp.each};
      const c = countSpec(world, owner, card, spec, unplayed, 'raw');
      if (c) add('vp', `${c.phrase}: ${plural(c.n, 'VP', 'VP')} ${now}`);
    }
  }

  // discounts by tag: the cards in your hand it would make cheaper
  if (owner.id === world.me && world.hand.length) {
    for (const d of card.cardDiscount) {
      if (!d.tag) continue;
      const n = world.hand.filter((name) => name !== card.name && findCard(name)?.tags.includes(d.tag as Tag)).length;
      const cards = n ? plural(n, `${unplayed ? 'other ' : ''}card`) : `No ${unplayed ? 'other ' : ''}cards`;
      add(`disc-${d.tag}`, `${cards} in your hand ${n === 1 ? 'has' : 'have'} ${article(d.tag)} ${tagWord(d.tag)} tag`);
    }
  }

  const manual = MANUAL[card.name]?.({world, owner, card, viewer, w});
  if (manual) add('manual', manual, 'info', 'manual');
  return out;
}

/** Words for a fixed behavior branch (the conditional's outcome). */
function describeFixed(b: Behavior): string {
  const parts: string[] = [];
  for (const [r, c] of Object.entries(b.production ?? {}) as Array<[Resource, Countable]>) if (typeof c === 'number') parts.push(`${c >= 0 ? '+' : ''}${c} ${RES_WORD[r]} production`);
  for (const [r, c] of Object.entries(b.stock ?? {}) as Array<[Resource, Countable]>) if (typeof c === 'number') parts.push(`${c} ${STOCK_WORD[r]}`);
  return parts.join(', ');
}

/** The engine tile type a card places (Capital is a city tile of its own type). */
export function tileTypeOf(card: CardDef): number | undefined {
  if (card.name === 'Capital') return 3;
  const t = card.behavior?.tile?.type;
  return typeof t === 'number' ? t : undefined;
}

/** Hints come from the declarative data (derived) or a hand-written entry (manual). */
export const MANUAL_HINT_CARDS = Object.keys(MANUAL);

// ---- where a card is -------------------------------------------------------------------------
/** A card on someone's table is seen from that player's side; anything else is a card in the viewer's hand. */
export function placeOf(world: HintWorld, name: string): HintViewer | null {
  const holder = world.players.find((p) => p.cards.some((c) => c.name === name));
  if (holder) return {owner: holder.id, place: 'table'};
  return world.me ? {owner: world.me, place: 'hand'} : null;
}

export function hintsFor(world: HintWorld | null | undefined, card: CardDef): CardHint[] {
  if (!world) return [];
  const v = placeOf(world, card.name);
  return v ? cardHints(card, world, v) : [];
}

// ---- worlds ----------------------------------------------------------------------------------
const CITY_TILES = new Set([2, 3, 20, 37, 43]);
const OCEAN_TILES = new Set([1, 20, 21, 22, 36, 43]);
const GREENERY_TILES = new Set([0, 36]);

function engineTags(p: PublicPlayerModel): Partial<Record<Tag, number>> {
  const raw = p.tags;
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((t) => [t.tag, t.count]));
  if (raw && typeof raw === 'object') return {...raw} as Partial<Record<Tag, number>>;
  return tagsFromCards(p.tableau.map((c) => c.name));
}

/** Face-up tags from card names: events keep only their event tag. */
export function tagsFromCards(names: string[]): Partial<Record<Tag, number>> {
  const out: Partial<Record<Tag, number>> = {};
  for (const n of names) {
    const d = findCard(n);
    if (!d) continue;
    for (const t of d.type === 'event' ? ['event' as Tag] : d.tags) out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

const units = (p: PublicPlayerModel, kind: 'stock' | 'production'): Units => kind === 'stock'
  ? {megacredits: p.megacredits, steel: p.steel, titanium: p.titanium, plants: p.plants, energy: p.energy, heat: p.heat}
  : {megacredits: p.megacreditProduction, steel: p.steelProduction, titanium: p.titaniumProduction, plants: p.plantProduction, energy: p.energyProduction, heat: p.heatProduction};

/** The engine's view for one phone (full games). Player ids are seat colours. */
export function hintWorldFromFull(model: PlayerViewModel): HintWorld {
  const spaces = model.game.spaces ?? [];
  const tiles = spaces.filter((s) => s.tileType !== undefined && s.tileType !== null);
  const onMars = (s: {spaceType: string; x: number}) => s.spaceType !== 'colony' && s.x >= 0;
  const players: HintPlayer[] = model.players.map((p) => ({
    id: p.color, name: p.name, tags: engineTags(p), tr: p.terraformRating,
    cards: p.tableau.map((c) => ({name: c.name, resources: c.resources ?? 0})),
    stock: units(p, 'stock'), production: units(p, 'production'),
    cities: {onMars: tiles.filter((s) => s.color === p.color && CITY_TILES.has(s.tileType!) && onMars(s)).length,
      offMars: tiles.filter((s) => s.color === p.color && CITY_TILES.has(s.tileType!) && !onMars(s)).length},
    greeneries: tiles.filter((s) => s.color === p.color && GREENERY_TILES.has(s.tileType!)).length,
  }));
  const oceanTiles = tiles.filter((s) => OCEAN_TILES.has(s.tileType!)).length;
  const hand = [...model.cardsInHand, ...(model.dealtProjectCards ?? []), ...(model.draftedCards ?? [])].map((c) => c.name);
  let cells: ReturnType<typeof layout>['cells'] | null = null;
  return {
    me: model.color, players, hand,
    global: {temperature: model.game.temperature, oxygen: model.game.oxygenLevel, oceans: Math.max(model.game.oceans, oceanTiles), venus: model.game.venusScaleLevel},
    nextTo: (owner, tileType) => {
      cells ??= layout(spaces).cells;
      const at = cells.find((c) => c.space.tileType === tileType && c.space.color === owner);
      if (!at) return undefined;
      const near = cells.filter((c) => c !== at && Math.hypot(c.cx - at.cx, c.cy - at.cy) < HEX_W * 1.05);
      return {city: near.filter((c) => c.space.tileType !== undefined && CITY_TILES.has(c.space.tileType)).length,
        ocean: near.filter((c) => c.space.tileType !== undefined && OCEAN_TILES.has(c.space.tileType)).length};
    },
  };
}

/** Our own game state (companion games: the physical board is the game, so no tile positions). */
export function hintWorldFromCompanion(state: GameState, me: string | null): HintWorld {
  const players: HintPlayer[] = state.players.map((p) => ({
    id: p.id, name: p.name, tr: p.tr, stock: p.stock, production: p.production,
    tags: tagsFromCards([...(p.corporation ? [p.corporation] : []), ...p.played.map((c) => c.name)]),
    cards: [...(p.corporation ? [{name: p.corporation, resources: 0}] : []), ...p.played.map((c) => ({name: c.name, resources: c.resources}))],
    cities: {onMars: p.tiles.cityOnMars, offMars: p.tiles.cityOffMars}, greeneries: p.tiles.greenery,
  }));
  return {me, players, hand: [], global: {...state.global}};
}
