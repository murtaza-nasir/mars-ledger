// Cross-check of the phone's move projection (src/shared/projection.ts) against the real engine (vendor/tm/build, the
// same commit the server runs, in-process). Bot games are played; at sampled turn menus every move the menu offers is
// projected from that player's view, then made on a copy of the game (follow-up questions answered by the Normal bot),
// and the player's real numbers afterwards are compared with what the projection claimed. Exact claims must match;
// ranges ("at least 3", "2 to 4") must contain the real value. After a first action, the second move's affordability
// and requirements (as the planner shows them) are compared with the engine's own turn menu.
//
//   npx tsx tools/plan/crosscheck.ts [--seeds 1-12] [--players 3] [--every 3] [--out FILE]
import * as fs from 'node:fs';
import {act, clone, newGame, view, waiting} from '../judge/engine';
import type {EngineGame, EnginePlayer} from '../judge/engine';
import {decide} from '../../src/server/full/bots/decide';
import {isTurnMenuQuestion} from '../../src/shared/sync';
import {payment} from '../../src/shared/full';
import type {CardModel, InputResponse, PlayerInputModel, PlayerViewModel} from '../../src/shared/full';
import {canMakeIn, defaultPayment, moveKey, project, SP_IDS, worldFromView} from '../../src/shared/projection';
import type {Move, Projection, Range} from '../../src/shared/projection';
import {findCard} from '../../src/shared/cards';
import {RESOURCES} from '../../src/shared/types';
import {seeded} from '../judge/play';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const range = (s: string) => s.split(',').flatMap((p) => { const [a, b] = p.split('-').map(Number); return b === undefined ? [a] : Array.from({length: b - a + 1}, (_, i) => a + i); });
const seeds = range(args.get('seeds') ?? '1-8');
const nPlayers = Number(args.get('players') ?? 3);
const every = Number(args.get('every') ?? 2);
const outFile = args.get('out');

type Field = {field: string; claim: string; real: number; ok: boolean; exact: boolean};
type Check = {seed: number; gen: number; player: string; move: string; ok: boolean; fields: Field[]; error?: string; drawn?: string; unknowns?: string[]; tableau?: string};
type Second = {move: string; predicted: 'yes' | 'no' | 'maybe'; engine: boolean; ok: boolean | null; reason?: string};

const checks: Check[] = [];
const seconds: Second[] = [];
const unpreviewable: string[] = [];
const PROD = {megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction', plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction'} as const;

const within = (r: Range, v: number) => v >= r.lo && v <= r.hi;
const show = (r: Range) => (r.lo === r.hi ? `${r.lo}` : r.hi === Infinity ? `≥${r.lo}` : `${r.lo}..${r.hi}`);

/** Moves the turn menu offers, with the answer that makes each. */
function menuMoves(m: PlayerViewModel): Array<{move: Move; response: InputResponse; space?: string}> {
  const w = m.waitingFor!;
  const out: Array<{move: Move; response: InputResponse; space?: string}> = [];
  const me = m.thisPlayer;
  (w.options as PlayerInputModel[]).forEach((o, index) => {
    const t = typeof o.title === 'string' ? o.title : (o.title as {message: string}).message;
    if (o.type === 'projectCard') {
      for (const c of (o as {cards: CardModel[]}).cards) {
        if (c.isDisabled) continue;
        const def = findCard(c.name);
        const cost = c.calculatedCost ?? 0;
        const heat = !!(o as {paymentOptions?: {heat?: boolean}}).paymentOptions?.heat;
        const sp = !!SP_IDS[c.name] || /standard/i.test(t);
        if (sp && !SP_IDS[c.name]) continue;
        const pay = defaultPayment(me, cost, {steel: !sp && !!def?.tags.includes('building'), titanium: !sp && !!def?.tags.includes('space'), heat});
        if (pay.megacredits + pay.steel * me.steelValue + pay.titanium * me.titaniumValue + pay.heat < cost) continue;
        const move: Move = sp ? {kind: 'standard', project: c.name, payment: pay} : {kind: 'play', card: c.name, payment: pay};
        out.push({move, response: {type: 'or', index, response: {type: 'projectCard', card: c.name, payment: payment(pay)}}});
      }
    } else if (o.type === 'card' && (o as {selectBlueCardAction?: boolean}).selectBlueCardAction) {
      for (const c of (o as {cards: CardModel[]}).cards) if (!c.isDisabled) out.push({move: {kind: 'action', card: c.name}, response: {type: 'or', index, response: {type: 'card', cards: [c.name]}}});
    } else if (o.type === 'space' && /plants/i.test(t)) {
      const sp = (o as {spaces: string[]}).spaces[0];
      out.push({move: {kind: 'plants'}, response: {type: 'or', index, response: {type: 'space', spaceId: sp}}, space: sp});
    } else if (o.type === 'option' && /heat/i.test(t) && /temperature/i.test(t)) {
      out.push({move: {kind: 'heat'}, response: {type: 'or', index, response: {type: 'option'}}});
    }
  });
  return out;
}

