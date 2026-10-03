// The TV's move pipeline (src/client/tv/full/pipeline): phase timings from the card's text and the queue (adaptive
// pacing), which cards and tiles are sequenced, and the log ticker's moves.
import {describe, expect, it} from 'vitest';
import type {LogLine, SpectatorModel} from '../src/shared/full';
import {TILE} from '../src/shared/full';
import {actionMs, attackMs, BEHIND_MAX_MS, CARD_STALE_MS, FLOOR, skipBehind, holdDeadline, holdForText, isBusy, paceFactor, planCard, QUIET, travelFor} from '../src/client/tv/full/pipeline/pacing';
import type {CardShape, PaceInput} from '../src/client/tv/full/pipeline/pacing';
import {sequencedBy} from '../src/client/tv/full/pipeline/sequence';
import {iconsOf, resourceOf, tickerItems} from '../src/client/tv/full/pipeline/ticker';
import spectator from './fixtures/full/spectator.json';
import g2 from './fixtures/logmoves/g2-full.json';

const QUIET_PACE: PaceInput = {waiting: 0, lagMs: 0, sinceLastMs: null};
const SHAPE: CardShape = {textLen: 120, distance: 0.4, gains: true, tile: true, reduced: false};

describe('pacing: the factor', () => {
  it('is 1 when the table is quiet', () => {
    expect(paceFactor(QUIET_PACE)).toBe(1);
    expect(paceFactor({waiting: 0, lagMs: 1200, sinceLastMs: 9000})).toBe(1);
  });
  it('shortens with the queue, down to the floor', () => {
    expect(paceFactor({...QUIET_PACE, waiting: 1})).toBe(0.75);
    expect(paceFactor({...QUIET_PACE, waiting: 2})).toBe(0.5);
    expect(paceFactor({...QUIET_PACE, waiting: 3})).toBe(FLOOR);
    expect(paceFactor({...QUIET_PACE, waiting: 9})).toBe(FLOOR);
  });
  it('shortens when the TV runs late and when moves come in a burst', () => {
    expect(paceFactor({...QUIET_PACE, lagMs: 2500})).toBe(0.75);
    expect(paceFactor({...QUIET_PACE, lagMs: 3500})).toBe(0.5);
    expect(paceFactor({...QUIET_PACE, lagMs: 30000})).toBe(FLOOR);
    expect(paceFactor({...QUIET_PACE, sinceLastMs: 800})).toBe(0.75);
    // the strongest reason wins
    expect(paceFactor({waiting: 1, lagMs: 3000, sinceLastMs: 800})).toBe(0.63);
    expect(paceFactor({waiting: 2, lagMs: 0, sinceLastMs: 800})).toBe(0.5);
  });
  it('busy pacing starts below 0.9', () => {
    expect(isBusy(1)).toBe(false);
    expect(isBusy(0.8)).toBe(true);
  });
});

