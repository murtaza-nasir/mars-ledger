// The phone's Log tab, read as moves. The engine's log has no move ids: each action starts with one line ("Kepler
// played Herbivores", "Kepler used Regolith Eaters action", "Kepler used Aquifer standard project", a claim or a funding),
// and the lines the action caused follow it at once (gains and losses, tiles, draws, resources on cards, other
// players' cards reacting). A move is that first line plus the known consequence lines after it. Anything this file
// does not recognise ends the move and stands on its own: a line shown alone is better than a line put in the wrong
// move. Pure: no React, no store; tests/logMoves.test.ts runs it on real engine logs.
import type {Color, LogLine} from '../../../shared/full';
import {LOG_DATA} from '../../../shared/full';
import {findCard} from '../../../shared/cards';

export type MoveHow = 'played' | 'used' | 'project' | 'standard' | 'first' | 'reused' | 'milestone' | 'award';

/** A piece of a rendered line: plain text, a player's name in their colour, or a card name (tappable). */
export type Seg = {t: 'text'; v: string} | {t: 'player'; color: Color} | {t: 'card'; name: string};

export type LogEntry =
  /** `first`: who goes first this generation, when the log says so next to the header */
  | {kind: 'generation'; key: string; generation: number; first?: Color}
  | {kind: 'move'; key: string; generation: number | null; by: Color; how: MoveHow; card: string | null; head: LogLine; lines: LogLine[]}
  /** the research phase's "bought N card(s)" lines, one entry per generation */
  | {kind: 'research'; key: string; generation: number | null; lines: LogLine[]}
  /** a line that belongs to no move this file can prove */
  | {kind: 'line'; key: string; generation: number | null; line: LogLine; by: Color | null}
  /** several lines in a row that stand alone, folded under their first */
  | {kind: 'run'; key: string; generation: number | null; lines: LogLine[]};

/** Lines standing alone in a row fold into one run from this many. */
export const RUN_MIN = 4;

// ---- reading a line ---------------------------------------------------------------------------------------------
const playerAt = (l: LogLine, i: number): Color | null => (l.data[i]?.type === LOG_DATA.PLAYER ? l.data[i].value as Color : null);
const valueAt = (l: LogLine, i: number): string => {
  const v = l.data[i]?.value as unknown;
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
};
const cardAt = (l: LogLine, i: number): string | null => (l.data[i]?.type === LOG_DATA.CARD ? valueAt(l, i) : null);
/** The card names of a card-list value (type 14 comes as an array, or as a comma-joined string). */
function cardsIn(l: LogLine, i: number): string[] {
  const d = l.data[i];
  if (!d) return [];
  if (d.type === LOG_DATA.CARD) return [valueAt(l, i)];
  if (d.type !== LOG_DATA.CARDS) return [];
  const v = d.value as unknown;
  return (Array.isArray(v) ? v.map(String) : String(v).split(',')).map((s) => s.trim()).filter(Boolean);
}

const HEADS: Array<[RegExp, MoveHow]> = [
  [/^\$\{0\} played \$\{1\}$/, 'played'],
  [/^\$\{0\} used \$\{1\} action( with \$\{2\})?$/, 'used'],
  [/^\$\{0\} used \$\{1\} standard project$/, 'project'],
  [/^\$\{0\} used \$\{1\} standard action$/, 'standard'],
  [/^\$\{0\} took the first action of \$\{1\} corporation$/, 'first'],
  [/^\$\{0\} reused \$\{1\} action via \$\{2\}$/, 'reused'],
  [/^\$\{0\} claimed \$\{1\} milestone$/, 'milestone'],
  [/^\$\{0\} funded \$\{1\} award$/, 'award'],
];

