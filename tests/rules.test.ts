import {describe, expect, it} from 'vitest';
import {autoAnswer, started} from './harness';
import {cardCost, preview, score, standardProjectCost, unmetRequirements, awardPlaces} from '../src/shared/engine';
import {getCard} from '../src/shared/cards';
import type {Answer} from '../src/shared/game';

describe('payment', () => {
  it('steel pays for building tags at 2 each', () => {
    const h = started('Mining Guild');
    const mc = h.p('a').stock.megacredits;
    h.do({t: 'playCard', playerId: 'a', card: 'Mine', payment: {steel: 2}, answers: []});
    expect(h.p('a').stock.steel).toBe(3);
    expect(h.p('a').stock.megacredits).toBe(mc);
  });
  it('titanium pays for space tags; PhoboLog makes it worth 4', () => {
    const h = started('PhoboLog');
    expect(h.p('a').titaniumValue).toBe(4);
    h.do({t: 'playCard', playerId: 'a', card: 'Asteroid Mining', payment: {titanium: 7, megacredits: 2}, answers: []});
    expect(h.p('a').stock.titanium).toBe(3);
  });
  it('rejects steel on a non-building card, short payment and M€ overpayment', () => {
    const h = started('Mining Guild');
    expect(preview(h.s, {t: 'playCard', playerId: 'a', card: 'Sponsors', payment: {steel: 3}, answers: []}))
      .toMatchObject({error: expect.stringContaining('building')});
    expect(preview(h.s, {t: 'playCard', playerId: 'a', card: 'Sponsors', payment: {megacredits: 5}, answers: []}))
      .toMatchObject({error: expect.stringContaining('short')});
    expect(preview(h.s, {t: 'playCard', playerId: 'a', card: 'Sponsors', payment: {megacredits: 7}, answers: []}))
      .toMatchObject({error: expect.stringContaining('more')});
  });
  it('Helion may pay with heat', () => {
    const h = started('Helion');
    h.give('a', {heat: 6});
    h.do({t: 'playCard', playerId: 'a', card: 'Sponsors', payment: {heat: 6}, answers: []});
    expect(h.p('a').stock.heat).toBe(0);
    const h2 = started('Ecoline');
    h2.give('a', {heat: 6});
    expect(preview(h2.s, {t: 'playCard', playerId: 'a', card: 'Sponsors', payment: {heat: 6}, answers: []})).toMatchObject({ok: false});
  });
  it('action costs go through payment: Water Import From Europa takes titanium', () => {
    const h = started('PhoboLog');
    h.place('a', 'Water Import From Europa');
    h.do({t: 'action', playerId: 'a', card: 'Water Import From Europa', payment: {titanium: 3}, answers: [{kind: 'tile', bonus: {}}]});
    expect(h.p('a').stock.titanium).toBe(7);
    expect(h.s.global.oceans).toBe(1);
  });
});

describe('discounts', () => {
  it('tag discounts, general discounts and ThorGate', () => {
    const h = started('Teractor', 'ThorGate');
    expect(cardCost(h.p('a'), getCard('Sponsors'))).toBe(3);
    h.place('a', 'Earth Catapult');
    expect(cardCost(h.p('a'), getCard('Sponsors'))).toBe(1);
    expect(cardCost(h.p('a'), getCard('Mine'))).toBe(2);
    expect(cardCost(h.p('b'), getCard('Geothermal Power'))).toBe(8);
    expect(standardProjectCost(h.p('b'), 'powerPlant')).toBe(8);
    expect(standardProjectCost(h.p('a'), 'powerPlant')).toBe(11);
  });
  it('Indentured Workers discounts only the next card', () => {
    const h = started();
    h.play('a', 'Indentured Workers');
    expect(cardCost(h.p('a'), getCard('Asteroid Mining'))).toBe(22);
    h.play('a', 'Asteroid Mining');
    expect(cardCost(h.p('a'), getCard('Asteroid Mining'))).toBe(30);
  });
});

