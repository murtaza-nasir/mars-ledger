// Phone-to-TV links (src/shared/tvlinks.ts, src/server/tvlinks.ts, src/client/phone/full/logLinks.ts): the relay rules
// (replay one at a time with a cooldown, echo gaps, who may ask), the hit buzz timed to the TV's resolve (targets only,
// duplicates ignored, fallback after 6 s or at once with no TV), and what a real engine log offers the TV.
import {describe, expect, it} from 'vitest';
import type {Color, LogLine} from '../src/shared/full';
import type {GameState} from '../src/shared/game';
import type {Notice} from '../src/shared/notices';
import {cleanTargets, EchoLimiter, ECHO_GAP_MS, HAPTIC_FALLBACK_MS, HapticRelay, HIT_PATTERN, HIT_PATTERN_PLAIN, MOMENT_KEEP_MS, REPLAY_COOLDOWN_MS, REPLAY_MAX_MS,
  ReplayDesk} from '../src/shared/tvlinks';
import {cleanMove, hapticFor, TvLinkDesk} from '../src/server/tvlinks';
import {groupLog, headline, plain} from '../src/client/phone/full/logMoves';
import type {LogEntry} from '../src/client/phone/full/logMoves';
import {echoTargets, lastReplayable, replayable, replayOf, resOf} from '../src/client/phone/full/logLinks';
import g1 from './fixtures/logmoves/g1-full.json';
import g2 from './fixtures/logmoves/g2-full.json';

const T0 = 1_000_000;
type Move = Extract<LogEntry, {kind: 'move'}>;
type Fixture = {seat: Color | null; lines: LogLine[]};
const NAMES: Record<string, string> = {red: 'Ada', blue: 'Kepler', green: 'Ares'};
const nm = (c: Color) => NAMES[c] ?? c;

// ---- replay: one at a time per phone, then a cooldown ---------------------------------------------------------------
describe('replay rate limit', () => {
  it('allows one replay at a time per phone, then a cooldown from when the TV finished', () => {
    const d = new ReplayDesk();
    expect(d.judge('vera', T0).ok).toBe(true);
    d.start('vera', 'r1', T0);
    const again = d.judge('vera', T0 + 1000);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/still showing/);
    // another phone is not held up
    expect(d.judge('ada', T0 + 1000).ok).toBe(true);
    expect(d.done('r1', T0 + 5000)).toBe('vera');
    const cool = d.judge('vera', T0 + 5000 + REPLAY_COOLDOWN_MS - 1);
    expect(cool.ok).toBe(false);
    if (!cool.ok) expect(cool.error).toBe('Try again in 1 s');
    expect(d.judge('vera', T0 + 5000 + REPLAY_COOLDOWN_MS).ok).toBe(true);
  });

  it('ignores unknown and repeated done reports (two TVs both report)', () => {
    const d = new ReplayDesk();
    d.start('vera', 'r1', T0);
    expect(d.done('nope', T0 + 100)).toBe(null);
    expect(d.done('r1', T0 + 4000)).toBe('vera');
    expect(d.done('r1', T0 + 4100)).toBe(null);
    // the second report did not restart the cooldown
    expect(d.judge('vera', T0 + 4000 + REPLAY_COOLDOWN_MS).ok).toBe(true);
  });

  it('lets a phone ask again when the TV never reported back', () => {
    const d = new ReplayDesk();
    d.start('vera', 'r1', T0);
    expect(d.judge('vera', T0 + REPLAY_MAX_MS - 1).ok).toBe(false);
    expect(d.judge('vera', T0 + REPLAY_MAX_MS + REPLAY_COOLDOWN_MS - 1).ok).toBe(false);
    expect(d.judge('vera', T0 + REPLAY_MAX_MS + REPLAY_COOLDOWN_MS).ok).toBe(true);
  });
});

describe('echo rate limit', () => {
  it('keeps a short gap between echoes from one phone', () => {
    const l = new EchoLimiter();
    expect(l.take('vera', T0).ok).toBe(true);
    expect(l.take('vera', T0 + ECHO_GAP_MS - 1).ok).toBe(false);
    expect(l.take('ada', T0 + 10).ok).toBe(true);
    expect(l.take('vera', T0 + ECHO_GAP_MS).ok).toBe(true);
  });

  it('keeps only valid targets, once each, at most 8', () => {
    expect(cleanTargets([{kind: 'space', spaceId: '32'}, {kind: 'space', spaceId: '32'}, {kind: 'space', spaceId: '<b>'}, {kind: 'global', param: 'venus'},
      {kind: 'global', param: 'oxygen'}, {kind: 'res', color: 'red', resource: 'plants'}, {kind: 'res', color: 'teal', resource: 'plants'}, {kind: 'tr', color: 'blue'}, null, 'x']))
      .toEqual([{kind: 'space', spaceId: '32'}, {kind: 'global', param: 'oxygen'}, {kind: 'res', color: 'red', resource: 'plants'}, {kind: 'tr', color: 'blue'}]);
    expect(cleanTargets(Array.from({length: 20}, (_, i) => ({kind: 'space', spaceId: String(10 + i)})))).toHaveLength(8);
    expect(cleanTargets('nope')).toEqual([]);
  });
});

