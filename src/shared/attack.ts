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
  const attacker = prev.players.find((p) => p.isActive);
  if (!attacker) return null;
  const before = new Map(prev.players.map((p) => [p.color, p]));
  const newTilesBy = new Set(next.game.spaces.filter((s) => s.color && s.tileType !== undefined &&
    prev.game.spaces.find((o) => o.id === s.id)?.tileType === undefined).map((s) => s.color));
  const targets: AttackTarget[] = [];
  for (const p of next.players) {
    if (p.color === attacker.color) continue;
    const o = before.get(p.color);
    if (!o) continue;
    const losses: Loss[] = [];
    for (const [r, stock, prod] of STOCK) {
      const ds = (o[stock] as number) - (p[stock] as number);
      // Losing plants while placing one's own greenery is a conversion, not an attack.
      if (ds > 0 && !(r === 'plants' && newTilesBy.has(p.color))) losses.push({what: 'stock', resource: r, amount: ds});
      const dp = (o[prod] as number) - (p[prod] as number);
      if (dp > 0) losses.push({what: 'production', resource: r, amount: dp});
    }
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