/** The line that starts a move, with who moved and the card involved (milestones and awards have none). */
export function headOf(l: LogLine): {by: Color; how: MoveHow; card: string | null} | null {
  const by = playerAt(l, 0);
  if (!by) return null;
  for (const [re, how] of HEADS) {
    if (!re.test(l.message)) continue;
    return {by, how, card: how === 'milestone' || how === 'award' ? null : cardAt(l, 1)};
  }
  return null;
}

const isGeneration = (l: LogLine) => /^Generation \$\{0\}$/.test(l.message);
/** Lines that end whatever move was in progress and stand alone. */
const isTurnEnd = (l: LogLine) => /^\$\{0\} (passed|ended turn)$/.test(l.message);
const isPurchase = (l: LogLine) => /^\$\{0\} \$\{1\} \$\{2\} card\(s\)$/.test(l.message) && valueAt(l, 1) === 'bought';
const isPrivatePurchase = (l: LogLine) => /^You bought \$\{0\}$/.test(l.message);

// What an action causes, by the engine's templates. ${0} is a player in all of them except the private "You ..." lines.
const CONSEQUENCES: RegExp[] = [
  /^\$\{0\} (gained|lost) \$\{1\} \$\{2\}( production)?( because of \$\{3\})?$/,
  /^\$\{0\} gained \$\{1\} M€ from \$\{2\} ocean\(s\)$/,
  /^\$\{3\} stole \$\{1\} \$\{2\}( production)? from \$\{0\}$/,
  /^\$\{0\} stole \$\{1\} /,
  /^\$\{0\} \$\{1\} \$\{2\} at \$\{3\}$/, // placed / removed a tile
  /^\$\{0\} \$\{1\} \$\{2\} card\(s\)$/, // drew / bought (during a move: Business Network, Inventors' Guild)
  /^\$\{0\} (drew|discarded|revealed|revealed and discarded|returned) /,
  /^\$\{0\} drew no cards$/,
  /^\$\{0\} added \$\{1\} \$\{2\} to \$\{3\}( from \$\{4\})?$/,
  /^\$\{0\} removed /,
  /^\$\{0\} kept \$\{1\} project cards$/,
  /^\$\{0\} (raised|increased|decreased|lowered|reduced) /,
  /^\$\{0\} spent /,
  /^\$\{0\} sold \$\{1\} /,
  /^\$\{0\} received \$\{1\} /,
  /^\$\{0\} (found life!|turned |searched |copied )/,
  /^\$\{0\} was discarded/,
  /^You (drew|discarded|drew and discarded) \$\{0\}$/,
  /^Drew and discarded /,
  /^There was nobody to steal plants or animals from\.$/,
];
const isConsequence = (l: LogLine) => CONSEQUENCES.some((re) => re.test(l.message));
/** A line that can change what the game holds (a move's head or consequence, a purchase): VP counted before it is not counted after. */
export const changesGame = (l: LogLine) => !!headOf(l) || isConsequence(l) || isPurchase(l) || isPrivatePurchase(l);
/** A private line ("You drew …", sent as `${0} drew ${1}` with the word You) is only ever about the seat it was sent to. */
const saysYou = (l: LogLine) => l.data[0]?.type === LOG_DATA.STRING && valueAt(l, 0) === 'You';
const isPrivate = (l: LogLine) => /^You /.test(l.message) || /^Drew and discarded /.test(l.message) || saysYou(l);

export const lineKey = (l: LogLine) => `${l.timestamp}|${l.message}|${JSON.stringify(l.data)}`;

// ---- history ----------------------------------------------------------------------------------------------------
/** Lines a phone keeps for its Log tab (the engine sends only its newest 50 with each view). */
export const HISTORY_MAX = 600;

/**
 * The phone's log so far, with the engine's latest window merged in. The window starts somewhere in what the phone
 * already has: everything from there on is replaced by the window (new lines are added; an undo's removed lines go).
 * A window that starts nowhere in the history (more than 50 lines missed, a new game) replaces it. Returns `acc`
 * itself when nothing changed, so the grouping and the rows stay as they are.
 */
