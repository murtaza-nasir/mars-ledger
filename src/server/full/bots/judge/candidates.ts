// The legal options of a prompt as a list of candidates, each with the heuristic's score (Normal's own formulas from
// decide.ts), its full engine response and its concrete effect. The judge offers the best of them to a decision model.
// Normal's actual pick (decide()) is always among them and is marked, so a judge can fall back to it.
import {findCard} from '../../../../shared/cards';
import type {Color, EnginePayment, InputResponse, PlayerInputModel, PlayerViewModel} from '../../../../shared/full';
import {neighbours, rankSpaces, tileGoal} from '../board';
import type {TileGoal} from '../board';
import {SP_VALUE, answer, awardOdds, bonusWorth, deadCards, decide, handReserve, isTurnMenu, lateProjectScore, optionKind, playScore, playables, projectsV3, resourceTargetValue, spaceChoice, titleOf} from '../decide';
import type {Decision, Mind} from '../decide';
import {payFor} from '../pay';
import {behaviorValue, context, handValue, stepsLeft} from '../value';
import type {Ctx} from '../value';
import {behaviorEffect, cardEffect, cardHeader, emptyEffect, paymentEffect, spaceEffect} from './effects';
import type {Effect} from './effects';

/** Which kind of decision a prompt is (for agreement per type in the bot arena). */
export type DecisionType = 'turn' | 'space' | 'draft' | 'keep' | 'buy' | 'initial' | 'target' | 'player' | 'option' | 'heuristic';

export type Candidate = {
  decision: Decision;
  score: number;
  kind: string;
  label: string;
  effect: Effect;
  card?: string;
  space?: string;
  player?: Color;
  pay?: EnginePayment | null;
  /** Normal's own pick */
  top?: boolean;
};

export type Prompt = {
  type: DecisionType;
  title: string;
  /** what the question asks the model */
  ask: string;
  candidates: Candidate[];
  /** buy / initial: several cards, each a yes/no (initial also has the corporation as a choice) */
  multi?: {cards: Candidate[]; max: number; min: number; corps?: Candidate[]; corpIndex?: number};
  goal?: TileGoal;
  normal: Decision;
};

type Input = PlayerInputModel;
type Or = Extract<Input, {type: 'or'}>;
type CardIn = Extract<Input, {type: 'card'}>;
const same = (a: InputResponse, b: InputResponse) => JSON.stringify(a) === JSON.stringify(b);
const wrapOr = (i: number, r: InputResponse): InputResponse => ({type: 'or', index: i, response: r});

