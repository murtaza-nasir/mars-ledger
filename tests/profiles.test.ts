import {describe, expect, it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {ACHIEVEMENTS, ACHIEVEMENT_BY_ID, unlocksFor} from '../src/shared/achievements';
import {buildResults, isWin, lifetime, placements} from '../src/shared/profiles';
import type {GameResult, RecentGame, ResultStats} from '../src/shared/profiles';
import {recordCompanion} from '../src/shared/record';
import {Store} from '../src/server/store';
import {ProfileDesk, ProfileError} from '../src/server/profiles';
import {Harness} from './harness';
import type {Tick} from '../src/shared/game';
import {apply} from '../src/shared/engine';

const stats = (s: Partial<ResultStats> = {}): ResultStats => ({cards: 0, cities: 0, greeneries: 0, oceans: 0, special: 0, trGained: 0, mcSpent: 0,
  attacks: 0, dealt: 0, received: 0, globalSteps: 0, milestones: [], awards: [], maxed: [], mostSteps: false, ...s});

let n = 0;
type ResultInput = Partial<Omit<GameResult, 'stats'>> & {stats?: Partial<ResultStats>};
function result(p: ResultInput = {}): GameResult {
  n++;
  return {gameId: `g${String(n).padStart(3, '0')}`, profileId: 'alice-1', name: 'Alice', color: 'red', endedAt: 1_000_000 + n * 1000,
    mode: 'full', board: 'tharsis', generations: 12, players: 2, placement: 2, vp: 60, margin: -5, corporations: ['Ecoline'],
    beginner: false, terraformed: true, ...p, stats: stats(p.stats)};
}
const won = (p: ResultInput = {}) => result({placement: 1, margin: 5, ...p});
const ids = (rs: GameResult[]) => unlocksFor(rs).map((u) => u.achievement).sort();
const has = (rs: GameResult[], id: string) => unlocksFor(rs).some((u) => u.achievement === id);

describe('placements', () => {
  it('shares places on ties and skips the next place', () => {
    expect(placements([70, 80, 70, 60])).toEqual([2, 1, 2, 4]);
    expect(placements([50, 50])).toEqual([1, 1]);
    expect(placements([42])).toEqual([1]);
  });
});

describe('buildResults', () => {
  it('computes placement and margin against every player, profile or not', () => {
    const rs = buildResults({gameId: 'x', endedAt: 1, mode: 'full', board: 'hellas', generations: 11, terraformed: true, history: null,
      allScores: [{color: 'red', vp: 71}, {color: 'blue', vp: 69}, {color: 'green', vp: 50}],
      seats: [{profileId: 'p-red1', name: 'R', color: 'red', vp: 71, corporations: ['Helion'], beginner: false},
        {profileId: 'p-green', name: 'G', color: 'green', vp: 50, corporations: [], beginner: false}]});
    expect(rs.map((r) => [r.placement, r.margin, r.players])).toEqual([[1, 2, 3], [3, -21, 3]]);
    expect(rs[0].board).toBe('hellas');
  });
  it('a tie gives both players first place with margin 0', () => {
    const rs = buildResults({gameId: 'x', endedAt: 1, mode: 'companion', board: 'tharsis', generations: 9, terraformed: false, history: null,
      allScores: [{color: 'red', vp: 55}, {color: 'blue', vp: 55}],
      seats: [{profileId: 'p-red1', name: 'R', color: 'red', vp: 55, corporations: [], beginner: false},
        {profileId: 'p-blue', name: 'B', color: 'blue', vp: 55, corporations: [], beginner: false}]});
    expect(rs.map((r) => [r.placement, r.margin])).toEqual([[1, 0], [1, 0]]);
    expect(rs.every(isWin)).toBe(true);
  });
  it('solo games are never wins', () => {
    expect(isWin(result({players: 1, placement: 1, margin: 0}))).toBe(false);
  });
});

describe('lifetime stats', () => {
  it('aggregates games, wins, best and average, favourite corporation and maps', () => {
    const rs = [won({vp: 80, corporations: ['Helion'], board: 'hellas', stats: {cities: 2, cards: 10, mcSpent: 100}}),
      result({vp: 60, corporations: ['Helion'], stats: {cities: 1, attacks: 2}}),
      result({vp: 70, corporations: ['Ecoline'], board: 'elysium', stats: {oceans: 3}})];
    const s = lifetime(rs);
    expect(s).toMatchObject({games: 3, wins: 1, bestScore: 80, averageVp: 70, cities: 3, cards: 10, oceans: 3, attacksDealt: 2, mcSpent: 100,
      favouriteCorporation: {name: 'Helion', games: 2}, mapsPlayed: ['tharsis', 'hellas', 'elysium'], mapsWon: ['hellas']});
    expect(s.winRate).toBeCloseTo(1 / 3);
  });
  it('no win rate before three games', () => {
    expect(lifetime([won(), result()]).winRate).toBeNull();
    expect(lifetime([]).bestScore).toBeNull();
  });
});

describe('achievement rules', () => {
  it('has at least 20 distinct achievements with rules and glyphs', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) { expect(a.rule.length).toBeGreaterThan(5); expect(a.glyph).toBeTruthy(); }
  });
  it('first landing on any finished game; first victory needs a rival', () => {
    expect(ids([result()])).toEqual(['first-landing']);
    expect(has([won({players: 1, margin: 0})], 'first-victory')).toBe(false);
    expect(has([won()], 'first-victory')).toBe(true);
  });
  it('hat trick at the third win, veteran at the tenth game', () => {
    const three = [won(), result(), won(), won()];
    const u = unlocksFor(three).find((x) => x.achievement === 'hat-trick')!;
    expect(u.gameId).toBe(three[3].gameId);
    expect(has(Array.from({length: 9}, () => result()), 'veteran')).toBe(false);
    expect(has(Array.from({length: 10}, () => result()), 'veteran')).toBe(true);
  });
  it('margins: dead heat, photo finish, landslide', () => {
    expect(has([won({margin: 0})], 'dead-heat')).toBe(true);
    expect(has([won({margin: 0})], 'photo-finish')).toBe(false);
    expect(has([won({margin: 2})], 'photo-finish')).toBe(true);
    expect(has([won({margin: 3})], 'photo-finish')).toBe(false);
    expect(has([won({margin: 19})], 'landslide')).toBe(false);
    expect(has([won({margin: 20})], 'landslide')).toBe(true);
    expect(has([result({margin: -1})], 'photo-finish')).toBe(false);
  });
  it('beginner luck and pacifist need a win', () => {
    expect(has([result({beginner: true})], 'beginners-luck')).toBe(false);
    expect(has([won({beginner: true})], 'beginners-luck')).toBe(true);
    expect(has([won({stats: {attacks: 1}})], 'pacifist')).toBe(false);
    expect(has([won()], 'pacifist')).toBe(true);
  });
  it('maxing parameters and leading the steps', () => {
    expect(ids([result({stats: {maxed: ['oceans', 'temperature', 'oxygen']}})])).toEqual(expect.arrayContaining(['last-drop', 'heat-wave', 'fresh-air']));
    expect(has([result({stats: {mostSteps: true}})], 'chief-terraformer')).toBe(true);
    expect(has([result({players: 1, stats: {mostSteps: true}})], 'chief-terraformer')).toBe(false);
  });
  it('single-game thresholds', () => {
    expect(has([result({stats: {cities: 2}})], 'metropolis')).toBe(false);
    expect(has([result({stats: {cities: 3}})], 'metropolis')).toBe(true);
    expect(has([result({stats: {greeneries: 5}})], 'green-belt')).toBe(true);
    expect(has([result({stats: {cards: 19}})], 'card-shark')).toBe(false);
    expect(has([result({stats: {cards: 20}})], 'card-shark')).toBe(true);
    expect(has([result({stats: {mcSpent: 200}})], 'big-spender')).toBe(true);
    expect(has([result({stats: {milestones: ['Mayor', 'Builder']}})], 'milestone-hunter')).toBe(true);
    expect(has([result({stats: {attacks: 3}})], 'ruthless')).toBe(true);
  });
  it('lifetime thresholds: city builder, deep blue', () => {
    expect(has([result({stats: {cities: 5}}), result({stats: {cities: 4}})], 'city-builder')).toBe(false);
    const u = unlocksFor([result({stats: {cities: 5}}), result({stats: {cities: 5}})]).find((x) => x.achievement === 'city-builder');
    expect(u).toBeTruthy();
    expect(has(Array.from({length: 4}, () => result({stats: {oceans: 5}})), 'deep-blue')).toBe(true);
  });
  it('speedrun needs a terraformed Mars; marathon counts generations', () => {
    expect(has([result({generations: 9, terraformed: false})], 'speedrun')).toBe(false);
    expect(has([result({generations: 10, terraformed: true})], 'speedrun')).toBe(true);
    expect(has([result({generations: 16})], 'marathon')).toBe(true);
    expect(has([result({generations: 15})], 'marathon')).toBe(false);
  });
  it('maps: tourist plays all three, cartographer wins all three', () => {
    const rs = [won({board: 'tharsis'}), result({board: 'hellas'}), won({board: 'elysium'})];
    expect(has(rs, 'tourist')).toBe(true);
    expect(has(rs, 'cartographer')).toBe(false);
    expect(has([...rs, won({board: 'hellas'})], 'cartographer')).toBe(true);
  });
  it('collector counts distinct corporations', () => {
    const corps = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    expect(has(corps.map((c) => result({corporations: [c]})), 'collector')).toBe(false);
    expect(has([...corps, 'J'].map((c) => result({corporations: [c]})), 'collector')).toBe(true);
  });
  it('replay is deterministic and unlocks each achievement once, in the earliest game', () => {
    const rs = [won({stats: {cities: 3}}), won({stats: {cities: 4}})];
    const a = unlocksFor(rs);
    expect(unlocksFor([...rs].reverse())).toEqual(a);
    expect(a.filter((u) => u.achievement === 'metropolis')).toEqual([{achievement: 'metropolis', gameId: rs[0].gameId, at: rs[0].endedAt}]);
    for (const u of a) expect(ACHIEVEMENT_BY_ID.has(u.achievement)).toBe(true);
  });
});

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prof-')); }

