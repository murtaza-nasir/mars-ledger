// Offline check of the Jev shortlist: Normal v2's and v3's top-6 turn
// candidates on the same game states, no model calls.   npx tsx tools/judge/candcheck.ts
import {decide} from '../../src/server/full/bots/decide';
import {promptFor} from '../../src/server/full/bots/judge/candidates';
import {offer} from '../../src/server/full/bots/judge/judge';
import {context} from '../../src/server/full/bots/value';
import {act, isOver, newGame, view, waiting} from './engine';
type Agg = Record<string, number>;
const agg: Record<string, Agg> = {v2: {}, v3: {}};
const inc = (a: Agg, k: string, n = 1) => { a[k] = (a[k] ?? 0) + n; };
for (let seed = 1; seed <= 30; seed++) {
  const game = newGame(seed, ['A', 'B', 'C'], {draft: true});
  while (!isOver(game)) {
    for (const p of waiting(game)) {
      const m = view(p); const w = m.waitingFor!;
      if (p.name === 'A') {
        for (const ver of ['v2', 'v3'] as const) {
          const mind = {level: 'normal' as const, rng: Math.random, avoid: new Set<string>(), v2: ver === 'v2'};
          const pr = promptFor(w, m, mind);
          const a = agg[ver];
          if (!pr) continue;
          inc(a, `prompt:${pr.type}`);
          if (pr.type !== 'turn') continue;
          const ctx = context(m, {v2: ver === 'v2'});
          const top = offer(pr, 'top6');
          const phase = ctx.gens <= 3 ? 'late' : 'early';
          inc(a, `turn:${phase}`);
          inc(a, `offered:${phase}`, top.length);
          for (const c of top) inc(a, `kind:${phase}:${c.kind}`);
          if (top.some((c) => c.kind === 'play')) inc(a, `hasPlay:${phase}`);
          if (pr.candidates.some((c) => c.kind === 'play') && !top.some((c) => c.kind === 'play')) inc(a, `playMissing:${phase}`);
          if (top.some((c) => c.kind === 'pass' || c.kind === 'end')) inc(a, `hasPassOrEnd:${phase}`);
          if (top.length < 2) inc(a, `single:${phase}`);
        }
      }
      act(p, decide(w, m, {level: 'normal', rng: Math.random, avoid: new Set()})!.response);
    }
  }
}
for (const ver of ['v2', 'v3']) {
  const a = agg[ver];
  console.log(`== candidates from Normal ${ver} (30 games, seat A, the same states)`);
  for (const ph of ['early', 'late']) {
    const n = a[`turn:${ph}`] ?? 0;
    const kinds = Object.entries(a).filter(([k]) => k.startsWith(`kind:${ph}:`)).map(([k, v]) => `${k.split(':')[2]} ${(v / n).toFixed(2)}`).join(', ');
    console.log(`  ${ph}: turn prompts ${n}, offered ${((a[`offered:${ph}`] ?? 0) / n).toFixed(2)}; per prompt: ${kinds}; with a play ${((a[`hasPlay:${ph}`] ?? 0) / n).toFixed(2)}, play left out ${((a[`playMissing:${ph}`] ?? 0) / n).toFixed(3)}, pass/end offered ${((a[`hasPassOrEnd:${ph}`] ?? 0) / n).toFixed(2)}, single ${((a[`single:${ph}`] ?? 0) / n).toFixed(2)}`);
  }
  console.log('  prompts:', Object.entries(a).filter(([k]) => k.startsWith('prompt:')).map(([k, v]) => `${k.slice(7)} ${v}`).join(', '));
}
