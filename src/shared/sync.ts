// Keeping every screen on the engine's latest numbers. Each view the server pushes carries a version; the server
// tells each socket, every few seconds, which version it last sent there; a client that shows something older asks for
// a fresh view. Everything here is pure so the server, the client and the tests share one set of rules.
// The engine's gameAge/undoCount do not order its moments. A second undo in one turn restores a save made
// before the first undo, so undoCount repeats and gameAge falls; views are therefore ordered by the server's own send
// count, rewinds are recognised by isRewind, and every answer names the view it was made against (Seen).

/**
 * A pushed view's version. `boot` names the server process and `seq` counts its sends: together they order views (the
 * pushes to one socket leave in fetch order, so a later send is never an older moment). `age`/`undo` are the engine's
 * gameAge and undoCount, for display and for the input check; `epoch` counts the undos this server process has seen.
 */
export type ViewVersion = {age: number; undo: number; boot: number; seq: number; epoch?: number};

/**
 * How often the server tells each socket its version; a visible client that hears nothing for STALE_AFTER_MS (two
 * missed heartbeats and a margin) drops the socket and reconnects. A silent dead link cannot be noticed faster than
 * this, so it bounds how long a screen on a zombie socket can lag. A page coming back asks at once and waits PROBE_MS.
 */
export const HEARTBEAT_MS = 2000;
export const STALE_AFTER_MS = 2 * HEARTBEAT_MS + 500;
export const PROBE_MS = 1500;
/** After the server says "you should have v", how long the client waits for v before it asks again. */
export const RESYNC_GRACE_MS = 1000;
/** A client asks at most once per CLIENT_RESYNC_GAP_MS; the server answers at most SERVER_RESYNC_BURST in a row, then one per gap. */
export const CLIENT_RESYNC_GAP_MS = 1500;
export const SERVER_RESYNC_GAP_MS = 1000;
export const SERVER_RESYNC_BURST = 3;
/** A push batch is refetched at most this many times when the views it fetched disagree on the engine version. */
export const CUT_RETRIES = 3;

/**
 * Negative when a is older than b, 0 when the same, positive when newer. A restarted server's views are fresh; within one
 * process the later send wins. The engine's numbers are not used: they repeat or fall after an undo (see isRewind).
 */
export function compareVersions(a: ViewVersion, b: ViewVersion): number {
  if (a.boot !== b.boot) return a.boot - b.boot;
  return a.seq - b.seq;
}

/**
 * Did the engine go back between two of its moments? An undo raises undoCount the first time, but a second undo in the
 * same turn restores a save made before the first one, so undoCount stays where it was and gameAge falls (measured:
 * 14.0 -> 12.1 -> 14.1 -> 12.1). An engine that reloads an older save after a restart looks the same.
 */
export function isRewind(prev: {gameAge: number; undoCount: number}, next: {gameAge: number; undoCount: number}): boolean {
  return next.undoCount !== prev.undoCount || next.gameAge < prev.gameAge;
}

export function isOlderVersion(next: ViewVersion | null | undefined, cur: ViewVersion | null | undefined): boolean {
  if (!next || !cur) return false;
  return compareVersions(next, cur) < 0;
}

/** The tag a device shows when asked (the perf recorder on a phone, ?debug=1 on the TV): "v<gameAge>.<undo>". */
export function versionTag(v: ViewVersion | null | undefined): string {
  return v ? `v${v.age}.${v.undo}` : 'v–';
}

/** Do these views form a consistent cut of the game (every one at the same gameAge and undoCount)? */
export function consistentCut(models: Array<{game: {gameAge: number; undoCount: number}}>): boolean {
  if (!models.length) return true;
  const {gameAge, undoCount} = models[0].game;
  return models.every((m) => m.game.gameAge === gameAge && m.game.undoCount === undoCount);
}

/**
 * What the screens show of a game moment, as a short string: gameAge/undoCount plus every public number on the TV
 * panels and phone headers. The engine changes some of these without a log line (gameAge stays put): a card's cost is
 * taken at its first question and logged only when the card resolves, research purchases, and so on. The poll compares
 * fingerprints, so such a change still reaches every screen within one poll.
 */