function recent(gameId: string, endedAt: number, players: RecentGame['players']): RecentGame {
  return {gameId, endedAt, mode: 'full', board: 'tharsis', generations: 12, players};
}

describe('ProfileDesk', () => {
  it('migrates an existing database without losing games', () => {
    const dir = tmpDir();
    const old = new DatabaseSync(path.join(dir, 'tm.db'));
    old.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, created INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE ticks (game TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, command TEXT NOT NULL, PRIMARY KEY (game, seq));
      INSERT INTO games (id, created) VALUES ('oldgame1', 1);
      INSERT INTO ticks (game, seq, at, command) VALUES ('oldgame1', 1, 1, '{"t":"join","playerId":"dev-aaaa1","name":"Ann","color":"red"}');`);
    old.close();
    const store = new Store(dir);
    const desk = new ProfileDesk(store.db);
    expect((store.db.prepare('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(3);
    expect(store.currentGameId()).toBe('oldgame1');
    expect(store.replay('oldgame1').state.players.map((p) => p.name)).toEqual(['Ann']);
    expect(desk.list()).toEqual([]);
    // Opening again is a no-op.
    const again = new ProfileDesk(new Store(dir).db);
    expect(again.list()).toEqual([]);
  });

  it('upgrades a version-1 profile table: existing people keep everything and hints start off', () => {
    const dir = tmpDir();
    const v1 = new DatabaseSync(path.join(dir, 'tm.db'));
    v1.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, avatar TEXT, created INTEGER NOT NULL, merged_into TEXT);
      CREATE TABLE devices (device TEXT PRIMARY KEY, profile TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE results (game TEXT NOT NULL, profile TEXT NOT NULL, ended_at INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (game, profile));
      CREATE TABLE recorded_games (game TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE unlocks (profile TEXT NOT NULL, achievement TEXT NOT NULL, game TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (profile, achievement));
      INSERT INTO profiles (id, name, color, avatar, created) VALUES ('prof-ann1', 'Ann', 'red', 'R17', 5);
      PRAGMA user_version = 1;`);
    v1.close();
    const desk = new ProfileDesk(new Store(dir).db);
    expect(desk.get('prof-ann1')).toEqual({id: 'prof-ann1', name: 'Ann', color: 'red', avatar: 'R17', created: 5, hints: false});
    expect(desk.update('prof-ann1', {hints: true}).hints).toBe(true);
    expect(desk.list()[0].hints).toBe(true);
    expect(desk.update('prof-ann1', {name: 'Anna'}).hints).toBe(true); // other edits keep the setting
    expect(() => desk.update('prof-ann1', {hints: 'yes'})).toThrow('Hints are either on or off');
  });

  it('creates, lists, updates and refuses duplicates', () => {
    const desk = new ProfileDesk(new Store(tmpDir()).db);
    desk.create({id: 'prof-ann1', name: '  Ann  ', color: 'red', avatar: 'R17'}, 10);
    desk.create({id: 'prof-bob1', name: 'Bob', color: 'blue'}, 20);
    expect(desk.list().map((p) => p.name)).toEqual(['Bob', 'Ann']);
    expect(() => desk.create({id: 'prof-ann2', name: 'ann', color: 'green'})).toThrow(ProfileError);
    expect(() => desk.create({id: 'x', name: 'Cy', color: 'green'})).toThrow(ProfileError);
    expect(() => desk.create({id: 'prof-cyy1', name: 'Cy', color: 'purple'})).toThrow(ProfileError);
    expect(() => desk.create({id: 'prof-cyy1', name: 'Cy', color: 'green', avatar: '../x'})).toThrow(ProfileError);
    expect(desk.update('prof-ann1', {name: 'Annie', avatar: null}).name).toBe('Annie');
    expect(() => desk.update('prof-ann1', {name: 'bob'})).toThrow(ProfileError);
    desk.claimDevice('device-111', 'prof-bob1');
    expect(desk.deviceProfile('device-111')).toBe('prof-bob1');
  });

  it('records idempotently, re-records on changed scores, and unrecords', () => {
    const desk = new ProfileDesk(new Store(tmpDir()).db);
    desk.create({id: 'prof-ann1', name: 'Ann', color: 'red'});
    desk.create({id: 'prof-bob1', name: 'Bob', color: 'blue'});
    const g = 'game-0001';
    const annWin = won({gameId: g, profileId: 'prof-ann1', endedAt: 5000, margin: 2});
    const bobLoss = result({gameId: g, profileId: 'prof-bob1', color: 'blue', endedAt: 5000, margin: -2});
    const rg = recent(g, 5000, [{profileId: 'prof-ann1', name: 'Ann', color: 'red', vp: 62, placement: 1}, {profileId: 'prof-bob1', name: 'Bob', color: 'blue', vp: 60, placement: 2}]);
    const u1 = desk.recordGame(rg, [annWin, bobLoss]);
    const u2 = desk.recordGame(rg, [annWin, bobLoss]);
    expect(u2).toEqual(u1);
    expect(desk.results('prof-ann1')).toHaveLength(1);
    expect(u1.find((x) => x.profileId === 'prof-ann1')!.achievements).toEqual(expect.arrayContaining(['first-landing', 'first-victory', 'photo-finish']));
    // Board points change the result: Bob wins after all.
    desk.recordGame(rg, [{...annWin, placement: 2, margin: -1}, {...bobLoss, placement: 1, margin: 1}]);
    expect(desk.detail('prof-ann1')!.unlocked.map((x) => x.achievement)).not.toContain('first-victory');
    expect(desk.detail('prof-bob1')!.unlocked.map((x) => x.achievement)).toContain('first-victory');
    expect(desk.list().find((p) => p.id === 'prof-bob1')!.wins).toBe(1);
    expect(desk.hallOfFame().leaderboard[0].profile.name).toBe('Bob');
    desk.unrecord(g);
    expect(desk.isRecorded(g)).toBe(false);
    expect(desk.detail('prof-bob1')!.unlocked).toEqual([]);
    expect(desk.hallOfFame()).toEqual({leaderboard: [], recent: [], latest: []});
  });

  it('merges a duplicate: games move, achievements replay (a combined third win)', () => {
    const desk = new ProfileDesk(new Store(tmpDir()).db);
    desk.create({id: 'prof-ann1', name: 'Ann', color: 'red'});
    desk.create({id: 'prof-ann2', name: 'Anne', color: 'red'});
    const games = [won({gameId: 'game-a1', profileId: 'prof-ann1', endedAt: 1000}), won({gameId: 'game-a2', profileId: 'prof-ann2', endedAt: 2000}),
      won({gameId: 'game-a3', profileId: 'prof-ann1', endedAt: 3000})];
    for (const r of games) desk.recordGame(recent(r.gameId, r.endedAt, [{profileId: r.profileId, name: 'Ann', color: 'red', vp: 60, placement: 1}]), [r]);
    expect(desk.detail('prof-ann1')!.unlocked.map((u) => u.achievement)).not.toContain('hat-trick');
    desk.claimDevice('device-222', 'prof-ann2');
    desk.merge('prof-ann2', 'prof-ann1');
    const d = desk.detail('prof-ann1')!;
    expect(d.stats.games).toBe(3);
    expect(d.unlocked.find((u) => u.achievement === 'hat-trick')!.gameId).toBe('game-a3');
    expect(desk.list().map((p) => p.id)).toEqual(['prof-ann1']);
    expect(desk.get('prof-ann2')!.id).toBe('prof-ann1');
    expect(desk.deviceProfile('device-222')).toBe('prof-ann1');
    expect(desk.hallOfFame().recent.every((g) => g.players.every((p) => p.profileId === 'prof-ann1'))).toBe(true);
    expect(() => desk.merge('prof-ann1', 'prof-ann1')).toThrow(ProfileError);
  });
});

