// Bot speed: a table-wide setting with Quick (fast),
// Table pace (human-like, the default) and Slow (1.5× table pace). Time a judge spends deciding counts toward the wait.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {BotDesk, botTable} from '../src/server/full/bots';
import type {BotLogEntry} from '../src/server/full/bots';
import type {Caller, JudgeConfig} from '../src/server/full/bots/judge/judge';
import {apply, newGame} from '../src/shared/engine';
import {BOT_SPEEDS, DEFAULT_BOT_SPEED} from '../src/shared/bots';
import type {CardModel, PlayerInputModel, PlayerViewModel} from '../src/shared/full';
import type {GameState} from '../src/shared/game';

const opt = (title: string): PlayerInputModel => ({type: 'option', title, buttonLabel: 'OK'});
const projectCards = (cards: CardModel[], title = 'Play project card'): PlayerInputModel =>
  ({type: 'projectCard', title, buttonLabel: 'Play', cards, paymentOptions: {}, microbes: 0, floaters: 0});
const menu = (n: number, first = true): PlayerInputModel =>
  ({type: 'or', title: first ? 'Take your first action' : 'Take your next action', buttonLabel: 'Take action',
    options: Array.from({length: n}, (_, i) => opt(i === n - 1 ? 'Pass for this generation' : `Option ${i}`))});
const pick: PlayerInputModel = {type: 'card', title: 'Select card(s) to buy', buttonLabel: '', cards: [], min: 0, max: 4, selectBlueCardAction: false, showOwner: false};
const space: PlayerInputModel = {type: 'space', title: 'Select space for ocean tile', buttonLabel: 'OK', spaces: []} as unknown as PlayerInputModel;

function model(patch: (m: PlayerViewModel) => void = () => {}): PlayerViewModel {
  const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-action.json', import.meta.url), 'utf8')) as PlayerViewModel;
  m.thisPlayer.tableau = [{name: 'Mining Guild'}];
  m.thisPlayer.actionsThisGeneration = [];
  m.thisPlayer.megacredits = 60;
  m.thisPlayer.heat = 0; m.thisPlayer.plants = 0; m.thisPlayer.steel = 0; m.thisPlayer.titanium = 0;
  m.game.generation = 1;
  m.cardsInHand = [{name: 'Mine', calculatedCost: 4}, {name: 'Comet', calculatedCost: 21}];
  patch(m);
  m.players = m.players.map((p) => (p.color === m.thisPlayer.color ? m.thisPlayer : p));
  return m;
}
const desk = (r: number) => { const d = new BotDesk({player: async () => model(), table: () => null, input: async () => {}, rng: () => r}); d.stop(); return d; };
const lo = desk(0), hi = desk(0.999999);
const range = (w: PlayerInputModel, m: PlayerViewModel, s: Parameters<BotDesk['waitFor']>[2]) => [Math.round(lo.waitFor(w, m, s)), Math.round(hi.waitFor(w, m, s))];
const research = model((m) => { m.game.phase = 'research'; });
const drafting = model((m) => { m.game.phase = 'drafting'; });

describe('bot speed: how long a bot takes over each question', () => {
  it('has three speeds, table pace by default', () => {
    expect(BOT_SPEEDS).toEqual(['quick', 'table', 'slow']);
    expect(DEFAULT_BOT_SPEED).toBe('table');
    expect(range(menu(3), model(), undefined)).toEqual(range(menu(3), model(), 'table'));
  });
  it('Quick keeps the old pace: 1–3 s on the turn menu, 0.6–1.4 s for follow-ups, 0.4–1.2 s for picks', () => {
    expect(range(menu(3), model(), 'quick')).toEqual([1000, 3000]);
    expect(range(space, model(), 'quick')).toEqual([600, 1400]);
    expect(range(pick, research, 'quick')).toEqual([400, 1200]);
  });
  it('Table pace: 6–9 s on a bare early turn, up to 10–15 s on a busy late one', () => {
    expect(range(menu(3), model(), 'table')).toEqual([6000, 9000]);
    expect(range(menu(12), model((m) => { m.game.generation = 10; }), 'table')).toEqual([10000, 15000]);
    // more options and later generations both take longer
    const mid = range(menu(7), model((m) => { m.game.generation = 5; }), 'table');
    expect(mid[0]).toBeGreaterThan(6000); expect(mid[1]).toBeLessThan(15000);
    expect(range(menu(10), model(), 'table')[0]).toBeGreaterThan(range(menu(4), model(), 'table')[0]);
    expect(range(menu(4), model((m) => { m.game.generation = 8; }), 'table')[0]).toBeGreaterThan(range(menu(4), model(), 'table')[0]);
  });
  it('Table pace: a short breath before the second action, 1.5–4 s per follow-up, 2–5 s per research or draft pick', () => {
    expect(range(menu(8, false), model((m) => { m.game.generation = 9; }), 'table')).toEqual([2500, 5000]);
    expect(range(space, model(), 'table')).toEqual([1500, 4000]);
    expect(range(pick, research, 'table')).toEqual([2000, 5000]);
    expect(range(pick, drafting, 'table')).toEqual([2000, 5000]);
    expect(range({type: 'initialCards', title: 'Select initial cards', buttonLabel: '', options: []} as unknown as PlayerInputModel, model(), 'table')).toEqual([2000, 5000]);
  });
  it('Slow is 1.5× table pace', () => {
    for (const [w, m] of [[menu(3), model()], [menu(12), model((x) => { x.game.generation = 10; })], [menu(5, false), model()], [space, model()], [pick, research]] as const) {
      const [a, b] = range(w, m, 'table');
      expect(range(w, m, 'slow')).toEqual([Math.round(a * 1.5), Math.round(b * 1.5)]);
    }
  });
  it('the end-of-game scoring never waits, at any speed', () => {
    const final = {type: 'or', title: 'Place any final greenery from plants', buttonLabel: '', options: []} as PlayerInputModel;
    for (const s of BOT_SPEEDS) expect(hi.waitFor(final, model(), s)).toBe(0);
    for (const s of BOT_SPEEDS) expect(hi.waitFor(menu(3), model((m) => { m.game.phase = 'end'; }), s)).toBe(0);
  });
  it('BOT_DELAY_SCALE still multiplies every wait', () => {
    const d = new BotDesk({player: async () => model(), table: () => null, input: async () => {}, rng: () => 0, delayScale: 0.5});
    d.stop();
    expect(d.waitFor(menu(3), model(), 'slow')).toBe(4500);
  });
});

