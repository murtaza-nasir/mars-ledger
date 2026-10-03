// Test harness: drives the pure engine the way the server does.
import {apply, cardCost, preview, suggestPayment, type Prompt} from '../src/shared/engine';
import {newGame} from '../src/shared/engine';
import {getCard} from '../src/shared/cards';
import type {Answer, Command, GameEvent, GameState, PlayerState} from '../src/shared/game';
import type {Units} from '../src/shared/types';

export class Harness {
  s: GameState;
  events: GameEvent[] = [];
  constructor(s?: GameState) { this.s = s ?? newGame('test'); }

  do(cmd: Command, answers?: Answer[]): GameEvent[] {
    const r = apply(this.s, cmd, answers);
    this.s = r.state;
    this.events = r.events;
    return r.events;
  }

  /** Apply a command, answering each prompt with `answer` (default: auto). Returns the prompts seen. */
  resolve(cmd: Command, answer: (p: Prompt) => Answer = autoAnswer): Prompt[] {
    const answers: Answer[] = [...('answers' in cmd ? cmd.answers : [])];
    const seen: Prompt[] = [];
    for (let i = 0; i < 30; i++) {
      const c = {...cmd, answers} as Command;
      const r = preview(this.s, c);
      if (r.ok) { this.s = r.state; this.events = r.events; return seen; }
      if ('error' in r) throw new Error(r.error);
      seen.push(r.prompt);
      answers.push(answer(r.prompt));
    }
    throw new Error('prompt loop did not finish');
  }

  p(id: string): PlayerState { return this.s.players.find((x) => x.id === id)!; }

  give(id: string, stock: Partial<Units> = {}, production: Partial<Units> = {}) {
    const p = this.p(id);
    for (const [k, v] of Object.entries(stock)) p.stock[k as keyof Units] += v!;
    for (const [k, v] of Object.entries(production)) p.production[k as keyof Units] += v!;
  }

  /** Put a card straight into play without paying or running it. */
  place(id: string, card: string, resources = 0) {
    getCard(card);
    this.p(id).played.push({name: card, resources, generation: this.s.generation});
  }

  /** Play a card paying the suggested default, auto-answering prompts. */
  play(id: string, card: string, answer?: (p: Prompt) => Answer): Prompt[] {
    const def = getCard(card);
    const p = this.p(id);
    const payment = suggestPayment(p, cardCost(p, def), {steel: def.tags.includes('building'), titanium: def.tags.includes('space')});
    return this.resolve({t: 'playCard', playerId: id, card, payment, answers: []}, answer);
  }

  /** Make it `id`'s turn with fresh actions. */
  turn(id: string) {
    this.s.phase = 'action';
    this.s.current = id;
    for (const p of this.s.players) { p.turnActions = 0; p.passed = false; }
  }
}

export function autoAnswer(p: Prompt): Answer {
  switch (p.kind) {
  case 'or': return {kind: 'or', index: 0};
  case 'player': return {kind: 'player', playerId: p.candidates.find((c) => c !== 'a') ?? p.candidates[0] ?? null};
  case 'card': return {kind: 'card', owner: p.candidates[0].owner, card: p.candidates[0].card};
  case 'tile': return {kind: 'tile', bonus: {}};
  case 'yesno': return {kind: 'yesno', yes: true};
  case 'resource': return {kind: 'resource', resource: 'plants'};
  case 'amount': return {kind: 'amount', value: p.max};
  case 'manual': return {kind: 'ack'};
  case 'pickCard': return {kind: 'pickCard', card: 'Donation'};
  }
}

/** Two players, corporations chosen, action phase, player a first. */
export function started(corpA = 'Beginner Corporation', corpB = 'Beginner Corporation', keptA = 0, keptB = 0): Harness {
  const h = new Harness();
  h.do({t: 'join', playerId: 'a', name: 'Ana', color: 'red'});
  h.do({t: 'join', playerId: 'b', name: 'Ben', color: 'blue'});
  h.do({t: 'start', playerId: 'a', modules: ['base', 'corpera'], order: ['a', 'b']});
  h.resolve({t: 'chooseCorp', playerId: 'a', corporation: corpA, cardsKept: keptA, answers: []});
  h.resolve({t: 'chooseCorp', playerId: 'b', corporation: corpB, cardsKept: keptB, answers: []});
  return h;
}
