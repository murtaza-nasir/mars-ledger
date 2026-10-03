// "While you were away": what changed for one player while their phone was hidden or offline.
// The server keeps a journal of facts (full mode: folded from consecutive engine models; companion
// mode: read from the command log) and builds one summary per return. Every line comes from the
// game state; nothing is guessed.
import {findCard} from './cards';
import {detectAttack} from './attack';
import type {Loss} from './attack';
import {apply, newGame} from './engine';
import type {Color, ProductionShow, SpectatorModel} from './full';
import {tileKind} from './full';
import type {GameState, PlayerState, Tick} from './game';
import {companionLoss} from './history';
import type {Units} from './types';
import {isRewind} from './sync';

/** A phone counts as away after this long hidden or offline (AWAY_MIN_MS overrides it for tests). */
export const AWAY_MIN_MS = 60_000;
/** A visible phone says it is still there this often (any message counts). */
export const HEARTBEAT_MS = 15_000;
/**
 * A socket that dropped silently is noticed late (the network gives up long after the phone left).
 * Its seat counts as away from shortly after the phone was last heard: a heartbeat plus slack.
 */
export const HEARD_SLACK_MS = HEARTBEAT_MS + 5_000;
/** The phone shows the card this long unless dismissed. */
export const AWAY_SHOW_MS = 8_000;
/** At most this many card names are listed; the rest become "+N more". */
export const AWAY_MAX_CARDS = 5;

export type Param = 'temperature' | 'oxygen' | 'oceans';

/** One fact, stamped with when it happened. Players are identified by colour (unique per game). */
export type AwayEntry =
  | {kind: 'attack'; at: number; by: Color; target: Color; losses: Loss[]}
  /** amount is in the parameter's own unit: °C, % oxygen, oceans */
  | {kind: 'global'; at: number; by: Color | null; param: Param; amount: number}
  | {kind: 'tile'; at: number; by: Color | null; tile: 'city' | 'greenery' | 'ocean' | 'special'}
  | {kind: 'card'; at: number; by: Color; card: string}
  | {kind: 'milestone' | 'award'; at: number; by: Color; name: string}
  | {kind: 'production'; at: number; generation: number; incomes: Array<{color: Color; gains: Units; energyToHeat: number}>}
  | {kind: 'generation'; at: number; generation: number};

export type Who = {color: Color; name: string};
export type TileCount = {city: number; greenery: number; ocean: number; special: number};

export type AwaySummary = {
  id: string;
  /** when the player was last seen, and when they came back (server clock) */
  since: number;
  until: number;
  /** attacks on this player, oldest first */
  attacks: Array<{by: Who; losses: Loss[]}>;
  /** net change of each global parameter, and who raised it */
  params: {temperature: number; oxygen: number; oceans: number; by: Array<Who & Record<Param, number>>} | null;
  /** tiles other players placed */
  tiles: Array<Who & TileCount>;
  /** cards other players played: the latest few in play order, and how many more */
  cards: {shown: Array<{by: Who; card: string}>; more: number};
  /** milestones claimed and awards funded by others */
  claims: Array<{kind: 'milestone' | 'award'; by: Who; name: string}>;
  /** the generation the player left in, and the one it is now (null when unchanged) */
  generations: {from: number; to: number} | null;
  /** this player's own production income over the window (summed when several productions passed) */
  income: {gains: Units; energyToHeat: number; times: number} | null;
  /** whose turn it is now; `mine` when it is this player's */
  turn: {who: Who | null; mine: boolean; phase: string | null};
};

/** Has the player been gone long enough to be told what they missed? */
export function wasAway(since: number | null | undefined, now: number, min = AWAY_MIN_MS): boolean {
  return since !== null && since !== undefined && now - since >= min;
}

// ---- full mode: facts from one engine update -----------------------------------------------------
const TILE_KIND = (t: number): 'city' | 'greenery' | 'ocean' | 'special' => {
  const k = tileKind(t);
  return k === 'greenery' || k === 'ocean' || k === 'city' ? k : 'special';
};

