// Prelude expansion in the companion engine: setup, the prelude phase, every prelude card, and the
// prelude-module corporations and project cards.
import {describe, expect, it} from 'vitest';
import {autoAnswer, Harness} from './harness';
import {cardsFor, getCard} from '../src/shared/cards';
import {cardCost, preview, suggestPayment, unmetRequirements, type Prompt} from '../src/shared/engine';
import type {Answer} from '../src/shared/game';
import {RESOURCES} from '../src/shared/types';
import type {Resource} from '../src/shared/types';

/** Two players at the prelude phase: Ana keeps `a`, Ben keeps `b`. */
function atPreludes(a: [string, string], b: [string, string] = ['Mohole', 'Supplier'],
  corpA = 'Beginner Corporation', corpB = 'Beginner Corporation'): Harness {
  const h = new Harness();
  h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
  h.do({t: 'join', playerId: 'b', name: 'Ben', color: 'blue'});
  h.do({t: 'setPrelude', playerId: 'a', on: true});
  h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b']});
  h.resolve({t: 'chooseCorp', playerId: 'a', corporation: corpA, cardsKept: 0, answers: [], preludes: a});
  h.resolve({t: 'chooseCorp', playerId: 'b', corporation: corpB, cardsKept: 0, answers: [], preludes: b});
  return h;
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

describe('prelude setup', () => {
  it('Prelude in the lobby adds the module at start', () => {
    const h = atPreludes(['Allied Bank', 'Biofuels']);
    expect(h.s.modules).toContain('prelude');
    expect(h.s.phase).toBe('preludes');
    expect(h.s.current).toBe('a');
  });

  it('without Prelude the module is not dealt and setup goes straight to actions', () => {
    const h = new Harness();
    h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
    h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a']});
    expect(h.s.modules).not.toContain('prelude');
    h.resolve({t: 'chooseCorp', playerId: 'a', corporation: 'Beginner Corporation', cardsKept: 0, answers: [], preludes: ['Donation', 'Loan']});
    expect(h.s.phase).toBe('action');
    expect(h.p('a').preludes).toBeUndefined();
  });

  it('each player must keep exactly two different preludes of this game', () => {
    const h = new Harness();
    h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
    h.do({t: 'join', playerId: 'b', name: 'Ben', color: 'blue'});
    h.do({t: 'setPrelude', playerId: 'a', on: true});
    h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b']});
    const base = {t: 'chooseCorp' as const, playerId: 'a', corporation: 'Beginner Corporation', cardsKept: 0, answers: []};
    expect(preview(h.s, base)).toMatchObject({ok: false, error: 'Choose the two preludes you keep'});
    expect(preview(h.s, {...base, preludes: ['Donation', 'Donation']})).toMatchObject({ok: false, error: 'Choose the two preludes you keep'});
    expect(preview(h.s, {...base, preludes: ['Donation', 'Birds']})).toMatchObject({ok: false});
    h.resolve({...base, preludes: ['Donation', 'Loan']});
    expect(preview(h.s, {...base, playerId: 'b', preludes: ['Loan', 'Mohole']})).toMatchObject({ok: false, error: 'Loan is already kept by another player'});
  });

  it('preludes are played in turn order, then the first action round begins with the first player', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier']);
    expect(preview(h.s, {t: 'playPrelude', playerId: 'b', card: 'Mohole', answers: []})).toMatchObject({ok: false});
    expect(preview(h.s, {t: 'playCard', playerId: 'a', card: 'Birds', payment: {}, answers: []})).toMatchObject({ok: false});
    h.resolve({t: 'playPrelude', playerId: 'a', card: 'Donation', answers: []});
    expect(h.s.current).toBe('a');
    expect(preview(h.s, {t: 'playPrelude', playerId: 'a', card: 'Donation', answers: []})).toMatchObject({ok: false});
    h.resolve({t: 'playPrelude', playerId: 'a', card: 'Loan', answers: []});
    expect(h.s.current).toBe('b');
    h.resolve({t: 'playPrelude', playerId: 'b', card: 'Supplier', answers: []});
    h.resolve({t: 'playPrelude', playerId: 'b', card: 'Mohole', answers: []});
    expect(h.s.phase).toBe('action');
    expect(h.s.current).toBe('a');
    expect(h.events.some((e) => e.kind === 'turn' && e.player === 'a')).toBe(true);
    // Beginner Corporation 42 + Donation 21 + Loan 30 = 93 M€, M€ production -2
    expect(h.p('a').stock.megacredits).toBe(93);
    expect(h.p('a').production.megacredits).toBe(-2);
    // preludes are on the table and their tags count
    expect(h.p('b').played.map((c) => c.name)).toEqual(['Supplier', 'Mohole']);
  });
});

