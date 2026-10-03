import {describe, expect, it} from 'vitest';
import {ReactionDesk} from '../src/server/reactions';
import {newGame, apply} from '../src/shared/engine';
import {
  REACTION_COMBINE_MS, REACTION_LIFE_MS, REACTION_QUIET_MS, REACTION_WINDOW_MS,
  ReactionLimiter, STICKERS, addReaction, inQuietWindow, isCombined, isSticker, liveBubbles,
} from '../src/shared/reactions';
import type {Bubble, Reaction, StickerId} from '../src/shared/reactions';
import {started} from './harness';

const T0 = 1_000_000;

describe('reaction rate limit', () => {
  it('allows 5 in any 10 s, then says how long to wait', () => {
    const l = new ReactionLimiter();
    for (let i = 0; i < 5; i++) expect(l.take('a', T0 + i * 100).ok).toBe(true);
    const sixth = l.take('a', T0 + 600);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.retryInMs).toBe(REACTION_WINDOW_MS - 600);
    expect(l.cooldown('a', T0 + 600)).toBe(REACTION_WINDOW_MS - 600);
  });

  it('frees a slot once the oldest reaction leaves the window, and counts players separately', () => {
    const l = new ReactionLimiter();
    for (let i = 0; i < 5; i++) l.take('a', T0 + i * 1000);
    expect(l.take('b', T0 + 5000).ok).toBe(true);
    expect(l.take('a', T0 + REACTION_WINDOW_MS - 1).ok).toBe(false);
    expect(l.take('a', T0 + REACTION_WINDOW_MS).ok).toBe(true);
    expect(l.cooldown('b', T0 + 5000)).toBe(0);
  });

  it('refused attempts do not extend the wait', () => {
    const l = new ReactionLimiter();
    for (let i = 0; i < 5; i++) l.take('a', T0);
    for (let i = 1; i <= 20; i++) l.take('a', T0 + i * 100);
    expect(l.take('a', T0 + REACTION_WINDOW_MS).ok).toBe(true);
  });
});

describe('the server desk', () => {
  const game = () => started().s;

  it('relays a valid sticker with the player colour and name', () => {
    const d = new ReactionDesk();
    const v = d.judge(game(), 'a', {playerId: 'a', sticker: 'gg'}, T0, [null]);
    expect(v.ok).toBe(true);
    if (v.ok && v.reaction) expect(v.reaction).toMatchObject({playerId: 'a', color: 'red', name: 'Ana', sticker: 'gg', at: T0});
    else throw new Error('expected a reaction');
  });

  it('refuses strangers, impostors, the TV, the lobby and unknown stickers', () => {
    const d = new ReactionDesk();
    expect(d.judge(game(), 'zz', {playerId: 'zz', sticker: 'gg'}, T0, []).ok).toBe(false);
    expect(d.judge(game(), 'b', {playerId: 'a', sticker: 'gg'}, T0, []).ok).toBe(false);
    expect(d.judge(game(), 'tv', {playerId: 'a', sticker: 'gg'}, T0, []).ok).toBe(false);
    let lobby = newGame('x');
    lobby = apply(lobby, {t: 'join', playerId: 'a', name: 'Ana', color: 'red'}).state;
    expect(d.judge(lobby, 'a', {playerId: 'a', sticker: 'gg'}, T0, []).ok).toBe(false);
    expect(d.judge(game(), 'a', {playerId: 'a', sticker: 'shrug'}, T0, []).ok).toBe(false);
    expect(d.judge(game(), 'a', {playerId: 'a', sticker: 42}, T0, []).ok).toBe(false);
  });

  it('enforces the per-player limit with the wait in the message', () => {
    const d = new ReactionDesk();
    for (let i = 0; i < 5; i++) expect(d.judge(game(), 'a', {playerId: 'a', sticker: 'nice'}, T0 + i, []).ok).toBe(true);
    const v = d.judge(game(), 'a', {playerId: 'a', sticker: 'nice'}, T0 + 10, []);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.error).toMatch(/try again in 10 s/); expect(v.retryInMs).toBe(REACTION_WINDOW_MS - 10); }
    expect(d.judge(game(), 'b', {playerId: 'b', sticker: 'nice'}, T0 + 10, []).ok).toBe(true);
  });

  it('drops (without refusing) a reaction in the first second of a show', () => {
    const d = new ReactionDesk();
    const during = d.judge(game(), 'a', {playerId: 'a', sticker: 'wow'}, T0 + 400, [T0]);
    expect(during).toEqual({ok: true, reaction: null});
    const after = d.judge(game(), 'a', {playerId: 'a', sticker: 'wow'}, T0 + REACTION_QUIET_MS, [T0]);
    expect(after.ok && after.reaction).toBeTruthy();
    const before = d.judge(game(), 'a', {playerId: 'a', sticker: 'wow'}, T0 - 1, [T0]);
    expect(before.ok && before.reaction).toBeTruthy();
  });
});

