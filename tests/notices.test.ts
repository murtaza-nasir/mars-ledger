// Table sense: notices for one seat from consecutive engine views and the update's log lines.
import {describe, expect, it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {groupTitle, newLogLines, noticesFor, noticeText} from '../src/shared/notices';
import type {Notice, NoticeFeed} from '../src/shared/notices';
import type {LogLine, PlayerViewModel} from '../src/shared/full';
import {NoticeDesk} from '../src/server/notices';
import playerAction from './fixtures/full/player-action.json';

// Ada (red) is the seat; Kepler (blue, a bot) is the other player.
const base = playerAction as unknown as PlayerViewModel;
function view(edit?: (v: PlayerViewModel) => void): PlayerViewModel {
  const v = structuredClone(base);
  v.players[1].name = 'Kepler';
  v.thisPlayer = v.players[0];
  v.dealtProjectCards = [];
  if (edit) edit(v);
  v.thisPlayer = v.players[0];
  return v;
}
/** The next moment: one gameAge on, with `edit` applied. */
const after = (prev: PlayerViewModel, edit: (v: PlayerViewModel) => void) => {
  const v = structuredClone(prev);
  v.game.gameAge += 1;
  edit(v);
  v.thisPlayer = v.players[0];
  return v;
};
const red = (v: PlayerViewModel) => v.players[0];
const blue = (v: PlayerViewModel) => v.players[1];

let clock = 1000;
type D = [number, string];
const P = (c: string): D => [2, c];
const C = (c: string): D => [3, c];
const S = (s: string): D => [0, s];
const N = (n: number): D => [1, String(n)];
const line = (message: string, ...data: D[]): LogLine => ({message, data: data.map(([type, value]) => ({type, value})), timestamp: ++clock});
const ctx = {gameId: 'g1', playerId: 'm', at: 5000};
const run = (prev: PlayerViewModel, next: PlayerViewModel, lines: LogLine[], before: LogLine[] = []) => noticesFor(null, null, prev, next, {lines, before}, ctx);

describe('hits', () => {
  it('names the attacker and the card: a steal', () => {
    const prev = view((v) => { red(v).megacredits = 10; v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).megacredits = 7; blue(v).megacredits += 3; });
    const ns = run(prev, next, [line('${0} played ${1}', P('blue'), C('Hired Raiders')), line('${3} stole ${1} ${2} from ${0}', P('red'), N(3), S('M€'), P('blue'))]);
    expect(ns).toHaveLength(1);
    const n = ns[0];
    expect(n).toMatchObject({kind: 'hit', sticky: true, by: 'blue', byName: 'Kepler', cause: {card: 'Hired Raiders', how: 'played'},
      changes: [{what: 'stock', resource: 'megacredits', amount: 3, stolen: true}]});
    expect(noticeText(n).title).toBe('Kepler took 3 M€ with Hired Raiders');
  });

  it('finds the card of a move begun in an earlier update (Asteroid, then its target)', () => {
    const played = line('${0} played ${1}', P('blue'), C('Asteroid'));
    const prev = view((v) => { red(v).plants = 5; v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).plants = 2; });
    const ns = run(prev, next, [line('${0} lost ${1} ${2} because of ${3}', P('red'), N(3), S('plants'), P('blue'))], [played]);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({kind: 'hit', by: 'blue', cause: {card: 'Asteroid'}});
    expect(noticeText(ns[0]).title).toBe('Kepler removed 3 of your plants with Asteroid');
  });

  it('a production loss', () => {
    const prev = view((v) => { red(v).heatProduction = 3; v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).heatProduction = 1; blue(v).energyProduction += 1; });
    const ns = run(prev, next, [
      line('${0} played ${1}', P('blue'), C('Heat Trappers')),
      line('${0} gained ${1} ${2} production', P('blue'), N(1), S('energy')),
      line('${0} lost ${1} ${2} production because of ${3}', P('red'), N(2), S('heat'), P('blue')),
    ]);
    expect(ns.map((n) => n.kind)).toEqual(['hit']);
    expect(ns[0].changes).toEqual([{what: 'production', resource: 'heat', amount: 2, stolen: false}]);
    expect(noticeText(ns[0]).title).toBe('Kepler lowered your heat production by 2 with Heat Trappers');
  });

  it('a stolen production step, from a bot\'s move', () => {
    const prev = view((v) => { red(v).energyProduction = 2; v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).energyProduction = 1; blue(v).energyProduction += 1; });
    const ns = run(prev, next, [line('${0} played ${1}', P('blue'), C('Energy Tapping')), line('${3} stole ${1} ${2} production from ${0}', P('red'), N(1), S('energy'), P('blue'))]);
    expect(noticeText(ns[0]).title).toBe('Kepler took 1 of your energy production with Energy Tapping');
  });

  it('resources taken off one of your cards, and several losses at once', () => {
    const prev = view((v) => { red(v).tableau.push({name: 'Birds', resources: 2}); red(v).plants = 4; v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).tableau.find((c) => c.name === 'Birds')!.resources = 0; red(v).plants = 0; });
    const ns = run(prev, next, [line('${0} played ${1}', P('blue'), C('Virus')),
      line('${0} removed ${1} resource(s) from ${2}\'s ${3}', P('blue'), N(2), P('red'), C('Birds')),
      line('${0} lost ${1} ${2} because of ${3}', P('red'), N(4), S('plants'), P('blue'))]);
    expect(ns).toHaveLength(1);
    expect(noticeText(ns[0])).toEqual({title: 'Kepler hit you with Virus', detail: 'You lost 4 plants and 2 animals on your Birds'});
  });

  it('says what was lost without a name when the log does not say who', () => {
    const prev = view((v) => { red(v).plants = 4; v.players.forEach((p) => { p.isActive = false; }); });
    const next = after(prev, (v) => { red(v).plants = 1; });
    // two other players moved in one update and no line is about Ada
    const ns = noticesFor(null, null, prev, next, {lines: [line('${0} played ${1}', P('blue'), C('Comet')), line('${0} played ${1}', P('green'), C('Asteroid'))]}, ctx);
    expect(ns[0]).toMatchObject({kind: 'hit', by: null, cause: null});
    expect(noticeText(ns[0]).title).toBe('You lost 3 plants');
  });
});

