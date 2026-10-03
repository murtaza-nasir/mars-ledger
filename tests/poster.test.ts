import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import boards from '../src/shared/data/boards.json';
import type {SpaceModel, SpectatorModel} from '../src/shared/full';
import {companionFacts, fullFacts, hashOf, matchPainting, paintingDistance, terraformProgress, uniquePrompt, wantedAxes} from '../src/shared/poster';
import type {Painting, PosterFacts, PosterStatus} from '../src/shared/poster';
import {headline, posterSvg, subline, wrap} from '../src/server/poster/compose';
import {ForgeClient, txt2imgBody} from '../src/server/poster/forge';
import {PosterDesk} from '../src/server/poster';
import {PosterAssets, findAssetsDir, initRenderer, rasterize} from '../src/server/poster/render';
import {started} from './harness';

const ASSETS = findAssetsDir();
const LIBRARY: Painting[] = JSON.parse(fs.readFileSync(path.join(ASSETS!, 'paintings', 'library.json'), 'utf8'));

function facts(o: Partial<PosterFacts> = {}): PosterFacts {
  return {
    gameId: 'g-test', mode: 'full', board: 'tharsis', endedAt: Date.parse('2026-09-30T20:00:00Z'), generations: 12,
    temperature: 8, oxygen: 14, oceans: 9, greenery: 12, cities: 7, special: 2, terraformed: true, spaces: null,
    players: [
      {name: 'Ana', color: 'red', vp: 70, placement: 1, tr: 40, corporation: 'Ecoline', portrait: 'R17', title: 'Green thumb', detail: '8 greeneries planted'},
      {name: 'Ben', color: 'blue', vp: 64, placement: 2, tr: 38, corporation: 'Helion', portrait: 'R18', title: 'Big spender', detail: '210 M€ spent'},
    ],
    ...o,
  };
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): {w: number; h: number} {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return {w: png.readUInt32BE(16), h: png.readUInt32BE(20)};
}

describe('matching a painting', () => {
  it('reads the finished planet onto the library axes', () => {
    expect(wantedAxes(facts())).toMatchObject({oceans: 'full', greenery: 'lush', cities: 'dense', warmth: 'warm', barren: false});
    expect(wantedAxes(facts({oceans: 5, greenery: 4, cities: 3, temperature: -4}))).toMatchObject({oceans: 'mid', greenery: 'sparse', cities: 'few', warmth: 'cold'});
    expect(wantedAxes(facts({oceans: 2, temperature: -26, oxygen: 1}))).toMatchObject({oceans: 'low', barren: true});
  });

  it('picks the exact painting when one exists, in the view the game id draws', () => {
    const f = facts();
    const p = matchPainting(f, LIBRARY)!;
    expect(p.file).toBe(`full-lush-dense-${wantedAxes(f).view}`);
    const mid = facts({oceans: 6, greenery: 3, cities: 2, temperature: 2, oxygen: 8, terraformed: false});
    expect(matchPainting(mid, LIBRARY)!.file).toBe(`mid-sparse-few-${wantedAxes(mid).view}`);
  });

  it('gives an early or abandoned-looking game a barren painting', () => {
    const early = facts({temperature: -26, oxygen: 1, oceans: 0, greenery: 1, cities: 1, terraformed: false, generations: 3});
    expect(terraformProgress(early)).toBeLessThan(0.3);
    expect(matchPainting(early, LIBRARY)!.barren).toBe(true);
  });

  it('keeps a game on the same view and spreads games across both views', () => {
    const views = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const f = facts({gameId: `game-${i}`});
      expect(matchPainting(f, LIBRARY)!.file).toBe(matchPainting(f, LIBRARY)!.file);
      views.add(matchPainting(f, LIBRARY)!.view);
    }
    expect(views).toEqual(new Set(['orbit', 'surface']));
  });

  it('weighs oceans above greenery above cities', () => {
    const want = wantedAxes(facts());
    const base = {greenery: 'lush', cities: 'dense', warmth: 'warm', view: want.view} as const;
    expect(paintingDistance(want, {...base, oceans: 'mid'})).toBeGreaterThan(paintingDistance(want, {...base, oceans: 'full', greenery: 'sparse'}));
    expect(paintingDistance(want, {...base, oceans: 'full', greenery: 'sparse'})).toBeGreaterThan(paintingDistance(want, {...base, oceans: 'full', cities: 'few'}));
  });

  it('can reach every painting in the library', () => {
    const reached = new Set<string>();
    for (const oceans of [0, 5, 9]) for (const greenery of [2, 12]) for (const cities of [2, 9]) for (let id = 0; id < 8; id++) {
      reached.add(matchPainting(facts({gameId: `r${id}`, oceans, greenery, cities, temperature: oceans ? 8 : -10, oxygen: oceans ? 10 : 6}), LIBRARY)!.file);
    }
    for (let id = 0; id < 40; id++) reached.add(matchPainting(facts({gameId: `b${id}`, oceans: 0, greenery: 0, cities: 0, temperature: -28, oxygen: 0}), LIBRARY)!.file);
    expect([...reached].sort()).toEqual(LIBRARY.map((p) => p.file).sort());
  });

  it('hashes deterministically', () => {
    expect(hashOf('abc')).toBe(hashOf('abc'));
    expect(hashOf('abc')).not.toBe(hashOf('abd'));
  });
});

