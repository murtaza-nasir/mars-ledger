// Full-game mode: routes each socket to its private engine view and keeps every device current.
// Players get their own PlayerViewModel (their hand is private); the TV and seatless phones get
// the spectator model. Views are pushed on hello, after every input, and when a poll sees the
// engine's gameAge/undoCount move (another player acted, the engine auto-advanced, a restart).
// Every view carries a version (src/shared/sync.ts); one push batch is a consistent cut of the game; every push to
// a socket (hello and resync included) goes through one queue, so a socket's views arrive in order; every few seconds each
// socket hears the version it was last sent, so a client that missed one (or sits on a dead socket) can heal itself.
// Answers go to the engine one at a time, each checked against the seat's current question and the view the phone
// answered (judgeInput); an undo is announced to every device with the views after it, and rewinds the story.
// Taking moves back (rewind): "Back" during your own move's follow-up questions reloads the save the move started from,
// told to nobody (nobody saw the move finish); "undo" takes back your last move and the bot moves after it, one engine
// save at a time, and is announced like an undo. Both use the engine's load_game route (see planBack/planBotUndo).
import type {BoardName} from '../../shared/board';
import type {WebSocket} from 'ws';
import type {GameState} from '../../shared/game';
import {PLAYER_COLORS} from '../../shared/game';
import type {Color, FullLink, FullView, Hover, InputResponse, LogLine, PlayerViewModel, ProductionShow, SpectatorModel} from '../../shared/full';
import {deadEndReason, promptTitle} from '../../shared/deadend';
import {serverBuild} from '../build';
import type {DeadEnd} from '../../shared/deadend';
import {productionIncome} from '../../shared/production';
import type {ServerMsg} from '../../shared/protocol';
import {EngineClient} from './engine';
import {HistoryKeeper} from './history';
import {isBotSeat} from '../../shared/bots';
import type {GameHistory} from '../../shared/history';
import {atTarget, consistentCut, CUT_RETRIES, HEARTBEAT_MS, isRewind, isTurnMenuQuestion, isUndoAnswer, judgeInput, menuChoice, modelFingerprint, MOVED_ON_TEXT, moveSubject,
  planBack, planBotUndo, ResyncLimiter, sameQuestion, seatNow, undoChangedText, UNDO_NOTICE_MS} from '../../shared/sync';
import type {InputCode, MoveRecord, Seen, UndoNotice, ViewVersion} from '../../shared/sync';

type Identity = {role: 'phone' | 'tv'; playerId: string | null};

/** An answer the server would not pass to the engine; `code` tells the phone to show the new situation. */
export class InputRefused extends Error {
  constructor(readonly code: InputCode, message: string) { super(message); }
}

/**
 * What an undo or other rewind means to the rest of the server: who (null when it was not an undo through us) and from when.
 * `actors`: every player whose moves were taken back (an undo through bot moves names the bots too); `kind` 'back' is a
 * move left during its follow-up questions (no notice: nobody saw it finish).
 */
export type Rewind = {gameId: string; notice: UndoNotice | null; actor: Color | null; since: number | null; actors?: Color[]; kind?: 'undo' | 'back' | 'bots'};

/** A move taken back through rewind(): the bot desk holds the bots after an undo through their moves. */
export type TakeBack = {kind: 'back' | 'bots'; playerId: string; bots: number; steps: number; humanTurn: boolean};

export const BACK_GONE_TEXT = 'That move has already finished. Here is the new situation.';
export const NOTHING_TO_UNDO_TEXT = 'Nothing of yours to undo right now.';

