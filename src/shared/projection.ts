// What a move would do, before it is made: the phone's effect preview ("−23 M€ · +1 heat production · places an ocean ·
// +1 TR") and the projected state a planned second action is chosen against. Pure, and private to the phone that
// computes it: nothing here is sent anywhere.
//
// The companion rules engine (engine.ts) does the work. A full game's PlayerViewModel is turned into a companion
// GameState (worldFromView); the move runs through apply() once for every way its open questions could be answered
// (which space, which option, whom to target, the top card of the deck), and only what every answer agrees on is
// claimed. Everything else is a range or "at least", with the reason in plain words. Card identities from the deck are
// never guessed: a draw is a count ("+2 cards (not known yet)").
//
// The full engine stays the authority: costs come from its calculatedCost (the companion's own cost is corrected by
// the difference), and a planned move is checked against the engine's real turn menu once it is due.
import {findCard} from './cards';
import {GLOBAL, HEAT_PER_TEMPERATURE, MILESTONE_COST, AWARD_COSTS, STANDARD_PROJECTS} from './board';
import type {BoardName} from './board';
import {allTags, apply, cardCost, NeedsInput, standardProjectCost, unmetRequirements} from './engine';
import type {Prompt} from './engine';
import type {Answer, Command, GameEvent, GameState, Payment, PlayerState} from './game';
import type {CardModel, Color, EnginePayment, PlayerInputModel, PlayerViewModel, PublicPlayerModel, SpaceModel} from './full';
import {RESOURCES} from './types';
import type {CardDef, Resource, Units} from './types';
import {HEX_W, layout} from './hexgeo';

// ---- moves -------------------------------------------------------------------------------------
/** A main action, as the phone names it. `project` is the engine's standard-project card name ('Power Plant:SP'). */
export type Move =
  | {kind: 'play'; card: string; payment?: Partial<EnginePayment>}
  | {kind: 'standard'; project: string; payment?: Partial<EnginePayment>}
  | {kind: 'action'; card: string}
  | {kind: 'plants'}
  | {kind: 'heat'}
  | {kind: 'milestone'; name: string}
  | {kind: 'award'; name: string};

/** Engine standard-project card names and the companion's project ids. */
export const SP_IDS: Record<string, string> = {
  'Power Plant:SP': 'powerPlant', 'Asteroid:SP': 'asteroid', 'Aquifer': 'aquifer', 'Greenery': 'greenery', 'City': 'city',
};

export function moveLabel(m: Move): string {
  switch (m.kind) {
  case 'play': return `Play ${m.card}`;
  case 'standard': return `Build ${(STANDARD_PROJECTS.find((s) => s.id === SP_IDS[m.project])?.name ?? m.project.replace(/:SP$/, '')).toLowerCase()}`;
  case 'action': return `Use ${m.card}`;
  case 'plants': return 'Turn plants into a greenery';
  case 'heat': return 'Turn heat into temperature';
  case 'milestone': return `Claim ${m.name}`;
  case 'award': return `Fund ${m.name}`;
  }
}

export const sameMove = (a: Move, b: Move) => a.kind === b.kind && moveKey(a) === moveKey(b);
export function moveKey(m: Move): string {
  return m.kind === 'play' || m.kind === 'action' ? `${m.kind}:${m.card}` : m.kind === 'standard' ? `standard:${m.project}`
    : m.kind === 'milestone' || m.kind === 'award' ? `${m.kind}:${m.name}` : m.kind;
}

// ---- the companion state for a full game --------------------------------------------------------
const PROD_KEY: Record<Resource, keyof PublicPlayerModel> = {
  megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction',
};
const CITY_TILES = new Set([2, 3, 20]); // city, capital, ocean city
const GREENERY = 0, OCEAN = 1;

/** A companion state built from one player's full-game view, with what is needed to read projections back. */
export type World = {
  state: GameState;
  /** the viewing player's id in `state` (their colour) */
  me: string;
  board: BoardName;
  /** the full engine's card cost minus the companion's, per card the view prices (hand cards, standard projects) */
  costFix: Map<string, number>;
  /** the full model the world came from */
  model: PlayerViewModel;
  /** what the engine's turn menu offers right now (null when no turn menu is open) */
  engineNow: EngineNow | null;
};

/** The engine's own verdicts in the current turn menu. */
export type EngineNow = {playable: Set<string>; standard: Set<string>; actions: Set<string>; plants: boolean; heat: boolean};

function engineNowOf(w: PlayerInputModel | undefined): EngineNow | null {
  if (!w || w.type !== 'or') return null;
  const opts = w.options as PlayerInputModel[];
  const text = (t: unknown) => (typeof t === 'string' ? t : (t as {message?: string} | undefined)?.message ?? '').toLowerCase();
  if (!opts.some((o) => /^pass|^end turn/.test(text(o.title))) && !/^take your/.test(text(w.title))) return null;
  const out: EngineNow = {playable: new Set(), standard: new Set(), actions: new Set(), plants: false, heat: false};
  for (const o of opts) {
    const t = text(o.title);
    const cards = ((o as {cards?: CardModel[]}).cards ?? []).filter((c) => !c.isDisabled).map((c) => c.name);
    if (o.type === 'projectCard') for (const c of cards) (t.includes('standard') ? out.standard : out.playable).add(c);
    else if (o.type === 'card' && (o as {selectBlueCardAction?: boolean}).selectBlueCardAction) for (const c of cards) out.actions.add(c);
    else if (t.includes('plants') && t.includes('greenery')) out.plants = true;
    else if (t.includes('heat') && t.includes('temperature')) out.heat = true;
  }
  return out;
}

const zero = (): Units => ({megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0});

