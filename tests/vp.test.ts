// "Show VP changes": the VP the phone predicts for a tile or a move equals what the real engine scores afterwards.
// Each case stages a game in the engine (vendor/tm/build, the commit the server runs), predicts from the player's own
// view, makes the change in the engine and compares every player's VP (the engine's own victoryPointsBreakdown).
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {act, clone, newGame, view, waiting} from '../tools/judge/engine';
import type {EngineGame, EnginePlayer} from '../tools/judge/engine';
import {decide} from '../src/server/full/bots/decide';
import {isTurnMenuQuestion} from '../src/shared/sync';
import {payment} from '../src/shared/full';
import type {InputResponse, PlayerInputModel, PlayerViewModel, SpaceModel} from '../src/shared/full';
import {defaultPayment, neighbours, previewText, project, worldFromView} from '../src/shared/projection';
import type {Move} from '../src/shared/projection';
import {findCard} from '../src/shared/cards';
import {placeVp, spaceVpLines, tileKindFromTitle, withVp} from '../src/shared/vp';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const {newProjectCard} = require('../vendor/tm/build/src/server/createCard.js');
const {TileType} = require('../vendor/tm/build/src/common/TileType.js');

function stage(o: {hand?: string[]; tableau?: string[]; mc?: number; plants?: number; seed?: number} = {}) {
  const g = newGame(o.seed ?? 5, ['Ada', 'Bea']);
  for (let i = 0; i < 400; i++) {
    const ws = waiting(g);
    const p = ws.find((x: EnginePlayer) => x.name === 'Ada') ?? ws[0];
    const m = view(p);
    if (p.name === 'Ada' && m.game.phase === 'action' && isTurnMenuQuestion(m.waitingFor) && m.thisPlayer.actionsTakenThisRound === 0) break;
    act(p, decide(m.waitingFor!, m, {level: 'normal', rng: () => 0.4, avoid: new Set()})!.response);
  }
  const a = g.players.find((x: EnginePlayer) => x.name === 'Ada');
  for (const n of o.hand ?? []) a.cardsInHand.push(newProjectCard(n));
  for (const n of o.tableau ?? []) a.playedCards.push(newProjectCard(n));
  if (o.mc !== undefined) a.megaCredits = o.mc;
  if (o.plants !== undefined) a.plants = o.plants;
  const game = clone(g);
  const ada = game.players.find((x: EnginePlayer) => x.name === 'Ada');
  const bea = game.players.find((x: EnginePlayer) => x.name === 'Bea');
  return {game, ada, bea};
}

const total = (p: EnginePlayer) => p.getVictoryPoints().total as number;
const space = (game: EngineGame, id: string) => game.board.getSpaceOrThrow(id);
const free = (s: SpaceModel) => s.spaceType === 'land' && s.tileType === undefined;

/** A free land space with at least `n` free land neighbours: [centre, neighbours]. */
function hub(m: PlayerViewModel, n: number, skip: string[] = []): [SpaceModel, SpaceModel[]] {
  for (const s of m.game.spaces) {
    if (!free(s) || skip.includes(s.id)) continue;
    const adj = neighbours(m.game.spaces, s).filter(free);
    if (adj.length >= n) return [s, adj];
  }
  throw new Error('no space');
}

function make(ada: EnginePlayer, r: InputResponse) {
  act(ada, r);
  for (let i = 0; i < 30; i++) {
    if (!ada.getWaitingFor()) break;
    const m = view(ada);
    if (isTurnMenuQuestion(m.waitingFor)) break;
    act(ada, decide(m.waitingFor!, m, {level: 'normal', rng: () => 0.4, avoid: new Set()})!.response);
  }
}

