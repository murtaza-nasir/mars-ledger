// Offline decision-quality probe: decision states sampled from Normal-only games, each candidate valued by rollouts
// (apply it, reshuffle the remaining deck K ways, play the game out with Normal everywhere, take the deciding
// player's final VP margin), then every model and context level asked the same states.
//
//   npx tsx tools/judge/probe.ts collect DIR [--n 200]
//   npx tsx tools/judge/probe.ts rollout DIR [--k 4]
//   npx tsx tools/judge/probe.ts rollout DIR --k 16 --shard 3/24 --values values16-3.jsonl   (parallel shards)
//   npx tsx tools/judge/probe.ts ask DIR --arm jev:c2:top6 [--calls 3]
//   npx tsx tools/judge/probe.ts ask DIR --arm 'jev:ctx=c2+evals;cands=distinct4' --tag NAME [--ledger DIR]
// States carry the deciding player's JudgeMemory (its views up to then), so history and pace parts can be probed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {decide} from '../../src/server/full/bots/decide';
import {promptFor} from '../../src/server/full/bots/judge/candidates';
import type {Candidate, Prompt} from '../../src/server/full/bots/judge/candidates';
import {DEFAULTS, JEV_USD_PER_M_INPUT, buildRequest, offer, parseJudgeSpec, readReply, systemOne} from '../../src/server/full/bots/judge/judge';
import {newMemory, observe} from '../../src/server/full/bots/judge/facts';
import type {JudgeMemory} from '../../src/server/full/bots/judge/facts';
import type {JudgeConfig, Provider} from '../../src/server/full/bots/judge/judge';
import {CONTEXT_LEVELS} from '../../src/server/full/bots/judge/render';
import type {ContextLevel} from '../../src/server/full/bots/judge/render';
import {context} from '../../src/server/full/bots/value';
import {act, clone, isOver, newGame, view, waiting} from './engine';
import type {EngineGame} from './engine';
import {heuristic, margin, playOut, seeded} from './play';
import type {Policy} from './play';

