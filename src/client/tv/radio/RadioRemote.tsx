// The phones' radio remote, in the game menu: the TV's Radio switch (always there, since the TV is hard to
// reach), and while the radio plays, what is on and ⏮ ⏯ ⏭. Everything goes through the server (rate-limited).
import {motion} from 'motion/react';
import {useState} from 'react';
import {useNet} from '../../net';
import {thumbnailUrl} from '../../../shared/radio';
import type {RadioAction} from '../../../shared/radio';

export function RadioRemote({playerId}: {playerId: string}) {
  const now = useNet((s) => s.radioNow);
  const radioRemote = useNet((s) => s.radioRemote);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<RadioAction | null>(null);
  const enabled = !!now?.enabled;
  const press = (a: RadioAction) => {
    setBusy(a);
    setError(null);
    radioRemote(playerId, a).catch((e: Error) => setError(e.message)).finally(() => setBusy(null));
  };
  const sub = now ? [now.artist, now.game].filter(Boolean).join(' · ') : '';
  const btn = (a: RadioAction, label: string, path: string, big = false) => (
    <button aria-label={label} data-remote={a} disabled={busy !== null} onClick={() => press(a)}
      style={{width: big ? 48 : 40, height: big ? 48 : 40, borderRadius: 999, display: 'grid', placeItems: 'center', flex: 'none',
        background: big ? 'var(--ice)' : 'rgba(255,255,255,.08)', color: big ? 'var(--dusk-1)' : 'var(--ice)', opacity: busy && busy !== a ? 0.5 : 1}}>
      <svg viewBox="0 0 24 24" width={big ? 22 : 18} height={big ? 22 : 18} aria-hidden="true"><path fill="currentColor" d={path} /></svg>
    </button>
  );
  return (
    <section aria-label="Radio" data-radio-remote="" style={{minWidth: 0, paddingBottom: 12, borderBottom: '1px solid var(--rim)'}}>
      <motion.button role="switch" aria-checked={enabled} data-radio-switch={enabled ? 'on' : 'off'} whileTap={{scale: 0.98}} disabled={busy !== null}
        onClick={() => press(enabled ? 'off' : 'on')}
        style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '4px 0'}}>
        <span style={{flex: 1, minWidth: 0}}>
          <strong style={{fontWeight: 650}}>Radio on the TV</strong>
          <span className="muted" style={{display: 'block', fontSize: 14}}>
            {!enabled ? 'The playlist on the TV during the game.' : now?.on ? 'Playing on the TV.' : 'On. The music starts with the first move.'}
          </span>
        </span>
        <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: enabled ? 'var(--tr)' : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
          <motion.span initial={false} animate={{x: enabled ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
            style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: enabled ? '#0E2E47' : 'var(--ice)'}} />
        </span>
      </motion.button>
      {now?.on && <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 10}}>
        <div aria-hidden="true" style={{width: 48, height: 48, flex: 'none', borderRadius: 8,
          background: now.videoId ? `#000 url(${thumbnailUrl(now.videoId, 'hq')}) center / 177.8% auto no-repeat` : 'rgba(255,255,255,.06)'}} />
        {/* zero basis: long titles shorten with an ellipsis instead of widening the menu */}
        <div style={{minWidth: 0, width: 0, flex: '1 1 0'}}>
          <div data-remote-title="" style={{fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{now.title || 'Starting…'}</div>
          {sub && <div className="muted" style={{fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{sub}</div>}
        </div>
        {btn('prev', 'Previous track', 'M6 5h2.2v14H6zM19 5.6v12.8L9.6 12z')}
        {btn('toggle', now.playing ? 'Pause the radio' : 'Play the radio', now.playing ? 'M6.5 5h3.8v14H6.5zm7.2 0h3.8v14h-3.8z' : 'M7.5 4.8v14.4L19.4 12z', true)}
        {btn('next', 'Next track', 'M15.8 5H18v14h-2.2zM5 5.6v12.8L14.4 12z')}
      </div>}
      {error && <p role="alert" style={{margin: '8px 4px 0', fontSize: 14, color: 'var(--ember)'}}>{error}</p>}
    </section>
  );
}
