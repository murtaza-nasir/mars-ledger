// Taking moves back: "Back" out of your own move's follow-up questions, and undo through bot moves. The rules
// (planBack, planBotUndo) are pure; the bridge is driven against a small engine that saves the way the real one does
// (one save each time a turn menu opens) and answers load_game like the real one (drop N saves, reload the newest).
import {describe, expect, it} from 'vitest';
import {atTarget, botMovesText, undoNoticeText, DREW_CARDS_TEXT, isTurnMenuQuestion, menuChoice, moveSubject, NEW_GENERATION_TEXT, planBack, planBotUndo, seenOf,
  undoWindowText} from '../src/shared/sync';
import type {MoveRecord, SeatNow, ViewVersion} from '../src/shared/sync';
import {isOlderView} from '../src/shared/full';
import type {FullView, InputResponse, PlayerViewModel, SpectatorModel} from '../src/shared/full';
import {BACK_GONE_TEXT, FullBridge, InputRefused} from '../src/server/full/bridge';
import type {Rewind, TakeBack} from '../src/server/full/bridge';
import type {EngineClient} from '../src/server/full/engine';
import {newGame} from '../src/shared/engine';
import type {GameState} from '../src/shared/game';
import type {ServerMsg} from '../src/shared/protocol';
import {BotDesk} from '../src/server/full/bots/runner';

// ---- the rules -------------------------------------------------------------------------------------------------
const pre = (age: number, acts = 0, hand: string[] = ['Hired Raiders'], generation = 1) => ({age, generation, acts, hand});
const mv = (playerId: string, kind: MoveRecord['kind'], o: Partial<MoveRecord> = {}): MoveRecord => ({playerId, name: NAMES[playerId], color: COLORS[playerId],
  bot: playerId.startsWith('bot'), kind, midAfter: false, ...o});
const NAMES: Record<string, string> = {a: 'Ana', b: 'Vera', bot1: 'Ares', bot2: 'Deimos'};
const COLORS: Record<string, string> = {a: 'red', b: 'blue', bot1: 'green', bot2: 'yellow'};
const now = (o: Partial<SeatNow> = {}): SeatNow => ({question: true, menu: false, phase: 'action', generation: 1, active: true, hand: [], ...o});

describe('the turn menu and its answers', () => {
  const menu = {type: 'or', title: {message: 'Take your next action'}, options: [{title: 'Play project card'}, {title: 'End Turn'}, {title: 'Pass for this generation'}]};
  it('knows the turn menu by its title', () => {
    expect(isTurnMenuQuestion(menu)).toBe(true);
    expect(isTurnMenuQuestion({type: 'or', title: 'Select one option', options: []})).toBe(false);
    expect(isTurnMenuQuestion(undefined)).toBe(false);
    // a corporation's first action is offered on a menu of its own, saved like the turn menu
    expect(isTurnMenuQuestion({type: 'or', title: 'Select one option', options: [{title: {message: 'Take first action of ${0} corporation'}}, {title: 'Pass for this generation'}]})).toBe(true);
  });
  it('names the chosen option: an action, End Turn, or a pass', () => {
    expect(menuChoice(menu, {type: 'or', index: 0, response: {type: 'option'}})).toBe('action');
    expect(menuChoice(menu, {type: 'or', index: 1, response: {type: 'option'}})).toBe('end');
    expect(menuChoice(menu, {type: 'or', index: 2, response: {type: 'option'}})).toBe('pass');
  });
  it('finds the card a move played or used', () => {
    expect(moveSubject({type: 'or', index: 0, response: {type: 'projectCard', card: 'Hired Raiders', payment: {}}})).toEqual({card: 'Hired Raiders', play: true});
    expect(moveSubject({type: 'or', index: 1, response: {type: 'card', cards: ['Predators']}})).toEqual({card: 'Predators', play: false});
    expect(moveSubject({type: 'or', index: 2, response: {type: 'option'}})).toBeNull();
  });
});

