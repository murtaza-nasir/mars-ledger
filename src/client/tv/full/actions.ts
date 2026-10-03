// Card actions on the full-game TV: which blue-card (or corporation) actions a player has, which they used this
// generation, and what using one changed. The signal is the engine's `actionsThisGeneration`: it gains a card's name
// when a player takes that card's action (Player.playActionCard). Standard projects and standard actions are tracked
// elsewhere in the engine, so they never appear here.
import {findCard} from '../../../shared/cards';
import {TILE_NAME, tileKind} from '../../../shared/full';
import type {Color, PublicPlayerModel, SpectatorModel} from '../../../shared/full';
import type {Resource} from '../../../shared/types';
import {isRewind} from '../../../shared/sync';

const RESOURCES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];
const PROD: Record<Resource, keyof PublicPlayerModel> = {
  megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction',
};
const WORD: Record<Resource, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};
/** "1 plant", "3 plants"; the other resource words do not change. */
const word = (r: Resource, n: number) => (r === 'plants' && n === 1 ? 'plant' : WORD[r]);

/** Whether a card on the table has an action ("Action: …" in its text). Standard projects/actions never count. */
export function hasAction(name: string): boolean {
  const d = findCard(name);
  if (!d || d.group === 'standardProject' || d.group === 'standardAction') return false;
  return d.text.some((t) => /^Action:/i.test(t));
}

/** The player's action cards in table order, each with whether its action is used this generation. */
export function actionCards(p: PublicPlayerModel): Array<{name: string; used: boolean}> {
  const used = new Set(p.actionsThisGeneration ?? []);
  return p.tableau.filter((c) => hasAction(c.name)).map((c) => ({name: c.name, used: used.has(c.name)}));
}

export type ActionUse = {color: Color; cards: string[]};

/** Card actions taken between two models: card names new in a player's actionsThisGeneration. */
export function newActions(prev: SpectatorModel | null, next: SpectatorModel): ActionUse[] {
  if (!prev || prev.id !== next.id) return [];
  if (prev.game.generation !== next.game.generation || isRewind(prev.game, next.game)) return [];
  const out: ActionUse[] = [];
  for (const p of next.players) {
    const old = prev.players.find((x) => x.color === p.color);
    if (!old) continue;
    const had = new Set(old.actionsThisGeneration ?? []);
    const cards = (p.actionsThisGeneration ?? []).filter((n) => !had.has(n) && findCard(n) &&
      findCard(n)!.group !== 'standardProject' && findCard(n)!.group !== 'standardAction');
    if (cards.length) out.push({color: p.color, cards});
  }
  return out;
}

