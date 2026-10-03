// What mission control notices. Each notable moment becomes a NarratorEvent carrying only facts that
// are true in the game (names, cards, numbers), so the prompt can never offer the model anything else.
// Routine moves (turns, passes, small cards, conversions, research) are never notable.
import {GLOBAL, findStanding} from '../../shared/board';
import {findCard} from '../../shared/cards';
import {detectAttack} from '../../shared/attack';
import type {AttackTarget} from '../../shared/attack';
import {score} from '../../shared/engine';
import type {Color, SpectatorModel} from '../../shared/full';
import {tileKind} from '../../shared/full';
import type {GameEvent, GameState, Tick} from '../../shared/game';
import {companionHistory, highlights} from '../../shared/history';
import type {GameHistory} from '../../shared/history';
import {isRewind} from '../../shared/sync';

export type NarratorKind = 'gameEnd' | 'paramMax' | 'attack' | 'milestone' | 'award' | 'bigPlay' | 'firstTile' |
  'paramBonus' | 'recap' | 'leadChange' | 'preludes';

export type NarratorEvent = {
  /** once per key: the same moment is never narrated twice */
  key: string;
  kind: NarratorKind;
  /** 1 (minor) .. 5 (must mention) */
  priority: number;
  /** a few words naming the moment for the model, e.g. "first ocean of the game" */
  focus: string;
  /** plain sentences, each true in the game */
  facts: string[];
  /** proper nouns the line may use */
  names: string[];
  cards: string[];
  at: number;
  /** claims that would be false for this moment (e.g. "thinner air" when oxygen rose), refused in a line */
  avoid?: Contradiction[];
};

export type Contradiction = {pattern: RegExp; because: string};

/** Words that would run the wrong way when a global parameter went up. */
export const RAISED: Record<'temperature' | 'oxygen' | 'oceans', Contradiction> = {
  temperature: {pattern: /\b(cold(er)?|cool(er|ing|ed)?|chill(ier|y|ed)?|freez\w*|froze\w*|frost\w*)\b/i, because: 'the temperature rose'},
  oxygen: {pattern: /\b(thinner|thin air|less (air|oxygen)|suffocat\w*|stale air|airless)\b/i, because: 'the oxygen rose'},
  oceans: {pattern: /\b(dri(er|est)|dried( up)?|drought|dehydrat\w*|evaporat\w*|dust bowl)\b/i, because: 'more water was placed'},
};

/** What has already been noticed in this game; survives mode changes so turning narration on is not stale. */
export type NarratorMemory = {
  gameId: string;
  firsts: Set<string>;
  leader: string | null;
  ended: boolean;
  /**
   * Each player's latest card played and card action used (full mode). The engine often plays a card in
   * one update and asks "whose plants?" in the next, so an attack is credited to what came just before.
   */
  recent: Map<string, {play?: {name: string; at: number; generation: number}; action?: {name: string; at: number; generation: number}}>;
};

export function newMemory(gameId: string): NarratorMemory {
  return {gameId, firsts: new Set(), leader: null, ended: false, recent: new Map()};
}

/** How long a card play or action still explains an attack by the same player. */
const CAUSE_WINDOW_MS = 30_000;

/** Cards at or above this cost count as a big play; very expensive ones rank higher. */
export const BIG_PLAY_COST = 20;
const HUGE_PLAY_COST = 30;

const RES_WORD: Record<string, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};
const PROD_WORD: Record<string, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plant', energy: 'energy', heat: 'heat'};
const PARAM_WORD = {temperature: 'Temperature', oxygen: 'Oxygen', oceans: 'Oceans'} as const;