describe('cards in and out of the hand', () => {
  it('cards drawn by the seat\'s own action, with the card that drew them', () => {
    const prev = view((v) => { v.players.forEach((p) => { p.isActive = p.color === 'red'; }); });
    const next = after(prev, (v) => { v.cardsInHand = [...v.cardsInHand, {name: 'Comet'}]; red(v).energy -= 1; });
    const ns = run(prev, next, [line('${0} used ${1} action', P('red'), C('Development Center')), line('${0} ${1} ${2} card(s)', P('red'), S('drew'), N(1)),
      {...line('${0} drew ${1}', S('You'), [14, 'Comet']), playerId: 'p-red'}]);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({kind: 'cards', self: true, cardsIn: ['Comet'], cardsOut: [], cause: {card: 'Development Center', how: 'used'}});
    expect(noticeText(ns[0])).toEqual({title: 'You drew 1 card', detail: 'With Development Center'});
  });

  it('no notice for the seat\'s own play, its own costs, or research purchases', () => {
    const prev = view((v) => { red(v).megacredits = 30; v.players.forEach((p) => { p.isActive = p.color === 'red'; }); });
    const next = after(prev, (v) => {
      v.cardsInHand = v.cardsInHand.filter((c) => c.name !== 'Big Asteroid');
      red(v).megacredits = 3; red(v).tableau.push({name: 'Big Asteroid'}); v.game.temperature += 4;
    });
    expect(run(prev, next, [line('${0} played ${1}', P('red'), C('Big Asteroid'))])).toEqual([]);
    // a card's cost taken at its first question, before any log line
    const paying = after(prev, (v) => { red(v).megacredits = 10; });
    expect(run(prev, paying, [])).toEqual([]);
    // research: the bought cards were on offer
    const research = view((v) => { v.game.phase = 'research'; v.dealtProjectCards = [{name: 'Comet'}, {name: 'Birds'}]; });
    const bought = after(research, (v) => { v.cardsInHand = [...v.cardsInHand, {name: 'Comet'}]; red(v).megacredits -= 3; v.dealtProjectCards = []; });
    expect(run(research, bought, [line('${0} ${1} ${2} card(s)', P('red'), S('bought'), N(1))])).toEqual([]);
  });
});

