import {describe, expect, it} from 'vitest';
import {getCard} from '../src/shared/cards';
import boards from '../src/shared/data/boards.json';
import type {CardModel, Color, PlayerViewModel, PublicPlayerModel, SpaceModel} from '../src/shared/full';
import type {GameState, PlayerState} from '../src/shared/game';
import {layout, HEX_W} from '../src/shared/hexgeo';
import {cardHints, hintsFor, hintWorldFromCompanion, hintWorldFromFull, placeOf, type CardHint, type HintWorld} from '../src/client/ui/cardHints';

// ---- an engine model, built the way the engine sends it ---------------------------------------
type P = {color: Color; name: string; tags?: Record<string, number>; tableau?: CardModel[]} & Partial<PublicPlayerModel>;
function pub({tags = {}, tableau = [], ...rest}: P): PublicPlayerModel {
  return {isActive: false, terraformRating: 20, megacredits: 0, megacreditProduction: 0, steel: 0, steelProduction: 0, steelValue: 2,
    titanium: 0, titaniumProduction: 0, titaniumValue: 3, plants: 0, plantProduction: 0, energy: 0, energyProduction: 0, heat: 0, heatProduction: 0,
    cardsInHandNbr: 0, citiesCount: 0, actionsThisGeneration: [], actionsTakenThisRound: 0, availableBlueCardActionCount: 0,
    // the engine sends every tag, zero or not, as {tag, count}
    tags: Object.entries(tags).map(([tag, count]) => ({tag, count})), tableau, ...rest};
}
const tharsis = (boards as Record<string, SpaceModel[]>).tharsis.map((s) => ({id: s.id, x: s.x, y: s.y, spaceType: s.spaceType, bonus: s.bonus} as SpaceModel));
function model(players: PublicPlayerModel[], opts: {hand?: string[]; tiles?: Record<string, {tileType: number; color?: Color}>; oxygen?: number; temperature?: number; oceans?: number} = {}): PlayerViewModel {
  const spaces = tharsis.map((s) => (opts.tiles?.[s.id] ? {...s, ...opts.tiles[s.id]} : s));
  return {id: 'p-red', color: players[0].color, thisPlayer: players[0], players,
    cardsInHand: (opts.hand ?? []).map((name) => ({name})), draftedCards: [], dealtProjectCards: [], dealtCorporationCards: [], pickedCorporationCard: [],
    game: {gameAge: 1, undoCount: 0, generation: 3, phase: 'action', temperature: opts.temperature ?? -20, oxygenLevel: opts.oxygen ?? 3, oceans: opts.oceans ?? 0,
      venusScaleLevel: 0, isTerraformed: false, spaces, passedPlayers: [], milestones: [], awards: [], deckSize: 100}};
}
const texts = (h: CardHint[]) => h.map((x) => x.text);
const hand = (w: HintWorld, name: string) => cardHints(getCard(name), w, {owner: w.me!, place: 'hand'});

describe('card hints: own tags for an effect', () => {
  const me = pub({color: 'red', name: 'Ada', tags: {space: 3, jovian: 1, plant: 2, microbe: 3, building: 4, power: 2}});
  const w = hintWorldFromFull(model([me, pub({color: 'blue', name: 'Vera', tags: {space: 2}})]));
  it('Satellites counts your space tags and itself ("including this one")', () => {
    expect(texts(hand(w, 'Satellites'))).toEqual(['You have 3 space tags, 4 with this card: +4 M€ production']);
  });
  it('Terraforming Ganymede counts Jovian tags into TR, itself included', () => {
    expect(texts(hand(w, 'Terraforming Ganymede'))).toEqual(['You have 1 Jovian tag, 2 with this card: +2 TR']);
  });
  it('Insects: plant tags (Insects itself is a microbe, so no "with this card"), next to its oxygen requirement', () => {
    expect(texts(hand(w, 'Insects'))).toEqual(['Oxygen 6% min: now 3%', 'You have 2 plant tags: +2 plant production']);
    expect(hand(w, 'Insects')[0].tone).toBe('unmet');
  });
  it('Worms: 1 step for every 2 microbe tags, itself included, rounding down', () => {
    expect(texts(hand(w, 'Worms'))).toContain('You have 3 microbe tags, 4 with this card: +2 plant production');
  });
  it('Medical Lab and Power Grid', () => {
    expect(texts(hand(w, 'Medical Lab'))).toEqual(['You have 4 building tags, 5 with this card: +2 M€ production']);
    expect(texts(hand(w, 'Power Grid'))).toEqual(['You have 2 power tags, 3 with this card: +3 energy production']);
  });
});

