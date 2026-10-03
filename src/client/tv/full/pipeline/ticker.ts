// The TV's log ticker as moves: at most three recent actions, each as the player's colour chip, a card
// thumbnail (or a glyph), one or two words and what it did as icons: "Asteroid → [ocean]". The engine's log is read
// as moves by the phone's grouping (phone/full/logMoves.ts); this picks the newest ones and their icons. Pure.
import {findCard} from '../../../../shared/cards';
import type {Color, LogLine} from '../../../../shared/full';
import type {Resource} from '../../../../shared/types';
import {cardLabel, groupLog, victimOf} from '../../../phone/full/logMoves';
import type {LogEntry, MoveHow} from '../../../phone/full/logMoves';

export type TickerIcon =
  | {k: 'tile'; tile: 'ocean' | 'greenery' | 'city' | 'special'}
  | {k: 'global'; param: 'temperature' | 'oxygen' | 'venus'}
  | {k: 'res'; r: Resource; n: number; prod: boolean}
  | {k: 'cards'; n: number}
  | {k: 'tr'; n: number};

export type TickerItem = {
  key: string;
  by: Color;
  how: MoveHow | 'passed';
  /** the card to show as a thumbnail (a project card or corporation the TV knows) */
  card: string | null;
  /** one or two words: the card's name, the standard project, the milestone, "passed" */
  label: string;
  icons: TickerIcon[];
  /** players the move hurt */
  hit: Color[];
};

/** At most this many moves show. */
export const TICKER_MAX = 3;
/** At most this many result icons per move (the hit marks come on top). */
const ICONS_MAX = 4;

const str = (l: LogLine, i: number) => {
  const v = l.data[i]?.value as unknown;
  return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
};
const player = (l: LogLine, i: number) => (l.data[i]?.type === 2 ? (l.data[i].value as Color) : null);

/** "plants", "plant", "M€", "megacredits" → the resource. */
export function resourceOf(word: string): Resource | null {
  const w = word.toLowerCase();
  if (w.startsWith('m€') || w.startsWith('megacredit') || w === 'mc') return 'megacredits';
  if (w.startsWith('plant')) return 'plants';
  if (w.startsWith('steel')) return 'steel';
  if (w.startsWith('titanium')) return 'titanium';
  if (w.startsWith('energy')) return 'energy';
  if (w.startsWith('heat')) return 'heat';
  return null;
}

function tileOf(desc: string): TickerIcon {
  const d = desc.toLowerCase();
  return {k: 'tile', tile: d.startsWith('ocean') ? 'ocean' : d.startsWith('greenery') ? 'greenery' : d.startsWith('city') || d.startsWith('capital') ? 'city' : 'special'};
}

/** What a move did, as icons: tiles first, then the global parameters its card raises, production, stock, cards. */
export function iconsOf(by: Color, card: string | null, lines: LogLine[]): TickerIcon[] {
  const tiles: TickerIcon[] = [];
  const prod: TickerIcon[] = [];
  const stock: TickerIcon[] = [];
  let cards = 0;
  for (const l of lines) {
    if (player(l, 0) !== by) continue;
    let m: RegExpMatchArray | null;
    if ((m = l.message.match(/^\$\{0\} gained \$\{1\} \$\{2\}( production)?$/))) {
      const r = resourceOf(str(l, 2));
      const n = Number(str(l, 1));
      if (r && n > 0) (m[1] ? prod : stock).push({k: 'res', r, n, prod: !!m[1]});
    } else if (/^\$\{0\} \$\{1\} \$\{2\} at \$\{3\}$/.test(l.message) && str(l, 1) === 'placed') tiles.push(tileOf(str(l, 2)));
    else if (/^\$\{0\} \$\{1\} \$\{2\} card\(s\)$/.test(l.message) && str(l, 1) === 'drew') cards += Number(str(l, 2)) || 0;
  }
  const g = card ? findCard(card)?.behavior?.global : undefined;
  const globals: TickerIcon[] = [];
  // standard actions and projects that raise the temperature have no card behaviour to read
  if (g?.temperature || card === 'Convert Heat' || card === 'Asteroid:SP') globals.push({k: 'global', param: 'temperature'});
  if (g?.oxygen) globals.push({k: 'global', param: 'oxygen'});
  if (g?.venus) globals.push({k: 'global', param: 'venus'});
  const tr = card ? findCard(card)?.behavior?.tr : undefined;
  const out = [...tiles, ...globals, ...prod, ...stock, ...(cards > 0 ? [{k: 'cards', n: cards} as TickerIcon] : []),
    ...(typeof tr === 'number' && tr > 0 ? [{k: 'tr', n: tr} as TickerIcon] : [])];
  return out.slice(0, ICONS_MAX);
}

function labelOf(e: Extract<LogEntry, {kind: 'move'}>): string {
  if (e.how === 'milestone' || e.how === 'award') return str(e.head, 1);
  return e.card ? cardLabel(e.card) : '';
}

/**
 * The newest moves, newest first, at most TICKER_MAX. `hide`: played cards ('color|name') the TV has not shown yet
 * (their move waits until its card resolves on screen). `generation`: the current generation (for groupLog).
 */
export function tickerItems(lines: LogLine[], hide: ReadonlySet<string> = new Set(), generation = 1, max = TICKER_MAX): TickerItem[] {
  const entries = groupLog(lines, null, generation);
  const out: TickerItem[] = [];
  const pass = (l: LogLine, key: string) => {
    const by = player(l, 0);
    if (by && /^\$\{0\} passed$/.test(l.message)) out.push({key, by, how: 'passed', card: null, label: 'passed', icons: [], hit: []});
  };
  for (const e of entries) {
    if (e.kind === 'move') {
      if (e.how === 'played' && e.card && hide.has(`${e.by}|${e.card}`)) continue;
      const card = e.card && findCard(e.card) ? e.card : null;
      const hit = [...new Set(e.lines.map((l) => victimOf(l, e.by)).filter((c): c is Color => !!c))];
      out.push({key: e.key, by: e.by, how: e.how, card, label: labelOf(e), icons: iconsOf(e.by, e.card, e.lines), hit});
    } else if (e.kind === 'line') pass(e.line, e.key);
    else if (e.kind === 'run') e.lines.forEach((l, i) => pass(l, `${e.key}#${i}`));
  }
  return out.slice(-max).reverse();
}