function playerFrom(p: PublicPlayerModel, model: PlayerViewModel, me: boolean): PlayerState {
  const stock = zero(), production = zero();
  for (const r of RESOURCES) { stock[r] = p[r] as number; production[r] = p[PROD_KEY[r]] as number; }
  const corp = p.tableau.find((c) => findCard(c.name)?.group === 'corporation')?.name ?? null;
  const played = p.tableau.filter((c) => c.name !== corp && findCard(c.name)).map((c) => ({name: c.name, resources: c.resources ?? 0, generation: 0}));
  const tiles = {cityOnMars: 0, cityOffMars: 0, greenery: 0, special: 0, oceans: 0};
  for (const s of model.game.spaces) {
    if (s.color !== p.color || s.tileType === undefined) continue;
    if (CITY_TILES.has(s.tileType)) { if (s.spaceType === 'colony') tiles.cityOffMars++; else tiles.cityOnMars++; }
    else if (s.tileType === GREENERY) tiles.greenery++;
    else if (s.tileType === OCEAN) tiles.oceans++;
    else tiles.special++;
  }
  const inPlay = [corp, ...played.map((c) => c.name)].map((n) => (n ? findCard(n) : undefined)).filter((d): d is CardDef => !!d);
  const greeneryCost = 8 - inPlay.reduce((a, d) => a + (d.behavior?.greeneryDiscount ?? 0), 0);
  // A corporation's first action is done by the time its owner has a turn menu.
  const usedActions = [...p.actionsThisGeneration, ...(corp && findCard(corp)?.firstAction ? [`first:${corp}`] : [])];
  return {
    id: p.color, name: p.name, color: p.color as PlayerState['color'], corporation: corp, tr: p.terraformRating, stock, production,
    steelValue: p.steelValue, titaniumValue: p.titaniumValue, greeneryCost, played, usedActions, tiles,
    milestones: model.game.milestones.filter((m) => m.color === p.color).map((m) => m.name),
    handSize: me ? model.cardsInHand.length : p.cardsInHandNbr, ready: false, passed: model.game.passedPlayers.includes(p.color),
    turnActions: me ? p.actionsTakenThisRound : 0, nextCardRequirementBonus: 0, nextCardDiscount: 0,
    // UNMI's action needs TR raised this generation: the engine offering it says so
    trRaisedGeneration: me && actionOffered(model.waitingFor, 'United Nations Mars Initiative') ? model.game.generation : undefined,
  };
}

function actionOffered(w: PlayerInputModel | undefined, name: string): boolean {
  if (!w || w.type !== 'or') return false;
  return (w.options as PlayerInputModel[]).some((o) => o.type === 'card' && (o as {selectBlueCardAction?: boolean}).selectBlueCardAction &&
    ((o as {cards?: CardModel[]}).cards ?? []).some((c) => c.name === name && !c.isDisabled));
}

export function worldFromView(model: PlayerViewModel): World {
  const g = model.game;
  const board = (['tharsis', 'hellas', 'elysium'].includes(g.gameOptions?.boardName ?? '') ? g.gameOptions!.boardName : 'tharsis') as BoardName;
  const me = model.thisPlayer.color;
  const players = model.players.map((p) => playerFrom(p.color === me ? {...p, ...model.thisPlayer} : p, model, p.color === me));
  const state: GameState = {
    id: 'projection', phase: 'action', modules: ['base', 'corpera', ...(g.gameOptions?.expansions?.prelude ? ['prelude'] : [])],
    players, order: [me], current: me, generation: g.generation,
    global: {temperature: g.temperature, oxygen: g.oxygenLevel, oceans: g.oceans, venus: g.venusScaleLevel ?? 0},
    awards: g.awards.filter((a) => a.color).map((a) => ({name: a.name, fundedBy: a.color!})),
    milestones: g.milestones.filter((m) => m.color).map((m) => ({name: m.name, claimedBy: m.color!})),
    seq: 0, startedAt: null, endedAt: null, mode: 'companion', board,
  };
  const p = players.find((x) => x.id === me)!;
  const costFix = new Map<string, number>();
  for (const c of model.cardsInHand) {
    const d = findCard(c.name);
    if (d && c.calculatedCost !== undefined) costFix.set(c.name, c.calculatedCost - cardCost(p, d));
  }
  for (const o of (model.waitingFor?.type === 'or' ? model.waitingFor.options as PlayerInputModel[] : [])) {
    if (o.type !== 'projectCard') continue;
    for (const c of (o as {cards: CardModel[]}).cards) {
      const id = SP_IDS[c.name];
      if (id && c.calculatedCost !== undefined) costFix.set(c.name, c.calculatedCost - standardProjectCost(p, id));
      else if (!costFix.has(c.name) && c.calculatedCost !== undefined && findCard(c.name)) costFix.set(c.name, c.calculatedCost - cardCost(p, findCard(c.name)!));
    }
  }
  return {state, me, board, costFix, model, engineNow: engineNowOf(model.waitingFor)};
}

const meOf = (w: World, s: GameState = w.state) => s.players.find((x) => x.id === w.me)!;

/** The full engine's price for a card or standard project in this world (its own discounts as the engine counts them). */
export function priceIn(w: World, move: Move, s: GameState = w.state): number {
  const p = meOf(w, s);
  if (move.kind === 'play') {
    const d = findCard(move.card);
    return d ? Math.max(0, cardCost(p, d) + (w.costFix.get(move.card) ?? 0)) : 0;
  }
  if (move.kind === 'standard') return Math.max(0, standardProjectCost(p, SP_IDS[move.project]) + (w.costFix.get(move.project) ?? 0));
  return 0;
}

// ---- payment ------------------------------------------------------------------------------------
/** The payment the play sheet suggests: titanium, then steel, then M€, then heat; a metal rounds up when M€ cannot cover the rest. */
export function defaultPayment(me: {megacredits: number; steel: number; titanium: number; heat: number; steelValue: number; titaniumValue: number},
  cost: number, can: {steel: boolean; titanium: boolean; heat: boolean}): {megacredits: number; steel: number; titanium: number; heat: number} {
  const sv = me.steelValue, tv = me.titaniumValue;
  let left = cost;
  const t = can.titanium ? Math.min(me.titanium, Math.floor(left / tv)) : 0; left -= t * tv;
  const s = can.steel ? Math.min(me.steel, Math.floor(left / sv)) : 0; left -= s * sv;
  let mc = Math.min(me.megacredits, left); left -= mc;
  let h = can.heat ? Math.min(me.heat, left) : 0; left -= h;
  let t2 = t, s2 = s;
  if (left > 0 && can.titanium && me.titanium > t2) { t2++; left -= tv; }
  if (left > 0 && can.steel && me.steel > s2) { s2++; left -= sv; }
  if (left < 0) { const back = Math.min(mc, -left); mc -= back; left += back; if (left < 0 && h) { h = Math.max(0, h + left); } }
  return {steel: s2, titanium: t2, heat: h, megacredits: mc};
}