describe('planBack: leaving your own move during its follow-up questions', () => {
  it('goes back to the save the move started from while the move is open', () => {
    const moves = [mv('a', 'action', {pre: pre(11), midAfter: true, what: {card: 'Hired Raiders', play: true}})];
    expect(planBack(moves, 'a', now())).toEqual({ok: true, target: pre(11), what: {card: 'Hired Raiders', play: true}});
    // a follow-up answered and another one open: still the same move
    const two = [...moves, mv('a', 'followUp', {midAfter: true})];
    expect(planBack(two, 'a', now())).toMatchObject({ok: true, target: pre(11)});
  });
  it('is not offered on the turn menu, outside the action phase, to someone else, or once the move is done', () => {
    const moves = [mv('a', 'action', {pre: pre(11), midAfter: true})];
    expect(planBack(moves, 'a', now({menu: true}))).toBeNull();
    expect(planBack(moves, 'a', now({phase: 'research'}))).toBeNull();
    expect(planBack(moves, 'a', now({active: false}))).toBeNull();
    expect(planBack(moves, 'b', now())).toBeNull();
    expect(planBack([...moves, mv('a', 'followUp', {midAfter: false})], 'a', now())).toBeNull();
    expect(planBack([], 'a', now())).toBeNull();
  });
  it('is refused when the move drew cards (the deck would be shown)', () => {
    const moves = [mv('a', 'action', {pre: pre(11, 0, ['Ants']), midAfter: true})];
    expect(planBack(moves, 'a', now({hand: ['Ants', 'Birds']}))).toEqual({ok: false, reason: DREW_CARDS_TEXT});
    expect(planBack(moves, 'a', now({hand: []}))).toMatchObject({ok: true});
  });
});

describe('planBotUndo: the undo window reaches through bot moves', () => {
  it('only bots moved since my move: take it back with their 2 moves; one engine save per finished turn-menu answer', () => {
    const moves = [mv('a', 'action', {pre: pre(10)}), mv('a', 'end', {pre: pre(13, 1)}), mv('bot1', 'action', {pre: pre(14)}), mv('bot1', 'action', {pre: pre(15, 1)})];
    // End Turn alone changes nothing: the target is the save before Ana's action
    expect(planBotUndo(moves, 'a', {phase: 'action', generation: 1})).toEqual({ok: true, target: {...pre(10), color: 'red'}, bots: 2, botNames: ['Ares'], steps: 4});
  });
  it('a bot still answering its follow-ups has made no save yet', () => {
    const moves = [mv('a', 'action', {pre: pre(10)}), mv('bot1', 'action', {pre: pre(12), midAfter: true}), mv('bot1', 'followUp', {midAfter: true})];
    expect(planBotUndo(moves, 'a', {phase: 'action', generation: 1})).toMatchObject({ok: true, bots: 1, steps: 1});
  });
  it('my move with its follow-ups, then two bots (one passed): the follow-ups belong to the move', () => {
    const moves = [mv('a', 'action', {pre: pre(10), midAfter: true}), mv('a', 'followUp'), mv('bot1', 'action', {pre: pre(14)}), mv('bot2', 'pass', {pre: pre(16)})];
    expect(planBotUndo(moves, 'a', {phase: 'action', generation: 1})).toMatchObject({ok: true, bots: 2, botNames: ['Ares', 'Deimos'], steps: 3});
  });
  it('refused when another person moved in between, as before', () => {
    const moves = [mv('a', 'action', {pre: pre(10)}), mv('bot1', 'action', {pre: pre(12)}), mv('b', 'action', {pre: pre(13)}), mv('bot1', 'action', {pre: pre(15)})];
    expect(planBotUndo(moves, 'a', {phase: 'action', generation: 1})).toEqual({ok: false, code: 'undoWindow', reason: undoWindowText('Vera')});
  });
  it('refused once a new generation started', () => {
    const moves = [mv('a', 'pass', {pre: pre(10)}), mv('bot1', 'pass', {pre: pre(12)})];
    expect(planBotUndo(moves, 'a', {phase: 'research', generation: 2})).toEqual({ok: false, code: 'undoWindow', reason: NEW_GENERATION_TEXT});
  });
  it('does not apply when nobody moved after me (the engine\'s own Undo), or I have no move', () => {
    expect(planBotUndo([mv('a', 'action', {pre: pre(10)})], 'a', {phase: 'action', generation: 1})).toBeNull();
    expect(planBotUndo([mv('bot1', 'action', {pre: pre(10)})], 'a', {phase: 'action', generation: 1})).toBeNull();
  });
  it('knows when a rollback reached the target', () => {
    const m = {game: {gameAge: 10, generation: 1}, waitingFor: {type: 'or', title: 'Take your first action'}, thisPlayer: {color: 'red', actionsTakenThisRound: 0},
      players: [{color: 'red', isActive: true}]};
    expect(atTarget(m, {...pre(10), color: 'red'})).toBe(true);
    expect(atTarget({...m, game: {gameAge: 12, generation: 1}}, {...pre(10), color: 'red'})).toBe(false);
    expect(atTarget({...m, players: [{color: 'red', isActive: false}]}, {...pre(10), color: 'red'})).toBe(false);
    expect(botMovesText(1)).toBe('1 bot move');
    expect(botMovesText(2)).toBe('2 bot moves');
  });
});

