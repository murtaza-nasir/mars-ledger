// What changed between two spectator models. Drives every animation on the TV.
import type {Color, PublicPlayerModel, SpectatorModel} from '../../../shared/full';
import {detectAttack} from '../../../shared/attack';
import type {AttackTarget} from '../../../shared/attack';

export type TileEvent = {kind: 'tile'; spaceId: string; tileType: number; color?: Color};
export type BoardEvent =
  | TileEvent
  | {kind: 'global'; param: 'temperature' | 'oxygen' | 'oceans'; from: number; to: number}
  | {kind: 'card'; color: Color; name: string}
  | {kind: 'tr'; color: Color; delta: number}
  | {kind: 'generation'; generation: number}
  | {kind: 'phase'; phase: string}
  | {kind: 'pass'; color: Color}
  | {kind: 'attack'; attacker: Color; targets: AttackTarget[]};

export type {Loss, AttackTarget} from '../../../shared/attack';

export function diffModels(prev: SpectatorModel | null, next: SpectatorModel): BoardEvent[] {
  if (!prev) return [];
  const out: BoardEvent[] = [];
  const before = new Map(prev.game.spaces.map((s) => [s.id, s]));
  for (const s of next.game.spaces) {
    if (s.tileType !== undefined && before.get(s.id)?.tileType === undefined) out.push({kind: 'tile', spaceId: s.id, tileType: s.tileType, color: s.color});
  }
  const g0 = prev.game; const g1 = next.game;
  if (g1.temperature !== g0.temperature) out.push({kind: 'global', param: 'temperature', from: g0.temperature, to: g1.temperature});
  if (g1.oxygenLevel !== g0.oxygenLevel) out.push({kind: 'global', param: 'oxygen', from: g0.oxygenLevel, to: g1.oxygenLevel});
  if (g1.oceans !== g0.oceans) out.push({kind: 'global', param: 'oceans', from: g0.oceans, to: g1.oceans});
  const byColor = new Map<Color, PublicPlayerModel>(prev.players.map((p) => [p.color, p]));
  for (const p of next.players) {
    const old = byColor.get(p.color);
    if (!old) continue;
    const had = new Set(old.tableau.map((c) => c.name));
    for (const c of p.tableau) if (!had.has(c.name)) out.push({kind: 'card', color: p.color, name: c.name});
    if (p.terraformRating !== old.terraformRating) out.push({kind: 'tr', color: p.color, delta: p.terraformRating - old.terraformRating});
  }
  for (const c of g1.passedPlayers) if (!g0.passedPlayers.includes(c)) out.push({kind: 'pass', color: c});
  if (g1.generation !== g0.generation) out.push({kind: 'generation', generation: g1.generation});
  if (g1.phase !== g0.phase) out.push({kind: 'phase', phase: g1.phase});
  const attack = detectAttack(prev, next);
  if (attack) out.push(attack);
  return out;
}