export class FullBridge {
  private ids = new Map<WebSocket, Identity>();
  private lastKey = '';
  private polling = false;
  private timer: NodeJS.Timeout;
  private beat: NodeJS.Timeout;
  /** This server process, and its count of views sent: with the engine's gameAge/undoCount they make a view's version. */
  private readonly boot = Date.now();
  private seq = 0;
  /** The version last sent to each socket (what its heartbeat says it should be showing). */
  private sent = new Map<WebSocket, ViewVersion>();
  private limits = new Map<WebSocket, ResyncLimiter>();
  /** Counters for the logs and tests: batches refetched because their views disagreed, resyncs served and refused. */
  readonly syncStats = {batches: 0, shared: 0, refetches: 0, uncut: 0, resyncs: 0, refused: 0};
  /** The most recent spectator model, for the server's own decisions (e.g. has the game ended). */
  lastSpectator: SpectatorModel | null = null;
  /** The newest spectator model by gameAge, used to spot a generation paying out. */
  private observed: {gameId: string; model: SpectatorModel} | null = null;
  /** The last production show, re-sent to devices that connect while it is still playing. */
  private show: ProductionShow | null = null;
  /** Called with every fresh engine model (prev is null on first sight); mission control listens here. */
  onObserve: ((gameId: string, prev: SpectatorModel | null, next: SpectatorModel, history: GameHistory | null) => void) | null = null;
  /** A question in the linked game that no answer can satisfy (said once per game; re-sent on hello). */
  deadEnd: DeadEnd | null = null;
  /** Called after every accepted input and every refresh (the bot desk looks at its questions then). */
  onInput: (() => void) | null = null;
  /** Called once a production show has been broadcast (the turn clock does not count the show). */
  onShow: ((show: ProductionShow) => void) | null = null;
  /**
   * Called with every consistent cut: the spectator model and each human seat's own view with its log lines (table-sense
   * notices). While it is set, seats without a phone are fetched too, so a sleeping phone still hears what happened.
   */
  onSeatViews: ((gameId: string, spectator: SpectatorModel, views: Array<{playerId: string; model: PlayerViewModel; logs: LogLine[]}>) => void) | null = null;
  /** Called when the engine went back (an undo): the away journal and mission control forget what was undone. */
  onRewind: ((r: Rewind) => void) | null = null;
  /** Called after a move was taken back through rewind() (the bot desk holds the bots after an undo through theirs). */
  onTakeBack: ((t: TakeBack) => void) | null = null;
  /** Called after every accepted answer (a person's move releases the bots held after an undo). */
  onAnswer: ((playerId: string, bot: boolean) => void) | null = null;
  // ---- Undo -------------------------------------------------------------------------------------------------
  /** Undos (and other rewinds) seen by this process; every view carries it, and an answer from an older epoch is refused. */
  private epoch = 0;
  private lastUndo: UndoNotice | null = null;
  /** The last accepted move by anyone (the undo window), and each seat's gameAge after its own last answer (double taps). */
  private lastMove: {playerId: string; name: string} | null = null;
  private ownAge = new Map<string, {epoch: number; age: number}>();
  /** Answers reach the engine one at a time, so the check and the answer see the same game. */
  private inputChain: Promise<unknown> = Promise.resolve();
  /** Accepted answers so far; a fetch remembers the count when it starts, so an undo applies only to fetches made after it. */
  private answers = 0;
  private rewindFrom: number | null = null;
  /** When each gameAge of the current epoch was first observed (the away journal forgets entries after an undo's target). */
  private firstSeen = new Map<number, number>();
  /** Accepted answers since the last undo (the extended undo window and "Back"); a rewind starts it again. */
  private moves: MoveRecord[] = [];
  /** A rewind through rewind() waiting to be observed: what kind, who backed out, whose moves went. */
  private taken: {kind: 'back' | 'bots'; color: Color; actors: Color[]} | null = null;
  /** The engine is being stepped back: the poll stays away, so no screen sees (and nothing counts) a moment in between. */
  private rewinding = false;
  static readonly MOVES_KEPT = 80;
  static readonly SHOW_LEAD_MS = 700;
  static readonly SHOW_MS = 6800;

  constructor(
    readonly engine: EngineClient,
    private state: () => GameState,
    private sockets: () => Iterable<WebSocket>,
    private send: (ws: WebSocket, msg: ServerMsg) => void,
    pollMs = Number(process.env.ENGINE_POLL_MS ?? 1200),
    private history: HistoryKeeper | null = null,
    heartbeatMs = Number(process.env.SYNC_HEARTBEAT_MS ?? HEARTBEAT_MS),
  ) {
    this.timer = setInterval(() => void this.poll(), pollMs);
    this.timer.unref();
    this.beat = setInterval(() => this.heartbeat(), heartbeatMs);
    this.beat.unref();
  }

  private link(): FullLink | null {
    const s = this.state();
    return s.mode === 'full' && s.full ? s.full : null;
  }

  /** Create the engine game for the lobby's players, in turn order. */
  async createGame(players: Array<{id: string; name: string; color: Color; beginner?: boolean}>, draft: boolean, board: BoardName = 'tharsis', prelude = false, fastMode = false): Promise<FullLink> {
    // The engine rejects duplicate colours; give any clash the first free colour.
    const used = new Set<Color>();
    const seats = players.map((p) => {
      let color = p.color;
      if (used.has(color)) color = PLAYER_COLORS.find((c) => !used.has(c)) ?? color;
      used.add(color);
      return {...p, color};
    });
    const g = await this.engine.createGame({players: seats.map((p) => ({name: p.name, color: p.color, beginner: !!p.beginner})), draft, board, prelude, fastMode});
    const out: FullLink = {gameId: g.id, spectatorId: g.spectatorId, players: {}, ...(g.name ? {name: g.name} : {})};
    for (const seat of seats) {
      const ep = g.players.find((x) => x.color === seat.color);
      if (!ep) throw new Error(`The engine did not seat ${seat.name}`);
      out.players[seat.id] = {engineId: ep.id, color: seat.color};
    }
    return out;
  }

