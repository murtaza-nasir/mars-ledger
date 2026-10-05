// Who played what, read from consecutive spectator models on the TV (diff.ts, pipeline/sequence.ts, actions.ts,
// shared/attack.ts), and which flick the TV shows (table/flicks.ts). The cases: two players moving within one update
// (quick bots), a card played and an action used together, events, a corporation's effect, and undo / "Back".
import {describe, expect, it} from 'vitest';
import type {Color, SpectatorModel} from '../src/shared/full';
import {TILE} from '../src/shared/full';
import {diffModels} from '../src/client/tv/full/diff';
import {sequencedBy} from '../src/client/tv/full/pipeline/sequence';
import {ActionWatcher, newActions} from '../src/client/tv/full/actions';
import {actorsBetween, detectAttack} from '../src/shared/attack';
import {FLICK_STALE_MS, nextFlick} from '../src/client/tv/table/flickQueue';
import spectator from './fixtures/full/spectator.json';

const base = spectator as unknown as SpectatorModel;

/** A two-player model in the action phase of generation 11: red (Orin) and blue (Juno), red to move. */
function start(): SpectatorModel {
  const m = structuredClone(base);
  m.game.phase = 'action';
  m.game.generation = 11;
  m.game.gameAge = 400;
  m.game.undoCount = 0;
  const [r, b] = m.players;
  r.name = 'Orin'; b.name = 'Juno';
  r.isActive = true; b.isActive = false;
  r.tableau = [{name: 'Tharsis Republic'}, {name: 'Birds', resources: 2}, {name: 'Mine'}];
  b.tableau = [{name: 'Inventrix'}, {name: 'Tardigrades', resources: 1}];
  r.actionsThisGeneration = []; b.actionsThisGeneration = [];
  r.megacredits = 40; b.megacredits = 50;
  r.plants = 6; b.plants = 5;
  return m;
}
/** The next model: one step on (gameAge up unless `age` says otherwise). */
function step(m: SpectatorModel, patch: (n: SpectatorModel) => void, age = m.game.gameAge + 3): SpectatorModel {
  const n = structuredClone(m);
  n.game.gameAge = age;
  patch(n);
  return n;
}
const P = (m: SpectatorModel, c: Color) => m.players.find((p) => p.color === c)!;
const cards = (ev: ReturnType<typeof diffModels>) => ev.flatMap((e) => (e.kind === 'card' ? [`${e.color}|${e.name}`] : []));
const free = (m: SpectatorModel) => m.game.spaces.filter((s) => s.tileType === undefined && s.spaceType === 'land');
function turn(n: SpectatorModel, to: Color) { for (const p of n.players) p.isActive = p.color === to; }

describe('two players within one update', () => {
  // red plays Sponsors (pays 6) and passes the turn; blue plays Immigrant City (pays 13, its city) before the TV's next model
  const a = start();
  const b = step(a, (n) => {
    P(n, 'red').tableau.push({name: 'Sponsors'}); P(n, 'red').megacredits -= 6; P(n, 'red').megacreditProduction += 2;
    P(n, 'blue').tableau.push({name: 'Immigrant City'}); P(n, 'blue').megacredits -= 13;
    P(n, 'blue').energyProduction -= 1; P(n, 'blue').megacreditProduction -= 2;
    const s = free(n)[0]; s.tileType = TILE.CITY; s.color = 'blue';
    turn(n, 'red');
  });
  it('each card goes to the player who played it', () => {
    expect(cards(diffModels(a, b))).toEqual(['red|Sponsors', 'blue|Immigrant City']);
    expect(sequencedBy(a, b).cards).toEqual(['red|Sponsors', 'blue|Immigrant City']);
  });
  it("Immigrant City's city drops with Immigrant City, not with red's card", () => {
    expect([...sequencedBy(a, b).tiles.values()].map((t) => t.card)).toEqual(['blue|Immigrant City']);
  });
  it("blue's own costs are not an attack by red (the player active before)", () => {
    expect(actorsBetween(a, b).sort()).toEqual(['blue', 'red']);
    expect(detectAttack(a, b)).toBeNull();
    expect(diffModels(a, b).some((e) => e.kind === 'attack')).toBe(false);
  });
  it('a model this screen missed (the turn passed): the one mover is the actor', () => {
    // red was active in the last model seen; only blue moved, and blue's Virus took red's plants
    const c = step(a, (n) => {
      P(n, 'blue').tableau.push({name: 'Virus'}); P(n, 'blue').megacredits -= 1;
      P(n, 'red').plants -= 5;
    });
    expect(cards(diffModels(a, c))).toEqual(['blue|Virus']);
    expect(detectAttack(a, c)).toMatchObject({attacker: 'blue', targets: [{color: 'red', losses: [{what: 'stock', resource: 'plants', amount: 5}]}]});
  });
});

