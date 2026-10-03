// A half-made selection survives another player's move. The phone keys its open question on the
// question's identity, and the server judges a stale answer by the seat's own question, never by the game's age.
// End to end: tests/full/selection.py.
import {describe, expect, it} from 'vitest';
import {ALREADY_SENT_TEXT, judgeInput, MOVED_ON_TEXT, questionIdentity, questionKey, sameQuestion, seenOf} from '../src/shared/sync';
import type {Seen} from '../src/shared/sync';

const card = (name: string, cost: number, isDisabled = false) => ({name, calculatedCost: cost, isDisabled, resources: 0});
const research = (cards = [card('Herbivores', 12), card('Fueled Generators', 1), card('Mine', 4), card('Moss', 4)]) =>
  ({type: 'card', title: 'Select card(s) to buy', buttonLabel: 'Buy', min: 0, max: 4, selectBlueCardAction: false, showOwner: false, cards});
const draft = (to: string, cards = [card('Moss', 4), card('Mine', 4), card('Trees', 13)]) =>
  ({type: 'card', title: {message: 'Select a card to keep and pass the rest to ${0}', data: [{type: 1, value: to}]}, buttonLabel: 'Keep',
    min: 1, max: 1, selectBlueCardAction: false, showOwner: false, cards});
const initial = (corps: string[], cards: string[]) => ({type: 'initialCards', title: ' ', buttonLabel: 'Start', options: [
  {type: 'card', title: 'Select corporation', buttonLabel: 'Save', min: 1, max: 1, cards: corps.map((c) => card(c, 0))},
  {type: 'card', title: 'Select initial cards to buy', buttonLabel: 'Save', min: 0, max: 10, cards: cards.map((c) => card(c, 3))}]});
const menu = (play: string[], undo = false) => ({type: 'or', title: 'Take your next action', buttonLabel: 'Take action', options: [
  {type: 'projectCard', title: 'Play project card', buttonLabel: 'Play card', cards: play.map((c) => card(c, 10)), paymentOptions: {}},
  {type: 'option', title: 'Pass for this generation', buttonLabel: 'Pass'},
  ...(undo ? [{type: 'option', title: 'Undo last action', buttonLabel: 'Undo'}] : [])]});

describe('questionIdentity', () => {
  it('is the same question when only the details the engine recomputes moved (costs, disabled cards, warnings, card order)', () => {
    const a = research();
    const b = {...research([card('Mine', 3), card('Moss', 5, true), card('Herbivores', 12), card('Fueled Generators', 1)]), warning: 'Not enough M€'};
    expect(questionKey(a)).not.toBe(questionKey(b));
    expect(questionIdentity(a)).toBe(questionIdentity(b));
    expect(questionIdentity(a)).toBe(questionIdentity(JSON.parse(JSON.stringify(a))));
    expect(questionIdentity(undefined)).toBe(questionIdentity(null));
  });
  it('is another question when the cards offered, the title, the type, the bounds or an option changed', () => {
    const id = questionIdentity(research());
    expect(questionIdentity(research([card('Herbivores', 12), card('Fueled Generators', 1), card('Mine', 4), card('Trees', 13)]))).not.toBe(id);
    expect(questionIdentity({...research(), title: 'Select card(s) to keep'})).not.toBe(id);
    expect(questionIdentity({...research(), type: 'projectCard'})).not.toBe(id);
    expect(questionIdentity({...research(), max: 2})).not.toBe(id);
    expect(questionIdentity(draft('Vera'))).not.toBe(questionIdentity(draft('Cleo')));
    expect(questionIdentity(draft('Vera'))).not.toBe(questionIdentity(draft('Vera', [card('Moss', 4), card('Mine', 4)])));
    expect(questionIdentity(initial(['Helion', 'Ecoline'], ['Mine']))).not.toBe(questionIdentity(initial(['Helion', 'Teractor'], ['Mine'])));
    expect(questionIdentity(initial(['Helion', 'Ecoline'], ['Mine']))).not.toBe(questionIdentity(initial(['Helion', 'Ecoline'], ['Moss'])));
    // a menu after an undo loses its Undo option: its indices shift, so it is another question
    expect(questionIdentity(menu(['Mine'], true))).not.toBe(questionIdentity(menu(['Mine'])));
    expect(questionIdentity(menu(['Mine']))).not.toBe(questionIdentity(menu(['Moss'])));
    expect(questionIdentity({type: 'space', title: 'Select space for ocean tile', spaces: ['03', '04']}))
      .not.toBe(questionIdentity({type: 'space', title: 'Select space for ocean tile', spaces: ['03']}));
    expect(questionIdentity({type: 'payment', title: 'Pay', amount: 6})).not.toBe(questionIdentity({type: 'payment', title: 'Pay', amount: 9}));
  });
  it('sameQuestion: the exact question, or the same by identity; an older phone without qi needs the exact one', () => {
    const before = research(); const after = research([card('Herbivores', 11), card('Fueled Generators', 1), card('Mine', 4), card('Moss', 4)]);
    const s = seenOf({age: 18, undo: 0, boot: 1, seq: 28}, {game: {gameAge: 18, undoCount: 0}, waitingFor: before})!;
    expect(sameQuestion(s, before)).toBe(true);
    expect(sameQuestion(s, after)).toBe(true);
    expect(sameQuestion({q: s.q}, after)).toBe(false);
    expect(sameQuestion(s, draft('Vera'))).toBe(false);
  });
});

