// What board life reacts to: the game's own changes (the spectator model, as the TV already diffs it), reduced to a few
// kinds. Pure. The move pipeline is never asked to wait for any of this: these events are read after the fact.
import type {Color, SpectatorModel} from '../../../../../shared/full';
import {isRewind} from '../../../../../shared/sync';
import {diffModels} from '../../diff';

export type LifeEvent =
  | {kind: 'tile'; spaceId: string; tileType: number; color?: Color}
  /** an attack card hit players */
  | {kind: 'attack'}
  /** a card from the sky: asteroids, comets and such */
  | {kind: 'impact'; card: string}
  | {kind: 'mc'; color: Color; delta: number}
  | {kind: 'temp'; from: number; to: number}
  | {kind: 'production'}
  /** any move at all (the idle clock restarts) */
  | {kind: 'activity'};

/** Cards that fall from the sky onto Mars. */
export const IMPACT_CARD = /asteroid|comet|meteor|impactor|deimos down|big asteroid|hailstorm|bombard/i;
/** Temperatures (°C) at which the sun gets bright: the heat bonus step, the ocean bonus step and the maximum. */
export const SUN_STEPS = [-20, 0, 8] as const;
/** A single update that gives a player at least this many M€. */
export const BIG_MC = 15;

export function deriveLifeEvents(prev: SpectatorModel | null, next: SpectatorModel): LifeEvent[] {
  if (!prev || prev.id !== next.id || isRewind(prev.game, next.game)) return [];
  const out: LifeEvent[] = [];
  for (const e of diffModels(prev, next)) {
    switch (e.kind) {
    case 'tile': out.push({kind: 'tile', spaceId: e.spaceId, tileType: e.tileType, color: e.color}); break;
    case 'card': if (IMPACT_CARD.test(e.name)) out.push({kind: 'impact', card: e.name}); break;
    case 'attack': out.push({kind: 'attack'}); break;
    case 'global':
      if (e.param === 'temperature') for (const s of SUN_STEPS) if (e.from < s && e.to >= s) { out.push({kind: 'temp', from: e.from, to: e.to}); break; }
      break;
    case 'phase': if (e.phase === 'production') out.push({kind: 'production'}); break;
    default: break;
    }
  }
  // a big gain of M€ outside the production phase (production has its own reaction)
  if (next.game.phase !== 'production' && prev.game.phase !== 'production') {
    const before = new Map(prev.players.map((p) => [p.color, p.megacredits]));
    for (const p of next.players) {
      const was = before.get(p.color);
      if (was !== undefined && p.megacredits - was >= BIG_MC) out.push({kind: 'mc', color: p.color, delta: p.megacredits - was});
    }
  }
  if (out.length || next.game.gameAge !== prev.game.gameAge) out.push({kind: 'activity'});
  return out;
}
