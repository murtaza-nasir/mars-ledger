// Feature 13: bot seats (decisions, payment, tiles, the desk that plays them, the lobby commands) and solo games.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {decide, HAND_CAP, HAND_CAP_V3, isTurnMenu, optionKind, safeDefault} from '../src/server/full/bots/decide';
import {deadEndReason, deadEndText} from '../src/shared/deadend';
import type {Mind} from '../src/server/full/bots/decide';
import {payFor, payForCard} from '../src/server/full/bots/pay';
import {neighbours, rankSpaces, tileGoal} from '../src/server/full/bots/board';
import {cardValue, context, generationsLeft, playableOdds} from '../src/server/full/bots/value';
import {BotDesk, botTable} from '../src/server/full/bots';
import type {BotLogEntry} from '../src/server/full/bots';
import {FullBridge} from '../src/server/full/bridge';
import {EngineClient} from '../src/server/full/engine';
import {getCard} from '../src/shared/cards';
import {apply, newGame} from '../src/shared/engine';
import {botColors, isBotSeat, nextBotName} from '../src/shared/bots';
import {soloGenerationText, soloStatus, soloVerdict, stepsText} from '../src/shared/solo';
import {TILE} from '../src/shared/full';
import type {CardModel, InputResponse, PlayerInputModel, PlayerViewModel, SpaceModel} from '../src/shared/full';
import type {Command, GameState} from '../src/shared/game';

const opt = (title: string): PlayerInputModel => ({type: 'option', title, buttonLabel: 'OK'});
const projectCards = (cards: CardModel[], title = 'Play project card'): PlayerInputModel =>
  ({type: 'projectCard', title, buttonLabel: 'Play', cards, paymentOptions: {}, microbes: 0, floaters: 0});
const menu = (options: PlayerInputModel[], first = false): PlayerInputModel =>
  ({type: 'or', title: first ? 'Take your first action' : 'Take your next action', buttonLabel: 'Take action', options});

function model(patch: (m: PlayerViewModel) => void = () => {}): PlayerViewModel {
  const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-action.json', import.meta.url), 'utf8')) as PlayerViewModel;
  m.thisPlayer.tableau = [{name: 'Mining Guild'}];
  m.thisPlayer.actionsThisGeneration = [];
  m.thisPlayer.megacredits = 40;
  m.thisPlayer.heat = 0; m.thisPlayer.plants = 0; m.thisPlayer.steel = 0; m.thisPlayer.titanium = 0;
  m.game.generation = 3;
  patch(m);
  m.players = m.players.map((p) => (p.color === m.thisPlayer.color ? m.thisPlayer : p));
  return m;
}
const normal = (avoid: string[] = []): Mind => ({level: 'normal', rng: seeded(7), avoid: new Set(avoid)});
const easy = (seed = 3): Mind => ({level: 'easy', rng: seeded(seed), avoid: new Set()});
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const chosen = (r: InputResponse | undefined): InputResponse | undefined => (r && r.type === 'or' ? chosen(r.response) ?? r : r);

describe('paying like a careful player', () => {
  const me = {megacredits: 10, steel: 3, titanium: 2, heat: 6, steelValue: 2, titaniumValue: 3};
  it('spends titanium on space cards and steel on building cards before M€', () => {
    expect(payForCard(me, 14, ['space'], {})).toMatchObject({titanium: 2, megacredits: 8, steel: 0});
    expect(payForCard(me, 9, ['building'], {})).toMatchObject({steel: 3, megacredits: 3, titanium: 0});
  });
  it('uses heat only when the corporation allows it, and refuses what it cannot cover', () => {
    expect(payFor(me, 14, {heat: true})).toMatchObject({heat: 6, megacredits: 8});
    expect(payFor(me, 14, {})).toBeNull();
  });
  it('overpays with one more metal unit rather than fail, and gives back the M€ no longer needed', () => {
    const p = payFor({...me, megacredits: 1}, 7, {titanium: true})!; // 2 Ti = 6, short 1 → 1 M€
    expect(p).toMatchObject({titanium: 2, megacredits: 1});
    const q = payFor({megacredits: 0, steel: 2, titanium: 0, heat: 0, steelValue: 2, titaniumValue: 3}, 3, {steel: true})!;
    expect(q).toMatchObject({steel: 2, megacredits: 0});
  });
});

