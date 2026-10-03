// Production income for the full-game show, computed from the last model seen BEFORE production.
// Diffing post-production stocks would be wrong: research/draft purchases follow immediately, and the
// energy-to-heat conversion hides inside the heat and energy numbers.
import type {PublicPlayerModel} from './full';
import type {Resource, Units} from './types';

export const SHOW_RESOURCES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

const PROD: Record<Resource, keyof PublicPlayerModel> = {
  megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction',
  plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction',
};

export type Income = {
  /** stock just before production */
  before: Units;
  /** what production adds: M€ = M€ production + TR; heat = heat production + converted energy */
  gains: Units;
  /** energy stock that turns into heat (already counted in gains.heat) */
  energyToHeat: number;
  /** stock right after production */
  after: Units;
};

export function productionIncome(p: PublicPlayerModel): Income {
  const before = Object.fromEntries(SHOW_RESOURCES.map((r) => [r, p[r] as number])) as Units;
  const prod = (r: Resource) => p[PROD[r]] as number;
  const energyToHeat = Math.max(0, before.energy);
  const gains: Units = {
    megacredits: prod('megacredits') + p.terraformRating,
    steel: prod('steel'),
    titanium: prod('titanium'),
    plants: prod('plants'),
    energy: prod('energy'),
    heat: prod('heat') + energyToHeat,
  };
  const after = Object.fromEntries(SHOW_RESOURCES.map((r) => [r, before[r] + gains[r]])) as Units;
  after.energy = prod('energy');
  return {before, gains, energyToHeat, after};
}

/**
 * Split an amount into at most `max` tokens whose values sum exactly to the amount.
 * Small incomes get one token per unit; big ones get fewer, heavier tokens.
 */
export function tokenValues(amount: number, max: number): number[] {
  if (amount <= 0 || max <= 0) return [];
  const n = Math.min(amount, max);
  const base = Math.floor(amount / n);
  let extra = amount - base * n;
  return Array.from({length: n}, () => base + (extra-- > 0 ? 1 : 0));
}
