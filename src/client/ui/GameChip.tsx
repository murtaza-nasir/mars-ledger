// A small chip naming the game. Tap it for the game's details: mode, map, options, when it started, the
// generation, who is playing in turn order, and the game id in small print (to point at a game when
// something needs looking into). No QR code: nobody can join a game in progress.
import {useEffect, useState} from 'react';
import {BOARDS} from '../../shared/board';
import {TURN_CLOCK_LABEL} from '../../shared/clock';
import {PLAYER_HEX} from '../../shared/game';
import type {GameState} from '../../shared/game';
import {NARRATOR_LABEL} from '../../shared/narrator';
import {Sheet} from './Sheet';

export type ChipSeat = {name: string; color: string; corporation?: string | null};

export function gameTitle(state: GameState): string {
  return state.title ?? state.full?.name ?? 'This game';
}

export function GameChip({state, generation, seats}: {state: GameState; generation: number; seats: ChipSeat[]}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="game-chip" onClick={() => setOpen(true)} aria-label={`Game details: ${gameTitle(state)}`}
        style={{display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0, minHeight: 24, padding: '2px 10px 2px 8px', borderRadius: 999,
          background: 'rgba(255,255,255,.07)', boxShadow: 'inset 0 0 0 1px var(--rim)', fontSize: 12.5, fontWeight: 600, color: 'var(--ice-dim)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{flex: 'none'}}>
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 5.4v3.2M6 3.4v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span style={{overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0}}>{gameTitle(state)}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={gameTitle(state)}>
        <GameDetails state={state} generation={generation} seats={seats} />
      </Sheet>
    </>
  );
}

function since(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function GameDetails({state, generation, seats}: {state: GameState; generation: number; seats: ChipSeat[]}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const full = state.mode === 'full';
  const options = [
    state.prelude ? 'Prelude' : null,
    full ? (state.draft === false ? 'No draft' : 'Draft') : null,
    full && state.fastMode ? 'Fast mode' : null,
    state.turnClock && state.turnClock !== 'off' ? `Turn clock: ${TURN_CLOCK_LABEL[state.turnClock]}` : null,
    state.narrator && state.narrator !== 'off' ? `Mission control: ${NARRATOR_LABEL[state.narrator]}` : null,
  ].filter(Boolean) as string[];
  const started = state.startedAt ? new Date(state.startedAt) : null;
  const end = state.endedAt ?? now;
  const row = (label: string, value: React.ReactNode) => (
    <div style={{display: 'flex', gap: 12, padding: '9px 0', borderTop: '1px solid var(--rim)'}}>
      <span className="muted" style={{width: 110, flex: 'none', fontSize: 14.5}}>{label}</span>
      <span style={{flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 15.5}}>{value}</span>
    </div>
  );
  return (
    <div data-testid="game-details">
      {row('Mode', full ? 'Full game' : 'Companion')}
      {row('Map', BOARDS[state.board ?? 'tharsis'].title)}
      {row('Options', options.length ? options.join(' · ') : 'None')}
      {row('Started', started ? `${started.toLocaleString(undefined, {weekday: 'short', hour: '2-digit', minute: '2-digit'})} · ${since(end - started.getTime())}${state.endedAt ? ' in all' : ' ago'}` : 'Not yet')}
      {row('Generation', generation)}
      {row('Players', (
        <ol style={{listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6}}>
          {seats.map((p, i) => (
            <li key={p.name + i} style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <span className="num faint" style={{width: 14, fontSize: 13}}>{i + 1}</span>
              <span aria-hidden="true" style={{width: 10, height: 10, borderRadius: 3, background: PLAYER_HEX[p.color as keyof typeof PLAYER_HEX] ?? p.color}} />
              <span style={{fontWeight: 650}}>{p.name}</span>
              {p.corporation && <span className="muted" style={{fontSize: 14}}>· {p.corporation}</span>}
            </li>
          ))}
        </ol>
      ))}
      <p className="faint" style={{margin: '14px 0 0', fontSize: 12, userSelect: 'all', wordBreak: 'break-all'}}>
        Game id {full && state.full ? state.full.gameId : state.id}
      </p>
    </div>
  );
}