/** Classify the prompt and list its candidates; null when the judge leaves it to the heuristic. */
export function promptFor(w: Input, model: PlayerViewModel, mind: Mind): Prompt | null {
  const normal = decide(w, model, mind);
  if (!normal) return null;
  const ctx = context(model, {v1: mind.v1, v2: mind.v2});
  const title = titleOf(w);
  const t = title.toLowerCase();
  let p: Omit<Prompt, 'normal' | 'title'> | null = null;
  if (isTurnMenu(w)) p = {type: 'turn', ask: 'Which action should you take now?', candidates: turnCandidates(w as Or, ctx, mind)};
  else if (w.type === 'space') {
    const goal = tileGoal(title);
    p = {type: 'space', goal, ask: `Where should you place this ${goal === 'other' ? 'tile' : goal + ' tile'}? (${title})`, candidates: spaceCandidates(w as Extract<Input, {type: 'space'}>, ctx, goal)};
  } else if (w.type === 'card' && !(w as CardIn).selectBlueCardAction) {
    const cw = w as CardIn;
    if (t.includes('to buy')) {
      const cards = cw.cards.map((c) => cardCandidate(c.name, c.calculatedCost, ctx, {response: {type: 'card', cards: [c.name]}, path: '', why: c.name}, 'buy'));
      p = {type: 'buy', ask: 'Research: which of these cards should you buy (3 M€ each) to keep in your hand?', candidates: [], multi: {cards, max: cw.max, min: cw.min}};
    } else if (t.includes('keep and pass') || (t.includes('keep') && cw.max === 1 && cw.min === 1)) {
      p = {type: 'draft', ask: 'Draft: which card should you keep? The rest go to your neighbour.', candidates: cw.cards.map((c) => cardCandidate(c.name, c.calculatedCost, ctx, {response: {type: 'card', cards: [c.name]}, path: `card:${c.name}`, why: `keep ${c.name}`}, 'keep'))};
    } else if (/add|move|resource|microbe|animal|science|floater/.test(t) && !t.includes('keep') && cw.max === 1 && cw.min === 1) {
      p = {type: 'target', ask: `${title}: which card?`, candidates: cw.cards.map((c) => ({
        decision: {response: {type: 'card', cards: [c.name]}, path: `card:${c.name}`, why: `add to ${c.name}`}, score: resourceTargetValue(c.name), kind: 'target',
        label: c.name, card: c.name, effect: {...emptyEffect(), other: [targetNote(c.name, c.resources)]},
      }))};
    }
  } else if (w.type === 'player') {
    p = {type: 'player', ask: `${title}: which player?`, candidates: (w as Extract<Input, {type: 'player'}>).players.map((c) => playerCandidate(c, ctx))};
  } else if (w.type === 'initialCards') {
    p = initialPrompt(w as Extract<Input, {type: 'initialCards'}>, ctx, mind);
  } else if (w.type === 'or') {
    const cands: Candidate[] = [];
    (w as Or).options.forEach((o, i) => {
      if (optionKind(o) === 'undo') return;
      const leaf = answer(o, ctx, mind, `or${i}/`);
      if (!leaf) return;
      cands.push({decision: {response: wrapOr(i, leaf.response), path: leaf.path, why: leaf.why || titleOf(o)}, score: -i, kind: 'option',
        label: namePlayers([titleOf(o), leaf.why && leaf.why !== titleOf(o) ? `(${leaf.why})` : ''].filter(Boolean).join(' '), ctx), effect: emptyEffect()});
    });
    p = {type: 'option', ask: `${title}: which option?`, candidates: cands};
  }
  if (!p || (!p.multi && p.candidates.length < 2)) return null;
  // Mark Normal's pick; add it when the list misses it (it must always be offered).
  if (!p.multi) {
    const hit = p.candidates.find((c) => same(c.decision.response, normal.response));
    if (hit) hit.top = true;
    else p.candidates.push({decision: normal, score: Math.max(...p.candidates.map((c) => c.score)) + 1, kind: 'normal', label: normal.why, effect: emptyEffect(), top: true});
  }
  return {...p, title, normal};
}

/** Engine option titles name players by colour ("Remove 2 plants from green"): add the name, and mark yourself. */
function namePlayers(text: string, ctx: Ctx): string {
  let out = text;
  for (const p of ctx.model.players) {
    out = out.replace(new RegExp(`\\b${p.color}\\b`, 'g'), `${p.name} (${p.color}${p.color === ctx.me.color ? ', you' : ''})`);
  }
  return out;
}

function targetNote(name: string, resources?: number): string {
  const def = findCard(name);
  const vp = def?.victoryPoints;
  const scoring = vp && typeof vp === 'object' && vp.resourcesHere ? `scores 1 VP per ${vp.per ?? 1} resource${(vp.per ?? 1) === 1 ? '' : 's'} here` : 'resources here score no VP';
  return `${resources ?? 0} on it now; ${scoring}`;
}

function cardCandidate(name: string, cost: number | undefined, ctx: Ctx, decision: Decision, kind: string): Candidate {
  return {decision, score: handValue(name, cost, ctx), kind, label: cardHeader(name, cost), card: name, effect: cardEffect(name, ctx)};
}

function playerCandidate(c: Color, ctx: Ctx): Candidate {
  const p = ctx.model.players.find((x) => x.color === c);
  const vp = p?.victoryPointsBreakdown?.total ?? p?.terraformRating ?? 0;
  const self = c === ctx.me.color;
  const label = p ? `${p.name}${self ? ' (yourself)' : ''}` : c;
  const note = p ? `${self ? 'you' : 'them'}: ${vp} VP, TR ${p.terraformRating}, production M€ ${p.megacreditProduction} steel ${p.steelProduction} titanium ${p.titaniumProduction} plants ${p.plantProduction} energy ${p.energyProduction} heat ${p.heatProduction}; plants ${p.plants}` : '';
  const others = ctx.model.players.filter((x) => x.color !== ctx.me.color).map((x) => x.victoryPointsBreakdown?.total ?? x.terraformRating);
  return {decision: {response: {type: 'player', player: c}, path: `player:${c}`, why: `target ${label}`}, score: self ? -99 : vp - Math.max(0, ...others) * 0, kind: 'player', label, player: c,
    effect: {...emptyEffect(), other: [note]}};
}