describe('reading the engine menu', () => {
  it('names every top-level option the way the soak bot does', () => {
    expect(optionKind(opt('Pass for this generation'))).toBe('pass');
    expect(optionKind(opt('End Turn'))).toBe('end');
    expect(optionKind(opt('Undo last action'))).toBe('undo');
    expect(optionKind(opt('Convert 8 heat into temperature'))).toBe('heat');
    expect(optionKind({type: 'space', title: 'Convert 8 plants into greenery', buttonLabel: '', spaces: []})).toBe('plants');
    expect(optionKind(projectCards([], 'Standard projects'))).toBe('standard');
    expect(optionKind(projectCards([]))).toBe('play');
    expect(isTurnMenu(menu([]))).toBe(true);
    expect(isTurnMenu({type: 'or', title: 'Select one option', buttonLabel: '', options: []})).toBe(false);
  });
});

describe('a normal bot on its turn', () => {
  it('claims a milestone first', () => {
    const w = menu([projectCards([{name: 'Mine', calculatedCost: 4}]), {type: 'or', title: 'Claim a milestone', buttonLabel: '', options: [opt('Builder')]}, opt('Pass for this generation')]);
    const d = decide(w, model(), normal())!;
    expect(d.response).toEqual({type: 'or', index: 1, response: {type: 'or', index: 0, response: {type: 'option'}}});
  });
  it('converts heat into temperature while it still counts, plays a good card otherwise', () => {
    const w = menu([projectCards([{name: 'Mine', calculatedCost: 4}]), opt('Convert 8 heat into temperature'), opt('Pass for this generation')]);
    expect(decide(w, model((m) => { m.game.temperature = -10; m.thisPlayer.heat = 8; }), normal())!.why).toMatch(/heat/);
    // temperature maxed: the heat is worth nothing, the card is
    expect(decide(w, model((m) => { m.game.temperature = 8; m.thisPlayer.heat = 8; }), normal())!.why).toMatch(/Mine/);
  });
  it('plays the card worth most for its price and pays legally', () => {
    const w = menu([projectCards([{name: 'Lichen', calculatedCost: 7}, {name: 'Power Plant', calculatedCost: 4}, {name: 'Mine', calculatedCost: 4}]), opt('Pass for this generation')]);
    const d = decide(w, model(), normal())!;
    const r = chosen(d.response) as Extract<InputResponse, {type: 'projectCard'}>;
    expect(r.type).toBe('projectCard');
    expect(['Lichen', 'Power Plant', 'Mine']).toContain(r.card);
    expect(r.payment.megacredits).toBe(getCard(r.card).cost);
  });
  it('passes when nothing is worth doing, and never undoes', () => {
    const w = menu([opt('End Turn'), opt('Pass for this generation'), opt('Undo last action')]);
    const d = decide(w, model((m) => { m.cardsInHand = []; }), normal())!;
    expect(d.why).toBe('pass');
    expect(d.response).toEqual({type: 'or', index: 1, response: {type: 'option'}});
  });
  it('tries another option after the engine refused one', () => {
    const w = menu([projectCards([{name: 'Mine', calculatedCost: 4}, {name: 'Power Plant', calculatedCost: 4}]), opt('Pass for this generation')]);
    const first = decide(w, model(), normal())!;
    const second = decide(w, model(), normal([first.path]))!;
    expect(second.path).not.toBe(first.path);
    const third = decide(w, model(), normal([first.path, second.path]))!;
    expect(third.why).toBe('pass');
  });
  it('funds an award it leads late in the game, not one it trails', () => {
    const m = model((m) => {
      m.game.temperature = 4; m.game.oxygenLevel = 13; m.game.oceans = 8; m.game.generation = 11;
      const other = m.players.find((p) => p.color !== m.thisPlayer.color)!.color;
      m.game.awards = [
        {name: 'Banker', scores: [{color: m.thisPlayer.color, score: 9}, {color: other, score: 4}]},
        {name: 'Miner', scores: [{color: m.thisPlayer.color, score: 1}, {color: other, score: 6}]},
      ];
    });
    const w = menu([{type: 'or', title: 'Fund an award (8 M€)', buttonLabel: '', options: [opt('Banker'), opt('Miner')]}, opt('Pass for this generation')]);
    const d = decide(w, m, normal())!;
    expect(d.response).toEqual({type: 'or', index: 0, response: {type: 'or', index: 0, response: {type: 'option'}}});
  });
  it('leaves standard projects for late in the game unless it has money to spare', () => {
    const sp = projectCards([{name: 'Aquifer', calculatedCost: 18}, {name: 'Asteroid:SP', calculatedCost: 14}], 'Standard projects');
    const w = menu([sp, opt('Pass for this generation')]);
    expect(decide(w, model((m) => { m.thisPlayer.megacredits = 20; m.game.generation = 2; }), normal())!.why).toBe('pass');
    // the last generation: money left at the end scores nothing, so a step of TR is worth buying
    const late = decide(w, model((m) => { m.thisPlayer.megacredits = 20; m.game.generation = 12; m.game.temperature = 6; m.game.oxygenLevel = 14; m.game.oceans = 8; }), normal())!;
    expect(late.why).toMatch(/standard project/);
  });
});

