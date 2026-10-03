// Normal v2: the endgame rules. Each rule is checked against Normal v1, which the bot arena keeps
// behind `Mind.v1` to measure the rules.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {attackScore, bonusWorth, decide, handReserve} from '../src/server/full/bots/decide';
import type {Mind} from '../src/server/full/bots/decide';
import {rankSpaces} from '../src/server/full/bots/board';
import {behaviorValue, context, stockValue} from '../src/server/full/bots/value';
import {getCard} from '../src/shared/cards';
import {BONUS} from '../src/shared/full';
import type {CardModel, InputResponse, PlayerInputModel, PlayerViewModel, SpaceModel} from '../src/shared/full';

const opt = (title: string): PlayerInputModel => ({type: 'option', title, buttonLabel: 'OK'});
const projectCards = (cards: CardModel[], title = 'Play project card'): PlayerInputModel =>
  ({type: 'projectCard', title, buttonLabel: 'Play', cards, paymentOptions: {}, microbes: 0, floaters: 0});
const menu = (options: PlayerInputModel[]): PlayerInputModel =>
  ({type: 'or', title: 'Take your next action', buttonLabel: 'Take action', options});
const hand = (...names: string[]): CardModel[] => names.map((name) => ({name, calculatedCost: getCard(name).cost ?? 0}));
const chosen = (r: InputResponse | undefined): InputResponse | undefined => (r && r.type === 'or' ? chosen(r.response) ?? r : r);

/** The fixture's two-player game, with a third player (green) and the board where `patch` puts it. */
function model(patch: (m: PlayerViewModel) => void = () => {}): PlayerViewModel {
  const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-action.json', import.meta.url), 'utf8')) as PlayerViewModel;
  m.thisPlayer.tableau = [{name: 'Mining Guild'}];
  m.thisPlayer.actionsThisGeneration = [];
  m.thisPlayer.heat = 0; m.thisPlayer.plants = 0; m.thisPlayer.steel = 0; m.thisPlayer.titanium = 0;
  const blue = m.players.find((p) => p.color === 'blue')!;
  m.players = [m.thisPlayer, blue, {...blue, color: 'green', name: 'Phobos'}];
  patch(m);
  m.players = m.players.map((p) => (p.color === m.thisPlayer.color ? m.thisPlayer : p));
  return m;
}
/** About two generations left (8 global steps, generation 9). */
const nearEnd = (m: PlayerViewModel) => { m.game.generation = 9; m.game.temperature = 2; m.game.oxygenLevel = 11; m.game.oceans = 7; };
/** The last generation (2 global steps left). */
const lastGen = (m: PlayerViewModel) => { m.game.generation = 12; m.game.temperature = 6; m.game.oxygenLevel = 14; m.game.oceans = 8; };
const mind = (v1 = false, level: Mind['level'] = 'normal'): Mind => ({level, rng: () => 0.5, avoid: new Set(), v1});

describe('Normal v2: idle money goes into standard projects in the last three generations', () => {
  const sp = projectCards([{name: 'Aquifer', calculatedCost: 18}, {name: 'Asteroid:SP', calculatedCost: 14}, {name: 'Power Plant:SP', calculatedCost: 11}], 'Standard projects');
  const w = menu([sp, opt('Pass for this generation')]);

  it('buys a TR with money no card in hand needs (v1 kept it)', () => {
    const m = model((m) => { nearEnd(m); m.thisPlayer.megacredits = 20; m.cardsInHand = []; });
    expect(context(m).gens).toBe(2);
    const d = decide(w, m, mind())!;
    expect(d.why).toMatch(/standard project Asteroid/);
    expect((chosen(d.response) as {card: string}).card).toBe('Asteroid:SP');
    expect(decide(w, m, mind(true))!.why).toBe('pass');
  });

  it('keeps the money that the worthwhile cards in hand need', () => {
    const m = model((m) => { nearEnd(m); m.thisPlayer.megacredits = 20; m.cardsInHand = hand('Ganymede Colony', 'Kelp Farming'); });
    expect(handReserve(context(m))).toBeGreaterThan(6);
    expect(decide(w, m, mind())!.why).not.toMatch(/standard project/);
  });

  it('reserves nothing in the last generation, and never buys a project that does nothing then', () => {
    const m = model((m) => { lastGen(m); m.thisPlayer.megacredits = 12; m.cardsInHand = hand('Ganymede Colony'); });
    expect(handReserve(context(m))).toBe(0);
    // only the power plant is affordable: energy production bought at the end is worth nothing
    expect(decide(w, m, mind())!.why).toBe('pass');
  });

  it('plays a card before a standard project, and leaves early-game money alone', () => {
    const play = projectCards([{name: 'Mine', calculatedCost: 4}]);
    const m = model((m) => { nearEnd(m); m.thisPlayer.megacredits = 40; m.cardsInHand = []; });
    expect(decide(menu([sp, play, opt('Pass for this generation')]), m, mind())!.why).toMatch(/Mine/);
    const early = model((m) => { m.game.generation = 2; m.thisPlayer.megacredits = 20; m.cardsInHand = []; });
    expect(decide(w, early, mind())!.why).toBe('pass');
  });
});

