// Undo is immediate, visible and safe. The engine's numbers after an undo, the input check, the undo window, the
// notice every device hears, and the story going back with the game.
import {describe, expect, it} from 'vitest';
import {compareVersions, isRewind, isUndoAnswer, judgeInput, movedText, questionIdentity, questionKey, seenOf, turnOfText, undoChangedText, undoWindowText,
  MOVED_ON_TEXT, ALREADY_SENT_TEXT, NOT_ASKED_TEXT} from '../src/shared/sync';
import type {Seen, ViewVersion} from '../src/shared/sync';
import {isOlderView} from '../src/shared/full';
import type {FullView, InputResponse, PlayerViewModel, SpectatorModel} from '../src/shared/full';
import {FullBridge, InputRefused} from '../src/server/full/bridge';
import type {Rewind} from '../src/server/full/bridge';
import {HistoryKeeper} from '../src/server/full/history';
import type {EngineClient} from '../src/server/full/engine';
import {newGame} from '../src/shared/engine';
import type {GameState} from '../src/shared/game';
import type {ServerMsg} from '../src/shared/protocol';
import type {GameHistory} from '../src/shared/history';

describe('the engine after an undo', () => {
  // measured on the production engine image (SQLite): 2 games, 40 undos (scratchpad undo/probe-sqlite.json)
  it('a repeated undo in one turn keeps undoCount and lowers gameAge, and isRewind sees every step back', () => {
    const steps = [[14, 0], [12, 1], [14, 1], [12, 1], [15, 1]].map(([gameAge, undoCount]) => ({gameAge, undoCount}));
    expect(steps.slice(1).map((s, i) => isRewind(steps[i], s))).toEqual([true, false, true, false]);
    expect(isRewind({gameAge: 5, undoCount: 0}, {gameAge: 5, undoCount: 0})).toBe(false);
  });
  it('the view after a repeated undo is newer than the one before it (ordering by undoCount, then gameAge, would drop it)', () => {
    const v = (age: number, undo: number, seq: number): ViewVersion => ({age, undo, boot: 1, seq});
    const view = (age: number, undo: number) => ({role: 'player', playerId: 'a', model: {id: 'p1', game: {gameAge: age, undoCount: undo}}}) as unknown as FullView;
    expect(compareVersions(v(12, 1, 11), v(14, 1, 10))).toBeGreaterThan(0);
    expect(isOlderView(view(12, 1), view(14, 1), v(12, 1, 11), v(14, 1, 10))).toBe(false);
  });
});

describe('questions and answers', () => {
  const menu = (undo: boolean) => ({type: 'or', title: 'Take your next action', options: [
    {type: 'projectCard', title: 'Play project card'}, {type: 'option', title: 'End Turn'}, {type: 'option', title: 'Pass for this generation'},
    ...(undo ? [{type: 'option', title: 'Undo last action'}] : [])]});
  it('a question has one key on every device, and any change gives another', () => {
    expect(questionKey(menu(true))).toBe(questionKey(JSON.parse(JSON.stringify(menu(true)))));
    expect(questionKey(menu(true))).not.toBe(questionKey(menu(false)));
    expect(questionKey(undefined)).toBe(questionKey(null));
  });
  it('knows the engine\'s undo option by its title, and nothing else', () => {
    expect(isUndoAnswer(menu(true), {type: 'or', index: 3, response: {type: 'option'}})).toBe(true);
    expect(isUndoAnswer(menu(true), {type: 'or', index: 2, response: {type: 'option'}})).toBe(false);
    // the same index on a menu without undo is something else (here: out of range)
    expect(isUndoAnswer(menu(false), {type: 'or', index: 3, response: {type: 'option'}})).toBe(false);
    expect(isUndoAnswer(undefined, {type: 'or', index: 0})).toBe(false);
    expect(isUndoAnswer({type: 'or', options: [{type: 'option', title: {message: 'Undo last action'}}]}, {type: 'or', index: 0})).toBe(true);
  });
  it('seenOf names the view and the question', () => {
    const s = seenOf({age: 7, undo: 1, boot: 3, seq: 40, epoch: 2}, {game: {gameAge: 7, undoCount: 1}, waitingFor: menu(true)});
    expect(s).toEqual({boot: 3, seq: 40, epoch: 2, age: 7, undo: 1, q: questionKey(menu(true)), qi: questionIdentity(menu(true))});
    expect(seenOf(null, {game: {gameAge: 7, undoCount: 1}})).toBeUndefined();
  });
});

