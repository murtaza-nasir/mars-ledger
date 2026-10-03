// Milestones and awards per map in companion mode, against the engine's rules (vendor/tm/src/server/milestones, awards).
import {describe, expect, it} from 'vitest';
import {Harness} from './harness';
import {BOARDS} from '../src/shared/board';
import type {BoardChoice, Standing} from '../src/shared/board';
import {cardsFor} from '../src/shared/cards';
import {awardPlaces, preview, score, standingValue} from '../src/shared/engine';
import type {CardDef} from '../src/shared/types';

const ALL = cardsFor(['base', 'corpera'], 'project');
const pick = (n: number, f: (c: CardDef) => boolean) => {
  const out = ALL.filter(f).slice(0, n);
  if (out.length < n) throw new Error('not enough test cards');
  return out.map((c) => c.name);
};

function on(board: BoardChoice, resolved?: 'tharsis' | 'hellas' | 'elysium'): Harness {
  const h = new Harness();
  h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
  h.do({t: 'join', playerId: 'b', name: 'Ben', color: 'blue'});
  h.do({t: 'setBoard', playerId: 'a', board});
  h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b'], board: resolved});
  h.resolve({t: 'chooseCorp', playerId: 'a', corporation: 'Beginner Corporation', cardsKept: 0, answers: []});
  h.resolve({t: 'chooseCorp', playerId: 'b', corporation: 'Beginner Corporation', cardsKept: 0, answers: []});
  return h;
}
const st = (board: 'tharsis' | 'hellas' | 'elysium', name: string): Standing =>
  [...BOARDS[board].milestones, ...BOARDS[board].awards].find((x) => x.name === name)!;

describe('choosing the map', () => {
  it('each board has the engine\'s five milestones and five awards', () => {
    expect(BOARDS.tharsis.milestones.map((m) => m.name)).toEqual(['Terraformer', 'Mayor', 'Gardener', 'Builder', 'Planner']);
    expect(BOARDS.tharsis.awards.map((m) => m.name)).toEqual(['Landlord', 'Banker', 'Scientist', 'Thermalist', 'Miner']);
    expect(BOARDS.hellas.milestones.map((m) => m.name)).toEqual(['Diversifier', 'Tactician', 'Polar Explorer', 'Energizer', 'Rim Settler']);
    expect(BOARDS.hellas.awards.map((m) => m.name)).toEqual(['Cultivator', 'Magnate', 'Space Baron', 'Excentric', 'Contractor']);
    expect(BOARDS.elysium.milestones.map((m) => m.name)).toEqual(['Generalist', 'Specialist', 'Ecologist', 'Tycoon', 'Legend']);
    expect(BOARDS.elysium.awards.map((m) => m.name)).toEqual(['Celebrity', 'Industrialist', 'Desert Settler', 'Estate Dealer', 'Benefactor']);
  });

  it('the map is a lobby setting; the start fixes it and announces it', () => {
    const h = on('hellas');
    expect(h.s.board).toBe('hellas');
    expect(preview(h.s, {t: 'setBoard', playerId: 'a', board: 'elysium'})).toMatchObject({error: expect.stringContaining('before the game starts')});
  });

  it('a random choice is resolved by the server and replayed from the command', () => {
    const h = new Harness();
    h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
    h.do({t: 'setBoard', playerId: 'a', board: 'random'});
    const events = h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a'], board: 'elysium'});
    expect(h.s.board).toBe('elysium');
    expect(events).toContainEqual({kind: 'board', board: 'elysium', random: true});
  });

  it('games from before maps existed are Tharsis', () => {
    const h = new Harness();
    h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
    h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a']});
    expect(h.s.board).toBe('tharsis');
  });

  it('rejects an unknown map and another map\'s milestones and awards', () => {
    const h = on('hellas');
    expect(preview(h.s, {t: 'setBoard', playerId: 'a', board: 'utopia' as never})).toMatchObject({ok: false});
    h.turn('a'); h.give('a', {megacredits: 40});
    expect(preview(h.s, {t: 'claimMilestone', playerId: 'a', milestone: 'Terraformer'})).toMatchObject({error: expect.stringContaining('not a milestone on Hellas')});
    expect(preview(h.s, {t: 'fundAward', playerId: 'a', award: 'Banker'})).toMatchObject({error: expect.stringContaining('not an award on Hellas')});
  });
});