  hello(ws: WebSocket, id: Identity) {
    // A bot's seat is played by the server: a phone that names it is shown the table, never the bot's hand.
    if (id.playerId && isBotSeat(this.state(), id.playerId)) id = {...id, playerId: null};
    this.ids.set(ws, id);
    this.send(ws, {type: 'build', build: serverBuild()});
    // A device joining mid-show gets it too; clients skip shows they have already played (by id).
    if (this.show && Date.now() < this.show.startAt + this.show.durationMs) this.send(ws, {type: 'production', show: {...this.show, serverNow: Date.now()}});
    const link = this.link();
    if (link && this.history) this.send(ws, {type: 'history', history: this.history.get(link.gameId)});
    if (link && this.deadEnd?.gameId === link.gameId) this.send(ws, {type: 'deadEnd', deadEnd: this.deadEnd});
    if (link && this.lastUndo?.gameId === link.gameId && Date.now() - this.lastUndo.at < UNDO_NOTICE_MS) this.send(ws, {type: 'fullUndo', notice: this.lastUndo});
    void this.pushTo(ws).catch((e) => console.warn('full: push on hello failed:', (e as Error).message));
  }

  /** The player a phone speaks for, from its hello (null for the TV and unknown sockets). */
  playerOf(ws: WebSocket): string | null {
    return this.ids.get(ws)?.playerId ?? null;
  }

  /** When the latest production show starts on the server clock (reactions keep quiet in its first second). */
  get showStartAt(): number | null {
    return this.show?.startAt ?? null;
  }

  /** Is this socket the TV? (Phones and unknown sockets are not.) */
  isTv(ws: WebSocket): boolean {
    return this.ids.get(ws)?.role === 'tv';
  }

  forget(ws: WebSocket) {
    this.ids.delete(ws);
    this.sent.delete(ws);
    this.limits.delete(ws);
  }

  /** The version last sent to this socket (null before its first view). */
  versionOf(ws: WebSocket): ViewVersion | null {
    return this.sent.get(ws) ?? null;
  }

  /**
   * A client asks for a fresh view: its screen is behind the version its heartbeat named, or the page came back (visible,
   * online). Served through the push queue, so it cannot overtake a batch; a socket asking too often hears its version.
   */
  resync(ws: WebSocket) {
    let limit = this.limits.get(ws);
    if (!limit) { limit = new ResyncLimiter(); this.limits.set(ws, limit); }
    if (!limit.allow(Date.now())) {
      this.syncStats.refused++;
      this.send(ws, {type: 'version', v: this.versionOf(ws), serverNow: Date.now()});
      return;
    }
    this.syncStats.resyncs++;
    void this.pushTo(ws).catch((e) => console.warn('full: resync failed:', (e as Error).message));
  }

  /**
   * Every socket hears the version it was last sent (and the server clock, for timing shows that arrive late). The server
   * also pings each socket and closes one that has missed DEAD_AFTER_PINGS pongs in a row: a phone that slept or lost the
   * Wi-Fi leaves a socket that looks open, and it would otherwise count as a phone at the table until TCP gives up.
   */
  private heartbeat() {
    const now = Date.now();
    for (const ws of this.sockets()) {
      this.send(ws, {type: 'version', v: this.versionOf(ws), serverNow: now, build: serverBuild(now)});
      if (typeof ws.ping !== 'function') continue;
      if (!this.missed.has(ws)) { this.missed.set(ws, 0); ws.on('pong', () => this.missed.set(ws, 0)); }
      const missed = this.missed.get(ws)!;
      if (missed >= FullBridge.DEAD_AFTER_PINGS) { this.missed.delete(ws); ws.terminate(); continue; }
      this.missed.set(ws, missed + 1);
      try { ws.ping(); } catch { /* closing */ }
    }
  }
  private missed = new WeakMap<WebSocket, number>();
  static readonly DEAD_AFTER_PINGS = 4;

  private stamp(view: FullView): ViewVersion {
    return {age: view.model.game.gameAge, undo: view.model.game.undoCount, boot: this.boot, seq: ++this.seq, epoch: this.epoch};
  }

  private sendView(ws: WebSocket, view: FullView) {
    const v = this.stamp(view);
    this.sent.set(ws, v);
    this.send(ws, {type: 'full', view: {...view, lastMove: this.lastMove, ...this.offers(view)}, v});
  }