describe('judgeInput', () => {
  const w = {type: 'or', title: 'Take your first action', options: [{type: 'option', title: 'Pass for this generation'}]};
  const fresh = (age: number, undo = 0, q: unknown = w) => ({game: {gameAge: age, undoCount: undo}, waitingFor: q});
  const seen = (age: number, undo = 0, epoch = 0, q: unknown = w, boot = 1): Seen => ({boot, seq: 1, epoch, age, undo, q: questionKey(q)});
  const base = {playerId: 'b', isUndo: false, boot: 1, epoch: 0, lastUndo: null, ownAge: null, lastMove: null};
  it('lets through an answer to the question on screen', () => {
    expect(judgeInput({...base, fresh: fresh(10), seen: seen(10)})).toEqual({ok: true});
  });
  it('lets through an answer when only someone else moved meanwhile (simultaneous research or draft)', () => {
    expect(judgeInput({...base, fresh: fresh(12), seen: seen(10)})).toEqual({ok: true});
  });
  it('refuses an answer from before an undo, naming who undid', () => {
    const v = judgeInput({...base, epoch: 1, lastUndo: {epoch: 1, name: 'Ana'}, fresh: fresh(8, 1), seen: seen(10, 0, 0)});
    expect(v).toEqual({ok: false, code: 'stale', error: undoChangedText('Ana')});
    expect(undoChangedText('Ana')).toBe('The game changed (Ana undid a move). Here is the new situation.');
  });
  it('refuses an answer from before a repeated undo (same undoCount, lower gameAge), even across a server restart', () => {
    // a restarted server (another boot) cannot compare epochs; the engine's own numbers still tell
    expect(judgeInput({...base, fresh: fresh(12, 1), seen: seen(14, 1, 0, w, 99)})).toMatchObject({ok: false, code: 'stale'});
  });
  it('refuses an answer to a question that changed, and one when no question is open', () => {
    expect(judgeInput({...base, fresh: fresh(10, 0, {type: 'card'}), seen: seen(10)})).toEqual({ok: false, code: 'stale', error: MOVED_ON_TEXT});
    expect(judgeInput({...base, fresh: {game: {gameAge: 10, undoCount: 0}}, seen: seen(10)})).toEqual({ok: false, code: 'stale', error: NOT_ASKED_TEXT});
    expect(judgeInput({...base, fresh: {game: {gameAge: 10, undoCount: 0}}})).toMatchObject({ok: false, code: 'stale'});
  });
  it('a refusal when your turn is over says who moved, or whose turn it is', () => {
    const none = {game: {gameAge: 10, undoCount: 0}};
    expect(judgeInput({...base, playerId: 'a', fresh: none, seen: seen(9), lastMove: {playerId: 'b', name: 'Vera'}}))
      .toEqual({ok: false, code: 'stale', error: movedText('Vera')});
    expect(movedText('Vera')).toBe('Vera has already moved. Here is the new situation.');
    expect(judgeInput({...base, playerId: 'a', fresh: none, seen: seen(9), lastMove: {playerId: 'a', name: 'Ana'}, activeName: 'Vera'}))
      .toEqual({ok: false, code: 'stale', error: turnOfText('Vera')});
  });
  it('refuses a double tap: a view older than this seat\'s own last answer', () => {
    expect(judgeInput({...base, ownAge: 11, fresh: fresh(11), seen: seen(10)})).toEqual({ok: false, code: 'stale', error: ALREADY_SENT_TEXT});
    expect(judgeInput({...base, ownAge: 11, fresh: fresh(11), seen: seen(11)})).toEqual({ok: true});
  });
  it('answers without a view (the bot desk) skip the view check', () => {
    expect(judgeInput({...base, fresh: fresh(10, 3)})).toEqual({ok: true});
  });
  it('an undo is refused once another player has moved after you', () => {
    expect(judgeInput({...base, playerId: 'a', isUndo: true, lastMove: {playerId: 'b', name: 'Vera'}, fresh: fresh(10), seen: seen(10)}))
      .toEqual({ok: false, code: 'undoWindow', error: undoWindowText('Vera')});
    expect(undoWindowText('Vera')).toMatch(/^Vera has already moved/);
    expect(judgeInput({...base, playerId: 'a', isUndo: true, lastMove: {playerId: 'a', name: 'Ana'}, fresh: fresh(10), seen: seen(10)})).toEqual({ok: true});
    expect(judgeInput({...base, playerId: 'a', isUndo: true, fresh: fresh(10), seen: seen(10)})).toEqual({ok: true});
  });
});

