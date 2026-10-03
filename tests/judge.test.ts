// The experimental "judge" bot (BOT_JUDGE): state rendering at each context level, the request it sends a decision
// model, and the fallback to Normal's pick on a timeout, an error, an over-long input or an invalid answer.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {decide} from '../src/server/full/bots/decide';
import type {Mind} from '../src/server/full/bots/decide';
import {BotDesk} from '../src/server/full/bots';
import type {BotLogEntry} from '../src/server/full/bots';
import {promptFor} from '../src/server/full/bots/judge/candidates';
import {JudgeError, buildRequest, jevLevelConfig, judgeConfigFromEnv, judgeDecide, offer} from '../src/server/full/bots/judge/judge';
import {BOT_LEVELS} from '../src/shared/bots';
import type {Caller, JudgeConfig, Reply, Request} from '../src/server/full/bots/judge/judge';
import {PRIMER_FULL, PRIMER_TRIM, renderState} from '../src/server/full/bots/judge/render';
import {context} from '../src/server/full/bots/value';
import type {CardModel, PlayerInputModel, PlayerViewModel} from '../src/shared/full';
import {newGame, view, waiting, act, isOver} from '../tools/judge/engine';

const opt = (title: string): PlayerInputModel => ({type: 'option', title, buttonLabel: 'OK'});
const projectCards = (cards: CardModel[], title = 'Play project card'): PlayerInputModel =>
  ({type: 'projectCard', title, buttonLabel: 'Play', cards, paymentOptions: {}, microbes: 0, floaters: 0});
const menu = (options: PlayerInputModel[]): PlayerInputModel => ({type: 'or', title: 'Take your next action', buttonLabel: 'Take action', options});

function model(w?: PlayerInputModel): PlayerViewModel {
  const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-action.json', import.meta.url), 'utf8')) as PlayerViewModel;
  m.thisPlayer.tableau = [{name: 'Mining Guild'}];
  m.thisPlayer.actionsThisGeneration = [];
  m.thisPlayer.megacredits = 60;
  m.thisPlayer.heat = 0; m.thisPlayer.plants = 0; m.thisPlayer.steel = 0; m.thisPlayer.titanium = 0;
  m.game.generation = 3;
  m.cardsInHand = [{name: 'Mine', calculatedCost: 4}, {name: 'Comet', calculatedCost: 21}];
  m.players = m.players.map((p) => (p.color === m.thisPlayer.color ? m.thisPlayer : p));
  m.waitingFor = w;
  return m;
}
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const mind = (): Mind => ({level: 'normal', rng: seeded(7), avoid: new Set()});
const turn = menu([
  projectCards([{name: 'Mine', calculatedCost: 4}, {name: 'Comet', calculatedCost: 21}, {name: 'Lichen', calculatedCost: 7}]),
  projectCards([{name: 'Power Plant:SP', calculatedCost: 11}, {name: 'Asteroid:SP', calculatedCost: 14}, {name: 'Aquifer', calculatedCost: 18},
    {name: 'Greenery', calculatedCost: 23}, {name: 'City', calculatedCost: 25}], 'Standard projects'),
  opt('Pass for this generation'),
]);
const cfg = (patch: Partial<JudgeConfig> = {}): JudgeConfig =>
  ({provider: 'jev', context: 'c1', candidates: 'top6', url: 'http://x', model: 'jev', timeoutMs: 1000, ...patch});