describe('Hellas', () => {
  it('Diversifier counts distinct tags on non-event cards, not the event tag', () => {
    const h = on('hellas');
    const kinds = ['building', 'space', 'science', 'power', 'earth', 'jovian', 'plant', 'microbe'];
    for (const t of kinds) h.place('a', pick(1, (c) => c.type !== 'event' && c.tags.length === 1 && c.tags[0] === t)[0]);
    h.place('a', pick(1, (c) => c.type === 'event' && c.tags.includes('space'))[0]);
    expect(standingValue(h.p('a'), st('hellas', 'Diversifier'))).toBe(8);
    h.turn('a'); h.give('a', {megacredits: 20});
    h.do({t: 'claimMilestone', playerId: 'a', milestone: 'Diversifier'});
    expect(h.s.milestones).toEqual([{name: 'Diversifier', claimedBy: 'a'}]);
  });

  it('Tactician counts non-event cards with requirements', () => {
    const h = on('hellas');
    for (const c of pick(4, (c) => c.type !== 'event' && c.requirements.length > 0)) h.place('a', c);
    h.place('a', pick(1, (c) => c.type === 'event' && c.requirements.length > 0)[0]);
    h.place('a', pick(1, (c) => c.type !== 'event' && c.requirements.length === 0)[0]);
    expect(standingValue(h.p('a'), st('hellas', 'Tactician'))).toBe(4);
    h.turn('a'); h.give('a', {megacredits: 20});
    expect(preview(h.s, {t: 'claimMilestone', playerId: 'a', milestone: 'Tactician'})).toMatchObject({error: expect.stringContaining('5 cards with requirements')});
  });

  it('Polar Explorer depends on tile rows: claimed on trust', () => {
    const h = on('hellas');
    expect(st('hellas', 'Polar Explorer').value(h.p('a'), {} as never)).toBeNull();
    h.turn('a'); h.give('a', {megacredits: 20});
    h.do({t: 'claimMilestone', playerId: 'a', milestone: 'Polar Explorer'});
    expect(h.p('a').milestones).toEqual(['Polar Explorer']);
  });

  it('Energizer is energy production; Rim Settler is Jovian tags', () => {
    const h = on('hellas');
    h.give('a', {}, {energy: 6});
    expect(standingValue(h.p('a'), st('hellas', 'Energizer'))).toBe(6);
    for (const c of pick(3, (c) => c.type !== 'event' && c.tags.includes('jovian'))) h.place('a', c);
    expect(standingValue(h.p('a'), st('hellas', 'Rim Settler'))).toBeGreaterThanOrEqual(3);
  });

  it('awards: Cultivator, Magnate, Space Baron, Excentric, Contractor', () => {
    const h = on('hellas');
    h.p('a').tiles.greenery = 3; h.p('b').tiles.greenery = 1;
    expect(standingValue(h.p('a'), st('hellas', 'Cultivator'))).toBe(3);
    for (const c of pick(2, (c) => c.type === 'automated')) h.place('b', c);
    h.place('b', pick(1, (c) => c.type === 'active')[0]);
    expect(standingValue(h.p('b'), st('hellas', 'Magnate'))).toBe(2);
    for (const c of pick(2, (c) => c.type !== 'event' && c.tags.filter((t) => t === 'space').length === 1)) h.place('a', c);
    h.place('a', pick(1, (c) => c.type === 'event' && c.tags.includes('space'))[0]);
    expect(standingValue(h.p('a'), st('hellas', 'Space Baron'))).toBe(2);
    h.place('b', pick(1, (c) => !!c.resourceType)[0], 4);
    expect(standingValue(h.p('b'), st('hellas', 'Excentric'))).toBe(4);
    for (const c of pick(2, (c) => c.type !== 'event' && c.tags.filter((t) => t === 'building').length === 1)) h.place('b', c);
    expect(standingValue(h.p('b'), st('hellas', 'Contractor'))).toBeGreaterThanOrEqual(2);
    // a funded Hellas award scores through the same values
    h.turn('a'); h.give('a', {megacredits: 20});
    h.do({t: 'fundAward', playerId: 'a', award: 'Cultivator'});
    expect(awardPlaces(h.s, 'Cultivator')[0]).toMatchObject({player: 'a', place: 1, value: 3});
    expect(score(h.s, h.p('a')).awards).toBe(5);
  });
});

