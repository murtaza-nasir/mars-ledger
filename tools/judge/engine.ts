// The open-source engine (vendor/tm/build) run in-process for bot experiments: seeded deals (the HTTP route ignores
// the seed), no database, cloneable games for rollouts. Experiment tooling only; the server never imports this.
import {createRequire} from 'node:module';
import * as path from 'node:path';
import type {Color, InputResponse, PlayerViewModel} from '../../src/shared/full';

const require = createRequire(import.meta.url);
const BUILD = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../vendor/tm/build/src/server');
/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (p: string): any => require(path.join(BUILD, p));

const {Database} = load('database/Database.js');
const {GameLoader} = load('database/GameLoader.js');
const ok = () => Promise.resolve();
const FAKE_DB: Record<string, unknown> = {
  markFinished: ok, deleteGameNbrSaves: ok, getPlayerCount: () => Promise.resolve(0), getGame: () => Promise.resolve({}),
  getGameId: () => Promise.resolve('g'), getGameVersion: () => Promise.resolve({}), getGameIds: () => Promise.resolve([]),
  getSaveIds: () => Promise.resolve([]), initialize: ok, saveGameResults: () => {}, saveGame: ok,
  purgeUnfinishedGames: () => Promise.resolve([]), compressCompletedGames: ok, stats: () => Promise.resolve({}),
  storeParticipants: ok, getParticipants: () => Promise.resolve([]), createSession: ok, deleteSession: ok,
  getSessions: () => Promise.resolve([]), deleteExpiredSessions: () => Promise.resolve(0),
};
Database.getInstance = () => FAKE_DB;
const loader = GameLoader.getInstance();
GameLoader.getInstance = () => loader;
load('globalInitialize.js').globalInitialize();
const {Game} = load('Game.js');
const {Player} = load('Player.js');
const {Server} = load('models/ServerModel.js');

export type EngineGame = any;
export type EnginePlayer = any;

/** The same options the server's FullBridge sends (base + Corporate Era, Tharsis, no Prelude), plus the draft flag;
 *  `board` and `prelude` as the lobby offers them (the bench varies them). */
export function newGame(seed: number, names: string[], opts: {draft?: boolean; board?: 'tharsis' | 'hellas' | 'elysium'; prelude?: boolean} = {}): EngineGame {
  const colors: Color[] = ['red', 'blue', 'green', 'yellow', 'black'];
  const players = names.map((n, i) => new Player(n, colors[i], false, 0, `p-${seed}-${i}`));
  const options = {
    expansions: {corpera: true, promo: false, venus: false, colonies: false, prelude: !!opts.prelude, prelude2: false, turmoil: false,
      community: false, ares: false, moon: false, pathfinders: false, ceo: false, starwars: false, underworld: false, deltaProject: false},
    corporateEra: true, boardName: opts.board ?? 'tharsis', draftVariant: !!opts.draft, undoOption: false, showOtherPlayersVP: true,
    startingCorporations: 2,
  };
  return Game.newInstance(`g-${seed}`, players, players[0], `s-${seed}`, options, engineSeed(seed));
}

/**
 * The engine's seed for a whole-number arena seed. The engine's SeededRandom takes a fraction in [0, 1) and starts
 * from floor(seed * 2^32), which its 32-bit arithmetic wraps to 0 for every whole number: without this every
 * arena seed would deal the same game.
 */
export function engineSeed(seed: number): number {
  return (Math.imul(seed + 1, 0x9E3779B1) >>> 0) / 4294967296;
}

export function clone(game: EngineGame): EngineGame {
  return Game.deserialize(JSON.parse(JSON.stringify(game.serialize())));
}

/** A player's view as the HTTP API would send it (JSON round trip). */
export function view(p: EnginePlayer): PlayerViewModel {
  return JSON.parse(JSON.stringify(Server.getPlayerModel(p))) as PlayerViewModel;
}

export function waiting(game: EngineGame): EnginePlayer[] {
  return game.players.filter((p: EnginePlayer) => p.getWaitingFor() !== undefined);
}

export function act(p: EnginePlayer, r: InputResponse): void {
  for (const card of p.tableau) { card.clearWarnings?.(); if (card.additionalProjectCosts !== undefined) card.additionalProjectCosts = undefined; }
  p.process(JSON.parse(JSON.stringify(r)));
}

export function isOver(game: EngineGame): boolean {
  return game.phase === 'end';
}

export type FinalScore = {name: string; color: Color; vp: number; tr: number; breakdown: Record<string, number>; mc: number};
export function scores(game: EngineGame): FinalScore[] {
  return game.players.map((p: EnginePlayer) => {
    const b = p.getVictoryPoints();
    return {name: p.name, color: p.color, vp: b.total, tr: p.terraformRating, mc: p.megaCredits,
      breakdown: {terraformRating: b.terraformRating, milestones: b.milestones, awards: b.awards, greenery: b.greenery, city: b.city, cards: b.victoryPoints}};
  });
}
