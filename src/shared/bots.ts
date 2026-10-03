// Bot seats: server-side players in full games. A bot is a lobby seat like any other, marked with
// its level; the server answers its engine prompts (src/server/full/bots/). Phones never play a bot's seat.
import type {Color} from './full';
import type {GameState, PlayerState} from './game';

export const BOT_LEVELS = ['easy', 'normal', 'jev'] as const;
export type BotLevel = typeof BOT_LEVELS[number];

export const BOT_LEVEL_INFO: Record<BotLevel, {label: string; text: string}> = {
  easy: {label: 'Easy', text: 'Plays loosely: random cards, random tiles, passes early.'},
  normal: {label: 'Normal', text: 'Plays sensibly: buys and plays the cards that pay off, claims milestones, funds awards it leads, and keeps standard projects for the endgame.'},
  // Normal's top moves, chosen by TypeSafe's Jev with derived context.
  jev: {label: 'Hard (Jev)', text: "Normal's top moves, chosen by TypeSafe's Jev model reading the board, the cards and the race."},
};

/** How long bots take over their moves (table-wide). Table pace is the default: about as long as a person. */
export const BOT_SPEEDS = ['quick', 'table', 'slow'] as const;
export type BotSpeed = typeof BOT_SPEEDS[number];
export const DEFAULT_BOT_SPEED: BotSpeed = 'table';
export const isBotSpeed = (v: unknown): v is BotSpeed => (BOT_SPEEDS as readonly unknown[]).includes(v);
export const BOT_SPEED_LABEL: Record<BotSpeed, string> = {quick: 'Quick', table: 'Table pace', slow: 'Slow'};
export const BOT_SPEED_HINT: Record<BotSpeed, string> = {
  quick: 'Bots move within a few seconds.',
  table: 'Bots take about as long as a person: 6 to 15 seconds a turn, longer later in the game.',
  slow: 'Bots take their time, about half again as long as table pace.',
};

/** Names offered for a new bot, in order; the lobby suggests the first one not at the table. */
export const BOT_NAMES = ['Ares', 'Deimos', 'Phobos', 'Olympus', 'Hellas', 'Tharsis', 'Elysium', 'Noctis'];

/** The most seats a table can have (the engine allows five players). */
export const MAX_SEATS = 5;

export function isBot(p: Pick<PlayerState, 'bot'> | undefined | null): boolean {
  return !!p?.bot;
}

/** Is this seat at the table a bot? */
export function isBotSeat(state: Pick<GameState, 'players'>, playerId: string | null | undefined): boolean {
  return !!playerId && state.players.some((p) => p.id === playerId && !!p.bot);
}

/** The engine colours of the bot seats in a full game (the engine may have changed a lobby colour). */
export function botColors(state: Pick<GameState, 'players' | 'full'>): Set<Color> {
  const out = new Set<Color>();
  for (const p of state.players) {
    if (!p.bot) continue;
    out.add(state.full?.players[p.id]?.color ?? p.color);
  }
  return out;
}

/** The name the lobby suggests for the next bot. */
export function nextBotName(state: Pick<GameState, 'players'>): string {
  const used = new Set(state.players.map((p) => p.name.toLowerCase()));
  return BOT_NAMES.find((n) => !used.has(n.toLowerCase())) ?? `Bot ${state.players.filter((p) => p.bot).length + 1}`;
}