export function mergeLog(acc: LogLine[], win: LogLine[], max = HISTORY_MAX): LogLine[] {
  if (!win.length) return acc.length ? [] : acc;
  if (!acc.length) return win.slice(-max);
  const first = lineKey(win[0]);
  // Where the window starts: a place where the history agrees with the window to the history's end (a plain append),
  // the longest such overlap when identical lines repeat; failing that (an undo), the latest place it could start.
  let at = -1;
  let latest = -1;
  const from = Math.max(0, acc.length - win.length);
  for (let i = acc.length - 1; i >= 0; i--) {
    if (lineKey(acc[i]) !== first) continue;
    if (latest < 0) latest = i;
    if (i < from) break;
    let k = 1;
    while (i + k < acc.length && k < win.length && lineKey(acc[i + k]) === lineKey(win[k])) k++;
    if (i + k === acc.length) at = i;
  }
  if (at < 0) at = latest;
  if (at < 0) return win.slice(-max);
  if (acc.length - at === win.length && win.every((l, k) => lineKey(l) === lineKey(acc[at + k]))) return acc;
  const out = acc.slice(0, at).concat(win);
  return out.length > max ? out.slice(-max) : out;
}

// ---- grouping ---------------------------------------------------------------------------------------------------
/**
 * The log, oldest first, as entries oldest first. `me`: the seat's colour (private lines belong only to its moves).
 * `generation`: the current generation, used for lines older than the first "Generation N" line in the window (the
 * engine sends the newest 50 lines).
 */
export function groupLog(lines: LogLine[], me: Color | null, generation: number): LogEntry[] {
  // The generation each line belongs to: lines before the first header in the window are in the one before it.
  const firstHeader = lines.findIndex(isGeneration);
  // (before "Generation 1" there is only the setup: no generation)
  const before = firstHeader < 0 ? generation : Number(valueAt(lines[firstHeader], 0)) - 1;
  let gen: number | null = Number.isFinite(before) && before >= 1 ? before : null;

  const out: LogEntry[] = [];
  const seen = new Map<string, number>();
  const keyOf = (l: LogLine, prefix: string) => {
    const k = prefix + lineKey(l);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n ? `${k}#${n}` : k;
  };
  let move: Extract<LogEntry, {kind: 'move'}> | null = null;
  let research: Extract<LogEntry, {kind: 'research'}> | null = null;
  const alone = (l: LogLine) => { out.push({kind: 'line', key: keyOf(l, 'l:'), generation: gen, line: l, by: playerAt(l, 0)}); };

  for (const l of lines) {
    if (isGeneration(l)) {
      move = null; research = null;
      const n = Number(valueAt(l, 0));
      gen = Number.isFinite(n) && n > 0 ? n : gen;
      out.push({kind: 'generation', key: keyOf(l, 'g:'), generation: gen ?? 0});
      continue;
    }
    const head = headOf(l);
    if (head) {
      research = null;
      move = {kind: 'move', key: keyOf(l, 'm:'), generation: gen, by: head.by, how: head.how, card: head.card, head: l, lines: []};
      out.push(move);
      continue;
    }
    if (isTurnEnd(l)) { move = null; research = null; alone(l); continue; }
    // research: "bought" with no move in progress by that player (a move's own purchases stay in the move)
    const buyer = playerAt(l, 0);
    if ((isPurchase(l) && !(move && move.by === buyer)) || (isPrivatePurchase(l) && !(move && move.by === me))) {
      move = null;
      if (!research) {
        research = {kind: 'research', key: keyOf(l, 'r:'), generation: gen, lines: []};
        out.push(research);
      }
      research.lines.push(l);
      continue;
    }
    research = null;
    if (move && isConsequence(l) && (!isPrivate(l) || (me !== null && move.by === me))) {
      move.lines.push(l);
      continue;
    }
    // not provably part of the move in progress: it stands alone, and so does everything until the next move
    move = null;
    alone(l);
  }
  return foldRuns(firstPlayers(out));
}

