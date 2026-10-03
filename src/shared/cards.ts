import type {CardDef, Tag} from './types';
import base from './data/base.json';
import corpera from './data/corpera.json';
import prelude from './data/prelude.json';

// Card packs by module. A new expansion adds a JSON file here plus its rules module.
export const CARD_PACKS: Record<string, CardDef[]> = {
  base: base as unknown as CardDef[],
  corpera: corpera as unknown as CardDef[],
  // Only dealt when the table turns Prelude on (the module is then added to `modules` at start).
  prelude: prelude as unknown as CardDef[],
};

const byName = new Map<string, CardDef>();
for (const pack of Object.values(CARD_PACKS)) for (const c of pack) byName.set(c.name, c);

export function getCard(name: string): CardDef {
  const c = byName.get(name);
  if (!c) throw new Error(`Unknown card: ${name}`);
  return c;
}

export function findCard(name: string): CardDef | undefined {
  return byName.get(name);
}

export function cardsFor(modules: string[], group?: CardDef['group']): CardDef[] {
  return modules.flatMap((m) => CARD_PACKS[m] ?? []).filter((c) => !group || c.group === group);
}

/** Tags that still count once the card is on the table (events keep only their event tag). */
export function countedTags(c: CardDef): Tag[] {
  return c.type === 'event' ? ['event'] : c.tags;
}
