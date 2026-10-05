import {describe, expect, it} from 'vitest';
import {hopAt, hopPlan, lapOf, leaderOf, perimeter, pointAt, PUFF_FROM, slotOf, slotPoint, spreadSlots, TRACK_LEN} from '../src/client/tv/full/trTrack';
import type {TrackShape} from '../src/client/tv/full/trTrack';
import {DEFAULT_SETTINGS, parseSettings} from '../src/client/tv/settings';

const SHAPE: TrackShape = {x: 100, y: 50, w: 800, h: 500, r: 60};

describe('slots and laps', () => {
  it('maps a rating to its space on the 0..99 loop', () => {
    expect(slotOf(0)).toBe(0);
    expect(slotOf(20)).toBe(20);
    expect(slotOf(63)).toBe(63);
    expect(slotOf(99)).toBe(99);
  });
  it('laps above 99: 100 sits on 0 of lap 1, 163 on 63 of lap 1, 250 on 50 of lap 2', () => {
    expect([100, 163, 199, 200, 250].map(slotOf)).toEqual([0, 63, 99, 0, 50]);
    expect([63, 99, 100, 163, 199, 200, 250].map(lapOf)).toEqual([0, 0, 1, 1, 1, 2, 2]);
  });
  it('clamps junk to the start of the track', () => {
    expect(slotOf(-5)).toBe(0); expect(slotOf(NaN)).toBe(0); expect(lapOf(-1)).toBe(0); expect(slotOf(20.4)).toBe(20);
  });
});

describe('the loop', () => {
  it('has a perimeter of two straights, two sides and four quarter arcs', () => {
    expect(perimeter(SHAPE)).toBeCloseTo(2 * 680 + 2 * 380 + 2 * Math.PI * 60, 6);
  });
  it('starts on the top edge right of the corner, runs clockwise and closes', () => {
    const p0 = pointAt(SHAPE, 0), P = perimeter(SHAPE);
    expect(p0).toMatchObject({x: 160, y: 50, ny: -1});
    const q = pointAt(SHAPE, 100); expect(q.x).toBeCloseTo(260); expect(q.y).toBeCloseTo(50);
    const right = pointAt(SHAPE, 680 + (Math.PI * 60) / 2 + 100);
    expect(right.x).toBeCloseTo(900); expect(right.y).toBeCloseTo(50 + 60 + 100);
    expect(right.nx).toBeCloseTo(1);
    const wrap = pointAt(SHAPE, P + 100); expect(wrap.x).toBeCloseTo(260);
    const back = pointAt(SHAPE, -1); expect(back.x).toBeLessThan(160); expect(back.y).toBeLessThan(120);
  });
  it('is continuous around every corner and keeps unit normals', () => {
    const P = perimeter(SHAPE); let prev = pointAt(SHAPE, 0);
    for (let d = 1; d <= P; d += 1) {
      const p = pointAt(SHAPE, d);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(1.02);
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 6);
      prev = p;
    }
  });
  it('places the 100 spaces as equal arcs, space 0 half a space in', () => {
    const P = perimeter(SHAPE), a = slotPoint(SHAPE, 0);
    expect(a.x).toBeCloseTo(160 + P / TRACK_LEN / 2); expect(a.y).toBeCloseTo(50);
    const full = slotPoint(SHAPE, 100), start = slotPoint(SHAPE, 0);
    expect(full.x).toBeCloseTo(start.x); expect(full.y).toBeCloseTo(start.y);
  });
});

