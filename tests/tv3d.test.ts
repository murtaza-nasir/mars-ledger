// The 3D board's quality ladder (step down and up with hysteresis, the focus skip, levels that change nothing),
// the canvas's pixel budget, the TV options' dependencies (Board life → Terraformers), board life without its
// characters, and the server's per-TV reports (log line, /api/health, rate limit).
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {applicableFor, commitLadder, FLAT, LADDER, ladderStart, ladderState, ladderStep, LEVELS, nextLevel, renderDpr, resetLadder, resumeFromFlat, windowStats}
  from '../src/client/tv/full/board3d/quality';
import type {LadderState} from '../src/client/tv/full/board3d/quality';
import {DEFAULT_SETTINGS, parseSettings, terraformersOn} from '../src/client/tv/settings';
import {cleanTv3dReport, tv3dLine, TV3D_LEVELS} from '../src/shared/tv3d';
import {Tv3dDesk} from '../src/server/tv3d';
import boards from '../src/shared/data/boards.json';
import type {SpaceModel} from '../src/shared/full';
import {board3d} from '../src/client/tv/full/board3d/geometry3d';

// board life's characters need a canvas for their faces: stand-ins with real three.js objects
const disposed = vi.hoisted(() => ({n: 0}));
vi.mock('../src/client/tv/full/board3d/life/rig', async (orig) => {
  const real = await orig<typeof import('../src/client/tv/full/board3d/life/rig')>();
  return {
    ...real,
    createCharacter: (skin: unknown) => ({skin, group: new THREE.Group(), bones: real.BONES.map(() => new THREE.Bone()),
      mesh: new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()), material: new THREE.MeshStandardMaterial(),
      atlas: new THREE.Texture(), face: -1, faceStart: 0, faceCount: 0, faceLocal: new Float32Array()}),
    disposeCharacter: () => { disposed.n++; },
    setFace: () => {},
  };
});
const {LifeWorld} = await import('../src/client/tv/full/board3d/life/world');
const {GENERIC_SKINS} = await import('../src/client/tv/full/board3d/life/skins');

const ok = Array(300).fill(16.7);           // 60 fps, every frame on time
const slow = Array(150).fill(34);           // 30 fps
const meh = Array(250).fill(19);            // between: neither slow nor roomy
const T = 60_000;                           // well past the warm-up
const all = (_i: number) => true;

/** Feed windows; returns the state and the changes made. */
function run(st: LadderState, windows: number[][], applicable = all) {
  const changes: string[] = [];
  for (const w of windows) {
    const r = ladderStep(st, w, {sinceStartMs: T, applicable});
    if (r.change) changes.push(`${r.change.dir}:${LEVELS[r.change.to].id}`);
    st = r.state;
  }
  return {st, changes};
}
const times = (n: number, w: number[]) => Array(n).fill(w) as number[][];