describe('Elysium', () => {
  it('Generalist counts productions above zero (Corporate Era)', () => {
    const h = on('elysium');
    h.p('a').production = {megacredits: 1, steel: 1, titanium: 1, plants: 1, energy: 1, heat: 0};
    expect(standingValue(h.p('a'), st('elysium', 'Generalist'))).toBe(5);
    h.p('a').production.heat = 1;
    expect(standingValue(h.p('a'), st('elysium', 'Generalist'))).toBe(6);
  });

  it('Specialist is the largest production', () => {
    const h = on('elysium');
    h.give('a', {}, {heat: 10});
    expect(standingValue(h.p('a'), st('elysium', 'Specialist'))).toBe(10);
  });

  it('Ecologist counts plant, microbe and animal tags', () => {
    const h = on('elysium');
    for (const t of ['plant', 'microbe', 'animal'] as const) h.place('a', pick(1, (c) => c.type !== 'event' && c.tags.length === 1 && c.tags[0] === t)[0]);
    h.place('a', pick(1, (c) => c.type !== 'event' && c.tags.length === 1 && c.tags[0] === 'plant' && !h.p('a').played.some((p) => p.name === c.name))[0]);
    expect(standingValue(h.p('a'), st('elysium', 'Ecologist'))).toBe(4);
  });

  it('Tycoon counts active and automated cards; Legend counts events', () => {
    const h = on('elysium');
    for (const c of pick(3, (c) => c.type === 'automated')) h.place('a', c);
    for (const c of pick(2, (c) => c.type === 'active')) h.place('a', c);
    for (const c of pick(2, (c) => c.type === 'event')) h.place('a', c);
    expect(standingValue(h.p('a'), st('elysium', 'Tycoon'))).toBe(5);
    expect(standingValue(h.p('a'), st('elysium', 'Legend'))).toBe(2);
  });

  it('awards: Celebrity (cost ≥ 20, not events), Industrialist, Benefactor', () => {
    const h = on('elysium');
    for (const c of pick(2, (c) => c.type !== 'event' && (c.cost ?? 0) >= 20)) h.place('a', c);
    h.place('a', pick(1, (c) => c.type === 'event' && (c.cost ?? 0) >= 20)[0]);
    h.place('a', pick(1, (c) => c.type !== 'event' && (c.cost ?? 0) < 20)[0]);
    expect(standingValue(h.p('a'), st('elysium', 'Celebrity'))).toBe(2);
    h.give('b', {steel: 3, energy: 4});
    expect(standingValue(h.p('b'), st('elysium', 'Industrialist'))).toBe(7);
    h.p('b').tr = 27;
    expect(standingValue(h.p('b'), st('elysium', 'Benefactor'))).toBe(27);
  });

  it('Desert Settler and Estate Dealer are counted on the board and scored from the entered counts', () => {
    const h = on('elysium');
    h.turn('a'); h.give('a', {megacredits: 40});
    h.do({t: 'fundAward', playerId: 'a', award: 'Desert Settler'});
    // nobody has entered a count yet: everyone ties at 0
    expect(awardPlaces(h.s, 'Desert Settler').every((r) => r.value === 0)).toBe(true);
    h.do({t: 'boardVP', playerId: 'a', cityAdjacency: 0, other: 0, manual: {'Desert Settler': 2}});
    h.do({t: 'boardVP', playerId: 'b', cityAdjacency: 0, other: 0, manual: {'Desert Settler': 5}});
    expect(awardPlaces(h.s, 'Desert Settler')[0]).toMatchObject({player: 'b', place: 1, value: 5});
    expect(score(h.s, h.p('b')).awards).toBe(5);
    // only positional standings take hand-entered counts
    expect(preview(h.s, {t: 'boardVP', playerId: 'a', cityAdjacency: 0, other: 0, manual: {Benefactor: 50}})).toMatchObject({error: expect.stringContaining('automatically')});
  });
});

describe('Tharsis is unchanged', () => {
  it('Planner stays claimable on trust and Builder is checked', () => {
    const h = on('tharsis');
    h.turn('a'); h.give('a', {megacredits: 40});
    expect(preview(h.s, {t: 'claimMilestone', playerId: 'a', milestone: 'Builder'})).toMatchObject({ok: false});
    h.do({t: 'claimMilestone', playerId: 'a', milestone: 'Planner'});
    expect(h.p('a').milestones).toEqual(['Planner']);
  });
});