describe('cards: research, draft and value', () => {
  it('buys within a budget and nothing in the last generation', () => {
    const w: PlayerInputModel = {type: 'card', title: 'Select card(s) to buy', buttonLabel: 'Buy', min: 0, max: 4, selectBlueCardAction: false, showOwner: false,
      cards: ['Mine', 'Lichen', 'Power Plant', 'Asteroid'].map((name) => ({name, calculatedCost: getCard(name).cost ?? 0}))};
    const poor = decide(w, model((m) => { m.thisPlayer.megacredits = 10; m.thisPlayer.megacreditProduction = 0; }), normal())!;
    expect((poor.response as {cards: string[]}).cards.length).toBeLessThanOrEqual(2);
    const end = decide(w, model((m) => { m.game.temperature = 8; m.game.oxygenLevel = 14; m.game.oceans = 8; }), normal())!;
    expect((end.response as {cards: string[]}).cards).toEqual([]);
  });
  it('values early production over late production, and an unplayable card at nothing', () => {
    const early = context(model((m) => { m.game.generation = 1; m.game.temperature = -30; m.game.oxygenLevel = 0; m.game.oceans = 0; }));
    const late = context(model((m) => { m.game.generation = 12; m.game.temperature = 6; m.game.oxygenLevel = 13; m.game.oceans = 9; }));
    expect(generationsLeft(early.model)).toBeGreaterThan(generationsLeft(late.model));
    expect(cardValue(getCard('Mine'), early)).toBeGreaterThan(cardValue(getCard('Mine'), late));
    // Arctic Algae needs -12 °C or colder
    expect(playableOdds(getCard('Arctic Algae'), late)).toBe(0);
  });
  it('picks a corporation and a starting hand it can pay for', () => {
    const m = JSON.parse(readFileSync(new URL('./fixtures/full/player-initial.json', import.meta.url), 'utf8')) as PlayerViewModel;
    const d = decide(m.waitingFor!, m, normal())!;
    expect(d.response.type).toBe('initialCards');
    const [corp, hand] = (d.response as {responses: Array<{cards: string[]}>}).responses;
    expect(corp.cards).toHaveLength(1);
    expect(hand.cards.length * 3).toBeLessThanOrEqual((getCard(corp.cards[0]).startingMegaCredits ?? 0) - 15 + 3);
  });
});

describe('placing tiles', () => {
  const space = (id: string, x: number, y: number, extra: Partial<SpaceModel> = {}): SpaceModel => ({id, x, y, spaceType: 'land', bonus: [], ...extra});
  // a strip of the middle row (y 4 has no indent: x 0..8) and the row above it (y 3, indent 1)
  const spaces = [
    space('a', 2, 4, {tileType: TILE.CITY, color: 'red'}), space('b', 3, 4), space('c', 4, 4, {bonus: [1, 1]}), space('d', 5, 4),
    space('e', 4, 3), space('f', 3, 3, {tileType: TILE.OCEAN}), space('g', 6, 4, {tileType: TILE.CITY, color: 'blue'}),
  ];
  it('finds neighbours from the engine coordinates', () => {
    const n = neighbours(spaces);
    expect(n.get('b')!.map((s) => s.id).sort()).toEqual(['a', 'c', 'e', 'f']);
  });
  it('puts a greenery beside its own city and an ocean, and a city among greeneries or on bonuses', () => {
    expect(tileGoal('Select space for greenery tile')).toBe('greenery');
    expect(tileGoal('Select space for city tile')).toBe('city');
    expect(rankSpaces(['b', 'd'], 'greenery', 'red', spaces)[0].id).toBe('b');
    expect(rankSpaces(['b', 'c', 'd'], 'other', 'red', spaces)[0].id).toBe('c'); // two steel
  });
  it('the easy bot places anywhere offered', () => {
    const w: PlayerInputModel = {type: 'space', title: 'Select space for greenery tile', buttonLabel: '', spaces: ['b', 'd']};
    const d = decide(w, model((m) => { m.game.spaces = spaces; }), easy())!;
    expect(['b', 'd']).toContain((d.response as {spaceId: string}).spaceId);
  });
});

