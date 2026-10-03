// Live connection to the table. One socket per device; state arrives whole on every move.
import {create} from 'zustand';
import type {Command, GameEvent, GameState, Tick} from '../shared/game';
import type {DeadEnd} from '../shared/deadend';
import type {ClientMsg, ServerMsg, TvMomentMsg} from '../shared/protocol';
import type {PosterStatus} from '../shared/poster';
import type {FullView, Hover, InputResponse, ProductionShow} from '../shared/full';
import {isOlderView} from '../shared/full';
import type {GameHistory} from '../shared/history';
import type {Flick, Nudge} from '../shared/social';
import type {TurnClock} from '../shared/clock';
import type {NarrationLine, NarrationReport} from '../shared/narrator';
import type {Reaction, StickerId} from '../shared/reactions';
import type {GameUnlocks, HallOfFame, ProfileDetail, ProfileSummary} from '../shared/profiles';
import type {AwaySummary} from '../shared/away';
import {HEARTBEAT_MS} from '../shared/away';
import type {RadioAction, RadioNow} from '../shared/radio';
import {PROBE_MS, ResyncPlanner, showLocalStart, STALE_AFTER_MS} from '../shared/sync';
import type {Seen, UndoNotice, ViewVersion} from '../shared/sync';
import type {NoticeFeed} from '../shared/notices';
import type {FlyStatus, FlyTvState} from '../shared/fly';
import type {Echo, EchoTarget, Replay, ReplayMove} from '../shared/tvlinks';

type Pending = {resolve: () => void; reject: (e: Error) => void};
/** A refusal from the server; `code` says why ('stale' answer, 'undoWindow' for an undo that came too late). */
export type NetError = Error & {code?: string};