// ---- the turn menu, one candidate per concrete action -----------------------------------------
export function turnCandidates(w: Or, ctx: Ctx, mind: Mind): Candidate[] {
  const out: Candidate[] = [];
  const g = ctx.model.game;
  const left = stepsLeft(g);
  const me = ctx.me;
  w.options.forEach((o, i) => {
    const k = optionKind(o);
    const at = `or${i}/`;
    switch (k) {
    case 'play': {
      for (const s of playables(o as Extract<Input, {type: 'projectCard'}>, ctx, {...mind, level: 'normal'}, at)) {
        const r = s.d.response as Extract<InputResponse, {type: 'projectCard'}>;
        const e = paymentEffect(r.payment, cardEffect(r.card, ctx));
        const cost = (o as Extract<Input, {type: 'projectCard'}>).cards.find((c) => c.name === r.card)?.calculatedCost;
        out.push({decision: {response: wrapOr(i, r), path: s.d.path, why: s.d.why}, score: playScore(s, ctx), kind: 'play', label: `Play ${r.card} (${cost ?? '?'} M€)`, card: r.card, pay: r.payment, effect: e});
      }
      break;
    }
    case 'action': {
      for (const c of (o as Extract<Input, {type: 'card'}>).cards) {
        if (c.isDisabled) continue;
        const def = findCard(c.name);
        const value = def?.action ? behaviorValue(def.action, ctx, def) : 1;
        const e = behaviorEffect(def?.action, ctx, def);
        out.push({decision: {response: wrapOr(i, {type: 'card', cards: [c.name]}), path: `${at}card:${c.name}`, why: `use the action of ${c.name}`},
          score: Math.max(0.5, value * 0.5), kind: 'action', label: `Use the action of ${c.name}`, card: c.name, effect: e});
      }
      break;
    }
    case 'standard': {
      const sp = o as Extract<Input, {type: 'projectCard'}>;
      // Normal v3: the projects it would consider now, scored as it scores them (none early without idle money).
      if (ctx.v3) {
        for (const x of projectsV3(sp, ctx, {...mind, level: 'normal'}, at)) {
          const r = x.response as Extract<InputResponse, {type: 'projectCard'}>;
          const cost = sp.cards.find((c) => c.name === r.card)?.calculatedCost ?? 0;
          out.push({decision: {response: wrapOr(i, r), path: x.path, why: x.why}, score: x.score, kind: 'standard', label: `Standard project ${r.card.replace(':SP', '')} (${cost} M€)`,
            pay: r.payment, effect: paymentEffect(r.payment, standardEffect(r.card, ctx))});
        }
        break;
      }
      // Normal's endgame rule (v2): projects the idle money can pay for score like Normal's own late project.
      const spare = !ctx.v1 && ctx.gens <= 3 ? me.megacredits + (sp.paymentOptions?.heat ? me.heat : 0) - handReserve(ctx) : -1;
      for (const c of sp.cards) {
        if (c.isDisabled) continue;
        const valueOf = SP_VALUE[c.name];
        if (!valueOf) continue;
        const cost = c.calculatedCost ?? 0;
        const pay = payFor(me, cost, {heat: !!sp.paymentOptions?.heat, steel: !!sp.paymentOptions?.steel, titanium: !!sp.paymentOptions?.titanium});
        if (!pay) continue;
        const net = valueOf(ctx) - cost;
        const late = cost <= spare && valueOf(ctx) >= 2;
        out.push({decision: {response: wrapOr(i, {type: 'projectCard', card: c.name, payment: pay}), path: `${at}card:${c.name}`, why: `standard project ${c.name.replace(':SP', '')}`},
          score: late ? lateProjectScore(net) : net * 0.8, kind: 'standard', label: `Standard project ${c.name.replace(':SP', '')} (${cost} M€)`, pay, effect: paymentEffect(pay, standardEffect(c.name, ctx))});
      }
      break;
    }
    case 'milestone': {
      (o as Or).options.forEach((m, j) => {
        const name = titleOf(m);
        const leaf = answer(m, ctx, mind, `${at}or${j}/`);
        if (!leaf) return;
        const e = emptyEffect();
        e.stock.megacredits = -8; e.vp = 5;
        out.push({decision: {response: wrapOr(i, wrapOr(j, leaf.response)), path: leaf.path, why: `claim ${name}`}, score: ctx.v3 ? 45 : 5 * ctx.vp - 8 + 6, kind: 'milestone', label: `Claim milestone ${name} (8 M€)`, effect: e});
      });
      break;
    }
    case 'award': {
      const aw = o as Or;
      const cost = Number(/(\d+)/.exec(titleOf(aw))?.[1] ?? 8);
      if (me.megacredits < cost) break;
      aw.options.forEach((a, j) => {
        const name = titleOf(a);
        const info = g.awards.find((x) => x.name === name);
        if (!info || info.color) return;
        const odds = awardOdds(info, ctx, cost);
        const e = emptyEffect();
        e.stock.megacredits = -cost;
        const standings = info.scores.map((s) => `${ctx.model.players.find((p) => p.color === s.color)?.name ?? s.color} ${s.score}`).join(', ');
        e.vpNote = `at the end 5 VP to first place, 2 VP to second (standings: ${standings})`;
        out.push({decision: {response: wrapOr(i, wrapOr(j, {type: 'option'})), path: `${at}or${j}`, why: `fund ${name}`},
          score: odds ? odds.score : -cost - 5, kind: 'award', label: `Fund award ${name} (${cost} M€)`, effect: e});
      });
      break;
    }
    case 'plants': {
      const leaf = spaceChoice(o as Extract<Input, {type: 'space'}>, ctx, {...mind, level: 'normal'}, at);
      if (!leaf) break;
      const id = (leaf.response as {spaceId: string}).spaceId;
      const e = spaceEffect(id, 'greenery', ctx);
      e.stock.plants = (e.stock.plants ?? 0) - plantCost(o);
      e.vp += 1; e.tiles.push('greenery');
      if (left.oxygen > 0) e.tr += 1;
      out.push({decision: {response: wrapOr(i, leaf.response), path: leaf.path, why: `convert plants into a greenery (${leaf.why})`},
        score: (left.oxygen > 0 ? ctx.tr : 0) + ctx.vp + 3, kind: 'greenery', label: `Convert ${plantCost(o)} plants into a greenery at ${id}`, space: id, effect: e});
      break;
    }
    case 'heat': {
      const e = emptyEffect();
      e.stock.heat = -8;
      if (left.temperature > 0) { e.tr = 1; e.other.push('temperature +1 step'); } else e.other.push('temperature already at maximum (no TR)');
      out.push({decision: {response: wrapOr(i, {type: 'option'}), path: `or${i}`, why: 'convert heat into temperature'},
        score: left.temperature > 0 ? ctx.tr + 3 : -1, kind: 'heat', label: 'Convert 8 heat into a temperature step', effect: e});
      break;
    }
    case 'sell': {
      // Normal v3 sells cards that will not be played before the end
      if (!ctx.v3) break;
      const dead = deadCards(o as CardIn, ctx);
      if (dead.length) {
        const e = emptyEffect();
        e.stock.megacredits = dead.length;
        out.push({decision: {response: wrapOr(i, {type: 'card', cards: dead}), path: `${at}sell`, why: `sell ${dead.join(', ')}`}, score: 0.03, kind: 'sell',
          label: `Sell patents: ${dead.join(', ')} (+${dead.length} M€)`, effect: e});
      }
      break;
    }
    case 'pass':
      out.push({decision: {response: wrapOr(i, {type: 'option'}), path: `or${i}`, why: 'pass'}, score: 0, kind: 'pass', label: 'Pass for this generation',
        effect: {...emptyEffect(), other: ['take no more actions this generation']}});
      break;
    case 'end':
      out.push({decision: {response: wrapOr(i, {type: 'option'}), path: `or${i}`, why: 'end turn'}, score: 0, kind: 'end', label: 'End turn',
        effect: {...emptyEffect(), other: ['end this turn; you may act again when your turn comes back this generation']}});
      break;
    case 'firstAction':
      out.push({decision: {response: wrapOr(i, {type: 'option'}), path: `or${i}`, why: titleOf(o)}, score: 50, kind: 'firstAction', label: titleOf(o),
        effect: {...emptyEffect(), other: ["your corporation's first action"]}});
      break;
    default:
      break;
    }
  });
  return out;
}

