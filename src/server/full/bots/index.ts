// Bot seats in full games: which seats the server plays (from the game log) and the desk that plays them.
import type {GameState} from '../../../shared/game';
import {DEFAULT_BOT_SPEED} from '../../../shared/bots';
import type {BotTable} from './runner';

export {BOT_HOLD_FOR_TURN_MS, BOT_HOLD_GRACE_MS, BotDesk, botLogger} from './runner';
export type {BotLogEntry, BotSeat, BotTable} from './runner';

/** The running full game's bot seats with their engine players, or null when there is nothing for bots to do. */
export function botTable(state: GameState): BotTable | null {
  if (state.mode !== 'full' || state.phase !== 'full' || !state.full) return null;
  const link = state.full;
  const bots = state.players.filter((p) => p.bot && link.players[p.id]).map((p) => ({
    playerId: p.id, name: p.name, level: p.bot!, engineId: link.players[p.id].engineId, color: link.players[p.id].color,
  }));
  return bots.length ? {gameId: link.gameId, bots, speed: state.botSpeed ?? DEFAULT_BOT_SPEED} : null;
}