/** The facts in one engine update (`prev` is the model seen just before `next`). */
export function fullEntries(prev: SpectatorModel, next: SpectatorModel, at: number): AwayEntry[] {
  const g0 = prev.game; const g1 = next.game;
  // An undo rewrites the past; its "changes" are not news (a repeated undo keeps undoCount and lowers gameAge).
  if (isRewind(g0, g1)) return [];
  const out: AwayEntry[] = [];
  const actor = prev.players.find((p) => p.isActive)?.color ?? null;

  const attack = detectAttack(prev, next);
  if (attack) for (const t of attack.targets) out.push({kind: 'attack', at, by: attack.attacker, target: t.color, losses: t.losses});

  const before = new Map(g0.spaces.map((s) => [s.id, s]));
  for (const s of g1.spaces) {
    if (s.tileType === undefined || before.get(s.id)?.tileType !== undefined) continue;
    out.push({kind: 'tile', at, by: s.color ?? actor, tile: TILE_KIND(s.tileType)});
  }

  const steps: Array<[Param, number]> = [['temperature', g1.temperature - g0.temperature], ['oxygen', g1.oxygenLevel - g0.oxygenLevel], ['oceans', g1.oceans - g0.oceans]];
  for (const [param, amount] of steps) if (amount > 0) out.push({kind: 'global', at, by: actor, param, amount});

  const was = new Map(prev.players.map((p) => [p.color, p]));
  for (const p of next.players) {
    const o = was.get(p.color);
    if (!o) continue;
    const had = new Set(o.tableau.map((c) => c.name));
    for (const c of p.tableau) {
      if (had.has(c.name)) continue;
      const group = findCard(c.name)?.group;
      // Corporations arrive at setup; projects and preludes are plays.
      if (group === 'project' || group === 'prelude') out.push({kind: 'card', at, by: p.color, card: c.name});
    }
  }

  for (const [kind, list0, list1] of [['milestone', g0.milestones, g1.milestones], ['award', g0.awards, g1.awards]] as const) {
    for (const m of list1) {
      if (!m.color || list0.find((x) => x.name === m.name)?.color) continue;
      out.push({kind, at, by: m.color, name: m.name});
    }
  }

  if (g1.generation > g0.generation) out.push({kind: 'generation', at, generation: g1.generation});
  return out;
}

/** The production show's income numbers (the server already computes them from the pre-production model). */
export function showEntry(show: ProductionShow, at: number): AwayEntry {
  return {kind: 'production', at, generation: show.generation - 1,
    incomes: show.players.map((p) => ({color: p.color, gains: p.gains, energyToHeat: p.energyToHeat}))};
}

// ---- companion mode: facts from the command log -------------------------------------------------
/** Companion production income from the state just before production (energy turns into heat first). */
export function companionIncome(p: PlayerState): {gains: Units; energyToHeat: number} {
  const energyToHeat = Math.max(0, p.stock.energy);
  return {
    energyToHeat,
    gains: {
      megacredits: p.production.megacredits + p.tr,
      steel: p.production.steel,
      titanium: p.production.titanium,
      plants: p.production.plants,
      energy: p.production.energy,
      heat: p.production.heat + energyToHeat,
    },
  };
}

/**
 * Every fact in a companion game's log at or after `from` (server time). The log is replayed from the
 * start so production income can be read from the state just before each production.
 */
export function companionEntries(gameId: string, ticks: Tick[], from = 0): AwayEntry[] {
  const out: AwayEntry[] = [];
  let state: GameState = newGame(gameId);
  for (const t of ticks) {
    const before = state;
    try { state = apply(state, t.command).state; } catch { /* a command the rules no longer accept is skipped, as on replay */ }
    if (t.at < from) continue;
    const color = (id: string | null | undefined) => (id ? before.players.find((p) => p.id === id)?.color ?? state.players.find((p) => p.id === id)?.color : undefined) as Color | undefined;
    for (const e of t.events) {
      switch (e.kind) {
      case 'cardPlayed': { const c = color(e.player); if (c) out.push({kind: 'card', at: t.at, by: c, card: e.card}); break; }
      case 'tile': out.push({kind: 'tile', at: t.at, by: color(e.player) ?? null, tile: e.tile}); break;
      case 'global': {
        // A correction on a phone fixes the record; it is not terraforming.
        if (e.param === 'venus' || t.command.t === 'setGlobal') break;
        const amount = e.to - e.from;
        if (amount > 0) out.push({kind: 'global', at: t.at, by: color(e.player) ?? null, param: e.param, amount});
        break;
      }
      case 'attack': {
        const by = color(e.player); const target = color(e.target);
        if (by && target) out.push({kind: 'attack', at: t.at, by, target, losses: [companionLoss(e.what)]});
        break;
      }
      case 'milestone': case 'award': { const c = color(e.player); if (c) out.push({kind: e.kind, at: t.at, by: c, name: e.name}); break; }
      case 'production':
        out.push({kind: 'production', at: t.at, generation: e.generation,
          incomes: before.players.map((p) => ({color: p.color as Color, ...companionIncome(p)}))});
        break;
      case 'generation': out.push({kind: 'generation', at: t.at, generation: e.generation}); break;
      default: break;
      }
    }
  }
  return out;
}

