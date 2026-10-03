// Hand tools for full games: sorting, filtering and synergy markers for the cards in a player's hand.
// Everything here is pure and conservative: a synergy is only reported when the card definitions (and,
// for discounts, the engine's own calculated cost) prove it. Nothing is guessed.
import {TAGS} from './types';
import type {Behavior, CardDef, CardResource, Tag, TileKind, Trigger} from './types';

// ---- sort and filter -------------------------------------------------------------------------

export const HAND_SORTS = ['playable', 'cost', 'type', 'tag'] as const;
export type HandSort = typeof HAND_SORTS[number];
/** 'all', 'playable', or a tag name. */
export type HandFilter = 'all' | 'playable' | Tag;
export type HandView = {sort: HandSort; filter: HandFilter};
export const DEFAULT_HAND_VIEW: HandView = {sort: 'playable', filter: 'all'};

export const SORT_LABEL: Record<HandSort, string> = {playable: 'Playable first', cost: 'Cost', type: 'Type', tag: 'Tag'};

/** A hand card as the tools see it: its definition, the engine's cost, and whether the engine offers it now. */
export type HandEntry = {name: string; def: CardDef; cost: number; playable: boolean};

const TYPE_ORDER: Record<string, number> = {automated: 0, active: 1, event: 2};
const tagRank = (d: CardDef) => (d.tags.length ? Math.min(...d.tags.map((t) => TAGS.indexOf(t))) : TAGS.length);

/** A stable order: ties fall back to cost, then name, so the deck never shuffles between updates. */
export function sortHand(entries: HandEntry[], sort: HandSort): HandEntry[] {
  const byCost = (a: HandEntry, b: HandEntry) => a.cost - b.cost || a.name.localeCompare(b.name);
  const out = [...entries];
  switch (sort) {
  case 'playable': out.sort((a, b) => Number(b.playable) - Number(a.playable) || byCost(a, b)); break;
  case 'cost': out.sort(byCost); break;
  case 'type': out.sort((a, b) => (TYPE_ORDER[a.def.type] ?? 3) - (TYPE_ORDER[b.def.type] ?? 3) || byCost(a, b)); break;
  case 'tag': out.sort((a, b) => tagRank(a.def) - tagRank(b.def) || byCost(a, b)); break;
  }
  return out;
}

export function filterHand(entries: HandEntry[], filter: HandFilter): HandEntry[] {
  if (filter === 'all') return entries;
  if (filter === 'playable') return entries.filter((e) => e.playable);
  return entries.filter((e) => e.def.tags.includes(filter));
}

/** Tags present in the hand (in the game's tag order) with how many cards carry each. */
export function handTagCounts(entries: HandEntry[]): Array<[Tag, number]> {
  const n = new Map<Tag, number>();
  for (const e of entries) for (const t of new Set(e.def.tags)) n.set(t, (n.get(t) ?? 0) + 1);
  return TAGS.filter((t) => n.has(t)).map((t) => [t, n.get(t)!]);
}

/** A stored view that still makes sense for this hand (a tag filter whose tag left the hand shows everything). */
export function effectiveView(view: HandView, entries: HandEntry[]): HandView {
  const sort = (HAND_SORTS as readonly string[]).includes(view.sort) ? view.sort : DEFAULT_HAND_VIEW.sort;
  let filter = view.filter;
  if (filter !== 'all' && filter !== 'playable' && !entries.some((e) => e.def.tags.includes(filter as Tag))) filter = 'all';
  return {sort, filter};
}

export function parseHandView(raw: string | null): HandView {
  try {
    const v = JSON.parse(raw ?? '') as Partial<HandView>;
    const sort = (HAND_SORTS as readonly string[]).includes(v.sort as string) ? v.sort as HandSort : DEFAULT_HAND_VIEW.sort;
    const okFilter = v.filter === 'all' || v.filter === 'playable' || (TAGS as readonly string[]).includes(v.filter as string);
    return {sort, filter: okFilter ? v.filter as HandFilter : DEFAULT_HAND_VIEW.filter};
  } catch {
    return DEFAULT_HAND_VIEW;
  }
}

// ---- synergy ---------------------------------------------------------------------------------

export type Synergy = {
  kind: 'discount' | 'trigger' | 'resources';
  /** the card in play that the hand card works with */
  source: string;
  /** one plain sentence, e.g. "Earth Office takes 3 M€ off its Earth tag." */
  reason: string;
};

