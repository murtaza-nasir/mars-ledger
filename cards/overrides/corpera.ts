// Hand-written rules for Corporate Era cards whose engine implementation is code rather than data.
import type {CardDef} from '../../src/shared/types';

const overrides: Record<string, Partial<CardDef>> = {
  // ---- attacks on another player -------------------------------------------------------------
  'Asteroid Mining Consortium': {
    behavior: {decreaseAnyProduction: {type: 'titanium', count: 1}, production: {titanium: 1}},
  },
  'Energy Tapping': {behavior: {decreaseAnyProduction: {type: 'energy', count: 1}, production: {energy: 1}}},
  'Great Escarpment Consortium': {
    behavior: {decreaseAnyProduction: {type: 'steel', count: 1}, production: {steel: 1}},
  },
  'Hackers': {
    behavior: {production: {energy: -1, megacredits: 2}, decreaseAnyProduction: {type: 'megacredits', count: 2}},
  },
  'Hired Raiders': {
    behavior: {or: {title: 'Hired Raiders', behaviors: [
      {title: 'Steal up to 2 steel', steal: {type: 'steel', count: 2}},
      {title: 'Steal up to 3 M€', steal: {type: 'megacredits', count: 3}},
    ]}},
  },
  'Power Supply Consortium': {
    behavior: {decreaseAnyProduction: {type: 'energy', count: 1}, production: {energy: 1}},
  },
  'Sabotage': {
    behavior: {or: {title: 'Sabotage', behaviors: [
      {title: 'Remove up to 3 titanium', removeAnyStock: {type: 'titanium', count: 3}},
      {title: 'Remove up to 4 steel', removeAnyStock: {type: 'steel', count: 4}},
      {title: 'Remove up to 7 M€', removeAnyStock: {type: 'megacredits', count: 7}},
    ]}},
  },
  'Virus': {
    behavior: {or: {title: 'Virus', behaviors: [
      {title: 'Remove up to 2 animals from any card', removeResourcesFromAnyCard: {type: 'Animal', count: 2, source: 'all', upTo: true}},
      {title: 'Remove up to 5 plants from any player', removeAnyPlants: 5},
    ]}},
  },

  // ---- triggers -------------------------------------------------------------------------------
  'Mars University': {
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['science'], perTag: true, behavior: {},
      text: 'you may discard a card to draw a card'}],
  },
  'Media Group': {
    triggers: [{when: 'cardPlayed', scope: 'self', cardType: 'event', behavior: {stock: {megacredits: 3}},
      text: 'you played an event, gain 3 M€'}],
  },
  'Olympus Conference': {
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['science'], perTag: true,
      behavior: {or: {title: 'Olympus Conference', behaviors: [
        {title: 'Add a science resource here', addResources: 1},
        {title: 'Remove a science resource to draw a card', spend: {resourcesHere: 1}, drawCard: 1},
      ]}},
      text: 'you played a science tag'}],
  },
  'Standard Technology': {
    triggers: [{when: 'standardProject', scope: 'self', standardProjectExcludes: ['sellPatents'],
      behavior: {stock: {megacredits: 3}}, text: 'you used a standard project, gain 3 M€'}],
  },
  'Viral Enhancers': {
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['plant', 'microbe', 'animal'], perTag: true,
      behavior: {or: {title: 'Viral Enhancers', behaviors: [
        {title: 'Gain 1 plant', stock: {plants: 1}},
        {title: 'Add 1 resource to the card you played', addResourcesToTriggerCard: 1},
      ]}},
      text: 'you played a plant, microbe or animal tag'}],
  },
  'Saturn Systems': {
    triggers: [{when: 'cardPlayed', scope: 'any', tags: ['jovian'], perTag: true, behavior: {production: {megacredits: 1}},
      text: 'a Jovian tag was played, +1 M€ production'}],
  },

  // ---- play effects -----------------------------------------------------------------------------
  'Indentured Workers': {behavior: {nextCardDiscount: 8}},
  'Industrial Center': {
    behavior: {tile: {type: 'industrial center', on: 'next to a city', title: 'Industrial Center (next to a city)'}},
  },
  'Land Claim': {behavior: {}, text: ['Place your player marker on a non-reserved area. Only you may place a tile there.'],
    automation: 'full'},
  'Mining Area': {
    behavior: {
      tile: {type: 'mining area', on: 'steel or titanium bonus', title: 'Mining Area (steel or titanium bonus, next to your tile)'},
      or: {title: 'Which bonus is under the tile?', behaviors: [
        {title: 'Steel: +1 steel production', production: {steel: 1}},
        {title: 'Titanium: +1 titanium production', production: {titanium: 1}},
      ]},
    },
  },
  'Robotic Workforce': {behavior: {copyProductionBox: {tag: 'building'}}},
  'Terraforming Ganymede': {behavior: {tr: {tag: 'jovian'}}},
  'Commercial District': {boardVP: '1 VP per city next to Commercial District', automation: 'partial'},

  // ---- actions and modifiers --------------------------------------------------------------------
  'Power Infrastructure': {action: {exchangeStock: {from: 'energy', to: 'megacredits'}}},
  'Protected Habitats': {protects: 'plantsAnimalsMicrobes'},
};

export default overrides;