export function modelFingerprint(m: {game: {gameAge: number; undoCount: number; phase: string; generation: number}; players: Array<Record<string, unknown>>}): string {
  const keys = ['color', 'megacredits', 'megacreditProduction', 'steel', 'steelProduction', 'titanium', 'titaniumProduction', 'plants',
    'plantProduction', 'energy', 'energyProduction', 'heat', 'heatProduction', 'terraformRating', 'cardsInHandNbr', 'isActive'];
  const players = m.players.map((p) => keys.map((k) => p[k]).join(',') + ',' + (Array.isArray(p.tableau) ? p.tableau.length : ''));
  return [m.game.gameAge, m.game.undoCount, m.game.phase, m.game.generation, ...players].join('|');
}

/** Server side, per socket: a small burst of resyncs is answered, then at most one per gap. */
export class ResyncLimiter {
  private tokens: number;
  private last: number;
  constructor(private gapMs = SERVER_RESYNC_GAP_MS, private burst = SERVER_RESYNC_BURST, now = 0) {
    this.tokens = burst;
    this.last = now;
  }
  allow(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.last) / this.gapMs);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Client side: when to ask for a fresh view. `heard` is the version the server last said it sent to this socket (with
 * the local time it said so); `shown` is the version on screen. Ask when the server says we should have something newer
 * and it has not arrived within the grace period, and never more often than the gap.
 */
export class ResyncPlanner {
  private lastAsk = -Infinity;
  private heard: {v: ViewVersion; at: number} | null = null;
  constructor(private graceMs = RESYNC_GRACE_MS, private gapMs = CLIENT_RESYNC_GAP_MS) {}

  hear(v: ViewVersion | null, now: number) {
    // a newer claim restarts the grace clock; the same claim repeated keeps the first time we heard it
    if (!v) { this.heard = null; return; }
    if (!this.heard || compareVersions(v, this.heard.v) !== 0) this.heard = {v, at: now};
  }

  /** Is the screen behind what the server says it sent, for longer than the grace period? */
  behind(shown: ViewVersion | null, now: number): boolean {
    if (!this.heard) return false;
    if (shown && compareVersions(shown, this.heard.v) >= 0) return false;
    return now - this.heard.at >= this.graceMs;
  }

  /** Rate limit for any reason to ask (behind, visible again, back online). Returns true when the ask may go out now. */
  mayAsk(now: number): boolean {
    if (now - this.lastAsk < this.gapMs) return false;
    this.lastAsk = now;
    return true;
  }
}

/**
 * A deliberate hold of numbers on screen (the production show) with a hard deadline. While it holds, the screen shows
 * `display`; at the deadline (or once it is past, however late a timer fires) it shows the latest view again.
 */
export type Hold<T> = {display: T; until: number};
export function heldValue<T>(hold: Hold<T> | null | undefined, now: number): T | undefined {
  return hold && now < hold.until ? hold.display : undefined;
}

/**
 * When a production show starts on this device's clock. `offset` estimates server time minus local time from the
 * heartbeats; without one, the show is timed from its arrival (it was sent ~0.7 s before it starts). A show buffered
 * while the device slept arrives late, and timing it from its arrival would replay old numbers as if they were new.
 */
export function showLocalStart(show: {startAt: number; serverNow: number}, now: number, offset: number | null): number {
  const fromArrival = show.startAt - (show.serverNow - now);
  if (offset === null) return fromArrival;
  const fromClock = show.startAt - offset;
  // trust arrival timing unless the message is clearly older than the clock says (network delay stays well below this)
  return fromClock < fromArrival - 1500 ? fromClock : fromArrival;
}

// ---- Answers name the view they were made against; undo is announced and has a window ---------------------

/** A short fingerprint of a question (the engine's waitingFor), the same on the server and the phones. */
export function questionKey(w: unknown): string {
  return shortHash(JSON.stringify(w ?? null));
}

function shortHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${str.length}`;
}

/**
 * What makes a question the same question to the player answering it: its type, title and button, the set of cards it
 * offers (by name), the spaces, players and bounds it offers, and the same for each of its options, in order (an answer
 * names an option by its index). Left out: what the engine recomputes as the game moves while the question stays open,
 * such as a card's current cost or disabled flag, the warning, or the player's stock. Another player's move gives every
 * screen a new view (gameAge moves during research when someone buys), and the question's identity is what tells a
 * phone that its own question did not change, so a half-made selection stays.
 */
export function questionIdentity(w: unknown): string {
  return shortHash(JSON.stringify(identityOf(w)));
}

function identityOf(w: unknown): unknown {
  if (w === undefined || w === null || typeof w !== 'object') return null;
  const q = w as Record<string, unknown>;
  const title = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object'
    ? [(t as {message?: unknown}).message ?? '', ...((t as {data?: Array<{value?: unknown}>}).data ?? []).map((d) => d?.value ?? null)] : null);
  const names = (cs: unknown) => (Array.isArray(cs) ? cs.map((c) => (c as {name?: unknown})?.name ?? c).map(String).sort() : undefined);
  const sorted = (xs: unknown) => (Array.isArray(xs) ? xs.map(String).sort() : undefined);
  const out: Record<string, unknown> = {type: q.type ?? null, title: title(q.title), button: q.buttonLabel ?? null};
  if (Array.isArray(q.options)) out.options = q.options.map(identityOf);
  if (q.cards !== undefined) out.cards = names(q.cards);
  if (q.spaces !== undefined) out.spaces = sorted(q.spaces);
  if (q.players !== undefined) out.players = sorted(q.players);
  if (q.include !== undefined) out.include = sorted(q.include);
  for (const k of ['min', 'max', 'amount', 'count', 'selectBlueCardAction'] as const) if (q[k] !== undefined) out[k] = q[k];
  const pay = q.payProduction as {cost?: unknown} | undefined;
  if (pay) out.cost = pay.cost ?? null;
  return out;
}

/**
 * What a phone had on screen when it answered: the view's version and the question it answered. The server refuses an
 * answer whose view is older than the game (an undo since, a question that changed, or its own earlier answer).
 */
export type Seen = {boot: number; seq: number; epoch: number; age: number; undo: number; q: string;
  /** the question's identity (questionIdentity): the same question although another player's move changed its details */
  qi?: string};

export function seenOf(v: ViewVersion | null | undefined, model: {game: {gameAge: number; undoCount: number}; waitingFor?: unknown}): Seen | undefined {
  if (!v) return undefined;
  return {boot: v.boot, seq: v.seq, epoch: v.epoch ?? 0, age: model.game.gameAge, undo: model.game.undoCount, q: questionKey(model.waitingFor),
    qi: questionIdentity(model.waitingFor)};
}

/** Is the seat's question now the one the phone answered? The exact question, or the same question by its identity. */
export function sameQuestion(seen: Pick<Seen, 'q' | 'qi'>, w: unknown): boolean {
  return seen.q === questionKey(w) || (!!seen.qi && seen.qi === questionIdentity(w));
}

/** Is this answer the engine's "Undo last action" (an option of the turn menu)? */
export function isUndoAnswer(w: unknown, response: unknown): boolean {
  const q = w as {type?: string; options?: Array<{title?: unknown}>} | undefined;
  const r = response as {type?: string; index?: number} | undefined;
  if (!q || q.type !== 'or' || !r || r.type !== 'or' || typeof r.index !== 'number') return false;
  const t = q.options?.[r.index]?.title;
  const text = typeof t === 'string' ? t : (t as {message?: string} | undefined)?.message ?? '';
  return /^undo/i.test(text.trim());
}

/** Every screen hears this when a player undoes: "<name> undid their last move" (with `bots`: "<name> took back their move and 2 bot moves"). */
export type UndoNotice = {id: string; gameId: string; playerId: string | null; name: string; color: string | null; at: number; epoch: number; bots?: number};
/** How long a device that (re)connects is still told about a recent undo. */
export const UNDO_NOTICE_MS = 6000;

export type InputCode = 'stale' | 'undoWindow';
export type InputVerdict = {ok: true} | {ok: false; code: InputCode; error: string};

export const undoChangedText = (name: string | null) => `The game changed (${name ? `${name} undid a move` : 'a move was undone'}). Here is the new situation.`;
export const MOVED_ON_TEXT = 'That question changed before your answer arrived. Here is the new situation.';
export const ALREADY_SENT_TEXT = 'Your earlier answer already went through. Here is the new situation.';
export const NOT_ASKED_TEXT = 'There is no question for you right now. Here is the new situation.';
export const undoWindowText = (name: string) => `${name} has already moved, so your last move can no longer be undone.`;
export const movedText = (name: string) => `${name} has already moved. Here is the new situation.`;
export const turnOfText = (name: string) => `It is ${name}'s turn now. Here is the new situation.`;