function plantCost(o: Input): number {
  return Number(/(\d+)/.exec(titleOf(o))?.[1] ?? 8);
}

function standardEffect(name: string, ctx: Ctx): Effect {
  const e = emptyEffect();
  const left = stepsLeft(ctx.model.game);
  switch (name) {
  case 'Power Plant:SP': e.prod.energy = 1; break;
  case 'Asteroid:SP': if (left.temperature) { e.tr = 1; e.other.push('temperature +1 step'); } else e.other.push('temperature at maximum (no TR)'); break;
  case 'Aquifer': if (left.oceans) { e.tr = 1; e.tiles.push('ocean (+2 M€ per ocean next to it)'); } break;
  case 'Greenery': e.vp = 1; e.tiles.push('greenery'); if (left.oxygen) { e.tr = 1; e.other.push('oxygen +1 step'); } break;
  case 'City': e.prod.megacredits = 1; e.tiles.push('city'); break;
  default: break;
  }
  return e;
}

// ---- tiles ------------------------------------------------------------------------------------
function spaceCandidates(w: Extract<Input, {type: 'space'}>, ctx: Ctx, goal: TileGoal): Candidate[] {
  const adj = neighbours(ctx.model.game.spaces);
  return rankSpaces(w.spaces, goal, ctx.me.color, ctx.model.game.spaces, bonusWorth(ctx)).map(({id, score}) => ({
    decision: {response: {type: 'space', spaceId: id}, path: `space:${id}`, why: `${goal} at ${id} (worth ${score.toFixed(1)})`},
    score, kind: 'space', label: `Space ${id}`, space: id, effect: spaceEffect(id, goal, ctx, adj),
  }));
}