/** Answer the mover's follow-up questions with the Normal bot until their turn menu is back or the turn passed. */
function finish(game: EngineGame, color: string, rng: () => number): string | null {
  for (let i = 0; i < 40; i++) {
    const p: EnginePlayer = game.players.find((x: EnginePlayer) => x.color === color);
    const w = p.getWaitingFor();
    if (!w) {
      // someone else may have been asked something by this move (rare): let the bot answer, then look again
      const others = waiting(game).filter((x) => x.color !== color);
      const other = others.find((x) => !isTurnMenuQuestion(view(x).waitingFor));
      if (!other) return null;
      const m = view(other);
      const d = decide(m.waitingFor!, m, {level: 'normal', rng, avoid: new Set()});
      if (!d) return 'stuck (other)';
      act(other, d.response);
      continue;
    }
    const m = view(p);
    if (isTurnMenuQuestion(m.waitingFor)) return null;
    const d = decide(m.waitingFor!, m, {level: 'normal', rng, avoid: new Set()});
    if (!d) return 'stuck';
    try { act(p, d.response); } catch (e) { return `refused: ${(e as Error).message}`; }
  }
  return 'too many follow-ups';
}

function compare(proj: Extract<Projection, {ok: true}>, before: PlayerViewModel, after: PlayerViewModel): Field[] {
  const f: Field[] = [];
  const me = after.thisPlayer;
  const add = (field: string, r: Range, real: number) => f.push({field, claim: show(r), real, ok: within(r, real), exact: r.lo === r.hi});
  for (const r of RESOURCES) {
    add(r, proj.after.stock[r], me[r] as number);
    add(`${r} production`, proj.after.production[r], me[PROD[r]] as number);
  }
  add('TR', proj.after.tr, me.terraformRating);
  add('hand', proj.after.hand, after.cardsInHand.length);
  add('temperature', proj.after.global.temperature, after.game.temperature);
  add('oxygen', proj.after.global.oxygen, after.game.oxygenLevel);
  add('oceans', proj.after.global.oceans, after.game.oceans);
  // tags: the engine's counts before plus the change the projection claims
  const tb = before.thisPlayer.tags as Record<string, number>, ta = me.tags as Record<string, number>;
  for (const t of Object.keys(ta)) {
    if (t === 'event') continue;
    const claimed = (tb[t] ?? 0) + (proj.after.tags[t] ?? 0) - (proj.before.tags[t] ?? 0);
    f.push({field: `${t} tags`, claim: `${claimed}`, real: ta[t] ?? 0, ok: claimed === (ta[t] ?? 0), exact: true});
  }
  for (const [name, r] of Object.entries(proj.after.cardResources)) {
    const real = me.tableau.find((c) => c.name === name)?.resources ?? 0;
    add(`resources on ${name}`, r, real);
  }
  // hidden draws: the cards drawn are never named; their number is what the projection claims
  const drawnReal = after.cardsInHand.filter((c) => !before.cardsInHand.some((b) => b.name === c.name)).length;
  add('cards drawn', proj.after.drawn, drawnReal);
  return f;
}

function sample(game: EngineGame, seed: number, rng: () => number) {
  const ws = waiting(game);
  for (const p of ws) {
    const m = view(p);
    if (!isTurnMenuQuestion(m.waitingFor) || m.game.phase !== 'action') continue;
    if (/first action of/i.test(JSON.stringify(m.waitingFor!.options.map((o) => o.title)))) continue;
    const world = worldFromView(m);
    for (const {move, response, space} of menuMoves(m)) {
      const proj = project(world, move, space ? {space} : {});
      const g2 = clone(game);
      const p2 = g2.players.find((x: EnginePlayer) => x.color === p.color);
      const label = moveKey(move);
      try { act(p2, response); } catch (e) {
        checks.push({seed, gen: m.game.generation, player: p.color, move: label, ok: !proj.ok, fields: [], error: `engine refused: ${(e as Error).message}`});
        continue;
      }
      const err = finish(g2, p.color, rng);
      const after = view(p2);
      if (!proj.ok) {
        if (proj.unpreviewable) { unpreviewable.push(label); continue; }
        checks.push({seed, gen: m.game.generation, player: p.color, move: label, ok: false, fields: [], error: `projection failed: ${proj.reason}${err ? ` / ${err}` : ''}`,
          tableau: m.players.map((x) => `${x.color}: ${x.tableau.map((c) => `${c.name}:${c.resources ?? 0}`).join(',')}`).join(' | ')});
        continue;
      }
      const fields = compare(proj, m, after);
      checks.push({seed, gen: m.game.generation, player: p.color, move: label, ok: fields.every((x) => x.ok), fields, error: err ?? undefined, unknowns: proj.unknowns.map((u) => u.text), tableau: m.thisPlayer.tableau.map((c) => `${c.name}:${c.resources ?? 0}`).join(","),
        drawn: proj.after.drawn.hi > 0 ? show(proj.after.drawn) : undefined});
      // The planner's second move: was the first action the turn's first, and is the turn menu back?
      if (m.thisPlayer.actionsTakenThisRound === 0 && isTurnMenuQuestion(after.waitingFor) && after.thisPlayer.isActive) {
        const engineMoves = new Map(menuMoves(after).map((x) => [moveKey(x.move), true]));
        const playOpt = (after.waitingFor!.options as PlayerInputModel[]).find((o) => o.type === 'projectCard' && !/standard/i.test(JSON.stringify(o.title)));
        const playable = new Set(((playOpt as {cards?: CardModel[]})?.cards ?? []).filter((c) => !c.isDisabled).map((c) => c.name));
        // every card in hand before (except the one played), checked against the projection
        for (const c of m.cardsInHand) {
          if (move.kind === 'play' && move.card === c.name) continue;
          if (!after.cardsInHand.some((x) => x.name === c.name)) continue;
          const v = canMakeIn(world, {kind: "play", card: c.name}, proj);
          const eng = playable.has(c.name);
          seconds.push({move: `after ${label}: play ${c.name}`, predicted: v.state, engine: eng, ok: v.state === 'maybe' ? null : (v.state === 'yes') === eng, reason: v.state !== 'yes' ? v.reason : undefined});
        }
        for (const k of ['plants', 'heat'] as const) {
          const v = canMakeIn(world, {kind: k}, proj);
          const eng = engineMoves.has(k);
          seconds.push({move: `after ${label}: ${k}`, predicted: v.state, engine: eng, ok: v.state === 'maybe' ? null : (v.state === 'yes') === eng, reason: v.state !== 'yes' ? v.reason : undefined});
        }
      }
    }
  }
}

