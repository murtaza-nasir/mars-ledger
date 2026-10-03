// Smart hints on the phone: a personal switch (off by default), one quiet rotating line above the dock on
// your turn, and a sheet that explains every current hint with the facts behind it. Never a popup, never a sound.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import type {GameState} from '../../shared/game';
import type {Hints, TurnHint} from '../../shared/hints';
import {useNet} from '../net';
import {Sheet} from './Sheet';
import {useViewerCovered} from './deck/cover';

/** Is this seat's hints setting on? A profiled seat keeps it on the profile, others beside the game. */
export function useHintsOn(state: GameState, playerId: string): boolean {
  const profileId = state.players.find((p) => p.id === playerId)?.profileId;
  const profile = useNet((s) => (profileId ? s.profiles.find((p) => p.id === profileId) : undefined));
  const seat = useNet((s) => s.seatPrefs[playerId]?.hints);
  return profileId ? !!profile?.hints : !!seat;
}

export function HintsPick({state, playerId}: {state: GameState; playerId: string}) {
  const {updateProfile, setSeatHints} = useNet();
  const on = useHintsOn(state, playerId);
  const profileId = state.players.find((p) => p.id === playerId)?.profileId;
  return <HintsSwitch on={on} saved={profileId ? 'Saved on your profile.' : 'Just for you.'}
    toggle={() => (profileId ? updateProfile(profileId, {hints: !on}) : setSeatHints(playerId, !on))} />;
}

/** The hints switch on a profile screen (the person's own profile). */
export function ProfileHintsSwitch({profileId}: {profileId: string}) {
  const {updateProfile} = useNet();
  const on = useNet((s) => !!s.profiles.find((p) => p.id === profileId)?.hints);
  return <HintsSwitch on={on} saved="Follows you to every game night." toggle={() => updateProfile(profileId, {hints: !on})} />;
}

function HintsSwitch({on, saved, toggle: run}: {on: boolean; saved: string; toggle: () => Promise<void>}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true); setError(null);
    try { await run(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <motion.button role="switch" aria-checked={on} data-hints={on ? 'on' : 'off'} whileTap={{scale: 0.98}} disabled={busy} onClick={toggle}
        style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '4px 0'}}>
        <span style={{flex: 1}}>
          <strong style={{fontWeight: 650}}>Hints</strong>
          <span className="muted" style={{display: 'block', fontSize: 14}}>
            Quiet notes on your own phone: milestones you can claim, awards you lead, cards that are close, conversions and unused card actions. {saved}
          </span>
        </span>
        <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: on ? 'var(--tr)' : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
          <motion.span animate={{x: on ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
            style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: on ? '#0E2E47' : 'var(--ice)'}} />
        </span>
      </motion.button>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}

const ROTATE_MS = 5200;

/** A small spark glyph, the only mark hints use. */
export function HintMark({size = 14, color = 'var(--tr)'}: {size?: number; color?: string}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{flex: 'none'}}>
      <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill={color} />
    </svg>
  );
}

/**
 * One hint at a time above the dock, crossfading every few seconds; tapping opens the explanation sheet.
 * `rightInset` keeps it clear of the turn-clock pill.
 */
export function HintLine({hints, rightInset = 0}: {hints: TurnHint[]; rightInset?: number}) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const key = hints.map((h) => h.id).join('|');
  useEffect(() => { setI(0); }, [key]);
  const covered = useViewerCovered();
  useEffect(() => {
    if (hints.length < 2 || covered) return;
    const t = setInterval(() => setI((x) => (x + 1) % hints.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [key, hints.length, covered]);
  const h = hints[i % Math.max(1, hints.length)];
  return (
    <>
      <AnimatePresence>
        {h && (
          <motion.button key="hint" data-testid="hint-line" onClick={() => setOpen(true)} aria-label={`Hint: ${h.line}. Tap for details`}
            initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: 8}} transition={{type: 'spring', stiffness: 360, damping: 28}}
            style={{position: 'absolute', left: 14, right: 14 + rightInset, top: -36, height: 30, display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 12px 0 10px', borderRadius: 999, background: 'rgba(14,30,44,.92)', backdropFilter: 'blur(10px)',
              boxShadow: 'inset 0 0 0 1px rgba(111,184,232,.35), 0 6px 18px rgba(0,0,0,.35)', overflow: 'hidden', textAlign: 'left'}}>
            <HintMark />
            <AnimatePresence mode="wait">
              <motion.span key={h.id} initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}} transition={{duration: 0.25}}
                style={{flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--ice)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {h.line}
              </motion.span>
            </AnimatePresence>
            {hints.length > 1 && <span className="num faint" style={{fontSize: 12}}>{(i % hints.length) + 1}/{hints.length}</span>}
          </motion.button>
        )}
      </AnimatePresence>
      <Sheet open={open} onClose={() => setOpen(false)} title="Hints">
        <HintsList hints={hints} />
      </Sheet>
    </>
  );
}

export function HintsList({hints}: {hints: TurnHint[]}) {
  if (!hints.length) return <p className="muted">Nothing to point out right now.</p>;
  return (
    <div data-testid="hints-list" style={{display: 'grid', gap: 10}}>
      {hints.map((h, k) => (
        <motion.div key={h.id} initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: k * 0.05}}
          style={{padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.05)', boxShadow: 'inset 3px 0 0 var(--tr)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650, fontSize: 16}}><HintMark />{h.line}</div>
          <ul style={{margin: '6px 0 0', paddingLeft: 22, display: 'grid', gap: 2}}>
            {h.facts.map((f, j) => <li key={j} className="muted" style={{fontSize: 14}}>{f}</li>)}
          </ul>
        </motion.div>
      ))}
      <p className="faint" style={{fontSize: 13, margin: '4px 2px 0'}}>Hints only state what the board shows right now. Turn them off in the ⋯ menu.</p>
    </div>
  );
}

export type {Hints};
