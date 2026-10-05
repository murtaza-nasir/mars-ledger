// "Confirm card purchases": what a card question asks before it is sent, for a player who turned the setting on.
// Pure, so the wording and the cases that ask are tested without a screen.

/** The price of a card bought in research. */
export const CARD_PRICE = 3;

/** "Buy 3 cards for 9 M€?", "Buy 1 card for 3 M€?", "Buy nothing?". */
export function buyQuestion(n: number, cost: number): string {
  return n > 0 ? `Buy ${n} card${n === 1 ? '' : 's'} for ${cost} M€?` : 'Buy nothing?';
}

/** "Keep Birds and pass the rest?" for a draft pick. */
export function keepQuestion(card: string): string {
  return `Keep ${card} and pass the rest?`;
}

/**
 * The question to ask before a card question's answer is sent, or null when it is sent straight away: the setting is
 * off, or the question is neither a purchase (research, the initial buy) nor a draft pick. `picked`: the cards ticked.
 */
export function confirmFor(on: boolean, title: string, picked: string[], single: boolean, money?: number): {question: string; detail?: string} | null {
  if (!on) return null;
  if (/\bbuy\b/i.test(title)) {
    const cost = picked.length * CARD_PRICE;
    return {question: buyQuestion(picked.length, cost), detail: picked.length && money !== undefined ? `You will have ${money - cost} M€ left.` : undefined};
  }
  if (/keep and pass/i.test(title) && single && picked.length === 1) return {question: keepQuestion(picked[0])};
  return null;
}