const isFirstPlayer = (l: LogLine) => /^First player this generation is \$\{0\}$/.test(l.message);
/** "First player this generation is Kepler" right after (or, in generation 1, right before) a header joins the header. */
function firstPlayers(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind === 'line' && isFirstPlayer(e.line) && e.by) {
      const prev = out[out.length - 1];
      if (prev?.kind === 'generation' && !prev.first) { out[out.length - 1] = {...prev, first: e.by}; continue; }
      const next = entries.slice(i + 1).find((x) => !(x.kind === 'line' && /^Good luck \$\{0\}!$/.test(x.line.message)));
      if (next?.kind === 'generation' && !next.first) { next.first = e.by; continue; }
    }
    out.push(e);
  }
  return out;
}

/** Lines standing alone in a row (RUN_MIN or more, same generation) fold into one run. */
function foldRuns(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (e.kind !== 'line') { out.push(e); i++; continue; }
    let j = i;
    while (j < entries.length && entries[j].kind === 'line' && entries[j].generation === e.generation) j++;
    if (j - i >= RUN_MIN) {
      const run = entries.slice(i, j) as Array<Extract<LogEntry, {kind: 'line'}>>;
      out.push({kind: 'run', key: `run:${run[0].key}`, generation: e.generation, lines: run.map((x) => x.line)});
    } else out.push(...entries.slice(i, j));
    i = j;
  }
  return out;
}

/**
 * Newest first, generation by generation, each generation's divider above its moves. Lines older than the first
 * header in the window get a divider of their own (their generation is known from the header after them).
 */
export function newestFirst(entries: LogEntry[]): LogEntry[] {
  const sections: LogEntry[][] = [[]];
  for (const e of entries) {
    if (e.kind === 'generation') sections.push([e]);
    else sections[sections.length - 1].push(e);
  }
  const out: LogEntry[] = [];
  for (const s of sections.reverse()) {
    if (!s.length) continue;
    const head = s[0].kind === 'generation' ? s[0] : null;
    const rest = head ? s.slice(1) : s;
    if (head) out.push(head);
    else {
      const g = rest.find((e) => e.kind !== 'generation' && e.generation)?.generation;
      if (g && entries.some((e) => e.kind === 'generation')) out.push({kind: 'generation', key: `g:before:${g}`, generation: g});
    }
    out.push(...[...rest].reverse());
  }
  return out;
}

// ---- words ------------------------------------------------------------------------------------------------------
/** "card(s)" after a number reads "card" or "cards". */
function plural(text: string, n: number | null): string {
  return text.replace(/^(\s*)([A-Za-z]+)\(s\)/, (_, sp: string, w: string) => sp + (n === 1 ? w : `${w}s`));
}

/** A line as segments, with the engine's own words: player names (coloured by the caller) and card names. */
export function segments(l: LogLine): Seg[] {
  // tiles: "Kepler placed an ocean" (the space id means nothing to players)
  if (/^\$\{0\} \$\{1\} \$\{2\} at \$\{3\}$/.test(l.message) && playerAt(l, 0)) {
    return [P(playerAt(l, 0)!), T(` ${valueAt(l, 1)} ${tileWords(valueAt(l, 2))}`)];
  }
  // "added 1 Microbe to" -> "added 1 microbe to"
  const resAt = /^\$\{0\} added \$\{1\} \$\{2\} to \$\{3\}/.test(l.message) ? 2 : -1;
  const parts = l.message.split(/(\$\{\d+\})/);
  const out: Seg[] = [];
  let lastNum: number | null = null;
  for (const part of parts) {
    const m = part.match(/^\$\{(\d+)\}$/);
    if (!m) {
      if (part) out.push({t: 'text', v: plural(part, lastNum)});
      continue;
    }
    const i = Number(m[1]);
    const d = l.data[i];
    if (!d) continue;
    if (d.type === LOG_DATA.PLAYER) { out.push({t: 'player', color: d.value as Color}); continue; }
    const cards = cardsIn(l, i);
    if (cards.length) {
      cards.forEach((name, k) => { if (k) out.push({t: 'text', v: ', '}); out.push({t: 'card', name}); });
      continue;
    }
    if (d.type === LOG_DATA.SPACE) {
      // "… at 58": drop the space and the " at " before it
      const last = out[out.length - 1];
      if (last?.t === 'text') last.v = last.v.replace(/ at $/, '');
      continue;
    }
    const v = valueAt(l, i);
    const n = Number(v);
    out.push({t: 'text', v: i === resAt ? resWord(v, lastNum ?? 2) : v});
    lastNum = v !== '' && Number.isFinite(n) ? n : null;
  }
  return merge(out);
}