// ---- the summary --------------------------------------------------------------------------------
const zeroUnits = (): Units => ({megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0});
const emptyTiles = (): TileCount => ({city: 0, greenery: 0, ocean: 0, special: 0});

export type SummaryInput = {
  id: string;
  since: number;
  until: number;
  me: Color;
  players: Who[];
  /** the generation when the player left (the window's facts tell how far it moved) */
  generationAtLeave?: number;
  turn: AwaySummary['turn'];
};

/** What changed for `me` between `since` and `until`; null when nothing worth telling happened. */
export function buildSummary(entries: AwayEntry[], input: SummaryInput): AwaySummary | null {
  const who = (c: Color): Who => input.players.find((p) => p.color === c) ?? {color: c, name: c};
  const inWindow = entries.filter((e) => e.at >= input.since && e.at <= input.until).sort((a, b) => a.at - b.at);

  const attacks: AwaySummary['attacks'] = [];
  const paramTotals: Record<Param, number> = {temperature: 0, oxygen: 0, oceans: 0};
  const paramBy = new Map<Color, Who & Record<Param, number>>();
  const tiles = new Map<Color, Who & TileCount>();
  const cards: Array<{by: Who; card: string}> = [];
  const claims: AwaySummary['claims'] = [];
  let genFrom: number | null = input.generationAtLeave ?? null;
  let genTo: number | null = null;
  const income = zeroUnits();
  let energyToHeat = 0;
  let times = 0;

  for (const e of inWindow) {
    switch (e.kind) {
    case 'attack':
      if (e.target === input.me && e.by !== input.me) attacks.push({by: who(e.by), losses: e.losses});
      break;
    case 'global': {
      paramTotals[e.param] += e.amount;
      if (e.by) {
        const row = paramBy.get(e.by) ?? {...who(e.by), temperature: 0, oxygen: 0, oceans: 0};
        row[e.param] += e.amount;
        paramBy.set(e.by, row);
      }
      break;
    }
    case 'tile':
      if (e.by && e.by !== input.me) {
        const row = tiles.get(e.by) ?? {...who(e.by), ...emptyTiles()};
        row[e.tile]++;
        tiles.set(e.by, row);
      }
      break;
    case 'card':
      if (e.by !== input.me) cards.push({by: who(e.by), card: e.card});
      break;
    case 'milestone': case 'award':
      if (e.by !== input.me) claims.push({kind: e.kind, by: who(e.by), name: e.name});
      break;
    case 'production': {
      const mine = e.incomes.find((x) => x.color === input.me);
      if (mine) {
        for (const k of Object.keys(income) as Array<keyof Units>) income[k] += mine.gains[k];
        energyToHeat += mine.energyToHeat;
        times++;
      }
      break;
    }
    case 'generation':
      genFrom ??= e.generation - 1;
      genTo = e.generation;
      break;
    }
  }

  const params = paramTotals.temperature || paramTotals.oxygen || paramTotals.oceans
    ? {...paramTotals, by: [...paramBy.values()]} : null;
  const shown = cards.slice(-AWAY_MAX_CARDS);
  const summary: AwaySummary = {
    id: input.id, since: input.since, until: input.until,
    attacks,
    params,
    tiles: [...tiles.values()],
    cards: {shown, more: cards.length - shown.length},
    claims,
    generations: genTo !== null && genFrom !== null && genTo > genFrom ? {from: genFrom, to: genTo} : null,
    income: times ? {gains: income, energyToHeat, times} : null,
    turn: input.turn,
  };
  return hasNews(summary) ? summary : null;
}

/** Whose turn or which phase, said plainly; the turn alone is not news (the board shows it anyway). */
export function hasNews(s: AwaySummary): boolean {
  return s.attacks.length > 0 || s.params !== null || s.tiles.length > 0 || s.cards.shown.length > 0 ||
    s.claims.length > 0 || s.generations !== null || s.income !== null;
}

/** "3 min", "1 h 5 min": how long the player was gone. */
export function awayFor(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
