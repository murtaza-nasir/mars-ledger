import {describe, expect, it} from 'vitest';
import {Harness, started} from './harness';
import {newGame, preview} from '../src/shared/engine';

describe('a two-player game from lobby to generation 2', () => {
  it('runs setup, two turns, production and research', () => {
    const h = new Harness(newGame('g'));
    h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
    h.do({t: 'join', playerId: 'b', name: 'Ben', color: 'blue'});
    expect(h.s.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b']});
    expect(h.s.phase).toBe('setup');

    h.resolve({t: 'chooseCorp', playerId: 'a', corporation: 'CrediCor', cardsKept: 5, answers: []});
    expect(h.p('a').stock.megacredits).toBe(57 - 15);
    expect(h.p('a').handSize).toBe(5);
    expect(h.s.phase).toBe('setup');
    h.resolve({t: 'chooseCorp', playerId: 'b', corporation: 'Ecoline', cardsKept: 3, answers: []});
    expect(h.p('b')).toMatchObject({stock: {megacredits: 27, plants: 3}, production: {plants: 2}, greeneryCost: 7});
    expect(h.s.phase).toBe('action');
    expect(h.s.current).toBe('a');

    h.play('a', 'Mine');
    expect(h.p('a').stock.megacredits).toBe(38);
    expect(h.p('a').production.steel).toBe(1);
    expect(h.s.current).toBe('a');
    h.play('a', 'Sponsors');
    expect(h.p('a').production.megacredits).toBe(2);
    expect(h.p('a').handSize).toBe(3);
    expect(h.s.current).toBe('b');

    h.do({t: 'pass', playerId: 'b'});
    expect(h.s.current).toBe('a');
    h.do({t: 'pass', playerId: 'a'});

    // production: M€ = stock + production + TR
    expect(h.s.generation).toBe(2);
    expect(h.s.phase).toBe('research');
    expect(h.s.order).toEqual(['b', 'a']);
    expect(h.p('a').stock).toMatchObject({megacredits: 32 + 2 + 20, steel: 1});
    expect(h.p('b').stock).toMatchObject({megacredits: 27 + 20, plants: 5});

    h.do({t: 'research', playerId: 'a', cardsBought: 2});
    expect(h.p('a').stock.megacredits).toBe(54 - 6);
    expect(h.p('a').handSize).toBe(5);
    h.do({t: 'research', playerId: 'b', cardsBought: 0});
    expect(h.s.phase).toBe('action');
    expect(h.s.current).toBe('b');
  });

  it('energy becomes heat at production', () => {
    const h = started();
    h.give('a', {energy: 3, heat: 1}, {energy: 2, heat: 1});
    h.do({t: 'pass', playerId: 'a'});
    h.do({t: 'pass', playerId: 'b'});
    expect(h.p('a').stock).toMatchObject({energy: 2, heat: 1 + 3 + 1});
  });

  it('enforces turn order and action counts', () => {
    const h = started();
    expect(preview(h.s, {t: 'pass', playerId: 'b'})).toMatchObject({ok: false, error: expect.stringContaining("Ana's turn")});
    expect(preview(h.s, {t: 'endTurn', playerId: 'a'})).toMatchObject({ok: false});
    h.play('a', 'Mine');
    h.do({t: 'endTurn', playerId: 'a'});
    expect(h.s.current).toBe('b');
  });

  it('a passed player is skipped for the rest of the generation', () => {
    const h = started();
    h.do({t: 'pass', playerId: 'a'});
    h.play('b', 'Mine');
    h.do({t: 'endTurn', playerId: 'b'});
    expect(h.s.current).toBe('b');
  });

  it('beginner corporation gets 10 free cards', () => {
    const h = started('Beginner Corporation', 'Beginner Corporation', 10, 0);
    expect(h.p('a').handSize).toBe(10);
    expect(h.p('a').stock.megacredits).toBe(42);
  });
});
