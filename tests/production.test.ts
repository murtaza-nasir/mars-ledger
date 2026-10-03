import {describe, expect, it} from 'vitest';
import type {PublicPlayerModel} from '../src/shared/full';
import {productionIncome, tokenValues} from '../src/shared/production';

function player(over: Partial<PublicPlayerModel>): PublicPlayerModel {
  return {
    color: 'red', name: 'A', isActive: false, terraformRating: 20,
    megacredits: 0, megacreditProduction: 0, steel: 0, steelProduction: 0, steelValue: 2, titanium: 0, titaniumProduction: 0, titaniumValue: 3,
    plants: 0, plantProduction: 0, energy: 0, energyProduction: 0, heat: 0, heatProduction: 0,
    cardsInHandNbr: 0, citiesCount: 0, tableau: [], tags: [], actionsThisGeneration: [], actionsTakenThisRound: 0, availableBlueCardActionCount: 0,
    ...over,
  };
}

describe('production income', () => {
  it('pays M€ production plus TR', () => {
    const inc = productionIncome(player({megacredits: 7, megacreditProduction: 3, terraformRating: 24}));
    expect(inc.gains.megacredits).toBe(27);
    expect(inc.after.megacredits).toBe(34);
  });

  it('handles negative M€ production', () => {
    const inc = productionIncome(player({megacredits: 2, megacreditProduction: -4, terraformRating: 20}));
    expect(inc.gains.megacredits).toBe(16);
    expect(inc.after.megacredits).toBe(18);
  });

  it('turns energy on hand into heat before adding production', () => {
    const inc = productionIncome(player({energy: 5, energyProduction: 3, heat: 2, heatProduction: 1}));
    expect(inc.energyToHeat).toBe(5);
    expect(inc.gains.heat).toBe(6);
    expect(inc.after.heat).toBe(8);
    expect(inc.gains.energy).toBe(3);
    expect(inc.after.energy).toBe(3);
  });

  it('passes the other productions straight through', () => {
    const inc = productionIncome(player({steel: 1, steelProduction: 2, titanium: 4, titaniumProduction: 1, plants: 6, plantProduction: 3}));
    expect(inc.after).toMatchObject({steel: 3, titanium: 5, plants: 9});
    expect(inc.before).toMatchObject({steel: 1, titanium: 4, plants: 6});
  });
});

describe('token values', () => {
  it('sums exactly to the amount and respects the cap', () => {
    for (const [amount, max] of [[1, 16], [7, 16], [16, 16], [31, 16], [100, 14], [5, 3]]) {
      const v = tokenValues(amount, max);
      expect(v.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(v.length).toBeLessThanOrEqual(max);
    }
  });
  it('makes no tokens for nothing', () => {
    expect(tokenValues(0, 10)).toEqual([]);
    expect(tokenValues(-3, 10)).toEqual([]);
  });
});
