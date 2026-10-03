// Derived, decision-relevant facts for the judge. Where render.ts dumps the
// state, these say what it means: Normal's own valuation of each option, the game clock, the race for milestones and
// awards, what every player did lately, the bot's own plan, and the effects and synergies of the cards in play. Each
// piece is a switchable part of the judge's context (JudgeConfig.parts), so the experiment can ablate them.
//
// History comes from a JudgeMemory: the judge observes its own player view at every decision and keeps the first view
// of each generation, plus its own picks this generation. The same memory works in the arena and in the server.
import {findCard} from '../../../../shared/cards';
import {TILE} from '../../../../shared/full';
import type {Color, PlayerViewModel, PublicPlayerModel} from '../../../../shared/full';
import type {Tag} from '../../../../shared/types';
import {stepsLeft, stockValue, tagMap, unitValue} from '../value';
import type {Ctx} from '../value';
import type {Candidate} from './candidates';
import {RES} from './effects';
import type {Effect} from './effects';
import {PROD_KEY} from './render';

export const PARTS = ['evals', 'clock', 'threats', 'history', 'plan', 'effects', 'crit'] as const;
export type Part = typeof PARTS[number];

const SHORT: Record<string, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plant', energy: 'energy', heat: 'heat'};
const r1 = (n: number) => Math.round(n * 10) / 10;
const sgn = (n: number) => (n > 0 ? `+${r1(n)}` : `${r1(n)}`);

// ---- memory ----------------------------------------------------------------------------------
export type PlayerSnap = {color: Color; name: string; tr: number; vp: number; prod: Record<string, number>; plants: number; heat: number;
  cards: string[]; cities: number; greeneries: number; tiles: number};
export type GenSnap = {gen: number; steps: number; players: PlayerSnap[]; milestones: Record<string, Color>; awards: Record<string, Color>};
export type JudgeMemory = {starts: GenSnap[]; last?: GenSnap; mine: Array<{gen: number; label: string}>};

export const newMemory = (): JudgeMemory => ({starts: [], mine: []});

export function snapshot(m: PlayerViewModel): GenSnap {
  const tiles = new Map<string, {cities: number; greeneries: number; tiles: number}>();
  for (const s of m.game.spaces) {
    if (!s.color || s.tileType === undefined || s.tileType === TILE.OCEAN) continue;
    const t = tiles.get(s.color) ?? {cities: 0, greeneries: 0, tiles: 0};
    t.tiles++;
    if (s.tileType === TILE.CITY || s.tileType === TILE.CAPITAL) t.cities++;
    if (s.tileType === TILE.GREENERY) t.greeneries++;
    tiles.set(s.color, t);
  }
  const left = stepsLeft(m.game).total;
  return {
    gen: m.game.generation, steps: 42 - left,
    players: m.players.map((p) => ({color: p.color, name: p.name, tr: p.terraformRating, vp: p.victoryPointsBreakdown?.total ?? p.terraformRating,
      prod: Object.fromEntries(RES.map((r) => [r, (p as unknown as Record<string, number>)[PROD_KEY[r]] ?? 0])),
      plants: p.plants, heat: p.heat, cards: p.tableau.map((c) => c.name), ...(tiles.get(p.color) ?? {cities: 0, greeneries: 0, tiles: 0})})),
    milestones: Object.fromEntries(m.game.milestones.filter((x) => x.color).map((x) => [x.name, x.color!])),
    awards: Object.fromEntries(m.game.awards.filter((x) => x.color).map((x) => [x.name, x.color!])),
  };
}

/** Record what the judge sees now (the first view of a generation is kept as that generation's start). */
export function observe(mem: JudgeMemory, m: PlayerViewModel): void {
  const s = snapshot(m);
  if (!mem.starts.some((x) => x.gen === s.gen)) {
    mem.starts.push(s);
    if (mem.starts.length > 4) mem.starts.shift();
  }
  mem.last = s;
  mem.mine = mem.mine.filter((x) => x.gen === s.gen);
}

/** The judge's own choice, for "your moves this generation". */
export function remember(mem: JudgeMemory, gen: number, label: string): void {
  mem.mine.push({gen, label});
  if (mem.mine.length > 12) mem.mine.shift();
}

const startOf = (mem: JudgeMemory | undefined, gen: number) => mem?.starts.find((x) => x.gen === gen);

