// Smart hints: quiet, provably true observations about the player's own position. Pure functions.
// Full mode reads only the player's private model and the engine's current turn menu (the engine offers a
// milestone, an award, a conversion or a card action only when it is legal and affordable, so those hints
// can never be wrong). Card badges compare a hand card's printed requirements with the board. Companion
// mode reads our own engine's state with the same rules the engine enforces.
import {AWARD_COSTS, boardOf, findStanding, GLOBAL, HEAT_PER_TEMPERATURE, MILESTONE_COST} from './board';
import {findCard} from './cards';
import {cardsInPlay, STANDING_HELPERS, tagCount} from './engine';
import {messageText} from './full';
import type {CardModel, PlayerInputModel, PlayerViewModel, PublicPlayerModel} from './full';
import type {GameState, PlayerState} from './game';
import type {CardDef, Requirement} from './types';

export type HintKind = 'milestone' | 'award' | 'plants' | 'heat' | 'actions';

/** A hint for the dock while it is your turn: one short line, plus the facts behind it. */
export type TurnHint = {id: string; kind: HintKind; line: string; facts: string[]};

/** A badge on a hand card whose requirement is close: the card's own requirement, not a promise it can be paid for. */
export type CardHint = {card: string; badge: string; facts: string[]};

export type Hints = {turn: TurnHint[]; cards: CardHint[]; unusedActions: string[]};

export const NO_HINTS: Hints = {turn: [], cards: [], unusedActions: []};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---- requirements: how far is a card from being allowed? ---------------------------------------
export type Params = {temperature: number; oxygen: number; oceans: number; venus: number};

/** Everything a requirement check needs, independent of the mode. `null` = unknown, so no badge. */
export type ReqFacts = {
  params: Params;
  /** global-parameter requirement tolerance in steps (Adaptation Technology, Inventrix, Special Design) */
  bonus: number;
  tags: (tag: string) => number;
  production: (r: string) => number | null;
  greeneries: number | null;
  tr: number;
};

const PARAMS = ['temperature', 'oxygen', 'oceans', 'venus'] as const;
const SCALE: Record<typeof PARAMS[number], number> = {temperature: 2, oxygen: 1, oceans: 1, venus: 2};
const UNIT = (p: typeof PARAMS[number], v: number) => (p === 'temperature' ? `${v} °C` : p === 'oceans' ? plural(v, 'ocean') : `${v}%`);
const PARAM_NAME: Record<typeof PARAMS[number], string> = {temperature: 'temperature', oxygen: 'oxygen', oceans: 'oceans', venus: 'Venus'};

type Status =
  | {kind: 'met'}
  | {kind: 'near'; badge: string; facts: string[]}
  | {kind: 'far'}
  | {kind: 'never'}
  | {kind: 'unknown'};

function requirementStatus(r: Requirement, f: ReqFacts): Status {
  for (const param of PARAMS) {
    const need = r[param];
    if (need === undefined) continue;
    if (param === 'venus') return {kind: 'unknown'};
    const scale = SCALE[param];
    const have = f.params[param];
    const tol = f.bonus * scale;
    const bonusFact = f.bonus ? [`Your requirement bonus allows ${plural(f.bonus, 'step')} either way.`] : [];
    if (r.max) {
      // Global parameters only ever rise, so a maximum that is already passed stays passed.
      return have <= need + tol ? {kind: 'met'} : {kind: 'never'};
    }
    const target = need - tol;
    if (have >= target) return {kind: 'met'};
    if (target > GLOBAL[param].max) return {kind: 'never'};
    const steps = Math.ceil((target - have) / scale);
    if (steps > 2) return {kind: 'far'};
    // The badge names the level the card needs (after any bonus) and how many steps remain.
    const badge = param === 'oceans'
      ? `${steps} more ocean${steps === 1 ? '' : 's'}`
      : param === 'temperature' ? `${target} °C · ${plural(steps, 'step')} to go` : `${target}% O₂ · ${plural(steps, 'step')} to go`;
    return {kind: 'near', badge, facts: [
      `The card requires ${r.max ? 'at most' : 'at least'} ${UNIT(param, need)}${param === 'oceans' ? '' : ` ${PARAM_NAME[param]}`}.`,
      ...bonusFact,
      `Mars is at ${UNIT(param, have)}${param === 'oceans' ? ' placed' : ` ${PARAM_NAME[param]}`}: ${plural(steps, 'step')} to go.`,
    ]};
  }
  if (r.tag) {
    if (r.all || r.max) return {kind: 'unknown'};
    const need = r.count ?? 1;
    const have = f.tags(r.tag);
    if (have >= need) return {kind: 'met'};
    if (need - have > 1) return {kind: 'far'};
    return {kind: 'near', badge: `1 more ${r.tag} tag`, facts: [`The card requires ${plural(need, `${r.tag} tag`)}; you have ${have}.`]};
  }
  if (r.production) {
    const have = f.production(r.production);
    if (have === null || r.max) return {kind: 'unknown'};
    return have >= (r.count ?? 1) ? {kind: 'met'} : {kind: 'far'};
  }
  if (r.greeneries !== undefined) {
    if (f.greeneries === null || r.max || r.all) return {kind: 'unknown'};
    return f.greeneries >= (r.count ?? r.greeneries) ? {kind: 'met'} : {kind: 'far'};
  }
  if (r.tr !== undefined) return f.tr >= (r.count ?? r.tr) ? {kind: 'met'} : {kind: 'far'};
  // cities (all players), parties, colonies…: not something we can prove from the model
  return {kind: 'unknown'};
}

