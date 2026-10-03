// "Table sense": what happened to one seat, as notices on its phone. At a real table you feel your plants leave your
// hand and the cards come in; here each update of the engine is compared with the one before, per seat, and the
// changes that touch the seat become notices. Public numbers come from the seat's own PlayerViewModel (its hand is
// private), the cause from the update's new log lines. Bots are seats like any other: what they do to a person turns
// up here without special cases.
//
// Kinds:
//   hit    another player took stock, lowered production or TR, or removed resources from one of your cards (sticky)
//   cards  cards came into your hand (drawn, received), or left it by an effect; never your own plays or research buys
//   gift   another player's move raised your stock or production, or added resources to one of your cards (this also
//          covers your own cards reacting to their move: Pets gaining an animal when they place a city)
// Production-phase income is the production show's job; nothing outside the action phase becomes a hit or a gift.
import {findCard} from './cards';
import type {CardModel, Color, LogLine, PlayerViewModel, PublicPlayerModel, SpectatorModel} from './full';
import {LOG_DATA} from './full';
import {isRewind} from './sync';

export type NoticeKind = 'hit' | 'cards' | 'gift';
/** One change to the seat; `amount` is always positive (the kind says which way). */
export type NoticeChange = {what: 'stock' | 'production' | 'tr' | 'card'; resource?: string; card?: string; amount: number;
  /** hit: the attacker gained what you lost (Hired Raiders, Energy Tapping) */
  stolen?: boolean};
/** What did it: a card played, a card or corporation action, a standard project or a standard action. */
export type NoticeCause = {card: string; how: 'played' | 'used' | 'project' | 'standard'};

export type Notice = {
  id: string;
  kind: NoticeKind;
  /** server clock when it was seen, and the engine moment it belongs to (an undo to an earlier gameAge removes it) */
  at: number;
  generation: number;
  age: number;
  undo: number;
  /** who did it: another player's colour and name, 'you' for the seat's own move, null when the log does not say */
  by: Color | null;
  byName: string | null;
  self?: boolean;
  cause: NoticeCause | null;
  changes: NoticeChange[];
  /** cards: names that came into the hand, and names that left it by an effect */
  cardsIn?: string[];
  cardsOut?: string[];
  /** hits stay on screen until the player clears them */
  sticky: boolean;
  cleared?: boolean;
};

/** What a phone keeps: the newest notices of this game for its seat, and when its feed was last opened. */
export type NoticeFeed = {gameId: string; playerId: string; notices: Notice[]; seenAt: number};
/** The newest this many notices are sent to a phone (the database keeps more). */
export const FEED_MAX = 80;

// ---- log lines --------------------------------------------------------------------------------------------------
const lineKey = (l: LogLine) => `${l.timestamp}|${l.message}|${JSON.stringify(l.data)}`;

/**
 * The lines in `next` that `prev` did not have. The engine sends the latest lines (up to 50), so the window slides:
 * the new lines are those after prev's last line. When that line is gone (more than a window of news, or a rewind),
 * lines newer than it by timestamp count.
 */
export function newLogLines(prev: LogLine[], next: LogLine[]): LogLine[] {
  if (!prev.length) return next.slice();
  const last = lineKey(prev[prev.length - 1]);
  for (let i = next.length - 1; i >= 0; i--) if (lineKey(next[i]) === last) return next.slice(i + 1);
  const t = prev[prev.length - 1].timestamp;
  return next.filter((l) => l.timestamp > t);
}

type Act = {by: Color; cause: NoticeCause | null};
const ACTS: Array<[RegExp, NoticeCause['how'] | null]> = [
  [/^\$\{0\} played \$\{1\}$/, 'played'],
  [/^\$\{0\} used \$\{1\} action$/, 'used'],
  [/^\$\{0\} used \$\{1\} standard project$/, 'project'],
  [/^\$\{0\} used \$\{1\} standard action$/, 'standard'],
  [/^\$\{0\} took the first action of \$\{1\} corporation$/, 'used'],
  [/^\$\{0\} (passed|ended turn)$/, null],
  [/^\$\{0\} (claimed \$\{1\} milestone|funded \$\{1\} award)$/, null],
];
const playerAt = (l: LogLine, i: number): Color | null => (l.data[i]?.type === LOG_DATA.PLAYER ? l.data[i].value as Color : null);
const cardAt = (l: LogLine, i: number): string | null => (l.data[i]?.type === LOG_DATA.CARD ? l.data[i].value : null);

