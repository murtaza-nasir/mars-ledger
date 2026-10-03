import {describe, expect, it} from 'vitest';
import {isSwitchAction, trackInfo, thumbnailUrl, RADIO_PLAYER_LIMIT} from '../src/shared/radio';
import {DuckDesk, DUCK_DEPTH, errorKind, errorText, gameKeyOf, glide, parseResume, playerVolume, radioStage, SkipGuard, StageLatch, startPoint} from '../src/client/tv/radio/logic';
import {radioMix} from '../src/client/tv/radio/mix';
import {RadioDesk} from '../src/server/radio';
import {DEFAULT_SETTINGS, parseSettings} from '../src/client/tv/settings';
import type {GameState} from '../src/shared/game';
import type {SpectatorModel} from '../src/shared/full';

// ---- fixtures ------------------------------------------------------------------------------------
const player = (o: Record<string, unknown> = {}) => ({actionsTakenThisRound: 0, actionsThisGeneration: [], ...o});
function full(game: Record<string, unknown>, players = [player(), player()]): [GameState, SpectatorModel] {
  const state = {id: 'g1', phase: 'full', mode: 'full', full: {gameId: 'eng-1'}, players: []} as unknown as GameState;
  const model = {id: 's', color: 'neutral', game: {generation: 1, phase: 'research', passedPlayers: [], ...game}, players} as unknown as SpectatorModel;
  return [state, model];
}
function companion(o: Record<string, unknown>, players: Array<Record<string, unknown>> = [{}]): GameState {
  return {id: 'c1', mode: 'companion', generation: 1, phase: 'action',
    players: players.map((p) => ({turnActions: 0, passed: false, usedActions: [], ...p})), ...o} as unknown as GameState;
}

describe('radio: track info from YouTube', () => {
  it('splits a "From … Original Game Soundtrack" title and the Topic channel', () => {
    expect(trackInfo('Alpha Centauri (From Stellaris Original Game Soundtrack)', 'Andreas Waldetoft - Topic'))
      .toEqual({title: 'Alpha Centauri', artist: 'Andreas Waldetoft', game: 'Stellaris'});
    expect(trackInfo('Main Theme (From "Surviving Mars")', 'Someone')).toEqual({title: 'Main Theme', artist: 'Someone', game: 'Surviving Mars'});
    expect(trackInfo('Mars Theme [Frostpunk OST]', 'X')).toEqual({title: 'Mars Theme', artist: 'X', game: 'Frostpunk'});
    expect(trackInfo('Anno 2205 Soundtrack - Moon Base', 'Y')).toEqual({title: 'Moon Base', artist: 'Y', game: 'Anno 2205'});
  });
  it('names the game from the playlist composers when the title does not', () => {
    expect(trackInfo('CO2', 'George Strezov - Topic')).toEqual({title: 'CO2', artist: 'George Strezov', game: 'Surviving Mars'});
    expect(trackInfo('Trade War', 'Christopher Tin - Topic').game).toBe('Offworld Trading Company');
    expect(trackInfo('Some Song', 'Unknown Band').game).toBeNull();
  });
  it('never returns an empty title', () => {
    expect(trackInfo('', '').title).toBe('Unknown track');
  });
  it('builds the thumbnail URL on YouTube\'s image server', () => {
    expect(thumbnailUrl('y2cU2CpEjpY')).toBe('https://i.ytimg.com/vi/y2cU2CpEjpY/hqdefault.jpg');
    expect(thumbnailUrl('y2cU2CpEjpY', 'mq')).toBe('https://i.ytimg.com/vi/y2cU2CpEjpY/mqdefault.jpg');
  });
});

