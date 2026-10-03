import {describe, expect, it} from 'vitest';
import {advanceFullTurn, budgetOf, companionHolds, companionTurn, formatClock, fullActing, fullHolds, fullTurnHolder, heldWithin,
  HOLD_MS, readClock, TURN_BUDGET_MS, usedMs} from '../src/shared/clock';
import type {TurnClock} from '../src/shared/clock';
import {apply, newGame} from '../src/shared/engine';
import type {Command, GameState, Tick} from '../src/shared/game';
import {TurnClockDesk} from '../src/server/clock';

// ---- a minimal engine model ----------------------------------------------------------------------
type P = {color: string; isActive?: boolean; actionsTakenThisRound?: number; tableau?: unknown[]};
function model(phase: string, players: P[], extra: {generation?: number; passed?: string[]; temperature?: number; oxygenLevel?: number; oceans?: number} = {}) {
  return {
    game: {phase, generation: extra.generation ?? 2, passedPlayers: extra.passed ?? [], temperature: extra.temperature ?? -30,
      oxygenLevel: extra.oxygenLevel ?? 0, oceans: extra.oceans ?? 0},
    players: players.map((p) => ({color: p.color, isActive: !!p.isActive, actionsTakenThisRound: p.actionsTakenThisRound ?? 0, tableau: p.tableau ?? [{name: 'Corp'}]})),
  } as never;
}

describe('hold arithmetic', () => {
  it('counts overlapping holds once and only inside the window', () => {
    expect(heldWithin([[10, 20], [15, 30], [50, 60]], 0, 100)).toBe(30);
    expect(heldWithin([[10, 20]], 15, 100)).toBe(5);
    expect(heldWithin([[10, 20]], 30, 100)).toBe(0);
    expect(heldWithin([], 0, 100)).toBe(0);
  });
  it('excludes holds from the time used on a turn', () => {
    expect(usedMs({startedAt: 1000, holds: [[2000, 5000]]}, 11_000)).toBe(7000);
    expect(usedMs({startedAt: 1000, holds: []}, 500)).toBe(0); // never negative (clock skew)
  });
});

describe('reading the clock', () => {
  const clock = (startedAt: number, holds: TurnClock['holds'] = []): TurnClock =>
    ({setting: 'brisk', budgetMs: 90_000, playerId: 'a', color: 'red', turnKey: 'k', startedAt, holds, serverNow: 0});
  it('is calm, then warm in the last fifth, then over time', () => {
    expect(readClock(clock(0), 30_000)).toMatchObject({warm: false, overTime: false, remainingMs: 60_000});
    expect(readClock(clock(0), 72_001)).toMatchObject({warm: true, overTime: false});
    expect(readClock(clock(0), 71_999)).toMatchObject({warm: false});
    expect(readClock(clock(0), 90_000)).toMatchObject({warm: false, overTime: true});
  });
  it('pauses inside a hold and does not count it', () => {
    const c = clock(0, [[10_000, 40_000]]);
    expect(readClock(c, 20_000)).toMatchObject({paused: true, remainingMs: 80_000});
    expect(readClock(c, 50_000)).toMatchObject({paused: false, remainingMs: 70_000});
  });
  it('formats minutes and seconds, over time with a plus', () => {
    expect(formatClock(125_000)).toBe('2:05');
    expect(formatClock(7_200)).toBe('0:08');
    expect(formatClock(-12_000)).toBe('+0:12');
  });
  it('has documented budgets', () => {
    expect(TURN_BUDGET_MS).toEqual({relaxed: 180_000, brisk: 90_000});
    expect(budgetOf('off')).toBe(0);
    expect(budgetOf(undefined)).toBe(0);
  });
});

