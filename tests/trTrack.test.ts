import {describe, expect, it} from 'vitest';
import {bandFor, cellCenter, clearOfFrame, frameLayout, hopAt, hopPlan, inward, lapOf, leaderOf, MARKER, PUFF_FROM, slotOf, stackPlaces, TRACK_LEN} from '../src/client/tv/full/trTrack';
import {DEFAULT_SETTINGS, parseSettings} from '../src/client/tv/settings';

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

const SCREENS: Array<[number, number]> = [[1536, 729], [1920, 1080], [3840, 2016], [6144, 2916], [1280, 1024], [800, 1280]];

describe('the frame of cells', () => {
  it('has 100 cells numbered 0..99, the four corners square', () => {
    for (const [W, H] of SCREENS) {
      const f = frameLayout(W, H);
      expect(f.cells.length).toBe(TRACK_LEN);
      expect(f.cells.map((c) => c.i)).toEqual(Array.from({length: 100}, (_, i) => i));
      expect(f.across + f.down).toBe(48);
      const corners = f.cells.filter((c) => c.corner);
      expect(corners.map((c) => c.i)).toEqual([0, f.across + 1, f.across + f.down + 2, 2 * f.across + f.down + 3]);
      for (const c of corners) { expect(c.w).toBe(f.band); expect(c.h).toBe(f.band); }
    }
  });
  it('closes the loop: each cell meets the next edge to edge, clockwise from the top-left corner', () => {
    for (const [W, H] of SCREENS) {
      const f = frameLayout(W, H);
      expect(f.cells[0]).toMatchObject({x: 0, y: 0, side: 'top'});
      for (let i = 0; i < 100; i++) {
        const a = f.cells[i], b = f.cells[(i + 1) % 100];
        // their boxes share an edge exactly: no gap, no overlap
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(Math.min(ox, oy)).toBe(0); expect(Math.max(ox, oy)).toBeGreaterThan(0);
      }
    }
  });
  it('fills the edge of the screen exactly and leaves the inside alone', () => {
    for (const [W, H] of SCREENS) {
      const f = frameLayout(W, H);
      const area = f.cells.reduce((s, c) => s + c.w * c.h, 0);
      expect(area).toBe(W * H - (W - 2 * f.band) * (H - 2 * f.band));
      for (const c of f.cells) {
        expect(c.x).toBeGreaterThanOrEqual(0); expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(W); expect(c.y + c.h).toBeLessThanOrEqual(H);
        const inBand = c.x + c.w <= f.band || c.x >= W - f.band || c.y + c.h <= f.band || c.y >= H - f.band;
        expect(inBand).toBe(true);
      }
    }
  });
  it('keeps the cells near square on every screen: as deep as the band, at most a third longer', () => {
    for (const [W, H] of SCREENS) {
      const f = frameLayout(W, H);
      for (const c of f.cells) {
        const long = Math.max(c.w, c.h), deep = Math.min(c.w, c.h);
        expect(deep).toBe(f.band);
        expect(long / deep).toBeLessThan(1.34);
      }
    }
  });
  it('takes a thin band: under 3 % of the width at 16:9, the same share on every TV of one shape', () => {
    expect(bandFor(1920, 1080) / 1920).toBeGreaterThan(0.022);
    expect(bandFor(1920, 1080) / 1920).toBeLessThan(0.03);
    expect(bandFor(1536, 729) / 1536).toBeCloseTo(bandFor(6144, 2916) / 6144, 3);
  });
  it('centres a rating on its cell and runs between cells mid-hop, across the 99 to 0 seam too', () => {
    const f = frameLayout(1920, 1080);
    const c20 = f.cells[20], p = cellCenter(f, 20);
    expect(p.x).toBeCloseTo(c20.x + c20.w / 2); expect(p.y).toBeCloseTo(c20.y + c20.h / 2);
    const mid = cellCenter(f, 20.5), p21 = cellCenter(f, 21);
    expect(mid.x).toBeCloseTo((p.x + p21.x) / 2); expect(mid.y).toBeCloseTo(p.y);
    const seam = cellCenter(f, 99.5), p99 = cellCenter(f, 99), p0 = cellCenter(f, 0);
    expect(seam.x).toBeCloseTo((p99.x + p0.x) / 2); expect(seam.y).toBeCloseTo((p99.y + p0.y) / 2);
    expect(cellCenter(f, 100)).toEqual(cellCenter(f, 0));
  });
  it('points each cell in towards the middle of the screen', () => {
    const f = frameLayout(1920, 1080);
    for (const c of f.cells) {
      const v = inward(c), m = {x: 960 - (c.x + c.w / 2), y: 540 - (c.y + c.h / 2)};
      expect(v.x * m.x + v.y * m.y).toBeGreaterThan(0);
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    }
  });
  it('keeps edge offsets clear of the band only while it shows (no --trb: the original offset)', () => {
    expect(clearOfFrame('2vw')).toBe('max(2vw, calc(var(--trb, 0px) + 0.6vw))');
    expect(clearOfFrame('4vh', '1.1vh')).toBe('max(4vh, calc(var(--trb, 0px) + 1.1vh))');
  });
});

describe('tokens on one cell', () => {
  it('leaves lone tokens alone, full size, in the middle of their cells (neighbouring ratings too)', () => {
    expect(stackPlaces([20, 35, 60])).toEqual([0, 1, 2].map(() => ({dx: 0, dy: 0, size: MARKER})));
    expect(stackPlaces([34, 35])).toEqual([{dx: 0, dy: 0, size: MARKER}, {dx: 0, dy: 0, size: MARKER}]);
  });
  it('shares a cell between equal ratings, smaller as there are more, inside or just over the cell', () => {
    let last = MARKER;
    for (let n = 2; n <= 5; n++) {
      const ps = stackPlaces(Array(n).fill(44));
      expect(new Set(ps.map((p) => `${p.dx},${p.dy}`)).size).toBe(n);
      expect(ps[0].size).toBeLessThan(last); last = ps[0].size;
      for (const p of ps) { expect(Math.abs(p.dx) + p.size / 2).toBeLessThan(0.56); expect(Math.abs(p.dy) + p.size / 2).toBeLessThan(0.56); }
    }
  });
  it('stacks only the tokens on the same cell, in seat order', () => {
    const ps = stackPlaces([40, 52, 40, 40]), three = stackPlaces([1, 1, 1]);
    expect(ps[1]).toEqual({dx: 0, dy: 0, size: MARKER});
    expect([ps[0], ps[2], ps[3]]).toEqual(three);
  });
  it('leaves a token in mid-hop alone at full size', () => {
    const ps = stackPlaces([null, 40, 40]);
    expect(ps[0]).toEqual({dx: 0, dy: 0, size: MARKER});
    expect(ps[1].size).toBeLessThan(MARKER);
  });
  it('lets lapped ratings share a cell with the others (110 and 10 stand on 10)', () => {
    const ps = stackPlaces([slotOf(110), slotOf(10)]);
    expect(ps[0].size).toBeLessThan(MARKER); expect(ps[0]).not.toEqual(ps[1]);
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
