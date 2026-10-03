// The turn clock on the server: it decides whose turn it is, when that turn started and which windows
// do not count, and tells every device. Full games follow the engine's models; companion games follow
// the command log. The clock never changes the game.
import {advanceFullTurn, budgetOf, companionHolds, companionTurn, fullHolds, HOLD_MS} from '../shared/clock';
import type {FullTurnTracker, Hold, TurnClock} from '../shared/clock';
import type {SpectatorModel} from '../shared/full';
import type {GameState, Tick} from '../shared/game';

/** Holds older than this are dropped; no turn lasts this long while holds still matter. */
const HOLD_MEMORY_MS = 30 * 60_000;

export class TurnClockDesk {
  private gameId: string | null = null;
  private tracker: FullTurnTracker | null = null;
  private holds: Hold[] = [];
  private lastSent = '';

  /** A fresh engine model (full mode). */
  observeFull(gameId: string, prev: SpectatorModel | null, next: SpectatorModel, now = Date.now()) {
    if (this.gameId !== gameId) this.reset(gameId);
    this.tracker = advanceFullTurn(this.tracker, next, now);
    this.addHolds(fullHolds(prev, next, now), now);
  }

  /** The production show was broadcast: it and the recap after it do not count. */
  productionShow(startAt: number, durationMs: number, now = Date.now()) {
    this.addHolds([[now, startAt + durationMs + HOLD_MS.recapAfterShow]], now);
  }

  reset(gameId: string | null) {
    this.gameId = gameId;
    this.tracker = null;
    this.holds = [];
    this.lastSent = '';
  }

  private addHolds(h: Hold[], now: number) {
    if (!h.length) return;
    this.holds = [...this.holds.filter(([, b]) => b > now - HOLD_MEMORY_MS), ...h];
  }

  /** The clock as devices should draw it now (null: no clock at all). */
  current(state: GameState, ticks: Tick[], now = Date.now()): TurnClock | null {
    const setting = state.turnClock ?? 'off';
    if (setting === 'off' || state.phase === 'lobby' || state.phase === 'ended') return null;
    const base = {setting, budgetMs: budgetOf(setting), serverNow: now};
    if (state.mode === 'full') {
      const t = this.tracker;
      const link = state.full;
      if (!t || !link || this.gameId !== link.gameId) return {...base, playerId: null, color: null, turnKey: 'none', startedAt: now, holds: []};
      const playerId = t.color ? Object.entries(link.players).find(([, seat]) => seat.color === t.color)?.[0] ?? null : null;
      return {...base, playerId, color: t.color, turnKey: `f${t.turnNo}`, startedAt: t.startedAt, holds: this.holds.filter(([, b]) => b > t.startedAt)};
    }
    const turn = companionTurn(state, ticks);
    if (!turn) return {...base, playerId: null, color: null, turnKey: 'none', startedAt: now, holds: []};
    const color = state.players.find((p) => p.id === turn.playerId)?.color ?? null;
    const holds = companionHolds(state, ticks, turn.startedAt).filter(([, b]) => b > turn.startedAt);
    return {...base, playerId: turn.playerId, color, turnKey: turn.turnKey, startedAt: turn.startedAt, holds};
  }

  /** The clock if it changed since the last broadcast (serverNow is ignored for the comparison). */
  changed(state: GameState, ticks: Tick[], now = Date.now()): {clock: TurnClock | null} | null {
    const clock = this.current(state, ticks, now);
    const key = JSON.stringify(clock ? {...clock, serverNow: 0} : null);
    if (key === this.lastSent) return null;
    this.lastSent = key;
    return {clock};
  }
}