describe('full mode: whose turn it is', () => {
  it('acts only in the action phase, plus generation 1 "research" once every corporation is in', () => {
    expect(fullActing(model('action', [{color: 'red'}]))).toBe(true);
    expect(fullActing(model('research', [{color: 'red'}], {generation: 2}))).toBe(false);
    expect(fullActing(model('drafting', [{color: 'red'}]))).toBe(false);
    expect(fullActing(model('research', [{color: 'red'}, {color: 'blue', tableau: []}], {generation: 1}))).toBe(false);
    expect(fullActing(model('research', [{color: 'red'}, {color: 'blue'}], {generation: 1}))).toBe(true);
    expect(fullActing(model('production', [{color: 'red'}]))).toBe(false);
  });
  it('the holder is the single active, unpassed player', () => {
    expect(fullTurnHolder(model('action', [{color: 'red', isActive: true}, {color: 'blue'}]))?.color).toBe('red');
    expect(fullTurnHolder(model('action', [{color: 'red', isActive: true}], {passed: ['red']}))).toBeNull();
    // research: isActive only marks the first player, so nobody holds a turn
    expect(fullTurnHolder(model('research', [{color: 'red', isActive: true}, {color: 'blue'}]))).toBeNull();
  });
  it('starts a new turn when the holder changes and when their action count resets', () => {
    let t = advanceFullTurn(null, model('action', [{color: 'red', isActive: true}, {color: 'blue'}]), 1000);
    expect(t).toMatchObject({color: 'red', startedAt: 1000});
    t = advanceFullTurn(t, model('action', [{color: 'red', isActive: true, actionsTakenThisRound: 1}, {color: 'blue'}]), 5000);
    expect(t.startedAt).toBe(1000); // the second action of the same turn
    t = advanceFullTurn(t, model('action', [{color: 'red'}, {color: 'blue', isActive: true}]), 9000);
    expect(t).toMatchObject({color: 'blue', startedAt: 9000});
    const n = t.turnNo;
    t = advanceFullTurn(t, model('action', [{color: 'red'}, {color: 'blue', isActive: true, actionsTakenThisRound: 1}]), 9500);
    expect(t.turnNo).toBe(n);
    t = advanceFullTurn(t, model('action', [{color: 'red'}, {color: 'blue', isActive: true, actionsTakenThisRound: 0}]), 12_000);
    expect(t).toMatchObject({color: 'blue', startedAt: 12_000}); // their next turn (others passed in between)
  });
  it('once everyone else has passed, every action is a turn of its own', () => {
    let t = advanceFullTurn(null, model('action', [{color: 'red', isActive: true}, {color: 'blue'}], {passed: ['blue']}), 0);
    t = advanceFullTurn(t, model('action', [{color: 'red', isActive: true, actionsTakenThisRound: 1}, {color: 'blue'}], {passed: ['blue']}), 4000);
    expect(t.startedAt).toBe(4000);
    t = advanceFullTurn(t, model('action', [{color: 'red', isActive: true, actionsTakenThisRound: 2}, {color: 'blue'}], {passed: ['blue']}), 8000);
    expect(t.startedAt).toBe(8000);
  });
  it('pauses (no holder) through research and drafting', () => {
    let t = advanceFullTurn(null, model('action', [{color: 'red', isActive: true}, {color: 'blue'}]), 0);
    t = advanceFullTurn(t, model('drafting', [{color: 'red', isActive: true}, {color: 'blue'}]), 100);
    expect(t.color).toBeNull();
    t = advanceFullTurn(t, model('action', [{color: 'red', isActive: true}, {color: 'blue'}], {generation: 3}), 60_000);
    expect(t).toMatchObject({color: 'red', startedAt: 60_000});
  });
  it('holds for the corporation reveal and terraforming maxima', () => {
    const before = model('research', [{color: 'red', tableau: []}, {color: 'blue'}], {generation: 1});
    const after = model('research', [{color: 'red'}, {color: 'blue'}], {generation: 1});
    expect(fullHolds(before, after, 1000)).toEqual([[1000, 1000 + 2 * HOLD_MS.revealPerPlayer + HOLD_MS.revealExtra]]);
    const warm = model('action', [{color: 'red'}], {temperature: 6});
    const hot = model('action', [{color: 'red'}], {temperature: 8});
    expect(fullHolds(warm, hot, 0)).toEqual([[0, HOLD_MS.milestone]]);
    expect(fullHolds(hot, hot, 0)).toEqual([]);
  });
});

