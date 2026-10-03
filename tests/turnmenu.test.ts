// The full-game turn menu's disabled rows: every reason is derived from the player's own model.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {MENU_ROWS, OPTION_ORDER, standardProjectReason, unavailableReason} from '../src/client/phone/full/model';
import type {PlayerViewModel} from '../src/shared/full';

function model(patch: (m: PlayerViewModel) => void = () => {}): PlayerViewModel {
  const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-action.json', import.meta.url), 'utf8')) as PlayerViewModel;
  m.thisPlayer.tableau = [{name: 'Mining Guild'}];
  m.thisPlayer.actionsThisGeneration = [];
  patch(m);
  return m;
}

describe('fixed turn menu rows', () => {
  it('lists every main option in the menu order', () => {
    expect(MENU_ROWS).toEqual(['play', 'action', 'standard', 'plants', 'heat', 'milestone', 'award', 'sell']);
    const positions = MENU_ROWS.map((k) => OPTION_ORDER.indexOf(k));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('play a card', () => {
  it('says the hand is empty', () => {
    expect(unavailableReason('play', model((m) => { m.cardsInHand = []; }))).toBe('No cards in hand');
  });
  it('names the cheapest card and the M€ when nothing is affordable', () => {
    const m = model((m) => { m.thisPlayer.megacredits = 9; m.cardsInHand = [{name: 'Comet', calculatedCost: 21}, {name: 'Big Asteroid', calculatedCost: 27}]; });
    expect(unavailableReason('play', m)).toBe('Nothing affordable: cheapest 21 M€, you have 9 M€');
  });
  it('counts titanium toward space cards before calling a card unaffordable', () => {
    // Comet (space, 21): 9 M€ + 4 titanium x 3 = 21 reaches it, so the reason is its requirements, not money.
    const m = model((m) => { m.thisPlayer.megacredits = 9; m.thisPlayer.titanium = 4; m.thisPlayer.titaniumValue = 3; m.cardsInHand = [{name: 'Comet', calculatedCost: 21}]; });
    expect(unavailableReason('play', m)).toBe('Requirements not met for the cards you can afford');
  });
  it('counts heat for Helion', () => {
    const m = model((m) => { m.thisPlayer.tableau = [{name: 'Helion'}]; m.thisPlayer.megacredits = 5; m.thisPlayer.heat = 20; m.cardsInHand = [{name: 'Comet', calculatedCost: 21}]; });
    expect(unavailableReason('play', m)).toBe('Requirements not met for the cards you can afford');
  });
});

describe('card actions', () => {
  it('says there are no action cards', () => {
    expect(unavailableReason('action', model())).toBe('No card actions on your table');
  });
  it('says every action is used', () => {
    const m = model((m) => { m.thisPlayer.tableau = [{name: 'Mining Guild'}, {name: 'Birds'}]; m.thisPlayer.actionsThisGeneration = ['Birds']; });
    expect(unavailableReason('action', m)).toBe('All card actions used this generation');
  });
  it('says an unused action needs something', () => {
    const m = model((m) => { m.thisPlayer.tableau = [{name: 'Mining Guild'}, {name: 'Development Center'}]; });
    expect(unavailableReason('action', m)).toBe('Your card actions need something you do not have right now');
  });
});

describe('standard projects', () => {
  it('uses 11 M€, or 8 with ThorGate', () => {
    expect(unavailableReason('standard', model((m) => { m.thisPlayer.megacredits = 3; }))).toBe('Nothing affordable: cheapest 11 M€, you have 3 M€');
    expect(unavailableReason('standard', model((m) => { m.thisPlayer.megacredits = 3; m.thisPlayer.tableau = [{name: 'ThorGate'}]; }))).toBe('Nothing affordable: cheapest 8 M€, you have 3 M€');
  });
  it('explains a greyed project', () => {
    expect(standardProjectReason('Aquifer', 18, model((m) => { m.game.oceans = 9; }))).toBe('All 9 oceans are placed');
    expect(standardProjectReason('Asteroid:SP', 14, model((m) => { m.game.temperature = 8; }))).toBe('Temperature is at its maximum');
    expect(standardProjectReason('City', 25, model((m) => { m.thisPlayer.megacredits = 12; }))).toBe('25 M€ needed, you have 12 M€');
  });
});

describe('conversions', () => {
  it('needs 8 plants, or 7 for Ecoline', () => {
    expect(unavailableReason('plants', model((m) => { m.thisPlayer.plants = 5; }))).toBe('8 plants needed, you have 5');
    expect(unavailableReason('plants', model((m) => { m.thisPlayer.plants = 5; m.thisPlayer.tableau = [{name: 'Ecoline'}]; }))).toBe('7 plants needed, you have 5');
  });
  it('heat: maximum temperature first, then the heat needed', () => {
    expect(unavailableReason('heat', model((m) => { m.game.temperature = 8; m.thisPlayer.heat = 30; }))).toBe('Temperature is at its maximum');
    expect(unavailableReason('heat', model((m) => { m.game.temperature = -10; m.thisPlayer.heat = 3; }))).toBe('8 heat needed, you have 3');
  });
});

describe('milestones and awards', () => {
  it('milestones: all claimed, then money, then none reached', () => {
    const claimed = model((m) => { m.game.milestones = m.game.milestones.map((x, i) => (i < 3 ? {...x, color: 'red', playerName: 'A'} : x)); });
    expect(unavailableReason('milestone', claimed)).toBe('All 3 milestones are claimed');
    expect(unavailableReason('milestone', model((m) => { m.thisPlayer.megacredits = 5; }))).toBe('8 M€ needed, you have 5 M€');
    expect(unavailableReason('milestone', model((m) => { m.thisPlayer.megacredits = 30; }))).toBe('No milestone reached yet');
  });
  it('awards: all funded, then the current funding cost', () => {
    const funded = model((m) => { m.game.awards = m.game.awards.map((x, i) => (i < 3 ? {...x, color: 'red', playerName: 'A'} : x)); });
    expect(unavailableReason('award', funded)).toBe('All 3 awards are funded');
    const one = model((m) => { m.thisPlayer.megacredits = 10; m.game.awards = m.game.awards.map((x, i) => (i < 1 ? {...x, color: 'red', playerName: 'A'} : x)); });
    expect(unavailableReason('award', one)).toBe('14 M€ needed, you have 10 M€');
  });
});

describe('sell patents', () => {
  it('needs a card in hand', () => {
    expect(unavailableReason('sell', model((m) => { m.cardsInHand = []; }))).toBe('No cards to sell');
  });
});