describe('recordCompanion', () => {
  it('records profiled seats with board, scores, corporations and history stats', () => {
    const h = new Harness();
    const ticks: Tick[] = [];
    let seq = 0;
    const run = (c: Parameters<Harness['do']>[0]) => { const r = apply(h.s, c); h.s = r.state; ticks.push({seq: ++seq, at: seq, command: c, events: r.events}); };
    run({t: 'join', playerId: 'dev-a', name: 'Ann', color: 'red', profileId: 'prof-ann1'});
    run({t: 'join', playerId: 'dev-b', name: 'Guest', color: 'blue'});
    expect(() => apply(h.s, {t: 'join', playerId: 'dev-c', name: 'Twin', color: 'green', profileId: 'prof-ann1'})).toThrow();
    run({t: 'setBoard', playerId: 'dev-a', board: 'hellas'});
    run({t: 'start', playerId: 'dev-a', modules: ['base', 'corpera'], order: ['dev-a', 'dev-b'], board: 'hellas'});
    run({t: 'chooseCorp', playerId: 'dev-a', corporation: 'Beginner Corporation', cardsKept: 10, answers: []});
    run({t: 'chooseCorp', playerId: 'dev-b', corporation: 'Ecoline', cardsKept: 0, answers: []});
    run({t: 'endGame', playerId: 'dev-a'});
    const rec = recordCompanion(h.s, ticks, 123);
    expect(rec.results).toHaveLength(1);
    const r = rec.results[0];
    expect(r).toMatchObject({profileId: 'prof-ann1', mode: 'companion', board: 'hellas', players: 2, corporations: ['Beginner Corporation'], beginner: true, endedAt: 123, terraformed: false});
    expect(rec.game.players.map((p) => p.profileId)).toContain(null);
    expect(rec.seats).toEqual([{profileId: 'prof-ann1', playerId: 'dev-a', name: 'Ann', color: 'red'}]);
  });
});