/** A line that starts a move ("Kepler played Asteroid", "Kepler used Predators action"), with its actor and card. */
export function actOf(l: LogLine): Act | null {
  const by = playerAt(l, 0);
  if (!by) return null;
  for (const [re, how] of ACTS) {
    if (!re.test(l.message)) continue;
    const card = how ? cardAt(l, 1) : null;
    return {by, cause: how && card ? {card, how} : null};
  }
  return null;
}

/** For a line about `me` that is not one of my own moves: who caused it (null when the line does not say). */
function responsible(l: LogLine, me: Color, act: Act | null): {by: Color | null} | null {
  const mentions = l.data.some((d) => d.type === LOG_DATA.PLAYER && d.value === me);
  if (!mentions) return null;
  // "Kepler lost 2 heat production because of Ada", "Ada stole 2 M€ from Kepler": the culprit is ${3}
  if (/because of \$\{3\}|stole/.test(l.message)) {
    const p = playerAt(l, 3);
    if (p) return {by: p};
    // "because of Rover Construction": often the seat's own card reacting; the move in progress is the cause
    if (l.data[3]?.type === LOG_DATA.CARD) return {by: act?.by ?? null};
  }
  const first = playerAt(l, 0);
  // "Kepler removed 1 resource(s) from Ada's Birds": the remover is ${0}
  if (first && first !== me) return {by: first};
  return {by: act?.by ?? null};
}

/** Who moved during these lines and who touched `me`: the basis for every hit and gift. */
export function attribute(lines: LogLine[], before: LogLine[], me: Color): {touchers: Set<Color | null>; actors: Set<Color>; causeFor: Map<Color, NoticeCause | null>; lossLines: Array<{line: LogLine; by: Color}>} {
  // the move in progress when the new lines start (its first question may have come in an earlier update)
  let act: Act | null = null;
  for (const l of before) {
    if (l.type === 1) act = null;
    const a = actOf(l);
    if (a) act = a;
  }
  const touchers = new Set<Color | null>();
  const actors = new Set<Color>();
  const causes = new Map<Color, Set<string>>();
  const firstCause = new Map<Color, NoticeCause | null>();
  const lossLines: Array<{line: LogLine; by: Color}> = [];
  const note = (by: Color, cause: NoticeCause | null) => {
    if (!firstCause.has(by)) firstCause.set(by, cause);
    const set = causes.get(by) ?? new Set<string>();
    set.add(cause ? `${cause.how}:${cause.card}` : '');
    causes.set(by, set);
  };
  if (act && lines.length && !actOf(lines[0])) actors.add(act.by);
  for (const l of lines) {
    if (l.type === 1) { act = null; continue; }
    const a = actOf(l);
    if (a) {
      act = a;
      actors.add(a.by);
      if (a.by === me) touchers.add(me);
      continue;
    }
    const r = responsible(l, me, act);
    if (!r) continue;
    touchers.add(r.by);
    if (r.by && r.by !== me) {
      const cause = act && act.by === r.by ? act.cause : null;
      note(r.by, cause);
      if (/ lost | stole | removed /.test(` ${l.message} `)) lossLines.push({line: l, by: r.by});
    }
  }
  // one cause per culprit only when every line about me points at the same card
  const causeFor = new Map<Color, NoticeCause | null>();
  for (const [by, set] of causes) causeFor.set(by, set.size === 1 ? firstCause.get(by) ?? null : null);
  return {touchers, actors, causeFor, lossLines};
}