describe('easy bots and safe defaults', () => {
  it('always answers with something the engine offered', () => {
    const cards: CardModel[] = [{name: 'Mine', calculatedCost: 4}, {name: 'Lichen', calculatedCost: 7}];
    const w = menu([projectCards(cards), opt('Convert 8 heat into temperature'), opt('End Turn'), opt('Pass for this generation'), opt('Undo last action')]);
    for (let seed = 1; seed < 40; seed++) {
      const d = decide(w, model((m) => { m.thisPlayer.heat = 8; m.game.temperature = -20; }), easy(seed))!;
      const r = d.response as {type: 'or'; index: number};
      expect(r.index).toBeLessThan(4); // never undo
    }
  });
  it('falls back to pass, then end turn, then the first plain option', () => {
    const w = menu([opt('Do something'), opt('End Turn'), opt('Pass for this generation')]);
    expect(safeDefault(w, new Set())!.why).toBe('pass');
    expect(safeDefault(w, new Set(['safe:or2']))!.why).toBe('end');
    expect(safeDefault(w, new Set(['safe:or2', 'safe:or1']))!.why).toBe('Do something');
  });
  it('answers every prompt type it can meet in a base game', () => {
    const m = model();
    const prompts: PlayerInputModel[] = [
      {type: 'player', title: 'Select player to decrease plants production', buttonLabel: '', players: [m.thisPlayer.color, m.players.find((p) => p.color !== m.thisPlayer.color)!.color]},
      {type: 'amount', title: 'Select amount of heat production to decrease', buttonLabel: '', min: 0, max: 3},
      {type: 'payment', title: 'Select how to pay for award', buttonLabel: '', amount: 8, paymentOptions: {heat: true}},
      {type: 'productionToLose', title: 'Choose 2 units of production to lose', buttonLabel: '', payProduction: {cost: 2, units: {megacredits: 1, heat: 3}}},
      {type: 'resource', title: 'Gain 1 standard resource', buttonLabel: '', include: ['megacredits', 'titanium', 'plants']},
      {type: 'resources', title: 'Gain 3 resources', buttonLabel: '', count: 3},
      {type: 'and', title: '', buttonLabel: '', options: [{type: 'amount', title: 'Birds', buttonLabel: '', min: 0, max: 3}, {type: 'amount', title: 'Fish', buttonLabel: '', min: 0, max: 3}]},
      {type: 'card', title: 'Select card to add 2 animals', buttonLabel: '', min: 1, max: 1, selectBlueCardAction: false, showOwner: false, cards: [{name: 'Pets'}, {name: 'Birds'}]},
      {type: 'or', title: 'Select one option', buttonLabel: '', options: [opt('Do nothing'), opt('Remove 3 plants')]},
    ];
    for (const level of ['normal', 'easy'] as const) {
      for (const w of prompts) expect(decide(w, m, {level, rng: seeded(1), avoid: new Set()}), `${level} ${w.type}`).not.toBeNull();
    }
    const dm = decide(prompts[0], m, normal())!;
    expect((dm.response as {player: string}).player).not.toBe(m.thisPlayer.color); // hurts a rival, not itself
    expect((decide(prompts[4], m, normal())!.response as {resource: string}).resource).toBe('titanium');
    expect((decide(prompts[7], m, normal())!.response as {cards: string[]}).cards).toEqual(['Birds']); // Birds score their animals
    expect((decide(prompts[8], m, normal())!.response as {index: number}).index).toBe(1); // something rather than nothing
  });
});

// ---- the lobby commands --------------------------------------------------------------------------
function lobby(...cmds: Command[]): GameState {
  let s = newGame('g');
  for (const c of cmds) s = apply(s, c).state;
  return s;
}
const join = (id: string, name: string, color: 'red' | 'blue' | 'green' | 'yellow' | 'black'): Command => ({t: 'join', playerId: id, name, color});
const addBot = (id: string, name: string, color: 'red' | 'blue' | 'green' | 'yellow' | 'black', level: 'easy' | 'normal' = 'normal'): Command =>
  ({t: 'addBot', playerId: 'a', botId: id, name, color, level});

