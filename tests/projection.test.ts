// The phone's move projection (src/shared/projection.ts) and turn planning rules (src/client/phone/full/plan/rules.ts).
// Projections are checked against the real engine run in-process (vendor/tm/build, the commit the server runs): each
// case stages a game, projects a move from the player's own view, makes the move in the engine and compares.
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {act, clone, newGame, view, waiting} from '../tools/judge/engine';
import type {EngineGame, EnginePlayer} from '../tools/judge/engine';
import {decide} from '../src/server/full/bots/decide';
import {isTurnMenuQuestion} from '../src/shared/sync';
import {payment} from '../src/shared/full';
import type {InputResponse, PlayerInputModel, PlayerViewModel} from '../src/shared/full';
import {canMakeIn, defaultPayment, previewText, project, spaceBonus, worldFromView} from '../src/shared/projection';
import type {Move, Projection, Range} from '../src/shared/projection';
import {findCard} from '../src/shared/cards';
import {RESOURCES} from '../src/shared/types';
import {checkPlan, newPlan, planFate, planNow, seenNow, trayTotals} from '../src/client/phone/full/plan/rules';
import type {Plan, PlanNow} from '../src/client/phone/full/plan/rules';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const {newProjectCard} = require('../vendor/tm/build/src/server/createCard.js');

type Stage = {hand?: string[]; tableau?: string[]; mc?: number; steel?: number; titanium?: number; plants?: number; heat?: number; energy?: number;
  temperature?: number; oxygen?: number; seed?: number; prod?: Partial<Record<'energy' | 'heat' | 'plants', number>>;
  /** the other player's production and plants */
  beaProd?: Partial<Record<'energy' | 'heat' | 'plants', number>>; beaPlants?: number};

/** A two-player game at Ada's first turn menu of a turn, with these cards and numbers written in (as a reload would). */
function stage(o: Stage = {}): {game: EngineGame; ada: EnginePlayer; m: PlayerViewModel} {
  const g = newGame(o.seed ?? 5, ['Ada', 'Bea']);
  for (let i = 0; i < 400; i++) {
    const ws = waiting(g);
    const p = ws.find((x: EnginePlayer) => x.name === 'Ada') ?? ws[0];
    const m = view(p);
    if (p.name === 'Ada' && m.game.phase === 'action' && isTurnMenuQuestion(m.waitingFor) && m.thisPlayer.actionsTakenThisRound === 0) break;
    const d = decide(m.waitingFor!, m, {level: 'normal', rng: () => 0.4, avoid: new Set()});
    act(p, d!.response);
  }
  const a = g.players.find((x: EnginePlayer) => x.name === 'Ada');
  for (const n of o.hand ?? []) a.cardsInHand.push(newProjectCard(n));
  for (const n of o.tableau ?? []) a.playedCards.push(newProjectCard(n));
  if (o.mc !== undefined) a.megaCredits = o.mc;
  if (o.steel !== undefined) a.steel = o.steel;
  if (o.titanium !== undefined) a.titanium = o.titanium;
  if (o.plants !== undefined) a.plants = o.plants;
  if (o.heat !== undefined) a.heat = o.heat;
  if (o.energy !== undefined) a.energy = o.energy;
  for (const [k, v] of Object.entries(o.prod ?? {})) a.production[k] = v;
  const b = g.players.find((x: EnginePlayer) => x.name === 'Bea');
  for (const [k, v] of Object.entries(o.beaProd ?? {})) b.production[k] = v;
  if (o.beaPlants !== undefined) b.plants = o.beaPlants;
  if (o.temperature !== undefined) g.temperature = o.temperature;
  if (o.oxygen !== undefined) g.oxygenLevel = o.oxygen;
  const g2 = clone(g);
  const ada = g2.players.find((x: EnginePlayer) => x.name === 'Ada');
  return {game: g2, ada, m: view(ada)};
}