describe('VP of a tile, from the board', () => {
  it('a greenery next to your city and an opponent city: +1 for the tile, +1 for each city', () => {
    const {game, ada, bea} = stage();
    const m0 = view(ada);
    const [z, [x, y]] = hub(m0, 2);
    game.simpleAddTile(ada, space(game, x.id), {tileType: TileType.CITY});
    game.simpleAddTile(bea, space(game, y.id), {tileType: TileType.CITY});
    const m = view(ada);
    const parts = placeVp(m.game.spaces, z.id, 'greenery', m.color);
    const before = {ada: total(ada), bea: total(bea)};
    game.simpleAddTile(ada, space(game, z.id), {tileType: TileType.GREENERY});
    const mine = parts.filter((p) => p.color === m.color).reduce((a, p) => a + p.vp, 0);
    const theirs = parts.filter((p) => p.color !== m.color).reduce((a, p) => a + p.vp, 0);
    expect(mine).toBe(2);
    expect(theirs).toBe(1);
    expect(total(ada) - before.ada).toBe(mine);
    expect(total(bea) - before.bea).toBe(theirs);
    const lines = spaceVpLines(m, z.id, 'greenery').map((l) => l.text);
    expect(lines).toContain('+1 VP (greenery)');
    expect(lines).toContain('+1 VP (your city next to it)');
    expect(lines).toContain('Bea +1 VP (city next to it)');
  });

  it('a city next to two greeneries: +2 VP for the city', () => {
    const {game, ada, bea} = stage();
    const m0 = view(ada);
    const [z, [x, y]] = hub(m0, 2);
    game.simpleAddTile(bea, space(game, x.id), {tileType: TileType.GREENERY});
    game.simpleAddTile(ada, space(game, y.id), {tileType: TileType.GREENERY});
    const m = view(ada);
    const parts = placeVp(m.game.spaces, z.id, 'city', m.color);
    const before = total(ada);
    game.simpleAddTile(ada, space(game, z.id), {tileType: TileType.CITY});
    expect(parts.reduce((a, p) => a + p.vp, 0)).toBe(2);
    expect(total(ada) - before).toBe(2);
    expect(spaceVpLines(m, z.id, 'city').map((l) => l.text)).toEqual(['+2 VP (city next to 2 greeneries)']);
  });

  it('a city with no greenery next to it says there is no VP change', () => {
    const {ada} = stage();
    const m = view(ada);
    const [z] = hub(m, 0);
    expect(spaceVpLines(m, z.id, 'city').map((l) => l.text)).toEqual(['No VP change']);
  });

  it('Capital: 1 VP for each ocean next to it, and an ocean next to a Capital gives its owner 1 VP', () => {
    const {game, ada, bea} = stage();
    const m0 = view(ada);
    // a land space with an ocean-area neighbour
    const land = m0.game.spaces.find((s) => free(s) && neighbours(m0.game.spaces, s).some((n) => n.spaceType === 'ocean' && n.tileType === undefined))!;
    const ocean = neighbours(m0.game.spaces, land).find((n) => n.spaceType === 'ocean' && n.tileType === undefined)!;
    bea.playedCards.push(newProjectCard('Capital'));
    game.simpleAddTile(bea, space(game, land.id), {tileType: TileType.CAPITAL, card: 'Capital'});
    const m = view(ada);
    // placing an ocean next to the Capital: Bea +1
    const parts = placeVp(m.game.spaces, ocean.id, 'ocean', m.color);
    expect(parts).toEqual([{color: bea.color, vp: 1, why: 'ocean next to Capital', source: 'adjacent'}]);
    const before = total(bea);
    game.simpleAddTile(ada, space(game, ocean.id), {tileType: TileType.OCEAN});
    expect(total(bea) - before).toBe(1);
    expect(spaceVpLines(m, ocean.id, 'ocean').map((l) => l.text)).toContain('Bea +1 VP (ocean next to Capital)');
  });

  it('a Capital placed next to an ocean scores it', () => {
    const {game, ada} = stage();
    const m0 = view(ada);
    const land = m0.game.spaces.find((s) => free(s) && neighbours(m0.game.spaces, s).some((n) => n.spaceType === 'ocean'))!;
    const ocean = neighbours(m0.game.spaces, land).find((n) => n.spaceType === 'ocean')!;
    game.simpleAddTile(ada, space(game, ocean.id), {tileType: TileType.OCEAN});
    ada.playedCards.push(newProjectCard('Capital'));
    const m = view(ada);
    const oceans = neighbours(m.game.spaces, land).filter((n) => n.tileType === TileType.OCEAN).length;
    const parts = placeVp(m.game.spaces, land.id, 'capital', m.color);
    const before = total(ada);
    game.simpleAddTile(ada, space(game, land.id), {tileType: TileType.CAPITAL, card: 'Capital'});
    expect(parts.reduce((a, p) => a + p.vp, 0)).toBe(oceans);
    expect(total(ada) - before).toBe(oceans);
    expect(spaceVpLines(m, land.id, 'capital').map((l) => l.text).join(' ')).toContain('Capital next to');
  });

  it('a tile question about Capital is read as a Capital, and unknown titles as special tiles', () => {
    expect(tileKindFromTitle('Select space for Capital tile')).toBe('capital');
    expect(tileKindFromTitle('Select space for city tile')).toBe('city');
    expect(tileKindFromTitle('Select space for first ocean')).toBe('ocean');
    expect(tileKindFromTitle('Select space for Mining Rights tile')).toBe('special');
  });
});

