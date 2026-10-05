// Attacks, inferred from consecutive spectator models. Shared by the TV (moments) and the server (history).
import type {Color, PublicPlayerModel, SpectatorModel} from './full';
import {isRewind} from './sync';

export type Loss = {what: 'stock' | 'production' | 'tr' | 'card'; resource?: string; card?: string; amount: number};
export type AttackTarget = {color: Color; losses: Loss[]};
export type AttackEvent = {kind: 'attack'; attacker: Color; targets: AttackTarget[]};

const STOCK: Array<[string, keyof PublicPlayerModel, keyof PublicPlayerModel]> = [
  ['megacredits', 'megacredits', 'megacreditProduction'], ['steel', 'steel', 'steelProduction'], ['titanium', 'titanium', 'titaniumProduction'],
  ['plants', 'plants', 'plantProduction'], ['energy', 'energy', 'energyProduction'], ['heat', 'heat', 'heatProduction'],
];

/**
 * Attacks, inferred from state rather than log wording (which varies by card). Within one action-phase
 * update, whatever a player other than the acting player loses was taken by the acting player.
 * The acting player is the one active in the previous model (the turn may have moved on since).
 * Skipped: other phases, generation changes, undo, and a player's own greenery conversion.
 */
export function detectAttack(prev: SpectatorModel, next: SpectatorModel): AttackEvent | null {
  const g0 = prev.game; const g1 = next.game;
  if (g0.phase !== 'action' || g1.phase !== 'action') return null;
  if (g0.generation !== g1.generation || isRewind(g0, g1)) return null;
  const before = new Map(prev.players.map((p) => [p.color, p]));
  const newTilesBy = new Set(next.game.spaces.filter((s) => s.color && s.tileType !== undefined &&
    prev.game.spaces.find((o) => o.id === s.id)?.tileType === undefined).map((s) => s.color));
  // Who moved in this update: a card played, a card action used, a pass, a tile of their own. When two players moved
  // between two models (quick bots), what a mover spent is their own cost, never an attack by the other.
  const acted = new Set(actorsBetween(prev, next));
  for (const c of newTilesBy) if (c) acted.add(c);
  const active = prev.players.find((p) => p.isActive);
  // the acting player: the one active before, unless the update shows exactly one other player moving (the turn passed
  // in a model this screen never saw)
  const onlyMover = acted.size === 1 ? [...acted][0] : null;
  const attacker = onlyMover && onlyMover !== active?.color ? prev.players.find((p) => p.color === onlyMover) : active;
  if (!attacker) return null;
  const targets: AttackTarget[] = [];
  for (const p of next.players) {
    if (p.color === attacker.color) continue;
    // a player who moved too: only lost plants are taken as an attack (cards take plants; a player spends them only on
    // greenery, which is not counted), everything else may be what their own move cost
    const mover = acted.has(p.color);
    const o = before.get(p.color);
    if (!o) continue;
    const losses: Loss[] = [];
    for (const [r, stock, prod] of STOCK) {
      const ds = (o[stock] as number) - (p[stock] as number);
      // Losing plants while placing one's own greenery is a conversion, not an attack.
      if (ds > 0 && !(r === 'plants' && newTilesBy.has(p.color)) && (!mover || r === 'plants')) losses.push({what: 'stock', resource: r, amount: ds});
      const dp = (o[prod] as number) - (p[prod] as number);
      if (dp > 0 && !mover) losses.push({what: 'production', resource: r, amount: dp});
    }
    if (mover) { if (losses.length) targets.push({color: p.color, losses}); continue; }
    if (o.terraformRating > p.terraformRating) losses.push({what: 'tr', amount: o.terraformRating - p.terraformRating});
    const had = new Map(o.tableau.map((c) => [c.name, c.resources ?? 0]));
    for (const c of p.tableau) {
      const d = (had.get(c.name) ?? 0) - (c.resources ?? 0);
      if (d > 0) losses.push({what: 'card', card: c.name, amount: d});
    }
    if (losses.length) targets.push({color: p.color, losses});
  }
  return targets.length ? {kind: 'attack', attacker: attacker.color, targets} : null;
}


/** Players who moved between two models of one generation: a new card on their table, a new card action, or a pass. */
export function actorsBetween(prev: SpectatorModel, next: SpectatorModel): Color[] {
  const out: Color[] = [];
  for (const p of next.players) {
    const o = prev.players.find((x) => x.color === p.color);
    if (!o) continue;
    const had = new Set(o.tableau.map((c) => c.name));
    const used = new Set(o.actionsThisGeneration ?? []);
    if (p.tableau.some((c) => !had.has(c.name)) || (p.actionsThisGeneration ?? []).some((n) => !used.has(n)) ||
      ((next.game.passedPlayers ?? []).includes(p.color) && !(prev.game.passedPlayers ?? []).includes(p.color))) out.push(p.color);
  }
  return out;
}
