// Looking at another player's table from the phone's Table tab: who can be picked, in what order, and what
// the header and action notes say. Pure helpers, so the rules are tested without a browser.
import type {Color, PublicPlayerModel} from '../../../shared/full';

/** "Kepler's table": whose table this is, so nobody mistakes it for their own. */
export function tableTitle(name: string): string {
  return `${name.trim() || 'Player'}'s table`;
}

/** Everyone but me, starting with the player after me in turn order (the engine lists players in seat order). */
export function othersFrom(players: PublicPlayerModel[], me: Color): PublicPlayerModel[] {
  const i = players.findIndex((p) => p.color === me);
  if (i < 0) return players.slice();
  return [...players.slice(i + 1), ...players.slice(0, i)];
}

/** A short chip label: the first word of the name, at most 9 characters. */
export function chipName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
}

/** The selection after a change: back to me when I leave the Table tab or my turn starts, else unchanged;
 *  a player who is no longer at the table also falls back to me. */
export function focusAfter(focus: Color | null, ev: {tableShown: boolean; turnStarted: boolean; colors: Color[]}): Color | null {
  if (!focus) return null;
  if (!ev.tableShown || ev.turnStarted) return null;
  return ev.colors.includes(focus) ? focus : null;
}

/** What a card with an action says on someone else's table (read-only: never how to use it). */
export function otherActionNote(used: boolean): string {
  return used ? 'Action used this generation' : 'Action ready';
}

/** The fields another player's table shows; equal signatures render the same, so the deck can skip the update. */
export function tableSignature(p: PublicPlayerModel): string {
  return JSON.stringify([p.name, p.isActive, p.terraformRating, p.cardsInHandNbr,
    p.megacredits, p.megacreditProduction, p.steel, p.steelProduction, p.titanium, p.titaniumProduction,
    p.plants, p.plantProduction, p.energy, p.energyProduction, p.heat, p.heatProduction,
    p.tableau.map((c) => [c.name, c.resources ?? 0]), p.tags, p.actionsThisGeneration]);
}
