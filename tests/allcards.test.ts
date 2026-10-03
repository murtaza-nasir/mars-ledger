import {describe, expect, it} from 'vitest';
import {started} from './harness';
import {cardsFor} from '../src/shared/cards';
import {cardCost, cardVP, preview, suggestPayment, unmetRequirements} from '../src/shared/engine';
import {autoAnswer} from './harness';
import type {Answer} from '../src/shared/game';

// A rich mid-game position where every base + Corporate Era project card should be playable.
function rich() {
  const h = started('Beginner Corporation', 'Beginner Corporation');
  for (const id of ['a', 'b']) h.give(id, {megacredits: 200, steel: 20, titanium: 20, plants: 20, energy: 20, heat: 20},
    {megacredits: 5, steel: 3, titanium: 3, plants: 5, energy: 6, heat: 6});
  for (const c of ['Birds', 'Tardigrades', 'Physics Complex', 'Mine', 'Lichen', 'Heather', 'Grass', 'Geothermal Power',
    'Power Plant', 'Research', 'Gene Repair', 'Breathing Filters', 'Trans-Neptune Probe', 'Asteroid Mining', 'Io Mining Industries', 'Advanced Alloys']) h.place('a', c, 2);
  h.place('b', 'Fish', 2); h.place('b', 'Ants', 2);
  h.p('a').tiles.greenery = 1; h.p('a').tiles.cityOnMars = 1; h.p('b').tiles.cityOnMars = 1;
  h.p('a').handSize = 10;
  return h;
}

describe('every base and Corporate Era project card', () => {
  const cards = cardsFor(['base', 'corpera'], 'project');
  it('covers all 208 project cards', () => expect(cards.length).toBe(208));
  for (const card of cards) {
    it(card.name, () => {
      const h = rich();
      if (h.p('a').played.some((c) => c.name === card.name)) h.p('a').played = h.p('a').played.filter((c) => c.name !== card.name);
      // Satisfy global requirements by moving the parameters where the card wants them.
      for (const r of card.requirements) {
        for (const g of ['temperature', 'oxygen', 'oceans'] as const) if (r[g] !== undefined) h.s.global[g] = r[g]!;
      }
      expect(unmetRequirements(h.s, h.p('a'), card)).toEqual([]);
      const p = h.p('a');
      const payment = suggestPayment(p, cardCost(p, card), {steel: card.tags.includes('building'), titanium: card.tags.includes('space')});
      const answers: Answer[] = [];
      let r;
      for (let i = 0; i < 20; i++) {
        r = preview(h.s, {t: 'playCard', playerId: 'a', card: card.name, payment, answers});
        if (r.ok || 'error' in r) break;
        answers.push(autoAnswer(r.prompt));
      }
      expect(r && 'error' in r ? r.error : 'ok').toBe('ok');
      const after = r!.ok ? r!.state : h.s;
      expect(after.players[0].played.some((c) => c.name === card.name)).toBe(true);
      expect(Number.isFinite(cardVP(after, after.players[0], card))).toBe(true);
      // Any action it has must also resolve.
      if (card.action) {
        const s2 = structuredClone(after);
        s2.current = 'a'; s2.players[0].turnActions = 0;
        const act: Answer[] = [];
        let ra;
        for (let i = 0; i < 20; i++) {
          ra = preview(s2, {t: 'action', playerId: 'a', card: card.name, payment: {}, answers: act});
          if (ra.ok || 'error' in ra) break;
          act.push(autoAnswer(ra.prompt));
        }
        const allowed = ['There is no', 'has not gone up', 'Not enough resources on this card'];
        if (ra && 'error' in ra) expect(allowed.some((a) => ra!.error.includes(a))).toBe(true);
      }
    });
  }
});