/** The most a player can put toward a card: M€, steel on building tags, titanium on space tags, heat when it pays, microbes on plant cards. */
export function reach(p: PlayerState, def: CardDef | null): number {
  const tags = def?.tags ?? [];
  const heat = canHeat(p) ? p.stock.heat : 0;
  let n = p.stock.megacredits + heat + (tags.includes('building') ? p.stock.steel * p.steelValue : 0) + (tags.includes('space') ? p.stock.titanium * p.titaniumValue : 0);
  for (const pc of p.played) {
    const d = findCard(pc.name);
    if (d?.payWithResources && tags.includes(d.payWithResources.tag)) n += pc.resources * d.payWithResources.value;
  }
  return n;
}
const canHeat = (p: PlayerState) => [p.corporation, ...p.played.map((c) => c.name)].some((n) => n && findCard(n)?.heatAsMC);

function paymentFor(w: World, s: GameState, move: Move, cost: number): Payment {
  const p = meOf(w, s);
  const given = move.kind === 'play' || move.kind === 'standard' ? move.payment : undefined;
  if (given) {
    return {megacredits: given.megacredits ?? 0, steel: given.steel ?? 0, titanium: given.titanium ?? 0, heat: given.heat ?? 0,
      ...(given.microbes ? {cardResources: given.microbes} : {})};
  }
  const def = move.kind === 'play' ? findCard(move.card) ?? null : null;
  const pay = defaultPayment({megacredits: p.stock.megacredits, steel: p.stock.steel, titanium: p.stock.titanium, heat: p.stock.heat,
    steelValue: p.steelValue, titaniumValue: p.titaniumValue}, cost,
  {steel: !!def?.tags.includes('building'), titanium: !!def?.tags.includes('space'), heat: canHeat(p)});
  // Microbes on Psychrophiles cover plant cards when the rest falls short.
  const value = pay.megacredits + pay.steel * p.steelValue + pay.titanium * p.titaniumValue + pay.heat;
  if (value < cost && def) {
    for (const pc of p.played) {
      const d = findCard(pc.name);
      if (d?.payWithResources && def.tags.includes(d.payWithResources.tag)) {
        return {...pay, cardResources: Math.min(pc.resources, Math.ceil((cost - value) / d.payWithResources.value))};
      }
    }
  }
  return pay;
}

/** The command(s) a move becomes. A card action that may be paid partly with metal is tried both ways. */
function commandsFor(w: World, s: GameState, move: Move): Command[] | {error: string} {
  const playerId = w.me;
  switch (move.kind) {
  case 'play': {
    const d = findCard(move.card);
    if (!d) return {error: 'This card is not one the phone knows'};
    const p = meOf(w, s);
    // the engine's price: the companion's own cost is moved onto it through the one-shot discount
    const want = priceIn(w, move, s);
    p.nextCardDiscount = 0;
    p.nextCardDiscount = cardCost(p, d) - want;
    return [{t: 'playCard', playerId, card: move.card, payment: paymentFor(w, s, move, want), answers: []}];
  }
  case 'standard': {
    const id = SP_IDS[move.project];
    if (!id) return {error: 'This standard project is not one the phone knows'};
    return [{t: 'standardProject', playerId, project: id, payment: paymentFor(w, s, move, priceIn(w, move, s)), answers: []}];
  }
  case 'action': {
    const d = findCard(move.card);
    const p = meOf(w, s);
    const spend = d?.action?.spend;
    const mc = spend?.megacredits ?? 0;
    const plain: Command = {t: 'action', playerId, card: move.card, payment: {}, answers: []};
    if (!mc || !(spend?.canUseSteel && p.stock.steel || spend?.canUseTitanium && p.stock.titanium)) return [plain];
    const metal = defaultPayment({megacredits: p.stock.megacredits, steel: p.stock.steel, titanium: p.stock.titanium, heat: 0,
      steelValue: p.steelValue, titaniumValue: p.titaniumValue}, mc, {steel: !!spend.canUseSteel, titanium: !!spend.canUseTitanium, heat: false});
    return [plain, {...plain, payment: metal}];
  }
  case 'plants': return [{t: 'convertPlants', playerId, answers: []}];
  case 'heat': return [{t: 'convertHeat', playerId, answers: []}];
  case 'milestone': return [{t: 'claimMilestone', playerId, milestone: move.name}];
  case 'award': return [{t: 'fundAward', playerId, award: move.name}];
  }
}

// ---- exploring the open questions ---------------------------------------------------------------
/** Why a value is not known: the kinds of question that branched. */
export type Unknown = {key: string; text: string};

type Leaf = {state: GameState; events: GameEvent[]; prompts: Prompt[]; tileBlind: boolean};
type Explored = {leaves: Leaf[]; errors: string[]; unknowns: Unknown[]; truncated: boolean; tiles: Array<'city' | 'greenery' | 'ocean' | 'special'>};

const MAX_LEAVES = 96;
/** A stand-in placement bonus for a space nobody has chosen yet: every resource a space can give, a little. */
const ANY_BONUS: Partial<Units> & {cards?: number} = {steel: 1, titanium: 1, plants: 1, heat: 1, megacredits: 2, cards: 1};

export type Known = {
  /** the space chosen for the move's first tile (its bonus is then counted) */
  space?: string;
};

