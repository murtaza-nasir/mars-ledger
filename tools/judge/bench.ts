// Bot bench: bots-only games in the in-process engine with 2-4 seats, several boards, and per-seat behaviour
// metrics by generation (cards bought at research and their M€, project cards played and their M€, standard projects
// by kind, M€ left when passing, production, TR). The arena (arena.ts) measures a judge seat against two Normals;
// the bench measures how the rules-based levels play.
//
//   npx tsx tools/judge/bench.ts --lineup v3,v2 --seeds 1-60 --players 2,3,4 --boards tharsis,hellas,elysium --out DIR
//
// Seat i of a game on seed s plays lineup[(i + s) % lineup.length], so every arm sits in every seat over the seeds.
// With --arm X --opp Y instead, seat (s mod seats) plays X and every other seat Y: run it for two arms on the same
// seeds and the X seats are paired (same deal, same seat, same opponents' level).
// Arms: v3 (Normal now), v2 (Normal before v3, kept behind Mind.v2), v1, easy.
// Seed s uses players[s % players.length] seats and boards[floor(s / players.length) % boards.length].
import * as fs from 'node:fs';
import * as path from 'node:path';
import {deadEndReason} from '../../src/shared/deadend';
import {V3, decide, titleOf} from '../../src/server/full/bots/decide';
import type {Decision, Mind} from '../../src/server/full/bots/decide';
import type {InputResponse, PlayerInputModel, PlayerViewModel} from '../../src/shared/full';
import {generationsLeft, generationsLeftV3, stepsLeft} from '../../src/server/full/bots/value';
import {act, isOver, newGame, scores, view, waiting} from './engine';
import type {EnginePlayer} from './engine';
import {seeded, winner} from './play';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const range = (s: string) => s.split(',').flatMap((p) => {
  const [a, b] = p.split('-').map(Number);
  return b === undefined ? [a] : Array.from({length: b - a + 1}, (_, i) => a + i);
});
const lineup = (args.get('lineup') ?? 'v3,v2').split(',');
const focus = args.get('arm');
const opp = args.get('opp') ?? 'v2';
const seeds = range(args.get('seeds') ?? '1-12');
const counts = (args.get('players') ?? '3').split(',').map(Number);
const boards = (args.get('boards') ?? 'tharsis').split(',') as Array<'tharsis' | 'hellas' | 'elysium'>;
const prelude = args.get('prelude') === '1';
const draft = (args.get('draft') ?? '1') !== '0';
const out = args.get('out') ?? 'bench-out';
const NAMES = ['Ares', 'Deimos', 'Phobos', 'Titan', 'Europa'];
fs.mkdirSync(out, {recursive: true});
// --tune '{"buyEarly":0}' overrides Normal v3's tuning for this run (development only)
if (args.get('tune')) Object.assign(V3, JSON.parse(args.get('tune')!));

type Gen = {gen: number; bought: number; buyMC: number; offered: number; played: number; playMC: number; sp: Record<string, number>; spMC: number;
  passMC: number | null; hand: number; prod: number[]; tr: number; mc: number; est?: number; estV2?: number; steps?: number};

function mindFor(arm: string, rng: () => number, avoid: Set<string>): Mind {
  if (arm === 'easy') return {level: 'easy', rng, avoid};
  return {level: 'normal', rng, avoid, v1: arm === 'v1', v2: arm === 'v2'} as Mind;
}

