// Board life: empty-hex pathing, the scheduler and its cooldowns, event to reaction mapping, and the settings.
import {describe, expect, it} from 'vitest';
import boards from '../src/shared/data/boards.json';
import type {SpaceModel, SpectatorModel} from '../src/shared/full';
import {TILE} from '../src/shared/full';
import {board3d} from '../src/client/tv/full/board3d/geometry3d';
import {blockedFrom, buildGrid, candidateSites, freeMask, isFree, nearestFree, path as hexPath, pickSite, reach} from '../src/client/tv/full/board3d/life/hexgrid';
import {LIFE, LifeScheduler} from '../src/client/tv/full/board3d/life/scheduler';
import {idleReaction, PER_UPDATE, ReactionQueue, reactionsFor} from '../src/client/tv/full/board3d/life/reactions';
import {BIG_MC, deriveLifeEvents} from '../src/client/tv/full/board3d/life/events';
import {DEFAULT_SETTINGS, parseSettings} from '../src/client/tv/settings';

const DATA = boards as unknown as Record<string, SpaceModel[]>;
const spaces = DATA.tharsis.map((s) => ({...s}));
const geo = board3d(spaces);
const mk = (over: Record<string, Partial<SpaceModel>> = {}) => buildGrid(geo.cells.map((c) => ({id: c.id, x: c.x, z: c.z, space: {...c.space, ...(over[c.id] ?? {})}})));
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

describe('hex grid', () => {
  const g = mk();
  it('finds six neighbours inside the map and fewer on the rim', () => {
    expect(g.cells).toHaveLength(61);
    expect(Math.max(...g.nbr.map((n) => n.length))).toBe(6);
    expect(Math.min(...g.nbr.map((n) => n.length))).toBe(3);
    for (let i = 0; i < g.nbr.length; i++) for (const j of g.nbr[i]) expect(g.nbr[j]).toContain(i);
  });

  it('only stands on empty land nobody is about to use', () => {
    const land = g.cells.findIndex((c) => c.space.spaceType === 'land');
    const id = g.cells[land].id;
    expect(isFree(g.cells[land], new Set())).toBe(true);
    expect(isFree(g.cells[land], new Set([id]))).toBe(false);
    const occ = mk({[id]: {tileType: TILE.GREENERY}});
    expect(isFree(occ.cells[land], new Set())).toBe(false);
    const ocean = g.cells.find((c) => c.space.spaceType === 'ocean')!;
    expect(isFree(ocean, new Set())).toBe(false);
  });

  it('paths never cross an occupied hex and stay inside the free set', () => {
    const land = g.cells.map((c, i) => (c.space.spaceType === 'land' ? i : -1)).filter((i) => i >= 0);
    // wall off a hex in the middle of a free path and check the path goes around or fails
    const free0 = freeMask(g, new Set());
    const from = land[0], to = land.find((i) => i !== from && hexPath(g, from, i, free0, 8) && hexPath(g, from, i, free0, 8)!.length >= 4)!;
    const p = hexPath(g, from, to, free0, 12)!;
    expect(p[0]).toBe(from); expect(p[p.length - 1]).toBe(to);
    for (let k = 1; k < p.length; k++) expect(g.nbr[p[k - 1]]).toContain(p[k]);
    const blocked = new Set([g.cells[p[1]].id]);
    const free1 = freeMask(g, blocked);
    const q = hexPath(g, from, to, free1, 14);
    if (q) { expect(q).not.toContain(p[1]); for (const h of q) expect(free1[h]).toBe(true); }
    expect(hexPath(g, from, p[1], free1)).toBeNull();
  });

  it('reach and nearestFree respect occupancy', () => {
    const free = freeMask(g, new Set());
    const i = free.findIndex(Boolean);
    const r = reach(g, i, free, 2);
    for (const [h, d] of r) { expect(free[h]).toBe(true); expect(d).toBeLessThanOrEqual(2); }
    const id = g.cells[i].id;
    const occ = mk({[id]: {tileType: TILE.CITY}});
    const near = nearestFree(occ, id, freeMask(occ, new Set()));
    expect(near).not.toBeNull();
    expect(near).not.toBe(i);
  });

  it('wants ocean or city neighbours, avoids bonus hexes and ones behind a tall tile', () => {
    const oceanId = g.cells.find((c) => c.space.spaceType === 'land' && g.nbr[g.byId.get(c.id)!].length === 6)!.id;
    const occ = mk({[oceanId]: {tileType: TILE.OCEAN}});
    const free = freeMask(occ, new Set());
    const sites = candidateSites(occ, free, {nextTo: 'ocean'});
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) expect(occ.nbr[s].map((j) => occ.cells[j].id)).toContain(oceanId);
    for (const s of candidateSites(occ, free, {bonusFree: true})) expect(occ.cells[s].space.bonus).toHaveLength(0);
    expect(pickSite(occ, free, 0.5, {nextTo: 'city'})).toBeNull();
    // a hex with a forest in front of it scores worse than one without
    const a = free.findIndex((f, i) => f && occ.nbr[i].length === 6 && occ.cells[i].space.bonus.length === 0);
    const front = occ.nbr[a].find((j) => occ.cells[j].z > occ.cells[a].z + occ.pitch * 0.3)!;
    const forest = mk({[g.cells[front].id]: {tileType: TILE.GREENERY}});
    const sc = (grid: typeof g) => candidateSites(grid, freeMask(grid, new Set()), {bonusFree: true}).indexOf(a);
    expect(sc(forest)).toBeGreaterThan(sc(g));
  });
});

