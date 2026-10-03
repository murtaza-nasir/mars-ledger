// People across game nights, kept in the same SQLite file as the games. Profiles are created from
// phones; a finished game writes one result row per seated profile; achievements are replayed from a
// profile's results whenever they change, so recording a game twice or merging profiles never
// double-counts. Abandoned games are never recorded (the caller only records finished games).
import type {DatabaseSync} from 'node:sqlite';
import {unlocksFor, ACHIEVEMENT_BY_ID} from '../shared/achievements';
import {isWin, lifetime, WIN_RATE_MIN_GAMES} from '../shared/profiles';
import type {GameResult, GameUnlocks, HallOfFame, Profile, ProfileDetail, ProfileSummary, RecentGame, Unlock} from '../shared/profiles';
import {PLAYER_COLORS} from '../shared/game';
import type {PlayerColor} from '../shared/game';

/** Bump when the profile tables change; each step runs once, in order, on an existing database. */
const MIGRATIONS: string[] = [
  // 1: profiles, devices, results, recorded games, unlocks
  `CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, avatar TEXT,
     created INTEGER NOT NULL, merged_into TEXT);
   CREATE TABLE IF NOT EXISTS devices (device TEXT PRIMARY KEY, profile TEXT NOT NULL, at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS results (game TEXT NOT NULL, profile TEXT NOT NULL, ended_at INTEGER NOT NULL, json TEXT NOT NULL,
     PRIMARY KEY (game, profile));
   CREATE INDEX IF NOT EXISTS results_profile ON results (profile, ended_at);
   CREATE TABLE IF NOT EXISTS recorded_games (game TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS unlocks (profile TEXT NOT NULL, achievement TEXT NOT NULL, game TEXT NOT NULL, at INTEGER NOT NULL,
     PRIMARY KEY (profile, achievement));`,
  // 2: a person's own settings that follow them between game nights
  `ALTER TABLE profiles ADD COLUMN hints INTEGER NOT NULL DEFAULT 0;`,
];

export class ProfileError extends Error {}

const NAME_MAX = 20;
const cleanName = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const isColor = (c: unknown): c is PlayerColor => typeof c === 'string' && (PLAYER_COLORS as readonly string[]).includes(c);
const isAvatar = (a: unknown) => a === null || (typeof a === 'string' && /^R\d{2}$/.test(a));
const isId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(s);

export class ProfileDesk {
  constructor(private db: DatabaseSync) {
    this.migrate();
  }