/**
 * May this answer go to the engine? `fresh` is the seat's engine model read just before (under the server's input lock,
 * so nothing else answers in between). Rules, in order:
 *  1. no question open: refused, saying why (an undo, another player's move, whose turn it is);
 *  2. with `seen` (phones always send it): refused when an undo happened since that view (this server's undo count, the
 *     engine's undoCount, or gameAge below the view's), when the question is not the one the phone showed, or when the
 *     view predates this seat's own last answer (a double tap). The question is compared, never the game's age: another
 *     player's move (gameAge up, the seat's own question the same by its identity) does not make an answer stale;
 *  3. an undo is refused once another player has committed a move after this player's last one (the engine already
 *     limits undo to the player's own turn; this keeps that true whatever the engine does).
 * Answers without `seen` (the bot desk, test drivers) skip rule 2.
 */
export function judgeInput(o: {
  playerId: string;
  fresh: {game: {gameAge: number; undoCount: number}; waitingFor?: unknown};
  seen?: Seen | null;
  isUndo: boolean;
  boot: number;
  epoch: number;
  /** the newest undo this server process performed (its epoch and who) */
  lastUndo: {epoch: number; name: string} | null;
  /** gameAge right after this seat's own last accepted answer, in the current epoch */
  ownAge: number | null;
  /** the last accepted answer by anyone (null: none since the last undo or since this server started) */
  lastMove: {playerId: string; name: string} | null;
  /** the player whose turn it is now, when it is someone else (for the refusal's wording) */
  activeName?: string | null;
}): InputVerdict {
  const {fresh, seen} = o;
  const undoneSince = !!seen && ((seen.boot === o.boot && seen.epoch < o.epoch) || seen.undo !== fresh.game.undoCount || fresh.game.gameAge < seen.age);
  const undoer = seen && o.lastUndo && seen.boot === o.boot && o.lastUndo.epoch > seen.epoch ? o.lastUndo.name : null;
  if (fresh.waitingFor === undefined || fresh.waitingFor === null) {
    const error = undoneSince ? undoChangedText(undoer)
      : o.lastMove && o.lastMove.playerId !== o.playerId ? movedText(o.lastMove.name)
        : o.activeName ? turnOfText(o.activeName) : NOT_ASKED_TEXT;
    return {ok: false, code: 'stale', error};
  }
  if (seen) {
    if (undoneSince) return {ok: false, code: 'stale', error: undoChangedText(undoer)};
    if (!sameQuestion(seen, fresh.waitingFor)) return {ok: false, code: 'stale', error: MOVED_ON_TEXT};
    if (o.ownAge !== null && seen.boot === o.boot && seen.epoch === o.epoch && seen.age < o.ownAge) return {ok: false, code: 'stale', error: ALREADY_SENT_TEXT};
  }
  if (o.isUndo && o.lastMove && o.lastMove.playerId !== o.playerId) return {ok: false, code: 'undoWindow', error: undoWindowText(o.lastMove.name)};
  return {ok: true};
}

// ---- Taking a move back: "Back" inside your own move, and undo through bot moves ---------------------------------
// The engine saves the game each time a player's turn menu opens (takeAction, with undoOption on) and at nothing in
// between, so every save is "a turn menu, before its answer". Its own Undo option exists only on the active player's
// menu after an action this turn, so the server also uses the engine's load_game route: rollback 0 reloads the latest
// save (the menu before a move whose follow-up questions are still open), rollback 1 drops the latest save and loads
// the one before it (one engine undo step). Measured on the engine image: tests/full/back_probe.py.

/** The engine moment right before a turn-menu answer: the save that answer started from. */
export type MovePre = {age: number; generation: number; acts: number; hand: string[]};

/** One accepted answer, as the undo window sees it. */
export type MoveRecord = {
  playerId: string; name: string; color: string; bot: boolean;
  /** a turn-menu answer starts a move ('action', 'end' for End Turn, 'pass'); anything else is a 'followUp' */
  kind: 'action' | 'end' | 'pass' | 'followUp';
  /** turn-menu answers: the moment the engine saved before them */
  pre?: MovePre;
  /** the answering seat was left with a follow-up question of its own move (the move is not finished) */
  midAfter: boolean;
  /** what the move was (the card played, or the card whose action was used), for the phone's wording */
  what?: MoveSubject | null;
};