describe('judge: rendering the state', () => {
  const m = model(turn);
  const p = promptFor(turn, m, mind())!;
  const ctx = context(m);
  it('grows with each context level and says what each level adds', () => {
    const s = Object.fromEntries((['c0', 'c1', 'c2', 'c3t', 'c3'] as const).map((l) => [l, renderState(ctx, p, l)]));
    expect(s.c0).not.toContain('GAME STATE');
    expect(s.c1).toContain('GAME STATE');
    expect(s.c1).toMatch(/temperature -?\d+ °C \(\d+ steps left to \+8\)/);
    expect(s.c1).toContain('Milestones (8 M€ to claim');
    expect(s.c1).not.toContain('BOARD');
    expect(s.c2).toContain('BOARD');
    expect(s.c2).toContain('YOUR HAND');
    expect(s.c2).toContain('- Mine (');
    expect(s.c3).toContain(PRIMER_FULL);
    expect(s.c3t).toContain(PRIMER_TRIM);
    expect(s.c3t).not.toContain(PRIMER_FULL);
    for (const t of Object.values(s)) expect(t).not.toMatch(/undefined|NaN/);
    expect(s.c0.length).toBeLessThan(s.c1.length);
    expect(s.c1.length).toBeLessThan(s.c2.length);
    expect(s.c2.length).toBeLessThan(s.c3t.length);
    expect(s.c3t.length).toBeLessThan(s.c3.length);
  });
  it('describes each option by its effect, adds the projected result from c2 on, and never shows heuristic scores', () => {
    const {req} = buildRequest(p, ctx, {...cfg(), context: 'c0'}, seeded(1));
    const crit = (req.questions.pick as {criteria: Record<string, string>}).criteria;
    const mine = Object.values(crit).find((t) => t.startsWith('Play Mine'))!;
    expect(mine).toMatch(/\+1 steel production/);
    expect(mine).not.toMatch(/worth|score/);
    const {req: req2} = buildRequest(p, ctx, {...cfg(), context: 'c2'}, seeded(1));
    expect(Object.values((req2.questions.pick as {criteria: Record<string, string>}).criteria).join('\n')).toContain('after:');
  });
  it('renders real engine states at every level without gaps', () => {
    const g = newGame(11, ['Ares', 'Deimos', 'Phobos'], {draft: true});
    let checked = 0;
    while (!isOver(g) && checked < 40) {
      for (const pl of waiting(g)) {
        const v = view(pl);
        const pr = promptFor(v.waitingFor!, v, mind());
        if (pr && v.game.generation >= 3) {
          for (const l of ['c0', 'c1', 'c2', 'c3'] as const) {
            const {req} = buildRequest(pr, context(v), {...cfg(), context: l}, seeded(2));
            expect(JSON.stringify(req)).not.toMatch(/undefined|NaN/);
          }
          checked++;
        }
        act(pl, decide(v.waitingFor!, v, mind())!.response);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('judge: candidates and the request', () => {
  const m = model(turn);
  it("always offers Normal's own pick, at most six options in top6, all of them (up to 12) in all", () => {
    const p = promptFor(turn, m, mind())!;
    const normal = decide(turn, m, mind())!;
    const top = offer(p, 'top6');
    expect(top.length).toBeLessThanOrEqual(6);
    expect(top.some((c) => JSON.stringify(c.decision.response) === JSON.stringify(normal.response))).toBe(true);
    expect(offer(p, 'all').length).toBe(Math.min(12, p.candidates.length));
  });
  it('shuffles options so the letter says nothing about the heuristic rank', () => {
    const p = promptFor(turn, m, mind())!;
    const firsts = new Set<string>();
    for (let s = 1; s < 30; s++) {
      const {ids} = buildRequest(p, context(m), cfg(), seeded(s));
      firsts.add(ids.get('A')!.label);
    }
    expect(firsts.size).toBeGreaterThan(2);
  });
});

describe('judge: answers and fallbacks', () => {
  const m = model(turn);
  const normal = decide(turn, m, mind())!;
  const asking = (answer: (req: Request) => Reply | Promise<Reply>): Caller => async (req) => answer(req);
  const idOf = (req: Request, label: RegExp) => Object.entries((req.questions.pick as {criteria: Record<string, string>}).criteria).find(([, t]) => label.test(t))![0];

  it("plays the model's pick and records whether Normal agreed", async () => {
    const o = (await judgeDecide(turn, m, mind(), cfg(), asking((req) => ({answers: {pick: {choice: idOf(req, /^Play Comet/), confidence: 0.7}}, usage: {input_tokens: 900}})), seeded(3)))!;
    expect(o.judged).toBe(true);
    expect(o.decision.response).toMatchObject({type: 'or', index: 0, response: {type: 'projectCard', card: 'Comet'}});
    expect(o.agreed).toBe(JSON.stringify(normal.response) === JSON.stringify(o.decision.response));
    expect(o.inputTokens).toBe(900);
    expect(o.confidence).toBe(0.7);
  });
  it("falls back to Normal's pick on a timeout, an error, an over-long input and an invalid answer", async () => {
    const cases: Array<[Caller, string]> = [
      [async () => { throw new JudgeError('timeout', 'slow'); }, 'timeout'],
      [async () => { throw new Error('ECONNREFUSED'); }, 'error'],
      [async () => { throw new JudgeError('too-long', 'HTTP 400: Input exceeds max_length'); }, 'too-long'],
      [asking(() => ({answers: {pick: {choice: 'Z'}}})), 'invalid'],
      [asking(() => ({answers: {}})), 'invalid'],
    ];
    for (const [call, kind] of cases) {
      const o = (await judgeDecide(turn, m, mind(), cfg(), call, seeded(4)))!;
      expect(o.fallback).toBe(kind);
      expect(o.judged).toBe(false);
      expect(o.decision).toEqual(normal);
    }
  });
  it('leaves payment-style prompts and retries after a refusal to the heuristic, without asking', async () => {
    let asked = 0;
    const call: Caller = async () => { asked++; return {answers: {}}; };
    const pay: PlayerInputModel = {type: 'payment', title: 'Select how to pay', buttonLabel: 'Pay', amount: 8, paymentOptions: {}};
    expect((await judgeDecide(pay, model(pay), mind(), cfg(), call, seeded(1)))!.type).toBe('heuristic');
    const retry = (await judgeDecide(turn, m, {...mind(), avoid: new Set(['or2'])}, cfg(), call, seeded(1)))!;
    expect(retry.fallback).toBe('retry');
    expect(asked).toBe(0);
  });
  it('research: buys the cards the model says yes to, most confident first, within what it can pay', async () => {
    const buy: PlayerInputModel = {type: 'card', title: 'Select card(s) to buy', buttonLabel: 'Buy', min: 0, max: 4, selectBlueCardAction: false, showOwner: false,
      cards: [{name: 'Mine', calculatedCost: 4}, {name: 'Comet', calculatedCost: 21}, {name: 'Lichen', calculatedCost: 7}, {name: 'Birds', calculatedCost: 10}]};
    const mm = model(buy);
    mm.thisPlayer.megacredits = 6; // two cards at most
    mm.cardsInHand = [];
    const o = (await judgeDecide(buy, mm, mind(), cfg(), asking(() => ({answers: {buy0: {noul: 0.9}, buy1: {noul: 0.2}, buy2: {noul: 0.6}, buy3: {noul: 0.95}}})), seeded(1)))!;
    expect(o.type).toBe('buy');
    expect(o.decision.response).toEqual({type: 'card', cards: ['Birds', 'Mine']});
  });
});

describe('judge: configuration and the bot desk', () => {
  it('is off unless BOT_JUDGE names a provider, and reads the context and candidate set', () => {
    expect(judgeConfigFromEnv({})).toBeNull();
    expect(judgeConfigFromEnv({BOT_JUDGE: 'gpt'})).toBeNull();
    expect(judgeConfigFromEnv({BOT_JUDGE: 'jev', BOT_JUDGE_CONTEXT: 'c3', BOT_JUDGE_CANDIDATES: 'all', TYPESAFE_API_KEY: 'k'}))
      .toMatchObject({provider: 'jev', context: 'c3', candidates: 'all', model: 'jev-latest', apiKey: 'k'});
    expect(judgeConfigFromEnv({BOT_JUDGE: 'jev', BOT_JUDGE_CONTEXT: 'c9'})).toMatchObject({context: 'c1', candidates: 'top6'});
    expect(judgeConfigFromEnv({BOT_JUDGE: 'jev', BOT_JUDGE_SKIP: 'buy, initial'})?.skip).toEqual(['buy', 'initial']);
  });
  it('leaves skipped decision types to the heuristic without asking', async () => {
    const buy: PlayerInputModel = {type: 'card', title: 'Select card(s) to buy', buttonLabel: 'Buy', min: 0, max: 4, selectBlueCardAction: false, showOwner: false,
      cards: [{name: 'Mine', calculatedCost: 4}, {name: 'Comet', calculatedCost: 21}]};
    let asked = 0;
    const o = (await judgeDecide(buy, model(buy), mind(), cfg({skip: ['buy']}), async () => { asked++; return {answers: {}}; }, seeded(1)))!;
    expect(asked).toBe(0);
    expect(o).toMatchObject({type: 'buy', judged: false, fallback: 'skipped'});
    expect(o.decision).toEqual(decide(buy, model(buy), mind()));
  });
  it("plays a Normal seat through the judge and logs the model's part; Easy seats never ask", async () => {
    const m = model(turn);
    let open = true;
    let asked = 0;
    const log: BotLogEntry[] = [];
    const call: Caller = async (req) => { asked++; return {answers: {pick: {choice: Object.keys((req.questions.pick as {criteria: object}).criteria)[0]}}}; };
    const desk = new BotDesk({
      player: async () => ({...m, waitingFor: open ? turn : undefined}),
      table: () => ({gameId: 'e1', bots: [{playerId: 'b1', name: 'Ares', level: 'normal', engineId: 'pb', color: m.thisPlayer.color}]}),
      input: async () => { open = false; },
      delayScale: 0, tickMs: 50, rng: seeded(5), log: (e) => log.push(e), judge: {config: cfg(), call},
    });
    desk.kick();
    const t0 = Date.now();
    while (!log.length && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
    desk.stop();
    expect(asked).toBe(1);
    expect(log[0].judge).toMatchObject({type: 'turn'});
  });
});

describe('the Jev level', () => {
  it('is selectable but not the default, and needs a key', () => {
    expect(BOT_LEVELS).toContain('jev');
    expect(jevLevelConfig(undefined)).toBeNull();
    expect(jevLevelConfig('k')).toMatchObject({provider: 'jev', context: 'c2', candidates: 'top6', skip: ['buy', 'initial'],
      parts: ['evals', 'clock', 'threats', 'history', 'plan', 'effects', 'crit']});
    expect(jevLevelConfig('k')?.gate).toBeUndefined();
  });
  it("plays exactly Normal's moves when it cannot ask Jev", () => {
    const m = model(turn);
    expect(decide(turn, m, {...mind(), level: 'jev'})).toEqual(decide(turn, m, mind()));
  });
  it('a Jev seat asks the Jev judge; without one it plays as Normal and asks nothing', async () => {
    for (const withJudge of [true, false]) {
      const m = model(turn);
      let open = true;
      let asked = 0;
      const log: BotLogEntry[] = [];
      const call: Caller = async (req) => { asked++; return {answers: {pick: {choice: Object.keys((req.questions.pick as {criteria: object}).criteria)[0]}}}; };
      const desk = new BotDesk({
        player: async () => ({...m, waitingFor: open ? turn : undefined}),
        table: () => ({gameId: 'e1', bots: [{playerId: 'b1', name: 'Ares', level: 'jev', engineId: 'pb', color: m.thisPlayer.color}]}),
        input: async () => { open = false; },
        delayScale: 0, tickMs: 50, rng: seeded(5), log: (e) => log.push(e), ...(withJudge ? {jev: {config: cfg({provider: 'jev'}), call}} : {}),
      });
      desk.kick();
      const t0 = Date.now();
      while (!log.length && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
      desk.stop();
      expect(asked).toBe(withJudge ? 1 : 0);
      expect(log[0].outcome).toBe('ok');
      if (!withJudge) expect(log[0].choice).toBe(decide(turn, m, mind())!.why);
    }
  });
});