describe('radio: when it plays', () => {
  it('full game: waits through setup, plays from the first move, stops at the end', () => {
    expect(radioStage(null, null)).toBe('none');
    expect(radioStage({phase: 'lobby'} as GameState, null)).toBe('none');
    expect(radioStage(...full({}))).toBe('before');
    // generation 1 can still report "research" while the first player acts
    expect(radioStage(...full({}, [player({actionsTakenThisRound: 1}), player()]))).toBe('playing');
    expect(radioStage(...full({phase: 'action'}, [player({actionsThisGeneration: ['Birds']}), player()]))).toBe('playing');
    expect(radioStage(...full({passedPlayers: ['red']}))).toBe('playing');
    expect(radioStage(...full({generation: 2}))).toBe('playing');
    expect(radioStage(...full({generation: 9, phase: 'end'}))).toBe('over');
    expect(radioStage(full({})[0], null)).toBe('before');
  });
  it('companion: the first move of the action phase, the end', () => {
    expect(radioStage(companion({phase: 'setup'}), null)).toBe('before');
    expect(radioStage(companion({phase: 'action'}), null)).toBe('before');
    expect(radioStage(companion({phase: 'action'}, [{turnActions: 1}]), null)).toBe('playing');
    expect(radioStage(companion({phase: 'action'}, [{passed: true}]), null)).toBe('playing');
    expect(radioStage(companion({phase: 'research', generation: 2}), null)).toBe('playing');
    expect(radioStage(companion({phase: 'ended', generation: 8}), null)).toBe('over');
  });
  it('stays under way between turns, until the next game; a saved position counts as under way', () => {
    const l = new StageLatch();
    expect(l.observe('g1', 'before')).toBe('before');
    expect(l.observe('g1', 'playing')).toBe('playing');
    expect(l.observe('g1', 'before')).toBe('playing');
    expect(l.observe('g1', 'over')).toBe('over');
    expect(l.observe('g2', 'before')).toBe('before');
    expect(new StageLatch().observe('g3', 'before', 'g3')).toBe('playing');
    expect(new StageLatch().observe('g3', 'before', 'other')).toBe('before');
  });
  it('keys the position by the engine game in full mode', () => {
    expect(gameKeyOf(full({})[0])).toBe('eng-1');
    expect(gameKeyOf(companion({}))).toBe('c1');
    expect(gameKeyOf({phase: 'lobby', id: 'x'} as GameState)).toBeNull();
  });
});

describe('radio: loudness and ducking', () => {
  it('scales by its own slider, the master volume and the duck; silent when muted', () => {
    expect(playerVolume({radioVolume: 0.5, master: 1, muted: false}, 1)).toBe(50);
    expect(playerVolume({radioVolume: 0.5, master: 0.5, muted: false}, 1)).toBe(25);
    expect(playerVolume({radioVolume: 0.5, master: 1, muted: false}, DUCK_DEPTH.voice)).toBe(11);
    expect(playerVolume({radioVolume: 1, master: 1, muted: true}, 1)).toBe(0);
    expect(playerVolume({radioVolume: 2, master: Number.NaN, muted: false}, 1)).toBe(0);
  });
  it('glides down fast and back up slowly', () => {
    expect(glide(1, 0.22, 175)).toBeCloseTo(0.5, 5); // 0.35 s for the whole range
    expect(glide(1, 0.22, 1000)).toBe(0.22);
    expect(glide(0.22, 1, 800)).toBeCloseTo(0.72, 5); // 1.6 s for the whole range
    expect(glide(0.5, 0.5, 100)).toBe(0.5);
  });
  it('holds: the deepest live one wins; timed holds expire, open ones wait for release', () => {
    const d = new DuckDesk();
    expect(d.level(0)).toBe(1);
    d.duck('voice', 0.22, 3000, 0);
    d.hold('cinema', 0.4);
    expect(d.level(100)).toBe(0.22);
    expect(d.level(3100)).toBe(0.4);
    d.release('cinema');
    expect(d.level(3200)).toBe(1);
    d.duck('cue', 0.5, 0, 0);
    expect(d.active).toEqual([]);
  });
  it('the mix API: ducks reach the radio and the hum steps aside only while music plays', () => {
    radioMix.duck('voice', DUCK_DEPTH.voice, 60_000);
    expect(radioMix.level()).toBe(DUCK_DEPTH.voice);
    radioMix.duck('voice', 0, 0);
    expect(radioMix.level()).toBe(1);
    const s = {...DEFAULT_SETTINGS, hum: true};
    let heard = 0;
    const off = radioMix.subscribe(() => heard++);
    expect(radioMix.gate(s).hum).toBe(true);
    radioMix.setPlaying(true);
    expect(radioMix.gate(s).hum).toBe(false);
    expect(radioMix.gate(s).humVolume).toBe(s.humVolume);
    radioMix.setPlaying(true);
    radioMix.setPlaying(false);
    expect(radioMix.gate(s).hum).toBe(true);
    expect(heard).toBe(2);
    off();
  });
});

