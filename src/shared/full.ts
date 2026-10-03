// Full-game mode: the open-source engine (terraforming-mars/terraforming-mars, GPL-3.0) runs as an
// internal service and enforces every rule. These are lean hand-written types for the parts of its
// JSON API we use; field names match the engine exactly. Extend (don't rename) as more is needed.
import {isOlderVersion} from './sync';
import type {ViewVersion} from './sync';

// ---- engine enums, as numbers on the wire ----------------------------------------------------
export const TILE = {
  GREENERY: 0, OCEAN: 1, CITY: 2, CAPITAL: 3, COMMERCIAL_DISTRICT: 4, ECOLOGICAL_ZONE: 5, INDUSTRIAL_CENTER: 6,
  LAVA_FLOWS: 7, MINING_AREA: 8, MINING_RIGHTS: 9, MOHOLE_AREA: 10, NATURAL_PRESERVE: 11, NUCLEAR_ZONE: 12,
  RESTRICTED_AREA: 13, MINING_STEEL_BONUS: 27, MINING_TITANIUM_BONUS: 28,
} as const;
/** What a tile looks like on our board. Special tiles (cards) render as 'special' with their card name. */
export function tileKind(t: number | undefined): 'greenery' | 'ocean' | 'city' | 'special' | null {
  if (t === undefined) return null;
  if (t === TILE.GREENERY) return 'greenery';
  if (t === TILE.OCEAN) return 'ocean';
  if (t === TILE.CITY || t === TILE.CAPITAL) return 'city';
  return 'special';
}
export const TILE_NAME: Record<number, string> = {
  0: 'Greenery', 1: 'Ocean', 2: 'City', 3: 'Capital', 4: 'Commercial District', 5: 'Ecological Zone', 6: 'Industrial Center',
  7: 'Lava Flows', 8: 'Mining Area', 9: 'Mining Rights', 10: 'Mohole Area', 11: 'Natural Preserve', 12: 'Nuclear Zone',
  13: 'Restricted Area', 27: 'Mine (steel)', 28: 'Mine (titanium)',
};
export const BONUS = {TITANIUM: 0, STEEL: 1, PLANT: 2, DRAW_CARD: 3, HEAT: 4, OCEAN: 5, MEGACREDITS: 6} as const;
export const BONUS_NAME: Record<number, 'titanium' | 'steel' | 'plants' | 'card' | 'heat' | 'ocean' | 'megacredits'> = {
  0: 'titanium', 1: 'steel', 2: 'plants', 3: 'card', 4: 'heat', 5: 'ocean', 6: 'megacredits',
};

export type Color = 'red' | 'green' | 'blue' | 'yellow' | 'black' | 'purple' | 'orange' | 'pink' | 'neutral' | 'bronze';

// ---- messages: titles are strings or templates like "Fund an award (${0} M€)" ---------------
export type Message = string | {message: string; data: Array<{type: number; value: string}>};
export function messageText(m: Message | undefined): string {
  if (m === undefined) return '';
  if (typeof m === 'string') return m;
  return m.message.replace(/\$\{(\d+)\}/g, (_, i) => m.data[Number(i)]?.value ?? '');
}

// ---- models ----------------------------------------------------------------------------------
export type SpaceModel = {
  id: string; x: number; y: number;
  spaceType: 'land' | 'ocean' | 'colony' | 'cove' | 'restricted' | string;
  bonus: number[];
  color?: Color;
  tileType?: number;
  highlight?: 'noctis' | 'volcanic';
};

export type CardModel = {
  name: string;
  resources?: number;
  calculatedCost?: number;
  isDisabled?: boolean;
  warnings?: unknown[];
  bonusResource?: string[];
};

export type TagCount = {tag: string; count: number};

export type PublicPlayerModel = {
  color: Color; name: string; isActive: boolean;
  terraformRating: number;
  megacredits: number; megacreditProduction: number;
  steel: number; steelProduction: number; steelValue: number;
  titanium: number; titaniumProduction: number; titaniumValue: number;
  plants: number; plantProduction: number;
  energy: number; energyProduction: number;
  heat: number; heatProduction: number;
  cardsInHandNbr: number;
  citiesCount: number;
  tableau: CardModel[];
  tags: TagCount[] | Record<string, number>;
  actionsThisGeneration: string[];
  actionsTakenThisRound: number;
  availableBlueCardActionCount: number;
  needsToResearch?: boolean;
  victoryPointsBreakdown?: {total: number; terraformRating: number; milestones: number; awards: number; greenery: number; city: number; victoryPoints: number};
  cardCost?: number;
};

