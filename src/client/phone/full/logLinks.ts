// What a log move can show on the TV (src/shared/tvlinks.ts): the move itself again (a replay), and the places and
// trackers it changed (a map echo). Read from the move's own lines and its card's rules data, never guessed: a tile
// line names its space; a card's behaviour names the global parameters and TR it raises; gain and loss lines name a
// player's resource cell. Pure, like logMoves.ts; tests/tvlinks.test.ts runs it on real engine logs.
import type {Color, LogLine} from '../../../shared/full';
import {LOG_DATA} from '../../../shared/full';
import {findCard} from '../../../shared/cards';
import type {EchoTarget, ReplayMove} from '../../../shared/tvlinks';
import type {LogEntry} from './logMoves';
import {plain, summary, victimOf} from './logMoves';

type Move = Extract<LogEntry, {kind: 'move'}>;
type Res = Extract<EchoTarget, {kind: 'res'}>['resource'];
type Param = Extract<EchoTarget, {kind: 'global'}>['param'];

const playerAt = (l: LogLine, i: number): Color | null => (l.data[i]?.type === LOG_DATA.PLAYER ? l.data[i].value as Color : null);
const valueAt = (l: LogLine, i: number): string => String(l.data[i]?.value ?? '');

/** The engine's resource words ("plant", "plants", "M€", "Energy") as a panel cell. */
export function resOf(word: string): Res | null {
  const w = word.toLowerCase().replace(/\(s\)$/, '');
  if (w === 'm€' || w === 'megacredit' || w === 'megacredits' || w === 'mc') return 'megacredits';
  if (w.startsWith('plant')) return 'plants';
  if (w.startsWith('steel')) return 'steel';
  if (w.startsWith('titanium')) return 'titanium';
  if (w.startsWith('energy')) return 'energy';
  if (w.startsWith('heat')) return 'heat';
  return null;
}

/** A behaviour block's global parameters and whether it gives TR. */
function fromBehavior(b: unknown, out: {params: Set<Param>; tr: boolean}) {
  if (!b || typeof b !== 'object') return;
  const x = b as {global?: Record<string, number>; ocean?: unknown; greenery?: unknown; tr?: number};
  if (x.global?.temperature) out.params.add('temperature');
  if (x.global?.oxygen) out.params.add('oxygen');
  if (x.ocean) out.params.add('oceans');
  if (x.tr) out.tr = true;
}

/** Tile words in a placement line ("ocean tile", "greenery tile", "city tile", "Natural Preserve tile"). */
const tileWord = (l: LogLine) => valueAt(l, 2).toLowerCase();

/**
 * The places and trackers a move changed, most telling first: the spaces it placed tiles on, the global parameters it
 * raised (and the mover's TR with them), then the resource cells its gains and losses touched. At most 8.
 */
export function echoTargets(m: Move): EchoTarget[] {
  const spaces: EchoTarget[] = [];
  const params = new Set<Param>();
  let tr = false;
  const cells: EchoTarget[] = [];
  const rules = {params, tr: false};
  const def = m.card ? findCard(m.card) : undefined;
  const sp = m.card ? m.card.replace(/:SP$/, '') : '';
  if (def && m.how === 'played') fromBehavior(def.behavior, rules);
  if (def && (m.how === 'used' || m.how === 'reused')) {
    const a = def.action as {or?: {behaviors?: Array<{spend?: {resourcesHere?: number}}>}} | null;
    if (a?.or?.behaviors) {
      // a choice: the branch that spends the card's resources raised the parameter when the log shows them removed
      const spent = m.lines.some((l) => /^\$\{0\} removed /.test(l.message));
      for (const b of a.or.behaviors) if (!!b.spend?.resourcesHere === spent) fromBehavior(b, rules);
    } else fromBehavior(a, rules);
  }
  if (m.how === 'project') {
    if (/^Asteroid$/i.test(sp)) params.add('temperature');
    if (/^Aquifer$/i.test(sp)) params.add('oceans');
  }
  if (m.how === 'standard' && m.card && /^Convert Heat$/i.test(m.card)) params.add('temperature');
  tr = rules.tr;
  for (const l of m.lines) {
    if (/^\$\{0\} \$\{1\} \$\{2\} at \$\{3\}$/.test(l.message) && l.data[3]?.type === LOG_DATA.SPACE && valueAt(l, 1) === 'placed') {
      spaces.push({kind: 'space', spaceId: valueAt(l, 3)});
      if (/^ocean/.test(tileWord(l))) params.add('oceans');
      if (/^greenery/.test(tileWord(l))) params.add('oxygen');
      continue;
    }
    if (/^\$\{0\} (gained|lost) \$\{1\} \$\{2\}( production)?( because of \$\{3\})?$/.test(l.message)) {
      const who = playerAt(l, 0);
      const res = resOf(valueAt(l, 2));
      if (who && res) cells.push({kind: 'res', color: who, resource: res});
      else if (who && /^tr$/i.test(valueAt(l, 2))) cells.push({kind: 'tr', color: who});
      continue;
    }
    if (/^\$\{3\} stole \$\{1\} \$\{2\}( production)? from \$\{0\}$/.test(l.message)) {
      const res = resOf(valueAt(l, 2));
      const victim = playerAt(l, 0);
      const thief = playerAt(l, 3);
      if (res && victim) cells.push({kind: 'res', color: victim, resource: res});
      if (res && thief && thief !== victim) cells.push({kind: 'res', color: thief, resource: res});
      continue;
    }
    if (/^\$\{0\} (gained|lost) \$\{1\} TR/.test(l.message)) {
      const who = playerAt(l, 0);
      if (who) cells.push({kind: 'tr', color: who});
    }
  }
  if (params.size) tr = true;
  const out: EchoTarget[] = [...spaces, ...[...params].map((param) => ({kind: 'global', param}) as EchoTarget)];
  if (tr) out.push({kind: 'tr', color: m.by});
  // hits first among the cells: the victim's cell is what the table asks about
  const victims = new Set(m.lines.map((l) => victimOf(l, m.by)).filter((c): c is Color => !!c));
  const sorted = [...cells.filter((c) => 'color' in c && victims.has(c.color)), ...cells.filter((c) => !('color' in c && victims.has(c.color)))];
  const seen = new Set<string>();
  for (const c of [...out, ...sorted]) {
    const k = JSON.stringify(c);
    if (!seen.has(k)) seen.add(k);
  }
  return [...seen].slice(0, 8).map((k) => JSON.parse(k) as EchoTarget);
}