describe('requirements', () => {
  it('global minimums, maximums and tolerance', () => {
    const h = started('Inventrix');
    const lichen = getCard('Lichen');
    expect(unmetRequirements(h.s, h.p('b'), lichen)).toHaveLength(1);
    h.s.global.temperature = -28;
    expect(unmetRequirements(h.s, h.p('a'), lichen)).toHaveLength(0); // Inventrix: ±2 steps = 4 °C
    expect(unmetRequirements(h.s, h.p('b'), lichen)).toHaveLength(1);
    h.s.global.oxygen = 6;
    expect(unmetRequirements(h.s, h.p('b'), getCard('Colonizer Training Camp'))).toHaveLength(1);
    expect(unmetRequirements(h.s, h.p('a'), getCard('Colonizer Training Camp'))).toHaveLength(0);
  });
  it('Special Design applies to the next card only', () => {
    const h = started();
    h.s.global.oxygen = 4;
    const windmills = getCard('Windmills');
    expect(unmetRequirements(h.s, h.p('a'), windmills)).toHaveLength(1);
    h.play('a', 'Special Design');
    expect(unmetRequirements(h.s, h.p('a'), windmills)).toHaveLength(1); // 7% needs 3 steps
    h.s.global.oxygen = 5;
    expect(unmetRequirements(h.s, h.p('a'), windmills)).toHaveLength(0);
    h.play('a', 'Windmills');
    expect(unmetRequirements(h.s, h.p('a'), windmills)).toHaveLength(1);
  });
  it('tag and city requirements', () => {
    const h = started();
    expect(unmetRequirements(h.s, h.p('a'), getCard('Fusion Power'))).toHaveLength(1);
    h.place('a', 'Geothermal Power'); h.place('a', 'Power Plant');
    expect(unmetRequirements(h.s, h.p('a'), getCard('Fusion Power'))).toHaveLength(0);
    h.p('a').tiles.cityOnMars = 1; h.p('b').tiles.cityOnMars = 1;
    expect(unmetRequirements(h.s, h.p('a'), getCard('Rad-Suits'))).toHaveLength(0);
  });
});

describe('global parameters', () => {
  it('temperature bonuses at −24 and −20, ocean at 0 °C', () => {
    const h = started();
    h.give('a', {heat: 40});
    for (let i = 0; i < 5; i++) { h.turn('a'); h.do({t: 'convertHeat', playerId: 'a', answers: []}); }
    expect(h.s.global.temperature).toBe(-20);
    expect(h.p('a').production.heat).toBe(2);
    expect(h.p('a').tr).toBe(25);
    h.s.global.temperature = -2;
    h.give('a', {heat: 8});
    h.turn('a');
    expect(preview(h.s, {t: 'convertHeat', playerId: 'a', answers: []})).toMatchObject({prompt: {kind: 'tile', tile: 'ocean'}});
    h.do({t: 'convertHeat', playerId: 'a', answers: [{kind: 'tile', bonus: {plants: 2}}]});
    expect(h.s.global).toMatchObject({temperature: 0, oceans: 1});
    expect(h.p('a').tr).toBe(27);
    expect(h.p('a').stock.plants).toBe(2);
  });
  it('oxygen reaching 8% raises temperature one step', () => {
    const h = started();
    h.s.global.oxygen = 7;
    h.give('a', {plants: 8});
    h.do({t: 'convertPlants', playerId: 'a', answers: [{kind: 'tile', bonus: {}}]});
    expect(h.s.global).toMatchObject({oxygen: 8, temperature: -28});
    expect(h.p('a').tr).toBe(22);
    expect(h.p('a').tiles.greenery).toBe(1);
  });
  it('no ninth-plus ocean and no TR above the cap', () => {
    const h = started();
    h.s.global.oceans = 9;
    h.play('a', 'Subterranean Reservoir');
    expect(h.s.global.oceans).toBe(9);
    expect(h.p('a').tr).toBe(20);
    h.s.global.temperature = 8;
    h.turn('a');
    h.play('a', 'Deep Well Heating');
    expect(h.p('a').tr).toBe(20);
  });
  it('the game moves to the final greenery round when all parameters are maxed', () => {
    const h = started();
    h.s.global = {temperature: 8, oxygen: 14, oceans: 9, venus: 0};
    h.do({t: 'pass', playerId: 'a'});
    h.do({t: 'pass', playerId: 'b'});
    expect(h.s.phase).toBe('finalGreenery');
  });
});

