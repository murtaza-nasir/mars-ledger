import type {Resource, Tag, TileKind, Units} from './types';
import type {FullLink} from './full';
import type {NarratorMode} from './narrator';
import type {TurnClockSetting} from './clock';
import type {BoardChoice, BoardName} from './board';
import type {BotLevel, BotSpeed} from './bots';

export const PLAYER_COLORS = ['red', 'green', 'blue', 'yellow', 'black'] as const;
export type PlayerColor = typeof PLAYER_COLORS[number];
/** Player colours as drawn everywhere (phones, TV, the poster). */
export const PLAYER_HEX: Record<string, string> = {red: '#E0493A', green: '#4FB35E', blue: '#3E8FE0', yellow: '#F2C230', black: '#8A8F9C'};

export type PlayedCard = {
  name: string;
  /** resources sitting on the card (animals, microbes, science...) */
  resources: number;
  /** generation the card was played in */
  generation: number;
};

export type PlayerState = {
  id: string;
  name: string;
  color: PlayerColor;
  corporation: string | null;
  tr: number;
  stock: Units;
  production: Units;
  steelValue: number;
  titaniumValue: number;
  greeneryCost: number;
  played: PlayedCard[];
  /** blue-card actions used this generation (card names; standard actions use 'std:' prefix) */
  usedActions: string[];
  tiles: {cityOnMars: number; cityOffMars: number; greenery: number; special: number; oceans: number};
  milestones: string[];
  handSize: number;
  /** research / setup phase: has this player finished? */
  ready: boolean;
  passed: boolean;
  /** Actions taken in the current turn (0..2). */
  turnActions: number;
  /** one-shot modifiers such as Special Design (+2 global req tolerance for the next card) */
  nextCardRequirementBonus: number;
  nextCardDiscount: number;
  /** generation in which this player's TR last went up (United Nations Mars Initiative) */
  trRaisedGeneration?: number;
  /** full game: play the Beginner Corporation (no corporation choice, the 10 starting cards are free) */
  beginner?: boolean;
  /** the person across game nights (src/shared/profiles.ts); absent for a player without a profile */
  profileId?: string;
  /** full games: a bot seat played by the server at this level (src/shared/bots.ts); absent for people */
  bot?: BotLevel;
  /** Prelude: the two preludes this player kept at setup, and those already played */
  preludes?: string[];
  preludesPlayed?: string[];
  /** Prelude: a card from hand may be played now as part of a prelude (Eccentric Sponsor, Ecology Experts);
   *  holds the instruction shown to the player until the card is played or skipped */
  preludeCardPlay?: string | null;
  /** final scoring numbers entered by hand from the board */
  boardVP?: {cityAdjacency: number; other: number};
  /** counts for milestones/awards that depend on tile positions, entered from the physical board (by standing name) */
  manualScores?: Record<string, number>;
};

export type Phase = 'lobby' | 'setup' | 'preludes' | 'research' | 'action' | 'production' | 'finalGreenery' | 'ended' | 'full';
export type GameMode = 'companion' | 'full';

export type GameState = {
  /** the game's name (game chip), set at start */
  title?: string;
  /** full games: drafting was on (recorded at start for the game chip) */
  draft?: boolean;
  id: string;
  phase: Phase;
  modules: string[];
  players: PlayerState[];
  /** turn order; index 0 is the first player this generation */
  order: string[];
  current: string | null;
  generation: number;
  global: {temperature: number; oxygen: number; oceans: number; venus: number};
  awards: Array<{name: string; fundedBy: string}>;
  milestones: Array<{name: string; claimedBy: string}>;
  /** increases every command; clients use it to detect gaps */
  seq: number;
  /** companion: the physical board is the game. full: the engine service runs the whole game. */
  mode?: GameMode;
  full?: FullLink;
  /** mission control on the TV: off (default), captions, or captions with voice */
  narrator?: NarratorMode;
  /** end-of-game poster: also paint a one-off illustration on the shared image server (off by default) */
  posterUnique?: boolean;
  /** the turn clock: off (default), relaxed (3 min) or brisk (90 s) per turn; a nudge, never a penalty */
  turnClock?: TurnClockSetting;
  /** how long bots take over their moves (absent: table pace) */
  botSpeed?: BotSpeed;
  /** lobby, full games: the engine's fast mode (two actions every turn; no ending a turn after one) */
  fastMode?: boolean;
  /** lobby: play with the Prelude expansion (table-wide, both modes); the module joins `modules` at start */
  prelude?: boolean;
  /** lobby: the table's map choice; 'random' is resolved by the server when the game starts */
  boardChoice?: BoardChoice;
  /** the map this game is played on (absent in games from before boards existed: Tharsis) */
  board?: BoardName;
  startedAt: number | null;
  endedAt: number | null;
};

// ---------------------------------------------------------------------------------------------
// Answers to prompts, collected on the phone and replayed on the server.
export type Answer =
  | {kind: 'or'; index: number}
  | {kind: 'player'; playerId: string | null}
  | {kind: 'card'; owner: string; card: string | null}
  | {kind: 'tile'; bonus: Partial<Units> & {cards?: number}; onMars?: boolean}
  | {kind: 'yesno'; yes: boolean}
  | {kind: 'resource'; resource: Resource}
  | {kind: 'amount'; value: number}
  /** a card picked from a deck the app does not track (Valley Trust's prelude draw) */
  | {kind: 'pickCard'; card: string}
  | {kind: 'ack'};