// ---- an engine that saves like the real one ----------------------------------------------------------------------
type G = {age: number; gen: number; phase: string; active: string; acts: number; hands: Record<string, string[]>; mc: Record<string, number>;
  tiles: string[]; pending: string | null; passed: string[]};
const ORDER_DEFAULT = ['pa', 'pbot'];
const SEATS: Record<string, {name: string; color: string}> = {pa: {name: 'Ana', color: 'red'}, pb: {name: 'Vera', color: 'blue'}, pbot: {name: 'Ares', color: 'green'}};

class SaveEngine {
  g: G;
  saves: string[] = [];
  loads: number[] = [];
  constructor(readonly order = ORDER_DEFAULT) {
    this.g = {age: 10, gen: 1, phase: 'action', active: order[0], acts: 0, hands: Object.fromEntries(order.map((id) => [id, ['Hired Raiders', 'Research Grant']])),
      mc: Object.fromEntries(order.map((id) => [id, 20])), tiles: [], pending: null, passed: []};
    this.takeAction();
  }
  /** the engine saves whenever a turn menu opens */
  private takeAction() { this.saves.push(JSON.stringify(this.g)); }
  menu(id: string) {
    const g = this.g;
    if (g.pending === id) return {type: 'or', title: 'Select one option', options: [{type: 'option', title: 'Steal 3 M€'}, {type: 'option', title: 'Do not steal'}]};
    if (g.phase !== 'action' || g.active !== id || g.pending) return undefined;
    return {type: 'or', title: g.acts ? 'Take your next action' : 'Take your first action', options: [
      {type: 'projectCard', title: 'Play project card', cards: g.hands[id].map((name) => ({name}))}, {type: 'option', title: 'Place a city'},
      ...(g.acts ? [{type: 'option', title: 'End Turn'}] : []), {type: 'option', title: 'Pass for this generation'}]};
  }
  model(id: string) {
    const g = this.g;
    return {id, color: SEATS[id].color, game: {gameAge: g.age, undoCount: 0, generation: g.gen, phase: g.phase},
      thisPlayer: {name: SEATS[id].name, color: SEATS[id].color, actionsTakenThisRound: g.active === id ? g.acts : 0, megaCredits: g.mc[id]},
      cardsInHand: g.hands[id].map((name) => ({name})), waitingFor: this.menu(id),
      players: this.order.map((p) => ({color: SEATS[p].color, name: SEATS[p].name, isActive: g.active === p}))} as unknown as PlayerViewModel;
  }
  spectator() {
    const g = this.g;
    return {id: 's1', color: 'neutral', game: {gameAge: g.age, undoCount: 0, generation: g.gen, phase: g.phase, spaces: g.tiles.map((t) => ({id: t, tileType: 2, color: 'red'})),
      temperature: -30, oxygenLevel: 0, oceans: 0, milestones: [], awards: []},
    players: this.order.map((p) => ({color: SEATS[p].color, name: SEATS[p].name, isActive: g.active === p, megacredits: g.mc[p], terraformRating: 20, tableau: []}))} as unknown as SpectatorModel;
  }
  private next() {
    const g = this.g;
    const live = this.order.filter((p) => !g.passed.includes(p));
    if (!live.length) { g.gen++; g.phase = 'research'; g.passed = []; g.age++; return; }
    const i = this.order.indexOf(g.active);
    for (let k = 1; k <= this.order.length; k++) {
      const p = this.order[(i + k) % this.order.length];
      if (!g.passed.includes(p)) { g.active = p; break; }
    }
    g.acts = 0; g.age++;
    this.takeAction();
  }
  private finish() {
    this.g.acts++;
    if (this.g.acts >= 2) this.next(); else this.takeAction();
  }
  async input(id: string, r: InputResponse) {
    const w = this.menu(id) as {title: string; options: Array<{title: string}>} | undefined;
    if (!w) throw new Error('Not waiting for anything');
    const g = this.g;
    const rr = r as {type: 'or'; index: number; response: {type: string; card?: string}};
    if (g.pending === id) {
      if (rr.index === 0) { const victim = this.order.find((p) => p !== id)!; g.mc[victim] -= 3; g.mc[id] += 3; }
      g.pending = null; g.age++;
      this.finish();
      return this.model(id);
    }
    const title = w.options[rr.index]?.title;
    if (title === 'Play project card') {
      const card = rr.response.card!;
      g.hands[id] = g.hands[id].filter((c) => c !== card); g.mc[id] -= 1; g.age++;
      if (card === 'Research Grant') g.hands[id].push('Ants'); // draws a card, then asks
      g.pending = id;
    } else if (title === 'Place a city') { g.tiles.push(`t${g.age}`); g.age += 2; this.finish(); } else if (title === 'End Turn') this.next();
    else if (title?.startsWith('Pass')) { g.passed.push(id); this.next(); } else throw new Error('Invalid index');
    return this.model(id);
  }
  /** load_game: drop the newest n saves, reload the newest left (which saves again over itself) */
  async load(_gameId: string, n: number) {
    this.loads.push(n);
    if (n > 0) this.saves.splice(-n);
    this.g = JSON.parse(this.saves.at(-1)!);
    return {};
  }
  client(): EngineClient {
    return {player: async (id: string) => this.model(id), spectator: async () => this.spectator(), logs: async () => [],
      input: (id: string, r: InputResponse) => this.input(id, r), load: (gid: string, n: number) => this.load(gid, n)} as unknown as EngineClient;
  }
}