describe('card hints: wild tags', () => {
  const me = pub({color: 'red', name: 'Ada', tags: {space: 2, science: 2, jovian: 1, wild: 1}});
  const ann = pub({color: 'green', name: 'Ann', tags: {space: 1, wild: 3}});
  const w = hintWorldFromFull(model([me, ann]));
  it('count as any tag for your own effects (engine Counter, default mode)', () => {
    expect(texts(hand(w, 'Satellites'))).toEqual(['You have 3 space tags including 1 wild, 4 with this card: +4 M€ production']);
  });
  it('count for "at least" tag requirements', () => {
    expect(hand(w, 'Gene Repair')).toMatchObject([{text: 'Requires 3 science tags: you have 3 including 1 wild', tone: 'met'}]);
  });
  it('do not count for victory points (engine counts VP tags raw)', () => {
    expect(texts(hand(w, 'Io Mining Industries'))).toEqual(['You have 1 Jovian tag, 2 with this card: 2 VP so far']);
  });
  it("opponents' wild tags never count for you (Toll Station)", () => {
    expect(texts(hand(w, 'Toll Station'))).toEqual(['Opponents have 1 space tag: +1 M€ production']);
  });
  it('"at most" tag requirements count face-up tags only', () => {
    const card = {...getCard('Gene Repair'), requirements: [{tag: 'science' as const, count: 2, max: true}]};
    expect(cardHints(card, w, {owner: 'red', place: 'hand'})[0]).toMatchObject({text: 'At most 2 science tags: you have 2', tone: 'met'});
  });
});

describe("card hints: opponents' tags", () => {
  it('Toll Station sums every opponent\'s space tags', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'Ada', tags: {space: 6}}), pub({color: 'blue', name: 'Vera', tags: {space: 2}}), pub({color: 'green', name: 'Ann', tags: {space: 3}})]));
    expect(texts(hand(w, 'Toll Station'))).toEqual(['Opponents have 5 space tags: +5 M€ production']);
  });
});

describe('card hints: events', () => {
  it('played events keep no tags: a played space event does not count for Satellites (companion state)', () => {
    const p = {id: 'a', name: 'Ada', corporation: null, tr: 20, stock: {megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0},
      production: {megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0}, played: [{name: 'Asteroid', resources: 0, generation: 1}, {name: 'Space Station', resources: 0, generation: 1}],
      tiles: {cityOnMars: 0, cityOffMars: 0, greenery: 0, special: 0, oceans: 0}} as unknown as PlayerState;
    const s = {players: [p], global: {temperature: -30, oxygen: 0, oceans: 0, venus: 0}} as unknown as GameState;
    const w = hintWorldFromCompanion(s, 'a');
    expect(texts(hand(w, 'Satellites'))).toEqual(['You have 1 space tag, 2 with this card: +2 M€ production']);
    expect(w.players[0].tags.event).toBe(1);
  });
  it('the same from an engine model without tag counts (tags rebuilt from the tableau)', () => {
    const me = {...pub({color: 'red', name: 'Ada', tableau: [{name: 'Asteroid'}, {name: 'Space Station'}]}), tags: undefined as unknown as []};
    const w = hintWorldFromFull(model([me]));
    expect(texts(hand(w, 'Satellites'))).toEqual(['You have 1 space tag, 2 with this card: +2 M€ production']);
  });
  it('an event in hand still counts its own tag while it is played, as the engine does', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'Ada', tags: {jovian: 2}})]));
    // Terraforming Ganymede is not an event, but the rule is the engine's: an unplayed card adds its own tags
    expect(texts(hand(w, 'Terraforming Ganymede'))).toEqual(['You have 2 Jovian tags, 3 with this card: +3 TR']);
  });
});

