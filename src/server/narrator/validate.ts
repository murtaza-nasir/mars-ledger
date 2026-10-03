// Every line is checked before it reaches the TV. A line that names a player or card not in the game,
// uses a number that is not in the facts, spells a number out, runs long, or contains profanity is
// rejected; the caller may retry once with the reason.
import cardNames from '../../shared/data/card-names.json';
import commonWords from './words.json';
import {CARD_PACKS} from '../../shared/cards';
import {ALL_STANDINGS} from '../../shared/board';
import {STYLE_EXAMPLES} from './prompt';
import {cleanNote, splitReply} from './acting';
import type {NarratorKind} from './detect';

export const MAX_LINE = 160;

export type LineContext = {
  players: string[];
  /** cards the facts mention (the only cards the line may name) */
  cards: string[];
  facts: string[];
  /** corporations in play: their names may appear too */
  corporations?: string[];
  /** claims that would be false for this moment */
  avoid?: Array<{pattern: RegExp; because: string}>;
};

export type Verdict = {ok: true; text: string} | {ok: false; reason: string};

/** Words that may be capitalised mid-sentence without naming a player or card. */
const VOCAB = new Set([
  'Mars', 'Martian', 'Martians', 'Earth', 'Moon', 'Phobos', 'Deimos', 'Ganymede', 'Jupiter', 'Jovian', 'Venus', 'Sun', 'Solar',
  'Tharsis', 'Hellas', 'Elysium', 'Olympus', 'Noctis', 'Valles', 'Marineris', 'Arsia', 'Pavonis', 'Ascraeus',
  'Mission', 'Control', 'Generation', 'TR', 'VP', 'M€', 'MC', 'C', 'I', 'OK', 'Oxygen', 'Temperature', 'Oceans', 'Ocean',
  'Terraforming', 'Terraform', 'Rating', 'Milestone', 'Award', 'Corporation', 'Corp', 'Houston',
  // every board's milestone and award names (Tharsis, Hellas, Elysium)
  ...ALL_STANDINGS.flatMap((m) => m.name.split(' ')),
]);

const NUMBER_WORDS: Record<string, number> = {two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90};
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')}|hundred|thousand)(?:-\\w+)?\\b`, 'gi');

const UNITS: Record<string, number> = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9};

/** "seven" -> 7, "twenty-seven" -> 27; null for anything it cannot read exactly ("hundred", "twenty-ish"). */
function numberWordValue(word: string): number | null {
  const [head, tail] = word.toLowerCase().split('-');
  const base = NUMBER_WORDS[head];
  if (base === undefined) return null;
  if (tail === undefined) return base;
  return base >= 20 && base % 10 === 0 && tail in UNITS ? base + UNITS[tail] : null;
}

/** Players are named, never guessed at: a gendered pronoun in a line is refused. */
const GENDERED = /\b(he|she|his|her|hers|him|himself|herself)\b/i;

/** Kept short and literal on purpose; the model is instructed not to swear, this catches slips. */
const PROFANITY = /\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|damn\w*|hell|crap\w*|piss\w*|dick\w*|ass|asshole\w*|arse\w*|bloody|wtf|stupid|idiot\w*|moron\w*|loser\w*|dumb\w*|suck\w*|screw(ed)?)\b/i;

const MULTI_WORD_CARDS: string[] = (cardNames as string[]).filter((n) => /\s/.test(n)).sort((a, b) => b.length - a.length);

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Clean the model's reply: one line, no wrapping quotes, tidy spacing. */
export function tidy(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
  return t;
}

export type ReplyVerdict = {ok: true; text: string; note: string; noteSource: 'model' | 'default'} | {ok: false; reason: string};

/**
 * The model's whole reply: the line (checked by validateLine; it is all the caption ever shows) and its
 * acting note (capped and stripped to delivery direction; a missing or unusable note gets the moment's
 * default, never a rejection).
 */
export function validateReply(raw: string, ctx: LineContext, kind: NarratorKind): ReplyVerdict {
  const {line, note} = splitReply(raw);
  const v = validateLine(line, ctx);
  if (!v.ok) return v;
  const n = cleanNote(note, kind);
  return {ok: true, text: v.text, note: n.note, noteSource: n.source};
}