function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (s.t === 'text' && last?.t === 'text') last.v += s.v;
    else out.push(s.t === 'text' ? {...s} : s);
  }
  return out;
}

const T = (v: string): Seg => ({t: 'text', v});
const P = (color: Color): Seg => ({t: 'player', color});
const C = (name: string): Seg => ({t: 'card', name});

/** Standard projects arrive as 'Power Plant:SP', 'Asteroid:SP'. */
export const cardLabel = (name: string) => name.replace(/:SP$/, '');

/** The move's headline: "Kepler played Herbivores", "Kepler used the Regolith Eaters action". */
export function headline(e: Extract<LogEntry, {kind: 'move'}>): Seg[] {
  const l = e.head;
  const card = e.card;
  switch (e.how) {
    case 'played': return [P(e.by), T(' played '), card ? C(card) : T(valueAt(l, 1))];
    case 'used': {
      const via = cardAt(l, 2);
      return [P(e.by), T(' used the '), card ? C(card) : T(valueAt(l, 1)), T(' action'), ...(via ? [T(' with '), C(via)] : [])];
    }
    case 'project': return [P(e.by), T(' used the '), card ? C(card) : T(valueAt(l, 1)), T(' standard project')];
    case 'standard': {
      const what = valueAt(l, 1);
      if (/^Convert Plants$/i.test(what)) return [P(e.by), T(' converted plants')];
      if (/^Convert Heat$/i.test(what)) return [P(e.by), T(' converted heat')];
      return [P(e.by), T(` used ${what}`)];
    }
    case 'first': return [P(e.by), T(' took the first action of '), card ? C(card) : T(valueAt(l, 1))];
    case 'reused': {
      const via = cardAt(l, 2);
      return [P(e.by), T(' reused the '), card ? C(card) : T(valueAt(l, 1)), T(' action'), ...(via ? [T(' with '), C(via)] : [])];
    }
    case 'milestone': return [P(e.by), T(` claimed the ${valueAt(l, 1)} milestone`)];
    case 'award': return [P(e.by), T(` funded the ${valueAt(l, 1)} award`)];
  }
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
/** "ocean tile" -> "an ocean"; "Mining Rights tile" -> "the Mining Rights tile". */
function tileWords(desc: string): string {
  const w = desc.replace(/ tile$/, '');
  return /^[a-z]/.test(w) ? `${article(w)} ${w}` : `the ${w} tile`;
}
const lower = (s: string) => s.toLowerCase();
/** "Microbe(s)" -> "microbes", "Animal" -> "animal". */
const resWord = (s: string, n: number) => {
  const w = lower(s).replace(/\(s\)$/, '');
  if (w === 'm€') return 'M€';
  if (w === 'science' || w === 'data') return w;
  return n === 1 || w.endsWith('s') ? w : `${w}s`;
};

/**
 * One consequence line, short and from the mover's side: "+1 plant production", "took 1 plant production from
 * Ada", "placed a greenery", "drew 2 cards". Lines about other players keep their names.
 */
export function phrase(l: LogLine, by: Color, moveCard: string | null): Seg[] {
  const msg = l.message;
  const p0 = playerAt(l, 0);
  const n = Number(valueAt(l, 1));
  let m: RegExpMatchArray | null;
  if ((m = msg.match(/^\$\{0\} (gained|lost) \$\{1\} \$\{2\}( production)?( because of \$\{3\})?$/))) {
    const amount = `${m[1] === 'gained' ? '+' : '−'}${valueAt(l, 1)} ${valueAt(l, 2)}${m[2] ?? ''}`;
    if (p0 === by) return [T(amount)];
    return [P(p0!), T(` ${m[1]} ${valueAt(l, 1)} ${valueAt(l, 2)}${m[2] ?? ''}`)];
  }
  if ((m = msg.match(/^\$\{3\} stole \$\{1\} \$\{2\}( production)? from \$\{0\}$/))) {
    const thief = playerAt(l, 3);
    const what = `${valueAt(l, 1)} ${valueAt(l, 2)}${m[1] ?? ''}`;
    // with no one else to take from, the card takes from its own player
    if (thief === by) return p0 === by ? [T(`−${what}`)] : [T(`took ${what} from `), P(p0!)];
    return segments(l);
  }
  if (/^\$\{0\} \$\{1\} \$\{2\} at \$\{3\}$/.test(msg)) {
    const words = `${valueAt(l, 1)} ${tileWords(valueAt(l, 2))}`;
    return p0 === by ? [T(words)] : [P(p0!), T(` ${words}`)];
  }
  if (/^\$\{0\} \$\{1\} \$\{2\} card\(s\)$/.test(msg)) {
    const k = Number(valueAt(l, 2));
    const words = `${valueAt(l, 1)} ${valueAt(l, 2)} ${k === 1 ? 'card' : 'cards'}`;
    return p0 === by ? [T(words)] : [P(p0!), T(` ${words}`)];
  }
  if (/^\$\{0\} added \$\{1\} \$\{2\} to \$\{3\}$/.test(msg)) {
    const card = cardAt(l, 3);
    const what = `+${valueAt(l, 1)} ${resWord(valueAt(l, 2), n)}`;
    if (p0 === by) return card && card !== moveCard ? [T(`${what} on `), C(card)] : [T(what)];
    return [P(p0!), T(` ${what} on `), ...(card ? [C(card)] : [])];
  }
  if (/^\$\{0\} removed \$\{1\} resource\(s\) from \$\{2\}'s \$\{3\}$/.test(msg)) {
    const owner = playerAt(l, 2);
    const card = cardAt(l, 3);
    const kind = card ? findCard(card)?.resourceType : null;
    const what = `${valueAt(l, 1)} ${kind ? resWord(kind, n) : n === 1 ? 'resource' : 'resources'}`;
    if (p0 === by && owner === by) return [T(`−${what} from `), ...(card ? [C(card)] : [])];
    if (p0 === by && owner) return [T(`removed ${what} from `), P(owner), T('’s '), ...(card ? [C(card)] : [])];
    return segments(l);
  }
  if (/^\$\{0\} kept \$\{1\} project cards$/.test(msg) && p0 === by) return [T(`kept ${valueAt(l, 1)} ${n === 1 ? 'card' : 'cards'}`)];
  if (/^\$\{0\} gained \$\{1\} M€ from \$\{2\} ocean\(s\)$/.test(msg) && p0 === by) return [T(`+${valueAt(l, 1)} M€ from oceans`)];
  if (/^You /.test(msg)) return segments({...l, message: msg.replace(/^You /, '')});
  if (saysYou(l)) { const segs = segments(l); return segs[0]?.t === 'text' ? [T(segs[0].v.replace(/^You /, '')), ...segs.slice(1)] : segs; }
  // the engine's own words, without the mover's name in front
  const segs = segments(l);
  if (p0 === by && segs[0]?.t === 'player' && segs[1]?.t === 'text') return [T(segs[1].v.replace(/^ /, '')), ...segs.slice(2)];
  return segs;
}

const isCountLine = (l: LogLine, verb: string) => /^\$\{0\} \$\{1\} \$\{2\} card\(s\)$/.test(l.message) && valueAt(l, 1) === verb;
const namesCards = (l: LogLine, verb: string) => (saysYou(l) && new RegExp(`^\\$\\{0\\} ${verb} \\$\\{1\\}$`).test(l.message))
  || new RegExp(`^You ${verb} \\$\\{0\\}$`).test(l.message);
/**
 * The lines worth showing: the seat's (`me`) count line ("Ada drew 2 cards", "Ada bought 1 card") is dropped when the seat's
 * private line naming those cards is next to it ("You drew Special Design, Power Grid").
 */
export function shownLines(lines: LogLine[], me: Color | null): LogLine[] {
  return lines.filter((l, i) => {
    for (const verb of ['drew', 'bought']) {
      if (!me || !isCountLine(l, verb) || playerAt(l, 0) !== me) continue;
      const near = [lines[i + 1], lines[i - 1]].filter((x): x is LogLine => !!x);
      if (near.some((x) => namesCards(x, verb))) return false;
    }
    return true;
  });
}

/** The one-line summary under a move: its consequences, in order (the caller joins them with " · "). */
export function summary(e: Extract<LogEntry, {kind: 'move'}>): Seg[][] {
  // a move holds private lines only when it is the seat's own
  return shownLines(e.lines, e.by).map((l) => phrase(l, e.by, e.card));
}

/**
 * The player a line hurts, when it is someone other than the mover `by`: "Ares lost 1 plant production because of
 * Kepler", "Kepler stole 3 M€ from Ada", "Kepler removed 2 animals from Ares's Birds". Null otherwise.
 */
export function victimOf(l: LogLine, by: Color): Color | null {
  const p0 = playerAt(l, 0);
  if (/^\$\{0\} lost \$\{1\} \$\{2\}( production)? because of \$\{3\}$/.test(l.message)) return p0 && p0 !== by ? p0 : null;
  if (/^\$\{3\} stole \$\{1\} \$\{2\}( production)? from \$\{0\}$/.test(l.message)) return p0 && p0 !== playerAt(l, 3) ? p0 : null;
  if (/^\$\{0\} removed \$\{1\} resource\(s\) from \$\{2\}'s \$\{3\}$/.test(l.message)) {
    const owner = playerAt(l, 2);
    return owner && owner !== p0 ? owner : null;
  }
  return null;
}

/** Every card a move involves, in order: its own card first, then cards in its lines. */
export function cardsOfMove(e: Extract<LogEntry, {kind: 'move'}>): string[] {
  const out: string[] = [];
  const add = (name: string | null) => { if (name && !out.includes(name)) out.push(name); };
  for (const s of headline(e)) if (s.t === 'card') add(s.name);
  for (const l of e.lines) for (const s of segments(l)) if (s.t === 'card') add(s.name);
  return out;
}

/** Plain text of segments (tests, aria labels): `name` turns a colour into a name. */
export function plain(segs: Seg[], name: (c: Color) => string = (c) => c): string {
  return segs.map((s) => (s.t === 'text' ? s.v : s.t === 'player' ? name(s.color) : cardLabel(s.name))).join('');
}

/** Moves in the log that involve `card` (its own play or action, or the card in a line), newest last. */
export function movesWithCard(entries: LogEntry[], card: string): Array<Extract<LogEntry, {kind: 'move'}>> {
  return entries.filter((e): e is Extract<LogEntry, {kind: 'move'}> => e.kind === 'move' && cardsOfMove(e).includes(card));
}
