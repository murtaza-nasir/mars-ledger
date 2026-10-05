import Fastify from 'fastify';
import {BOARD_NAMES} from '../shared/board';
import type {BoardChoice, BoardName} from '../shared/board';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as path from 'node:path';
import * as fs from 'node:fs';
import QRCode from 'qrcode';
import type {WebSocket} from 'ws';
import {apply, NeedsInput} from '../shared/engine';
import type {Command, GameState, Tick} from '../shared/game';
import type {ClientMsg, ServerMsg} from '../shared/protocol';
import {NUDGE_COOLDOWN_MS} from '../shared/social';
import type {Flick} from '../shared/social';
import {Store} from './store';
import {FullBridge, InputRefused} from './full/bridge';
import {EngineClient} from './full/engine';
import {HistoryKeeper} from './full/history';
import {BOT_HOLD_FOR_TURN_MS, BOT_HOLD_GRACE_MS, BotDesk, botLogger, botTable} from './full/bots';
import {jevLevelConfig, judgeConfigFromEnv, systemOne} from './full/bots/judge/judge';
import {companionHistory} from '../shared/history';
import {recognize, visionEnabled} from './vision';
import {Narrator} from './narrator';
import {HealthCheck, registerHealth} from './health';
import {serverBuild} from './build';
import {configFromEnv, narratorAvailable, voiceAvailable} from './narrator/services';
import {sourceUrl} from '../shared/source';
import {playlistId} from '../shared/radio';
import {TurnClockDesk} from './clock';
import {ReactionDesk} from './reactions';
import {findCard} from '../shared/cards';
import type {NarrationLine} from '../shared/narrator';
import {ProfileDesk, ProfileError} from './profiles';
import {recordCompanion, recordFull} from '../shared/record';
import type {Recording} from '../shared/record';
import type {GameUnlocks, HallOfFame} from '../shared/profiles';
import {companionFacts, fullFacts, POSTER_ORIENTATIONS, POSTER_VARIANTS} from '../shared/poster';
import type {PosterFacts, PosterOrientation, PosterVariant} from '../shared/poster';
import {PosterDesk} from './poster';
import {ForgeClient, forgeConfigFromEnv} from './poster/forge';
import {AwayDesk} from './away';
import type {Return} from './away';
import {AWAY_MIN_MS, buildSummary, companionEntries, fullEntries, showEntry} from '../shared/away';
import type {AwaySummary, Who} from '../shared/away';
import type {Color} from '../shared/full';
import {RadioDesk} from './radio';
import {FlyRelay} from './fly';
import {NoticeDesk} from './notices';
import {hapticFor, TvLinkDesk} from './tvlinks';
import type {Buzz} from '../shared/tvlinks';
import {registerPerf} from './perf';
import {handleTvMoment, primaryTv, readTvMoment} from './tvMoments';
import {Tv3dDesk} from './tv3d';
import {relabelFeed, seatNames} from '../shared/names';
import type {NoticeFeed} from '../shared/notices';