describe('pacing: phase lengths', () => {
  it('holds 1.5 s for a short card and up to 2.5 s for a long one', () => {
    expect(holdForText(20)).toBe(1500);
    expect(holdForText(40)).toBe(1500);
    expect(holdForText(150)).toBe(2000);
    expect(holdForText(260)).toBe(2500);
    expect(holdForText(900)).toBe(2500);
  });
  it('travels 0.6–1.2 s with the distance', () => {
    expect(travelFor(0)).toBe(600);
    expect(travelFor(0.3)).toBe(900);
    expect(travelFor(2)).toBe(1200);
  });
  it('quiet: the full timings, one effect at a time, the reticle pings twice', () => {
    const p = planCard(SHAPE, QUIET_PACE);
    expect(p.factor).toBe(1);
    expect(p.busy).toBe(false);
    expect(p.anticipation).toBe(QUIET.anticipation);
    expect(p.travel).toBe(travelFor(0.4));
    expect(p.hold).toBe(holdForText(120));
    expect(p.holdAt).toBe(p.anticipation + p.travel);
    expect(p.resolveAt).toBe(p.holdAt + p.hold);
    expect(p.flightsAt).toBeGreaterThan(p.resolveAt);
    expect(p.reticleAt).toBe(p.flightsAt + p.flights);
    expect(p.pings).toBe(2);
    expect(p.dropAt).toBe(p.reticleAt + 2 * p.ping);
    expect(p.mergeFlights).toBe(false);
    expect(p.total).toBeGreaterThan(p.exitAt);
    expect(p.total).toBeGreaterThan(6000);
    expect(p.total).toBeLessThan(8000);
  });
  it('busy: every phase shorter, flights merged, one ping, none at the floor', () => {
    const quiet = planCard(SHAPE, QUIET_PACE);
    const one = planCard(SHAPE, {waiting: 1, lagMs: 0, sinceLastMs: null});
    expect(one.busy).toBe(true);
    expect(one.mergeFlights).toBe(true);
    expect(one.pings).toBe(1);
    expect(one.hold).toBe(Math.round(quiet.hold * 0.75));
    const floor = planCard(SHAPE, {waiting: 4, lagMs: 6000, sinceLastMs: 500});
    expect(floor.factor).toBe(FLOOR);
    expect(floor.pings).toBe(0);
    expect(floor.dropAt).toBe(floor.reticleAt);
    // roughly 40 % of the quiet length
    expect(floor.total / quiet.total).toBeGreaterThan(0.35);
    expect(floor.total / quiet.total).toBeLessThan(0.5);
    expect(floor.total).toBeLessThan(3200);
  });
  it('a card without gains or a tile resolves at once', () => {
    const p = planCard({...SHAPE, gains: false, tile: false}, QUIET_PACE);
    expect(p.flights).toBe(0);
    expect(p.pings).toBe(0);
    expect(p.dropAt).toBe(p.reticleAt);
    expect(p.total).toBeLessThan(planCard(SHAPE, QUIET_PACE).total - 1500);
  });
  it('reduced motion: no flights or pings, a short fade instead of the travel', () => {
    const p = planCard({...SHAPE, reduced: true}, QUIET_PACE);
    expect(p.flights).toBe(0);
    expect(p.pings).toBe(0);
    expect(p.travel).toBe(300);
    expect(p.hold).toBe(holdForText(120));
  });
  it('a replay plays Phase 3 and 4 only', () => {
    const p = planCard({...SHAPE, replay: true}, QUIET_PACE);
    expect(p.anticipation).toBe(0);
    expect(p.travel).toBe(0);
    expect(p.holdAt).toBe(0);
    expect(p.pings).toBe(2);
  });
  it('actions and attacks shorten too, with floors', () => {
    expect(actionMs(QUIET_PACE)).toBe(2600);
    expect(actionMs({waiting: 5, lagMs: 0, sinceLastMs: null})).toBe(1200);
    expect(attackMs(QUIET_PACE)).toBe(3400);
    expect(attackMs({waiting: 5, lagMs: 0, sinceLastMs: null})).toBe(2000);
  });
  it('a burst of bot cards never leaves the TV more than a few seconds behind', () => {
    // a bot plays a card with a tile every 1.2 s for 12 moves; the TV shows them one after another, skipping a head
    // moment that is too far behind while others wait
    const arrive = Array.from({length: 12}, (_, i) => i * 1200);
    let clock = 0, maxBehind = 0, skipped = 0;
    for (let i = 0; i < arrive.length; i++) {
      clock = Math.max(clock, arrive[i]);
      const waiting = arrive.filter((a, j) => j > i && a <= clock).length;
      const pace = {waiting, lagMs: clock - arrive[i], sinceLastMs: i ? 1200 : null};
      if (skipBehind(pace)) { skipped++; continue; }
      const p = planCard(SHAPE, pace);
      maxBehind = Math.max(maxBehind, clock - arrive[i]);
      clock += p.total;
    }
    expect(maxBehind).toBeLessThanOrEqual(BEHIND_MAX_MS);
    expect(skipped).toBeGreaterThan(0);
    expect(skipped).toBeLessThan(arrive.length);
  });
  it('skips only with moments waiting, or when very late', () => {
    expect(skipBehind({waiting: 0, lagMs: 7000})).toBe(false);
    expect(skipBehind({waiting: 1, lagMs: 7000})).toBe(true);
    expect(skipBehind({waiting: 1, lagMs: 5000})).toBe(false);
    expect(skipBehind({waiting: 0, lagMs: CARD_STALE_MS + 1})).toBe(true);
  });
  it('holds let go before a skipped card would', () => {
    expect(holdDeadline(planCard(SHAPE, QUIET_PACE), 0)).toBeLessThan(CARD_STALE_MS);
    expect(holdDeadline(planCard(SHAPE, QUIET_PACE), 60000)).toBe(CARD_STALE_MS + 2000);
  });
});

const base = spectator as unknown as SpectatorModel;
function pair(patch: (next: SpectatorModel) => void): [SpectatorModel, SpectatorModel] {
  const a = structuredClone(base);
  a.game.phase = 'action';
  const b = structuredClone(a);
  patch(b);
  return [a, b];
}