// ---- who may ask --------------------------------------------------------------------------------------------------
const table = (over: Partial<GameState> = {}): GameState => ({
  mode: 'full', phase: 'full',
  players: [{id: 'vera', name: 'Vera', color: 'red'}, {id: 'ada', name: 'Ada', color: 'blue'}, {id: 'bot1', name: 'Rover', color: 'green', bot: 'normal'}],
  full: {gameId: 'g1', spectatorId: 's1', players: {vera: {engineId: 'p1', color: 'red'}, ada: {engineId: 'p2', color: 'blue'}, bot1: {engineId: 'p3', color: 'green'}}},
  ...over,
}) as unknown as GameState;
const move = {key: 'm:1', by: 'blue', how: 'played', card: 'Comet', line: '+1 ocean', spaceId: '43', gains: [{r: 'plants', n: 2, prod: false}]};

describe('the relay: who may ask, and what reaches the TV', () => {
  it('relays a replay from a seated phone, as itself, with who asked', () => {
    const d = new TvLinkDesk();
    const v = d.replay(table(), 'vera', {playerId: 'vera', move}, T0, 1);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.out.from).toEqual({id: 'vera', name: 'Vera', color: 'red'});
      expect(v.out.move).toEqual(move);
    }
    // one at a time
    expect(d.replay(table(), 'vera', {playerId: 'vera', move}, T0 + 500, 1).ok).toBe(false);
  });

  it('refuses another seat, a bot, the TV, no TV, the lobby and a companion game', () => {
    const d = new TvLinkDesk();
    const err = (v: {ok: boolean; error?: string}) => (v.ok ? 'ok' : v.error);
    expect(err(d.replay(table(), 'ada', {playerId: 'vera', move}, T0, 1))).toMatch(/its own player/);
    expect(err(d.replay(table(), null, {playerId: 'vera', move}, T0, 1))).toMatch(/its own player/);
    expect(err(d.replay(table(), 'bot1', {playerId: 'bot1', move}, T0, 1))).toMatch(/Only players/);
    expect(err(d.replay(table(), 'vera', {playerId: 'vera', move}, T0, 0))).toBe('No TV is connected');
    expect(err(d.echo(table({phase: 'lobby'}), 'vera', {playerId: 'vera', targets: [{kind: 'space', spaceId: '10'}]}, T0, 1))).toMatch(/game is running/);
    expect(err(d.echo(table({mode: 'companion'} as never), 'vera', {playerId: 'vera', targets: [{kind: 'space', spaceId: '10'}]}, T0, 1))).toMatch(/game is running/);
    expect(err(d.echo(table(), 'vera', {playerId: 'vera', targets: []}, T0, 1))).toMatch(/Nothing to show/);
  });

  it('cleans a replay request: needs a card or a space, drops what the TV does not use', () => {
    expect(cleanMove({...move, card: null, spaceId: undefined})).toBe(null);
    expect(cleanMove({...move, by: 'teal'})).toBe(null);
    expect(cleanMove({...move, card: null})?.spaceId).toBe('43');
    const big = cleanMove({...move, gains: [{r: 'plants', n: 500, prod: 1}, {r: 'gold', n: 1}], extra: 'x', targets: [{color: 'red', losses: [{what: 'stock', resource: 'plants', amount: 3}, {what: 'evil'}]}]});
    expect(big?.gains).toEqual([{r: 'plants', n: 99, prod: true}]);
    expect(big?.targets).toEqual([{color: 'red', losses: [{what: 'stock', resource: 'plants', amount: 3}]}]);
    expect(big).not.toHaveProperty('extra');
  });
});

// ---- haptics --------------------------------------------------------------------------------------------------------
const hit = (id: string, by: Color, age: number): Notice => ({id, kind: 'hit', at: T0, generation: 3, age, undo: 0, by, byName: null, cause: null, changes: [], sticky: true});