// ---- evals: Normal's valuation of an option --------------------------------------------------
export type Breakdown = {vp: number; tr: number; economy: number; gain: number; cost: number};

/** An option's worth by Normal's own rates (M€): points now, TR, production for the rest of the game, resources. */
export function breakdown(ctx: Ctx, e: Effect): Breakdown {
  const g = ctx.model.game;
  const payouts = Math.max(0, ctx.gens - 0.4);
  let economy = 0, gain = 0, cost = 0;
  for (const r of RES) {
    const p = e.prod[r] ?? 0;
    if (p) economy += p * unitValue(r, g) * payouts;
    const s = e.stock[r] ?? 0;
    if (s > 0) gain += s * stockValue(r, ctx);
    if (s < 0) cost += s * (r === 'megacredits' ? 1 : stockValue(r, ctx));
  }
  return {vp: e.vp * ctx.vp, tr: e.tr * ctx.tr, economy, gain, cost};
}

/** "Normal's estimate 12.5, 2nd of 9 (VP 0, TR +9, economy +8 over the game, cost −14; enables: ...)". */
export function evalText(ctx: Ctx, c: Candidate, rank: number, legal: number): string {
  const b = breakdown(ctx, c.effect);
  const bits: string[] = [];
  if (b.vp) bits.push(`VP now ${sgn(b.vp)}`);
  if (c.effect.vpNote && c.card) bits.push('card VP later');
  if (b.tr) bits.push(`TR ${sgn(b.tr)}`);
  if (b.economy) bits.push(`economy ${sgn(b.economy)} over the game`);
  if (b.gain) bits.push(`resources ${sgn(b.gain)}`);
  if (b.cost) bits.push(`cost ${sgn(b.cost)}`);
  const enables = c.effect.other.filter((x) => /action|cost .* less|effect:|draw|worth|discount/.test(x)).slice(0, 2);
  if (enables.length) bits.push(`enables: ${enables.join('; ')}`);
  const nth = rank === 1 ? "Normal's pick" : `Normal ranks it ${rank} of ${legal}`;
  return `[${nth}; score ${r1(c.score)}${bits.length ? `; in M€: ${bits.join(', ')}` : ''}]`;
}

// ---- clock -----------------------------------------------------------------------------------
/** Steps a generation recently (the last one or two whole generations), or null without history. */
export function recentPace(mem: JudgeMemory | undefined, gen: number): number | null {
  const now = startOf(mem, gen);
  const back = startOf(mem, gen - 2) ?? startOf(mem, gen - 1);
  if (!now || !back || back.gen === now.gen) return null;
  return (now.steps - back.steps) / (now.gen - back.gen);
}

export function clockText(ctx: Ctx, mem?: JudgeMemory): string {
  const g = ctx.model.game;
  const left = stepsLeft(g).total;
  const pace = recentPace(mem, g.generation);
  const byPace = pace && pace > 0 ? Math.max(1, Math.ceil((left + (pace * 0.5)) / pace)) : null;
  const gens = ctx.gens;
  const phase = gens <= 1 ? 'LAST GENERATION' : gens <= 3 ? 'endgame' : gens <= 6 ? 'midgame' : 'early game';
  const lines = [`CLOCK: ${left} of 42 global steps left. ${pace !== null ? `Recent pace ${r1(pace)} steps a generation, so about ${byPace} generation(s) left including this one` : 'No pace history yet'}; Normal's estimate ${gens}. Phase: ${phase}.`];
  const payouts = Math.max(0, gens - 0.4);
  lines.push(`Worth now: 1 VP = ${ctx.vp} M€; 1 TR = ${ctx.tr} M€ (a point plus income); +1 M€ production returns about ${r1(payouts)} M€ by the end; a card drawn ${ctx.lastGen ? 'is almost worthless now' : 'about 3.5 M€'}.`);
  if (gens <= 1) lines.push('Production bought now never pays. Money left at the end scores nothing: convert it into TR, tiles and points.');
  else if (gens <= 3) lines.push('Production pays only a few more times: prefer points, TR and tiles unless production is cheap.');
  else lines.push('Production and card engines still pay for many generations.');
  return lines.join('\n');
}

// ---- threats ---------------------------------------------------------------------------------
const GOAL: Record<string, number> = {Terraformer: 35, Mayor: 3, Gardener: 3, Builder: 8, Planner: 16};
const nameOf = (ctx: Ctx, c?: string) => ctx.model.players.find((p) => p.color === c)?.name ?? c ?? '?';
const you = (ctx: Ctx, c?: string) => (c === ctx.me.color ? 'you' : nameOf(ctx, c));

