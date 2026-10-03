// The turn clock's table-wide setting: Off, Relaxed (3 minutes) or Brisk (90 seconds) per turn.
// Any player can change it, in the lobby or from the game menu. It is a nudge: nothing happens at zero.
import {motion} from 'motion/react';
import {useId, useState} from 'react';
import {TURN_CLOCK_HINT, TURN_CLOCK_LABEL, TURN_CLOCKS} from '../../shared/clock';
import type {TurnClockSetting} from '../../shared/clock';
import type {GameState} from '../../shared/game';
import {useNet} from '../net';

export function TurnClockPick({state, playerId, glass}: {state: GameState; playerId: string; glass?: boolean}) {
  const send = useNet((s) => s.send);
  const value = state.turnClock ?? 'off';
  const [error, setError] = useState<string | null>(null);
  const layout = useId();
  const pick = (c: TurnClockSetting) => {
    if (c === value) return;
    send({t: 'setTurnClock', playerId, clock: c}).then(() => setError(null)).catch((e) => setError(e.message));
  };
  return (
    <div style={{padding: glass ? '12px 14px' : 0, borderRadius: 16, background: glass ? 'rgba(0,0,0,.35)' : undefined,
      backdropFilter: glass ? 'blur(8px)' : undefined, boxShadow: glass ? 'inset 0 0 0 1px var(--rim)' : undefined}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8}}>
        <strong style={{fontWeight: 650}}>Turn clock</strong>
        <span className="muted" style={{fontSize: 13}}>for the whole table</span>
      </div>
      <div role="radiogroup" aria-label="Turn clock" style={{display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,.06)'}}>
        {TURN_CLOCKS.map((c) => (
          <button key={c} role="radio" aria-checked={value === c} data-turn-clock={c} onClick={() => pick(c)}
            style={{flex: 1, position: 'relative', padding: '10px 0', fontWeight: 650, fontSize: 15, fontVariationSettings: "'wdth' 85",
              color: value === c ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
            {value === c && <motion.span layoutId={`turnclock-${layout}`} style={{position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--heat)'}}
              transition={{type: 'spring', stiffness: 420, damping: 34}} />}
            <span style={{position: 'relative'}}>{TURN_CLOCK_LABEL[c]}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{margin: '8px 2px 0', fontSize: 14}}>{TURN_CLOCK_HINT[value]}</p>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}