/** Walk the prompt and the answer together and count what the answer does. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function tally(w0: PlayerInputModel, r0: InputResponse, g: Gen, mcBefore: number, top: boolean): void {
  const w = w0 as any, r = r0 as any;
  const t = titleOf(w0).toLowerCase();
  if (w.type === 'or' && r.type === 'or') {
    const o = w.options[r.index];
    if (top && o && o.type === 'option' && titleOf(o).toLowerCase().startsWith('pass')) g.passMC = mcBefore;
    if (o) tally(o, r.response, g, mcBefore, false);
    return;
  }
  if (w.type === 'and' && r.type === 'and') { w.options.forEach((o: PlayerInputModel & any, j: number) => r.responses[j] && tally(o, r.responses[j], g, mcBefore, false)); return; }
  if (w.type === 'initialCards' && r.type === 'initialCards') {
    w.options.forEach((o: PlayerInputModel & any, j: number) => {
      const ot = titleOf(o).toLowerCase();
      if (o.type === 'card' && !ot.includes('corporation') && !ot.includes('prelude') && !ot.includes('ceo') && r.responses[j]?.type === 'card') {
        const n = (r.responses[j] as {cards: string[]}).cards.length;
        g.bought += n; g.buyMC += 3 * n; g.offered += o.cards.length;
      }
    });
    return;
  }
  if (w.type === 'card' && r.type === 'card' && t.includes('to buy')) {
    g.bought += r.cards.length; g.buyMC += 3 * r.cards.length; g.offered += w.cards.length; return;
  }
  if (w.type === 'projectCard' && r.type === 'projectCard') {
    const cost = w.cards.find((c: {name: string}) => c.name === r.card)?.calculatedCost ?? 0;
    if (t.includes('standard')) { const k = r.card.replace(':SP', ''); g.sp[k] = (g.sp[k] ?? 0) + 1; g.spMC += cost; } else { g.played++; g.playMC += cost; }
  }
}

function snapshot(p: EnginePlayer, gen: number): Gen {
  return {gen, bought: 0, buyMC: 0, offered: 0, played: 0, playMC: 0, sp: {}, spMC: 0, passMC: null, hand: p.cardsInHand.length,
    prod: ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'].map((k) => p.production[k] as number), tr: p.terraformRating, mc: p.megaCredits};
}

async function one(seed: number) {
  const n = counts[seed % counts.length];
  const board = boards[Math.floor(seed / counts.length) % boards.length];
  const game = newGame(seed, NAMES.slice(0, n), {draft, board, prelude});
  const players: EnginePlayer[] = game.players;
  const arms = players.map((_, i) => (focus ? (i === seed % n ? focus : opp) : lineup[(i + seed) % lineup.length]));
  const rngs = players.map((_, i) => seeded(seed * 31 + i));
  const gens: Gen[][] = players.map(() => []);
  const cur = (i: number) => {
    const list = gens[i];
    if (!list.length || list[list.length - 1].gen !== game.generation) list.push(snapshot(players[i], game.generation));
    return list[list.length - 1];
  };
  let decisions = 0, refused = 0, ms = 0;
  let status = 'over';
  const t0 = Date.now();
  while (!isOver(game) && decisions < 6000) {
    const ws: EnginePlayer[] = waiting(game);
    if (!ws.length) { status = `nobody to move in ${game.phase}`; break; }
    let bad = '';
    for (const p of ws) {
      const i = players.indexOf(p);
      const avoid = new Set<string>();
      let done = false;
      for (let attempt = 0; attempt < 12 && !done; attempt++) {
        const m: PlayerViewModel = view(p);
        const w = m.waitingFor;
        if (!w) { done = true; break; }
        const dead = deadEndReason(w);
        if (dead) { bad = `dead: ${dead}`; break; }
        const d0 = Date.now();
        const d: Decision | null = decide(w, m, mindFor(arms[i], rngs[i], avoid)) ?? decide(w, m, {level: 'normal', rng: Math.random, avoid});
        ms += Date.now() - d0;
        if (!d) { bad = 'stuck'; break; }
        const g = cur(i);
        if (g.est === undefined) { g.est = generationsLeftV3(m); g.estV2 = generationsLeft(m); g.steps = stepsLeft(m.game).total; }
        const mc = m.thisPlayer.megacredits;
        try { act(p, d.response); decisions++; tally(w, d.response, g, mc, true); done = true; } catch (e) { refused++; avoid.add(d.path); fs.appendFileSync(path.join(out, 'refusals.jsonl'), JSON.stringify({seed, arm: arms[i], gen: game.generation, path: d.path, why: d.why, title: titleOf(w), error: String((e as Error).message).slice(0, 200)}) + '\n'); }
      }
      if (!done && !bad) bad = 'stuck';
      if (bad) break;
    }
    if (bad) { status = bad; break; }
  }
  const s = scores(game);
  const win = winner(s);
  const row = {seed, focus: focus ? seed % n : undefined, players: n, board, prelude, status, generation: game.generation, decisions, refused, msDecide: ms, ms: Date.now() - t0,
    seats: players.map((p, i) => ({arm: arms[i], color: p.color, vp: s[i].vp, tr: s[i].tr, mc: s[i].mc, win: win === p.color, breakdown: s[i].breakdown,
      corp: p.corporations?.[0]?.name ?? p.corporationCard?.name, tableau: p.tableau.length, gens: gens[i]}))};
  fs.appendFileSync(path.join(out, 'games.jsonl'), JSON.stringify(row) + '\n');
  console.log(`seed ${seed} ${n}p ${board}: ${status} gen ${game.generation} ${row.seats.map((x) => `${x.arm} ${x.vp}${x.win ? '*' : ''}`).join(' | ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

const done = new Set<number>();
try { for (const l of fs.readFileSync(path.join(out, 'games.jsonl'), 'utf8').split('\n')) if (l) done.add(JSON.parse(l).seed); } catch { /* fresh */ }
for (const s of seeds) {
  if (done.has(s)) continue;
  try { await one(s); } catch (e) { console.log(`seed ${s} failed: ${(e as Error).stack}`); }
}
process.exit(0);
