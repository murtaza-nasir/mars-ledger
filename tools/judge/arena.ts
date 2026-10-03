// Bot arena: three-player bots-only games in the in-process engine, one seat played by the arm under test and two by
// Normal. Fixed seeds and rotated seats, so every arm faces the same deals from the same seats, and a Normal-in-seat
// game on the same seed is the paired baseline.
//
//   npx tsx tools/judge/arena.ts --arm jev:c2:top6 --seeds 1-12 --seats 0,1,2 --out DIR [--parallel 8] [--calls 3]
//   arms: normal | normal-v1 | easy | jev:<c0|c1|c2|c3|c3t>:<top6|all>[:<types left to Normal, e.g. buy+initial>]
//         | jev:<spec> with a judge spec (parseJudgeSpec), e.g. 'jev:ctx=c2+evals+clock;cands=distinct4;gate=t:0.7,m:3;skip=buy+initial'
//   --opp v1|v2 (default v2): the two opponents play Normal v1 (without the endgame rules) or the
//   current Normal. --cand v1|v2 (default v2): which Normal lists and scores a judge arm's options. The
//   --opp v1 --cand v1 plays the rules as they were before v2.
// Jev reads TYPESAFE_API_KEY; spend is kept in DIR/../jev-ledger.json and capped (--jev-cap, USD, default 5).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {BotLevel} from '../../src/shared/bots';
import {DEFAULTS, JEV_USD_PER_M_INPUT, judgeDecide, parseJudgeSpec, systemOne} from '../../src/server/full/bots/judge/judge';
import {newMemory} from '../../src/server/full/bots/judge/facts';
import type {Caller, JudgeConfig, JudgeOutcome, Provider} from '../../src/server/full/bots/judge/judge';
import {CONTEXT_LEVELS} from '../../src/server/full/bots/judge/render';
import type {ContextLevel} from '../../src/server/full/bots/judge/render';
import {newGame} from './engine';
import {heuristic, margin, playOut, seeded, winner} from './play';
import type {Policy} from './play';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const arm = args.get('arm') ?? 'normal';
const out = args.get('out') ?? 'arena-out';
const parallel = Number(args.get('parallel') ?? 8);
const callLimit = Number(args.get('calls') ?? 3);
const jevCap = Number(args.get('jev-cap') ?? 5);
const draft = (args.get('draft') ?? '1') !== '0';
const oppV1 = (args.get('opp') ?? 'v2') === 'v1';
const candV1 = (args.get('cand') ?? 'v2') === 'v1';
const range = (s: string) => s.split(',').flatMap((p) => {
  const [a, b] = p.split('-').map(Number);
  return b === undefined ? [a] : Array.from({length: b - a + 1}, (_, i) => a + i);
});
const seeds = range(args.get('seeds') ?? '1-12');
const seats = range(args.get('seats') ?? '0,1,2');
const NAMES = ['Ares', 'Deimos', 'Phobos'];

fs.mkdirSync(out, {recursive: true});
const ledgerPath = path.join(path.dirname(path.resolve(out)), 'jev-ledger.json');
type Ledger = {usd: number; tokens: number; calls: number};
const readLedger = (): Ledger => { try { return JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as Ledger; } catch { return {usd: 0, tokens: 0, calls: 0}; } };
const ledger = readLedger();
let overBudget = false;

// A small semaphore: Jev allows 1,200 requests a minute.
let inFlight = 0;
const queue: Array<() => void> = [];
async function limited<T>(f: () => Promise<T>): Promise<T> {
  if (inFlight >= callLimit) await new Promise<void>((ok) => queue.push(ok));
  inFlight++;
  try { return await f(); } finally { inFlight--; queue.shift()?.(); }
}

function judgeConfig(spec: string): JudgeConfig | null {
  if (spec.startsWith('jev:') && spec.includes('=')) {
    return parseJudgeSpec(spec.slice(4), {url: DEFAULTS.jev.url, model: DEFAULTS.jev.model, apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 15000});
  }
  const [provider, context, candidates, skip] = spec.split(':');
  if (provider !== 'jev') return null;
  if (!(CONTEXT_LEVELS as readonly string[]).includes(context) || !['top6', 'all'].includes(candidates)) throw new Error(`bad arm ${spec}`);
  return {provider: provider as Provider, context: context as ContextLevel, candidates: candidates === 'all' ? 'all' : 'top6',
    url: DEFAULTS[provider as Provider].url, model: DEFAULTS[provider as Provider].model,
    apiKey: provider === 'jev' ? process.env.TYPESAFE_API_KEY : undefined, timeoutMs: 15000,
    skip: skip ? (skip.split('+') as JudgeConfig['skip']) : undefined};
}

const cfg = judgeConfig(arm);
if (cfg?.provider === 'jev' && !cfg.apiKey) throw new Error('TYPESAFE_API_KEY is not set');
const raw = cfg ? systemOne(cfg) : null;
const call: Caller | null = raw && cfg ? async (req) => {
  if (cfg.provider === 'jev') {
    if (overBudget || ledger.usd >= jevCap * 0.95) { overBudget = true; throw new Error('Jev budget cap reached'); }
  }
  const reply = await limited(() => raw(req));
  if (cfg.provider === 'jev') {
    const t = reply.usage?.input_tokens ?? 0;
    ledger.tokens += t; ledger.calls++; ledger.usd += t * JEV_USD_PER_M_INPUT / 1e6;
  }
  return reply;
} : null;

