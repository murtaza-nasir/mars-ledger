// "Record performance" in the phone's ⋯ game menu: this device only (localStorage), with a Send button and an
// optional label for the session (e.g. "after a change").
import {motion} from 'motion/react';
import {useSyncExternalStore} from 'react';
import {perfStatus, send, setPerfLabel, setPerfOn, subscribePerf} from './recorder';

export function PerfPick() {
  const st = useSyncExternalStore(subscribePerf, perfStatus);
  return (
    <div style={{display: 'grid', gap: 8}}>
      <motion.button role="switch" aria-checked={st.on} data-perf={st.on ? 'on' : 'off'} whileTap={{scale: 0.98}} onClick={() => void setPerfOn(!st.on)}
        style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '4px 0'}}>
        <span style={{flex: 1}}>
          <strong style={{fontWeight: 650}}>Record performance</strong>
          <span className="muted" style={{display: 'block', fontSize: 14}}>
            Times every frame while you play and sends the numbers (no names or game data) to the server's /perf page. This phone only.
          </span>
        </span>
        <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: st.on ? '#C4372B' : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
          <motion.span animate={{x: st.on ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
            style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: st.on ? '#3A0B07' : 'var(--ice)'}} />
        </span>
      </motion.button>
      {st.on && (
        <div style={{display: 'grid', gap: 8}}>
          <input data-perf-label aria-label="Label for this recording" placeholder="Label (optional), e.g. after the fix" defaultValue={st.label} maxLength={80}
            onChange={(e) => setPerfLabel(e.target.value)}
            style={{padding: '10px 12px', borderRadius: 12, border: 'none', background: 'rgba(255,255,255,.07)', color: 'var(--ice)', font: 'inherit', fontSize: 16}} />
          <button className="btn ghost" data-perf-send disabled={st.sending} onClick={() => void send('manual')} style={{justifyContent: 'space-between'}}>
            <span>{st.sending ? 'Sending…' : 'Send recording'}</span>
            <span className="faint num" style={{fontSize: 14}}>{st.interactions} marked</span>
          </button>
          {st.lastSent && <p data-perf-result={st.lastSent.ok ? 'ok' : 'error'} className="muted" style={{margin: '0 2px', fontSize: 14, color: st.lastSent.ok ? undefined : 'var(--ember)'}}>{st.lastSent.text}</p>}
        </div>
      )}
    </div>
  );
}