for (const seed of seeds) {
  const names = ['Ada', 'Bea', 'Cy', 'Dee', 'Eve'].slice(0, nPlayers);
  const game = newGame(seed, names, {prelude: args.get('prelude') === '1', board: (args.get('board') ?? 'tharsis') as 'tharsis'});
  const rng = seeded(seed * 7 + 1);
  let menus = 0, steps = 0;
  while (game.phase !== 'end' && steps < 3000) {
    const ws = waiting(game);
    if (!ws.length) break;
    if (ws.some((p) => isTurnMenuQuestion(view(p).waitingFor)) && view(ws[0]).game.phase === 'action' && menus++ % every === 0) sample(game, seed, rng);
    for (const p of ws) {
      const m = view(p);
      if (!m.waitingFor) continue;
      const d = decide(m.waitingFor, m, {level: 'normal', rng, avoid: new Set()});
      if (!d) continue;
      try { act(p, d.response); } catch { /* the next loop asks again */ }
      steps++;
    }
  }
  process.stderr.write(`seed ${seed}: generation ${game.generation}, ${checks.length} checks so far\n`);
}

const fieldsAll = checks.flatMap((c) => c.fields);
const exactF = fieldsAll.filter((f) => f.exact), rangeF = fieldsAll.filter((f) => !f.exact);
const okMoves = checks.filter((c) => c.ok).length;
const byKind = new Map<string, {n: number; ok: number}>();
for (const c of checks) { const k = c.move.split(':')[0]; const e = byKind.get(k) ?? {n: 0, ok: 0}; e.n++; if (c.ok) e.ok++; byKind.set(k, e); }
const sec = seconds.filter((s) => s.ok !== null);
const summary = {
  moves: checks.length, movesAgree: okMoves, moveRate: +(okMoves / Math.max(1, checks.length)).toFixed(4),
  byKind: Object.fromEntries(byKind),
  exactFields: exactF.length, exactAgree: exactF.filter((f) => f.ok).length,
  rangeFields: rangeF.length, rangeContain: rangeF.filter((f) => f.ok).length,
  distinctCards: new Set(checks.filter((c) => c.move.startsWith('play:')).map((c) => c.move)).size,
  withDraws: checks.filter((c) => c.drawn).length,
  unpreviewable: unpreviewable.length, unpreviewableMoves: [...new Set(unpreviewable)],
  second: {checked: seconds.length, decided: sec.length, agree: sec.filter((s) => s.ok).length, maybe: seconds.length - sec.length},
};
console.log(JSON.stringify(summary, null, 1));
const bad = checks.filter((c) => !c.ok);
const badKinds = new Map<string, number>();
for (const c of bad) badKinds.set(c.move, (badKinds.get(c.move) ?? 0) + 1);
console.log('disagreements by move:', JSON.stringify([...badKinds].sort((a, b) => b[1] - a[1]).slice(0, 40)));
for (const c of bad.slice(0, 25)) console.log(c.move, c.error ?? '', JSON.stringify(c.fields.filter((f) => !f.ok)));
const badSec = seconds.filter((s) => s.ok === false);
for (const s of badSec.slice(0, 20)) console.log('second', s.move, 'predicted', s.predicted, 'engine', s.engine, s.reason ?? '');
if (outFile) fs.writeFileSync(outFile, JSON.stringify({summary, checks, seconds}, null, 1));