export function threatsText(ctx: Ctx, mem?: JudgeMemory): string {
  const g = ctx.model.game;
  const lines: string[] = ['THREATS AND RACES'];
  const vp = (p: PublicPlayerModel) => p.victoryPointsBreakdown?.total ?? p.terraformRating;
  const order = [...ctx.model.players].sort((a, b) => vp(b) - vp(a));
  const mine = vp(ctx.me);
  lines.push(`Points: ${order.map((p) => `${you(ctx, p.color)} ${vp(p)}`).join(', ')}. ${order[0].color === ctx.me.color ? `You lead by ${mine - vp(order[1] ?? order[0])}.` : `${order[0].name} leads you by ${vp(order[0]) - mine}.`}`);
  const claimed = g.milestones.filter((x) => x.color).length;
  if (claimed < 3) {
    const race = g.milestones.filter((x) => !x.color).map((x) => {
      const goal = GOAL[x.name];
      if (!goal) return null;
      const near = x.scores.map((s) => ({c: s.color, need: Math.max(0, goal - s.score)})).sort((a, b) => a.need - b.need).slice(0, 3);
      if (!near.length || near[0].need > 3) return null;
      return `${x.name} (${goal}): ${near.map((n) => `${you(ctx, n.c)} ${n.need === 0 ? 'can claim now' : `${n.c === ctx.me.color ? 'need' : 'needs'} ${n.need}`}`).join(', ')}`;
    }).filter(Boolean);
    lines.push(`Milestones (${3 - claimed} left to claim): ${race.length ? race.join('; ') : 'nobody is within 3 of one'}.`);
  } else lines.push('Milestones: all three claimed.');
  const funded = g.awards.filter((x) => x.color).length;
  lines.push(`Awards (${funded} of 3 funded): ` + g.awards.map((x) => {
    const s = [...x.scores].sort((a, b) => b.score - a.score);
    const lead = s[0], second = s[1];
    if (!lead) return `${x.name}${x.color ? ' [funded]' : ''} no scores`;
    const myScore = x.scores.find((y) => y.color === ctx.me.color)?.score ?? 0;
    const tie = second && second.score === lead.score;
    const who = tie ? 'tied' : `${you(ctx, lead.color)} leads by ${lead.score - (second?.score ?? 0)}`;
    return `${x.name}${x.color ? ' [funded]' : ''} ${who}${lead.color !== ctx.me.color ? ` (you ${myScore} vs ${lead.score})` : ''}`;
  }).join('; ') + '.');
  // Engine growth: production now against two generations ago (or the oldest start remembered).
  const back = startOf(mem, g.generation - 2) ?? startOf(mem, g.generation - 1) ?? mem?.starts[0];
  for (const p of ctx.model.players) {
    if (p.color === ctx.me.color) continue;
    const bits: string[] = [];
    const income = p.megacreditProduction + p.terraformRating;
    bits.push(`income ${income} M€ a generation`);
    const old = back?.players.find((x) => x.color === p.color);
    if (old && back!.gen < g.generation) {
      const d = RES.map((r) => [r, (p as unknown as Record<string, number>)[PROD_KEY[r]] - (old.prod[r] ?? 0)] as const).filter(([, n]) => n);
      bits.push(d.length ? `production since gen ${back!.gen}: ${d.map(([r, n]) => `${sgn(n)} ${SHORT[r]}`).join(', ')}` : `no production change since gen ${back!.gen}`);
    }
    const next: string[] = [];
    if (p.plants >= 8) next.push(`a greenery (${p.plants} plants)`);
    if (p.heat >= 8 && stepsLeft(g).temperature > 0) next.push(`a temperature step (${p.heat} heat)`);
    for (const x of g.milestones) {
      if (x.color || claimed >= 3) continue;
      const sc = x.scores.find((y) => y.color === p.color)?.score ?? 0;
      if (GOAL[x.name] && sc >= GOAL[x.name] && p.megacredits >= 8) next.push(`claiming ${x.name}`);
    }
    bits.push(next.length ? `can do next: ${next.join(', ')}` : 'no obvious big play ready');
    lines.push(`${p.name}: ${bits.join('; ')}.`);
  }
  return lines.join('\n');
}