type Sock = {name: string; readyState: number};
const sock = (name: string): Sock => ({name, readyState: 1});
const PLAYER_OF: Record<string, string> = {pa: 'a', pb: 'b', pbot: 'bot1'};
function setup(order = ORDER_DEFAULT) {
  const e = new SaveEngine(order);
  const state = (): GameState => {
    const s = newGame('g');
    return {...s, mode: 'full', phase: 'full' as GameState['phase'],
      players: order.map((eid) => ({id: PLAYER_OF[eid], name: SEATS[eid].name, color: SEATS[eid].color, ...(eid === 'pbot' ? {bot: 'normal'} : {})})) as GameState['players'],
      full: {gameId: 'e1', spectatorId: 's1', players: Object.fromEntries(order.map((eid) => [PLAYER_OF[eid], {engineId: eid, color: SEATS[eid].color}]))}} as GameState;
  };
  const tv = sock('tv'); const pa = sock('phoneA');
  const sent: Array<{to: string; msg: ServerMsg}> = [];
  const b = new FullBridge(e.client(), state, () => [tv, pa] as never, (ws, msg) => sent.push({to: (ws as unknown as Sock).name, msg}), 60000, null, 60000);
  b.stop();
  b.hello(tv as never, {role: 'tv', playerId: null});
  b.hello(pa as never, {role: 'phone', playerId: 'a'});
  const held = (to: string) => {
    let cur: {view: FullView; v: ViewVersion} | null = null;
    for (const x of sent) {
      if (x.to !== to || x.msg.type !== 'full') continue;
      if (!cur || !isOlderView(x.msg.view, cur.view, x.msg.v, cur.v)) cur = {view: {...x.msg.view, v: x.msg.v}, v: x.msg.v!};
    }
    return cur!.view;
  };
  const seenBy = (to: string) => { const h = held(to); return seenOf(h.v, h.model as PlayerViewModel)!; };
  const idx = (id: string, title: string) => (e.menu(id) as {options: Array<{title: string}>}).options.findIndex((o) => o.title === title);
  const opt = (id: string, title: string): InputResponse => ({type: 'or', index: idx(id, title), response: {type: 'option'}});
  const play = (id: string, card: string): InputResponse => ({type: 'or', index: idx(id, 'Play project card'), response: {type: 'projectCard', card, payment: {} as never}});
  return {e, b, sent, held, seenBy, opt, play};
}

