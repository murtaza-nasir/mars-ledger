import {describe, expect, it} from 'vitest';
import type {Color, PublicPlayerModel, SpaceModel, SpectatorModel} from '../src/shared/full';
import type {GameState, Tick} from '../src/shared/game';
import {closeGeneration, companionHistory, highlights, newHistory, observeFull, titles, totals, trRace} from '../src/shared/history';

function player(color: Color, name: string, o: Partial<PublicPlayerModel> = {}): PublicPlayerModel {
  return {
    color, name, isActive: false, terraformRating: 20,
    megacredits: 40, megacreditProduction: 0, steel: 0, steelProduction: 0, steelValue: 2, titanium: 0, titaniumProduction: 0, titaniumValue: 3,
    plants: 0, plantProduction: 0, energy: 0, energyProduction: 0, heat: 0, heatProduction: 0,
    cardsInHandNbr: 5, citiesCount: 0, tableau: [{name: color === 'red' ? 'Ecoline' : 'Helion'}], tags: [], actionsThisGeneration: [],
    actionsTakenThisRound: 0, availableBlueCardActionCount: 0, ...o,
  };
}

const SPACES: SpaceModel[] = ['03', '04', '05', '06', '07'].map((id, i) => ({id, x: i, y: 0, spaceType: i === 1 ? 'ocean' : 'land', bonus: []}));

function model(players: PublicPlayerModel[], g: Partial<SpectatorModel['game']> = {}): SpectatorModel {
  return {
    id: 'spec', color: 'neutral', players,
    game: {
      gameAge: 1, undoCount: 0, generation: 1, phase: 'action', temperature: -30, oxygenLevel: 0, oceans: 0, venusScaleLevel: 0, isTerraformed: false,
      spaces: SPACES, passedPlayers: [], milestones: [], awards: [], deckSize: 100, ...g,
    },
  };
}

describe('observeFull', () => {
  it('credits tiles, cards, TR, global steps and spending to the acting player', () => {
    const h = newHistory('g1', 'full');
    const a = model([player('red', 'Ann', {isActive: true}), player('blue', 'Bo')]);
    observeFull(h, null, a);
    const b = model([
      player('red', 'Ann', {isActive: false, terraformRating: 22, megacredits: 22, tableau: [{name: 'Ecoline'}, {name: 'Comet'}]}),
      player('blue', 'Bo', {isActive: true}),
    ], {gameAge: 2, temperature: -28, oceans: 1, spaces: SPACES.map((s) => (s.id === '04' ? {...s, tileType: 1} : s))});
    observeFull(h, a, b);
    const [ann] = totals(h);
    expect(ann.cards).toEqual([{name: 'Comet', cost: 21}]);
    expect(ann.tiles.ocean).toBe(1);
    expect(ann.trGained).toBe(2);
    expect(ann.globalSteps).toBe(2);
    expect(ann.mcSpent).toBe(18);
    expect(h.tiles).toEqual([expect.objectContaining({spaceId: '04', tileType: 1, by: 'red', generation: 1, order: 0})]);
  });

  it('records attacks without counting the victim\'s loss as spending', () => {
    const h = newHistory('g1', 'full');
    const a = model([player('red', 'Ann', {isActive: true}), player('blue', 'Bo', {megacredits: 20, plants: 6})]);
    observeFull(h, null, a);
    const b = model([player('red', 'Ann', {isActive: true, tableau: [{name: 'Ecoline'}, {name: 'Hired Raiders'}], megacredits: 43}),
      player('blue', 'Bo', {megacredits: 17, plants: 6})], {gameAge: 2});
    observeFull(h, a, b);
    const [ann, bo] = totals(h);
    expect(ann.dealt).toBe(3);
    expect(bo.received).toBe(3);
    expect(bo.mcSpent).toBe(0);
    expect(h.generations[0].attacks[0]).toMatchObject({attacker: 'red', units: 3});
  });

  it('closes a generation with its pre-production TR when the generation advances', () => {
    const h = newHistory('g1', 'full');
    const a = model([player('red', 'Ann', {terraformRating: 24}), player('blue', 'Bo', {terraformRating: 21})]);
    observeFull(h, null, a);
    const b = model([player('red', 'Ann', {terraformRating: 24}), player('blue', 'Bo', {terraformRating: 21})], {generation: 2, gameAge: 5, phase: 'research'});
    const r = observeFull(h, a, b);
    expect(r.closed).toBe(1);
    expect(h.generations.find((g) => g.generation === 1)).toMatchObject({closed: true, tr: {red: 24, blue: 21}});
    expect(trRace(h)[0].points).toEqual([{generation: 0, tr: 20}, {generation: 1, tr: 24}, {generation: 2, tr: 24}]);
  });

  it('closes the final generation explicitly and keeps the final board', () => {
    const h = newHistory('g1', 'full');
    const a = model([player('red', 'Ann', {terraformRating: 40}), player('blue', 'Bo')], {generation: 12});
    observeFull(h, null, a);
    expect(closeGeneration(h, a)).toBe(12);
    expect(closeGeneration(h, a)).toBeNull();
    const end = model([player('red', 'Ann', {terraformRating: 40}), player('blue', 'Bo')], {generation: 12, phase: 'end', gameAge: 9,
      spaces: SPACES.map((s) => (s.id === '03' ? {...s, tileType: 0, color: 'red'} : s))});
    const r = observeFull(h, a, end);
    expect(r.ended).toBe(true);
    expect(h.ended).toBe(true);
    expect(h.finalSpaces?.find((s) => s.id === '03')?.tileType).toBe(0);
  });

  it('ignores updates across an undo', () => {
    const h = newHistory('g1', 'full');
    const a = model([player('red', 'Ann', {isActive: true}), player('blue', 'Bo')]);
    observeFull(h, null, a);
    const b = model([player('red', 'Ann', {terraformRating: 30}), player('blue', 'Bo')], {undoCount: 1, gameAge: 3});
    expect(observeFull(h, a, b).changed).toBe(false);
    expect(totals(h)[0].trGained).toBe(0);
  });
});