describe('bot seats in the lobby', () => {
  it('seats a bot with its level and removes it again', () => {
    const s = lobby(join('a', 'Ana', 'red'), addBot('b1', 'Ares', 'blue', 'easy'));
    expect(s.players.find((p) => p.id === 'b1')).toMatchObject({name: 'Ares', color: 'blue', bot: 'easy'});
    expect(isBotSeat(s, 'b1')).toBe(true);
    expect(isBotSeat(s, 'a')).toBe(false);
    expect(nextBotName(s)).toBe('Deimos');
    expect(lobby(join('a', 'Ana', 'red'), addBot('b1', 'Ares', 'blue'), {t: 'leave', playerId: 'b1'}).players.map((p) => p.id)).toEqual(['a']);
  });
  it('refuses a taken colour, a sixth seat, a second bot with the same name, and seats after the start', () => {
    const base = lobby(join('a', 'Ana', 'red'));
    expect(() => apply(base, addBot('b1', 'Ares', 'red'))).toThrow(/colour/);
    expect(() => apply(lobby(join('a', 'Ana', 'red'), addBot('b1', 'Ares', 'blue')), addBot('b2', 'ares', 'green'))).toThrow(/already/);
    const fiveSeats = lobby(join('a', 'Ana', 'red'), addBot('b1', 'A1', 'blue'), addBot('b2', 'A2', 'green'), addBot('b3', 'A3', 'yellow'), addBot('b4', 'A4', 'black'));
    expect(() => apply(fiveSeats, {...addBot('b5', 'A5', 'black')})).toThrow(/full/);
  });
  it('plays full games only', () => {
    const s = lobby(join('a', 'Ana', 'red'), addBot('b1', 'Ares', 'blue'));
    expect(() => apply(s, {t: 'start', playerId: 'a', modules: ['base'], order: ['a', 'b1'], mode: 'companion'})).toThrow(/full games only/);
    const link = {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red' as const}, b1: {engineId: 'pb', color: 'yellow' as const}}};
    const started = apply(s, {t: 'start', playerId: 'a', modules: ['base'], order: ['a', 'b1'], mode: 'full', link}).state;
    expect(botTable(started)).toEqual({gameId: 'e1', bots: [{playerId: 'b1', name: 'Ares', level: 'normal', engineId: 'pb', color: 'yellow'}], speed: 'table'});
    // the engine's colour wins over the lobby colour
    expect([...botColors(started)]).toEqual(['yellow']);
    expect(botTable(s)).toBeNull();
  });
});

// ---- the bot desk ---------------------------------------------------------------------------------
function fakeTable(waiting: () => PlayerInputModel | undefined, accept: (r: InputResponse) => boolean) {
  const m = model();
  const log: BotLogEntry[] = [];
  const inputs: InputResponse[] = [];
  let age = 1;
  let gameId = 'e1';
  const desk = new BotDesk({
    player: async () => ({...m, game: {...m.game, gameAge: age}, waitingFor: waiting()}),
    table: () => ({gameId, bots: [{playerId: 'b1', name: 'Ares', level: 'normal', engineId: 'pb', color: m.thisPlayer.color}]}),
    input: async (_id, r) => { inputs.push(r); if (!accept(r)) throw new Error('Not a valid option'); age++; },
    delayScale: 0, tickMs: 50, rng: seeded(5), log: (e) => log.push(e),
  });
  return {desk, log, inputs, setGame: (g: string) => { gameId = g; }};
}
const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  return f();
};