export type GameModel = {
  gameAge: number; undoCount: number;
  /** the options the game was created with (expansions decide e.g. whether preludes are revealed with corporations) */
  gameOptions?: {expansions?: Partial<Record<string, boolean>>; boardName?: string};
  generation: number;
  phase: 'research' | 'drafting' | 'action' | 'production' | 'solar' | 'intergeneration' | 'end' | string;
  temperature: number; oxygenLevel: number; oceans: number; venusScaleLevel: number;
  isTerraformed: boolean;
  spaces: SpaceModel[];
  passedPlayers: Color[];
  milestones: Array<{name: string; color?: Color; playerName?: string; scores: Array<{color: Color; score: number}>}>;
  awards: Array<{name: string; color?: Color; playerName?: string; scores: Array<{color: Color; score: number}>}>;
  deckSize: number;
  spectatorId?: string;
  /** solo games (one player against the neutral player): the generation the game ends after (14, or 12 with Prelude) */
  lastSoloGeneration?: number;
  /** solo games: Mars is terraformed and the generation limit not passed (the engine's own verdict) */
  isSoloModeWin?: boolean;
};

export type PlayerViewModel = {
  id: string; color: Color;
  game: GameModel;
  thisPlayer: PublicPlayerModel;
  players: PublicPlayerModel[];
  cardsInHand: CardModel[];
  draftedCards: CardModel[];
  dealtProjectCards: CardModel[];
  dealtCorporationCards: CardModel[];
  pickedCorporationCard: CardModel[];
  waitingFor?: PlayerInputModel;
};

export type SpectatorModel = {id: string; color: 'neutral'; game: GameModel; players: PublicPlayerModel[]};

// ---- inputs: what the engine is asking a player ----------------------------------------------
type BaseInput = {title: Message; buttonLabel: string; warning?: Message; optional?: boolean};
export type PaymentOptions = Partial<Record<'heat' | 'plants' | 'steel' | 'titanium' | 'microbes' | 'floaters', boolean>>;
export type PlayerInputModel =
  | BaseInput & {type: 'and'; options: PlayerInputModel[]}
  | BaseInput & {type: 'or'; options: PlayerInputModel[]; initialIdx?: number}
  | BaseInput & {type: 'initialCards'; options: PlayerInputModel[]}
  | BaseInput & {type: 'option'}
  | BaseInput & {type: 'card'; cards: CardModel[]; max: number; min: number; selectBlueCardAction: boolean; showOwner: boolean}
  | BaseInput & {type: 'projectCard'; cards: CardModel[]; paymentOptions: PaymentOptions; microbes: number; floaters: number}
  | BaseInput & {type: 'payment'; amount: number; paymentOptions: PaymentOptions}
  | BaseInput & {type: 'amount'; min: number; max: number; maxByDefault?: boolean}
  | BaseInput & {type: 'player'; players: Color[]}
  | BaseInput & {type: 'space'; spaces: string[]}
  | BaseInput & {type: 'productionToLose'; payProduction: {cost: number; units: Record<string, number>}}
  | BaseInput & {type: 'resource'; include: string[]}
  | BaseInput & {type: 'resources'; count: number}
  | BaseInput & {type: string; [k: string]: unknown};

export const PAYMENT_KEYS = ['megacredits', 'steel', 'titanium', 'heat', 'plants', 'microbes', 'floaters', 'lunaArchivesScience',
  'spireScience', 'seeds', 'auroraiData', 'graphene', 'kuiperAsteroids'] as const;
export type EnginePayment = Record<typeof PAYMENT_KEYS[number], number>;
export function payment(p: Partial<EnginePayment>): EnginePayment {
  return Object.fromEntries(PAYMENT_KEYS.map((k) => [k, p[k] ?? 0])) as EnginePayment;
}