type Net = {
  connected: boolean;
  state: GameState | null;
  recent: Tick[];
  /** events from the newest move, for animations */
  lastEvents: GameEvent[];
  lastTick: Tick | null;
  config: {vision: boolean; joinUrl: string; fullGame?: boolean; narrator?: boolean; narratorVoice?: boolean; posterUnique?: boolean; jevBots?: boolean;
    /** the TV radio's YouTube playlist (RADIO_PLAYLIST); null or absent: no radio */
    radioPlaylist?: string | null;
    /** the "Source code" link (SOURCE_URL) */
    sourceUrl?: string} | null;
  send: (command: Command) => Promise<void>;
  undo: (playerId: string) => Promise<void>;
  newGame: (force?: boolean) => Promise<void>;
  /** full mode: this device's view (a player's own model, or the spectator model on the TV) */
  fullView: FullView | null;
  /** full mode: the version of the view on screen, and the version the server last said it sent here */
  fullVersion: ViewVersion | null;
  heardVersion: ViewVersion | null;
  /** full mode: other players' fingers hovering spaces, keyed by player id */
  hovers: Record<string, Hover>;
  /** Answer the engine. `seen`: the view the answer was made against; a refusal rejects with an Error whose `code` is 'stale' or 'undoWindow'. */
  input: (playerId: string, response: InputResponse, seen?: Seen) => Promise<void>;
  /** Take a move back: 'back' out of your own move's follow-up questions, or 'undo' your last move with the bot moves after it. */
  rewind: (playerId: string, what: 'back' | 'undo', seen?: Seen) => Promise<void>;
  /** full mode: the latest undo at the table, with this device's receive time; screens show it for a few seconds */
  undoNotice: (UndoNotice & {receivedAt: number}) | null;
  hover: (h: Hover) => void;
  /** Fly over Mars (experimental): what the TVs can do and whose phone flies; a phone's flight controls (sent as they
   *  are, no answer awaited); and a TV's report of what it can do */
  flyStatus: FlyStatus | null;
  fly: (playerId: string, op: 'start' | 'input' | 'stop', i?: number[]) => void;
  flyTv: (state: FlyTvState, pilot: string | null) => void;
  /** full mode: the production show to play, with startAt already moved onto this device's clock */
  production: (ProductionShow & {localStart: number}) | null;
  /** the game's story so far (TV recaps and the end-of-game story) */
  history: GameHistory | null;
  /** cards flicked from phones toward the TV (newest last) and the ids of flicks the rules refused */
  flicks: Flick[];
  cancelledFlicks: string[];
  /** the newest nudge anywhere at the table (phones show it when it is for them; the TV always) */
  nudge: Nudge | null;
  /** the turn clock and this device's offset to server time (serverNow - Date.now() when it arrived) */
  turnClock: {clock: TurnClock; offset: number} | null;
  /** the build the server serves (null: unknown); src/client/update.ts reloads a screen on another build */
  serverBuild: string | null;
  /** Launch a card toward the TV; returns the flick id so a refused play can call it back. */
  flick: (playerId: string, card: string) => string;
  cancelFlick: (id: string, playerId: string) => void;
  sendNudge: (from: string, to: string) => void;
  /** mission control lines for the TV (newest last); `at` is this device's receive time */
  narrations: NarrationLine[];
  /** stickers from phones (TV only; newest last); `at` is this device's receive time */
  reactions: Reaction[];
  /** Send a sticker to the TV. Rejects with the server's reason when rate-limited. */
  react: (playerId: string, sticker: StickerId) => Promise<void>;
  /** Phone-to-TV links (src/shared/tvlinks.ts): show a move again on the TV, or point at what it changed. Reject with
   *  the server's reason (a replay already on its way, the cooldown, no TV). */
  askReplay: (playerId: string, move: ReplayMove) => Promise<void>;
  askEcho: (playerId: string, targets: EchoTarget[]) => Promise<void>;
  /** TV: replays and echoes asked for by phones (newest last); `at` is this device's receive time */
  replays: Replay[];
  echoes: Echo[];
  /** TV: a replay finished or was dropped here (the asker's phone may ask again after the cooldown) */
  replayDone: (replayId: string) => void;
  /** TVs connected to the table (phones show TV links only when there is one) */
  tvs: number;
  /** people across game nights; `mine` is the profile the server remembers for this device */
  profiles: ProfileSummary[];
  /** seats' own settings (smart hints) for seats without a profile, keyed by player id */
  seatPrefs: Record<string, {hints: boolean}>;
  /** phones connected per player id */
  phones: Record<string, number>;
  setSeatHints: (playerId: string, hints: boolean) => Promise<void>;
  /** the profile list has arrived at least once (the join screen waits for it) */
  profilesKnown: boolean;
  mine: string | null;
  fame: HallOfFame | null;
  /** what the latest finished game unlocked */
  unlocks: GameUnlocks | null;
  /** end-of-game posters by game id (the current game's, as the server reports progress) */
  posters: Record<string, PosterStatus>;
  /** profile screens loaded on this device, by profile id */
  details: Record<string, ProfileDetail>;
  createProfile: (profile: {id: string; name: string; color: string; avatar: string | null}) => Promise<void>;
  updateProfile: (profileId: string, patch: {name?: string; color?: string; avatar?: string | null; hints?: boolean}) => Promise<void>;
  mergeProfiles: (from: string, into: string) => Promise<void>;
  /** Fetch a profile's stats, achievements and recent games into `details`. */
  loadProfile: (profileId: string) => Promise<void>;
  /** what changed while this phone was hidden or offline (shown once, then cleared) */
  away: AwaySummary | null;
  dismissAway: () => void;
  /** the TV radio: what the TV is playing (null: off or no TV), and the newest remote press (TV only) */
  radioNow: RadioNow | null;
  radioCommand: {seq: number; action: RadioAction; from: string} | null;
  /** Press the radio remote. Rejects with the server's reason (rate limit, radio off). */
  radioRemote: (playerId: string, action: RadioAction) => Promise<void>;
  /** TV: report what is playing; and note a skipped track in the server log. */
  reportRadio: (now: RadioNow | null) => void;
  radioLog: (text: string) => void;
  /** TV: what became of a mission control line here (shown, spoken, or why not) */
  narrationSeen: (report: NarrationReport) => void;
  /** TV: a moment's Phase 4 (resolution) began (phone haptics are timed to it) */
  tvMoment: (m: Omit<TvMomentMsg, 'type' | 'phase'>) => void;
  /** full mode: a question no answer can satisfy; the game cannot go on (shown on phones and the TV) */
  deadEnd: DeadEnd | null;
  /** full mode: this seat's notices (table sense), and the ids that arrived new with the latest send (`seq` counts sends) */
  notices: NoticeFeed | null;
  noticeFresh: {seq: number; ids: string[]};
  /** Clear hits (all of this seat's when `ids` is missing); mark the feed read up to a time. */
  clearNotices: (playerId: string, ids?: string[]) => void;
  seenNotices: (playerId: string, upTo: number) => void;
};