describe('every prelude card', () => {
  const preludes = cardsFor(['prelude'], 'prelude');
  it('covers all 35 preludes', () => expect(preludes.length).toBe(35));
  for (const card of preludes) {
    it(card.name, () => {
      const other = card.name === 'Donation' ? 'Loan' : 'Donation';
      const ben = ['Mohole', 'Supplier', 'Biofuels', 'Metals Company'].filter((n) => n !== card.name).slice(0, 2) as [string, string];
      const h = atPreludes([card.name, other], ben);
      const before = structuredClone(h.p('a'));
      const globalBefore = {...h.s.global};
      const seen: Prompt[] = h.resolve({t: 'playPrelude', playerId: 'a', card: card.name, answers: []});
      const a = h.p('a');
      expect(a.played.map((c) => c.name)).toContain(card.name);
      const b = card.behavior ?? {};
      for (const r of RESOURCES as readonly Resource[]) {
        const prod = num(b.production?.[r]) + (r === 'heat' && globalBefore.temperature < -24 && h.s.global.temperature >= -24 ? 1 : 0)
          + (r === 'heat' && globalBefore.temperature < -20 && h.s.global.temperature >= -20 ? 1 : 0);
        expect(a.production[r] - before.production[r], `${r} production`).toBe(prod);
        // Stock changes: the card's own stock, minus a printed cost; tile placement bonuses are 0 under autoAnswer.
        const stock = num(b.stock?.[r]) - num(b.spend?.[r]);
        expect(a.stock[r] - before.stock[r], `${r} stock`).toBe(stock);
      }
      const tr = num(b.tr) + (h.s.global.oceans - globalBefore.oceans)
        + (h.s.global.temperature - globalBefore.temperature) / 2 + (h.s.global.oxygen - globalBefore.oxygen);
      expect(a.tr - before.tr, 'TR').toBe(tr);
      if (b.global?.temperature) expect(h.s.global.temperature - globalBefore.temperature).toBe(2 * b.global.temperature);
      if (b.global?.oxygen) expect(h.s.global.oxygen - globalBefore.oxygen).toBe(b.global.oxygen);
      if (b.ocean) expect(h.s.global.oceans - globalBefore.oceans).toBe(b.ocean.count ?? 1);
      if (b.city) expect(a.tiles.cityOnMars - before.tiles.cityOnMars).toBe(1);
      if (b.greenery) expect(a.tiles.greenery - before.tiles.greenery).toBe(1);
      if (b.drawCard) expect(a.handSize).toBeGreaterThan(before.handSize);
      // A tile prompt for every tile it places, nothing else unexpected.
      for (const pr of seen) expect(['tile', 'manual']).toContain(pr.kind);
    });
  }
});