// ---- the opening: corporation (a choice) and starting cards (yes/no each) ----------------------
function initialPrompt(w: Extract<Input, {type: 'initialCards'}>, ctx: Ctx, mind: Mind): Omit<Prompt, 'normal' | 'title'> | null {
  const kind = (o: Input) => {
    const t = titleOf(o).toLowerCase();
    return t.includes('corporation') ? 'corp' : t.includes('prelude') || t.includes('ceo') ? 'other' : 'project';
  };
  if (w.options.some((o) => kind(o) === 'other')) return null; // preludes and CEOs: heuristic only
  const corpStep = w.options.find((o) => kind(o) === 'corp') as Extract<Input, {type: 'card'}> | undefined;
  const projStep = w.options.find((o) => kind(o) === 'project') as Extract<Input, {type: 'card'}> | undefined;
  if (!corpStep || !projStep) return null;
  const corps = corpStep.cards.map((c) => {
    const def = findCard(c.name);
    const e = behaviorEffect(def?.behavior, ctx, def);
    if (def?.startingMegaCredits) e.stock.megacredits = def.startingMegaCredits;
    return {decision: {response: {type: 'card', cards: [c.name]}, path: `corp:${c.name}`, why: c.name} as Decision, score: 0, kind: 'corp', label: c.name, card: c.name, effect: e};
  });
  const cards = projStep.cards.map((c) => cardCandidate(c.name, c.calculatedCost, ctx, {response: {type: 'card', cards: [c.name]}, path: '', why: c.name}, 'buy'));
  void mind;
  return {type: 'initial', ask: 'Opening: which corporation, and which starting cards to buy (3 M€ each)?', candidates: [], multi: {cards, max: projStep.max, min: projStep.min, corps, corpIndex: w.options.indexOf(corpStep)}};
}

export {payFor};
