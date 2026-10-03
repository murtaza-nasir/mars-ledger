import {describe, expect, it} from 'vitest';
import type {PublicPlayerModel} from '../src/shared/full';
import {chipName, focusAfter, otherActionNote, othersFrom, tableSignature, tableTitle} from '../src/client/phone/full/tableFocus';

const P = (color: string, name: string, extra: Partial<PublicPlayerModel> = {}) => ({
  color, name, isActive: false, terraformRating: 20, megacredits: 0, megacreditProduction: 0, steel: 0, steelProduction: 0, steelValue: 2,
  titanium: 0, titaniumProduction: 0, titaniumValue: 3, plants: 0, plantProduction: 0, energy: 0, energyProduction: 0, heat: 0, heatProduction: 0,
  cardsInHandNbr: 3, citiesCount: 0, tableau: [], tags: [], actionsThisGeneration: [], actionsTakenThisRound: 0, availableBlueCardActionCount: 0, ...extra,
}) as PublicPlayerModel;

describe('other players\' tables on the phone', () => {
  it('names whose table it is', () => {
    expect(tableTitle('Kepler')).toBe("Kepler's table");
    expect(tableTitle('  ')).toBe("Player's table");
  });

  it('lists the others from the player after me, in seat order', () => {
    const ps = ['red', 'green', 'blue', 'yellow', 'black'].map((c) => P(c, c));
    expect(othersFrom(ps, 'blue').map((p) => p.color)).toEqual(['yellow', 'black', 'red', 'green']);
    expect(othersFrom(ps.slice(0, 2), 'red').map((p) => p.color)).toEqual(['green']);
  });

  it('shortens chip names', () => {
    expect(chipName('Kepler Okafor')).toBe('Kepler');
    expect(chipName('Maximiliana')).toBe('Maximili…');
  });

  it('goes back to my table on leaving the tab, on my turn, or when the player is gone', () => {
    const colors = ['red', 'green'] as const;
    const base = {tableShown: true, turnStarted: false, colors: [...colors]};
    expect(focusAfter('green', base)).toBe('green');
    expect(focusAfter('green', {...base, tableShown: false})).toBeNull();
    expect(focusAfter('green', {...base, turnStarted: true})).toBeNull();
    expect(focusAfter('blue', base)).toBeNull();
    expect(focusAfter(null, base)).toBeNull();
  });

  it('never offers to use another player\'s action', () => {
    expect(otherActionNote(true)).toBe('Action used this generation');
    expect(otherActionNote(false)).toBe('Action ready');
    expect(otherActionNote(false)).not.toMatch(/use/i);
  });

  it('changes signature only when something shown changes', () => {
    const a = P('red', 'A', {tableau: [{name: 'Birds', resources: 1} as never]});
    expect(tableSignature(a)).toBe(tableSignature({...a, actionsTakenThisRound: 2}));
    expect(tableSignature(a)).not.toBe(tableSignature({...a, tableau: [{name: 'Birds', resources: 2} as never]}));
    expect(tableSignature(a)).not.toBe(tableSignature({...a, actionsThisGeneration: ['Birds']}));
    expect(tableSignature(a)).not.toBe(tableSignature({...a, plants: 4}));
  });
});