export function validateLine(raw: string, ctx: LineContext): Verdict {
  const text = tidy(raw);
  if (!text) return {ok: false, reason: 'the line was empty'};
  if (text.length > MAX_LINE) return {ok: false, reason: `the line was ${text.length} characters; keep it under 130`};
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) return {ok: false, reason: 'it used an emoji'};
  if (/#\w/.test(text)) return {ok: false, reason: 'it used a hashtag'};
  if (/["“”]/.test(text)) return {ok: false, reason: 'it used quotation marks'};
  if (/[*[\]]/.test(text)) return {ok: false, reason: 'it used stage directions or markup'};
  if (/!!/.test(text)) return {ok: false, reason: 'it stacked exclamation marks'};
  if (PROFANITY.test(text)) return {ok: false, reason: 'it used a word that is not friendly enough'};
  if (/^(mission control|looks like|well)\b/i.test(text)) return {ok: false, reason: 'it began with a banned opening'};
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  for (const ex of STYLE_EXAMPLES) {
    for (const sentence of ex.split(/(?<=\.)\s+/)) {
      if (flat(text).includes(flat(sentence))) return {ok: false, reason: 'it copied one of the style examples; write something new'};
    }
  }
  if (GENDERED.test(text)) return {ok: false, reason: 'it used he, she, his or her; refer to players only by name'};
  // Mars is only finished when the game says so.
  const over = /\b(ended|won|tied|terraformed)\b/i.test(ctx.facts.join(' ')) && /game|won|tied/i.test(ctx.facts.join(' '));
  const done = /\b(finish(ed|es)? (the )?terraforming|terraforming (is )?(done|complete|over|finished)|fully terraformed|mission accomplished|job done|mars is (done|finished|complete))\b/i.exec(text);
  if (done && !over) return {ok: false, reason: `it said "${done[0]}", but the terraforming is not finished`};
  for (const c of ctx.avoid ?? []) {
    const m = c.pattern.exec(text);
    if (m) return {ok: false, reason: `it said "${m[0]}", but ${c.because}`};
  }

  // Numbers: each must appear in the facts (signs and a trailing % or °/C are ignored). A number written as
  // a word ("two remain") is fine when its value is in the facts; "one" and "zero" are too common to check.
  const factNumbers = new Set((ctx.facts.join(' ').match(/\d+(?:\.\d+)?/g) ?? []));
  for (const m of text.matchAll(NUMBER_WORD)) {
    const value = numberWordValue(m[0]);
    if (value === null || !factNumbers.has(String(value))) {
      return {ok: false, reason: `it wrote the number "${m[0]}", which is not in the facts; write numbers as digits`};
    }
  }
  for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!factNumbers.has(n)) return {ok: false, reason: `it used the number ${n}, which is not in the facts`};
  }

  // Card names: remove the allowed ones; any multi-word card name left is one this moment did not involve.
  // (Single-word card names are caught by the proper-noun check below when capitalised mid-sentence.)
  let rest = text;
  const allowed = [...ctx.cards, ...(ctx.corporations ?? [])].sort((a, b) => b.length - a.length);
  for (const c of allowed) rest = rest.replace(new RegExp(`\\b${escape(c)}\\b`, 'g'), ' ');
  for (const c of MULTI_WORD_CARDS) {
    if (new RegExp(`\\b${escape(c)}\\b`).test(rest)) return {ok: false, reason: `it named ${c}, which is not part of this moment`};
  }

  // Proper nouns: a capitalised word mid-sentence must be a player, an allowed card, or known vocabulary.
  const known = new Set<string>(VOCAB);
  for (const n of [...ctx.players, ...allowed]) for (const w of n.split(/[\s-]+/)) known.add(w.replace(/[^\p{L}\p{N}€]/gu, ''));
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const words = s.split(/\s+/);
    // A sentence's first word is capitalised anyway: it must be an ordinary word or a known name.
    const first = words[0]?.replace(/^[^\p{L}\p{N}€]+|[^\p{L}\p{N}€]+$/gu, '').replace(/['’]s$/, '');
    if (first && /^\p{Lu}/u.test(first) && !known.has(first) && !isOrdinary(first)) {
      return {ok: false, reason: `it began a sentence with ${first}, which is not a player or card in this moment`};
    }
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/^[^\p{L}\p{N}€]+|[^\p{L}\p{N}€]+$/gu, '').replace(/['’]s$/, '');
      if (!w || !/^\p{Lu}/u.test(w)) continue;
      if (!known.has(w)) return {ok: false, reason: `it mentioned ${w}, which is not a player or card in this moment`};
    }
  }
  return {ok: true, text};
}

/** Ordinary words: common English plus every word in the game's own card texts ("lichen", "rovers"). */
const ORDINARY = new Set<string>(commonWords as string[]);
for (const pack of Object.values(CARD_PACKS)) {
  for (const c of pack) {
    for (const t of [c.description ?? '', ...c.text]) for (const w of t.toLowerCase().match(/\p{L}+/gu) ?? []) ORDINARY.add(w);
  }
}

/** An ordinary word, a simple plural of one ("viruses", "colonies"), or a hyphenated pair of them ("twenty-seven"). */
function isOrdinary(word: string): boolean {
  const w = word.toLowerCase();
  if (w.includes('-')) return w.split('-').every((part) => part.length > 0 && (part in NUMBER_WORDS || part in UNITS || isOrdinary(part)));
  if (ORDINARY.has(w)) return true;
  // English word endings that names almost never have ("hydrating", "hydration", "quietly")
  if (w.length >= 7 && /(ing|tion|sion|ment|ness|ly|ity|ize|ise|ized|ised)$/.test(w)) return true;
  if (w.endsWith('ies') && ORDINARY.has(`${w.slice(0, -3)}y`)) return true;
  if (w.endsWith('es') && ORDINARY.has(w.slice(0, -2))) return true;
  return w.endsWith('s') && ORDINARY.has(w.slice(0, -1));
}
