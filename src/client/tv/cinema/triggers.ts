// What deserves a cinematic, from a change in the global parameters (both modes) and from
// engine models (full mode). Pure: the TVs call these and enqueue the results.
import type {Color} from '../../../shared/full';
import type {Cinematic, MilestoneKind} from './queue';

export type Globals = {temperature: number; oxygen: number; oceans: number};

export const planetOf = (g: Globals) => ({sea: g.oceans / 9, green: g.oxygen / 14, warmth: (g.temperature + 30) / 38});

const maxed = (g: Globals) => g.temperature >= 8 && g.oxygen >= 14 && g.oceans >= 9;

export function milestoneCinematics(key: string, a: Globals, b: Globals, by?: {name: string; color: Color}): Cinematic[] {
  const out: Cinematic[] = [];
  const add = (milestone: MilestoneKind, value: number) =>
    out.push({id: `${key}:${milestone}:${value}`, kind: 'milestone', milestone, by, value, planet: {from: planetOf(a), to: planetOf(b)}});
  // board bonus steps first (short banners), then the big moments
  for (const step of [-24, -20]) if (a.temperature < step && b.temperature >= step) add('heat-bonus', step);
  if (a.temperature < 0 && b.temperature >= 0) add('ocean-bonus', 0);
  if (a.oxygen < 8 && b.oxygen >= 8) add('oxygen-bonus', 8);
  if (a.oceans < 9 && b.oceans >= 9) add('oceans', 9);
  if (a.oxygen < 14 && b.oxygen >= 14) add('oxygen', 14);
  if (a.temperature < 8 && b.temperature >= 8) add('temperature', 8);
  if (!maxed(a) && maxed(b)) add('all', 1);
  return out;
}
