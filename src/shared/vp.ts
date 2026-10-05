// Victory points in the phone's previews ("Show VP changes"). Pure, and private to the phone that computes it.
//
// Two sources, both the engine's own rules:
//  - a projected move (projection.ts) is run through the companion rules engine, and the VP each player holds before and
//    after is read from its state: terraform rating, greenery tiles, and every card's VP (fixed VP, VP per resource on the
//    card, per tag, per city: cardVP in engine.ts);
//  - the VP that depends on where a tile goes (a city scores 1 VP for each greenery next to it, a greenery gives each city
//    next to it 1 VP, a Capital scores 1 VP for each ocean next to it, a Commercial District 1 VP for each city next to it)
//    is read from the real board (the full engine's calculateVictoryPoints), once the space is known.
// What cannot be known yet (the space of a tile, award standings at the end of the game) is said so, never guessed.
import {findCard} from './cards';
import {GLOBAL} from './board';
import {awardPlaces, cardVP, cardsInPlay} from './engine';
import type {GameState, PlayerState} from './game';
import type {Color, PlayerViewModel, SpaceModel} from './full';
import {neighbours} from './projection';
import type {PreviewLine, Projection, Unknown, World} from './projection';

// the engine's TileType numbers (vendor/tm/src/common/TileType.ts)
const GREENERY_TILES = new Set([0, 36]); // greenery, wetlands
const CITY_TILES = new Set([2, 3, 20, 37, 43]); // city, capital, ocean city, red city, new holland
const OCEAN_TILES = new Set([1, 20, 21, 22, 36, 43]);
const CAPITAL = 3, COMMERCIAL_DISTRICT = 4;

export type TileKind = 'greenery' | 'city' | 'capital' | 'ocean' | 'special';

/** One bit of VP a placement gives: `source` says which rule it comes from. */
export type VpPart = {color: Color; vp: number; why: string; source: 'tile' | 'adjacent' | 'tr'};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The tile kind a space question is about, from its title ("Select space for city tile", "... for Capital tile"). */
export function tileKindFromTitle(title: string): TileKind {
  const t = title.toLowerCase();
  if (t.includes('ocean')) return 'ocean';
  if (t.includes('greenery')) return 'greenery';
  if (t.includes('capital')) return 'capital';
  if (t.includes('city')) return 'city';
  return 'special';
}

/**
 * The VP placing a tile on this space gives, on the board as it is now. Only VP that is certain today: a city counts
 * the greeneries already next to it (more may come later, and are counted when they do).
 * `game`: when given, the terraform rating the tile raises (a greenery raises oxygen, an ocean adds to the ocean count).
 */
export function placeVp(spaces: SpaceModel[], spaceId: string, kind: TileKind, me: Color,
  game?: {oxygenLevel: number; temperature: number; oceans: number}): VpPart[] {
  const sp = spaces.find((s) => s.id === spaceId);
  if (!sp) return [];
  const adj = neighbours(spaces, sp);
  const out: VpPart[] = [];
  if (kind === 'greenery') {
    out.push({color: me, vp: 1, why: 'greenery', source: 'tile'});
    for (const a of adj) {
      if (a.color && a.tileType !== undefined && CITY_TILES.has(a.tileType)) {
        out.push({color: a.color, vp: 1, why: a.color === me ? 'your city next to it' : 'city next to it', source: 'adjacent'});
      }
    }
  } else if (kind === 'city' || kind === 'capital') {
    const greeneries = adj.filter((a) => a.tileType !== undefined && GREENERY_TILES.has(a.tileType)).length;
    if (greeneries) out.push({color: me, vp: greeneries, why: `city next to ${plural(greeneries, 'greenery', 'greeneries')}`, source: 'tile'});
    if (kind === 'capital') {
      const oceans = adj.filter((a) => a.tileType !== undefined && OCEAN_TILES.has(a.tileType)).length;
      if (oceans) out.push({color: me, vp: oceans, why: `Capital next to ${plural(oceans, 'ocean', 'oceans')}`, source: 'tile'});
    }
    for (const a of adj) if (a.color && a.tileType === COMMERCIAL_DISTRICT) out.push({color: a.color, vp: 1, why: 'city next to Commercial District', source: 'adjacent'});
  } else if (kind === 'ocean') {
    for (const a of adj) if (a.color && a.tileType === CAPITAL) out.push({color: a.color, vp: 1, why: 'ocean next to Capital', source: 'adjacent'});
  }
  if (game) {
    if (kind === 'greenery' && game.oxygenLevel < GLOBAL.oxygen.max) {
      out.push({color: me, vp: 1, why: 'terraform rating, oxygen', source: 'tr'});
      // oxygen reaches 8: temperature rises a step
      if (game.oxygenLevel + 1 === 8 && game.temperature < GLOBAL.temperature.max) out.push({color: me, vp: 1, why: 'terraform rating, temperature', source: 'tr'});
    }
    if (kind === 'ocean' && game.oceans < GLOBAL.oceans.max) out.push({color: me, vp: 1, why: 'terraform rating, ocean', source: 'tr'});
  }
  return out;
}