describe('sequenced cards and tiles', () => {
  const color = base.players[0].color;
  const empty = (m: SpectatorModel) => m.game.spaces.filter((s) => s.tileType === undefined && s.spaceType !== 'colony');
  it('a played card with its own tile and an ocean', () => {
    const [a, b] = pair((m) => {
      m.players[0].tableau = [...m.players[0].tableau, {name: 'Asteroid'}];
      const [s1, s2] = empty(m);
      s1.tileType = TILE.OCEAN; s1.color = undefined;
      s2.tileType = TILE.CITY; s2.color = color;
    });
    const seq = sequencedBy(a, b);
    expect(seq.cards).toEqual([`${color}|Asteroid`]);
    expect([...seq.tiles.values()].map((t) => t.card)).toEqual([`${color}|Asteroid`, `${color}|Asteroid`]);
  });
  it('a tile with no played card (a standard project) is not sequenced; nor are flicked cards or corporations', () => {
    const [a, b] = pair((m) => { const [s] = empty(m); s.tileType = TILE.CITY; s.color = color; });
    expect(sequencedBy(a, b).tiles.size).toBe(0);
    const [c, d] = pair((m) => { m.players[0].tableau = [...m.players[0].tableau, {name: 'Asteroid'}]; });
    expect(sequencedBy(c, d, () => true).cards).toEqual([]);
    const [e, f] = pair((m) => { m.players[0].tableau = [...m.players[0].tableau, {name: 'Tharsis Republic'}]; });
    expect(sequencedBy(e, f).cards).toEqual([]);
  });
  it('nothing across games or an undo', () => {
    const [a, b] = pair((m) => { m.players[0].tableau = [...m.players[0].tableau, {name: 'Asteroid'}]; m.id = 'other'; });
    expect(sequencedBy(a, b).cards).toEqual([]);
    expect(sequencedBy(null, b).cards).toEqual([]);
  });
});

describe('the log ticker', () => {
  const lines = (g2 as unknown as {lines: LogLine[]}).lines;
  it('shows at most three moves, newest first', () => {
    const items = tickerItems(lines);
    expect(items.length).toBe(3);
    const all = tickerItems(lines, new Set(), 9, 999);
    expect(items.map((x) => x.key)).toEqual(all.slice(0, 3).map((x) => x.key));
  });
  it('reads a move as a word and icons', () => {
    const all = tickerItems(lines, new Set(), 9, 999);
    const natural = all.find((x) => x.card === 'Natural Preserve');
    expect(natural?.label).toBe('Natural Preserve');
    expect(natural?.icons.some((i) => i.k === 'tile' && i.tile === 'special')).toBe(true);
    expect(all.some((x) => x.how === 'passed' && x.label === 'passed')).toBe(true);
    expect(all.some((x) => x.how === 'milestone' && x.label === 'Builder')).toBe(true);
    expect(all.some((x) => x.icons.some((i) => i.k === 'res' && i.prod))).toBe(true);
  });
  it('a played card waits until the TV has shown it', () => {
    const all = tickerItems(lines, new Set(), 9, 999);
    const played = all.find((x) => x.how === 'played' && x.card)!;
    const hidden = tickerItems(lines, new Set([`${played.by}|${played.card}`]), 9, 999);
    expect(hidden.some((x) => x.key === played.key)).toBe(false);
  });
  it('icons: an ocean tile and a card that raises the temperature', () => {
    const l = (message: string, data: LogLine['data']): LogLine => ({message, data, timestamp: 1});
    const icons = iconsOf('red', 'Asteroid', [
      l('${0} ${1} ${2} at ${3}', [{type: 2, value: 'red'}, {type: 1, value: 'placed'}, {type: 1, value: 'ocean tile'}, {type: 13, value: '33'}]),
      l('${0} gained ${1} ${2}', [{type: 2, value: 'red'}, {type: 1, value: '2'}, {type: 1, value: 'titanium'}]),
    ] as LogLine[]);
    expect(icons[0]).toEqual({k: 'tile', tile: 'ocean'});
    expect(icons).toContainEqual({k: 'global', param: 'temperature'});
    expect(icons).toContainEqual({k: 'res', r: 'titanium', n: 2, prod: false});
    expect(iconsOf('red', 'Convert Heat', [])).toEqual([{k: 'global', param: 'temperature'}]);
    expect(resourceOf('M€')).toBe('megacredits');
    expect(resourceOf('plant')).toBe('plants');
    expect(resourceOf('animal')).toBeNull();
  });
});