describe('card hints: cards on a table, from that player\'s side', () => {
  const vera = pub({color: 'blue', name: 'Vera', tags: {jovian: 2, animal: 1, science: 1, building: 1},
    tableau: [{name: 'Fish', resources: 5}, {name: 'Io Mining Industries'}, {name: 'Search For Life', resources: 1}, {name: 'Physics Complex', resources: 2}]});
  const w = hintWorldFromFull(model([pub({color: 'red', name: 'Ada', tags: {jovian: 5}}), vera]));
  it('VP per animal on the card (Fish: 1 VP per animal)', () => {
    const v = placeOf(w, 'Fish')!;
    expect(v).toEqual({owner: 'blue', place: 'table'});
    expect(texts(cardHints(getCard('Fish'), w, v))).toEqual(['5 animals here: 5 VP now']);
  });
  it('VP per Jovian tag for another player counts their tags, not mine, and no "with this card" once played', () => {
    expect(texts(hintsFor(w, getCard('Io Mining Industries')))).toEqual(['Vera has 2 Jovian tags: 2 VP now']);
  });
  it('Search For Life and Physics Complex', () => {
    expect(texts(hintsFor(w, getCard('Search For Life')))).toContain('1 science resource here: 3 VP now');
    expect(texts(hintsFor(w, getCard('Physics Complex')))).toEqual(['Its action spends 6 energy: Vera has 0', '2 science resources here: 4 VP now']);
  });
  it('per 2 rounds down (Herbivores)', () => {
    const w2 = hintWorldFromFull(model([pub({color: 'red', name: 'Ada', tableau: [{name: 'Herbivores', resources: 3}]})]));
    expect(texts(hintsFor(w2, getCard('Herbivores')))).toEqual(['3 animals here: 1 VP now']);
  });
});

describe('card hints: board counts', () => {
  // Tharsis: 30 is a land space; its neighbours are 21, 22, 29, 31, 38 and 39 (the engine's board data)
  const tiles = {
    '30': {tileType: 4, color: 'red' as Color}, // Commercial District
    '21': {tileType: 2, color: 'blue' as Color}, '22': {tileType: 2, color: 'red' as Color}, '31': {tileType: 1}, // two cities next to it
    '40': {tileType: 2, color: 'red' as Color},
    '01': {tileType: 2, color: 'blue' as Color}, // Phobos: a city in space
    '47': {tileType: 0, color: 'red' as Color},
  };
  const me = pub({color: 'red', name: 'Ada', tableau: [{name: 'Commercial District'}]});
  const w = hintWorldFromFull(model([me, pub({color: 'blue', name: 'Vera'})], {tiles, oxygen: 6}));
  it('counts cities on Mars and in space from the spaces', () => {
    expect(w.players[0].cities).toEqual({onMars: 2, offMars: 0});
    expect(w.players[1].cities).toEqual({onMars: 1, offMars: 1});
    expect(w.players[0].greeneries).toBe(1);
  });
  it('Zeppelins: cities on Mars, every player', () => {
    expect(texts(hand(w, 'Zeppelins'))).toEqual(['Oxygen 5% min: now 6%', '3 cities on Mars: +3 M€ production']);
  });
  it('Energy Saving: every city in play, Mars or not', () => {
    expect(texts(hand(w, 'Energy Saving'))).toEqual(['4 cities in play: +4 energy production']);
  });
  it('Commercial District: cities next to its tile, any owner', () => {
    expect(texts(hintsFor(w, getCard('Commercial District')))).toEqual(['2 cities next to it: 2 extra VP now']);
  });
  it('Capital: oceans next to it', () => {
    const w2 = hintWorldFromFull(model([pub({color: 'red', name: 'M', tableau: [{name: 'Capital'}]})], {tiles: {'30': {tileType: 3, color: 'red'}, '21': {tileType: 1}, '31': {tileType: 1}, '32': {tileType: 1}}}));
    expect(texts(hintsFor(w2, getCard('Capital')))).toEqual(['2 oceans next to it: 2 extra VP now']);
  });
  it('the hex geometry matches the engine adjacency on every board', () => {
    for (const [name, spaces] of Object.entries(boards as Record<string, Array<SpaceModel & {adjacent: string[]}>>)) {
      const cells = layout(spaces).cells;
      for (const c of cells) {
        const near = cells.filter((o) => o !== c && Math.hypot(o.cx - c.cx, o.cy - c.cy) < HEX_W * 1.05).map((o) => o.id).sort();
        const engine = spaces.find((s) => s.id === c.id)!.adjacent.filter((id) => cells.some((x) => x.id === id)).sort();
        expect(near, `${name} ${c.id}`).toEqual(engine);
      }
    }
  });
  it('Martian Rails: what its action gives now', () => {
    const w2 = hintWorldFromFull(model([pub({color: 'red', name: 'M', energy: 1, tableau: [{name: 'Martian Rails'}]})], {tiles}));
    expect(texts(hintsFor(w2, getCard('Martian Rails')))).toEqual(['Its action spends 1 energy: you have 1', '2 cities on Mars: its action gives 2 M€']);
  });
});