  /** What a view may offer: "Back" out of the seat's open move, undo through bot moves, and which seat is mid-move. */
  private offers(view: FullView): Pick<FullView, 'moving' | 'back' | 'undoMine'> {
    const last = this.moves.at(-1);
    const moving = last && !last.bot && last.midAfter ? last.color as Color : null;
    if (view.role !== 'player') return {moving};
    const now = seatNow(view.model);
    const back = planBack(this.moves, view.playerId, now);
    const undo = planBotUndo(this.moves, view.playerId, now);
    return {moving,
      back: back ? (back.ok ? {ok: true, what: back.what} : {ok: false, reason: back.reason}) : null,
      undoMine: undo ? (undo.ok ? {ok: true, bots: undo.bots} : {ok: false, reason: undo.reason}) : null};
  }

  /**
   * Answer the engine for a seat. Only the bot desk may answer for a bot seat (`asBot`). `seen` is the view the phone
   * answered: the answer is checked against the seat's current question first, under a lock, and refused with
   * InputRefused when it was made against an older game. An undo is announced to every device before the new views.
   */
  async input(playerId: string, response: InputResponse, asBot = false, seen?: Seen | null) {
    const link = this.link();
    if (!link) throw new Error('No full game is running');
    const seat = link.players[playerId];
    if (!seat) throw new Error('You do not have a seat in this game');
    if (isBotSeat(this.state(), playerId) !== asBot) throw new Error(asBot ? 'That seat is not a bot' : 'A bot plays that seat');
    const notice = await this.locked(async () => {
      const fresh = await this.engine.player(seat.engineId);
      const isUndo = isUndoAnswer(fresh.waitingFor, response);
      const own = this.ownAge.get(playerId);
      const verdict = judgeInput({playerId, fresh, seen, isUndo, boot: this.boot, epoch: this.epoch, lastUndo: this.lastUndo,
        ownAge: own && own.epoch === this.epoch ? own.age : null, lastMove: this.lastMove,
        activeName: fresh.players?.find((p) => p.isActive && p.color !== seat.color)?.name ?? null});
      if (!verdict.ok) throw new InputRefused(verdict.code, verdict.error);
      const after = await this.engine.input(seat.engineId, response);
      this.answers++;
      if (isUndo) return this.noteUndo(link, playerId, fresh, after);
      this.lastMove = {playerId, name: this.nameOf(playerId, fresh.thisPlayer?.name)};
      this.ownAge.set(playerId, {epoch: this.epoch, age: after.game.gameAge});
      this.noteMove(playerId, seat.color, asBot, fresh, after, response);
      return null;
    });
    try { this.onAnswer?.(playerId, asBot); } catch (e) { console.warn('full: answer observer failed:', (e as Error).message); }
    // Everyone hears about an undo first, then gets the views after it (an open question on another phone closes then).
    if (notice) for (const ws of this.sockets()) this.send(ws, {type: 'fullUndo', notice});
    await this.pushAll();
  }

  /** Keep an accepted answer for the undo window: a turn-menu answer remembers the save it started from. */
  private noteMove(playerId: string, color: Color, bot: boolean, fresh: PlayerViewModel, after: PlayerViewModel, response: InputResponse) {
    const menu = isTurnMenuQuestion(fresh.waitingFor);
    this.moves.push({playerId, name: this.nameOf(playerId, fresh.thisPlayer?.name), color, bot,
      kind: menu ? menuChoice(fresh.waitingFor, response) : 'followUp',
      pre: menu ? {age: fresh.game.gameAge, generation: fresh.game.generation, acts: fresh.thisPlayer?.actionsTakenThisRound ?? 0,
        hand: (fresh.cardsInHand ?? []).map((c) => c.name)} : undefined,
      midAfter: after.game.phase === 'action' && !!after.waitingFor && !isTurnMenuQuestion(after.waitingFor),
      what: menu ? moveSubject(response) : undefined});
    if (this.moves.length > FullBridge.MOVES_KEPT) this.moves.splice(0, this.moves.length - FullBridge.MOVES_KEPT);
  }

