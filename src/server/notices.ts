// "Table sense", server side: keeps each human seat's last view and log, turns every new view into notices
// (src/shared/notices.ts), stores them per game and seat in SQLite and tells that seat's phones. Hits stay until the
// player clears them; an undo (the engine going back to an earlier gameAge) takes away the notices of the undone moves.
import type {DatabaseSync} from 'node:sqlite';
import type {LogLine, PlayerViewModel, SpectatorModel} from '../shared/full';
import {FEED_MAX, newLogLines, noticesFor} from '../shared/notices';
import type {Notice, NoticeFeed} from '../shared/notices';
import {isRewind} from '../shared/sync';

/** How many notices are kept per seat and game. */
const KEEP = 400;

export type SeatView = {playerId: string; model: PlayerViewModel; logs: LogLine[]};

export class NoticeDesk {
  /** Each seat's previous view and log lines, for the current engine game. */
  private last = new Map<string, {gameId: string; model: PlayerViewModel; logs: LogLine[]}>();

  /** `tell(playerId, feed, fresh)`: send a seat's feed to its phones (`fresh`: ids that are new in this send). */
  constructor(private db: DatabaseSync, private tell: (playerId: string, feed: NoticeFeed, fresh: string[]) => void) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, game TEXT NOT NULL, seat TEXT NOT NULL, at INTEGER NOT NULL,
        age INTEGER NOT NULL, kind TEXT NOT NULL, cleared INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS notices_seat ON notices (game, seat, at);
      CREATE TABLE IF NOT EXISTS notice_seen (game TEXT NOT NULL, seat TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (game, seat));
    `);
  }

  /**
   * One consistent cut of the game: the spectator model and each human seat's own view (bot seats have none). The
   * first view of a seat (a new game, a restart) only sets the baseline.
   */
  observe(gameId: string, spectator: SpectatorModel | null, views: SeatView[], now = Date.now()) {
    let rewoundTo: number | null = null;
    const made = new Map<string, Notice[]>();
    for (const v of views) {
      const prev = this.last.get(v.playerId);
      this.last.set(v.playerId, {gameId, model: v.model, logs: v.logs});
      if (!prev || prev.gameId !== gameId) continue;
      const g0 = prev.model.game; const g1 = v.model.game;
      if (isRewind(g0, g1)) { rewoundTo = rewoundTo === null ? g1.gameAge : Math.min(rewoundTo, g1.gameAge); continue; }
      if (g0.gameAge === g1.gameAge && g0.undoCount === g1.undoCount && JSON.stringify(prev.model.thisPlayer) === JSON.stringify(v.model.thisPlayer) &&
        prev.model.cardsInHand.map((c) => c.name).join('|') === v.model.cardsInHand.map((c) => c.name).join('|')) continue;
      const lines = newLogLines(prev.logs, v.logs);
      const before = v.logs.slice(0, v.logs.length - lines.length);
      let ns: Notice[];
      try {
        ns = noticesFor(null, spectator, prev.model, v.model, {lines, before}, {gameId, playerId: v.playerId, at: now});
      } catch (e) {
        console.warn('notices: detection failed:', (e as Error).message);
        continue;
      }
      if (ns.length) made.set(v.playerId, ns);
    }
    if (rewoundTo !== null) this.retract(gameId, rewoundTo);
    for (const [playerId, ns] of made) {
      this.save(gameId, playerId, ns);
      this.tell(playerId, this.feed(gameId, playerId), ns.map((n) => n.id));
    }
  }

  private save(gameId: string, seat: string, ns: Notice[]) {
    const ins = this.db.prepare('INSERT OR REPLACE INTO notices (id, game, seat, at, age, kind, cleared, json) VALUES (?, ?, ?, ?, ?, ?, 0, ?)');
    for (const n of ns) ins.run(n.id, gameId, seat, n.at, n.age, n.kind, JSON.stringify(n));
    const row = this.db.prepare('SELECT at FROM notices WHERE game = ? AND seat = ? ORDER BY at DESC LIMIT 1 OFFSET ?').get(gameId, seat, KEEP) as {at: number} | undefined;
    if (row) this.db.prepare('DELETE FROM notices WHERE game = ? AND seat = ? AND at <= ?').run(gameId, seat, row.at);
  }

  /** An undo took the game back to `age`: notices from later moments describe moves that were taken back. */
  retract(gameId: string, age: number) {
    const seats = this.db.prepare('SELECT DISTINCT seat FROM notices WHERE game = ? AND age > ?').all(gameId, age) as Array<{seat: string}>;
    if (!seats.length) return;
    this.db.prepare('DELETE FROM notices WHERE game = ? AND age > ?').run(gameId, age);
    for (const {seat} of seats) this.tell(seat, this.feed(gameId, seat), []);
  }

  /** A seat's newest notices (newest first) and when its feed was last opened. */
  feed(gameId: string, seat: string): NoticeFeed {
    const rows = this.db.prepare('SELECT json, cleared FROM notices WHERE game = ? AND seat = ? ORDER BY at DESC, id DESC LIMIT ?').all(gameId, seat, FEED_MAX) as Array<{json: string; cleared: number}>;
    const seen = this.db.prepare('SELECT seen_at FROM notice_seen WHERE game = ? AND seat = ?').get(gameId, seat) as {seen_at: number} | undefined;
    return {gameId, playerId: seat, notices: rows.map((r) => ({...JSON.parse(r.json) as Notice, cleared: !!r.cleared})), seenAt: seen?.seen_at ?? 0};
  }

  /** The player cleared some hits (or all of them when `ids` is missing). */
  clear(gameId: string, seat: string, ids?: string[]) {
    if (ids) {
      const up = this.db.prepare('UPDATE notices SET cleared = 1 WHERE game = ? AND seat = ? AND id = ?');
      for (const id of ids) up.run(gameId, seat, id);
    } else {
      this.db.prepare('UPDATE notices SET cleared = 1 WHERE game = ? AND seat = ?').run(gameId, seat);
    }
    this.tell(seat, this.feed(gameId, seat), []);
  }

  /** The player opened the feed: everything up to `upTo` has been read. */
  seen(gameId: string, seat: string, upTo: number) {
    this.db.prepare('INSERT INTO notice_seen (game, seat, seen_at) VALUES (?, ?, ?) ON CONFLICT(game, seat) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)')
      .run(gameId, seat, upTo);
    this.tell(seat, this.feed(gameId, seat), []);
  }

  /** A new game: no seat has a baseline in it yet. */
  newGame() { this.last.clear(); }
}