describe('gifts', () => {
  it('another player\'s move adds an animal to your Pets', () => {
    const prev = view((v) => { red(v).tableau.push({name: 'Pets', resources: 1}); v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).tableau.find((c) => c.name === 'Pets')!.resources = 2; blue(v).megacredits -= 25; });
    const ns = run(prev, next, [line('${0} used ${1} standard project', P('blue'), C('City:SP')),
      line('${0} ${1} ${2} at ${3}', P('blue'), S('placed'), S('city tile'), [13, '23']),
      line('${0} added ${1} ${2} to ${3}', P('red'), N(1), S('Animal'), C('Pets'))]);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({kind: 'gift', sticky: false, by: 'blue', cause: {card: 'City:SP', how: 'project'}, changes: [{what: 'card', card: 'Pets', amount: 1}]});
    expect(noticeText(ns[0])).toEqual({title: 'You gained 1 animal on your Pets', detail: 'When Kepler used the City standard project'});
  });

  it('never during production (the production show tells it)', () => {
    const prev = view();
    const next = after(prev, (v) => { v.game.generation += 1; red(v).megacredits += 30; });
    expect(run(prev, next, [])).toEqual([]);
  });
});

describe('log windows and grouping', () => {
  it('reads only the new lines of a sliding window', () => {
    const a = line('${0} passed', P('red')); const b = line('${0} passed', P('blue')); const c = line('${0} played ${1}', P('blue'), C('Comet'));
    expect(newLogLines([a, b], [a, b, c])).toEqual([c]);
    expect(newLogLines([a, b], [b, c])).toEqual([c]);
    expect(newLogLines([], [a])).toEqual([a]);
  });
  it('groups draws arriving together', () => {
    const n = (k: number) => ({kind: 'cards', cardsIn: Array.from({length: k}, (_, i) => `c${i}`), cardsOut: []}) as unknown as Notice;
    expect(groupTitle([n(1), n(2)])).toBe('You drew 3 cards');
  });
});

describe('the desk: stored per seat, cleared, undone', () => {
  const desk = () => {
    const told: Array<{playerId: string; feed: NoticeFeed; fresh: string[]}> = [];
    const d = new NoticeDesk(new DatabaseSync(':memory:'), (playerId, feed, fresh) => told.push({playerId, feed, fresh}));
    return {d, told};
  };
  const hitViews = () => {
    const prev = view((v) => { red(v).plants = 5; v.players.forEach((p) => { p.isActive = p.color === 'blue'; }); });
    const next = after(prev, (v) => { red(v).plants = 2; });
    const lines = [line('${0} played ${1}', P('blue'), C('Asteroid')), line('${0} lost ${1} ${2} because of ${3}', P('red'), N(3), S('plants'), P('blue'))];
    return {prev, next, lines};
  };

  it('keeps hits until cleared, and an undo takes back the notices of undone moves', () => {
    const {d, told} = desk();
    const {prev, next, lines} = hitViews();
    d.observe('g1', null, [{playerId: 'm', model: prev, logs: []}], 1);
    expect(told).toHaveLength(0); // first sight only sets the baseline
    d.observe('g1', null, [{playerId: 'm', model: next, logs: lines}], 2);
    expect(told).toHaveLength(1);
    expect(told[0].fresh).toHaveLength(1);
    expect(d.feed('g1', 'm').notices.map((n) => [n.kind, n.cleared])).toEqual([['hit', false]]);
    d.clear('g1', 'm', [told[0].fresh[0]]);
    expect(d.feed('g1', 'm').notices[0].cleared).toBe(true);
    // Kepler undoes the Asteroid: the engine goes back to the earlier moment (undoCount rises, gameAge falls)
    const undone = structuredClone(prev);
    undone.game.undoCount += 1;
    d.observe('g1', null, [{playerId: 'm', model: undone, logs: []}], 3);
    expect(d.feed('g1', 'm').notices).toEqual([]);
    expect(told.at(-1)!.feed.notices).toEqual([]);
  });

  it('keeps notices of moments at or before the undo target', () => {
    const {d} = desk();
    const {prev, next, lines} = hitViews();
    d.observe('g1', null, [{playerId: 'm', model: prev, logs: []}], 1);
    d.observe('g1', null, [{playerId: 'm', model: next, logs: lines}], 2);
    const later = after(next, (v) => { v.game.undoCount += 0; });
    d.observe('g1', null, [{playerId: 'm', model: later, logs: lines}], 3);
    const back = structuredClone(next);
    back.game.undoCount += 1;
    d.observe('g1', null, [{playerId: 'm', model: back, logs: lines}], 4);
    expect(d.feed('g1', 'm').notices.map((n) => n.age)).toEqual([next.game.gameAge]);
  });

  it('remembers when the feed was read, per seat and game', () => {
    const {d} = desk();
    d.seen('g1', 'm', 50);
    d.seen('g1', 'm', 20);
    expect(d.feed('g1', 'm').seenAt).toBe(50);
    expect(d.feed('g1', 'other').seenAt).toBe(0);
  });
});
