// Versions, consistent push batches, heartbeats, resync limits and hold deadlines.
import {describe, expect, it} from 'vitest';
import {compareVersions, consistentCut, heldValue, isOlderVersion, modelFingerprint, ResyncLimiter, ResyncPlanner, showLocalStart, versionTag} from '../src/shared/sync';
import type {ViewVersion} from '../src/shared/sync';
import {isOlderView} from '../src/shared/full';
import type {FullView, SpectatorModel, PlayerViewModel} from '../src/shared/full';
import {FullBridge} from '../src/server/full/bridge';
import type {EngineClient} from '../src/server/full/engine';
import {newGame} from '../src/shared/engine';
import type {GameState} from '../src/shared/game';
import type {ServerMsg} from '../src/shared/protocol';

const ver = (age: number, undo = 0, seq = 1, boot = 100): ViewVersion => ({age, undo, boot, seq});

describe('view versions', () => {
  it('orders by server process, then the send sequence; the engine numbers do not decide', () => {
    expect(compareVersions(ver(5, 0, 1), ver(6, 0, 2))).toBeLessThan(0);
    // a repeated undo: the engine goes 14.1 -> 12.1, and the later send is still the newer view
    expect(compareVersions(ver(12, 1, 9), ver(14, 1, 8))).toBeGreaterThan(0);
    expect(compareVersions(ver(9, 0, 3), ver(3, 1, 4))).toBeLessThan(0);
    expect(compareVersions(ver(5, 0, 7), ver(5, 0, 8))).toBeLessThan(0); // same engine moment, later send
    expect(compareVersions(ver(5, 0, 900, 100), ver(5, 0, 1, 200))).toBeLessThan(0); // a restarted server starts its count again
    expect(compareVersions(ver(5, 0, 3), ver(5, 0, 3))).toBe(0);
  });
  it('isOlderVersion treats a missing version as not older', () => {
    expect(isOlderVersion(ver(4, 0, 1), ver(5, 0, 2))).toBe(true);
    expect(isOlderVersion(null, ver(5))).toBe(false);
    expect(isOlderVersion(ver(4), null)).toBe(false);
  });
  it('isOlderView uses the versions when both views carry one', () => {
    const view = (age: number) => ({role: 'player', playerId: 'a', model: {id: 'p1', game: {gameAge: age, undoCount: 0}}}) as unknown as FullView;
    // the same gameAge sent twice (a draft pick does not move it): the earlier send arriving last is dropped
    expect(isOlderView(view(5), view(5), ver(5, 0, 3), ver(5, 0, 4))).toBe(true);
    expect(isOlderView(view(5), view(5), ver(5, 0, 5), ver(5, 0, 4))).toBe(false);
    // without versions (an older server) gameAge alone decides, as before
    expect(isOlderView(view(5), view(5))).toBe(false);
    expect(isOlderView(view(4), view(5))).toBe(true);
  });
  it('tags a version as v<gameAge>.<undo>', () => {
    expect(versionTag(ver(212, 1))).toBe('v212.1');
    expect(versionTag(null)).toBe('v–');
  });
  it('a batch is a consistent cut only when every model shares gameAge and undoCount', () => {
    const m = (gameAge: number, undoCount = 0) => ({game: {gameAge, undoCount}});
    expect(consistentCut([m(5), m(5), m(5)])).toBe(true);
    expect(consistentCut([m(5), m(6)])).toBe(false);
    expect(consistentCut([m(5, 0), m(5, 1)])).toBe(false);
    expect(consistentCut([])).toBe(true);
  });
});