const decisionsLog = fs.createWriteStream(path.join(out, 'decisions.jsonl'), {flags: 'a'});
const disagreeLog = fs.createWriteStream(path.join(out, 'disagreements.jsonl'), {flags: 'a'});
const gamesLog = fs.createWriteStream(path.join(out, 'games.jsonl'), {flags: 'a'});
const done = new Set<string>();
try { for (const l of fs.readFileSync(path.join(out, 'games.jsonl'), 'utf8').split('\n')) if (l) { const g = JSON.parse(l); done.add(`${g.seed}:${g.seat}`); } } catch { /* fresh run */ }

function judgePolicy(seed: number, seat: number): Policy {
  const rng = seeded(seed * 7919 + seat * 104729 + 17);
  const mem = newMemory();
  return async (m, avoid) => {
    const o: JudgeOutcome | null = await judgeDecide(m.waitingFor!, m, {level: 'normal', rng, avoid, v1: candV1}, cfg!, call!, rng, mem);
    if (!o) return null;
    const row = {arm, seed, seat, gen: m.game.generation, phase: m.game.phase, type: o.type, judged: o.judged, agreed: o.agreed, fallback: o.fallback,
      error: o.error?.slice(0, 120), ms: o.ms, tokens: o.inputTokens, chars: o.chars, offered: o.offered, legal: o.legal, rank: o.rank, chosen: o.chosen,
      top: o.top, confidence: o.confidence, gated: o.gated, wanted: o.wanted, gap: o.gap, vpNow: m.thisPlayer.victoryPointsBreakdown?.total, tr: m.thisPlayer.terraformRating};
    decisionsLog.write(JSON.stringify(row) + '\n');
    if (o.judged && !o.agreed) disagreeLog.write(JSON.stringify({...row, normalWhy: o.normal.why, request: o.request}) + '\n');
    return o.decision;
  };
}

async function one(seed: number, seat: number) {
  const game = newGame(seed, NAMES, {draft});
  const players = game.players;
  const policies: Record<string, Policy> = {};
  const v1Seats = new Set<string>();
  players.forEach((p: {id: string}, i: number) => {
    if (i !== seat) { policies[p.id] = heuristic('normal', Math.random, oppV1); if (oppV1) v1Seats.add(p.id); return; }
    if (cfg) { policies[p.id] = judgePolicy(seed, seat); if (candV1) v1Seats.add(p.id); }
    else if (arm === 'normal-v1') { policies[p.id] = heuristic('normal', Math.random, true); v1Seats.add(p.id); }
    else policies[p.id] = heuristic(arm as BotLevel, seeded(seed * 31 + seat));
  });
  const t0 = Date.now();
  const r = await playOut(game, policies, 4000, v1Seats);
  const color = players[seat].color as string;
  const me = r.scores.find((s) => s.color === color)!;
  const row = {arm, opp: oppV1 ? 'v1' : 'v2', cand: cfg ? (candV1 ? 'v1' : 'v2') : undefined, seed, seat, color, over: r.over, deadEnd: r.deadEnd, error: r.error, generation: r.generation, decisions: r.decisions, refused: r.refused,
    ms: Date.now() - t0, vp: me.vp, tr: me.tr, margin: margin(r.scores, color), win: winner(r.scores) === color,
    meanOppVp: r.scores.filter((s) => s.color !== color).reduce((a, s) => a + s.vp, 0) / 2, breakdown: me.breakdown, scores: r.scores};
  gamesLog.write(JSON.stringify(row) + '\n');
  console.log(`${arm} seed ${seed} seat ${seat}: ${r.over ? 'over' : 'NOT OVER ' + (r.deadEnd ?? r.error)} gen ${r.generation} vp ${me.vp} margin ${row.margin} ${row.win ? 'WIN' : ''} (${((Date.now() - t0) / 1000).toFixed(0)} s)${cfg?.provider === 'jev' ? ` jev $${ledger.usd.toFixed(3)}` : ''}`);
}

const jobs = seeds.flatMap((s) => seats.map((t) => [s, t] as const)).filter(([s, t]) => !done.has(`${s}:${t}`));
// Several arena processes may share the ledger: each adds only what it spent since its last save.
let saved: Ledger = {...ledger};
const saveLedger = () => {
  if (cfg?.provider !== 'jev') return;
  const now = readLedger();
  const merged = {usd: now.usd + ledger.usd - saved.usd, tokens: now.tokens + ledger.tokens - saved.tokens, calls: now.calls + ledger.calls - saved.calls};
  fs.writeFileSync(ledgerPath, JSON.stringify(merged, null, 1));
  // Others' spend counts against the cap too.
  ledger.usd = merged.usd; ledger.tokens = merged.tokens; ledger.calls = merged.calls;
  saved = {...ledger};
};
const timer = setInterval(saveLedger, 5000);
let next = 0;
await Promise.all(Array.from({length: Math.min(parallel, jobs.length)}, async () => {
  while (next < jobs.length && !overBudget) {
    const [s, t] = jobs[next++];
    try { await one(s, t); } catch (e) { console.log(`seed ${s} seat ${t} failed: ${(e as Error).stack}`); }
  }
}));
clearInterval(timer);
saveLedger();
if (overBudget) console.log('STOPPED: Jev budget cap reached');
await Promise.all([decisionsLog, disagreeLog, gamesLog].map((s) => new Promise((ok) => s.end(ok))));
process.exit(0);
