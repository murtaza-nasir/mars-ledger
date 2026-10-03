import {describe, expect, it} from 'vitest';
import {getCard} from '../src/shared/cards';
import {cardSynergies, DEFAULT_HAND_VIEW, effectiveView, filterHand, handTagCounts, parseHandView, sortHand, type HandEntry} from '../src/shared/synergy';

const c = getCard;
const kinds = (s: ReturnType<typeof cardSynergies>) => s.map((x) => `${x.kind}:${x.source}`);

describe('synergy: tag discounts', () => {
  it('Earth Office marks an Earth card when the engine cost proves the discount', () => {
    const s = cardSynergies(c('Imported GHG'), [c('Earth Office')], 4);
    expect(kinds(s)).toEqual(['discount:Earth Office']);
    expect(s[0].reason).toBe('Earth Office takes 3 M€ off its Earth tag.');
  });
  it('no discount without the engine proof (cost not below the printed cost, or unknown)', () => {
    expect(cardSynergies(c('Imported GHG'), [c('Earth Office')], 7)).toEqual([]);
    expect(cardSynergies(c('Imported GHG'), [c('Earth Office')])).toEqual([]);
  });
  it('no discount for a card without the tag, even when something else made it cheaper', () => {
    expect(kinds(cardSynergies(c('Breathing Filters'), [c('Earth Office'), c('Research Outpost')], 10))).toEqual([]);
  });
  it('untagged discounts (Research Outpost) are not reasons: they apply to every card', () => {
    expect(cardSynergies(c('Asteroid'), [c('Research Outpost')], 13)).toEqual([]);
  });
  it('Space Station and Shuttles both mark a space card', () => {
    expect(kinds(cardSynergies(c('Asteroid'), [c('Space Station'), c('Shuttles')], 10))).toEqual(['discount:Space Station', 'discount:Shuttles']);
  });
});

describe('synergy: triggers you own', () => {
  it('Mars University fires for a science tag', () => {
    expect(kinds(cardSynergies(c('Breathing Filters'), [c('Mars University')]))).toEqual(['trigger:Mars University']);
  });
  it('Optimal Aerobraking fires for a space event, not for a space automated card or a non-space event', () => {
    expect(kinds(cardSynergies(c('Asteroid'), [c('Optimal Aerobraking')]))).toEqual(['trigger:Optimal Aerobraking']);
    expect(cardSynergies(c('Space Elevator'), [c('Optimal Aerobraking')])).toEqual([]);
    expect(cardSynergies(c('Flooding'), [c('Optimal Aerobraking')])).toEqual([]);
  });
  it('Decomposers fires for a microbe tag; Media Group for any event', () => {
    expect(kinds(cardSynergies(c('Ants'), [c('Decomposers')]))).toEqual(['trigger:Decomposers']);
    expect(kinds(cardSynergies(c('Flooding'), [c('Media Group')]))).toEqual(['trigger:Media Group']);
    expect(cardSynergies(c('Ants'), [c('Media Group')])).toEqual([]);
  });
  it('Rover Construction fires for a card that places a city on Mars', () => {
    expect(kinds(cardSynergies(c('Research Outpost'), [c('Rover Construction')]))).toEqual(['trigger:Rover Construction']);
  });
  it('Tharsis Republic: an off-Mars city sets off only its own-city trigger, not the on-Mars production one', () => {
    const s = cardSynergies(c('Ganymede Colony'), [c('Tharsis Republic')]);
    expect(kinds(s)).toEqual(['trigger:Tharsis Republic']);
    expect(s[0].reason).toContain('you placed a city');
  });
  it('Arctic Algae for an ocean, Herbivores for a greenery', () => {
    expect(kinds(cardSynergies(c('Lake Marineris'), [c('Arctic Algae')]))).toEqual(['trigger:Arctic Algae']);
    expect(kinds(cardSynergies(c('Mangrove'), [c('Herbivores')]))).toEqual(['trigger:Herbivores']);
  });
  it('a tile outside an either/or still counts (Imported Hydrogen always places its ocean)', () => {
    expect(kinds(cardSynergies(c('Imported Hydrogen'), [c('Arctic Algae')]))).toEqual(['trigger:Arctic Algae']);
  });
  it('tiles inside an either/or choice prove nothing (no base card does this; synthetic card)', () => {
    const choice = {...c('Mangrove'), behavior: {or: {behaviors: [{title: 'City', city: {}}, {title: 'Plants', stock: {plants: 3}}]}}};
    expect(cardSynergies(choice, [c('Rover Construction')])).toEqual([]);
  });
  it('placement-bonus triggers (Mining Guild) are never claimed', () => {
    expect(cardSynergies(c('Research Outpost'), [c('Mining Guild')])).toEqual([]);
  });
  it('CrediCor needs a printed cost of 20 or more', () => {
    expect(kinds(cardSynergies(c('Comet'), [c('CrediCor')]))).toEqual(['trigger:CrediCor']);
    expect(cardSynergies(c('Asteroid'), [c('CrediCor')])).toEqual([]);
  });
  it('Saturn Systems (any player) counts for your own Jovian card', () => {
    expect(kinds(cardSynergies(c('Ganymede Colony'), [c('Saturn Systems')]))).toEqual(['trigger:Saturn Systems']);
  });
});