export type Payment = Partial<Pick<Units, 'megacredits' | 'steel' | 'titanium' | 'heat'>> & {resourcesHere?: number;
  /** resources from a card that pays for certain tags (Psychrophiles' microbes for plant cards) */
  cardResources?: number};

export type Command =
  | {t: 'join'; playerId: string; name: string; color: PlayerColor; profileId?: string}
  /** link a seat to a profile (or unlink with null); one profile per table */
  | {t: 'claimProfile'; playerId: string; profileId: string | null}
  /** remove a seat from the lobby (a phone leaving, or a bot seat being removed) */
  | {t: 'leave'; playerId: string}
  /** lobby, full games: add a bot seat (`botId` is its new player id; `playerId` is the phone that added it) */
  | {t: 'addBot'; playerId: string; botId: string; name: string; color: PlayerColor; level: BotLevel}
  | {t: 'rename'; playerId: string; name: string; color: PlayerColor; beginner?: boolean}
  | {t: 'start'; playerId: string; modules: string[]; order: string[]; mode?: GameMode; draft?: boolean; link?: FullLink; board?: BoardName;
      /** the game's name for the game chip, fixed by the server at start (engine name, or "Game N") */
      title?: string}
  | {t: 'chooseCorp'; playerId: string; corporation: string; cardsKept: number; answers: Answer[]; preludes?: string[]}
  /** Prelude phase: play one of your kept preludes (in turn order, before the first generation's actions) */
  | {t: 'playPrelude'; playerId: string; card: string; answers: Answer[]}
  /** decline the card a prelude lets you play from hand */
  | {t: 'skipPreludeCard'; playerId: string}
  | {t: 'research'; playerId: string; cardsBought: number}
  | {t: 'playCard'; playerId: string; card: string; payment: Payment; answers: Answer[]}
  | {t: 'action'; playerId: string; card: string; payment: Payment; answers: Answer[]}
  | {t: 'standardProject'; playerId: string; project: string; payment: Payment; answers: Answer[]}
  | {t: 'convertPlants'; playerId: string; answers: Answer[]}
  | {t: 'convertHeat'; playerId: string; answers: Answer[]}
  | {t: 'claimMilestone'; playerId: string; milestone: string}
  | {t: 'fundAward'; playerId: string; award: string}
  | {t: 'endTurn'; playerId: string}
  | {t: 'pass'; playerId: string}
  | {t: 'adjust'; playerId: string; target: string; stock?: Partial<Units>; production?: Partial<Units>; tr?: number;
      handSize?: number; cardResources?: {card: string; delta: number}; note?: string}
  | {t: 'setGlobal'; playerId: string; param: 'temperature' | 'oxygen' | 'oceans'; value: number}
  | {t: 'boardVP'; playerId: string; cityAdjacency: number; other: number; manual?: Record<string, number>}
  | {t: 'setBoard'; playerId: string; board: BoardChoice}
  /** table-wide lobby setting */
  | {t: 'setPrelude'; playerId: string; on: boolean}
  | {t: 'setTurnClock'; playerId: string; clock: TurnClockSetting}
  /** table-wide, any time; playerId 'table' when the server carries the setting into a new game */
  | {t: 'setBotSpeed'; playerId: string; speed: BotSpeed}
  | {t: 'setFastMode'; playerId: string; on: boolean}
  | {t: 'endGame'; playerId: string}
  /** table-wide; playerId 'table' when the server carries the setting into a new game */
  | {t: 'narrator'; playerId: string; mode: NarratorMode}
  /** table-wide; playerId 'table' when the server carries the setting into a new game */
  | {t: 'posterArt'; playerId: string; unique: boolean};

/** Something that happened, for the TV and the phones' feeds. Derived, never stored. */
export type GameEvent =
  | {kind: 'joined'; player: string}
  | {kind: 'started'}
  | {kind: 'corp'; player: string; corporation: string}
  | {kind: 'cardPlayed'; player: string; card: string; tags: Tag[]; cardType: string; cost: number}
  | {kind: 'action'; player: string; card: string}
  | {kind: 'standardProject'; player: string; project: string}
  | {kind: 'global'; player: string | null; param: 'temperature' | 'oxygen' | 'oceans' | 'venus'; from: number; to: number}
  | {kind: 'tr'; player: string; delta: number}
  | {kind: 'tile'; player: string; tile: TileKind}
  | {kind: 'attack'; player: string; target: string; what: string}
  | {kind: 'milestone'; player: string; name: string}
  | {kind: 'award'; player: string; name: string}
  | {kind: 'pass'; player: string}
  | {kind: 'turn'; player: string}
  | {kind: 'production'; generation: number}
  | {kind: 'generation'; generation: number}
  | {kind: 'ended'}
  | {kind: 'note'; player: string; text: string}
  | {kind: 'narrator'; player: string | null; mode: NarratorMode}
  | {kind: 'board'; board: BoardName; random: boolean};

export type Tick = {seq: number; at: number; command: Command; events: GameEvent[]};