// ---- history ---------------------------------------------------------------------------------
function diff(a: PlayerSnap, b: PlayerSnap): string {
  const bits: string[] = [];
  const cards = b.cards.filter((c) => !a.cards.includes(c));
  if (cards.length) bits.push(`played ${cards.slice(0, 4).join(', ')}${cards.length > 4 ? ` +${cards.length - 4} more` : ''}`);
  if (b.cities > a.cities) bits.push(`+${b.cities - a.cities} city`);
  if (b.greeneries > a.greeneries) bits.push(`+${b.greeneries - a.greeneries} greenery`);
  const prod = RES.map((r) => [r, (b.prod[r] ?? 0) - (a.prod[r] ?? 0)] as const).filter(([, n]) => n);
  if (prod.length) bits.push(`production ${prod.map(([r, n]) => `${sgn(n)} ${SHORT[r]}`).join(', ')}`);
  if (b.tr !== a.tr) bits.push(`TR ${sgn(b.tr - a.tr)}`);
  if (b.vp !== a.vp) bits.push(`VP ${sgn(b.vp - a.vp)}`);
  return bits.join('; ') || 'nothing visible';
}

export function historyText(ctx: Ctx, mem?: JudgeMemory): string {
  const g = ctx.model.game.generation;
  if (!mem?.last) return 'RECENT HISTORY: none recorded yet.';
  const lines: string[] = ['RECENT HISTORY'];
  const prev = startOf(mem, g - 1), now = startOf(mem, g);
  for (const p of ctx.model.players) {
    const parts: string[] = [];
    const a = prev?.players.find((x) => x.color === p.color), b = now?.players.find((x) => x.color === p.color);
    const c = mem.last.players.find((x) => x.color === p.color);
    if (a && b) parts.push(`gen ${g - 1}: ${diff(a, b)}`);
    if (b && c && mem.last !== now) parts.push(`gen ${g} so far: ${diff(b, c)}`);
    if (parts.length) lines.push(`${p.color === ctx.me.color ? 'You' : p.name}: ${parts.join(' | ')}`);
  }
  const ms = Object.entries(mem.last.milestones).filter(([k]) => !prev || !prev.milestones[k]).map(([k, c]) => `${k} claimed by ${you(ctx, c)}`);
  const aw = Object.entries(mem.last.awards).filter(([k]) => !prev || !prev.awards[k]).map(([k, c]) => `${k} funded by ${you(ctx, c)}`);
  if (ms.length || aw.length) lines.push(`Lately: ${[...ms, ...aw].join('; ')}.`);
  return lines.length > 1 ? lines.join('\n') : 'RECENT HISTORY: no earlier generation recorded yet.';
}

// ---- plan ------------------------------------------------------------------------------------
/** A strategy tag for the bot from its tags, production and table. */
export function planTags(ctx: Ctx): string[] {
  const t = ctx.tags, me = ctx.me;
  const s: Array<[string, number]> = [
    ['plant engine (greeneries)', me.plantProduction * 1.5 + (t.plant ?? 0) + (t.microbe ?? 0) * 0.5],
    ['heat rush (temperature)', me.heatProduction + me.energyProduction * 0.7 + (t.power ?? 0) * 0.5],
    ['Jovian VP', (t.jovian ?? 0) * 2.5],
    ['builder (steel, building tags)', me.steelProduction * 1.5 + (t.building ?? 0) * 0.7],
    ['space (titanium, space tags)', me.titaniumProduction * 1.5 + (t.space ?? 0) * 0.7],
    ['science engine (card draw)', (t.science ?? 0) * 1.2],
    ['money engine', me.megacreditProduction * 0.5],
    ['cities and tiles', me.citiesCount * 2],
  ];
  const ranked = s.sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 3);
  return ranked.slice(0, 2).map(([k]) => k);
}

export function planText(ctx: Ctx, mem?: JudgeMemory): string {
  const tags = planTags(ctx);
  const lines = [`YOUR PLAN: ${tags.length ? tags.join(' + ') : 'no clear engine yet (flexible)'}.`];
  const mine = mem?.mine.filter((x) => x.gen === ctx.model.game.generation).map((x) => x.label) ?? [];
  if (mine.length) lines.push(`Your moves this generation: ${mine.slice(-6).join('; ')}.`);
  return lines.join('\n');
}

