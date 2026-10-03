import {describe, expect, it} from 'vitest';
import {apply, newGame} from '../src/shared/engine';
import {isHiddenLogLine, visibleLogLines} from '../src/shared/logfilter';
import type {GameState} from '../src/shared/game';

describe('engine log lines hidden from players', () => {
  it('drops the game id and clone lines', () => {
    expect(isHiddenLogLine({message: 'This game id was ${0}'})).toBe(true);
    expect(isHiddenLogLine({message: 'This game was a clone from game ${0}'})).toBe(true);
  });
  it('keeps every other line', () => {
    const lines = [{message: '${0} played ${1}'}, {message: 'This game id was ${0}'}, {message: 'Generation ${0}'}];
    expect(visibleLogLines(lines).map((l) => l.message)).toEqual(['${0} played ${1}', 'Generation ${0}']);
  });
});

describe('game title and draft recorded at start', () => {
  const lobby = (): GameState => {
    let s = newGame('g1');
    s = apply(s, {t: 'join', playerId: 'a', name: 'A', color: 'red'}).state;
    return s;
  };
  it('companion: title from the start command', () => {
    const s = apply(lobby(), {t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a'], title: 'Game 7'}).state;
    expect(s.title).toBe('Game 7');
    expect(s.draft).toBeUndefined();
  });
  it('full: title and draft', () => {
    const link = {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'p1', color: 'red' as const}}, name: 'Cold Stellar Node'};
    const s = apply(lobby(), {t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a'], mode: 'full', draft: false, link, title: 'Cold Stellar Node'}).state;
    expect(s.title).toBe('Cold Stellar Node');
    expect(s.draft).toBe(false);
  });
  it('older games without a title still load', () => {
    const s = apply(lobby(), {t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a']}).state;
    expect(s.title).toBeUndefined();
  });
});
