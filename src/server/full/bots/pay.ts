// Paying for things the way a careful player would: titanium on space cards and steel on building cards first
// (they buy nothing else), heat when the corporation allows it (Helion), and M€ for the rest. Ported from the soak
// bot's pay_for (tests/full/soak.py), which the engine has accepted across many full games.
import {payment} from '../../../shared/full';
import type {EnginePayment, PaymentOptions, PublicPlayerModel} from '../../../shared/full';

type Payer = Pick<PublicPlayerModel, 'megacredits' | 'steel' | 'titanium' | 'heat' | 'steelValue' | 'titaniumValue'>;

/**
 * A legal payment of `cost`, or null when the player cannot cover it.
 * `steel`/`titanium` say whether those may be used (building / space tags, or the engine's payment options).
 */
export function payFor(me: Payer, cost: number, opts: {steel?: boolean; titanium?: boolean; heat?: boolean}): EnginePayment | null {
  let left = Math.max(0, cost);
  const p = {megacredits: 0, steel: 0, titanium: 0, heat: 0};
  if (opts.titanium && me.titanium > 0 && me.titaniumValue > 0) {
    const n = Math.min(me.titanium, Math.floor(left / me.titaniumValue));
    p.titanium = n; left -= n * me.titaniumValue;
  }
  if (opts.steel && me.steel > 0 && me.steelValue > 0) {
    const n = Math.min(me.steel, Math.floor(left / me.steelValue));
    p.steel = n; left -= n * me.steelValue;
  }
  if (opts.heat && me.heat > 0) {
    const n = Math.min(me.heat, left);
    p.heat = n; left -= n;
  }
  const mc = Math.min(me.megacredits, left);
  p.megacredits = mc; left -= mc;
  // Short by less than one metal unit: one more steel or titanium covers it (overpaying with metal is allowed).
  if (left > 0 && opts.titanium && me.titanium > p.titanium) { p.titanium++; left -= me.titaniumValue; }
  if (left > 0 && opts.steel && me.steel > p.steel) { p.steel++; left -= me.steelValue; }
  if (left > 0) return null;
  // Metal overpaid: give back M€ that is no longer needed.
  if (left < 0 && p.megacredits > 0) p.megacredits = Math.max(0, p.megacredits + left);
  return payment(p);
}

/** The payment for a project card from the engine's play prompt (titanium for space, steel for building). */
export function payForCard(me: Payer, cost: number, tags: readonly string[], po: PaymentOptions | undefined): EnginePayment | null {
  return payFor(me, cost, {
    titanium: tags.includes('space') || !!po?.titanium,
    steel: tags.includes('building') || !!po?.steel,
    heat: !!po?.heat,
  });
}

/** What a payment costs the payer in M€-equivalents (for comparing options). */
export function paymentWeight(p: EnginePayment, me: Payer): number {
  return p.megacredits + p.heat + p.steel * me.steelValue + p.titanium * me.titaniumValue;
}