describe('line of sight', () => {
  const g = buildGrid([{id: 'a', x: 0, z: 0, space: {id: 'a', x: 0, y: 0, spaceType: 'land', bonus: []}}, {id: 'b', x: 0, z: 1, space: {id: 'b', x: 0, y: 1, spaceType: 'land', bonus: [], tileType: TILE.CITY}},
    {id: 'c', x: 0, z: -1, space: {id: 'c', x: 0, y: -1, spaceType: 'land', bonus: [], tileType: TILE.CITY}}]);
  const heights = [0.1, 0.1, 0.1], top = () => 0.8, cam = {x: 0, y: 1.5, z: 6};
  it('is blocked by a tall tile between the camera and the figure, not by one behind it', () => {
    expect(blockedFrom(g, 0, cam, top, 0.3, heights)).toBe(true);   // b stands in front (toward the camera)
    const behind = buildGrid([g.cells[0], g.cells[2]]);
    expect(blockedFrom(behind, 0, cam, top, 0.3, [0.1, 0.1])).toBe(false);
    expect(blockedFrom(g, 0, {x: 0, y: 60, z: 0.01}, top, 0.3, heights)).toBe(false); // from straight above nothing hides it
  });
});

describe('scheduler', () => {
  const all = () => true;
  it('waits before the first ambient scene and never exceeds two scenes', () => {
    const s = new LifeScheduler(seq(0.1, 0.5, 0.9));
    s.start(0, 0);
    const ctx = {scenesActive: 0, charsFree: 2, kindsActive: new Set<never>(), eligible: all};
    expect(s.nextAmbient(1, ctx)).toBeNull();
    expect(s.nextAmbient(6, {...ctx, scenesActive: LIFE.maxScenes})).toBeNull();
    expect(s.nextAmbient(6, {...ctx, charsFree: 0})).toBeNull();
    expect(s.nextAmbient(6, ctx)).not.toBeNull();
  });

  it('does not repeat the last two kinds or a running kind', () => {
    const s = new LifeScheduler(() => 0);
    s.start(0, 0);
    const seen: string[] = [];
    for (let t = 10; seen.length < 3; t += 5) { const k = s.nextAmbient(t, {scenesActive: 0, charsFree: 2, kindsActive: new Set(), eligible: all}); if (k) seen.push(k); }
    expect(new Set(seen).size).toBe(3);
    const s2 = new LifeScheduler(() => 0);
    s2.start(0, 0);
    expect(s2.nextAmbient(10, {scenesActive: 1, charsFree: 1, kindsActive: new Set(['plant'] as const), eligible: all})).not.toBe('plant');
    expect(s2.nextAmbient(100, {scenesActive: 0, charsFree: 2, kindsActive: new Set(), eligible: () => false})).toBeNull();
  });

  it('keeps the sky rare: a long first wait and a long cooldown, never while busy', () => {
    const s = new LifeScheduler(() => 0.5);
    s.start(0, 0);
    expect(s.nextFall(LIFE.fallFirst[0] - 1, all, false)).toBeNull();
    expect(s.nextFall(LIFE.fallFirst[1] + 1, all, true)).toBeNull();
    const first = s.nextFall(LIFE.fallFirst[1] + 1, all, false);
    expect(first).not.toBeNull();
    expect(s.nextFall(LIFE.fallFirst[1] + 60, all, false)).toBeNull();
    expect(s.nextFall(LIFE.fallFirst[1] + 1 + LIFE.fallEvery[1], all, false)).not.toBe(first);
    expect(LIFE.fallEvery[0]).toBeGreaterThanOrEqual(100);
  });

  it('delays the sky after a reaction and fires the idle scene once per quiet spell', () => {
    const s = new LifeScheduler(() => 0.5);
    s.start(0, 0);
    s.noteReaction(80);
    expect(s.nextFall(85, all, false)).toBeNull();
    expect(s.idleDue(LIFE.idleMs - 1)).toBe(false);
    expect(s.quietMs(25_000)).toBe(25_000);
    expect(s.idleDue(LIFE.idleMs + 1)).toBe(true);
    expect(s.idleDue(LIFE.idleMs + 2)).toBe(false);
    s.noteActivity(200_000);
    expect(s.idleDue(200_000 + LIFE.idleMs - 1)).toBe(false); // a move restarts the quiet clock
    expect(s.idleDue(200_000 + LIFE.idleMs + 1)).toBe(true);
  });
});