// ---- state changes ----------------------------------------------------------------------------------------------
const STOCK = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'] as const;
type Res = typeof STOCK[number];
const PROD: Record<Res, keyof PublicPlayerModel> = {megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction'};

/** The seat's own public changes between two moments: losses and gains, each positive. */
function diffs(o: PublicPlayerModel, p: PublicPlayerModel): {losses: NoticeChange[]; gains: NoticeChange[]} {
  const losses: NoticeChange[] = [];
  const gains: NoticeChange[] = [];
  const push = (d: number, c: Omit<NoticeChange, 'amount'>) => {
    if (d < 0) losses.push({...c, amount: -d});
    if (d > 0) gains.push({...c, amount: d});
  };
  for (const r of STOCK) push((p[r] as number) - (o[r] as number), {what: 'stock', resource: r});
  for (const r of STOCK) push((p[PROD[r]] as number) - (o[PROD[r]] as number), {what: 'production', resource: r});
  push(p.terraformRating - o.terraformRating, {what: 'tr'});
  const had = new Map(o.tableau.map((c) => [c.name, c.resources ?? 0]));
  for (const c of p.tableau) if (had.has(c.name)) push((c.resources ?? 0) - had.get(c.name)!, {what: 'card', card: c.name});
  return {losses, gains};
}

/** Losses read from the log lines (when the seat moved in the same update, its own payments hide them in the numbers). */
function lossesFromLog(lossLines: Array<{line: LogLine; by: Color}>, me: Color): Map<Color, NoticeChange[]> {
  const out = new Map<Color, NoticeChange[]>();
  const RES: Record<string, Res> = {'M€': 'megacredits', steel: 'steel', titanium: 'titanium', plant: 'plants', plants: 'plants', energy: 'energy', heat: 'heat'};
  for (const {line: l, by} of lossLines) {
    const n = Number(l.data[1]?.value);
    if (!Number.isFinite(n) || n <= 0) continue;
    let c: NoticeChange | null = null;
    if (/^\$\{0\} lost \$\{1\} \$\{2\}( production)? because of \$\{3\}$/.test(l.message) && playerAt(l, 0) === me) {
      const r = RES[l.data[2]?.value ?? ''];
      if (r) c = {what: l.message.includes('production') ? 'production' : 'stock', resource: r, amount: n};
    } else if (/^\$\{3\} stole \$\{1\} \$\{2\}( production)? from \$\{0\}$/.test(l.message) && playerAt(l, 0) === me) {
      const r = RES[l.data[2]?.value ?? ''];
      if (r) c = {what: l.message.includes('production') ? 'production' : 'stock', resource: r, amount: n, stolen: true};
    } else if (/^\$\{0\} removed \$\{1\} resource\(s\) from \$\{2\}'s \$\{3\}$/.test(l.message) && playerAt(l, 2) === me) {
      const card = cardAt(l, 3);
      if (card) c = {what: 'card', card, amount: n};
    }
    if (c) out.set(by, [...(out.get(by) ?? []), c]);
  }
  return out;
}

/** Did the culprit gain what the seat lost (a steal)? Read from the log ("stole"), never guessed from the numbers. */
function markStolen(losses: NoticeChange[], lines: LogLine[], me: Color) {
  for (const c of losses) {
    if (c.what !== 'stock' && c.what !== 'production') continue;
    const word = c.resource === 'megacredits' ? 'M€' : c.resource === 'plants' ? 'plant' : c.resource;
    c.stolen = lines.some((l) => l.message.includes('stole') && playerAt(l, 0) === me && (l.message.includes('production') === (c.what === 'production')) &&
      (l.data[2]?.value === word || l.data[2]?.value === `${word}s` || l.data[2]?.value === c.resource));
  }
}

// ---- the notices for one update ---------------------------------------------------------------------------------
export type NoticeContext = {gameId: string; playerId: string; at: number};

const names = (cards: CardModel[] | undefined) => (cards ?? []).map((c) => c.name);

/**
 * The notices one engine update brings to one seat. `prevView`/`nextView` are the seat's own models (hand included);
 * the spectator models stand in for the public part when a seat's views are missing (then no hand changes are known).
 * `logs.lines` are the update's new log lines as the seat sees them (private lines included); `logs.before` the lines
 * before them, so a move begun in an earlier update (Asteroid, then its target) is still known.
 */
export function noticesFor(prevSpectator: SpectatorModel | null, nextSpectator: SpectatorModel | null, prevView: PlayerViewModel | null | undefined,
  nextView: PlayerViewModel | null | undefined, logs: {lines: LogLine[]; before?: LogLine[]}, ctx: NoticeContext): Notice[] {
  const prev = prevView ?? prevSpectator;
  const next = nextView ?? nextSpectator;
  if (!prev || !next) return [];
  const me: Color | undefined = nextView?.color ?? prevView?.color;
  if (!me) return [];
  const g0 = prev.game; const g1 = next.game;
  // An undo rewrites the past: nothing in it is news.
  if (isRewind(g0, g1)) return [];
  const o = prev.players.find((p) => p.color === me);
  const p = next.players.find((x) => x.color === me);
  if (!o || !p) return [];
  const nameOf = (c: Color | null) => (c ? next.players.find((x) => x.color === c)?.name ?? null : null);
  const base = {at: ctx.at, generation: g1.generation, age: g1.gameAge, undo: g1.undoCount};
  const idOf = (kind: NoticeKind, i = 0) => `${ctx.gameId}:${ctx.playerId}:${g1.undoCount}.${g1.gameAge}:${ctx.at.toString(36)}:${kind}${i ? i : ''}`;
  const out: Notice[] = [];
  const lines = logs.lines;
  const who = attribute(lines, logs.before ?? [], me);

  // ---- hits and gifts: only between two action-phase moments of one generation (not production, not research) ----
  const inAction = g0.phase === 'action' && g1.phase === 'action' && g0.generation === g1.generation;
  const prevActive = prev.players.find((x) => x.isActive)?.color ?? null;
  // The seat's own move: it started or continued a move in these lines, a line about it is its own doing, or (no lines
  // at all, e.g. a card's cost taken before the card resolves) it was the active player.
  const selfMoved = who.actors.has(me) || who.touchers.has(me) || (who.actors.size === 0 && who.touchers.size === 0 && prevActive === me);
  const namedOthers = [...who.touchers].filter((c): c is Color => c !== null && c !== me);
  if (inAction && !selfMoved) {
    // Who did it: the one other player the lines about the seat point at; else the only player who moved; else (no
    // lines at all) the player who was active before the update. Anything less certain stays unnamed.
    let by: Color | null = null;
    if (namedOthers.length === 1 && !who.touchers.has(null)) by = namedOthers[0];
    else if (who.touchers.size === 0) {
      const moved = [...who.actors];
      if (moved.length === 1) by = moved[0];
      else if (moved.length === 0 && prevActive) by = prevActive;
    }
    const cause = by ? (who.causeFor.has(by) ? who.causeFor.get(by)! : soleCause(lines, by)) : null;
    const {losses, gains} = diffs(o, p);
    if (losses.length) {
      markStolen(losses, lines, me);
      out.push({...base, id: idOf('hit'), kind: 'hit', by, byName: nameOf(by), cause, changes: losses, sticky: true});
    }
    if (gains.length) out.push({...base, id: idOf('gift'), kind: 'gift', by, byName: nameOf(by), cause, changes: gains, sticky: false});
  } else if (inAction && namedOthers.length) {
    // The seat moved in the same update as someone else: its own payments hide their losses in the numbers, so only
    // the losses the log pins on another player count.
    let i = 0;
    for (const [culprit, changes] of lossesFromLog(who.lossLines, me)) {
      out.push({...base, id: idOf('hit', i++), kind: 'hit', by: culprit, byName: nameOf(culprit), cause: who.causeFor.get(culprit) ?? null, changes, sticky: true});
    }
  }

  // ---- cards in and out of the hand (the seat's own view only) ----------------------------------------------------
  if (prevView && nextView) {
    const before = new Set(names(prevView.cardsInHand));
    const after = new Set(names(nextView.cardsInHand));
    // research and draft purchases came from cards the seat was already looking at
    // (the engine keeps the last research offer in dealtProjectCards all generation long: only research and draft count)
    const choosing = g0.phase !== 'action' || g1.phase !== 'action';
    const offered = new Set([...(choosing ? [...names(prevView.dealtProjectCards), ...names(prevView.draftedCards)] : []), ...bought(lines)]);
    const cameIn = [...after].filter((n) => !before.has(n) && !offered.has(n));
    const played = new Set([...nextView.thisPlayer.tableau.map((c) => c.name),
      ...lines.filter((l) => /^\$\{0\} played \$\{1\}$/.test(l.message) && playerAt(l, 0) === me).map((l) => cardAt(l, 1) ?? '')]);
    const left = [...before].filter((n) => !after.has(n) && !played.has(n));
    const ownMove = who.actors.has(me) || who.touchers.has(me) || (who.actors.size === 0 && next.players.find((x) => x.isActive)?.color === me);
    // Selling patents or discarding by one's own choice is not news; a draw is, and so is a discard that came with it.
    const shownOut = cameIn.length || !ownMove ? left : [];
    if (cameIn.length || shownOut.length) {
      // who made the cards move: the seat's own move (and which card), another player's, or nobody in particular
      const drawLine = lines.find((l) => /drew|drawing|draw a card/.test(l.message));
      const selfMove = ownMove && !(drawLine && (() => { const r = responsible(drawLine, me, null); return r?.by && r.by !== me; })());
      let by: Color | null = null; let cause: NoticeCause | null = null; let self = false;
      if (selfMove) {
        self = true; by = me;
        cause = drawCause(lines, logs.before ?? [], me);
      } else {
        const moved = [...who.actors].filter((a) => a !== me);
        if (moved.length === 1) { by = moved[0]; cause = soleCause(lines, by); }
      }
      out.push({...base, id: idOf('cards'), kind: 'cards', by: self ? null : by, byName: self ? null : nameOf(by), ...(self ? {self: true} : {}), cause,
        changes: [], cardsIn: cameIn, cardsOut: shownOut, sticky: false});
    }
  }
  return out;
}

/** Cards named on the seat's private "You bought" lines (research and draft purchases). */
function bought(lines: LogLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (!/^You bought \$\{0\}/.test(l.message)) continue;
    for (const d of l.data) {
      const v = d.value as unknown;
      if (Array.isArray(v)) out.push(...v.map(String));
      else if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

/** The one card a player moved with in these lines (null when there were none or several). */
function soleCause(lines: LogLine[], by: Color): NoticeCause | null {
  const causes = lines.map(actOf).filter((a): a is Act => !!a && a.by === by && !!a.cause).map((a) => a.cause!);
  const distinct = new Set(causes.map((c) => `${c.how}:${c.card}`));
  return distinct.size === 1 ? causes[0] : null;
}

/** What drew the seat's cards in its own move: the effect named on the line ("using their Mars University effect"),
 *  else the move the draw belongs to. */
function drawCause(lines: LogLine[], before: LogLine[], me: Color): NoticeCause | null {
  let act: Act | null = null;
  for (const l of before) { if (l.type === 1) act = null; const a = actOf(l); if (a) act = a; }
  for (const l of lines) {
    if (l.type === 1) { act = null; continue; }
    const a = actOf(l);
    if (a) { act = a; continue; }
    if (/using their \$\{1\} effect/.test(l.message) && playerAt(l, 0) === me) {
      const card = cardAt(l, 1);
      if (card) return {card, how: 'used'};
    }
    if (/drew/.test(l.message) && (playerAt(l, 0) === me || l.playerId)) return act && act.by === me ? act.cause : null;
  }
  return act && act.by === me ? act.cause : null;
}

// ---- words ------------------------------------------------------------------------------------------------------
const RES_WORD: Record<string, [string, string]> = {
  megacredits: ['M€', 'M€'], steel: ['steel', 'steel'], titanium: ['titanium', 'titanium'], plants: ['plant', 'plants'],
  energy: ['energy', 'energy'], heat: ['heat', 'heat'],
};
/** The name a card shows (standard projects come as "City:SP" from the engine). */
export const cardLabel = (name: string) => name.replace(/:SP$/, '');

function cardResource(card: string, n: number): string {
  const t = findCard(card)?.resourceType?.toLowerCase();
  if (!t) return n === 1 ? 'resource' : 'resources';
  if (t === 'science' || t === 'data') return t;
  return n === 1 ? t : `${t}s`;
}

/** "3 plants", "2 heat production", "1 TR", "1 animal on Birds" (the card's resource kind from its definition). */
export function changeText(c: NoticeChange, opts: {yours?: boolean} = {}): string {
  if (c.what === 'tr') return `${c.amount} TR`;
  if (c.what === 'card') return `${c.amount} ${cardResource(c.card ?? '', c.amount)} on ${opts.yours ? 'your ' : ''}${cardLabel(c.card ?? '')}`;
  const [one, many] = RES_WORD[c.resource ?? ''] ?? [c.resource ?? '', c.resource ?? ''];
  const word = c.amount === 1 ? one : many;
  return c.what === 'production' ? `${c.amount} ${RES_WORD[c.resource ?? '']?.[0] ?? word} production` : `${c.amount} ${word}`;
}

/** "with Herbivores", "with the City standard project", "" when unknown. */
function withCause(c: NoticeCause | null): string {
  if (!c) return '';
  if (c.how === 'project') return ` with the ${cardLabel(c.card)} standard project`;
  return ` with ${cardLabel(c.card)}`;
}
/** "when Kepler played Immigrant City", "when you used Mars University", "when Kepler moved" (cause unknown). */
function whenCause(name: string, c: NoticeCause | null): string {
  if (!c) return `when ${name} moved`;
  if (c.how === 'played') return `when ${name} played ${cardLabel(c.card)}`;
  if (c.how === 'project') return `when ${name} used the ${cardLabel(c.card)} standard project`;
  return `when ${name} used ${cardLabel(c.card)}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** One sentence for one loss: "took 3 plants", "lowered your heat production by 2", "removed 1 animal from your Birds". */
function lossVerb(c: NoticeChange): string {
  if (c.what === 'tr') return `lowered your TR by ${c.amount}`;
  if (c.what === 'card') return `removed ${c.amount} ${cardResource(c.card ?? '', c.amount)} from your ${cardLabel(c.card ?? '')}`;
  const prodWord = RES_WORD[c.resource ?? '']?.[0] ?? c.resource;
  if (c.what === 'production') return c.stolen ? `took ${c.amount} of your ${prodWord} production` : `lowered your ${prodWord} production by ${c.amount}`;
  const [one, many] = RES_WORD[c.resource ?? ''] ?? [c.resource ?? '', c.resource ?? ''];
  return c.stolen ? `took ${c.amount} ${c.amount === 1 ? one : many}` : `removed ${c.amount} of your ${many}`;
}

/**
 * The words on a phone: a headline and, for several changes, a detail line. Plain sentences that say what happened
 * and who did it ("Kepler took 3 plants with Herbivores"); the cause is left out when the log did not say.
 */
export function noticeText(n: Notice): {title: string; detail: string | null} {
  if (n.kind === 'hit') {
    const lost = `You lost ${list(n.changes.map((c) => changeText(c, {yours: true})))}`;
    // nobody named by the log or the turn: say what was lost, not who took it
    if (!n.byName) return {title: lost, detail: null};
    if (n.changes.length === 1) return {title: `${n.byName} ${lossVerb(n.changes[0])}${withCause(n.cause)}`, detail: null};
    return {title: `${n.byName} hit you${withCause(n.cause)}`, detail: lost};
  }
  if (n.kind === 'gift') {
    const what = list(n.changes.slice(0, 3).map((c) => (c.what === 'card' ? changeText(c, {yours: true}) : c.what === 'production' ? `${changeText(c)}` : changeText(c))));
    const more = n.changes.length > 3 ? ` and ${n.changes.length - 3} more` : '';
    return {title: `You gained ${what}${more}`, detail: n.byName ? capital(whenCause(n.byName, n.cause)) : null};
  }
  const cin = n.cardsIn ?? []; const cout = n.cardsOut ?? [];
  const cards = (k: number) => `${k} card${k === 1 ? '' : 's'}`;
  let title: string;
  if (cin.length && cout.length) title = `You drew ${cards(cin.length)} and discarded ${cards(cout.length)}`;
  else if (cin.length) title = n.self || !n.byName ? `You drew ${cards(cin.length)}` : `You got ${cards(cin.length)}`;
  else title = `You lost ${cards(cout.length)} from your hand`;
  let detail: string | null = null;
  if (n.self && n.cause) detail = n.cause.how === 'played' ? `From playing ${cardLabel(n.cause.card)}` : `With ${cardLabel(n.cause.card)}`;
  else if (n.byName) detail = capital(whenCause(n.byName, n.cause));
  return {title, detail};
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Several notices that arrived together, as one toast line ("You drew 3 cards", "2 new notices"). */
export function groupTitle(ns: Notice[]): string {
  if (ns.length === 1) return noticeText(ns[0]).title;
  if (ns.every((n) => n.kind === 'cards' && !(n.cardsOut ?? []).length)) {
    const k = ns.reduce((s, n) => s + (n.cardsIn ?? []).length, 0);
    return `You drew ${k} card${k === 1 ? '' : 's'}`;
  }
  return `${ns.length} things happened to you`;
}