// ---- a small engine that undoes like the real one -------------------------------------------------------------
/**
 * Two seats (pa: Ana, pb: Vera), two actions a turn. The turn start is saved; undo restores that save with its undoCount
 * plus one (so a second undo in the same turn repeats undoCount and lowers gameAge, as measured on the real engine).
 * During research both seats have a question at once.
 */
class MiniEngine {
  g = {age: 10, undo: 0, phase: 'action', active: 'pa', actions: 0, tiles: [] as string[], research: new Set<string>()};
  save = JSON.stringify({...this.g, research: []});
  inputs: Array<{id: string; response: InputResponse}> = [];
  /** called inside input() before it applies, to let a test land something "at the same moment" */
  gate: Promise<void> | null = null;
  menu(id: string) {
    const g = this.g;
    if (g.phase === 'research') return g.research.has(id) ? undefined : {type: 'card', title: 'Select cards to buy', cards: [{name: 'Ants'}]};
    if (g.active !== id) return undefined;
    return {type: 'or', title: g.actions ? 'Take your next action' : 'Take your first action', options: [
      {type: 'option', title: 'Place a city'}, ...(g.actions ? [{type: 'option', title: 'End Turn'}] : []), {type: 'option', title: 'Pass for this generation'},
      ...(g.actions ? [{type: 'option', title: 'Undo last action'}] : [])]};
  }
  model(id: string) {
    return {id, color: id === 'pa' ? 'red' : 'blue', game: {gameAge: this.g.age, undoCount: this.g.undo, generation: 1, phase: this.g.phase},
      thisPlayer: {name: id === 'pa' ? 'Ana' : 'Vera', actionsTakenThisRound: this.g.active === id ? this.g.actions : 0},
      waitingFor: this.menu(id), players: []} as unknown as PlayerViewModel;
  }
  spectator() {
    return {id: 's1', color: 'neutral', game: {gameAge: this.g.age, undoCount: this.g.undo, generation: 1, phase: this.g.phase, spaces: this.g.tiles.map((t) => ({id: t, tileType: 2, color: 'red'})),
      temperature: -30, oxygenLevel: 0, oceans: 0, milestones: [], awards: []},
      players: [{color: 'red', name: 'Ana', isActive: this.g.active === 'pa', megacredits: 0, terraformRating: 20, tableau: []},
        {color: 'blue', name: 'Vera', isActive: this.g.active === 'pb', megacredits: 0, terraformRating: 20, tableau: []}]} as unknown as SpectatorModel;
  }
  async input(id: string, response: InputResponse) {
    if (this.gate) await this.gate;
    const w = this.menu(id) as {options?: Array<{title: string}>} | undefined;
    if (!w) throw new Error('Not waiting for anything');
    this.inputs.push({id, response});
    const g = this.g;
    if (g.phase === 'research') { g.research.add(id); g.age++; return this.model(id); }
    const title = w.options![(response as {index: number}).index]?.title;
    if (!title) throw new Error('Invalid index');
    if (title === 'Undo last action') {
      const s = JSON.parse(this.save);
      this.g = {...s, research: new Set(), undo: s.undo + 1};
      return this.model(id);
    }
    if (title === 'Place a city') { g.tiles.push(`t${g.age}`); g.age += 2; g.actions++; }
    if (title !== 'Place a city' || g.actions >= 2) {
      g.active = g.active === 'pa' ? 'pb' : 'pa'; g.actions = 0; g.age++;
      this.save = JSON.stringify({...g, research: []});
    }
    return this.model(id);
  }
  client(): EngineClient {
    return {player: async (id: string) => this.model(id), spectator: async () => this.spectator(), logs: async () => [],
      input: (id: string, r: InputResponse) => this.input(id, r)} as unknown as EngineClient;
  }
}