describe('resync rate limits', () => {
  it('the server answers a burst of three, then one per second', () => {
    const l = new ResyncLimiter(1000, 3, 0);
    expect([l.allow(0), l.allow(10), l.allow(20), l.allow(30)]).toEqual([true, true, true, false]);
    expect(l.allow(500)).toBe(false);
    expect(l.allow(1100)).toBe(true);
    expect(l.allow(1200)).toBe(false);
    // a quiet spell refills the burst, never beyond it
    expect([l.allow(60000), l.allow(60001), l.allow(60002), l.allow(60003)]).toEqual([true, true, true, false]);
  });
  it('the client asks at most once per gap', () => {
    const p = new ResyncPlanner(1000, 1500);
    expect(p.mayAsk(0)).toBe(true);
    expect(p.mayAsk(1000)).toBe(false);
    expect(p.mayAsk(1500)).toBe(true);
  });
  it('the client is behind only once the version it heard has not arrived within the grace period', () => {
    const p = new ResyncPlanner(1000, 1500);
    expect(p.behind(ver(5), 0)).toBe(false); // nothing heard yet
    p.hear(ver(7, 0, 9), 1000);
    expect(p.behind(ver(5), 1500)).toBe(false); // still within the grace period (it may be on its way)
    expect(p.behind(ver(5), 2000)).toBe(true);
    expect(p.behind(ver(7, 0, 9), 2000)).toBe(false); // it arrived
    expect(p.behind(ver(8, 0, 10), 2000)).toBe(false); // something newer arrived
    expect(p.behind(null, 2000)).toBe(true); // nothing on screen at all
    // hearing the same version again keeps the first time; a newer one restarts the grace period
    p.hear(ver(7, 0, 9), 1900);
    expect(p.behind(ver(5), 2000)).toBe(true);
    p.hear(ver(8, 0, 11), 2000);
    expect(p.behind(ver(5), 2500)).toBe(false);
    expect(p.behind(ver(5), 3000)).toBe(true);
    p.hear(null, 3000);
    expect(p.behind(ver(5), 9000)).toBe(false);
  });
});

describe('hold deadlines', () => {
  it('a hold shows its numbers until the deadline and the latest view from then on', () => {
    const hold = {display: {megacredits: 10}, until: 5000};
    expect(heldValue(hold, 4999)).toEqual({megacredits: 10});
    expect(heldValue(hold, 5000)).toBeUndefined();
    // however late the check comes (a frozen page), past the deadline nothing is held
    expect(heldValue(hold, 5_000_000)).toBeUndefined();
    expect(heldValue(null, 0)).toBeUndefined();
  });
  it('a show is timed from its arrival, unless the server clock says it arrived late', () => {
    const show = {startAt: 10_700, serverNow: 10_000};
    // fresh: local clock 50 s ahead of the server, no offset known yet
    expect(showLocalStart(show, 60_000, null)).toBe(60_700);
    // fresh with a known offset (server - local = -50 000): the same
    expect(showLocalStart(show, 60_000, -50_000)).toBe(60_700);
    // delivered 30 s late (the phone slept): timed from the server clock, so it is long over
    expect(showLocalStart(show, 90_000, -50_000)).toBe(60_700);
    // a little network delay is not lateness
    expect(showLocalStart(show, 60_400, -50_000)).toBe(61_100);
  });
});

// ---- the bridge -----------------------------------------------------------------------------------------------
type Sock = {name: string; readyState: number; ping?: () => void; on?: () => void; terminate?: () => void};
const sock = (name: string): Sock => ({name, readyState: 1});