describe('words on the poster', () => {
  it('announces a winner, a shared win, a draw and a solo game', () => {
    expect(headline(facts())).toBe('Ana wins with 70 points');
    expect(headline(facts({players: facts().players.map((p) => ({...p, vp: 70, placement: 1}))}))).toBe('A draw on 70 points');
    const three = [...facts().players.map((p) => ({...p, vp: 70, placement: 1})), {...facts().players[1], name: 'Cy', color: 'green', vp: 50, placement: 3}];
    expect(headline(facts({players: three}))).toBe('Shared victory for Ana and Ben');
    expect(headline(facts({players: [facts().players[0]]}))).toBe('Ana finished with 70 points');
    expect(subline(facts())).toBe('Mars is terraformed');
    expect(subline(facts({terraformed: false, temperature: -30, oxygen: 0, oceans: 0}))).toBe('Mars is 0% terraformed');
  });

  it('wraps a headline into two even lines, never leaving one word alone', () => {
    expect(wrap('Galileo wins with 55 points', 26, 2)).toEqual(['Galileo wins', 'with 55 points']);
    expect(wrap('A draw on 60 points', 26, 2)).toEqual(['A draw on 60 points']);
    for (const line of wrap('Shared victory for Galileo, Vera, Samantha and Christopher', 26, 2)) expect(line.length).toBeLessThanOrEqual(26);
  });

  it('builds the one-off prompt from the game with the shared recipe prefix', () => {
    const p = uniquePrompt(facts());
    expect(p.startsWith('<lora:anima-turbo-lora-v0.2:0.5>')).toBe(true);
    expect(p).toContain('deep blue seas');
    expect(p).toContain('dense green forests');
    expect(p).toContain('Ecoline');
    expect(p).toContain('no text');
    expect(uniquePrompt(facts({temperature: -28, oxygen: 0, oceans: 0}))).toContain('frozen dust plains');
  });
});

describe('facts from finished games', () => {
  it('companion: scores, placements and counts from our engine', () => {
    const h = started('Ecoline', 'Helion');
    h.p('a').tiles.greenery = 5; h.p('b').tiles.cityOnMars = 3;
    h.s.global = {temperature: 2, oxygen: 9, oceans: 6, venus: 0};
    h.do({t: 'endGame', playerId: 'a'});
    const f = companionFacts(h.s, null);
    expect(f.mode).toBe('companion');
    expect(f.spaces).toBeNull();
    expect(f).toMatchObject({greenery: 5, cities: 3, oceans: 6, temperature: 2, oxygen: 9, terraformed: false});
    expect(f.players.map((p) => p.corporation).sort()).toEqual(['Ecoline', 'Helion']);
    expect(f.players.find((p) => p.corporation === 'Ecoline')!.portrait).toBe('R17');
    expect(f.players[0].placement).toBe(1);
  });

  it('full: the engine board, tile counts and lobby names', () => {
    const spec = JSON.parse(fs.readFileSync('tests/fixtures/full/spectator.json', 'utf8')) as SpectatorModel;
    const state = started().s;
    state.mode = 'full';
    state.full = {gameId: 'eng1', spectatorId: 's', players: {a: {engineId: 'x', color: spec.players[0].color}}};
    const f = fullFacts(state, spec, null);
    expect(f.gameId).toBe('eng1');
    expect(f.spaces?.length).toBe(spec.game.spaces.length);
    expect(f.oceans).toBe(spec.game.oceans);
    expect(f.players.some((p) => p.name === 'Ana')).toBe(true);
    expect(f.greenery).toBe(spec.game.spaces.filter((s) => s.tileType === 0).length);
  });
});

