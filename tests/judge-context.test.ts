// The judge's derived context (judge/facts.ts: evals, clock, threats, history, plan, effects, criteria), its distinct
// candidate set, the compact spec, and the confidence gate.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {decide} from '../src/server/full/bots/decide';
import type {Mind} from '../src/server/full/bots/decide';
import {promptFor} from '../src/server/full/bots/judge/candidates';
import {breakdown, clockText, criteria, effectsText, historyText, newMemory, observe, planTags, planText, recentPace, remember, threatsText} from '../src/server/full/bots/judge/facts';
import {buildRequest, judgeDecide, offer, parseJudgeSpec} from '../src/server/full/bots/judge/judge';
import type {Caller, JudgeConfig, Reply, Request} from '../src/server/full/bots/judge/judge';
import {context} from '../src/server/full/bots/value';
import type {CardModel, PlayerInputModel, PlayerViewModel} from '../src/shared/full';
import {act, isOver, newGame, view, waiting} from '../tools/judge/engine';

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
const ALL = 'ctx=c2+evals+clock+threats+history+plan+effects+crit';
const base = {url: 'http://x', model: 'jev', timeoutMs: 1000};
const cfg = (spec: string): JudgeConfig => parseJudgeSpec(spec, base);

/** The same model a few generations on: the own player gained production, a card and TR. */
function later(m: PlayerViewModel, gens: number, steps: number): PlayerViewModel {
  const n = structuredClone(m);
  n.game.generation += gens;
  n.game.temperature += steps * 2;
  n.thisPlayer.plantProduction += 3;
  n.thisPlayer.terraformRating += 4;
  n.thisPlayer.tableau = [...n.thisPlayer.tableau, {name: 'Lichen'}];
  n.players = n.players.map((p) => (p.color === n.thisPlayer.color ? n.thisPlayer : {...p, megacreditProduction: p.megacreditProduction + 2}));
  return n;
}

describe('judge context: memory, clock and history', () => {
  it('keeps the first view of each generation and the own moves of the current one', () => {
    const mem = newMemory();
    const m = model(turn);
    observe(mem, m);
    remember(mem, 3, 'Play Mine');
    observe(mem, later(m, 0, 0));
    expect(mem.starts.map((s) => s.gen)).toEqual([3]);
    expect(mem.mine).toHaveLength(1);
    observe(mem, later(m, 1, 2));
    expect(mem.starts.map((s) => s.gen)).toEqual([3, 4]);
    expect(mem.mine).toHaveLength(0); // a new generation forgets last generation's moves
  });
  it('estimates the pace from the global steps of recent generations', () => {
    const mem = newMemory();
    const m = model(turn);
    observe(mem, m);
    expect(recentPace(mem, 3)).toBeNull();
    expect(clockText(context(m), mem)).toContain('No pace history yet');
    const n = later(m, 2, 6);
    observe(mem, n);
    expect(recentPace(mem, 5)).toBe(3);
    const t = clockText(context(n), mem);
    expect(t).toMatch(/Recent pace 3 steps a generation, so about \d+ generation/);
    expect(t).toMatch(/1 TR = \d+ M€/);
  });
  it('says what each player did in the last generation and this one so far', () => {
    const mem = newMemory();
    const m = model(turn);
    observe(mem, m);
    const n = later(m, 1, 1);
    observe(mem, n);
    const now = structuredClone(n);
    now.thisPlayer.tableau = [...now.thisPlayer.tableau, {name: 'Mine'}];
    now.players = now.players.map((p) => (p.color === now.thisPlayer.color ? now.thisPlayer : p));
    observe(mem, now);
    const h = historyText(context(now), mem);
    expect(h).toContain('RECENT HISTORY');
    expect(h).toMatch(/You: gen 3: played Lichen; production \+3 plant; TR \+4/);
    expect(h).toContain('gen 4 so far: played Mine');
    expect(historyText(context(m), undefined)).toContain('none recorded');
  });
});

