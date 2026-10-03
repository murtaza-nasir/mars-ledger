import type {Command, GameState, Tick} from './game';
import type {PosterStatus} from './poster';
import type {Color, FullView, Hover, InputResponse, ProductionShow} from './full';
import type {GameHistory} from './history';
import type {Flick, Nudge} from './social';
import type {TurnClock} from './clock';
import type {NarrationLine, NarrationReport} from './narrator';
import type {Reaction} from './reactions';
import type {GameUnlocks, HallOfFame, ProfileDetail, ProfileSummary} from './profiles';
import type {AwaySummary} from './away';
import type {DeadEnd} from './deadend';
import type {RadioAction, RadioNow} from './radio';
import type {Seen, UndoNotice, ViewVersion} from './sync';
import type {NoticeFeed} from './notices';
import type {FlyStatus, FlyTvState} from './fly';
import type {Echo, EchoTarget, HapticHit, Replay, ReplayMove} from './tvlinks';

export type ClientMsg =
  // a seat's own setting (smart hints) when the seat has no profile; not a move, never in the game log
  | {type: 'seatPref'; id: string; playerId: string; hints: boolean}
  | {type: 'cmd'; id: string; command: Command}
  | {type: 'undo'; id: string; playerId: string}
  | {type: 'newGame'; id: string; force?: boolean}
  | {type: 'ping'}
  // full mode: send me a fresh view (the screen is behind what the server says it sent, or the page came back); rate-limited
  | {type: 'resync'; have: ViewVersion | null}
  // full mode
  // `visible`: whether the page is showing (a phone reconnecting in the background says false)
  | {type: 'hello'; role: 'phone' | 'tv'; playerId: string | null; visible?: boolean}
  // a phone's page became visible or hidden (for "while you were away")
  | {type: 'presence'; visible: boolean}
  // `seen`: the view the answer was made against; the server refuses an answer to a question that is gone
  | {type: 'input'; id: string; playerId: string; response: InputResponse; seen?: Seen}
  // take a move back: 'back' leaves your own move during its follow-up questions; 'undo' takes back your last move and
  // the bot moves after it. Refused (nack with code) when it no longer applies.
  | {type: 'rewind'; id: string; playerId: string; what: 'back' | 'undo'; seen?: Seen}
  | {type: 'hover'; hover: Hover}
  // table gestures (both modes): a card flicked toward the TV, a cancelled flick, a nudge
  | {type: 'flick'; flick: {id: string; playerId: string; card: string}}
  | {type: 'flickCancel'; id: string; playerId: string}
  | {type: 'nudge'; from: string; to: string}
  // a sticker from a phone for the TV (acked, or refused with the wait when rate-limited)
  | {type: 'react'; id: string; playerId: string; sticker: string}
  // phone-to-TV links (src/shared/tvlinks.ts): show a move again on the TV (acked, or refused with the wait), point at
  // what a move changed (map echo), and a TV saying it finished (or dropped) a replay
  | {type: 'replay'; id: string; playerId: string; move: ReplayMove}
  | {type: 'echo'; id: string; playerId: string; targets: EchoTarget[]}
  | {type: 'replayDone'; replayId: string}
  // profiles: create (the phone picks the id; `device` is the phone's id so it remembers the profile), edit, merge a duplicate
  | {type: 'profile'; id: string; op: 'create'; device: string; profile: {id: string; name: string; color: string; avatar: string | null}}
  | {type: 'profile'; id: string; op: 'update'; profileId: string; patch: {name?: string; color?: string; avatar?: string | null; hints?: boolean}}
  | {type: 'profile'; id: string; op: 'merge'; from: string; into: string}
  // ask for one profile's stats, achievements and recent games (answered with 'profileDetail', then acked)
  | {type: 'profileDetail'; id: string; profileId: string}
  // the TV radio: a phone's remote press (acked, or refused when rate-limited or the radio is off)
  | {type: 'radio'; id: string; playerId: string; action: RadioAction}
  // the TV radio: what the TV is playing (null: radio off or gone), and an unplayable track it skipped, for the log
  | {type: 'radioNow'; now: RadioNow | null}
  | {type: 'radioLog'; text: string}
  // mission control: what became of a line on this TV (shown, spoken, or why not), for the server log and /api/health
  | {type: 'narrationSeen'; report: NarrationReport}
  // table-sense notices (full mode): clear hits (all of this seat's when `ids` is missing), or mark the feed read up to `upTo`
  | {type: 'noticeClear'; playerId: string; ids?: string[]}
  | {type: 'noticeSeen'; playerId: string; upTo: number}
  // Fly over Mars (experimental): a phone flying the TV camera (`i`: packFly, with op 'input'), and a TV saying what
  // it can do
  | {type: 'fly'; playerId: string; op: 'start' | 'input' | 'stop'; i?: number[]}
  | {type: 'flyTv'; state: FlyTvState; pilot: string | null}
  // A TV's move presentation reached Phase 4 (effects resolving) for one moment: `gameAge` of the update the move came
  // in, who moved (`attacker`), the players it hit (`targets`, [] for a move that hurt no one), `at` the TV's Date.now().
  // Sent by every TV; the server keeps only the first-connected TV's (phone haptics are timed to it).
  | TvMomentMsg;

