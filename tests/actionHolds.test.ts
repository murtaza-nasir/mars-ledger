// The TV panel cells wait for an action's gains to land, and every hold lets go by its deadline.
import {describe, expect, it} from 'vitest';
import type {PublicPlayerModel, SpectatorModel} from '../src/shared/full';
import {ACTION_HOLD_MS, heldOffsets, heldPanel, holdKey, holdsFor, landHold, tokenShare, useActionHolds} from '../src/client/tv/full/actionHolds';
import spectator from './fixtures/full/spectator.json';

const base = spectator as unknown as SpectatorModel;
function player(patch: Partial<PublicPlayerModel> = {}): PublicPlayerModel {
  return {...structuredClone(base.players[0]), color: 'red', megacredits: 27, plants: 3, energyProduction: 2, megacreditProduction: -1, ...patch} as PublicPlayerModel;
}
const T0 = 1_000_000;
const moment = (k: string, flights: Array<{r: 'megacredits' | 'plants' | 'energy'; n: number; prod: boolean}>) => ({k, color: 'red', flights});

describe('action holds', () => {
  it('holds each flight back from its cell until the deadline', () => {
    const holds = holdsFor([moment('m1', [{r: 'megacredits', n: 7, prod: false}, {r: 'energy', n: 1, prod: true}])], T0);
    expect(holds.map((h) => h.until)).toEqual([T0 + ACTION_HOLD_MS, T0 + ACTION_HOLD_MS]);
    expect(heldOffsets(holds, 'red', T0 + 100)).toEqual({stock: {megacredits: 7}, prod: {energy: 1}});
    expect(heldOffsets(holds, 'blue', T0 + 100)).toEqual({stock: {}, prod: {}});
    // the deadline holds however late a render comes, landed or not
    expect(heldOffsets(holds, 'red', T0 + ACTION_HOLD_MS)).toEqual({stock: {}, prod: {}});
    expect(heldOffsets(holds, 'red', T0 + 60_000)).toEqual({stock: {}, prod: {}});
  });

  it('gives the number back token by token as the flights land', () => {
    const shares = [0, 1, 2, 3].map((i) => tokenShare(7, 4, i));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(7);
    expect(shares.every((x) => x >= 1)).toBe(true);
    expect([0, 1, 2, 3].map((i) => tokenShare(2, 4, i)).reduce((a, b) => a + b, 0)).toBe(2);
    let holds = holdsFor([moment('m1', [{r: 'megacredits', n: 7, prod: false}])], T0);
    const key = holdKey('m1', {r: 'megacredits', prod: false});
    const p = player({megacredits: 34});
    const seen: number[] = [heldPanel(holds, p, T0).amounts!.megacredits];
    for (const s of shares) {
      holds = landHold(holds, key, s);
      seen.push(heldPanel(holds, p, T0).amounts?.megacredits ?? p.megacredits);
    }
    expect(seen).toEqual([27, 28, 30, 32, 34]);
    expect(holds).toEqual([]);
  });

  it('takes the gain off the latest view, so other changes meanwhile still show', () => {
    const holds = holdsFor([moment('m1', [{r: 'plants', n: 2, prod: false}, {r: 'energy', n: 1, prod: true}])], T0);
    // the player spent M€ and gained a plant elsewhere after the action
    const after = heldPanel(holds, player({megacredits: 20, plants: 6, energyProduction: 3}), T0 + 50);
    expect(after.amounts).toMatchObject({megacredits: 20, plants: 4});
    expect(after.prod).toEqual({energy: 2});
    // never below zero
    expect(heldPanel(holds, player({plants: 1}), T0).amounts!.plants).toBe(0);
    expect(heldPanel([], player(), T0)).toEqual({});
  });

  it('adds up two actions into the same cell, and releases by moment', () => {
    const holds = holdsFor([moment('a', [{r: 'megacredits', n: 3, prod: false}]), moment('b', [{r: 'megacredits', n: 4, prod: false}])], T0);
    expect(heldOffsets(holds, 'red', T0).stock.megacredits).toBe(7);
    const s = useActionHolds.getState();
    s.clear();
    s.add(holdsFor([moment('a', [{r: 'megacredits', n: 3, prod: false}])], Date.now()));
    s.add(holdsFor([moment('b', [{r: 'megacredits', n: 4, prod: false}])], Date.now()));
    expect(useActionHolds.getState().holds).toHaveLength(2);
    useActionHolds.getState().release((h) => h.moment === 'a');
    expect(useActionHolds.getState().holds.map((h) => h.moment)).toEqual(['b']);
    useActionHolds.getState().land(holdKey('b', {r: 'megacredits', prod: false}), 4);
    expect(useActionHolds.getState().holds).toEqual([]);
  });

  it('drops expired holds when new ones arrive, and skips empty flights', () => {
    const s = useActionHolds.getState();
    s.clear();
    s.add(holdsFor([moment('old', [{r: 'plants', n: 1, prod: false}])], Date.now() - ACTION_HOLD_MS - 1));
    s.add(holdsFor([moment('new', [{r: 'plants', n: 1, prod: false}, {r: 'energy', n: 0, prod: false}])], Date.now()));
    expect(useActionHolds.getState().holds.map((h) => h.key)).toEqual(['new:plants:stock']);
    s.clear();
  });
});
