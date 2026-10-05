// Player names: a seat renamed on a phone (its profile edited mid-game) is the name every screen and every server text
// uses from then on, although the engine keeps the name from game creation (src/shared/names.ts).
import {describe, expect, it} from 'vitest';
import {apply, newGame} from '../src/shared/engine';
import type {GameState} from '../src/shared/game';
import type {LogLine, PlayerViewModel, SpectatorModel} from '../src/shared/full';
import type {ServerMsg} from '../src/shared/protocol';
import type {GameHistory} from '../src/shared/history';
import type {Notice} from '../src/shared/notices';
import {noticeText} from '../src/shared/notices';
import {displayName, nameResolver, namesKey, relabelById, relabelFeed, relabelHistory, relabelModel, relabelRows, relabelView, seatNames} from '../src/shared/names';
import {FullBridge} from '../src/server/full/bridge';
import type {EngineClient} from '../src/server/full/engine';
import {HistoryKeeper} from '../src/server/full/history';
import {detectFull, newMemory} from '../src/server/narrator/detect';
import {buildMessages} from '../src/server/narrator/prompt';
import {plain, segments} from '../src/client/phone/full/logMoves';
import {msg as messageText} from '../src/client/phone/full/model';
import {buildSummary} from '../src/shared/away';
import playerFixture from './fixtures/full/player-action.json';
import spectatorFixture from './fixtures/full/spectator.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A full game at the table: Ada (red) and NOVA (blue); the engine was created with those names. */
function table(): GameState {
  let s = newGame('g');
  s = apply(s, {t: 'join', playerId: 'a', name: 'Ada', color: 'red'}).state;
  s = apply(s, {t: 'join', playerId: 'b', name: 'NOVA', color: 'blue'}).state;
  return {...s, mode: 'full', phase: 'full' as GameState['phase'],
    full: {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red'}, b: {engineId: 'pb', color: 'blue'}}}} as GameState;
}
const rename = (s: GameState, playerId: string, name: string) => {
  const p = s.players.find((x) => x.id === playerId)!;
  return apply(s, {t: 'rename', playerId, name, color: p.color}).state;
};

/** Engine models with NOVA's creation-time name, and NOVA holding the Terraformer milestone. */
function engineModels(age: number) {
  const spec = clone(spectatorFixture) as unknown as SpectatorModel;
  const view = clone(playerFixture) as unknown as PlayerViewModel;
  for (const m of [spec, view] as Array<SpectatorModel | PlayerViewModel>) {
    m.game.gameAge = age;
    for (const p of m.players) if (p.color === 'blue') p.name = 'NOVA';
    m.game.milestones = m.game.milestones.map((x, i) => (i === 0 && age >= 15 ? {...x, color: 'blue' as const, playerName: 'NOVA'} : x));
  }
  return {spec, view};
}

describe('seat names', () => {
  it('maps colours (the engine colour in full games) and playerIds to the seat record', () => {
    const s = table();
    s.full!.players.b.color = 'green'; // the engine gave b another colour than the lobby
    const n = seatNames(s);
    expect(n.byId).toEqual({a: 'Ada', b: 'NOVA'});
    expect(n.byColor).toEqual({red: 'Ada', green: 'NOVA'});
    expect(displayName(n, 'green')).toBe('NOVA');
    expect(displayName(n, 'b')).toBe('NOVA');
    // an engine-only seat (the solo neutral player) keeps the engine's name; unknown and empty keys fall back
    expect(displayName(n, 'neutral', 'Neutral')).toBe('Neutral');
    expect(displayName(n, 'pink')).toBe('pink');
    expect(displayName(n, null, 'x')).toBe('x');
    expect(nameResolver(n)('red', 'Engine')).toBe('Ada');
  });
  it('a rename changes the key; the same names give the same key', () => {
    const s = table();
    expect(namesKey(seatNames(s))).toBe(namesKey(seatNames(clone(s))));
    expect(namesKey(seatNames(rename(s, 'b', 'Nova')))).not.toBe(namesKey(seatNames(s)));
  });
  it('mid-game, a rename keeps the seat colour and refuses a name already at the table', () => {
    const s = table();
    const r = apply(s, {t: 'rename', playerId: 'b', name: '  Nova Lane ', color: 'yellow'}).state;
    expect(r.players.find((p) => p.id === 'b')).toMatchObject({name: 'Nova Lane', color: 'blue'});
    expect(() => apply(s, {t: 'rename', playerId: 'b', name: 'ada', color: 'blue'})).toThrow(/already at the table/);
    // in the lobby the colour still changes with it
    const lobby = apply(apply(newGame('l'), {t: 'join', playerId: 'a', name: 'Ada', color: 'red'}).state, {t: 'rename', playerId: 'a', name: 'Ada', color: 'green'}).state;
    expect(lobby.players[0].color).toBe('green');
  });
});

describe('relabelling', () => {
  const after = seatNames(rename(table(), 'b', 'Nova'));
  it('engine models: every player, the seat itself and milestone owners; unchanged models stay the same object', () => {
    const {view} = engineModels(15);
    view.color = 'blue'; view.thisPlayer = {...view.players.find((p) => p.color === 'blue')!};
    const r = relabelModel(view, after);
    expect(r.players.map((p) => p.name)).toEqual(['Ada', 'Nova']);
    expect(r.thisPlayer.name).toBe('Nova');
    expect(r.game.milestones[0].playerName).toBe('Nova');
    expect(view.players[1].name).toBe('NOVA'); // not mutated
    expect(relabelModel(r, after)).toBe(r);
    const v = {role: 'player' as const, playerId: 'b', model: view, lastMove: {playerId: 'b', name: 'NOVA'}};
    expect(relabelView(v, after).lastMove?.name).toBe('Nova');
  });
  it('the story, notices, shows and notices by playerId', () => {
    const h = {players: [{color: 'red', name: 'Ada'}, {color: 'blue', name: 'NOVA', corporation: 'Ecoline'}]} as GameHistory;
    expect(relabelHistory(h, after).players[1]).toEqual({color: 'blue', name: 'Nova', corporation: 'Ecoline'});
    expect(relabelHistory(relabelHistory(h, after), after)).toEqual(relabelHistory(h, after));
    expect(relabelById({playerId: 'b', name: 'NOVA', color: 'blue'}, after).name).toBe('Nova');
    expect(relabelById({playerId: null, name: 'NOVA', color: 'blue'}, after).name).toBe('Nova');
    const show = {players: [{playerId: 'b', name: 'NOVA', color: 'blue' as const}]};
    expect(relabelRows(show, after).players[0].name).toBe('Nova');
  });
});

describe('formatters with a renamed seat', () => {
  const s = rename(table(), 'b', 'Nova');
  const n = seatNames(s);
  it('notices: an entry stored with the old name (format before the rename) reads with the new one', () => {
    const old: Notice = {id: 'x', kind: 'hit', at: 1, generation: 3, age: 10, undo: 0, by: 'blue', byName: 'NOVA', cause: {how: 'played', card: 'Herbivores'} as Notice['cause'],
      changes: [{what: 'stock', resource: 'plants', amount: 3, stolen: false} as Notice['changes'][number]], sticky: true};
    expect(noticeText(old).title).toContain('NOVA'); // what the phone showed before the fix
    const feed = relabelFeed({gameId: 'e1', playerId: 'a', notices: [old, {...old, id: 'y', by: null, byName: null}], seenAt: 0}, n);
    expect(noticeText(feed.notices[0]).title).toBe('Nova removed 3 of your plants with Herbivores');
    expect(feed.notices[1].byName).toBeNull(); // nobody named stays unnamed
  });
  it('log lines name players by colour: the phone log and the engine messages read the seat name', () => {
    const line: LogLine = {message: '${0} played ${1}', data: [{type: 2, value: 'blue'}, {type: 3, value: 'Comet'}], timestamp: 1};
    expect(plain(segments(line), (c) => displayName(n, c))).toBe('Nova played Comet');
    const {view} = engineModels(14);
    expect(messageText(relabelModel(view, n), {message: 'Pass the rest to ${0}', data: [{type: 2, value: 'blue'}]})).toBe('Pass the rest to Nova');
  });
  it('the away journal names players from the seats', () => {
    const at = 1000;
    const summary = buildSummary([{kind: 'card', at, by: 'blue', card: 'Comet'}], {id: 'x', since: 0, until: 2000, me: 'red',
      players: s.players.map((p) => ({color: p.color as 'red', name: p.name})), turn: {who: null, mine: false, phase: null}});
    expect(JSON.stringify(summary)).toContain('Nova');
    expect(JSON.stringify(summary)).not.toContain('NOVA');
  });
});

// ---- the bridge: rename a seat mid-game ------------------------------------------------------------------------
type Sock = {name: string; readyState: number};
const sock = (name: string): Sock => ({name, readyState: 1});

describe('a rename mid-game reaches every device and every server text', () => {
  it('views, the story, the narrator context and the next moments use the new name', async () => {
    let state = table();
    let age = 14;
    const engine = {
      spectator: async () => engineModels(age).spec,
      player: async (id: string) => { const v = engineModels(age).view; if (id === 'pb') { v.color = 'blue'; v.thisPlayer = clone(v.players.find((p) => p.color === 'blue')!); } return v; },
      logs: async () => [{message: '${0} played ${1}', data: [{type: 2, value: 'blue'}, {type: 3, value: 'Comet'}], timestamp: 1}],
    } as unknown as EngineClient;
    const saved: Record<string, GameHistory> = {};
    const keeper = new HistoryKeeper({loadHistory: (id) => saved[id] ?? null, saveHistory: (id, h) => { saved[id] = clone(h); }});
    const tv = sock('tv'); const phoneA = sock('a'); const phoneB = sock('b');
    const sent: Array<{to: string; msg: ServerMsg}> = [];
    const b = new FullBridge(engine, () => state, () => [tv, phoneA, phoneB] as never, (ws, m) => sent.push({to: (ws as unknown as Sock).name, msg: m}), 60000, keeper, 60000);
    b.stop();
    const observed: Array<{prev: SpectatorModel | null; next: SpectatorModel; history: GameHistory | null}> = [];
    b.onObserve = (_g, prev, next, history) => observed.push({prev, next, history});
    b.hello(tv as never, {role: 'tv', playerId: null});
    b.hello(phoneA as never, {role: 'phone', playerId: 'a'});
    b.hello(phoneB as never, {role: 'phone', playerId: 'b'});
    await b.pushAll();
    const names = (to: string) => {
      const v = sent.filter((x) => x.to === to && x.msg.type === 'full').at(-1)!.msg as Extract<ServerMsg, {type: 'full'}>;
      return v.view.model.players.map((p) => p.name);
    };
    expect(names('tv')).toEqual(['Ada', 'NOVA']);

    // NOVA edits her profile on her phone: the server renames her seat (a command) and tells the bridge
    state = rename(state, 'b', 'Nova');
    sent.length = 0;
    await b.renamed();
    // every device gets fresh views with the new name, without a move: the TV, the other phone's table, her own seat
    expect(names('tv')).toEqual(['Ada', 'Nova']);
    expect(names('a')).toEqual(['Ada', 'Nova']);
    const own = sent.filter((x) => x.to === 'b' && x.msg.type === 'full').at(-1)!.msg as Extract<ServerMsg, {type: 'full'}>;
    expect((own.view.model as PlayerViewModel).thisPlayer.name).toBe('Nova');
    // the story is sent again with the new name
    const story = sent.filter((x) => x.to === 'tv' && x.msg.type === 'history').at(-1)!.msg as Extract<ServerMsg, {type: 'history'}>;
    expect(story.history.players.find((p) => p.color === 'blue')?.name).toBe('Nova');

    // the next moment: NOVA claims Terraformer. Mission control's facts and prompt, and the milestone label, say Nova.
    age = 15;
    await b.pushAll();
    const last = observed.at(-1)!;
    expect(last.next.game.milestones[0].playerName).toBe('Nova');
    expect(last.history?.players.find((p) => p.color === 'blue')?.name).toBe('Nova');
    const events = detectFull(newMemory('e1'), last.prev, last.next, last.history, 1);
    const claim = events.find((e) => e.kind === 'milestone')!;
    expect(claim.facts[0]).toBe('Nova claimed the Terraformer milestone.');
    const prompt = JSON.stringify(buildMessages(claim, state.players.map((p) => p.name), []));
    expect(prompt).toContain('Nova');
    expect(prompt).not.toContain('NOVA');
    // the persisted story follows too (the stored name of game creation is replaced on the next observation)
    expect(keeper.get('e1').players.find((p) => p.color === 'blue')?.name).toBe('Nova');
    (keeper as unknown as {flush(): void}).flush(); // the debounced save, now
    expect(saved.e1.players.find((p) => p.color === 'blue')?.name).toBe('Nova');
    // the log the phones render names the player by colour, resolved to the seat
    const view = sent.filter((x) => x.to === 'a' && x.msg.type === 'full').at(-1)!.msg as Extract<ServerMsg, {type: 'full'}>;
    const line = view.view.logs![0];
    expect(plain(segments(line), (c) => displayName(seatNames(state), c, view.view.model.players.find((p) => p.color === c)?.name))).toBe('Nova played Comet');
  });
});