describe('bot speed: the table setting', () => {
  const lobby = (): GameState => {
    let s = newGame('g1');
    s = apply(s, {t: 'join', playerId: 'p1', name: 'Ada', color: 'red'}).state;
    return s;
  };
  it('any player sets it at any time; an unknown speed is refused', () => {
    let s = lobby();
    expect(s.botSpeed).toBeUndefined();
    s = apply(s, {t: 'setBotSpeed', playerId: 'p1', speed: 'slow'}).state;
    expect(s.botSpeed).toBe('slow');
    expect(() => apply(s, {t: 'setBotSpeed', playerId: 'p1', speed: 'warp' as never})).toThrow(/bot speed/i);
  });
  it("reaches the bot desk with the table's bots (table pace when unset)", () => {
    const s = {mode: 'full', phase: 'full', botSpeed: undefined, full: {gameId: 'e1', players: {b1: {engineId: 'pb', color: 'blue'}}},
      players: [{id: 'b1', name: 'Ares', color: 'blue', bot: 'normal'}]} as unknown as GameState;
    expect(botTable(s)?.speed).toBe('table');
    expect(botTable({...s, botSpeed: 'quick'})?.speed).toBe('quick');
  });
});

describe('bot speed: deciding counts toward the wait', () => {
  const turn: PlayerInputModel = {type: 'or', title: 'Take your next action', buttonLabel: 'Take action', options: [
    projectCards([{name: 'Mine', calculatedCost: 4}, {name: 'Comet', calculatedCost: 21}]), opt('Pass for this generation')]};
  const cfg: JudgeConfig = {provider: 'jev', context: 'c1', candidates: 'top6', url: 'http://x', model: 'jev', timeoutMs: 2000};
  async function run(judgeMs: number, hold = 0): Promise<{at: number; log: BotLogEntry[]}> {
    const m = model();
    let open = true;
    let at = 0;
    const log: BotLogEntry[] = [];
    const call: Caller = async (req) => {
      await new Promise((r) => setTimeout(r, judgeMs));
      return {answers: {pick: {choice: Object.keys((req.questions.pick as {criteria: object}).criteria)[0]}}};
    };
    const t0 = Date.now();
    const d = new BotDesk({
      player: async () => ({...m, waitingFor: open ? turn : undefined}),
      table: () => ({gameId: 'e1', speed: 'table', bots: [{playerId: 'b1', name: 'Ares', level: 'jev', engineId: 'pb', color: m.thisPlayer.color}]}),
      input: async () => { open = false; at = Date.now() - t0; },
      holdUntil: () => (hold ? t0 + hold : 0),
      // table pace's breath before a second action is 2.5 s at rng 0; scaled by 0.2 that is 500 ms
      delayScale: 0.2, tickMs: 50, rng: () => 0, log: (e) => log.push(e), jev: {config: cfg, call},
    });
    d.kick();
    while (!at && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 10));
    d.stop();
    return {at, log};
  }
  it('a judge call shorter than the pace is absorbed by it', async () => {
    const {at, log} = await run(300);
    expect(log[0]?.outcome).toBe('ok');
    expect(at).toBeGreaterThanOrEqual(480);
    expect(at).toBeLessThan(700); // 500 ms, not 500 + 300
  });
  it('a judge call longer than the pace adds nothing after it', async () => {
    const {at} = await run(800);
    expect(at).toBeGreaterThanOrEqual(780);
    expect(at).toBeLessThan(1000); // 800 ms, not 800 + 500
  });
  it('a show still holds the move until it ends', async () => {
    const {at} = await run(0, 1200);
    expect(at).toBeGreaterThanOrEqual(1180);
    expect(at).toBeLessThan(1500);
  });
});