let ws: WebSocket | null = null;
const seenShows = new Set<string>();
// ---- Staying in sync -----------------------------------------------------------------------------------
/** When this device last heard anything from the server (a heartbeat comes every few seconds). */
let lastHeard = 0;
/** A resync sent to check a socket that may be dead: no answer by then, and the socket is replaced. */
let probeDeadline = 0;
const planner = new ResyncPlanner();
/** Server clock minus this device's clock, from recent heartbeats (the largest sample: a late one only reads low). */
const offsets: number[] = [];
const serverOffset = () => (offsets.length ? Math.max(...offsets) : null);

/** Ask for a fresh view (rate-limited). `probe`: also treat the socket as dead if nothing comes back soon. */
function resync(probe = false) {
  if (!ws || ws.readyState !== 1) return;
  const now = Date.now();
  if (!planner.mayAsk(now)) return;
  ws.send(JSON.stringify({type: 'resync', have: useNet.getState().fullVersion} satisfies ClientMsg));
  if (probe) probeDeadline = now + PROBE_MS;
}

/** Drop a socket that looks open but carries nothing (iOS leaves these after the phone sleeps) and connect afresh. */
function replaceSocket(why: string) {
  console.info(`net: reconnecting (${why})`);
  useNet.setState({connected: false});
  probeDeadline = 0;
  connect();
}

function watchdog() {
  if (!pageVisible() || !ws || ws.readyState !== 1) return;
  const now = Date.now();
  if (now - lastHeard > STALE_AFTER_MS) return replaceSocket('no heartbeat');
  if (probeDeadline && now > probeDeadline) {
    if (lastHeard < probeDeadline - PROBE_MS) return replaceSocket('no answer to a resync');
    probeDeadline = 0;
  }
  // the server says it sent a newer view than the one on screen: ask for it again
  if (planner.behind(useNet.getState().fullVersion, now)) resync();
}
const pending = new Map<string, Pending>();
let seq = 0;

function rpc(msg: ClientMsg & {id: string}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('Not connected to the table'));
    pending.set(msg.id, {resolve, reject});
    ws.send(JSON.stringify(msg));
    setTimeout(() => { if (pending.delete(msg.id)) reject(new Error('The table did not answer')); }, 8000);
  });
}
const id = () => `${Date.now().toString(36)}-${++seq}`;

