// Day and night on the TV: each generation runs from dusk (its first turn) through night to dawn (everyone
// has passed). Pure functions so both modes, and the tests, agree on where in the generation the table is.
import type {GameState, Tick} from '../../../shared/game';

/** Light weights for the three sky layers; each 0..1. Night peaks in the middle of the generation. */
export type SkyLight = {dusk: number; night: number; dawn: number};

export const NO_LIGHT: SkyLight = {dusk: 0, night: 0, dawn: 0};

/** 0 = dusk (the generation's first turn), 0.5 = deepest night, 1 = dawn (everyone passed / production). */
export function skyLight(t: number): SkyLight {
  const x = Math.min(1, Math.max(0, t));
  const night = Math.sin(Math.PI * x);
  return {dusk: (1 - x) * (1 - night * 0.8), night, dawn: x * (1 - night * 0.8)};
}

/**
 * The engine logs a few lines per decision; its gameAge counts them. Calibrated from complete two- and
 * three-player games: about this many log lines per player per generation.
 */
export const LOG_LINES_PER_PLAYER = 12;
/** Never claim more than this of the night from the move count alone: dawn waits for the passes. */
const COUNT_CAP = 0.85;

type FullModelLike = {
  game: {generation: number; gameAge: number; phase: string; passedPlayers: string[]};
  players: Array<{isActive?: boolean}>;
};

const BEFORE_ACTIONS = new Set(['research', 'drafting', 'initial_drafting', 'initialdrafting', 'preludes', 'ceos']);
const AFTER_ACTIONS = new Set(['production', 'solar', 'intergeneration', 'end']);

/**
 * Full game: where the generation is, from the spectator model. `startAge` is the engine's gameAge when this
 * generation's action phase began (null if the TV joined mid-generation and does not know it).
 */
export function fullGenProgress(m: FullModelLike, startAge: number | null): number {
  const phase = m.game.phase;
  if (AFTER_ACTIONS.has(phase)) return 1;
  // In generation 1 the engine keeps reporting "research" while the first player already acts.
  const acting = phase === 'research' && m.players.some((p) => p.isActive);
  if (BEFORE_ACTIONS.has(phase) && !acting) return 0;
  const n = Math.max(1, m.players.length);
  const passed = Math.min(1, m.game.passedPlayers.length / n);
  if (passed >= 1) return 1;
  const counted = startAge === null ? 0 : Math.max(0, m.game.gameAge - startAge) / (n * LOG_LINES_PER_PLAYER);
  return Math.min(1, Math.max(passed, COUNT_CAP * Math.min(1, counted)));
}

/** Moves that count as a turn's worth of progress in companion mode. */
const TURN_MOVES = new Set(['playCard', 'action', 'standardProject', 'convertPlants', 'convertHeat', 'claimMilestone', 'fundAward', 'pass', 'endTurn']);
/** Companion players take about this many moves per generation each. */
export const MOVES_PER_PLAYER = 6;

/** Companion game: where the generation is, from our state and the recent moves. */
export function companionGenProgress(s: Pick<GameState, 'phase' | 'players' | 'generation'>, recent: Pick<Tick, 'command' | 'events'>[]): number {
  if (s.phase === 'production' || s.phase === 'ended') return 1;
  if (s.phase !== 'action' && s.phase !== 'finalGreenery') return 0;
  const n = Math.max(1, s.players.length);
  const passed = s.players.filter((p) => p.passed).length / n;
  if (passed >= 1) return 1;
  // moves since this generation began: after the newest "generation" event (or "started" for generation 1)
  let i = recent.length - 1;
  for (; i >= 0; i--) if (recent[i].events.some((e) => e.kind === 'generation' || e.kind === 'started')) break;
  const moves = recent.slice(i + 1).filter((t) => TURN_MOVES.has(t.command.t)).length;
  return Math.min(1, Math.max(passed, COUNT_CAP * Math.min(1, moves / (n * MOVES_PER_PLAYER))));
}

// ---- when to play weather ----------------------------------------------------------------------
export type WeatherGate = {enabled: boolean; reduced: boolean; covered: boolean};

/** A dust storm plays unless weather is off or something covers the board; reduced motion gets a still haze. */
export function stormMode(g: WeatherGate): 'off' | 'haze' | 'storm' {
  if (!g.enabled || g.covered) return 'off';
  return g.reduced ? 'haze' : 'storm';
}

/** Late-game mist after an ocean: only once the air is breathable-ish, never under reduced motion. */
export function mistAllowed(g: WeatherGate, oxygen: number): boolean {
  return g.enabled && !g.covered && !g.reduced && oxygen >= 9;
}