  /**
   * Take a move back for a person (never a bot). 'back': the seat is answering a follow-up question of its own move;
   * the engine reloads the save made when the move started (the turn menu), so the card returns to the hand and its cost
   * is refunded. No notice: the move never finished. 'undo': every answer since the seat's last move came from bots; the
   * engine steps back one save at a time (each step checked) until the seat's turn menu before that move, and every
   * device hears "<name> took back their move and 2 bot moves". Runs under the input lock; refused with InputRefused.
   */
  async rewind(playerId: string, what: 'back' | 'undo', seen?: Seen | null): Promise<void> {
    const link = this.link();
    if (!link) throw new Error('No full game is running');
    const seat = link.players[playerId];
    if (!seat) throw new Error('You do not have a seat in this game');
    if (isBotSeat(this.state(), playerId)) throw new Error('A bot plays that seat');
    const done = await this.locked(async () => {
      // a poll already under way finishes first, so nothing observes the engine between two steps
      this.rewinding = true;
      try { await this.pushChain; return await this.takeBack(link, playerId, what, seen); } finally { this.rewinding = false; }
    });
    if (done.notice) for (const ws of this.sockets()) this.send(ws, {type: 'fullUndo', notice: done.notice});
    try { this.onTakeBack?.(done.take); } catch (e) { console.warn('full: take-back observer failed:', (e as Error).message); }
    await this.pushAll();
  }

  private async takeBack(link: FullLink, playerId: string, what: 'back' | 'undo', seen?: Seen | null): Promise<{take: TakeBack; notice: UndoNotice | null}> {
    const seat = link.players[playerId];
    const fresh = await this.engine.player(seat.engineId);
    if (seen && seen.boot === this.boot && seen.epoch < this.epoch) {
      const undoer = this.lastUndo && this.lastUndo.epoch > seen.epoch ? this.lastUndo.name : null;
      throw new InputRefused('stale', undoChangedText(undoer));
    }
    const now = seatNow(fresh);
    const name = this.nameOf(playerId, fresh.thisPlayer?.name);
    if (what === 'back') {
      const plan = planBack(this.moves, playerId, now);
      if (!plan) throw new InputRefused('stale', BACK_GONE_TEXT);
      if (!plan.ok) throw new InputRefused('undoWindow', plan.reason);
      if (seen && !sameQuestion(seen, fresh.waitingFor)) throw new InputRefused('stale', MOVED_ON_TEXT);
      await this.engine.load(link.gameId, 0);
      const after = await this.engine.player(seat.engineId);
      if (!atTarget(after, {...plan.target, color: seat.color})) {
        console.warn(`full: ${name} backed out, but the engine reloaded ${after.game.gameAge} (generation ${after.game.generation}), not the move's start at ${plan.target.age}`);
      }
      this.noteTakeBack({kind: 'back', color: seat.color, actors: [seat.color]});
      console.info(`full: ${name} backed out of their move${plan.what ? ` (${plan.what.card})` : ''} (engine ${fresh.game.gameAge} -> ${after.game.gameAge}, epoch ${this.epoch})`);
      return {take: {kind: 'back', playerId, bots: 0, steps: 0, humanTurn: seatNow(after).active} as TakeBack, notice: null};
    }
    const plan = planBotUndo(this.moves, playerId, now);
    if (!plan) throw new InputRefused('undoWindow', NOTHING_TO_UNDO_TEXT);
    if (!plan.ok) throw new InputRefused(plan.code, plan.reason);
    const actors = [seat.color, ...new Set(this.moves.filter((m) => m.bot).map((m) => m.color as Color))];
    let after = fresh;
    let steps = 0;
    let reached = false;
    // one engine save per step, checked each time: the target is the seat's own turn menu before its last move
    while (!reached && steps < plan.steps + 2) {
      await this.engine.load(link.gameId, 1);
      steps++;
      after = await this.engine.player(seat.engineId);
      reached = atTarget(after, plan.target);
      if (!reached && after.game.gameAge < plan.target.age) break;
    }
    if (!reached) console.warn(`full: ${name}'s undo through bot moves stopped at ${after.game.gameAge} after ${steps} steps (target ${plan.target.age}, planned ${plan.steps})`);
    this.noteTakeBack({kind: 'bots', color: seat.color, actors});
    const notice: UndoNotice = {id: `${link.gameId}:${this.boot}:${this.epoch}`, gameId: link.gameId, playerId, name, color: seat.color, at: Date.now(), epoch: this.epoch, bots: plan.bots};
    this.lastUndo = notice;
    console.info(`full: ${name} took back their move and ${plan.bots} bot moves (engine ${fresh.game.gameAge} -> ${after.game.gameAge} in ${steps} steps, planned ${plan.steps}, epoch ${this.epoch})`);
    return {take: {kind: 'bots', playerId, bots: plan.bots, steps, humanTurn: seatNow(after).active} as TakeBack, notice};
  }

  /** A rewind through rewind(): a new epoch, no last move, and the next observation takes the game as rewound. */
  private noteTakeBack(t: {kind: 'back' | 'bots'; color: Color; actors: Color[]}) {
    this.epoch++;
    this.lastMove = null;
    this.ownAge.clear();
    this.moves = [];
    this.rewindFrom = this.answers;
    this.taken = t;
  }

