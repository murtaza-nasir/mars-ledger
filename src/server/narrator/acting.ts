// Acting notes: how mission control should say a line ("dry, deadpan", "withering sarcasm"). The model
// writes one after its line; it never reaches the caption. A note may only hold delivery direction:
// words outside the delivery vocabulary below are dropped, the note is capped at six words, and a note
// with nothing left falls back to the moment's default.
import type {NarratorKind} from './detect';

/** The notes offered to the model. Free text is allowed too, within DELIVERY_WORDS. */
export const ACTING_NOTES = [
  'dry, deadpan', 'mock-solemn', 'barely contained glee', 'withering sarcasm', 'genuinely impressed',
  'wry, understated', 'mock outrage', 'hushed awe', 'weary patience', 'gravely concerned', 'smug satisfaction',
  'warm, approving', 'brisk, matter-of-fact', 'theatrical gravitas',
];

/** A note that fits each kind of moment, used when the model gives none (or nothing usable). */
export const DEFAULT_NOTES: Record<NarratorKind, string> = {
  attack: 'withering sarcasm',
  bigPlay: 'genuinely impressed',
  firstTile: 'wry, understated',
  paramMax: 'hushed awe',
  paramBonus: 'dry, deadpan',
  milestone: 'mock-solemn',
  award: 'mock-solemn',
  recap: 'dry, deadpan',
  leadChange: 'barely contained glee',
  preludes: 'brisk, matter-of-fact',
  gameEnd: 'theatrical gravitas',
};

export const MAX_NOTE_WORDS = 6;
export const MAX_NOTE_CHARS = 60;

/** Words that only join tone words; trimmed from either end. */
const CONNECTORS = new Set(['a', 'an', 'and', 'but', 'then', 'with', 'of']);
/** Words that shade a tone word ("barely contained"); fine first, trimmed last. */
const MODIFIERS = new Set(['very', 'slightly', 'faintly', 'quietly', 'barely', 'hint', 'touch', 'almost', 'just']);
/** A note made of these alone says nothing. */
const JOINERS = new Set([...CONNECTORS, ...MODIFIERS]);

/** Every word a note may use. */
export const DELIVERY_WORDS = new Set<string>([
  ...JOINERS,
  ...ACTING_NOTES.flatMap((n) => n.split(/[\s,]+/)),
  'mock', 'solemn', 'solemnly', 'matter-of-fact', 'deadpan', 'dry', 'drily', 'dryly', 'wry', 'wryly', 'understated',
  'sarcasm', 'sarcastic', 'sardonic', 'ironic', 'arch', 'droll', 'teasing', 'playful', 'mischievous', 'sly', 'knowing',
  'tongue-in-cheek', 'withering', 'glee', 'gleeful', 'delight', 'delighted', 'triumphant', 'jubilant', 'excited', 'excitement',
  'contained', 'restrained', 'suppressed', 'impressed', 'admiring', 'admiration', 'genuinely', 'sincere', 'sincerely',
  'proud', 'pride', 'warm', 'warmly', 'approving', 'gentle', 'gently', 'kind', 'consoling', 'sympathetic', 'rueful',
  'resigned', 'weary', 'patience', 'patient', 'exasperated', 'incredulous', 'disbelief', 'astonished', 'surprised',
  'awe', 'awed', 'hushed', 'reverent', 'grave', 'gravely', 'concerned', 'ominous', 'foreboding', 'grim', 'mournful',
  'sombre', 'somber', 'smug', 'satisfaction', 'satisfied', 'theatrical', 'dramatic', 'gravitas', 'grand', 'stately',
  'ceremonial', 'formal', 'outrage', 'outraged', 'indignant', 'scandalised', 'scandalized', 'calm', 'measured',
  'unhurried', 'unflappable', 'brisk', 'crisp', 'clipped', 'conspiratorial', 'whispered', 'low', 'slow', 'deliberate',
  'cheerful', 'bright', 'amused', 'bemused', 'polite', 'politely', 'bored', 'tired', 'fond', 'fondly', 'urgent',
]);

export type ActingNote = {note: string; source: 'model' | 'default'};

/**
 * Keep only delivery direction: lower case, letters, hyphens and commas; words outside the delivery
 * vocabulary are dropped (names, numbers, quotes, anything that is not a way of speaking). Joiners
 * at either end are trimmed. Nothing usable means the default for the moment.
 */
export function cleanNote(raw: string | null | undefined, kind: NarratorKind): ActingNote {
  const fallback: ActingNote = {note: DEFAULT_NOTES[kind] ?? 'dry, deadpan', source: 'default'};
  if (!raw) return fallback;
  const first = raw.split('\n')[0].toLowerCase().replace(/[^a-z,\- ]+/g, ' ');
  const tokens: string[] = [];
  for (const part of first.split(/(,)|\s+/)) {
    if (!part) continue;
    if (part === ',') { if (tokens.length && tokens[tokens.length - 1] !== ',') tokens.push(','); continue; }
    const w = part.replace(/^-+|-+$/g, '');
    if (w && DELIVERY_WORDS.has(w)) tokens.push(w);
  }
  const words = () => tokens.filter((t) => t !== ',');
  const trim = () => {
    while (tokens.length && (tokens[0] === ',' || CONNECTORS.has(tokens[0]))) tokens.shift();
    while (tokens.length && (tokens[tokens.length - 1] === ',' || JOINERS.has(tokens[tokens.length - 1]))) tokens.pop();
  };
  trim();
  while (words().length > MAX_NOTE_WORDS) { tokens.pop(); trim(); }
  let note = tokens.join(' ').replace(/ ,/g, ',');
  while (note.length > MAX_NOTE_CHARS) { tokens.pop(); trim(); note = tokens.join(' ').replace(/ ,/g, ','); }
  if (!words().some((w) => !JOINERS.has(w))) return fallback;
  return {note, source: 'model'};
}

/**
 * Split the model's reply into the caption line and its acting note. The prompt asks for the line, then
 * "Delivery: <note>" on a line of its own; a note given inline at the end ("... Delivery: dry") is found too.
 */
export function splitReply(raw: string): {line: string; note: string | null} {
  const m = /^([\s\S]*?)[\s([]*\b(?:delivery|acting note|acting|tone)\s*:\s*([^\n\])]*)[\])]?\s*$/i.exec(raw.trim());
  if (m && m[1].trim()) return {line: m[1].trim(), note: m[2].trim() || null};
  return {line: raw, note: null};
}