describe('radio: resume, errors, settings', () => {
  it('resumes a reload where it was, a little before, and only in the same game', () => {
    const saved = parseResume(JSON.stringify({game: 'g1', index: 4, seconds: 61.7, videoId: 'abc'}));
    expect(saved).toEqual({game: 'g1', index: 4, seconds: 61.7, videoId: 'abc'});
    expect(startPoint(saved, 'g1')).toEqual({index: 4, seconds: 59});
    expect(startPoint(saved, 'g2')).toEqual({index: 0, seconds: 0});
    expect(startPoint(null, 'g1')).toEqual({index: 0, seconds: 0});
    expect(parseResume('nope')).toBeNull();
    expect(parseResume(JSON.stringify({game: 'g', index: -2, seconds: 'x'}))).toEqual({game: 'g', index: 0, seconds: 0, videoId: null});
  });
  it('skips unplayable tracks, gives up after a run of them, and a played track resets the run', () => {
    expect(errorKind(150)).toBe('skip');
    expect(errorKind(101)).toBe('skip');
    expect(errorKind(100)).toBe('skip');
    expect(errorKind(5)).toBe('skip');
    expect(errorKind(2)).toBe('fatal');
    expect(errorText(150)).toBe('embedding disabled');
    expect(errorText(100)).toBe('removed or private');
    const g = new SkipGuard(3);
    expect(g.skip(98)).toBe('next');
    expect(g.skip(98)).toBe('next');
    g.played();
    expect(g.skip(98)).toBe('next');
    expect(g.skip(98)).toBe('next');
    expect(g.skip(98)).toBe('give-up');
    // a two-track playlist gives up after two
    const h = new SkipGuard(6);
    expect(h.skip(2)).toBe('next');
    expect(h.skip(2)).toBe('give-up');
  });
  it('TV settings: radio off by default, volume clamped, kept per screen', () => {
    expect(DEFAULT_SETTINGS.radio).toBe(false);
    expect(DEFAULT_SETTINGS.radioVolume).toBe(0.5);
    expect(parseSettings(JSON.stringify({radio: true, radioVolume: 0.8}))).toMatchObject({radio: true, radioVolume: 0.8});
    expect(parseSettings(JSON.stringify({radio: 'yes', radioVolume: 3}))).toMatchObject({radio: false, radioVolume: 1});
  });
});