// Load .env when present (dev); in Docker the environment is set directly.
for (const f of ['.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const store = new Store(DATA_DIR);
const RECENT = 40;

let gameId = store.currentGameId();
let {state, ticks} = store.replay(gameId);

const sockets = new Set<WebSocket>();
function send(ws: WebSocket, msg: ServerMsg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg: ServerMsg) { for (const ws of sockets) send(ws, msg); }
function broadcastPhones() { broadcast({type: 'phones', phones: away.phones(), tvs: tvCount()}); }
const snapshot = (): ServerMsg => ({type: 'state', state, recent: ticks.slice(-RECENT)});
const prefsMsg = (): ServerMsg => ({type: 'prefs', prefs: store.seatPrefs(gameId)});

// People across game nights: profiles, finished-game results, achievements, hall of fame.
const profiles = new ProfileDesk(store.db);
/** What the last recorded game unlocked (re-sent to devices that connect while its end screen is up). */
let lastUnlocks: GameUnlocks | null = null;

function sendProfiles(ws: WebSocket) {
  const device = full.playerOf(ws);
  send(ws, {type: 'profiles', profiles: profiles.list(), mine: device ? profiles.deviceProfile(device) : null});
}
function broadcastProfiles() { for (const ws of sockets) sendProfiles(ws); }

// The end-of-game poster: rendered in the background from the library painting that fits the game;
// optionally also a one-off illustration from the shared image server (POSTER_UNIQUE_ENABLED=false removes it).
const forgeConfig = forgeConfigFromEnv();
const posters = new PosterDesk({
  dataDir: DATA_DIR,
  forge: forgeConfig ? new ForgeClient(forgeConfig) : null,
  onStatus: (poster) => {
    broadcast({type: 'poster', poster});
    if (poster.library === 'ready') broadcastFame();
  },
});

/** The hall of fame, with each recent game's poster version when its poster is ready (for thumbnails). */
function fame(): HallOfFame {
  const f = profiles.hallOfFame();
  return {...f, recent: f.recent.map((g) => {
    const s = posters.status(g.gameId);
    return {...g, poster: s?.library === 'ready' ? s.version : null};
  })};
}
function broadcastFame() { broadcast({type: 'fame', fame: fame()}); }
/** The id the current game is known by in results and posters (the engine's id for full games). */
const currentGameId = () => (state.mode === 'full' ? state.full?.gameId ?? state.id : state.id);

/** Record a finished game (again, if scores changed), tell every device what it unlocked, and paint its poster. */
function publishRecording(r: Recording, facts: PosterFacts | null) {
  profiles.recordGame(r.game, r.results);
  lastUnlocks = profiles.gameUnlocks(r.game.gameId, r.seats);
  broadcast({type: 'unlocks', unlocks: lastUnlocks});
  broadcastProfiles();
  broadcastFame();
  if (facts) posters.submit(facts, !!state.posterUnique);
}

function safeFacts(build: () => PosterFacts): PosterFacts | null {
  try { return build(); } catch (e) { console.warn('poster: could not describe the game:', (e as Error).message); return null; }
}

const full = new FullBridge(new EngineClient(), () => state, () => sockets, send, undefined, new HistoryKeeper(store));

// Bot seats: the server answers their engine questions through the same bridge as the phones.
// BOT_DELAY_SCALE scales their human-feeling waits (0 in tests); BOT_LOG appends every decision as a JSON line.
const bots = new BotDesk({
  player: (engineId) => full.playerModel(engineId),
  table: () => botTable(state),
  input: (playerId, response) => full.input(playerId, response, true),
  // the TV's generation recap starts 0.3 s after the show and runs 8.6 s (src/client/tv/cinema/queue.ts)
  holdUntil: (acting) => (full.showEndsAt ? full.showEndsAt + (acting ? 9000 : 0) : 0),
  delayScale: Number(process.env.BOT_DELAY_SCALE ?? 1),
  log: botLogger(),
  onDeadEnd: (playerId, model) => full.checkDeadEnd(playerId, model),
  // Experimental, off by default: BOT_JUDGE=jev lets a decision model pick among Normal's options; BOT_JUDGE_BOTS limits it to the named bots.
  judge: judgeFromEnv(),
  // The Jev bot level (TYPESAFE_API_KEY); without a key Jev seats play as Normal.
  jev: (() => { const config = jevLevelConfig(process.env.TYPESAFE_API_KEY); return config ? {config, call: systemOne(config)} : undefined; })(),
  jevBudgetUsd: Number(process.env.BOT_JEV_BUDGET_USD ?? 0.1),
});
full.onInput = () => bots.kick();
// After a person takes back their move and the bot moves after it, the bots wait for that person's next move (or a short
// grace when it is not their turn), so they do not replay at once; any person's move releases them.
full.onTakeBack = (t) => { if (t.kind === 'bots') bots.hold(t.humanTurn ? BOT_HOLD_FOR_TURN_MS : BOT_HOLD_GRACE_MS); };
full.onAnswer = (_playerId, bot) => { if (!bot) bots.release(); };

function judgeFromEnv() {
  const config = judgeConfigFromEnv();
  if (!config) return undefined;
  const names = (process.env.BOT_JUDGE_BOTS ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
  console.log(`bots: ${config.provider} judge at context ${config.context} (${config.candidates}) for ${names.length ? names.join(', ') : 'every Normal bot'}`);
  return {config, call: systemOne(config), seats: names.length ? (b: {name: string}) => names.includes(b.name.toLowerCase()) : undefined};
}

// "While you were away": which seats have no visible phone, since when, and the facts that happened meanwhile.
const away = new AwayDesk(store.db, () => gameId, {minMs: Number(process.env.AWAY_MIN_MS ?? AWAY_MIN_MS)});
const generationNow = (): number | null => (state.phase === 'lobby' ? null : state.mode === 'full' ? full.lastSpectator?.game.generation ?? null : state.generation);

const PHASE_LABEL: Record<string, string> = {
  setup: 'Choosing corporations', preludes: 'Preludes', research: 'Research', drafting: 'Drafting', production: 'Production',
  finalGreenery: 'Final greeneries', ended: 'The game is over', end: 'The game is over', solar: 'Solar phase', intergeneration: 'Between generations',
};

/** What changed for a returning player, or null when nothing worth telling happened. */
function awaySummary(r: Return): AwaySummary | null {
  if (state.phase === 'lobby') return null;
  const me = state.players.find((p) => p.id === r.player);
  if (!me) return null;
  // Full games: the engine may have given a seat a different colour than the lobby one.
  const colorOf = (id: string) => (state.mode === 'full' ? state.full?.players[id]?.color : undefined) ?? (me.id === id ? me.color : state.players.find((p) => p.id === id)?.color) as Color;
  const players: Who[] = state.players.map((p) => ({color: colorOf(p.id), name: p.name}));
  const myColor = colorOf(me.id);
  let turn: AwaySummary['turn'];
  if (state.mode === 'full') {
    const s = full.lastSpectator;
    const active = s?.players.find((p) => p.isActive);
    const phase = s?.game.phase ?? null;
    const who = active ? players.find((p) => p.color === active.color) ?? null : null;
    turn = {who: phase === 'action' ? who : null, mine: phase === 'action' && !!who && who.color === myColor, phase: phase && phase !== 'action' ? PHASE_LABEL[phase] ?? null : null};
  } else {
    const cur = state.phase === 'action' && state.current ? state.players.find((p) => p.id === state.current) : undefined;
    turn = {who: cur ? {color: colorOf(cur.id), name: cur.name} : null, mine: !!cur && cur.id === me.id, phase: state.phase === 'action' ? null : PHASE_LABEL[state.phase] ?? null};
  }
  const entries = state.mode === 'full' ? away.entries(r.since) : companionEntries(state.id, ticks, r.since);
  return buildSummary(entries, {id: `${r.player}-${r.since}`, since: r.since, until: Date.now(), me: myColor, players,
    generationAtLeave: r.generation ?? undefined, turn});
}

function tellAway(ws: WebSocket, r: Return | null) {
  if (!r) return;
  try {
    const summary = awaySummary(r);
    if (summary) send(ws, {type: 'away', summary});
  } catch (e) { console.warn('away: summary failed:', (e as Error).message); }
}

// Mission control: lines about notable moments, for the TV only. Off without an LLM; NARRATOR_ENABLED=false removes it.
const narratorConfig = configFromEnv();
const narratorEnabled = process.env.NARRATOR_ENABLED !== 'false' && narratorAvailable(narratorConfig);
const narrator = narratorEnabled ? new Narrator({
  config: narratorConfig,
  mode: () => state.narrator ?? 'off',
  toTv: (line: NarrationLine) => { for (const ws of sockets) if (full.isTv(ws)) send(ws, {type: 'narration', line}); },
  players: () => state.players.map((p) => p.name),
  corporations: () => {
    const fromFull = full.lastSpectator?.players.flatMap((p) => p.tableau.map((c) => c.name).filter((n) => findCard(n)?.group === 'corporation')) ?? [];
    return [...state.players.map((p) => p.corporation).filter((x): x is string => !!x), ...fromFull];
  },
  dataDir: DATA_DIR,
  logPath: process.env.NARRATOR_LOG,
}) : null;
/** The turn clock: whose turn, since when, and which windows do not count. */
const clocks = new TurnClockDesk();
function pushClock() {
  const c = clocks.changed(state, ticks);
  if (c) broadcast({type: 'turnClock', clock: c.clock});
}
full.onShow = (show) => { clocks.productionShow(show.startAt, show.durationMs); pushClock(); away.journal([showEntry(show, Date.now())]); };

// Full games are recorded once, the first time the engine reports the end.
full.onObserve = (gameId, prev, next, history) => {
  clocks.observeFull(gameId, prev, next);
  pushClock();
  // "While you were away" keeps the facts of every engine update (who did what, when).
  if (prev && state.mode === 'full' && state.full?.gameId === gameId) away.journal(fullEntries(prev, next, Date.now()));
  narrator?.full(gameId, prev, next, history);
  if (next.game.phase === 'end' && state.mode === 'full' && state.full?.gameId === gameId && !profiles.isRecorded(gameId)) {
    try { publishRecording(recordFull(state, next, history), safeFacts(() => fullFacts(state, next, history))); } catch (e) { console.warn('profiles: recording the full game failed:', (e as Error).message); }
  }
};

// Phone-to-TV links: replays and map echoes for the TVs, and each hit's buzz timed to the TV's resolve.
const links = new TvLinkDesk();
const tvCount = () => [...sockets].filter((s) => full.isTv(s)).length;
function buzz(bs: Buzz[]) {
  for (const b of bs) {
    const hit = hapticFor(b);
    for (const ws of sockets) if (full.playerOf(ws) === b.seat) send(ws, {type: 'hapticHit', hit});
  }
}
setInterval(() => buzz(links.tick(Date.now())), 500).unref();

// Table sense: what happened to each seat (hits, cards in and out, gifts), told to that seat's phones only.
// A notice keeps the colour of whoever did it; the name it shows is the seat's current one (src/shared/names.ts).
const noticesMsg = (feed: NoticeFeed, fresh: string[]): ServerMsg => ({type: 'notices', feed: relabelFeed(feed, seatNames(state)), fresh});
const notices = new NoticeDesk(store.db, (playerId, feed, fresh) => {
  for (const ws of sockets) if (full.playerOf(ws) === playerId) send(ws, noticesMsg(feed, fresh));
  // a new hit buzzes its phones when the TV resolves it (or now, with no TV)
  const color = fresh.length && state.mode === 'full' ? state.full?.players[playerId]?.color : undefined;
  if (color) buzz(links.hits(playerId, color, feed.notices.filter((n) => fresh.includes(n.id)), Date.now(), tvCount()));
});
full.onSeatViews = (gameId, spectator, views) => {
  if (state.mode === 'full' && state.full?.gameId === gameId) notices.observe(gameId, spectator, views);
};

// An undo takes back what the undone move added to "while you were away" and to mission control's queue.
full.onRewind = (r) => {
  if (r.since !== null && state.mode === 'full' && state.full?.gameId === r.gameId) away.retract(r.since);
  narrator?.undo(r.gameId, r.actor);
  links.reset();
  // an undo through bot moves: the bots' latest plays are forgotten too
  for (const c of r.actors ?? []) if (c !== r.actor) narrator?.undo(r.gameId, c);
};

/** Companion mode: the story is rebuilt from the command log whenever it moves on. */
const companionStory = (): ServerMsg | null => (state.mode === 'full' || state.phase === 'lobby' ? null : {type: 'history', history: companionHistory(state, ticks)});
const STORY_EVENTS = new Set(['production', 'generation', 'ended', 'corp', 'started']);
let starting = false;

function resolveBoard(choice: BoardChoice | undefined): BoardName {
  if (choice === 'random') return BOARD_NAMES[Math.floor(Math.random() * BOARD_NAMES.length)];
  return choice ?? 'tharsis';
}

/** A full-mode start needs the engine game first; its ids go into the command so replay stays pure. */
async function startFull(command: Extract<Command, {t: 'start'}>): Promise<Command> {
  if (state.phase !== 'lobby') throw new Error('The game has already started');
  if (!state.players.length) throw new Error('Nobody has joined');
  if (starting) throw new Error('The game is already being set up');
  starting = true;
  try {
    const order = [...command.order.filter((id) => state.players.some((p) => p.id === id))];
    for (const p of state.players) if (!order.includes(p.id)) order.push(p.id);
    const seats = order.map((id) => state.players.find((p) => p.id === id)!).map((p) => ({id: p.id, name: p.name, color: p.color, beginner: !!p.beginner}));
    const link = await full.createGame(seats, command.draft ?? true, command.board ?? 'tharsis', !!state.prelude, !!state.fastMode);
    return {...command, order, link};
  } finally {
    starting = false;
  }
}

function commit(command: Command): Tick {
  const r = apply(state, command);
  const tick: Tick = {seq: r.state.seq, at: Date.now(), command, events: r.events};
  store.append(gameId, tick.seq, tick.at, command);
  state = r.state;
  ticks.push(tick);
  return tick;
}

/**
 * A profile was renamed on a phone. Its seat at the table takes the new name through a command (kept in the game's log,
 * so it survives a restart and replays), and every TV and phone hears it now.
 */
async function renameProfileSeats(profileId: string) {
  const p = profiles.get(profileId);
  if (!p) return;
  const seats = state.players.filter((x) => x.profileId === p.id && x.name !== p.name);
  for (const seat of seats) {
    try {
      const tick = commit({t: 'rename', playerId: seat.id, name: p.name, color: seat.color});
      broadcast({type: 'tick', tick, state});
    } catch (e) { console.warn(`names: ${seat.name} could not become ${p.name}: ${(e as Error).message}`); }
  }
  if (lastUnlocks) {
    const players = lastUnlocks.players.map((u) => ({...u, name: profiles.get(u.profileId)?.name ?? u.name}));
    if (players.some((u, i) => u.name !== lastUnlocks!.players[i].name)) { lastUnlocks = {...lastUnlocks, players}; broadcast({type: 'unlocks', unlocks: lastUnlocks}); }
  }
  if (seats.length) await namesChanged();
}

/**
 * A seat's name changed mid-game. Names are resolved from the seats wherever they are shown (src/shared/names.ts), so the
 * stored story and notices need no rewriting: every device just gets them again, with the views, the story and the
 * last production show, without a reload.
 */
async function namesChanged() {
  if (state.mode === 'full' && state.full) {
    const link = state.full;
    for (const ws of sockets) {
      const seat = full.playerOf(ws);
      if (seat && link.players[seat]) send(ws, noticesMsg(notices.feed(link.gameId, seat), []));
    }
    await full.renamed();
  } else {
    const m = companionStory();
    if (m) broadcast(m);
  }
}

function undo(playerId: string): string | null {
  const last = ticks[ticks.length - 1];
  if (!last) return 'Nothing to undo';
  if ('playerId' in last.command && last.command.playerId !== playerId) return 'Only the last move can be undone, by the player who made it';
  // a name change (a profile edit on a phone) is not a move: undo never takes it back instead of the player's last move
  if (last.command.t === 'start' || last.command.t === 'join' || last.command.t === 'rename') return 'That cannot be undone';
  store.removeLast(gameId, last.seq);
  ({state, ticks} = store.replay(gameId));
  if (state.mode !== 'full' && profiles.isRecorded(state.id)) {
    // An undone end forgets the recording; an undone board-point correction re-records the scores.
    if (state.phase === 'ended') publishRecording(recordCompanion(state, ticks), safeFacts(() => companionFacts(state, companionHistory(state, ticks))));
    else { profiles.unrecord(state.id); lastUnlocks = null; broadcastProfiles(); broadcastFame(); }
  }
  return null;
}

/** Per-sender nudge cooldown, in memory: a restart forgiving a nudge is harmless. */
const lastNudge = new Map<string, number>();
/** Reactions: per-player rate limit and the quiet start of shows (in memory, like the nudge cooldown). */
const reactions = new ReactionDesk();
/** The TV radio: remote presses from phones, what the TV is playing (in memory). */
const radio = new RadioDesk();
const fly = new FlyRelay();
/** TVs' 3D board quality levels (logged, and the latest per TV in /api/health). */
const tv3d = new Tv3dDesk();
/** Companion mode: when production last paid out (the TV plays its production moment then). */
let companionProductionAt: number | null = null;

const app = Fastify({logger: {level: 'warn'}, bodyLimit: 8 * 1024 * 1024});
await app.register(websocket);

app.get('/ws', {websocket: true}, (ws) => {
  sockets.add(ws);
  send(ws, snapshot());
  send(ws, {type: 'turnClock', clock: clocks.current(state, ticks)});
  if (radio.now) send(ws, {type: 'radioNow', now: radio.now});
  ws.on('close', () => {
    sockets.delete(ws);
    // the pilot's phone (or the last TV) went away: the TVs stop its flight and every phone hears who flies now
    const pilot = fly.pilot ? state.players.find((p) => p.id === fly.pilot) : undefined;
    if (fly.forget(ws)) {
      if (pilot && !fly.pilot) for (const s of sockets) if (full.isTv(s)) send(s, {type: 'fly', op: 'stop', from: {id: pilot.id, name: pilot.name, color: pilot.color}});
      broadcast({type: 'flyStatus', status: fly.status()});
    }
    full.forget(ws); away.remove(ws, Date.now(), generationNow()); broadcastPhones();
    if (radio.gone(ws)) broadcast({type: 'radioNow', now: null});
  });
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    away.heard(ws, Date.now());
    if (msg.type === 'cmd') {
      const id = msg.id;
      const run = async () => {
        let command = msg.command;
        // The map is fixed before anything else: 'random' is rolled here so the log replays to the same board.
        if (command.t === 'start' && !command.board) command = {...command, board: resolveBoard(state.boardChoice)};
        if (command.t === 'start' && command.mode === 'full' && !command.link) command = await startFull(command);
        if (command.t === 'start' && !command.title) {
          command = {...command, title: command.link?.name ?? `Game ${store.startedGames() + 1}`};
        }
        // A profile must exist; the canonical id is stored (a merged profile resolves to the one it became).
        if ((command.t === 'join' && command.profileId) || (command.t === 'claimProfile' && command.profileId)) {
          const p = profiles.get(command.profileId!);
          if (!p) throw new Error('That profile no longer exists');
          command = {...command, profileId: p.id};
        }
        const before = state;
        const tick = commit(command);
        if ((command.t === 'join' || command.t === 'claimProfile') && command.profileId) profiles.claimDevice(command.playerId, command.profileId);
        // Companion games are recorded when they end and again whenever final board points change.
        if (state.mode !== 'full' && state.phase === 'ended' && (command.t === 'endGame' || command.t === 'boardVP')) {
          try { publishRecording(recordCompanion(state, ticks), safeFacts(() => companionFacts(state, companionHistory(state, ticks)))); } catch (e) { console.warn('profiles: recording failed:', (e as Error).message); }
        }
        if (tick.events.some((e) => e.kind === 'production')) companionProductionAt = Date.now();
        // Turning the one-off illustration on after the game ended paints it now.
        if (command.t === 'posterArt' && command.unique) posters.setUnique(currentGameId(), true);
        if (narrator) {
          if (command.t === 'narrator') narrator.modeChanged(command.mode);
          else if (state.mode !== 'full') narrator.companion(before, tick, state, ticks);
        }
        send(ws, {type: 'ack', id});
        broadcast({type: 'tick', tick, state});
        pushClock();
        if (command.t === 'rename' && before.players.find((p) => p.id === command.playerId)?.name !== state.players.find((p) => p.id === command.playerId)?.name) await namesChanged();
        else if (state.mode === 'full') await full.pushAll();
        else if (tick.events.some((e) => STORY_EVENTS.has(e.kind))) { const m = companionStory(); if (m) broadcast(m); }
      };
      run().catch((e) => {
        const error = e instanceof NeedsInput ? `Missing answer: ${e.prompt.title}` : (e as Error).message;
        send(ws, {type: 'nack', id, error});
      });
    } else if (msg.type === 'hello') {
      full.hello(ws, {role: msg.role, playerId: msg.playerId});
      send(ws, {type: 'flyStatus', status: fly.status()});
      // this seat's notices so far (a reload or another phone sees the same hits until they are cleared)
      const seat = full.playerOf(ws);
      if (seat && state.mode === 'full' && state.full?.players[seat]) send(ws, noticesMsg(notices.feed(state.full.gameId, seat), []));
      // A phone coming back (visible) to a seat that was away long enough hears what it missed.
      tellAway(ws, away.update(ws, msg.role === 'phone' ? msg.playerId : null, msg.visible !== false, Date.now(), generationNow()));
      broadcastPhones();
      sendProfiles(ws);
      send(ws, prefsMsg());
      send(ws, {type: 'fame', fame: fame()});
      const poster = state.phase === 'lobby' ? null : posters.status(currentGameId());
      if (poster) send(ws, {type: 'poster', poster});
      const currentGame = state.mode === 'full' ? state.full?.gameId : state.id;
      if (lastUnlocks && lastUnlocks.gameId === currentGame) send(ws, {type: 'unlocks', unlocks: lastUnlocks});
      const story = companionStory();
      if (story) send(ws, story);
    } else if (msg.type === 'noticeClear' || msg.type === 'noticeSeen') {
      // a phone speaks only for its own seat
      const link = state.mode === 'full' ? state.full : null;
      if (!link || full.playerOf(ws) !== msg.playerId) return;
      if (msg.type === 'noticeClear') notices.clear(link.gameId, msg.playerId, Array.isArray(msg.ids) ? msg.ids.map(String) : undefined);
      else if (Number.isFinite(msg.upTo)) notices.seen(link.gameId, msg.playerId, msg.upTo);
    } else if (msg.type === 'presence') {
      tellAway(ws, away.update(ws, away.playerOf(ws), !!msg.visible, Date.now(), generationNow()));
    } else if (msg.type === 'seatPref') {
      // A personal setting, not a move: stored beside the game, never in its command log.
      const flag = (v: unknown) => v === undefined || typeof v === 'boolean';
      if (!state.players.some((p) => p.id === msg.playerId) || !flag(msg.hints) || !flag(msg.showVp) || !flag(msg.confirmBuy)) {
        send(ws, {type: 'nack', id: msg.id, error: 'That seat is not at the table'});
        return;
      }
      if (msg.hints !== undefined) store.setSeatHints(gameId, msg.playerId, msg.hints);
      store.setSeatFlags(gameId, msg.playerId, {showVp: msg.showVp, confirmBuy: msg.confirmBuy});
      send(ws, {type: 'ack', id: msg.id});
      broadcast(prefsMsg());
    } else if (msg.type === 'input') {
      const id = msg.id;
      full.input(msg.playerId, msg.response, false, msg.seen ?? null)
        .then(() => send(ws, {type: 'ack', id}))
        .catch((e) => {
          // An answer made against an older game is refused with the reason, and this phone gets the new situation
          if (e instanceof InputRefused) {
            send(ws, {type: 'nack', id, error: e.message, code: e.code});
            void full.pushTo(ws).catch(() => {});
          } else send(ws, {type: 'nack', id, error: (e as Error).message});
        });
    } else if (msg.type === 'rewind') {
      const id = msg.id;
      // a phone speaks only for its own seat
      if (full.playerOf(ws) !== msg.playerId) { send(ws, {type: 'nack', id, error: 'You can only take back your own move'}); return; }
      full.rewind(msg.playerId, msg.what === 'back' ? 'back' : 'undo', msg.seen ?? null)
        .then(() => send(ws, {type: 'ack', id}))
        .catch((e) => {
          if (e instanceof InputRefused) {
            send(ws, {type: 'nack', id, error: e.message, code: e.code});
            void full.pushTo(ws).catch(() => {});
          } else send(ws, {type: 'nack', id, error: (e as Error).message});
        });
    } else if (msg.type === 'hover') {
      full.relayHover(msg.hover);
    } else if (msg.type === 'flick') {
      // A card leaving a phone for the TV. Only a seated player can flick, and only as themselves.
      const p = state.players.find((x) => x.id === msg.flick.playerId);
      if (!p || state.phase === 'lobby' || typeof msg.flick.card !== 'string') return;
      const flick: Flick = {id: String(msg.flick.id).slice(0, 40), playerId: p.id, color: p.color, name: p.name, card: msg.flick.card.slice(0, 80), at: Date.now()};
      broadcast({type: 'flick', flick});
    } else if (msg.type === 'flickCancel') {
      if (state.players.some((x) => x.id === msg.playerId)) broadcast({type: 'flickCancel', id: String(msg.id).slice(0, 40)});
    } else if (msg.type === 'nudge') {
      const from = state.players.find((x) => x.id === msg.from);
      const to = state.players.find((x) => x.id === msg.to);
      if (!from || !to || from.id === to.id || to.bot || state.phase === 'lobby' || state.phase === 'ended') return;
      const last = lastNudge.get(from.id) ?? 0;
      if (Date.now() - last < NUDGE_COOLDOWN_MS) return;
      lastNudge.set(from.id, Date.now());
      broadcast({type: 'nudge', nudge: {id: `${from.id}-${Date.now().toString(36)}`, from: from.id, fromName: from.name, fromColor: from.color,
        to: to.id, toName: to.name, toColor: to.color, at: Date.now()}});
    } else if (msg.type === 'react') {
      const verdict = reactions.judge(state, full.isTv(ws) ? 'tv' : full.playerOf(ws), msg, Date.now(), [full.showStartAt, companionProductionAt]);
      if (!verdict.ok) { send(ws, {type: 'nack', id: msg.id, error: verdict.error}); return; }
      send(ws, {type: 'ack', id: msg.id});
      if (verdict.reaction) for (const s of sockets) if (full.isTv(s)) send(s, {type: 'reaction', reaction: verdict.reaction});
    } else if (msg.type === 'replay' || msg.type === 'echo') {
      // phone-to-TV links: only the asker's own phone, a seat in a running full game, a TV to show it on; rate-limited
      const speaker = full.isTv(ws) ? null : full.playerOf(ws);
      const now = Date.now();
      const tvs = tvCount();
      const v = msg.type === 'replay' ? links.replay(state, speaker, msg, now, tvs) : links.echo(state, speaker, msg, now, tvs);
      if (!v.ok) { send(ws, {type: 'nack', id: msg.id, error: v.error}); return; }
      send(ws, {type: 'ack', id: msg.id});
      const out: ServerMsg = msg.type === 'replay' ? {type: 'replay', replay: v.out as never} : {type: 'echo', echo: v.out as never};
      for (const s of sockets) if (full.isTv(s)) send(s, out);
    } else if (msg.type === 'replayDone') {
      if (full.isTv(ws)) links.replayDone(msg.replayId, Date.now());
    } else if (msg.type === 'radio') {
      const tvs = [...sockets].filter((s) => full.isTv(s)).length;
      const verdict = radio.judge(state, full.isTv(ws) ? 'tv' : full.playerOf(ws), msg, Date.now(), tvs);
      if (!verdict.ok) { send(ws, {type: 'nack', id: msg.id, error: verdict.error}); return; }
      send(ws, {type: 'ack', id: msg.id});
      for (const s of sockets) if (full.isTv(s)) send(s, {type: 'radio', action: verdict.action, from: verdict.from});
    } else if (msg.type === 'fly') {
      // Fly over Mars: only the pilot's sticks reach the TVs; starts and stops are heard by every phone
      const r = fly.phone(ws, state, full.isTv(ws) ? null : full.playerOf(ws), msg, Date.now());
      if (r.relay) for (const s of sockets) if (full.isTv(s)) send(s, {type: 'fly', ...r.relay});
      if (r.changed) broadcast({type: 'flyStatus', status: fly.status()});
      else if (r.error && msg.op === 'start') send(ws, {type: 'flyStatus', status: fly.status()});
    } else if (msg.type === 'flyTv') {
      if (full.isTv(ws) && fly.tvReport(ws, msg.state, msg.pilot ?? null)) broadcast({type: 'flyStatus', status: fly.status()});
    } else if (msg.type === 'radioNow') {
      if (full.isTv(ws) && radio.report(msg.now, ws)) broadcast({type: 'radioNow', now: radio.now});
    } else if (msg.type === 'tvMoment') {
      // Phase 4 of a move on a TV: only the first-connected TV's count
      const m = full.isTv(ws) && primaryTv(sockets, (s) => full.isTv(s)) === ws ? readTvMoment(msg) : null;
      if (m) { handleTvMoment(m); buzz(links.moment(m, Date.now())); }
    } else if (msg.type === 'narrationSeen') {
      if (full.isTv(ws)) narrator?.tvReport(msg.report);
    } else if (msg.type === 'tv3d') {
      const line = full.isTv(ws) ? tv3d.report(msg.report, Date.now()) : null;
      if (line) console.log(line);
    } else if (msg.type === 'radioLog') {
      const line = full.isTv(ws) ? radio.logLine(msg.text, Date.now()) : null;
      if (line) console.log(line);
    } else if (msg.type === 'profile') {
      try {
        if (msg.op === 'create') {
          const p = profiles.create(msg.profile);
          profiles.claimDevice(msg.device, p.id);
        } else if (msg.op === 'update') profiles.update(msg.profileId, msg.patch);
        else if (msg.op === 'merge') profiles.merge(msg.from, msg.into);
        send(ws, {type: 'ack', id: msg.id});
        broadcastProfiles();
        broadcastFame();
        if (msg.op === 'update') void renameProfileSeats(msg.profileId).catch((e) => console.warn('names: renaming the seat failed:', (e as Error).message));
      } catch (e) {
        send(ws, {type: 'nack', id: msg.id, error: e instanceof ProfileError ? e.message : 'The profile could not be saved'});
        if (!(e instanceof ProfileError)) console.warn('profiles:', (e as Error).message);
      }
    } else if (msg.type === 'profileDetail') {
      const detail = profiles.detail(msg.profileId);
      if (!detail) { send(ws, {type: 'nack', id: msg.id, error: 'That profile does not exist'}); return; }
      send(ws, {type: 'profileDetail', detail});
      send(ws, {type: 'ack', id: msg.id});
    } else if (msg.type === 'undo') {
      const err = undo(msg.playerId);
      if (err) send(ws, {type: 'nack', id: msg.id, error: err});
      else { send(ws, {type: 'ack', id: msg.id}); broadcast({type: 'undone', state, recent: ticks.slice(-RECENT)}); pushClock(); }
    } else if (msg.type === 'newGame') {
      const fullOver = state.phase === 'full' && full.lastSpectator?.game.phase === 'end';
      if (state.phase !== 'ended' && state.phase !== 'lobby' && !fullOver && !msg.force) {
        send(ws, {type: 'nack', id: msg.id, error: 'End the current game first'});
        return;
      }
      const carried = state.narrator;
      const carriedPoster = !!state.posterUnique;
      const carriedPrelude = !!state.prelude;
      const carriedClock = state.turnClock;
      const carriedFast = !!state.fastMode;
      const carriedBotSpeed = state.botSpeed;
      const carriedBots = state.players.filter((p) => p.bot);
      lastUnlocks = null;
      gameId = store.createGame();
      away.newGame();
      notices.newGame();
      links.reset();
      ({state, ticks} = store.replay(gameId));
      // The table's mission control setting carries into the next game.
      if (carried && carried !== 'off') commit({t: 'narrator', playerId: 'table', mode: carried});
      if (carriedPoster) commit({t: 'posterArt', playerId: 'table', unique: true});
      // So does Prelude: a table that plays with it usually keeps playing with it.
      if (carriedPrelude) commit({t: 'setPrelude', playerId: 'table', on: true});
      // The pace a table chose carries over too: the turn clock and fast mode.
      if (carriedClock && carriedClock !== 'off') commit({t: 'setTurnClock', playerId: 'table', clock: carriedClock});
      if (carriedFast) commit({t: 'setFastMode', playerId: 'table', on: true});
      if (carriedBotSpeed && carriedBotSpeed !== 'table') commit({t: 'setBotSpeed', playerId: 'table', speed: carriedBotSpeed});
      // The table's bots stay seated for the next game (the lobby can remove them).
      for (const b of carriedBots) {
        try { commit({t: 'addBot', playerId: 'table', botId: b.id, name: b.name, color: b.color, level: b.bot!}); } catch (e) { console.warn('bots: could not reseat', b.name, (e as Error).message); }
      }
      clocks.reset(null);
      broadcast(prefsMsg());
      send(ws, {type: 'ack', id: msg.id});
      broadcast(snapshot());
      pushClock();
    } else if (msg.type === 'ping') send(ws, {type: 'pong'});
    // A screen behind its heartbeat's version, or a page that came back, asks for a fresh view (rate-limited)
    else if (msg.type === 'resync') full.resync(ws);
  });
});

// Health: the app, and whether the engine answers (cached 10 s). Companion-only setups report the engine as off.
const engineConfigured = process.env.FULL_GAME !== 'false' && !!process.env.ENGINE_URL;
// Mission control's health rides along as `narrator` (LLM and paid voices reachable, credits, last line, last error, what the TVs saw),
// and each TV's latest 3D board quality level as `tv3d`.
registerHealth(app, new HealthCheck({probe: engineConfigured ? (ms) => full.engine.ping(ms) : null, build: () => serverBuild() ?? process.env.BUILD_SHA ?? null,
  extra: async () => ({...(narrator ? {narrator: await narrator.health()} : {}), tv3d: tv3d.health()})}));

app.get('/api/config', async (req) => ({
  vision: visionEnabled(),
  // Full-game mode needs the engine service; FULL_GAME=false hides the choice in the lobby.
  fullGame: process.env.FULL_GAME !== 'false',
  // Mission control: needs an LLM (NARRATOR_LLM_URL or LOCAL_VLM_URL, and a model); NARRATOR_ENABLED=false hides it.
  narrator: narratorEnabled,
  // "Text + voice" needs a speech provider (HUME_API_KEY or NARRATOR_TTS_URL).
  narratorVoice: narratorEnabled && voiceAvailable(narratorConfig),
  // The one-off poster illustration needs an image server (POSTER_FORGE_URL); without one the switch is hidden.
  posterUnique: posters.uniqueAvailable,
  // The "Hard (Jev)" bot level needs the server's TypeSafe key; without it the lobby does not offer it.
  jevBots: !!process.env.TYPESAFE_API_KEY,
  joinUrl: process.env.PUBLIC_URL ?? `${req.protocol}://${req.headers.host}`,
  // The TV radio plays this YouTube playlist (RADIO_PLAYLIST); without it there is no radio.
  radioPlaylist: playlistId(process.env.RADIO_PLAYLIST),
  // The "Source code" link on the phones and the TV lobby (SOURCE_URL).
  sourceUrl: sourceUrl(process.env.SOURCE_URL),
}));

app.get('/api/qr.svg', async (req, reply) => {
  const url = (req.query as {url?: string}).url ?? process.env.PUBLIC_URL ?? `${req.protocol}://${req.headers.host}`;
  const svg = await QRCode.toString(url, {type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: {dark: '#24130F', light: '#EAF2F4'}});
  reply.type('image/svg+xml').send(svg);
});

app.post('/api/recognize', async (req, reply) => {
  if (!visionEnabled()) return reply.code(404).send({error: 'Card scanning is turned off'});
  const {image, group} = req.body as {image: string; group?: 'project' | 'corporation' | 'prelude'};
  if (!image?.startsWith('data:image/')) return reply.code(400).send({error: 'Send the photo as a data URL'});
  try {
    return await recognize(image, state.modules, group ?? 'any');
  } catch (e) {
    return reply.code(502).send({error: (e as Error).message});
  }
});

app.get('/api/history', async () => ({gameId, ticks}));

// End-of-game posters: /api/poster/<gameId>.png?variant=library|unique&orientation=landscape|portrait[&size=thumb][&download=1]
app.get('/api/poster/:file', async (req, reply) => {
  const m = /^([A-Za-z0-9_-]{1,64})\.png$/.exec((req.params as {file: string}).file);
  const q = req.query as {variant?: string; orientation?: string; size?: string; download?: string};
  const variant = (POSTER_VARIANTS as readonly string[]).includes(q.variant ?? 'library') ? (q.variant ?? 'library') as PosterVariant : null;
  const orientation = (POSTER_ORIENTATIONS as readonly string[]).includes(q.orientation ?? 'landscape') ? (q.orientation ?? 'landscape') as PosterOrientation : null;
  if (!m || !variant || !orientation) return reply.code(400).send({error: 'Unknown poster'});
  const file = posters.file(m[1], variant, orientation, q.size === 'thumb');
  if (!file) return reply.code(404).send({error: 'The poster is not ready'});
  if (q.download) reply.header('Content-Disposition', `attachment; filename="mars-ledger-${m[1]}-${orientation}.png"`);
  // Files change when final scores are corrected; the phones and TV add the version to the URL.
  return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(fs.createReadStream(file));
});

app.get('/api/narration/:file', async (req, reply) => {
  const file = narrator?.audioPath((req.params as {file: string}).file);
  if (!file) return reply.code(404).send({error: 'Not found'});
  return reply.type(file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg').header('Cache-Control', 'public, max-age=3600').send(fs.createReadStream(file));
});

// Performance recordings and screen recordings from phones, for the /perf diagnostics pages.
await registerPerf(app, {db: store.db, dataDir: DATA_DIR});

const dist = path.resolve(process.env.CLIENT_DIST ?? 'dist');
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, {root: dist, wildcard: false, maxAge: '1h'});
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.code(404).send({error: 'Not found'});
    return reply.type('text/html').header('Cache-Control', 'no-cache').send(fs.readFileSync(path.join(dist, 'index.html')));
  });
}

await app.listen({port: PORT, host: '0.0.0.0'});
console.log(`Mars Ledger on :${PORT} (game ${gameId}, ${ticks.length} moves, vision ${visionEnabled() ? 'on' : 'off'}, engine ${process.env.ENGINE_URL ?? 'http://localhost:8791'})`);

export type {GameState};