describe('composition', () => {
  let assets: PosterAssets;
  beforeAll(async () => { assets = new PosterAssets(ASSETS!); await initRenderer(ASSETS); });

  const spaces = (boards as unknown as Record<string, SpaceModel[]>).hellas.map((s, i) => ({...s, tileType: s.spaceType === 'ocean' ? 1 : i % 5 === 0 ? 0 : undefined, color: i % 5 === 0 ? 'red' as const : undefined}));

  it('renders landscape and portrait PNGs at their sizes, with text drawn on top of the art', async () => {
    const f = facts({spaces});
    const art = {painting: assets.painting(matchPainting(f, assets.library)!.file), portraits: new Map([['R17', assets.portrait('R17')!]])};
    for (const [o, w, h] of [['landscape', 1920, 1080], ['portrait', 1080, 1920]] as const) {
      const svg = posterSvg(f, art, o);
      expect(svg).toContain('Ana');
      expect(svg).toContain('Mars Ledger');
      const png = await rasterize(svg, assets.fonts);
      expect(pngSize(png)).toEqual({w, h});
      expect(png.length).toBeGreaterThan(200_000);
      // The text layer really draws: the same poster without its text renders differently.
      const bare = await rasterize(svg.replace(/<text[\s\S]*?<\/text>/g, ''), assets.fonts);
      expect(bare.equals(png)).toBe(false);
    }
  });

  it('draws a companion poster without a board, and a poster without a painting', async () => {
    const png = await rasterize(posterSvg(facts({mode: 'companion'}), {painting: null, portraits: new Map()}, 'portrait'), assets.fonts);
    expect(pngSize(png)).toEqual({w: 1080, h: 1920});
    const thumb = await rasterize(posterSvg(facts(), {painting: null, portraits: new Map()}, 'landscape'), assets.fonts, 480);
    expect(pngSize(thumb)).toEqual({w: 480, h: 270});
  });

  it('escapes names so markup in a name cannot break the poster', () => {
    const svg = posterSvg(facts({players: [{...facts().players[0], name: '<b>&"x'}]}), {painting: null, portraits: new Map()}, 'landscape');
    expect(svg).toContain('&lt;b&gt;&amp;&quot;x');
    expect(svg).not.toContain('<b>');
  });
});

// ---- the Forge client and the desk --------------------------------------------------------------
type Call = {url: string; body?: Record<string, unknown>};
function fakeForge(opts: {busy?: boolean; down?: boolean; hang?: boolean; png?: Buffer} = {}) {
  const calls: Call[] = [];
  const png = opts.png ?? fs.readFileSync(path.join(ASSETS!, 'portraits', 'R17.jpg'));
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({url, body: init?.body ? JSON.parse(String(init.body)) : undefined});
    if (opts.down) throw new TypeError('fetch failed');
    if (url.includes('/sdapi/v1/progress')) {
      return new Response(JSON.stringify({progress: opts.busy ? 0.4 : 0, state: {job_count: opts.busy ? 1 : 0, job: opts.busy ? 'x' : ''}}));
    }
    if (opts.hang) {
      await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), {name: 'TimeoutError'}))));
    }
    return new Response(JSON.stringify({images: [png.toString('base64')]}));
  }) as unknown as typeof fetch;
  return {calls, impl};
}

describe('the shared image server', () => {
  const cfg = {url: 'http://forge.test', timeoutMs: 300, idleTimeoutMs: 200};

  it('never sends override_settings or a checkpoint, and uses the documented recipe', async () => {
    const f = fakeForge();
    const r = await new ForgeClient(cfg, f.impl).paint('a prompt', 7);
    expect(r.ok).toBe(true);
    const post = f.calls.find((c) => c.url.endsWith('/sdapi/v1/txt2img'))!;
    expect(post.body).toBeDefined();
    const text = JSON.stringify(post.body);
    expect(text).not.toContain('override_settings');
    expect(text).not.toContain('sd_model_checkpoint');
    expect(post.body).toMatchObject({steps: 30, cfg_scale: 2.5, distilled_cfg_scale: 7, sampler_name: 'ER SDE', scheduler: 'simple', seed: 7, prompt: 'a prompt'});
    expect(Object.keys(txt2imgBody('p', 1))).not.toContain('override_settings');
    expect(f.calls.some((c) => c.url.includes('/sdapi/v1/options'))).toBe(false);
  });

  it('skips when busy, unreachable or slow', async () => {
    const busy = fakeForge({busy: true});
    expect(await new ForgeClient(cfg, busy.impl).paint('p', 1)).toMatchObject({ok: false, reason: 'busy'});
    expect(busy.calls.some((c) => c.url.endsWith('/txt2img'))).toBe(false);
    expect(await new ForgeClient(cfg, fakeForge({down: true}).impl).paint('p', 1)).toMatchObject({ok: false, reason: 'unreachable'});
    expect(await new ForgeClient(cfg, fakeForge({hang: true}).impl).paint('p', 1)).toMatchObject({ok: false, reason: 'timeout'});
  });
});

