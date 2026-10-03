// Card actions on the full-game TV (detection from actionsThisGeneration, the one-line summary, the wait for
// effects that arrive in a later model) and the action dots.
import {describe, expect, it} from 'vitest';
import type {SpectatorModel} from '../src/shared/full';
import {actionCards, ActionWatcher, cardResWord, hasAction, newActions, summarizeAction} from '../src/client/tv/full/actions';
import spectator from './fixtures/full/spectator.json';

const base = spectator as unknown as SpectatorModel;
function model(patch: (m: SpectatorModel) => void = () => {}): SpectatorModel {
  const m = structuredClone(base);
  m.game.phase = 'action';
  m.game.generation = 3;
  const red = m.players.find((p) => p.color === 'red')!;
  red.tableau = [{name: 'Robinson Industries'}, {name: 'Birds', resources: 3}, {name: 'Power Infrastructure'}, {name: 'Tardigrades', resources: 1}, {name: 'Mine'}];
  red.actionsThisGeneration = [];
  red.energy = 5; red.megacredits = 20;
  patch(m);
  return m;
}
const red = (m: SpectatorModel) => m.players.find((p) => p.color === 'red')!;
const blue = (m: SpectatorModel) => m.players.find((p) => p.color !== 'red')!;

describe('action cards and dots', () => {
  it('knows which cards have actions, corporations included, standard projects never', () => {
    expect(hasAction('Birds')).toBe(true);
    expect(hasAction('Robinson Industries')).toBe(true);
    expect(hasAction('Mine')).toBe(false);
    expect(hasAction('Power Plant:SP')).toBe(false);
    expect(hasAction('Not A Card')).toBe(false);
  });
  it('lists the action cards in table order with their used state', () => {
    const m = model((x) => { red(x).actionsThisGeneration = ['Birds']; });
    expect(actionCards(red(m))).toEqual([
      {name: 'Robinson Industries', used: false}, {name: 'Birds', used: true}, {name: 'Power Infrastructure', used: false}, {name: 'Tardigrades', used: false},
    ]);
  });
});

describe('detecting a card action', () => {
  it('a name new in actionsThisGeneration is an action by that player', () => {
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Birds']; });
    expect(newActions(a, b)).toEqual([{color: 'red', cards: ['Birds']}]);
  });
  it('ignores a new generation (the engine clears the list), an undo, another game and the first model', () => {
    const a = model((x) => { red(x).actionsThisGeneration = ['Birds']; });
    const gen = model((x) => { x.game.generation = 4; red(x).actionsThisGeneration = ['Fish']; });
    expect(newActions(a, gen)).toEqual([]);
    const undo = model((x) => { x.game.undoCount = 1; red(x).actionsThisGeneration = ['Birds', 'Tardigrades']; });
    expect(newActions(a, undo)).toEqual([]);
    const other = model((x) => { x.id = 'other'; red(x).actionsThisGeneration = ['Birds', 'Tardigrades']; });
    expect(newActions(a, other)).toEqual([]);
    expect(newActions(null, a)).toEqual([]);
  });
  it('never counts names that are not cards or are standard projects', () => {
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Power Plant:SP', 'Mystery']; });
    expect(newActions(a, b)).toEqual([]);
  });
});

describe('what an action changed', () => {
  it('a resource added to the used card', () => {
    const a = model();
    const b = model((x) => { red(x).tableau.find((c) => c.name === 'Birds')!.resources = 4; red(x).actionsThisGeneration = ['Birds']; });
    const s = summarizeAction(a, b, 'red', ['Birds']);
    expect(s.line).toBe('+1 animal on Birds (now 4)');
    expect(s.onCards).toEqual([{name: 'Birds', type: 'Animal', from: 3, to: 4}]);
    expect(s.flights).toEqual([]);
  });
  it('a conversion reads cost → result', () => {
    const a = model();
    const b = model((x) => { red(x).energy = 2; red(x).megacredits = 23; });
    const s = summarizeAction(a, b, 'red', ['Power Infrastructure']);
    expect(s.line).toBe('3 energy → 3 M€');
    expect(s.flights).toEqual([{r: 'megacredits', n: 3, prod: false}]);
  });
  it('production, TR and cards drawn', () => {
    const a = model();
    const b = model((x) => { red(x).megacredits = 16; red(x).energyProduction += 1; });
    expect(summarizeAction(a, b, 'red').line).toBe('4 M€ → energy production +1');
    const c = model((x) => { red(x).energyProduction -= 1; red(x).terraformRating += 1; });
    expect(summarizeAction(a, c, 'red').line).toBe('energy production −1 → 1 TR');
    const d = model((x) => { red(x).cardsInHandNbr += 1; });
    expect(summarizeAction(a, d, 'red').line).toBe('+1 card');
    const e = model((x) => { red(x).energyProduction += 1; });
    expect(summarizeAction(a, e, 'red').line).toBe('energy production +1');
    expect(summarizeAction(a, e, 'red').flights).toEqual([{r: 'energy', n: 1, prod: true}]);
  });
  it('a tile, its TR and the ocean count', () => {
    const a = model();
    const free = a.game.spaces.find((s) => s.spaceType === 'ocean' && s.tileType === undefined)!;
    const b = model((x) => { red(x).megacredits = 8; red(x).terraformRating += 1; x.game.oceans += 1; x.game.spaces.find((s) => s.id === free.id)!.tileType = 1; });
    expect(summarizeAction(a, b, 'red').line).toBe('12 M€ → an ocean, 1 TR');
  });
  it('microbes taken from a card to raise oxygen', () => {
    const a = model((x) => { red(x).tableau.find((c) => c.name === 'Tardigrades')!.resources = 2; });
    const b = model((x) => { red(x).tableau.find((c) => c.name === 'Tardigrades')!.resources = 0; red(x).terraformRating += 1; x.game.oxygenLevel += 1; });
    expect(summarizeAction(a, b, 'red', ['Tardigrades']).line).toBe('2 microbes from Tardigrades (now 0) → 1 TR, oxygen +1 %');
  });
  it('a cost with nothing gained (Search For Life revealing a card without a microbe tag)', () => {
    const a = model();
    const b = model((x) => { red(x).megacredits = 19; });
    expect(summarizeAction(a, b, 'red').line).toBe('Paid 1 M€, nothing gained');
  });
  it('one plant is singular', () => {
    const a = model((x) => { red(x).plants = 3; });
    const b = model((x) => { red(x).plants = 2; red(x).megacredits = 27; });
    expect(summarizeAction(a, b, 'red').line).toBe('1 plant → 7 M€');
  });
  it('words for card resources', () => {
    expect(cardResWord('Animal', 1)).toBe('animal');
    expect(cardResWord('Microbe', 3)).toBe('microbes');
    expect(cardResWord('Science', 2)).toBe('science resources');
    expect(cardResWord(undefined, 1)).toBe('resource');
  });
  it('other players\' changes are not part of the line', () => {
    const a = model();
    const b = model((x) => { blue(x).megacredits += 5; red(x).tableau.find((c) => c.name === 'Birds')!.resources = 4; });
    expect(summarizeAction(a, b, 'red', ['Birds']).line).toBe('+1 animal on Birds (now 4)');
  });
});

