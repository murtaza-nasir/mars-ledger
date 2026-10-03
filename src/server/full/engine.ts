// Client for the open-source Terraforming Mars engine running as an internal service.
// Routes (from vendor/tm/src/common/app/paths.ts): api/creategame, api/player, api/spectator,
// api/game/logs, api/waitingfor, player/input. Undo is an option inside the engine's top-level
// 'or' input (UndoActionOption) when undoOption is on, so phones undo by answering it.
import {visibleLogLines} from '../../shared/logfilter';
import type {Color, InputResponse, LogLine, PlayerViewModel, SpectatorModel} from '../../shared/full';

export class EngineError extends Error {}

export type CreatedGame = {id: string; name?: string; spectatorId: string; players: Array<{id: string; name: string; color: Color}>};

export class EngineClient {
  constructor(private base = (process.env.ENGINE_URL ?? 'http://localhost:8791').replace(/\/$/, '')) {}
  static readonly SLOW_MS = 1500;

  /** The health probe: the engine's front page (a few hundred bytes), within timeoutMs. Throws when it does not answer. */
  async ping(timeoutMs = 2000): Promise<void> {
    let r: Response;
    try {
      r = await fetch(this.base + '/', {signal: AbortSignal.timeout(timeoutMs)});
    } catch (e) {
      throw new EngineError(`The game engine is not reachable (${(e as Error).message})`);
    }
    await r.body?.cancel().catch(() => {});
    if (!r.ok) throw new EngineError(`The game engine answered ${r.status}`);
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    let r: Response;
    const started = Date.now();
    try {
      r = await fetch(this.base + path, {...init, signal: AbortSignal.timeout(15000)});
    } catch (e) {
      throw new EngineError(`The game engine is not reachable (${(e as Error).message})`);
    }
    // Every screen waits on these: a slow engine shows up here first.
    const ms = Date.now() - started;
    if (ms > EngineClient.SLOW_MS) console.warn(`engine: ${init?.method ?? 'GET'} ${path.split('?')[0]} took ${ms} ms`);
    const text = await r.text();
    if (!r.ok) {
      let message = text;
      try { message = (JSON.parse(text) as {message?: string}).message ?? text; } catch { /* plain text or HTML */ }
      throw new EngineError(message.replace(/<[^>]+>/g, '').trim().slice(0, 300) || `Engine error ${r.status}`);
    }
    return JSON.parse(text) as T;
  }

  createGame(opts: {players: Array<{name: string; color: Color; beginner?: boolean}>; draft: boolean; board?: 'tharsis' | 'hellas' | 'elysium'; prelude?: boolean; fastMode?: boolean; seed?: number}): Promise<CreatedGame> {
    const expansions = {corpera: true, promo: false, venus: false, colonies: false, prelude: !!opts.prelude, prelude2: false, turmoil: false,
      community: false, ares: false, moon: false, pathfinders: false, ceo: false, starwars: false, underworld: false, deltaProject: false};
    const body = {
      players: opts.players.map((p, i) => ({name: p.name, color: p.color, beginner: !!p.beginner, handicap: 0, first: i === 0})),
      expansions, board: opts.board ?? 'tharsis', seed: opts.seed ?? Math.random(), randomFirstPlayer: false,
      undoOption: true, showTimers: false, fastModeOption: !!opts.fastMode, showOtherPlayersVP: true,
      aresExtremeVariant: false, politicalAgendasExtension: 'Standard', solarPhaseOption: false, removeNegativeGlobalEventsOption: false,
      modularMA: false, draftVariant: opts.draft, initialDraft: false, preludeDraftVariant: false, ceosDraftVariant: false,
      startingCorporations: 2, shuffleMapOption: false, randomMA: 'No randomization', includeFanMA: false, soloTR: false,
      customCorporationsList: [], bannedCards: [], includedCards: [], customColoniesList: [], customPreludes: [],
      requiresMoonTrackCompletion: false, requiresVenusTrackCompletion: false, moonStandardProjectVariant: false,
      moonStandardProjectVariant1: false, altVenusBoard: false, twoCorpsVariant: false, customCeos: [], startingCeos: 3, startingPreludes: 4,
      // Test hook: extra engine game options as JSON, e.g. {"includedCards": [...], "bannedCards": [...]}.
      ...JSON.parse(process.env.ENGINE_GAME_OPTIONS || '{}'),
    };
    return this.req<CreatedGame>('/api/creategame', {method: 'POST', body: JSON.stringify(body)});
  }

  player(engineId: string): Promise<PlayerViewModel> {
    return this.req(`/api/player?id=${encodeURIComponent(engineId)}`);
  }

  spectator(spectatorId: string): Promise<SpectatorModel> {
    return this.req(`/api/spectator?id=${encodeURIComponent(spectatorId)}`);
  }

  /** Recent log lines visible to this participant (a player id includes their private lines). */
  logs(participantId: string): Promise<LogLine[]> {
    // Every log line reaches devices through here: drop the ones meaning nothing to players (the game id).
    return this.req<LogLine[]>(`/api/game/logs?id=${encodeURIComponent(participantId)}`).then(visibleLogLines);
  }

  /**
   * The engine's load_game route: drop the newest `rollbackCount` saves and reload the newest one left. The engine saves
   * when a turn menu opens, so 0 restores the menu before a move still in its follow-up questions, and 1 is one undo step.
   */
  load(gameId: string, rollbackCount: number): Promise<unknown> {
    return this.req('/load_game', {method: 'PUT', body: JSON.stringify({gameId, rollbackCount})});
  }

  input(engineId: string, response: InputResponse): Promise<PlayerViewModel> {
    return this.req(`/player/input?id=${encodeURIComponent(engineId)}`, {method: 'POST', body: JSON.stringify(response)});
  }
}
