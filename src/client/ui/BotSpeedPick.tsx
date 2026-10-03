// How long the bots take over their moves: a table-wide setting, chosen in the lobby or from the game menu at any
// time. Table pace (about as long as a person) is the default; Quick is about 1–3 s a move.
import {motion} from 'motion/react';
import {useId, useState} from 'react';
import {BOT_SPEED_HINT, BOT_SPEED_LABEL, BOT_SPEEDS, DEFAULT_BOT_SPEED} from '../../shared/bots';
import type {BotSpeed} from '../../shared/bots';
import type {GameState} from '../../shared/game';
import {useNet} from '../net';

export function BotSpeedPick({state, playerId, glass}: {state: GameState; playerId: string; glass?: boolean}) {
  const send = useNet((s) => s.send);
  const value = state.botSpeed ?? DEFAULT_BOT_SPEED;
  const [error, setError] = useState<string | null>(null);
  const layout = useId();
  const pick = (v: BotSpeed) => {
    if (v === value) return;
    send({t: 'setBotSpeed', playerId, speed: v}).then(() => setError(null)).catch((e) => setError(e.message));
  };
  return (
    <div data-testid="bot-speed" style={{padding: glass ? '12px 14px' : 0, borderRadius: 16, background: glass ? 'rgba(0,0,0,.35)' : undefined,
      backdropFilter: glass ? 'blur(8px)' : undefined, boxShadow: glass ? 'inset 0 0 0 1px var(--rim)' : undefined}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8}}>
        <strong style={{fontWeight: 650}}>Bot speed</strong>
        <span className="muted" style={{fontSize: 13}}>for the whole table</span>
      </div>
      <div role="radiogroup" aria-label="Bot speed" style={{display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,.06)'}}>
        {BOT_SPEEDS.map((v) => (
          <button key={v} role="radio" aria-checked={value === v} data-bot-speed={v} onClick={() => pick(v)}
            style={{flex: 1, position: 'relative', padding: '10px 0', fontWeight: 650, fontSize: 15, fontVariationSettings: "'wdth' 85",
              color: value === v ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
            {value === v && <motion.span layoutId={`botspeed-${layout}`} style={{position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--ice)'}}
              transition={{type: 'spring', stiffness: 420, damping: 34}} />}
            <span style={{position: 'relative'}}>{BOT_SPEED_LABEL[v]}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{margin: '8px 2px 0', fontSize: 14}}>{BOT_SPEED_HINT[value]}</p>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}