describe('preludes that play a card from hand', () => {
  it('Eccentric Sponsor: the next card costs 25 M€ less and is part of the prelude, not an action', () => {
    const h = atPreludes(['Eccentric Sponsor', 'Donation']);
    h.p('a').handSize = 3;
    h.resolve({t: 'playPrelude', playerId: 'a', card: 'Eccentric Sponsor', answers: []});
    expect(h.p('a').preludeCardPlay).toBeTruthy();
    expect(preview(h.s, {t: 'playPrelude', playerId: 'a', card: 'Donation', answers: []})).toMatchObject({ok: false});
    const card = getCard('Methane From Titan'); // 28 M€, requires 2% oxygen
    h.s.global.oxygen = 2;
    expect(cardCost(h.p('a'), card)).toBe(3);
    const mc = h.p('a').stock.megacredits;
    h.resolve({t: 'playCard', playerId: 'a', card: card.name, payment: {megacredits: 3}, answers: []});
    expect(h.p('a').stock.megacredits).toBe(mc - 3);
    expect(h.p('a').turnActions).toBe(0);
    expect(h.p('a').nextCardDiscount).toBe(0);
    expect(h.s.phase).toBe('preludes');
    expect(h.s.current).toBe('a'); // Donation still to play
  });

  it('a prelude card can be skipped, and the one-shot bonus goes with it', () => {
    const h = atPreludes(['Eccentric Sponsor', 'Donation']);
    h.resolve({t: 'playPrelude', playerId: 'a', card: 'Eccentric Sponsor', answers: []});
    h.do({t: 'skipPreludeCard', playerId: 'a'});
    expect(h.p('a').preludeCardPlay).toBeNull();
    expect(h.p('a').nextCardDiscount).toBe(0);
    h.resolve({t: 'playPrelude', playerId: 'a', card: 'Donation', answers: []});
    expect(h.s.current).toBe('b');
  });

  it('Ecology Experts: the card ignores global requirements', () => {
    const h = atPreludes(['Ecology Experts', 'Donation']);
    h.resolve({t: 'playPrelude', playerId: 'a', card: 'Ecology Experts', answers: []});
    const lichen = getCard('Lichen'); // requires -24 °C
    expect(unmetRequirements(h.s, h.p('a'), lichen)).toEqual([]);
    h.resolve({t: 'playCard', playerId: 'a', card: 'Lichen', payment: {megacredits: 7}, answers: []});
    expect(h.p('a').played.map((c) => c.name)).toContain('Lichen');
    expect(h.p('a').nextCardRequirementBonus).toBe(0);
    expect(unmetRequirements(h.s, h.p('a'), getCard('Fish'))).not.toEqual([]);
  });
});

describe('prelude-module corporations', () => {
  it('Valley Trust: first action plays a prelude drawn from the deck; science cards cost 2 less', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier'], 'Valley Trust');
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    // Research has two science tags: the discount applies per tag, as in the engine (11 - 2 x 2).
    expect(cardCost(h.p('a'), getCard('Research'))).toBe(7);
    const seen = h.resolve({t: 'action', playerId: 'a', card: 'Valley Trust', payment: {}, answers: []},
      (p) => (p.kind === 'pickCard' ? {kind: 'pickCard', card: 'Allied Bank'} : autoAnswer(p)));
    expect(seen[0]).toMatchObject({kind: 'pickCard', group: 'prelude'});
    expect((seen[0] as Extract<Prompt, {kind: 'pickCard'}>).exclude).toEqual(expect.arrayContaining(['Donation', 'Mohole']));
    expect(h.p('a').played.map((c) => c.name)).toContain('Allied Bank');
    expect(h.p('a').production.megacredits).toBe(-2 + 4);
    expect(h.p('a').turnActions).toBe(1);
    // A prelude already in play cannot be drawn again.
    const h2 = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier'], 'Valley Trust');
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h2.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    expect(preview(h2.s, {t: 'action', playerId: 'a', card: 'Valley Trust', payment: {}, answers: [{kind: 'pickCard', card: 'Mohole'}]}))
      .toMatchObject({ok: false, error: 'Mohole is already in play'});
  });

  it('Valley Trust drawing Eccentric Sponsor: the action finishes with the card it allows', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier'], 'Valley Trust');
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    h.resolve({t: 'action', playerId: 'a', card: 'Valley Trust', payment: {}, answers: [{kind: 'pickCard', card: 'Eccentric Sponsor'}]});
    expect(h.p('a').turnActions).toBe(0);
    expect(h.p('a').preludeCardPlay).toBeTruthy();
    h.resolve({t: 'playCard', playerId: 'a', card: 'Mine', payment: {megacredits: 0}, answers: []});
    expect(h.p('a').turnActions).toBe(1);
  });

  it('Vitor: first action funds an award for free; +3 M€ for cards with victory points', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier'], 'Vitor');
    expect(h.p('a').stock.megacredits).toBe(48);
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    const mc = h.p('a').stock.megacredits;
    h.resolve({t: 'action', playerId: 'a', card: 'Vitor', payment: {}, answers: [{kind: 'or', index: 1}]});
    expect(h.s.awards).toEqual([{name: 'Banker', fundedBy: 'a'}]);
    expect(h.p('a').stock.megacredits).toBe(mc);
    // Dust Seals has 1 VP: Vitor pays 3 M€ back. Mine (no VP) does not.
    h.s.global.oceans = 0;
    const before = h.p('a').stock.megacredits;
    h.resolve({t: 'playCard', playerId: 'a', card: 'Dust Seals', payment: {megacredits: 2}, answers: []});
    expect(h.p('a').stock.megacredits).toBe(before - 2 + 3);
    h.s.current = 'a'; h.p('a').turnActions = 0;
    const b2 = h.p('a').stock.megacredits;
    h.resolve({t: 'playCard', playerId: 'a', card: 'Mine', payment: {megacredits: 4}, answers: []});
    expect(h.p('a').stock.megacredits).toBe(b2 - 4);
  });

  it('Robinson Industries: 4 M€ raises one of the lowest productions', () => {
    const h = atPreludes(['Donation', 'Mohole'], ['Biofuels', 'Supplier'], 'Robinson Industries');
    for (const [id, c] of [['a', 'Donation'], ['a', 'Mohole'], ['b', 'Biofuels'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    // productions: M€ 0, steel 0, titanium 0, plants 0, energy 0, heat 3: a choice between five lowest
    const seen = h.resolve({t: 'action', playerId: 'a', card: 'Robinson Industries', payment: {}, answers: []},
      (p) => (p.kind === 'resource' ? {kind: 'resource', resource: 'titanium'} : autoAnswer(p)));
    expect(seen[0]).toMatchObject({kind: 'resource'});
    expect((seen[0] as Extract<Prompt, {kind: 'resource'}>).options).not.toContain('heat');
    expect(h.p('a').production.titanium).toBe(1);
    expect(preview(h.s, {t: 'action', playerId: 'a', card: 'Robinson Industries', payment: {}, answers: []})).toMatchObject({ok: false});
  });

  it('Point Luna draws for its own Earth tag and for every Earth tag played', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier'], 'Point Luna');
    expect(h.p('a').handSize).toBe(1);
    expect(h.p('a').production.titanium).toBe(1);
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    // Space Hotels has an Earth tag: it leaves the hand (−1) and draws one through Point Luna (+1).
    h.resolve({t: 'playCard', playerId: 'a', card: 'Space Hotels', payment: {megacredits: 12}, answers: []});
    expect(h.p('a').handSize).toBe(1);
    expect(h.events.some((e) => e.kind === 'note' && e.text.startsWith('Point Luna'))).toBe(true);
  });

  it('Cheung Shing MARS: building cards cost 2 less', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier'], 'Cheung Shing MARS');
    expect(cardCost(h.p('a'), getCard('Mine'))).toBe(4 - 2);
    expect(h.p('a').production.megacredits).toBe(3);
  });
});