  private locked<T>(job: () => Promise<T>): Promise<T> {
    const run = this.inputChain.then(job);
    this.inputChain = run.catch(() => {});
    return run;
  }

  private nameOf(playerId: string, fallback?: string): string {
    return this.state().players.find((p) => p.id === playerId)?.name ?? fallback ?? 'A player';
  }

  /** The engine took a move back: a new epoch (older answers are refused), no last move, and a notice for every device. */
  private noteUndo(link: FullLink, playerId: string, before: PlayerViewModel, after: PlayerViewModel): UndoNotice | null {
    // The engine answers an undo it could not perform with the unchanged model (it logs the failure privately).
    if (!isRewind(before.game, after.game) && before.thisPlayer?.actionsTakenThisRound === after.thisPlayer?.actionsTakenThisRound) return null;
    this.epoch++;
    this.lastMove = null;
    this.ownAge.clear();
    this.moves = [];
    this.taken = null;
    this.rewindFrom = this.answers;
    const notice: UndoNotice = {id: `${link.gameId}:${this.boot}:${this.epoch}`, gameId: link.gameId, playerId, name: this.nameOf(playerId, before.thisPlayer?.name),
      color: link.players[playerId]?.color ?? null, at: Date.now(), epoch: this.epoch};
    this.lastUndo = notice;
    console.info(`full: ${notice.name} undid their last move (engine ${before.game.gameAge}.${before.game.undoCount} -> ${after.game.gameAge}.${after.game.undoCount}, epoch ${this.epoch})`);
    return notice;
  }

  relayHover(h: Hover) {
    const link = this.link();
    // Only seated players can hover, and a phone can only speak for itself (its colour comes from the link).
    const seat = link?.players[h.playerId];
    if (!seat) return;
    const msg: ServerMsg = {type: 'hover', hover: {...h, color: seat.color}};
    for (const ws of this.sockets()) this.send(ws, msg);
  }

  private async viewFor(id: Identity | undefined, spectator: () => Promise<SpectatorModel>): Promise<FullView | null> {
    const link = this.link();
    if (!link) return null;
    const seat = id?.role === 'phone' && id.playerId ? link.players[id.playerId] : undefined;
    if (seat && id?.playerId) {
      const [model, logs] = await Promise.all([this.engine.player(seat.engineId), this.engine.logs(seat.engineId).catch(() => [])]);
      this.checkDeadEnd(id.playerId, model);
      return {role: 'player', playerId: id.playerId, model, logs};
    }
    const [model, logs] = await Promise.all([spectator(), this.engine.logs(link.spectatorId).catch(() => [])]);
    return {role: 'spectator', model, logs};
  }

  /** Refresh one socket (hello, resync). Queued with the batches, so a slower fetch never lands after a newer batch. */
  pushTo(ws: WebSocket): Promise<void> {
    return this.enqueue(async () => {
      const link = this.link();
      if (!link) return;
      const view = await this.viewFor(this.ids.get(ws), () => this.engine.spectator(link.spectatorId));
      if (view) this.sendView(ws, view);
    });
  }