describe('what the TV shows', () => {
  let n = 0;
  const r = (playerId: string, sticker: StickerId, at = T0): Reaction =>
    ({id: `r${++n}`, playerId, color: playerId === 'a' ? 'red' : playerId === 'b' ? 'blue' : 'green', name: playerId.toUpperCase(), sticker, at});

  it('a single reaction makes a bubble at its player', () => {
    const {bubbles, created} = addReaction([], r('a', 'ouch'), T0);
    expect(created).toBe(true);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({sticker: 'ouch', anchor: 'red', slot: 0, count: 1});
    expect(isCombined(bubbles[0])).toBe(false);
  });

  it('the same sticker from three players within 1.5 s combines into one bubble in the middle', () => {
    let b: Bubble[] = [];
    const created: boolean[] = [];
    for (const [p, dt] of [['a', 0], ['b', 500], ['c', 1400]] as const) {
      const res = addReaction(b, r(p, 'gg'), T0 + dt);
      b = res.bubbles; created.push(res.created);
    }
    expect(created).toEqual([true, false, false]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({anchor: 'center', count: 3});
    expect(b[0].senders.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    expect(isCombined(b[0])).toBe(true);
  });

  it('the combine window runs from the last addition', () => {
    let b = addReaction([], r('a', 'nice'), T0).bubbles;
    b = addReaction(b, r('b', 'nice'), T0 + 1000).bubbles;
    b = addReaction(b, r('c', 'nice'), T0 + 2400).bubbles;
    expect(b).toHaveLength(1);
    expect(b[0].count).toBe(3);
    const late = addReaction(b, r('a', 'nice'), T0 + 2400 + REACTION_COMBINE_MS);
    expect(late.created).toBe(true);
    expect(late.bubbles).toHaveLength(2);
  });

  it('a repeat from the same player counts up at their strip without moving to the middle', () => {
    let b = addReaction([], r('a', 'money'), T0).bubbles;
    b = addReaction(b, r('a', 'money'), T0 + 300).bubbles;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({anchor: 'red', count: 2});
    expect(b[0].senders).toHaveLength(1);
  });

  it('different stickers at once stack side by side, whichever strip they come from', () => {
    let b = addReaction([], r('a', 'ouch'), T0).bubbles;
    b = addReaction(b, r('a', 'wow'), T0 + 10).bubbles;
    b = addReaction(b, r('b', 'laugh'), T0 + 20).bubbles;
    expect(b.map((x) => [x.anchor, x.slot])).toEqual([['red', 0], ['red', 1], ['blue', 2]]);
  });

  it('a sticker that moves to the middle frees its side slot', () => {
    let b = addReaction([], r('a', 'ouch'), T0).bubbles;
    b = addReaction(b, r('b', 'wow'), T0 + 10).bubbles;
    b = addReaction(b, r('a', 'wow'), T0 + 20).bubbles;
    expect(b.map((x) => [x.sticker, x.anchor, x.slot])).toEqual([['ouch', 'red', 0], ['wow', 'center', 0]]);
    b = addReaction(b, r('c', 'gg'), T0 + 30).bubbles;
    expect(b.find((x) => x.sticker === 'gg')?.slot).toBe(1);
  });

  it('two combined bursts share the middle without overlapping, and slots are reused', () => {
    let b = addReaction([], r('a', 'gg'), T0).bubbles;
    b = addReaction(b, r('b', 'gg'), T0 + 10).bubbles;
    b = addReaction(b, r('a', 'wow'), T0 + 20).bubbles;
    b = addReaction(b, r('b', 'wow'), T0 + 30).bubbles;
    expect(b.map((x) => [x.anchor, x.slot])).toEqual([['center', 0], ['center', 1]]);
    const later = addReaction(b, r('a', 'ouch'), T0 + 20 + REACTION_LIFE_MS + 50).bubbles;
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({anchor: 'red', slot: 0});
  });

  it('bubbles leave after their life, counted from the last addition', () => {
    let b = addReaction([], r('a', 'meteor'), T0).bubbles;
    b = addReaction(b, r('b', 'meteor'), T0 + 1000).bubbles;
    expect(liveBubbles(b, T0 + REACTION_LIFE_MS)).toHaveLength(1);
    expect(liveBubbles(b, T0 + 1000 + REACTION_LIFE_MS)).toHaveLength(0);
  });

  it('knows the eight stickers and the quiet window', () => {
    expect(STICKERS).toHaveLength(8);
    expect(STICKERS.every(isSticker)).toBe(true);
    expect(isSticker('nope')).toBe(false);
    expect(inQuietWindow([T0], T0 + 999)).toBe(true);
    expect(inQuietWindow([T0], T0 + 1000)).toBe(false);
    expect(inQuietWindow([null, undefined], T0)).toBe(false);
  });
});