describe('the bot desk', () => {
  it('answers the question its seat is on and logs the decision', async () => {
    let asked = true;
    const t = fakeTable(() => (asked ? menu([opt('Pass for this generation')], true) : undefined), () => { asked = false; return true; });
    t.desk.kick();
    expect(await until(() => t.log.length > 0)).toBe(true);
    t.desk.stop();
    expect(t.inputs[0]).toEqual({type: 'or', index: 0, response: {type: 'option'}});
    expect(t.log[0]).toMatchObject({name: 'Ares', outcome: 'ok', choice: 'pass'});
  });
  it('after a refusal answers again with another option, logging the refusal', async () => {
    let open = true;
    const w = menu([projectCards([{name: 'Mine', calculatedCost: 4}]), opt('Pass for this generation')], true);
    const t = fakeTable(() => (open ? w : undefined), (r) => { const ok = (r as {index: number}).index === 1; if (ok) open = false; return ok; });
    t.desk.kick();
    expect(await until(() => t.log.some((e) => e.outcome === 'ok'))).toBe(true);
    t.desk.stop();
    expect(t.log.map((e) => e.outcome)).toEqual(['refused', 'ok']);
    expect(t.log[0].error).toBe('Not a valid option');
  });
  it('never stalls: when every answer is refused it waits and looks again, without blocking', async () => {
    const t = fakeTable(() => menu([opt('Pass for this generation')], true), () => false);
    t.desk.kick();
    expect(await until(() => t.log.some((e) => e.outcome === 'stuck'))).toBe(true);
    t.desk.stop();
    expect(t.log.filter((e) => e.outcome === 'refused').length).toBeGreaterThan(0);
  });
  it('drops a scheduled move when the game changes (abandoned, new game)', async () => {
    const m = model();
    const inputs: InputResponse[] = [];
    let gameId: string | null = 'e1';
    const desk = new BotDesk({
      player: async () => ({...m, waitingFor: menu([opt('Pass for this generation')], true)}),
      table: () => (gameId ? {gameId, bots: [{playerId: 'b1', name: 'Ares', level: 'normal', engineId: 'pb', color: m.thisPlayer.color}]} : null),
      input: async (_id, r) => { inputs.push(r); },
      delayScale: 0.2, tickMs: 1000, rng: () => 0.9,
    });
    desk.kick();
    await until(() => desk.busy > 0);
    gameId = null;
    desk.kick();
    await new Promise((r) => setTimeout(r, 800));
    desk.stop();
    expect(inputs).toEqual([]);
  });
  it('waits like a person at Quick: 1–3 s on the turn menu, nothing in the final scoring (other speeds: botspeed.test.ts)', () => {
    const desk = new BotDesk({player: async () => model(), table: () => null, input: async () => {}, rng: () => 0.5});
    desk.stop();
    expect(desk.waitFor(menu([]), model(), 'quick')).toBe(2000);
    expect(desk.waitFor({type: 'or', title: 'Place any final greenery from plants', buttonLabel: '', options: []}, model())).toBe(0);
    const research = model((m) => { m.game.phase = 'research'; });
    expect(desk.waitFor({type: 'card', title: 'Select card(s) to buy', buttonLabel: '', cards: [], min: 0, max: 4, selectBlueCardAction: false, showOwner: false}, research, 'quick')).toBe(800);
  });
});