describe('triggers', () => {
  it('Arctic Algae, Pets, Rover Construction on another player’s tiles', () => {
    const h = started();
    h.place('b', 'Arctic Algae'); h.place('b', 'Pets'); h.place('b', 'Rover Construction');
    h.play('a', 'Subterranean Reservoir');
    expect(h.p('b').stock.plants).toBe(2);
    h.give('a', {megacredits: 25});
    h.resolve({t: 'standardProject', playerId: 'a', project: 'city', payment: {megacredits: 25}, answers: []});
    expect(h.p('b').played.find((c) => c.name === 'Pets')!.resources).toBe(1);
    expect(h.p('b').stock.megacredits).toBe(42 + 2);
  });
  it('Herbivores only on its owner’s greenery', () => {
    const h = started();
    h.place('a', 'Herbivores'); h.give('a', {plants: 8}); h.give('b', {plants: 8});
    h.resolve({t: 'convertPlants', playerId: 'a', answers: []});
    expect(h.p('a').played[0].resources).toBe(1);
    h.turn('b');
    h.resolve({t: 'convertPlants', playerId: 'b', answers: []});
    expect(h.p('a').played[0].resources).toBe(1);
  });
  it('Tharsis Republic: first action city, and others’ cities', () => {
    const h = started('Tharsis Republic');
    h.resolve({t: 'action', playerId: 'a', card: 'Tharsis Republic', payment: {}, answers: []});
    expect(h.p('a').production.megacredits).toBe(1);
    expect(h.p('a').stock.megacredits).toBe(43);
    expect(h.p('a').tiles.cityOnMars).toBe(1);
    h.turn('b'); h.give('b', {megacredits: 20}, {energy: 2});
    h.play('b', 'Phobos Space Haven'); // off Mars: no Tharsis production
    expect(h.p('a').production.megacredits).toBe(1);
    h.turn('b');
    h.play('b', 'Underground City');
    expect(h.p('a').production.megacredits).toBe(2);
  });
  it('Decomposers counts tags of the played card, including itself', () => {
    const h = started();
    h.play('a', 'Decomposers');
    const d = () => h.p('a').played.find((c) => c.name === 'Decomposers')!.resources;
    expect(d()).toBe(1);
    h.turn('a');
    h.play('a', 'Advanced Ecosystems');
    expect(d()).toBe(4);
  });
  it('Saturn Systems gains from any player’s Jovian tag', () => {
    const h = started('Saturn Systems');
    h.turn('b'); h.give('b', {megacredits: 20}, {energy: 2});
    h.play('b', 'Asteroid Mining');
    expect(h.p('a').production.megacredits).toBe(1);
  });
  it('CrediCor on expensive cards and standard projects; Standard Technology', () => {
    const h = started('CrediCor');
    h.place('a', 'Standard Technology');
    h.play('a', 'Asteroid Mining');
    expect(h.p('a').stock.megacredits).toBe(57 - 30 + 4);
    h.turn('a');
    h.resolve({t: 'standardProject', playerId: 'a', project: 'city', payment: {megacredits: 25}, answers: []});
    expect(h.p('a').stock.megacredits).toBe(31 - 25 + 4 + 3);
    h.turn('a');
    h.resolve({t: 'standardProject', playerId: 'a', project: 'sellPatents', payment: {}, answers: [{kind: 'amount', value: 0}]});
    expect(h.p('a').stock.megacredits).toBe(13);
  });
  it('Mining Guild gains production from steel or titanium bonuses', () => {
    const h = started('Mining Guild');
    h.give('a', {plants: 8});
    h.do({t: 'convertPlants', playerId: 'a', answers: [{kind: 'tile', bonus: {steel: 2}}]});
    expect(h.p('a').production.steel).toBe(2);
    expect(h.p('a').stock.steel).toBe(7);
  });
  it('event triggers: Optimal Aerobraking, Media Group, Interplanetary Cinematics', () => {
    const h = started('Interplanetary Cinematics');
    h.place('a', 'Optimal Aerobraking'); h.place('a', 'Media Group');
    const before = h.p('a').stock.megacredits;
    h.play('a', 'Asteroid');
    expect(h.p('a').stock.megacredits).toBe(before - 14 + 3 + 3 + 2);
    expect(h.p('a').stock.heat).toBe(3);
  });
  it('Olympus Conference must add when empty; Viral Enhancers can feed the played card', () => {
    const h = started();
    const prompts = h.play('a', 'Olympus Conference');
    expect(prompts[0]).toMatchObject({kind: 'or'});
    expect(h.p('a').played.find((c) => c.name === 'Olympus Conference')!.resources).toBe(1);
    h.turn('a'); h.place('a', 'Viral Enhancers');
    h.play('a', 'Tardigrades', (p) => p.kind === 'or' ? {kind: 'or', index: 1} : autoAnswer(p));
    expect(h.p('a').played.find((c) => c.name === 'Tardigrades')!.resources).toBe(1);
  });
});

