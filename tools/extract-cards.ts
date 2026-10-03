// Run from vendor/tm: npx tsx ../../tools/extract-cards.ts <outDir>
// Dumps every card in every module manifest to <outDir>/<module>.json.
import * as fs from 'fs';
import * as path from 'path';
import {ALL_MODULE_MANIFESTS} from './src/server/cards/AllManifests';

const outDir = process.argv[2];
fs.mkdirSync(outDir, {recursive: true});

// Methods that mean the card does something the declarative fields do not describe.
const HOOKS = ['bespokePlay', 'bespokeCanPlay', 'bespokeAction', 'bespokeCanAct', 'onCardPlayed',
  'onCardPlayedForCorps', 'onCorpCardPlayed', 'onTilePlaced', 'onGlobalParameterIncrease', 'getCardDiscount',
  'onStandardProject', 'onProductionPhase', 'onResourceAdded', 'getVictoryPoints', 'getRequirementBonus',
  'initialAction', 'onColonyAdded', 'onDiscard', 'onIncreaseTerraformRating', 'onProductionGain',
  'getAttributes', 'play', 'action', 'canAct', 'canPlay'];

function ownHooks(card: object): string[] {
  const found = new Set<string>();
  let proto = Object.getPrototypeOf(card);
  while (proto && !['Card', 'ActionCard', 'CorporationCard', 'PreludeCard', 'CeoCard', 'Object', 'StandardProjectCard', 'StandardActionCard'].includes(proto.constructor.name)) {
    for (const k of Object.getOwnPropertyNames(proto)) if (k !== 'constructor' && (HOOKS.includes(k) || typeof Object.getOwnPropertyDescriptor(proto, k)?.value === 'function')) found.add(k);
    proto = Object.getPrototypeOf(proto);
  }
  return [...found];
}

function texts(node: unknown, out: string[] = []): string[] {
  // Effect and action wording is pushed into render rows as bare strings ("Effect: ...", "Action: ...").
  if (Array.isArray(node)) {
    for (const v of node) {
      if (typeof v === 'string' && v.length > 12 && v.includes(' ')) out.push(v);
      else texts(v, out);
    }
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === 'text' || k === 'description') && typeof v === 'string' && v.length > 1) out.push(v);
      else texts(v, out);
    }
  }
  return out;
}

function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x] : x)));
}

let total = 0;
for (const m of ALL_MODULE_MANIFESTS) {
  const cards: unknown[] = [];
  const groups: Array<[string, object]> = [
    ['project', m.projectCards], ['corporation', m.corporationCards], ['prelude', m.preludeCards],
    ['ceo', m.ceoCards], ['standardProject', m.standardProjects], ['standardAction', m.standardActions],
  ];
  for (const [group, manifest] of groups) {
    for (const spec of Object.values(manifest ?? {}) as Array<{Factory: new () => any, compatibility?: unknown, instantiate?: boolean}>) {
      if (spec.instantiate === false) continue;
      let c: any;
      try { c = new spec.Factory(); } catch (e) { console.error('skip', group, e); continue; }
      const md = c.metadata ?? {};
      const desc = typeof md.description === 'string' ? md.description : md.description?.text;
      cards.push(clean({
        name: c.name, group, type: c.type, module: m.module, compatibility: spec.compatibility ?? null,
        number: md.cardNumber ?? null, cost: c.cost ?? null, startingMegaCredits: c.startingMegaCredits ?? null,
        tags: c.tags ?? [], requirements: c.requirements ?? [], victoryPoints: c.properties?.victoryPoints ?? c.victoryPoints ?? null,
        resourceType: c.resourceType ?? null, cardDiscount: c.cardDiscount ?? null,
        behavior: c.behavior ?? null, action: c.properties?.action ?? c.action ?? null,
        firstAction: c.firstAction ?? null, initialActionText: c.initialActionText ?? null,
        hooks: ownHooks(c), description: desc ?? null, text: texts(md.renderData),
      }));
    }
  }
  fs.writeFileSync(path.join(outDir, `${m.module}.json`), JSON.stringify(cards, null, 1));
  console.log(m.module, cards.length);
  total += cards.length;
}
console.log('total', total);