export const useNet = create<Net>(() => ({
  connected: false, state: null, recent: [], lastEvents: [], lastTick: null, config: null,
  send: (command) => rpc({type: 'cmd', id: id(), command}),
  undo: (playerId) => rpc({type: 'undo', id: id(), playerId}),
  newGame: (force) => rpc({type: 'newGame', id: id(), force}),
  fullView: null,
  fullVersion: null,
  heardVersion: null,
  serverBuild: null,
  hovers: {},
  production: null,
  history: null,
  input: (playerId, response, seen) => rpc({type: 'input', id: id(), playerId, response, ...(seen ? {seen} : {})}),
  rewind: (playerId, what, seen) => rpc({type: 'rewind', id: id(), playerId, what, ...(seen ? {seen} : {})}),
  undoNotice: null,
  hover: (h) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'hover', hover: h} satisfies ClientMsg)); },
  flyStatus: null,
  fly: (playerId, op, i) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'fly', playerId, op, ...(i ? {i} : {})} satisfies ClientMsg)); },
  flyTv: (state, pilot) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'flyTv', state, pilot} satisfies ClientMsg)); },
  flicks: [],
  cancelledFlicks: [],
  nudge: null,
  turnClock: null,
  narrations: [],
  reactions: [],
  react: (playerId, sticker) => rpc({type: 'react', id: id(), playerId, sticker}),
  askReplay: (playerId, move) => rpc({type: 'replay', id: id(), playerId, move}),
  askEcho: (playerId, targets) => rpc({type: 'echo', id: id(), playerId, targets}),
  replays: [],
  echoes: [],
  replayDone: (replayId) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'replayDone', replayId} satisfies ClientMsg)); },
  tvs: 0,
  profiles: [],
  seatPrefs: {},
  phones: {},
  setSeatHints: (playerId, hints) => rpc({type: 'seatPref', id: id(), playerId, hints}),
  profilesKnown: false,
  mine: null,
  fame: null,
  unlocks: null,
  posters: {},
  details: {},
  createProfile: (profile) => rpc({type: 'profile', id: id(), op: 'create', device: myId(), profile}),
  updateProfile: (profileId, patch) => rpc({type: 'profile', id: id(), op: 'update', profileId, patch}),
  mergeProfiles: (from, into) => rpc({type: 'profile', id: id(), op: 'merge', from, into}),
  loadProfile: (profileId) => rpc({type: 'profileDetail', id: id(), profileId}),
  away: null,
  dismissAway: () => useNet.setState({away: null}),
  radioNow: null,
  deadEnd: null,
  radioCommand: null,
  radioRemote: (playerId, action) => rpc({type: 'radio', id: id(), playerId, action}),
  reportRadio: (now) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'radioNow', now} satisfies ClientMsg)); },
  radioLog: (text) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'radioLog', text} satisfies ClientMsg)); },
  narrationSeen: (report) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'narrationSeen', report} satisfies ClientMsg)); },
  tvMoment: (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'tvMoment', phase: 'resolve', ...m} satisfies ClientMsg)); },
  flick: (playerId, card) => {
    const fid = `f-${id()}`;
    if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'flick', flick: {id: fid, playerId, card}} satisfies ClientMsg));
    return fid;
  },
  cancelFlick: (fid, playerId) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'flickCancel', id: fid, playerId} satisfies ClientMsg)); },
  notices: null,
  noticeFresh: {seq: 0, ids: []},
  clearNotices: (playerId, ids) => {
    // shown cleared at once; the server's feed follows
    useNet.setState((s) => (s.notices ? {notices: {...s.notices, notices: s.notices.notices.map((n) => (!ids || ids.includes(n.id) ? {...n, cleared: true} : n))}} : {}));
    if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'noticeClear', playerId, ...(ids ? {ids} : {})} satisfies ClientMsg));
  },
  seenNotices: (playerId, upTo) => {
    useNet.setState((s) => (s.notices ? {notices: {...s.notices, seenAt: Math.max(s.notices.seenAt, upTo)}} : {}));
    if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'noticeSeen', playerId, upTo} satisfies ClientMsg));
  },
  sendNudge: (from, to) => { if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'nudge', from, to} satisfies ClientMsg)); },
}));

type FlyMsg = Extract<ServerMsg, {type: 'fly'}>;
let flyHandler: ((m: FlyMsg) => void) | null = null;
/** The TV's flight listens for the pilot's messages here (null to stop). */
export function onFlyMessage(h: ((m: FlyMsg) => void) | null) { flyHandler = h; }

