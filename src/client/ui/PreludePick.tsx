// The Prelude expansion, for the whole table and both modes: each player keeps two prelude cards
// and plays them before the first action round.
import {motion} from 'motion/react';
import {useState} from 'react';
import type {GameState} from '../../shared/game';
import {useNet} from '../net';
import {TYPE_COLOR} from './CardFace';

export function PreludePick({state, playerId, glass}: {state: GameState; playerId: string; glass?: boolean}) {
  const send = useNet((s) => s.send);
  const on = !!state.prelude;
  const [error, setError] = useState<string | null>(null);
  const toggle = () => send({t: 'setPrelude', playerId, on: !on}).then(() => setError(null)).catch((e) => setError(e.message));
  const amber = TYPE_COLOR.prelude;
  return (
    <div>
      <motion.button role="switch" aria-checked={on} data-prelude={on ? 'on' : 'off'} whileTap={{scale: 0.98}} onClick={toggle}
        style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: glass ? '12px 16px' : '4px 0', borderRadius: 16,
          background: glass ? 'rgba(0,0,0,.35)' : undefined, backdropFilter: glass ? 'blur(8px)' : undefined,
          boxShadow: glass ? (on ? `inset 0 0 0 1.5px ${amber}` : 'inset 0 0 0 1px var(--rim)') : undefined}}>
        <span style={{flex: 1}}>
          <strong style={{fontWeight: 650}}>Prelude</strong>
          <span className="muted" style={{display: 'block', fontSize: 14}}>
            Everyone keeps two prelude cards and plays them before the first round: a faster, bolder start. For the whole table.
          </span>
        </span>
        <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: on ? amber : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
          <motion.span animate={{x: on ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
            style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: on ? '#2A1A04' : 'var(--ice)'}} />
        </span>
      </motion.button>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}
