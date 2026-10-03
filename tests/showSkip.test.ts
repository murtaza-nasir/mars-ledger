// The production show is built from the model before production. When the server fetched nothing for a while (no
// screen connected) and the engine moved on by more than a generation, that model is old: no show, no stale recap.
import {describe, expect, it} from 'vitest';
import {newGame} from '../src/shared/engine';
import type {GameState} from '../src/shared/game';
import type {SpectatorModel} from '../src/shared/full';
import type {ServerMsg} from '../src/shared/protocol';
import type {EngineClient} from '../src/server/full/engine';
import {FullBridge} from '../src/server/full/bridge';

function table(): GameState {
  const s = newGame('g');
  return {...s, mode: 'full', phase: 'full' as GameState['phase'], players: [{id: 'a', name: 'Ana', color: 'red'}] as GameState['players'],
    full: {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red'}}}} as GameState;
}

describe('production show after a gap', () => {
  it('shows one generation advancing, never a jump of several', async () => {
    const gens = [1, 3, 4];
    let i = 0;
    const spec = (generation: number, age: number) => ({id: 's1', color: 'neutral', game: {gameAge: age, undoCount: 0, generation, phase: 'action'},
      players: [{color: 'red', name: 'Ana', megacredits: 10, megacreditProduction: 2, terraformRating: 20, steel: 0, steelProduction: 0, titanium: 0,
        titaniumProduction: 0, plants: 0, plantProduction: 0, energy: 0, energyProduction: 0, heat: 0, heatProduction: 0}]}) as unknown as SpectatorModel;
    const e = {spectator: async () => spec(gens[i], 10 + i), player: async () => null, logs: async () => []} as unknown as EngineClient;
    const tv = {name: 'tv', readyState: 1};
    const sent: ServerMsg[] = [];
    const b = new FullBridge(e, table, () => [tv] as never, (_ws, msg) => sent.push(msg), 60000, null, 60000);
    b.stop();
    b.hello(tv as never, {role: 'tv', playerId: null});
    await b.pushAll();
    i = 1; await b.pushAll(); // 1 -> 3: nobody watched generation 2
    expect(sent.filter((m) => m.type === 'production')).toEqual([]);
    i = 2; await b.pushAll(); // 3 -> 4: production paid out for generation 3
    const shows = sent.filter((m) => m.type === 'production') as Array<Extract<ServerMsg, {type: 'production'}>>;
    expect(shows.map((m) => [m.show.id, m.show.generation])).toEqual([['e1:g3', 4]]);
  });
});
