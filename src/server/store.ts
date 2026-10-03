// Persistence: every game is its command log. State is rebuilt by replaying it.
import {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {nanoid} from 'nanoid';
import {apply, newGame} from '../shared/engine';
import type {Command, GameState, Tick} from '../shared/game';
import type {GameHistory} from '../shared/history';

export class Store {
  /** shared with the profile desk (src/server/profiles.ts), which keeps its tables in the same file */
  readonly db: DatabaseSync;
  constructor(dir: string) {
    fs.mkdirSync(dir, {recursive: true});
    this.db = new DatabaseSync(path.join(dir, 'tm.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, created INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ticks (game TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, command TEXT NOT NULL,
        PRIMARY KEY (game, seq));
      CREATE TABLE IF NOT EXISTS history (game TEXT PRIMARY KEY, updated INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seat_prefs (game TEXT NOT NULL, player TEXT NOT NULL, hints INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game, player));
    `);
  }

  /**
   * Personal settings of seats without a profile (a profiled seat keeps them on the profile). They live
   * outside the command log on purpose: toggling one is not a move, so it never shows up as "your last
   * move" for undo, never resets the turn clock and never replays.
   */
  seatPrefs(game: string): Record<string, {hints: boolean}> {
    const rows = this.db.prepare('SELECT player, hints FROM seat_prefs WHERE game = ?').all(game) as Array<{player: string; hints: number}>;
    return Object.fromEntries(rows.map((r) => [r.player, {hints: !!r.hints}]));
  }

  setSeatHints(game: string, player: string, hints: boolean) {
    this.db.prepare('INSERT INTO seat_prefs (game, player, hints) VALUES (?, ?, ?) ON CONFLICT(game, player) DO UPDATE SET hints = excluded.hints')
      .run(game, player, hints ? 1 : 0);
  }

  currentGameId(): string {
    const row = this.db.prepare('SELECT id FROM games WHERE archived = 0 ORDER BY created DESC LIMIT 1').get() as {id: string} | undefined;
    return row?.id ?? this.createGame();
  }

  /** How many games have been started (not lobbies), for naming the next one "Game N". */
  startedGames(): number {
    const row = this.db.prepare(`SELECT COUNT(DISTINCT game) AS n FROM ticks WHERE command LIKE '%"t":"start"%'`).get() as {n: number};
    return row.n;
  }

  createGame(): string {
    this.db.prepare('UPDATE games SET archived = 1 WHERE archived = 0').run();
    const id = nanoid(8);
    this.db.prepare('INSERT INTO games (id, created) VALUES (?, ?)').run(id, Date.now());
    return id;
  }

  commands(game: string): Array<{seq: number; at: number; command: Command}> {
    return (this.db.prepare('SELECT seq, at, command FROM ticks WHERE game = ? ORDER BY seq').all(game) as Array<{seq: number; at: number; command: string}>)
      .map((r) => ({seq: r.seq, at: r.at, command: JSON.parse(r.command) as Command}));
  }

  append(game: string, seq: number, at: number, command: Command) {
    this.db.prepare('INSERT INTO ticks (game, seq, at, command) VALUES (?, ?, ?, ?)').run(game, seq, at, JSON.stringify(command));
  }

  /** Full-mode story, keyed by the engine's game id. */
  loadHistory(game: string): GameHistory | null {
    const row = this.db.prepare('SELECT json FROM history WHERE game = ?').get(game) as {json: string} | undefined;
    return row ? JSON.parse(row.json) as GameHistory : null;
  }

  saveHistory(game: string, h: GameHistory) {
    this.db.prepare('INSERT INTO history (game, updated, json) VALUES (?, ?, ?) ON CONFLICT(game) DO UPDATE SET updated = excluded.updated, json = excluded.json')
      .run(game, Date.now(), JSON.stringify(h));
  }

  removeLast(game: string, seq: number) {
    this.db.prepare('DELETE FROM ticks WHERE game = ? AND seq = ?').run(game, seq);
  }

  /** Replay a game's log. Commands that no longer apply (after a rules fix) are skipped, not fatal. */
  replay(game: string): {state: GameState; ticks: Tick[]} {
    let state = newGame(game);
    const ticks: Tick[] = [];
    for (const c of this.commands(game)) {
      try {
        const r = apply(state, c.command);
        state = r.state;
        ticks.push({seq: c.seq, at: c.at, command: c.command, events: r.events});
      } catch (e) {
        console.warn(`replay: skipped seq ${c.seq} (${c.command.t}): ${(e as Error).message}`);
      }
    }
    return {state, ticks};
  }
}
