// Build src/shared/data/<module>.json from the engine extract (cards-src/) plus overrides (cards/overrides/).
// Usage: npm run cards
import * as fs from 'fs';
import * as path from 'path';
import type {CardDef} from '../src/shared/types';

const MODULES = ['base', 'corpera', 'prelude'];
// Behavior keys the executor in src/shared/engine.ts understands.
const SUPPORTED = new Set(['or', 'spend', 'production', 'stock', 'standardResource', 'addResources', 'addResourcesToAnyCard',
  'removeResourcesFromAnyCard', 'decreaseAnyProduction', 'removeAnyPlants', 'tr', 'global', 'city', 'greenery', 'ocean',
  'tile', 'titanumValue', 'steelValue', 'drawCard', 'greeneryDiscount', 'manual', 'optional', 'steal',
  'addResourcesToTriggerCard', 'log', 'title', 'text', 'autoSelect', 'removeAnyStock', 'exchangeProduction',
  'exchangeStock', 'conditional', 'copyProductionBox', 'nextCardRequirementBonus', 'nextCardDiscount', 'requires',
  'playCardNow', 'playPrelude', 'fundAwardFree', 'raiseLowestProduction']);
const PLAIN_HOOKS = new Set(['play', 'action', 'canAct', 'canPlay']);

type Override = Partial<CardDef> & {replace?: boolean};

function unsupported(b: unknown): string[] {
  if (!b || typeof b !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    if (!SUPPORTED.has(k)) out.push(k);
    if (k === 'or') for (const x of (v as {behaviors: unknown[]}).behaviors) out.push(...unsupported(x));
    if (k === 'optional') out.push(...unsupported((v as {behavior: unknown}).behavior));
  }
  return out;
}

const report: string[] = ['# Card automation report', '', `Generated ${new Date().toISOString().slice(0, 10)} by tools/build-cards.ts.`, ''];
for (const mod of MODULES) {
  const raw = JSON.parse(fs.readFileSync(`cards-src/${mod}.json`, 'utf8')) as Array<Record<string, any>>;
  const ovPath = path.resolve(`cards/overrides/${mod}.ts`);
  const overrides: Record<string, Override> = fs.existsSync(ovPath) ? (await import(ovPath)).default : {};
  const seen = new Set<string>();
  const out: CardDef[] = [];
  const counts = {full: 0, partial: 0, manual: 0};
  const lines: string[] = [];
  for (const r of raw) {
    if (r.group === 'standardProject' || r.group === 'standardAction') continue;
    const ov = overrides[r.name];
    if (ov) seen.add(r.name);
    const hooks = (r.hooks as string[]).filter((h) => !PLAIN_HOOKS.has(h));
    const def: CardDef = {
      name: r.name, module: mod, group: r.group, type: r.type, number: r.number, cost: r.cost,
      startingMegaCredits: r.startingMegaCredits, tags: r.tags, requirements: r.requirements,
      victoryPoints: r.victoryPoints ?? null, resourceType: r.resourceType ?? null,
      cardDiscount: r.cardDiscount ? [r.cardDiscount].flat() : [],
      behavior: r.behavior ?? null, action: r.action ?? null, firstAction: r.firstAction ?? null, triggers: [],
      automation: 'full', description: r.description, text: r.text,
      ...(ov ?? {}),
    } as CardDef;
    delete (def as Override).replace;
    const gaps = [...unsupported(def.behavior), ...unsupported(def.action), ...unsupported(def.firstAction)];
    const manualSteps = JSON.stringify([def.behavior, def.action, def.firstAction, def.triggers]).includes('"manual"');
    if (!ov && hooks.length) def.automation = 'manual';
    else if (gaps.length || manualSteps || ov?.automation === 'partial') def.automation = 'partial';
    if (ov?.automation) def.automation = ov.automation;
    counts[def.automation]++;
    if (def.automation !== 'full') lines.push(`- ${def.automation}: **${def.name}** ${hooks.length && !ov ? `(engine hooks: ${hooks.join(', ')})` : ''}${gaps.length ? ` unsupported: ${gaps.join(', ')}` : ''}${def.boardVP ? ` (board step: ${def.boardVP})` : ''}`);
    out.push(def);
  }
  for (const k of Object.keys(overrides)) if (!seen.has(k)) throw new Error(`Override for unknown card ${k} in ${mod}`);
  fs.writeFileSync(`src/shared/data/${mod}.json`, JSON.stringify(out));
  report.push(`## ${mod}: ${out.length} cards; ${counts.full} full, ${counts.partial} partial, ${counts.manual} manual`, '', ...lines, '');
  console.log(mod, out.length, counts);
}
fs.writeFileSync('cards/REPORT.md', report.join('\n'));

// Every card name in every module (not only the packs in play), so mission control can reject a line that
// names a real card which is not in this game, as well as one that invents a card.
const allNames = new Set<string>();
for (const f of fs.readdirSync('cards-src').filter((x) => x.endsWith('.json'))) {
  for (const c of JSON.parse(fs.readFileSync(`cards-src/${f}`, 'utf8')) as Array<{name: string}>) allNames.add(c.name.replace(/:SP$/, ''));
}
fs.writeFileSync('src/shared/data/card-names.json', JSON.stringify([...allNames].sort()));
console.log('card names', allNames.size);