describe('a card played and an action used in one update', () => {
  const a = start();
  const b = step(a, (n) => {
    P(n, 'red').tableau.push({name: 'Kelp Farming'}); P(n, 'red').megacredits -= 17;
    P(n, 'red').actionsThisGeneration = ['Birds']; P(n, 'red').tableau.find((c) => c.name === 'Birds')!.resources = 3;
  });
  it('the card is a card moment and the action an action moment, both red', () => {
    expect(cards(diffModels(a, b))).toEqual(['red|Kelp Farming']);
    expect(newActions(a, b)).toEqual([{color: 'red', cards: ['Birds']}]);
    const w = new ActionWatcher();
    expect(w.feed(a, b).map((x) => [x.color, x.cards])).toEqual([['red', ['Birds']]]);
  });
  it("an action by blue in the same update stays blue's", () => {
    const c = step(b, (n) => { P(n, 'blue').actionsThisGeneration = ['Tardigrades']; P(n, 'blue').tableau.find((x) => x.name === 'Tardigrades')!.resources = 2; });
    expect(newActions(b, c)).toEqual([{color: 'blue', cards: ['Tardigrades']}]);
    expect(cards(diffModels(b, c))).toEqual([]);
  });
});

describe('events', () => {
  it('an event is a card moment for its player, and what it took is an attack by them', () => {
    const a = start();
    const b = step(a, (n) => {
      P(n, 'red').tableau.push({name: 'Asteroid'}); P(n, 'red').megacredits -= 14; P(n, 'red').titanium += 2; P(n, 'red').terraformRating += 1;
      n.game.temperature += 2;
      P(n, 'blue').plants -= 3;
    });
    expect(cards(diffModels(a, b))).toEqual(['red|Asteroid']);
    expect(detectAttack(a, b)).toMatchObject({attacker: 'red', targets: [{color: 'blue', losses: [{what: 'stock', resource: 'plants', amount: 3}]}]});
  });
});

describe("a corporation's effect", () => {
  it("red's Tharsis Republic paying out on blue's city is no card, no action and no attack of red's", () => {
    const a = start();
    const b = step(a, (n) => {
      P(n, 'blue').tableau.push({name: 'Immigrant City'}); P(n, 'blue').megacredits -= 13;
      const s = free(n)[0]; s.tileType = TILE.CITY; s.color = 'blue';
      P(n, 'red').megacreditProduction += 1; // Tharsis Republic: any city on Mars
      turn(n, 'blue');
    });
    const ev = diffModels(a, b);
    expect(cards(ev)).toEqual(['blue|Immigrant City']);
    expect(newActions(a, b)).toEqual([]);
    expect(ev.some((e) => e.kind === 'attack')).toBe(false);
  });
});

describe('undo and "Back"', () => {
  const a = start();
  const played = step(a, (n) => { P(n, 'blue').tableau.push({name: 'Special Design'}); P(n, 'blue').megacredits -= 4; turn(n, 'blue'); });
  it('Back (the engine reloads the save before the move: gameAge falls) is no card and no attack', () => {
    const back = step(played, (n) => { P(n, 'blue').tableau.pop(); P(n, 'blue').megacredits += 4; }, a.game.gameAge);
    expect(cards(diffModels(played, back))).toEqual([]);
    expect(sequencedBy(played, back).cards).toEqual([]);
    expect(newActions(played, back)).toEqual([]);
    expect(detectAttack(played, back)).toBeNull();
  });
  it('the card chosen instead is the one shown, even when the screen never saw the rewound model', () => {
    const instead = step(played, (n) => {
      P(n, 'blue').tableau = P(n, 'blue').tableau.filter((c) => c.name !== 'Special Design');
      P(n, 'blue').tableau.push({name: 'Immigrant City'}); P(n, 'blue').megacredits -= 9;
    }, played.game.gameAge);
    expect(cards(diffModels(played, instead))).toEqual(['blue|Immigrant City']);
  });
  it('an undo (undoCount rises) is never a card, an action or an attack', () => {
    const undone = step(played, (n) => { n.game.undoCount = 1; P(n, 'red').plants -= 2; P(n, 'red').actionsThisGeneration = ['Birds']; });
    expect(sequencedBy(played, undone).cards).toEqual([]);
    expect(newActions(played, undone)).toEqual([]);
    expect(detectAttack(played, undone)).toBeNull();
  });
});

describe('the flick the TV shows', () => {
  const known = () => true;
  const f = (id: string, at: number, card = 'Immigrant City') => ({id, card, at});
  it('the oldest not yet shown, in arrival order', () => {
    const list = [f('a', 1000, 'Sponsors'), f('b', 2000)];
    expect(nextFlick(list, new Set(), 0, 3000, known)?.id).toBe('a');
    expect(nextFlick(list, new Set(['a']), 0, 3000, known)?.id).toBe('b');
    expect(nextFlick(list, new Set(['a', 'b']), 0, 3000, known)).toBeUndefined();
  });
  it('never one from before the TV was watching, nor a card it does not know', () => {
    expect(nextFlick([f('a', 1000)], new Set(), 5000, 6000, known)).toBeUndefined();
    expect(nextFlick([f('a', 1000)], new Set(), 0, 2000, () => undefined)).toBeUndefined();
  });
  it('an old flick (it waited behind the others) is passed over for the card being played now', () => {
    const now = 100_000;
    const list = [f('old', now - FLICK_STALE_MS - 1, 'Sponsors'), f('new', now - 500)];
    expect(nextFlick(list, new Set(), 0, now, known)?.id).toBe('new');
  });
});