describe('markers on one number', () => {
  it('leaves lone markers on their own spaces', () => {
    expect(spreadSlots([20, 35, 60], 1)).toEqual([20, 35, 60]);
  });
  it('fans equal ratings about their space, one gap apart, in seat order', () => {
    expect(spreadSlots([40, 40], 1)).toEqual([39.5, 40.5]);
    expect(spreadSlots([40, 40, 40], 1)).toEqual([39, 40, 41]);
    const four = spreadSlots([10, 10, 10, 10], 0.8); expect(four.map((x) => +x.toFixed(3))).toEqual([8.8, 9.6, 10.4, 11.2]);
  });
  it('spreads neighbours that would touch and leaves a clear one alone', () => {
    const r = spreadSlots([34, 35, 50], 1);
    expect(r[2]).toBe(50);
    expect(r[1] - r[0]).toBeCloseTo(1); expect((r[0] + r[1]) / 2).toBeCloseTo(34.5);
  });
  it('pushes a run of three neighbours apart and keeps its middle', () => {
    const r = spreadSlots([30, 31, 32], 1.5);
    expect(r[1] - r[0]).toBeCloseTo(1.5); expect(r[2] - r[1]).toBeCloseTo(1.5); expect(r[1]).toBeCloseTo(31);
  });
  it('spreads a cluster over the 99 to 0 seam', () => {
    const r = spreadSlots([99, 0, 0], 1);
    // the cluster's mean (99.67 on the unwrapped loop) is kept; its members stand one apart across the seam
    expect(r.map((x) => +x.toFixed(3))).toEqual([98.667, 99.667, 0.667]);
    expect(r.every((x) => x >= 0 && x < TRACK_LEN)).toBe(true);
  });
  it('keeps the order of the spaces and the order given for equal ones', () => {
    const r = spreadSlots([41, 40, 40], 1);
    expect(r[1]).toBeLessThan(r[2]); expect(r[2]).toBeLessThan(r[0]);
  });
  it('lets lapped ratings share a space with the others (110 and 10 stand on 10)', () => {
    const r = spreadSlots([slotOf(110), slotOf(10)], 1);
    expect(r).toEqual([9.5, 10.5]);
  });
});

describe('hops', () => {
  it('does nothing for no change', () => { expect(hopPlan(35, 35).steps).toEqual([]); });
  it('hops one rating at a time, up or down, ending on the new one', () => {
    expect(hopPlan(35, 38).steps).toEqual([36, 37, 38]);
    expect(hopPlan(40, 38).steps).toEqual([39, 38]);
  });
  it('puffs dust on jumps of three or more, not on a step or two', () => {
    expect(hopPlan(20, 20 + PUFF_FROM - 1).puff).toBe(false);
    expect(hopPlan(20, 20 + PUFF_FROM).puff).toBe(true);
    expect(hopPlan(60, 55).puff).toBe(true);
  });
  it('speeds up long jumps and caps their total time', () => {
    const one = hopPlan(20, 21), ten = hopPlan(20, 30);
    expect(ten.stepMs).toBeLessThan(one.stepMs);
    expect(ten.stepMs * ten.steps.length).toBeLessThanOrEqual(1100 + 1e-6);
  });
  it('hops only the last twelve of a very long jump', () => {
    const p = hopPlan(0, 90);
    expect(p.steps.length).toBe(12); expect(p.steps[11]).toBe(90); expect(p.from).toBe(78); expect(p.puff).toBe(true);
  });
  it('crosses a lap: 98 to 102 walks 99, 100 (slot 0), 101, 102', () => {
    const p = hopPlan(98, 102);
    expect(p.steps).toEqual([99, 100, 101, 102]); expect(p.steps.map(slotOf)).toEqual([99, 0, 1, 2]);
  });
  it('places a marker between steps and lifts it mid-step', () => {
    const p = hopPlan(35, 37);
    const t0 = hopAt(p, 0), mid = hopAt(p, p.stepMs * 0.5), done = hopAt(p, p.stepMs * 5);
    expect(t0).toMatchObject({tr: 35, lift: 0, done: false});
    expect(mid.tr).toBeCloseTo(35.5); expect(mid.lift).toBeCloseTo(1);
    expect(done).toEqual({tr: 37, lift: 0, done: true});
    expect(hopAt(p, p.stepMs * 1.5).tr).toBeCloseTo(36.5);
  });
});

describe('the leader', () => {
  const P = (c: string, tr: number) => ({color: c, tr});
  it('is the strictly highest rating', () => { expect(leaderOf([P('red', 35), P('blue', 37), P('green', 34)])).toBe('blue'); });
  it('is nobody when the top is shared, and at the start', () => {
    expect(leaderOf([P('red', 37), P('blue', 37), P('green', 34)])).toBeNull();
    expect(leaderOf([P('red', 20), P('blue', 20)])).toBeNull();
    expect(leaderOf([])).toBeNull();
    expect(leaderOf([P('red', 0)])).toBeNull();
  });
  it('counts laps: 105 leads 99', () => { expect(leaderOf([P('red', 99), P('blue', 105)])).toBe('blue'); });
});

describe('the TV option', () => {
  it('is on by default and survives parsing', () => {
    expect(DEFAULT_SETTINGS.trTrack).toBe(true);
    expect(parseSettings(null).trTrack).toBe(true);
    expect(parseSettings(JSON.stringify({trTrack: false})).trTrack).toBe(false);
    expect(parseSettings(JSON.stringify({trTrack: 'x'})).trTrack).toBe(true);
  });
});