// ---- effects and synergies -------------------------------------------------------------------
export function effectsText(ctx: Ctx): string {
  const lines: string[] = ['EFFECTS IN PLAY'];
  const discounts: Array<{tag?: Tag; amount: number; card: string}> = [];
  const triggers: Array<{tags?: Tag[]; text: string; card: string}> = [];
  for (const c of ctx.me.tableau) {
    const def = findCard(c.name);
    if (!def || def.type === 'event') continue;
    for (const d of def.cardDiscount ?? []) discounts.push({tag: d.tag, amount: d.amount, card: c.name});
    for (const t of def.triggers ?? []) if (t.scope !== 'others') triggers.push({tags: t.tags, text: t.text ?? t.when, card: c.name});
    if (def.behavior?.steelValue) lines.push(`${c.name}: steel worth ${2 + def.behavior.steelValue} M€.`);
    if (def.behavior?.titanumValue) lines.push(`${c.name}: titanium worth ${3 + def.behavior.titanumValue} M€.`);
  }
  if (discounts.length) lines.push(`Discounts: ${discounts.map((d) => `${d.card} −${d.amount} M€ on ${d.tag ? d.tag + ' cards' : 'every card'}`).join('; ')}.`);
  if (triggers.length) lines.push(`Triggers: ${triggers.slice(0, 5).map((x) => `${x.card}: ${x.text}`).join('; ')}.`);
  // Hand cards that combine with what is in play.
  const combos: string[] = [];
  for (const h of ctx.model.cardsInHand) {
    const def = findCard(h.name);
    if (!def) continue;
    const why: string[] = [];
    const disc = discounts.filter((d) => !d.tag || def.tags.includes(d.tag)).reduce((a, d) => a + d.amount, 0);
    if (disc) why.push(`−${disc} M€ discount`);
    const trig = triggers.filter((x) => x.tags?.some((t) => def.tags.includes(t)));
    if (trig.length) why.push(`fires ${trig.map((x) => x.card).join(', ')}`);
    const vp = def.victoryPoints;
    if (vp && typeof vp === 'object' && vp.tag) why.push(`scores per ${vp.tag} tag (you have ${ctx.tags[vp.tag] ?? 0})`);
    if (def.resourceType && def.action) why.push(`collects ${def.resourceType.toLowerCase()}s`);
    const unmet = (def.requirements ?? []).filter((r) => r.tag && !r.max && (ctx.tags[r.tag] ?? 0) < (r.count ?? 1));
    if (unmet.length) why.push(`needs ${unmet.map((r) => `${r.count ?? 1} ${r.tag} (have ${ctx.tags[r.tag!] ?? 0})`).join(', ')}`);
    if (why.length) combos.push(`${h.name}: ${why.join(', ')}`);
  }
  if (combos.length) lines.push(`Hand synergies: ${combos.slice(0, 6).join('; ')}.`);
  return lines.length > 1 ? lines.join('\n') : 'EFFECTS IN PLAY: none.';
}

// ---- criteria --------------------------------------------------------------------------------
/** The question's instructions, weighted by the game phase. */
export function criteria(ctx: Ctx): string {
  if (ctx.gens <= 1) return 'This is the last generation: only points scored by the end count. Prefer TR, tiles, milestones, awards and card VP; production, card draw and money left over are worth nothing.';
  if (ctx.gens <= 3) return 'The game ends in about ' + ctx.gens + ' generations: weigh points and TR most, production only if it pays back quickly, and spend money rather than hoard it. Deny a rival a milestone or award when it is close.';
  if (ctx.gens <= 6) return 'Midgame: balance economy against points. Take milestones and awards you can secure, keep your plan consistent, and watch rivals close to a milestone.';
  return 'Early game: economy first (production, card draw, discounts, metal production with matching cards). Points matter less now, but milestones you can claim cheaply are worth taking.';
}

/** Tags each option for the distinct candidate set: what kind of value it mostly brings. */
export function leaning(ctx: Ctx, c: Candidate): {economy: number; points: number; denial: number} {
  const b = breakdown(ctx, c.effect);
  const denial = c.kind === 'milestone' || c.kind === 'award' ? 10 : c.effect.other.some((x) => /rival|remove|steal/.test(x)) ? 4 : 0;
  return {economy: b.economy + (c.effect.other.some((x) => /action|less|draw/.test(x)) ? 4 : 0), points: b.vp + b.tr, denial};
}
