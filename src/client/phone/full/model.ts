// Helpers that turn the engine's player model into what the phone shows.
import {STANDARD_PROJECTS} from '../../../shared/board';
import {findCard} from '../../../shared/cards';
import {messageText} from '../../../shared/full';
import type {Message} from '../../../shared/full';
import type {CardModel, Color, PlayerInputModel, PlayerViewModel, PublicPlayerModel} from '../../../shared/full';
import type {CardDef, Resource} from '../../../shared/types';

export const RES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

const PROD_KEY: Record<Resource, keyof PublicPlayerModel> = {
  megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction',
};
export const stock = (p: PublicPlayerModel, r: Resource) => p[r] as number;
export const prod = (p: PublicPlayerModel, r: Resource) => p[PROD_KEY[r]] as number;

export function tagCounts(p: PublicPlayerModel): Array<[string, number]> {
  const raw = p.tags;
  const entries: Array<[string, number]> = Array.isArray(raw) ? raw.map((t) => [t.tag, t.count]) : Object.entries(raw ?? {});
  return entries.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

export function nameOf(model: PlayerViewModel, color: Color | undefined): string {
  return model.players.find((p) => p.color === color)?.name ?? color ?? '';
}

// ---- cards -----------------------------------------------------------------------------------
/** Standard projects arrive as cards named 'Power Plant:SP', 'Aquifer', 'City'... */
const SP_BY_NAME: Record<string, string> = {
  'Power Plant:SP': 'powerPlant', 'Asteroid:SP': 'asteroid', 'Aquifer': 'aquifer', 'Greenery': 'greenery', 'City': 'city',
  'Sell Patents': 'sellPatents', 'Buffer Gas': 'bufferGas', 'Air Scrapping': 'airScrapping',
};
export function standardProject(name: string) {
  const id = SP_BY_NAME[name];
  return id ? STANDARD_PROJECTS.find((s) => s.id === id) : undefined;
}

/** A displayable card definition for any name the engine sends; unknown names get a plain face. */
export function cardDef(name: string): CardDef {
  const found = findCard(name);
  if (found) return found;
  const sp = standardProject(name);
  return {
    name: sp?.name ?? name.replace(/:SP$/, ''), module: 'engine', group: sp ? 'standardProject' : 'project', type: sp ? 'standard_project' : 'automated',
    number: null, cost: sp?.cost ?? null, startingMegaCredits: null, tags: [], requirements: [], victoryPoints: null, resourceType: null,
    cardDiscount: [], behavior: null, action: null, firstAction: null, triggers: [], automation: 'full',
    description: sp?.text ?? null, text: [],
  };
}

export type TableauGroups = {corporation: CardModel[]; prelude: CardModel[]; active: CardModel[]; automated: CardModel[]; event: CardModel[]; other: CardModel[]};
export function groupTableau(cards: CardModel[]): TableauGroups {
  const g: TableauGroups = {corporation: [], prelude: [], active: [], automated: [], event: [], other: []};
  for (const c of cards) {
    const d = findCard(c.name);
    const t = d?.type;
    if (t === 'corporation' || t === 'ceo') g.corporation.push(c);
    else if (t === 'prelude') g.prelude.push(c);
    else if (t === 'active') g.active.push(c);
    else if (t === 'automated') g.automated.push(c);
    else if (t === 'event') g.event.push(c);
    else g.other.push(c);
  }
  return g;
}

// ---- inputs ----------------------------------------------------------------------------------
export type OptionKind = 'play' | 'action' | 'standard' | 'milestone' | 'award' | 'plants' | 'heat' | 'pass' | 'end' | 'sell'
  | 'undo' | 'other';

export function optionKind(o: PlayerInputModel): OptionKind {
  const t = messageText(o.title).toLowerCase();
  if (o.type === 'projectCard') return t.includes('standard') ? 'standard' : 'play';
  if (o.type === 'card' && (o as {selectBlueCardAction?: boolean}).selectBlueCardAction) return 'action';
  if (t.includes('sell patents')) return 'sell';
  if (t.includes('milestone')) return 'milestone';
  if (t.includes('award')) return 'award';
  if (t.includes('plants') && t.includes('greenery')) return 'plants';
  if (t.includes('heat') && t.includes('temperature')) return 'heat';
  if (t.startsWith('pass')) return 'pass';
  if (t === 'end turn') return 'end';
  if (t.includes('undo')) return 'undo';
  if (t.includes('action')) return 'action';
  return 'other';
}

export const OPTION_ORDER: OptionKind[] = ['play', 'action', 'standard', 'plants', 'heat', 'milestone', 'award', 'sell', 'other', 'end', 'pass', 'undo'];

export const OPTION_LABEL: Record<OptionKind, string> = {
  play: 'Play a card', action: 'Use a card action', standard: 'Standard project', milestone: 'Claim a milestone',
  award: 'Fund an award', plants: 'Plants to greenery', heat: 'Heat to temperature', pass: 'Pass for this generation',
  end: 'End turn', sell: 'Sell patents', undo: 'Undo last action', other: '',
};

/** Is this the engine's main turn menu (as opposed to a follow-up question)? */
export function isTurnMenu(w: PlayerInputModel | undefined): boolean {
  if (!w || w.type !== 'or') return false;
  const t = messageText(w.title).toLowerCase();
  return t.startsWith('take your') || (w.options as PlayerInputModel[]).some((o) => ['pass', 'end'].includes(optionKind(o)));
}

/** Card lists offered to "play a card" in the current menu: name -> calculated cost. */
export function playableCards(w: PlayerInputModel | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!w || w.type !== 'or') return out;
  for (const o of w.options as PlayerInputModel[]) {
    if (o.type === 'projectCard' && optionKind(o) === 'play') {
      for (const c of (o as {cards: CardModel[]}).cards) if (!c.isDisabled) out.set(c.name, c.calculatedCost ?? 0);
    }
  }
  return out;
}

