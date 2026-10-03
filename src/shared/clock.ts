// The turn clock: a gentle, table-wide nudge that shows how long the active player has been on their turn.
// It never forces anything. The server stamps when each turn starts and which windows do not count
// (the production show and recap, cinematics), so every phone and the TV show the same time.
import type {GameState, Tick} from './game';
import type {PublicPlayerModel, SpectatorModel} from './full';

export const TURN_CLOCKS = ['off', 'relaxed', 'brisk'] as const;
export type TurnClockSetting = typeof TURN_CLOCKS[number];
export const isTurnClockSetting = (v: unknown): v is TurnClockSetting => (TURN_CLOCKS as readonly unknown[]).includes(v);

/** Per-turn budgets. A turn is one or two actions, so these are generous on purpose. */
export const TURN_BUDGET_MS: Record<Exclude<TurnClockSetting, 'off'>, number> = {relaxed: 180_000, brisk: 90_000};
export const TURN_CLOCK_LABEL: Record<TurnClockSetting, string> = {off: 'Off', relaxed: 'Relaxed', brisk: 'Brisk'};
export const TURN_CLOCK_HINT: Record<TurnClockSetting, string> = {
  off: 'No clock.',
  relaxed: '3 minutes a turn, shown on your phone and the TV. Nothing happens when it runs out.',
  brisk: '90 seconds a turn, shown on your phone and the TV. Nothing happens when it runs out.',
};
/** The warmer, pulsing stretch at the end of a turn. */
export const CLOCK_WARM_FRACTION = 0.2;

/** Windows that do not count against a turn, in server milliseconds. */
export type Hold = [from: number, to: number];

/** Everything a device needs to draw the clock. `startedAt` and holds are server time; `serverNow` lets a
 *  device convert to its own clock when the message arrives. `playerId` null means nobody's turn (paused). */
export type TurnClock = {
  setting: TurnClockSetting;
  budgetMs: number;
  playerId: string | null;
  color: string | null;
  /** a fresh value per turn, so a new turn always restarts the ring */
  turnKey: string;
  startedAt: number;
  holds: Hold[];
  serverNow: number;
};

/** Hold lengths for the server-known shows (milliseconds). Kept in one place so the tests can assert them. */
export const HOLD_MS = {
  /** the synchronized production show (its own durationMs) is followed by the generation recap */
  recapAfterShow: 300 + 8_600,
  /** corporation reveal: per player, plus a breath */
  revealPerPlayer: 2_600,
  revealExtra: 600,
  /** a terraforming milestone cinematic (last ocean, 14% oxygen, +8 °C) */
  milestone: 5_000,
};

/** Milliseconds of `[from, to]` covered by `holds` (holds may overlap each other). */
export function heldWithin(holds: Hold[], from: number, to: number): number {
  const parts = holds.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as Hold).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of parts) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/** Time used on the current turn at server time `now`, holds excluded. */
export function usedMs(c: Pick<TurnClock, 'startedAt' | 'holds'>, now: number): number {
  return Math.max(0, now - c.startedAt - heldWithin(c.holds, c.startedAt, now));
}

/** Is `now` inside a hold (the clock is paused)? */
export function isHeld(holds: Hold[], now: number): boolean {
  return holds.some(([a, b]) => now >= a && now < b);
}

export type ClockReading = {remainingMs: number; fraction: number; warm: boolean; overTime: boolean; paused: boolean};

export function readClock(c: TurnClock, now: number): ClockReading {
  const used = usedMs(c, now);
  const remainingMs = c.budgetMs - used;
  const fraction = c.budgetMs > 0 ? Math.max(0, Math.min(1, remainingMs / c.budgetMs)) : 0;
  return {remainingMs, fraction, warm: remainingMs > 0 && fraction <= CLOCK_WARM_FRACTION, overTime: remainingMs <= 0, paused: isHeld(c.holds, now)};
}