describe('judge context: threats, plan, effects, evals and criteria', () => {
  it('lists the points leader, milestone distances, award leads and rival engine growth', () => {
    const mem = newMemory();
    const m = model(turn);
    observe(mem, m);
    const n = later(m, 2, 2);
    observe(mem, n);
    const t = threatsText(context(n), mem);
    expect(t).toMatch(/^THREATS AND RACES\nPoints: /);
    expect(t).toMatch(/Awards \(\d of 3 funded\): /);
    expect(t).toMatch(/production since gen 3: \+2 M€/);
    expect(t).not.toMatch(/undefined|NaN/);
    // awards without scores do not break it
    const e = structuredClone(n);
    e.game.awards = e.game.awards.map((a) => ({...a, scores: []}));
    expect(() => threatsText(context(e), mem)).not.toThrow();
  });
  it('derives a strategy tag and lists the moves made this generation', () => {
    const m = model(turn);
    m.thisPlayer.plantProduction = 4;
    m.thisPlayer.tags = [{tag: 'plant', count: 3}];
    expect(planTags(context(m))[0]).toBe('plant engine (greeneries)');
    const mem = newMemory();
    observe(mem, m);
    remember(mem, 3, 'Play Mine (4 M€)');
    expect(planText(context(m), mem)).toContain('Your moves this generation: Play Mine (4 M€)');
  });
  it('lists discounts in play and hand cards that use them', () => {
    const m = model(turn);
    m.thisPlayer.tableau = [{name: 'Earth Office'}];
    m.cardsInHand = [{name: 'Sponsors', calculatedCost: 3}];
    const t = effectsText(context(m));
    expect(t).toContain('Earth Office −3 M€ on earth cards');
    expect(t).toMatch(/Sponsors: −3 M€ discount/);
  });
  it("shows Normal's valuation with its parts only when evals are on", () => {
    const m = model(turn);
    const p = promptFor(turn, m, mind())!;
    const crit = (spec: string) => Object.values((buildRequest(p, context(m), cfg(spec), seeded(1)).req.questions.pick as {criteria: Record<string, string>}).criteria);
    expect(crit('ctx=c2').join('\n')).not.toContain("Normal's pick");
    const withEvals = crit('ctx=c2+evals').join('\n');
    expect(withEvals).toContain("[Normal's pick; score");
    expect(withEvals).toMatch(/Normal ranks it \d+ of \d+/);
    const comet = p.candidates.find((c) => c.card === 'Comet')!;
    const b = breakdown(context(m), comet.effect);
    expect(b.cost).toBeLessThan(0);
    expect(b.tr).toBeGreaterThan(0);
  });
  it('weights the question by the game phase', () => {
    const m = model(turn);
    const ctx = context(m);
    expect(criteria({...ctx, gens: 1})).toMatch(/last generation/);
    expect(criteria({...ctx, gens: 3})).toMatch(/points and TR most/);
    expect(criteria({...ctx, gens: 8})).toMatch(/Early game/);
    const p = promptFor(turn, m, mind())!;
    const ask = (spec: string) => (buildRequest(p, ctx, cfg(spec), seeded(1)).req.questions.pick as {instructions: string}).instructions;
    expect(ask('ctx=c2+crit')).toContain(criteria(ctx));
    expect(ask('ctx=c2')).not.toContain(criteria(ctx));
  });
  it('renders every part on real engine states without gaps, at a size Jev takes quickly', () => {
    const g = newGame(23, ['Ares', 'Deimos', 'Phobos'], {draft: true});
    const mems: Record<string, ReturnType<typeof newMemory>> = {};
    let checked = 0, longest = 0;
    while (!isOver(g) && checked < 60) {
      for (const pl of waiting(g)) {
        const v = view(pl);
        observe(mems[pl.id] ??= newMemory(), v);
        const pr = promptFor(v.waitingFor!, v, mind());
        if (pr && !pr.multi && v.game.generation >= 2) {
          const {req} = buildRequest(pr, context(v), cfg(`${ALL};cands=distinct4`), seeded(2), mems[pl.id]);
          const text = JSON.stringify(req);
          expect(text).not.toMatch(/undefined|NaN/);
          longest = Math.max(longest, text.length);
          checked++;
        }
        act(pl, decide(v.waitingFor!, v, mind())!.response);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(longest).toBeLessThan(16000);
  });
});

describe('judge: spec, distinct candidates and the gate', () => {
  it('parses the compact spec and rejects unknown parts', () => {
    expect(cfg('ctx=c2+evals+clock;cands=distinct4;gate=t:0.7,m:3;skip=buy+initial')).toMatchObject({
      provider: 'jev', context: 'c2', parts: ['evals', 'clock'], candidates: 'distinct4', gate: {t: 0.7, m: 3}, skip: ['buy', 'initial']});
    expect(cfg('ctx=c1;gate=off').gate).toBeUndefined();
    expect(() => cfg('ctx=c2+primer')).toThrow(/part/);
    expect(() => cfg('ctx=c9')).toThrow(/level/);
    expect(() => cfg('cands=top3')).toThrow(/candidate/);
    expect(() => cfg('gate=t:x')).toThrow(/gate/);
  });
  it("distinct4 offers at most four different options, Normal's pick first", () => {
    const m = model(turn);
    const p = promptFor(turn, m, mind())!;
    const d = offer(p, 'distinct4', context(m));
    expect(d.length).toBeLessThanOrEqual(4);
    expect(d.length).toBeGreaterThanOrEqual(Math.min(4, p.candidates.length));
    expect(new Set(d).size).toBe(d.length);
    expect(d[0].top).toBe(true);
  });

  const m = model(turn);
  const normal = decide(turn, m, mind())!;
  const p = promptFor(turn, m, mind())!;
  const ranked = [...p.candidates].sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || b.score - a.score);
  const alt = ranked[1];
  const gapToAlt = ranked[0].score - alt.score;
  const answering = (label: string, confidence: number): {call: Caller; asked: () => number} => {
    let n = 0;
    return {call: async (req: Request): Promise<Reply> => {
      n++;
      const crit = (req.questions.pick as {criteria: Record<string, string>}).criteria;
      const id = Object.entries(crit).find(([, t]) => t.startsWith(label))![0];
      return {answers: {pick: {choice: id, confidence}}, usage: {input_tokens: 100}};
    }, asked: () => n};
  };
  it("takes the model's pick only when it is confident enough and Normal rates the pick close to its own", async () => {
    const go = async (t: number, mm: number, conf: number) => {
      const a = answering(alt.label, conf);
      const o = (await judgeDecide(turn, m, mind(), cfg(`ctx=c2;gate=t:${t},m:${mm}`), a.call, seeded(3)))!;
      return {o, asked: a.asked()};
    };
    const take = await go(0.6, gapToAlt + 1, 0.8);
    expect(take.o.decision).toEqual(alt.decision);
    expect(take.o.gated).toBeUndefined();
    const unsure = await go(0.6, gapToAlt + 1, 0.4);
    expect(unsure.o.decision).toEqual(normal);
    expect(unsure.o).toMatchObject({gated: true, wanted: alt.label, judged: true});
  });
  it('does not ask at all when no alternative is within the margin', async () => {
    const a = answering(alt.label, 0.99);
    const gaps = ranked.slice(1).map((c) => ranked[0].score - c.score);
    const o = (await judgeDecide(turn, m, mind(), cfg(`ctx=c2;gate=t:0.5,m:${Math.min(...gaps) - 0.01}`), a.call, seeded(3)))!;
    expect(a.asked()).toBe(0);
    expect(o).toMatchObject({fallback: 'close', judged: false});
    expect(o.decision).toEqual(normal);
  });
  it('without a gate it plays the pick whatever the confidence (the old behaviour)', async () => {
    const a = answering(alt.label, 0.05);
    const o = (await judgeDecide(turn, m, mind(), cfg('ctx=c2'), a.call, seeded(3)))!;
    expect(o.decision).toEqual(alt.decision);
  });
  it('remembers its own turn choices for the plan part', async () => {
    const mem = newMemory();
    const a = answering(alt.label, 0.9);
    await judgeDecide(turn, m, mind(), cfg('ctx=c2'), a.call, seeded(3), mem);
    expect(mem.mine.map((x) => x.label)).toEqual([alt.label]);
  });
});
