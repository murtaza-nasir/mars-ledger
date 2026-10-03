// Board facts: global parameter ranges, each map's milestones and awards, standard projects.
// Milestone and award rules follow the engine (vendor/tm/src/server/milestones, awards) exactly;
// the few that depend on where tiles sit on the physical board are marked `manual`, because the
// companion engine only knows how many tiles a player owns, not where.
import type {Behavior, CardDef} from './types';
import type {PlayerState} from './game';

export const GLOBAL = {
  temperature: {min: -30, max: 8, step: 2},
  oxygen: {min: 0, max: 14, step: 1},
  oceans: {min: 0, max: 9, step: 1},
  venus: {min: 0, max: 30, step: 2},
} as const;

export const MILESTONE_COST = 8;
export const AWARD_COSTS = [8, 14, 20];

export const BOARD_NAMES = ['tharsis', 'hellas', 'elysium'] as const;
export type BoardName = typeof BOARD_NAMES[number];
export type BoardChoice = BoardName | 'random';

/** What a standing needs to know about a player; the engine supplies it (board.ts must not import the engine). */
export type StandingHelpers = {
  /** tags that count while in play (events contribute only their event tag) */
  tags: (p: PlayerState, tag: string) => number;
  /** distinct tag kinds on non-event cards in play, corporation included */
  distinctTags: (p: PlayerState) => number;
  /** project cards in play (not the corporation) */
  played: (p: PlayerState) => CardDef[];
  /** resources sitting on cards in play */
  cardResources: (p: PlayerState) => number;
};

export type Standing = {
  name: string;
  text: string;
  goal?: number;
  /** null when the companion engine cannot know it (see `manual`) */
  value: (p: PlayerState, h: StandingHelpers) => number | null;
  /** what the players count on the physical board instead */
  manual?: string;
  /** depends on where tiles sit on the physical board, so the companion engine cannot compute it */
  positional?: boolean;
};

const cities = (p: PlayerState) => p.tiles.cityOnMars + p.tiles.cityOffMars;
const projects = (h: StandingHelpers, p: PlayerState) => h.played(p).filter((c) => c.type === 'active' || c.type === 'automated');

// ---- Tharsis -----------------------------------------------------------------------------------
const THARSIS_MILESTONES: Standing[] = [
  {name: 'Terraformer', text: 'Terraform rating of 35', goal: 35, value: (p) => p.tr},
  {name: 'Mayor', text: 'Own 3 cities', goal: 3, value: (p) => cities(p)},
  {name: 'Gardener', text: 'Own 3 greenery tiles', goal: 3, value: (p) => p.tiles.greenery},
  {name: 'Builder', text: 'Have 8 building tags in play', goal: 8, value: (p, h) => h.tags(p, 'building')},
  // The hand is private in companion mode: the table trusts the claim.
  {name: 'Planner', text: 'Have 16 cards in hand', goal: 16, value: (p) => p.handSize, manual: 'cards in hand'},
];
const THARSIS_AWARDS: Standing[] = [
  {name: 'Landlord', text: 'Most tiles in play', value: (p) => cities(p) + p.tiles.greenery + p.tiles.special},
  {name: 'Banker', text: 'Highest M€ production', value: (p) => p.production.megacredits},
  {name: 'Scientist', text: 'Most science tags in play', value: (p, h) => h.tags(p, 'science')},
  {name: 'Thermalist', text: 'Most heat resources', value: (p) => p.stock.heat},
  {name: 'Miner', text: 'Most steel and titanium resources', value: (p) => p.stock.steel + p.stock.titanium},
];

// ---- Hellas ------------------------------------------------------------------------------------
const HELLAS_MILESTONES: Standing[] = [
  {name: 'Diversifier', text: 'Have 8 different tags in play', goal: 8, value: (p, h) => h.distinctTags(p)},
  {name: 'Tactician', text: 'Have 5 cards with requirements in play', goal: 5,
    value: (p, h) => h.played(p).filter((c) => c.type !== 'event' && c.requirements.length > 0).length},
  {name: 'Polar Explorer', text: 'Own 3 tiles on the two bottom rows', goal: 3, value: () => null,
    manual: 'your tiles on the two bottom rows', positional: true},
  {name: 'Energizer', text: 'Have 6 energy production', goal: 6, value: (p) => p.production.energy},
  {name: 'Rim Settler', text: 'Have 3 Jovian tags in play', goal: 3, value: (p, h) => h.tags(p, 'jovian')},
];
const HELLAS_AWARDS: Standing[] = [
  {name: 'Cultivator', text: 'Own the most greenery tiles', value: (p) => p.tiles.greenery},
  {name: 'Magnate', text: 'Have the most automated (green) project cards in play', value: (p, h) => h.played(p).filter((c) => c.type === 'automated').length},
  {name: 'Space Baron', text: 'Have the most space tags in play', value: (p, h) => h.tags(p, 'space')},
  {name: 'Excentric', text: 'Have the most resources on cards in play', value: (p, h) => h.cardResources(p)},
  {name: 'Contractor', text: 'Have the most building tags in play', value: (p, h) => h.tags(p, 'building')},
];