/**
 * A badge for a card that is exactly one requirement away from being allowed, and that requirement is within
 * reach (1–2 global steps, or one tag). Every other requirement must be met and provable; otherwise no badge.
 */
export function cardHint(def: CardDef, f: ReqFacts): CardHint | null {
  if (def.group !== 'project' || !def.requirements.length) return null;
  let near: Extract<Status, {kind: 'near'}> | null = null;
  for (const r of def.requirements) {
    const s = requirementStatus(r, f);
    if (s.kind === 'met') continue;
    if (s.kind !== 'near' || near) return null;
    near = s;
  }
  return near ? {card: def.name, badge: near.badge, facts: near.facts} : null;
}

// ---- full mode ---------------------------------------------------------------------------------
function tagTotals(p: PublicPlayerModel): Record<string, number> {
  const raw = p.tags;
  const entries: Array<[string, number]> = Array.isArray(raw) ? raw.map((t) => [t.tag, t.count]) : Object.entries(raw ?? {});
  return Object.fromEntries(entries);
}

const PROD: Record<string, keyof PublicPlayerModel> = {
  megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction',
};

/** Requirement bonus visible in a full-mode tableau. Special Design's bonus lasts until the next card is played. */
export function tableauBonus(tableau: CardModel[]): number {
  let n = 0;
  for (const c of tableau) n += findCard(c.name)?.requirementBonus ?? 0;
  if (tableau[tableau.length - 1]?.name === 'Special Design') n += 2;
  return n;
}

export function fullFacts(model: PlayerViewModel): ReqFacts {
  const me = model.thisPlayer;
  const tags = tagTotals(me);
  const g = model.game;
  return {
    params: {temperature: g.temperature, oxygen: g.oxygenLevel, oceans: g.oceans, venus: g.venusScaleLevel},
    bonus: tableauBonus(me.tableau),
    tags: (t) => (tags[t] ?? 0) + (t === 'wild' ? 0 : tags.wild ?? 0),
    production: (r) => (PROD[r] ? (me[PROD[r]] as number) : null),
    greeneries: g.spaces.filter((s) => s.color === model.color && s.tileType === 0).length,
    tr: me.terraformRating,
  };
}

/** The engine's turn menu ("Take your first action" / "Take your next action"). */
export function isTurnMenu(w: PlayerInputModel | undefined): w is Extract<PlayerInputModel, {type: 'or'}> {
  return !!w && w.type === 'or' && /^take your (first|next) action/i.test(messageText(w.title));
}

const optionTitle = (o: PlayerInputModel) => (typeof o.title === 'string' ? o.title : o.title.message);
const findOption = (w: Extract<PlayerInputModel, {type: 'or'}>, test: (o: PlayerInputModel) => boolean) => (w.options as PlayerInputModel[]).find(test);