describe('prelude-module project cards', () => {
  it('Psychrophiles: microbes pay 2 M€ each for plant cards only', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier']);
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    h.place('a', 'Psychrophiles', 3);
    const lichen = getCard('Lichen'); // 7 M€, plant tag, requires -24 °C
    h.s.global.temperature = -24;
    const mc = h.p('a').stock.megacredits;
    h.resolve({t: 'playCard', playerId: 'a', card: 'Lichen', payment: {megacredits: 1, cardResources: 3}, answers: []});
    expect(h.p('a').stock.megacredits).toBe(mc - 1);
    expect(h.p('a').played.find((c) => c.name === 'Psychrophiles')!.resources).toBe(0);
    expect(cardCost(h.p('a'), lichen)).toBe(7);
    h.s.current = 'a'; h.p('a').turnActions = 0;
    h.p('a').played.find((c) => c.name === 'Psychrophiles')!.resources = 2;
    expect(preview(h.s, {t: 'playCard', playerId: 'a', card: 'Mine', payment: {megacredits: 0, cardResources: 2}, answers: []}))
      .toMatchObject({ok: false, error: 'No card resources can pay for this card'});
  });

  it('Research Coordination: its wild tag counts toward tag requirements', () => {
    const h = atPreludes(['Donation', 'Loan']);
    const spaceHotels = getCard('Space Hotels'); // 2 Earth tags
    h.place('a', 'Research Coordination');
    h.place('a', 'Earth Office');
    expect(unmetRequirements(h.s, h.p('a'), spaceHotels)).toEqual([]);
  });

  it('Lava Tube Settlement asks for a city on a volcanic area', () => {
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier']);
    for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
    h.give('a', {}, {energy: 1});
    const p = h.p('a');
    const card = getCard('Lava Tube Settlement');
    const payment = suggestPayment(p, cardCost(p, card), {steel: true, titanium: false});
    const seen = h.resolve({t: 'playCard', playerId: 'a', card: card.name, payment, answers: []});
    expect(seen[0]).toMatchObject({kind: 'tile', tile: 'city', title: 'Place a city tile on a volcanic area'});
    expect(h.p('a').production.megacredits).toBe(-2 + 2);
  });

  it('every prelude-module project card can be played', () => {
    for (const card of cardsFor(['prelude'], 'project')) {
      const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier']);
      for (const [id, c] of [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']]) h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
      h.give('a', {megacredits: 100, steel: 10}, {energy: 2});
      h.place('a', 'Earth Office'); h.place('a', 'Sponsors');
      for (const r of card.requirements) for (const g of ['temperature', 'oxygen', 'oceans'] as const) if (r[g] !== undefined) h.s.global[g] = r[g]!;
      expect(unmetRequirements(h.s, h.p('a'), card), card.name).toEqual([]);
      const answers: Answer[] = [];
      const p = h.p('a');
      const payment = suggestPayment(p, cardCost(p, card), {steel: card.tags.includes('building'), titanium: card.tags.includes('space')});
      let r;
      for (let i = 0; i < 10; i++) {
        r = preview(h.s, {t: 'playCard', playerId: 'a', card: card.name, payment, answers});
        if (r.ok || 'error' in r) break;
        answers.push(autoAnswer(r.prompt));
      }
      expect(r && 'error' in r ? `${card.name}: ${r.error}` : 'ok').toBe('ok');
    }
  });
});

describe('mission control and the prelude openings', () => {
  it('companion: one opening line when the last prelude is played', async () => {
    const {detectCompanion, newMemory, primeCompanion} = await import('../src/server/narrator/detect');
    const h = atPreludes(['Donation', 'Loan'], ['Mohole', 'Supplier']);
    const mem = newMemory(h.s.id); primeCompanion(mem, h.s);
    const steps: Array<[string, string]> = [['a', 'Donation'], ['a', 'Loan'], ['b', 'Mohole'], ['b', 'Supplier']];
    const lines = [];
    for (const [id, c] of steps) {
      const before = structuredClone(h.s);
      h.resolve({t: 'playPrelude', playerId: id, card: c, answers: []});
      const tick = {seq: h.s.seq, at: 0, command: {t: 'playPrelude' as const, playerId: id, card: c, answers: []}, events: h.events};
      lines.push(...detectCompanion(mem, before, tick, h.s, [], 1000));
    }
    const opening = lines.filter((e) => e.kind === 'preludes');
    expect(opening).toHaveLength(1);
    expect(opening[0].facts).toEqual(['Ana opened with Donation and Loan.', 'Ben opened with Mohole and Supplier.']);
    expect(opening[0].cards).toEqual(['Donation', 'Loan', 'Mohole', 'Supplier']);
  });

  it('full: the opening line fires when the engine leaves the preludes phase', async () => {
    const {detectFull, newMemory} = await import('../src/server/narrator/detect');
    const p = (color: 'red' | 'blue', name: string, cards: string[]) => ({color, name, tableau: cards.map((n) => ({name: n})), megacredits: 0,
      megacreditProduction: 0, steel: 0, steelProduction: 0, titanium: 0, titaniumProduction: 0, plants: 0, plantProduction: 0, energy: 0,
      energyProduction: 0, heat: 0, heatProduction: 0, terraformRating: 20, isActive: false, actionsThisGeneration: []});
    const model = (phase: string, a: string[], b: string[]) => ({id: 's', color: 'neutral' as const,
      game: {gameAge: phase === 'preludes' ? 5 : 6, undoCount: 0, generation: 1, phase, temperature: -30, oxygenLevel: 0, oceans: 0,
        venusScaleLevel: 0, isTerraformed: false, spaces: [], passedPlayers: [], milestones: [], awards: [], deckSize: 100},
      players: [p('red', 'Ana', a), p('blue', 'Ben', b)]});
    const mem = newMemory('g');
    const before = model('preludes', ['Helion', 'Donation', 'Loan'], ['Ecoline', 'Mohole']);
    detectFull(mem, null, before as never, null, 0);
    const out = detectFull(mem, before as never, model('action', ['Helion', 'Donation', 'Loan'], ['Ecoline', 'Mohole', 'Supplier']) as never, null, 1000);
    const opening = out.find((e) => e.kind === 'preludes');
    expect(opening?.facts).toEqual(['Ana opened with Donation and Loan.', 'Ben opened with Mohole and Supplier.']);
  });
});