describe('reactions', () => {
  it('maps the game events to the spec reactions', () => {
    const r = (e: Parameters<typeof reactionsFor>[0], rnd = 0.2) => reactionsFor(e, 1000, () => rnd);
    expect(r([{kind: 'tile', spaceId: '12', tileType: TILE.OCEAN}])[0]).toMatchObject({kind: 'surf', spaceId: '12'});
    expect(r([{kind: 'tile', spaceId: '12', tileType: TILE.OCEAN}], 0.9)[0].kind).toBe('fish');
    expect(r([{kind: 'tile', spaceId: '9', tileType: TILE.CITY}])[0].kind).toBe('bricks');
    expect(r([{kind: 'tile', spaceId: '9', tileType: TILE.CAPITAL}], 0.9)[0].kind).toBe('flag');
    expect(r([{kind: 'tile', spaceId: '9', tileType: TILE.GREENERY}])).toEqual([]);
    expect(r([{kind: 'impact', card: 'Asteroid'}])[0].kind).toBe('cover');
    expect(r([{kind: 'attack'}])[0].kind).toBe('cover');
    expect(r([{kind: 'mc', color: 'red', delta: 30}])[0].kind).toBe('coin');
    expect(r([{kind: 'temp', from: -2, to: 0}])[0].kind).toBe('shades');
    expect(r([{kind: 'production'}])[0].kind).toBe('conveyor');
    expect(r([{kind: 'activity'}])).toEqual([]);
  });

  it('keeps the most important two of a busy update', () => {
    const out = reactionsFor([{kind: 'production'}, {kind: 'tile', spaceId: '1', tileType: TILE.OCEAN}, {kind: 'impact', card: 'Comet'}, {kind: 'mc', color: 'red', delta: 40}], 0, () => 0);
    expect(out).toHaveLength(PER_UPDATE);
    expect(out.map((x) => x.kind)).toEqual(['cover', 'coin']);
  });

  it('queues with cooldowns and expiry, and never hands out what is not ready', () => {
    const q = new ReactionQueue();
    q.push(reactionsFor([{kind: 'mc', color: 'red', delta: 30}], 0, () => 0), 0);
    q.push(reactionsFor([{kind: 'mc', color: 'red', delta: 30}], 0, () => 0), 0);
    expect(q.size).toBe(1);
    expect(q.take(100, () => false)).toBeNull();
    expect(q.take(100, () => true)?.kind).toBe('coin');
    q.push(reactionsFor([{kind: 'mc', color: 'blue', delta: 30}], 5000, () => 0), 5000);
    expect(q.size).toBe(0); // still cooling down
    q.push(reactionsFor([{kind: 'mc', color: 'blue', delta: 30}], 20000, () => 0), 20000);
    expect(q.size).toBe(1);
    expect(q.take(20000 + 16000, () => true)).toBeNull(); // expired
    expect(idleReaction(0, () => 0.1).kind).toBe('catch');
    expect(idleReaction(0, () => 0.9).kind).toBe('camwave');
  });
});