export function fullHints(model: PlayerViewModel): Hints {
  const facts = fullFacts(model);
  const cards: CardHint[] = [];
  for (const c of model.cardsInHand) {
    const def = findCard(c.name);
    if (!def) continue;
    const h = cardHint(def, facts);
    if (h) cards.push(h);
  }
  const w = model.waitingFor;
  if (!isTurnMenu(w)) return {turn: [], cards, unusedActions: []};
  const me = model.thisPlayer;
  const g = model.game;
  const turn: TurnHint[] = [];

  const mil = findOption(w, (o) => o.type === 'or' && optionTitle(o) === 'Claim a milestone');
  for (const o of ((mil as {options?: PlayerInputModel[]} | undefined)?.options ?? [])) {
    const name = messageText(o.title);
    const st = findStanding(name);
    const score = g.milestones.find((m) => m.name === name)?.scores.find((s) => s.color === model.color)?.score;
    turn.push({id: `milestone:${name}`, kind: 'milestone', line: `You can claim ${name} (${MILESTONE_COST} M€)`, facts: [
      st ? `${name}: ${st.text}.` : `${name} is open to you.`,
      ...(score !== undefined && st?.goal !== undefined ? [`You have ${score} of ${st.goal}.`] : []),
      `${plural(3 - g.milestones.filter((m) => m.color).length, 'milestone slot')} left.`,
    ]});
  }

  const award = findOption(w, (o) => o.type === 'or' && optionTitle(o) === 'Fund an award (${0} M€)');
  if (award && model.players.length > 1) {
    const cost = Number(typeof award.title === 'string' ? NaN : award.title.data[0]?.value);
    const rows: Array<{name: string; lead: number; mine: number}> = [];
    for (const o of (award as {options: PlayerInputModel[]}).options) {
      const name = messageText(o.title);
      const a = g.awards.find((x) => x.name === name);
      if (!a || a.color) continue;
      const mine = a.scores.find((s) => s.color === model.color)?.score;
      const others = a.scores.filter((s) => s.color !== model.color).map((s) => s.score);
      if (mine === undefined || !others.length || mine <= 0) continue;
      const best = Math.max(...others);
      if (mine >= best) rows.push({name, lead: mine - best, mine});
    }
    rows.sort((a, b) => b.lead - a.lead);
    for (const r of rows) {
      const st = findStanding(r.name);
      turn.push({id: `award:${r.name}`, kind: 'award',
        line: r.lead > 0 ? `${r.name}: you lead by ${r.lead}` : `${r.name}: you share the lead`,
        facts: [
          st ? `${r.name}: ${st.text}.` : `${r.name} is unfunded.`,
          r.lead > 0 ? `You have ${r.mine}; the next best has ${r.mine - r.lead}.` : `You and at least one other player have ${r.mine}.`,
          ...(Number.isFinite(cost) ? [`Funding it now costs ${cost} M€.`] : []),
          'The final standings are counted at the end of the game.',
        ]});
    }
  }

  const plants = findOption(w, (o) => optionTitle(o) === 'Convert ${0} plants into greenery');
  if (plants) {
    const need = Number(typeof plants.title === 'string' ? NaN : plants.title.data[0]?.value);
    turn.push({id: 'plants', kind: 'plants', line: `Your plants can become a greenery`, facts: [
      `You have ${me.plants} plants${Number.isFinite(need) ? `; a greenery costs ${need}` : ''}.`,
    ]});
  }

  const heat = findOption(w, (o) => optionTitle(o) === 'Convert 8 heat into temperature');
  if (heat && g.temperature < GLOBAL.temperature.max) {
    turn.push({id: 'heat', kind: 'heat', line: 'Your heat can raise the temperature', facts: [
      `You have ${me.heat} heat; a temperature step costs ${HEAT_PER_TEMPERATURE}.`,
      `Mars is at ${g.temperature} °C (the maximum is ${GLOBAL.temperature.max} °C).`,
    ]});
  }

  const actions = findOption(w, (o) => o.type === 'card' && !!(o as {selectBlueCardAction?: boolean}).selectBlueCardAction);
  const unusedActions = actions ? (actions as {cards: CardModel[]}).cards.map((c) => c.name) : [];
  if (unusedActions.length) {
    turn.push({id: 'actions', kind: 'actions', line: `${plural(unusedActions.length, 'card action')} ready: ${list(unusedActions)}`, facts: [
      `Not used this generation and available now: ${list(unusedActions)}.`,
      'Card actions reset at the end of the generation.',
    ]});
  }
  return {turn, cards, unusedActions};
}