describe('quality ladder', () => {
  it('measures a window: p95, median, slow share', () => {
    const s = windowStats([...Array(90).fill(16), ...Array(10).fill(40)]);
    expect(s).toMatchObject({p95: 40, median: 16, slow: 0.1, frames: 100});
  });

  it('skips the warm-up, thin windows and windows without focus, changing nothing', () => {
    const st = {...ladderStart(), bad: 2};
    expect(ladderStep(st, slow, {sinceStartMs: LADDER.warmupMs - 1})).toEqual({state: st, change: null});
    expect(ladderStep(st, slow.slice(0, 10), {sinceStartMs: T})).toEqual({state: st, change: null});
    expect(ladderStep(st, slow, {sinceStartMs: T, focused: false})).toEqual({state: st, change: null});
    // the count survives the skipped window: the next focused slow window steps down
    expect(ladderStep(st, slow, {sinceStartMs: T}).change).toMatchObject({from: 0, to: 1, dir: 'down'});
  });

  it('never steps down for brief spikes: two slow windows then a good one reset the count', () => {
    const {st, changes} = run(ladderStart(), [slow, slow, ok, slow, slow, meh, slow, slow, ok]);
    expect(changes).toEqual([]);
    expect(st.level).toBe(0);
    // a window with a few long frames whose p95 stays in budget is not slow
    expect(run(ladderStart(), times(6, [...Array(290).fill(16.7), ...Array(10).fill(80)])).changes).toEqual([]);
  });

  it('steps down one level after 15 s of slow frames, then waits a settle window and two more per level', () => {
    let r = run(ladderStart(), times(3, slow));
    expect(r.changes).toEqual(['down:res85']);
    expect(r.st.settle).toBe(1);
    // settle window, then one slow window: not yet
    r = run(r.st, [slow, slow]);
    expect(r.changes).toEqual([]);
    r = run(r.st, [slow]);
    expect(r.changes).toEqual(['down:res70']);
    // all the way down: every level in turn, flat last
    r = run(r.st, times(40, slow));
    expect(r.changes).toEqual(['down:effects', 'down:noTerraformers', 'down:noLife', 'down:lite', 'down:flat']);
    expect(r.st.level).toBe(FLAT);
  });

  it('skips levels that change nothing on this screen', () => {
    const app = applicableFor({boardLife: true, terraformers: false, detailed: false});
    const r = run(ladderStart(3), times(30, slow), app);
    expect(r.changes).toEqual(['down:noLife', 'down:flat']);
    expect(nextLevel(3, 1, applicableFor({boardLife: false, terraformers: true, detailed: true}))).toBe(6);
    expect(nextLevel(6, -1, applicableFor({boardLife: false, terraformers: true, detailed: true}))).toBe(3);
    expect(nextLevel(0, -1)).toBeNull();
  });

  it('steps up only after a sustained minute of room, one level at a time', () => {
    let r = run(ladderStart(3), times(LADDER.upWindows - 1, ok));
    expect(r.changes).toEqual([]);
    r = run(r.st, [ok]);
    expect(r.changes).toEqual(['up:res70']);
    // a middling window in between restarts the count
    r = run(r.st, [ok, ...times(LADDER.upWindows - 2, ok), meh, ...times(LADDER.upWindows - 1, ok)]);
    expect(r.changes).toEqual([]);
    r = run(r.st, [ok]);
    expect(r.changes).toEqual(['up:res85']);
    // many long frames are not "room" even when the p95 is fine
    const spiky = [...Array(290).fill(16.7), ...Array(10).fill(30)];
    expect(run(ladderStart(1), times(30, spiky)).changes).toEqual([]);
    // never up from flat (the 3D board is not running there), never above full
    expect(run(ladderStart(FLAT), times(30, ok)).changes).toEqual([]);
    expect(run(ladderStart(0), times(30, ok)).changes).toEqual([]);
  });

  it('hysteresis: a step up that does not hold doubles the wait before the next one', () => {
    let r = run(ladderStart(2), times(LADDER.upWindows, ok));
    expect(r.changes).toEqual(['up:res85']);
    r = run(r.st, [ok, slow, slow]);   // settle, then slow again within the probation
    expect(r.changes).toEqual(['down:res70']);
    expect(r.st.upNeed).toBe(LADDER.upWindows * 2);
    r = run(r.st, [ok, ...times(LADDER.upWindows * 2 - 1, ok)]);
    expect(r.changes).toEqual([]);
    r = run(r.st, [ok]);
    expect(r.changes).toEqual(['up:res85']);
    // and fails again: 4×, capped at upMax
    r = run(r.st, [ok, slow, slow]);
    expect(r.st.upNeed).toBe(LADDER.upWindows * 4);
    let st = {...r.st, upNeed: LADDER.upMax, probation: 3};
    st = run(st, [slow, slow]).st;
    expect(st.upNeed).toBe(LADDER.upMax);
  });

  it('a step up that holds through its probation relaxes the wait again', () => {
    const st = {...ladderStart(2), upNeed: LADDER.upWindows * 4};
    let r = run(st, times(LADDER.upWindows * 4, ok));
    expect(r.changes).toEqual(['up:res85']);
    r = run(r.st, times(LADDER.probation + 1, ok));
    expect(r.st.upNeed).toBe(LADDER.upWindows * 2);
  });

  it('keeps the level on this screen, resets to full, and resumes above flat', () => {
    const m = new Map<string, string>();
    const store = {getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }};
    resetLadder(store);
    commitLadder({...ladderStart(3)}, {at: 1, dir: 'down', from: 2, to: 3, p95: 30, median: 25, slow: 0.3, size: '1536x729@2.5'}, store);
    expect(ladderState().level).toBe(3);
    expect(m.get('mars-ledger-board3d-level')).toBe('3');
    commitLadder({...ladderStart(FLAT)}, undefined, store);
    expect(m.get('mars-ledger-board3d-level')).toBe('3');   // flat is fallback.ts's to remember
    resumeFromFlat();
    expect(ladderState().level).toBe(FLAT - 1);
    resetLadder(store);
    expect(ladderState().level).toBe(0);
    expect(m.size).toBe(0);
  });

  it('every level keeps the savings of the ones above it', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      const a = LEVELS[i - 1], b = LEVELS[i];
      expect(b.scale).toBeLessThanOrEqual(a.scale);
      for (const k of ['effects', 'terraformers', 'life'] as const) if (!a[k]) expect(b[k]).toBe(false);
      for (const k of ['lite', 'flat'] as const) if (a[k]) expect(b[k]).toBe(true);
    }
    expect(LEVELS.map((l) => l.id)).toEqual(TV3D_LEVELS.map((l) => l.id));
    expect(LEVELS[FLAT].flat).toBe(true);
  });
});