const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);
const vpWord = (lo: number, hi: number) => (lo === hi ? `${signed(lo)} VP` : `${signed(lo)} to ${signed(hi)} VP`);

/** VP parts as preview lines: one per player and reason ("+1 VP (greenery)", "Ada +1 VP (city next to it)"). */
export function partLines(parts: VpPart[], me: Color, nameOf: (c: Color) => string): PreviewLine[] {
  const grouped = new Map<string, {color: Color; vp: number; why: string}>();
  for (const p of parts) {
    const k = `${p.color}|${p.why}`;
    const g = grouped.get(k);
    if (g) g.vp += p.vp; else grouped.set(k, {color: p.color, vp: p.vp, why: p.why});
  }
  const rows = [...grouped.values()].sort((a, b) => Number(b.color === me) - Number(a.color === me));
  return rows.map((g) => ({
    text: `${g.color === me ? '' : `${nameOf(g.color)} `}${vpWord(g.vp, g.vp)} (${g.why})`,
    tone: g.vp < 0 ? 'loss' as const : g.color === me ? 'gain' as const : 'info' as const,
  }));
}

/** The "VP" lines of a hovered space, for any tile question: what the tile scores and gives others, at this moment. */
export function spaceVpLines(model: PlayerViewModel, spaceId: string, kind: TileKind): PreviewLine[] {
  const me = model.color;
  const g = model.game;
  const parts = placeVp(g.spaces, spaceId, kind, me, {oxygenLevel: g.oxygenLevel, temperature: g.temperature, oceans: g.oceans});
  const name = (c: Color) => model.players.find((p) => p.color === c)?.name ?? c;
  const lines = partLines(parts, me, name);
  if (!lines.length) lines.push({text: kind === 'special' ? 'No VP change from this tile' : 'No VP change', tone: 'info'});
  return lines;
}

// ---- VP from a companion state ------------------------------------------------------------------------
type Held = {tr: number; greenery: number; cards: Map<string, number>};

function held(s: GameState, p: PlayerState): Held {
  const cards = new Map<string, number>();
  for (const c of cardsInPlay(p)) {
    const v = cardVP(s, p, c);
    if (v) cards.set(c.name, v);
  }
  return {tr: p.tr, greenery: p.tiles.greenery, cards};
}

/** What a card's VP is counted from, for the reason in brackets ("animals on Birds"), or its name. */
function cardWhy(name: string): string {
  const d = findCard(name);
  const vp = d?.victoryPoints;
  if (d && vp && typeof vp === 'object' && vp.resourcesHere) return `${(d.resourceType ?? 'resource').toLowerCase()}s on ${name}`;
  return name;
}

/** "Birds: 1 VP per animal" for a card just played (its VP grows as resources arrive); null for fixed or no VP. */
export function cardVpRule(name: string): string | null {
  const d = findCard(name);
  const vp = d?.victoryPoints;
  if (!d || !vp || typeof vp !== 'object') return null;
  const res = (d.resourceType ?? 'resource').toLowerCase();
  if (vp.resourcesHere && vp.ifAny !== undefined) return `${name}: ${vp.ifAny} VP if it holds any ${res}`;
  if (vp.resourcesHere) {
    const each = vp.each ?? 1, per = vp.per ?? 1;
    return each > 1 ? `${name}: ${each} VP per ${res}` : per === 1 ? `${name}: 1 VP per ${res}` : `${name}: 1 VP per ${per} ${res}s`;
  }
  if (vp.tag) return `${name}: 1 VP per ${vp.per ?? 1} ${vp.tag} tag${(vp.per ?? 1) === 1 ? '' : 's'}`;
  if (vp.cities) return `${name}: 1 VP per ${vp.per ?? 1} ${vp.all ? 'cities in play' : 'of your cities'}`;
  return null;
}

/**
 * The projection with the VP it changes added to its lines: yours and other players' (a city that gains a greenery
 * next to it, a card that counts every city). Where the outcomes disagree it is a range. `space`: the space chosen for
 * the move's first tile, which settles the VP that depends on the board. Awards are never counted: their standings are
 * not final until the game ends, so a change in them is said as such.
 */