function promptUnknown(pr: Prompt, w: World): Unknown | null {
  switch (pr.kind) {
  case 'tile': return null; // reported per tile below
  case 'or': return {key: `or:${pr.options.join('|')}`, text: `You choose one: ${pr.options.map(lowerFirst).join(' or ')}`};
  case 'player': {
    const dec = /^Decrease any (.+) production (\d+) steps?$/.exec(pr.title);
    if (dec) return {key: `target:${pr.title}`, text: `Another player loses ${dec[2]} ${dec[1]} production (you choose who)`};
    const steal = /^Steal up to (\d+) (.+)$/.exec(pr.title);
    if (steal) return {key: 'steal', text: `Takes up to ${steal[1]} ${steal[2]} from another player: how much depends on whom you choose`};
    const rem = /^Remove up to (\d+) (.+) from any player$/.exec(pr.title);
    if (rem) return {key: `remove:${pr.title}`, text: `Removes up to ${rem[1]} ${rem[2]} from another player (you choose who)`};
    return {key: `player:${pr.title}`, text: `${pr.title} (you choose who)`};
  }
  case 'card': return {key: `card:${pr.title}`, text: `${pr.title}: you choose the card`};
  case 'yesno': return /reveal|top card/i.test(pr.title) ? {key: 'deck', text: 'Depends on the top card of the deck'}
    : {key: `yes:${pr.title}`, text: `Your choice: ${lowerFirst(pr.title.replace(/\?$/, ''))}`};
  case 'resource': return {key: 'resource', text: 'You choose which resource'};
  case 'amount': return {key: `amount:${pr.title}`, text: `You choose how many: ${lowerFirst(pr.title.replace(/\?$/, ''))}`};
  case 'manual': return {key: `manual:${pr.text}`, text: `Not counted here: ${pr.text}`};
  case 'pickCard': return {key: 'pick', text: 'Depends on a card drawn from the deck'};
  }
  void w;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function answersFor(pr: Prompt, w: World, s: GameState, known: Known, tileIndex: number): Array<{a: Answer; blind?: boolean}> {
  switch (pr.kind) {
  case 'or': return pr.options.slice(0, 8).map((_, index) => ({a: {kind: 'or', index}}));
  case 'player': {
    // Attacks aim at another player when there is one; "up to" effects may also take nobody.
    const others = pr.candidates.filter((c) => c !== w.me);
    const pool = others.length ? others : pr.candidates;
    return [...pool.map((playerId) => ({a: {kind: 'player', playerId} as Answer})), ...(pr.allowNone ? [{a: {kind: 'player', playerId: null} as Answer}] : [])];
  }
  case 'card': return pr.candidates.slice(0, 6).map((c) => ({a: {kind: 'card', owner: c.owner, card: c.card}}));
  case 'tile': {
    if (tileIndex === 0 && known.space) {
      const b = spaceBonus(w.model, known.space);
      if (b) return [{a: {kind: 'tile', bonus: b.bonus, onMars: true}}];
    }
    return [{a: {kind: 'tile', bonus: {}, onMars: true}, blind: true}, {a: {kind: 'tile', bonus: ANY_BONUS, onMars: true}, blind: true}];
  }
  case 'yesno': return [{a: {kind: 'yesno', yes: true}}, {a: {kind: 'yesno', yes: false}}];
  case 'resource': return pr.options.map((resource) => ({a: {kind: 'resource', resource}}));
  case 'amount': {
    const vals = pr.max - pr.min <= 3 ? Array.from({length: pr.max - pr.min + 1}, (_, i) => pr.min + i) : [pr.min, Math.floor((pr.min + pr.max) / 2), pr.max];
    return vals.map((value) => ({a: {kind: 'amount', value}}));
  }
  case 'manual': return [{a: {kind: 'ack'}}];
  case 'pickCard': return [];
  }
  void s;
}

function explore(w: World, move: Move, known: Known, base: GameState = w.state): Explored | {error: string} {
  const s0 = structuredClone(base);
  const cmds = commandsFor(w, s0, move);
  if ('error' in cmds) return cmds;
  const out: Explored = {leaves: [], errors: [], unknowns: [], truncated: false, tiles: []};
  const seenUnknown = new Set<string>();
  if (cmds.length > 1) { seenUnknown.add('pay'); out.unknowns.push({key: 'pay', text: 'You may pay part of it with metal'}); }
  const stack: Array<{cmd: Command; answers: Answer[]; prompts: Prompt[]; blind: boolean}> = cmds.map((cmd) => ({cmd, answers: [], prompts: [], blind: false}));
  let steps = 0;
  while (stack.length) {
    if (++steps > 600 || out.leaves.length >= MAX_LEAVES) { out.truncated = true; break; }
    const node = stack.shift()!;
    try {
      const r = apply(s0, node.cmd, node.answers);
      out.leaves.push({state: r.state, events: r.events, prompts: node.prompts, tileBlind: node.blind});
    } catch (e) {
      if (e instanceof NeedsInput) {
        const pr = e.prompt;
        const tileIndex = node.prompts.filter((p) => p.kind === 'tile').length;
        if (pr.kind === 'tile' && !out.tiles[tileIndex]) out.tiles[tileIndex] = pr.tile;
        const u = promptUnknown(pr, w);
        if (u && !seenUnknown.has(u.key)) { seenUnknown.add(u.key); out.unknowns.push(u); }
        const choices = answersFor(pr, w, s0, known, tileIndex);
        if (!choices.length) { out.truncated = true; continue; }
        // breadth first, the stand-in answers after the plain ones: the first leaf is the lower bound
        for (const c of choices) stack.push({cmd: node.cmd, answers: [...node.answers, c.a], prompts: [...node.prompts, pr], blind: node.blind || !!c.blind});
      } else out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

// ---- reading a projection back ------------------------------------------------------------------
/** A projected number: exact when lo === hi; hi Infinity reads "at least lo". */
export type Range = {lo: number; hi: number};
const exact = (n: number): Range => ({lo: n, hi: n});
export const isExact = (r: Range) => r.lo === r.hi;

export type Snapshot = {
  stock: Record<Resource, Range>;
  production: Record<Resource, Range>;
  tr: Range;
  /** cards in hand */
  hand: Range;
  /** of those, cards that come from the deck during the move: never named */
  drawn: Range;
  tags: Record<string, number>;
  global: {temperature: Range; oxygen: Range; oceans: Range};
  /** resources on your cards, by card name */
  cardResources: Record<string, Range>;
};

export type PreviewLine = {text: string; tone: 'cost' | 'gain' | 'loss' | 'info' | 'unknown'};

export type Projection =
  | {ok: true; move: Move; cost: number; before: Snapshot; after: Snapshot; lines: PreviewLine[]; unknowns: Unknown[];
      /** the move's possible results (each a companion state), for checking a second move against */
      outcomes: GameState[];
      /** some answers were left out (too many to try): only what the tried ones agree on is claimed, and that is marked */
      partial: boolean;
      /** a tile goes on a space not chosen yet: its bonus is open */
      open?: boolean;
      /** the move places tiles */
      tiles?: number;
      /** Helion: heat that may go toward M€ costs inside the move (a second heat conversion may then fall short) */
      helion?: number}
  | {ok: false; move: Move; reason: string;
      /** the engine offers the move but the phone cannot work it out: nothing is claimed */
      unpreviewable?: boolean};

function snap(w: World, s: GameState, events: GameEvent[] = [], play = false, handBefore?: number): Omit<Snapshot, 'drawn'> & {drawn: number} {
  const p = meOf(w, s);
  const stock = {} as Record<Resource, Range>, production = {} as Record<Resource, Range>;
  for (const r of RESOURCES) { stock[r] = exact(p.stock[r]); production[r] = exact(p.production[r]); }
  let drawn = 0;
  for (const e of events) {
    if (e.kind !== 'note' || e.player !== w.me) continue;
    const m = /^Draw (\d+) cards?.*?(?:, keep (\d+))?$/.exec(e.text);
    if (m) drawn += Number(m[2] ?? m[1]);
  }
  if (handBefore !== undefined) drawn = Math.max(drawn, p.handSize - handBefore + (play ? 1 : 0));
  return {stock, production, tr: exact(p.tr), hand: exact(p.handSize), drawn, tags: allTags(p),
    global: {temperature: exact(s.global.temperature), oxygen: exact(s.global.oxygen), oceans: exact(s.global.oceans)},
    cardResources: Object.fromEntries(p.played.filter((c) => findCard(c.name)?.resourceType).map((c) => [c.name, exact(c.resources)]))};
}

function merge(a: Range, b: Range): Range { return {lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi)}; }

/** What every outcome agrees on; where they differ, the range. With a blind tile, a value that differs is "at least". */
function combine(snaps: Array<ReturnType<typeof snap>>, blind: boolean[], hellasTile: boolean): Snapshot {
  const first = snaps[0];
  const out: Snapshot = {stock: {...first.stock}, production: {...first.production}, tr: first.tr, hand: first.hand, drawn: exact(first.drawn),
    tags: first.tags, global: {...first.global}, cardResources: {...first.cardResources}};
  const anyBlind = blind.some(Boolean);
  // A space nobody has chosen may give more than the stand-in bonus: a value that differs between outcomes is open upward.
  const open = (r: Range): Range => (r.lo !== r.hi ? {lo: r.lo, hi: Infinity} : r);
  for (let i = 1; i < snaps.length; i++) {
    const s = snaps[i];
    for (const r of RESOURCES) { out.stock[r] = merge(out.stock[r], s.stock[r]); out.production[r] = merge(out.production[r], s.production[r]); }
    out.tr = merge(out.tr, s.tr); out.hand = merge(out.hand, s.hand); out.drawn = merge(out.drawn, exact(s.drawn));
    for (const k of ['temperature', 'oxygen', 'oceans'] as const) out.global[k] = merge(out.global[k], s.global[k]);
    for (const k of Object.keys(out.cardResources)) out.cardResources[k] = merge(out.cardResources[k], s.cardResources[k] ?? exact(0));
  }
  if (anyBlind) {
    for (const r of RESOURCES) { out.stock[r] = open(out.stock[r]); out.production[r] = open(out.production[r]); }
    out.hand = open(out.hand); out.drawn = open(out.drawn);
    // Hellas: a tile on the south-pole space may pay 6 M€ for an extra ocean (the player's choice)
    if (hellasTile) out.stock.megacredits = {lo: out.stock.megacredits.lo - 6, hi: Infinity};
  }
  return out;
}

/** The effect preview of one move in this world. */
export function project(w: World, move: Move, known: Known = {}, base: GameState = w.state): Projection {
  if (move.kind === 'milestone' || move.kind === 'award') {
    // the engine decides who may claim or fund; the preview only needs the price
    const before = snapOf(snap(w, base));
    const cost = move.kind === 'milestone' ? MILESTONE_COST : AWARD_COSTS[base.awards.length] ?? AWARD_COSTS[2];
    const after: Snapshot = {...before, stock: {...before.stock, megacredits: exact(before.stock.megacredits.lo - cost)}};
    const state = structuredClone(base);
    meOf(w, state).stock.megacredits -= cost;
    return {ok: true, move, cost, before, after, unknowns: [], outcomes: [state], partial: false,
      lines: [{text: `${minus(cost)} M€`, tone: 'cost'}, {text: move.kind === 'milestone' ? '5 VP at the end of the game' : 'up to 5 VP at the end of the game', tone: 'gain'}]};
  }
  if (move.kind === 'heat' && base.global.temperature >= GLOBAL.temperature.max) {
    // the engine still lets 8 heat go at the maximum temperature (with a warning): no step, no TR
    const before = snapOf(snap(w, base));
    if (before.stock.heat.lo < HEAT_PER_TEMPERATURE) return {ok: false, move, reason: `${HEAT_PER_TEMPERATURE - before.stock.heat.lo} heat short`};
    const state = structuredClone(base);
    meOf(w, state).stock.heat -= HEAT_PER_TEMPERATURE;
    return {ok: true, move, cost: 0, before, after: {...before, stock: {...before.stock, heat: exact(before.stock.heat.lo - HEAT_PER_TEMPERATURE)}},
      unknowns: [], outcomes: [state], partial: false,
      lines: [{text: `${minus(HEAT_PER_TEMPERATURE)} heat`, tone: 'cost'}, {text: 'temperature is already at its maximum: no TR', tone: 'info'}]};
  }
  const ex = explore(w, move, known, base);
  if ('error' in ex) return {ok: false, move, reason: ex.error};
  if (!ex.leaves.length) {
    if (engineOffers(w, move) && base === w.state) return {ok: false, move, reason: 'The phone cannot preview this move', unpreviewable: true};
    return {ok: false, move, reason: friendlyError(ex.errors[0] ?? (ex.truncated ? 'This move cannot be previewed' : 'This move is not possible'))};
  }
  const p0 = meOf(w, base);
  const before = snapOf(snap(w, base));
  const play = move.kind === 'play';
  const snaps = ex.leaves.map((l) => snap(w, l.state, l.events, play, p0.handSize));
  const blind = ex.leaves.map((l) => l.tileBlind);
  const after = combine(snaps, blind, w.board === 'hellas' && ex.tiles.length > 0 && !known.space);
  const extra: Unknown[] = [];
  let helion = 0;
  // Robotic Workforce copies a building card's production box: which one (and so what it does) is open
  if (move.kind === 'play' && findCard(move.card)?.behavior?.copyProductionBox) {
    for (const r of RESOURCES) after.production[r] = {lo: -Infinity, hi: Infinity};
    extra.push({key: 'copy', text: 'Your production changes depend on the card whose box you copy'});
  }
  // Mars University: each science tag you play lets you swap a card from your hand for one from the deck (the
  // companion leaves it to the table, so the hand's count holds but some of its cards may be new)
  const playedDef = move.kind === 'play' ? findCard(move.card) : undefined;
  const ownsMU = move.kind === 'play' && (move.card === 'Mars University' || p0.played.some((c) => c.name === 'Mars University'));
  const science = playedDef ? playedDef.tags.filter((t) => t === 'science').length : 0;
  if (ownsMU && science > 0) {
    after.drawn = {lo: after.drawn.lo, hi: after.drawn.hi + science};
    extra.push({key: 'mu', text: `Mars University: you may swap ${science === 1 ? 'a card' : `${science} cards`} from your hand for ${science === 1 ? 'one' : 'others'} from the deck`});
  }
  // Helion pays M€ costs inside an effect with heat if it likes (a card bought from the deck, an action's price)
  if (canHeat(p0) && move.kind !== 'play' && move.kind !== 'standard') {
    // per outcome: the M€ it paid could have been heat instead, as far as the heat goes
    const swaps = snaps.map((x) => ({x, sub: Math.min(Math.max(0, p0.stock.megacredits - x.stock.megacredits.lo), x.stock.heat.lo)}));
    helion = Math.max(0, ...swaps.map((w) => w.sub));
    if (helion > 0) {
      after.stock.megacredits = {lo: after.stock.megacredits.lo, hi: Math.max(after.stock.megacredits.hi, ...swaps.map((w) => w.x.stock.megacredits.lo + w.sub))};
      after.stock.heat = {lo: Math.min(after.stock.heat.lo, ...swaps.map((w) => w.x.stock.heat.lo - w.sub)), hi: after.stock.heat.hi};
      extra.push({key: 'helion', text: 'You may pay part of it with heat'});
    }
  }
  const cost = move.kind === 'play' || move.kind === 'standard' ? priceIn(w, move, base) : 0;
  const unknowns = [...ex.unknowns, ...extra];
  ex.tiles.forEach((t, i) => {
    if (i === 0 && known.space) return;
    unknowns.unshift({key: `tile:${i}`, text: `${tileWord(t, true)}: the bonus depends on the space`});
  });
  if (after.drawn.lo > 0 || (after.drawn.hi > 0 && after.drawn.hi !== Infinity)) {
    unknowns.unshift({key: 'drawn', text: `${drawnText(after.drawn.hi === Infinity ? exact(after.drawn.lo) : after.drawn)} (not known yet)`});
  }
  if (ex.truncated) unknowns.push({key: 'partial', text: 'Some outcomes were not worked out; only what is certain is shown'});
  return {ok: true, move, cost, before, after, lines: previewLines(before, after, ex.tiles, move, w, base), unknowns,
    outcomes: distinct(w, ex.leaves.map((l) => l.state)), partial: ex.truncated, open: blind.some(Boolean), tiles: ex.tiles.length,
    ...(helion ? {helion} : {})};
}

const snapOf = (s: ReturnType<typeof snap>): Snapshot => ({...s, drawn: exact(s.drawn)});

/** Outcomes that differ in what a second move could depend on (your numbers, your cards, the board's parameters). */
function distinct(w: World, states: GameState[]): GameState[] {
  const seen = new Set<string>();
  return states.filter((s) => {
    const p = meOf(w, s);
    const k = JSON.stringify([p.stock, p.production, p.tr, p.handSize, p.played, p.usedActions, p.nextCardDiscount, p.nextCardRequirementBonus, s.global, p.tiles]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function friendlyError(e: string): string {
  return e.replace(/^Payment of (\d+) M€ is short of (\d+) M€$/, (_, a, b) => `${Number(b) - Number(a)} M€ short`).replace(/\bM€$/, 'M€');
}

function tileWord(t: string, cap = false): string {
  const w = t === 'ocean' ? 'places an ocean' : t === 'greenery' ? 'places a greenery' : t === 'city' ? 'places a city' : 'places a special tile';
  return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

function drawnText(r: Range): string {
  if (r.hi === Infinity) return r.lo > 0 ? `+${r.lo} or more cards` : 'maybe a card';
  if (r.lo === r.hi) return `+${r.lo} card${r.lo === 1 ? '' : 's'}`;
  return `+${r.lo} to ${r.hi} cards`;
}

const RES_WORD: Record<Resource, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};
const PROD_WORD: Record<Resource, string> = {megacredits: 'M€ production', steel: 'steel production', titanium: 'titanium production', plants: 'plant production', energy: 'energy production', heat: 'heat production'};
const minus = (n: number) => `−${n}`;
const signed = (n: number) => (n < 0 ? minus(-n) : `+${n}`);

/** "+2", "−3", "at least +1", "+0 to +2" for a change from an exact before. */
function deltaText(before: number, r: Range): string | null {
  if (r.lo === -Infinity) return null; // not known at all: the note says why
  const lo = r.lo - before, hi = r.hi - before;
  // open upward (a space's bonus may add to it): the certain part, and the bonus note says the rest
  if (r.hi === Infinity) return lo ? signed(lo) : null;
  if (lo === hi) return lo ? signed(lo) : null;
  return `${signed(lo)} to ${signed(hi)}`;
}

function previewLines(before: Snapshot, after: Snapshot, tiles: string[], move: Move, w: World, base: GameState): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const add = (text: string | null, tone: PreviewLine['tone']) => { if (text) lines.push({text, tone}); };
  const d = (r: Resource) => deltaText(before.stock[r].lo, after.stock[r]);
  const spent = (r: Resource) => after.stock[r].lo < before.stock[r].lo && (after.stock[r].hi <= before.stock[r].lo || after.stock[r].hi === Infinity);
  // what the move costs first, M€ before metals
  for (const r of ['megacredits', 'steel', 'titanium', 'heat', 'plants', 'energy'] as Resource[]) {
    const t = d(r);
    if (t && spent(r)) add(`${t} ${RES_WORD[r]}`, 'cost');
  }
  for (const r of RESOURCES) {
    const t = deltaText(before.production[r].lo, after.production[r]);
    if (t) add(`${t} ${PROD_WORD[r]}`, after.production[r].lo < before.production[r].lo ? 'loss' : 'gain');
  }
  for (const t of tiles) add(tileWord(t), 'info');
  const steps = (k: 'temperature' | 'oxygen' | 'oceans', step: number) => {
    const r = after.global[k], b = before.global[k].lo;
    if (k === 'oceans') return null;
    const lo = (r.lo - b) / step, hi = (r.hi - b) / step;
    if (!hi) return null;
    const word = k === 'temperature' ? 'temperature' : 'oxygen';
    return lo === hi ? `raises ${word} ${lo} step${lo === 1 ? '' : 's'}` : `raises ${word} ${lo} to ${hi} steps`;
  };
  add(steps('temperature', GLOBAL.temperature.step), 'info');
  add(steps('oxygen', GLOBAL.oxygen.step), 'info');
  const tr = deltaText(before.tr.lo, after.tr);
  if (tr) add(`${tr} TR`, after.tr.lo < before.tr.lo ? 'loss' : 'gain');
  for (const r of RESOURCES) {
    const t = d(r);
    if (t && !spent(r)) add(`${t} ${RES_WORD[r]}`, 'gain');
  }
  // cards from the deck: counted, never named (a space's card bonus is in the bonus note)
  const drawn: Range = after.drawn.hi === Infinity ? exact(after.drawn.lo) : after.drawn;
  if (drawn.hi > 0) add(`${drawnText(drawn)} (not known yet)`, 'unknown');
  for (const [name, r] of Object.entries(after.cardResources)) {
    const b = before.cardResources[name]?.lo ?? 0;
    const t = deltaText(b, r);
    if (!t) continue;
    const type = (findCard(name)?.resourceType ?? 'resource').toLowerCase();
    add(`${t} ${type}${Math.abs(r.lo - b) === 1 && isExact(r) ? '' : 's'} on ${name}`, 'gain');
  }
  // tags the move puts on the table
  for (const [tag, n] of Object.entries(after.tags)) {
    const diff = n - (before.tags[tag] ?? 0);
    if (diff > 0 && tag !== 'event') add(`+${diff} ${tagName(tag)} tag${diff === 1 ? '' : 's'}`, 'info');
  }
  void w; void base; void move;
  return lines;
}

const PROPER = new Set(['jovian', 'earth', 'venus', 'moon', 'mars']);
const tagName = (t: string) => (PROPER.has(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** The preview as one line: "−23 M€ · +1 heat production · places an ocean · +1 TR". */
export function previewText(p: Projection): string {
  return p.ok ? p.lines.map((l) => l.text).join(' · ') : p.reason;
}

// ---- tile placement bonuses ----------------------------------------------------------------------
/** What placing a tile on a space gives: its printed bonus and 2 M€ for each ocean next to it. */
export function spaceBonus(model: Pick<PlayerViewModel, 'game'>, spaceId: string): {bonus: Partial<Units> & {cards?: number}; words: string[]} | null {
  const spaces = model.game.spaces;
  const sp = spaces.find((s) => s.id === spaceId);
  if (!sp) return null;
  const bonus: Partial<Units> & {cards?: number} = {};
  const addB = (k: keyof typeof bonus, n: number) => { bonus[k] = (bonus[k] ?? 0) + n; };
  for (const b of sp.bonus ?? []) {
    if (b === 0) addB('titanium', 1);
    else if (b === 1) addB('steel', 1);
    else if (b === 2) addB('plants', 1);
    else if (b === 3) addB('cards', 1);
    else if (b === 4) addB('heat', 1);
    // 5 (Hellas: pay for an extra ocean) is a choice the engine asks about afterwards
  }
  const oceans = neighbours(spaces, sp).filter((s) => s.tileType === OCEAN || s.tileType === 20 || s.tileType === 21 || s.tileType === 22).length;
  if (oceans) addB('megacredits', 2 * oceans);
  const words: string[] = [];
  for (const [k, n] of Object.entries(bonus)) {
    if (!n) continue;
    if (k === 'cards') words.push(`+${n} card${n === 1 ? '' : 's'} (not known yet)`);
    else if (k === 'megacredits') words.push(`+${n} M€ (${oceans} ocean${oceans === 1 ? '' : 's'} next to it)`);
    else words.push(`+${n} ${RES_WORD[k as Resource]}`);
  }
  return {bonus, words};
}

function neighbours(spaces: SpaceModel[], sp: SpaceModel): SpaceModel[] {
  const {cells} = layout(spaces);
  const me = cells.find((c) => c.id === sp.id);
  if (!me) return [];
  return cells.filter((c) => c.id !== sp.id && Math.hypot(c.cx - me.cx, c.cy - me.cy) < HEX_W * 1.15).map((c) => c.space);
}

// ---- a second move against a projected first ------------------------------------------------------
export type Verdict = {state: 'yes'} | {state: 'no'; reason: string} | {state: 'maybe'; reason: string};

/** Could this move be made in each of these outcomes? Yes in all, no in all, or it depends. Cost and requirements as
 *  the companion counts them, with the engine's price corrections. */
export function canMakeIn(w: World, move: Move, first: {outcomes: GameState[]; open?: boolean; tiles?: number; helion?: number}): Verdict {
  const verdicts = first.outcomes.map((s) => canMake(w, move, s));
  if (first.helion && move.kind === 'heat' && verdicts.every((v) => v === null)
    && first.outcomes.some((o) => meOf(w, o).stock.heat - first.helion! < HEAT_PER_TEMPERATURE)) {
    return {state: 'maybe', reason: 'Depends on whether you pay with heat'};
  }
  const no = verdicts.filter((v): v is Reason => v !== null);
  // Where the phone and the engine disagree about the move right now, the engine sees something the phone cannot
  // (a rule the companion leaves to the table): the projection then claims neither way.
  const doubt = disagreesNow(w, move);
  if (!no.length) {
    // the engine refuses it now although the phone sees no reason, and the first move places no tile: a tile with a
    // placement rule has nowhere to go, and that stays so
    if (doubt && restrictedTile(move) && !first.tiles && engineOffers(w, move) === false) return {state: 'no', reason: 'No space for its tile right now'};
    if (doubt) return {state: 'maybe', reason: 'The game checks this once your first move is done'};
    // a tile with a placement rule (next to a city, on a volcanic area...): the phone does not know the free spaces
    if (restrictedTile(move) && (!w.engineNow?.playable.has(moveCard(move)) || (first.tiles ?? 0) > 0)) {
      return {state: 'maybe', reason: 'Where its tile can go is checked once your first move is done'};
    }
    return {state: 'yes'};
  }
  if (no.length === verdicts.length) {
    const r = no[0];
    // The engine refuses it now for a reason the phone cannot see (a tile with nowhere to go), and the first move
    // places no tile: that stays so.
    if (doubt && restrictedTile(move) && !first.tiles && canMake(w, move, w.state) === null) return {state: 'no', reason: 'No space for its tile right now'};
    // Only a price, a requirement or a production step you lack is a firm no.
    if (doubt || r.kind === 'effect') return {state: 'maybe', reason: `Probably not: ${lowerFirst(r.text)}`};
    if (r.kind === 'short' && first.open) {
      // the best any free space on this board could give for each tile placed
      const best = bestBonus(w.model);
      const rich = first.outcomes.map((o) => {
        const x = structuredClone(o);
        const q = meOf(w, x);
        for (const k of RESOURCES) q.stock[k] += (best[k] ?? 0) * (first.tiles ?? 1);
        return canMake(w, move, x);
      });
      if (rich.every((v) => v !== null && v.kind === 'short')) return {state: 'no', reason: r.text};
      return {state: 'maybe', reason: `${r.text} unless your tile's space covers it`};
    }
    return {state: 'no', reason: r.text};
  }
  return {state: 'maybe', reason: `Depends on the first move: ${lowerFirst(no[0].text)}`};
}

const moveCard = (m: Move) => (m.kind === 'play' || m.kind === 'action' ? m.card : '');

/** Cards whose tile has a placement rule beyond "an empty land space". */
const RESTRICTED = new Set(['Urbanized Area', 'Research Outpost', 'Ecological Zone', 'Lava Flows', 'Mangrove', 'Protected Valley', 'Mining Rights',
  'Mining Area', 'Mohole Area', 'Natural Preserve', 'Industrial Center', 'Lava Tube Settlement', 'Artificial Lake']);
function restrictedTile(m: Move): boolean {
  if (m.kind !== 'play') return false;
  if (RESTRICTED.has(m.card)) return true;
  const b = findCard(m.card)?.behavior;
  const on = [b?.city?.on, b?.greenery?.on, b?.ocean?.on, b?.tile?.on].filter(Boolean) as string[];
  return on.some((x) => x !== 'land');
}

/** Does the engine's turn menu offer this move right now? */
function engineOffers(w: World, move: Move): boolean | null {
  const e = w.engineNow;
  if (!e) return null;
  return move.kind === 'play' ? e.playable.has(move.card) : move.kind === 'standard' ? e.standard.has(move.project)
    : move.kind === 'action' ? e.actions.has(move.card) : move.kind === 'plants' ? e.plants : move.kind === 'heat' ? e.heat : null;
}

/** Does the companion's verdict for this move now differ from the engine's turn menu? */
function disagreesNow(w: World, move: Move): boolean {
  const engine = engineOffers(w, move);
  if (engine === null) return false;
  return (canMake(w, move, w.state) === null) !== engine;
}

/** Why a move cannot be made: its price, a requirement, or its effect (the last is the companion's own reading). */
export type Reason = {kind: 'short' | 'requirement' | 'effect' | 'used'; text: string};

/** null when the move can be made in this state, else why not in plain words. */
export function canMake(w: World, move: Move, s: GameState, tense: Tense = 'would'): Reason | null {
  const p = meOf(w, s);
  const short = (n: number, what: string): Reason | null => (n > 0 ? {kind: 'short', text: `${n} ${what} short`} : null);
  switch (move.kind) {
  case 'play': {
    const d = findCard(move.card);
    if (!d) return {kind: 'effect', text: 'Not a card the phone knows'};
    if (p.played.some((c) => c.name === move.card)) return {kind: 'used', text: 'Already played'};
    const unmet = unmetRequirements(s, p, d);
    if (unmet.length) return {kind: 'requirement', text: requirementWords(unmet[0], s, tense)};
    return short(priceIn(w, move, s) - reach(p, d), 'M€') ?? effectReason(w, move, s);
  }
  case 'standard': {
    const id = SP_IDS[move.project];
    if (id === 'aquifer' && s.global.oceans >= GLOBAL.oceans.max) return {kind: 'requirement', text: 'All 9 oceans are placed'};
    if (id === 'asteroid' && s.global.temperature >= GLOBAL.temperature.max) return {kind: 'requirement', text: 'Temperature is at its maximum'};
    return short(priceIn(w, move, s) - (p.stock.megacredits + (canHeat(p) ? p.stock.heat : 0)), 'M€');
  }
  case 'plants': return short(p.greeneryCost - p.stock.plants, 'plants') ?? effectReason(w, move, s);
  case 'heat': return short(HEAT_PER_TEMPERATURE - p.stock.heat, 'heat');
  case 'action':
    if (p.usedActions.includes(move.card)) return {kind: 'used', text: 'Already used this generation'};
    return effectReason(w, move, s);
  case 'milestone': return short(MILESTONE_COST - p.stock.megacredits, 'M€');
  case 'award': return short((AWARD_COSTS[s.awards.length] ?? 99) - p.stock.megacredits, 'M€');
  }
}

/** A move is possible when at least one way of answering its questions goes through. */
function effectReason(w: World, move: Move, s: GameState): Reason | null {
  const ex = explore(w, move, {}, s);
  if ('error' in ex) return {kind: 'effect', text: ex.error};
  if (ex.leaves.length) return null;
  const e = ex.errors[0] ?? 'Not possible';
  // lowering your own production below what you have is a rule the engine checks the same way
  if (/^Not enough (M€|steel|titanium|plants|energy|heat) production$/.test(e)) return {kind: 'requirement', text: `Needs more ${e.replace(/^Not enough /, '')}`};
  return {kind: 'effect', text: friendlyError(e)};
}

/** The most one tile could bring from any empty space on the board: its printed bonus and 2 M€ per ocean next to it. */
function bestBonus(model: PlayerViewModel): Partial<Units> {
  const best: Partial<Units> = {};
  for (const sp of model.game.spaces) {
    if (sp.tileType !== undefined || sp.spaceType === 'colony' || sp.x < 0) continue;
    const b = spaceBonus(model, sp.id);
    if (!b) continue;
    for (const [k, n] of Object.entries(b.bonus)) if (k !== 'cards' && n) best[k as Resource] = Math.max(best[k as Resource] ?? 0, n);
  }
  return best;
}

/** "At most 5% oxygen" (engine words) as the player reads it with the value: after the first move ('would') or now. */
function requirementWords(unmet: string, s: GameState, tense: Tense): string {
  const m = /^(At most|At least) (-?\d+)(°C|%| oceans)$/.exec(unmet);
  if (!m) return `Needs ${unmet}`;
  const [, side, n, unit] = m;
  const be = tense === 'now' ? 'is now' : 'would be';
  const k = s.global.oceans;
  if (unit === '°C') return side === 'At most' ? `Temperature ${be} ${s.global.temperature}°C, above this card's ${n}°C maximum` : `Needs ${n}°C, temperature ${be} ${s.global.temperature}°C`;
  if (unit === '%') return side === 'At most' ? `Oxygen ${be} ${s.global.oxygen}%, above this card's ${n}% maximum` : `Needs ${n}% oxygen, oxygen ${be} ${s.global.oxygen}%`;
  const placed = tense === 'now' ? `${k} ${k === 1 ? 'is' : 'are'} placed` : `there would be ${k}`;
  return side === 'At most' ? `${n} oceans at most, ${placed}` : `Needs ${n} oceans, ${placed}`;
}

/** Reasons read after the planned first move ('would') or against the real game now. */
export type Tense = 'would' | 'now';

/** The viewing player in a world (or in one of its projected states). */
export function meOfWorld(w: World, s: GameState = w.state): PlayerState { return meOf(w, s); }

export type {Color};