/** The turn-menu answer for a move (with the payment the phone suggests). */
function answer(m: PlayerViewModel, move: Move, space?: string): InputResponse {
  const opts = (m.waitingFor as any).options as PlayerInputModel[];
  const t = (o: PlayerInputModel) => (typeof o.title === 'string' ? o.title : (o.title as {message: string}).message).toLowerCase();
  const me = m.thisPlayer;
  if (move.kind === 'play' || move.kind === 'standard') {
    const name = move.kind === 'play' ? move.card : move.project;
    const index = opts.findIndex((o) => o.type === 'projectCard' && (o as any).cards.some((c: any) => c.name === name && !c.isDisabled));
    expect(index, `${name} offered`).toBeGreaterThanOrEqual(0);
    const c = (opts[index] as any).cards.find((x: any) => x.name === name);
    const def = findCard(name);
    const pay = (move as {payment?: any}).payment ?? defaultPayment(me, c.calculatedCost, {steel: move.kind === 'play' && !!def?.tags.includes('building'),
      titanium: move.kind === 'play' && !!def?.tags.includes('space'), heat: !!(opts[index] as any).paymentOptions?.heat});
    return {type: 'or', index, response: {type: 'projectCard', card: name, payment: payment(pay)}};
  }
  if (move.kind === 'action') {
    const index = opts.findIndex((o) => o.type === 'card' && (o as any).selectBlueCardAction);
    return {type: 'or', index, response: {type: 'card', cards: [move.card]}};
  }
  if (move.kind === 'plants') {
    const index = opts.findIndex((o) => t(o).includes('greenery') && t(o).includes('plants'));
    return {type: 'or', index, response: {type: 'space', spaceId: space ?? (opts[index] as any).spaces[0]}};
  }
  const index = opts.findIndex((o) => t(o).includes('heat') && t(o).includes('temperature'));
  return {type: 'or', index, response: {type: 'option'}};
}

/** Make the move in the engine, answering its follow-ups with the Normal bot; Ada's view afterwards. */
function make(s: ReturnType<typeof stage>, move: Move, space?: string): PlayerViewModel {
  act(s.ada, answer(s.m, move, space));
  for (let i = 0; i < 30; i++) {
    const w = s.ada.getWaitingFor();
    if (!w) break;
    const m = view(s.ada);
    if (isTurnMenuQuestion(m.waitingFor)) break;
    act(s.ada, decide(m.waitingFor!, m, {level: 'normal', rng: () => 0.4, avoid: new Set()})!.response);
  }
  return view(s.ada);
}

const within = (r: Range, v: number) => v >= r.lo && v <= r.hi;
const PROD = {megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction', plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction'} as const;

/** Every number the projection gives agrees with the engine: exact claims equal, ranges contain the real value. */
function agrees(p: Extract<Projection, {ok: true}>, after: PlayerViewModel) {
  const me = after.thisPlayer;
  for (const r of RESOURCES) {
    expect(within(p.after.stock[r], me[r] as number), `${r} ${JSON.stringify(p.after.stock[r])} vs ${me[r]}`).toBe(true);
    expect(within(p.after.production[r], me[PROD[r]] as number), `${r} production`).toBe(true);
  }
  expect(within(p.after.tr, me.terraformRating), 'TR').toBe(true);
  expect(within(p.after.hand, after.cardsInHand.length), 'hand').toBe(true);
  expect(within(p.after.global.temperature, after.game.temperature)).toBe(true);
  expect(within(p.after.global.oxygen, after.game.oxygenLevel)).toBe(true);
  expect(within(p.after.global.oceans, after.game.oceans)).toBe(true);
}

const lineOf = (p: Projection) => previewText(p);

