// The end-of-game poster's optional extra, for the whole table: besides the poster made from the
// painted library, ask the shared image server for a one-off illustration of this game's Mars.
import {motion} from 'motion/react';
import {useState} from 'react';
import type {GameState} from '../../shared/game';
import {useNet} from '../net';

export function PosterArtPick({state, playerId, glass}: {state: GameState; playerId: string; glass?: boolean}) {
  const available = useNet((s) => !!s.config?.posterUnique);
  const send = useNet((s) => s.send);
  const on = !!state.posterUnique;
  const [error, setError] = useState<string | null>(null);
  if (!available) return null;
  const toggle = () => send({t: 'posterArt', playerId, unique: !on}).then(() => setError(null)).catch((e) => setError(e.message));
  return (
    <div>
      <motion.button role="switch" aria-checked={on} data-poster-unique={on ? 'on' : 'off'} whileTap={{scale: 0.98}} onClick={toggle}
        style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: glass ? '12px 16px' : '4px 0', borderRadius: 16,
          background: glass ? 'rgba(0,0,0,.35)' : undefined, backdropFilter: glass ? 'blur(8px)' : undefined,
          boxShadow: glass ? (on ? 'inset 0 0 0 1.5px var(--tr)' : 'inset 0 0 0 1px var(--rim)') : undefined}}>
        <span style={{flex: 1}}>
          <strong style={{fontWeight: 650}}>One-off poster illustration</strong>
          <span className="muted" style={{display: 'block', fontSize: 14}}>
            At the end, also paint a unique picture of this game's Mars on the image server, when it is free. For the whole table.
          </span>
        </span>
        <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: on ? 'var(--tr)' : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
          <motion.span animate={{x: on ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
            style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: on ? 'var(--dusk-1)' : 'var(--ice)'}} />
        </span>
      </motion.button>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}
