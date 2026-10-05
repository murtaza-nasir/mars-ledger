// "Confirm card purchases": which card questions ask before they are sent, and what they say.
import {describe, expect, it} from 'vitest';
import {buyQuestion, confirmFor, keepQuestion} from '../src/shared/confirmBuy';

const RESEARCH = 'Select which cards to buy';
const DRAFT = 'Select a card to keep and pass the rest to the next player';

describe('confirming card purchases', () => {
  it('asks nothing while the setting is off', () => {
    expect(confirmFor(false, RESEARCH, ['A', 'B'], false, 40)).toBeNull();
    expect(confirmFor(false, DRAFT, ['A'], true)).toBeNull();
  });

  it('research with cards ticked asks "Buy 3 cards for 9 M€?" and says what is left', () => {
    expect(confirmFor(true, RESEARCH, ['A', 'B', 'C'], false, 40)).toEqual({question: 'Buy 3 cards for 9 M€?', detail: 'You will have 31 M€ left.'});
  });

  it('one card is singular, and skipping everything asks "Buy nothing?"', () => {
    expect(buyQuestion(1, 3)).toBe('Buy 1 card for 3 M€?');
    expect(confirmFor(true, RESEARCH, [], false, 40)).toEqual({question: 'Buy nothing?', detail: undefined});
  });

  it('the initial buy asks the same way', () => {
    expect(confirmFor(true, 'Select initial cards to buy', ['A', 'B'], false, 30)?.question).toBe('Buy 2 cards for 6 M€?');
  });

  it('a draft pick asks to keep the card, once the card is ticked', () => {
    expect(confirmFor(true, DRAFT, ['Birds'], true)).toEqual({question: keepQuestion('Birds')});
    expect(keepQuestion('Birds')).toBe('Keep Birds and pass the rest?');
    expect(confirmFor(true, DRAFT, [], true)).toBeNull();
  });

  it('other card questions are never confirmed (corporation, prelude, card actions, projects)', () => {
    expect(confirmFor(true, 'Select corporation card', ['Helion'], true)).toBeNull();
    expect(confirmFor(true, 'Select prelude card to play', ['Donation'], true)).toBeNull();
    expect(confirmFor(true, 'Perform an action from a played card', ['Birds'], true)).toBeNull();
  });
});
