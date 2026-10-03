import {NARRATOR_LABEL} from '../../shared/narrator';
import {BOARDS} from '../../shared/board';
import type {GameEvent, GameState} from '../../shared/game';

const who = (s: GameState, id: string | null) => (id ? s.players.find((p) => p.id === id)?.name ?? 'Someone' : 'The table');

export function eventText(s: GameState, e: GameEvent): string | null {
  switch (e.kind) {
  case 'joined': return `${who(s, e.player)} joined`;
  case 'started': return 'The game began';
  case 'corp': return `${who(s, e.player)} founded ${e.corporation}`;
  case 'cardPlayed': return `${who(s, e.player)} played ${e.card}`;
  case 'action': return `${who(s, e.player)} used ${e.card}`;
  case 'standardProject': return `${who(s, e.player)} built ${e.project.toLowerCase()}`;
  case 'global': {
    const name = {temperature: 'Temperature', oxygen: 'Oxygen', oceans: 'Oceans', venus: 'Venus'}[e.param];
    const unit = e.param === 'temperature' ? '°C' : e.param === 'oxygen' ? '%' : '';
    return `${name} ${e.to}${unit}`;
  }
  case 'tr': return null;
  case 'tile': return `${who(s, e.player)} placed ${e.tile === 'ocean' ? 'an ocean' : `a ${e.tile}`}`;
  case 'attack': return `${who(s, e.player)} hit ${who(s, e.target)}: ${e.what}`;
  case 'milestone': return `${who(s, e.player)} claimed ${e.name}`;
  case 'award': return `${who(s, e.player)} funded ${e.name}`;
  case 'pass': return `${who(s, e.player)} passed`;
  case 'turn': return null;
  case 'production': return `Production, generation ${e.generation}`;
  case 'generation': return `Generation ${e.generation} begins`;
  case 'ended': return 'The game is over';
  case 'note': return e.text;
  case 'board': return e.random ? `A random map: ${BOARDS[e.board].title}` : `Playing on ${BOARDS[e.board].title}`;
  case 'narrator': return `${e.player ? who(s, e.player) : 'The table'} set mission control to ${NARRATOR_LABEL[e.mode].toLowerCase()}`;
  }
}
