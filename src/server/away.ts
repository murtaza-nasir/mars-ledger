// "While you were away", server side. Tracks, per seat, whether any phone for it is connected and
// visible; when the last one goes hidden or drops, the seat is away from that moment (persisted, so a
// server restart or another device taking the seat over still knows). When a phone for an away seat
// becomes visible again after AWAY_MIN_MS, the caller builds that player's summary.
// Full games also keep a journal of facts here (folded from engine updates as they happen); companion
// games read theirs from the command log instead (src/shared/away.ts).
import type {DatabaseSync} from 'node:sqlite';
import type {WebSocket} from 'ws';
import {AWAY_MIN_MS, HEARD_SLACK_MS} from '../shared/away';
import type {AwayEntry} from '../shared/away';

export type Return = {player: string; since: number; generation: number | null};

/** How long full-game journal entries are kept. */
const JOURNAL_MS = 24 * 3600_000;

export class AwayDesk {
  /** every phone socket that speaks for a seat, and whether its page is visible */
  private sockets = new Map<WebSocket, {player: string; visible: boolean; heard: number}>();
  /** seats away right now: since when, and the generation they left in (mirrors the presence table) */
  private away = new Map<string, {since: number; generation: number | null}>();
  private journalCache: {game: string; entries: AwayEntry[]} | null = null;
  /** Seats present when the server stopped are treated as away from the restart until a phone shows up. */
  private restartedAt = Date.now();
  readonly minMs: number;

  constructor(private db: DatabaseSync, private game: () => string, opts: {minMs?: number; startedAt?: number} = {}) {
    this.minMs = opts.minMs ?? AWAY_MIN_MS;
    db.exec(`
      CREATE TABLE IF NOT EXISTS presence (game TEXT NOT NULL, player TEXT NOT NULL, away_since INTEGER NOT NULL,
        generation INTEGER, PRIMARY KEY (game, player));
      CREATE TABLE IF NOT EXISTS away_journal (game TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS away_journal_game ON away_journal (game, at);
    `);
    this.load(opts.startedAt ?? Date.now());
  }

  /** Read the current game's away seats; after a restart, seats nobody has seen yet count from the restart. */
  private load(startedAt: number) {
    this.away.clear();
    const rows = this.db.prepare('SELECT player, away_since, generation FROM presence WHERE game = ?').all(this.game()) as Array<{player: string; away_since: number; generation: number | null}>;
    for (const r of rows) this.away.set(r.player, {since: r.away_since, generation: r.generation});
    this.restartedAt = startedAt;
  }

  /** A new game: nobody is away from it yet. */
  newGame() {
    this.away.clear();
    this.journalCache = null;
    this.restartedAt = Date.now();
  }

  private present(player: string): boolean {
    for (const s of this.sockets.values()) if (s.player === player && s.visible) return true;
    return false;
  }

  private markAway(player: string, at: number, generation: number | null) {
    this.away.set(player, {since: at, generation});
    this.db.prepare('INSERT INTO presence (game, player, away_since, generation) VALUES (?, ?, ?, ?) ON CONFLICT(game, player) DO UPDATE SET away_since = excluded.away_since, generation = excluded.generation')
      .run(this.game(), player, at, generation);
  }

  private markBack(player: string) {
    this.away.delete(player);
    this.db.prepare('DELETE FROM presence WHERE game = ? AND player = ?').run(this.game(), player);
  }

  /**
   * A phone said who it is and whether it is visible (hello, a visibility change). Returns the seat's
   * absence when this brings the seat back after being away long enough; otherwise null. Every phone
   * is tracked by the id it speaks for (seated or not yet: a lobby phone becomes a seat when it joins);
   * the caller only tells seated players what they missed.
   */
  update(ws: WebSocket, player: string | null, visible: boolean, now: number, generation: number | null): Return | null {
    const old = this.sockets.get(ws);
    // A socket that changes who it speaks for leaves its old seat first.
    if (old && old.player !== player) this.remove(ws, now, generation);
    if (!player) { this.sockets.delete(ws); return null; }
    const wasPresent = this.present(player);
    this.sockets.set(ws, {player, visible, heard: now});
    const isPresent = this.present(player);
    if (wasPresent && !isPresent) this.markAway(player, now, generation);
    if (!wasPresent && isPresent) return this.back(player, now);
    return null;
  }

  /** Any message from a phone: it is still there (visible phones send a heartbeat). */
  heard(ws: WebSocket, now: number) {
    const s = this.sockets.get(ws);
    if (s) s.heard = now;
  }

  /**
   * A socket closed: its seat may now be away. A clean close is noticed at once; a dropped connection
   * may be noticed much later, so the seat counts as away from shortly after its phone was last heard.
   */
  remove(ws: WebSocket, now: number, generation: number | null) {
    const old = this.sockets.get(ws);
    if (!old) return;
    const wasPresent = this.present(old.player);
    this.sockets.delete(ws);
    if (wasPresent && !this.present(old.player)) this.markAway(old.player, Math.min(now, old.heard + HEARD_SLACK_MS), generation);
  }

  private back(player: string, now: number): Return | null {
    const rec = this.away.get(player) ?? {since: this.restartedAt, generation: null};
    this.markBack(player);
    // Never seen since a restart: count from the restart, but only if it is long enough ago.
    if (now - rec.since < this.minMs) return null;
    return {player, since: rec.since, generation: rec.generation};
  }

  /** How many phones speak for each seat right now (connected, visible or not): the lobby shows who has a phone. */
  phones(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.sockets.values()) out[s.player] = (out[s.player] ?? 0) + 1;
    return out;
  }

  /** The seat a phone socket speaks for (null when unknown). */
  playerOf(ws: WebSocket): string | null {
    return this.sockets.get(ws)?.player ?? null;
  }

  /** When a seat went away (null while present or never tracked). */
  awaySince(player: string): number | null {
    return this.away.get(player)?.since ?? null;
  }

  // ---- full-game journal ------------------------------------------------------------------------
  journal(entries: AwayEntry[]) {
    if (!entries.length) return;
    const game = this.game();
    const ins = this.db.prepare('INSERT INTO away_journal (game, at, json) VALUES (?, ?, ?)');
    for (const e of entries) ins.run(game, e.at, JSON.stringify(e));
    // Old facts are never needed: a return reads at most one absence back (a day is plenty).
    const cutoff = Math.max(...entries.map((e) => e.at)) - JOURNAL_MS;
    this.db.prepare('DELETE FROM away_journal WHERE at < ?').run(cutoff);
    if (this.journalCache?.game === game) this.journalCache.entries = [...this.journalCache.entries, ...entries].filter((e) => e.at >= cutoff);
  }

  /** An undo: facts journaled after `since` describe moves that were taken back, so they go. */
  retract(since: number) {
    const game = this.game();
    this.db.prepare('DELETE FROM away_journal WHERE game = ? AND at > ?').run(game, since);
    if (this.journalCache?.game === game) this.journalCache.entries = this.journalCache.entries.filter((e) => e.at <= since);
  }

  entries(since: number): AwayEntry[] {
    const game = this.game();
    if (this.journalCache?.game !== game) {
      const rows = this.db.prepare('SELECT json FROM away_journal WHERE game = ? ORDER BY at').all(game) as Array<{json: string}>;
      this.journalCache = {game, entries: rows.map((r) => JSON.parse(r.json) as AwayEntry)};
    }
    return this.journalCache.entries.filter((e) => e.at >= since);
  }
}