/** What one target lost, as plain sentences ("Bo lost 4 plants. Bo's energy production dropped 1 step."). */
export function lossText(t: AttackTarget, name: string): string {
  const lost: string[] = [];
  const out: string[] = [];
  for (const l of t.losses) {
    if (l.what === 'production') out.push(`${name}'s ${PROD_WORD[l.resource ?? ''] ?? l.resource} production dropped ${l.amount} step${l.amount > 1 ? 's' : ''}.`);
    else if (l.what === 'tr') lost.push(`${l.amount} TR`);
    else if (l.what === 'card') lost.push(`${l.amount} resource${l.amount > 1 ? 's' : ''} from ${l.card}`);
    else lost.push(`${l.amount} ${RES_WORD[l.resource ?? ''] ?? l.resource}`);
  }
  return [lost.length ? `${name} lost ${lost.join(' and ')}.` : '', ...out].filter(Boolean).join(' ');
}

function paramFacts(param: 'temperature' | 'oxygen' | 'oceans', value: number): string {
  if (param === 'temperature') return `${PARAM_WORD[param]} is now ${value} C.`;
  if (param === 'oxygen') return `${PARAM_WORD[param]} is now ${value}%.`;
  return `${value} of 9 oceans are placed.`;
}

/** Board bonus steps a raise crossed, and whether it reached the maximum. */
function paramSteps(param: 'temperature' | 'oxygen' | 'oceans', from: number, to: number): {bonus: string | null; max: boolean} {
  if (to <= from) return {bonus: null, max: false};
  const max = to >= GLOBAL[param].max && from < GLOBAL[param].max;
  let bonus: string | null = null;
  if (param === 'temperature') {
    if (from < -24 && to >= -24) bonus = 'temperature reached -24 C, a heat production bonus';
    else if (from < -20 && to >= -20) bonus = 'temperature reached -20 C, a heat production bonus';
    else if (from < 0 && to >= 0) bonus = 'temperature reached 0 C, which melts a free ocean';
  }
  if (param === 'oxygen' && from < 8 && to >= 8) bonus = 'oxygen reached 8%, which also warms the planet';
  return {bonus, max};
}

const MAX_TEXT = {temperature: 'Temperature reached its maximum of 8 C.', oxygen: 'Oxygen reached its maximum of 14%.', oceans: 'All 9 oceans are placed.'};

/** The openings of a Prelude game: who started with which preludes. */
export function preludeOpening(gameId: string, openers: Array<{name: string; preludes: string[]}>, now: number): NarratorEvent | null {
  if (!openers.length) return null;
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  return {key: `${gameId}:preludes`, kind: 'preludes', priority: 4, focus: 'the opening preludes, before the first round',
    facts: openers.map((o) => `${o.name} opened with ${list(o.preludes)}.`),
    names: openers.map((o) => o.name), cards: openers.flatMap((o) => o.preludes), at: now};
}

// ---- companion mode: our engine's events ------------------------------------------------------
/**
 * The companion engine words attacks as "−2 plants", "−1 heat production", "stole 3 M€" or
 * "took 1 Animal from Birds". Turn each into what the target lost, and name any card involved.
 */
export function companionLoss(what: string): {sentence: (name: string) => string; card?: string} {
  const took = what.match(/^took (\d+) (\w+) from (.+)$/);
  if (took) {
    const n = Number(took[1]);
    return {sentence: (name) => `${name} lost ${n} ${took[2].toLowerCase()}${n > 1 ? 's' : ''} from ${took[3]}.`, card: took[3]};
  }
  const prod = what.match(/^−(\d+) (.+) production$/);
  if (prod) {
    const n = Number(prod[1]);
    const word = prod[2] === 'plants' ? 'plant' : prod[2];
    return {sentence: (name) => `${name}'s ${word} production dropped ${n} step${n > 1 ? 's' : ''}.`};
  }
  return {sentence: (name) => `${name} lost ${what.replace(/^−/, '').replace(/^stole /, '')}.`};
}

