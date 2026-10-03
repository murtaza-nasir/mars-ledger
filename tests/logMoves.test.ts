// The phone's Log tab reads the engine's log as moves (src/client/phone/full/logMoves.ts). Fixtures are real logs
// from local engine games (tm-engine:41a1b005de73; one seat answered by the soak bot, two normal bots, focus deck):
// the whole game as the red seat saw it, a spectator's log, and the 50-line window a phone actually received.
import {describe, expect, it} from 'vitest';
import type {Color, LogLine} from '../src/shared/full';
import {cardsOfMove, mergeLog, newestFirst, victimOf, groupLog, headline, lineKey, movesWithCard, phrase, plain, RUN_MIN, segments, shownLines, summary} from '../src/client/phone/full/logMoves';
import type {LogEntry} from '../src/client/phone/full/logMoves';
import g1 from './fixtures/logmoves/g1-full.json';
import g2 from './fixtures/logmoves/g2-full.json';
import win from './fixtures/logmoves/g2-window.json';

type Fixture = {seat: Color | null; lines: LogLine[]};
const G1 = g1 as unknown as Fixture;
const G2 = g2 as unknown as Fixture;
const WIN = win as unknown as Fixture;
const NAMES: Record<string, string> = {red: 'Ada', blue: 'Kepler', green: 'Ares'};
const nm = (c: Color) => NAMES[c] ?? c;
type Move = Extract<LogEntry, {kind: 'move'}>;
const moves = (es: LogEntry[]) => es.filter((e): e is Move => e.kind === 'move');
const head = (m: Move) => plain(headline(m), nm);
const sum = (m: Move) => summary(m).map((s) => plain(s, nm)).join(' · ');
const find = (es: LogEntry[], h: string) => {
  const m = moves(es).find((x) => head(x) === h);
  if (!m) throw new Error(`no move "${h}"`);
  return m;
};
/** Every line of the log, in the order the entries hold them. */
function linesOf(es: LogEntry[]): LogLine[] {
  return es.flatMap((e) => (e.kind === 'move' ? [e.head, ...e.lines] : e.kind === 'line' ? [e.line] : e.kind === 'research' || e.kind === 'run' ? e.lines : []));
}
const isHeader = (l: LogLine) => l.message === 'Generation ${0}' || l.message === 'First player this generation is ${0}';
const line = (message: string, data: LogLine['data'], timestamp = 1): LogLine => ({message, data, timestamp});

