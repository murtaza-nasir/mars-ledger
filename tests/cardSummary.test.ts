// Card text is never committed: the wording rules run on synthetic text, and the sweeps run on the fetched card data.
import {describe, expect, it} from 'vitest';
import {cardsFor, getCard} from '../src/shared/cards';
import type {CardDef} from '../src/shared/types';
import {cardSummary, reqChips, summaryParts, vpChip} from '../src/client/phone/full/cardSummary';

/** A real card's shape with invented wording. */
const card = (over: Partial<CardDef>): CardDef => ({...getCard('Lichen'), requirements: [], description: null, text: [], ...over});

describe('card row summaries', () => {
  it('a plain card says what it does, without the requirement sentence', () => {
    expect(cardSummary(card({description: 'Requires 2 ocean tiles. Gain 3 heat. Draw a card.'}))).toBe('Gain 3 heat. Draw a card.');
    expect(cardSummary(card({description: 'Oxygen must be 4% or less. Gain 1 steel'}))).toBe('Gain 1 steel.');
    expect(cardSummary(card({description: '(It must be -10 C or colder to play. Gain 5 M€.)'}))).toBe('Gain 5 M€.');
  });

  it('shouted words go to lower case, place names keep their capital', () => {
    expect(cardSummary(card({description: 'Place a city tile ON MARS.'}))).toBe('Place a city tile on Mars.');
  });

  it('an action or effect comes first, then what playing the card does', () => {
    const c = card({description: 'Gain 2 plants.', text: ['Effect: When you play a card, gain 1 heat.', 'Action: Spend 1 energy to draw a card.']});
    expect(summaryParts(c)).toEqual([
      {lead: 'Effect:', text: 'When you play a card, gain 1 heat.'},
      {lead: 'Action:', text: 'Spend 1 energy to draw a card.'},
      {lead: null, text: 'Gain 2 plants.'},
    ]);
  });

  it('a requirement that also costs something keeps the cost', () => {
    expect(cardSummary(card({description: 'Requires 2 ocean tiles and that you lose 3 plants. Gain 4 M€.'}))).toBe('Lose 3 plants. Gain 4 M€.');
    expect(cardSummary(card({description: 'Requires 2 ocean tiles and that you have 3 plants. Gain 4 M€.'}))).toBe('Gain 4 M€.');
  });

  it('a sentence on the card twice shows once, and an icon caption not at all', () => {
    expect(cardSummary(card({description: 'Gain 2 heat.', text: ['Gain 2 heat.', 'Global requirements +/- 2']}))).toBe('Gain 2 heat.');
  });

  it('every real card: no requirement sentence, no icon caption, no shouted phrase', () => {
    const all = cardsFor(['base', 'corpera', 'prelude']);
    expect(all.length).toBeGreaterThan(200);
    for (const c of all) {
      const s = cardSummary(c);
      expect(s, c.name).not.toMatch(/^Requires\b|\. Requires\b|must be .* (or|to play)|Global requirements\.|\+\/- ?2\./);
      expect(s, c.name).not.toMatch(/\b[A-Z]{3,} [A-Z]{2,}\b/);
    }
  });

  it('every real card with text gets a summary, and blue cards lead with the action or effect', () => {
    for (const c of cardsFor(['base', 'corpera'])) {
      const parts = summaryParts(c);
      if (c.text.some((t) => /^(Action|Effect)\s*:/i.test(t.trim()))) expect(parts[0]?.lead, c.name).toMatch(/^(Action|Effect):$/);
    }
  });

  it('requirements and fixed points become chips', () => {
    expect(reqChips(card({requirements: [{oceans: 4}]}))).toEqual([{kind: 'text', text: '4 oceans'}]);
    expect(reqChips(card({requirements: [{temperature: -12, max: true}]}))).toEqual([{kind: 'text', text: 'max −12°C'}]);
    expect(reqChips(card({requirements: [{temperature: 2}]}))).toEqual([{kind: 'text', text: '+2°C'}]);
    expect(reqChips(card({requirements: [{oxygen: 13}]}))).toEqual([{kind: 'text', text: '13% O₂'}]);
    expect(vpChip(card({victoryPoints: -2}))).toBe('−2 VP');
    expect(vpChip(card({victoryPoints: 2}))).toBe('2 VP');
    expect(vpChip(card({victoryPoints: undefined}))).toBeNull();
  });
});