describe('recordFull', () => {
  it('maps engine colours to lobby profiles, shares a tie, and reads the engine breakdown', async () => {
    const {recordFull} = await import('../src/shared/record');
    const vp = (total: number) => ({total, terraformRating: 0, milestones: 0, awards: 0, greenery: 0, city: 0, victoryPoints: 0});
    const ep = (color: string, name: string, total: number, corp: string) => ({color, name, isActive: false, terraformRating: 30, megacredits: 0,
      megacreditProduction: 0, steel: 0, steelProduction: 0, steelValue: 2, titanium: 0, titaniumProduction: 0, titaniumValue: 3, plants: 0, plantProduction: 0,
      energy: 0, energyProduction: 0, heat: 0, heatProduction: 0, cardsInHandNbr: 0, citiesCount: 0, tableau: [{name: corp}], tags: [],
      actionsThisGeneration: [], actionsTakenThisRound: 0, availableBlueCardActionCount: 0, victoryPointsBreakdown: vp(total)});
    const state = {id: 'lobby1', mode: 'full', board: 'elysium', phase: 'full',
      full: {gameId: 'eng-1', spectatorId: 's', players: {'dev-a': {engineId: 'pa', color: 'red'}, 'dev-b': {engineId: 'pb', color: 'blue'}, 'dev-c': {engineId: 'pc', color: 'green'}}},
      players: [{id: 'dev-a', name: 'Ann', color: 'red', profileId: 'prof-ann1', beginner: true}, {id: 'dev-b', name: 'Bob', color: 'blue', profileId: 'prof-bob1'},
        {id: 'dev-c', name: 'Guest', color: 'green'}]} as unknown as import('../src/shared/game').GameState;
    const final = {id: 's', color: 'neutral', players: [ep('red', 'Ann', 70, 'Beginner Corporation'), ep('blue', 'Bob', 70, 'Helion'), ep('green', 'Guest', 50, 'Ecoline')],
      game: {gameAge: 9, undoCount: 0, generation: 13, phase: 'end', temperature: 8, oxygenLevel: 14, oceans: 9, venusScaleLevel: 0, isTerraformed: true,
        spaces: [], passedPlayers: [], milestones: [], awards: [], deckSize: 0}} as unknown as import('../src/shared/full').SpectatorModel;
    const rec = recordFull(state, final, null, 777);
    expect(rec.game).toMatchObject({gameId: 'eng-1', mode: 'full', board: 'elysium', generations: 13});
    expect(rec.game.players.map((p) => [p.name, p.placement, p.profileId])).toEqual([['Ann', 1, 'prof-ann1'], ['Bob', 1, 'prof-bob1'], ['Guest', 3, null]]);
    expect(rec.results.map((r) => [r.profileId, r.placement, r.margin, r.corporations[0], r.beginner, r.terraformed])).toEqual([
      ['prof-ann1', 1, 0, 'Beginner Corporation', true, true], ['prof-bob1', 1, 0, 'Helion', false, true]]);
    expect(unlocksFor(rec.results.filter((r) => r.profileId === 'prof-ann1')).map((u) => u.achievement)).toEqual(expect.arrayContaining(['beginners-luck', 'dead-heat']));
  });
});
