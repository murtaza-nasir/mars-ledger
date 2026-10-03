import {describe, expect, it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {AWAY_MAX_CARDS, AWAY_MIN_MS, HEARD_SLACK_MS, awayFor, buildSummary, companionEntries, companionIncome, fullEntries, showEntry, wasAway} from '../src/shared/away';
import type {AwayEntry, SummaryInput} from '../src/shared/away';
import {apply, newGame} from '../src/shared/engine';
import type {Command, GameState, Tick} from '../src/shared/game';
import type {ProductionShow, SpectatorModel} from '../src/shared/full';
import {AwayDesk} from '../src/server/away';
import spectator from './fixtures/full/spectator.json';

const ZERO = {megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0};
const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  id: 'x', since: 1000, until: 100_000, me: 'red',
  players: [{color: 'red', name: 'Ada'}, {color: 'blue', name: 'Vera'}, {color: 'green', name: 'Nova'}],
  turn: {who: null, mine: false, phase: null}, ...over,
});

describe('the away window', () => {
  it('needs at least a minute hidden or offline', () => {
    expect(wasAway(0, AWAY_MIN_MS - 1)).toBe(false);
    expect(wasAway(0, AWAY_MIN_MS)).toBe(true);
    expect(wasAway(null, 10 * AWAY_MIN_MS)).toBe(false);
    expect(wasAway(5000, 6000, 1000)).toBe(true);
  });
  it('says how long in plain words', () => {
    expect(awayFor(30_000)).toBe('1 min');
    expect(awayFor(12 * 60_000)).toBe('12 min');
    expect(awayFor(65 * 60_000)).toBe('1 h 5 min');
    expect(awayFor(120 * 60_000)).toBe('2 h');
  });
});