describe('judgeInput compares the seat\'s own question, not the game\'s age', () => {
  const base = {playerId: 'm', isUndo: false, boot: 1, epoch: 0, lastUndo: null, ownAge: null, lastMove: null};
  const seenAt = (age: number, w: unknown, undo = 0, epoch = 0): Seen => seenOf({age, undo, boot: 1, seq: 1, epoch}, {game: {gameAge: age, undoCount: undo}, waitingFor: w})!;
  const fresh = (age: number, w: unknown, undo = 0) => ({game: {gameAge: age, undoCount: undo}, waitingFor: w});
  it('research: Vera and Cleo bought meanwhile (gameAge 18 -> 20) and the question is the same: accepted', () => {
    expect(judgeInput({...base, fresh: fresh(20, research()), seen: seenAt(18, research()), lastMove: {playerId: 'c', name: 'Cleo'}})).toEqual({ok: true});
  });
  it('research: the same question with a detail the engine recomputed (a card\'s cost): accepted by identity', () => {
    const now = research([card('Herbivores', 10), card('Fueled Generators', 1), card('Mine', 4), card('Moss', 4)]);
    expect(judgeInput({...base, fresh: fresh(20, now), seen: seenAt(18, research())})).toEqual({ok: true});
  });
  it('draft: the next pick (other cards, passed on) is another question: refused', () => {
    expect(judgeInput({...base, fresh: fresh(22, draft('Vera', [card('Trees', 13), card('Moss', 4)])), seen: seenAt(21, draft('Vera'))}))
      .toEqual({ok: false, code: 'stale', error: MOVED_ON_TEXT});
  });
  it('an undo still refuses, even when the question came back the same', () => {
    expect(judgeInput({...base, fresh: fresh(12, research(), 1), seen: seenAt(14, research(), 0)})).toMatchObject({ok: false, code: 'stale'});
    expect(judgeInput({...base, epoch: 1, lastUndo: {epoch: 1, name: 'Ana'}, fresh: fresh(14, research()), seen: seenAt(14, research())}))
      .toMatchObject({ok: false, code: 'stale'});
  });
  it('a double tap is still refused when the next question looks the same (its view predates the seat\'s own answer)', () => {
    expect(judgeInput({...base, ownAge: 31, fresh: fresh(31, menu(['Mine'])), seen: seenAt(30, menu(['Mine']))}))
      .toEqual({ok: false, code: 'stale', error: ALREADY_SENT_TEXT});
  });
});