export function withVp(w: World, p: Projection, opts: {space?: string; base?: GameState} = {}): Projection {
  if (!p.ok || p.move.kind === 'milestone' || p.move.kind === 'award') return p;
  const base = opts.base ?? w.state;
  const lines: PreviewLine[] = [];
  const unknowns: Unknown[] = [];
  const name = (c: string) => base.players.find((x) => x.id === c)?.name ?? c;
  const me = w.me as Color;

  for (const pl of base.players) {
    const before = held(base, pl);
    const afters = p.outcomes.map((o) => held(o, o.players.find((x) => x.id === pl.id) ?? pl));
    const sources: Array<{key: string; why: string; values: number[]}> = [
      {key: 'tr', why: 'terraform rating', values: afters.map((a) => a.tr - before.tr)},
      {key: 'greenery', why: 'greenery', values: afters.map((a) => a.greenery - before.greenery)},
    ];
    const names = new Set<string>([...before.cards.keys(), ...afters.flatMap((a) => [...a.cards.keys()])]);
    for (const c of names) sources.push({key: `card:${c}`, why: cardWhy(c), values: afters.map((a) => (a.cards.get(c) ?? 0) - (before.cards.get(c) ?? 0))});
    for (const s of sources) {
      const lo = Math.min(...s.values), hi = Math.max(...s.values);
      if (!lo && !hi) continue;
      const who = pl.id === me ? '' : `${pl.name} `;
      const why = s.key === 'greenery' && lo === hi && lo > 1 ? `${lo} greeneries` : s.why;
      lines.push({text: `${who}${vpWord(lo, hi)} (${why})`, tone: hi <= 0 ? 'loss' : lo >= 0 && pl.id === me ? 'gain' : lo >= 0 ? 'info' : 'unknown'});
    }
  }

  // the VP that rides on the board: exact once the space is known, a note until then
  const first = p.outcomes[0];
  const mePl = base.players.find((x) => x.id === me);
  const mine = first && mePl ? first.players.find((x) => x.id === me) : undefined;
  const cardName = p.move.kind === 'play' || p.move.kind === 'action' ? p.move.card : '';
  let kind: TileKind | null = null;
  if (mine && mePl) {
    if (mine.tiles.greenery > mePl.tiles.greenery) kind = 'greenery';
    else if (mine.tiles.cityOnMars > mePl.tiles.cityOnMars) kind = cardName === 'Capital' ? 'capital' : 'city';
    else if (first.global.oceans > base.global.oceans) kind = 'ocean';
  }
  const spaces = w.model.game.spaces;
  if (kind && opts.space && cardName !== 'Commercial District') {
    const parts = placeVp(spaces, opts.space, kind, me).filter((x) => x.source === 'adjacent' || (x.source === 'tile' && kind !== 'greenery'));
    lines.push(...partLines(parts, me, name));
  } else if (kind && p.tiles) {
    const anyCity = spaces.some((s) => s.tileType !== undefined && CITY_TILES.has(s.tileType));
    if (kind === 'greenery' && anyCity) unknowns.push({key: 'vp:tile', text: 'A greenery next to a city gives that city’s owner 1 VP, counted when you pick the space'});
    if (kind === 'city') unknowns.push({key: 'vp:tile', text: 'A city is worth 1 VP for each greenery next to it, counted when you pick the space'});
    if (kind === 'capital') unknowns.push({key: 'vp:tile', text: 'A Capital is worth 1 VP for each greenery and ocean next to it, counted when you pick the space'});
    if (kind === 'ocean' && spaces.some((s) => s.tileType === CAPITAL)) unknowns.push({key: 'vp:tile', text: 'An ocean next to a Capital gives its owner 1 VP, counted when you pick the space'});
  }
  if (cardName === 'Commercial District') unknowns.push({key: 'vp:cd', text: 'Commercial District is worth 1 VP for each city next to it, counted when you pick the space'});

  // a card just played whose VP grows with what is on it
  if (p.move.kind === 'play') {
    const rule = cardVpRule(p.move.card);
    if (rule) unknowns.push({key: 'vp:rule', text: rule});
  }

  // awards: standings are not final until the game ends
  for (const a of base.awards) {
    const places = (s: GameState) => awardPlaces(s, a.name).map((r) => `${r.player}:${r.place ?? 0}`).join(',');
    const was = places(base);
    if (p.outcomes.some((o) => places(o) !== was)) unknowns.push({key: `vp:award:${a.name}`, text: `The ${a.name} award standings may change. Its VP are not counted until the game ends`});
  }

  if (!lines.some((l) => /VP/.test(l.text))) lines.push({text: 'No VP change', tone: 'info'});
  return {...p, lines: [...p.lines, ...lines], unknowns: [...p.unknowns, ...unknowns]};
}
