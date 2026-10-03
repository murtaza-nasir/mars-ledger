// Hand-written rules for base-game cards whose engine implementation is code rather than data.
// Each entry is merged over the extracted card (tools/build-cards.ts). Tile positions and adjacency
// live on the physical board: the tile prompt collects placement bonuses, everything else is automatic.
import type {CardDef} from '../../src/shared/types';

const overrides: Record<string, Partial<CardDef>> = {
  // ---- triggers ----------------------------------------------------------------------------
  'Arctic Algae': {
    triggers: [{when: 'tilePlaced', scope: 'any', tile: 'ocean', behavior: {stock: {plants: 2}},
      text: 'an ocean was placed, gain 2 plants'}],
  },
  'Decomposers': {
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['animal', 'plant', 'microbe'], perTag: true,
      behavior: {addResources: 1}, text: 'add a microbe for each animal, plant or microbe tag'}],
  },
  'Ecological Zone': {
    behavior: {tile: {type: 'ecological zone', on: 'adjacent to greenery', title: 'Ecological Zone (next to any greenery)'}},
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['animal', 'plant'], perTag: true,
      behavior: {addResources: 1}, text: 'add an animal for each animal or plant tag'}],
  },
  'Herbivores': {
    triggers: [{when: 'tilePlaced', scope: 'self', tile: 'greenery', behavior: {addResources: 1},
      text: 'you placed a greenery, add an animal'}],
  },
  'Immigrant City': {
    behavior: {production: {energy: -1, megacredits: -2}, city: {}},
    triggers: [{when: 'tilePlaced', scope: 'any', tile: 'city', behavior: {production: {megacredits: 1}},
      text: 'a city was placed, +1 M€ production'}],
  },
  'Optimal Aerobraking': {
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['space'], cardType: 'event',
      behavior: {stock: {megacredits: 3, heat: 3}}, text: 'you played a space event, gain 3 M€ and 3 heat'}],
  },
  'Pets': {
    protects: 'thisCard',
    triggers: [{when: 'tilePlaced', scope: 'any', tile: 'city', behavior: {addResources: 1},
      text: 'a city was placed, add an animal'}],
  },
  'Rover Construction': {
    triggers: [{when: 'tilePlaced', scope: 'any', tile: 'city', behavior: {stock: {megacredits: 2}},
      text: 'a city was placed, gain 2 M€'}],
  },

  // ---- play effects ------------------------------------------------------------------------
  'Artificial Lake': {automation: 'full'},
  'Flooding': {
    behavior: {ocean: {}, removeAnyStock: {type: 'megacredits', count: 4}},
    text: ['You may remove 4 M€ from the owner of a tile next to the new ocean.'],
  },
  'Imported Hydrogen': {
    behavior: {
      or: {title: 'Imported Hydrogen', behaviors: [
        {title: 'Gain 3 plants', stock: {plants: 3}},
        {title: 'Add 3 microbes to another card', addResourcesToAnyCard: {count: 3, type: 'Microbe'}},
        {title: 'Add 2 animals to another card', addResourcesToAnyCard: {count: 2, type: 'Animal'}},
      ]},
      ocean: {},
    },
  },
  'Insulation': {behavior: {exchangeProduction: {from: 'heat', to: 'megacredits'}}},
  'Large Convoy': {
    behavior: {
      drawCard: 2,
      ocean: {},
      or: {title: 'Large Convoy', behaviors: [
        {title: 'Gain 5 plants', stock: {plants: 5}},
        {title: 'Add 4 animals to another card', addResourcesToAnyCard: {count: 4, type: 'Animal'}},
      ]},
    },
  },
  'Local Heat Trapping': {
    behavior: {
      spend: {heat: 5},
      or: {title: 'Local Heat Trapping', behaviors: [
        {title: 'Gain 4 plants', stock: {plants: 4}},
        {title: 'Add 2 animals to another card', addResourcesToAnyCard: {count: 2, type: 'Animal'}},
      ]},
    },
  },
  'Mining Rights': {
    behavior: {
      tile: {type: 'mining rights', on: 'steel or titanium bonus', title: 'Mining Rights (on a steel or titanium bonus)'},
      or: {title: 'Which bonus is under the tile?', behaviors: [
        {title: 'Steel: +1 steel production', production: {steel: 1}},
        {title: 'Titanium: +1 titanium production', production: {titanium: 1}},
      ]},
    },
  },
  'Moss': {behavior: {stock: {plants: -1}, production: {plants: 1}}},
  'Nitrogen-Rich Asteroid': {
    behavior: {
      tr: 2,
      global: {temperature: 1},
      conditional: {tag: 'plant', atLeast: 3, then: {production: {plants: 4}}, else: {production: {plants: 1}}},
    },
  },
  'Nitrophilic Moss': {behavior: {stock: {plants: -2}, production: {plants: 2}}},
  'Noctis City': {behavior: {production: {energy: -1, megacredits: 3}, city: {}}},
  'Urbanized Area': {behavior: {production: {energy: -1, megacredits: 2}, city: {}}},
  'Water Splitting Plant': {automation: 'full'},
  'Capital': {
    // Capital is a city tile: it counts for Mayor and fires city triggers.
    behavior: {production: {energy: -2, megacredits: 5}, city: {}},
    boardVP: '1 VP per ocean next to Capital',
    automation: 'partial',
  },

  // ---- actions -----------------------------------------------------------------------------
  'Extreme-Cold Fungus': {
    action: {or: {title: 'Extreme-Cold Fungus', behaviors: [
      {title: 'Gain 1 plant', stock: {plants: 1}},
      {title: 'Add 2 microbes to another card', addResourcesToAnyCard: {count: 2, type: 'Microbe'}},
    ]}},
  },
  'Search For Life': {
    victoryPoints: {resourcesHere: {}, ifAny: 3},
    action: {
      spend: {megacredits: 1},
      optional: {title: 'Reveal the top card of the deck. Does it have a microbe tag?', behavior: {addResources: 1}},
    },
  },

  // ---- ongoing modifiers -------------------------------------------------------------------
  'Adaptation Technology': {requirementBonus: 2},
  'Special Design': {behavior: {nextCardRequirementBonus: 2}},

  // ---- corporations ------------------------------------------------------------------------
  'CrediCor': {
    triggers: [
      {when: 'cardPlayed', scope: 'self', minCost: 20, behavior: {stock: {megacredits: 4}},
        text: 'you played a card costing 20 M€ or more, gain 4 M€'},
      {when: 'standardProject', scope: 'self', minCost: 20, behavior: {stock: {megacredits: 4}},
        text: 'you used a standard project costing 20 M€ or more, gain 4 M€'},
    ],
  },
  'Helion': {heatAsMC: true},
  'Interplanetary Cinematics': {
    triggers: [{when: 'cardPlayed', scope: 'self', cardType: 'event', behavior: {stock: {megacredits: 2}},
      text: 'you played an event, gain 2 M€'}],
  },
  'Inventrix': {requirementBonus: 2},
  'Mining Guild': {
    triggers: [{when: 'tilePlaced', scope: 'self', bonusSteelOrTitanium: true, behavior: {production: {steel: 1}},
      text: 'steel or titanium placement bonus, +1 steel production'}],
  },
  'Tharsis Republic': {
    triggers: [
      {when: 'tilePlaced', scope: 'any', tile: 'city', tileOnMars: true, behavior: {production: {megacredits: 1}},
        text: 'a city was placed on Mars, +1 M€ production'},
      {when: 'tilePlaced', scope: 'self', tile: 'city', behavior: {stock: {megacredits: 3}},
        text: 'you placed a city, gain 3 M€'},
    ],
  },
  'ThorGate': {standardProjectDiscount: [{project: 'powerPlant', amount: 3}]},
  'United Nations Mars Initiative': {
    action: {requires: 'trRaisedThisGeneration', spend: {megacredits: 3}, tr: 1},
  },
};

export default overrides;