describe('events from the spectator model', () => {
  const player = (color: string, mc: number) => ({color, name: color, megacredits: mc, terraformRating: 20, tableau: []} as unknown as SpectatorModel['players'][number]);
  const model = (o: Partial<SpectatorModel['game']> = {}, mc = 10, id = 'g'): SpectatorModel => ({id, color: 'neutral', players: [player('red', mc)],
    game: {gameAge: 1, undoCount: 0, generation: 3, phase: 'action', temperature: -22, oxygenLevel: 3, oceans: 2, venusScaleLevel: 0, isTerraformed: false,
      spaces: DATA.tharsis.map((s) => ({...s})), passedPlayers: [], milestones: [], awards: [], deckSize: 10, ...o}} as SpectatorModel);
  it('derives tiles, temperature steps, big gains and production', () => {
    const a = model();
    const placed = DATA.tharsis.map((s, i) => (i === 20 ? {...s, tileType: TILE.OCEAN} : {...s}));
    expect(deriveLifeEvents(a, model({gameAge: 2, spaces: placed}))).toContainEqual(expect.objectContaining({kind: 'tile', tileType: TILE.OCEAN}));
    expect(deriveLifeEvents(a, model({gameAge: 2, temperature: -18}))).toContainEqual(expect.objectContaining({kind: 'temp'}));
    expect(deriveLifeEvents(a, model({gameAge: 2, temperature: -20}))).toContainEqual(expect.objectContaining({kind: 'temp'}));
    expect(deriveLifeEvents(a, model({gameAge: 2, temperature: -21}))).not.toContainEqual(expect.objectContaining({kind: 'temp'}));
    expect(deriveLifeEvents(a, model({gameAge: 2}, 10 + BIG_MC))).toContainEqual(expect.objectContaining({kind: 'mc'}));
    expect(deriveLifeEvents(a, model({gameAge: 2}, 10 + BIG_MC - 1))).not.toContainEqual(expect.objectContaining({kind: 'mc'}));
    expect(deriveLifeEvents(a, model({gameAge: 2, phase: 'production'}))).toContainEqual({kind: 'production'});
    // no gain event inside the production phase, no events at all for a new game or an undo
    expect(deriveLifeEvents(model({phase: 'production'}), model({gameAge: 2, phase: 'production'}, 90))).not.toContainEqual(expect.objectContaining({kind: 'mc'}));
    expect(deriveLifeEvents(a, model({}, 10, 'other'))).toEqual([]);
    expect(deriveLifeEvents(model({gameAge: 5}), model({gameAge: 4, undoCount: 1}))).toEqual([]);
    expect(deriveLifeEvents(null, a)).toEqual([]);
  });
});

describe('settings', () => {
  it('board life is on by default', () => {
    expect(DEFAULT_SETTINGS.boardLife).toBe(true);
    expect(parseSettings('{"boardLife":false}')).toMatchObject({boardLife: false});
    expect(parseSettings('{"boardLife":3}')).toMatchObject({boardLife: true});
  });
});
