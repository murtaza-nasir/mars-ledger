// The "judge" bot: Normal's heuristic lists and scores the legal options, a decision model (Jev, TypeSafe's hosted
// model) picks one through a /v1/systemone choice question. Options are shuffled so position
// gives nothing away. On a timeout, an error or an answer that is not one of the options the judge plays Normal's
// own pick and says why (fallback). Payment, amounts, production to lose, resources and discards stay heuristic.
//
// Off unless BOT_JUDGE is set (see judgeConfigFromEnv); the shipped Easy and Normal levels never call it.
import type {PlayerInputModel, PlayerViewModel} from '../../../../shared/full';
import {decide} from '../decide';
import type {Decision, Mind} from '../decide';
import {HAND_CAP} from '../decide';
import {context} from '../value';
import type {Ctx} from '../value';
import {promptFor} from './candidates';
import type {Candidate, DecisionType, Prompt} from './candidates';
import {CONTEXT_LEVELS, optionText, renderState} from './render';
import type {ContextLevel} from './render';
import {findCard} from '../../../../shared/cards';
import {formatEffect} from './effects';
import {PARTS, criteria, leaning, observe, remember} from './facts';
import type {JudgeMemory, Part} from './facts';

export type Provider = 'jev';
export type JudgeConfig = {
  provider: Provider;
  context: ContextLevel;
  /** top6: the heuristic's best six (Normal's pick always included); all: every option when there are at most 12;
   *  distinct4: Normal's pick plus the best economy, points and denial alternatives (filled up to four by rank) */
  candidates: 'top6' | 'all' | 'distinct4';
  /** derived context on top of the level (facts.ts): evals, clock, threats, history, plan, effects, crit */
  parts?: Part[];
  /** take the model's pick over Normal's only when its confidence is at least t and Normal scores the pick within m
   *  of its own; when no offered alternative is within m the model is not asked */
  gate?: {t: number; m: number};
  url: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  /** decision types left to the heuristic (e.g. buy, initial) */
  skip?: DecisionType[];
};

export const DEFAULTS: Record<Provider, {url: string; model: string}> = {
  jev: {url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest'},
};

/** The Jev level's configuration: game state, board and card text plus every
 *  derived part (Normal's valuation of each option, the clock, threats, recent history, own plan, effects in play and
 *  phase-weighted criteria), the heuristic's top six, no gate, research and the opening left to the heuristic. On 300
 *  held-out games against two Normal v2 bots it beat a Normal v2 seat by +2.3 VP (95 % CI +0.7 to +3.9), 40 % wins. */
export const JEV_LEVEL_SPEC = 'ctx=c2+evals+clock+threats+history+plan+effects+crit;cands=top6;skip=buy+initial';
export function jevLevelConfig(apiKey: string | undefined): JudgeConfig | null {
  if (!apiKey) return null;
  return parseJudgeSpec(JEV_LEVEL_SPEC, {url: DEFAULTS.jev.url, model: DEFAULTS.jev.model, apiKey, timeoutMs: 10000});
}

/**
 * A judge configuration from a compact spec, e.g. "ctx=c2+evals+clock;cands=distinct4;gate=t:0.7,m:3;skip=buy+initial"
 * (the arena's arms use this form).
 */
export function parseJudgeSpec(spec: string, base: Pick<JudgeConfig, 'url' | 'model' | 'apiKey' | 'timeoutMs'>): JudgeConfig {
  const cfg: JudgeConfig = {provider: 'jev', context: 'c2', candidates: 'top6', ...base};
  for (const kv of spec.split(';').map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)];
    if (k === 'ctx') {
      const [level, ...extra] = v.split('+');
      if (!(CONTEXT_LEVELS as readonly string[]).includes(level)) throw new Error(`bad context level ${level}`);
      for (const x of extra) if (!(PARTS as readonly string[]).includes(x)) throw new Error(`bad context part ${x}`);
      cfg.context = level as ContextLevel;
      cfg.parts = extra as Part[];
    } else if (k === 'cands') {
      if (!['top6', 'all', 'distinct4'].includes(v)) throw new Error(`bad candidate set ${v}`);
      cfg.candidates = v as JudgeConfig['candidates'];
    } else if (k === 'gate') {
      if (v === 'off') continue;
      const g = Object.fromEntries(v.split(',').map((x) => x.split(':')).map(([a, b]) => [a, Number(b)]));
      if (!Number.isFinite(g.t) || !Number.isFinite(g.m)) throw new Error(`bad gate ${v}`);
      cfg.gate = {t: g.t, m: g.m};
    } else if (k === 'skip') {
      cfg.skip = v.split('+').filter(Boolean) as DecisionType[];
    } else throw new Error(`bad judge spec key ${k}`);
  }
  return cfg;
}