/** A game seen for the first time (e.g. after a restart): learn what already happened, announce nothing old. */
export function primeCompanion(mem: NarratorMemory, s: GameState) {
  if (s.global.oceans > 0) mem.firsts.add('ocean');
  if (s.players.some((p) => p.tiles.greenery > 0)) mem.firsts.add('greenery');
  if (s.players.some((p) => p.tiles.cityOnMars + p.tiles.cityOffMars > 0)) mem.firsts.add('city');
  mem.leader = leaderOf(s.players.map((p) => ({key: p.id, name: p.name, value: p.tr})))?.key ?? null;
  mem.ended = s.phase === 'ended';
}
export function detectCompanion(mem: NarratorMemory, before: GameState, tick: Tick, after: GameState, ticks: Tick[], now = Date.now()): NarratorEvent[] {
  if (after.mode === 'full' || before.phase === 'lobby') return [];
  const out: NarratorEvent[] = [];
  const nameOf = (id: string | null | undefined) => (id ? after.players.find((p) => p.id === id)?.name : undefined);
  const names = after.players.map((p) => p.name);
  const ev = tick.events;
  const played = ev.find((e): e is Extract<GameEvent, {kind: 'cardPlayed'}> => e.kind === 'cardPlayed');
  const acted = ev.find((e): e is Extract<GameEvent, {kind: 'action'}> => e.kind === 'action');

  // Prelude games: one line for the openings once every prelude is on the table.
  if (before.phase === 'preludes' && after.phase === 'action') {
    const openers = after.players.filter((p) => p.preludesPlayed?.length);
    const opening = preludeOpening(mem.gameId, openers.map((p) => ({name: p.name, preludes: p.preludesPlayed!})), now);
    if (opening) out.push(opening);
  }

  for (const e of ev) {
    switch (e.kind) {
    case 'attack': {
      const a = nameOf(e.player); const t = nameOf(e.target);
      if (!a || !t) break;
      const loss = companionLoss(e.what);
      const cause = played && played.player === e.player ? {kind: 'play', name: played.card} : acted && acted.player === e.player ? {kind: 'action', name: acted.card} : null;
      const facts = [cause?.kind === 'play' ? `${a} played ${cause.name}.` : cause ? `${a} used the action on ${cause.name}.` : `${a} attacked.`, loss.sentence(t)];
      out.push({key: `${mem.gameId}:c${tick.seq}:attack:${e.target}`, kind: 'attack', priority: 4, focus: 'an attack on another player', facts,
        names: [a, t], cards: [...(cause ? [cause.name] : []), ...(loss.card ? [loss.card] : [])], at: now});
      break;
    }
    case 'cardPlayed': {
      if (e.cost < BIG_PLAY_COST || ev.some((x) => x.kind === 'attack')) break;
      const a = nameOf(e.player);
      if (!a) break;
      out.push({key: `${mem.gameId}:c${tick.seq}:big`, kind: 'bigPlay', priority: e.cost >= HUGE_PLAY_COST ? 4 : 3, focus: 'an expensive card',
        facts: [`${a} played ${e.card}, costing ${e.cost} M€.`], names: [a], cards: [e.card], at: now});
      break;
    }
    case 'tile': {
      if (e.tile === 'special' || mem.firsts.has(e.tile)) break;
      mem.firsts.add(e.tile);
      const a = nameOf(e.player);
      if (!a) break;
      out.push({key: `${mem.gameId}:first:${e.tile}`, kind: 'firstTile', priority: 3, focus: `the first ${e.tile} of the game`,
        facts: [`${a} placed the first ${e.tile} of the game.`], names: [a], cards: [], at: now});
      break;
    }
    case 'global': {
      if (e.param === 'venus' || tick.command.t === 'setGlobal') break;
      const {bonus, max} = paramSteps(e.param, e.from, e.to);
      const a = nameOf(e.player);
      if (max) {
        out.push({key: `${mem.gameId}:max:${e.param}`, kind: 'paramMax', priority: 5, focus: `${e.param} reaching its maximum`,
          facts: [MAX_TEXT[e.param], ...(a ? [`${a} made the final step.`] : [])], names: a ? [a] : [], cards: [], at: now, avoid: [RAISED[e.param]]});
      } else if (bonus) {
        out.push({key: `${mem.gameId}:bonus:${e.param}:${e.to}`, kind: 'paramBonus', priority: 2, focus: 'a board bonus step',
          facts: [`${bonus[0].toUpperCase()}${bonus.slice(1)}.`, ...(a ? [`${a} did it.`] : [])], names: a ? [a] : [], cards: [], at: now, avoid: [RAISED[e.param]]});
      }
      break;
    }
    case 'milestone': case 'award': {
      const a = nameOf(e.player);
      if (!a) break;
      const text = findStanding(e.name)?.text;
      const left = e.kind === 'milestone' ? 3 - after.milestones.length : 3 - after.awards.length;
      out.push({key: `${mem.gameId}:${e.kind}:${e.name}`, kind: e.kind, priority: e.kind === 'milestone' ? 4 : 3,
        focus: e.kind === 'milestone' ? 'a milestone claimed' : 'an award funded',
        facts: [e.kind === 'milestone' ? `${a} claimed the ${e.name} milestone${text ? ` (${text.toLowerCase()})` : ''}.` : `${a} funded the ${e.name} award${text ? ` (${text.toLowerCase()})` : ''}.`,
          left > 0 ? `${left} ${e.kind === 'milestone' ? 'milestone' : 'award'}${left > 1 ? 's' : ''} can still be ${e.kind === 'milestone' ? 'claimed' : 'funded'}.` : `No ${e.kind}s are left.`],
        names: [a], cards: [], at: now});
      break;
    }
    case 'production': {
      const h = companionHistory(after, ticks);
      const r = recapEvent(mem.gameId, h, e.generation, (c) => after.players.find((p) => p.color === c)?.name, now);
      if (r) out.push(r);
      break;
    }
    case 'ended': {
      if (mem.ended) break;
      mem.ended = true;
      const rows = after.players.map((p) => ({name: p.name, total: score(after, p).total})).sort((a, b) => b.total - a.total);
      if (!rows.length) break;
      out.push({key: `${mem.gameId}:end`, kind: 'gameEnd', priority: 5, focus: 'the end of the game',
        facts: [...resultFacts(rows),
          `The game lasted ${after.generation} generation${after.generation === 1 ? '' : 's'}.`], names, cards: [], at: now});
      break;
    }
    default: break;
    }
  }

  // Lead changes in TR, from generation 2 on, only when someone clearly takes over.
  if (after.phase !== 'ended' && after.generation >= 2 && after.players.length > 1) {
    const lead = leaderOf(after.players.map((p) => ({key: p.id, name: p.name, value: p.tr})));
    const change = leadChange(mem, lead, 'TR', mem.gameId, after.generation, now);
    if (change) out.push(change);
  } else if (after.players.length > 1) {
    mem.leader = leaderOf(after.players.map((p) => ({key: p.id, name: p.name, value: p.tr})))?.key ?? mem.leader;
  }
  return out;
}

