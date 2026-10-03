// The radio's decisions, kept free of React and of YouTube so they can be tested: when the music plays in a
// game, how loud it is (the TV options, mute and ducking), what a reload resumes, and which player errors
// skip a track or retire the radio for the evening.
import type {GameState} from '../../../shared/game';
import type {SpectatorModel} from '../../../shared/full';

// ---- when the radio plays ---------------------------------------------------------------------
/**
 * Where the game is, for the radio: `before` until the first player move after setup, `playing` from then on,
 * `over` at the game's end (the music stops; no finale is scheduled), `none` in the lobby.
 */
export type RadioStage = 'none' | 'before' | 'playing' | 'over';

export function radioStage(state: GameState | null, model: SpectatorModel | null): RadioStage {
  if (!state || state.phase === 'lobby') return 'none';
  if (state.mode === 'full') {
    if (!model) return 'before';
    const g = model.game;
    if (g.phase === 'end') return 'over';
    // In generation 1 the engine can keep saying "research" while the first player acts, so a move is
    // read from the players: an action taken or used, a pass, or a later generation or phase.
    const moved = g.generation > 1 || g.passedPlayers.length > 0
      || model.players.some((p) => p.actionsTakenThisRound > 0 || p.actionsThisGeneration.length > 0)
      || ['production', 'solar', 'intergeneration'].includes(g.phase);
    return moved ? 'playing' : 'before';
  }
  if (state.phase === 'ended') return 'over';
  if (state.phase === 'setup' || state.phase === 'preludes') return 'before';
  if (state.generation > 1 || state.phase === 'production' || state.phase === 'finalGreenery') return 'playing';
  if (state.phase === 'research') return 'before';
  const moved = state.players.some((p) => p.turnActions > 0 || p.passed || p.usedActions.length > 0);
  return moved ? 'playing' : 'before';
}

/**
 * Once a game is under way it stays under way for the radio: the signs of a move (actions this turn) reset
 * between turns, so `before` never follows `playing` in the same game.
 */
export class StageLatch {
  private game: string | null = null;
  private started = false;
  /** `resumed`: the game a saved resume point belongs to (a reload mid-game is already under way). */
  observe(game: string | null, stage: RadioStage, resumed: string | null = null): RadioStage {
    if (game !== this.game) { this.game = game; this.started = game !== null && resumed === game; }
    if (stage === 'playing') this.started = true;
    return stage === 'before' && this.started ? 'playing' : stage;
  }
}

/** The game the radio's position belongs to (a new game starts the playlist from the top). */
export function gameKeyOf(state: GameState | null): string | null {
  if (!state || state.phase === 'lobby') return null;
  return state.mode === 'full' ? state.full?.gameId ?? state.id : state.id;
}

// ---- loudness ------------------------------------------------------------------------------------
/** YouTube's volume (0..100) for the radio: its own slider, under the TV's master volume, mute and ducking. */
export function playerVolume(o: {radioVolume: number; master: number; muted: boolean}, duck: number): number {
  if (o.muted) return 0;
  const v = clamp01(o.radioVolume) * clamp01(o.master) * clamp01(duck) * 100;
  return Math.round(v);
}

/** Ducking glides: down quickly (a voice must be heard from its first word), back up slowly. */
export const DUCK_DOWN_PER_S = 1 / 0.35;
export const DUCK_UP_PER_S = 1 / 1.6;

/** Move `current` toward `target` over `dtMs`, at the down or up rate. */
export function glide(current: number, target: number, dtMs: number): number {
  const dt = Math.max(0, dtMs) / 1000;
  if (target < current) return Math.max(target, current - DUCK_DOWN_PER_S * dt);
  return Math.min(target, current + DUCK_UP_PER_S * dt);
}

/** Holds that lower the music for a while, by name: the deepest live hold wins. */
export class DuckDesk {
  private holds = new Map<string, {depth: number; until: number}>();

  /** Lower the music to `depth` (0..1) for `ms` from `now`; the same key extends or replaces its hold. */
  duck(key: string, depth: number, ms: number, now: number) {
    if (!(ms > 0)) { this.holds.delete(key); return; }
    this.holds.set(key, {depth: clamp01(depth), until: now + ms});
  }

  /** Hold until released (a cinematic or the production show while it is on screen). */
  hold(key: string, depth: number) { this.holds.set(key, {depth: clamp01(depth), until: Infinity}); }
  release(key: string) { this.holds.delete(key); }

  /** The level the music should be at now (1 = not ducked). */
  level(now: number): number {
    let l = 1;
    for (const [k, h] of this.holds) {
      if (h.until <= now) { this.holds.delete(k); continue; }
      l = Math.min(l, h.depth);
    }
    return l;
  }

  get active(): string[] { return [...this.holds.keys()]; }
}

/** How deep each kind of duck goes (the music's share of its normal level). */
export const DUCK_DEPTH = {voice: 0.22, production: 0.35, cinema: 0.4, cue: 0.5} as const;

// ---- resuming after a reload ------------------------------------------------------------------
export const RESUME_KEY = 'mars-ledger-tv-radio';
export type ResumePoint = {game: string; index: number; seconds: number; videoId: string | null};

export function parseResume(raw: string | null): ResumePoint | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object' || typeof o.game !== 'string') return null;
    const index = Number.isInteger(o.index) && o.index >= 0 ? o.index : 0;
    const seconds = typeof o.seconds === 'number' && Number.isFinite(o.seconds) && o.seconds >= 0 ? o.seconds : 0;
    return {game: o.game, index, seconds, videoId: typeof o.videoId === 'string' ? o.videoId : null};
  } catch { return null; }
}

/** Where to start for this game: the saved point when it belongs to the game, otherwise the top. */
export function startPoint(saved: ResumePoint | null, game: string): {index: number; seconds: number} {
  if (!saved || saved.game !== game) return {index: 0, seconds: 0};
  // a few seconds back, so a reload does not land mid-phrase
  return {index: saved.index, seconds: Math.max(0, Math.floor(saved.seconds - 2))};
}

// ---- player errors --------------------------------------------------------------------------
/**
 * YouTube's onError codes: 2 = bad request (our parameters; nothing to skip to), 5 = the HTML5 player
 * failed, 100 = removed or private, 101/150 = the video's owner disabled embedding. Everything but 2 skips the track.
 */
export function errorKind(code: number): 'skip' | 'fatal' {
  return code === 2 ? 'fatal' : 'skip';
}

export function errorText(code: number): string {
  if (code === 100) return 'removed or private';
  if (code === 101 || code === 150 || code === 153) return 'embedding disabled';
  if (code === 5) return 'player error';
  if (code === 2) return 'bad request';
  return `error ${code}`;
}

/**
 * Skips in a row with nothing playing in between. Past the limit the playlist itself is taken as broken
 * (blocked embeds, offline) and the radio steps aside.
 */
export class SkipGuard {
  private run = 0;
  constructor(private limit = 6) {}
  skip(playlistLength: number): 'next' | 'give-up' {
    this.run++;
    const cap = playlistLength > 0 ? Math.min(this.limit, playlistLength) : this.limit;
    return this.run >= cap ? 'give-up' : 'next';
  }
  played() { this.run = 0; }
  get count() { return this.run; }
}

function clamp01(v: number) { return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
