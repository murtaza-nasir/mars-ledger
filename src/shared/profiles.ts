// People across game nights: profiles, one result row per profile per finished game, lifetime stats
// and the hall of fame. Pure functions; the server stores the rows (src/server/profiles.ts).
import type {BoardName} from './board';
import type {GameMode, PlayerColor} from './game';
import {totals} from './history';
import type {GameHistory} from './history';

export type Profile = {
  id: string;
  name: string;
  color: PlayerColor;
  /** a corporation portrait number (public/portraits/<n>.webp), or null for the colour monogram */
  avatar: string | null;
  created: number;
  /** smart hints on this person's phone; off unless they turn it on */
  hints?: boolean;
};

/** What the lobby and join screen show about a person. */
export type ProfileSummary = Profile & {games: number; wins: number; lastPlayed: number | null};

/** One player's finished game. `margin` is VP minus the best other score (negative when behind). */
export type GameResult = {
  gameId: string;
  profileId: string;
  name: string;
  color: string;
  endedAt: number;
  mode: GameMode;
  board: BoardName;
  generations: number;
  players: number;
  placement: number;
  vp: number;
  margin: number;
  corporations: string[];
  beginner: boolean;
  /** every global parameter at its maximum when the game ended (a natural finish) */
  terraformed: boolean;
  stats: ResultStats;
};

export type ResultStats = {
  cards: number;
  cities: number;
  greeneries: number;
  oceans: number;
  special: number;
  trGained: number;
  /** full games: every M€ spent; companion games: card costs only (the companion engine knows no more) */
  mcSpent: number;
  attacks: number;
  dealt: number;
  received: number;
  globalSteps: number;
  milestones: string[];
  awards: string[];
  /** global parameters this player took to their maximum */
  maxed: Array<'temperature' | 'oxygen' | 'oceans'>;
  /** this player raised strictly more global steps than anyone else (and at least one) */
  mostSteps: boolean;
};

export type SeatInput = {
  profileId: string;
  name: string;
  color: string;
  vp: number;
  corporations: string[];
  beginner: boolean;
};

/** Placement with shared ties: 1 + the number of players with strictly more points. */
export function placements(vps: number[]): number[] {
  return vps.map((v) => 1 + vps.filter((x) => x > v).length);
}

/**
 * The result rows for one finished game. `seats` are the players who have a profile; `allVps` are
 * every player's scores (players without a profile still count for placement and margin).
 */
export function buildResults(args: {
  gameId: string; endedAt: number; mode: GameMode; board: BoardName; generations: number; terraformed: boolean;
  seats: SeatInput[]; allScores: Array<{color: string; vp: number}>; history: GameHistory | null;
}): GameResult[] {
  const {seats, allScores, history} = args;
  const tot = history ? totals(history) : [];
  const steps = tot.map((t) => ({color: t.color, n: t.globalSteps})).sort((a, b) => b.n - a.n);
  const stepLeader = steps.length && steps[0].n > 0 && (steps.length < 2 || steps[1].n < steps[0].n) ? steps[0].color : null;
  return seats.map((seat) => {
    const others = allScores.filter((x) => x.color !== seat.color).map((x) => x.vp);
    const placement = 1 + allScores.filter((x) => x.color !== seat.color && x.vp > seat.vp).length;
    const t = tot.find((x) => x.color === seat.color);
    const attacks = history ? history.generations.reduce((a, g) => a + g.attacks.filter((x) => x.attacker === seat.color).length, 0) : 0;
    const maxed = history?.maxedBy ? (Object.entries(history.maxedBy).filter(([, c]) => c === seat.color).map(([k]) => k) as ResultStats['maxed']) : [];
    return {
      gameId: args.gameId, profileId: seat.profileId, name: seat.name, color: seat.color, endedAt: args.endedAt, mode: args.mode,
      board: args.board, generations: args.generations, players: allScores.length, placement, vp: seat.vp,
      margin: others.length ? seat.vp - Math.max(...others) : 0, corporations: seat.corporations, beginner: seat.beginner,
      terraformed: args.terraformed,
      stats: {
        cards: t?.cards.length ?? 0, cities: t?.tiles.city ?? 0, greeneries: t?.tiles.greenery ?? 0, oceans: t?.tiles.ocean ?? 0,
        special: t?.tiles.special ?? 0, trGained: t?.trGained ?? 0, mcSpent: t?.mcSpent ?? 0, attacks, dealt: t?.dealt ?? 0,
        received: t?.received ?? 0, globalSteps: t?.globalSteps ?? 0, milestones: t?.milestones ?? [], awards: t?.awards ?? [],
        maxed, mostSteps: stepLeader === seat.color,
      },
    };
  });
}