describe('log moves: grouping real engine logs', () => {
  const es = groupLog(G2.lines, G2.seat, 9);

  it('keeps every line exactly once, in order, on every fixture', () => {
    for (const f of [G1, G2, WIN]) {
      const got = linesOf(groupLog(f.lines, f.seat, 9)).map(lineKey);
      expect(got).toEqual(f.lines.filter((l) => !isHeader(l)).map(lineKey));
    }
  });

  it('starts one move per action line and no other', () => {
    const heads = G2.lines.filter((l) => /^\$\{0\} (played \$\{1\}|used \$\{1\} (action|standard project|standard action)|claimed|funded)/.test(l.message));
    expect(moves(es).map((m) => m.head)).toEqual(heads);
  });

  it('puts an attack on another player under the card that made it', () => {
    expect(sum(find(es, 'Ada played Hired Raiders'))).toBe('took 3 M€ from Kepler');
    expect(sum(find(es, 'Ada played Hackers'))).toBe('+2 M€ production · −1 energy production · took 2 M€ production from Kepler');
    expect(sum(find(es, 'Ada played Deimos Down'))).toBe('+4 steel · +4 M€ · Kepler lost 3 plants');
    expect(sum(find(es, 'Kepler played Biomass Combustors'))).toBe('+2 energy production · Ares lost 1 plant production');
    expect(sum(find(es, 'Ares played Small Animals'))).toBe('Kepler lost 1 plant production');
    const g1es = groupLog(G1.lines, null, 5);
    expect(sum(find(g1es, 'Ada played Sabotage'))).toBe('Kepler lost 7 M€');
    expect(sum(find(g1es, 'Ada played Energy Tapping'))).toBe('took 1 energy production from Kepler');
  });

  it('names the cards drawn by the seat in its own moves, without the count line', () => {
    const convoy = find(es, 'Ada played Large Convoy');
    expect(convoy.lines).toHaveLength(6);
    expect(sum(convoy)).toBe('drew Special Design, Power Grid · +5 plants · +4 M€ · placed an ocean · +1 plant');
    expect(cardsOfMove(convoy)).toEqual(['Large Convoy', 'Special Design', 'Power Grid']);
    expect(sum(find(es, 'Ada played Lagrange Observatory'))).toBe('drew Immigrant City');
    // a spectator sees only the count
    expect(sum(find(groupLog(G1.lines, null, 5), 'Kepler played Flooding'))).toBe('placed an ocean · drew 2 cards');
  });

  it('never gives another seat\'s private lines to a move', () => {
    // the red seat's "You drew …" lines read with blue as the seat: they stand alone
    const asBlue = groupLog(G2.lines, 'blue', 9);
    const convoy = find(asBlue, 'Ada played Large Convoy');
    expect(convoy.lines).toHaveLength(1);
    const alone = asBlue.flatMap((e) => (e.kind === 'line' ? [e.line] : e.kind === 'run' ? e.lines : []));
    expect(alone.map((l) => plain(segments(l), nm))).toContain('You drew Special Design, Power Grid');
  });

  it('tiles, card resources, standard actions, awards and milestones', () => {
    expect(sum(find(es, 'Kepler played Natural Preserve'))).toBe('+1 M€ production · placed the Natural Preserve tile · +1 plant · +1 titanium');
    expect(sum(find(es, 'Ada played Immigrant City'))).toBe('placed a city · +1 M€ production');
    expect(moves(es).filter((m) => head(m) === 'Ares converted plants').map(sum)).toEqual(['placed a greenery · +1 steel', 'placed a greenery', 'placed a greenery · drew 1 card']);
    expect(moves(es).filter((m) => head(m) === 'Ares used the Regolith Eaters action').map(sum)).toEqual(['+1 microbe', '+1 microbe', '−2 microbes from Regolith Eaters', '+1 microbe']);
    expect(sum(find(es, 'Ares played Robotic Workforce'))).toBe('copied Mine production with Robotic Workforce · +1 steel production');
    expect(find(es, 'Ares funded the Banker award').lines).toEqual([]);
    expect(find(es, 'Ares claimed the Builder milestone').card).toBeNull();
    expect(head(find(es, 'Ada used the Asteroid standard project'))).toBe('Ada used the Asteroid standard project');
    expect(find(es, 'Ada used the Asteroid standard project').card).toBe('Asteroid:SP');
    expect(sum(find(groupLog(G1.lines, null, 5), 'Ada played Mining Rights'))).toBe('+1 titanium production · placed the Mining Rights tile · +1 titanium');
  });

  it('passes stand alone; research purchases group per generation', () => {
    const passes = es.filter((e) => e.kind === 'line' && /passed|ended turn/.test(e.line.message));
    expect(passes.length).toBe(G2.lines.filter((l) => /^\$\{0\} (passed|ended turn)$/.test(l.message)).length);
    const research = es.filter((e): e is Extract<LogEntry, {kind: 'research'}> => e.kind === 'research');
    expect(research.map((r) => r.generation)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // the seat's count line gives way to its private line naming the cards
    expect(shownLines(research[0].lines, 'red').map((l) => plain(segments(l), nm))).toEqual(['You bought Deimos Down', 'Ares bought 2 cards', 'Kepler bought 1 card']);
  });

  it('generation dividers carry who goes first; every entry knows its generation', () => {
    const gens = es.filter((e): e is Extract<LogEntry, {kind: 'generation'}> => e.kind === 'generation');
    expect(gens.map((g) => [g.generation, g.first])).toEqual([[1, 'red'], [2, 'blue'], [3, 'green'], [4, 'red'], [5, 'blue'], [6, 'green'], [7, 'red'], [8, 'blue'], [9, 'green']]);
    expect(find(es, 'Ada played Tropical Resort').generation).toBe(8);
  });

  it('a 50-line window: lines before the first header belong to the generation before it', () => {
    const w = groupLog(WIN.lines, WIN.seat, 9);
    expect(w[0]).toMatchObject({kind: 'move', generation: 7});
    expect(head(w[0] as Move)).toBe('Ares funded the Banker award');
    expect(find(w, 'Ada played Tropical Resort').generation).toBe(8);
    // no header in the window at all: the current generation
    const tail = WIN.lines.slice(-4);
    expect(groupLog(tail, 'red', 9).every((e) => e.kind === 'generation' || ('generation' in e && e.generation === 9))).toBe(true);
  });

  it('newest first: each generation\'s divider above its entries, and one for the lines before the first header', () => {
    const rows = newestFirst(groupLog(WIN.lines, WIN.seat, 9));
    const gens = rows.flatMap((e, i) => (e.kind === 'generation' ? [[i, e.generation]] : []));
    expect(gens.map((g) => g[1])).toEqual([9, 8, 7]);
    expect(gens[0][0]).toBe(0);
    // under each divider, only entries of that generation, newest first
    for (let k = 0; k < gens.length; k++) {
      const part = rows.slice(gens[k][0] + 1, k + 1 < gens.length ? gens[k + 1][0] : rows.length);
      expect(part.every((e) => e.kind !== 'generation' && e.generation === gens[k][1])).toBe(true);
    }
    expect(head(rows[rows.length - 1] as Move)).toBe('Ares funded the Banker award');
    // the setup lines before "Generation 1" get no divider of their own
    const start = newestFirst(groupLog(G2.lines.slice(0, 12), 'red', 1));
    expect(start.filter((e) => e.kind === 'generation').map((e) => e.key.startsWith('g:before'))).toEqual([false]);
    // a window with no header gets no divider
    expect(newestFirst(groupLog(WIN.lines.slice(-4), 'red', 9)).some((e) => e.kind === 'generation')).toBe(false);
  });

  it('keys stay the same as the window slides', () => {
    const a = groupLog(WIN.lines.slice(0, 40), 'red', 9);
    const b = groupLog(WIN.lines.slice(6), 'red', 9);
    const keyOf = (es2: LogEntry[], h: string) => find(es2, h).key;
    expect(keyOf(a, 'Ada played Tropical Resort')).toBe(keyOf(b, 'Ada played Tropical Resort'));
    expect(keyOf(a, 'Kepler played Biomass Combustors')).toBe(keyOf(b, 'Kepler played Biomass Combustors'));
  });

  it('marks the lines that hurt another player', () => {
    const hurt = (h: string) => { const m = find(es, h); return m.lines.map((l) => victimOf(l, m.by)).filter(Boolean); };
    expect(hurt('Ada played Hired Raiders')).toEqual(['blue']);
    expect(hurt('Kepler played Biomass Combustors')).toEqual(['green']);
    expect(hurt('Ares played Great Escarpment Consortium')).toEqual([]); // took from itself
    expect(hurt('Ares used the Regolith Eaters action')).toEqual([]); // its own card
    expect(hurt('Ada played Large Convoy')).toEqual([]);
  });

  it('finds every move a card was in', () => {
    expect(movesWithCard(es, 'Regolith Eaters').map(head)).toEqual(['Ares played Regolith Eaters', ...Array(4).fill('Ares used the Regolith Eaters action')]);
    expect(movesWithCard(es, 'Immigrant City').map(head)).toEqual(['Ada played Lagrange Observatory', 'Ada played Immigrant City']);
  });
});

describe('log moves: falling back', () => {
  const P = (c: Color) => ({type: 2, value: c});
  const N = (n: number) => ({type: 1, value: String(n)});
  const S = (s: string) => ({type: 0, value: s});
  const Cd = (s: string) => ({type: 3, value: s});

  it('a line it does not know ends the move; what follows stands alone', () => {
    const lines = [
      line('${0} played ${1}', [P('red'), Cd('Asteroid')]),
      line('${0} gained ${1} ${2}', [P('red'), N(2), S('titanium')]),
      line('${0} did something new with ${1}', [P('red'), Cd('Asteroid')]),
      line('${0} gained ${1} ${2}', [P('red'), N(1), S('heat')]),
    ];
    const es = groupLog(lines, 'red', 3);
    expect(es.map((e) => e.kind)).toEqual(['move', 'line', 'line']);
    expect((es[0] as Move).lines).toHaveLength(1);
  });

  it('consequence lines with no move before them (cut off by the window) stand alone', () => {
    const es = groupLog([line('${0} gained ${1} ${2}', [P('blue'), N(1), S('plant')]), line('${0} played ${1}', [P('blue'), Cd('Lichen')])], 'red', 3);
    expect(es.map((e) => e.kind)).toEqual(['line', 'move']);
  });

  it(`${RUN_MIN} or more lines standing alone in a row fold into one run`, () => {
    const odd = (k: number) => line('${0} did something new', [P('red')], k);
    expect(groupLog([odd(1), odd(2), odd(3)], 'red', 2).map((e) => e.kind)).toEqual(['line', 'line', 'line']);
    const es = groupLog([odd(1), odd(2), odd(3), odd(4), odd(5)], 'red', 2);
    expect(es.map((e) => e.kind)).toEqual(['run']);
    expect((es[0] as Extract<LogEntry, {kind: 'run'}>).lines).toHaveLength(5);
  });

  it('identical lines in one millisecond still get their own keys', () => {
    const l = line('${0} passed', [P('red')], 5);
    const es = groupLog([l, {...l}], 'red', 2);
    expect(new Set(es.map((e) => e.key)).size).toBe(2);
  });

  it('phrases from the mover\'s side, keeping other players\' names', () => {
    const steal = line('${3} stole ${1} ${2} production from ${0}', [P('red'), N(1), S('plant'), P('blue')]);
    expect(plain(phrase(steal, 'blue', 'Herbivores'), nm)).toBe('took 1 plant production from Ada');
    expect(plain(phrase(steal, 'green', null), nm)).toBe('Kepler stole 1 plant production from Ada');
    const pets = line('${0} added ${1} ${2} to ${3}', [P('blue'), N(1), S('Animal'), Cd('Pets')]);
    expect(plain(phrase(pets, 'red', 'Immigrant City'), nm)).toBe('Kepler +1 animal on Pets');
    expect(plain(phrase(line('${0} ${1} ${2} at ${3}', [P('red'), S('placed'), S('ocean tile'), {type: 13, value: '13'}]), 'red', null), nm)).toBe('placed an ocean');
  });
});

describe('log moves: the phone\'s history', () => {
  const L = G2.lines;
  it('appends a sliding window and keeps what dropped off its start', () => {
    let acc = mergeLog([], L.slice(0, 50));
    acc = mergeLog(acc, L.slice(10, 60));
    acc = mergeLog(acc, L.slice(30, 80));
    expect(acc.map(lineKey)).toEqual(L.slice(0, 80).map(lineKey));
  });
  it('returns the same array when nothing changed', () => {
    const acc = mergeLog([], L.slice(0, 50));
    expect(mergeLog(acc, L.slice(0, 50))).toBe(acc);
    expect(mergeLog(acc, L.slice(0, 50).map((l) => ({...l})))).toBe(acc);
  });
  it('an undo removes the undone lines', () => {
    let acc = mergeLog([], L.slice(0, 50));
    acc = mergeLog(acc, L.slice(20, 70));
    // the engine went back: its window now ends at line 64, starting further back
    acc = mergeLog(acc, L.slice(14, 64));
    expect(acc.map(lineKey)).toEqual(L.slice(0, 64).map(lineKey));
    // and the new lines after the undo come in
    const fresh = line('${0} passed', [{type: 2, value: 'red'}], 99);
    acc = mergeLog(acc, [...L.slice(15, 64), fresh]);
    expect(acc.map(lineKey)).toEqual([...L.slice(0, 64), fresh].map(lineKey));
  });
  it('a window that starts nowhere in the history replaces it (missed lines, a new game)', () => {
    const acc = mergeLog([], L.slice(0, 50));
    expect(mergeLog(acc, L.slice(120, 170)).map(lineKey)).toEqual(L.slice(120, 170).map(lineKey));
    expect(mergeLog(acc, [])).toEqual([]);
  });
  it('identical lines in a row do not duplicate', () => {
    const a = line('${0} gained ${1} ${2}', [{type: 2, value: 'red'}, {type: 1, value: '1'}, {type: 0, value: 'plant'}], 7);
    const b = line('${0} passed', [{type: 2, value: 'red'}], 8);
    const acc = mergeLog([], [a, {...a}]);
    expect(mergeLog(acc, [{...a}, {...a}, b]).map(lineKey)).toEqual([a, a, b].map(lineKey));
    expect(mergeLog(acc, [{...a}, b]).map(lineKey)).toEqual([a, a, b].map(lineKey));
  });
  it('keeps at most the newest HISTORY_MAX lines', () => {
    let acc: LogLine[] = [];
    for (let i = 0; i + 50 <= L.length; i += 25) acc = mergeLog(acc, L.slice(i, i + 50), 100);
    expect(acc).toHaveLength(100);
    expect(lineKey(acc[acc.length - 1])).toBe(lineKey(L[L.length - 1 - ((L.length - 50) % 25)]));
  });
});