/** Who this device is, sent on every (re)connect so the server can route private views. */
let identity: {role: 'phone' | 'tv'; playerId: string | null} = {role: 'phone', playerId: null};
export function identify(role: 'phone' | 'tv', playerId: string | null) {
  identity = {role, playerId};
  if (ws?.readyState === 1) ws.send(JSON.stringify(hello()));
}

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
/** Hello says whether the page is showing: a phone reconnecting in the background is not back yet. */
const hello = (): ClientMsg => ({type: 'hello', ...identity, visible: pageVisible()});

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // One socket at a time: a close timer and a page coming back could both reconnect, and the socket left behind kept
  // its handlers (two sockets feeding one store, each reconnecting when it closed).
  const old = ws;
  if (old && old.readyState <= 1) { old.onopen = null; old.onclose = null; old.onmessage = null; try { old.close(); } catch { /* gone */ } }
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  lastHeard = Date.now();
  sock.onopen = () => { lastHeard = Date.now(); useNet.setState({connected: true}); sock.send(JSON.stringify(hello())); };
  sock.onclose = () => { if (ws !== sock) return; useNet.setState({connected: false}); setTimeout(() => { if (ws === sock) connect(); }, 1200); };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    const msg = JSON.parse(e.data) as ServerMsg;
    lastHeard = Date.now();
    switch (msg.type) {
    case 'state':
    case 'undone':
      useNet.setState({state: msg.state, recent: msg.recent, lastEvents: [], lastTick: null});
      break;
    case 'tick':
      useNet.setState((s) => ({state: msg.state, recent: [...s.recent.slice(-39), msg.tick], lastEvents: msg.tick.events, lastTick: msg.tick}));
      break;
    case 'ack': pending.get(msg.id)?.resolve(); pending.delete(msg.id); break;
    case 'nack': {
      const err: NetError = new Error(msg.error);
      if (msg.code) err.code = msg.code;
      pending.get(msg.id)?.reject(err); pending.delete(msg.id); break;
    }
    // the view keeps the version it came with, so an answer can name exactly the view it was made against
    case 'full': useNet.setState((s) => (isOlderView(msg.view, s.fullView, msg.v, s.fullVersion) ? {} : {fullView: msg.v ? {...msg.view, v: msg.v} : msg.view, fullVersion: msg.v ?? null})); break;
    case 'fullUndo': useNet.setState((s) => (s.undoNotice?.id === msg.notice.id ? {} : {undoNotice: {...msg.notice, receivedAt: Date.now()}})); break;
    case 'version': {
      offsets.push(msg.serverNow - Date.now());
      if (offsets.length > 8) offsets.shift();
      planner.hear(msg.v, Date.now());
      useNet.setState(msg.build !== undefined ? {heardVersion: msg.v, serverBuild: msg.build} : {heardVersion: msg.v});
      break;
    }
    case 'hover': useNet.setState((s) => ({hovers: {...s.hovers, [msg.hover.playerId]: msg.hover}})); break;
    case 'reaction': useNet.setState((s) => ({reactions: [...s.reactions.slice(-23), {...msg.reaction, at: Date.now()}]})); break;
    case 'replay': useNet.setState((s) => ({replays: [...s.replays.slice(-7), {...msg.replay, at: Date.now()}]})); break;
    case 'echo': useNet.setState((s) => ({echoes: [...s.echoes.slice(-7), {...msg.echo, at: Date.now()}]})); break;
    // a hit lands on the TV now: buzz (phones that cannot vibrate from a web page, like iPhones, do nothing)
    case 'hapticHit': buzz(msg.hit.pattern); break;
    case 'history': useNet.setState({history: msg.history}); break;
    case 'profiles': useNet.setState({profiles: msg.profiles, mine: msg.mine, profilesKnown: true}); break;
    case 'prefs': useNet.setState({seatPrefs: msg.prefs}); break;
    case 'phones': useNet.setState({phones: msg.phones, ...(msg.tvs !== undefined ? {tvs: msg.tvs} : {})}); break;
    case 'fame': useNet.setState({fame: msg.fame}); break;
    case 'unlocks': useNet.setState({unlocks: msg.unlocks}); break;
    case 'away': useNet.setState({away: msg.summary}); break;
    case 'deadEnd': useNet.setState({deadEnd: msg.deadEnd}); break;
    case 'notices': useNet.setState((s) => ({notices: msg.feed, ...(msg.fresh.length ? {noticeFresh: {seq: s.noticeFresh.seq + 1, ids: msg.fresh}} : {})})); break;
    case 'radioNow': useNet.setState({radioNow: msg.now}); break;
    case 'flyStatus': useNet.setState({flyStatus: msg.status}); break;
    // the pilot's controls arrive many times a second: handed straight to the TV's flight, never through the store
    case 'fly': flyHandler?.(msg); break;
    case 'build': useNet.setState({serverBuild: msg.build}); break;
    case 'radio': useNet.setState((s) => ({radioCommand: {seq: (s.radioCommand?.seq ?? 0) + 1, action: msg.action, from: msg.from}})); break;
    case 'poster': useNet.setState((s) => ({posters: {...s.posters, [msg.poster.gameId]: msg.poster}})); break;
    case 'profileDetail': useNet.setState((s) => ({details: {...s.details, [msg.detail.profile.id]: msg.detail}})); break;
    // `at` becomes this device's receive time, so timing never depends on clocks agreeing
    case 'flick': useNet.setState((s) => ({flicks: [...s.flicks.slice(-11), {...msg.flick, at: Date.now()}]})); break;
    case 'flickCancel': useNet.setState((s) => ({cancelledFlicks: [...s.cancelledFlicks.slice(-23), msg.id]})); break;
    case 'nudge': useNet.setState({nudge: {...msg.nudge, at: Date.now()}}); break;
    case 'turnClock': useNet.setState({turnClock: msg.clock ? {clock: msg.clock, offset: msg.clock.serverNow - Date.now()} : null}); break;
    case 'narration': useNet.setState((s) => ({narrations: [...s.narrations.slice(-9), {...msg.line, at: Date.now()}]})); break;
    case 'production': {
      // Each show plays once per device, even if a reconnect delivers it again.
      if (seenShows.has(msg.show.id)) break;
      seenShows.add(msg.show.id);
      // timed from the server clock when the message is late (a phone that slept gets it on waking), else from arrival
      const localStart = showLocalStart(msg.show, Date.now(), serverOffset());
      if (localStart + msg.show.durationMs < Date.now()) break;
      useNet.setState({production: {...msg.show, localStart}});
      break;
    }
    }
  };
}