/** What kind of tile a space question places, from its title. */
export function tileFromTitle(title: string): 'greenery' | 'ocean' | 'city' | 'special' {
  const t = title.toLowerCase();
  if (t.includes('ocean')) return 'ocean';
  if (t.includes('greenery')) return 'greenery';
  if (t.includes('city')) return 'city';
  return 'special';
}

/** Buying cards costs 3 M€ each; the engine says so only in the title. */
export function isBuyTitle(title: string): boolean {
  return /\bbuy\b/i.test(title);
}

/** Message text with player colours replaced by player names ("pass the rest to Vera"). */
export function msg(model: PlayerViewModel, m: Message | undefined): string {
  if (m === undefined) return '';
  if (typeof m === 'string') return m;
  return m.message.replace(/\$\{(\d+)\}/g, (_, i) => {
    const d = m.data[Number(i)];
    if (!d) return '';
    return d.type === 2 ? nameOf(model, d.value as Color) : d.value;
  });
}

// ---- the turn menu's fixed rows --------------------------------------------------------------
/** The main turn options, always listed in this order; ones the engine does not offer stay visible but disabled. */
export const MENU_ROWS: OptionKind[] = ['play', 'action', 'standard', 'plants', 'heat', 'milestone', 'award', 'sell'];

const AWARD_COSTS = [8, 14, 20];

/** Why a main turn option is not available right now, from the player's own model. Never sent anywhere. */
export function unavailableReason(kind: OptionKind, model: PlayerViewModel): string {
  const me = model.thisPlayer;
  const g = model.game;
  const corps = new Set(me.tableau.map((c) => c.name));
  const heatPays = corps.has('Helion');
  const mc = me.megacredits;
  switch (kind) {
  case 'play': {
    const hand = model.cardsInHand;
    if (!hand.length) return 'No cards in hand';
    // The most a player can put toward each card: M€, steel on building tags, titanium on space tags, heat for Helion.
    const reach = (c: CardModel) => {
      const tags = cardDef(c.name).tags;
      return mc + (heatPays ? me.heat : 0) + (tags.includes('building') ? me.steel * me.steelValue : 0) + (tags.includes('space') ? me.titanium * me.titaniumValue : 0);
    };
    const affordable = hand.filter((c) => (c.calculatedCost ?? cardDef(c.name).cost ?? 0) <= reach(c));
    if (!affordable.length) {
      const cheapest = Math.min(...hand.map((c) => c.calculatedCost ?? cardDef(c.name).cost ?? 0));
      return `Nothing affordable: cheapest ${cheapest} M€, you have ${mc} M€`;
    }
    return 'Requirements not met for the cards you can afford';
  }
  case 'action': {
    const withAction = me.tableau.filter((c) => cardDef(c.name).text.some((t) => /^Action:/i.test(t)));
    if (!withAction.length) return 'No card actions on your table';
    const used = new Set(me.actionsThisGeneration);
    if (withAction.every((c) => used.has(c.name))) return 'All card actions used this generation';
    return 'Your card actions need something you do not have right now';
  }
  case 'standard': {
    const cheapest = corps.has('ThorGate') ? 8 : 11;
    return `Nothing affordable: cheapest ${cheapest} M€, you have ${mc + (heatPays ? me.heat : 0)} M€`;
  }
  case 'plants': {
    const need = corps.has('Ecoline') ? 7 : 8;
    return me.plants < need ? `${need} plants needed, you have ${me.plants}` : 'No space for a greenery right now';
  }
  case 'heat':
    if (g.temperature >= 8) return 'Temperature is at its maximum';
    return me.heat < 8 ? `8 heat needed, you have ${me.heat}` : 'Not available right now';
  case 'milestone': {
    const claimed = g.milestones.filter((m) => m.color || m.playerName).length;
    if (claimed >= 3) return 'All 3 milestones are claimed';
    if (mc < 8) return `8 M€ needed, you have ${mc} M€`;
    return 'No milestone reached yet';
  }
  case 'award': {
    const funded = g.awards.filter((a) => a.color || a.playerName).length;
    if (funded >= 3) return 'All 3 awards are funded';
    const cost = AWARD_COSTS[funded];
    if (mc < cost) return `${cost} M€ needed, you have ${mc} M€`;
    return 'Not available right now';
  }
  case 'sell':
    return model.cardsInHand.length ? 'Not available right now' : 'No cards to sell';
  default:
    return 'Not available right now';
  }
}

/** Why one standard project is greyed out (the engine only marks it disabled). */
export function standardProjectReason(name: string, cost: number, model: PlayerViewModel): string {
  const me = model.thisPlayer;
  const g = model.game;
  const id = name.replace(/:SP$/, '').toLowerCase();
  if (id.startsWith('aquifer') && g.oceans >= 9) return 'All 9 oceans are placed';
  if (id.startsWith('asteroid') && g.temperature >= 8) return 'Temperature is at its maximum';
  const have = me.megacredits + (me.tableau.some((c) => c.name === 'Helion') ? me.heat : 0);
  if (have < cost) return `${cost} M€ needed, you have ${have} M€`;
  return 'Not available right now';
}