/** Jev's price per million input tokens (it charges for input only). */
export const JEV_USD_PER_M_INPUT = 0.042;

/** BOT_JUDGE=jev turns the judge on ; BOT_JUDGE_CONTEXT (c0..c3, c3t), BOT_JUDGE_CANDIDATES (top6|all),
 *  BOT_JUDGE_SKIP (decision types left to the heuristic, e.g. buy,initial), BOT_JUDGE_URL, BOT_JUDGE_MODEL,
 *  BOT_JUDGE_TIMEOUT_MS tune it, or BOT_JUDGE_SPEC sets everything at once (parseJudgeSpec); Jev reads TYPESAFE_API_KEY. */
export function judgeConfigFromEnv(env: Record<string, string | undefined> = process.env): JudgeConfig | null {
  const provider = env.BOT_JUDGE?.toLowerCase();
  if (provider !== 'jev') return null;
  if (env.BOT_JUDGE_SPEC) {
    return parseJudgeSpec(env.BOT_JUDGE_SPEC, {url: env.BOT_JUDGE_URL ?? DEFAULTS.jev.url, model: env.BOT_JUDGE_MODEL ?? DEFAULTS.jev.model,
      apiKey: env.TYPESAFE_API_KEY, timeoutMs: Number(env.BOT_JUDGE_TIMEOUT_MS ?? 10000)});
  }
  const level = (env.BOT_JUDGE_CONTEXT ?? 'c1').toLowerCase() as ContextLevel;
  return {
    provider,
    context: (CONTEXT_LEVELS as readonly string[]).includes(level) ? level : 'c1',
    candidates: env.BOT_JUDGE_CANDIDATES === 'all' ? 'all' : 'top6',
    url: env.BOT_JUDGE_URL ?? DEFAULTS[provider].url,
    model: env.BOT_JUDGE_MODEL ?? DEFAULTS[provider].model,
    apiKey: env.TYPESAFE_API_KEY,
    timeoutMs: Number(env.BOT_JUDGE_TIMEOUT_MS ?? 10000),
    skip: (env.BOT_JUDGE_SKIP ?? '').split(',').map((x) => x.trim()).filter(Boolean) as DecisionType[],
  };
}

export type Question =
  | {type: 'choice'; instructions: string; criteria: Record<string, string>}
  | {type: 'noul'; instructions: string};
export type Request = {model: string; state: string; questions: Record<string, Question>};
export type Answer = {type?: string; choice?: string; answer?: unknown; noul?: number; confidence?: number; probabilities?: Record<string, number>};
export type Reply = {answers: Record<string, Answer>; usage?: {input_tokens?: number}; model?: string};
export type Caller = (req: Request) => Promise<Reply>;

export class JudgeError extends Error {
  constructor(public kind: 'timeout' | 'error' | 'too-long', message: string) { super(message); }
}