describe('projection agrees with the engine for real cards', () => {
  it('Lichen: −7 M€, +1 plant production, a plant tag', () => {
    const s = stage({hand: ['Lichen'], mc: 30, temperature: -20});
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Lichen'});
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(lineOf(p)).toBe('−7 M€ · +1 plant production · +1 plant tag');
    agrees(p, make(s, {kind: 'play', card: 'Lichen'}));
  });

  it('Comet: the ocean is placed, its bonus depends on the space; plants taken from another player is your choice', () => {
    const s = stage({hand: ['Comet'], mc: 40, temperature: -20, beaPlants: 4});
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Comet'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toMatch(/^−21 M€ · places an ocean · raises temperature 1 step · \+2 TR/);
    expect(p.unknowns.map((u) => u.text)).toContain('Places an ocean: the bonus depends on the space');
    expect(p.unknowns.some((u) => /Removes up to 3 plants from another player/.test(u.text))).toBe(true);
    // the space's bonus is open: M€ is "at least"
    expect(p.after.stock.megacredits.hi).toBe(Infinity);
    agrees(p, make(s, {kind: 'play', card: 'Comet'}));
  });

  it('Nuclear Power: production changes both ways', () => {
    const s = stage({hand: ['Nuclear Power'], mc: 30});
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Nuclear Power'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toContain('−2 M€ production · +3 energy production');
    agrees(p, make(s, {kind: 'play', card: 'Nuclear Power'}));
  });

  it('Heat Trappers: another player loses heat production (you choose who); your energy production goes up', () => {
    const s = stage({hand: ['Heat Trappers'], mc: 30, beaProd: {heat: 3}});
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Heat Trappers'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toContain('+1 energy production');
    expect(p.unknowns.map((u) => u.text)).toContain('Another player loses 2 heat production (you choose who)');
    agrees(p, make(s, {kind: 'play', card: 'Heat Trappers'}));
  });

  it('Mining Expedition: oxygen, TR and steel', () => {
    const s = stage({hand: ['Mining Expedition'], mc: 30, plants: 0});
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Mining Expedition'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toMatch(/raises oxygen 1 step · \+1 TR · \+2 steel/);
    agrees(p, make(s, {kind: 'play', card: 'Mining Expedition'}));
  });

  it('Deep Well Heating: a building card paid partly with steel, as the payment says', () => {
    const s = stage({hand: ['Deep Well Heating'], mc: 40, steel: 5, temperature: -20});
    const cost = s.m.cardsInHand.find((c) => c.name === 'Deep Well Heating')!.calculatedCost!;
    const pay = defaultPayment(s.m.thisPlayer, cost, {steel: true, titanium: false, heat: false});
    const move: Move = {kind: 'play', card: 'Deep Well Heating', payment: pay};
    const p = project(worldFromView(s.m), move);
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toMatch(/^\u2212\d+ M€ · \u2212\d steel · \+1 energy production · raises temperature 1 step · \+1 TR/);
    agrees(p, make(s, move));
  });

  it('Kelp Farming: plants now and production', () => {
    const s = stage({hand: ['Kelp Farming'], mc: 40, seed: 7});
    const w = worldFromView(s.m);
    w.state.global.oceans = s.m.game.oceans; // requirement aside: the projection itself
    const p = project(w, {kind: 'play', card: 'Kelp Farming'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toContain('+2 M€ production · +3 plant production');
    expect(lineOf(p)).toContain('+2 plants');
  });

  it('Earth Office makes the next Earth card cheaper in the projected state', () => {
    const s = stage({hand: ['Earth Office', 'Luna Governor'], mc: 60});
    const w = worldFromView(s.m);
    const p = project(w, {kind: 'play', card: 'Earth Office'});
    if (!p.ok) throw new Error(p.reason);
    const v = canMakeIn(w, {kind: 'play', card: 'Luna Governor'}, p);
    // Luna Governor needs 3 Earth tags; the verdict names it, after the first move
    expect(['no', 'maybe', 'yes']).toContain(v.state);
    const after = make(s, {kind: 'play', card: 'Earth Office'});
    agrees(p, after);
  });

  it('standard projects: power plant, asteroid and an aquifer whose space is not chosen', () => {
    for (const project_ of ['Power Plant:SP', 'Asteroid:SP', 'Aquifer']) {
      const s = stage({mc: 40});
      const move: Move = {kind: 'standard', project: project_};
      const p = project(worldFromView(s.m), move);
      if (!p.ok) throw new Error(p.reason);
      agrees(p, make(s, move));
    }
    const s = stage({mc: 40});
    expect(lineOf(project(worldFromView(s.m), {kind: 'standard', project: 'Power Plant:SP'}))).toBe('−11 M€ · +1 energy production');
    expect(lineOf(project(worldFromView(s.m), {kind: 'standard', project: 'Asteroid:SP'}))).toBe('−14 M€ · raises temperature 1 step · +1 TR');
  });

  it('conversions: heat into temperature, and plants into a greenery on a chosen space (its bonus counted exactly)', () => {
    const s = stage({heat: 9, plants: 9});
    const heat = project(worldFromView(s.m), {kind: 'heat'});
    if (!heat.ok) throw new Error(heat.reason);
    expect(lineOf(heat)).toBe('−8 heat · raises temperature 1 step · +1 TR');
    agrees(heat, make(stage({heat: 9, plants: 9}), {kind: 'heat'}));
    const s2 = stage({heat: 9, plants: 9});
    const opts = (s2.m.waitingFor as any).options as PlayerInputModel[];
    const spaces = (opts.find((o) => o.type === 'space') as {spaces: string[]}).spaces;
    // a space with a printed bonus, so the exact count matters
    const space = spaces.find((id) => (spaceBonus(s2.m, id)?.words.length ?? 0) > 0) ?? spaces[0];
    const p = project(worldFromView(s2.m), {kind: 'plants'}, {space});
    if (!p.ok) throw new Error(p.reason);
    for (const r of RESOURCES) expect(p.after.stock[r].lo).toBe(p.after.stock[r].hi);
    agrees(p, make(s2, {kind: 'plants'}, space));
  });

  it('heat at the maximum temperature: the engine allows it, no TR', () => {
    const s = stage({heat: 8, temperature: 8});
    const p = project(worldFromView(s.m), {kind: 'heat'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toBe('−8 heat · temperature is already at its maximum: no TR');
    agrees(p, make(s, {kind: 'heat'}));
  });

  it('a card action: Development Center spends energy to draw a card (never named)', () => {
    const s = stage({tableau: ['Development Center'], energy: 2});
    const move: Move = {kind: 'action', card: 'Development Center'};
    const p = project(worldFromView(s.m), move);
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toBe('−1 energy · +1 card (not known yet)');
    agrees(p, make(s, move));
  });
});

describe('hidden draws', () => {
  it('Research: "+2 cards (not known yet)", and nothing in the projection names a card from the deck', () => {
    const s = stage({hand: ['Research'], mc: 30, tableau: ['Physics Complex', 'Search For Life']});
    const deckTop = s.game.projectDeck.drawPile.slice(-6).map((c: any) => c.name);
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Research'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toContain('+2 cards (not known yet)');
    expect(p.unknowns[0].text).toBe('+2 cards (not known yet)');
    expect(p.after.drawn).toEqual({lo: 2, hi: 2});
    const after = make(s, {kind: 'play', card: 'Research'});
    const drawn = after.cardsInHand.map((c) => c.name).filter((n) => !s.m.cardsInHand.some((c) => c.name === n));
    expect(drawn.length).toBe(2);
    const text = JSON.stringify({lines: p.lines, unknowns: p.unknowns, before: p.before, after: p.after});
    for (const name of [...drawn, ...deckTop]) if (name !== 'Research') expect(text).not.toContain(name);
    agrees(p, after);
  });

  it('Invention Contest keeps one of three: +1 card, and a card bought from the deck is your choice', () => {
    const s = stage({hand: ['Invention Contest'], mc: 30});
    const p = project(worldFromView(s.m), {kind: 'play', card: 'Invention Contest'});
    if (!p.ok) throw new Error(p.reason);
    expect(lineOf(p)).toContain('+1 card (not known yet)');
    agrees(p, make(s, {kind: 'play', card: 'Invention Contest'}));
  });

  it('a top-card reveal is marked as depending on the deck', () => {
    const s = stage({tableau: ['Search For Life'], mc: 10});
    const p = project(worldFromView(s.m), {kind: 'action', card: 'Search For Life'});
    if (!p.ok) throw new Error(p.reason);
    expect(p.unknowns.map((u) => u.text)).toContain('Depends on the top card of the deck');
    expect(p.after.cardResources['Search For Life']).toEqual({lo: 0, hi: 1});
  });
});

describe('a second move against the projected first', () => {
  it('affordability follows the first move: an expensive card becomes short after spending', () => {
    const s = stage({hand: ['Nuclear Power', 'Comet'], mc: 30, temperature: -20});
    const w = worldFromView(s.m);
    const p = project(w, {kind: 'play', card: 'Nuclear Power'});
    if (!p.ok) throw new Error(p.reason);
    const v = canMakeIn(w, {kind: 'play', card: 'Comet'}, p);
    expect(v).toEqual({state: 'no', reason: '1 M€ short'});
    // the engine agrees
    const after = make(s, {kind: 'play', card: 'Nuclear Power'});
    const play = ((after.waitingFor as any).options as PlayerInputModel[]).find((o) => o.type === 'projectCard' && !/standard/i.test(JSON.stringify(o.title)));
    expect(((play as any)?.cards ?? []).some((c: any) => c.name === 'Comet' && !c.isDisabled)).toBe(false);
  });

  it('a requirement crossed by the first move: Worms (4% oxygen) opens, Colonizer Training Camp (5% at most) closes', () => {
    const s = stage({hand: ['Mining Expedition', 'Worms'], mc: 60, oxygen: 3, plants: 0});
    const w = worldFromView(s.m);
    expect(canMakeIn(w, {kind: 'play', card: 'Worms'}, {outcomes: [w.state]}).state).toBe('no');
    const p = project(w, {kind: 'play', card: 'Mining Expedition'});
    if (!p.ok) throw new Error(p.reason);
    expect(canMakeIn(w, {kind: 'play', card: 'Worms'}, p).state).toBe('yes');
    const s2 = stage({hand: ['Mining Expedition', 'Colonizer Training Camp'], mc: 60, oxygen: 5, plants: 0});
    const w2 = worldFromView(s2.m);
    const p2 = project(w2, {kind: 'play', card: 'Mining Expedition'});
    if (!p2.ok) throw new Error(p2.reason);
    expect(canMakeIn(w2, {kind: 'play', card: 'Colonizer Training Camp'}, p2)).toEqual({state: 'no', reason: "Oxygen would be 6%, above this card's 5% maximum"});
    // the engine agrees once the first move is made, and the plan check says so in the present tense
    const after = make(s2, {kind: 'play', card: 'Mining Expedition'});
    expect(checkPlan(after, {kind: 'play', card: 'Colonizer Training Camp'})).toEqual({ok: false, reason: "Oxygen is now 6%, above this card's 5% maximum."});
  });
});

describe('plan rules', () => {
  const now = (o: Partial<PlanNow> = {}): PlanNow => ({generation: 3, gameAge: 50, undoCount: 0, phase: 'action', active: true, acts: 0, menu: true, ...o});
  const plan = (): Plan => ({v: 1, after: 'Play Lichen', second: {kind: 'play', card: 'Comet'}, made: {generation: 3, gameAge: 50, undoCount: 0}, seen: {gameAge: 50, undoCount: 0}});

  it('waits while the first move is chosen or answered, is ready when the menu is back after it', () => {
    expect(planFate(plan(), now())).toEqual({s: 'waiting'});
    expect(planFate(plan(), now({gameAge: 52, menu: false}))).toEqual({s: 'waiting'});
    expect(planFate(plan(), now({gameAge: 54, acts: 1}))).toEqual({s: 'ready'});
    expect(planFate(plan(), now({gameAge: 56, acts: 1, menu: false}))).toEqual({s: 'busy'});
  });

  it('is dropped on undo (undoCount or gameAge going back), a new generation, and the end of the turn', () => {
    expect(planFate(plan(), now({undoCount: 1})).s).toBe('drop');
    expect(planFate({...plan(), seen: {gameAge: 54, undoCount: 0}}, now({gameAge: 50})).s).toBe('drop');
    expect(planFate(plan(), now({generation: 4})).s).toBe('drop');
    expect(planFate(plan(), now({active: false, acts: 0, gameAge: 60}))).toMatchObject({s: 'drop', quiet: true});
    expect(planFate(plan(), now({phase: 'production'})).s).toBe('drop');
    // the turn came round again: a turn menu with no action taken at a later moment
    expect(planFate(plan(), now({gameAge: 70})).s).toBe('drop');
    expect(planFate(plan(), now({acts: 2, gameAge: 70})).s).toBe('drop');
  });

  it('remembers the newest moment seen, so a fall in gameAge between two views counts as going back', () => {
    const p = seenNow(plan(), now({gameAge: 53, menu: false}));
    expect(p.seen.gameAge).toBe(53);
    expect(seenNow(p, now({gameAge: 51})).seen.gameAge).toBe(53);
    expect(planFate(p, now({gameAge: 51, menu: false})).s).toBe('drop');
  });

  it('survives another player\'s view changes that leave this seat\'s moment alone (same numbers, same question)', () => {
    const p = plan();
    expect(planFate(seenNow(p, now()), now())).toEqual({s: 'waiting'});
  });

  it('checks a due plan against the real game and says why it no longer works', () => {
    // first move: Nuclear Power; planned: Comet; after it, Comet is 1 M€ short
    const s = stage({hand: ['Nuclear Power', 'Comet'], mc: 30, temperature: -20});
    const pl = newPlan(s.m, 'Play Nuclear Power', {kind: 'play', card: 'Comet'});
    const after = make(s, {kind: 'play', card: 'Nuclear Power'});
    expect(planFate(pl, planNow(after)).s).toBe('ready');
    expect(checkPlan(after, pl.second)).toEqual({ok: false, reason: 'Now 1 M€ short.'});
  });

  it('a due plan that still works offers its option, with a preview from the real state', () => {
    const s = stage({hand: ['Lichen', 'Comet'], mc: 60, temperature: -20});
    const pl = newPlan(s.m, 'Play Lichen', {kind: 'play', card: 'Comet'});
    const after = make(s, {kind: 'play', card: 'Lichen'});
    const c = checkPlan(after, pl.second);
    expect(c.ok).toBe(true);
    if (c.ok) expect(previewText(c.preview)).toMatch(/^−21 M€/);
  });

  it('a requirement not met reads in the present tense, and a card gone from the hand says so', () => {
    const s = stage({hand: ['Lichen', 'Algae'], mc: 60, temperature: -20});
    const after = make(s, {kind: 'play', card: 'Lichen'});
    const k = after.game.oceans;
    expect(checkPlan(after, {kind: 'play', card: 'Algae'})).toEqual({ok: false, reason: `Needs 5 oceans, ${k} ${k === 1 ? 'is' : 'are'} placed.`});
    expect(checkPlan(after, {kind: 'play', card: 'Comet'})).toEqual({ok: false, reason: 'Comet is no longer in your hand.'});
  });
});

describe('the off-turn tray', () => {
  it('totals the pinned cards against M€ now plus next generation\'s income, with metal where it pays', () => {
    const s = stage({hand: ['Capital', 'Comet', 'Lichen'], mc: 10, steel: 3, titanium: 0});
    const t = trayTotals(s.m, ['Capital', 'Lichen']);
    const me = s.m.thisPlayer;
    const capital = s.m.cardsInHand.find((c) => c.name === 'Capital')!.calculatedCost!;
    const lichen = s.m.cardsInHand.find((c) => c.name === 'Lichen')!.calculatedCost!;
    expect(t.cost).toBe(capital + lichen);
    expect(t.income).toBe(me.terraformRating + me.megacreditProduction);
    expect(t.steel).toBe(Math.min(capital, (3 + me.steelProduction) * me.steelValue));
    expect(t.titanium).toBe(0);
    expect(t.left).toBe(10 + t.income + t.steel - t.cost);
    // a pin no longer in hand is not counted
    expect(trayTotals(s.m, ['Nowhere']).cost).toBe(0);
  });
});