describe('the watcher', () => {
  it('emits at once when the effect is in the same model', () => {
    const w = new ActionWatcher();
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Birds']; red(x).tableau.find((c) => c.name === 'Birds')!.resources = 4; });
    const out = w.feed(a, b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({color: 'red', cards: ['Birds'], line: '+1 animal on Birds (now 4)'});
  });
  it('waits for an effect that arrives after the player answers a question', () => {
    const w = new ActionWatcher();
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure']; });
    expect(w.feed(a, b)).toEqual([]);
    const c = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure']; red(x).energy = 0; red(x).megacredits = 25; });
    const out = w.feed(b, c);
    expect(out).toHaveLength(1);
    expect(out[0].line).toBe('5 energy → 5 M€');
  });
  it('a cost paid before a space is chosen waits for the tile', () => {
    const w = new ActionWatcher();
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure']; red(x).megacredits = 12; });
    expect(w.feed(a, b)).toEqual([]);
    const free = a.game.spaces.find((s) => s.spaceType === 'ocean' && s.tileType === undefined)!;
    const c = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure']; red(x).megacredits = 12; red(x).terraformRating += 1;
      x.game.oceans += 1; x.game.spaces.find((s) => s.id === free.id)!.tileType = 1; });
    expect(w.feed(b, c).map((o) => o.line)).toEqual(['8 M€ → an ocean, 1 TR']);
  });
  it('a cost with nothing gained shows once the player moves on', () => {
    const w = new ActionWatcher();
    const a = model((x) => { red(x).isActive = true; });
    const b = model((x) => { red(x).isActive = true; red(x).actionsThisGeneration = ['Power Infrastructure']; red(x).megacredits = 19; });
    expect(w.feed(a, b)).toEqual([]);
    const c = model((x) => { red(x).isActive = false; blue(x).isActive = true; red(x).actionsThisGeneration = ['Power Infrastructure']; red(x).megacredits = 19; });
    expect(w.feed(b, c).map((o) => o.line)).toEqual(['Paid 1 M€, nothing gained']);
  });
  it('gives up with the card text when the player moves on without a visible change', () => {
    const w = new ActionWatcher();
    const a = model((x) => { red(x).isActive = true; });
    const b = model((x) => { red(x).isActive = true; red(x).actionsThisGeneration = ['Power Infrastructure']; });
    expect(w.feed(a, b)).toEqual([]);
    const c = model((x) => { red(x).isActive = false; blue(x).isActive = true; red(x).actionsThisGeneration = ['Power Infrastructure']; });
    const out = w.feed(b, c);
    expect(out).toHaveLength(1);
    expect(out[0].summary.empty).toBe(true);
    expect(out[0].line).toBe('Spend any amount of energy and gain that amount of M€.');
  });
  it('a second action while one waits closes the first and starts the second', () => {
    const w = new ActionWatcher();
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure']; });
    w.feed(a, b);
    const c = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure', 'Birds']; red(x).tableau.find((t) => t.name === 'Birds')!.resources = 4; });
    const out = w.feed(b, c);
    expect(out.map((o) => o.cards[0])).toEqual(['Power Infrastructure', 'Birds']);
    expect(out[1].line).toBe('+1 animal on Birds (now 4)');
  });
  it('an undo drops anything waiting', () => {
    const w = new ActionWatcher();
    const a = model();
    const b = model((x) => { red(x).actionsThisGeneration = ['Power Infrastructure']; });
    w.feed(a, b);
    const c = model((x) => { x.game.undoCount = 1; red(x).energy = 0; });
    expect(w.feed(b, c)).toEqual([]);
    const d = model((x) => { x.game.undoCount = 1; red(x).energy = 1; });
    expect(w.feed(c, d)).toEqual([]);
  });
});