/** Does the move change the board or a global parameter (the moves whose button says "Show on the TV" first)? */
export const touchesMap = (targets: EchoTarget[]) => targets.some((t) => t.kind === 'space' || t.kind === 'global');

/** The move as the TV needs it to present it again. `name`: colour to name, for the one-line summary. */
export function replayOf(m: Move, name: (c: Color) => string = (c) => c): ReplayMove {
  const targets = new Map<Color, NonNullable<ReplayMove['targets']>[number]['losses']>();
  for (const l of m.lines) {
    const v = victimOf(l, m.by);
    if (!v) continue;
    const amount = Number(valueAt(l, 1)) || 1;
    const prod = / production( |$)/.test(l.message);
    const res = resOf(valueAt(l, 2));
    const loss = /removed \$\{1\} resource/.test(l.message)
      ? {what: 'card' as const, card: valueAt(l, 3), amount}
      : {what: prod ? 'production' as const : 'stock' as const, ...(res ? {resource: res} : {}), amount};
    targets.set(v, [...(targets.get(v) ?? []), loss]);
  }
  const gains: NonNullable<ReplayMove['gains']> = [];
  for (const l of m.lines) {
    if (playerAt(l, 0) !== m.by || !/^\$\{0\} gained \$\{1\} \$\{2\}( production)?$/.test(l.message)) continue;
    const r = resOf(valueAt(l, 2));
    const n = Number(valueAt(l, 1));
    if (r && n > 0) gains.push({r, n, prod: / production$/.test(l.message)});
  }
  const spaceId = replaySpace(m);
  const used = m.how === 'used' || m.how === 'reused' || m.how === 'first';
  const line = summary(m).slice(0, 4).map((p) => plain(p, name)).join(' · ');
  return {key: m.key, by: m.by, how: m.how, card: m.card,
    ...(used && m.card ? {cards: [m.card]} : {}),
    ...(line ? {line} : {}),
    ...(targets.size ? {targets: [...targets].map(([color, losses]) => ({color, losses}))} : {}),
    ...(gains.length ? {gains} : {}), ...(spaceId ? {spaceId} : {})};
}

/** The space a tile line placed a tile on ("Ada placed a city tile at 32"), else null. */
const placedAt = (l: LogLine): string | null =>
  (/^\$\{0\} \$\{1\} \$\{2\} at \$\{3\}$/.test(l.message) && valueAt(l, 1) === 'placed' && l.data[3]?.type === LOG_DATA.SPACE ? valueAt(l, 3) : null);

/**
 * Can the TV present this move? A card played or used (corporations and preludes too); a standard project or a
 * conversion only when it placed a tile (the TV then points at it). Milestones and awards have nothing to show.
 */
export const replayable = (m: Move) => (!!m.card && !/:SP$/.test(m.card) && m.how !== 'standard') || !!replaySpace(m);
const replaySpace = (m: Move): string | null => m.lines.map(placedAt).find((x) => !!x) ?? null;

/** The newest move in the log that the TV can present (entries oldest first, as groupLog returns them). */
export function lastReplayable(entries: LogEntry[]): Move | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'move' && replayable(e)) return e;
  }
  return null;
}