describe('radio: the server relay', () => {
  const state = {phase: 'action', players: [{id: 'p0', name: 'Ada'}, {id: 'p1', name: 'Vera'}, {id: 'p2', name: 'Nova'}]} as unknown as GameState;
  const on = {enabled: true, on: true, playing: true, videoId: 'abc', index: 0, title: 'T', artist: 'A', game: null};

  it('refuses presses while no TV radio is on, from strangers, and as someone else', () => {
    const d = new RadioDesk();
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'next'}, 0)).toMatchObject({ok: false, error: 'The radio is off on the TV'});
    d.report(on, 'tv');
    expect(d.judge(state, 'x', {playerId: 'x', action: 'next'}, 0).ok).toBe(false);
    expect(d.judge(state, 'p1', {playerId: 'p0', action: 'next'}, 0).ok).toBe(false);
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'louder'}, 0).ok).toBe(false);
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'next'}, 0)).toEqual({ok: true, action: 'next', from: 'Ada'});
  });
  it('rate-limits each phone and the table', () => {
    const d = new RadioDesk();
    d.report(on, 'tv');
    for (let i = 0; i < RADIO_PLAYER_LIMIT; i++) expect(d.judge(state, 'p0', {playerId: 'p0', action: 'toggle'}, i * 10).ok).toBe(true);
    const r = d.judge(state, 'p0', {playerId: 'p0', action: 'toggle'}, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/try again in 10 s/);
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'toggle'}, 10_100).ok).toBe(true);
    // the table: ten presses in ten seconds between everyone
    const t = new RadioDesk();
    t.report(on, 'tv');
    let ok = 0;
    for (let i = 0; i < 15; i++) if (t.judge(state, `p${i % 3}`, {playerId: `p${i % 3}`, action: 'next'}, i).ok) ok++;
    expect(ok).toBe(10);
  });
  it('keeps the playing TV\'s report; forgets it when that TV leaves', () => {
    const d = new RadioDesk();
    expect(d.report(on, 'tv1')).toBe(true);
    expect(d.report(on, 'tv1')).toBe(false);
    expect(d.report(null, 'tv2')).toBe(false); // another TV with its radio off
    expect(d.now?.on).toBe(true);
    expect(d.gone('tv2')).toBe(false);
    expect(d.gone('tv1')).toBe(true);
    expect(d.now).toBeNull();
    expect(d.report({...on, title: 'x'.repeat(500), index: -3}, 'tv1')).toBe(true);
    expect(d.now?.title.length).toBe(160);
    expect(d.now?.index).toBe(0);
  });
  it('the Radio switch: works while the radio is off, needs a TV, shares the rate limits', () => {
    expect(isSwitchAction('on')).toBe(true);
    expect(isSwitchAction('off')).toBe(true);
    expect(isSwitchAction('next')).toBe(false);
    const d = new RadioDesk();
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'on'}, 0, 1)).toEqual({ok: true, action: 'on', from: 'Ada'});
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'on'}, 10, 0)).toMatchObject({ok: false, error: 'No TV is connected'});
    expect(d.judge(state, 'p1', {playerId: 'p0', action: 'off'}, 10, 1).ok).toBe(false);
    // the transport still needs a radio that is on
    expect(d.judge(state, 'p0', {playerId: 'p0', action: 'next'}, 20, 1)).toMatchObject({ok: false, error: 'The radio is off on the TV'});
    for (let i = 1; i < RADIO_PLAYER_LIMIT; i++) expect(d.judge(state, 'p0', {playerId: 'p0', action: i % 2 ? 'off' : 'on'}, 100 + i, 1).ok).toBe(true);
    const r = d.judge(state, 'p0', {playerId: 'p0', action: 'off'}, 200, 1);
    expect(r).toMatchObject({ok: false});
    if (!r.ok) expect(r.error).toMatch(/Easy on the radio/);
  });
  it('a TV whose switch is on but whose music waits reports enabled; a TV that is off does not hide it', () => {
    const d = new RadioDesk();
    const waiting = {enabled: true, on: false, playing: false, videoId: null, index: 0, title: '', artist: '', game: null};
    expect(d.report(waiting, 'tv1')).toBe(true);
    expect(d.now).toMatchObject({enabled: true, on: false});
    expect(d.report(null, 'tv2')).toBe(false);
    expect(d.report(null, 'tv1')).toBe(true);
    expect(d.now).toBeNull();
    // an older TV build without `enabled`: on implies enabled
    d.report({on: true, playing: true, videoId: 'a', index: 0, title: 't', artist: 'a', game: null}, 'tv1');
    expect(d.now?.enabled).toBe(true);
  });
  it('log lines are cleaned and rate-limited', () => {
    const d = new RadioDesk();
    expect(d.logLine('skipped track 2\n(abc)', 0)).toBe('radio: skipped track 2 (abc)');
    expect(d.logLine(42, 0)).toBeNull();
    let n = 1;
    for (let i = 0; i < 40; i++) if (d.logLine('x', i)) n++;
    expect(n).toBe(20);
    expect(d.logLine('later', 61_000)).not.toBeNull();
  });
});