function table(): GameState {
  const s = newGame('g');
  return {...s, mode: 'full', phase: 'full' as GameState['phase'], players: [{id: 'a', name: 'Ana', color: 'red'}] as GameState['players'],
    full: {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red'}}}} as GameState;
}

/** An engine whose gameAge moves when told to; each request can be scripted to see a given age. */
function engine(ages: {spectator: number[]; player: number[]}) {
  const spec = (age: number) => ({id: 's1', color: 'neutral', game: {gameAge: age, undoCount: 0, generation: 1, phase: 'action'}, players: []}) as unknown as SpectatorModel;
  const player = (age: number) => ({id: 'pa', color: 'red', game: {gameAge: age, undoCount: 0, generation: 1, phase: 'action'}, thisPlayer: {}, players: []}) as unknown as PlayerViewModel;
  const calls = {spectator: 0, player: 0};
  const e = {
    spectator: async () => spec(ages.spectator[Math.min(calls.spectator++, ages.spectator.length - 1)]),
    player: async () => player(ages.player[Math.min(calls.player++, ages.player.length - 1)]),
    logs: async () => [],
  } as unknown as EngineClient;
  return {e, calls};
}

function bridgeWith(e: EngineClient, sockets: Sock[]) {
  const sent: Array<{to: string; msg: ServerMsg}> = [];
  const b = new FullBridge(e, table, () => sockets as never, (ws, msg) => sent.push({to: (ws as unknown as Sock).name, msg}), 60000, null, 60000);
  b.stop();
  return {b, sent};
}

describe('push batches', () => {
  it('refetches a batch whose views disagree on gameAge, then sends one consistent cut with versions', async () => {
    // the spectator is read at 5, the player at 6 (a move landed in between); the second round agrees at 6
    const {e, calls} = engine({spectator: [5, 6], player: [6, 6]});
    const tv = sock('tv'); const phone = sock('phone');
    const {b, sent} = bridgeWith(e, [tv, phone]);
    b.hello(tv as never, {role: 'tv', playerId: null});
    b.hello(phone as never, {role: 'phone', playerId: 'a'});
    await b.pushAll();
    sent.length = 0;
    calls.spectator = 0; calls.player = 0;
    await b.pushAll();
    const views = sent.filter((x) => x.msg.type === 'full').map((x) => ({to: x.to, msg: x.msg as Extract<ServerMsg, {type: 'full'}>}));
    expect(views.map((x) => [x.to, x.msg.view.model.game.gameAge])).toEqual([['tv', 6], ['phone', 6]]);
    expect(views.every((x) => x.msg.v?.age === 6)).toBe(true);
    expect(b.syncStats.refetches).toBeGreaterThanOrEqual(1);
  });
  it('gives up refetching after a bounded number of tries and still sends', async () => {
    const {e} = engine({spectator: [1, 2, 3, 4, 5, 6], player: [9]});
    const phone = sock('phone');
    const {b, sent} = bridgeWith(e, [phone]);
    b.hello(phone as never, {role: 'phone', playerId: 'a'});
    await b.pushAll();
    expect(b.syncStats.uncut).toBe(1);
    expect(sent.filter((x) => x.msg.type === 'full').length).toBeGreaterThan(0);
  });
  it('numbers every send, and the view sent on hello waits its turn behind a batch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let age = 5;
    const spec = (a: number) => ({id: 's1', game: {gameAge: a, undoCount: 0, generation: 1, phase: 'action'}, players: []}) as unknown as SpectatorModel;
    const e = {
      // the batch's spectator fetch is slow; the hello's fetch would be fast if it were allowed to overtake
      spectator: async () => { const a = age; if (a === 5) await gate; return spec(a); },
      player: async () => ({id: 'pa', game: {gameAge: age, undoCount: 0}, thisPlayer: {}, players: []}),
      logs: async () => [],
    } as unknown as EngineClient;
    const tv = sock('tv');
    const {b, sent} = bridgeWith(e, [tv]);
    const batch = b.pushAll();
    age = 6;
    // the TV says hello while the batch is still fetching an older moment
    b.hello(tv as never, {role: 'tv', playerId: null});
    release();
    await batch;
    await b.pushTo(tv as never);
    const seqs = sent.filter((x) => x.msg.type === 'full').map((x) => (x.msg as Extract<ServerMsg, {type: 'full'}>).v!);
    // in order on the wire: every later send has a later version
    for (let i = 1; i < seqs.length; i++) expect(compareVersions(seqs[i], seqs[i - 1])).toBeGreaterThan(0);
    expect(b.versionOf(tv as never)).toEqual(seqs.at(-1));
  });
});

describe('quiet engine changes', () => {
  const model = (age: number, mc: number) => ({game: {gameAge: age, undoCount: 0, phase: 'action', generation: 2},
    players: [{color: 'red', megacredits: mc, terraformRating: 20, tableau: [{name: 'x'}]}]});
  it('the fingerprint changes with a number on screen even when gameAge does not', () => {
    expect(modelFingerprint(model(46, 8))).not.toBe(modelFingerprint(model(46, 0)));
    expect(modelFingerprint(model(46, 8))).toBe(modelFingerprint(model(46, 8)));
    expect(modelFingerprint(model(47, 8))).not.toBe(modelFingerprint(model(46, 8)));
  });
  it('the poll pushes a change the engine made without moving gameAge', async () => {
    let mc = 8;
    const e = {
      spectator: async () => ({id: 's1', game: {gameAge: 46, undoCount: 0, generation: 2, phase: 'action'}, players: [{color: 'red', megacredits: mc, tableau: []}]}),
      player: async () => ({id: 'pa', game: {gameAge: 46, undoCount: 0}, thisPlayer: {}, players: []}),
      logs: async () => [],
    } as unknown as EngineClient;
    const tv = sock('tv');
    const {b, sent} = bridgeWith(e, [tv]);
    b.hello(tv as never, {role: 'tv', playerId: null});
    const poll = () => (b as unknown as {poll: () => Promise<void>}).poll();
    await poll();
    const n = sent.filter((x) => x.msg.type === 'full').length;
    await poll(); // nothing changed: no push
    expect(sent.filter((x) => x.msg.type === 'full').length).toBe(n);
    mc = 0; // the card's cost is taken; the log line (and gameAge) come later
    await poll();
    const views = sent.filter((x) => x.msg.type === 'full').map((x) => (x.msg as Extract<ServerMsg, {type: 'full'}>).view.model);
    expect(views.length).toBe(n + 1);
    expect((views.at(-1) as unknown as SpectatorModel).players[0].megacredits).toBe(0);
  });
});

describe('batch coalescing', () => {
  it('requests made while a batch waits share it, and every caller resolves after a fetch made after its request', async () => {
    let release!: () => void;
    let gate: Promise<void> | null = null;
    let age = 1;
    let fetches = 0;
    const e = {
      spectator: async () => { fetches++; if (gate) { const g = gate; gate = null; await g; } return {id: 's1', game: {gameAge: age, undoCount: 0, generation: 1, phase: 'action'}, players: []}; },
      player: async () => ({id: 'pa', game: {gameAge: age, undoCount: 0}, thisPlayer: {}, players: []}),
      logs: async () => [],
    } as unknown as EngineClient;
    const tv = sock('tv');
    const {b, sent} = bridgeWith(e, [tv]);
    b.hello(tv as never, {role: 'tv', playerId: null});
    await b.pushTo(tv as never);
    gate = new Promise<void>((r) => { release = r; });
    const before = fetches;
    const first = b.pushAll();
    // wait until the first batch is fetching (and held at the engine)
    while (fetches === before) await new Promise((r) => setTimeout(r, 1));
    // five moves land meanwhile: they share one queued batch
    const later: Array<Promise<void>> = [];
    for (let i = 0; i < 5; i++) { age = 2 + i; later.push(b.pushAll()); }
    expect(new Set(later).size).toBe(1);
    expect(later[0]).not.toBe(first);
    release();
    await Promise.all([first, ...later]);
    // the shared batch fetched after the last move: the screen ends on it
    const views = sent.filter((x) => x.msg.type === 'full').map((x) => (x.msg as Extract<ServerMsg, {type: 'full'}>).view.model.game.gameAge);
    expect(views.at(-1)).toBe(6);
    expect(b.syncStats.batches).toBe(2);
    expect(b.syncStats.shared).toBe(4);
    // a request after the shared batch has started gets a batch of its own
    age = 7;
    await b.pushAll();
    expect(b.syncStats.batches).toBe(3);
  });
});

describe('heartbeat and resync', () => {
  it('each socket hears the version last sent to it', async () => {
    const {e} = engine({spectator: [7], player: [7]});
    const tv = sock('tv'); const fresh = sock('fresh');
    const {b, sent} = bridgeWith(e, [tv]);
    b.hello(tv as never, {role: 'tv', playerId: null});
    await b.pushAll();
    sent.length = 0;
    (b as unknown as {sockets: () => Sock[]}).sockets = () => [tv, fresh];
    (b as unknown as {heartbeat: () => void}).heartbeat();
    const beats = sent.filter((x) => x.msg.type === 'version').map((x) => [x.to, (x.msg as Extract<ServerMsg, {type: 'version'}>).v?.age ?? null]);
    expect(beats).toEqual([['tv', 7], ['fresh', null]]);
  });
  it('serves a burst of resyncs, then answers with the version only', async () => {
    const {e} = engine({spectator: [3], player: [3]});
    const tv = sock('tv');
    const {b, sent} = bridgeWith(e, [tv]);
    b.hello(tv as never, {role: 'tv', playerId: null});
    await b.pushTo(tv as never);
    sent.length = 0;
    for (let i = 0; i < 6; i++) b.resync(tv as never);
    await b.pushTo(tv as never); // let the queue drain
    const fulls = sent.filter((x) => x.msg.type === 'full').length;
    const versions = sent.filter((x) => x.msg.type === 'version').length;
    expect(b.syncStats.resyncs).toBe(3);
    expect(b.syncStats.refused).toBe(3);
    expect(fulls).toBe(4); // three resyncs and the explicit push
    expect(versions).toBe(3);
  });
  it('closes a socket that stops answering pings', () => {
    const {e} = engine({spectator: [1], player: [1]});
    let terminated = false; let pings = 0;
    const dead: Sock = {name: 'dead', readyState: 1, ping: () => { pings++; }, on: () => {}, terminate: () => { terminated = true; }};
    const {b} = bridgeWith(e, [dead]);
    const beat = () => (b as unknown as {heartbeat: () => void}).heartbeat();
    for (let i = 0; i < FullBridge.DEAD_AFTER_PINGS; i++) beat();
    expect(terminated).toBe(false);
    beat();
    expect(terminated).toBe(true);
    expect(pings).toBe(FullBridge.DEAD_AFTER_PINGS);
  });
});
