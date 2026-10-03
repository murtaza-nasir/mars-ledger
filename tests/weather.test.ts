import {describe, expect, it} from 'vitest';
import {companionGenProgress, fullGenProgress, LOG_LINES_PER_PLAYER, mistAllowed, MOVES_PER_PLAYER, NO_LIGHT, skyLight, stormMode} from '../src/client/tv/weather/sky';

const full = (o: {phase?: string; gameAge?: number; passed?: number; n?: number; active?: boolean}) => ({
  game: {generation: 3, gameAge: o.gameAge ?? 100, phase: o.phase ?? 'action', passedPlayers: Array.from({length: o.passed ?? 0}, (_, i) => `c${i}`)},
  players: Array.from({length: o.n ?? 2}, (_, i) => ({isActive: o.active === undefined ? i === 0 : o.active && i === 0})),
});

describe('sky light', () => {
  it('runs dusk → night → dawn', () => {
    const a = skyLight(0), m = skyLight(0.5), z = skyLight(1);
    expect(a.dusk).toBeCloseTo(1); expect(a.night).toBeCloseTo(0); expect(a.dawn).toBeCloseTo(0);
    expect(m.night).toBeCloseTo(1); expect(m.dusk).toBeLessThan(0.15); expect(m.dawn).toBeLessThan(0.15);
    expect(z.dawn).toBeCloseTo(1); expect(z.night).toBeCloseTo(0, 5); expect(z.dusk).toBeCloseTo(0);
  });
  it('clamps out-of-range progress', () => {
    expect(skyLight(-1)).toEqual(skyLight(0));
    expect(skyLight(2)).toEqual(skyLight(1));
  });
  it('off is no light at all', () => expect(NO_LIGHT).toEqual({dusk: 0, night: 0, dawn: 0}));
});

describe('full game progress', () => {
  it('is dusk before the action phase and dawn after it', () => {
    expect(fullGenProgress(full({phase: 'drafting', active: false}), null)).toBe(0);
    expect(fullGenProgress(full({phase: 'research', active: false}), null)).toBe(0);
    expect(fullGenProgress(full({phase: 'preludes', active: false}), null)).toBe(0);
    expect(fullGenProgress(full({phase: 'production'}), 50)).toBe(1);
    expect(fullGenProgress(full({phase: 'end'}), 50)).toBe(1);
  });
  it('treats generation 1 "research" with an active player as the action phase', () => {
    const start = 100;
    expect(fullGenProgress(full({phase: 'research', active: true, gameAge: start + LOG_LINES_PER_PLAYER}), start)).toBeGreaterThan(0.3);
  });
  it('advances with the engine log and caps before dawn until everyone passes', () => {
    const start = 100, n = 2;
    expect(fullGenProgress(full({gameAge: start}), start)).toBe(0);
    expect(fullGenProgress(full({gameAge: start + n * LOG_LINES_PER_PLAYER / 2}), start)).toBeCloseTo(0.425);
    expect(fullGenProgress(full({gameAge: start + 10 * n * LOG_LINES_PER_PLAYER}), start)).toBeCloseTo(0.85);
    expect(fullGenProgress(full({gameAge: start + 10 * n * LOG_LINES_PER_PLAYER, passed: 2}), start)).toBe(1);
  });
  it('follows the passes when it does not know where the generation started', () => {
    expect(fullGenProgress(full({gameAge: 999}), null)).toBe(0);
    expect(fullGenProgress(full({gameAge: 999, passed: 1, n: 2}), null)).toBe(0.5);
    expect(fullGenProgress(full({gameAge: 999, passed: 2, n: 3}), null)).toBeCloseTo(2 / 3);
  });
});

type T = {command: {t: string}; events: Array<{kind: string}>};
const tick = (t: string, events: string[] = []): T => ({command: {t}, events: events.map((kind) => ({kind}))});
const comp = (phase: string, passed: boolean[]) => ({phase, generation: 2, players: passed.map((p) => ({passed: p}))}) as never;

describe('companion progress', () => {
  it('is dusk outside the action phase and dawn at production', () => {
    expect(companionGenProgress(comp('research', [false, false]), [])).toBe(0);
    expect(companionGenProgress(comp('setup', [false, false]), [])).toBe(0);
    expect(companionGenProgress(comp('production', [false, false]), [])).toBe(1);
  });
  it('counts moves since the newest generation boundary', () => {
    const recent = [tick('playCard'), tick('playCard'), tick('research', ['generation']), tick('playCard'), tick('standardProject'), tick('adjust')];
    // 2 turn moves after the boundary; adjust is not a move
    expect(companionGenProgress(comp('action', [false, false]), recent as never)).toBeCloseTo(0.85 * 2 / (2 * MOVES_PER_PLAYER));
  });
  it('generation 1 counts from the start of the game', () => {
    const recent = [tick('start', ['started']), tick('chooseCorp'), tick('playCard'), tick('pass')];
    expect(companionGenProgress(comp('action', [true, false]), recent as never)).toBe(0.5);
  });
  it('dawn when everyone has passed', () => {
    expect(companionGenProgress(comp('action', [true, true]), [])).toBe(1);
  });
});

describe('when weather plays', () => {
  it('a storm needs weather on and an uncovered board; reduced motion gets a still haze', () => {
    expect(stormMode({enabled: true, reduced: false, covered: false})).toBe('storm');
    expect(stormMode({enabled: true, reduced: true, covered: false})).toBe('haze');
    expect(stormMode({enabled: false, reduced: false, covered: false})).toBe('off');
    expect(stormMode({enabled: true, reduced: false, covered: true})).toBe('off');
  });
  it('mist only after an ocean once oxygen reaches 9%, never under reduced motion', () => {
    const ok = {enabled: true, reduced: false, covered: false};
    expect(mistAllowed(ok, 9)).toBe(true);
    expect(mistAllowed(ok, 8)).toBe(false);
    expect(mistAllowed({...ok, reduced: true}, 12)).toBe(false);
    expect(mistAllowed({...ok, enabled: false}, 12)).toBe(false);
    expect(mistAllowed({...ok, covered: true}, 12)).toBe(false);
  });
});
