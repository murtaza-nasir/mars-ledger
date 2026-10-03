// The short line a card row shows under the name: what the card does, from its own text, without the requirement
// sentence (the requirement shows as a chip beside it). Pure helpers, so the wording is tested without a browser.
import type {CardDef, Requirement, Tag} from '../../../shared/types';

/** One requirement as a chip: plain text, or a tag icon with a count. */
export type ReqChip = {kind: 'text'; text: string} | {kind: 'tag'; tag: Tag; count: number; max?: boolean};

const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);
const signedPlus = (n: number) => (n > 0 ? `+${n}` : signed(n));

/** The compact requirement labels the card face uses ("max 5% O₂", "3 oceans", "−24°C"), so a row reads like the card. */
export function reqChips(card: CardDef): ReqChip[] {
  return card.requirements.map(reqChip).filter((x): x is ReqChip => x !== null);
}

function reqChip(r: Requirement): ReqChip | null {
  const pre = r.max ? 'max ' : '';
  if (r.temperature !== undefined) return {kind: 'text', text: `${pre}${signedPlus(r.temperature)}°C`};
  if (r.oxygen !== undefined) return {kind: 'text', text: `${pre}${r.oxygen}% O₂`};
  if (r.oceans !== undefined) return {kind: 'text', text: `${pre}${r.oceans} ocean${r.oceans === 1 ? '' : 's'}`};
  if (r.venus !== undefined) return {kind: 'text', text: `${pre}${r.venus}% Venus`};
  if (r.tag) return {kind: 'tag', tag: r.tag, count: r.count ?? 1, max: r.max};
  if (r.production) return {kind: 'text', text: `${r.production} production`};
  if (r.greeneries !== undefined) return {kind: 'text', text: `${pre}${r.greeneries} ${r.greeneries === 1 ? 'greenery' : 'greeneries'}`};
  if (r.cities !== undefined) return {kind: 'text', text: `${pre}${r.cities} ${r.cities === 1 ? 'city' : 'cities'}`};
  if (r.tr !== undefined) return {kind: 'text', text: `TR ${r.tr}`};
  return null;
}

/** "Requires 4 ocean tiles.", "Oxygen must be 5% or less.", "It must be −12 C or colder to play.": the chip says it already. */
const REQ_SENTENCE = /^(requires\b|(it|oxygen|temperature|venus) must be\b)/i;

/** A requirement sentence that also asks something of the player keeps that part: "Requires 2 ocean tiles and that
 *  you lose 3 plants." becomes "Lose 3 plants." */
function withoutRequirement(s: string): string | null {
  if (!REQ_SENTENCE.test(s)) return s;
  const m = /\band that you (.+)$/i.exec(s);
  if (m && !/^have\b/i.test(m[1])) return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return null;
}

/** The icon caption some cards repeat under their effect ("Global requirements +/- 2"). */
const ICON_CAPTION = /^(global requirements( \+\/-\s*\d+)?|\+\/-\s*\d+)\.?$/i;
/** Place names keep their capital when a shouted phrase goes to lower case. */
const lower = (m: string) => m.toLowerCase().replace(/\b(mars|earth|venus|jovian)\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

/** Sentences of one text, with wrapping brackets dropped ("(Requires 9% oxygen. Gain 2 heat.)"),
 *  shouted words in lower case ("ON MARS") and a full stop where the card leaves it out. */
function sentences(t: string): string[] {
  const plain = t.trim().replace(/^\((.*)\)$/s, '$1').replace(/\s+/g, ' ')
    .replace(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/g, lower);
  return (plain.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((s) => s.trim()).filter((s) => s && !ICON_CAPTION.test(s))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
}

/** The parts of the summary in reading order: the action or effect first (that is what a blue card is for), then what
 *  happens when it is played, then everything else (victory points per resource and the like). */
export function summaryParts(card: CardDef): {lead: string | null; text: string}[] {
  const ae = card.text.filter((t) => /^(Action|Effect)\s*:/i.test(t.trim()));
  const rest = card.text.filter((t) => !/^(Action|Effect)\s*:/i.test(t.trim()));
  const out: {lead: string | null; text: string}[] = [];
  for (const t of ae) {
    const m = /^(Action|Effect)\s*:\s*(.*)$/is.exec(t.trim())!;
    const body = sentences(m[2]).map(withoutRequirement).filter(Boolean).join(' ');
    if (body) out.push({lead: `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()}:`, text: body});
  }
  const plain = [card.description ?? '', ...rest].flatMap(sentences).map(withoutRequirement).filter((s): s is string => !!s);
  // the same sentence on the card twice (in the description and again in the text) shows once
  const seen = new Set<string>();
  const kept = plain.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (kept.length) out.push({lead: null, text: kept.join(' ')});
  return out;
}

/** The whole summary as one string (for labels and tests). */
export function cardSummary(card: CardDef): string {
  return summaryParts(card).map((p) => (p.lead ? `${p.lead} ${p.text}` : p.text)).join(' ');
}

/** Fixed victory points as a chip ("2 VP", "−1 VP"); points that depend on resources or tags stay in the text. */
export function vpChip(card: CardDef): string | null {
  const vp = card.victoryPoints;
  return typeof vp === 'number' && vp !== 0 ? `${signed(vp)} VP` : null;
}