describe('Back through the bridge', () => {
  it('a card with a target question: Back puts it in the hand again, refunds it, shows the menu, and tells nobody', async () => {
    const t = setup();
    const rewinds: Rewind[] = []; const taken: TakeBack[] = [];
    t.b.onRewind = (r) => rewinds.push(r); t.b.onTakeBack = (x) => taken.push(x);
    await t.b.pushAll();
    await t.b.input('a', t.play('pa', 'Hired Raiders'), false, t.seenBy('phoneA'));
    // mid-move: Ana's phone offers Back, and every screen knows red is mid-move (the TV waits to announce the card)
    expect(t.held('phoneA').back).toEqual({ok: true, what: {card: 'Hired Raiders', play: true}});
    expect(t.held('phoneA').moving).toBe('red');
    expect(t.held('tv').moving).toBe('red');
    expect(t.e.g.mc.pa).toBe(19);
    const sentBefore = t.sent.length;
    await t.b.rewind('a', 'back', t.seenBy('phoneA'));
    expect(t.e.loads).toEqual([0]);
    const a = t.held('phoneA');
    expect((a.model as PlayerViewModel).cardsInHand.map((c) => c.name)).toContain('Hired Raiders');
    expect(t.e.g.mc.pa).toBe(20);
    expect(isTurnMenuQuestion((a.model as PlayerViewModel).waitingFor)).toBe(true);
    expect(a.back ?? null).toBeNull();
    expect(t.held('tv').moving).toBeNull();
    // a move nobody saw finish: no undo notice anywhere, and the story counts no undo
    expect(t.sent.slice(sentBefore).filter((x) => x.msg.type === 'fullUndo')).toEqual([]);
    expect(rewinds).toHaveLength(1);
    expect(rewinds[0]).toMatchObject({kind: 'back', notice: null, actor: 'red'});
    expect(taken).toEqual([{kind: 'back', playerId: 'a', bots: 0, steps: 0, humanTurn: true}]);
  });
  it('an answer to the old follow-up after Back is refused and never reaches the engine', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', t.play('pa', 'Hired Raiders'), false, t.seenBy('phoneA'));
    const old = t.seenBy('phoneA');
    await t.b.rewind('a', 'back', old);
    await expect(t.b.input('a', {type: 'or', index: 0, response: {type: 'option'}}, false, old)).rejects.toBeInstanceOf(InputRefused);
    expect(t.e.g.mc.pa).toBe(20);
  });
  it('a move that drew cards cannot be backed out of; a finished move has no Back', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', t.play('pa', 'Research Grant'), false, t.seenBy('phoneA'));
    expect(t.held('phoneA').back).toEqual({ok: false, reason: DREW_CARDS_TEXT});
    await expect(t.b.rewind('a', 'back', t.seenBy('phoneA'))).rejects.toMatchObject({code: 'undoWindow', message: DREW_CARDS_TEXT});
    await t.b.input('a', {type: 'or', index: 1, response: {type: 'option'}}, false, t.seenBy('phoneA'));
    expect(t.held('phoneA').back ?? null).toBeNull();
    await expect(t.b.rewind('a', 'back', t.seenBy('phoneA'))).rejects.toMatchObject({code: 'stale', message: BACK_GONE_TEXT});
    expect(t.e.loads).toEqual([]);
  });
});