// ---- full mode: consecutive engine models -----------------------------------------------------
export function detectFull(mem: NarratorMemory, prev: SpectatorModel | null, next: SpectatorModel, history: GameHistory | null, now = Date.now()): NarratorEvent[] {
  if (!prev || isRewind(prev.game, next.game)) {
    // First sight (or an undo): learn what already happened so nothing stale is announced.
    for (const s of next.game.spaces) { const k = tileKind(s.tileType); if (k && k !== 'special') mem.firsts.add(k); }
    mem.leader = leaderOf(next.players.map((p) => ({key: p.color, name: p.name, value: vpOf(p)})))?.key ?? mem.leader;
    if (next.game.phase === 'end') mem.ended = true;
    return [];
  }
  const out: NarratorEvent[] = [];
  const g0 = prev.game; const g1 = next.game;
  const nameOf = (c: Color | undefined) => (c ? next.players.find((p) => p.color === c)?.name : undefined);
  const names = next.players.map((p) => p.name);
  const actor = prev.players.find((p) => p.isActive)?.color;

  // Cards that entered a tableau in this update (project cards only).
  const played: Array<{color: Color; name: string; cost: number}> = [];
  const was = new Map(prev.players.map((p) => [p.color, new Set(p.tableau.map((c) => c.name))]));
  for (const p of next.players) {
    for (const c of p.tableau) {
      if (was.get(p.color)?.has(c.name)) continue;
      const def = findCard(c.name);
      if (def?.group === 'project') played.push({color: p.color, name: c.name, cost: def.cost ?? 0});
    }
  }

  // Remember each player's latest play and card action (actionsThisGeneration grows when a blue card is used).
  for (const c of played) mem.recent.set(c.color, {...mem.recent.get(c.color), play: {name: c.name, at: now, generation: g1.generation}});
  for (const p of next.players) {
    const before = new Set(prev.players.find((x) => x.color === p.color)?.actionsThisGeneration ?? []);
    const used = (p.actionsThisGeneration ?? []).filter((n) => !before.has(n) && findCard(n));
    if (used.length) mem.recent.set(p.color, {...mem.recent.get(p.color), action: {name: used[used.length - 1], at: now, generation: g1.generation}});
  }

  const attack = detectAttack(prev, next);
  if (attack) {
    const a = nameOf(attack.attacker);
    if (a) {
      const targets = attack.targets.map((t) => ({t, name: nameOf(t.color)})).filter((x): x is {t: AttackTarget; name: string} => !!x.name);
      const cause = causeOf(mem, attack.attacker, g1.generation, now, played.find((c) => c.color === attack.attacker)?.name);
      if (targets.length) {
        out.push({key: `${mem.gameId}:f${g1.gameAge}:attack`, kind: 'attack', priority: 4, focus: 'an attack on another player',
          facts: [cause?.kind === 'play' ? `${a} played ${cause.name}.` : cause?.kind === 'action' ? `${a} used the action on ${cause.name}.` : `${a} attacked.`,
            ...targets.map((x) => lossText(x.t, x.name))],
          names: [a, ...targets.map((x) => x.name)],
          cards: [...(cause ? [cause.name] : []), ...attack.targets.flatMap((t) => t.losses.map((l) => l.card).filter((x): x is string => !!x))],
          at: now});
      }
    }
  }
  for (const c of played) {
    if (c.cost < BIG_PLAY_COST || (attack && attack.attacker === c.color)) continue;
    const a = nameOf(c.color);
    if (!a) continue;
    out.push({key: `${mem.gameId}:big:${c.color}:${c.name}`, kind: 'bigPlay', priority: c.cost >= HUGE_PLAY_COST ? 4 : 3, focus: 'an expensive card',
      facts: [`${a} played ${c.name}, costing ${c.cost} M€.`], names: [a], cards: [c.name], at: now});
  }

  // Prelude games: one line for the openings once every prelude is on the table.
  if (g0.phase === 'preludes' && g1.phase !== 'preludes') {
    const opening = preludeOpening(mem.gameId, next.players.map((p) => ({name: p.name,
      preludes: p.tableau.map((c) => c.name).filter((n) => findCard(n)?.group === 'prelude')})).filter((x) => x.preludes.length), now);
    if (opening) out.push(opening);
  }

  // First city, greenery and ocean of the game.
  const before = new Map(g0.spaces.map((s) => [s.id, s]));
  for (const s of g1.spaces) {
    const k = tileKind(s.tileType);
    if (!k || k === 'special' || before.get(s.id)?.tileType !== undefined || mem.firsts.has(k)) continue;
    mem.firsts.add(k);
    const a = nameOf(s.color ?? actor);
    if (!a) continue;
    out.push({key: `${mem.gameId}:first:${k}`, kind: 'firstTile', priority: 3, focus: `the first ${k} of the game`,
      facts: [`${a} placed the first ${k} of the game.`], names: [a], cards: [], at: now});
  }

  // Global parameters (only within the action phase: production does not move them).
  const a = nameOf(actor);
  for (const [param, from, to] of [['temperature', g0.temperature, g1.temperature], ['oxygen', g0.oxygenLevel, g1.oxygenLevel], ['oceans', g0.oceans, g1.oceans]] as const) {
    const {bonus, max} = paramSteps(param, from, to);
    if (max) {
      out.push({key: `${mem.gameId}:max:${param}`, kind: 'paramMax', priority: 5, focus: `${param} reaching its maximum`,
        facts: [MAX_TEXT[param], ...(a ? [`${a} made the final step.`] : [])], names: a ? [a] : [], cards: [], at: now, avoid: [RAISED[param]]});
    } else if (bonus) {
      out.push({key: `${mem.gameId}:bonus:${param}:${to}`, kind: 'paramBonus', priority: 2, focus: 'a board bonus step',
        facts: [`${bonus[0].toUpperCase()}${bonus.slice(1)}.`, paramFacts(param, to), ...(a ? [`${a} did it.`] : [])], names: a ? [a] : [], cards: [], at: now, avoid: [RAISED[param]]});
    }
  }

  // Milestones and awards.
  for (const [kind, list0, list1] of [['milestone', g0.milestones, g1.milestones], ['award', g0.awards, g1.awards]] as const) {
    for (const m of list1) {
      if (!m.color || list0.find((x) => x.name === m.name)?.color) continue;
      const who = nameOf(m.color);
      if (!who) continue;
      const left = 3 - list1.filter((x) => x.color).length;
      out.push({key: `${mem.gameId}:${kind}:${m.name}`, kind, priority: kind === 'milestone' ? 4 : 3,
        focus: kind === 'milestone' ? 'a milestone claimed' : 'an award funded',
        facts: [kind === 'milestone' ? `${who} claimed the ${m.name} milestone.` : `${who} funded the ${m.name} award.`,
          left > 0 ? `${left} ${kind}${left > 1 ? 's' : ''} can still be ${kind === 'milestone' ? 'claimed' : 'funded'}.` : `No ${kind}s are left.`],
        names: [who], cards: [], at: now});
    }
  }

  // A generation closed: one highlight from the recap.
  if (g1.generation > g0.generation && history) {
    const r = recapEvent(mem.gameId, history, g0.generation, nameOf, now);
    if (r) out.push(r);
  }

  // The end.
  if (g1.phase === 'end' && !mem.ended) {
    mem.ended = true;
    const rows = next.players.map((p) => ({name: p.name, total: vpOf(p)})).sort((x, y) => y.total - x.total);
    if (rows.length) {
      out.push({key: `${mem.gameId}:end`, kind: 'gameEnd', priority: 5, focus: 'the end of the game',
        facts: [...resultFacts(rows),
          `The game lasted ${g1.generation} generation${g1.generation === 1 ? '' : 's'}.`], names, cards: [], at: now});
    }
  } else if (g1.phase === 'action' && g1.generation >= 2 && next.players.length > 1) {
    const lead = leaderOf(next.players.map((p) => ({key: p.color, name: p.name, value: vpOf(p)})));
    const change = leadChange(mem, lead, 'points', mem.gameId, g1.generation, now);
    if (change) out.push(change);
  }
  return out;
}