/** "2:05", "0:07"; over time reads as "+0:12". */
export function formatClock(ms: number): string {
  const over = ms < 0;
  const s = Math.ceil(Math.abs(ms) / 1000);
  return `${over ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- full mode: turns from consecutive engine models --------------------------------------------

/** Acting means a player is taking turns (not research, drafting, preludes, production or the end).
 *  The engine reports 'research' through generation 1's first round once corporations are in. */
export function fullActing(s: Pick<SpectatorModel, 'game' | 'players'>): boolean {
  const ph = s.game.phase;
  if (ph === 'action') return true;
  return ph === 'research' && s.game.generation === 1 && s.players.length > 0 && s.players.every((p) => p.tableau.length > 0);
}

/** The player whose turn it is, or null when nobody is acting. */
export function fullTurnHolder(s: Pick<SpectatorModel, 'game' | 'players'>): PublicPlayerModel | null {
  if (!fullActing(s)) return null;
  const passed = new Set(s.game.passedPlayers);
  const active = s.players.filter((p) => p.isActive && !passed.has(p.color));
  return active.length === 1 ? active[0] : null;
}

export type FullTurnTracker = {color: string | null; actions: number; startedAt: number; turnNo: number};

/**
 * Advance the full-mode turn tracker with a new spectator model observed at `now`.
 * A new turn starts when the holder changes, when the holder's action count drops (their next turn),
 * or, once everyone else has passed, with every action they take (each action is a turn of its own).
 */
export function advanceFullTurn(prev: FullTurnTracker | null, s: Pick<SpectatorModel, 'game' | 'players'>, now: number): FullTurnTracker {
  const holder = fullTurnHolder(s);
  const color = holder?.color ?? null;
  const actions = holder?.actionsTakenThisRound ?? 0;
  const turnNo = (prev?.turnNo ?? 0) + 1;
  if (!prev || prev.color !== color) return {color, actions, startedAt: now, turnNo};
  if (!holder) return prev;
  const alone = s.players.filter((p) => !s.game.passedPlayers.includes(p.color)).length === 1;
  if (actions < prev.actions || (alone && actions > prev.actions)) return {color, actions, startedAt: now, turnNo};
  return {...prev, actions};
}

/** Holds the server can see coming in full mode: the reveal when the first round starts, terraforming
 *  maxima, and the production show plus recap (added by the caller from the show it broadcasts). */
export function fullHolds(prev: Pick<SpectatorModel, 'game' | 'players'> | null, next: Pick<SpectatorModel, 'game' | 'players'>, now: number): Hold[] {
  const out: Hold[] = [];
  if (prev && !fullActing(prev) && fullActing(next) && next.game.generation === 1) {
    out.push([now, now + next.players.length * HOLD_MS.revealPerPlayer + HOLD_MS.revealExtra]);
  }
  if (prev) {
    const maxed = (p: typeof prev) => [p.game.temperature >= 8, p.game.oxygenLevel >= 14, p.game.oceans >= 9];
    const a = maxed(prev);
    const b = maxed(next);
    for (let i = 0; i < 3; i++) if (!a[i] && b[i]) out.push([now, now + HOLD_MS.milestone]);
  }
  return out;
}

// ---- companion mode: turns from the command log -------------------------------------------------

/** Companion: whose turn it is and when it started, from the log (deterministic, survives restarts). */
export function companionTurn(state: GameState, ticks: Tick[]): {playerId: string; startedAt: number; turnKey: string} | null {
  if (state.mode === 'full' || state.phase !== 'action' || !state.current) return null;
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    if (t.events.some((e) => e.kind === 'turn' && e.player === state.current)) return {playerId: state.current, startedAt: t.at, turnKey: `c${t.seq}`};
  }
  return null;
}

/** Companion holds from the log: the corporation reveal as the first round starts, and terraforming maxima. */
export function companionHolds(state: GameState, ticks: Tick[], since: number): Hold[] {
  const out: Hold[] = [];
  for (const t of ticks) {
    if (t.at < since - 60_000) continue;
    for (const e of t.events) {
      if (e.kind === 'global' && ((e.param === 'temperature' && e.to >= 8) || (e.param === 'oxygen' && e.to >= 14) || (e.param === 'oceans' && e.to >= 9)) && e.from < e.to) {
        out.push([t.at, t.at + HOLD_MS.milestone]);
      }
    }
    // The last corporation chosen starts the first round and the TV plays the reveal.
    if (t.command.t === 'chooseCorp' && t.events.some((e) => e.kind === 'turn')) {
      out.push([t.at, t.at + state.players.length * HOLD_MS.revealPerPlayer + HOLD_MS.revealExtra]);
    }
  }
  return out;
}

export function budgetOf(setting: TurnClockSetting | undefined): number {
  return setting && setting !== 'off' ? TURN_BUDGET_MS[setting] : 0;
}
