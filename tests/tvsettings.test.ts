import {describe, expect, it} from 'vitest';
import {DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings, SETTINGS_KEY, TEXT_SCALE, tvt} from '../src/client/tv/settings';
import {applyLevels, levelsFor, MASTER_GAIN} from '../src/client/tv/sound/synth';

function memoryStore() {
  const m = new Map<string, string>();
  return {getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m};
}

describe('TV settings store', () => {
  it('defaults: full volume, hum on, large text, weather on', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({master: 1, hum: true, humVolume: 1, effects: 1, voice: 1, textSize: 'large', weather: true, board3d: true, trTrack: true, cameraMoves: true, tileStyle: null, boardLife: true, terraformers: true, radio: false, radioVolume: 0.5,
      boardView: false, boardZoom: null, boardTilt: null, fly: false, flyBank: true});
  });

  it('keeps the weather switch, and ignores a malformed one', () => {
    expect(parseSettings(JSON.stringify({weather: false})).weather).toBe(false);
    expect(parseSettings(JSON.stringify({weather: 'no'})).weather).toBe(true);
  });

  it('falls back field by field on malformed or partial data', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({hum: false}))).toEqual({...DEFAULT_SETTINGS, hum: false});
    expect(parseSettings(JSON.stringify({textSize: 'huge', hum: 'no', voice: 'loud'}))).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps volumes to 0..1 and rejects non-numbers', () => {
    const s = parseSettings(JSON.stringify({master: 1.7, humVolume: -0.4, effects: 0.35, voice: Number.NaN}));
    expect(s.master).toBe(1);
    expect(s.humVolume).toBe(0);
    expect(s.effects).toBe(0.35);
    expect(s.voice).toBe(1);
  });

  it('persists and reloads', () => {
    const store = memoryStore();
    saveSettings({...DEFAULT_SETTINGS, hum: false, humVolume: 0.3, textSize: 'xl'}, store);
    expect(JSON.parse(store.m.get(SETTINGS_KEY)!)).toMatchObject({hum: false, humVolume: 0.3, textSize: 'xl'});
    expect(loadSettings(store)).toEqual({...DEFAULT_SETTINGS, hum: false, humVolume: 0.3, textSize: 'xl'});
  });

  it('survives storage that throws', () => {
    const broken = {getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }};
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });

  it('text sizes scale secondary text, never below 1.6% of a 16:9 screen height', () => {
    expect(TEXT_SCALE.normal).toBe(1);
    expect(TEXT_SCALE.large).toBeGreaterThan(1);
    expect(TEXT_SCALE.xl).toBeGreaterThan(TEXT_SCALE.large);
    // 0.9vw on a 16:9 screen is 1.6% of its height
    expect(tvt(0.75)).toBe('calc(0.9vw * var(--tvt, 1))');
    expect(tvt(1.1)).toBe('calc(1.1vw * var(--tvt, 1))');
  });
});

describe('sound buses', () => {
  const on = {master: 1, hum: true, humVolume: 1, effects: 1, voice: 1};

  it('hum off silences only the ambient bus', () => {
    const l = levelsFor({...on, hum: false}, false);
    expect(l.hum).toBe(0);
    expect(l.effects).toBe(1);
    expect(l.voice).toBe(1);
    expect(l.master).toBe(MASTER_GAIN);
  });

  it('each level follows its own option; master carries the overall volume', () => {
    const l = levelsFor({master: 0.5, hum: true, humVolume: 0.4, effects: 0.7, voice: 0.2}, false);
    expect(l).toEqual({master: MASTER_GAIN * 0.5, hum: 0.4, effects: 0.7, voice: 0.2});
  });

  it('mute silences the master but keeps each bus level for when sound returns', () => {
    const l = levelsFor({...on, humVolume: 0.6}, true);
    expect(l.master).toBe(0);
    expect(l.hum).toBe(0.6);
  });

  it('applyLevels moves every bus to its level', () => {
    const node = () => {
      const calls: number[] = [];
      return {gain: {cancelScheduledValues: () => {}, setTargetAtTime: (v: number) => { calls.push(v); }}, calls};
    };
    const b = {ctx: {currentTime: 0}, master: node(), hum: node(), effects: node(), voice: node()};
    applyLevels(b as never, levelsFor({...on, hum: false, effects: 0.5}, false));
    expect(b.hum.calls).toEqual([0]);
    expect(b.effects.calls).toEqual([0.5]);
    expect(b.voice.calls).toEqual([1]);
    expect(b.master.calls).toEqual([MASTER_GAIN]);
  });
});