  /**
   * Note a fresh spectator model. When the generation has advanced since the newest model we had,
   * production just paid out: broadcast the show, computed from that pre-production model.
   */
  private observe(link: FullLink, s: SpectatorModel, fetchedAfter = this.answers) {
    let prev = this.observed?.gameId === link.gameId ? this.observed.model : null;
    if (!prev) this.firstSeen.clear();
    // Observations arrive in fetch order (every fetch runs in the push queue), so a lower gameAge is a rewind, never a slow
    // fetch. An undo through input() counts once a fetch made after it arrives, even if the engine's numbers did not move.
    const undone = this.rewindFrom !== null; // an undo through input() waits to be observed
    if (prev && ((undone && fetchedAfter >= this.rewindFrom!) || isRewind(prev.game, s.game))) {
      if (!undone) { this.epoch++; this.lastMove = null; this.ownAge.clear(); this.moves = []; } // not through us (an engine restart reloading a save)
      this.rewindFrom = null;
      const taken = undone ? this.taken : null;
      this.taken = null;
      const since = this.firstSeen.get(s.game.gameAge) ?? null;
      for (const age of [...this.firstSeen.keys()]) if (age > s.game.gameAge) this.firstSeen.delete(age);
      // a move left during its follow-ups ("Back") is no undo: no notice, and the story does not count one
      const notice = undone && taken?.kind !== 'back' && this.lastUndo?.gameId === link.gameId ? this.lastUndo : null;
      const actor = taken?.color ?? (notice?.color as Color | null | undefined) ?? s.players.find((p) => p.isActive)?.color ?? null;
      // the story goes back to where the restored moment was first seen; observing it below as a fresh look sends it out
      this.history?.rewind(link.gameId, s, notice ? actor : null);
      try {
        this.onRewind?.({gameId: link.gameId, notice, actor, since, actors: taken?.actors ?? (actor ? [actor] : []), kind: taken?.kind ?? 'undo'});
      } catch (e) { console.warn('full: rewind observer failed:', (e as Error).message); }
      // the rest of the server takes the rewound game as a fresh look (no diff against the undone moment)
      prev = null;
    }
    this.observed = {gameId: link.gameId, model: s};
    const storyGrew = this.history?.observe(link.gameId, prev, s) ?? false;
    if (storyGrew) this.broadcastHistory(link);
    try { this.onObserve?.(link.gameId, prev, s, this.history?.get(link.gameId) ?? null); } catch (e) { console.warn('full: observer failed:', (e as Error).message); }
    // after the observers (the away journal dates its entries now): entries later than this belong to the undone future
    if (!this.firstSeen.has(s.game.gameAge)) this.firstSeen.set(s.game.gameAge, Date.now());
    if (!prev) return;
    // A new generation means production paid out. The last production of the game does not advance
    // the generation (the engine goes straight to final greeneries), so also accept the one change
    // only production makes: every player's M€ rising by exactly M€ production + TR at once.
    // Exactly one generation: when screens were away for longer (no socket, so no fetch), `prev` is generations old
    // and a show built from it would pay out old numbers and queue a recap of a long-gone generation.
    const advanced = s.game.generation === prev.game.generation + 1;
    const finalPayout = s.game.generation === prev.game.generation && prev.players.length > 0 &&
      prev.players.some((p) => p.megacreditProduction + p.terraformRating > 0) &&
      prev.players.every((p) => {
        const now = s.players.find((x) => x.color === p.color);
        return now !== undefined && now.megacredits === p.megacredits + p.megacreditProduction + p.terraformRating;
      });
    if (!advanced && !finalPayout) return;
    if (finalPayout && this.history?.closeFinal(link.gameId, prev)) this.broadcastHistory(link);
    const byColor = new Map(Object.entries(link.players).map(([id, seat]) => [seat.color, id]));
    const now = Date.now();
    const show: ProductionShow = {
      id: `${link.gameId}:g${prev.game.generation}${advanced ? '' : ':final'}`,
      generation: prev.game.generation + 1, // screens label the show "Generation {generation - 1} pays out"
      startAt: now + FullBridge.SHOW_LEAD_MS,
      serverNow: now,
      durationMs: FullBridge.SHOW_MS,
      players: prev.players.map((p) => {
        const inc = productionIncome(p);
        return {playerId: byColor.get(p.color) ?? null, color: p.color, name: p.name, before: inc.before, gains: inc.gains, energyToHeat: inc.energyToHeat};
      }),
    };
    this.show = show;
    for (const ws of this.sockets()) this.send(ws, {type: 'production', show});
    try { this.onShow?.(show); } catch (e) { console.warn('full: show observer failed:', (e as Error).message); }
  }

  private broadcastHistory(link: FullLink) {
    if (!this.history) return;
    const history = this.history.get(link.gameId);
    for (const ws of this.sockets()) this.send(ws, {type: 'history', history});
  }