describe('hit haptics timed to the TV', () => {
  it('waits for the TV, then buzzes the target seat only, with the hit pattern', () => {
    const h = new HapticRelay();
    expect(h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0, 1)).toEqual([]);
    expect(h.waiting()).toEqual(['vera']);
    // the TV resolves 2.1 s later: Vera buzzes, nobody else (Ada is the attacker; Rover has no notice)
    const b = h.moment({phase: 'resolve', gameAge: 40, attacker: 'blue', targets: ['red', 'green'], at: T0 + 2100}, T0 + 2100);
    expect(b).toEqual([{seat: 'vera', attacker: 'blue', synced: true}]);
    expect(hapticFor(b[0]).pattern).toEqual(HIT_PATTERN);
    expect(h.tick(T0 + HAPTIC_FALLBACK_MS + 10)).toEqual([]);
  });

  it('ignores the same moment twice (two TVs, or one TV re-sending)', () => {
    const h = new HapticRelay();
    h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0, 2);
    const m = {phase: 'resolve' as const, gameAge: 40, attacker: 'blue' as Color, targets: ['red' as Color], at: T0 + 1500};
    expect(h.moment(m, T0 + 1500)).toHaveLength(1);
    expect(h.moment({...m, at: T0 + 1600}, T0 + 1600)).toEqual([]);
    // a second notice for the same hit, after the moment, does not buzz again either
    expect(h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0 + 1700, 2)).toEqual([]);
    expect(h.tick(T0 + 1700 + HAPTIC_FALLBACK_MS)).toEqual([]);
  });

  it('never buzzes a seat that is not among the moment targets', () => {
    const h = new HapticRelay();
    h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0, 1);
    expect(h.moment({phase: 'resolve', gameAge: 40, attacker: 'blue', targets: ['green'], at: T0}, T0 + 800)).toEqual([]);
    // another attacker's moment does not answer Vera's notice either
    expect(h.moment({phase: 'resolve', gameAge: 40, attacker: 'green', targets: ['red'], at: T0}, T0 + 900)).toEqual([]);
    expect(h.waiting()).toEqual(['vera']);
  });

  it('falls back to a plain buzz when no moment arrives within 6 s', () => {
    const h = new HapticRelay();
    h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0, 1);
    expect(h.tick(T0 + HAPTIC_FALLBACK_MS - 1)).toEqual([]);
    const b = h.tick(T0 + HAPTIC_FALLBACK_MS);
    expect(b).toEqual([{seat: 'vera', attacker: 'blue', synced: false}]);
    expect(hapticFor(b[0]).pattern).toEqual(HIT_PATTERN_PLAIN);
    // the moment arriving after the fallback does not buzz a second time
    expect(h.moment({phase: 'resolve', gameAge: 40, attacker: 'blue', targets: ['red'], at: T0}, T0 + HAPTIC_FALLBACK_MS + 100)).toEqual([]);
  });

  it('a moment that comes after its hit fell back is not taken for the next hit (end-to-end finding)', () => {
    const h = new HapticRelay();
    // hit 1 at gameAge 28: no resolve within 6 s, so it buzzes at the fallback
    h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 28}, T0, 1);
    expect(h.tick(T0 + HAPTIC_FALLBACK_MS)).toHaveLength(1);
    // its resolve arrives late, then hit 2 (gameAge 29) is noticed before its own resolve
    expect(h.moment({phase: 'resolve', gameAge: 28, attacker: 'blue', targets: ['red'], at: T0}, T0 + 9200)).toEqual([]);
    expect(h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 29}, T0 + 9500, 1)).toEqual([]);
    // hit 2 buzzes on its own resolve
    expect(h.moment({phase: 'resolve', gameAge: 29, attacker: 'blue', targets: ['red'], at: T0}, T0 + 12800)).toEqual([{seat: 'vera', attacker: 'blue', synced: true}]);
  });

  it('buzzes at notice time when no TV is connected', () => {
    const h = new HapticRelay();
    expect(h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0, 0)).toEqual([{seat: 'vera', attacker: 'blue', synced: false}]);
    expect(h.waiting()).toEqual([]);
  });

  it('buzzes at once when the TV resolved before the notice arrived, within the keep window only', () => {
    const h = new HapticRelay();
    expect(h.moment({phase: 'resolve', gameAge: 41, attacker: 'blue', targets: ['red'], at: T0}, T0)).toEqual([]);
    expect(h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 41}, T0 + 300, 1)).toEqual([{seat: 'vera', attacker: 'blue', synced: true}]);
    const late = new HapticRelay();
    late.moment({phase: 'resolve', gameAge: 41, attacker: 'blue', targets: ['red'], at: T0}, T0);
    expect(late.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 41}, T0 + MOMENT_KEEP_MS + 1, 1)).toEqual([]);
  });

  it('forgets what was waiting after an undo', () => {
    const h = new HapticRelay();
    h.notice({seat: 'vera', color: 'red', attacker: 'blue', age: 40}, T0, 1);
    h.reset();
    expect(h.tick(T0 + HAPTIC_FALLBACK_MS)).toEqual([]);
  });

  it('the desk takes only hit notices, and moments that hurt nobody change nothing', () => {
    const d = new TvLinkDesk();
    const cards: Notice = {...hit('n2', 'blue', 40), kind: 'cards', sticky: false};
    expect(d.hits('vera', 'red', [cards], T0, 0)).toEqual([]);
    expect(d.hits('vera', 'red', [hit('n1', 'blue', 40)], T0, 0)).toEqual([{seat: 'vera', attacker: 'blue', synced: false}]);
    d.hits('ada', 'blue', [hit('n3', 'red', 44)], T0, 1);
    expect(d.moment({type: 'tvMoment', phase: 'resolve', gameAge: 44, attacker: 'red', targets: [], at: T0}, T0 + 100)).toEqual([]);
    expect(d.moment({type: 'tvMoment', phase: 'resolve', gameAge: 44, attacker: 'red', targets: ['blue'], at: T0}, T0 + 200)).toEqual([{seat: 'ada', attacker: 'red', synced: true}]);
  });
});

