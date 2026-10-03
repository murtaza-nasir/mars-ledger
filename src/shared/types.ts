// Core vocabulary shared by server, phones and TV.
// Resource, tag and behavior names follow the open-source engine (vendor/tm) so its card data drops in unchanged.

export const RESOURCES = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'] as const;
export type Resource = typeof RESOURCES[number];
export type Units = Record<Resource, number>;

export const TAGS = ['building', 'space', 'science', 'power', 'earth', 'jovian', 'venus', 'plant', 'microbe',
  'animal', 'city', 'moon', 'mars', 'crime', 'wild', 'event', 'clone'] as const;
export type Tag = typeof TAGS[number];

export type CardType = 'event' | 'active' | 'automated' | 'prelude' | 'corporation' | 'ceo' | 'standard_project' | 'standard_action';
export type CardResource = string; // 'Animal' | 'Microbe' | 'Science' | 'Fighter' | ...
export type TileKind = 'city' | 'greenery' | 'ocean' | 'special';
export type GlobalParam = 'temperature' | 'oxygen' | 'oceans' | 'venus';

// ---- Countable: a number or a count derived from game state -------------------------------
export type CountSpec = {
  tag?: Tag | Tag[];
  others?: boolean; // only opponents
  all?: boolean; // every player
  cities?: {where?: 'onmars' | 'offmars'};
  greeneries?: object;
  oceans?: object;
  eventsPlayed?: boolean;
  resourcesHere?: object;
  per?: number; // divide, rounding down
  each?: number; // multiply
};
export type Countable = number | CountSpec;
export type CountableUnits = Partial<Record<Resource, Countable>>;

// ---- Behavior: the engine's declarative effect format, subset we execute -------------------
export type TitledBehavior = Behavior & {title: string};
export type Behavior = {
  or?: {behaviors: TitledBehavior[]; title?: string};
  spend?: Partial<Record<Resource, number>> & {resourcesHere?: number; cards?: number; canUseSteel?: boolean; canUseTitanium?: boolean};
  production?: CountableUnits;
  stock?: CountableUnits;
  standardResource?: number | {count: number; same?: boolean};
  addResources?: Countable;
  addResourcesToAnyCard?: {count: Countable; type?: CardResource; tag?: Tag; excludeThis?: boolean; min?: number} |
    Array<{count: Countable; type?: CardResource; tag?: Tag}>;
  removeResourcesFromAnyCard?: {type: CardResource; count?: Countable; source?: 'self' | 'opponents' | 'all'; upTo?: boolean};
  decreaseAnyProduction?: {count: number; type: Resource};
  removeAnyPlants?: number;
  tr?: Countable;
  global?: Partial<Record<'temperature' | 'oxygen' | 'venus', number>>;
  city?: {space?: string; on?: string};
  greenery?: {on?: string};
  ocean?: {count?: number; on?: string};
  tile?: {type: string | number; on?: string; title?: string};
  titanumValue?: number;
  steelValue?: number;
  drawCard?: number | {count: Countable; keep?: number; pay?: boolean; tag?: Tag; type?: CardType; resource?: CardResource};
  greeneryDiscount?: number;
  // ---- our extensions (used by overrides) ----
  /** A step we cannot automate: shown as an instruction; the player adjusts by hand if needed. */
  manual?: string;
  /** Yes/no question; the nested behavior runs only on yes. */
  optional?: {title: string; behavior: Behavior};
  /** Steal resources from another player (Hired Raiders style). */
  steal?: {type: Resource; count: number};
  /** Target card for resources is the card that caused a trigger. */
  addResourcesToTriggerCard?: number;
  /** Place a tile owned by nobody but still counted (e.g. Mohole). */
  log?: string;
  /** Remove up to `count` of a standard resource from a chosen player (Sabotage, Flooding). */
  removeAnyStock?: {type: Resource; count: number};
  /** Move any number of production steps from one resource to another (Insulation). */
  exchangeProduction?: {from: Resource; to: Resource};
  /** Spend any amount of one resource to gain as much of another (Power Infrastructure). */
  exchangeStock?: {from: Resource; to: Resource};
  /** Branch on the player's tag count (Nitrogen-Rich Asteroid). */
  conditional?: {tag: Tag; atLeast: number; then: Behavior; else?: Behavior};
  /** Replay the production box of one of the player's cards with this tag (Robotic Workforce). */
  copyProductionBox?: {tag: Tag};
  /** The next card this generation gets this many steps of global-requirement tolerance (Special Design). */
  nextCardRequirementBonus?: number;
  /** The next card this generation costs this much less (Indentured Workers). */
  nextCardDiscount?: number;
  /** Precondition checked before anything else runs. */
  requires?: 'trRaisedThisGeneration';
  /** Prelude: the player plays a project card from hand straight away (Eccentric Sponsor, Ecology Experts).
   *  The text is shown to the player; the card goes through the normal Play card flow. */
  playCardNow?: string;
  /** Valley Trust: play one prelude card (drawn from the prelude deck). */
  playPrelude?: boolean;
  /** Vitor: fund an award without paying for it. */
  fundAwardFree?: boolean;
  /** Robinson Industries: increase (one of) your lowest productions 1 step. */
  raiseLowestProduction?: boolean;
};