  /**
   * Refresh every socket, one refresh at a time so devices receive views in order (a later refresh never lands first).
   * A batch that is queued but not started yet fetches the engine when it starts, so it already covers any change made
   * before then: further requests share it instead of queueing one batch each (fast bots made 25 batches a second, and
   * screens fell a second or two behind working through them).
   */
  pushAll(spectatorModel?: SpectatorModel): Promise<void> {
    if (this.queued) { this.syncStats.shared++; return this.queued; }
    const run = this.enqueue(() => { this.queued = null; return this.pushAllNow(spectatorModel); });
    this.queued = run;
    return run;
  }
  private queued: Promise<void> | null = null;
  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.pushChain.then(job);
    this.pushChain = run.catch(() => {});
    return run;
  }
  private pushChain: Promise<void> = Promise.resolve();

  /**
   * Each distinct player model and the spectator model are fetched once, and sent only once they agree on the engine's
   * gameAge/undoCount (a move landing between two fetches would otherwise give the TV and a phone different moments).
   */
  private async pushAllNow(spectatorModel?: SpectatorModel, spectatorAfter?: number) {
    const link = this.link();
    if (!link) return;
    const sockets = [...this.sockets()];
    const keyOf = (ws: WebSocket) => {
      const id = this.ids.get(ws);
      return id?.role === 'phone' && id.playerId && link.players[id.playerId] ? `p:${id.playerId}` : 'spectator';
    };
    let given = spectatorModel;
    let givenAfter = spectatorAfter;
    let s: SpectatorModel;
    let views: Map<string, FullView | null>;
    this.syncStats.batches++;
    for (let attempt = 0; ; attempt++) {
      // The spectator model comes first: if production just paid out, the show must reach devices
      // before the post-production numbers do, so phones can hold their numerals until tokens land.
      const fetchedAfter = givenAfter ?? this.answers;
      s = given ?? await this.engine.spectator(link.spectatorId);
      given = undefined; givenAfter = undefined;
      this.observe(link, s, fetchedAfter);
      const first = s;
      const spectator = () => Promise.resolve(first);
      const keys = new Map<string, Identity | undefined>();
      for (const ws of sockets) if (!keys.has(keyOf(ws))) keys.set(keyOf(ws), this.ids.get(ws));
      // notices: every human seat's own view, phone or not
      if (this.onSeatViews) {
        for (const id of Object.keys(link.players)) if (!keys.has(`p:${id}`) && !isBotSeat(this.state(), id)) keys.set(`p:${id}`, {role: 'phone', playerId: id});
      }
      const fetched = await Promise.all([...keys].map(async ([key, id]) => [key, await this.viewFor(id, spectator)] as const));
      views = new Map(fetched);
      const models = [s, ...[...views.values()].filter((v) => v !== null).map((v) => v!.model)];
      if (consistentCut(models)) break;
      if (attempt >= CUT_RETRIES) {
        // the engine kept moving under us: send what we have; the move in progress brings its own push right after
        this.syncStats.uncut++;
        break;
      }
      this.syncStats.refetches++;
    }
    for (const ws of sockets) {
      const view = views.get(keyOf(ws));
      if (view) this.sendView(ws, view);
    }
    if (this.onSeatViews) {
      const seats = [...views.values()].flatMap((v) => (v?.role === 'player' ? [{playerId: v.playerId, model: v.model, logs: v.logs ?? []}] : []));
      try { this.onSeatViews(link.gameId, s, seats); } catch (e) { console.warn('full: seat view observer failed:', (e as Error).message); }
    }
    this.lastSpectator = s;
    this.lastKey = `${link.gameId}:${modelFingerprint(s)}`;
    try { this.onInput?.(); } catch (e) { console.warn('full: input observer failed:', (e as Error).message); }
  }

  /**
   * Note a question no answer can satisfy (src/shared/deadend.ts): warn in the server log and tell every device once,
   * so the table can abandon the game from the menu instead of waiting on a game that cannot move.
   */
  checkDeadEnd(playerId: string, model: PlayerViewModel) {
    const link = this.link();
    if (!link || this.deadEnd?.gameId === link.gameId) return;
    const w = model.waitingFor;
    const reason = deadEndReason(w);
    if (!reason || !w) return;
    const player = this.state().players.find((p) => p.id === playerId)?.name ?? model.thisPlayer.name;
    this.deadEnd = {gameId: link.gameId, player, prompt: promptTitle(w), reason, at: Date.now()};
    console.warn(`full: game ${link.gameId} cannot continue: ${player} is asked "${this.deadEnd.prompt}" but ${reason} (generation ${model.game.generation}, phase ${model.game.phase})`);
    for (const ws of this.sockets()) this.send(ws, {type: 'deadEnd', deadEnd: this.deadEnd});
  }

  /** When the latest production show ends on the server clock (bots wait for it; 0 when none is playing). */
  get showEndsAt(): number {
    return this.show ? this.show.startAt + this.show.durationMs : 0;
  }

  private async poll() {
    const link = this.link();
    if (!link || this.polling || this.rewinding) return;
    if (![...this.sockets()].length) return;
    this.polling = true;
    try {
      // In the push queue, like every fetch that is observed: observations then arrive in the order they were fetched,
      // and a rewind (undo) is never confused with a slow fetch.
      await this.enqueue(async () => {
        const after = this.answers;
        const s = await this.engine.spectator(link.spectatorId);
        this.lastSpectator = s;
        this.observe(link, s, after);
        // gameAge alone misses changes the engine makes without a log line (a card's cost taken before it resolves)
        const key = `${link.gameId}:${modelFingerprint(s)}`;
        if (key !== this.lastKey) await this.pushAllNow(s, after);
      });
    } catch (e) {
      console.warn('full: poll failed:', (e as Error).message);
    } finally {
      this.polling = false;
    }
  }

  stop() { clearInterval(this.timer); clearInterval(this.beat); }
}