/**
 * The engine's turn menu ("Take your first action", "Take your next action"), or the menu of a corporation's first
 * action ("Take first action of ${0} corporation" or pass): the engine saves the game before both.
 */
export function isTurnMenuQuestion(w: unknown): boolean {
  const q = w as {type?: string; title?: unknown; options?: Array<{title?: unknown}>} | undefined;
  if (!q || q.type !== 'or') return false;
  const text = (t: unknown) => (typeof t === 'string' ? t : (t as {message?: string} | undefined)?.message ?? '').trim();
  return /^take your (first|next) action/i.test(text(q.title)) || !!q.options?.some((o) => /^take first action of/i.test(text(o.title)));
}

/** Which turn-menu option an answer chose. */
export function menuChoice(w: unknown, response: unknown): MoveRecord['kind'] {
  const q = w as {options?: Array<{title?: unknown}>} | undefined;
  const r = response as {type?: string; index?: number} | undefined;
  const t = r?.type === 'or' && typeof r.index === 'number' ? q?.options?.[r.index]?.title : undefined;
  const text = (typeof t === 'string' ? t : (t as {message?: string} | undefined)?.message ?? '').trim();
  if (/^end turn/i.test(text)) return 'end';
  if (/^pass/i.test(text)) return 'pass';
  return 'action';
}

export type MoveSubject = {card: string; play: boolean};

/** The card a turn-menu answer played (`play`) or whose action it used (null for other moves). */
export function moveSubject(response: unknown): MoveSubject | null {
  const r = response as {type?: string; response?: unknown; card?: string; cards?: string[]} | undefined;
  if (!r) return null;
  if (r.type === 'projectCard' && typeof r.card === 'string') return /standard project/i.test(r.card) ? null : {card: r.card, play: true};
  if (r.type === 'card' && Array.isArray(r.cards) && r.cards.length === 1) return {card: r.cards[0], play: false};
  if (r.type === 'or') return moveSubject(r.response);
  return null;
}

export const DREW_CARDS_TEXT = 'You drew cards during this move, so it can no longer be taken back.';
export const NEW_GENERATION_TEXT = 'A new generation has started, so your last move can no longer be undone.';

/** Where the seat stands now, from its own engine model. */
export type SeatNow = {question: boolean; menu: boolean; phase: string; generation: number; active: boolean; hand: string[]};

export function seatNow(m: {game: {phase: string; generation: number}; waitingFor?: unknown; cardsInHand?: Array<{name: string}>;
  thisPlayer?: {color: string}; players?: Array<{color: string; isActive: boolean}>}): SeatNow {
  const color = m.thisPlayer?.color;
  return {question: m.waitingFor !== undefined && m.waitingFor !== null, menu: isTurnMenuQuestion(m.waitingFor), phase: m.game.phase,
    generation: m.game.generation, active: !!m.players?.some((p) => p.isActive && p.color === color), hand: (m.cardsInHand ?? []).map((c) => c.name)};
}

export type BackPlan = {ok: true; target: MovePre; what: MoveSubject | null} | {ok: false; reason: string};

/**
 * "Back" during a follow-up question of your own move: reload the save the move started from. Offered (null means not
 * offered at all) when the seat is active in the action phase with a follow-up question, and every answer since its
 * last turn-menu answer is its own (the move is still open). Refused when the move drew cards: taking it back would
 * show the player cards from the deck.
 */
export function planBack(moves: MoveRecord[], playerId: string, now: SeatNow): BackPlan | null {
  if (!now.question || now.menu || now.phase !== 'action' || !now.active) return null;
  const last = moves.at(-1);
  if (!last || last.playerId !== playerId || !last.midAfter) return null;
  let i = moves.length - 1;
  while (i >= 0 && moves[i].playerId === playerId && moves[i].kind === 'followUp') i--;
  const start = moves[i];
  if (!start || start.playerId !== playerId || start.kind !== 'action' || !start.pre) return null;
  if (start.pre.generation !== now.generation) return null;
  const before = new Set(start.pre.hand);
  if (now.hand.some((c) => !before.has(c))) return {ok: false, reason: DREW_CARDS_TEXT};
  return {ok: true, target: start.pre, what: start.what ?? null};
}