describe('the summary', () => {
  it('is empty (null) when nothing happened, or only the turn moved', () => {
    expect(buildSummary([], input())).toBeNull();
    expect(buildSummary([], input({turn: {who: {color: 'blue', name: 'Vera'}, mine: false, phase: null}}))).toBeNull();
  });

  it('only counts facts inside the window', () => {
    const e: AwayEntry[] = [{kind: 'card', at: 500, by: 'blue', card: 'Birds'}, {kind: 'card', at: 200_000, by: 'blue', card: 'Comet'}];
    expect(buildSummary(e, input())).toBeNull();
  });

  it('lists attacks on me only, with who and what', () => {
    const e: AwayEntry[] = [
      {kind: 'attack', at: 2000, by: 'blue', target: 'red', losses: [{what: 'stock', resource: 'plants', amount: 3}]},
      {kind: 'attack', at: 3000, by: 'blue', target: 'green', losses: [{what: 'stock', resource: 'plants', amount: 2}]},
    ];
    const s = buildSummary(e, input())!;
    expect(s.attacks).toEqual([{by: {color: 'blue', name: 'Vera'}, losses: [{what: 'stock', resource: 'plants', amount: 3}]}]);
  });

  it('sums parameter steps and says who raised them', () => {
    const e: AwayEntry[] = [
      {kind: 'global', at: 2000, by: 'blue', param: 'temperature', amount: 2},
      {kind: 'global', at: 2100, by: 'green', param: 'temperature', amount: 4},
      {kind: 'global', at: 2200, by: 'blue', param: 'oxygen', amount: 1},
      {kind: 'global', at: 2300, by: null, param: 'oceans', amount: 1},
    ];
    const s = buildSummary(e, input())!;
    expect(s.params).toMatchObject({temperature: 6, oxygen: 1, oceans: 1});
    expect(s.params!.by).toEqual([
      {color: 'blue', name: 'Vera', temperature: 2, oxygen: 1, oceans: 0},
      {color: 'green', name: 'Nova', temperature: 4, oxygen: 0, oceans: 0},
    ]);
  });

  it('counts tiles other players placed, by kind', () => {
    const e: AwayEntry[] = [
      {kind: 'tile', at: 2000, by: 'blue', tile: 'city'}, {kind: 'tile', at: 2001, by: 'blue', tile: 'greenery'},
      {kind: 'tile', at: 2002, by: 'blue', tile: 'greenery'}, {kind: 'tile', at: 2003, by: 'red', tile: 'city'},
    ];
    expect(buildSummary(e, input())!.tiles).toEqual([{color: 'blue', name: 'Vera', city: 1, greenery: 2, ocean: 0, special: 0}]);
  });

  it('shows the latest cards others played and how many more', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const e: AwayEntry[] = names.map((card, i) => ({kind: 'card', at: 2000 + i, by: i % 2 ? 'green' : 'blue', card}));
    e.push({kind: 'card', at: 9000, by: 'red', card: 'Mine'});
    const s = buildSummary(e, input())!;
    expect(s.cards.shown.map((c) => c.card)).toEqual(names.slice(-AWAY_MAX_CARDS));
    expect(s.cards.more).toBe(2);
    expect(s.cards.shown.some((c) => c.card === 'Mine')).toBe(false);
  });

  it('lists milestones and awards others took', () => {
    const e: AwayEntry[] = [{kind: 'milestone', at: 2000, by: 'blue', name: 'Mayor'}, {kind: 'award', at: 2001, by: 'green', name: 'Banker'},
      {kind: 'milestone', at: 2002, by: 'red', name: 'Builder'}];
    expect(buildSummary(e, input())!.claims).toEqual([
      {kind: 'milestone', by: {color: 'blue', name: 'Vera'}, name: 'Mayor'},
      {kind: 'award', by: {color: 'green', name: 'Nova'}, name: 'Banker'},
    ]);
  });

  it('adds up my production income and the generations that passed', () => {
    const inc = (mc: number, heat: number, e2h: number) => ({color: 'red' as const, gains: {...ZERO, megacredits: mc, heat}, energyToHeat: e2h});
    const e: AwayEntry[] = [
      {kind: 'production', at: 2000, generation: 3, incomes: [inc(23, 4, 2), {color: 'blue', gains: {...ZERO, megacredits: 50}, energyToHeat: 0}]},
      {kind: 'generation', at: 2001, generation: 4},
      {kind: 'production', at: 3000, generation: 4, incomes: [inc(25, 1, 0)]},
      {kind: 'generation', at: 3001, generation: 5},
    ];
    const s = buildSummary(e, input({generationAtLeave: 3}))!;
    expect(s.income).toEqual({gains: {...ZERO, megacredits: 48, heat: 5}, energyToHeat: 2, times: 2});
    expect(s.generations).toEqual({from: 3, to: 5});
  });

  it('keeps the turn as given, with "mine" for my turn', () => {
    const e: AwayEntry[] = [{kind: 'card', at: 2000, by: 'blue', card: 'Birds'}];
    const s = buildSummary(e, input({turn: {who: {color: 'red', name: 'Ada'}, mine: true, phase: null}}))!;
    expect(s.turn.mine).toBe(true);
  });
});

// ---- full mode: facts from engine updates ----------------------------------------------------------
const base = spectator as unknown as SpectatorModel;
const clone = (): SpectatorModel => structuredClone(base);

describe('facts from engine updates', () => {
  it('reads tiles, steps, cards, claims and attacks; the actor is the active player before the update', () => {
    const prev = clone();
    const next = clone();
    const free = next.game.spaces.find((s) => s.spaceType === 'land' && s.tileType === undefined)!;
    free.tileType = 0; free.color = 'red';
    next.game.oxygenLevel += 1;
    next.game.temperature += 2;
    next.players[0].tableau.push({name: 'Birds'});
    next.players[1].tableau.push({name: 'Comet'});
    prev.players[1].plants = 5; next.players[1].plants = 2;
    next.game.milestones[0] = {...next.game.milestones[0], color: 'red', playerName: 'Ada'};
    const e = fullEntries(prev, next, 42);
    expect(e).toContainEqual({kind: 'tile', at: 42, by: 'red', tile: 'greenery'});
    expect(e).toContainEqual({kind: 'global', at: 42, by: 'red', param: 'oxygen', amount: 1});
    expect(e).toContainEqual({kind: 'global', at: 42, by: 'red', param: 'temperature', amount: 2});
    expect(e).toContainEqual({kind: 'card', at: 42, by: 'red', card: 'Birds'});
    expect(e).toContainEqual({kind: 'card', at: 42, by: 'blue', card: 'Comet'});
    expect(e).toContainEqual({kind: 'milestone', at: 42, by: 'red', name: next.game.milestones[0].name});
    expect(e).toContainEqual({kind: 'attack', at: 42, by: 'red', target: 'blue', losses: [{what: 'stock', resource: 'plants', amount: 3}]});
  });

  it('ignores an undo', () => {
    const prev = clone(); const next = clone();
    next.game.undoCount = prev.game.undoCount + 1;
    next.game.oxygenLevel += 3;
    expect(fullEntries(prev, next, 1)).toEqual([]);
  });

  it('notes a new generation, and production from the show numbers', () => {
    const prev = clone(); const next = clone();
    next.game.generation = prev.game.generation + 1;
    expect(fullEntries(prev, next, 5)).toContainEqual({kind: 'generation', at: 5, generation: next.game.generation});
    const show = {generation: 3, players: [{playerId: 'a', color: 'red', name: 'M', before: ZERO, gains: {...ZERO, megacredits: 30}, energyToHeat: 1}]} as unknown as ProductionShow;
    expect(showEntry(show, 9)).toEqual({kind: 'production', at: 9, generation: 2, incomes: [{color: 'red', gains: {...ZERO, megacredits: 30}, energyToHeat: 1}]});
  });
});

