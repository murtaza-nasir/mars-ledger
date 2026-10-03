// Mission control's table-wide setting: Off, Text, or Text + voice. Any player can change it, in the
// lobby or from the game menu; the TV shows the change.
import {motion} from 'motion/react';
import {useId, useState} from 'react';
import {NARRATOR_LABEL, NARRATOR_MODES} from '../../shared/narrator';
import type {NarratorMode} from '../../shared/narrator';
import type {GameState} from '../../shared/game';
import {useNet} from '../net';

const HINT: Record<NarratorMode, string> = {
  off: 'No commentary.',
  text: 'Short lines about big moments appear on the TV.',
  voice: 'The TV shows the lines and reads them aloud.',
};

export function NarratorPick({state, playerId, glass}: {state: GameState; playerId: string; glass?: boolean}) {
  const enabled = useNet((s) => s.config?.narrator !== false);
  // "Text + voice" only when the server has a speech provider
  const voice = useNet((s) => s.config?.narratorVoice !== false);
  const send = useNet((s) => s.send);
  const mode = state.narrator ?? 'off';
  const modes = NARRATOR_MODES.filter((m) => m !== 'voice' || voice || mode === 'voice');
  const [error, setError] = useState<string | null>(null);
  const layout = useId();
  if (!enabled) return null;
  const pick = (m: NarratorMode) => {
    if (m === mode) return;
    send({t: 'narrator', playerId, mode: m}).then(() => setError(null)).catch((e) => setError(e.message));
  };
  return (
    <div style={{padding: glass ? '12px 14px' : 0, borderRadius: 16, background: glass ? 'rgba(0,0,0,.35)' : undefined,
      backdropFilter: glass ? 'blur(8px)' : undefined, boxShadow: glass ? 'inset 0 0 0 1px var(--rim)' : undefined}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8}}>
        <strong style={{fontWeight: 650}}>Mission control</strong>
        <span className="muted" style={{fontSize: 13}}>for the whole table</span>
      </div>
      <div role="radiogroup" aria-label="Mission control" style={{display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,.06)'}}>
        {modes.map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} data-narrator={m} onClick={() => pick(m)}
            style={{flex: 1, position: 'relative', padding: '10px 0', fontWeight: 650, fontSize: 15, fontVariationSettings: "'wdth' 85",
              color: mode === m ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
            {mode === m && <motion.span layoutId={`narrator-${layout}`} style={{position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--tr)'}}
              transition={{type: 'spring', stiffness: 420, damping: 34}} />}
            <span style={{position: 'relative'}}>{NARRATOR_LABEL[m]}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{margin: '8px 2px 0', fontSize: 14}}>{HINT[mode]}</p>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}