const RES_WORD: Record<string, string> = {Animal: 'animals', Microbe: 'microbes', Floater: 'floaters', Science: 'science resources', Fighter: 'fighters'};
const resWord = (r: CardResource) => RES_WORD[r] ?? `${r.toLowerCase()} resources`;
const tagWord = (t: string) => (t === 'event' ? 'event' : t.charAt(0).toUpperCase() + t.slice(1));

/** The tiles a card's own play places for sure (top level only: an either/or choice proves nothing). */
function placedTiles(b: Behavior | null): Array<{tile: TileKind; onMars: boolean}> {
  if (!b) return [];
  const out: Array<{tile: TileKind; onMars: boolean}> = [];
  if (b.city) out.push({tile: 'city', onMars: !b.city.space});
  if (b.greenery) out.push({tile: 'greenery', onMars: true});
  if (b.ocean) for (let i = 0; i < (b.ocean.count ?? 1); i++) out.push({tile: 'ocean', onMars: true});
  if (b.tile) out.push({tile: 'special', onMars: true});
  return out;
}

/** Would this owned trigger fire, provably, when the player plays `card`? Mirrors the engine's `matches`. */
function triggerFires(t: Trigger, card: CardDef): boolean {
  if (t.scope === 'others') return false;
  if (t.when === 'cardPlayed') {
    // A trigger with no condition fires for every card: true but not a reason to prefer this one.
    if (!t.tags && !t.cardType && t.minCost === undefined && !t.hasVictoryPoints) return false;
    if (t.tags && !card.tags.some((x) => t.tags!.includes(x))) return false;
    if (t.cardType && card.type !== t.cardType) return false;
    if (t.minCost !== undefined && (card.cost ?? 0) < t.minCost) return false;
    if (t.hasVictoryPoints) {
      const vp = card.victoryPoints;
      if (vp === null || vp === undefined || (typeof vp === 'number' && vp < 0)) return false;
    }
    return true;
  }
  if (t.when === 'tilePlaced') {
    // Placement bonuses depend on the space chosen, so they are never provable from the card.
    if (t.bonusSteelOrTitanium) return false;
    return placedTiles(card.behavior).some((p) => (!t.tile || t.tile === p.tile) && (!t.tileOnMars || p.onMars));
  }
  return false;
}

function addedTypes(b: Behavior | null): Array<{type: CardResource; count: number}> {
  const spec = b?.addResourcesToAnyCard;
  if (!spec) return [];
  return [spec].flat().filter((s) => typeof s.type === 'string')
    .map((s) => ({type: s.type as CardResource, count: typeof s.count === 'number' ? s.count : 1}));
}

/**
 * How `card` (in hand) works with the cards the player has in play.
 * `engineCost` is the engine's calculatedCost for this hand card; a discount is only reported when it is
 * below the printed cost, which proves the discount applies.
 */
export function cardSynergies(card: CardDef, inPlay: CardDef[], engineCost?: number): Synergy[] {
  const out: Synergy[] = [];
  // (a) tag discounts the player owns
  if (card.group === 'project' && card.cost !== null && engineCost !== undefined && engineCost < card.cost) {
    for (const src of inPlay) {
      for (const d of src.cardDiscount) {
        if (!d.tag || !card.tags.includes(d.tag)) continue;
        out.push({kind: 'discount', source: src.name, reason: `${src.name} takes ${d.amount} M€ off its ${tagWord(d.tag)} tag.`});
      }
    }
  }
  // (b) triggers the player owns that this card sets off
  for (const src of inPlay) {
    for (const t of src.triggers) {
      if (!triggerFires(t, card)) continue;
      if (out.some((s) => s.kind === 'trigger' && s.source === src.name)) continue;
      out.push({kind: 'trigger', source: src.name, reason: `Playing it sets off ${src.name}: ${t.text}.`});
    }
  }
  // (c) resource targets, both ways
  for (const add of addedTypes(card.behavior)) {
    const homes = inPlay.filter((c) => c.resourceType === add.type);
    if (homes.length) {
      out.push({kind: 'resources', source: homes[0].name,
        reason: `It adds ${add.count} ${resWord(add.type)} to a card of yours (${homes.map((h) => h.name).join(', ')}).`});
    }
  }
  if (card.resourceType) {
    for (const src of inPlay) {
      // Only repeatable actions count: a one-off "add resources" on play has already happened.
      if (addedTypes(src.action).some((f) => f.type === card.resourceType)) {
        out.push({kind: 'resources', source: src.name, reason: `${src.name}'s action can add ${resWord(card.resourceType)} to it.`});
      }
    }
  }
  return out;
}