type Sock = {name: string; readyState: number};
const sock = (name: string): Sock => ({name, readyState: 1});
function table(): GameState {
  const s = newGame('g');
  return {...s, mode: 'full', phase: 'full' as GameState['phase'],
    players: [{id: 'a', name: 'Ana', color: 'red'}, {id: 'b', name: 'Vera', color: 'blue'}] as GameState['players'],
    full: {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red'}, b: {engineId: 'pb', color: 'blue'}}}} as GameState;
}
function setup(history: HistoryKeeper | null = null) {
  const e = new MiniEngine();
  const tv = sock('tv'); const pa = sock('phoneA'); const pb = sock('phoneB');
  const sent: Array<{to: string; msg: ServerMsg; at: number}> = [];
  const b = new FullBridge(e.client(), table, () => [tv, pa, pb] as never, (ws, msg) => sent.push({to: (ws as unknown as Sock).name, msg, at: Date.now()}), 60000, history, 60000);
  b.stop();
  b.hello(tv as never, {role: 'tv', playerId: null});
  b.hello(pa as never, {role: 'phone', playerId: 'a'});
  b.hello(pb as never, {role: 'phone', playerId: 'b'});
  /** the newest view each device holds (a client keeps a view unless it is older than the one it has) */
  const held = (to: string) => {
    let cur: {view: FullView; v: ViewVersion} | null = null;
    for (const x of sent) {
      if (x.to !== to || x.msg.type !== 'full') continue;
      if (!cur || !isOlderView(x.msg.view, cur.view, x.msg.v, cur.v)) cur = {view: {...x.msg.view, v: x.msg.v}, v: x.msg.v!};
    }
    return cur!;
  };
  const seenBy = (to: string) => { const h = held(to); return seenOf(h.v, h.view.model as PlayerViewModel)!; };
  const undoIdx = () => (e.menu('pa') as {options: Array<{title: string}>}).options.findIndex((o) => o.title.startsWith('Undo'));
  return {e, b, sent, held, seenBy, undoIdx, tv, pa, pb};
}
const opt = (index: number): InputResponse => ({type: 'or', index, response: {type: 'option'}});

describe('undo through the bridge', () => {
  it('every device gets the notice and then the undone game, even on a repeated undo', async () => {
    const t = setup();
    await t.b.pushAll();
    for (let round = 1; round <= 2; round++) {
      await t.b.input('a', opt(0), false, t.seenBy('phoneA')); // Ana places a city
      const before = t.held('tv').view.model.game.gameAge;
      const n0 = t.sent.length;
      await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA'));
      const after = t.sent.slice(n0);
      // the notice first, to every device, then fresh views that every device keeps
      for (const d of ['tv', 'phoneA', 'phoneB']) {
        const mine = after.filter((x) => x.to === d);
        expect(mine[0].msg).toMatchObject({type: 'fullUndo', notice: {name: 'Ana', playerId: 'a', color: 'red', epoch: round}});
        expect(mine.some((x) => x.msg.type === 'full')).toBe(true);
        expect(t.held(d).view.model.game.gameAge).toBe(10);
        expect(t.held(d).v.epoch).toBe(round);
      }
      expect(before).toBe(12);
      // round 2 repeats undoCount 1 with a lower gameAge: ordering by the engine's numbers would drop these views
      expect(t.held('tv').view.model.game.undoCount).toBe(1);
    }
  });
  it('an answer made against the view before the undo is refused with the reason and never reaches the engine', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    const stale = t.seenBy('phoneA'); // Ana's phone shows "Take your next action" (End Turn at index 1)
    await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA'));
    const n = t.e.inputs.length;
    // index 1 was "End Turn"; on the restored menu it is "Pass for this generation": the engine would have passed
    expect((t.e.menu('pa') as {options: Array<{title: string}>}).options[1].title).toBe('Pass for this generation');
    const err = await t.b.input('a', opt(1), false, stale).catch((e) => e);
    expect(err).toBeInstanceOf(InputRefused);
    expect(err.code).toBe('stale');
    expect(err.message).toBe('The game changed (Ana undid a move). Here is the new situation.');
    expect(t.e.inputs.length).toBe(n);
    expect(t.e.g.phase).toBe('action');
  });
  it('an undo and another answer in the same instant: the lock orders them, and the late answer is refused', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    const seenA = t.seenBy('phoneA');
    let release!: () => void;
    t.e.gate = new Promise((r) => { release = r; });
    // the undo is held at the engine; a second tap from the same view arrives meanwhile
    const undo = t.b.input('a', opt(t.undoIdx()), false, seenA);
    const tap = t.b.input('a', opt(0), false, seenA).then(() => 'accepted', (e) => (e as Error).message);
    await new Promise((r) => setTimeout(r, 5));
    t.e.gate = null; release();
    await undo;
    expect(await tap).toBe('The game changed (Ana undid a move). Here is the new situation.');
    expect(t.e.g.tiles).toEqual([]);
  });
  it('the undo window: Vera has moved, so Ana cannot undo (even if the engine offered it)', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    await t.b.input('a', opt(0), false, t.seenBy('phoneA')); // second action: the turn passes to Vera
    expect(t.e.g.active).toBe('pb');
    // the real engine never offers Ana an undo now; a stale Undo tap is refused before the engine sees it
    const err = await t.b.input('a', opt(3), false, t.seenBy('phoneA')).catch((e) => e);
    expect(err).toMatchObject({code: 'stale'});
    await t.b.input('b', opt(0), false, t.seenBy('phoneB')); // Vera places a city
    // pretend the engine offered Ana an undo now: our window still refuses it
    t.e.g.active = 'pa'; t.e.g.actions = 1;
    await t.b.pushAll();
    const w = await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA')).catch((e) => e);
    expect(w).toMatchObject({code: 'undoWindow', message: 'Vera has already moved, so your last move can no longer be undone.'});
    // every view says who moved last (the phone's greyed Undo row gives the reason)
    expect(t.held('phoneA').view.lastMove).toEqual({playerId: 'b', name: 'Vera'});
  });
  it('simultaneous research answers are not refused for each other\'s moves; a double tap is', async () => {
    const t = setup();
    t.e.g.phase = 'research';
    await t.b.pushAll();
    const seenA = t.seenBy('phoneA'); const seenB = t.seenBy('phoneB');
    await t.b.input('a', {type: 'card', cards: ['Ants']}, false, seenA);
    // Vera answers from the view she had before Ana's answer moved gameAge: same question, accepted
    await t.b.input('b', {type: 'card', cards: ['Ants']}, false, seenB);
    expect(t.e.g.research.size).toBe(2);
    const again = await t.b.input('a', {type: 'card', cards: ['Ants']}, false, seenA).catch((e) => e);
    expect(again).toMatchObject({code: 'stale'});
  });
  it('a device that connects just after an undo still hears about it', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA'));
    const late = sock('late');
    t.sent.length = 0;
    t.b.hello(late as never, {role: 'tv', playerId: null});
    expect(t.sent.find((x) => x.to === 'late' && x.msg.type === 'fullUndo')).toBeTruthy();
  });
  it('tells the rest of the server what was undone and from when (away journal, mission control)', async () => {
    const t = setup();
    const rewinds: Rewind[] = [];
    t.b.onRewind = (r) => rewinds.push(r);
    await t.b.pushAll();
    const t0 = Date.now();
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA'));
    expect(rewinds).toHaveLength(1);
    expect(rewinds[0]).toMatchObject({gameId: 'e1', actor: 'red', notice: {name: 'Ana'}});
    // since: when the restored moment (gameAge 10) was first seen, i.e. before Ana's undone move
    expect(rewinds[0].since).not.toBeNull();
    expect(rewinds[0].since!).toBeLessThanOrEqual(t0);
  });
});

describe('the story goes back with the game', () => {
  it('a city placed, undone and placed again counts once', async () => {
    const saved: Record<string, GameHistory> = {};
    const keeper = new HistoryKeeper({loadHistory: (id) => saved[id] ?? null, saveHistory: (id, h) => { saved[id] = JSON.parse(JSON.stringify(h)); }});
    const t = setup(keeper);
    await t.b.pushAll();
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    expect(keeper.get('e1').tiles).toHaveLength(1);
    await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA'));
    expect(keeper.get('e1').tiles).toHaveLength(0);
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    await t.b.input('a', opt(t.undoIdx()), false, t.seenBy('phoneA')); // the repeated undo (same undoCount)
    await t.b.input('a', opt(0), false, t.seenBy('phoneA'));
    const h = keeper.get('e1');
    expect(h.tiles).toHaveLength(1);
    expect(h.generations[0].players.find((p) => p.color === 'red')!.tiles.city).toBe(1);
    expect(h.undos).toEqual([{generation: 1, color: 'red'}, {generation: 1, color: 'red'}]);
    // the TV hears the story after each undo
    expect(t.sent.filter((x) => x.to === 'tv' && x.msg.type === 'history').length).toBeGreaterThanOrEqual(2);
  });
});
