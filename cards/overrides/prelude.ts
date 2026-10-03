// Hand-written rules for Prelude cards whose engine implementation is code rather than data.
// Preludes with a printed M€ cost ("Pay 5 M€") carry a negative startingMegaCredits in the engine and are
// paid through `spend` here, before the rest of the card resolves (as the engine's SelectPayment does).
import type {CardDef} from '../../src/shared/types';

const overrides: Record<string, Partial<CardDef>> = {
  // ---- preludes that cost M€ ---------------------------------------------------------------------
  'Aquifer Turbines': {behavior: {spend: {megacredits: 3}, production: {energy: 2}, ocean: {}}},
  'Business Empire': {behavior: {spend: {megacredits: 6}, production: {megacredits: 6}}},
  'Galilean Mining': {behavior: {spend: {megacredits: 5}, production: {titanium: 2}}},
  'Huge Asteroid': {behavior: {spend: {megacredits: 5}, global: {temperature: 3}}},

  // ---- preludes that play a project card straight away ------------------------------------------
  // The card is played with the normal Play card flow while the prelude phase waits for it.
  'Eccentric Sponsor': {
    behavior: {nextCardDiscount: 25, playCardNow: 'Play a card from your hand; it costs 25 M€ less.'},
    description: 'Play a card from your hand, reducing its cost by 25 M€.',
  },
  'Ecology Experts': {
    behavior: {production: {plants: 1}, nextCardRequirementBonus: 50,
      playCardNow: 'Play a card from your hand, ignoring global requirements.'},
    description: 'Increase your plant production 1 step. Play a card from your hand, ignoring global requirements.',
  },

  // ---- prelude-module corporations ------------------------------------------------------------
  'Cheung Shing MARS': {cardDiscount: [{tag: 'building', amount: 2}]},
  'Point Luna': {
    // "When you play an Earth tag, including this, draw a card": this corporation's own tag draws at setup.
    behavior: {production: {titanium: 1}, drawCard: 1},
    triggers: [{when: 'cardPlayed', scope: 'self', tags: ['earth'], perTag: true, behavior: {drawCard: 1},
      text: 'Earth tag, draw a card'}],
  },
  'Robinson Industries': {
    action: {spend: {megacredits: 4}, raiseLowestProduction: true},
  },
  'Valley Trust': {
    firstAction: {playPrelude: true},
  },
  'Vitor': {
    firstAction: {fundAwardFree: true},
    triggers: [{when: 'cardPlayed', scope: 'self', hasVictoryPoints: true, behavior: {stock: {megacredits: 3}},
      text: 'card with victory points, gain 3 M€'}],
  },

  // ---- prelude-module project cards -----------------------------------------------------------
  'Psychrophiles': {
    // "When paying for a plant card, microbes here may be used as 2 M€ each."
    payWithResources: {tag: 'plant', value: 2},
  },
  'Lava Tube Settlement': {
    behavior: {production: {energy: -1, megacredits: 2}, city: {on: 'volcanic'}},
  },
};

export default overrides;