/** What explains an attack: a card played in this update, else the latest recent play or action in this generation. */
function causeOf(mem: NarratorMemory, color: Color, generation: number, now: number, playedNow?: string): {kind: 'play' | 'action'; name: string} | null {
  if (playedNow) return {kind: 'play', name: playedNow};
  const r = mem.recent.get(color);
  const fresh = (x?: {at: number; generation: number}) => !!x && x.generation === generation && now - x.at <= CAUSE_WINDOW_MS;
  const play = fresh(r?.play) ? r!.play! : null;
  const action = fresh(r?.action) ? r!.action! : null;
  if (play && (!action || play.at >= action.at)) return {kind: 'play', name: play.name};
  if (action) return {kind: 'action', name: action.name};
  return null;
}

function vpOf(p: SpectatorModel['players'][number]): number {
  return p.victoryPointsBreakdown?.total ?? p.terraformRating;
}

// ---- shared pieces -----------------------------------------------------------------------------
/** The result in plain sentences; a shared top score is a tie, not a win. Rows are sorted, best first. */
export function resultFacts(rows: Array<{name: string; total: number}>): string[] {
  const top = rows.filter((r) => r.total === rows[0].total);
  const rest = rows.slice(top.length, 3);
  const head = top.length > 1
    ? `${top.map((r) => r.name).join(' and ')} tied for first with ${rows[0].total} points.`
    : `${rows[0].name} won with ${rows[0].total} points.`;
  return [head, ...rest.map((r) => `${r.name} finished with ${r.total} points.`)];
}
type Standing = {key: string; name: string; value: number};