describe('the bridge guards bot seats', () => {
  const state = (): GameState => {
    const s = lobby(join('a', 'Ana', 'red'), addBot('b1', 'Ares', 'blue'));
    const link = {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red' as const}, b1: {engineId: 'pb', color: 'blue' as const}}};
    return apply(s, {t: 'start', playerId: 'a', modules: ['base'], order: ['a', 'b1'], mode: 'full', link}).state;
  };
  it('refuses a phone answering for a bot, and the desk answering for a person', async () => {
    const sent: string[] = [];
    // the bridge reads the seat's question before answering it
    const engine = {input: async (id: string) => { sent.push(id); return {game: {gameAge: 2, undoCount: 0}} as PlayerViewModel; },
      player: async () => ({game: {gameAge: 1, undoCount: 0}, waitingFor: {type: 'option'}, thisPlayer: {}}) as unknown as PlayerViewModel,
      spectator: async () => { throw new Error('no engine'); }} as unknown as EngineClient;
    const bridge = new FullBridge(engine, state, () => [], () => {}, 60000);
    bridge.stop();
    await expect(bridge.input('b1', {type: 'option'})).rejects.toThrow(/bot plays that seat/);
    await expect(bridge.input('a', {type: 'option'}, true)).rejects.toThrow(/not a bot/);
    await bridge.input('b1', {type: 'option'}, true).catch(() => {});
    expect(sent).toEqual(['pb']);
  });
  it('creates a one-player engine game for a solo table', async () => {
    let body: {players: unknown[]} | null = null;
    const engine = {createGame: async (o: {players: unknown[]}) => { body = o; return {id: 'e2', spectatorId: 's2', players: [{id: 'p1', name: 'Ana', color: 'red'}]}; }} as unknown as EngineClient;
    const bridge = new FullBridge(engine, () => newGame('g'), () => [], () => {}, 60000);
    bridge.stop();
    const link = await bridge.createGame([{id: 'a', name: 'Ana', color: 'red'}], false);
    expect(body!.players).toHaveLength(1);
    expect(link.players).toEqual({a: {engineId: 'p1', color: 'red'}});
  });
});

describe('solo facts', () => {
  const game = {generation: 9, phase: 'action', temperature: 0, oxygenLevel: 10, oceans: 9, lastSoloGeneration: 14, isSoloModeWin: false, gameOptions: {}};
  it('counts the generations left against the engine limit, solo only', () => {
    expect(soloStatus(2, game)).toBeNull();
    const s = soloStatus(1, game)!;
    expect(s).toMatchObject({last: 14, left: 6, result: null, steps: {temperature: 4, oxygen: 4, oceans: 0, total: 8}});
    expect(soloGenerationText(s)).toBe('Generation 9 of 14');
    // Prelude games end after generation 12 when the engine does not say
    expect(soloStatus(1, {...game, lastSoloGeneration: undefined, gameOptions: {expansions: {prelude: true}}})!.last).toBe(12);
  });
  it('says won or lost from the engine verdict at the end', () => {
    const lost = soloStatus(1, {...game, generation: 14, phase: 'end'})!;
    expect(lost.result).toBe('lost');
    expect(soloVerdict(lost)).toEqual({title: 'Mars held out', line: 'Not terraformed by the end of generation 14: 4 temperature steps and 4 % oxygen still missing.'});
    const won = soloStatus(1, {...game, generation: 14, phase: 'end', temperature: 8, oxygenLevel: 14, isSoloModeWin: true})!;
    expect(soloVerdict(won).title).toBe('Mars is terraformed');
    expect(stepsText({temperature: 1, oxygen: 0, oceans: 2, total: 3})).toBe('1 temperature step and 2 oceans');
  });
});

// ---- an empty project deck (a draft can deal a bot an empty hand that requires a card) ----
describe('bots do not drain the deck', () => {
  const buy: PlayerInputModel = {type: 'card', title: 'Select card(s) to buy', buttonLabel: 'Buy', min: 0, max: 4, selectBlueCardAction: false, showOwner: false,
    cards: ['Mine', 'Lichen', 'Power Plant', 'Asteroid'].map((name) => ({name, calculatedCost: getCard(name).cost ?? 0}))};
  const hand = (n: number) => Array.from({length: n}, (_, i) => ({name: ['Mine', 'Lichen', 'Power Plant', 'Asteroid', 'Comet', 'Moss', 'Heather', 'Algae', 'Trees', 'Grass'][i % 10]}));
  const bought = (level: 'normal' | 'easy', n: number, seed = 1, v2 = false) =>
    (decide(buy, model((m) => { m.thisPlayer.megacredits = 60; m.cardsInHand = hand(n); m.game.generation = 2; m.game.temperature = -30; m.game.oxygenLevel = 0; m.game.oceans = 0; }), {level, rng: seeded(seed), avoid: new Set(), v2})!.response as {cards: string[]}).cards;
  it('normal v2 buys nothing with 8 cards in hand and never takes the hand past 8', () => {
    expect(HAND_CAP).toEqual({normal: 8, easy: 6, jev: 8});
    expect(bought('normal', 8, 1, true)).toEqual([]);
    expect(bought('normal', 10, 1, true)).toEqual([]);
    expect(bought('normal', 7, 1, true).length).toBeLessThanOrEqual(1);
    expect(bought('normal', 2, 1, true).length).toBeGreaterThan(0);
  });
  it('normal v3 counts only cards it may still play, and never holds more than 14', () => {
    expect(HAND_CAP_V3).toEqual({live: 10, all: 14});
    expect(bought('normal', 14)).toEqual([]);
    expect(bought('normal', 12).length).toBeLessThanOrEqual(2);
    expect(bought('normal', 2).length).toBeGreaterThan(0);
  });
  it('easy buys nothing with 6 cards in hand', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(bought('easy', 6, seed)).toEqual([]);
      expect(bought('easy', 5, seed).length).toBeLessThanOrEqual(1);
    }
  });
  it('easy plays an affordable card most turns instead of hoarding', () => {
    const w = menu([projectCards([{name: 'Mine', calculatedCost: 4}]), opt('Convert 8 heat into temperature'), opt('End Turn'), opt('Pass for this generation')]);
    let plays = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const d = decide(w, model((m) => { m.thisPlayer.heat = 8; m.game.temperature = -20; }), easy(seed))!;
      if ((d.response as {index: number}).index === 0) plays++;
    }
    expect(plays).toBeGreaterThan(70);
  });
});