// ---- Elysium -----------------------------------------------------------------------------------
const ELYSIUM_MILESTONES: Standing[] = [
  // With Corporate Era (always on here) a production counts once it is above zero.
  {name: 'Generalist', text: 'Have increased all 6 productions by 1 step', goal: 6,
    value: (p) => Object.values(p.production).filter((n) => n > 0).length},
  {name: 'Specialist', text: 'Have 10 in production of any resource', goal: 10, value: (p) => Math.max(...Object.values(p.production))},
  {name: 'Ecologist', text: 'Have 4 bio tags in play (plant, microbe and animal)', goal: 4,
    value: (p, h) => h.tags(p, 'plant') + h.tags(p, 'microbe') + h.tags(p, 'animal')},
  {name: 'Tycoon', text: 'Have 15 project cards in play (not events)', goal: 15, value: (p, h) => projects(h, p).length},
  {name: 'Legend', text: 'Have 5 cards in your event pile', goal: 5, value: (p, h) => h.played(p).filter((c) => c.type === 'event').length},
];
const ELYSIUM_AWARDS: Standing[] = [
  {name: 'Celebrity', text: 'Have the most project cards in play costing at least 20 M€ (not events)',
    value: (p, h) => projects(h, p).filter((c) => (c.cost ?? 0) >= 20).length},
  // The physical rule and the engine's final count: steel and energy resources.
  {name: 'Industrialist', text: 'Have the most steel and energy resources', value: (p) => p.stock.steel + p.stock.energy},
  {name: 'Desert Settler', text: 'Own the most tiles south of the equator (the four bottom rows)', value: () => null,
    manual: 'your tiles on the four bottom rows', positional: true},
  {name: 'Estate Dealer', text: 'Own the most tiles next to ocean tiles', value: () => null,
    manual: 'your tiles next to an ocean', positional: true},
  {name: 'Benefactor', text: 'Have the highest terraform rating', value: (p) => p.tr},
];

export type BoardInfo = {name: BoardName; title: string; blurb: string; milestones: Standing[]; awards: Standing[]};

export const BOARDS: Record<BoardName, BoardInfo> = {
  tharsis: {name: 'tharsis', title: 'Tharsis', blurb: 'The classic map: volcanoes in the west, Noctis City in the labyrinth.',
    milestones: THARSIS_MILESTONES, awards: THARSIS_AWARDS},
  hellas: {name: 'hellas', title: 'Hellas', blurb: 'The southern basin: oceans in the middle, a polar cap that pays 6 M€ for an extra ocean.',
    milestones: HELLAS_MILESTONES, awards: HELLAS_AWARDS},
  elysium: {name: 'elysium', title: 'Elysium', blurb: 'The northern plains: a sea in the north and card-rich volcanoes.',
    milestones: ELYSIUM_MILESTONES, awards: ELYSIUM_AWARDS},
};

export function boardOf(s: {board?: BoardName}): BoardInfo {
  return BOARDS[s.board ?? 'tharsis'];
}

/** Every milestone and award on every board, for lookups by name (narration, logs). */
export const ALL_STANDINGS: Standing[] = BOARD_NAMES.flatMap((b) => [...BOARDS[b].milestones, ...BOARDS[b].awards]);
export function findStanding(name: string): Standing | undefined {
  return ALL_STANDINGS.find((x) => x.name === name);
}

/** Hellas: a tile on the south-pole space lets its owner pay this to place an extra ocean. */
export const HELLAS_BONUS_OCEAN_COST = 6;

export type StandardProject = {id: string; name: string; cost: number; behavior: Behavior; text: string};
export const STANDARD_PROJECTS: StandardProject[] = [
  {id: 'sellPatents', name: 'Sell patents', cost: 0, behavior: {}, text: 'Discard cards for 1 M€ each'},
  {id: 'powerPlant', name: 'Power plant', cost: 11, behavior: {production: {energy: 1}}, text: 'Increase energy production 1 step'},
  {id: 'asteroid', name: 'Asteroid', cost: 14, behavior: {global: {temperature: 1}}, text: 'Raise temperature 1 step'},
  {id: 'aquifer', name: 'Aquifer', cost: 18, behavior: {ocean: {}}, text: 'Place an ocean tile'},
  {id: 'greenery', name: 'Greenery', cost: 23, behavior: {greenery: {}}, text: 'Place a greenery tile'},
  {id: 'city', name: 'City', cost: 25, behavior: {city: {}, production: {megacredits: 1}}, text: 'Place a city tile and increase M€ production 1 step'},
];

export const PLANTS_PER_GREENERY = 8;
export const HEAT_PER_TEMPERATURE = 8;
export const CARD_BUY_COST = 3;
export const STARTING_TR = 20;
