// Smart hints: every hint must be provably true from the model, and absent when it is not.
import {describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {cardHint, companionHints, companionFacts, fullFacts, fullHints, tableauBonus, unusedCompanionActions} from '../src/shared/hints';
import type {ReqFacts} from '../src/shared/hints';
import {getCard} from '../src/shared/cards';
import type {CardModel, PlayerInputModel, PlayerViewModel} from '../src/shared/full';
import type {CardDef} from '../src/shared/types';
import {started} from './harness';
import {Store} from '../src/server/store';

const fixture = (): PlayerViewModel => JSON.parse(readFileSync('tests/fixtures/full/player-action.json', 'utf8'));

const opt = (title: string): PlayerInputModel => ({type: 'option', title, buttonLabel: 'OK'});
const menu = (...options: PlayerInputModel[]): PlayerInputModel => ({type: 'or', title: 'Take your next action', buttonLabel: 'Take action', options});
const milestoneMenu = (...names: string[]): PlayerInputModel => ({type: 'or', title: 'Claim a milestone', buttonLabel: 'Confirm', options: names.map(opt)});
const awardMenu = (cost: number, ...names: string[]): PlayerInputModel => ({type: 'or', buttonLabel: 'Confirm',
  title: {message: 'Fund an award (${0} M€)', data: [{type: 1, value: String(cost)}]}, options: names.map(opt)});
const plantsOpt = (n: number): PlayerInputModel => ({type: 'space', buttonLabel: 'Convert', spaces: ['30'],
  title: {message: 'Convert ${0} plants into greenery', data: [{type: 1, value: String(n)}]}});
const actionsOpt = (...names: string[]): PlayerInputModel => ({type: 'card', title: 'Perform an action from a played card', buttonLabel: 'Take action',
  cards: names.map((name) => ({name})), max: 1, min: 1, selectBlueCardAction: true, showOwner: false});

function withMenu(m: PlayerViewModel, ...options: PlayerInputModel[]): PlayerViewModel {
  return {...m, waitingFor: menu(...options, opt('Pass for this generation'))};
}

// ---- full mode: turn hints come only from what the engine offers --------------------------------
describe('full-mode turn hints', () => {
  it('claimable milestone: only when the engine offers it', () => {
    const m = fixture();
    m.game.milestones[0].scores[0].score = 35;
    const h = fullHints(withMenu(m, milestoneMenu('Terraformer')));
    expect(h.turn.map((x) => x.id)).toEqual(['milestone:Terraformer']);
    expect(h.turn[0].line).toBe('You can claim Terraformer (8 M€)');
    expect(h.turn[0].facts).toContain('You have 35 of 35.');
    expect(fullHints(withMenu(m)).turn).toEqual([]);
  });

  it('milestone slots exhausted: the engine stops offering it, so no hint', () => {
    const m = fixture();
    for (const x of m.game.milestones.slice(0, 3)) x.color = 'blue';
    expect(fullHints(withMenu(m)).turn.filter((x) => x.kind === 'milestone')).toEqual([]);
  });

  it('award: lead, shared lead, behind, zero, already funded', () => {
    const m = fixture();
    const set = (name: string, red: number, blue: number, funded = false) => {
      const a = m.game.awards.find((x) => x.name === name)!;
      a.scores = [{color: 'red', score: red}, {color: 'blue', score: blue}];
      if (funded) a.color = 'blue';
    };
    set('Landlord', 5, 2); set('Banker', 3, 3); set('Scientist', 1, 4); set('Thermalist', 0, 0); set('Miner', 9, 1, true);
    const h = fullHints(withMenu(m, awardMenu(14, 'Landlord', 'Banker', 'Scientist', 'Thermalist')));
    const awards = h.turn.filter((x) => x.kind === 'award');
    expect(awards.map((x) => x.line)).toEqual(['Landlord: you lead by 3', 'Banker: you share the lead']);
    expect(awards[0].facts).toContain('Funding it now costs 14 M€.');
    expect(awards.every((x) => !/will win/i.test(x.line + x.facts.join(' ')))).toBe(true);
  });

  it('award ties at zero and solo games give no award hint', () => {
    const m = fixture();
    for (const a of m.game.awards) a.scores = a.scores.map((s) => ({...s, score: 0}));
    expect(fullHints(withMenu(m, awardMenu(8, 'Landlord'))).turn).toEqual([]);
    const solo = fixture();
    solo.players = solo.players.filter((p) => p.color === 'red');
    solo.game.awards[0].scores = [{color: 'red', score: 4}];
    expect(fullHints(withMenu(solo, awardMenu(8, 'Landlord'))).turn).toEqual([]);
  });

  it('plants conversion: from the engine option, with its cost', () => {
    const m = fixture();
    m.thisPlayer.plants = 7;
    const h = fullHints(withMenu(m, plantsOpt(7)));
    expect(h.turn.map((x) => x.kind)).toEqual(['plants']);
    expect(h.turn[0].facts[0]).toBe('You have 7 plants; a greenery costs 7.');
  });

  it('heat: only while the temperature can still rise', () => {
    const m = fixture();
    m.thisPlayer.heat = 9;
    expect(fullHints(withMenu(m, opt('Convert 8 heat into temperature'))).turn.map((x) => x.kind)).toEqual(['heat']);
    m.game.temperature = 8;
    // the engine still offers the conversion at max temperature (with a warning); the hint must not
    expect(fullHints(withMenu(m, opt('Convert 8 heat into temperature'))).turn).toEqual([]);
  });

  it('unused card actions are listed and passed on for the Pass row', () => {
    const h = fullHints(withMenu(fixture(), actionsOpt('Birds', 'Predators')));
    expect(h.unusedActions).toEqual(['Birds', 'Predators']);
    expect(h.turn[0].line).toBe('2 card actions ready: Birds and Predators');
  });

  it('no turn hints outside the turn menu (follow-up questions, other players\' turns)', () => {
    const m = fixture();
    m.waitingFor = {type: 'space', title: 'Select space for ocean tile', buttonLabel: 'Save', spaces: ['04']};
    expect(fullHints(m).turn).toEqual([]);
    delete m.waitingFor;
    expect(fullHints(m).turn).toEqual([]);
  });
});

// ---- card badges: requirements compared with the board -------------------------------------------
const facts = (over: Partial<ReqFacts> = {}, tags: Record<string, number> = {}): ReqFacts => ({
  params: {temperature: -30, oxygen: 0, oceans: 0, venus: 0}, bonus: 0,
  tags: (t) => (tags[t] ?? 0) + (t === 'wild' ? 0 : tags.wild ?? 0), production: () => 0, greeneries: 0, tr: 20, ...over,
});
const at = (p: Partial<ReqFacts['params']>) => ({params: {temperature: -30, oxygen: 0, oceans: 0, venus: 0, ...p}});

describe('card badges', () => {
  const ants = getCard('Ants'); // requires 4% oxygen
  it('oxygen within 1–2 steps gets a badge; 3 steps does not; met gets none', () => {
    expect(cardHint(ants, facts(at({oxygen: 3})))?.badge).toBe('4% O₂ · 1 step to go');
    expect(cardHint(ants, facts(at({oxygen: 2})))?.badge).toBe('4% O₂ · 2 steps to go');
    expect(cardHint(ants, facts(at({oxygen: 1})))).toBeNull();
    expect(cardHint(ants, facts(at({oxygen: 4})))).toBeNull();
  });

  it('temperature counts 2 °C per step and applies the requirement bonus', () => {
    const lake = getCard('Artificial Lake'); // requires -6 °C
    expect(cardHint(lake, facts(at({temperature: -8})))?.badge).toBe('-6 °C · 1 step to go');
    expect(cardHint(lake, facts(at({temperature: -10})))?.badge).toBe('-6 °C · 2 steps to go');
    expect(cardHint(lake, facts(at({temperature: -12})))).toBeNull();
    // Adaptation Technology: 2 steps of tolerance, so -10 °C is enough and -12 °C is one step away
    expect(cardHint(lake, facts({...at({temperature: -10}), bonus: 2}))).toBeNull();
    const h = cardHint(lake, facts({...at({temperature: -14}), bonus: 2}));
    expect(h?.badge).toBe('-10 °C · 2 steps to go');
    expect(h?.facts.join(' ')).toContain('requirement bonus');
  });

  it('a maximum requirement that has been passed never gets a badge', () => {
    const archae = getCard('ArchaeBacteria'); // max -18 °C
    expect(cardHint(archae, facts(at({temperature: -16})))).toBeNull();
    expect(cardHint(archae, facts(at({temperature: -20})))).toBeNull(); // met
  });

  it('oceans', () => {
    expect(cardHint(getCard('Algae'), facts(at({oceans: 4})))?.badge).toBe('1 more ocean'); // requires 5
    expect(cardHint(getCard('Algae'), facts(at({oceans: 3})))?.badge).toBe('2 more oceans');
  });

  it('tags: one away gets a badge, wild tags count, two away does not', () => {
    const fusion = getCard('Fusion Power'); // 2 power tags
    expect(cardHint(fusion, facts({}, {power: 1}))?.badge).toBe('1 more power tag');
    expect(cardHint(fusion, facts({}, {power: 1, wild: 1}))).toBeNull();
    expect(cardHint(fusion, facts({}, {wild: 1}))?.badge).toBe('1 more power tag');
    expect(cardHint(fusion, facts({}, {}))).toBeNull();
  });

  it('two unmet requirements, unknown kinds and cards without requirements get nothing', () => {
    const eco = getCard('Advanced Ecosystems'); // plant, microbe and animal tag
    expect(cardHint(eco, facts({}, {plant: 1, microbe: 1}))?.badge).toBe('1 more animal tag');
    expect(cardHint(eco, facts({}, {plant: 1}))).toBeNull();
    expect(cardHint(getCard('Rad-Suits'), facts())).toBeNull(); // cities across all players: not provable here
    expect(cardHint(getCard('Comet'), facts())).toBeNull();
  });

  it('a production requirement must be met for any other badge', () => {
    const def: CardDef = {...getCard('Ants'), requirements: [{oxygen: 4, count: 4}, {production: 'titanium', count: 1}]};
    expect(cardHint(def, facts({...at({oxygen: 3}), production: () => 0}))).toBeNull();
    expect(cardHint(def, facts({...at({oxygen: 3}), production: () => 1}))?.badge).toBe('4% O₂ · 1 step to go');
  });

  it('full-mode facts: tableau bonus (Adaptation Technology, Inventrix, Special Design just played) and wild tags', () => {
    const t = (...names: string[]): CardModel[] => names.map((name) => ({name}));
    expect(tableauBonus(t('Teractor'))).toBe(0);
    expect(tableauBonus(t('Inventrix'))).toBe(2);
    expect(tableauBonus(t('Inventrix', 'Adaptation Technology'))).toBe(4);
    expect(tableauBonus(t('Teractor', 'Special Design'))).toBe(2);
    expect(tableauBonus(t('Teractor', 'Special Design', 'Comet'))).toBe(0);
    const m = fixture();
    (m.thisPlayer.tags as Record<string, number>).wild = 1;
    expect(fullFacts(m).tags('building')).toBe(3);
    expect(fullFacts(m).tags('wild')).toBe(1);
  });

  it('full-mode badges come from the hand and never from other players', () => {
    const m = fixture();
    m.game.oxygenLevel = 3;
    m.cardsInHand = [{name: 'Ants'}, {name: 'Comet'}];
    const h = fullHints(m);
    expect(h.cards.map((c) => c.card)).toEqual(['Ants']);
  });
});

// ---- companion mode ------------------------------------------------------------------------------
describe('companion hints', () => {
  it('only on your turn (plants also during final greeneries)', () => {
    const h = started('Ecoline');
    h.give('a', {plants: 10, heat: 10});
    h.turn('b');
    expect(companionHints(h.s, 'a').turn).toEqual([]);
    h.turn('a');
    const kinds = companionHints(h.s, 'a').turn.map((x) => x.kind);
    expect(kinds).toContain('plants');
    expect(kinds).toContain('heat');
    h.s.phase = 'finalGreenery'; h.s.current = null;
    expect(companionHints(h.s, 'a').turn.map((x) => x.kind)).toEqual(['plants']);
  });

  it('Ecoline converts at 7 plants; others need 8', () => {
    const h = started('Ecoline', 'Teractor');
    const ecoPlants = h.p('a').stock.plants;
    h.give('a', {plants: 7 - ecoPlants});
    h.give('b', {plants: 7});
    h.turn('a');
    expect(companionHints(h.s, 'a').turn.find((x) => x.kind === 'plants')?.facts[0]).toBe('You have 7 plants; a greenery costs 7.');
    h.turn('b');
    expect(companionHints(h.s, 'b').turn.find((x) => x.kind === 'plants')).toBeUndefined();
  });

  it('heat: not when the temperature is maxed', () => {
    const h = started();
    h.give('a', {heat: 8});
    h.turn('a');
    expect(companionHints(h.s, 'a').turn.map((x) => x.kind)).toContain('heat');
    h.s.global.temperature = 8;
    expect(companionHints(h.s, 'a').turn.map((x) => x.kind)).not.toContain('heat');
  });

  it('milestone: met, affordable, unclaimed, slots left; none once three are claimed', () => {
    const h = started();
    h.p('a').tr = 35;
    h.turn('a');
    expect(companionHints(h.s, 'a').turn.map((x) => x.id)).toContain('milestone:Terraformer');
    h.p('a').stock.megacredits = 7;
    expect(companionHints(h.s, 'a').turn.map((x) => x.id)).not.toContain('milestone:Terraformer');
    h.p('a').stock.megacredits = 50;
    h.s.milestones = [{name: 'Mayor', claimedBy: 'b'}, {name: 'Gardener', claimedBy: 'b'}, {name: 'Builder', claimedBy: 'b'}];
    expect(companionHints(h.s, 'a').turn.map((x) => x.kind)).not.toContain('milestone');
  });

  it('manual milestones (Planner: cards in hand) are never hinted', () => {
    const h = started();
    h.p('a').handSize = 20;
    h.turn('a');
    expect(companionHints(h.s, 'a').turn.map((x) => x.id)).not.toContain('milestone:Planner');
  });

  it('award: lead and ties; behind and positional awards never', () => {
    const h = started();
    h.p('a').production.megacredits = 5; h.p('b').production.megacredits = 2;
    h.p('a').stock.heat = 3; h.p('b').stock.heat = 3;
    h.turn('a');
    const lines = companionHints(h.s, 'a').turn.filter((x) => x.kind === 'award').map((x) => x.line);
    expect(lines).toContain('Banker: you lead by 3');
    expect(lines).toContain('Thermalist: you share the lead');
    expect(companionHints({...h.s, current: 'b'}, 'b').turn.filter((x) => x.line.startsWith('Banker'))).toEqual([]);
    const hellas = started();
    hellas.s.board = 'elysium';
    hellas.p('a').tiles.greenery = 3;
    hellas.turn('a');
    // Desert Settler and Estate Dealer depend on tile positions: no hint
    expect(companionHints(hellas.s, 'a').turn.map((x) => x.id).some((id) => /Desert Settler|Estate Dealer/.test(id))).toBe(false);
  });

  it('unused card actions this generation', () => {
    const h = started();
    h.place('a', 'Birds');
    h.place('a', 'Predators');
    h.turn('a');
    expect(unusedCompanionActions(h.p('a'))).toEqual(['Birds', 'Predators']);
    h.p('a').usedActions.push('Birds');
    expect(unusedCompanionActions(h.p('a'))).toEqual(['Predators']);
    expect(companionHints(h.s, 'a').turn.find((x) => x.kind === 'actions')?.line).toBe('1 card action not used yet: Predators');
  });

  it('companion requirement facts agree with the engine for a card one step away', () => {
    const h = started();
    h.s.global.oxygen = 3;
    expect(cardHint(getCard('Ants'), companionFacts(h.s, h.p('a'), 0))?.badge).toBe('4% O₂ · 1 step to go');
  });
});

// ---- the seat setting lives beside the game, never in its command log -----------------------------

describe('seat hint preference', () => {
  it('is stored per game and seat, outside the command log', () => {
    const store = new Store(mkdtempSync(path.join(tmpdir(), 'tm-hints-')));
    const game = store.currentGameId();
    expect(store.seatPrefs(game)).toEqual({});
    store.setSeatHints(game, 'seat-a', true);
    store.setSeatHints(game, 'seat-b', false);
    store.setSeatHints(game, 'seat-a', true);
    expect(store.seatPrefs(game)).toEqual({'seat-a': {hints: true}, 'seat-b': {hints: false}});
    expect(store.commands(game)).toEqual([]);
    const next = store.createGame();
    expect(store.seatPrefs(next)).toEqual({});
  });
});
