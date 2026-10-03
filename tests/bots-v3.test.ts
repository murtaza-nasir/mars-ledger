// Normal v3: research, card values and standard projects of a competent player. v2 stays behind `Mind.v2` so the bench can measure the change.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {buyGain, decide, researchV3, shadowPrice} from '../src/server/full/bots/decide';
import type {Mind} from '../src/server/full/bots/decide';
import {actionUses, cardValue, context, generationsLeft, generationsLeftV3, handValue, readiness} from '../src/server/full/bots/value';
import {getCard} from '../src/shared/cards';
import type {CardModel, InputResponse, PlayerInputModel, PlayerViewModel} from '../src/shared/full';

const opt = (title: string): PlayerInputModel => ({type: 'option', title, buttonLabel: 'OK'});
const projectCards = (cards: CardModel[], title = 'Play project card'): PlayerInputModel =>
  ({type: 'projectCard', title, buttonLabel: 'Play', cards, paymentOptions: {}, microbes: 0, floaters: 0});
const menu = (options: PlayerInputModel[]): PlayerInputModel =>
  ({type: 'or', title: 'Take your next action', buttonLabel: 'Take action', options});
const cardsOf = (...names: string[]): CardModel[] => names.map((name) => ({name, calculatedCost: getCard(name).cost ?? 0}));
const chosen = (r: InputResponse | undefined): InputResponse | undefined => (r && r.type === 'or' ? chosen(r.response) ?? r : r);
const research = (...names: string[]): PlayerInputModel =>
  ({type: 'card', title: 'Select card(s) to buy', buttonLabel: 'Buy', min: 0, max: 4, selectBlueCardAction: false, showOwner: false, cards: cardsOf(...names)});
const SP = projectCards([{name: 'Power Plant:SP', calculatedCost: 11}, {name: 'Asteroid:SP', calculatedCost: 14}, {name: 'Aquifer', calculatedCost: 18},
  {name: 'Greenery', calculatedCost: 23}, {name: 'City', calculatedCost: 25}], 'Standard projects');

/** The fixture as a three-player game in generation `gen` with globals moved on proportionally. */
function model(patch: (m: PlayerViewModel) => void = () => {}, gen = 3): PlayerViewModel {
  const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-action.json', import.meta.url), 'utf8')) as PlayerViewModel;
  m.thisPlayer.tableau = [{name: 'Mining Guild'}];
  m.thisPlayer.actionsThisGeneration = [];
  m.thisPlayer.heat = 0; m.thisPlayer.plants = 0; m.thisPlayer.steel = 0; m.thisPlayer.titanium = 0; m.thisPlayer.energy = 0;
  m.thisPlayer.megacreditProduction = 2; m.thisPlayer.energyProduction = 0; m.thisPlayer.terraformRating = 22;
  m.cardsInHand = [];
  m.game.generation = gen; m.game.temperature = -30 + 2 * (gen - 1); m.game.oxygenLevel = gen - 1; m.game.oceans = Math.floor((gen - 1) / 2);
  const blue = m.players.find((p) => p.color === 'blue')!;
  m.players = [m.thisPlayer, blue, {...blue, color: 'green', name: 'Phobos'}];
  patch(m);
  m.players = m.players.map((p) => (p.color === m.thisPlayer.color ? m.thisPlayer : p));
  return m;
}
const mind = (v2 = false): Mind => ({level: 'normal', rng: () => 0.5, avoid: new Set(), v2});
const value = (name: string, m: PlayerViewModel) => cardValue(getCard(name), context(m));

describe('Normal v3: how long the game lasts', () => {
  it('expects a three-player game to run about eleven generations, not seven', () => {
    const m = model(() => {}, 1);
    expect(generationsLeft(m)).toBe(7);
    expect(generationsLeftV3(m)).toBeGreaterThanOrEqual(10);
    expect(generationsLeftV3(m)).toBeLessThanOrEqual(12);
  });
  it('follows a fast table: a game nearly terraformed by generation 6 ends within two generations', () => {
    const m = model((m) => { m.game.generation = 6; m.game.temperature = 4; m.game.oxygenLevel = 12; m.game.oceans = 8; });
    expect(generationsLeftV3(m)).toBeLessThanOrEqual(2);
  });
});