describe('undo through bot moves, through the bridge', () => {
  it('takes back my move and the bot\'s two moves, one save at a time, and every screen says so', async () => {
    const t = setup();
    const rewinds: Rewind[] = []; const taken: TakeBack[] = [];
    t.b.onRewind = (r) => rewinds.push(r); t.b.onTakeBack = (x) => taken.push(x);
    await t.b.pushAll();
    const start = JSON.stringify(t.e.g);
    await t.b.input('a', t.opt('pa', 'Place a city'), false, t.seenBy('phoneA'));
    await t.b.input('a', t.opt('pa', 'End Turn'), false, t.seenBy('phoneA'));
    await t.b.input('bot1', t.opt('pbot', 'Place a city'), true);
    await t.b.input('bot1', t.opt('pbot', 'Place a city'), true);
    expect(t.e.g.active).toBe('pa');
    expect(t.held('phoneA').undoMine).toEqual({ok: true, bots: 2});
    await t.b.rewind('a', 'undo', t.seenBy('phoneA'));
    expect(t.e.loads).toEqual([1, 1, 1, 1]);
    expect(JSON.stringify(t.e.g)).toBe(start);
    const notices = t.sent.filter((x) => x.msg.type === 'fullUndo');
    expect(notices.map((x) => x.to).sort()).toEqual(['phoneA', 'tv']);
    expect(notices[0].msg).toMatchObject({notice: {name: 'Ana', bots: 2}});
    expect(taken).toEqual([{kind: 'bots', playerId: 'a', bots: 2, steps: 4, humanTurn: true}]);
    expect(rewinds[0].actors).toEqual(['red', 'green']);
    expect(t.held('phoneA').undoMine ?? null).toBeNull();
  });
  it('is refused when another person moved in between', async () => {
    const t = setup(['pa', 'pb', 'pbot']);
    await t.b.pushAll();
    await t.b.input('a', t.opt('pa', 'Place a city'), false, t.seenBy('phoneA'));
    await t.b.input('a', t.opt('pa', 'End Turn'), false, t.seenBy('phoneA'));
    await t.b.input('b', t.opt('pb', 'Place a city'), false);
    await t.b.input('b', t.opt('pb', 'End Turn'), false);
    await t.b.input('bot1', t.opt('pbot', 'Place a city'), true);
    expect(t.held('phoneA').undoMine).toEqual({ok: false, reason: undoWindowText('Vera')});
    await expect(t.b.rewind('a', 'undo', t.seenBy('phoneA'))).rejects.toMatchObject({code: 'undoWindow'});
    expect(t.e.loads).toEqual([]);
  });
  it('is refused after the generation ended', async () => {
    const t = setup();
    await t.b.pushAll();
    await t.b.input('a', t.opt('pa', 'Pass for this generation'), false, t.seenBy('phoneA'));
    await t.b.input('bot1', t.opt('pbot', 'Pass for this generation'), true);
    expect(t.e.g.phase).toBe('research');
    await expect(t.b.rewind('a', 'undo', t.seenBy('phoneA'))).rejects.toMatchObject({message: NEW_GENERATION_TEXT});
    expect(t.e.loads).toEqual([]);
  });
});

describe('the bot desk holds after an undo through bot moves', () => {
  it('no bot move while held; a person\'s move releases them', async () => {
    const inputs: InputResponse[] = [];
    const desk = new BotDesk({
      player: async () => ({game: {gameAge: 1, undoCount: 0, phase: 'action', generation: 1}, thisPlayer: {color: 'green'}, cardsInHand: [],
        waitingFor: {type: 'or', title: 'Take your first action', buttonLabel: '', options: [{type: 'option', title: 'Pass for this generation', buttonLabel: ''}]}} as unknown as PlayerViewModel),
      table: () => ({gameId: 'e1', bots: [{playerId: 'bot1', name: 'Ares', level: 'easy', engineId: 'pbot', color: 'green'}]}),
      input: async (_id, r) => { inputs.push(r); },
      delayScale: 0, tickMs: 30, rng: () => 0.5,
    });
    desk.hold(60_000);
    desk.kick();
    await new Promise((r) => setTimeout(r, 300));
    expect(inputs).toEqual([]);
    expect(desk.held).toBe(true);
    desk.release();
    const t0 = Date.now();
    while (!inputs.length && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    desk.stop();
    expect(inputs.length).toBeGreaterThan(0);
  });
});

describe('what the screens say', () => {
  it('an undo through bot moves names them; a plain undo reads as before', () => {
    const undoText = undoNoticeText;
    expect(undoText({playerId: 'a', name: 'Ada', bots: 2}, 'b')).toBe('Ada took back their move and 2 bot moves');
    expect(undoText({playerId: 'a', name: 'Ada', bots: 1}, 'a')).toBe('You took back your move and 1 bot move');
    expect(undoText({playerId: 'a', name: 'Ada'}, 'b')).toBe('Ada undid their last move');
  });
});