// ---- what an action changed ----------------------------------------------------------------------
export type Flight = {r: Resource; n: number; prod: boolean};
export type CardCount = {name: string; type?: string; from: number; to: number};
export type ActionSummary = {
  /** one line for the TV, e.g. "3 energy → 3 M€" or "+1 animal on Birds (now 4)" */
  line: string;
  /** the separate pieces, losses first */
  items: Array<{text: string; loss: boolean}>;
  /** gains that fly into the player's panel cells */
  flights: Flight[];
  /** resources added to (or taken from) the used cards themselves */
  onCards: CardCount[];
  empty: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "animal", "microbe", "science resource": a card resource word for a count. */
export function cardResWord(type: string | undefined, n: number): string {
  const t = (type ?? 'resource').toLowerCase();
  if (t === 'science') return plural(n, 'science resource');
  return plural(n, t);
}

const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');

/**
 * What changed for one player between two models: stock and production, TR, cards in hand, resources on their
 * cards, tiles they placed and the global parameters. Costs come first and the result after an arrow.
 */
export function summarizeAction(before: SpectatorModel, after: SpectatorModel, color: Color, used: string[] = []): ActionSummary {
  const p0 = before.players.find((p) => p.color === color);
  const p1 = after.players.find((p) => p.color === color);
  const items: Array<{text: string; conv: string; loss: boolean}> = [];
  const flights: Flight[] = [];
  const onCards: CardCount[] = [];
  if (!p0 || !p1) return {line: '', items: [], flights, onCards, empty: true};

  for (const r of RESOURCES) {
    const d = (p1[r] as number) - (p0[r] as number);
    if (d < 0) items.push({text: `−${-d} ${word(r, -d)}`, conv: `${-d} ${word(r, -d)}`, loss: true});
  }
  for (const r of RESOURCES) {
    const d = (p1[PROD[r]] as number) - (p0[PROD[r]] as number);
    if (d < 0) items.push({text: `${WORD[r]} production −${-d}`, conv: `${WORD[r]} production −${-d}`, loss: true});
  }
  // resources on the player's own cards (the used card first)
  const was = new Map(p0.tableau.map((c) => [c.name, c.resources ?? 0]));
  const cards = [...p1.tableau].sort((a, b) => Number(used.includes(b.name)) - Number(used.includes(a.name)));
  for (const c of cards) {
    const from = was.get(c.name);
    if (from === undefined) continue;
    const to = c.resources ?? 0;
    if (to === from) continue;
    const type = findCard(c.name)?.resourceType ?? undefined;
    onCards.push({name: c.name, type, from, to});
    const n = Math.abs(to - from);
    if (to < from) items.push({text: `−${n} ${cardResWord(type, n)} from ${c.name} (now ${to})`, conv: `${n} ${cardResWord(type, n)} from ${c.name} (now ${to})`, loss: true});
  }
  for (const c of onCards) {
    if (c.to <= c.from) continue;
    const n = c.to - c.from;
    items.push({text: `+${n} ${cardResWord(c.type, n)} on ${c.name} (now ${c.to})`, conv: `${n} ${cardResWord(c.type, n)} on ${c.name} (now ${c.to})`, loss: false});
  }
  // tiles this player placed
  const had = new Map(before.game.spaces.map((s) => [s.id, s.tileType]));
  const placed = after.game.spaces.filter((s) => s.tileType !== undefined && had.get(s.id) === undefined && (s.color === color || s.tileType === 1));
  for (const s of placed) {
    const k = tileKind(s.tileType);
    const name = k === 'special' ? TILE_NAME[s.tileType!] ?? 'a tile' : k === 'city' && s.tileType === 3 ? 'Capital' : k!;
    const what = k === 'special' || name === 'Capital' ? name : `${article(name)} ${name}`;
    items.push({text: `places ${what}`, conv: what, loss: false});
  }
  for (const r of RESOURCES) {
    const d = (p1[r] as number) - (p0[r] as number);
    if (d > 0) { items.push({text: `+${d} ${word(r, d)}`, conv: `${d} ${word(r, d)}`, loss: false}); flights.push({r, n: d, prod: false}); }
  }
  for (const r of RESOURCES) {
    const d = (p1[PROD[r]] as number) - (p0[PROD[r]] as number);
    if (d > 0) { items.push({text: `${WORD[r]} production +${d}`, conv: `${WORD[r]} production +${d}`, loss: false}); flights.push({r, n: d, prod: true}); }
  }
  const tr = p1.terraformRating - p0.terraformRating;
  if (tr > 0) items.push({text: `+${tr} TR`, conv: `${tr} TR`, loss: false});
  if (tr < 0) items.push({text: `−${-tr} TR`, conv: `${-tr} TR`, loss: true});
  const hand = p1.cardsInHandNbr - p0.cardsInHandNbr;
  if (hand > 0) items.push({text: `+${hand} ${plural(hand, 'card')}`, conv: `${hand} ${plural(hand, 'card')}`, loss: false});
  const g0 = before.game; const g1 = after.game;
  if (g1.oxygenLevel > g0.oxygenLevel) items.push({text: `oxygen +${g1.oxygenLevel - g0.oxygenLevel} %`, conv: `oxygen +${g1.oxygenLevel - g0.oxygenLevel} %`, loss: false});
  if (g1.temperature > g0.temperature) items.push({text: `temperature +${g1.temperature - g0.temperature} °C`, conv: `temperature +${g1.temperature - g0.temperature} °C`, loss: false});

  const losses = items.filter((i) => i.loss);
  const gains = items.filter((i) => !i.loss);
  const line = losses.length && gains.length
    ? `${losses.map((i) => i.conv).join(', ')} → ${gains.map((i) => i.conv).join(', ')}`
    : losses.length ? `Paid ${losses.map((i) => i.conv).join(', ')}, nothing gained`
      : items.map((i) => i.text).join(' · ');
  return {line, items: [...losses, ...gains].map(({text, loss}) => ({text, loss})), flights, onCards, empty: items.length === 0};
}

/** The card's own action text, for an action whose effect the models do not show (e.g. it looked at a card). */
export function actionText(name: string): string {
  const t = findCard(name)?.text.find((x) => /^Action:/i.test(x));
  return t ? t.replace(/^Action:\s*/i, '') : '';
}

// ---- turning model updates into moments ---------------------------------------------------------------
export type ActionMomentData = {color: Color; cards: string[]; summary: ActionSummary; line: string};

function finish(before: SpectatorModel, after: SpectatorModel, color: Color, cards: string[]): ActionMomentData {
  const summary = summarizeAction(before, after, color, cards);
  const line = summary.empty ? actionText(cards[0]) : summary.line;
  return {color, cards, summary, line};
}

/** A player's public numbers and own tiles, to tell whether anything of theirs changed. */
function footprint(m: SpectatorModel, color: Color): string {
  const p = m.players.find((x) => x.color === color);
  if (!p) return '';
  const nums = [...RESOURCES.map((r) => p[r]), ...RESOURCES.map((r) => p[PROD[r]]), p.terraformRating, p.cardsInHandNbr];
  const res = p.tableau.map((c) => `${c.name}:${c.resources ?? 0}`).join(',');
  const tiles = m.game.spaces.filter((s) => s.tileType !== undefined && s.color === color).length;
  return `${nums.join(',')}|${res}|${tiles}|${m.game.oceans}|${m.game.oxygenLevel}|${m.game.temperature}`;
}

/**
 * Watches consecutive spectator models and returns an action moment once each action's effect is known. An action
 * that asked its player a question (pick a card, an amount) shows its effect only in a later model: it waits until
 * that player's numbers change, and gives up (with the card's action text) when that player moves on to something
 * else, the turn passes, or the generation ends.
 */
export class ActionWatcher {
  private pending = new Map<Color, {before: SpectatorModel; cards: string[]}>();

  reset() { this.pending.clear(); }

  feed(prev: SpectatorModel | null, next: SpectatorModel): ActionMomentData[] {
    const out: ActionMomentData[] = [];
    if (!prev || prev.id !== next.id || isRewind(prev.game, next.game)) {
      this.pending.clear();
      return out;
    }
    const fresh = newActions(prev, next);
    const sameGen = prev.game.generation === next.game.generation;
    for (const [color, w] of [...this.pending]) {
      const p0 = prev.players.find((p) => p.color === color);
      const p1 = next.players.find((p) => p.color === color);
      const movedOn = !sameGen || fresh.some((f) => f.color === color) || !p1 ||
        p1.tableau.length !== p0?.tableau.length || (p0?.isActive && !p1.isActive);
      const changed = footprint(prev, color) !== footprint(next, color);
      if (changed && sameGen && !fresh.some((f) => f.color === color) && p1?.tableau.length === p0?.tableau.length) {
        out.push(finish(w.before, next, color, w.cards));
        this.pending.delete(color);
      } else if (movedOn) {
        out.push(finish(w.before, prev, color, w.cards));
        this.pending.delete(color);
      }
    }
    for (const f of fresh) {
      const m = finish(prev, next, f.color, f.cards);
      // Only a cost so far (Aquifer Pumping has paid and is choosing its space): wait for the result too.
      if (m.summary.empty || m.summary.items.every((i) => i.loss)) this.pending.set(f.color, {before: prev, cards: f.cards});
      else out.push(m);
    }
    return out;
  }
}