/** A TV reached the resolution phase of a moment (see ClientMsg). */
export type TvMomentMsg = {type: 'tvMoment'; phase: 'resolve'; gameAge: number; attacker: Color; targets: Color[]; at: number};

export type ServerMsg =
  // seats' own settings for the current game (see the seatPref message), keyed by player id
  | {type: 'prefs'; prefs: Record<string, {hints: boolean}>}
  /** phones connected per player id (any id a phone speaks for, seated or not) */
  | {type: 'phones'; phones: Record<string, number>; tvs?: number}
  | {type: 'state'; state: GameState; recent: Tick[]}
  | {type: 'tick'; tick: Tick; state: GameState}
  | {type: 'undone'; state: GameState; recent: Tick[]}
  | {type: 'ack'; id: string}
  // `code` (full-mode answers): 'stale' when the answer's view is out of date, 'undoWindow' when an undo comes too late
  | {type: 'nack'; id: string; error: string; code?: 'stale' | 'undoWindow'}
  | {type: 'pong'}
  // full mode: each socket gets its own view (a player's hand is private; the TV gets the spectator view)
  | {type: 'full'; view: FullView; v?: ViewVersion}
  // full mode: a player undid their last move (sent to every device with the views after it; re-sent on hello for a few seconds)
  | {type: 'fullUndo'; notice: UndoNotice}
  // every few seconds, and in answer to a resync it will not serve yet: the version last sent to this socket (null: none)
  | {type: 'version'; v: ViewVersion | null; serverNow: number; build?: string | null}
  // the build the server serves (sent on hello; the heartbeat repeats it): a screen on another build reloads when quiet
  | {type: 'build'; build: string | null}
  | {type: 'hover'; hover: Hover}
  // full mode: production pays out; sent before the post-production views so numerals can hold
  | {type: 'production'; show: ProductionShow}
  // the game's story so far (per-generation stats, tile order, TR race); sent on hello and when it grows
  | {type: 'history'; history: GameHistory}
  | {type: 'flick'; flick: Flick}
  | {type: 'flickCancel'; id: string}
  | {type: 'nudge'; nudge: Nudge}
  // the turn clock (null: off or nobody's turn); sent on connect and whenever it changes
  | {type: 'turnClock'; clock: TurnClock | null}
  // mission control: a line for the TV (sent to TV sockets only)
  | {type: 'narration'; line: NarrationLine}
  // a player's sticker, for TV sockets only; never stored
  | {type: 'reaction'; reaction: Reaction}
  // phone-to-TV links: a replay and a map echo for TV sockets only; a hit seat's phones buzz (timed to the TV's resolve)
  | {type: 'replay'; replay: Replay}
  | {type: 'echo'; echo: Echo}
  | {type: 'hapticHit'; hit: HapticHit}
  // profiles for the join screen and lobby; `mine` is the profile this device last used
  | {type: 'profiles'; profiles: ProfileSummary[]; mine: string | null}
  | {type: 'profileDetail'; detail: ProfileDetail}
  // leaderboard, recent games and latest achievements (the TV lobby, and the phones' profile screens)
  | {type: 'fame'; fame: HallOfFame}
  /** end-of-game poster: status of the current (or a recent) game's poster */
  | {type: 'poster'; poster: PosterStatus}
  // what a finished game unlocked, per seated profile (phones reveal their own; the TV rolls them up)
  | {type: 'unlocks'; unlocks: GameUnlocks}
  // what changed for this player while their phone was hidden or offline (sent to that phone only)
  | {type: 'away'; summary: AwaySummary}
  // full mode: a question no answer can satisfy (the engine ran out of project cards); the game cannot go on
  | {type: 'deadEnd'; deadEnd: DeadEnd | null}
  // the TV radio: a remote press for TV sockets, and what is playing for everyone (null: off)
  | {type: 'radio'; action: RadioAction; from: string}
  | {type: 'radioNow'; now: RadioNow | null}
  // full mode: this seat's notices (hits, cards in and out, gifts), newest first; `fresh` are ids new in this send
  | {type: 'notices'; feed: NoticeFeed; fresh: string[]}
  // Fly over Mars: the pilot's controls, to TV sockets only; and who flies, to everyone
  | {type: 'fly'; op: 'start' | 'input' | 'stop'; from: {id: string; name: string; color: string}; i?: number[]}
  | {type: 'flyStatus'; status: FlyStatus};
