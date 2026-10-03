// The TV's 'tvMoment' message (Phase 4 of a move began): validation and which TV counts.
import {describe, expect, it} from 'vitest';
import {primaryTv, readTvMoment} from '../src/server/tvMoments';

describe('tvMoment', () => {
  it('accepts a well-formed message and cleans its targets', () => {
    expect(readTvMoment({type: 'tvMoment', phase: 'resolve', gameAge: 41, attacker: 'red', targets: ['blue', 'blue', 'red', 'nope', 3], at: 5}))
      .toEqual({type: 'tvMoment', phase: 'resolve', gameAge: 41, attacker: 'red', targets: ['blue'], at: 5});
    expect(readTvMoment({type: 'tvMoment', phase: 'resolve', gameAge: 2, attacker: 'green', targets: [], at: 1})?.targets).toEqual([]);
  });
  it('refuses malformed ones', () => {
    expect(readTvMoment({type: 'tvMoment', phase: 'start', gameAge: 1, attacker: 'red', targets: [], at: 1})).toBeNull();
    expect(readTvMoment({type: 'tvMoment', phase: 'resolve', gameAge: 'x', attacker: 'red', targets: [], at: 1})).toBeNull();
    expect(readTvMoment({type: 'tvMoment', phase: 'resolve', gameAge: 1, attacker: 'teal', targets: [], at: 1})).toBeNull();
    expect(readTvMoment({type: 'tvMoment', phase: 'resolve', gameAge: 1, attacker: 'red', targets: 'blue', at: 1})).toBeNull();
    expect(readTvMoment(null)).toBeNull();
  });
  it('counts only the first-connected TV', () => {
    const socks = [{id: 'phone', tv: false}, {id: 'tv1', tv: true}, {id: 'tv2', tv: true}];
    expect(primaryTv(socks, (s) => s.tv)?.id).toBe('tv1');
    expect(primaryTv(socks.filter((s) => s.id !== 'tv1'), (s) => s.tv)?.id).toBe('tv2');
    expect(primaryTv([socks[0]], (s) => s.tv)).toBeNull();
  });
});