describe('card hints: requirements', () => {
  const me = pub({color: 'red', name: 'Ada', tags: {science: 3}, terraformRating: 25});
  const w = hintWorldFromFull(model([me], {oxygen: 5, temperature: -12, oceans: 3}));
  it('a maximum on oxygen, with the current value', () => {
    expect(hand(w, 'Colonizer Training Camp')).toMatchObject([{text: 'Oxygen 5% max: now 5%', tone: 'met'}]);
  });
  it('a science tag count that is not met yet', () => {
    expect(hand(w, 'Interstellar Colony Ship')).toMatchObject([{text: 'Requires 5 science tags: you have 3', tone: 'unmet'}]);
  });
  it('temperature and oceans', () => {
    expect(texts(hand(w, 'Artificial Lake'))).toEqual(['Requires −6 °C or warmer: now −12 °C']);
    expect(texts(hand(w, 'Algae'))).toEqual(['Requires 5 oceans: 3 placed']);
  });
  it('a requirement bonus in play is named when it makes the difference', () => {
    const w2 = hintWorldFromFull(model([pub({color: 'red', name: 'M', tableau: [{name: 'Adaptation Technology'}]})], {oxygen: 5}));
    expect(hand(w2, 'Breathing Filters')).toMatchObject([{text: 'Oxygen 7% min: now 5% (within your 2 steps of leeway)', tone: 'met'}]);
  });
  it('no requirement hints for a card already played', () => {
    const w2 = hintWorldFromFull(model([pub({color: 'red', name: 'M', tableau: [{name: 'Gene Repair'}]})]));
    expect(hintsFor(w2, getCard('Gene Repair'))).toEqual([]);
  });
});

describe('card hints: discounts, conditionals and hand-written entries', () => {
  it('Shuttles: the other cards in your hand with a space tag', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'M', tags: {}})], {hand: ['Shuttles', 'Asteroid', 'Satellites', 'Gene Repair'], oxygen: 5}));
    expect(texts(hand(w, 'Shuttles'))).toEqual(['Oxygen 5% min: now 5%', '2 other cards in your hand have a space tag']);
  });
  it('Nitrogen-Rich Asteroid: plant tags against the 3 needed', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'M', tags: {plant: 2}})]));
    expect(hand(w, 'Nitrogen-Rich Asteroid')).toMatchObject([{text: 'You have 2 plant tags (3 needed for +4 plant production): +1 plant production', tone: 'unmet'}]);
  });
  it('Saturn Systems (hand-written): Jovian tags in play', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'M', tags: {jovian: 1}}), pub({color: 'blue', name: 'B', tags: {jovian: 2}})]));
    expect(hand(w, 'Saturn Systems')).toMatchObject([{text: '3 Jovian tags in play so far', source: 'manual'}]);
  });
  it('Robotic Workforce (hand-written): building cards with a production box', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'M', tableau: [{name: 'Mine'}, {name: 'Space Elevator'}, {name: 'Research'}]})]));
    expect(texts(hand(w, 'Robotic Workforce'))).toEqual(['You have 2 building cards with a production box to copy']);
  });
  it('a plain card gets nothing', () => {
    const w = hintWorldFromFull(model([pub({color: 'red', name: 'M'})]));
    expect(hand(w, 'Asteroid')).toEqual([]);
  });
});