describe('the poster desk', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posters-')); });
  afterAll(() => { fs.rmSync(dir, {recursive: true, force: true}); });

  function desk(forge: ForgeClient | null, seen: PosterStatus[] = []) {
    return new PosterDesk({dataDir: dir, forge, onStatus: (s) => seen.push({...s}), log: () => {}});
  }

  it('renders in the background, caches, and re-renders only when the facts change', async () => {
    const seen: PosterStatus[] = [];
    const d = desk(null, seen);
    const f = facts({gameId: 'cache1'});
    d.submit(f, false);
    expect(d.status('cache1')!.library).toBe('pending'); // returns at once; the work is queued
    await d.idle();
    const ready = d.status('cache1')!;
    expect(ready).toMatchObject({library: 'ready', unique: 'off'});
    for (const o of ['landscape', 'portrait'] as const) expect(pngSize(fs.readFileSync(d.file('cache1', 'library', o)!))).toEqual(o === 'landscape' ? {w: 1920, h: 1080} : {w: 1080, h: 1920});
    expect(pngSize(fs.readFileSync(d.file('cache1', 'library', 'landscape', true)!))).toEqual({w: 480, h: 270});
    const mtime = fs.statSync(d.file('cache1', 'library', 'landscape')!).mtimeMs;
    const count = seen.length;

    d.submit(f, false); // identical: nothing happens
    await d.idle();
    expect(seen.length).toBe(count);
    expect(fs.statSync(d.file('cache1', 'library', 'landscape')!).mtimeMs).toBe(mtime);

    d.submit({...f, players: f.players.map((p, i) => (i === 1 ? {...p, vp: 66} : p))}, false); // corrected score
    await d.idle();
    expect(d.status('cache1')!.version).toBeGreaterThan(ready.version);

    // After a restart the desk finds the finished poster on disk.
    expect(desk(null).status('cache1')).toMatchObject({library: 'ready'});
    expect(d.file('../etc', 'library', 'landscape')).toBeNull();
  });

  it('adds the one-off variant when the table asked for it, and skips it quietly when the server is busy', async () => {
    const ok = desk(new ForgeClient({url: 'http://forge.test', timeoutMs: 2000, idleTimeoutMs: 200}, fakeForge().impl));
    ok.submit(facts({gameId: 'uniq1'}), true);
    await ok.idle();
    expect(ok.status('uniq1')).toMatchObject({library: 'ready', unique: 'ready'});
    expect(ok.file('uniq1', 'unique', 'portrait')).not.toBeNull();

    const busy = desk(new ForgeClient({url: 'http://forge.test', timeoutMs: 2000, idleTimeoutMs: 200}, fakeForge({busy: true}).impl));
    busy.submit(facts({gameId: 'uniq2'}), true);
    await busy.idle();
    expect(busy.status('uniq2')).toMatchObject({library: 'ready', unique: 'skipped'});
    expect(busy.file('uniq2', 'unique', 'landscape')).toBeNull();
  });

  it('paints the one-off afterwards when the table turns it on after the game', async () => {
    const d = desk(new ForgeClient({url: 'http://forge.test', timeoutMs: 2000, idleTimeoutMs: 200}, fakeForge().impl));
    d.submit(facts({gameId: 'late1'}), false);
    await d.idle();
    expect(d.status('late1')!.unique).toBe('off');
    d.setUnique('late1', true);
    expect(d.status('late1')!.unique).toBe('pending');
    await d.idle();
    expect(d.status('late1')).toMatchObject({library: 'ready', unique: 'ready'});
  });

  it('falls back to the styled card state instead of throwing when there are no assets', async () => {
    const d = new PosterDesk({dataDir: dir, forge: null, onStatus: () => {}, assetsDir: null, log: () => {}});
    d.submit(facts({gameId: 'noassets'}), false);
    await d.idle();
    expect(d.status('noassets')!.library).toBe('failed');
  });
});
