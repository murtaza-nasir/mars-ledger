// "Your poster" on the phones' final-score screens: shows progress while the server paints it,
// develops into a preview, opens full screen, and saves (share sheet with the file where the browser
// allows it, otherwise a download). A styled card stands in if the poster could not be drawn.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {posterUrl} from '../../shared/poster';
import type {PosterOrientation, PosterStatus, PosterVariant} from '../../shared/poster';
import {useNet} from '../net';
import {PLAYER_HEX} from './Icons';

export type PosterSummary = {headline: string; rows: Array<{name: string; color: string; vp: number; place: number}>};

/** The words the fallback card uses, from the final-score rows the screen already has (best first). */
export function summarize(rows: PosterSummary['rows']): PosterSummary {
  const winners = rows.filter((r) => r.place === 1);
  const headline = rows.length === 1 ? `${rows[0].name}: ${rows[0].vp} points`
    : winners.length > 1 ? `Shared victory for ${winners.map((w) => w.name).join(' and ')}` : `${winners[0]?.name ?? ''} wins with ${winners[0]?.vp ?? 0} points`;
  return {headline, rows};
}

export function PosterCard({gameId, summary}: {gameId: string | null | undefined; summary: PosterSummary}) {
  const status = useNet((s) => (gameId ? s.posters[gameId] : undefined));
  const [variant, setVariant] = useState<PosterVariant>('library');
  const [open, setOpen] = useState(false);
  // Follow the one-off illustration once it arrives, unless the player already chose.
  const [chosen, setChosen] = useState(false);
  useEffect(() => { if (!chosen && status?.unique === 'ready') setVariant('unique'); }, [status?.unique, chosen]);
  const pick = (v: PosterVariant) => { setChosen(true); setVariant(v); };

  const ready = status?.library === 'ready';
  const failed = status?.library === 'failed';
  const shown: PosterVariant = variant === 'unique' && status?.unique === 'ready' ? 'unique' : 'library';

  return (
    <section aria-label="Your poster" style={{marginTop: 26}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10}}>
        <h2 style={{margin: 0, fontSize: 22, fontWeight: 750, fontVariationSettings: "'wdth' 90"}}>Your poster</h2>
        {ready && <span className="muted" style={{fontSize: 14}}>a keepsake of this game</span>}
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '112px 1fr', gap: 16, alignItems: 'center'}}>
        <button aria-label="Open the poster" disabled={!ready} onClick={() => setOpen(true)}
          style={{position: 'relative', width: 112, aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', background: 'linear-gradient(170deg, #2A2140, #4A2218 55%, #1A0D0A)',
            boxShadow: '0 12px 30px rgba(0,0,0,.45), inset 0 0 0 1px var(--rim-strong)'}}>
          <AnimatePresence mode="wait">
            {ready && status ? (
              <motion.img key={`${shown}-${status.version}`} src={posterUrl(status, shown, 'portrait')} alt="" draggable={false}
                initial={{opacity: 0, scale: 1.08, filter: 'blur(10px) saturate(.4)'}} animate={{opacity: 1, scale: 1, filter: 'blur(0px) saturate(1)'}}
                exit={{opacity: 0}} transition={{duration: 1.1, ease: [0.2, 0.9, 0.25, 1]}}
                style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
            ) : failed ? (
              <Fallback key="fallback" summary={summary} small />
            ) : (
              <motion.span key="painting" aria-hidden="true" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
                style={{position: 'absolute', inset: 0}}>
                <motion.span animate={{x: ['-120%', '120%']}} transition={{duration: 1.8, repeat: Infinity, ease: 'easeInOut'}}
                  style={{position: 'absolute', inset: 0, background: 'linear-gradient(100deg, transparent 20%, rgba(242,194,48,.25) 50%, transparent 80%)'}} />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        <div style={{display: 'grid', gap: 10}}>
          <p className="muted" style={{margin: 0, fontSize: 15}}>{statusLine(status, failed)}</p>
          {ready && status?.unique === 'ready' && (
            <div role="radiogroup" aria-label="Poster picture" style={{display: 'flex', gap: 4, padding: 3, borderRadius: 12, background: 'rgba(255,255,255,.06)'}}>
              {(['library', 'unique'] as const).map((v) => (
                <button key={v} role="radio" aria-checked={shown === v} onClick={() => pick(v)}
                  style={{flex: 1, position: 'relative', padding: '8px 0', fontSize: 14, fontWeight: 650, color: shown === v ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
                  {shown === v && <motion.span layoutId="poster-variant" style={{position: 'absolute', inset: 0, borderRadius: 9, background: 'var(--ice)'}} transition={{type: 'spring', stiffness: 420, damping: 34}} />}
                  <span style={{position: 'relative'}}>{v === 'library' ? 'Painting' : 'One-off'}</span>
                </button>
              ))}
            </div>
          )}
          {ready && status && <button className="btn warm" style={{minHeight: 46}} onClick={() => setOpen(true)} data-testid="poster-open">Save the poster</button>}
        </div>
      </div>
      {open && ready && status && createPortal(<Viewer status={status} variant={shown} onClose={() => setOpen(false)} />, document.body)}
    </section>
  );
}

function statusLine(s: PosterStatus | undefined, failed: boolean): string {
  if (failed) return 'The poster could not be drawn this time. Your scores are saved.';
  if (!s || s.library === 'pending') return 'Painting your poster of this game…';
  if (s.unique === 'pending') return 'Ready. A one-off illustration is being painted too.';
  if (s.unique === 'skipped') return 'Ready. The image server was busy, so it uses the painting from the library.';
  return 'Tap it to see it full size and save it to your phone.';
}

function Fallback({summary, small}: {summary: PosterSummary; small?: boolean}) {
  const k = small ? 0.34 : 1;
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} style={{position: 'absolute', inset: 0, padding: 18 * k, display: 'grid', alignContent: 'start', gap: 10 * k, textAlign: 'left'}}>
      <div style={{fontSize: 26 * k, fontWeight: 900, fontVariationSettings: "'wdth' 120"}}>Mars Ledger</div>
      <div style={{fontSize: 18 * k, fontWeight: 700}}>{summary.headline}</div>
      {summary.rows.map((r) => (
        <div key={r.name + r.color} style={{display: 'flex', justifyContent: 'space-between', fontSize: 16 * k, color: PLAYER_HEX[r.color] ?? 'var(--ice)'}}>
          <span>{r.place}. {r.name}</span><span className="num">{r.vp}</span>
        </div>
      ))}
    </motion.div>
  );
}

/** Full screen: the poster, a portrait/landscape choice, and Save. */
function Viewer({status, variant, onClose}: {status: PosterStatus; variant: PosterVariant; onClose: () => void}) {
  const [orientation, setOrientation] = useState<PosterOrientation>('portrait');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = posterUrl(status, variant, orientation);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setBusy(true); setNote(null);
    const name = `mars-ledger-${status.gameId}-${orientation}.png`;
    try {
      const nav = navigator as Navigator & {canShare?: (d: {files: File[]}) => boolean};
      if (nav.share && nav.canShare) {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], name, {type: 'image/png'});
        if (nav.canShare({files: [file]})) {
          await nav.share({files: [file], title: 'Mars Ledger'});
          setBusy(false);
          return;
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setBusy(false); return; } // the player closed the share sheet
    }
    // No share sheet with files here (plain http, older browsers): download it instead.
    const a = document.createElement('a');
    a.href = `${url}&download=1`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setNote('Downloading. You can also press and hold the picture to save it.');
    setBusy(false);
  }

  return (
    <motion.div role="dialog" aria-label="Your poster" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.3}}
      style={{position: 'fixed', inset: 0, zIndex: 95, background: 'radial-gradient(90% 60% at 50% 35%, #1E0E0A, #080302)', display: 'grid', gridTemplateRows: '1fr auto',
        padding: 'calc(12px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom))', gap: 12}}>
      <div onClick={onClose} style={{minHeight: 0, display: 'grid', placeItems: 'center'}}>
        <motion.img key={url} src={url} alt="The poster of this game" onClick={(e) => e.stopPropagation()}
          initial={{opacity: 0, scale: 0.94, y: 16}} animate={{opacity: 1, scale: 1, y: 0}} transition={{type: 'spring', stiffness: 220, damping: 24}}
          style={{maxWidth: '100%', maxHeight: '100%', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.6)', WebkitTouchCallout: 'default'}} />
      </div>
      <div style={{display: 'grid', gap: 10}}>
        <div role="radiogroup" aria-label="Shape" style={{display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,.07)'}}>
          {(['portrait', 'landscape'] as const).map((o) => (
            <button key={o} role="radio" aria-checked={orientation === o} onClick={() => setOrientation(o)}
              style={{flex: 1, position: 'relative', padding: '10px 0', fontWeight: 650, color: orientation === o ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
              {orientation === o && <motion.span layoutId="poster-shape" style={{position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--ice)'}} transition={{type: 'spring', stiffness: 420, damping: 34}} />}
              <span style={{position: 'relative'}}>{o === 'portrait' ? 'For your phone' : 'Wide'}</span>
            </button>
          ))}
        </div>
        {note && <p className="muted" role="status" style={{margin: 0, fontSize: 14, textAlign: 'center'}}>{note}</p>}
        <div style={{display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10}}>
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn warm" disabled={busy} onClick={save} data-testid="poster-save">{busy ? 'Preparing…' : 'Save the poster'}</button>
        </div>
      </div>
    </motion.div>
  );
}