describe('highlights and titles', () => {
  function played(): ReturnType<typeof newHistory> {
    const h = newHistory('g1', 'full');
    h.players = [{color: 'red', name: 'Ann'}, {color: 'blue', name: 'Bo'}, {color: 'green', name: 'Cy'}];
    h.generations = [{
      generation: 1, closed: true, attacks: [{attacker: 'blue', units: 4, targets: [{color: 'red', losses: [{what: 'stock', resource: 'plants', amount: 4}]}]}],
      params: {temperature: [-30, -26], oxygen: [0, 1], oceans: [0, 2]}, tr: {}, vp: {},
      players: [
        {color: 'red', cards: [{name: 'Comet', cost: 21}], tiles: {city: 0, greenery: 3, ocean: 0, special: 0}, trGained: 4, mcSpent: 30, dealt: 0, received: 4, globalSteps: 3, milestones: [], awards: []},
        {color: 'blue', cards: [{name: 'Asteroid', cost: 14}, {name: 'Birds', cost: 10}], tiles: {city: 1, greenery: 0, ocean: 0, special: 0}, trGained: 1, mcSpent: 60, dealt: 4, received: 0, globalSteps: 1, milestones: [], awards: []},
        {color: 'green', cards: [], tiles: {city: 0, greenery: 0, ocean: 0, special: 0}, trGained: 0, mcSpent: 0, dealt: 0, received: 0, globalSteps: 0, milestones: [], awards: []},
      ],
    }];
    return h;
  }

  it('picks the generation highlights', () => {
    const hi = highlights(played().generations[0]);
    expect(hi.biggestPlay).toEqual({color: 'red', name: 'Comet', cost: 21});
    expect(hi.harshestAttack?.attacker).toBe('blue');
    expect(hi.mostTiles).toMatchObject({color: 'red', count: 3});
    expect(hi.terraforming).toEqual({temperature: 2, oxygen: 1, oceans: 2});
  });

  it('gives every player one distinct title', () => {
    const t = titles(played());
    expect(t).toHaveLength(3);
    expect(new Set(t.map((x) => x.title)).size).toBe(3);
    // outright leads with no rival count win first
    expect(t.find((x) => x.color === 'red')?.title).toBe('Green thumb');
    expect(['Most ruthless', 'Urban planner', 'Big spender', 'Card shark']).toContain(t.find((x) => x.color === 'blue')?.title);
    expect(t.find((x) => x.color === 'green')).toEqual({color: 'green', title: 'Steady hand', detail: '0 TR gained'});
  });
});