  private migrate() {
    const v = (this.db.prepare('PRAGMA user_version').get() as {user_version: number}).user_version;
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[i]);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  private tx<T>(f: () => T): T {
    this.db.exec('BEGIN');
    try { const r = f(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---- profiles ----------------------------------------------------------------------------
  get(id: string): Profile | null {
    const r = this.db.prepare('SELECT id, name, color, avatar, created, merged_into, hints FROM profiles WHERE id = ?').get(id) as
      {id: string; name: string; color: string; avatar: string | null; created: number; merged_into: string | null; hints: number} | undefined;
    if (!r) return null;
    if (r.merged_into) return this.get(r.merged_into);
    return {id: r.id, name: r.name, color: r.color as PlayerColor, avatar: r.avatar, created: r.created, hints: !!r.hints};
  }

  list(): ProfileSummary[] {
    const rows = this.db.prepare(`SELECT p.id, p.name, p.color, p.avatar, p.created, p.hints,
        (SELECT COUNT(*) FROM results r WHERE r.profile = p.id) AS games,
        (SELECT MAX(ended_at) FROM results r WHERE r.profile = p.id) AS last
      FROM profiles p WHERE p.merged_into IS NULL`).all() as Array<{id: string; name: string; color: string; avatar: string | null; created: number; hints: number; games: number; last: number | null}>;
    const wins = new Map<string, number>();
    for (const r of this.db.prepare('SELECT profile, json FROM results').all() as Array<{profile: string; json: string}>) {
      if (isWin(JSON.parse(r.json) as GameResult)) wins.set(r.profile, (wins.get(r.profile) ?? 0) + 1);
    }
    return rows.map((r) => ({id: r.id, name: r.name, color: r.color as PlayerColor, avatar: r.avatar, created: r.created, hints: !!r.hints,
      games: r.games, wins: wins.get(r.id) ?? 0, lastPlayed: r.last}))
      .sort((a, b) => (b.lastPlayed ?? b.created) - (a.lastPlayed ?? a.created));
  }

  create(input: {id: unknown; name: unknown; color: unknown; avatar?: unknown}, now = Date.now()): Profile {
    const name = cleanName(input.name);
    if (!isId(input.id)) throw new ProfileError('That profile id is not valid');
    if (!name) throw new ProfileError('A profile needs a name');
    if (!isColor(input.color)) throw new ProfileError('Pick a colour');
    const avatar = input.avatar ?? null;
    if (!isAvatar(avatar)) throw new ProfileError('That avatar is not available');
    const existing = this.get(input.id);
    if (existing) return existing;
    if (this.list().some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new ProfileError(`${name} already has a profile. Pick it from the list.`);
    this.db.prepare('INSERT INTO profiles (id, name, color, avatar, created) VALUES (?, ?, ?, ?, ?)').run(input.id, name, input.color, avatar as string | null, now);
    return this.get(input.id)!;
  }

  update(id: string, patch: {name?: unknown; color?: unknown; avatar?: unknown; hints?: unknown}): Profile {
    const p = this.get(id);
    if (!p || p.id !== id) throw new ProfileError('That profile does not exist');
    const name = patch.name === undefined ? p.name : cleanName(patch.name);
    if (!name) throw new ProfileError('A profile needs a name');
    if (name.toLowerCase() !== p.name.toLowerCase() && this.list().some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
      throw new ProfileError(`${name} is already taken`);
    }
    const color = patch.color === undefined ? p.color : patch.color;
    if (!isColor(color)) throw new ProfileError('Pick a colour');
    const avatar = patch.avatar === undefined ? p.avatar : patch.avatar;
    if (!isAvatar(avatar)) throw new ProfileError('That avatar is not available');
    if (patch.hints !== undefined && typeof patch.hints !== 'boolean') throw new ProfileError('Hints are either on or off');
    const hints = patch.hints === undefined ? !!p.hints : patch.hints;
    this.db.prepare('UPDATE profiles SET name = ?, color = ?, avatar = ?, hints = ? WHERE id = ?').run(name, color, avatar as string | null, hints ? 1 : 0, id);
    return this.get(id)!;
  }

  /**
   * Fold a duplicate profile into another: its games, devices and achievements move over, and the
   * achievements are replayed so combined totals (e.g. a third win) unlock where they happened.
   */
  merge(fromId: string, intoId: string): Profile {
    const from = this.get(fromId);
    const into = this.get(intoId);
    if (!from || from.id !== fromId) throw new ProfileError('The duplicate profile does not exist');
    if (!into || into.id !== intoId) throw new ProfileError('The profile to keep does not exist');
    if (from.id === into.id) throw new ProfileError('Pick two different profiles');
    return this.tx(() => {
      const theirs = this.db.prepare('SELECT game, ended_at, json FROM results WHERE profile = ?').all(fromId) as Array<{game: string; ended_at: number; json: string}>;
      const mine = new Set((this.db.prepare('SELECT game FROM results WHERE profile = ?').all(intoId) as Array<{game: string}>).map((r) => r.game));
      for (const r of theirs) {
        // Both profiles in the same game cannot both be this person; the kept profile's row wins.
        if (!mine.has(r.game)) {
          const res = {...(JSON.parse(r.json) as GameResult), profileId: intoId};
          this.db.prepare('INSERT INTO results (game, profile, ended_at, json) VALUES (?, ?, ?, ?)').run(r.game, intoId, r.ended_at, JSON.stringify(res));
        }
      }
      this.db.prepare('DELETE FROM results WHERE profile = ?').run(fromId);
      this.db.prepare('DELETE FROM unlocks WHERE profile = ?').run(fromId);
      this.db.prepare('UPDATE devices SET profile = ? WHERE profile = ?').run(intoId, fromId);
      this.db.prepare('UPDATE profiles SET merged_into = ? WHERE id = ?').run(intoId, fromId);
      // Recent-games summaries point at the kept profile too.
      for (const g of this.db.prepare('SELECT game, json FROM recorded_games').all() as Array<{game: string; json: string}>) {
        const rg = JSON.parse(g.json) as RecentGame;
        if (!rg.players.some((p) => p.profileId === fromId)) continue;
        rg.players = rg.players.map((p) => (p.profileId === fromId ? {...p, profileId: intoId} : p));
        this.db.prepare('UPDATE recorded_games SET json = ? WHERE game = ?').run(JSON.stringify(rg), g.game);
      }
      this.rebuild(intoId);
      return this.get(intoId)!;
    });
  }

  // ---- devices -----------------------------------------------------------------------------
  claimDevice(device: string, profileId: string, now = Date.now()) {
    if (!isId(device) || !this.get(profileId)) return;
    this.db.prepare('INSERT INTO devices (device, profile, at) VALUES (?, ?, ?) ON CONFLICT(device) DO UPDATE SET profile = excluded.profile, at = excluded.at')
      .run(device, this.get(profileId)!.id, now);
  }

  deviceProfile(device: string): string | null {
    const r = this.db.prepare('SELECT profile FROM devices WHERE device = ?').get(device) as {profile: string} | undefined;
    return r ? this.get(r.profile)?.id ?? null : null;
  }

  // ---- results -----------------------------------------------------------------------------
  /**
   * Record (or re-record) a finished game. Rows for the game are replaced, every affected profile's
   * achievements are replayed, and the achievements this game unlocked are returned.
   */
  recordGame(game: RecentGame, results: GameResult[]): Array<{profileId: string; achievements: string[]}> {
    return this.tx(() => {
      const before = (this.db.prepare('SELECT profile FROM results WHERE game = ?').all(game.gameId) as Array<{profile: string}>).map((r) => r.profile);
      this.db.prepare('DELETE FROM results WHERE game = ?').run(game.gameId);
      for (const r of results) {
        this.db.prepare('INSERT INTO results (game, profile, ended_at, json) VALUES (?, ?, ?, ?)').run(r.gameId, r.profileId, r.endedAt, JSON.stringify(r));
      }
      this.db.prepare('INSERT INTO recorded_games (game, ended_at, json) VALUES (?, ?, ?) ON CONFLICT(game) DO UPDATE SET ended_at = excluded.ended_at, json = excluded.json')
        .run(game.gameId, game.endedAt, JSON.stringify(game));
      for (const p of new Set([...before, ...results.map((r) => r.profileId)])) this.rebuild(p);
      return this.unlocksOfGame(game.gameId);
    });
  }

  /** Forget a game that turned out not to be finished (its end was undone). */
  unrecord(gameId: string) {
    this.tx(() => {
      const had = (this.db.prepare('SELECT profile FROM results WHERE game = ?').all(gameId) as Array<{profile: string}>).map((r) => r.profile);
      this.db.prepare('DELETE FROM results WHERE game = ?').run(gameId);
      this.db.prepare('DELETE FROM recorded_games WHERE game = ?').run(gameId);
      for (const p of new Set(had)) this.rebuild(p);
    });
  }

  isRecorded(gameId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM recorded_games WHERE game = ?').get(gameId);
  }

  results(profileId: string): GameResult[] {
    return (this.db.prepare('SELECT json FROM results WHERE profile = ? ORDER BY ended_at, game').all(profileId) as Array<{json: string}>)
      .map((r) => JSON.parse(r.json) as GameResult);
  }

  private rebuild(profileId: string) {
    this.db.prepare('DELETE FROM unlocks WHERE profile = ?').run(profileId);
    for (const u of unlocksFor(this.results(profileId))) {
      this.db.prepare('INSERT INTO unlocks (profile, achievement, game, at) VALUES (?, ?, ?, ?)').run(profileId, u.achievement, u.gameId, u.at);
    }
  }

  unlocksOfGame(gameId: string): Array<{profileId: string; achievements: string[]}> {
    const rows = this.db.prepare('SELECT profile, achievement FROM unlocks WHERE game = ?').all(gameId) as Array<{profile: string; achievement: string}>;
    const by = new Map<string, string[]>();
    const order = new Map([...ACHIEVEMENT_BY_ID.keys()].map((k, i) => [k, i]));
    for (const r of rows) by.set(r.profile, [...(by.get(r.profile) ?? []), r.achievement]);
    return [...by.entries()].map(([profileId, a]) => ({profileId, achievements: a.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0))}));
  }

  /** The phones' and the TV's view of what a game unlocked, with seat names. */
  gameUnlocks(gameId: string, seats: Array<{profileId: string; playerId: string | null; name: string; color: string}>): GameUnlocks {
    const u = this.unlocksOfGame(gameId);
    return {gameId, players: seats.map((s) => ({...s, achievements: u.find((x) => x.profileId === s.profileId)?.achievements ?? []}))};
  }

  detail(profileId: string): ProfileDetail | null {
    const profile = this.get(profileId);
    if (!profile) return null;
    const results = this.results(profile.id);
    const unlocked = (this.db.prepare('SELECT profile, achievement, game, at FROM unlocks WHERE profile = ? ORDER BY at, achievement').all(profile.id) as
      Array<{profile: string; achievement: string; game: string; at: number}>).map((r) => ({profileId: r.profile, achievement: r.achievement, gameId: r.game, at: r.at}));
    return {profile, stats: lifetime(results), unlocked, recent: [...results].reverse().slice(0, 8)};
  }

  hallOfFame(): HallOfFame {
    const people = this.list().filter((p) => p.games > 0);
    const leaderboard = people.map((p) => {
      const s = lifetime(this.results(p.id));
      return {profile: {id: p.id, name: p.name, color: p.color, avatar: p.avatar, created: p.created}, games: s.games, wins: s.wins,
        winRate: s.winRate, bestScore: s.bestScore};
    }).sort((a, b) => b.wins - a.wins || (b.winRate ?? -1) - (a.winRate ?? -1) || (b.bestScore ?? 0) - (a.bestScore ?? 0) || b.games - a.games);
    const recent = (this.db.prepare('SELECT json FROM recorded_games ORDER BY ended_at DESC LIMIT 6').all() as Array<{json: string}>)
      .map((r) => JSON.parse(r.json) as RecentGame);
    const latest = (this.db.prepare('SELECT profile, achievement, game, at FROM unlocks ORDER BY at DESC, achievement LIMIT 8').all() as
      Array<{profile: string; achievement: string; game: string; at: number}>).flatMap((r): HallOfFame['latest'] => {
      const p = this.get(r.profile);
      return p ? [{profileId: p.id, achievement: r.achievement, gameId: r.game, at: r.at, name: p.name, color: p.color}] : [];
    });
    return {leaderboard, recent, latest};
  }
}

export {WIN_RATE_MIN_GAMES};
export type {Unlock};