describe('VP of a move, from the projection', () => {
  it('a card with VP of its own: +1 VP, and the engine agrees', () => {
    const {ada} = stage({hand: ['Adaptation Technology'], mc: 40});
    const m = view(ada);
    const w = worldFromView(m);
    const p = withVp(w, project(w, {kind: 'play', card: 'Adaptation Technology'}));
    if (!p.ok) throw new Error(p.reason);
    expect(p.lines.map((l) => l.text)).toContain('+1 VP (Adaptation Technology)');
    const before = total(ada);
    make(ada, answer(m, {kind: 'play', card: 'Adaptation Technology'}));
    expect(total(ada) - before).toBe(1);
  });

  it('VP per resource: an action that adds an animal to Birds is +1 VP, and the engine agrees', () => {
    const {ada} = stage({tableau: ['Birds']});
    const birds = [...ada.tableau].find((c: any) => c.name === 'Birds');
    birds.resourceCount = 2;
    const m = view(ada);
    const w = worldFromView(m);
    const p = withVp(w, project(w, {kind: 'action', card: 'Birds'}));
    if (!p.ok) throw new Error(p.reason);
    expect(p.lines.map((l) => l.text)).toContain('+1 VP (animals on Birds)');
    const before = total(ada);
    make(ada, answer(m, {kind: 'action', card: 'Birds'}));
    expect(total(ada) - before).toBe(1);
  });

  it('playing a card that counts resources says how it scores', () => {
    const {ada} = stage({hand: ['Pets'], mc: 40});
    const m = view(ada);
    const w = worldFromView(m);
    const p = withVp(w, project(w, {kind: 'play', card: 'Pets'}));
    if (!p.ok) throw new Error(p.reason);
    expect(p.unknowns.map((u) => u.text)).toContain('Pets: 1 VP per 2 animals');
  });

  it('plants into a greenery next to your city and an opponent city: the lines add up to what the engine scores', () => {
    const {game, ada, bea} = stage({plants: 20});
    const m0 = view(ada);
    const [z, [x, y]] = hub(m0, 2);
    game.simpleAddTile(ada, space(game, x.id), {tileType: TileType.CITY});
    game.simpleAddTile(bea, space(game, y.id), {tileType: TileType.CITY});
    const m = view(ada);
    const w = worldFromView(m);
    const known = {space: z.id};
    const p = withVp(w, project(w, {kind: 'plants'}, known), known);
    if (!p.ok) throw new Error(p.reason);
    const text = p.lines.map((l) => l.text);
    expect(text).toContain('+1 VP (terraform rating)');
    expect(text).toContain('+1 VP (greenery)');
    expect(text).toContain('+1 VP (your city next to it)');
    expect(text).toContain('Bea +1 VP (city next to it)');
    const before = {ada: total(ada), bea: total(bea)};
    make(ada, answer(m, {kind: 'plants'}, z.id));
    // TR and the greenery are Ada's first two lines, her city the third; Bea gets the city line
    expect(total(ada) - before.ada).toBe(3);
    expect(total(bea) - before.bea).toBe(1);
  });

  it('without a space, a greenery says what depends on the space instead of guessing', () => {
    const {game, ada, bea} = stage({plants: 20});
    const m0 = view(ada);
    const [, [x]] = hub(m0, 1);
    game.simpleAddTile(bea, space(game, x.id), {tileType: TileType.CITY});
    const w = worldFromView(view(ada));
    const p = withVp(w, project(w, {kind: 'plants'}));
    if (!p.ok) throw new Error(p.reason);
    expect(p.lines.map((l) => l.text)).toContain('+1 VP (greenery)');
    expect(p.unknowns.map((u) => u.key)).toContain('vp:tile');
    expect(previewText(p)).toContain('VP');
  });

  it('a move that changes no VP says so', () => {
    const {ada} = stage({hand: ['Lichen'], mc: 40});
    const w = worldFromView(view(ada));
    const p = withVp(w, project(w, {kind: 'play', card: 'Lichen'}));
    if (!p.ok) throw new Error(p.reason);
    expect(p.lines.map((l) => l.text)).toContain('No VP change');
  });
});

function answer(m: PlayerViewModel, move: Move, spaceId?: string): InputResponse {
  const opts = (m.waitingFor as any).options as PlayerInputModel[];
  const t = (o: PlayerInputModel) => (typeof o.title === 'string' ? o.title : (o.title as {message: string}).message).toLowerCase();
  if (move.kind === 'play') {
    const index = opts.findIndex((o) => o.type === 'projectCard' && (o as any).cards.some((c: any) => c.name === move.card && !c.isDisabled));
    expect(index).toBeGreaterThanOrEqual(0);
    const c = (opts[index] as any).cards.find((x: any) => x.name === move.card);
    const def = findCard(move.card);
    const pay = defaultPayment(m.thisPlayer, c.calculatedCost, {steel: !!def?.tags.includes('building'), titanium: !!def?.tags.includes('space'), heat: false});
    return {type: 'or', index, response: {type: 'projectCard', card: move.card, payment: payment(pay)}};
  }
  if (move.kind === 'action') {
    const index = opts.findIndex((o) => o.type === 'card' && (o as any).selectBlueCardAction);
    return {type: 'or', index, response: {type: 'card', cards: [move.card]}};
  }
  const index = opts.findIndex((o) => t(o).includes('greenery') && t(o).includes('plants'));
  return {type: 'or', index, response: {type: 'space', spaceId: spaceId ?? (opts[index] as any).spaces[0]}};
}