/** The sole leader, or null on a tie. */
export function leaderOf(rows: Standing[]): (Standing & {second: Standing}) | null {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  if (sorted.length < 2 || sorted[0].value === sorted[1].value) return null;
  return {...sorted[0], second: sorted[1]};
}

/** A lead change worth a line: a new sole leader, different from the last one we knew. */
function leadChange(mem: NarratorMemory, lead: ReturnType<typeof leaderOf>, unit: 'TR' | 'points', gameId: string, generation: number, now: number): NarratorEvent | null {
  if (!lead) return null;
  const was = mem.leader;
  mem.leader = lead.key;
  if (was === null || was === lead.key) return null;
  return {key: `${gameId}:lead:${generation}:${lead.key}`, kind: 'leadChange', priority: 3, focus: 'a new leader',
    facts: [`${lead.name} took the lead with ${lead.value} ${unit}.`, `${lead.second.name} is second with ${lead.second.value} ${unit}.`,
      `${lead.name} leads by ${lead.value - lead.second.value} ${unit === 'TR' ? 'TR' : lead.value - lead.second.value === 1 ? 'point' : 'points'}.`, `It is generation ${generation}.`],
    names: [lead.name, lead.second.name], cards: [], at: now};
}

/** One highlight of a closed generation: the harshest attack, else the biggest play, else the terraforming. */
export function recapEvent(gameId: string, h: GameHistory, generation: number, nameOf: (c: Color) => string | undefined, now: number): NarratorEvent | null {
  const g = h.generations.find((x) => x.generation === generation);
  if (!g) return null;
  const hl = highlights(g);
  const base = {key: `${gameId}:recap:${generation}`, kind: 'recap' as const, priority: 3, focus: `the end of generation ${generation}`, at: now};
  if (hl.harshestAttack && hl.harshestAttack.units >= 3) {
    const a = nameOf(hl.harshestAttack.attacker);
    const ts = hl.harshestAttack.targets.map((t) => nameOf(t.color)).filter((x): x is string => !!x);
    if (a && ts.length) {
      return {...base, facts: [`Generation ${generation} ended.`, `Its harshest attack: ${a} took ${hl.harshestAttack.units} from ${ts.join(' and ')}.`], names: [a, ...ts], cards: []};
    }
  }
  if (hl.biggestPlay && hl.biggestPlay.cost >= 12) {
    const a = nameOf(hl.biggestPlay.color);
    if (a) return {...base, facts: [`Generation ${generation} ended.`, `Its biggest play: ${a} played ${hl.biggestPlay.name} for ${hl.biggestPlay.cost} M€.`], names: [a], cards: [hl.biggestPlay.name]};
  }
  const t = hl.terraforming;
  const steps = [t.temperature > 0 ? `the planet got warmer (temperature rose ${t.temperature * 2} C)` : '',
    t.oxygen > 0 ? `the air got richer (oxygen rose ${t.oxygen}%)` : '',
    t.oceans > 0 ? `${t.oceans} more ocean${t.oceans > 1 ? 's' : ''} filled` : ''].filter(Boolean);
  if (!steps.length) return null;
  const avoid = [t.temperature > 0 ? RAISED.temperature : null, t.oxygen > 0 ? RAISED.oxygen : null, t.oceans > 0 ? RAISED.oceans : null]
    .filter((x): x is Contradiction => !!x);
  return {...base, priority: 2, facts: [`Generation ${generation} ended.`, `During it, ${steps.join(', ')}.`], names: [], cards: [], avoid};
}