/** A /v1/systemone client (fetch, one retry on 429/503). */
export function systemOne(cfg: Pick<JudgeConfig, 'url' | 'apiKey' | 'timeoutMs'>): Caller {
  return async (req) => {
    for (let attempt = 0; ; attempt++) {
      let r: Response;
      try {
        r = await fetch(cfg.url, {method: 'POST', signal: AbortSignal.timeout(cfg.timeoutMs),
          headers: {'Content-Type': 'application/json', ...(cfg.apiKey ? {Authorization: `Bearer ${cfg.apiKey}`} : {})},
          body: JSON.stringify(req)});
      } catch (e) {
        const name = (e as Error).name;
        throw new JudgeError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'error', (e as Error).message);
      }
      const text = await r.text();
      if (r.ok) return JSON.parse(text) as Reply;
      if ((r.status === 429 || r.status === 503) && attempt < 2) { await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1))); continue; }
      throw new JudgeError(/max_length|too long|exceed/i.test(text) ? 'too-long' : 'error', `HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
  };
}

export type Fallback = 'timeout' | 'error' | 'too-long' | 'invalid' | 'retry' | 'skipped' | 'close';
export type JudgeOutcome = {
  decision: Decision;
  normal: Decision;
  type: DecisionType;
  /** the model was asked */
  judged: boolean;
  agreed: boolean;
  fallback?: Fallback;
  error?: string;
  ms: number;
  inputTokens?: number;
  chars?: number;
  offered?: number;
  legal?: number;
  /** 1-based heuristic rank of the option taken (1 = Normal's pick) */
  rank?: number;
  chosen?: string;
  top?: string;
  confidence?: number;
  /** the gate kept Normal's pick over the model's (`wanted`) */
  gated?: boolean;
  wanted?: string;
  /** Normal's score of the model's pick minus its own pick's (0 when they agree) */
  gap?: number;
  request?: Request;
};

/** Heuristic order: Normal's pick first, then by score. */
function ranked(p: Prompt): Candidate[] {
  return [...p.candidates].sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || b.score - a.score);
}

/** The options offered to the model: the top six, all of them when there are at most twelve (else the top 12), or
 *  four distinct ones (Normal's pick, then the best for economy, for points and for denial among the top 12). */
export function offer(p: Prompt, mode: JudgeConfig['candidates'], ctx?: Ctx): Candidate[] {
  const r = ranked(p);
  if (mode !== 'distinct4' || !ctx) return r.slice(0, mode === 'all' ? 12 : 6);
  const pool = r.slice(0, 12);
  const out: Candidate[] = [pool[0]];
  const lean = new Map(pool.map((c) => [c, leaning(ctx, c)]));
  for (const k of ['economy', 'points', 'denial'] as const) {
    const best = pool.filter((c) => !out.includes(c) && lean.get(c)![k] > 0).sort((a, b) => lean.get(b)![k] - lean.get(a)![k] || b.score - a.score)[0];
    if (best) out.push(best);
  }
  for (const c of pool) if (out.length < 4 && !out.includes(c)) out.push(c);
  return out;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function shuffled<T>(list: T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build the request for a prompt (exported for tests and the offline probe). */
export function buildRequest(p: Prompt, ctx: Ctx, cfg: Pick<JudgeConfig, 'context' | 'candidates' | 'model' | 'parts'>, rng: () => number, mem?: JudgeMemory):
    {req: Request; ids: Map<string, Candidate>; offered: Candidate[]} {
  const parts = cfg.parts ?? [];
  const state = renderState(ctx, p, cfg.context, parts, mem);
  const ids = new Map<string, Candidate>();
  const questions: Record<string, Question> = {};
  if (p.multi) {
    if (p.multi.corps) {
      const corps = shuffled(p.multi.corps, rng);
      const crit: Record<string, string> = {};
      corps.forEach((c, i) => {
        const id = LETTERS[i]; ids.set(`corp:${id}`, c);
        const def = findCard(c.label);
        crit[id] = `${c.label}: ${def?.startingMegaCredits ?? '?'} M€ to start; ${formatEffect(c.effect)}${def ? `. ${[def.description, ...(def.text ?? [])].filter(Boolean).join(' ')}` : ''}`;
      });
      questions.corporation = {type: 'choice', instructions: 'Which corporation should you start with?', criteria: crit};
    }
    p.multi.cards.forEach((c, i) => {
      const key = `buy${i}`;
      ids.set(key, c);
      questions[key] = {type: 'noul', instructions: `Should you buy this card for 3 M€ now? ${optionText(ctx, c, cfg.context === 'c0' || cfg.context === 'c1' ? cfg.context : 'c1')}.`};
    });
    return {req: {model: cfg.model, state, questions}, ids, offered: p.multi.cards};
  }
  const order = ranked(p);
  const offered = shuffled(offer(p, cfg.candidates, ctx), rng);
  const crit: Record<string, string> = {};
  offered.forEach((c, i) => {
    const id = LETTERS[i];
    ids.set(id, c);
    crit[id] = optionText(ctx, c, cfg.context, parts.includes('evals') ? {rank: order.indexOf(c) + 1, legal: order.length} : undefined);
  });
  const how = parts.includes('crit') ? ` ${criteria(ctx)}` : '';
  questions.pick = {type: 'choice', instructions: `${p.ask} Pick the option that gives you the best chance to finish with the most victory points.${how}`, criteria: crit};
  return {req: {model: cfg.model, state, questions}, ids, offered};
}

/** Read the model's answer into a decision (null when the answer is not one of the options). */
export function readReply(p: Prompt, reply: Reply, ids: Map<string, Candidate>, ctx: Ctx): {decision: Decision; chosen: Candidate | null; confidence?: number} | null {
  if (p.multi) {
    const yes = p.multi.cards.map((c, i) => ({c, a: reply.answers?.[`buy${i}`]})).filter((x) => x.a && typeof x.a.noul === 'number')
      .map((x) => ({c: x.c, p: x.a!.noul!}));
    if (yes.length !== p.multi.cards.length) return null;
    const room = Math.max(0, HAND_CAP.normal - ctx.model.cardsInHand.length);
    let corpName: string | undefined;
    let money = ctx.me.megacredits;
    if (p.multi.corps) {
      const a = reply.answers?.corporation;
      const id = a?.choice ?? (typeof a?.answer === 'string' ? a.answer : undefined);
      const corp = id ? ids.get(`corp:${id}`) : undefined;
      if (!corp) return null;
      corpName = corp.label;
      money = findCard(corp.label)?.startingMegaCredits ?? 40;
    }
    const afford = Math.floor(money / 3);
    const cap = Math.min(p.multi.max, afford, p.multi.corps ? p.multi.max : room);
    const picks = yes.filter((x) => x.p >= 0.5).sort((a, b) => b.p - a.p).slice(0, cap).map((x) => x.c.card!);
    if (picks.length < p.multi.min) return null;
    if (p.multi.corps) {
      const responses = (p.normal.response as {responses: unknown[]}).responses.map((_r, i) => i === p.multi!.corpIndex ? {type: 'card', cards: [corpName!]} : {type: 'card', cards: picks});
      return {decision: {response: {type: 'initialCards', responses} as Decision['response'], path: 'judge:initial', why: `found ${corpName}, keep ${picks.length} cards`}, chosen: null};
    }
    return {decision: {response: {type: 'card', cards: picks}, path: `judge:card:${picks.join('+')}`, why: picks.length ? `buy ${picks.join(', ')}` : 'buy nothing'}, chosen: null};
  }
  const a = reply.answers?.pick;
  const id = a?.choice ?? (typeof a?.answer === 'string' ? a.answer : undefined);
  const c = id ? ids.get(id) : undefined;
  if (!c) return null;
  return {decision: c.decision, chosen: c, confidence: a?.confidence};
}

/** The judge's answer to a prompt. Never throws: every failure falls back to Normal's pick. */
export async function judgeDecide(w: PlayerInputModel, model: PlayerViewModel, mind: Mind, cfg: JudgeConfig, call: Caller, rng: () => number, mem?: JudgeMemory): Promise<JudgeOutcome | null> {
  const t0 = Date.now();
  if (mem) observe(mem, model);
  const normalMind: Mind = {...mind, level: 'normal'};
  const normal = decide(w, model, normalMind);
  if (!normal) return null;
  const base = {normal, ms: 0};
  // After a refusal the runner retries with paths to avoid: the heuristic handles those.
  if (mind.avoid.size) return {...base, decision: normal, type: 'heuristic', judged: false, agreed: true, fallback: 'retry'};
  let p: Prompt | null;
  try { p = promptFor(w, model, normalMind); } catch { p = null; }
  if (!p) return {...base, decision: normal, type: 'heuristic', judged: false, agreed: true};
  if (cfg.skip?.includes(p.type)) return {...base, decision: normal, type: p.type, judged: false, agreed: true, fallback: 'skipped'};
  const ctx = context(model, {v1: mind.v1, v2: mind.v2});
  const order = ranked(p);
  // The gate: when Normal rates every alternative well below its own pick, the model is not asked at all.
  if (cfg.gate && !p.multi) {
    const alts = offer(p, cfg.candidates, ctx).filter((c) => c !== order[0] && order[0].score - c.score <= cfg.gate!.m);
    if (!alts.length) {
      if (mem && p.type === 'turn') remember(mem, model.game.generation, order[0].label);
      return {...base, decision: normal, type: p.type, judged: false, agreed: true, fallback: 'close', legal: p.candidates.length};
    }
  }
  let built: ReturnType<typeof buildRequest>;
  try { built = buildRequest(p, ctx, cfg, rng, mem); } catch (e) {
    return {...base, decision: normal, type: p.type, judged: false, agreed: true, fallback: 'error', error: `render: ${(e as Error).message}`, ms: Date.now() - t0};
  }
  const {req, ids, offered} = built;
  const chars = req.state.length + JSON.stringify(req.questions).length;
  const legal = p.multi ? p.multi.cards.length : p.candidates.length;
  const top = p.multi ? normal.why : ranked(p)[0]?.label;
  const info = {chars, offered: offered.length, legal, top, request: req};
  let reply: Reply;
  try {
    reply = await call(req);
  } catch (e) {
    const kind = e instanceof JudgeError ? e.kind : 'error';
    return {...base, ...info, decision: normal, type: p.type, judged: false, agreed: true, fallback: kind, error: (e as Error).message, ms: Date.now() - t0};
  }
  const ms = Date.now() - t0;
  const inputTokens = reply.usage?.input_tokens;
  const read = readReply(p, reply, ids, ctx);
  if (!read) return {...base, ...info, decision: normal, type: p.type, judged: false, agreed: true, fallback: 'invalid', ms, inputTokens};
  const agreed = JSON.stringify(read.decision.response) === JSON.stringify(normal.response);
  const rank = read.chosen ? order.indexOf(read.chosen) + 1 : undefined;
  const gap = read.chosen ? read.chosen.score - order[0].score : undefined;
  const gated = !agreed && !!cfg.gate && !!read.chosen && ((read.confidence ?? 0) < cfg.gate.t || -(gap ?? 0) > cfg.gate.m);
  const decision = agreed || gated ? normal : read.decision;
  if (mem && p.type === 'turn') remember(mem, model.game.generation, agreed || gated ? order[0].label : read.chosen?.label ?? decision.why);
  return {...base, ...info, decision, type: p.type, judged: true, agreed: agreed || gated, ms, inputTokens, rank: gated ? 1 : rank,
    chosen: gated ? normal.why : read.chosen?.label ?? read.decision.why, confidence: read.confidence, gap,
    ...(gated ? {gated, wanted: read.chosen!.label} : {})};
}