describe('actions and attacks', () => {
  it('a blue action works once per generation', () => {
    const h = started();
    h.place('a', 'Tardigrades');
    h.do({t: 'action', playerId: 'a', card: 'Tardigrades', payment: {}, answers: []});
    expect(preview(h.s, {t: 'action', playerId: 'a', card: 'Tardigrades', payment: {}, answers: []}))
      .toMatchObject({error: expect.stringContaining('already used')});
    h.do({t: 'pass', playerId: 'a'}); h.do({t: 'pass', playerId: 'b'});
    h.do({t: 'research', playerId: 'a', cardsBought: 0}); h.do({t: 'research', playerId: 'b', cardsBought: 0});
    h.turn('a');
    h.do({t: 'action', playerId: 'a', card: 'Tardigrades', payment: {}, answers: []});
    expect(h.p('a').played[0].resources).toBe(2);
  });
  it('UNMI needs a TR raise this generation', () => {
    const h = started('United Nations Mars Initiative');
    expect(preview(h.s, {t: 'action', playerId: 'a', card: 'United Nations Mars Initiative', payment: {}, answers: []}))
      .toMatchObject({ok: false, error: expect.stringContaining('terraform rating')});
    h.play('a', 'Release of Inert Gases');
    h.do({t: 'action', playerId: 'a', card: 'United Nations Mars Initiative', payment: {}, answers: []});
    expect(h.p('a').tr).toBe(23);
    expect(h.p('a').stock.megacredits).toBe(40 - 14 - 3);
  });
  it('Predators needs an animal to take; Pets and Protected Habitats protect', () => {
    const h = started();
    h.place('a', 'Predators');
    h.place('b', 'Pets', 3);
    expect(preview(h.s, {t: 'action', playerId: 'a', card: 'Predators', payment: {}, answers: []})).toMatchObject({ok: false});
    h.place('b', 'Birds', 2);
    h.place('b', 'Protected Habitats');
    expect(preview(h.s, {t: 'action', playerId: 'a', card: 'Predators', payment: {}, answers: []})).toMatchObject({ok: false});
    h.p('b').played = h.p('b').played.filter((c) => c.name !== 'Protected Habitats');
    h.resolve({t: 'action', playerId: 'a', card: 'Predators', payment: {}, answers: []});
    expect(h.p('b').played.find((c) => c.name === 'Birds')!.resources).toBe(1);
    expect(h.events.some((e) => e.kind === 'attack' && e.target === 'b')).toBe(true);
  });
  it('asteroids remove plants from the chosen player, not a protected one', () => {
    const h = started();
    h.give('b', {plants: 5});
    const prompts = h.play('a', 'Asteroid', (p) => p.kind === 'player' ? {kind: 'player', playerId: 'b'} : autoAnswer(p));
    expect(prompts.map((p) => p.kind)).toEqual(['player']);
    expect(h.p('b').stock.plants).toBe(2);
    h.place('b', 'Protected Habitats');
    h.turn('a');
    const again = h.play('a', 'Comet');
    expect(again.find((p) => p.kind === 'player')).toBeUndefined();
  });
  it('production attacks need a target; Sabotage and Hired Raiders', () => {
    const h = started();
    expect(preview(h.s, {t: 'playCard', playerId: 'a', card: 'Energy Tapping', payment: {megacredits: 3}, answers: []}))
      .toMatchObject({error: expect.stringContaining('Nobody')});
    h.give('b', {steel: 5}, {energy: 1});
    h.play('a', 'Energy Tapping', (p) => p.kind === 'player' ? {kind: 'player', playerId: 'b'} : autoAnswer(p));
    expect(h.p('b').production.energy).toBe(0);
    expect(h.p('a').production.energy).toBe(1);
    h.turn('a');
    h.play('a', 'Hired Raiders', (p) => p.kind === 'or' ? {kind: 'or', index: 0} : {kind: 'player', playerId: 'b'});
    expect(h.p('a').stock.steel).toBe(2);
    expect(h.p('b').stock.steel).toBe(3);
    h.turn('a');
    h.play('a', 'Sabotage', (p) => p.kind === 'or' ? {kind: 'or', index: 1} : {kind: 'player', playerId: 'b'});
    expect(h.p('b').stock.steel).toBe(0);
  });
  it('Robotic Workforce copies a building production box', () => {
    const h = started();
    h.place('a', 'Mine');
    h.play('a', 'Robotic Workforce');
    expect(h.p('a').production.steel).toBe(1);
  });
  it('Insulation and Power Infrastructure take an amount', () => {
    const h = started();
    h.give('a', {energy: 4}, {heat: 3});
    h.play('a', 'Insulation', () => ({kind: 'amount', value: 2}));
    expect(h.p('a').production).toMatchObject({heat: 1, megacredits: 2});
    h.place('a', 'Power Infrastructure');
    h.resolve({t: 'action', playerId: 'a', card: 'Power Infrastructure', payment: {}, answers: [{kind: 'amount', value: 3}]});
    expect(h.p('a').stock.energy).toBe(1);
  });
  it('Nitrogen-Rich Asteroid gives 4 plant production with 3 plant tags', () => {
    const h = started();
    h.place('a', 'Lichen'); h.place('a', 'Heather'); h.place('a', 'Grass');
    h.give('a', {megacredits: 10});
    h.play('a', 'Nitrogen-Rich Asteroid');
    expect(h.p('a').production.plants).toBe(4);
    expect(h.p('a').tr).toBe(23);
  });
});