describe('the canvas pixel budget', () => {
  it('caps density at 2 and the canvas at 4K, then scales by level', () => {
    expect(renderDpr(1920, 1080, 1)).toBe(1);
    expect(renderDpr(1536, 729, 2.5)).toBe(2);                     // 3072×1458
    expect(renderDpr(6144, 2916, 0.625)).toBe(0.625);
    expect(renderDpr(3840, 2016, 1)).toBe(1);
    expect(renderDpr(3840, 2160, 2)).toBe(1);                      // a 4K page at 2× draws 4K, not 8K
    expect(renderDpr(1920, 1080, 1, 0.7)).toBe(0.7);
    expect(renderDpr(1536, 729, 2.5, 0.85)).toBe(1.7);
  });
});

describe('TV options: Board life and Terraformers', () => {
  it('Terraformers is on by default and only counts while Board life is on', () => {
    expect(DEFAULT_SETTINGS.terraformers).toBe(true);
    expect(parseSettings('{"terraformers":false}').terraformers).toBe(false);
    expect(parseSettings('{"terraformers":"no"}').terraformers).toBe(true);
    expect(terraformersOn({boardLife: true, terraformers: true})).toBe(true);
    expect(terraformersOn({boardLife: true, terraformers: false})).toBe(false);
    expect(terraformersOn({boardLife: false, terraformers: true})).toBe(false);
    // turning Board life back on brings Terraformers back as it was
    const s = parseSettings(JSON.stringify({boardLife: false, terraformers: true}));
    expect(terraformersOn({...s, boardLife: true})).toBe(true);
  });
});