describe('Normal v3: card values', () => {
  it('values M€ production by the generations left (Sponsors early is worth about twice its late worth)', () => {
    const early = value('Sponsors', model(() => {}, 2));
    const late = value('Sponsors', model(() => {}, 9));
    expect(early).toBeGreaterThan(18);
    expect(early).toBeGreaterThan(late * 1.6);
  });
  it('knows a card that lowers energy production needs that production first (Strip Mine, Fuel Factory)', () => {
    const none = context(model());
    expect(readiness(getCard('Strip Mine'), none).odds).toBeLessThan(0.5);
    expect(readiness(getCard('Strip Mine'), none).delay).toBeGreaterThan(1);
    const powered = context(model((m) => { m.thisPlayer.energyProduction = 2; }));
    expect(readiness(getCard('Strip Mine'), powered)).toEqual({odds: 1, delay: 0});
  });
  it('limits an action by what it spends: Physics Complex is worth little without energy', () => {
    const ctx0 = context(model());
    const ctx6 = context(model((m) => { m.thisPlayer.energyProduction = 6; }));
    expect(actionUses(getCard('Physics Complex'), ctx0)).toBeLessThan(actionUses(getCard('Physics Complex'), ctx6) / 3);
    expect(cardValue(getCard('Physics Complex'), ctx0)).toBeLessThan(cardValue(getCard('Physics Complex'), ctx6) / 2);
  });
  it('counts "add a microbe, or spend two to raise oxygen" as one raise every three uses', () => {
    const ctx = context(model());
    const regolith = cardValue(getCard('Regolith Eaters'), ctx);
    const uses = actionUses(getCard('Regolith Eaters'), ctx);
    // a third of a TR a use, give or take the tags
    expect(regolith).toBeLessThan(uses * ctx.tr * 0.75 / 3 + 6);
    expect(regolith).toBeGreaterThan(uses * ctx.tr * 0.75 / 3 - 2);
  });
  it('stops valuing heat production once the temperature is nearly maxed', () => {
    const cold = value('Soletta', model(() => {}, 3));
    const warm = value('Soletta', model((m) => { m.game.temperature = 6; }, 3));
    expect(warm).toBeLessThan(cold / 3);
  });
  it('adds tag synergy with the corporation (Point Luna draws a card per Earth tag)', () => {
    const plain = value('Sponsors', model());
    const luna = value('Sponsors', model((m) => { m.thisPlayer.tableau = [{name: 'Point Luna'}]; }));
    expect(luna - plain).toBeGreaterThan(2.5);
  });
});

describe('Normal v3: research', () => {
  it('buys the cards that pay back, early, and keeps a quarter of its money', () => {
    const m = model((m) => { m.thisPlayer.megacredits = 12; }, 2);
    const d = decide(research('Sponsors', 'Mine', 'Satellites', 'Immigrant City'), m, mind())!;
    const cards = (d.response as {cards: string[]}).cards;
    expect(cards).toContain('Sponsors');
    expect(cards).not.toContain('Immigrant City');
    expect(cards.length * 3).toBeLessThanOrEqual(12 * 0.75);
  });
  it('buys nothing in the last generation', () => {
    const m = model((m) => { m.thisPlayer.megacredits = 60; m.game.temperature = 8; m.game.oxygenLevel = 14; m.game.oceans = 8; }, 11);
    expect((decide(research('Sponsors', 'Mine', 'Asteroid', 'Comet'), m, mind())!.response as {cards: string[]}).cards).toEqual([]);
  });
  it('is not stopped by dead cards in hand (v2 stopped at 8 cards, playable or not)', () => {
    const dead = cardsOf('Strip Mine', 'Fuel Factory', 'Steelworks', 'Ironworks', 'Kelp Farming', 'Birds', 'Fish', 'Mangrove');
    const m = model((m) => { m.thisPlayer.megacredits = 40; m.cardsInHand = dead; });
    const w = research('Sponsors', 'Mine', 'Asteroid', 'Comet');
    expect((decide(w, m, mind(true))!.response as {cards: string[]}).cards).toEqual([]);
    expect((decide(w, m, mind())!.response as {cards: string[]}).cards.length).toBeGreaterThan(0);
  });
  it('prices money by what the hand already asks of it', () => {
    const flush = context(model((m) => { m.thisPlayer.megacredits = 80; }));
    const short = context(model((m) => { m.thisPlayer.megacredits = 5; m.cardsInHand = cardsOf('Comet', 'Big Asteroid', 'Space Elevator', 'Asteroid Mining'); }));
    expect(shadowPrice(flush)).toBe(0.75);
    expect(shadowPrice(short)).toBeGreaterThan(1.1);
    // the same card gains more for the flush player
    const c = {name: 'Asteroid', calculatedCost: 14};
    expect(buyGain(c, flush, shadowPrice(flush))).toBeGreaterThan(buyGain(c, short, shadowPrice(short)));
    expect(researchV3(cardsOf('Asteroid'), 4, flush)).toEqual(['Asteroid']);
  });
});