// ---- companion mode: facts from the command log -----------------------------------------------------
function play(commands: Command[], start = 1000): {state: GameState; ticks: Tick[]} {
  let state = newGame('g1');
  const ticks: Tick[] = [];
  commands.forEach((c, i) => {
    const r = apply(state, c);
    state = r.state;
    ticks.push({seq: r.state.seq, at: start + i * 1000, command: c, events: r.events});
  });
  return {state, ticks};
}

describe('facts from the companion log', () => {
  const setup: Command[] = [
    {t: 'join', playerId: 'a', name: 'Ada', color: 'red'},
    {t: 'join', playerId: 'b', name: 'Vera', color: 'blue'},
    {t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b']},
    {t: 'chooseCorp', playerId: 'a', corporation: 'CrediCor', cardsKept: 0, answers: []},
    {t: 'chooseCorp', playerId: 'b', corporation: 'Ecoline', cardsKept: 0, answers: []},
  ];

  it('reads parameter steps and production income from the state before production', () => {
    const {state, ticks} = play([...setup,
      {t: 'standardProject', playerId: 'a', project: 'asteroid', payment: {megacredits: 14}, answers: []},
      {t: 'pass', playerId: 'a'},
      {t: 'pass', playerId: 'b'},
    ]);
    const e = companionEntries(state.id, ticks, ticks[5].at);
    expect(e).toContainEqual({kind: 'global', at: ticks[5].at, by: 'red', param: 'temperature', amount: 2});
    const prod = e.find((x) => x.kind === 'production');
    expect(prod).toBeDefined();
    if (prod?.kind !== 'production') return;
    const red = prod.incomes.find((x) => x.color === 'red')!;
    // CrediCor: 57 - 14 = 43 M€ before production; income = M€ production 0 + TR 21
    expect(red.gains.megacredits).toBe(21);
    const blue = prod.incomes.find((x) => x.color === 'blue')!;
    expect(blue.gains.plants).toBe(2); // Ecoline: 2 plant production
    expect(e).toContainEqual({kind: 'generation', at: ticks[7].at, generation: 2});
    // nothing before `from`
    expect(companionEntries(state.id, ticks, ticks[7].at + 1)).toEqual([]);
  });

  it('turns energy into heat in the income', () => {
    const p = {stock: {...ZERO, energy: 3}, production: {...ZERO, heat: 1, energy: 2, megacredits: 1}, tr: 20} as unknown as Parameters<typeof companionIncome>[0];
    expect(companionIncome(p)).toEqual({energyToHeat: 3, gains: {...ZERO, megacredits: 21, energy: 2, heat: 4}});
  });
});

// ---- the server desk: who is away, since when, across reconnects and takeovers ---------------------
function desk(db = new DatabaseSync(':memory:'), game = 'g1', startedAt = 0) {
  return {db, d: new AwayDesk(db, () => game, {minMs: 60_000, startedAt})};
}
const sock = () => ({}) as never;

describe('away tracking', () => {
  it('a phone hidden for a minute or more is told on return; a shorter break is not', () => {
    const {d} = desk();
    const ws = sock();
    expect(d.update(ws, 'a', true, 1000, 1)).toBeNull();
    expect(d.update(ws, 'a', false, 2000, 1)).toBeNull();
    expect(d.awaySince('a')).toBe(2000);
    expect(d.update(ws, 'a', true, 20_000, 1)).toBeNull(); // 18 s: not away long enough
    expect(d.awaySince('a')).toBeNull();
    d.update(ws, 'a', false, 30_000, 2);
    expect(d.update(ws, 'a', true, 95_000, 3)).toEqual({player: 'a', since: 30_000, generation: 2});
  });

  it('a dropped connection counts as away; the reconnect hears what it missed', () => {
    const {d} = desk();
    const ws1 = sock();
    d.update(ws1, 'a', true, 1000, 1);
    d.remove(ws1, 5000, 1);
    const ws2 = sock();
    expect(d.update(ws2, 'a', true, 70_000, 2)).toEqual({player: 'a', since: 5000, generation: 1});
  });

  it('a connection that drops silently is dated from shortly after the phone was last heard', () => {
    const {d} = desk();
    const ws = sock();
    d.update(ws, 'a', true, 1000, 1);
    d.heard(ws, 30_000); // a heartbeat
    d.remove(ws, 400_000, 1); // the server only notices much later
    expect(d.awaySince('a')).toBe(30_000 + HEARD_SLACK_MS);
    // a clean close is dated when it happens
    const ws2 = sock();
    d.update(ws2, 'b', true, 1000, 1);
    d.heard(ws2, 9000);
    d.remove(ws2, 10_000, 1);
    expect(d.awaySince('b')).toBe(10_000);
  });

  it('a phone reconnecting in the background is not back until it is visible', () => {
    const {d} = desk();
    const ws1 = sock();
    d.update(ws1, 'a', true, 1000, 1);
    d.remove(ws1, 2000, 1);
    const ws2 = sock();
    expect(d.update(ws2, 'a', false, 80_000, 1)).toBeNull();
    expect(d.update(ws2, 'a', true, 90_000, 1)).toEqual({player: 'a', since: 2000, generation: 1});
  });

  it('another device taking over the seat gets the right window', () => {
    const {d} = desk();
    const phone = sock();
    d.update(phone, 'a', true, 1000, 1);
    d.remove(phone, 10_000, 1);
    const tablet = sock();
    expect(d.update(tablet, 'a', true, 100_000, 1)).toEqual({player: 'a', since: 10_000, generation: 1});
  });

  it('a seat with another visible device is not away', () => {
    const {d} = desk();
    const phone = sock(); const tablet = sock();
    d.update(phone, 'a', true, 1000, 1);
    d.update(tablet, 'a', true, 1000, 1);
    d.update(phone, 'a', false, 2000, 1);
    expect(d.awaySince('a')).toBeNull();
    expect(d.update(phone, 'a', true, 500_000, 1)).toBeNull();
  });

  it('survives a server restart: the absence is stored, and unseen seats count from the restart', () => {
    const {db, d} = desk();
    const ws = sock();
    d.update(ws, 'a', true, 1000, 1);
    d.update(ws, 'a', false, 2000, 1);
    const after = new AwayDesk(db, () => 'g1', {minMs: 60_000, startedAt: 50_000});
    expect(after.update(sock(), 'a', true, 100_000, 2)).toEqual({player: 'a', since: 2000, generation: 1});
    // never seen since the restart: from the restart, if that is long enough ago
    expect(after.update(sock(), 'b', true, 80_000, 2)).toBeNull();
    expect(after.update(sock(), 'c', true, 120_000, 2)).toEqual({player: 'c', since: 50_000, generation: null});
  });

  it('keeps the full-game journal per game and reads it back from a moment', () => {
    const {db, d} = desk();
    d.journal([{kind: 'card', at: 1000, by: 'red', card: 'A'}, {kind: 'card', at: 5000, by: 'blue', card: 'B'}]);
    expect(d.entries(2000)).toEqual([{kind: 'card', at: 5000, by: 'blue', card: 'B'}]);
    const again = new AwayDesk(db, () => 'g1', {minMs: 60_000});
    expect(again.entries(0)).toHaveLength(2);
    const other = new AwayDesk(db, () => 'g2', {minMs: 60_000});
    expect(other.entries(0)).toHaveLength(0);
  });
});