describe('board life without terraformers', () => {
  const spaces = (boards as unknown as Record<string, SpaceModel[]>).tharsis.map((s) => ({...s}));
  const geo = board3d(spaces);
  const cells = geo.cells.map((c) => ({id: c.id, x: c.x, z: c.z, space: c.space}));
  const ctx = {hidden: false, night: 0, reduced: false, cam: [0, 5, 6] as [number, number, number], dive: 0, canVisit: false, focus: [], oxygen: 4, wallMs: 1000};

  it('builds no characters until asked, and clearing them ends their scenes and reactions', () => {
    const w = new LifeWorld(5);
    w.setBoard(cells, new Set(), 0);
    expect(w.chars).toHaveLength(0);
    w.setSkins(GENERIC_SKINS, 'generic');
    expect(w.chars).toHaveLength(2);
    const groups = w.chars.map((c) => c.ch.group);
    expect(w.spawn('plant')).toBe('ok');
    expect(w.scenes).toHaveLength(1);
    disposed.n = 0;
    w.clearChars();
    expect(w.chars).toHaveLength(0);
    expect(w.scenes).toHaveLength(0);
    expect(disposed.n).toBe(2);
    for (const g of groups) expect(g.parent).toBeNull();
    // game events no longer queue reactions
    w.onEvents([{kind: 'temp', from: 0, to: 2}], 2000);
    expect(w.queue.waiting).toHaveLength(0);
  });

  it('keeps the sky and the ambient life running without characters', () => {
    const w = new LifeWorld(7);
    w.setBoard(cells, new Set(), 0);
    for (let i = 0; i < 30; i++) w.tick(0.05, {...ctx, wallMs: 1000 + i * 50});
    w.sched.fallNow(w.clock);
    for (let i = 0; i < 20 && !w.fall; i++) w.tick(0.05, {...ctx, wallMs: 3000 + i * 50});
    expect(w.fall).not.toBeNull();
    expect(w.scenes).toHaveLength(0);
    expect(w.chars).toHaveLength(0);
    // a pizza with nobody to eat it plays out
    w.abort(w.fall!, 'done');
    expect(w.spawn('pizza')).toBe('ok');
    for (let i = 0; i < 400; i++) w.tick(0.05, {...ctx, wallMs: 5000 + i * 50});
    expect(w.chars).toHaveLength(0);
  });
});

describe('TV reports to the server', () => {
  const rep = {tv: 'k3x9ab', level: 1, dir: 'down', p95: 34.04, median: 28, slow: 0.31, size: '1536x729@2.5', render: '3072x1458'};
  it('cleans reports and refuses malformed ones', () => {
    expect(cleanTv3dReport(rep)).toEqual({...rep, p95: 34});
    expect(cleanTv3dReport({...rep, level: 9})).toBeNull();
    expect(cleanTv3dReport({...rep, tv: 'bad id!'})).toBeNull();
    expect(cleanTv3dReport({...rep, size: '<script>'})).toBeNull();
    expect(cleanTv3dReport({...rep, dir: 'sideways'})).toBeNull();
    expect(cleanTv3dReport({...rep, render: 'x'})).toMatchObject({render: null});
    expect(cleanTv3dReport(null)).toBeNull();
  });

  it('writes the log line', () => {
    expect(tv3dLine(cleanTv3dReport(rep)!)).toBe('3D: TV k3x9ab stepped down to reduced resolution (85%): p95 34 ms, median 28 ms, 31% over 25 ms at 1536x729@2.5 (canvas 3072x1458)');
    expect(tv3dLine(cleanTv3dReport({...rep, level: 7, dir: 'flat'})!)).toMatch(/^3D: TV k3x9ab fell back to the flat board: p95 34 ms/);
    expect(tv3dLine(cleanTv3dReport({...rep, level: 0, dir: 'reset', p95: null, median: null, slow: null, render: null})!)).toBe('3D: TV k3x9ab was reset to full quality at 1536x729@2.5');
  });

  it('keeps the latest per TV for /api/health, rate-limited per TV and in all', () => {
    const d = new Tv3dDesk(3);
    expect(d.report(rep, 1000)).toMatch(/stepped down/);
    expect(d.report({...rep, level: 2}, 2000)).toMatch(/70%/);
    expect(d.health()).toEqual({k3x9ab: {level: 2, levelId: 'res70', label: 'reduced resolution (70%)', dir: 'down', p95: 34, median: 28, slow: 0.31,
      size: '1536x729@2.5', render: '3072x1458', at: new Date(2000).toISOString()}});
    expect(d.report({...rep, junk: 1, level: 'x'}, 3000)).toBeNull();
    for (let i = 0; i < 10; i++) d.report(rep, 3000 + i);
    expect(d.report(rep, 4000)).toBeNull();               // twelve a minute per TV
    expect(d.report(rep, 1000 + 61_000)).not.toBeNull();
    // the oldest TVs give way
    for (const tv of ['aaaa', 'bbbb', 'cccc']) d.report({...rep, tv}, 70_000);
    expect(Object.keys(d.health())).toEqual(['aaaa', 'bbbb', 'cccc']);
  });
});
