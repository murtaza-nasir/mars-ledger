import {describe, expect, it} from 'vitest';
import {isOlderView} from '../src/shared/full';
import type {FullView} from '../src/shared/full';

const view = (id: string, gameAge: number, undoCount = 0, role: 'player' | 'spectator' = 'player'): FullView =>
  ({role, playerId: id, model: {id, game: {gameAge, undoCount}}} as unknown as FullView);

describe('isOlderView', () => {
  it('accepts the first view and a newer one', () => {
    expect(isOlderView(view('p1', 5), null)).toBe(false);
    expect(isOlderView(view('p1', 6), view('p1', 5))).toBe(false);
    expect(isOlderView(view('p1', 5), view('p1', 5))).toBe(false);
  });
  it('drops an older view of the same seat that arrives late', () => {
    expect(isOlderView(view('p1', 4), view('p1', 5))).toBe(true);
  });
  it('treats an undo as newer even though gameAge drops', () => {
    expect(isOlderView(view('p1', 3, 1), view('p1', 5, 0))).toBe(false);
    expect(isOlderView(view('p1', 9, 0), view('p1', 3, 1))).toBe(true);
  });
  it('always accepts another seat, role or game', () => {
    expect(isOlderView(view('p2', 1), view('p1', 5))).toBe(false);
    expect(isOlderView(view('s1', 1, 0, 'spectator'), view('p1', 5))).toBe(false);
  });
});