describe('milestones, awards and scoring', () => {
  it('milestones need their condition; awards cost 8/14/20', () => {
    const h = started();
    expect(preview(h.s, {t: 'claimMilestone', playerId: 'a', milestone: 'Gardener'})).toMatchObject({ok: false});
    h.p('a').tiles.greenery = 3;
    h.do({t: 'claimMilestone', playerId: 'a', milestone: 'Gardener'});
    expect(h.p('a').stock.megacredits).toBe(34);
    h.do({t: 'fundAward', playerId: 'a', award: 'Banker'});
    expect(h.p('a').stock.megacredits).toBe(26);
    h.do({t: 'fundAward', playerId: 'b', award: 'Miner'});
    expect(h.p('b').stock.megacredits).toBe(42 - 14);
  });
  it('scores TR, milestones, awards, greeneries, cards and board VP', () => {
    const h = started();
    h.p('a').tiles.greenery = 3;
    h.do({t: 'claimMilestone', playerId: 'a', milestone: 'Gardener'});
    h.p('a').production.megacredits = 3;
    h.do({t: 'fundAward', playerId: 'a', award: 'Banker'});
    h.place('a', 'Birds', 3); h.place('a', 'Search For Life', 1); h.place('a', 'Io Mining Industries'); h.place('a', 'Dust Seals');
    h.do({t: 'boardVP', playerId: 'a', cityAdjacency: 4, other: 1});
    expect(awardPlaces(h.s, 'Banker')[0]).toMatchObject({player: 'a', place: 1});
    const sc = score(h.s, h.p('a'));
    expect(sc).toMatchObject({tr: 20, milestones: 5, awards: 5, greenery: 3, cities: 4, other: 1, cards: 3 + 3 + 1 + 1});
    expect(sc.total).toBe(20 + 5 + 5 + 3 + 4 + 1 + 8);
  });
});

describe('prompt replay', () => {
  it('a command returns one prompt at a time and replays deterministically', () => {
    const h = started();
    h.give('b', {plants: 4});
    const cmd = {t: 'playCard' as const, playerId: 'a', card: 'Comet', payment: {megacredits: 21}, answers: [] as Answer[]};
    const first = preview(h.s, cmd);
    expect(first).toMatchObject({ok: false, prompt: {kind: 'player', allowNone: true}});
    cmd.answers.push({kind: 'player', playerId: 'b'});
    expect(preview(h.s, cmd)).toMatchObject({ok: false, prompt: {kind: 'tile'}});
    cmd.answers.push({kind: 'tile', bonus: {}});
    const done = preview(h.s, cmd);
    expect(done.ok).toBe(true);
    const again = preview(h.s, cmd);
    expect(again).toEqual(done);
  });
});