export type Requirement = {
  temperature?: number; oxygen?: number; oceans?: number; venus?: number;
  tag?: Tag; production?: Resource; greeneries?: number; cities?: number; tr?: number;
  count?: number; max?: boolean; all?: boolean;
};

export type VictoryPoints = number | 'special' | {
  resourcesHere?: object; per?: number; each?: number; tag?: Tag; cities?: object; oceans?: object;
  nextToThis?: object; all?: boolean;
  /** with resourcesHere: this many VP when at least one resource is here (Search For Life). */
  ifAny?: number;
};

export type CardDiscount = {tag?: Tag; amount: number; per?: 'card'};

// ---- Triggers: our declarative form of the engine's bespoke hooks --------------------------
export type Trigger = {
  when: 'cardPlayed' | 'tilePlaced' | 'standardProject' | 'globalRaised';
  /** Whose actions fire it. */
  scope: 'self' | 'any' | 'others';
  /** cardPlayed: fire if the played card has any of these tags. */
  tags?: Tag[];
  /** cardPlayed: fire once per matching tag instead of once per card. */
  perTag?: boolean;
  cardType?: CardType;
  minCost?: number;
  tile?: TileKind;
  tileOnMars?: boolean;
  /** tilePlaced: only when the tile's placement bonus included steel or titanium. */
  bonusSteelOrTitanium?: boolean;
  /** cardPlayed: only cards with a non-negative victory-point icon (Vitor). */
  hasVictoryPoints?: boolean;
  /** Behavior for the owner of the trigger card. */
  behavior?: Behavior;
  /** Tharsis-style: owner gets `behavior` for others' tiles, `selfBehavior` for own. */
  selfBehavior?: Behavior;
  standardProjectExcludes?: string[];
  text: string;
};

export type CardDef = {
  name: string;
  module: string;
  group: 'project' | 'corporation' | 'prelude' | 'ceo' | 'standardProject' | 'standardAction';
  type: CardType;
  number: string | null;
  cost: number | null;
  startingMegaCredits: number | null;
  tags: Tag[];
  requirements: Requirement[];
  victoryPoints: VictoryPoints | null;
  resourceType: CardResource | null;
  cardDiscount: CardDiscount[];
  behavior: Behavior | null;
  action: Behavior | null;
  firstAction: Behavior | null;
  triggers: Trigger[];
  /** Global-requirement tolerance granted while this card is in play (Adaptation Technology = 2). */
  requirementBonus?: number;
  /** Payment with heat allowed (Helion). */
  heatAsMC?: boolean;
  /** Standard projects cost less while this card is in play (ThorGate). */
  standardProjectDiscount?: Array<{project: string; amount: number}>;
  /** Resource protection: Pets' animals, or Protected Habitats' plants/animals/microbes against opponents. */
  protects?: 'thisCard' | 'plantsAnimalsMicrobes';
  /** VP that depend on the physical board (adjacency); scored through the final board-VP entry. */
  boardVP?: string;
  /** Resources on this card pay for cards with this tag (Psychrophiles: microbes as 2 M€ for plant cards). */
  payWithResources?: {tag: Tag; value: number};
  /** how much of this card the app applies by itself */
  automation: 'full' | 'partial' | 'manual';
  description: string | null;
  text: string[];
};
