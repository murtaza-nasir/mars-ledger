// "Show VP changes" in the log: a move's VP change is the difference between the states the phone saw just before its
// first line and just after its last (logVp.ts), taken on real engine logs (the fixtures of logMoves.test.ts).
import {describe, expect, it} from 'vitest';
import type {Color, LogLine, PlayerViewModel} from '../src/shared/full';
import {groupLog, headline, lineKey, plain} from '../src/client/phone/full/logMoves';
import type {LogEntry} from '../src/client/phone/full/logMoves';
import {indexLines, moveVp, vpSegs, vpSnapshot} from '../src/client/phone/full/logVp';
import type {VpAt} from '../src/client/phone/full/logVp';
import g2 from './fixtures/logmoves/g2-full.json';

type Fixture = {seat: Color | null; lines: LogLine[]};
const G2 = g2 as unknown as Fixture;
type Move = Extract<LogEntry, {kind: 'move'}>;
const NAMES: Record<string, string> = {red: 'Ada', blue: 'Kepler', green: 'Ares'};
const nm = (c: Color) => NAMES[c] ?? c;
const text = (segs: ReturnType<typeof vpSegs>) => plain(segs, nm);

const lines = G2.lines;
const entries = groupLog(lines, G2.seat, 9);
const moves = entries.filter((e): e is Move => e.kind === 'move' && e.lines.length > 0);
const index = indexLines(lines);
const at = (l: LogLine) => index.get(lineKey(l))!;
/** A move with an ordinary line before it. */
const m = moves.find((x) => at(x.head) > 2 && !/^\$\{0\} (passed|ended)/.test(lines[at(x.head) - 1].message))!;
const lastOf = (x: Move) => x.lines[x.lines.length - 1];
const other = (['red', 'blue', 'green'] as Color[]).find((c) => c !== m.by)!;

const vp = (a: number, b: number, awardsMover = 0): VpAt => ({
  [m.by]: {total: a, awards: awardsMover}, [other]: {total: b, awards: 0},
});

describe('a move\'s VP change from two states', () => {
  const snaps = (before: VpAt | null, after: VpAt | null) => {
    const s = new Map<string, VpAt>();
    if (before) s.set(lineKey(lines[at(m.head) - 1]), before);
    if (after) s.set(lineKey(lastOf(m)), after);
    return s;
  };

  it('the mover gains and another player loses: "+1 VP · Kepler −1 VP", the mover first', () => {
    const c = moveVp(m, lines, index, snaps(vp(20, 21), vp(21, 20)))!;
    expect(c).toEqual([{color: m.by, vp: 1, awards: 0}, {color: other, vp: -1, awards: 0}]);
    expect(text(vpSegs(c, m.by))).toBe(`+1 VP · ${nm(other)} −1 VP`);
  });

  it('only another player changes: the mover reads 0 VP', () => {
    const c = moveVp(m, lines, index, snaps(vp(20, 21), vp(20, 22)))!;
    expect(text(vpSegs(c, m.by))).toBe(`0 VP · ${nm(other)} +1 VP`);
  });

  it('nothing changes: No VP change, and it is known (not null)', () => {
    const c = moveVp(m, lines, index, snaps(vp(20, 21), vp(20, 21)));
    expect(c).toEqual([]);
    expect(text(vpSegs(c!, m.by))).toBe('No VP change');
  });

  it('award standings are kept apart and marked as not final', () => {
    const c = moveVp(m, lines, index, snaps(vp(20, 21), vp(25, 21, 5)))!;
    expect(c).toEqual([{color: m.by, vp: 0, awards: 5}]);
    expect(text(vpSegs(c, m.by))).toBe('+5 VP from award standings (not final)');
    const both = moveVp(m, lines, index, snaps(vp(20, 21), vp(26, 21, 5)))!;
    expect(text(vpSegs(both, m.by))).toBe('+1 VP, +5 VP from award standings (not final)');
  });

  it('is not known when the phone did not see the state before or after', () => {
    expect(moveVp(m, lines, index, snaps(null, vp(21, 20)))).toBeNull();
    expect(moveVp(m, lines, index, snaps(vp(20, 21), null))).toBeNull();
  });

  it('is not known when another change sits between the last state seen and the move', () => {
    const i = at(m.head);
    // a snapshot two lines earlier, with a line that changes the game in between
    const effect = lines.findIndex((l, k) => k < i - 1 && /^\$\{0\} (gained|placed|drew)/.test(l.message) && k > 0);
    if (effect < 0) return;
    const s = new Map<string, VpAt>();
    s.set(lineKey(lines[effect - 1]), vp(20, 21));
    s.set(lineKey(lastOf(m)), vp(21, 21));
    // everything from the snapshot to the head must be quiet for the change to be trusted
    const quiet = lines.slice(effect, i).every((l) => !/^\$\{0\} (gained|lost|placed|drew|played|used)/.test(l.message));
    if (!quiet) expect(moveVp(m, lines, index, s)).toBeNull();
  });

  it('takes the state after the move from a later quiet line (a turn end), not from another move', () => {
    const s = new Map<string, VpAt>();
    s.set(lineKey(lines[at(m.head) - 1]), vp(20, 21));
    const k = at(lastOf(m));
    const next = lines[k + 1];
    if (next && /^\$\{0\} (passed|ended turn)$/.test(next.message)) {
      s.set(lineKey(next), vp(22, 21));
      expect(moveVp(m, lines, index, s)).toEqual([{color: m.by, vp: 2, awards: 0}]);
    }
    // the next line is another move's: its state is not this move's
    const second = moves.find((x) => at(x.head) === k + 1);
    if (second) {
      const t = new Map<string, VpAt>();
      t.set(lineKey(lines[at(m.head) - 1]), vp(20, 21));
      t.set(lineKey(lastOf(second)), vp(22, 21));
      expect(moveVp(m, lines, index, t)).toBeNull();
    }
  });
});

describe('the VP snapshot of a view', () => {
  const player = (color: string, total: number, awards = 0) => ({color, victoryPointsBreakdown: {total, awards, terraformRating: 20, milestones: 0, greenery: 0, city: 0, victoryPoints: 0}});
  it('reads every player\'s total and award part', () => {
    const model = {players: [player('red', 23, 5), player('blue', 21)]} as unknown as PlayerViewModel;
    expect(vpSnapshot(model)).toEqual({red: {total: 23, awards: 5}, blue: {total: 21, awards: 0}});
  });
  it('is null when the engine does not send VP', () => {
    const model = {players: [{color: 'red'}, player('blue', 21)]} as unknown as PlayerViewModel;
    expect(vpSnapshot(model)).toBeNull();
  });
  it('heads of moves are unchanged by it (the headline still reads)', () => {
    expect(plain(headline(m), nm)).toMatch(/\w/);
  });
});