/** A win needs a rival: solo games count as games played, never as wins. */
export const isWin = (r: GameResult) => r.players >= 2 && r.placement === 1;

export type LifetimeStats = {
  games: number;
  wins: number;
  /** null until 3 games (a win rate from one game says nothing) */
  winRate: number | null;
  bestScore: number | null;
  averageVp: number | null;
  favouriteCorporation: {name: string; games: number} | null;
  mapsPlayed: BoardName[];
  mapsWon: BoardName[];
  cities: number;
  greeneries: number;
  oceans: number;
  cards: number;
  attacksDealt: number;
  unitsReceived: number;
  mcSpent: number;
};

export const WIN_RATE_MIN_GAMES = 3;

export function lifetime(results: GameResult[]): LifetimeStats {
  const games = results.length;
  const wins = results.filter(isWin).length;
  const corpCount = new Map<string, {games: number; last: number}>();
  for (const r of results) {
    for (const c of r.corporations) {
      const e = corpCount.get(c) ?? {games: 0, last: 0};
      e.games++; e.last = Math.max(e.last, r.endedAt);
      corpCount.set(c, e);
    }
  }
  const fav = [...corpCount.entries()].sort((a, b) => b[1].games - a[1].games || b[1].last - a[1].last)[0];
  const sum = (f: (r: GameResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const uniq = (xs: BoardName[]) => (['tharsis', 'hellas', 'elysium'] as BoardName[]).filter((b) => xs.includes(b));
  return {
    games, wins,
    winRate: games >= WIN_RATE_MIN_GAMES ? wins / games : null,
    bestScore: games ? Math.max(...results.map((r) => r.vp)) : null,
    averageVp: games ? Math.round((sum((r) => r.vp) / games) * 10) / 10 : null,
    favouriteCorporation: fav ? {name: fav[0], games: fav[1].games} : null,
    mapsPlayed: uniq(results.map((r) => r.board)),
    mapsWon: uniq(results.filter(isWin).map((r) => r.board)),
    cities: sum((r) => r.stats.cities), greeneries: sum((r) => r.stats.greeneries), oceans: sum((r) => r.stats.oceans),
    cards: sum((r) => r.stats.cards), attacksDealt: sum((r) => r.stats.attacks), unitsReceived: sum((r) => r.stats.received),
    mcSpent: sum((r) => r.stats.mcSpent),
  };
}

// ---- what goes over the wire -----------------------------------------------------------------
export type Unlock = {profileId: string; achievement: string; gameId: string; at: number};

export type ProfileDetail = {
  profile: Profile;
  stats: LifetimeStats;
  unlocked: Unlock[];
  recent: GameResult[];
};

export type RecentGame = {
  gameId: string;
  endedAt: number;
  mode: GameMode;
  board: BoardName;
  generations: number;
  /** everyone at the table, best first (profileId null for a player who played without a profile) */
  players: Array<{profileId: string | null; name: string; color: string; vp: number; placement: number}>;
  /** version of the game's library poster when it is ready (added by the server, not stored) */
  poster?: number | null;
};

export type HallOfFame = {
  leaderboard: Array<{profile: Profile; games: number; wins: number; winRate: number | null; bestScore: number | null}>;
  recent: RecentGame[];
  latest: Array<Unlock & {name: string; color: string}>;
};

/** Achievements unlocked by one finished game, for the phones' reveals and the TV's roll-up. */
export type GameUnlocks = {
  gameId: string;
  players: Array<{profileId: string; playerId: string | null; name: string; color: string; achievements: string[]}>;
};