// ---- what a real log offers the TV ---------------------------------------------------------------------------------
describe('log moves on the TV', () => {
  const es = groupLog((g2 as unknown as Fixture).lines, 'red', 9);
  const g1es = groupLog((g1 as unknown as Fixture).lines, null, 5);
  const moves = (x: LogEntry[]) => x.filter((e): e is Move => e.kind === 'move');
  const find = (x: LogEntry[], h: string) => {
    const m = moves(x).find((e) => plain(headline(e), nm) === h);
    if (!m) throw new Error(`no move "${h}"`);
    return m;
  };

  it('points at the space a tile went on, and the parameter it raised', () => {
    expect(echoTargets(find(es, 'Ada played Immigrant City'))[0]).toEqual({kind: 'space', spaceId: '47'});
    const greenery = moves(es).find((m) => m.how === 'standard' && m.lines.some((l) => /greenery tile/.test(String(l.data[2]?.value))) && m.by === 'green')!;
    const t = echoTargets(greenery);
    expect(t[0]).toEqual({kind: 'space', spaceId: '09'});
    expect(t).toContainEqual({kind: 'global', param: 'oxygen'});
    expect(t).toContainEqual({kind: 'tr', color: 'green'});
  });

  it('points at the temperature for a standard asteroid, and at the victim first for a hit', () => {
    const sp = moves(es).find((m) => m.card === 'Asteroid:SP')!;
    expect(echoTargets(sp)).toContainEqual({kind: 'global', param: 'temperature'});
    const raid = echoTargets(find(es, 'Ada played Hired Raiders'));
    expect(raid[0]).toEqual({kind: 'res', color: 'blue', resource: 'megacredits'});
    expect(raid).toContainEqual({kind: 'res', color: 'red', resource: 'megacredits'});
    expect(echoTargets(find(g1es, 'Ada played Sabotage'))[0]).toEqual({kind: 'res', color: 'blue', resource: 'megacredits'});
  });

  it('gives a replay the card, who it hurt, what the mover gained and the space', () => {
    const r = replayOf(find(es, 'Ada played Hired Raiders'), nm);
    expect(r).toMatchObject({by: 'red', how: 'played', card: 'Hired Raiders', line: 'took 3 M€ from Kepler'});
    expect(r.targets).toEqual([{color: 'blue', losses: [{what: 'stock', resource: 'megacredits', amount: 3}]}]);
    const city = replayOf(find(es, 'Ada played Immigrant City'), nm);
    expect(city.spaceId).toBe('47');
    const hackers = replayOf(find(es, 'Ada played Hackers'), nm);
    expect(hackers.gains).toEqual([{r: 'megacredits', n: 2, prod: true}]);
    expect(hackers.targets?.[0].losses[0]).toMatchObject({what: 'production', resource: 'megacredits', amount: 2});
  });

  it('offers a replay for cards and tile moves, not for milestones, awards or plain conversions', () => {
    const all = moves(es);
    expect(all.filter((m) => m.how === 'milestone' || m.how === 'award').some(replayable)).toBe(false);
    expect(replayable(find(es, 'Ada played Hired Raiders'))).toBe(true);
    // the newest move the TV can show
    const last = lastReplayable(es)!;
    expect(replayable(last)).toBe(true);
    expect(es.slice(es.indexOf(last) + 1).some((e) => e.kind === 'move' && replayable(e))).toBe(false);
  });

  it('reads the engine resource words', () => {
    expect(['M€', 'plant', 'plants', 'Energy', 'steel', 'titanium', 'heat', 'Microbe'].map(resOf)).toEqual(['megacredits', 'plants', 'plants', 'energy', 'steel', 'titanium', 'heat', null]);
  });
});