describe('Normal v2: in the last generation a card must beat a standard project for its price', () => {
  const w = menu([projectCards([{name: 'Sponsors', calculatedCost: 6}]), opt('Pass for this generation')]);
  it('leaves production in hand at the end (v1 played it)', () => {
    const m = model((m) => { lastGen(m); m.thisPlayer.megacredits = 6; m.cardsInHand = hand('Sponsors'); });
    expect(decide(w, m, mind())!.why).toBe('pass');
    expect(decide(w, m, mind(true))!.why).toMatch(/Sponsors/);
  });
  it('still plays a card that scores now', () => {
    const tr = menu([projectCards([{name: 'Ice Cap Melting', calculatedCost: 5}]), opt('Pass for this generation')]);
    const m = model((m) => { lastGen(m); m.thisPlayer.megacredits = 5; m.cardsInHand = hand('Ice Cap Melting'); });
    expect(decide(tr, m, mind())!.why).toMatch(/Ice Cap Melting/);
  });
});

describe('Normal v2: attacks go to the leader, not to the engine\'s first player', () => {
  const leads = (m: PlayerViewModel) => {
    for (const p of m.players) p.victoryPointsBreakdown = {...(p.victoryPointsBreakdown ?? {}), total: p.color === 'green' ? 40 : 25} as typeof p.victoryPointsBreakdown;
  };
  const w: PlayerInputModel = {type: 'or', title: 'Select player to remove up to 3 plants', buttonLabel: '', options: [
    opt('Remove 3 plants from blue'), opt('Remove 3 plants from green'), opt('Skip removing plants'),
  ]};
  it('removes plants from the player who leads on points (v1 took the first listed)', () => {
    const m = model(leads);
    expect(decide(w, m, mind())!.response).toEqual({type: 'or', index: 1, response: {type: 'option'}});
    expect(decide(w, m, mind(true))!.response).toEqual({type: 'or', index: 0, response: {type: 'option'}});
  });
  it('takes the bigger loss over the leader when the leader has little to lose, and never hits itself', () => {
    const m = model(leads);
    const ctx = context(m);
    expect(attackScore('Remove 1 plants from green', ctx)!).toBeLessThan(attackScore('Remove 4 plants from blue', ctx)!);
    expect(attackScore('Steal 2 M€ from blue', ctx)).toBe(4); // a steal hurts them and pays you
    expect(attackScore('Remove 3 plants from red', ctx)).toBeLessThan(0); // red is this player
    expect(attackScore('Skip removing plants', ctx)).toBeNull();
    const self: PlayerInputModel = {type: 'or', title: '', buttonLabel: '', options: [opt('Remove 2 plants from red'), opt('Skip removing plants')]};
    expect(decide(self, m, mind())!.response).toEqual({type: 'or', index: 1, response: {type: 'option'}});
  });
});

describe('Normal v2: metal and cards in the last generation', () => {
  const space = (id: string, x: number, bonus: number[]): SpaceModel => ({id, x, y: 0, spaceType: 'ocean', bonus});
  const spaces = [space('ti', 2, [BONUS.TITANIUM, BONUS.TITANIUM]), space('pl', 6, [BONUS.PLANT])];
  const w: PlayerInputModel = {type: 'space', title: 'Select space for ocean tile', buttonLabel: '', spaces: ['ti', 'pl']};
  const at = (d: ReturnType<typeof decide>) => (d!.response as {spaceId: string}).spaceId;

  it('takes a plant over two titanium when no space card is left to pay for (v1 took the titanium)', () => {
    const m = model((m) => { lastGen(m); m.game.spaces = spaces; m.cardsInHand = hand('Kelp Farming'); });
    expect(at(decide(w, m, mind()))).toBe('pl');
    expect(at(decide(w, m, mind(true)))).toBe('ti');
    expect(rankSpaces(['ti', 'pl'], 'ocean', 'red', spaces, bonusWorth(context(m)))[0].id).toBe('pl');
  });
  it('still values titanium with a space card in hand, and before the last generation', () => {
    const withSpace = model((m) => { lastGen(m); m.game.spaces = spaces; m.cardsInHand = hand('Asteroid'); });
    expect(at(decide(w, withSpace, mind()))).toBe('ti');
    const earlier = model((m) => { nearEnd(m); m.game.spaces = spaces; m.cardsInHand = []; });
    expect(bonusWorth(context(earlier))).toEqual({});
    expect(at(decide(w, earlier, mind()))).toBe('ti');
  });
  it('values a card drawn in the last generation at almost nothing', () => {
    const end = context(model((m) => { lastGen(m); m.cardsInHand = []; }));
    const before = context(model((m) => { nearEnd(m); m.cardsInHand = []; }));
    expect(behaviorValue({drawCard: 2}, end)).toBeLessThan(2);
    expect(behaviorValue({drawCard: 2}, before)).toBe(7);
    expect(stockValue('steel', end)).toBeLessThan(0.5);
    expect(stockValue('steel', before)).toBe(1.7);
  });
});

describe('the v1 flag and the other levels', () => {
  it('v1 and Easy never see the endgame rules; Jev uses Normal v2', () => {
    const m = model((m) => { lastGen(m); m.thisPlayer.megacredits = 30; m.cardsInHand = []; });
    expect(context(m).lastGen).toBe(true);
    expect(context(m, {v1: true}).lastGen).toBe(false);
    const w = menu([projectCards([{name: 'Asteroid:SP', calculatedCost: 14}], 'Standard projects'), opt('Pass for this generation')]);
    for (let s = 0; s < 20; s++) {
      const d = decide(w, m, {level: 'easy', rng: () => (s + 0.5) / 20, avoid: new Set()});
      expect(d?.why ?? '').not.toMatch(/idle money/);
    }
    expect(decide(w, m, mind(false, 'jev'))!.why).toMatch(/idle money/);
  });
});