// ---- companion mode, from a real command log ------------------------------------------------------
function play(cmds: Command[], at: number[]): {state: GameState; ticks: Tick[]} {
  let state = newGame('g');
  const ticks: Tick[] = [];
  cmds.forEach((c, i) => {
    const r = apply(state, c);
    state = r.state;
    ticks.push({seq: state.seq, at: at[i], command: c, events: r.events});
  });
  return {state, ticks};
}
const setup: Command[] = [
  {t: 'join', playerId: 'a', name: 'Ana', color: 'red'},
  {t: 'join', playerId: 'b', name: 'Ben', color: 'blue'},
  {t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b']},
  {t: 'chooseCorp', playerId: 'a', corporation: 'CrediCor', cardsKept: 0, answers: []},
  {t: 'chooseCorp', playerId: 'b', corporation: 'Helion', cardsKept: 0, answers: []},
];

describe('companion mode: whose turn it is', () => {
  it('reads the turn start from the log and holds for the reveal', () => {
    const {state, ticks} = play(setup, [1, 2, 3, 4, 10_000]);
    expect(state.current).toBe('a');
    const turn = companionTurn(state, ticks);
    expect(turn).toMatchObject({playerId: 'a', startedAt: 10_000});
    expect(companionHolds(state, ticks, turn!.startedAt)).toEqual([[10_000, 10_000 + 2 * HOLD_MS.revealPerPlayer + HOLD_MS.revealExtra]]);
  });
  it('moves to the next player when a turn ends', () => {
    const {state, ticks} = play([...setup, {t: 'pass', playerId: 'a'}], [1, 2, 3, 4, 5, 20_000]);
    expect(companionTurn(state, ticks)).toMatchObject({playerId: 'b', startedAt: 20_000});
  });
  it('is nobody\'s turn outside the action phase', () => {
    const {state, ticks} = play(setup.slice(0, 4), [1, 2, 3, 4]);
    expect(state.phase).toBe('setup');
    expect(companionTurn(state, ticks)).toBeNull();
  });
});

describe('the table-wide options', () => {
  it('the turn clock can change at any time; unknown values are refused', () => {
    const {state} = play(setup, [1, 2, 3, 4, 5]);
    const r = apply(state, {t: 'setTurnClock', playerId: 'a', clock: 'brisk'});
    expect(r.state.turnClock).toBe('brisk');
    expect(() => apply(state, {t: 'setTurnClock', playerId: 'a', clock: 'blitz' as never})).toThrow(/turn clock/);
  });
  it('fast mode is chosen in the lobby only', () => {
    const lobby = apply(newGame('g'), {t: 'setFastMode', playerId: 'a', on: true}).state;
    expect(lobby.fastMode).toBe(true);
    const {state} = play(setup, [1, 2, 3, 4, 5]);
    expect(() => apply(state, {t: 'setFastMode', playerId: 'a', on: true})).toThrow(/before the game starts/);
  });
});

describe('the server desk', () => {
  it('sends nothing when the clock is off and the companion turn when it is on', () => {
    const {state, ticks} = play(setup, [1, 2, 3, 4, 10_000]);
    const desk = new TurnClockDesk();
    expect(desk.current(state, ticks, 12_000)).toBeNull();
    const on = apply(state, {t: 'setTurnClock', playerId: 'a', clock: 'relaxed'}).state;
    expect(desk.current(on, ticks, 12_000)).toMatchObject({setting: 'relaxed', budgetMs: 180_000, playerId: 'a', color: 'red', startedAt: 10_000, serverNow: 12_000});
  });
  it('broadcasts only on change (server time alone is not a change)', () => {
    const {state, ticks} = play(setup, [1, 2, 3, 4, 10_000]);
    const on = apply(state, {t: 'setTurnClock', playerId: 'a', clock: 'brisk'}).state;
    const desk = new TurnClockDesk();
    expect(desk.changed(on, ticks, 11_000)).not.toBeNull();
    expect(desk.changed(on, ticks, 15_000)).toBeNull();
  });
  it('maps the engine colour to the seat and keeps the production-show hold', () => {
    const desk = new TurnClockDesk();
    const state = {...newGame('g'), phase: 'full', mode: 'full', turnClock: 'brisk',
      full: {gameId: 'E', spectatorId: 's', players: {a: {engineId: 'pa', color: 'red'}, b: {engineId: 'pb', color: 'blue'}}}} as unknown as GameState;
    desk.observeFull('E', null, model('action', [{color: 'red'}, {color: 'blue', isActive: true}]), 1000);
    desk.productionShow(2000, 6800, 1500);
    const c = desk.current(state, [], 3000)!;
    expect(c).toMatchObject({playerId: 'b', color: 'blue', startedAt: 1000});
    expect(c.holds).toEqual([[1500, 2000 + 6800 + HOLD_MS.recapAfterShow]]);
    desk.reset(null);
    expect(desk.current(state, [], 3000)).toMatchObject({playerId: null});
  });
});