describe('questions no answer can satisfy', () => {
  const emptyDraft: PlayerInputModel = {type: 'card', title: 'Select a card to keep and pass the rest to ${0}', buttonLabel: 'Select', cards: [], min: 1, max: 1, selectBlueCardAction: false, showOwner: false};
  it('spots an empty hand that requires a card, and nothing else', () => {
    expect(deadEndReason(emptyDraft)).toBe('no cards are left to deal');
    expect(deadEndReason({...emptyDraft, cards: [{name: 'Mine'}], min: 2})).toBe('only 1 of the 2 required cards are offered');
    expect(deadEndReason({...emptyDraft, min: 0})).toBeNull();
    expect(deadEndReason({...emptyDraft, optional: true})).toBeNull();
    expect(deadEndReason({type: 'or', title: '', buttonLabel: '', options: [emptyDraft, opt('Pass')]})).toBeNull();
    expect(deadEndReason({type: 'or', title: '', buttonLabel: '', options: [emptyDraft]})).toBe('no cards are left to deal');
    expect(deadEndReason({type: 'space', title: '', buttonLabel: '', spaces: []})).toBe('there is no space to choose');
    expect(deadEndReason(menu([opt('Pass for this generation')]))).toBeNull();
    expect(deadEndText({player: 'Deimos', reason: 'no cards are left to deal'}).line)
      .toBe('The project cards ran out: Deimos must pick a card, but no cards are left to deal. Open the game menu and abandon this game to start a new one.');
  });
  it('the bridge warns once and tells every device, and repeats it to a device that connects later', async () => {
    const s = (() => {
      const l = lobby(join('a', 'Ana', 'red'), addBot('b1', 'Deimos', 'blue', 'easy'));
      const link = {gameId: 'e1', spectatorId: 's1', players: {a: {engineId: 'pa', color: 'red' as const}, b1: {engineId: 'pb', color: 'blue' as const}}};
      return apply(l, {t: 'start', playerId: 'a', modules: ['base'], order: ['a', 'b1'], mode: 'full', link}).state;
    })();
    const sent: Array<{ws: string; msg: {type: string}}> = [];
    const sockets = ['phone', 'tv'] as unknown as import('ws').WebSocket[];
    const engine = {spectator: async () => { throw new Error('no engine'); }, player: async () => { throw new Error('no engine'); }, logs: async () => []} as unknown as EngineClient;
    const bridge = new FullBridge(engine, () => s, () => sockets, (ws, msg) => sent.push({ws: ws as unknown as string, msg}), 60000);
    bridge.stop();
    const warn = console.warn; const warned: string[] = []; console.warn = (m: string) => warned.push(m);
    try {
      const m = model((x) => { x.waitingFor = emptyDraft; x.game.phase = 'drafting'; x.game.generation = 17; });
      bridge.checkDeadEnd('b1', m);
      bridge.checkDeadEnd('b1', m);
    } finally { console.warn = warn; }
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/cannot continue: Deimos is asked .* but no cards are left to deal \(generation 17, phase drafting\)/);
    expect(sent.filter((x) => x.msg.type === 'deadEnd').map((x) => x.ws)).toEqual(['phone', 'tv']);
    expect(bridge.deadEnd).toMatchObject({gameId: 'e1', player: 'Deimos', reason: 'no cards are left to deal'});
    sent.length = 0;
    bridge.hello('late' as unknown as import('ws').WebSocket, {role: 'tv', playerId: null});
    expect(sent.some((x) => x.ws === 'late' && x.msg.type === 'deadEnd')).toBe(true);
  });
  it('a bot on such a question reports it once and sends nothing to the engine', async () => {
    const m = model();
    const inputs: InputResponse[] = [];
    const reported: string[] = [];
    const log: BotLogEntry[] = [];
    const desk = new BotDesk({
      player: async () => ({...m, waitingFor: {type: 'card', title: 'Select a card to keep and pass the rest to ${0}', buttonLabel: '', cards: [], min: 1, max: 1, selectBlueCardAction: false, showOwner: false}}),
      table: () => ({gameId: 'e1', bots: [{playerId: 'b1', name: 'Deimos', level: 'easy', engineId: 'pb', color: m.thisPlayer.color}]}),
      input: async (_id, r) => { inputs.push(r); },
      delayScale: 0, tickMs: 30, rng: seeded(2), log: (e) => log.push(e), onDeadEnd: (id) => reported.push(id),
    });
    desk.kick();
    await new Promise((r) => setTimeout(r, 400));
    desk.stop();
    expect(inputs).toEqual([]);
    expect(reported).toEqual(['b1']);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({outcome: 'stuck', error: 'no answer exists: no cards are left to deal'});
  });
});