describe('Normal v3: the action phase', () => {
  it('plays a good card before any standard project', () => {
    const m = model((m) => { m.thisPlayer.megacredits = 80; m.cardsInHand = cardsOf('Mine'); });
    const d = decide(menu([SP, projectCards(cardsOf('Mine')), opt('Pass for this generation')]), m, mind())!;
    expect(d.why).toMatch(/play Mine/);
  });
  it('keeps about a generation of money rather than buying standard projects early', () => {
    const w = menu([SP, opt('Pass for this generation')]);
    expect(decide(w, model((m) => { m.thisPlayer.megacredits = 30; }), mind())!.why).toBe('pass');
    // far beyond a generation of spending, idle money terraforms (never a power plant without cards that need energy)
    const rich = decide(w, model((m) => { m.thisPlayer.megacredits = 80; }), mind())!;
    expect(rich.why).toMatch(/standard project (Asteroid|Aquifer|Greenery|City)/);
  });
  it('builds a power plant only when cards wait for energy', () => {
    const w = menu([projectCards([{name: 'Power Plant:SP', calculatedCost: 11}], 'Standard projects'), opt('Pass for this generation')]);
    expect(decide(w, model((m) => { m.thisPlayer.megacredits = 80; }), mind())!.why).toBe('pass');
    const waiting = decide(w, model((m) => { m.thisPlayer.megacredits = 80; m.cardsInHand = cardsOf('Strip Mine', 'Fuel Factory'); }), mind())!;
    expect(waiting.why).toMatch(/Power Plant/);
  });
  it('takes the standard project that completes a milestone it can then claim', () => {
    const m = model((m) => {
      m.thisPlayer.megacredits = 40;
      const mayor = m.game.milestones.find((x) => x.name === 'Mayor')!;
      mayor.color = undefined;
      mayor.scores = [{color: m.thisPlayer.color, score: 2}];
    });
    const d = decide(menu([SP, opt('Pass for this generation')]), m, mind())!;
    expect(d.why).toMatch(/City.*milestone/);
  });
  it('claims a milestone before playing a card', () => {
    const w = menu([projectCards(cardsOf('Sponsors')), {type: 'or', title: 'Claim a milestone', buttonLabel: '', options: [opt('Builder')]}, opt('Pass for this generation')]);
    const d = decide(w, model((m) => { m.thisPlayer.megacredits = 30; m.cardsInHand = cardsOf('Sponsors'); }), mind())!;
    expect(d.why).toMatch(/milestone/);
  });
  it('sells cards it can never play before passing', () => {
    const m = model((m) => { m.thisPlayer.megacredits = 3; m.cardsInHand = cardsOf('Arctic Algae', 'Mine'); m.game.temperature = 0; });
    const sell: PlayerInputModel = {type: 'card', title: 'Sell patents', buttonLabel: 'Sell', min: 1, max: 2, selectBlueCardAction: false, showOwner: false, cards: cardsOf('Arctic Algae', 'Mine')};
    const d = decide(menu([sell, opt('Pass for this generation')]), m, mind())!;
    expect((chosen(d.response) as {cards: string[]}).cards).toEqual(['Arctic Algae']);
  });
  it('takes resources from a rival card, not its own', () => {
    const m = model((m) => { m.thisPlayer.tableau = [{name: 'Mining Guild'}, {name: 'Tardigrades', resources: 3}]; });
    const w: PlayerInputModel = {type: 'card', title: 'Select card to remove 1 microbe(s)', buttonLabel: 'Remove', min: 1, max: 1, selectBlueCardAction: false, showOwner: true,
      cards: [{name: 'Tardigrades', resources: 3}, {name: 'Decomposers', resources: 1}]};
    expect((decide(w, m, mind())!.response as {cards: string[]}).cards).toEqual(['Decomposers']);
  });
  it('Easy plays exactly as before (v1 context)', () => {
    const m = model((m) => { m.thisPlayer.megacredits = 80; });
    expect(context(m, {v1: true}).v3).toBe(false);
    const w = menu([SP, projectCards(cardsOf('Mine')), opt('Pass for this generation')]);
    for (let s = 0; s < 10; s++) {
      const easy = decide(w, m, {level: 'easy', rng: () => (s + 0.5) / 10, avoid: new Set()});
      const v1 = decide(w, m, {level: 'easy', rng: () => (s + 0.5) / 10, avoid: new Set(), v1: true});
      expect(easy).toEqual(v1);
    }
  });
});