// ---- companion mode ----------------------------------------------------------------------------
export function companionHints(s: GameState, playerId: string): Hints {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return NO_HINTS;
  const myTurn = s.phase === 'action' && s.current === p.id;
  const finalGreenery = s.phase === 'finalGreenery';
  if (!myTurn && !finalGreenery) return NO_HINTS;
  const turn: TurnHint[] = [];
  const board = boardOf(s);

  if (myTurn && s.milestones.length < 3 && p.stock.megacredits >= MILESTONE_COST) {
    for (const m of board.milestones) {
      if (m.manual || m.goal === undefined || s.milestones.some((x) => x.name === m.name)) continue;
      const v = m.value(p, STANDING_HELPERS);
      if (v === null || v < m.goal) continue;
      turn.push({id: `milestone:${m.name}`, kind: 'milestone', line: `You can claim ${m.name} (${MILESTONE_COST} M€)`, facts: [
        `${m.name}: ${m.text}.`, `You have ${v} of ${m.goal}.`, `${plural(3 - s.milestones.length, 'milestone slot')} left.`,
      ]});
    }
  }

  if (myTurn && s.awards.length < 3 && s.players.length > 1) {
    const cost = AWARD_COSTS[s.awards.length];
    if (p.stock.megacredits >= cost) {
      const rows: Array<{name: string; text: string; lead: number; mine: number}> = [];
      for (const a of board.awards) {
        if (s.awards.some((x) => x.name === a.name)) continue;
        const values = s.players.map((x) => ({id: x.id, v: a.value(x, STANDING_HELPERS)}));
        if (values.some((x) => x.v === null)) continue;
        const mine = values.find((x) => x.id === p.id)!.v as number;
        const best = Math.max(...values.filter((x) => x.id !== p.id).map((x) => x.v as number));
        if (mine > 0 && mine >= best) rows.push({name: a.name, text: a.text, lead: mine - best, mine});
      }
      rows.sort((a, b) => b.lead - a.lead);
      for (const r of rows) {
        turn.push({id: `award:${r.name}`, kind: 'award', line: r.lead > 0 ? `${r.name}: you lead by ${r.lead}` : `${r.name}: you share the lead`, facts: [
          `${r.name}: ${r.text}.`,
          r.lead > 0 ? `You have ${r.mine}; the next best has ${r.mine - r.lead}.` : `You and at least one other player have ${r.mine}.`,
          `Funding it now costs ${cost} M€.`, 'The final standings are counted at the end of the game.',
        ]});
      }
    }
  }

  if (p.stock.plants >= p.greeneryCost) {
    turn.push({id: 'plants', kind: 'plants', line: 'Your plants can become a greenery', facts: [`You have ${p.stock.plants} plants; a greenery costs ${p.greeneryCost}.`]});
  }
  if (myTurn && p.stock.heat >= HEAT_PER_TEMPERATURE && s.global.temperature < GLOBAL.temperature.max) {
    turn.push({id: 'heat', kind: 'heat', line: 'Your heat can raise the temperature', facts: [
      `You have ${p.stock.heat} heat; a temperature step costs ${HEAT_PER_TEMPERATURE}.`,
      `Mars is at ${s.global.temperature} °C (the maximum is ${GLOBAL.temperature.max} °C).`,
    ]});
  }

  const unusedActions = myTurn ? unusedCompanionActions(p) : [];
  if (unusedActions.length) {
    turn.push({id: 'actions', kind: 'actions', line: `${plural(unusedActions.length, 'card action')} not used yet: ${list(unusedActions)}`, facts: [
      `Not used this generation: ${list(unusedActions)}.`, 'Card actions reset at the end of the generation.',
    ]});
  }
  return {turn, cards: [], unusedActions};
}

/** Blue-card actions (and a corporation's first action) this player has not used this generation. */
export function unusedCompanionActions(p: PlayerState): string[] {
  const out: string[] = [];
  for (const c of cardsInPlay(p)) {
    if (c.group === 'corporation' && c.firstAction && !p.usedActions.includes('first:' + c.name)) out.push(c.name);
    else if (c.action && !p.usedActions.includes(c.name)) out.push(c.name);
  }
  return out;
}

/** Companion requirement facts for a card (used by tests and the play-card review). */
export function companionFacts(s: GameState, p: PlayerState, bonus: number): ReqFacts {
  return {
    params: {temperature: s.global.temperature, oxygen: s.global.oxygen, oceans: s.global.oceans, venus: s.global.venus},
    bonus,
    tags: (t) => tagCount(p, t) + (t === 'wild' ? 0 : tagCount(p, 'wild')),
    production: (r) => (r in p.production ? p.production[r as keyof PlayerState['production']] : null),
    greeneries: p.tiles.greenery,
    tr: p.tr,
  };
}