const [, , mode, dir] = process.argv;
const args = new Map<string, string>();
for (let i = 4; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
fs.mkdirSync(dir, {recursive: true});
const statesPath = path.join(dir, 'states.jsonl');
const valuesPath = path.join(dir, args.get('values') ?? 'values.jsonl');

type State = {id: string; seed: number; gen: number; type: string; playerId: string; color: string; serialized: unknown; mem?: JudgeMemory};
// Only prompts a snapshot restores faithfully: the engine does not serialize a move's pending follow-ups (where to put
// the tile, whom to target), so those are judged in whole games only.
const TARGET: Record<string, number> = {turn: 0.7, draft: 0.3};
const mind = () => ({level: 'normal' as const, rng: Math.random, avoid: new Set<string>()});
const key = (c: Candidate) => JSON.stringify(c.decision.response);

/** A fresh engine game from a stored snapshot. */
function restore(s: State): EngineGame {
  return clone({serialize: () => s.serialized});
}

function playerOf(g: EngineGame, id: string) {
  return g.players.find((p: {id: string}) => p.id === id);
}

async function collect() {
  const n = Number(args.get('n') ?? 200);
  const want = Object.fromEntries(Object.entries(TARGET).map(([k, f]) => [k, Math.round(f * n)]));
  const have: Record<string, number> = {};
  const outS = fs.createWriteStream(statesPath);
  const rng = seeded(4242);
  for (let seed = 501; seed < 800 && Object.keys(want).some((k) => (have[k] ?? 0) < want[k]); seed++) {
    const g = newGame(seed, ['Ares', 'Deimos', 'Phobos'], {draft: true});
    const mems: Record<string, JudgeMemory> = {};
    let i = 0;
    let guard = 0;
    while (!isOver(g) && guard++ < 6000) {
      for (const p of waiting(g)) {
        const m = view(p);
        const w = m.waitingFor!;
        observe(mems[p.id] ??= newMemory(), m);
        const pr = promptFor(w, m, mind());
        // Sample sparsely (about one decision in eight) so states spread over games and generations.
        if (pr && !pr.multi && (have[pr.type] ?? 0) < (want[pr.type] ?? 0) && pr.candidates.length >= 2 && rng() < (pr.type === 'turn' ? 0.06 : 0.12) * Number(args.get('rate') ?? 1)) {
          const serialized = g.serialize();
          const back = view(playerOf(clone({serialize: () => serialized}), p.id));
          if (JSON.stringify(back.waitingFor) === JSON.stringify(w) && JSON.stringify(back.thisPlayer) === JSON.stringify(m.thisPlayer)) {
            have[pr.type] = (have[pr.type] ?? 0) + 1;
            outS.write(JSON.stringify({id: `${seed}-${i}`, seed, gen: m.game.generation, type: pr.type, playerId: p.id, color: p.color, serialized, mem: mems[p.id]}) + '\n');
          }
        }
        // Normal is occasionally refused (a payment the engine rejects): retry without that path, as playOut does.
        const avoid = new Set<string>();
        for (let tries = 0; tries < 12; tries++) {
          const d = decide(w, m, {...mind(), avoid});
          if (!d) break;
          try { act(p, d.response); break; } catch { avoid.add(d.path); }
        }
        i++;
      }
    }
  }
  await new Promise((ok) => outS.end(ok));
  console.log('collected', have);
}

function shuffleDeck(g: EngineGame, k: number) {
  const pile = g.projectDeck.drawPile as unknown[];
  const r = seeded(9973 * (k + 1));
  for (let i = pile.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
}

function readStates(): State[] {
  return fs.readFileSync(statesPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as State);
}

async function rollout() {
  const K = Number(args.get('k') ?? 4);
  const outV = fs.createWriteStream(valuesPath);
  const [shard, shards] = (args.get('shard') ?? '0/1').split('/').map(Number);
  const states = readStates().filter((_, i) => i % shards === shard);
  let done = 0;
  for (const s of states) {
    const base = restore(s);
    const m = view(playerOf(base, s.playerId));
    const pr = promptFor(m.waitingFor!, m, mind())!;
    const all = offer(pr, 'all');
    const values: Record<string, number[]> = {};
    for (const c of all) {
      values[key(c)] = [];
      for (let k = 0; k < K; k++) {
        const g = restore(s);
        shuffleDeck(g, k);
        try { act(playerOf(g, s.playerId), c.decision.response); } catch { values[key(c)].push(NaN); continue; }
        const policies: Record<string, Policy> = Object.fromEntries(g.players.map((p: {id: string}) => [p.id, heuristic('normal')]));
        const r = await playOut(g, policies);
        values[key(c)].push(r.over ? margin(r.scores, s.color) : NaN);
      }
    }
    const top = pr.candidates.find((c) => c.top)!;
    outV.write(JSON.stringify({id: s.id, type: s.type, gen: s.gen, legal: pr.candidates.length, top: key(top),
      cands: all.map((c, i) => ({key: key(c), label: c.label, rank: i + 1, score: c.score, v: values[key(c)]}))}) + '\n');
    if (++done % 20 === 0) console.log('rolled out', done, 'of', states.length);
  }
  await new Promise((ok) => outV.end(ok));
}

async function ask() {
  const arm = args.get('arm')!;
  let cfg: JudgeConfig;
  const provider: Provider = 'jev';
  if (arm.startsWith('jev:') && arm.includes('=')) {
    cfg = parseJudgeSpec(arm.slice(4), {url: DEFAULTS.jev.url, model: DEFAULTS.jev.model, apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 20000});
  } else {
    const [prov, level, cands] = arm.split(':') as [Provider, ContextLevel, 'top6' | 'all'];
    if (!(['jev'] as string[]).includes(prov) || !(CONTEXT_LEVELS as readonly string[]).includes(level) || !['top6', 'all'].includes(cands)) throw new Error(`bad arm ${arm}`);
    cfg = {provider: prov, context: level, candidates: cands, url: DEFAULTS[prov].url, model: DEFAULTS[prov].model,
      apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 20000};
  }
  if (!cfg.apiKey && !args.has('dry')) throw new Error('TYPESAFE_API_KEY is not set');
  const call = systemOne(cfg);
  const limit = Number(args.get('calls') ?? 3);
  const states = readStates();
  const outA = fs.createWriteStream(path.join(dir, `ask-${args.get('tag') ?? arm.replace(/:/g, '-')}.jsonl`));
  const dry = args.has('dry');
  let next = 0, tokens = 0;
  await Promise.all(Array.from({length: limit}, async () => {
    while (next < states.length) {
      const s = states[next++];
      const g = restore(s);
      const m = view(playerOf(g, s.playerId));
      const pr: Prompt = promptFor(m.waitingFor!, m, mind())!;
      const ctx = context(m);
      const rng = seeded([...s.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0);
      const mem = s.mem ? structuredClone(s.mem) : undefined;
      if (mem) observe(mem, m);
      const {req, ids} = buildRequest(pr, ctx, cfg, rng, mem);
      const t0 = Date.now();
      const offeredKeys = Object.fromEntries([...ids].map(([id, c]) => [id, key(c)]));
      let row: Record<string, unknown> = {id: s.id, type: s.type, chars: req.state.length + JSON.stringify(req.questions).length, offered: Object.values(offeredKeys)};
      if (dry) { row.request = req; outA.write(JSON.stringify(row) + '\n'); continue; }
      try {
        const reply = await call(req);
        tokens += reply.usage?.input_tokens ?? 0;
        const read = readReply(pr, reply, ids, ctx);
        const probs = reply.answers?.pick?.probabilities ?? {};
        row = {...row, ms: Date.now() - t0, tokens: reply.usage?.input_tokens, pick: read?.chosen ? key(read.chosen) : null, invalid: !read,
          confidence: read?.confidence, probs: Object.fromEntries(Object.entries(probs).map(([id, p]) => [offeredKeys[id] ?? id, p]))};
      } catch (e) {
        row = {...row, ms: Date.now() - t0, error: (e as Error).message.slice(0, 160)};
      }
      outA.write(JSON.stringify(row) + '\n');
    }
  }));
  await new Promise((ok) => outA.end(ok));
  console.log(arm, 'asked', states.length, 'tokens', tokens, provider === 'jev' ? `$${(tokens * JEV_USD_PER_M_INPUT / 1e6).toFixed(4)}` : '');
  // Keep the shared Jev ledger honest.
  if (provider === 'jev' && !dry) {
    const lp = path.join(args.get('ledger') ?? dir, 'jev-ledger.json');
    let l = {usd: 0, tokens: 0, calls: 0};
    try { l = JSON.parse(fs.readFileSync(lp, 'utf8')); } catch { /* new */ }
    l.tokens += tokens; l.calls += states.length; l.usd += tokens * JEV_USD_PER_M_INPUT / 1e6;
    fs.writeFileSync(lp, JSON.stringify(l, null, 1));
  }
}

if (mode === 'collect') await collect();
else if (mode === 'rollout') await rollout();
else if (mode === 'ask') await ask();
process.exit(0);