export type InputResponse =
  | {type: 'option'}
  | {type: 'or'; index: number; response: InputResponse}
  | {type: 'and'; responses: InputResponse[]}
  | {type: 'initialCards'; responses: InputResponse[]}
  | {type: 'card'; cards: string[]}
  | {type: 'projectCard'; card: string; payment: EnginePayment}
  | {type: 'payment'; payment: EnginePayment}
  | {type: 'amount'; amount: number}
  | {type: 'player'; player: Color}
  | {type: 'space'; spaceId: string}
  | {type: 'productionToLose'; units: Record<string, number>}
  | {type: 'resource'; resource: string}
  | {type: 'resources'; units: Record<string, number>};

// ---- our link between the lobby and an engine game -------------------------------------------
export type FullLink = {gameId: string; spectatorId: string; players: Record<string, {engineId: string; color: Color}>;
  /** the engine's game name (e.g. "Cold Stellar Node"), shown on the game chip */
  name?: string};

// ---- wire messages added for full mode (see protocol.ts) --------------------------------------
/**
 * A game log line from the engine. `message` is a template like "${0} played ${1}"; each `data` entry
 * fills one placeholder. data[].type: 0 string, 1 raw string, 2 player (value = colour), 3 card name,
 * 4 award, 5 milestone, 9 tile type, 10 space bonus, 13 space id, 14 cards. type 1 = new generation.
 * Render with messageText(); use the data entries to find the player colour and card for animations.
 */
export type LogLine = {message: string; data: Array<{type: number; value: string}>; timestamp: number; type?: number; playerId?: string};
export const LOG_DATA = {STRING: 0, RAW: 1, PLAYER: 2, CARD: 3, AWARD: 4, MILESTONE: 5, TILE_TYPE: 9, SPACE_BONUS: 10, SPACE: 13, CARDS: 14} as const;

/**
 * `lastMove`: who made the last accepted move (a turn menu without Undo says "<name> has already moved"); null when
 * none is known since the last undo or a server restart. `v`: the version the view arrived with (the client sets it, so
 * an answer can name the exact view it was made against).
 */
export type FullView = (
  | {role: 'player'; playerId: string; model: PlayerViewModel; logs?: LogLine[]}
  | {role: 'spectator'; model: SpectatorModel; logs?: LogLine[]}
) & {lastMove?: {playerId: string; name: string} | null; v?: ViewVersion;
  /** a human seat inside its own move (its follow-up questions are open): the TV waits before announcing the card */
  moving?: Color | null;
  /** player views: "Back" out of this move's follow-up questions (with the card it puts back), or why not */
  back?: {ok: true; what: {card: string; play: boolean} | null} | {ok: false; reason: string} | null;
  /** player views: undo your last move together with the bot moves after it, or why not */
  undoMine?: {ok: true; bots: number} | {ok: false; reason: string} | null};

/**
 * The production show: one synchronized celebration on the TV and every phone when a generation's
 * production pays out. startAt/serverNow are server clock ms; clients offset by (serverNow - their now).
 */
export type ProductionShow = {
  id: string;
  generation: number;
  startAt: number;
  serverNow: number;
  durationMs: number;
  players: Array<{
    playerId: string | null;
    color: Color;
    name: string;
    before: Record<'megacredits' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat', number>;
    gains: Record<'megacredits' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat', number>;
    energyToHeat: number;
  }>;
};

/** A player's finger hovering a space on their phone before confirming; the TV shows a ghost tile. */
export type Hover = {playerId: string; color: Color; spaceId: string | null; tile: 'greenery' | 'ocean' | 'city' | 'special' | null};

/**
 * A view of the same seat (or the same spectator) that is older than the one on screen: dropped. Pushes can overtake
 * each other on the way (a move, the poll and a reconnect each fetch their own copy), and the last one to arrive must
 * not wind the numbers back. Versioned views order by the server's sends; the engine's own numbers (the fallback for
 * an unversioned view) do not order an undo that repeats undoCount (src/shared/sync.ts isRewind).
 */
export function isOlderView(next: FullView, cur: FullView | null, nextV?: ViewVersion | null, curV?: ViewVersion | null): boolean {
  if (!cur || cur.role !== next.role || cur.model.id !== next.model.id) return false;
  // Versioned views also order two sends of the same engine moment (src/shared/sync.ts).
  if (nextV && curV) return isOlderVersion(nextV, curV);
  const a = next.model.game, b = cur.model.game;
  return a.undoCount < b.undoCount || (a.undoCount === b.undoCount && a.gameAge < b.gameAge);
}