describe('synergy: resource targets', () => {
  it('a card that adds microbes marks when you own a microbe card', () => {
    const s = cardSynergies(c('Aerobraked Ammonia Asteroid'), [c('Decomposers')]);
    expect(kinds(s)).toEqual(['resources:Decomposers']);
    expect(s[0].reason).toBe('It adds 2 microbes to a card of yours (Decomposers).');
  });
  it('no resource synergy without a matching card', () => {
    expect(cardSynergies(c('Aerobraked Ammonia Asteroid'), [c('Birds')]).filter((x) => x.kind === 'resources')).toEqual([]);
  });
  it('a microbe card marks when an owned action can feed it (Symbiotic Fungus)', () => {
    const s = cardSynergies(c('Ants'), [c('Symbiotic Fungus')]);
    expect(kinds(s)).toEqual(['resources:Symbiotic Fungus']);
  });
  it('nothing in play, nothing to mark', () => {
    for (const n of ['Asteroid', 'Ants', 'Research Outpost', 'Mangrove', 'Comet']) expect(cardSynergies(c(n), [])).toEqual([]);
  });
});

describe('hand sort and filter', () => {
  const e = (name: string, cost: number, playable: boolean): HandEntry => ({name, def: c(name), cost, playable});
  const hand = [e('Comet', 21, true), e('Ants', 9, false), e('Asteroid', 14, true), e('Breathing Filters', 11, false), e('Mangrove', 12, true)];
  it('playable first, then cost', () => {
    expect(sortHand(hand, 'playable').map((x) => x.name)).toEqual(['Mangrove', 'Asteroid', 'Comet', 'Ants', 'Breathing Filters']);
  });
  it('by cost', () => {
    expect(sortHand(hand, 'cost').map((x) => x.name)).toEqual(['Ants', 'Breathing Filters', 'Mangrove', 'Asteroid', 'Comet']);
  });
  it('by type: automated, active, event', () => {
    expect(sortHand(hand, 'type').map((x) => x.def.type)).toEqual(['automated', 'automated', 'active', 'event', 'event']);
  });
  it('by tag, in the game tag order, then cost', () => {
    expect(sortHand(hand, 'tag').map((x) => x.name)).toEqual(['Asteroid', 'Comet', 'Breathing Filters', 'Mangrove', 'Ants']);
  });
  it('filters by playable and by tag', () => {
    expect(filterHand(hand, 'playable').map((x) => x.name)).toEqual(['Comet', 'Asteroid', 'Mangrove']);
    expect(filterHand(hand, 'space').map((x) => x.name)).toEqual(['Comet', 'Asteroid']);
    expect(filterHand(hand, 'all')).toHaveLength(5);
  });
  it('counts tags present in the hand', () => {
    expect(handTagCounts(hand)).toEqual([['space', 2], ['science', 1], ['plant', 1], ['microbe', 1]]);
  });
  it('a stored tag filter whose tag left the hand falls back to all', () => {
    expect(effectiveView({sort: 'cost', filter: 'jovian'}, hand)).toEqual({sort: 'cost', filter: 'all'});
    expect(effectiveView({sort: 'cost', filter: 'space'}, hand)).toEqual({sort: 'cost', filter: 'space'});
  });
  it('persistence: parses what it stored, rejects junk', () => {
    expect(parseHandView(JSON.stringify({sort: 'tag', filter: 'science'}))).toEqual({sort: 'tag', filter: 'science'});
    expect(parseHandView('{"sort":"nonsense","filter":"x"}')).toEqual(DEFAULT_HAND_VIEW);
    expect(parseHandView(null)).toEqual(DEFAULT_HAND_VIEW);
    expect(parseHandView('not json')).toEqual(DEFAULT_HAND_VIEW);
  });
});