describe('companionHistory', () => {
  it('builds generations, tiles and the TR race from the command log', () => {
    const state = {id: 'c1', players: [{id: 'p1', name: 'Ann', color: 'red', corporation: 'Ecoline'}, {id: 'p2', name: 'Bo', color: 'blue', corporation: null}]} as unknown as GameState;
    const tick = (events: Tick['events']): Tick => ({seq: 1, at: 0, command: {t: 'pass', playerId: 'p1'}, events});
    const h = companionHistory(state, [
      tick([{kind: 'cardPlayed', player: 'p1', card: 'Comet', tags: [], cardType: 'event', cost: 21}, {kind: 'global', player: 'p1', param: 'temperature', from: -30, to: -28},
        {kind: 'tr', player: 'p1', delta: 1}, {kind: 'tile', player: 'p1', tile: 'ocean'}, {kind: 'attack', player: 'p1', target: 'p2', what: '−3 plants'}]),
      tick([{kind: 'production', generation: 1}, {kind: 'generation', generation: 2}]),
      tick([{kind: 'tile', player: 'p2', tile: 'city'}, {kind: 'ended'}]),
    ]);
    expect(h.generations.map((g) => [g.generation, g.closed])).toEqual([[1, true], [2, true]]);
    expect(h.generations[0].tr).toEqual({red: 21, blue: 20});
    const [ann, bo] = totals(h);
    expect(ann).toMatchObject({trGained: 1, globalSteps: 1, dealt: 3, mcSpent: 21});
    expect(ann.tiles.ocean).toBe(1);
    expect(bo.tiles.city).toBe(1);
    expect(h.ended).toBe(true);
  });

  it('treats a manual correction of a global parameter as the new baseline, not terraforming', () => {
    const state = {id: 'c2', players: [{id: 'p1', name: 'Ann', color: 'red', corporation: null}]} as unknown as GameState;
    const h = companionHistory(state, [
      {seq: 1, at: 0, command: {t: 'setGlobal', playerId: 'p1', param: 'temperature', value: 6}, events: [{kind: 'global', player: null, param: 'temperature', from: -30, to: 6}]},
      {seq: 2, at: 0, command: {t: 'convertHeat', playerId: 'p1', answers: []}, events: [{kind: 'global', player: 'p1', param: 'temperature', from: 6, to: 8}]},
    ]);
    expect(h.generations[0].params.temperature).toEqual([6, 8]);
    expect(totals(h)[0].globalSteps).toBe(1);
  });
});

describe('who maxed each global parameter', () => {
  it('full: credits the acting player with the step that reached the maximum, once', () => {
    const h = newHistory('g1', 'full');
    const a = model([player('red', 'Ann', {isActive: true}), player('blue', 'Bo')], {temperature: 6, oxygenLevel: 13, oceans: 8});
    observeFull(h, null, a);
    const b = model([player('red', 'Ann'), player('blue', 'Bo', {isActive: true})], {gameAge: 2, temperature: 8, oxygenLevel: 14, oceans: 9});
    observeFull(h, a, b);
    const c = model([player('red', 'Ann', {isActive: true}), player('blue', 'Bo')], {gameAge: 3, temperature: 8, oxygenLevel: 14, oceans: 9});
    observeFull(h, b, c);
    expect(h.maxedBy).toEqual({temperature: 'red', oxygen: 'red', oceans: 'red'});
  });

  it('companion: from the global events, ignoring manual corrections', () => {
    const state = {id: 'c3', players: [{id: 'p1', name: 'Ann', color: 'red', corporation: null}, {id: 'p2', name: 'Bo', color: 'blue', corporation: null}]} as unknown as GameState;
    const h = companionHistory(state, [
      {seq: 1, at: 0, command: {t: 'setGlobal', playerId: 'p1', param: 'oxygen', value: 14}, events: [{kind: 'global', player: null, param: 'oxygen', from: 0, to: 14}]},
      {seq: 2, at: 0, command: {t: 'pass', playerId: 'p2'}, events: [{kind: 'global', player: 'p2', param: 'oceans', from: 8, to: 9}]},
    ]);
    expect(h.maxedBy).toEqual({oceans: 'blue'});
  });
});