export type BotUndoPlan =
  | {ok: true; target: MovePre & {color: string}; bots: number; botNames: string[]; steps: number}
  | {ok: false; code: InputCode; reason: string};

/**
 * Undo through bot moves: when every answer since this player's own last one came from bots, the player may take back
 * their last move and everything the bots did after it. The target is the save before the player's last move (a move
 * that ended with End Turn goes back to before the action it ended). `steps` is how many engine saves lie after the
 * target: one per finished turn-menu answer from the target on (the save the next turn menu makes); a move still in
 * its follow-ups has made none yet. It also applies when nobody has moved since and the turn has passed to someone else
 * (a person who has not answered anything yet): the undo window stays open until the next person actually moves.
 * null when this does not apply (nothing of yours to undo; your move is still in its follow-ups, where Back covers it;
 * or it is still your turn, where the engine's own Undo covers it).
 */
export function planBotUndo(moves: MoveRecord[], playerId: string, now: {phase: string; generation: number; active?: boolean}): BotUndoPlan | null {
  let h = moves.length - 1;
  while (h >= 0 && moves[h].playerId !== playerId) h--;
  if (h < 0) return null;
  const after = moves.slice(h + 1);
  if (!after.length && (now.active !== false || moves[h].midAfter)) return null;
  const human = after.find((m) => !m.bot);
  if (human) return {ok: false, code: 'undoWindow', reason: undoWindowText(human.name)};
  let s = h;
  while (s >= 0 && !(moves[s].playerId === playerId && moves[s].kind !== 'followUp')) {
    if (moves[s].playerId !== playerId) return null;
    s--;
  }
  if (s < 0 || !moves[s].pre) return null;
  if (moves[s].kind === 'end') {
    // End Turn alone changes nothing on the table: go back to before the action it ended, when that is in the same turn
    let a = s - 1;
    while (a >= 0 && moves[a].playerId === playerId && moves[a].kind === 'followUp') a--;
    if (a >= 0 && moves[a].playerId === playerId && moves[a].kind === 'action' && moves[a].pre) s = a;
  }
  const target = moves[s].pre!;
  if (now.phase !== 'action' || now.generation !== target.generation) return {ok: false, code: 'undoWindow', reason: NEW_GENERATION_TEXT};
  const bot = after.filter((m) => m.kind === 'action' || m.kind === 'pass');
  const finished = moves.slice(s).filter((m) => m.kind !== 'followUp').length - (moves.at(-1)!.midAfter ? 1 : 0);
  return {ok: true, target: {...target, color: moves[s].color}, bots: bot.length, botNames: [...new Set(bot.map((m) => m.name))], steps: Math.max(1, finished)};
}

/** Has a rollback reached the target? The seat's own engine model after a step. */
export function atTarget(m: {game: {gameAge: number; generation: number}; waitingFor?: unknown; thisPlayer?: {color: string; actionsTakenThisRound?: number};
  players?: Array<{color: string; isActive: boolean}>}, t: MovePre & {color: string}): boolean {
  return m.game.gameAge === t.age && m.game.generation === t.generation && isTurnMenuQuestion(m.waitingFor) &&
    m.thisPlayer?.color === t.color && (m.thisPlayer?.actionsTakenThisRound ?? 0) === t.acts && !!m.players?.some((p) => p.isActive && p.color === t.color);
}

/**
 * The text of an undo notice for one device: "You undid your last move" on the undoer's phone, "<name> undid their last
 * move" elsewhere; an undo through bot moves says how many it took back ("Ada took back their move and 2 bot moves").
 */
export function undoNoticeText(n: {playerId: string | null; name: string; bots?: number}, meId?: string | null): string {
  const me = !!meId && n.playerId === meId;
  if (n.bots) return `${me ? 'You' : n.name} took back ${me ? 'your' : 'their'} move and ${botMovesText(n.bots)}`;
  return me ? 'You undid your last move' : `${n.name} undid their last move`;
}

/** "2 bot moves", "1 bot move". */
export function botMovesText(n: number): string {
  return `${n} bot ${n === 1 ? 'move' : 'moves'}`;
}
