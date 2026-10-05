// "Show VP changes" in the Log tab. The log has no VP in it: the phone keeps the VP of every player from each view it
// receives (the engine's own victoryPointsBreakdown), tied to the last log line that view had. A move's VP change is the
// difference between the state just before its first line and the state just after its last, read from those
// snapshots, never guessed. When the phone did not see a state at one of those two places (it loaded in the middle of
// the move, or two moves came in one update), the change is not known and nothing is shown.
import type {Color, LogLine, PlayerViewModel} from '../../../shared/full';
import {changesGame, lineKey} from './logMoves';
import type {LogEntry, Seg} from './logMoves';

type Move = Extract<LogEntry, {kind: 'move'}>;

/** Each player's VP total and the part of it that comes from award standings (not final until the game ends). */
export type VpAt = Record<string, {total: number; awards: number}>;

export type VpChange = {color: Color; vp: number; awards: number};

/** The VP of every player in this view, or null when the engine does not send them. */
export function vpSnapshot(model: PlayerViewModel): VpAt | null {
  const out: VpAt = {};
  for (const p of model.players) {
    const b = p.victoryPointsBreakdown;
    if (!b || typeof b.total !== 'number') return null;
    out[p.color] = {total: b.total, awards: b.awards ?? 0};
  }
  return Object.keys(out).length ? out : null;
}

/**
 * What a move did to everyone's VP: the mover first, then the others. `[]` when the phone saw both states and nothing
 * changed; null when it did not see them.
 */
export function moveVp(m: Move, lines: LogLine[], index: Map<string, number>, snaps: Map<string, VpAt>): VpChange[] | null {
  const head = index.get(lineKey(m.head));
  if (head === undefined) return null;
  const lastLine = m.lines.length ? m.lines[m.lines.length - 1] : m.head;
  const last = index.get(lineKey(lastLine));
  if (last === undefined) return null;
  let before: VpAt | null = null;
  for (let i = head - 1; i >= 0; i--) {
    const s = snaps.get(lineKey(lines[i]));
    if (s) { before = s; break; }
    if (changesGame(lines[i])) return null;
  }
  let after: VpAt | null = snaps.get(lineKey(lines[last])) ?? null;
  for (let j = last + 1; !after && j < lines.length; j++) {
    if (changesGame(lines[j])) return null;
    after = snaps.get(lineKey(lines[j])) ?? null;
  }
  if (!before || !after) return null;
  const out: VpChange[] = [];
  for (const color of Object.keys(after) as Color[]) {
    const b = before[color], a = after[color];
    if (!b) continue;
    const awards = a.awards - b.awards;
    const vp = a.total - b.total - awards;
    if (vp || awards) out.push({color, vp, awards});
  }
  return out.sort((x, y) => Number(y.color === m.by) - Number(x.color === m.by));
}

const signed = (n: number) => (n < 0 ? `\u2212${-n}` : n > 0 ? `+${n}` : '0');

/** Position of each line in the history, by its key. */
export function indexLines(lines: LogLine[]): Map<string, number> {
  const out = new Map<string, number>();
  lines.forEach((l, i) => out.set(lineKey(l), i));
  return out;
}

/** One player's change in words: "+1 VP", "-1 VP", "+5 VP from award standings (not final)". */
function words(c: {vp: number; awards: number}): string {
  const parts: string[] = [];
  if (c.vp || !c.awards) parts.push(`${signed(c.vp)} VP`);
  if (c.awards) parts.push(`${signed(c.awards)} VP from award standings (not final)`);
  return parts.join(', ');
}

/** "+1 VP, then Orin -1 VP": the mover's change first (0 VP when only others changed), then each other player's. "No VP change" when none. */
export function vpSegs(changes: VpChange[], by: Color): Seg[] {
  if (!changes.length) return [{t: 'text', v: 'No VP change'}];
  const mine = changes.find((c) => c.color === by) ?? {color: by, vp: 0, awards: 0};
  const out: Seg[] = [{t: 'text', v: words(mine)}];
  for (const c of changes) {
    if (c.color === by) continue;
    out.push({t: 'text', v: ' \u00b7 '}, {t: 'player', color: c.color}, {t: 'text', v: ` ${words(c)}`});
  }
  return out;
}

/** The tone of the mover's part: gain, loss or neutral. */
export function vpTone(changes: VpChange[], by: Color): 'gain' | 'loss' | 'none' {
  const mine = changes.find((c) => c.color === by);
  return !mine ? 'none' : mine.vp > 0 ? 'gain' : mine.vp < 0 ? 'loss' : 'none';
}