/** Vibrate when the browser can (feature-detected: iPhones have no navigator.vibrate). */
function buzz(pattern: number[]) {
  try { if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern); } catch { /* not allowed */ }
}

export function startNet() {
  connect();
  fetch('/api/config').then((r) => r.json()).then((config) => useNet.setState({config})).catch(() => {});
  // A visible phone says it is still at the table now and then: a connection that drops silently is
  // then dated from shortly after the last heartbeat, not from whenever the server notices.
  setInterval(() => { if (pageVisible() && ws?.readyState === 1) ws.send(JSON.stringify({type: 'ping'} satisfies ClientMsg)); }, HEARTBEAT_MS);
  // Phones sleep; a visible page should always have a live socket.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ws && ws.readyState > 1) connect();
    // The table keeps track of who is looking, for "while you were away".
    else if (ws?.readyState === 1) ws.send(JSON.stringify({type: 'presence', visible: pageVisible()} satisfies ClientMsg));
    // Back on screen: ask for the current view at once, and find out whether the socket survived the sleep.
    if (document.visibilityState === 'visible') resync(true);
  });
  // Back on the network: a socket that died meanwhile is replaced; a live one is asked for the current view.
  window.addEventListener('online', () => {
    if (ws && ws.readyState > 1) connect();
    else resync(true);
  });
  // A socket can look open and carry nothing: the heartbeat (every 2 s) proves it alive, and also says which view
  // the server sent last, so a screen that missed one asks again.
  setInterval(watchdog, 500);
}

// ---- identity: a device remembers which player it is ----------------------------------------
const KEY = 'mars-ledger-player';
let memoryId: string | null = null;
export function myId(): string {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) { v = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2); localStorage.setItem(KEY, v); }
    return v;
  } catch {
    memoryId ??= Math.random().toString(36).slice(2);
    return memoryId;
  }
}

/** This device now plays as another seat (the game menu's "Switch player"); the page reloads into that seat. */
export function switchTo(playerId: string) {
  try { localStorage.setItem(KEY, playerId); } catch { memoryId = playerId; }
  location.reload();
}

// ---- the profile this device plays as (the server remembers it too, per device) ----------------
const PROFILE_KEY = 'mars-ledger-profile';
export function rememberedProfile(): string | null {
  try { return localStorage.getItem(PROFILE_KEY); } catch { return null; }
}
export function rememberProfile(profileId: string | null) {
  try { if (profileId) localStorage.setItem(PROFILE_KEY, profileId); else localStorage.removeItem(PROFILE_KEY); } catch { /* private mode */ }
}
export function newProfileId(): string {
  const r = crypto.randomUUID?.().replace(/-/g, '') ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `p-${r.slice(0, 20)}`;
}

// Debug handle: lets tests and the console inject fixture views (window.__net.setState({...})).
(window as unknown as {__net: typeof useNet}).__net = useNet;

